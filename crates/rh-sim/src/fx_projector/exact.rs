//! Exact sum of nonnegative finite binary64 values, rounded once to nearest/ties-even.
//! Limbs represent integer multiples of 2^-1074. 34 limbs cover finite f64 plus 78 carry bits.
#[derive(Clone, Debug)]
pub(crate) struct ExactSum {
    words: [u64; 34],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SumError {
    Invalid,
    Overflow,
}
impl Default for ExactSum {
    fn default() -> Self {
        Self { words: [0; 34] }
    }
}
impl ExactSum {
    pub(crate) fn add(&mut self, value: f64) -> Result<(), SumError> {
        if !value.is_finite() || value < 0.0 {
            return Err(SumError::Invalid);
        }
        if value == 0.0 {
            return Ok(());
        }
        let bits = value.to_bits();
        let exponent = ((bits >> 52) & 0x7ff) as usize;
        let mantissa = (bits & 0x000f_ffff_ffff_ffff) | if exponent == 0 { 0 } else { 1 << 52 };
        let shift = exponent.saturating_sub(1);
        let index = shift / 64;
        let offset = shift % 64;
        self.add_word(index, mantissa << offset)?;
        if offset > 0 {
            self.add_word(index + 1, mantissa >> (64 - offset))?;
        }
        Ok(())
    }
    fn add_word(&mut self, mut index: usize, mut word: u64) -> Result<(), SumError> {
        while word != 0 {
            let Some(slot) = self.words.get_mut(index) else {
                return Err(SumError::Overflow);
            };
            let (v, carry) = slot.overflowing_add(word);
            *slot = v;
            word = u64::from(carry);
            index += 1;
        }
        Ok(())
    }
    fn bit(&self, index: usize) -> bool {
        (self.words[index / 64] >> (index % 64)) & 1 != 0
    }
    pub(crate) fn rounded(&self) -> Result<f64, SumError> {
        let Some(index) = self.words.iter().rposition(|&w| w != 0) else {
            return Ok(0.0);
        };
        let mut high = index * 64 + (63 - self.words[index].leading_zeros() as usize);
        if high < 52 {
            return Ok(f64::from_bits(self.words[0]));
        }
        let shift = high - 52;
        let mut mantissa = 0;
        for bit in (shift..=high).rev() {
            mantissa = (mantissa << 1) | u64::from(self.bit(bit));
        }
        if shift > 0
            && self.bit(shift - 1)
            && ((0..shift - 1).any(|i| self.bit(i)) || mantissa & 1 != 0)
        {
            mantissa += 1;
        }
        if mantissa == 1 << 53 {
            mantissa >>= 1;
            high += 1;
        }
        let exponent = high - 51;
        if exponent >= 2047 {
            return Err(SumError::Overflow);
        }
        Ok(f64::from_bits(
            ((exponent as u64) << 52) | (mantissa & 0x000f_ffff_ffff_ffff),
        ))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_rounding_and_permutations() {
        for xs in [
            [
                1.0,
                (1.0 / (1u64 << 53) as f64),
                (1.0 / (1u64 << 53) as f64),
            ],
            [((1u64 << 53) as f64), 1.0, 1.0],
            [f64::from_bits(1), f64::from_bits(1), f64::from_bits(1)],
        ] {
            let mut a = ExactSum::default();
            let mut b = ExactSum::default();
            for x in xs {
                a.add(x).unwrap();
            }
            for x in xs.into_iter().rev() {
                b.add(x).unwrap();
            }
            assert_eq!(a.rounded(), b.rounded());
        }
        let mut a = ExactSum::default();
        a.add(1.).unwrap();
        a.add(1.0 / (1u64 << 53) as f64).unwrap();
        assert_eq!(a.rounded(), Ok(1.));
        a.add(1.0 / (1u64 << 54) as f64).unwrap();
        assert_eq!(a.rounded(), Ok(f64::from_bits(1f64.to_bits() + 1)));
    }
    #[test]
    fn invalid_inputs_and_overflow_are_explicit() {
        for v in [-1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(ExactSum::default().add(v), Err(SumError::Invalid));
        }
        let mut s = ExactSum::default();
        s.add(f64::MAX).unwrap();
        assert_eq!(s.rounded(), Ok(f64::MAX));
        s.add(f64::MAX).unwrap();
        assert_eq!(s.rounded(), Err(SumError::Overflow));
        let mut s = ExactSum::default();
        s.add(f64::from_bits((1u64 << 52) - 1)).unwrap();
        s.add(f64::from_bits(1)).unwrap();
        assert_eq!(s.rounded(), Ok(f64::MIN_POSITIVE));
    }
}
