//! Random streams. The core never reads entropy itself: every seed or salt arrives through [`crate::Secrets`] (the live
//! adapter draws them from the OS CSPRNG; tests and the headless runner derive them from a run seed). Each stream has one
//! purpose and one owner, so drawing from one never shifts another (docs/CONTRACTS.md C-RNG).

/// mulberry32, bit-exact with the legacy `packages/shared/src/rng.ts`: 32-bit state, floats in [0, 1).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
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
        self.next_u32() as f64 / 4_294_967_296.0
    }

    /// The raw stream state (hashed and checkpointed; a test pins the wind stream's seed derivation).
    #[cfg(test)]
    pub(crate) fn state(&self) -> u32 {
        self.state
    }
}

/// The secret per-tick order in which players' inputs apply (legacy `actionOrder`): a Fisher-Yates shuffle of the join
/// order, keyed by the secret order salt and the tick. Fair for any subset of contenders and unpredictable to clients.
pub fn action_order<T: Copy>(order_salt: u32, tick: u32, join_order: &[T]) -> Vec<T> {
    let mut ids = Vec::new();
    action_order_into(order_salt, tick, join_order, &mut ids);
    ids
}

/// [`action_order`] into a caller's buffer (cleared first): the tick's order without an allocation once the buffer has
/// grown.
pub fn action_order_into<T: Copy>(order_salt: u32, tick: u32, join_order: &[T], out: &mut Vec<T>) {
    out.clear();
    out.extend_from_slice(join_order);
    action_order_in_place(order_salt, tick, out);
}

/// The shuffle itself, over `ids` already in join order. The draw is in [0, 1) so `draw * (i + 1)` is a non-negative
/// number below `i + 1`: truncation is its floor, exactly.
pub fn action_order_in_place<T>(order_salt: u32, tick: u32, ids: &mut [T]) {
    let mut rng = Mulberry32::new(order_salt ^ tick.wrapping_mul(0x9e37_79b1));
    let mut i = ids.len();
    while i > 1 {
        i -= 1;
        let j = (rng.next_f64() * (i + 1) as f64) as usize;
        ids.swap(i, j);
    }
}

/// Integer mixing for independent stream seeds (legacy `hashSeed`).
pub fn hash_seed(seed: u32, attempt: u32, zone: u32, stream: u32) -> u32 {
    let mut h = seed.wrapping_mul(0x9e37_79b1) ^ 0x5bd1_e995;
    h = (h ^ (h >> 15)).wrapping_mul(0x85eb_ca6b) ^ attempt.wrapping_mul(0x27d4_eb2d);
    h = (h ^ (h >> 13)).wrapping_mul(0xc2b2_ae35) ^ zone.wrapping_mul(0x1656_67b1);
    h = (h ^ (h >> 16)).wrapping_mul(0x85eb_ca6b) ^ stream.wrapping_mul(0x9e37_79b1);
    h = (h ^ (h >> 13)).wrapping_mul(0xc2b2_ae35);
    h ^ (h >> 16)
}

/// Exact source actor key, independent from the private allocation namespace and public actor ID.
pub(crate) fn tie_rank_origin(
    salt: u32,
    tick: u32,
    origin: &crate::mob_runtime::ActorOrigin,
) -> u32 {
    let (prefix, mut n, radix): (&[u8], u32, u32) = match origin {
        crate::mob_runtime::ActorOrigin::Player { join_ordinal } => (b"p", *join_ordinal, 10),
        crate::mob_runtime::ActorOrigin::Mob { birth_serial, .. }
        | crate::mob_runtime::ActorOrigin::Practice { birth_serial, .. }
        | crate::mob_runtime::ActorOrigin::Dummy { birth_serial, .. } => {
            (b"mob", *birth_serial, 36)
        }
        crate::mob_runtime::ActorOrigin::Zombie { owner } => (b"zombie", owner.0, 10),
    };
    let mut h = salt ^ tick.wrapping_mul(0x9e37_79b1);
    for &b in prefix {
        h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
    }
    let mut digits = [0u8; 10];
    let mut at = digits.len();
    loop {
        at -= 1;
        let d = (n % radix) as u8;
        digits[at] = if d < 10 { b'0' + d } else { b'a' + d - 10 };
        n /= radix;
        if n == 0 {
            break;
        }
    }
    for &b in &digits[at..] {
        h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
    }
    Mulberry32::new(h).next_u32()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actor_ties_use_actual_source_keys() {
        // Direct call to unchanged packages/server/src/sim/world.ts tieRank, salt1237598750,tick1.
        use crate::mob_runtime::ActorOrigin;
        for (ordinal, expected) in [(0, 2133980057), (1, 3762038895)] {
            assert_eq!(
                tie_rank_origin(
                    1237598750,
                    1,
                    &ActorOrigin::Player {
                        join_ordinal: ordinal
                    }
                ),
                expected
            );
        }
        for (serial, expected) in [
            (1, 3797300844),
            (35, 2199502943),
            (36, 1524533302),
            (46, 3775833461),
        ] {
            let origin = ActorOrigin::Mob {
                birth_serial: serial,
                born_tick: 1,
                camp: 0,
                spot: 0,
                mob_type: crate::mob_catalog::MobTypeId::Wyrmling,
                elite: true,
            };
            assert_eq!(tie_rank_origin(1237598750, 1, &origin), expected);
        }
    }

    #[test]
    fn mulberry32_matches_legacy_vectors() {
        // Values printed by the legacy implementation (node: mulberry32(12) x3, mulberry32(0) x2).
        let mut r = Mulberry32::new(12);
        let got: Vec<u32> = (0..3).map(|_| r.next_u32()).collect();
        let mut z = Mulberry32::new(0);
        let got0: Vec<u32> = (0..2).map(|_| z.next_u32()).collect();
        assert_eq!(got, LEGACY_12);
        assert_eq!(got0, LEGACY_0);
    }

    #[test]
    fn the_buffer_shuffle_is_the_floor_shuffle() {
        // The reference is the shuffle as first written (a floor of the scaled draw); the integer truncation and the
        // in-place form must give its order for every salt, tick and size.
        fn reference(salt: u32, tick: u32, n: usize) -> Vec<usize> {
            let mut ids: Vec<usize> = (0..n).collect();
            let mut rng = Mulberry32::new(salt ^ tick.wrapping_mul(0x9e37_79b1));
            let mut i = n;
            while i > 1 {
                i -= 1;
                let j = (rng.next_f64() * (i + 1) as f64).floor() as usize;
                ids.swap(i, j);
            }
            ids
        }
        let mut buf = Vec::new();
        for salt in [0u32, 1, 0x8c2b_f464, u32::MAX] {
            for tick in 0..400u32 {
                for n in 0..=9usize {
                    let join: Vec<usize> = (0..n).collect();
                    let want = reference(salt, tick, n);
                    assert_eq!(action_order(salt, tick, &join), want);
                    action_order_into(salt, tick, &join, &mut buf);
                    assert_eq!(buf, want, "salt {salt} tick {tick} n {n}");
                }
            }
        }
    }

    // From `node` against packages/shared/src/rng.ts; the fixtures also record orderSalt = the first draw of
    // mulberry32(randomSeed), which the parity harness checks.
    const LEGACY_12: [u32; 3] = [1237598750, 324989476, 2491772807];
    const LEGACY_0: [u32; 2] = [1144304738, 1416247];
}
