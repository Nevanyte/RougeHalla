use super::*;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Rle {
    rle: Vec<[usize; 2]>,
}
impl Rle {
    fn decode(&self) -> Vec<u8> {
        assert!(!self.rle.is_empty());
        let mut out = Vec::new();
        for &[value, count] in &self.rle {
            assert!(value <= 255 && count > 0 && count <= W * H);
            assert!(out.len() + count <= W * H);
            out.extend(std::iter::repeat_n(value as u8, count));
        }
        assert_eq!(out.len(), W * H);
        out
    }
}
#[derive(Deserialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Phase {
    TerrainBefore {
        styled: bool,
        tiles: Rle,
        terrain: Rle,
        props: Vec<MapProp>,
    },
    TerrainAfter {
        tiles: Rle,
        terrain: Rle,
        props: Vec<MapProp>,
    },
    LootBefore {
        tiles: Rle,
        terrain: Rle,
        props: Vec<MapProp>,
        pool: Vec<usize>,
        all_crates: Vec<usize>,
        ground_spots: Vec<WorldPt>,
    },
    LootAfter {
        props: Vec<MapProp>,
    },
    BushAvoid {
        bush_avoid: Rle,
        zone: Rle,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ShapeInput {
    tiles: Rle,
    feature_grid: Rle,
    zone: Rle,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    seed: i64,
    attempt: u64,
    styled: bool,
    decor: bool,
    synthetic_props: bool,
    complete_final_output_equality: bool,
    final_hash: String,
    phases: Vec<Phase>,
    shape_input: ShapeInput,
    shape: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Ice {
    position: usize,
    code: u8,
    neighbor: usize,
    tiles: Rle,
    before: Rle,
    after: Rle,
    cleared: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Buried {
    styled: bool,
    kind: u8,
    code: u8,
    tiles: Rle,
    before: Rle,
    after: Rle,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Shape {
    name: String,
    input: ShapeInput,
    reason: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Corpus {
    format: String,
    node: String,
    platform: String,
    arch: String,
    sources: BTreeMap<String, String>,
    cases: Vec<Case>,
    buried: Vec<Buried>,
    ice: Vec<Ice>,
    shape: Vec<Shape>,
}
fn fixture() -> Corpus {
    let c: Corpus = serde_json::from_str(include_str!("../fixtures/map-tail.json")).unwrap();
    assert_eq!(c.format, "rh-map-tail/1");
    assert_eq!(
        (c.node.as_str(), c.platform.as_str(), c.arch.as_str()),
        ("v22.23.4", "linux", "x64")
    );
    let records: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/map-records.json")).unwrap();
    assert_eq!(c.sources.len(), 75);
    assert_eq!(
        serde_json::to_value(&c.sources).unwrap(),
        records["sources"]
    );
    assert_eq!(c.cases.len(), 10);
    assert_eq!(c.buried.len(), 48);
    assert_eq!(c.ice.len(), 120);
    assert_eq!(c.shape.len(), 12);
    c
}

#[test]
fn original_closed_buried_helper_matches_all_kind_classes_and_hook_modes() {
    let c = fixture();
    let mut index = 0;
    for styled in [false, true] {
        for kind in 0..8 {
            for code in [0, 1, 2] {
                let case = &c.buried[index];
                index += 1;
                assert_eq!((case.styled, case.kind, case.code), (styled, kind, code));
                let at = 50 * W + 50;
                let mut tiles = vec![0; W * H];
                let mut terrain = vec![0; W * H];
                tiles[at] = code;
                terrain[at] = kind;
                assert_eq!(tiles, case.tiles.decode());
                assert_eq!(terrain, case.before.decode());
                clear_terrain(
                    &crate::mapgen::terrain_gate::default_definition(),
                    styled,
                    &tiles,
                    &mut terrain,
                    &mut Vec::new(),
                )
                .unwrap();
                assert_eq!(terrain, case.after.decode());
            }
        }
    }
    assert_eq!(index, 48);
}

#[test]
fn genuine_stage_ten_loot_and_shape_boundaries_match_actual_source() {
    let c = fixture();
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let attempt_context = crate::mapgen::attempt::AttemptContext::new(&fixed);
    let landmark_context = crate::mapgen::landmarks::stage::StageContext::new(&fixed);
    let spawn_context = crate::mapgen::spawns::SpawnContext::new(&fixed);
    let recipe_definitions = crate::mapgen::landmarks::recipes::default_definitions();
    let recipes =
        crate::mapgen::landmarks::recipes::Recipes::from_definitions(&recipe_definitions).unwrap();
    let mut original_pools = BTreeMap::new();
    let records: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/map-records.json")).unwrap();
    let inventory = [
        (1, 0, false, false, false),
        (-1, 0, false, false, false),
        (4294967297, 4294967296, false, false, false),
        (17, 0, false, false, false),
        (17, 1, false, false, false),
        (176, 0, false, false, false),
        (1, 0, true, false, false),
        (1, 0, false, true, false),
        (1, 0, true, true, false),
        (1, 0, true, true, true),
    ];
    for (case_index, (case, expected)) in c.cases.iter().zip(inventory).enumerate() {
        assert_eq!(
            (
                case.seed,
                case.attempt,
                case.styled,
                case.decor,
                case.synthetic_props
            ),
            expected
        );
        assert!(case.complete_final_output_equality);
        assert_eq!(case.final_hash.len(), 8);
        assert!(case
            .final_hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
        let [Phase::TerrainBefore {
            styled,
            tiles: before_tiles,
            terrain: before_terrain,
            props: before_props,
        }, Phase::TerrainAfter {
            tiles: after_tiles,
            terrain: after_terrain,
            props: after_props,
        }, Phase::LootBefore {
            tiles: loot_tiles,
            terrain: loot_terrain,
            props: loot_props,
            pool,
            all_crates,
            ground_spots,
        }, Phase::LootAfter { props: final_props }, Phase::BushAvoid { bush_avoid, zone }] =
            case.phases.as_slice()
        else {
            panic!("exact phase order required")
        };
        assert_eq!(*styled, case.styled);
        let tiles = before_tiles.decode();
        let mut terrain = before_terrain.decode();
        let mut props = before_props.clone();
        clear_terrain(
            &crate::mapgen::terrain_gate::default_definition(),
            *styled,
            &tiles,
            &mut terrain,
            &mut props,
        )
        .unwrap();
        assert_eq!(tiles, after_tiles.decode());
        assert_eq!(terrain, after_terrain.decode());
        assert_eq!(props, *after_props);
        assert_eq!(tiles, loot_tiles.decode());
        assert_eq!(terrain, loot_terrain.decode());
        assert_eq!(props, *loot_props);
        let avoid = clear_loot_decor(
            &default_definition(),
            pool,
            all_crates,
            ground_spots,
            &mut props,
        )
        .unwrap();
        assert_eq!(props, *final_props);
        assert_eq!(avoid, bush_avoid.decode());
        assert_eq!(tiles, case.shape_input.tiles.decode());
        assert_eq!(zone.decode(), case.shape_input.zone.decode());
        assert!((24..=32).contains(&pool.len()));
        let original_pool = original_pools
            .entry((case.seed, case.attempt))
            .or_insert_with(|| {
                let mut frame = crate::mapgen::attempt::begin_attempt(
                    &attempt_context,
                    case.seed,
                    case.attempt,
                )
                .unwrap()
                .unwrap();
                let landmarks = landmark_context.apply(&frame, &recipes).unwrap().unwrap();
                crate::mapgen::spawns::prepare_and_pick(
                    &spawn_context,
                    &crate::mapgen::spawns::PoolInput {
                        tiles: &landmarks.state.tiles,
                        zone: &frame.state.partition.zone,
                        landmark_near1: &landmarks.masks.near1,
                        camps: &frame.state.layout.camps,
                    },
                    &mut || frame.rng.next_f64(),
                )
                .unwrap()
                .pool
            });
        assert_eq!(pool, original_pool);
        let unique: std::collections::BTreeSet<_> = pool.iter().copied().collect();
        assert_eq!(unique.len(), pool.len());
        assert!((20..=30).contains(&all_crates.len()));
        assert!((30..=45).contains(&ground_spots.len()));
        // A separate accepted source oracle binds every genuine boundary to a nonempty finished map.
        // This prevents replacing all phase data with a self-consistent empty/zero world.
        if case_index < 9 {
            let record = &records["cases"][case_index];
            assert_eq!(case.final_hash, record["finalHash"].as_str().unwrap());
            let input = &record["input"];
            let decode = |key: &str| {
                serde_json::from_value::<Rle>(input[key].clone())
                    .unwrap()
                    .decode()
            };
            assert_eq!(tiles, decode("tiles"));
            assert_eq!(terrain, decode("terrain"));
            assert_eq!(zone.decode(), decode("zone"));
            assert_eq!(
                case.shape_input.feature_grid.decode(),
                serde_json::from_value::<Rle>(record["output"]["featureGrid"].clone())
                    .unwrap()
                    .decode()
            );
            assert_eq!(
                *final_props,
                serde_json::from_value::<Vec<MapProp>>(input["props"].clone()).unwrap()
            );
            assert_eq!(
                *ground_spots,
                serde_json::from_value::<Vec<WorldPt>>(input["groundSpots"].clone()).unwrap()
            );
            let crates: Vec<Vec<usize>> =
                serde_json::from_value(input["cratesByZone"].clone()).unwrap();
            assert_eq!(
                *all_crates,
                crates.into_iter().flatten().collect::<Vec<_>>()
            );
        } else {
            let Phase::TerrainBefore {
                props: ordinary_props,
                ..
            } = &c.cases[8].phases[0]
            else {
                unreachable!()
            };
            let mut expected_props = ordinary_props.clone();
            for code in [0, 1, 2] {
                let i = tiles.iter().position(|&v| v == code).unwrap();
                for kind in 0..34 {
                    expected_props.push(MapProp {
                        kind,
                        x: (i % W) as f64 * TILE + TILE / 2.0,
                        y: (i / W) as f64 * TILE + TILE / 2.0,
                        v: kind as u8,
                    });
                }
            }
            for (x, y) in [
                (-1.0, 100.0),
                (5120.0, 100.0),
                (100.0, -1.0),
                (100.0, 5120.0),
                (1e21, 0.0),
                (-1e-7, 0.0),
            ] {
                expected_props.push(MapProp {
                    kind: 0,
                    x,
                    y,
                    v: 0,
                });
            }
            expected_props.push(MapProp {
                kind: 65535,
                x: 1600.0,
                y: 1600.0,
                v: 0,
            });
            for &at in pool {
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        expected_props.push(MapProp {
                            kind: 0,
                            x: ((at % W) as i32 + dx) as f64 * TILE + TILE / 2.0,
                            y: ((at / W) as i32 + dy) as f64 * TILE + TILE / 2.0,
                            v: 0,
                        });
                    }
                }
            }
            assert_eq!(*before_props, expected_props);
        }
        let reason = shape_gate(
            &default_definition(),
            &tiles,
            &case.shape_input.feature_grid.decode(),
            &zone.decode(),
        )
        .unwrap();
        assert_eq!(reason.map(Refusal::source_reason), case.shape.as_deref());
    }
}

#[test]
fn all_ice_edge_class_and_neighbor_inputs_match_actual_helper() {
    let c = fixture();
    let mut index = 0;
    for position in [0, 159, 160 * 159, 25599, 160 * 50 + 50] {
        for code in [0, 1, 2] {
            for neighbor in 0..8 {
                let case = &c.ice[index];
                index += 1;
                assert_eq!(
                    (case.position, case.code, case.neighbor),
                    (position, code, neighbor)
                );
                let mut tiles = vec![0; W * H];
                let (x, y) = ((position % W) as i32, (position / W) as i32);
                let (nx, ny) = (x + RING_DX[neighbor], y + RING_DY[neighbor]);
                if nx >= 0 && ny >= 0 && nx < W as i32 && ny < H as i32 {
                    tiles[ny as usize * W + nx as usize] = code;
                }
                let mut terrain = vec![0; W * H];
                terrain[position] = 6;
                assert_eq!(tiles, case.tiles.decode());
                assert_eq!(terrain, case.before.decode());
                let cleared = clear_terrain(
                    &crate::mapgen::terrain_gate::default_definition(),
                    true,
                    &tiles,
                    &mut terrain,
                    &mut Vec::new(),
                )
                .unwrap();
                assert_eq!(cleared, case.cleared);
                assert_eq!(terrain, case.after.decode());
            }
        }
    }
    assert_eq!(index, 120);
}

fn shape_input(index: usize) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let (mut t, mut z, mut f) = (vec![0; W * H], vec![0; W * H], vec![0; W * H]);
    let mut put = |p, code, zone, owner| {
        t[p] = code;
        z[p] = zone;
        f[p] = owner;
    };
    match index {
        0 => {}
        1 => put(161, 2, 1, 0),
        2 => {
            put(161, 1, 1, 1);
            put(20000, 2, 2, 0);
        }
        3 => put(161, 2, 1, 1),
        4..=7 => {
            for i in 0..[1, 5, 6, 7][index - 4] {
                put((i + 3) * W + i + 3, 1, 1, 1);
            }
        }
        8 => {
            for i in 0..6 {
                put(5000 + i, 1, if i < 3 { 1 } else { 2 }, 1);
            }
        }
        9 => {
            put(0, 1, 0, 0);
            put(159, 2, 0, 0);
        }
        10 => {
            for i in 0..6 {
                put(5000 + i, 1, 1, 1);
            }
            put(24000, 1, 1, 1);
        }
        11 => {
            for p in [159, 160, 319, 320, 479, 480] {
                put(p, 1, 1, 1);
            }
        }
        _ => panic!("unknown shape case"),
    }
    (t, z, f)
}
#[test]
fn exact_source_shape_inventory_and_fail_first_priority() {
    let c = fixture();
    let names = [
        "empty",
        "unowned-low",
        "unowned-before-earlier-small-piece",
        "owned-low-not-wall",
        "diagonal-1",
        "diagonal-5",
        "diagonal-6",
        "diagonal-7",
        "different-zones-do-not-join",
        "zero-zone-ignored",
        "two-pieces-later-small",
        "border-does-not-wrap",
    ];
    let reasons = [
        None,
        Some("A:unowned"),
        Some("A:unowned"),
        None,
        Some("A:wallPiece"),
        Some("A:wallPiece"),
        None,
        None,
        Some("A:wallPiece"),
        None,
        Some("A:wallPiece"),
        Some("A:wallPiece"),
    ];
    for (index, case) in c.shape.iter().enumerate() {
        assert_eq!(case.name, names[index]);
        assert_eq!(case.reason.as_deref(), reasons[index]);
        let (tiles, zone, features) = shape_input(index);
        assert_eq!(tiles, case.input.tiles.decode());
        assert_eq!(zone, case.input.zone.decode());
        assert_eq!(features, case.input.feature_grid.decode());
        let reason = shape_gate(&default_definition(), &tiles, &features, &zone).unwrap();
        assert_eq!(reason.map(Refusal::source_reason), case.reason.as_deref());
    }
}

#[test]
fn live_policy_and_malformed_preflight_are_effective() {
    let d = default_definition();
    let mut words = Vec::new();
    visit_content(&d, |v| words.push(v));
    assert_eq!(words, [6, 1]);
    let (tiles, zone, features) = shape_input(5);
    let changed = Definition {
        wall_piece_min: 5,
        ..d
    };
    assert_eq!(
        shape_gate(&changed, &tiles, &features, &zone).unwrap(),
        None
    );
    let p = MapProp {
        kind: 0,
        x: 11.0 * TILE + TILE / 2.0,
        y: 10.0 * TILE + TILE / 2.0,
        v: 0,
    };
    let mut props = vec![p.clone()];
    clear_loot_decor(&d, &[], &[10 * W + 10], &[], &mut props).unwrap();
    assert!(props.is_empty());
    props.push(p.clone());
    clear_loot_decor(
        &Definition {
            loot_margin: 0,
            ..d
        },
        &[],
        &[10 * W + 10],
        &[],
        &mut props,
    )
    .unwrap();
    assert_eq!(props.as_slice(), std::slice::from_ref(&p));
    for bad in [
        Definition {
            wall_piece_min: 0,
            ..d
        },
        Definition {
            loot_margin: i32::MAX,
            ..d
        },
    ] {
        assert_eq!(
            clear_loot_decor(&bad, &[], &[], &[], &mut props),
            Err(Error::Definition)
        );
        assert_eq!(props.as_slice(), std::slice::from_ref(&p));
    }
    assert_eq!(
        clear_loot_decor(&d, &[W * H], &[], &[], &mut props),
        Err(Error::Positions)
    );
    assert_eq!(props.as_slice(), std::slice::from_ref(&p));
    assert_eq!(
        clear_loot_decor(
            &d,
            &[],
            &[],
            &[WorldPt {
                x: f64::NAN,
                y: 0.0
            }],
            &mut props
        ),
        Err(Error::Positions)
    );
    assert_eq!(props, [p]);
    let mut terrain = vec![6; W * H];
    let before = terrain.clone();
    let mut invalid = tiles.clone();
    invalid[0] = 255;
    assert_eq!(
        clear_terrain(
            &crate::mapgen::terrain_gate::default_definition(),
            true,
            &invalid,
            &mut terrain,
            &mut props
        ),
        Err(Error::Codes)
    );
    assert_eq!(terrain, before);
}
