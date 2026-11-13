//! Oracle of P-MAPGEN-SIG-FROST-2 (amendment, 2026-11-12): no signature landmark's tiles lie in another landmark's
//! apron on any attempt the generator accepts (core rule G5, ADR 0028: an attempt that breaks a rule is discarded by the
//! end-of-attempt check, `SignatureContext::intact`; G1: the apron round each landmark stays clear). No legacy
//! counterpart (DEV-020). Option on, seeds 1-40.
//!
//! Which attempts: the generator has no hook that exposes an attempt's map between records and `intact`, and an attempt
//! that `intact` (or any earlier check) refuses yields no map. So "every attempt" is read as every attempt the generator
//! accepts: `Pipeline::styled_attempt(seed, n)` for each n from 0 up to the attempt that certifies the seed, and at least
//! attempts 0-3 (an attempt beyond the certifying one is what the seed lands on when an earlier one is discarded, by
//! this rule or by another packet's). Each accepted map must meet the rule: the rule holds per attempt by construction
//! (`intact` discards the attempt), not by the luck of which attempt certifies.
//!
//! Definitions (tile units):
//! * the five landmarks and their features: Fire, the `Volcano` (its `LavaStream` and `LavaPool` tiles count as its
//!   tiles, not as its apron); Sentenced, the `Church` and its `Graveyard`; Plague, the `BogTree`; Frost, the `Cave`;
//!   Holy, the hall: the Holy `Hall` feature whose box is the Holy anchor's footprint.
//! * a landmark's tiles: the cells the feature grid gives to its features.
//! * a landmark's apron: each of its features' boxes grown by the core band (`signature::DEFAULT_DEFINITION.bands[0]`,
//!   2 tiles), for the volcano the cone's box only (the streams and pools keep their own by-tile apron in the generator).
//! * the rule, for every ordered pair (guest, host) of different landmarks: no guest tile lies in the host's apron.
use rh_sim::mapdata::{FeatureKind, GameMapData, TileRect, Zone};
use rh_sim::mapgen::landmarks::signature::DEFAULT_DEFINITION;
use rh_sim::mapgen::{coliseum, pipeline, spawns};
use std::sync::OnceLock;

type Cell = (i32, i32);

fn seeds() -> std::ops::RangeInclusive<i64> {
    1..=40
}

/// Attempts checked on every seed even when an earlier one certifies.
fn attempts_always() -> u64 {
    4
}

/// The attempts `certified_styled` may use (`pipeline` rules, `certified_attempts`).
fn attempt_limit() -> u64 {
    16
}

fn on_options() -> pipeline::Options {
    pipeline::Options {
        decor: false,
        signature: true,
        ..pipeline::Options::default()
    }
}

/// One accepted attempt: seed, attempt index, map.
struct Accepted {
    seed: i64,
    attempt: u64,
    map: GameMapData,
}

/// Every accepted attempt of seeds 1-40 (see the file comment), generated once per test binary; panics when a seed has
/// no accepted attempt within the limit.
fn accepted() -> &'static Vec<Accepted> {
    static MAPS: OnceLock<Vec<Accepted>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        let mut out = Vec::new();
        for seed in seeds() {
            let mut certified = false;
            let mut n = 0;
            while n < attempt_limit() && (n < attempts_always() || !certified) {
                if let Some(map) = generator
                    .styled_attempt(seed, n, on_options())
                    .expect("generator error")
                {
                    certified = true;
                    out.push(Accepted {
                        seed,
                        attempt: n,
                        map,
                    });
                }
                n += 1;
            }
            assert!(certified, "seed {seed}: no accepted attempt in {n}");
        }
        out
    })
}

/// One landmark of a map: its name, its tiles, its apron boxes (x0, y0, x1, y1).
struct Landmark {
    name: &'static str,
    tiles: Vec<Cell>,
    apron: Vec<(i32, i32, i32, i32)>,
}

fn grow(r: TileRect, by: i32) -> (i32, i32, i32, i32) {
    (
        r.x - by,
        r.y - by,
        r.x + r.w as i32 - 1 + by,
        r.y + r.h as i32 - 1 + by,
    )
}

fn inside(r: (i32, i32, i32, i32), c: Cell) -> bool {
    c.0 >= r.0 && c.0 <= r.2 && c.1 >= r.1 && c.1 <= r.3
}

fn owned(m: &GameMapData, k: usize) -> Vec<Cell> {
    (0..m.feature_grid.len())
        .filter(|&i| usize::from(m.feature_grid[i]) == k + 1)
        .map(|i| ((i as i32) % m.w as i32, (i as i32) / m.w as i32))
        .collect()
}

/// The five landmarks of an option-on map (panics when one is missing).
fn landmarks(seed: i64, attempt: u64, m: &GameMapData) -> Vec<Landmark> {
    let core = DEFAULT_DEFINITION.bands[0];
    let ks = |kinds: &[FeatureKind]| -> Vec<usize> {
        (0..m.features.len())
            .filter(|&k| kinds.contains(&m.features[k].kind))
            .collect()
    };
    let one = |kind: FeatureKind| -> usize {
        let v = ks(&[kind]);
        assert_eq!(
            v.len(),
            1,
            "seed {seed} attempt {attempt}: {} {kind:?}",
            v.len()
        );
        v[0]
    };
    let holy = m
        .anchors
        .iter()
        .find(|a| a.zone == Zone::Holy)
        .unwrap_or_else(|| panic!("seed {seed} attempt {attempt}: no Holy anchor"));
    let hall = (0..m.features.len())
        .find(|&k| {
            let f = &m.features[k];
            f.kind == FeatureKind::Hall && f.zone == Zone::Holy && f.bbox == holy.footprint
        })
        .unwrap_or_else(|| panic!("seed {seed} attempt {attempt}: no hall on the Holy anchor"));
    let build = |name: &'static str, members: Vec<usize>, boxes: Vec<usize>| Landmark {
        name,
        tiles: members.iter().flat_map(|&k| owned(m, k)).collect(),
        apron: boxes
            .iter()
            .map(|&k| grow(m.features[k].bbox, core))
            .collect(),
    };
    let volcano = one(FeatureKind::Volcano);
    let mut fire = vec![volcano];
    fire.extend(ks(&[FeatureKind::LavaStream, FeatureKind::LavaPool]));
    let sentenced = vec![one(FeatureKind::Church), one(FeatureKind::Graveyard)];
    vec![
        build("volcano", fire, vec![volcano]),
        build("church", sentenced.clone(), sentenced),
        build(
            "bog tree",
            vec![one(FeatureKind::BogTree)],
            vec![one(FeatureKind::BogTree)],
        ),
        build(
            "cave",
            vec![one(FeatureKind::Cave)],
            vec![one(FeatureKind::Cave)],
        ),
        build("hall", vec![hall], vec![hall]),
    ]
}

/// Every breach on one map: "guest in host's apron: n tiles, first (x, y)".
fn breaches(seed: i64, attempt: u64, m: &GameMapData) -> Vec<String> {
    let all = landmarks(seed, attempt, m);
    let mut out = Vec::new();
    for guest in &all {
        for host in &all {
            if guest.name == host.name {
                continue;
            }
            let bad: Vec<Cell> = guest
                .tiles
                .iter()
                .copied()
                .filter(|&c| host.apron.iter().any(|&r| inside(r, c)))
                .collect();
            if let Some(first) = bad.first() {
                out.push(format!(
                    "seed {seed} attempt {attempt}: {} in the {}'s apron: {} tiles, first {first:?}",
                    guest.name,
                    host.name,
                    bad.len()
                ));
            }
        }
    }
    out
}

/// G5: on every accepted attempt of seeds 1-40, no landmark's tiles lie in another landmark's apron (every ordered
/// pair of the five). Fails today on seed 7 attempt 2 and seed 34 attempt 0 (the bog tree in the cave's apron).
#[test]
fn no_landmark_lies_in_another_landmarks_apron_on_any_accepted_attempt() {
    let mut all = Vec::new();
    let mut seen = Vec::new();
    for a in accepted() {
        seen.push((a.seed, a.attempt));
        all.extend(breaches(a.seed, a.attempt, &a.map));
    }
    eprintln!("accepted attempts checked ({}): {seen:?}", seen.len());
    assert!(
        all.is_empty(),
        "{} landmark pairs breach an apron: {all:#?}",
        all.len()
    );
}

/// Guard (passes today, must keep passing): the pairs FIRE-1's `note1_bog_tree_tiles_stay_out_of_other_landmarks_aprons`
/// checks, on the attempt each of seeds 1-16 certifies on: no bog-tree tile in a legacy building grown by the spawn
/// rules' `landmark_box_margin`, nor in another signature feature's box grown by the core band.
#[test]
fn the_bog_tree_keeps_out_of_buildings_and_signature_aprons_on_certified_maps() {
    let core = DEFAULT_DEFINITION.bands[0];
    let margin = spawns::DEFAULT_DEFINITION.landmark_box_margin;
    let signature = [
        FeatureKind::Church,
        FeatureKind::Graveyard,
        FeatureKind::Volcano,
        FeatureKind::LavaStream,
        FeatureKind::LavaPool,
        FeatureKind::Cave,
    ];
    for seed in 1..=16 {
        let a = accepted()
            .iter()
            .find(|a| a.seed == seed)
            .expect("an accepted attempt");
        let m = &a.map;
        let tree = (0..m.features.len())
            .find(|&k| m.features[k].kind == FeatureKind::BogTree)
            .expect("a bog tree");
        let aprons: Vec<(String, (i32, i32, i32, i32))> = m
            .buildings
            .iter()
            .map(|b| ("building".to_string(), grow(*b, margin)))
            .chain(
                m.features
                    .iter()
                    .filter(|f| signature.contains(&f.kind))
                    .map(|f| (format!("{:?}", f.kind), grow(f.bbox, core))),
            )
            .collect();
        for c in owned(m, tree) {
            for (name, r) in &aprons {
                assert!(
                    !inside(*r, c),
                    "seed {seed} attempt {}: bog-tree tile {c:?} in the {name}'s apron {r:?}",
                    a.attempt
                );
            }
        }
    }
}
