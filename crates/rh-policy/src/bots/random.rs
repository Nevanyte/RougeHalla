//! Distributions over a seeded stream (packages/server/src/bots/brain/random.ts): shared by the humanizer (delays,
//! scatter) and the choices (softmax). Nothing here reads a clock or entropy: a brain replays exactly from its seed.
//!
//! The generator is the legacy shared mulberry32 (shared/src/rng.ts) as f64 in [0, 1): the same recurrence rh-sim uses
//! for its world draws, reimplemented here so a policy's own stream never touches match secrets (C-RNG).
use crate::bots::types::{ExGaussian, HumanizerRules};

/// A deterministic natural log. rh-sim forks the reference libm for exp/cos/sqrt so every declared target agrees bit for
/// bit; rh-sim exposes no ln, and std's ln is the platform libm. Newton on the forked exp keeps a policy stream identical
/// on every target without adding a dependency (Cargo.lock stays untouched): y <- y + x/e^y - 1, from an exponent/mantissa
/// start, converges quadratically.
pub fn ln(x: f64) -> f64 {
    if x <= 0. {
        return f64::NEG_INFINITY;
    }
    let bits = x.to_bits();
    let exponent = ((bits >> 52) as i64 - 1023) as f64;
    let mantissa = f64::from_bits((bits & 0x000f_ffff_ffff_ffff) | 0x3ff0_0000_0000_0000);
    let m = mantissa - 1.;
    let mut y = exponent * std::f64::consts::LN_2 + m - m * m / 2. + m * m * m / 3.;
    for _ in 0..10 {
        y += x / rh_sim::math::exp(y) - 1.;
    }
    y
}

/// The legacy shared Rng: mulberry32, floats in [0, 1).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rng {
    state: u32,
}
impl Rng {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }
    pub fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let a = self.state;
        let mut t = (a ^ (a >> 15)).wrapping_mul(a | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }
    pub fn next_f64(&mut self) -> f64 {
        f64::from(self.next_u32()) / 4_294_967_296.
    }
}

/// A 32-bit seed for one stream (source BotManager.ts `mix`): the seed mixed with a tag (a murmur finaliser), so no
/// two streams of a manager march in step.
pub fn mix(seed: u32, tag: u32) -> u32 {
    let mut h = seed.wrapping_mul(0x9e37_79b1) ^ (tag.wrapping_add(1)).wrapping_mul(0x85eb_ca6b);
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    h ^ (h >> 16)
}

pub fn uniform(rng: &mut Rng, lo: f64, hi: f64) -> f64 {
    lo + (hi - lo) * rng.next_f64()
}

pub fn chance(rng: &mut Rng, p: f64) -> bool {
    rng.next_f64() < p
}

/// Box-Muller: one normal draw (two uniforms, the second half is discarded so the stream advances the same every call).
pub fn gaussian(rng: &mut Rng, mu: f64, sigma: f64) -> f64 {
    let u1 = rng.next_f64().max(1e-12);
    let u2 = rng.next_f64();
    mu + sigma
        * rh_sim::math::sqrt(-2. * ln(u1))
        * rh_sim::math::cos(2. * std::f64::consts::PI * u2)
}

/// Exponential with the given mean.
pub fn exponential(rng: &mut Rng, mean: f64) -> f64 {
    -mean * ln((1. - rng.next_f64()).max(1e-12))
}

/// An ex-Gaussian delay in ms: a Gaussian motor part plus an exponential tail of slow answers. Below floor it is drawn
/// again (a human cannot answer faster), above cap it is clamped. Bounded loop, so the stream advances a bounded number.
pub fn ex_gaussian(rng: &mut Rng, d: &ExGaussian) -> f64 {
    for _ in 0..8 {
        let v = gaussian(rng, d.mu, d.sigma) + exponential(rng, d.tau);
        if v >= d.floor {
            return v.min(d.cap);
        }
    }
    d.floor
}

/// Softmax pick at temperature t over utilities: the index chosen. t <= 0 is argmax. Empty input returns -1.
pub fn softmax_index(rng: &mut Rng, utilities: &[f64], temperature: f64) -> i32 {
    let n = utilities.len();
    if n == 0 {
        return -1;
    }
    let mut best = 0usize;
    for i in 1..n {
        if utilities[i] > utilities[best] {
            best = i;
        }
    }
    if temperature <= 0. || n == 1 {
        return best as i32;
    }
    let top = utilities[best];
    let weights: Vec<f64> = utilities
        .iter()
        .map(|u| rh_sim::math::exp((u - top) / temperature))
        .collect();
    let mut sum = 0.;
    for w in &weights {
        sum += w;
    }
    let mut r = rng.next_f64() * sum;
    for (i, w) in weights.iter().enumerate() {
        r -= w;
        if r <= 0. {
            return i as i32;
        }
    }
    best as i32
}

/// The choices' option pick: softmax at temperature, but with probability lapseP take one of the top three options
/// uniformly instead (a slip of attention). The lapse stream is separate.
pub fn pick_option(
    rng: &mut Rng,
    lapse: &mut Rng,
    utilities: &[f64],
    temperature: f64,
    lapse_p: f64,
) -> (i32, bool) {
    let n = utilities.len();
    if n == 0 {
        return (-1, false);
    }
    if n > 1 && chance(lapse, lapse_p) {
        let mut order: Vec<(f64, usize)> = utilities.iter().copied().zip(0..n).collect();
        // JS Array.sort is stable and the comparator is descending on the utility: equal utilities keep index order.
        order.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
        order.truncate(3);
        let k = (f64::floor(lapse.next_f64() * order.len() as f64) as usize).min(order.len() - 1);
        return (order[k].1 as i32, true);
    }
    (softmax_index(rng, utilities, temperature), false)
}

/// HUMANIZER_RULES.reactionSamples is the cap the humanizer keeps per stimulus kind; it lives with the rules.
pub fn reaction_sample_cap(rules: &HumanizerRules) -> usize {
    rules.reaction_samples
}
