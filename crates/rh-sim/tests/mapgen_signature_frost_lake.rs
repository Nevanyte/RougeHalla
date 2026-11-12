//! Oracle of P-MAPGEN-SIG-FROST-2: a Frost map whose main lake is not at the cave's mouth is discarded at the end of
//! the attempt (owner decision 4, 2026-11-10: a frozen lake with an enterable frozen cave at the back, the mouth facing
//! the lake; core rule G5, ADR 0028: a map that fails a rule is discarded, never patched). No legacy counterpart
//! (DEV-020). Seeds 1-32, option on, generated once per test binary.
//!
//! Definitions (FROST-1's, `mapgen_signature_frost.rs`; tile units; "floor" is tile value 0, walkable 4-connected):
//! * cave: the one feature of kind `Cave` (zone Frost); its mouth: the Frost anchor's `entrance` tiles.
//! * unowned Frost ice: floor tiles in the Frost region with terrain ice (6) that the cave does not own.
//! * the largest ice body: the largest 4-connected set of unowned Frost ice (first in row order on a tie of size).
//! * mouth to lake: the fewest 4-connected floor steps from any mouth tile (step 0) to any tile of the largest ice body.
//!
//! The rule under test: on every finished option-on map with unowned Frost ice, mouth to lake is at most
//! `lake_reach + 2` = 10 floor steps; a map with no unowned Frost ice is kept. The pinned attempts and map hashes below
//! are this packet's own golden values: measured with the generator as merged at P-MAPGEN-SIG-FROST-1 (2026-11-12),
//! by running each attempt in turn and keeping the first map that meets the rule.
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone};
use rh_sim::mapgen::landmarks::signature::DEFAULT_DEFINITION;
use rh_sim::mapgen::{coliseum, map_hash, pipeline};
use std::collections::{BTreeSet, VecDeque};
use std::sync::OnceLock;

type Cell = (i32, i32);

/// The longest floor path (steps) from the mouth to the largest unowned ice body: the styler's seed reach plus two.
fn mouth_to_lake() -> usize {
    DEFAULT_DEFINITION.lake_reach + 2
}

/// The attempts `certified_styled` may use (`pipeline` rules, `certified_attempts`).
fn attempt_limit() -> u64 {
    16
}

/// The worst attempt index over seeds 1-32 under the rule (measured: 3, seed 18) plus a margin of 2.
fn worst_attempt_allowed() -> u64 {
    3 + 2
}

/// Seeds 1-32 whose lake is already at the mouth today: (seed, attempt that certifies, `map_hash`). The rule must leave
/// them exactly as they are (it only discards).
fn unchanged() -> [(i64, u64, &'static str); 30] {
    [
        (1, 0, "b0165a0a"),
        (2, 0, "ef2c8748"),
        (3, 0, "c83d0e2e"),
        (4, 0, "55cfcd59"),
        (5, 0, "b13ac97e"),
        (6, 0, "2051e02c"),
        (7, 0, "dfdeb7ef"),
        (8, 2, "7281443c"),
        (9, 2, "ef37c8e0"),
        (10, 0, "ae7ff4f8"),
        (11, 1, "885cc9ca"),
        (12, 0, "969d8e93"),
        (13, 0, "a77deac9"),
        (14, 0, "5479e66f"),
        (15, 0, "55a19e9f"),
        (16, 1, "a2d02cd0"),
        (19, 0, "623eea2b"),
        (20, 0, "f637bb0c"),
        (21, 0, "73ed442c"),
        (22, 0, "71d373a2"),
        (23, 0, "c3719689"),
        (24, 0, "ce8439c4"),
        (25, 0, "481cd65e"),
        (26, 0, "01b07b7b"),
        (27, 0, "99d5de56"),
        (28, 0, "b2065d75"),
        (29, 0, "6c6879db"),
        (30, 0, "39d91776"),
        (31, 0, "4ed863b2"),
        (32, 1, "11ce93ef"),
    ]
}

/// Seeds 17 and 18: today attempt 0 certifies with the largest ice body 98 and 102 floor steps from the mouth. Under
/// the rule attempt 0 is discarded and the seed lands on the first later attempt that meets it: (seed, attempt,
/// `map_hash`), the maps today's generator already makes at those attempts (18's attempt 1 is refused
/// `Repair(RadiusPost)`, attempt 2 `Signature`).
fn moved() -> [(i64, u64, &'static str); 2] {
    [(17, 1, "78c08b44"), (18, 3, "2d258d08")]
}

/// Today's option-off generator (`Options::default()`, `certified_styled`), seeds 1-8: (seed, `map_hash`, FNV-1a 64 of
/// the map's JSON). The values pinned by `mapgen_signature_fire.rs` and `mapgen_signature_frost.rs`; G8.
fn pinned_off() -> [(i64, &'static str, u64); 8] {
    [
        (1, "d09b4fd9", 0xf638_ce4a_8563_d41d),
        (2, "190cd50f", 0xf13c_e037_fbd7_f651),
        (3, "b82117b8", 0xeb4f_0525_0310_7414),
        (4, "bec16d65", 0x785a_11c3_0a31_46b7),
        (5, "25032ba7", 0x0f6e_a513_6ba7_ca0d),
        (6, "2d58fdf5", 0x600e_c62d_a4c6_d207),
        (7, "6255dbbe", 0x7188_b411_554a_ddb7),
        (8, "dbb3602f", 0xd855_dc2a_be46_a4eb),
    ]
}

fn on_options() -> pipeline::Options {
    pipeline::Options {
        decor: false,
        signature: true,
        ..pipeline::Options::default()
    }
}

/// One seed's outcome with the option on: the attempt that gave the map, and the map.
struct Landed {
    seed: i64,
    attempt: u64,
    map: GameMapData,
}

/// The first attempt of `seed` (option on) that gives a map, within the attempt limit; `None` if none does.
fn land(generator: &pipeline::Pipeline<'_>, seed: i64) -> Option<Landed> {
    (0..attempt_limit()).find_map(|n| {
        let (report, _) = generator
            .styled_attempt_with_trace(seed, n, on_options())
            .expect("generator error");
        report.map.map(|map| Landed {
            seed,
            attempt: n,
            map,
        })
    })
}

/// Seeds 1-32 with the option on (the server's options: no decor), generated once per test binary.
fn on_maps() -> &'static Vec<(i64, Option<Landed>)> {
    static MAPS: OnceLock<Vec<(i64, Option<Landed>)>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        (1..=32)
            .map(|seed| (seed, land(&generator, seed)))
            .collect()
    })
}

/// Every seed must give a map within the attempt limit.
fn maps() -> impl Iterator<Item = &'static Landed> {
    on_maps().iter().map(|(seed, l)| {
        l.as_ref().unwrap_or_else(|| {
            panic!(
                "seed {seed}: no map in {} attempts with the option on",
                attempt_limit()
            )
        })
    })
}

fn landed(seed: i64) -> &'static Landed {
    maps()
        .find(|l| l.seed == seed)
        .unwrap_or_else(|| panic!("seed {seed} not generated"))
}

fn at(m: &GameMapData, c: Cell) -> Option<usize> {
    (c.0 >= 0 && c.1 >= 0 && c.0 < m.w as i32 && c.1 < m.h as i32)
        .then(|| (c.1 * m.w as i32 + c.0) as usize)
}

fn cell(m: &GameMapData, i: usize) -> Cell {
    ((i as i32) % m.w as i32, (i as i32) / m.w as i32)
}

/// 4-connected groups of `cells`, in order of their first cell (row order).
fn components4(cells: &[Cell]) -> Vec<Vec<Cell>> {
    let set: BTreeSet<Cell> = cells.iter().copied().collect();
    let mut seen = BTreeSet::new();
    let mut ordered: Vec<Cell> = cells.to_vec();
    ordered.sort_by_key(|c| (c.1, c.0));
    let mut out = Vec::new();
    for start in ordered {
        if !seen.insert(start) {
            continue;
        }
        let mut group = vec![start];
        let mut stack = vec![start];
        while let Some((x, y)) = stack.pop() {
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let n = (x + dx, y + dy);
                if set.contains(&n) && seen.insert(n) {
                    group.push(n);
                    stack.push(n);
                }
            }
        }
        out.push(group);
    }
    out
}

/// Fewest 4-connected floor steps from any of `from` to any tile of `to`.
fn floor_steps(m: &GameMapData, from: &[Cell], to: &BTreeSet<Cell>) -> Option<usize> {
    let mut seen = vec![false; m.tiles.len()];
    let mut queue = VecDeque::new();
    for &s in from {
        if let Some(i) = at(m, s).filter(|&i| m.tiles[i] == 0) {
            seen[i] = true;
            queue.push_back((s, 0));
        }
    }
    while let Some((c, d)) = queue.pop_front() {
        if to.contains(&c) {
            return Some(d);
        }
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let n = (c.0 + dx, c.1 + dy);
            if let Some(i) = at(m, n) {
                if !seen[i] && m.tiles[i] == 0 {
                    seen[i] = true;
                    queue.push_back((n, d + 1));
                }
            }
        }
    }
    None
}

fn of_kind(m: &GameMapData, kind: FeatureKind) -> Vec<usize> {
    (0..m.features.len())
        .filter(|&k| m.features[k].kind == kind)
        .collect()
}

/// The single feature of `kind`, which must stand in `zone`.
fn single(seed: i64, m: &GameMapData, kind: FeatureKind, zone: Zone) -> usize {
    let ks = of_kind(m, kind);
    assert_eq!(ks.len(), 1, "seed {seed}: {} {kind:?} features", ks.len());
    assert_eq!(m.features[ks[0]].zone, zone, "seed {seed}: {kind:?} zone");
    ks[0]
}

/// The largest unowned Frost ice body's size and its floor steps from the cave's mouth; `None` when the Frost zone has
/// no ice outside the cave.
fn lake(seed: i64, m: &GameMapData) -> Option<(usize, Option<usize>)> {
    let k = single(seed, m, FeatureKind::Cave, Zone::Frost);
    let a = m
        .anchors
        .iter()
        .find(|a| a.zone == Zone::Frost)
        .unwrap_or_else(|| panic!("seed {seed}: no Frost anchor"));
    let mouth: Vec<Cell> = a.entrance.iter().map(|p| (p.x, p.y)).collect();
    assert!(!mouth.is_empty(), "seed {seed}: the cave has no mouth");
    let ice: Vec<Cell> = (0..m.tiles.len())
        .filter(|&i| {
            m.region_grid[i] == Zone::Frost.code()
                && m.tiles[i] == 0
                && m.terrain[i] == 6
                && usize::from(m.feature_grid[i]) != k + 1
        })
        .map(|i| cell(m, i))
        .collect();
    let bodies = components4(&ice);
    let body = bodies
        .iter()
        .enumerate()
        .max_by_key(|(k, b)| (b.len(), std::cmp::Reverse(*k)))
        .map(|(_, b)| b)?;
    let set: BTreeSet<Cell> = body.iter().copied().collect();
    Some((body.len(), floor_steps(m, &mouth, &set)))
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

// --------------------------------------------------------------------------------------------------------------------
// The rule.
// --------------------------------------------------------------------------------------------------------------------

/// On every option-on map of seeds 1-32 with ice in Frost outside the cave, the largest such body is at most
/// `mouth_to_lake()` floor steps from the mouth. Red today on seeds 17 (98 steps) and 18 (102).
#[test]
fn the_largest_lake_is_at_the_mouth_on_every_seed() {
    let limit = mouth_to_lake();
    let mut far = Vec::new();
    for l in maps() {
        if let Some((size, steps)) = lake(l.seed, &l.map) {
            if !steps.is_some_and(|s| s <= limit) {
                far.push(format!(
                    "seed {} (attempt {}): {size} ice tiles {steps:?} floor steps from the mouth",
                    l.seed, l.attempt
                ));
            }
        }
    }
    assert!(
        far.is_empty(),
        "largest Frost ice body farther than {limit} floor steps from the cave's mouth: {far:?}"
    );
}

/// Seeds 17 and 18 still certify within the attempt limit, on the first later attempt that meets the rule, with the map
/// today's generator makes at that attempt (17: attempt 1; 18: attempt 3). Red today: both land on attempt 0.
#[test]
fn seeds_17_and_18_land_on_the_next_attempt_with_the_lake_at_the_mouth() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for (seed, attempt, hash) in moved() {
        let l = landed(seed);
        assert_eq!(
            (l.attempt, map_hash::map_hash(&l.map).as_str()),
            (attempt, hash),
            "seed {seed}: (attempt, map hash); the map at attempt {} has its lake {:?} (size, floor steps) from the mouth",
            l.attempt,
            lake(seed, &l.map)
        );
        let served = generator
            .certified_styled(seed, on_options())
            .expect("generator error")
            .unwrap_or_else(|| panic!("seed {seed}: certified_styled gives no map"));
        assert_eq!(
            map_hash::map_hash(&served),
            hash,
            "seed {seed}: certified_styled's map"
        );
    }
}

// --------------------------------------------------------------------------------------------------------------------
// Guards: pass today, must keep passing.
// --------------------------------------------------------------------------------------------------------------------

/// Every seed in 1-32 whose lake is already at the mouth lands on the same attempt with the same map as today.
#[test]
fn seeds_with_the_lake_at_the_mouth_keep_their_maps() {
    for (seed, attempt, hash) in unchanged() {
        let l = landed(seed);
        assert_eq!(
            (l.attempt, map_hash::map_hash(&l.map).as_str()),
            (attempt, hash),
            "seed {seed}: (attempt, map hash)"
        );
    }
}

/// Option off, seeds 1-8: the map hash and the whole map's JSON are today's; no cave, no anchors (G8).
#[test]
fn option_off_maps_are_todays() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for (seed, hash, json) in pinned_off() {
        let m = generator
            .certified_styled(seed, pipeline::Options::default())
            .unwrap()
            .expect("certified");
        assert_eq!(map_hash::map_hash(&m), hash, "seed {seed}: map hash");
        assert_eq!(
            fnv(&serde_json::to_vec(&m).unwrap()),
            json,
            "seed {seed}: map JSON digest"
        );
        assert!(
            of_kind(&m, FeatureKind::Cave).is_empty(),
            "seed {seed}: option off has a cave"
        );
        assert!(m.anchors.is_empty(), "seed {seed}: option-off anchors");
    }
}

/// Every seed 1-32 still places the volcano, the church and its graveyard, the bog tree and the cave.
#[test]
fn every_seed_still_places_all_four_landmarks() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        single(seed, m, FeatureKind::Volcano, Zone::Fire);
        single(seed, m, FeatureKind::Church, Zone::Sentenced);
        single(seed, m, FeatureKind::Graveyard, Zone::Sentenced);
        single(seed, m, FeatureKind::BogTree, Zone::Plague);
        single(seed, m, FeatureKind::Cave, Zone::Frost);
    }
}

/// The worst attempt index over seeds 1-32 stays within `worst_attempt_allowed()` (measured 3 under the rule, 2 today).
#[test]
fn the_worst_attempt_stays_within_the_measured_margin() {
    let worst = maps()
        .map(|l| (l.attempt, l.seed))
        .max()
        .expect("seeds generated");
    assert!(
        worst.0 <= worst_attempt_allowed(),
        "seed {}: attempt {} (allowed {})",
        worst.1,
        worst.0,
        worst_attempt_allowed()
    );
}

/// The report the brief asks for beyond the gate's seeds (run with `--ignored --nocapture`): seeds 33-64 with the
/// option on, the attempt each lands on and its lake; every seed certifies within the limit and meets the rule.
/// Measured under the rule: seed 34 moves from attempt 0 (lake 20 floor steps from the mouth) to 1; seed 51 is the
/// worst at attempt 7 (unchanged by the rule).
#[test]
#[ignore]
fn report_seeds_33_to_64() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let mut worst = (0, 0);
    for seed in 33..=64 {
        let l = land(&generator, seed).unwrap_or_else(|| panic!("seed {seed}: no map"));
        let lk = lake(seed, &l.map);
        eprintln!(
            "seed {seed}: attempt {}, lake {lk:?} (size, floor steps), hash {}",
            l.attempt,
            map_hash::map_hash(&l.map)
        );
        worst = worst.max((l.attempt, seed));
        if let Some((_, steps)) = lk {
            assert!(
                steps.is_some_and(|s| s <= mouth_to_lake()),
                "seed {seed}: lake {steps:?} floor steps from the mouth"
            );
        }
    }
    eprintln!(
        "worst attempt over seeds 33-64: {} (seed {})",
        worst.0, worst.1
    );
}
