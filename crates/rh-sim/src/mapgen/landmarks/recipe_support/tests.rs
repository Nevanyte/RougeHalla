use super::super::runtime::{CampInfo, FloatTilePoint, Stage4State, ZoneGeometry};
use super::*;
use crate::map::TILE_WALL;
use crate::mapdata::Zone;
use crate::mapgen::coliseum::DEFAULT_DEFINITION as FIXED_DEFINITION;
use serde_json::Value;
fn fixture() -> Value {
    serde_json::from_str(include_str!("../../fixtures/landmark-support.json")).unwrap()
}
fn f(v: &Value) -> f64 {
    v.as_f64().unwrap()
}
fn bits(v: &Value) -> u64 {
    u64::from_str_radix(v.as_str().unwrap(), 16).unwrap()
}
#[test]
fn actual_helper_bits_and_order() {
    let v = fixture();
    assert_eq!(v["node"], "v22.23.4");
    assert_eq!(v["platform"], "linux");
    assert_eq!(v["arch"], "x64");
    assert_eq!(v["schema"], 1);
    assert_eq!(
        default_definition(),
        serde_json::from_value::<RecipeSupportDefinition>(v["definitions"].clone()).unwrap()
    );
    let names = [
        "mapgen.ts",
        "styler.ts",
        "zoneStyle/hook.ts",
        "zoneStyle/styleZones.ts",
        "zoneStyle/context.ts",
        "zoneStyle/landmarks.ts",
        "zoneStyle/scorch.ts",
        "zoneStyle/gallows.ts",
        "zoneStyle/rime.ts",
        "zoneStyle/sanctum.ts",
        "zoneStyle/warren.ts",
        "zoneStyle/kit.ts",
        "zoneStyle/features.ts",
        "zoneStyle/scale.ts",
        "rng.ts",
        "coliseum.ts",
        "gridTopology.ts",
        "map.ts",
        "zoneStyle/types.ts",
    ];
    let sources = v["sources"].as_object().unwrap();
    assert_eq!(sources.len(), names.len());
    for name in names {
        assert_eq!(sources[name].as_str().unwrap().len(), 64);
    }
    assert_eq!(v["hashes"].as_array().unwrap().len(), 5);
    for c in v["hashes"].as_array().unwrap() {
        let a = &c["args"];
        assert_eq!(
            hash2(f(&a[0]), f(&a[1]), f(&a[2])).to_bits(),
            bits(&c["bits"])
        );
    }
    assert_eq!(v["noises"].as_array().unwrap().len(), 4);
    for c in v["noises"].as_array().unwrap() {
        let a = &c["args"];
        let n = Noise {
            stream_seed: f(&a[4]) as u32,
        };
        assert_eq!(
            n.value(f(&a[0]), f(&a[1]), f(&a[2]), f(&a[3])).to_bits(),
            bits(&c["valueBits"])
        );
        assert_eq!(
            vnoise(f(&a[0]), f(&a[1]), f(&a[2]), f(&a[3])).to_bits(),
            bits(&c["vnoiseBits"])
        );
        assert_eq!(
            n.noise_q(f(&a[0]), f(&a[1]), f(&a[2]), f(&a[3])),
            f(&c["q"])
        );
    }
    assert_eq!(v["rounds"].as_array().unwrap().len(), 9);
    for c in v["rounds"].as_array().unwrap() {
        assert_eq!(
            js_round(f64::from_bits(bits(&c["inputBits"]))).to_bits(),
            bits(&c["resultBits"])
        );
    }
    assert_eq!(serde_json::to_value(DIR16).unwrap(), v["dir16"]);
    for c in v["directionSeparations"].as_array().unwrap() {
        assert_eq!(
            dir_sep16(
                c["a"].as_i64().unwrap() as i32,
                c["b"].as_i64().unwrap() as i32
            ),
            c["result"].as_i64().unwrap() as i32
        );
    }
    for c in v["squareRoots"].as_array().unwrap() {
        assert_eq!(isqrt(f(&c["n"])), f(&c["result"]));
    }
    assert_eq!(v["fields"].as_array().unwrap().len(), 4);
    for c in v["fields"].as_array().unwrap() {
        let field: Vec<i32> = serde_json::from_value(c["field"].clone()).unwrap();
        let mask: Vec<u8> = serde_json::from_value(c["mask"].clone()).unwrap();
        assert_eq!(
            argmax_in(
                &field,
                &mask,
                c["from"].as_i64().unwrap() as isize,
                c["to"].as_i64().unwrap() as isize
            )
            .map_or(-1, |i| i as i64),
            c["result"].as_i64().unwrap()
        );
    }
    assert_eq!(v["graphs"].as_array().unwrap().len(), 5);
    for c in v["graphs"].as_array().unwrap() {
        let nodes: Vec<Node> = serde_json::from_value(c["nodes"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(gabriel_edges(&nodes)).unwrap(),
            c["edges"]
        );
    }
    for c in v["scales"].as_array().unwrap() {
        let p = c["painted"].as_u64().unwrap() as usize;
        assert_eq!(
            DEFAULT_DEFINITION.area_scale(p).to_bits(),
            bits(&c["areaBits"])
        );
        assert_eq!(
            DEFAULT_DEFINITION.len_scale(p).to_bits(),
            bits(&c["lenBits"])
        );
    }
}
#[test]
fn actual_camp_nodes_read_current_collision_and_preserve_original_indices() {
    let v = fixture();
    let cases = v["campCases"].as_array().unwrap();
    assert_eq!(cases.len(), 5);
    assert_eq!(
        cases
            .iter()
            .map(|c| c["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "door-tie",
            "current-collision-changed",
            "all-door-floor-removed",
            "non-generator-grid",
            "empty-mask"
        ]
    );
    for c in cases {
        let w = c["w"].as_u64().unwrap() as usize;
        let h = c["h"].as_u64().unwrap() as usize;
        let mut zones = vec![0; w * h];
        let mut tiles = vec![TILE_WALL; w * h];
        for i in c["maskIndices"].as_array().unwrap() {
            zones[i.as_u64().unwrap() as usize] = 1;
        }
        for i in c["floorIndices"].as_array().unwrap() {
            tiles[i.as_u64().unwrap() as usize] = TILE_FLOOR;
        }
        let mut g = ZoneGeometry::new(1, Zone::Fire, &zones, &tiles, w, h, &[]);
        g.camps = c["camps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| CampInfo {
                x: k["x"].as_i64().unwrap() as i32,
                y: k["y"].as_i64().unwrap() as i32,
                r: 0.0,
                territory: 0,
                elite: k["elite"].as_bool().unwrap(),
                index: k["index"].as_u64().unwrap() as usize,
            })
            .collect();
        g.info.centroid = FloatTilePoint {
            x: f(&c["zone"]["centroid"]["x"]),
            y: f(&c["zone"]["centroid"]["y"]),
        };
        g.info.bbox = serde_json::from_value(c["zone"]["bbox"].clone()).unwrap();
        let mut s = Stage4State::new(w, h, tiles, vec![], vec![0; w * h]);
        let hard = vec![0; w * h];
        let rt = LandmarkRuntime::new(
            &mut s,
            &g,
            &hard,
            None,
            &super::super::runtime::default_definition(),
        );
        let fp = c["distFp"].as_array().map(|pairs| {
            let mut fp = vec![0; w * h];
            for p in pairs {
                fp[p[0].as_u64().unwrap() as usize] = p[1].as_u64().unwrap() as u8;
            }
            fp
        });
        assert_eq!(
            camp_nodes(
                &rt,
                fp.as_deref(),
                FIXED_DEFINITION.ring_road,
                &DEFAULT_DEFINITION
            ),
            serde_json::from_value::<Vec<Node>>(c["result"].clone()).unwrap()
        );
        assert_eq!(
            camp_nodes(
                &rt,
                Some(&[255]),
                FIXED_DEFINITION.ring_road,
                &DEFAULT_DEFINITION
            ),
            camp_nodes(&rt, None, FIXED_DEFINITION.ring_road, &DEFAULT_DEFINITION)
        );
    }
}
#[test]
fn actual_context_seeds_zero_draw_continuation_and_independence() {
    let v = fixture();
    let cases = v["realCases"].as_array().unwrap();
    assert_eq!(cases.len(), 7);
    let contexts = v["contexts"].as_array().unwrap();
    assert_eq!(contexts.len(), 35);
    let main = Mulberry32::new(19);
    let before = main.clone();
    let mut factions = std::collections::BTreeSet::new();
    for c in contexts {
        let streams = RecipeStreams::new(
            c["seed"].as_i64().unwrap(),
            c["attempt"].as_u64().unwrap(),
            c["index"].as_u64().unwrap() as u8,
            &DEFAULT_DEFINITION,
        )
        .unwrap();
        assert_eq!(
            streams.landmark_seed as u64,
            c["landmarkSeed"].as_u64().unwrap()
        );
        assert_eq!(streams.noise_seed as u64, c["noiseSeed"].as_u64().unwrap());
        assert_eq!(c["draws"], 0);
        let mut r = streams.rng();
        for b in c["continuation"].as_array().unwrap() {
            assert_eq!(r.next_f64().to_bits(), bits(b));
        }
        assert_eq!(
            streams.noise().value(-3.25, 7.5, 7.0, 99.0).to_bits(),
            bits(&c["noiseBits"])
        );
        factions.insert(c["faction"].as_str().unwrap());
    }
    assert_eq!(
        factions,
        ["fire", "frost", "holy", "plague", "sentenced"]
            .into_iter()
            .collect()
    );
    assert_eq!(main, before);
    for (i, c) in cases.iter().enumerate() {
        assert_eq!(c["completeFinalOutputEquality"], true);
        assert_eq!(c["contextRange"], serde_json::json!([i * 5, (i + 1) * 5]));
        assert_eq!(c["styledObserverControl"], i == 6);
    }
}
#[test]
fn every_definition_field_changes_live_behavior_and_content_words() {
    let d = DEFAULT_DEFINITION;
    let words = |d: &RecipeSupportDefinition| {
        let mut out = Vec::new();
        visit_content(d, |w| out.push(w));
        out
    };
    let before = words(&d);
    assert_eq!(before.len(), 6);
    let mut d2 = d;
    d2.ref_zone_tiles *= 2.0;
    assert_ne!(d.area_scale(1710), d2.area_scale(1710));
    assert_ne!(d.len_scale(1710), d2.len_scale(1710));
    assert_ne!(before, words(&d2));
    d2 = d;
    d2.landmarks_per_zone = 1;
    assert_ne!(d.landmark_limit(5000), d2.landmark_limit(5000));
    assert_ne!(before, words(&d2));
    for noise in [false, true] {
        d2 = d;
        if noise {
            d2.noise_stream_offset += 1;
        } else {
            d2.landmark_stream += 1;
        }
        assert_ne!(
            RecipeStreams::new(-1, 4294967296, 1, &d),
            RecipeStreams::new(-1, 4294967296, 1, &d2)
        );
        assert_ne!(before, words(&d2));
    }
    // Door policy is tested through the live helper, using a minimal real runtime.
    let w = 3;
    let tiles = vec![TILE_FLOOR; 9];
    let g = ZoneGeometry::new(1, Zone::Fire, &[1; 9], &tiles, w, w, &[]);
    let mut s = Stage4State::new(w, w, tiles, vec![], vec![0; 9]);
    let rt = LandmarkRuntime::new(
        &mut s,
        &g,
        &[0; 9],
        None,
        &super::super::runtime::default_definition(),
    );
    for min in [false, true] {
        d2 = d;
        let distance = if min {
            d2.door_min_offset += 1;
            FIXED_DEFINITION.ring_road + d.door_min_offset + 1
        } else {
            d2.door_max_offset -= 1;
            FIXED_DEFINITION.ring_road + d.door_max_offset
        };
        let fp = [distance; 9];
        assert_ne!(
            camp_nodes(&rt, Some(&fp), FIXED_DEFINITION.ring_road, &d),
            camp_nodes(&rt, Some(&fp), FIXED_DEFINITION.ring_road, &d2)
        );
        assert_ne!(before, words(&d2));
    }
}

#[test]
fn typed_metadata_reuses_attempt_admission() {
    use crate::mapgen::attempt::AttemptInputError;
    assert_eq!(
        RecipeStreams::new(i64::MAX, 0, 1, &DEFAULT_DEFINITION),
        Err(AttemptInputError::SeedNotSafeInteger)
    );
    assert_eq!(
        RecipeStreams::new(0, u64::MAX, 1, &DEFAULT_DEFINITION),
        Err(AttemptInputError::AttemptNotSafeInteger)
    );
    assert!(
        RecipeStreams::new(-9007199254740991, 9007199254740991, 1, &DEFAULT_DEFINITION).is_ok()
    );
    let mut words = [0; 6];
    let mut at = 0;
    visit_content(&DEFAULT_DEFINITION, |w| {
        words[at] = w;
        at += 1;
    });
    assert_eq!(at, words.len());
}

#[test]
fn recipe_inputs_borrows_corresponding_fixed_rules_at_door_boundary() {
    use crate::mapgen::coliseum::{fixed_layout_from, H, W};
    let original_rules = crate::mapgen::coliseum::default_definition();
    let original_fixed = fixed_layout_from(&original_rules);
    let mut changed_rules = original_rules;
    changed_rules.ring_road += 1;
    let changed_fixed = fixed_layout_from(&changed_rules);
    let low = original_rules.ring_road + DEFAULT_DEFINITION.door_min_offset + 1;
    let a = original_fixed
        .dist_fp
        .iter()
        .position(|&d| d == low)
        .unwrap();
    let b = original_fixed
        .dist_fp
        .iter()
        .position(|&d| d == low + 1)
        .unwrap();
    assert_eq!(original_fixed.dist_fp, changed_fixed.dist_fp);
    let mut zone = vec![0; W * H];
    zone[a] = 1;
    zone[b] = 1;
    let mut tiles = vec![TILE_WALL; W * H];
    tiles[a] = TILE_FLOOR;
    tiles[b] = TILE_FLOOR;
    let mut g = ZoneGeometry::new(1, Zone::Fire, &zone, &tiles, W, H, &[]);
    g.info.centroid = FloatTilePoint {
        x: (a % W) as f64 + 0.5,
        y: (a / W) as f64 + 0.5,
    };
    let mut s = Stage4State::new(W, H, tiles, vec![], vec![0; W * H]);
    let hard = vec![0; W * H];
    let rt = LandmarkRuntime::new(
        &mut s,
        &g,
        &hard,
        None,
        &super::super::runtime::default_definition(),
    );
    let original =
        RecipeInputs::new(1, 0, &original_fixed, &original_rules, &DEFAULT_DEFINITION).unwrap();
    let changed =
        RecipeInputs::new(1, 0, &changed_fixed, &changed_rules, &DEFAULT_DEFINITION).unwrap();
    assert!(std::ptr::eq(changed.fixed_rules, &changed_rules));
    let original_nodes = original.camp_nodes(&rt);
    let changed_nodes = changed.camp_nodes(&rt);
    let door = |i: usize| {
        vec![Node {
            x: (i % W) as f64,
            y: (i / W) as f64,
            kind: NodeKind::Door,
            camp: -1,
            elite: false,
        }]
    };
    assert_eq!(original_nodes, door(a));
    assert_eq!(changed_nodes, door(b));
    assert_eq!(
        original_nodes,
        camp_nodes(
            &rt,
            Some(&original_fixed.dist_fp),
            original_rules.ring_road,
            &DEFAULT_DEFINITION
        )
    );
    assert_eq!(
        changed_nodes,
        camp_nodes(
            &rt,
            Some(&changed_fixed.dist_fp),
            changed_rules.ring_road,
            &DEFAULT_DEFINITION
        )
    );
    assert_eq!(original.streams(1), changed.streams(1));
    assert!(matches!(
        RecipeInputs::new(
            i64::MAX,
            0,
            &original_fixed,
            &original_rules,
            &DEFAULT_DEFINITION
        ),
        Err(crate::mapgen::attempt::AttemptInputError::SeedNotSafeInteger)
    ));
}

#[test]
fn complete_support_fixture_inventory() {
    let v = fixture();
    for (name, len) in [
        ("hashes", 5),
        ("noises", 4),
        ("rounds", 9),
        ("fields", 4),
        ("graphs", 5),
        ("campCases", 5),
        ("dir16", 16),
        ("directionSeparations", 4),
        ("squareRoots", 8),
        ("scales", 6),
        ("realCases", 7),
        ("contexts", 35),
    ] {
        assert_eq!(v[name].as_array().unwrap().len(), len, "{name}");
    }
    let cases = v["realCases"].as_array().unwrap();
    let contexts = v["contexts"].as_array().unwrap();
    let expected = [
        (1, 0),
        (-1, 0),
        (4294967297, 4294967296),
        (176, 0),
        (54, 0),
        (17, 1),
        (1, 0),
    ];
    for (i, (c, (seed, attempt))) in cases.iter().zip(expected).enumerate() {
        assert_eq!(c["seed"].as_i64(), Some(seed));
        assert_eq!(c["attempt"].as_u64(), Some(attempt));
        assert_eq!(c["completeFinalOutputEquality"], true);
        assert_eq!(c["styledObserverControl"], i == 6);
        assert_eq!(
            c["options"],
            if i == 6 {
                serde_json::json!({"decor": false})
            } else {
                serde_json::json!({"decor": false, "styleZones": null})
            }
        );
        let hash = c["finalHash"].as_str().unwrap();
        assert_eq!(hash.len(), 8);
        assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(c["contextRange"], serde_json::json!([i * 5, (i + 1) * 5]));
        let mut factions = std::collections::BTreeSet::new();
        for (zone, ctx) in contexts[i * 5..(i + 1) * 5].iter().enumerate() {
            assert_eq!(ctx["seed"], c["seed"]);
            assert_eq!(ctx["attempt"], c["attempt"]);
            assert_eq!(ctx["index"].as_u64(), Some((zone + 1) as u64));
            assert_eq!(ctx["draws"], 0);
            assert_eq!(ctx["continuation"].as_array().unwrap().len(), 3);
            factions.insert(ctx["faction"].as_str().unwrap());
        }
        assert_eq!(
            factions,
            ["fire", "frost", "holy", "plague", "sentenced"]
                .into_iter()
                .collect()
        );
    }
}

#[test]
fn source_distance_and_landmark_limit_boundaries() {
    let v = fixture();
    let scalars = &v["scalarBoundaries"];
    assert_eq!(
        scalars["distances"]["provenance"],
        serde_json::json!({"kind":"actual-exported-helper","source":"zoneStyle/features.ts","export":"dist2"})
    );
    assert_eq!(
        scalars["landmarkLimits"]["provenance"],
        serde_json::json!({"kind":"inline-source-count-expression-probe","source":"zoneStyle/gallows.ts","expression":"Math.min(LANDMARKS_PER_ZONE, Math.round(areaScale(c.zone.painted)))","scope":"Common count upper-limit expression only; no callback or recipe replay"})
    );
    let distances = scalars["distances"]["cases"].as_array().unwrap();
    assert_eq!(distances.len(), 3);
    let limits = scalars["landmarkLimits"]["cases"].as_array().unwrap();
    assert_eq!(limits.len(), 8);
    for c in distances {
        let a = &c["args"];
        assert_eq!(
            dist2(f(&a[0]), f(&a[1]), f(&a[2]), f(&a[3])).to_bits(),
            bits(&c["bits"])
        );
    }
    assert_eq!(
        limits
            .iter()
            .map(|c| c["painted"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        [0, 854, 855, 856, 2564, 2565, 2566, 4275]
    );
    for c in limits {
        assert_eq!(
            DEFAULT_DEFINITION
                .landmark_limit(c["painted"].as_u64().unwrap() as usize)
                .to_bits(),
            bits(&c["bits"])
        );
    }
}
