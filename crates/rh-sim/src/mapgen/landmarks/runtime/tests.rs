use super::*;
use serde_json::Value;
fn fixture() -> Value {
    serde_json::from_str(include_str!("../../fixtures/landmark-runtime.json")).unwrap()
}
fn decode<T: TryFrom<i64>>(v: &Value) -> Vec<T>
where
    T::Error: std::fmt::Debug,
{
    v.as_array()
        .unwrap()
        .iter()
        .flat_map(|r| std::iter::repeat_n(r[0].as_i64().unwrap(), r[1].as_u64().unwrap() as usize))
        .map(|n| T::try_from(n).unwrap())
        .collect()
}
fn snapshot(rt: &LandmarkRuntime<'_>, s: &Value) {
    let state = rt.state();
    assert_eq!(state.tiles, decode::<u8>(&s["tiles"]));
    assert_eq!(state.terrain, decode::<u8>(&s["terrain"]));
    assert_eq!(state.feature_owner, decode::<u16>(&s["featureOwner"]));
    assert_eq!(state.wrote, decode::<u8>(&s["wrote"]));
    assert_eq!(rt.reserved(), decode::<u8>(&s["reserved"]));
    assert_eq!(
        state.features,
        serde_json::from_value::<Vec<MapFeature>>(s["features"].clone()).unwrap()
    );
    assert_eq!(state.scratch.mark, decode::<i32>(&s["mark"]));
    assert_eq!(state.scratch.qa, decode::<i32>(&s["qa"]));
    assert_eq!(state.scratch.qb, decode::<i32>(&s["qb"]));
    assert_eq!(state.scratch.epoch, s["epoch"].as_i64().unwrap());
    assert_eq!(
        rt.counters(),
        serde_json::from_value::<Counters>(s["counters"].clone()).unwrap()
    );
    assert_eq!(
        (0..state.tiles.len())
            .map(|i| u8::from(rt.open(i as i32)))
            .collect::<Vec<_>>(),
        decode::<u8>(&s["open"])
    );
}
fn command(rt: &mut LandmarkRuntime<'_>, c: &Value) {
    match c["type"].as_str().unwrap() {
        "place" => {
            let spec = serde_json::from_value::<LandmarkSpec>(c["spec"].clone()).unwrap();
            let result = rt.place_whole(&spec);
            assert_eq!(
                result,
                serde_json::from_value::<Option<PlacedFeature>>(c["result"].clone()).unwrap()
            );
        }
        "reserve" => {
            rt.reserve(c["tile"].as_i64().unwrap() as i32);
        }
        "probe" => assert_eq!(
            rt.can_block_wall(c["tile"].as_i64().unwrap() as i32),
            c["result"].as_bool().unwrap()
        ),
        _ => panic!("unknown command"),
    }
    snapshot(rt, &c["snapshot"]);
}
fn assert_info(actual: &ZoneInfo, expected: &Value) {
    let expected: ZoneInfo = serde_json::from_value(expected.clone()).unwrap();
    assert_eq!(*actual, expected);
    for (a, b) in [
        (actual.centroid.x, expected.centroid.x),
        (actual.centroid.y, expected.centroid.y),
        (actual.axis.x, expected.axis.x),
        (actual.axis.y, expected.axis.y),
    ] {
        assert_eq!(a.to_bits(), b.to_bits());
    }
}
#[test]
fn real_stage4_every_command_full_state_and_prefix() {
    let f = fixture();
    assert_eq!(f["format"], "rh-landmark-runtime/1");
    assert_eq!(f["node"], "v22.23.4");
    assert_eq!(f["platform"], "linux");
    assert_eq!(f["arch"], "x64");
    assert_eq!(f["observationOnlyFinalEqualityVerified"], true);
    assert_eq!(f["noSpeculativeStatefulCalls"], true);
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let prefix = crate::mapgen::attempt::AttemptContext::new(&fixed);
    let spawns = crate::mapgen::spawns::SpawnContext::new(&fixed);
    assert_eq!(f["cases"].as_array().unwrap().len(), 3);
    for case in f["cases"].as_array().unwrap() {
        assert_eq!(case["finalVerified"], true);
        let input = &case["input"];
        let w = input["w"].as_u64().unwrap() as usize;
        let h = input["h"].as_u64().unwrap() as usize;
        let zone: Vec<u8> = serde_json::from_value(input["zone"].clone()).unwrap();
        let territory: Vec<u8> = serde_json::from_value(input["territoryGrid"].clone()).unwrap();
        let hard: Vec<u8> = serde_json::from_value(input["protect"].clone()).unwrap();
        let order: Vec<Zone> = serde_json::from_value(input["zoneFaction"].clone()).unwrap();
        let frame = crate::mapgen::attempt::begin_attempt(
            &prefix,
            input["seed"].as_i64().unwrap(),
            input["attempt"].as_u64().unwrap(),
        )
        .unwrap()
        .unwrap();
        let tiles: Vec<u8> = serde_json::from_value(input["tiles"].clone()).unwrap();
        assert_eq!(frame.state.tiles, tiles);
        assert_eq!(frame.state.partition.zone, zone);
        assert_eq!(frame.state.layout.territory_grid, territory);
        assert_eq!(spawns.landmark_protect(&frame.state.layout.camps), hard);
        assert_eq!(
            frame
                .state
                .order
                .iter()
                .map(|f| f.as_str())
                .collect::<Vec<_>>(),
            order.iter().map(|z| z.as_str()).collect::<Vec<_>>()
        );
        for (camp, expected) in frame
            .state
            .style_camps
            .iter()
            .zip(input["camps"].as_array().unwrap())
        {
            assert_eq!(camp.site, expected["site"].as_u64().unwrap() as usize);
            assert_eq!(camp.r.to_bits(), expected["r"].as_f64().unwrap().to_bits());
            assert_eq!(u64::from(camp.territory), expected["territory"]);
            assert_eq!(camp.elite, expected["elite"].as_bool().unwrap());
        }
        let mut state = Stage4State::new(
            w,
            h,
            tiles,
            serde_json::from_value(input["features"].clone()).unwrap(),
            serde_json::from_value(input["featureOwner"].clone()).unwrap(),
        );
        let rules: LandmarkDefinition = serde_json::from_value(case["definition"].clone()).unwrap();
        let commands = case["commands"].as_array().unwrap();
        let mut cursor = 0;
        while cursor < commands.len() {
            let begin = &commands[cursor];
            assert_eq!(begin["type"], "zone");
            let index = begin["index"].as_u64().unwrap() as u8;
            let geometry = ZoneGeometry::new(
                index,
                order[usize::from(index - 1)],
                &zone,
                &state.tiles,
                w,
                h,
                &frame.state.style_camps,
            );
            assert_info(&geometry.info, &begin["info"]);
            assert_eq!(geometry.mask, decode::<u8>(&begin["mask"]));
            assert_eq!(geometry.edge_dist, decode::<i32>(&begin["edgeDist"]));
            assert_eq!(
                geometry.camps,
                serde_json::from_value::<Vec<CampInfo>>(begin["camps"].clone()).unwrap()
            );
            let mut rt =
                LandmarkRuntime::new(&mut state, &geometry, &hard, Some(&territory), &rules);
            snapshot(&rt, &begin["snapshot"]);
            cursor += 1;
            while cursor < commands.len() && commands[cursor]["type"] != "zone" {
                command(&mut rt, &commands[cursor]);
                cursor += 1;
            }
        }
    }
}
fn replay_unit(unit: &Value) -> Vec<Option<PlacedFeature>> {
    let w = unit["w"].as_u64().unwrap() as usize;
    let h = unit["h"].as_u64().unwrap() as usize;
    let tiles = decode::<u8>(&unit["tiles"]);
    let zone: Vec<u8> = serde_json::from_value(unit["zone"].clone()).unwrap();
    let hard: Vec<u8> = serde_json::from_value(unit["hard"].clone()).unwrap();
    let territory: Option<Vec<u8>> = serde_json::from_value(unit["territory"].clone()).unwrap();
    let faction: Zone = serde_json::from_value(unit["faction"].clone()).unwrap();
    let rules: LandmarkDefinition = serde_json::from_value(unit["definition"].clone()).unwrap();
    let geometry = ZoneGeometry::new(
        unit["index"].as_u64().unwrap() as u8,
        faction,
        &zone,
        &tiles,
        w,
        h,
        &[],
    );
    assert_info(&geometry.info, &unit["info"]);
    let mut state = Stage4State::new(w, h, tiles, vec![], vec![0; w * h]);
    let mut rt = LandmarkRuntime::new(&mut state, &geometry, &hard, territory.as_deref(), &rules);
    let mut results = Vec::new();
    for c in unit["commands"].as_array().unwrap() {
        command(&mut rt, c);
        if c["type"] == "place" {
            results.push(serde_json::from_value(c["result"].clone()).unwrap());
        }
    }
    results
}
#[test]
fn actual_requests_reduced_budget_and_direct_boundaries() {
    let f = fixture();
    let units = f["units"].as_array().unwrap();
    assert_eq!(units.len(), 9);
    for u in units {
        replay_unit(u);
    }
    assert_eq!(replay_unit(&units[0]), vec![None, None]);
    assert!(replay_unit(&units[1])[0].is_some());
    assert!(replay_unit(&units[6])[0].is_some());
    assert_eq!(replay_unit(&units[7]), vec![None]);
    let rim = replay_unit(&units[8]);
    assert_eq!(rim[0], None);
    assert!(rim[1].is_some());
    assert_eq!(
        units[0]["commands"][0]["snapshot"]["counters"]["joinUsed"],
        2
    );
    assert_eq!(units[0]["commands"][0]["snapshot"]["counters"]["walls"], 0);
}
#[test]
fn definition_visitor_covers_rules_and_invalid_stage_rejected() {
    let d = default_definition();
    let mut words = Vec::new();
    visit_content(&d, |w| words.push(w));
    assert_eq!(words.len(), 3);
    for i in 0..3 {
        let mut m = d;
        match i {
            0 => m.join_checks += 1,
            1 => m.footprint_percent += 1.0,
            _ => m.rim_tiles += 1.0,
        }
        let mut changed = Vec::new();
        visit_content(&m, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1
        );
        assert_ne!(changed[i], words[i]);
    }
    assert!(std::panic::catch_unwind(|| Stage4State::new(1, 1, vec![2], vec![], vec![0])).is_err());
    let mut state = Stage4State::new(3, 3, vec![0; 9], vec![], vec![0; 9]);
    state.terrain[0] = 1;
    let geometry = ZoneGeometry::new(1, Zone::Fire, &[1; 9], &state.tiles, 3, 3, &[]);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        LandmarkRuntime::new(&mut state, &geometry, &[0; 9], None, &d);
    }))
    .is_err());
    assert!(serde_json::from_value::<LandmarkSpec>(serde_json::json!({"variant":"","jobs":[],"anchor":[0,0],"params":null,"blocks":[],"floor":null,"mode":"trim"})).is_err());
}
#[test]
fn chamfer_and_empty_zone_size_free_boundaries() {
    assert_eq!(chamfer(&[1], 1, 1), vec![3]);
    let g = ZoneGeometry::new(1, Zone::Fire, &[0; 6], &[0; 6], 2, 3, &[]);
    assert_eq!(g.info.painted, 0);
    assert_eq!(g.info.axis, FloatTilePoint { x: 1.0, y: 0.0 });
    assert_eq!(g.edge_dist, vec![0; 6]);
}

#[test]
fn malformed_terrain_shape_rejected_before_any_transaction_write() {
    let rules = LandmarkDefinition {
        join_checks: 128,
        footprint_percent: 100.0,
        rim_tiles: 0.0,
    };
    let spec = LandmarkSpec {
        variant: "shape-regression".into(),
        jobs: vec![FeatureJob::Landmark],
        anchor: [3, 3],
        params: None,
        blocks: vec![24],
        floor: None,
    };
    for terrain_len in [0, 48, 50] {
        let mut state = Stage4State::new(7, 7, vec![TILE_FLOOR; 49], vec![], vec![0; 49]);
        state.terrain.resize(terrain_len, 0);
        let geometry = ZoneGeometry::new(1, Zone::Fire, &[1; 49], &state.tiles, 7, 7, &[]);
        let before = state.clone();
        let mut constructed = false;
        let rejected = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut runtime = LandmarkRuntime::new(&mut state, &geometry, &[0; 49], None, &rules);
            constructed = true;
            runtime.place_whole(&spec);
        }));
        assert!(rejected.is_err(), "terrain length {terrain_len}");
        assert!(
            !constructed,
            "constructor admitted terrain length {terrain_len}"
        );
        assert_eq!(state, before, "rejected state was partially modified");
    }
}
