//! The actual supported source effects and tiers.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    pub tiers: [u8; 3],
    pub slow_burn_linger: f64,
    pub slow_burn_dot: f64,
    pub siphon: f64,
    pub pocket_sand_ms: f64,
    pub pocket_sand_slow: f64,
}
pub const DEFINITION: Definition = Definition {
    tiers: [1, 1, 2],
    slow_burn_linger: 2.,
    slow_burn_dot: 0.7,
    siphon: 0.2,
    pocket_sand_ms: 1000.,
    pocket_sand_slow: 0.3,
};
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    for v in d.tiers {
        word(u64::from(v))
    }
    for v in [
        d.slow_burn_linger,
        d.slow_burn_dot,
        d.siphon,
        d.pocket_sand_ms,
        d.pocket_sand_slow,
    ] {
        word(v.to_bits())
    }
}
