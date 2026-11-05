use super::*;
use serde_json::Value;
fn layer(v: &Value) -> Vec<u8> {
    if let Some(r) = v.get("rle") {
        let mut out = Vec::new();
        for p in r.as_array().unwrap() {
            out.extend(std::iter::repeat_n(
                p[0].as_u64().unwrap() as u8,
                p[1].as_u64().unwrap() as usize,
            ));
        }
        out
    } else {
        serde_json::from_value(v.clone()).unwrap()
    }
}
fn owners(v: &Value) -> Vec<u16> {
    if let Some(r) = v.get("rle") {
        let mut out = Vec::new();
        for p in r.as_array().unwrap() {
            out.extend(std::iter::repeat_n(
                p[0].as_u64().unwrap() as u16,
                p[1].as_u64().unwrap() as usize,
            ));
        }
        out
    } else {
        serde_json::from_value(v.clone()).unwrap()
    }
}
fn state(v: &Value) -> State {
    let mut keys: Vec<_> = v.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut expected = vec![
        "tiles",
        "terrain",
        "zone",
        "territoryGrid",
        "featureOwner",
        "features",
    ];
    if v.get("regionGrid").is_some() {
        expected.push("regionGrid");
    }
    expected.sort_unstable();
    assert_eq!(keys, expected);

    State {
        tiles: layer(&v["tiles"]),
        terrain: layer(&v["terrain"]),
        zone: layer(&v["zone"]),
        territory_grid: layer(&v["territoryGrid"]),
        region_grid: if v.get("regionGrid").is_some() {
            layer(&v["regionGrid"])
        } else {
            vec![0; N]
        },
        feature_owner: owners(&v["featureOwner"]),
        features: serde_json::from_value(v["features"].clone()).unwrap(),
    }
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireInput {
    styled: bool,
    order: Vec<Zone>,
    camps: Vec<CampSite>,
    clearing: Vec<usize>,
    pool: Vec<usize>,
    protect: Value,
    landmark_box: Value,
    buildings: Vec<TileRect>,
    #[serde(default)]
    before_nets: Value,
    #[serde(default)]
    crates_by_zone: Vec<Vec<usize>>,
    #[serde(default)]
    all_crates: Vec<usize>,
}
fn fixture() -> Value {
    serde_json::from_str(include_str!("../fixtures/map-repair.json")).unwrap()
}
// Borrow the actual terrain on-class definition rather than own another kind table.
fn terrain_on() -> Vec<u8> {
    crate::mapgen::terrain_gate::default_definition()
        .kinds
        .iter()
        .map(|t| t.tile.unwrap_or(TILE_FLOOR))
        .collect()
}
fn check_refusal(reason: Refusal, case: &Value, last: &Value) {
    if last["phase"] == "refused:repair" {
        assert!(
            case["failures"][reason.source_reason()]
                .as_u64()
                .unwrap_or(0)
                > 0,
            "wrong repair refusal {reason:?}"
        );
    } else {
        assert_eq!(
            last["phase"].as_str().unwrap(),
            format!("refused:{}", reason.source_reason())
        );
    }
}
#[test]
fn genuine_stage_snapshots_match_source() {
    let doc = fixture();
    assert_eq!(doc["format"], "rh-map-repair/1");
    assert_eq!(doc["node"], "v22.23.4");
    assert_eq!(doc["platform"], "linux");
    assert_eq!(doc["arch"], "x64");
    let cases = doc["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 40);
    let mut expected = vec![
        (0i64, 0u64, false, false),
        (1, 0, false, false),
        (17, 0, false, false),
        (17, 1, false, false),
        (176, 0, false, false),
        (1, 0, true, false),
        (1, 0, true, true),
        (-1, 0, false, false),
        (4294967297, 4294967296, false, false),
    ];
    for seed in 0..32 {
        if seed != 1 {
            expected.push((seed, 0, true, false));
        }
    }
    for (c, (seed, attempt, styled, decor)) in cases.iter().zip(expected) {
        assert_eq!(c["seed"].as_i64(), Some(seed));
        assert_eq!(c["attempt"].as_u64(), Some(attempt));
        assert_eq!(c["styled"].as_bool(), Some(styled));
        assert_eq!(c["decor"].as_bool(), Some(decor));
    }
    assert_eq!(doc["nullSearch"]["firstSeed"], 0);
    assert_eq!(doc["nullSearch"]["endSeedExclusive"], 32);
    assert_eq!(doc["nullSearch"]["mode"], "styled");
    assert_eq!(doc["nullSearch"]["nullFound"], false);

    let synthetic = doc["synthetic"].as_array().unwrap();
    assert_eq!(synthetic.len(), 22);
    let names: Vec<_> = synthetic
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "infill",
            "floorShare",
            "moving-camp-radius",
            "territory-tie",
            "stray-refusal",
            "protected-cross-zone",
            "rezone-low",
            "rezone-floor",
            "plain-rezone-terrain",
            "rezone-crate",
            "rezone-landmark",
            "rezone-pool",
            "nets-campCut",
            "nets-poolCut",
            "nets-buried",
            "nets-restore",
            "wall-stray",
            "wall-far",
            "fits-preference",
            "keep-landmark",
            "keep-crate",
            "zone-transfer-balance"
        ]
    );
    let operations = cases
        .iter()
        .chain(synthetic)
        .flat_map(|c| c["events"].as_array().unwrap())
        .filter(|e| e["phase"] == "territory-operation")
        .count();
    assert_eq!(operations, 110);
    let mut phase_counts = std::collections::BTreeMap::new();
    for e in cases
        .iter()
        .chain(synthetic)
        .flat_map(|c| c["events"].as_array().unwrap())
        .filter(|e| e["phase"] == "territory-operation")
    {
        *phase_counts
            .entry(e["operation"]["phase"].as_str().unwrap())
            .or_insert(0) += 1;
    }
    assert_eq!(
        phase_counts,
        std::collections::BTreeMap::from([
            ("assign", 30),
            ("note-infill", 11),
            ("note-rezone", 11),
            ("rezone", 14),
            ("stray", 18),
            ("wall-far", 1),
            ("wall-stray", 1),
            ("wall-sweep", 11),
            ("zone-balance", 12),
            ("zone-transfer", 1)
        ])
    );
    let balance = synthetic
        .iter()
        .find(|c| c["name"] == "zone-transfer-balance")
        .unwrap();
    let mut prior = layer(&balance["events"][0]["state"]["zone"]);
    let mut actual_balance_move = false;
    for event in balance["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["phase"] == "territory-operation")
    {
        let next = layer(&event["operation"]["zone"]);
        if event["operation"]["phase"] == "zone-balance" && next != prior {
            actual_balance_move = true;
        }
        prior = next;
    }
    assert!(actual_balance_move);

    let fixed = crate::mapgen::coliseum::fixed_layout();
    let on = terrain_on();
    let d = default_definition(&on);
    let zd = zones::default_definition();
    let cd = zones::camps::default_definition();
    let sd = crate::mapgen::spawns::default_definition();
    let mut nets_checked = 0;
    let mut post_checked = 0;
    let mut refusals = 0;
    for c in cases.iter().chain(synthetic) {
        if c.get("completeFinalOutputEquality").is_some() {
            assert_eq!(c["completeFinalOutputEquality"], true);
        }
        assert_eq!(
            c["finalIsNull"].as_bool().unwrap(),
            c["finalHash"].is_null()
        );
        let events = c["events"].as_array().unwrap();
        for (phase, exit) in [("nets-entry", "nets-exit"), ("post-entry", "post-exit")] {
            let Some(start) = events.iter().position(|e| e["phase"] == phase) else {
                continue;
            };
            let entry = &events[start];
            let last = events[start + 1..].iter().find(|e| {
                e["phase"] == exit || e["phase"].as_str().unwrap().starts_with("refused:")
            });
            let Some(last) = last else {
                panic!("stage without exit {c}")
            };
            assert_eq!(entry["draws"], last["draws"]);
            assert_eq!(entry["continuation"], last["continuation"]);
            let w: WireInput = serde_json::from_value(entry["extra"].clone()).unwrap();
            if phase == "post-entry" {
                assert_eq!(
                    w.all_crates,
                    w.crates_by_zone
                        .iter()
                        .flatten()
                        .copied()
                        .collect::<Vec<_>>()
                );
            }
            let protect = layer(&w.protect);
            let landmark = layer(&w.landmark_box);
            let empty = vec![vec![]; ZONES];
            let crates = if phase == "nets-entry" {
                &empty
            } else {
                &w.crates_by_zone
            };
            let input = Input {
                styled: w.styled,
                order: &w.order,
                camps: &w.camps,
                clearing: &w.clearing,
                pool: &w.pool,
                protect: &protect,
                landmark_box: &landmark,
                crates_by_zone: crates,
                buildings: &w.buildings,
            };
            let mut actual = state(&entry["state"]);
            let refused = if phase == "nets-entry" {
                nets_checked += 1;
                let result = safety_nets(&d, &fixed, &mut actual, &input).unwrap();
                match &result {
                    Ok(nets) => assert_eq!(nets.before_nets, layer(&last["extra"]["beforeNets"])),
                    Err(r) => check_refusal(*r, c, last),
                }
                result.is_err()
            } else {
                post_checked += 1;
                let nets = Nets {
                    before_nets: layer(&w.before_nets),
                };
                let mut trace = Vec::new();
                let result = post_repair_with_trace(
                    &d,
                    &SharedDefinitions {
                        zones: &zd,
                        camps: &cd,
                        spawns: &sd,
                    },
                    &fixed,
                    &mut actual,
                    &input,
                    &nets,
                    &mut trace,
                )
                .unwrap();
                let expected_trace: Vec<Trace> = events[start + 1..]
                    .iter()
                    .take_while(|e| {
                        e["phase"] != exit && !e["phase"].as_str().unwrap().starts_with("refused:")
                    })
                    .filter(|e| e["phase"] == "territory-operation")
                    .map(|e| {
                        let o = &e["operation"];
                        Trace {
                            phase: o["phase"].as_str().unwrap().to_owned(),
                            round: o["round"].as_u64().unwrap() as usize,
                            target: o["target"].as_u64().unwrap() as usize,
                            rezoned: o["rezoned"].as_u64().unwrap() as usize,
                            cells: serde_json::from_value(o["cells"].clone()).unwrap(),
                            tiles: layer(&o["tiles"]),
                            zone: layer(&o["zone"]),
                            territory_grid: layer(&o["territoryGrid"]),
                        }
                    })
                    .collect();
                assert_eq!(
                    trace, expected_trace,
                    "operation trace seed {} synthetic {}",
                    c["seed"], c["name"]
                );
                if let Ok(result) = &result {
                    assert_eq!(
                        result.infill_tiles,
                        expected_trace
                            .iter()
                            .filter(|e| e.phase == "note-infill")
                            .map(|e| e.cells.len())
                            .sum::<usize>()
                    );
                    assert_eq!(
                        result.rezoned as u64,
                        last["extra"]["rezoned"].as_u64().unwrap()
                    );
                    assert_eq!(
                        result.reach2,
                        serde_json::from_value::<Vec<i32>>(last["extra"]["reach2"].clone())
                            .unwrap()
                    );
                }
                if let Err(r) = result {
                    check_refusal(r, c, last);
                }
                result.is_err()
            };
            let is_refused = last["phase"] != exit;
            assert_eq!(refused, is_refused, "{} {c}", phase);
            refusals += usize::from(refused);
            let expected = state(&last["state"]);
            assert_eq!(
                actual, expected,
                "{} seed {} attempt {}",
                phase, c["seed"], c["attempt"]
            );
        }
    }
    assert_eq!(
        (nets_checked, post_checked, refusals),
        (44, 60, 12),
        "truncated stage inventory"
    );
}
#[test]
fn content_visitor_uses_live_rules() {
    let on = terrain_on();
    let d = default_definition(&on);
    let mut words = Vec::new();
    visit_content(&d, |w| words.push(w));
    assert_eq!(words.len(), 7 + on.len());
    assert_eq!(words[0], 1.15f64.to_bits());
    let mut changed = d;
    changed.floor_share_max = 1.2;
    let mut other = Vec::new();
    visit_content(&changed, |w| other.push(w));
    assert_ne!(words, other);
}
struct OwnedInput {
    w: WireInput,
    protect: Vec<u8>,
    landmark: Vec<u8>,
}
impl OwnedInput {
    fn input(&self) -> Input<'_> {
        Input {
            styled: self.w.styled,
            order: &self.w.order,
            camps: &self.w.camps,
            clearing: &self.w.clearing,
            pool: &self.w.pool,
            protect: &self.protect,
            landmark_box: &self.landmark,
            crates_by_zone: &self.w.crates_by_zone,
            buildings: &self.w.buildings,
        }
    }
}
fn source_post(name: Option<&str>) -> (State, OwnedInput, Nets) {
    let doc = fixture();
    let c = if let Some(name) = name {
        doc["synthetic"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .unwrap()
    } else {
        &doc["cases"][1]
    };
    let e = c["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["phase"] == "post-entry")
        .unwrap();
    let w: WireInput = serde_json::from_value(e["extra"].clone()).unwrap();
    let nets = Nets {
        before_nets: layer(&w.before_nets),
    };
    let protect = layer(&w.protect);
    let landmark = layer(&w.landmark_box);
    (
        state(&e["state"]),
        OwnedInput {
            w,
            protect,
            landmark,
        },
        nets,
    )
}
#[test]
fn malformed_inputs_refuse_without_panics_or_partial_writes() {
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let on = terrain_on();
    let d = default_definition(&on);
    let zd = zones::default_definition();
    let cd = zones::camps::default_definition();
    let sd = crate::mapgen::spawns::default_definition();
    let shared = SharedDefinitions {
        zones: &zd,
        camps: &cd,
        spawns: &sd,
    };
    for kind in 0..12 {
        let (mut s, mut own, nets) = source_post(None);
        match kind {
            0 => {
                s.tiles.pop();
            }
            1 => s.tiles[500] = 255,
            2 => s.terrain[500] = 255,
            3 => s.zone[500] = 255,
            4 => s.territory_grid[500] = 255,
            5 => s.feature_owner[500] = 65535,
            6 => own.w.camps[0].site = usize::MAX,
            7 => own.w.pool.push(usize::MAX),
            8 => own.w.order.clear(),
            9 => own.w.buildings.push(TileRect {
                x: i32::MAX,
                y: 10,
                w: i32::MAX,
                h: 10,
            }),
            10 => own.protect.clear(),
            _ => own.w.camps.clear(),
        };
        let before = s.clone();
        assert!(
            post_repair(&d, &shared, &fixed, &mut s, &own.input(), &nets).is_err(),
            "malformed kind {kind}"
        );
        assert_eq!(s, before);
    }
    for short in [false, true] {
        let (mut s, own, mut nets) = source_post(None);
        let before = s.clone();
        if short {
            nets.before_nets.pop();
        } else {
            nets.before_nets[500] = 255;
        }
        assert!(post_repair(&d, &shared, &fixed, &mut s, &own.input(), &nets).is_err());
        assert_eq!(s, before);
    }
    for field in 0..5 {
        let (mut s, own, nets) = source_post(Some("protected-cross-zone"));
        let before = s.clone();
        let mut changed = zd;
        match field {
            0 => changed.peel_ceiling = 0,
            1 => changed.peel_ceiling = 1_000_000,
            2 => changed.peel_ceiling = i32::MAX,
            3 => changed.peel_to_weight = i32::MAX,
            _ => changed.peel_bias = i32::MAX,
        };
        assert_eq!(
            post_repair(
                &d,
                &SharedDefinitions {
                    zones: &changed,
                    camps: &cd,
                    spawns: &sd
                },
                &fixed,
                &mut s,
                &own.input(),
                &nets
            ),
            Err(Error::Definition)
        );
        assert_eq!(s, before);
    }
    let (mut s, own, nets) = source_post(None);
    let before = s.clone();
    let mut invalid = zd;
    invalid.annulus_edge = usize::MAX;
    assert!(post_repair(
        &d,
        &SharedDefinitions {
            zones: &invalid,
            camps: &cd,
            spawns: &sd
        },
        &fixed,
        &mut s,
        &own.input(),
        &nets
    )
    .is_err());
    assert_eq!(s, before);
}
#[test]
fn camp_cut_preserves_unallocated_region_field() {
    let doc = fixture();
    let case = doc["synthetic"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "nets-campCut")
        .unwrap();
    let event = case["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["phase"] == "nets-entry")
        .unwrap();
    let mut w: WireInput = serde_json::from_value(event["extra"].clone()).unwrap();
    w.crates_by_zone = vec![vec![]; ZONES];
    let protect = layer(&w.protect);
    let landmark = layer(&w.landmark_box);
    let own = OwnedInput {
        w,
        protect,
        landmark,
    };
    let mut state = state(&event["state"]);
    state.region_grid.fill(5);
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let on = terrain_on();
    assert_eq!(
        safety_nets(&default_definition(&on), &fixed, &mut state, &own.input()).unwrap(),
        Err(Refusal::CampCut)
    );
    assert!(state.region_grid.iter().all(|&v| v == 5));
}
#[test]
fn shared_policy_words_change_actual_post_decisions() {
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let on = terrain_on();
    let d = default_definition(&on);
    let zd = zones::default_definition();
    let cd = zones::camps::default_definition();
    let sd = crate::mapgen::spawns::default_definition();
    for (field, expected) in [
        (0, Refusal::AreaPost),
        (1, Refusal::RingPost),
        (2, Refusal::SliverPost),
    ] {
        let (mut s, own, nets) = source_post(if field == 0 {
            None
        } else {
            Some("protected-cross-zone")
        });
        let mut changed = zd;
        match field {
            0 => changed.area_tolerance = -1,
            1 => changed.ring_contact_min = i32::MAX,
            _ => changed.sliver_max = -1,
        };
        let mut words = Vec::new();
        zones::visit_content(&zd, |w| words.push(w));
        let mut altered = Vec::new();
        zones::visit_content(&changed, |w| altered.push(w));
        assert_ne!(words, altered);
        assert_eq!(
            post_repair(
                &d,
                &SharedDefinitions {
                    zones: &changed,
                    camps: &cd,
                    spawns: &sd
                },
                &fixed,
                &mut s,
                &own.input(),
                &nets
            )
            .unwrap(),
            Err(expected)
        );
    }
    let (mut s, own, nets) = source_post(Some("floorShare"));
    assert_eq!(
        post_repair(
            &d,
            &SharedDefinitions {
                zones: &zd,
                camps: &cd,
                spawns: &sd
            },
            &fixed,
            &mut s,
            &own.input(),
            &nets
        )
        .unwrap(),
        Err(Refusal::FloorShare)
    );
    let (mut s, own, nets) = source_post(Some("floorShare"));
    let mut relaxed = d;
    relaxed.floor_share_max = 1000.0;
    assert_ne!(
        post_repair(
            &relaxed,
            &SharedDefinitions {
                zones: &zd,
                camps: &cd,
                spawns: &sd
            },
            &fixed,
            &mut s,
            &own.input(),
            &nets
        )
        .unwrap(),
        Err(Refusal::FloorShare)
    );
    let (mut s, own, nets) = source_post(Some("protected-cross-zone"));
    let mut changed = sd;
    changed.pool_zones = 6;
    let mut words = Vec::new();
    crate::mapgen::spawns::visit_content(&sd, |w| words.push(w));
    let mut altered = Vec::new();
    crate::mapgen::spawns::visit_content(&changed, |w| altered.push(w));
    assert_ne!(words, altered);
    assert_eq!(
        post_repair(
            &d,
            &SharedDefinitions {
                zones: &zd,
                camps: &cd,
                spawns: &changed
            },
            &fixed,
            &mut s,
            &own.input(),
            &nets
        )
        .unwrap(),
        Err(Refusal::RezonePool)
    );
    let (mut s, own, nets) = source_post(Some("moving-camp-radius"));
    let mut camps_changed = cd;
    camps_changed.territory_radius_max = 10000.0;
    let mut old_words = Vec::new();
    zones::camps::visit_content(&cd, |w| old_words.push(w));
    let mut new_words = Vec::new();
    zones::camps::visit_content(&camps_changed, |w| new_words.push(w));
    assert_ne!(old_words, new_words);
    assert!(post_repair(
        &d,
        &SharedDefinitions {
            zones: &zd,
            camps: &camps_changed,
            spawns: &sd
        },
        &fixed,
        &mut s,
        &own.input(),
        &nets
    )
    .unwrap()
    .is_ok());
    let (mut s, own, nets) = source_post(Some("rezone-floor"));
    let mut changed_on = on.clone();
    changed_on[4] = TILE_LOW;
    let changed = default_definition(&changed_on);
    let mut old_words = Vec::new();
    visit_content(&d, |w| old_words.push(w));
    let mut new_words = Vec::new();
    visit_content(&changed, |w| new_words.push(w));
    assert_ne!(old_words, new_words);
    assert_eq!(
        post_repair(
            &changed,
            &SharedDefinitions {
                zones: &zd,
                camps: &cd,
                spawns: &sd
            },
            &fixed,
            &mut s,
            &own.input(),
            &nets
        )
        .unwrap(),
        Err(Refusal::RezoneLow)
    );
}
