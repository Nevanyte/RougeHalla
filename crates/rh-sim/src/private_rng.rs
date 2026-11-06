//! Source private reward stream. Words come from server secrets, never the public map seed.
//! Serialized state is for private checkpoints only; observations must not contain this type.
/// The actual warmup policy is visited by content integration, not shadowed by a hash-only constant.
pub struct Definition {
    pub warmups: usize,
}
pub static DEFINITION: Definition = Definition { warmups: 16 };
pub fn visit_content(mut word: impl FnMut(u64)) {
    word(DEFINITION.warmups as u64);
}
#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sfc32 {
    words: [u32; 4],
}
impl std::fmt::Debug for Sfc32 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Sfc32 { <private> }")
    }
}
impl Sfc32 {
    /// Actual source `rewardStream`: four salt words followed by sixteen unobserved warmup draws.
    pub fn from_words(words: [u32; 4]) -> Self {
        let mut stream = Self { words };
        for _ in 0..DEFINITION.warmups {
            stream.next_u32();
        }
        stream
    }
    pub fn next_u32(&mut self) -> u32 {
        let [a, b, c, d] = self.words;
        let t0 = a.wrapping_add(b);
        let d = d.wrapping_add(1);
        let t = t0.wrapping_add(d);
        self.words = [
            b ^ (b >> 9),
            c.wrapping_add(c << 3),
            c.rotate_left(21).wrapping_add(t),
            d,
        ];
        t
    }
    pub fn next_f64(&mut self) -> f64 {
        f64::from(self.next_u32()) / 4_294_967_296.0
    }
    /// Trusted crate-only parity projection, never an observation.
    #[cfg(test)]
    pub(crate) fn words(&self) -> [u32; 4] {
        self.words
    }
}
/// Source `mixedSalt`, over explicit secret words. Does not draw or mutate a stream.
pub fn mixed_salt(words: [u32; 4], tag: u32) -> [u32; 4] {
    let mut lane =
        std::array::from_fn(|i| words[i] ^ tag ^ ((i as u32 + 1).wrapping_mul(0x9e37_79b1)));
    for _ in 0..3 {
        for i in 0..4 {
            lane[i] =
                fmix(lane[i].wrapping_add(
                    lane[(i + 1) & 3] ^ lane[(i + 2) & 3].rotate_left(7 + 5 * i as u32),
                ));
        }
    }
    lane
}
pub(crate) fn fmix(mut h: u32) -> u32 {
    h = (h ^ (h >> 16)).wrapping_mul(0x85eb_ca6b);
    h = (h ^ (h >> 13)).wrapping_mul(0xc2b2_ae35);
    h ^ (h >> 16)
}
