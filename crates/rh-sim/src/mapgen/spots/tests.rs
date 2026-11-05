use super::*;
use crate::rng::Mulberry32;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
fn fixture() -> Value {
    serde_json::from_str(include_str!("../fixtures/map-spots.json")).unwrap()
}
fn val<T: DeserializeOwned>(v: &Value) -> T {
    serde_json::from_value(v.clone()).unwrap()
}
fn run<T>(c: &Value, op: &Value, mut f: impl FnMut(&mut dyn FnMut() -> f64) -> T) -> T {
    let mut prefix = Mulberry32::new(val(&c["initialU32"]));
    for word in op["prefix"].as_array().unwrap() {
        assert_eq!(prefix.next_u32(), val::<u32>(word));
    }
    assert_eq!(
        serde_json::to_value(&prefix).unwrap()["state"],
        op["initialState"]
    );
    let mut rng = Mulberry32::new(val(&op["initialState"]));
    let mut words = Vec::new();
    let result = f(&mut || {
        let word = rng.next_u32();
        words.push(word);
        f64::from(word) / 4294967296.0
    });
    assert_eq!(serde_json::to_value(words).unwrap(), op["words"]);
    assert_eq!(serde_json::to_value(&rng).unwrap()["state"], op["endState"]);
    assert_eq!(op["continuation"].as_array().unwrap().len(), 8);
    assert!(!op["prefix"].as_array().unwrap().is_empty());
    for word in op["continuation"].as_array().unwrap() {
        assert_eq!(rng.next_u32(), val::<u32>(word));
    }
    result
}
#[test]
fn exact_actual_operations_and_rng_inventory() {
    let f = fixture();
    assert_eq!(f["format"], "rh-map-spots/1");
    assert_eq!(
        f["runtime"],
        json!({"node":"v22.23.4","platform":"linux","arch":"x64"})
    );
    assert_eq!(
        f["inventory"],
        json!({"cases":7,"camps":350,"crateZones":35,"ground":7,"units":7})
    );
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 7);
    let identities = [
        (1_i64, 0_i64, false, false, "b94d0723"),
        (-1, 0, false, false, "bf972bff"),
        (4294967297, 4294967296, false, false, "803a5416"),
        (17, 0, false, false, "bf9e6562"),
        (17, 1, false, false, "c4ae913e"),
        (1, 0, true, false, "d09b4fd9"),
        (1, 0, true, true, "d09b4fd9"),
    ];
    let draw_counts = [
        (1000, 277, 21222),
        (1000, 286, 21237),
        (1000, 271, 21217),
        (1000, 286, 21209),
        (1000, 282, 21192),
        (1000, 1191, 15579),
        (1000, 1191, 15579),
    ];
    let mut fixed = super::super::coliseum::fixed_layout();
    let zones = ZoneContext::new(&fixed);
    let d = default_definition();
    let mut terrain_on = vec![None; 256];
    for (kind, on) in f["terrainOn"].as_object().unwrap() {
        terrain_on[kind.parse::<usize>().unwrap()] = val(on);
    }
    let (mut camps_count, mut zones_count) = (0, 0);
    for ((c, id), draws) in cases.iter().zip(identities).zip(draw_counts) {
        assert_eq!(
            (
                val::<i64>(&c["seed"]),
                val::<i64>(&c["attempt"]),
                val::<bool>(&c["styled"]),
                val::<bool>(&c["decor"]),
                c["finalHash"].as_str().unwrap()
            ),
            id
        );
        assert_eq!(c["finalVerified"], true);
        assert_eq!(
            (
                c["camp"]["words"].as_array().unwrap().len(),
                c["crates"]["words"].as_array().unwrap().len(),
                c["ground"]["words"].as_array().unwrap().len()
            ),
            draws
        );
        let mut camps: Vec<CampSite> = val(&c["camp"]["input"]);
        assert_eq!(camps.len(), 50);
        let trace = run(c, &c["camp"], |mut rng| {
            camp_spots(&zones, &mut camps, &mut rng, &d).unwrap()
        });
        assert_eq!(serde_json::to_value(&trace).unwrap(), c["camp"]["traces"]);
        camps_count += trace.len();
    }
    // ZoneContext no longer borrows fixed while later phase-specific masks are installed.
    drop(zones);
    for c in cases {
        let op = &c["crates"];
        let i = &op["input"];
        fixed.ring = val(&i["ring"]);
        let tiles = val::<Vec<u8>>(&i["tiles"]);
        let terrain = val::<Vec<u8>>(&i["terrain"]);
        let zone = val::<Vec<u8>>(&i["zone"]);
        let owner = val::<Vec<u8>>(&i["featureOwner"]);
        let features = val::<Vec<MapFeature>>(&i["features"]);
        let pool = val::<Vec<usize>>(&i["pool"]);
        let camps = val::<Vec<CampSite>>(&i["camps"]);
        let out = run(c, op, |mut rng| {
            weapon_crates(
                CrateInput {
                    fixed: &fixed,
                    tiles: &tiles,
                    terrain: &terrain,
                    zone: &zone,
                    feature_owner: &owner,
                    features: &features,
                    pool: &pool,
                    camps: &camps,
                    styled: val(&i["styled"]),
                },
                &mut rng,
                &d,
            )
            .unwrap()
        });
        assert_eq!(out.refusal, None);
        assert_eq!(json!(out.refusal), op["refusal"]);
        assert_eq!(out.zones.len(), 5);
        zones_count += out.zones.len();
        assert_eq!(serde_json::to_value(&out.zones).unwrap(), op["zones"]);
        assert_eq!(
            serde_json::to_value(&out.door_near).unwrap(),
            op["doorNear"]
        );
        assert_eq!(
            serde_json::to_value(&out.nooks_by_zone).unwrap(),
            op["nooksByZone"]
        );
        assert_eq!(
            serde_json::to_value(&out.initial_no).unwrap(),
            op["initialNo"]
        );
        assert_eq!(serde_json::to_value(&out.crate_no).unwrap(), op["crateNo"]);
        let op = &c["ground"];
        let i = &op["input"];
        fixed.fp = val(&i["fp"]);
        let tiles = val::<Vec<u8>>(&i["tiles"]);
        let terrain = val::<Vec<u8>>(&i["terrain"]);
        let landmark_box = val::<Vec<u8>>(&i["landmarkBox"]);
        let clearing = val::<Vec<usize>>(&i["clearing"]);
        let crates = val::<Vec<usize>>(&i["allCrates"]);
        let pool = val::<Vec<usize>>(&i["pool"]);
        let out = run(c, op, |mut rng| {
            ground_spots(
                GroundInput {
                    fixed: &fixed,
                    tiles: &tiles,
                    terrain: &terrain,
                    terrain_on: &terrain_on,
                    landmark_box: &landmark_box,
                    clearing: &clearing,
                    crates: &crates,
                    pool: &pool,
                },
                &mut rng,
                &d,
            )
            .unwrap()
        });
        assert_eq!(out.refusal, None);
        assert_eq!(json!(out.refusal), op["refusal"]);
        for (key, got) in [
            ("noLoot", json!(out.no_loot)),
            ("nearSpawn", json!(out.near_spawn)),
            ("cands", json!(out.cands)),
            ("nooks", json!(out.nooks)),
            ("want", json!(out.want)),
            ("chosen", json!(out.chosen)),
        ] {
            let expected = if key == "cands" || key == "nooks" || key == "chosen" {
                json!(op[key]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| val::<usize>(&p["y"]) * W + val::<usize>(&p["x"]))
                    .collect::<Vec<_>>())
            } else {
                op[key].clone()
            };
            assert_eq!(got, expected, "{} ground {key}", c["seed"]);
        }
    }
    assert_eq!((camps_count, zones_count), (350, 35));
}
#[test]
fn explicit_synthetic_fallback_and_refusals_preserve_draws() {
    let f = fixture();
    let units = f["units"].as_array().unwrap();
    assert_eq!(units.len(), 7);
    let labels = [
        "explicit-empty-refusal",
        "explicit-scarce-open-nooks-spacing-fallback",
        "explicit-exact-90-open-threshold",
        "explicit-empty-crate-refusal",
        "explicit-open3-crate-fallback-cross-zone",
        "explicit-normal-internal-order-fallback",
        "explicit-elite-equal-distance-index-ties",
    ];
    let mut fixed = super::super::coliseum::fixed_layout();
    fixed.fp.fill(0);
    fixed.ring.fill(0);
    let d = default_definition();
    let draw_counts = [1, 88, 90, 1, 24336, 20, 20];
    let seeds = [7, 19, 21, 31, 31, 1, 43];
    for (((u, label), draw_count), seed) in units.iter().zip(labels).zip(draw_counts).zip(seeds) {
        assert_eq!(u["words"].as_array().unwrap().len(), draw_count);
        assert_eq!(u["seed"], seed);
        assert_eq!(u["continuation"].as_array().unwrap().len(), 8);
        assert_eq!(u["label"], label);
        let tiles: Vec<u8> = if u["kind"] == "camps" {
            Vec::new()
        } else {
            val(&u["tiles"])
        };
        let mut rng = Mulberry32::new(val(&u["seed"]));
        let mut words = Vec::new();
        if u["kind"] == "camps" {
            let zones = ZoneContext::new(&fixed);
            let mut camps: Vec<CampSite> = val(&u["input"]);
            let traces = camp_spots(
                &zones,
                &mut camps,
                &mut || {
                    let w = rng.next_u32();
                    words.push(w);
                    f64::from(w) / 4294967296.0
                },
                &d,
            )
            .unwrap();
            assert_eq!(json!(camps), u["result"]);
            let mut expected = u["traces"].clone();
            for e in expected.as_array_mut().unwrap() {
                e.as_object_mut().unwrap().remove("type");
            }
            assert_eq!(json!(traces), expected);
            assert_eq!(traces.len(), 1);
            if label == "explicit-normal-internal-order-fallback" {
                assert_eq!(u["seed"], 1);
                let mut primary = Vec::new();
                for &t in &traces[0].around {
                    if primary.len() >= traces[0].want {
                        break;
                    }
                    if primary.iter().all(|&o| cheb(o, t) >= d.camp_gap) {
                        primary.push(t)
                    }
                }
                assert_eq!(primary.len(), 4);
                assert_eq!(traces[0].spots.len(), 5);
            } else {
                assert_eq!(u["seed"], 43);
                assert!(traces[0]
                    .spots
                    .windows(2)
                    .any(|p| d2(p[0], camps[0].site) == d2(p[1], camps[0].site)));
            }
        } else if u["kind"] == "ground" {
            let skip = val::<Vec<u8>>(&u["skip"]);
            let pool: Vec<usize> = u["spawns"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| val::<usize>(&p["y"]) * W + val::<usize>(&p["x"]))
                .collect();
            let out = ground_spots(
                GroundInput {
                    fixed: &fixed,
                    tiles: &tiles,
                    terrain: &vec![0; N],
                    terrain_on: &[],
                    landmark_box: &skip,
                    clearing: &[],
                    crates: &[],
                    pool: &pool,
                },
                &mut || {
                    let w = rng.next_u32();
                    words.push(w);
                    f64::from(w) / 4294967296.0
                },
                &d,
            )
            .unwrap();
            for (key, got) in [
                ("nearSpawn", json!(out.near_spawn)),
                ("cands", json!(out.cands)),
                ("nooks", json!(out.nooks)),
                ("want", json!(out.want)),
                ("chosen", json!(out.chosen)),
            ] {
                let expected = if key == "cands" || key == "nooks" || key == "chosen" {
                    json!(u["trace"][key]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|p| val::<usize>(&p["y"]) * W + val::<usize>(&p["x"]))
                        .collect::<Vec<_>>())
                } else {
                    u["trace"][key].clone()
                };
                assert_eq!(got, expected, "{label} {key}");
            }
            let captured = u["result"].as_array().unwrap();
            let expected_count = match label {
                "explicit-empty-refusal" => 0,
                "explicit-scarce-open-nooks-spacing-fallback" => 30,
                "explicit-exact-90-open-threshold" => 41,
                _ => unreachable!(),
            };
            assert_eq!(captured.len(), expected_count);
            let captured_indices: Vec<usize> = captured
                .iter()
                .map(|p| val::<usize>(&p["y"]) * W + val::<usize>(&p["x"]))
                .collect();
            assert_eq!(out.chosen, captured_indices);
            assert_eq!(
                out.refusal,
                if captured.len() < 30 {
                    Some(Refusal::Ground)
                } else {
                    None
                }
            );
        } else {
            assert_eq!(u["kind"], "crates");
            let zone: Vec<u8> = val(&u["zone"]);
            let empty = vec![0; N];
            let out = weapon_crates(
                CrateInput {
                    fixed: &fixed,
                    tiles: &tiles,
                    terrain: &empty,
                    zone: &zone,
                    feature_owner: &empty,
                    features: &[],
                    pool: &[],
                    camps: &[],
                    styled: false,
                },
                &mut || {
                    let w = rng.next_u32();
                    words.push(w);
                    f64::from(w) / 4294967296.0
                },
                &d,
            )
            .unwrap();
            let events = u["traces"].as_array().unwrap();
            let mut expected_events = vec![
                json!({"type":"crateMasks","doorNear":out.door_near,"nooksByZone":out.nooks_by_zone,"initialNo":out.initial_no}),
            ];
            for (z, t) in out.zones.iter().enumerate() {
                expected_events.push(json!({"type":"crateZone","z":z+1,"nooks":t.nooks,"cands":t.cands,"want":t.want}));
                if let Some(open) = &t.open {
                    expected_events.push(json!({"type":"crateOpen","z":z+1,"open":open}));
                }
                expected_events.push(json!({"type":"crateChosen","z":z+1,"chosen":t.chosen,"refused":t.chosen.len()<d.crate_min}));
            }
            if out.refusal.is_none() {
                expected_events.push(json!({"type":"crateEnd","crateNo":out.crate_no}));
            }
            assert_eq!(
                events.len(),
                if label == "explicit-empty-crate-refusal" {
                    4
                } else {
                    17
                }
            );
            assert_eq!(&expected_events, events);
            if label == "explicit-empty-crate-refusal" {
                assert_eq!(out.refusal, Some(Refusal::Crates));
                assert_eq!(out.zones.len(), 1);
                assert!(u["result"].is_null());
            } else {
                assert_eq!(out.refusal, None);
                assert_eq!(
                    json!(out.zones.iter().map(|z| &z.chosen).collect::<Vec<_>>()),
                    u["result"]
                );
                assert!(out.zones.iter().all(|z| z.open.is_some()));
            }
        }
        assert_eq!(json!(words), u["words"]);
        for w in u["continuation"].as_array().unwrap() {
            assert_eq!(rng.next_u32(), val::<u32>(w));
        }
    }
}
#[test]
fn definition_inventory() {
    let mut v = Vec::new();
    visit_content(&default_definition(), |x| v.push(x));
    assert_eq!(
        v,
        vec![3, 5, 2, 4, 6, 2, 4, 2, 2, 1, 1, 90, 30, 45, 2, 1, 1, 4, 2, 1]
    );
}
#[test]
fn malformed_admission_draws_nothing() {
    let fixed = super::super::coliseum::fixed_layout();
    let zones = ZoneContext::new(&fixed);
    let d = default_definition();
    let mut calls = 0;
    let mut rng = || {
        calls += 1;
        0.5
    };
    assert_eq!(
        camp_spots(
            &zones,
            &mut [CampSite {
                zone: 1,
                site: N,
                elite: false,
                spots: vec![]
            }],
            &mut rng,
            &d
        ),
        Err(Error::Index)
    );
    let empty = vec![0; N];
    assert_eq!(
        weapon_crates(
            CrateInput {
                fixed: &fixed,
                tiles: &[],
                terrain: &empty,
                zone: &empty,
                feature_owner: &empty,
                features: &[],
                pool: &[],
                camps: &[],
                styled: false
            },
            &mut rng,
            &d
        ),
        Err(Error::Length)
    );
    assert_eq!(
        ground_spots(
            GroundInput {
                fixed: &fixed,
                tiles: &empty,
                terrain: &vec![1; N],
                terrain_on: &[],
                landmark_box: &empty,
                clearing: &[],
                crates: &[],
                pool: &[]
            },
            &mut rng,
            &d
        ),
        Err(Error::TerrainKind)
    );
    assert_eq!(calls, 0);
}
#[test]
fn definitions_drive_behavior_and_every_word() {
    let base = default_definition();
    let mut original = Vec::new();
    visit_content(&base, |w| original.push(w));
    macro_rules! changed {
        ($field:ident) => {{
            let mut d = base;
            d.$field += 1;
            let mut v = Vec::new();
            visit_content(&d, |w| v.push(w));
            assert_ne!(v, original, stringify!($field));
        }};
    }
    changed!(camp_min);
    changed!(camp_max);
    changed!(camp_gap);
    changed!(crate_min);
    changed!(crate_max);
    changed!(crate_gap);
    changed!(crate_first_gap);
    changed!(crate_pool_margin);
    changed!(crate_camp_margin);
    changed!(crate_spot_margin);
    changed!(door_margin);
    changed!(ground_open_min);
    changed!(ground_min);
    changed!(ground_max);
    changed!(ground_spawn_margin);
    changed!(ground_crate_margin);
    changed!(ground_hazard_margin);
    for i in 0..3 {
        let mut d = base;
        d.ground_gaps[i] += 1;
        let mut v = Vec::new();
        visit_content(&d, |w| v.push(w));
        assert_ne!(v, original);
    }
    let mut fixed = super::super::coliseum::fixed_layout();
    let zones = ZoneContext::new(&fixed);
    let mut camps = [CampSite {
        site: 80 * W + 80,
        zone: 1,
        elite: true,
        spots: vec![],
    }];
    let mut d = base;
    d.camp_min = 1;
    d.camp_max = 1;
    camp_spots(&zones, &mut camps, &mut || 0.5, &d).unwrap();
    assert_eq!(camps[0].spots.len(), 1);
    drop(zones);
    fixed.fp.fill(0);
    fixed.ring.fill(0);
    let tiles = vec![0; N];
    let zone = vec![1; N];
    let empty = vec![0; N];
    d = base;
    d.crate_min = 1;
    d.crate_max = 1;
    let out = weapon_crates(
        CrateInput {
            fixed: &fixed,
            tiles: &tiles,
            terrain: &empty,
            zone: &zone,
            feature_owner: &empty,
            features: &[],
            pool: &[],
            camps: &[],
            styled: false,
        },
        &mut || 0.5,
        &d,
    )
    .unwrap();
    assert_eq!(out.zones[0].chosen.len(), 1);
    assert_eq!(out.refusal, Some(Refusal::Crates));
    assert_eq!(out.zones.len(), 2);
    d = base;
    d.ground_min = 1;
    d.ground_max = 1;
    let out = ground_spots(
        GroundInput {
            fixed: &fixed,
            tiles: &tiles,
            terrain: &empty,
            terrain_on: &[],
            landmark_box: &empty,
            clearing: &[],
            crates: &[],
            pool: &[],
        },
        &mut || 0.5,
        &d,
    )
    .unwrap();
    assert_eq!(out.chosen.len(), 1);
    assert_eq!(out.refusal, None);
}

#[test]
fn malformed_crate_gap_is_refused_before_any_draw_or_camp_mutation() {
    let mut fixed = super::super::coliseum::fixed_layout();
    fixed.ring.fill(0);
    fixed.fp.fill(0);
    let zones = ZoneContext::new(&fixed);
    let empty = vec![0; N];
    let zone = vec![1; N];
    for gap in [0, W.min(H), N, usize::MAX] {
        let mut d = default_definition();
        d.crate_min = 1;
        d.crate_max = 1;
        d.crate_gap = gap;
        let original = vec![CampSite {
            zone: 1,
            site: 80 * W + 80,
            elite: false,
            spots: vec![17],
        }];
        let mut camps = original.clone();
        let mut calls = 0;
        let mut rng = || {
            calls += 1;
            0.5
        };
        assert_eq!(
            camp_spots(&zones, &mut camps, &mut rng, &d),
            Err(Error::Definition)
        );
        assert_eq!(camps, original);
        assert_eq!(
            weapon_crates(
                CrateInput {
                    fixed: &fixed,
                    tiles: &empty,
                    terrain: &empty,
                    zone: &zone,
                    feature_owner: &empty,
                    features: &[],
                    pool: &[],
                    camps: &[],
                    styled: false
                },
                &mut rng,
                &d
            ),
            Err(Error::Definition)
        );
        assert_eq!(
            ground_spots(
                GroundInput {
                    fixed: &fixed,
                    tiles: &empty,
                    terrain: &empty,
                    terrain_on: &[],
                    landmark_box: &empty,
                    clearing: &[],
                    crates: &[],
                    pool: &[]
                },
                &mut rng,
                &d
            ),
            Err(Error::Definition)
        );
        assert_eq!(calls, 0, "gap {gap}");
    }
    let mut d = default_definition();
    d.crate_gap = W.min(H) - 1;
    assert_eq!(check(&d), Ok(()));
}
