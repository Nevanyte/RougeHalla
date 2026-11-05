use super::*;
use crate::{math::Vec2, pathfind::Pathfinder, rng::Mulberry32};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Corpus {
    format: String,
    node: String,
    platform: String,
    arch: String,
    actual_source_sha256: String,
    observation_only_final_equality_verified: bool,
    scan: Vec<Scan>,
    cases: Vec<Case>,
    pool_units: Vec<PoolUnit>,
    gate_cases: Vec<GateCase>,
    rects: Vec<RectCase>,
    segments: Vec<Segment>,
}
#[derive(Deserialize)]
struct Scan {
    dropped: Option<usize>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    seed: u32,
    styled: bool,
    initial_u32: u32,
    skipped_words: usize,
    words: Vec<u32>,
    continuation: Vec<u32>,
    landmark_protect: Vec<u8>,
    pool_input: Input,
    pool: Option<Vec<usize>>,
    pool_masks: Option<Masks>,
    style_protect: Option<Vec<u8>>,
    gate_input: Option<GateInput>,
    paths: Vec<Path>,
    decision: Option<Decision>,
    original_masks_survived: usize,
    final_verified: bool,
    final_hash: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    tiles: Vec<u8>,
    zone: Vec<u8>,
    open3: Vec<u8>,
    landmark_near1: Vec<u8>,
    landmark_box: Vec<u8>,
    camps: Vec<CampSite>,
    centre_walk: Vec<i32>,
    buildings: Vec<TileRect>,
    feature_owner: Vec<u16>,
    features: Vec<serde_json::Value>,
}
#[derive(Deserialize)]
struct Masks {
    halo: Vec<u8>,
    pool5: Vec<u8>,
}
#[derive(Deserialize)]
struct GateInput {
    tiles: Vec<u8>,
    pool: Vec<usize>,
    terrain: Vec<u8>,
    zone: Vec<u8>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Path {
    tile: usize,
    path: Vec<Point>,
    walk_bits: String,
    hazards: u32,
}
#[derive(Deserialize)]
struct Point {
    x: f64,
    y: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Decision {
    keep: Option<Vec<usize>>,
    walk_bits: Vec<String>,
    hazards: Vec<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PoolUnit {
    name: String,
    base_case: usize,
    landmark_near1: Vec<u8>,
    words: Vec<u32>,
    continuation: Vec<u32>,
    pool: Option<Vec<usize>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GateCase {
    name: String,
    pool: Vec<usize>,
    walk_bits: Vec<String>,
    hazards: Vec<u32>,
    zones: Vec<u8>,
    keep: Option<Vec<usize>>,
}
#[derive(Deserialize)]
struct RectCase {
    rect: TileRect,
    margin: i32,
    grid: Vec<u8>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    ax: i32,
    ay: i32,
    bx: i32,
    by: i32,
    stop_after: usize,
    visited: Vec<(i32, i32)>,
    stopped: bool,
}
fn corpus() -> Corpus {
    serde_json::from_str(include_str!("../fixtures/spawns.json")).unwrap()
}
fn float(bits: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(bits, 16).unwrap())
}
fn centre(tile: usize) -> Vec2 {
    Vec2::new(
        (tile % W) as f64 * crate::constants::TILE + crate::constants::TILE / 2.0,
        (tile / W) as f64 * crate::constants::TILE + crate::constants::TILE / 2.0,
    )
}
#[test]
fn real_landmark_inputs_pool_arrays_protection_and_rng_are_exact() {
    let corpus = corpus();
    assert_eq!(corpus.format, "rh-spawns/1");
    assert_eq!(
        (
            corpus.node.as_str(),
            corpus.platform.as_str(),
            corpus.arch.as_str()
        ),
        ("v22.23.4", "linux", "x64")
    );
    assert_eq!(corpus.actual_source_sha256.len(), 64);
    assert!(corpus.observation_only_final_equality_verified);
    assert_eq!(corpus.scan.len(), 32);
    assert!(corpus.scan.iter().any(|s| s.dropped.is_some_and(|n| n > 0)));
    assert!(corpus.cases.iter().any(|c| c.styled) && corpus.cases.iter().any(|c| !c.styled));
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let context = SpawnContext::new(&fixed);
    let mut checked_drop = false;
    for c in corpus.cases {
        assert!(c.final_verified);
        if let Some(hash) = c.final_hash {
            assert_eq!(hash.len(), 8);
        }
        assert!(!c.pool_input.buildings.is_empty());
        assert!(c
            .pool_input
            .features
            .iter()
            .any(|f| f["kind"] == "landmark"));
        assert!(c.pool_input.feature_owner.iter().any(|&id| id > 0));
        let masks = context.landmark_masks(&c.pool_input.buildings);
        assert_eq!(masks.boxes, c.pool_input.landmark_box);
        assert_eq!(masks.near1, c.pool_input.landmark_near1);
        assert_eq!(
            context.landmark_protect(&c.pool_input.camps),
            c.landmark_protect
        );
        let preparation = prepare(&c.pool_input.tiles);
        assert_eq!(preparation.centre_walk, c.pool_input.centre_walk);
        assert_eq!(preparation.open3, c.pool_input.open3);
        let input = PoolInput {
            tiles: &c.pool_input.tiles,
            zone: &c.pool_input.zone,
            landmark_near1: &c.pool_input.landmark_near1,
            camps: &c.pool_input.camps,
        };
        let mut rng = Mulberry32::new(c.initial_u32);
        for _ in 0..c.skipped_words {
            rng.next_u32();
        }
        let mut combined_rng = rng.clone();
        let mut words = Vec::new();
        let picked = pick_spawn_pool(&context, &input, &preparation, &mut || {
            let w = rng.next_u32();
            words.push(w);
            f64::from(w) / 4294967296.0
        });
        let combined = prepare_and_pick(&context, &input, &mut || combined_rng.next_f64());
        assert_eq!(combined.as_ref().map(|p| &p.pool), picked.as_ref());
        if let Some(combined) = combined {
            assert_eq!(combined.preparation, preparation);
            assert_eq!(combined.protection, context.pool_masks(&combined.pool));
        }
        assert_eq!(combined_rng, rng);
        assert_eq!(picked, c.pool, "seed {}", c.seed);
        assert_eq!(words, c.words);
        assert_eq!(
            (0..8).map(|_| rng.next_u32()).collect::<Vec<_>>(),
            c.continuation
        );
        if let (Some(pool), Some(expected)) = (picked, c.pool_masks) {
            let protection = context.pool_masks(&pool);
            assert_eq!(protection.halo, expected.halo);
            assert_eq!(protection.pool5, expected.pool5);
            assert_eq!(
                Some(context.style_protect(
                    &c.pool_input.camps,
                    &c.pool_input.landmark_near1,
                    &c.pool_input.feature_owner,
                    &protection.halo
                )),
                c.style_protect
            );
            if let (Some(gate), Some(decision)) = (c.gate_input, c.decision) {
                assert_eq!(gate.pool, pool);
                assert_eq!(c.original_masks_survived, 2);
                let original = protection.clone();
                let walks: Vec<f64> = decision.walk_bits.iter().map(|s| float(s)).collect();
                let kept =
                    gate_spawn_walks(&context.rules, &pool, &walks, &decision.hazards, |t| {
                        gate.zone[t]
                    });
                assert_eq!(kept, decision.keep);
                assert_eq!(
                    protection, original,
                    "gate cannot rewrite original pool protection"
                );
                if let Some(kept) = kept {
                    if kept.len() < pool.len() {
                        checked_drop = true;
                        let members: Vec<usize> = kept.iter().map(|&i| pool[i]).collect();
                        let recomputed = context.pool_masks(&members);
                        assert_ne!(
                            original, recomputed,
                            "rebuilding masks after real drops would lose reserved ground"
                        );
                        for (i, &tile) in pool.iter().enumerate() {
                            if !kept.contains(&i) {
                                assert_eq!(original.halo[tile], 1);
                                assert_eq!(recomputed.halo[tile], 0);
                            }
                        }
                    }
                }
            }
        }
    }
    assert!(checked_drop);
}
#[test]
fn existing_pathfinder_matches_actual_gate_paths_lengths_and_hazards_without_tolerance() {
    let mut queries = 0;
    for c in corpus().cases {
        let Some(gate) = c.gate_input else {
            continue;
        };
        let map = crate::map::TileMap::new(W as u32, H as u32, gate.tiles).unwrap();
        let mut finder = Pathfinder::default();
        for expected in c.paths {
            queries += 1;
            let from = centre(expected.tile);
            let path = finder.find_path(
                &map,
                from,
                centre(CY as usize * W + CX as usize),
                crate::constants::PLAYER_RADIUS,
            );
            assert_eq!(
                path.len(),
                expected.path.len(),
                "seed {} tile {}",
                c.seed,
                expected.tile
            );
            let mut length = 0.0;
            let mut previous = from;
            for (p, e) in path.iter().zip(&expected.path) {
                assert_eq!(
                    (p.x.to_bits(), p.y.to_bits()),
                    (e.x.to_bits(), e.y.to_bits()),
                    "seed {} tile {} path",
                    c.seed,
                    expected.tile
                );
                let dx = p.x - previous.x;
                let dy = p.y - previous.y;
                length += crate::math::sqrt(dx * dx + dy * dy);
                previous = *p;
            }
            assert_eq!(
                length.to_bits(),
                float(&expected.walk_bits).to_bits(),
                "seed {} tile {} length",
                c.seed,
                expected.tile
            );
            let mut seen = vec![false; W * H];
            let mut hazards = 0;
            let (mut ax, mut ay) = ((expected.tile % W) as i32, (expected.tile / W) as i32);
            for p in &path {
                let bx = (p.x / crate::constants::TILE).floor() as i32;
                let by = (p.y / crate::constants::TILE).floor() as i32;
                walk_segment(ax, ay, bx, by, |x, y| {
                    let i = y as usize * W + x as usize;
                    if !seen[i] {
                        seen[i] = true;
                        if [4, 5, 6].contains(&gate.terrain[i]) {
                            hazards += 1;
                        }
                    }
                    false
                });
                ax = bx;
                ay = by;
            }
            assert_eq!(
                hazards, expected.hazards,
                "seed {} tile {} hazards",
                c.seed, expected.tile
            );
        }
    }
    assert!(queries >= 100);
}
#[test]
fn standalone_gate_thresholds_ties_and_minimums_match_real_function() {
    let definition = default_definition();
    for c in corpus().gate_cases {
        let walks: Vec<f64> = c.walk_bits.iter().map(|s| float(s)).collect();
        assert_eq!(
            gate_spawn_walks(&definition, &c.pool, &walks, &c.hazards, |tile| c.zones
                [c.pool.iter().position(|&t| t == tile).unwrap()]),
            c.keep,
            "{}",
            c.name
        );
    }
}
#[test]
fn clipped_rects_and_integer_segment_visit_order_match_actual_helpers() {
    let c = corpus();
    for r in c.rects {
        let mut grid = vec![0; W * H];
        mark_rect(&mut grid, r.rect, r.margin);
        assert_eq!(grid, r.grid);
    }
    for s in c.segments {
        let mut visited = Vec::new();
        let stopped = walk_segment(s.ax, s.ay, s.bx, s.by, |x, y| {
            visited.push((x, y));
            s.stop_after > 0 && visited.len() >= s.stop_after
        });
        assert_eq!(visited, s.visited);
        assert_eq!(stopped, s.stopped);
    }
    let mut tiles = vec![0; W * H];
    tiles[50 * W + 50] = 2;
    let p = prepare(&tiles);
    assert_eq!(p.open3[0], 0);
    assert_eq!(p.open3[W], 0);
    assert_eq!(p.open3[W + 1], 1);
    assert_eq!(p.open3[50 * W + 50], 0);
    assert_eq!(p.open3[49 * W + 49], 0);
    let f = crate::mapgen::coliseum::fixed_layout();
    let ctx = SpawnContext::new(&f);
    let input = PoolInput {
        tiles: &tiles,
        zone: &vec![0; W * H],
        landmark_near1: &vec![0; W * H],
        camps: &[],
    };
    let mut draws = 0;
    assert!(pick_spawn_pool(&ctx, &input, &p, &mut || {
        draws += 1;
        0.5
    })
    .is_none());
    assert_eq!(draws, 0);
}
#[test]
fn all_spawn_rule_words_are_covered_and_changes_reach_runtime_and_masks() {
    fn words(d: &SpawnDefinition) -> Vec<u64> {
        let mut out = Vec::new();
        visit_content(d, |w| out.push(w));
        out
    }
    let d = default_definition();
    let original = words(&d);
    assert_eq!(original.len(), 27);
    macro_rules! changed {
        ($field:ident,$value:expr) => {{
            let mut next = d;
            next.$field = $value;
            assert_ne!(words(&next), original, stringify!($field));
        }};
    }
    changed!(separation, d.separation + 1.0);
    changed!(safe_separation, d.safe_separation + 1.0);
    changed!(camp_pick, d.camp_pick + 1);
    changed!(ring_lo, d.ring_lo + 0.01);
    changed!(ring_hi, d.ring_hi + 0.01);
    changed!(pick_target, d.pick_target + 1);
    changed!(pool_min, d.pool_min + 1);
    changed!(pool_zones, d.pool_zones + 1);
    changed!(pick_band, d.pick_band + 0.01);
    changed!(tries, d.tries + 1);
    changed!(walk_ratio_max, d.walk_ratio_max + 0.1);
    changed!(hazard_walk_max, d.hazard_walk_max + 1);
    changed!(quantile_first, d.quantile_first + 1);
    changed!(quantile_last, d.quantile_last + 1);
    changed!(quantile_denominator, d.quantile_denominator + 1);
    changed!(score_weight, d.score_weight + 1);
    changed!(early_extra, d.early_extra + 1);
    changed!(scan_margin, d.scan_margin + 1);
    changed!(pool_halo_margin, d.pool_halo_margin + 1);
    changed!(pool5_margin, d.pool5_margin + 1);
    changed!(corner_open, d.corner_open + 1);
    changed!(landmark_road_margin, d.landmark_road_margin + 1);
    changed!(landmark_lane_margin, d.landmark_lane_margin + 1);
    changed!(landmark_clearing_margin, d.landmark_clearing_margin + 1);
    changed!(style_road_margin, d.style_road_margin + 1);
    changed!(style_lane_margin, d.style_lane_margin + 1);
    changed!(landmark_box_margin, d.landmark_box_margin + 1);
    let f = crate::mapgen::coliseum::fixed_layout();
    let normal = SpawnContext::new(&f);
    let mut modified = d;
    modified.pool_halo_margin += 1;
    let changed = SpawnContext::from_definitions(
        &f,
        &modified,
        &crate::mapgen::coliseum::default_definition(),
        &crate::mapgen::zones::default_definition(),
        &crate::mapgen::zones::camps::default_definition(),
    );
    assert_ne!(
        normal.pool_masks(&[80 * W + 80]),
        changed.pool_masks(&[80 * W + 80])
    );
    let case = corpus().cases.remove(0);
    let input = PoolInput {
        tiles: &case.pool_input.tiles,
        zone: &case.pool_input.zone,
        landmark_near1: &case.pool_input.landmark_near1,
        camps: &case.pool_input.camps,
    };
    let preparation = prepare(&case.pool_input.tiles);
    let mut modified = d;
    modified.tries = 0;
    let changed = SpawnContext::from_definitions(
        &f,
        &modified,
        &crate::mapgen::coliseum::default_definition(),
        &crate::mapgen::zones::default_definition(),
        &crate::mapgen::zones::camps::default_definition(),
    );
    let mut draws = 0;
    assert!(pick_spawn_pool(&changed, &input, &preparation, &mut || {
        draws += 1;
        0.5
    })
    .is_none());
    assert_eq!(draws, 0);
}

#[test]
fn real_source_pool_helper_boundaries_preserve_retry_consumption_and_results() {
    let c = corpus();
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let context = SpawnContext::new(&fixed);
    for unit in c.pool_units {
        let base = &c.cases[unit.base_case];
        let input = PoolInput {
            tiles: &base.pool_input.tiles,
            zone: &base.pool_input.zone,
            landmark_near1: &unit.landmark_near1,
            camps: &base.pool_input.camps,
        };
        let preparation = prepare(input.tiles);
        let mut rng = Mulberry32::new(base.initial_u32);
        for _ in 0..base.skipped_words {
            rng.next_u32();
        }
        let mut words = Vec::new();
        let pool = pick_spawn_pool(&context, &input, &preparation, &mut || {
            let w = rng.next_u32();
            words.push(w);
            f64::from(w) / 4294967296.0
        });
        assert_eq!(pool, unit.pool, "{}", unit.name);
        assert_eq!(words, unit.words, "{} draws", unit.name);
        assert_eq!(
            (0..8).map(|_| rng.next_u32()).collect::<Vec<_>>(),
            unit.continuation
        );
        if unit.name == "0-original-candidates" {
            assert!(words.is_empty());
        } else {
            assert!(
                words.len() > 7,
                "controlled candidate exclusions exercise more than one round"
            );
        }
    }
}
