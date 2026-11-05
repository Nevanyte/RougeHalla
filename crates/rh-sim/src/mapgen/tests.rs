use super::{coliseum, det_math, grid_ops, grid_topology as topo};
use serde::Deserialize;
#[derive(Deserialize)]
struct Corpus {
    format: String,
    oracle: Oracle,
    simple: Vec<u8>,
    offsets: Offsets,
    trig: Vec<Trig>,
    rounds: Vec<Round>,
    grids: Vec<Grid>,
    layout: coliseum::FixedLayout,
    connectivity: Vec<Connectivity>,
}
#[derive(Deserialize)]
struct Oracle {
    node: String,
    platform: String,
    arch: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Offsets {
    ring: Vec<i32>,
    nb4: Vec<i32>,
    fixed_ring: Vec<i32>,
    fixed_nb4: Vec<i32>,
}
#[derive(Deserialize)]
struct Trig {
    x: String,
    sin: String,
    cos: String,
    wrap: String,
}
#[derive(Deserialize)]
struct Round {
    x: String,
    rounded: String,
}
#[derive(Deserialize)]
struct Grid {
    name: String,
    w: usize,
    h: usize,
    tiles: Vec<u8>,
    seeds: Vec<i32>,
    values: Option<Vec<i32>>,
    scope: Option<Vec<u8>>,
    distances: Vec<Vec<i32>>,
    field: Vec<i32>,
    paths: Vec<Path>,
    segments: Vec<(i32, i32, i32, i32, u8, bool)>,
}
#[derive(Deserialize)]
struct Path {
    from: i32,
    path: Vec<i32>,
}
#[derive(Deserialize)]
struct Connectivity {
    seed: coliseum::TilePt,
    before: Vec<u8>,
    after: Vec<u8>,
    log: Vec<usize>,
}
fn corpus() -> Corpus {
    serde_json::from_str(include_str!("fixtures/foundations.json")).expect("legacy fixture schema")
}
fn bits(s: &str) -> u64 {
    u64::from_str_radix(s, 16).unwrap()
}
#[test]
fn fixture_provenance_and_all_simple_masks() {
    let c = corpus();
    assert_eq!(c.format, "rh-map-foundations/1");
    assert_eq!(
        (
            c.oracle.node.as_str(),
            c.oracle.platform.as_str(),
            c.oracle.arch.as_str()
        ),
        ("v22.23.4", "linux", "x64")
    );
    assert_eq!(topo::SIMPLE.as_slice(), c.simple);
    assert_eq!(topo::ring_offsets(160).as_slice(), c.offsets.ring);
    assert_eq!(topo::nb4_offsets(160).as_slice(), c.offsets.nb4);
    assert_eq!(grid_ops::RING_OFF.as_slice(), c.offsets.fixed_ring);
    assert_eq!(grid_ops::NB4.as_slice(), c.offsets.fixed_nb4);
    assert_eq!(grid_ops::SIMPLE, topo::SIMPLE);
    assert_eq!(grid_ops::RING_DX, topo::RING_DX);
    assert_eq!(grid_ops::RING_DY, topo::RING_DY);
}
#[test]
fn generator_trigonometry_rounding_and_wrapping_match_legacy_bits() {
    let c = corpus();
    for t in c.trig {
        let x = f64::from_bits(bits(&t.x));
        assert_eq!(det_math::det_sin(x).to_bits(), bits(&t.sin), "sin({x:?})");
        assert_eq!(det_math::det_cos(x).to_bits(), bits(&t.cos), "cos({x:?})");
        assert_eq!(
            crate::math::wrap_angle(x).to_bits(),
            bits(&t.wrap),
            "wrap({x:?})"
        );
    }
    for t in c.rounds {
        let x = f64::from_bits(bits(&t.x));
        assert_eq!(
            crate::math::js_round(x).to_bits(),
            bits(&t.rounded),
            "round({x:?})"
        );
    }
}
#[test]
fn distance_fields_paths_and_segments_match_real_legacy_functions() {
    let c = corpus();
    assert_eq!(c.grids.len(), 295);
    for g in c.grids {
        for (from, expected) in g.distances.iter().enumerate() {
            assert_eq!(
                &topo::walk_distances(&g.tiles, g.w, g.h, from),
                expected,
                "{} 5/7 from={from}",
                g.name
            );
        }
        let field = topo::walk_field16(
            &g.tiles,
            g.w,
            g.h,
            &g.seeds,
            g.values.as_deref(),
            g.scope.as_deref(),
        );
        assert_eq!(field, g.field, "{} 5/7/11", g.name);
        for p in g.paths {
            assert_eq!(
                topo::descent_path(&field, &g.tiles, g.w, g.h, p.from),
                p.path,
                "{} descent from={}",
                g.name,
                p.from
            );
        }
        for (ax, ay, bx, by, mask, blocked) in g.segments {
            assert_eq!(
                topo::segment_blocked(&g.tiles, g.w, g.h, ax, ay, bx, by, mask),
                blocked,
                "{} segment ({ax},{ay}) -> ({bx},{by}) mask={mask}",
                g.name
            );
        }
    }
}
#[test]
fn fixed_layout_matches_every_legacy_tile_variant_gate_and_spawn_in_order() {
    let expected = corpus().layout;
    let actual = coliseum::fixed_layout();
    // Equality includes all tile masks, 8 complete pillar variants, painted/ring order,
    // lanes, gate coordinates and ordering, rectangle and snapped inner spawns.
    assert_eq!(actual, expected);
    assert_eq!(actual.pillars.len(), 8);
    for p in &actual.pillars {
        assert_eq!(p.iter().filter(|&&x| x == 1).count(), 20);
    }
    // Returned layouts own their buffers: callers cannot corrupt future layouts.
    let mut changed = actual;
    changed.fp.fill(0);
    assert_eq!(coliseum::fixed_layout(), expected);
}
#[test]
fn fixed_connectivity_matches_legacy_including_blocked_seed_and_append_log() {
    for c in corpus().connectivity {
        let mut tiles = c.before.clone();
        let mut log = vec![123456];
        grid_ops::enforce_connectivity(&mut tiles, c.seed, Some(&mut log));
        assert_eq!(tiles, c.after);
        assert_eq!(log, c.log);
        let mut no_log = c.before;
        grid_ops::enforce_connectivity(&mut no_log, c.seed, None);
        assert_eq!(no_log, c.after);
    }
}
#[test]
fn explicit_corner_scope_and_descent_tie_regressions() {
    // Vertex touching either opaque side blocks sight. LOW only blocks movement.
    let tiles = [0, 2, 0, 0];
    assert!(!topo::segment_blocked(&tiles, 2, 2, 0, 0, 1, 1, 1));
    assert!(topo::segment_blocked(&tiles, 2, 2, 0, 0, 1, 1, 255));
    assert_eq!(topo::walk_distances(&tiles, 2, 2, 0), [0, -1, 5, 10]);
    // A seed outside scope still emits; corner cells need floor, not scope membership.
    let scope = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    let field = topo::walk_field16(&[0; 9], 3, 3, &[0], None, Some(&scope));
    assert_eq!(field, [0, -1, -1, -1, 7, -1, -1, -1, -1]);
    let tied = [0, 0, 0, 0, 9, 0, 0, 0, 0];
    assert_eq!(topo::descent_path(&tied, &[0; 9], 3, 3, 4), [4, 0]);
    assert_eq!(topo::descent_path(&[-1; 9], &[0; 9], 3, 3, 4), [4]);
}

#[test]
fn fixed_definition_content_words_cover_scalar_rules_and_pillar_orbits() {
    fn words(data: &coliseum::FixedDefinition<'_>) -> Vec<u64> {
        let mut out = Vec::new();
        coliseum::visit_content(data, |word| out.push(word));
        out
    }
    let default = coliseum::default_definition();
    let expected = words(&default);
    assert_eq!(expected.len(), 89); // 11 scalars/count + 4 orbit headers + 35 coordinate pairs.
    macro_rules! scalar {
        ($field:ident, $value:expr) => {{
            let mut changed = default;
            changed.$field = $value;
            assert_ne!(words(&changed), expected, stringify!($field));
        }};
    }
    scalar!(half, default.half + 1.0);
    scalar!(chamfer, default.chamfer + 1.0);
    scalar!(gate_width, default.gate_width + 1);
    scalar!(lane_depth, default.lane_depth + 1);
    scalar!(lane_margin, default.lane_margin + 1);
    scalar!(ring_road, default.ring_road + 1);
    scalar!(distance_cap, default.distance_cap + 1);
    scalar!(inner_spawn_radius, default.inner_spawn_radius + 1.0);
    scalar!(inner_spawn_phase, default.inner_spawn_phase + 0.25);
    scalar!(pillar_source_center, default.pillar_source_center + 1);
    for orbit_index in 0..default.pillars.len() {
        let mut orbits = default.pillars.to_vec();
        orbits[orbit_index].turns += 1;
        let mut changed = default;
        changed.pillars = &orbits;
        assert_ne!(words(&changed), expected);
        for index in 0..default.pillars[orbit_index].generators.len() {
            for axis in 0..2 {
                let mut orbits = default.pillars.to_vec();
                let mut generators = orbits[orbit_index].generators.to_vec();
                if axis == 0 {
                    generators[index].0 += 1;
                } else {
                    generators[index].1 += 1;
                }
                orbits[orbit_index].generators = &generators;
                let mut changed = default;
                changed.pillars = &orbits;
                assert_ne!(
                    words(&changed),
                    expected,
                    "orbit {orbit_index} generator {index} axis {axis}"
                );
            }
        }
    }
    let mut geometry = default;
    geometry.inner_spawn_radius += 1.0;
    assert_ne!(
        coliseum::fixed_layout_from(&geometry).inner_tiles,
        coliseum::fixed_layout().inner_tiles
    );
    let mut orbits = default.pillars.to_vec();
    let mut generators = orbits[0].generators.to_vec();
    generators[0].0 += 1;
    orbits[0].generators = &generators;
    let mut changed = default;
    changed.pillars = &orbits;
    assert_ne!(
        coliseum::fixed_layout_from(&changed).pillars,
        coliseum::fixed_layout().pillars
    );
}

#[test]
fn field_cursor_finishes_at_signed_seed_value_boundaries() {
    // These values are captured through actual walkField16 in the oracle too.
    // Values above the legacy INF sentinel do not become sources.
    for value in [i32::MAX - 1, i32::MAX] {
        assert_eq!(
            topo::walk_field16(&[0], 1, 1, &[0], Some(&[value]), None),
            [-1]
        );
    }
    for value in [i32::MIN, i32::MIN + 1] {
        assert_eq!(
            topo::walk_field16(&[0], 1, 1, &[0], Some(&[value]), None),
            [value]
        );
    }
}
