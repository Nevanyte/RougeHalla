//! Oracle of P-MAPGEN-GUARANTEES-1 (architecture review 2026-11-13, finding 4): the per-zone end-of-attempt checks of
//! the signature generator become one registered list beside each zone's styler (`style_zones::guarantees`), run by the
//! pipeline after `SignatureContext::intact` and the strict certifier, one refusal variant for all of them
//! (`pipeline::Refusal::Guarantee { zone, rule }`). The Frost lake rule leaves `intact` for `style_rime` as
//! `"lake-at-mouth"`; the Plague pool check leaves `pipeline/plague_pools.rs` for `style_warren` as `"pool-walks"` and
//! `"pool-wet"`. No legacy counterpart (DEV-020). Brief: `docs/backlog/packets/P-MAPGEN-GUARANTEES-1.md`.
//!
//! Which attempts are kept does not change, so no map changes: the guard
//! `mapgen_signature_blueprint.rs::option_on_maps_are_unchanged` (pins in `tests/support/signature_pins.rs`) stays green
//! unchanged and is not repeated here. Only the label of some discarded attempts changes; this file pins the labels.
use rh_sim::map::{TILE_FLOOR, TILE_WALL};
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone};
use rh_sim::mapgen::landmarks::signature::frame::LandmarkFrame;
use rh_sim::mapgen::landmarks::signature::{Placed, SignatureContext};
use rh_sim::mapgen::landmarks::{recipes, stage};
use rh_sim::mapgen::style_zones::{guarantees, Guarantee};
use rh_sim::mapgen::{attempt, coliseum, pipeline};
use std::sync::OnceLock;

// ---------------------------------------------------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------------------------------------------------

fn on() -> pipeline::Options {
    pipeline::Options {
        signature: true,
        ..pipeline::Options::default()
    }
}

/// The Landmarks phase of an accepted attempt, option on (its frames are the ones the pipeline hands the guarantees).
fn landmarks_phase(seed: i64, n: u64) -> Placed {
    let fixed = coliseum::fixed_layout();
    let context = attempt::AttemptContext::new(&fixed);
    let frame = attempt::begin_attempt_signature(&context, seed, n, true)
        .expect("prefix input")
        .expect("the accepted attempt passed the Prefix");
    let mut st = stage::StageContext::new(&fixed)
        .apply(&frame, &recipes::Recipes::default())
        .expect("stage input")
        .expect("the accepted attempt passed the landmark stage");
    SignatureContext::new(&fixed)
        .apply(&frame, &mut st)
        .expect("signature input")
        .expect("the accepted attempt placed its landmarks")
}

/// One seed, option on, every attempt from 0 until a map is kept.
struct Run {
    seed: i64,
    /// Per refused attempt, in order: `format!("{:?}", refusal)` and the last phase its trace observed.
    refused: Vec<(String, Option<pipeline::Phase>)>,
    map: GameMapData,
    placed: Placed,
}

/// Seeds 1-32, once per test binary.
fn runs() -> &'static Vec<Run> {
    static RUNS: OnceLock<Vec<Run>> = OnceLock::new();
    RUNS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        (1..=32)
            .map(|seed| {
                let mut refused = Vec::new();
                for n in 0..64 {
                    let (report, trace) = generator
                        .styled_attempt_with_trace(seed, n, on())
                        .expect("a refusal is not an error");
                    match report.map {
                        Some(map) => {
                            assert_eq!(map.attempt, n);
                            let placed = landmarks_phase(seed, n);
                            return Run {
                                seed,
                                refused,
                                map,
                                placed,
                            };
                        }
                        None => refused.push((
                            format!("{:?}", report.refusal.expect("a refused attempt says why")),
                            trace.last().map(|t| t.phase),
                        )),
                    }
                }
                panic!("seed {seed}: no map in 64 attempts")
            })
            .collect()
    })
}

fn rules(z: Zone) -> Vec<&'static str> {
    guarantees(z).iter().map(|g| g.rule).collect()
}

/// The guarantee `rule` of `z`.
fn rule(z: Zone, name: &str) -> Guarantee {
    let g = guarantees(z).iter().find(|g| g.rule == name).copied();
    assert!(
        g.is_some(),
        "no guarantee {name:?} registered for {z:?} (registered: {:?})",
        rules(z)
    );
    g.unwrap()
}

fn frame(r: &Run, z: Zone) -> &LandmarkFrame {
    let f = r.placed.frames.iter().find(|f| f.zone() == z);
    assert!(f.is_some(), "seed {}: no {z:?} frame", r.seed);
    f.unwrap()
}

/// The index into `m.features` of the only feature of kind `k`.
fn only(m: &GameMapData, k: FeatureKind) -> usize {
    let all: Vec<usize> = (0..m.features.len())
        .filter(|&i| m.features[i].kind == k)
        .collect();
    assert_eq!(all.len(), 1, "one {k:?} feature");
    all[0]
}

fn owner(m: &GameMapData, i: usize) -> Option<usize> {
    usize::from(m.feature_grid[i]).checked_sub(1)
}

fn neighbours(m: &GameMapData, i: usize) -> Vec<usize> {
    let (w, h) = (m.w as i32, m.h as i32);
    let (x, y) = ((i as i32) % w, (i as i32) / w);
    [(1, 0), (-1, 0), (0, 1), (0, -1)]
        .into_iter()
        .map(|(dx, dy)| (x + dx, y + dy))
        .filter(|&(x, y)| x >= 0 && y >= 0 && x < w && y < h)
        .map(|(x, y)| (y * w + x) as usize)
        .collect()
}

/// The terrain code of the cave's ice: the one non-zero terrain among the Frost frame's floor cells (the drawing's `=`).
fn ice_code(f: &LandmarkFrame) -> u8 {
    let mut codes: Vec<u8> = f
        .cells
        .iter()
        .filter(|c| c.1 == TILE_FLOOR && c.2 != 0)
        .map(|c| c.2)
        .collect();
    codes.sort_unstable();
    codes.dedup();
    assert_eq!(codes.len(), 1, "the cave's floor carries one terrain");
    codes[0]
}

/// Every Frost-region floor tile with the cave's ice terrain that the cave does not own (the lake rule's ice).
fn unowned_frost_ice(m: &GameMapData, ice: u8) -> Vec<usize> {
    let cave = only(m, FeatureKind::Cave);
    (0..m.tiles.len())
        .filter(|&i| {
            m.region_grid[i] == Zone::Frost.code()
                && m.tiles[i] == TILE_FLOOR
                && m.terrain[i] == ice
                && owner(m, i) != Some(cave)
        })
        .collect()
}

/// The first `BogPool` feature that owns floor with non-zero terrain, and that terrain (the bog).
fn wet_pool(m: &GameMapData) -> Option<(usize, u8)> {
    (0..m.tiles.len()).find_map(|i| {
        let k = owner(m, i)?;
        (m.features.get(k)?.kind == FeatureKind::BogPool
            && m.tiles[i] == TILE_FLOOR
            && m.terrain[i] != 0)
            .then(|| (k, m.terrain[i]))
    })
}

const SD: &str = "SignatureDiscarded";
const LAKE: &str = r#"Guarantee { zone: Frost, rule: "lake-at-mouth" }"#;
const SPAWN_RATIO: &str = "SpawnRatio";
const PREFIX: &str = "Prefix";
const RADIUS_POST: &str = "Repair(RadiusPost)";

/// Seeds 1-32, option on: each refused attempt's label, in attempt order; the seed's map is the next attempt. Taken on
/// the stub (`packet/P-MAPGEN-GUARANTEES-1`'s stub commit, today's behaviour) with the packet's mapping applied: an
/// attempt `SignatureDiscarded` today ONLY because the Frost lake rule fails (integrity, door, aprons and the strict
/// certifier all pass) is `Guarantee { Frost, "lake-at-mouth" }`; every other label is today's. Measured on the stub's
/// base: 14 `SignatureDiscarded` over seeds 1-32, 11 of them failing the lake rule alone and 3 failing `intact`'s other
/// parts with the lake rule passing; no attempt fails the lake rule together with another check; no `SignaturePools`.
fn pinned_labels() -> [(i64, &'static [&'static str]); 32] {
    [
        (1, &[LAKE]),
        (2, &[SPAWN_RATIO, PREFIX, SD, LAKE]),
        (3, &[]),
        (4, &[]),
        (5, &[SD]),
        (6, &[]),
        (7, &[LAKE, SPAWN_RATIO]),
        (8, &[LAKE]),
        (9, &[LAKE]),
        (10, &[]),
        (11, &[]),
        (12, &[RADIUS_POST, LAKE, LAKE]),
        (13, &[SPAWN_RATIO]),
        (14, &[]),
        (15, &[]),
        (16, &[]),
        (17, &[PREFIX]),
        (18, &[]),
        (19, &[LAKE]),
        (20, &[]),
        (21, &[]),
        (22, &[PREFIX]),
        (23, &[]),
        (24, &[PREFIX]),
        (25, &[LAKE]),
        (26, &[LAKE]),
        (27, &[LAKE]),
        (28, &[]),
        (29, &[SD]),
        (30, &[]),
        (31, &[]),
        (32, &[]),
    ]
}

// ---------------------------------------------------------------------------------------------------------------------
// The registry.
// ---------------------------------------------------------------------------------------------------------------------

/// Frost lists `lake-at-mouth`; Plague lists `pool-walks` then `pool-wet`; Fire, Sentenced and Holy list nothing yet.
#[test]
fn the_registry_lists_the_frost_and_plague_rules_and_nothing_else() {
    let got: Vec<(Zone, Vec<&str>)> = [
        Zone::Fire,
        Zone::Sentenced,
        Zone::Plague,
        Zone::Frost,
        Zone::Holy,
    ]
    .into_iter()
    .map(|z| (z, rules(z)))
    .collect();
    assert_eq!(
        got,
        vec![
            (Zone::Fire, vec![]),
            (Zone::Sentenced, vec![]),
            (Zone::Plague, vec!["pool-walks", "pool-wet"]),
            (Zone::Frost, vec!["lake-at-mouth"]),
            (Zone::Holy, vec![]),
        ],
        "each zone's guarantees, in run order"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Each check, called directly.
// ---------------------------------------------------------------------------------------------------------------------

/// Every registered guarantee of every frame's zone holds on the kept map of each of seeds 1-32 (3 checks per map).
#[test]
fn every_guarantee_holds_on_every_kept_map_of_seeds_1_to_32() {
    let mut checked = 0;
    for r in runs() {
        for f in &r.placed.frames {
            for g in guarantees(f.zone()) {
                assert!(
                    (g.check)(&r.map, f),
                    "seed {}: the kept map fails {:?} {:?}",
                    r.seed,
                    f.zone(),
                    g.rule
                );
                checked += 1;
            }
        }
    }
    assert_eq!(
        checked,
        32 * 3,
        "lake-at-mouth, pool-walks and pool-wet on 32 maps"
    );
}

/// `lake-at-mouth`: a kept map with a lake fails once the cave's mouth is walled (no walk starts), and passes again when
/// the lake is dried as well (a map without unowned Frost ice passes: the styler may lay no lake).
#[test]
fn lake_at_mouth_fails_with_the_mouth_walled_and_passes_with_no_lake() {
    let lake = rule(Zone::Frost, "lake-at-mouth");
    let mut doctored = 0;
    for r in runs() {
        let f = frame(r, Zone::Frost);
        let ice = ice_code(f);
        if unowned_frost_ice(&r.map, ice).is_empty() {
            continue;
        }
        assert!(!f.anchor.entrance.is_empty(), "seed {}: a mouth", r.seed);
        let mut m = r.map.clone();
        for p in &f.anchor.entrance {
            m.tiles[(p.y * m.w as i32 + p.x) as usize] = TILE_WALL;
        }
        assert!(
            !(lake.check)(&m, f),
            "seed {}: the mouth walled off, the lake is out of reach",
            r.seed
        );
        for i in unowned_frost_ice(&m, ice) {
            m.terrain[i] = 0;
        }
        assert!(
            (lake.check)(&m, f),
            "seed {}: no unowned Frost ice left, nothing to judge",
            r.seed
        );
        doctored += 1;
    }
    assert!(
        doctored >= 16,
        "only {doctored} kept maps with a Frost lake"
    );
}

/// `pool-wet`: a kept map fails once one `BogPool` loses all its bog (its tiles still owned, plain floor); `pool-walks`
/// still holds (less styler bog never lengthens a walk).
#[test]
fn pool_wet_fails_when_a_pool_loses_its_bog_and_pool_walks_still_holds() {
    let (walks, wet) = (
        rule(Zone::Plague, "pool-walks"),
        rule(Zone::Plague, "pool-wet"),
    );
    let mut doctored = 0;
    for r in runs() {
        let f = frame(r, Zone::Plague);
        let Some((k, _)) = wet_pool(&r.map) else {
            continue;
        };
        let mut m = r.map.clone();
        for i in 0..m.tiles.len() {
            if owner(&m, i) == Some(k) {
                m.terrain[i] = 0;
            }
        }
        assert!(
            !(wet.check)(&m, f),
            "seed {}: BogPool feature {k} owns no bog",
            r.seed
        );
        assert!((walks.check)(&m, f), "seed {}: no walk grew", r.seed);
        doctored += 1;
    }
    assert!(doctored >= 16, "only {doctored} kept maps with a BogPool");
}

/// `pool-walks`: a kept map fails once a Plague spawn's floor neighbours (all unowned) become bog of a wet `BogPool`
/// (the spawn is cut off with styler bog avoided: its walk grows without bound, past the detour); `pool-wet` still holds.
#[test]
fn pool_walks_fails_when_pool_bog_rings_a_plague_spawn_and_pool_wet_still_holds() {
    let (walks, wet) = (
        rule(Zone::Plague, "pool-walks"),
        rule(Zone::Plague, "pool-wet"),
    );
    let mut doctored = 0;
    for r in runs() {
        let f = frame(r, Zone::Plague);
        let m0 = &r.map;
        let Some((k, bog)) = wet_pool(m0) else {
            continue;
        };
        let tile = |v: f64| (v / rh_sim::constants::TILE).floor() as i32;
        let ring = m0
            .spawn_pool
            .iter()
            .filter(|s| s.zone == Zone::Plague)
            .map(|s| (tile(s.y) * m0.w as i32 + tile(s.x)) as usize)
            .filter(|&i| m0.tiles[i] == TILE_FLOOR)
            .map(|i| {
                neighbours(m0, i)
                    .into_iter()
                    .filter(|&j| m0.tiles[j] == TILE_FLOOR)
                    .collect::<Vec<_>>()
            })
            .find(|ring| !ring.is_empty() && ring.iter().all(|&j| owner(m0, j).is_none()));
        let Some(ring) = ring else {
            continue;
        };
        let mut m = m0.clone();
        for j in ring {
            m.terrain[j] = bog;
            m.feature_grid[j] = u8::try_from(k + 1).expect("feature id fits the grid");
        }
        assert!(
            !(walks.check)(&m, f),
            "seed {}: a Plague spawn ringed by pool bog",
            r.seed
        );
        assert!((wet.check)(&m, f), "seed {}: every pool still wet", r.seed);
        doctored += 1;
    }
    assert!(
        doctored >= 16,
        "only {doctored} kept maps with a pool and a ringable Plague spawn"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// The pipeline.
// ---------------------------------------------------------------------------------------------------------------------

/// Seeds 1-32, option on: every refused attempt's label is today's under the packet's mapping (`pinned_labels`), and
/// the seed's map is the attempt after them (the map itself: `option_on_maps_are_unchanged`).
#[test]
fn the_refusal_labels_of_seeds_1_to_32_are_todays_relabelled() {
    let got: Vec<(i64, Vec<String>)> = runs()
        .iter()
        .map(|r| (r.seed, r.refused.iter().map(|(l, _)| l.clone()).collect()))
        .collect();
    let want: Vec<(i64, Vec<String>)> = pinned_labels()
        .iter()
        .map(|(s, ls)| (*s, ls.iter().map(|l| l.to_string()).collect()))
        .collect();
    for (g, w) in got.iter().zip(&want) {
        assert_eq!(g, w, "seed {}: refusal labels before its map", w.0);
    }
    assert_eq!(got.len(), want.len());
}

/// A guarantee failure is refused after records (the last phase observed is `Records`, as `SignatureDiscarded`), as
/// `Refusal::Guarantee` naming the zone and the rule, and a numbered attempt returns that refusal as its error.
#[test]
fn a_lake_failure_is_refused_after_records_as_the_frost_guarantee() {
    let mut first = None;
    let mut seen = 0;
    for r in runs() {
        for (n, (label, last)) in r.refused.iter().enumerate() {
            if label.starts_with("Guarantee") || label == SD {
                assert_eq!(
                    *last,
                    Some(pipeline::Phase::Records),
                    "seed {} attempt {n}: {label} after records",
                    r.seed
                );
            }
            if label == LAKE {
                seen += 1;
                first.get_or_insert((r.seed, n as u64));
            }
        }
    }
    assert_eq!(seen, 11, "lake-at-mouth refusals over seeds 1-32");
    let (seed, n) = first.expect("a lake refusal");
    let fixed = coliseum::fixed_layout();
    let got = pipeline::Pipeline::new(&fixed).generate_styled(seed, Some(n), on());
    assert!(
        matches!(
            got,
            Err(pipeline::Error::AttemptRefused(
                pipeline::Refusal::Guarantee {
                    zone: Zone::Frost,
                    rule: "lake-at-mouth"
                }
            ))
        ),
        "seed {seed} attempt {n}: {:?}",
        got.as_ref().err()
    );
}
