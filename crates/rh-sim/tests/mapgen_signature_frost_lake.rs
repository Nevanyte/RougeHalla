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
//! `lake_reach + 2` = 10 floor steps; a map with no unowned Frost ice is kept.
//!
//! Amended by P-MAPGEN-SIG-SCALE-1 (oracle commit, coordinator's decision 2026-11-12): this packet first pinned, as a
//! guard that the rule changed nothing else, the option-on (attempt, map hash) of every seed 1-32 as the generator made
//! them at P-MAPGEN-SIG-FROST-1. Any change of a landmark's size moves every option-on map, so those exact pins are
//! replaced by the properties that matter going forward: the rule on every seed, `certified_styled` serving the first
//! attempt that meets it, and the worst attempt index within a re-measured bound.
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone};
use rh_sim::mapgen::landmarks::signature::DEFAULT_DEFINITION;
use rh_sim::mapgen::{coliseum, map_hash, pipeline};
use std::collections::{BTreeSet, VecDeque};
use std::sync::OnceLock;

#[path = "support/signature_pins.rs"]
mod pins;

type Cell = (i32, i32);

/// The longest floor path (steps) from the mouth to the largest unowned ice body: the styler's seed reach plus two.
fn mouth_to_lake() -> usize {
    DEFAULT_DEFINITION.lake_reach + 2
}

/// The attempts `certified_styled` may use (`pipeline` rules, `certified_attempts`).
fn attempt_limit() -> u64 {
    16
}

/// The worst attempt index over seeds 1-32 under the rule. Measured 3 (seed 18) at P-MAPGEN-SIG-FROST-2; re-measured
/// for P-MAPGEN-SIG-SCALE-1 with the brief's prototype of the larger cave: 5 (seeds 1 and 23); plus a margin of 3.
fn worst_attempt_allowed() -> u64 {
    5 + 3
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

/// The server's call serves the first attempt that meets the rule: for seeds 17 and 18 (whose attempt 0 put the lake
/// 98 and 102 floor steps from the mouth at P-MAPGEN-SIG-FROST-1), `certified_styled` gives the map of the first attempt
/// `styled_attempt_with_trace` accepts, and that map meets the rule. (Was: the pinned (attempt, map hash) of seeds 17 and
/// 18; replaced by P-MAPGEN-SIG-SCALE-1, see the file comment.)
#[test]
fn certified_styled_serves_the_first_attempt_that_meets_the_rule() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for seed in [17, 18] {
        let l = landed(seed);
        if let Some((size, steps)) = lake(seed, &l.map) {
            assert!(
                steps.is_some_and(|s| s <= mouth_to_lake()),
                "seed {seed} (attempt {}): {size} ice tiles {steps:?} floor steps from the mouth",
                l.attempt
            );
        }
        let served = generator
            .certified_styled(seed, on_options())
            .expect("generator error")
            .unwrap_or_else(|| panic!("seed {seed}: certified_styled gives no map"));
        assert_eq!(
            map_hash::map_hash(&served),
            map_hash::map_hash(&l.map),
            "seed {seed}: certified_styled's map is not attempt {}'s",
            l.attempt
        );
    }
}

// --------------------------------------------------------------------------------------------------------------------
// Guards: pass today, must keep passing.
// --------------------------------------------------------------------------------------------------------------------

/// Option off, seeds 1-8: the map hash and the whole map's JSON are today's; no cave, no anchors (G8).
#[test]
fn option_off_maps_are_todays() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for (seed, hash, json) in pins::pinned_off() {
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

/// The worst attempt index over seeds 1-32 stays within `worst_attempt_allowed()` (see there).
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
