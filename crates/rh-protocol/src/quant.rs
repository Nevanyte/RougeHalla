//! Quantization of remote actors (protocol v2). The SELF view is never quantized (prediction and reconciliation need full
//! precision); only what a client merely draws is.
//!
//! * Position: `u16` at 1/8 world unit ([`POS_SCALE`]). The finest power-of-two step that fits a `u16` over the largest
//!   world extent: the nominal world is 160 x 32 u = 5120 u, and 5120 * 8 = 40960 <= 65535 (a step of 1/16 would need
//!   81920). Representable range 0 ..= 8191.875 u (the 255-tile guide limit of a 256-tile map); a value outside it
//!   SATURATES (the codec never fails an observation over a position). Rounding is half away from zero.
//!   Error bound: |decoded - original| <= 1/16 u = 0.0625 u (for a value inside the range, up to f32 rounding of the input).
//! * Facing: `u16` over 2 pi, read as a two's complement angle in `[-pi, pi)`. The step is [`FACING_STEP`] = 2 pi / 65536
//!   (9.59e-5 rad, 0.0055 degree); the error is at most half of it, 4.79e-5 rad (modulo 2 pi: +pi and -pi are the same
//!   code).
//! * hp: the observation already rounds to hundredths, so `hp_pct` is exact (`u8`, 0 ..= 100).
//!
//! Decoding is exact in `f32` and portable: a position is `q / 8` (a power of two: exact), a facing is the `f32` product
//! of the signed code and [`FACING_STEP_F32`] (one rounding, the same on every IEEE-754 platform). The C# and JS decoders
//! compute the same two expressions, and the golden vectors carry the decoded values.

use std::f64::consts::TAU;

/// Position steps per world unit (a power of two, so dequantizing is exact).
pub const POS_SCALE: f32 = 8.0;
/// Largest representable position: `65535 / 8`.
pub const POS_MAX: f32 = 65535.0 / POS_SCALE;
/// Facing step in radians (`2 pi / 65536`), as the encoder divides by it.
pub const FACING_STEP: f64 = TAU / 65536.0;
/// [`FACING_STEP`] rounded to `f32`: the factor a decoder multiplies the signed code by.
pub const FACING_STEP_F32: f32 = FACING_STEP as f32;
/// Largest quantity (in steps) the encoder rounds; anything beyond is an absurd angle that only has to be deterministic.
const FACING_CLAMP: f64 = (1u64 << 40) as f64;

/// World units to the nearest 1/8 u, saturating to `0 ..= 65535` (NaN is 0).
#[inline]
pub fn quantize_pos(v: f32) -> u16 {
    ((v as f64) * (POS_SCALE as f64))
        .round()
        .clamp(0.0, 65535.0) as u16
}

#[inline]
pub fn dequantize_pos(q: u16) -> f32 {
    q as f32 / POS_SCALE
}

/// An angle in radians to a `u16` turn fraction (wraps modulo 2 pi; NaN and infinities are 0).
#[inline]
pub fn quantize_facing(a: f32) -> u16 {
    let t = (a as f64) / FACING_STEP;
    if !t.is_finite() {
        return 0;
    }
    (t.clamp(-FACING_CLAMP, FACING_CLAMP).round() as i64 & 0xffff) as u16
}

/// The angle a code stands for, in `[-pi, pi)`.
#[inline]
pub fn dequantize_facing(q: u16) -> f32 {
    (q as i16) as f32 * FACING_STEP_F32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_step_is_the_finest_power_of_two_that_fits_the_world() {
        let world = 160.0 * 32.0;
        assert!(world * POS_SCALE <= 65535.0);
        assert!(world * POS_SCALE * 2.0 > 65535.0, "1/16 would not fit");
        assert_eq!(POS_MAX, 8191.875);
    }

    #[test]
    fn positions_round_trip_within_half_a_step_and_saturate() {
        for i in 0..=40960u32 {
            let v = i as f32 * 0.125 + 0.0625; // midpoints round away from zero, so the error is exactly 1/16
            let back = dequantize_pos(quantize_pos(v));
            assert!((back - v).abs() <= 0.0625, "{v} -> {back}");
        }
        assert_eq!(quantize_pos(-5.0), 0);
        assert_eq!(quantize_pos(f32::NAN), 0);
        assert_eq!(quantize_pos(1e9), 65535);
        assert_eq!(dequantize_pos(quantize_pos(5120.0)), 5120.0);
        assert_eq!(quantize_pos(0.0625), 1, "ties round away from zero");
    }

    #[test]
    fn facing_round_trips_within_half_a_step_modulo_a_turn() {
        let tau = TAU as f32;
        for i in 0..10_000 {
            let a = -3.2 + 6.4 * i as f32 / 10_000.0;
            let back = dequantize_facing(quantize_facing(a));
            let mut d = (back - a).rem_euclid(tau);
            if d > tau / 2.0 {
                d -= tau;
            }
            assert!(d.abs() <= 4.85e-5, "{a} -> {back}");
        }
        assert_eq!(quantize_facing(f32::INFINITY), 0);
        assert_eq!(quantize_facing(0.0), 0);
        assert_eq!(dequantize_facing(0x8000), -std::f32::consts::PI);
        assert_eq!(quantize_facing(std::f32::consts::PI), 0x8000);
    }

    #[test]
    fn quantizing_is_idempotent() {
        for q in (0..=65535u32).step_by(7) {
            assert_eq!(quantize_pos(dequantize_pos(q as u16)), q as u16);
            assert_eq!(quantize_facing(dequantize_facing(q as u16)), q as u16);
        }
    }
}
