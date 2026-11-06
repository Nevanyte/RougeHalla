//! Qualified Fire capture provenance, exact diagnostics and every-tick continuations.
use rh_parity::{build, compare, fixtures_dir, load, raw_command_pub};
use rh_sim::{validate, PlayerId, Sim};
fn fixture(name: &str) -> rh_parity::Fixture {
    load(&fixtures_dir().join(format!("{name}.json")))
}
#[test]
fn every_fire_tick_restores_and_complete_diagnostics_are_required() {
    let mut count = 0;
    for name in [
        "fire_whiff_thirdparty",
        "fire_wand_pause",
        "fire_projectile_requests",
        "fire_plague_holy_windows",
    ] {
        let fx = fixture(name);
        assert!(compare(&fx).mismatches.is_empty(), "{name}");
        let mut sim = build(&fx);
        let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
        for t in &fx.ticks {
            for input in fx.inputs.iter().filter(|i| i.tick == t.tick) {
                let id = PlayerId(input.player[1..].parse::<u32>().unwrap() + 1);
                let cmd = validate(raw_command_pub(input).unwrap()).unwrap();
                sim.submit_unbudgeted(id, cmd).unwrap();
                restored.submit_unbudgeted(id, cmd).unwrap();
            }
            assert_eq!(sim.step(), restored.step(), "{name} tick {}", t.tick);
            for action in fx.actions.iter().filter(|a| a.tick == t.tick) {
                assert!(action.kind == "remove");
                let id = PlayerId(action.player[1..].parse::<u32>().unwrap() + 1);
                sim.remove_player(id);
                restored.remove_player(id);
            }
            assert_eq!(sim.state_hash(), restored.state_hash());
            restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
            count += 1;
        }
    }
    assert_eq!(count, 540);
    let mut missing = fixture("fire_wand_pause");
    missing.ticks[0].plague = None;
    assert!(compare(&missing)
        .mismatches
        .iter()
        .any(|m| m.contains("missing Plague")));
    for key in [
        "performed",
        "raw",
        "landed",
        "dotSince",
        "buckets",
        "fighters",
    ] {
        let mut fx = fixture("fire_wand_pause");
        fx.ticks[0]
            .plague
            .as_mut()
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove(key);
        assert!(
            !compare(&fx).mismatches.is_empty(),
            "missing {key} must fail"
        );
    }
    let mut extra = fixture("fire_wand_pause");
    extra.ticks[0].plague.as_mut().unwrap()["newUncompared"] = true.into();
    assert!(!compare(&extra).mismatches.is_empty());
}
#[test]
fn a_mutated_damage_clock_bit_or_installation_cannot_false_match() {
    for field in ["raw", "pause", "bits", "dotSince"] {
        let mut fx = fixture("fire_wand_pause");
        let tick = fx
            .ticks
            .iter_mut()
            .find(|t| {
                t.plague.as_ref().unwrap()["raw"]
                    .as_array()
                    .is_some_and(|a| !a.is_empty())
            })
            .unwrap();
        let p = tick.plague.as_mut().unwrap();
        match field {
            "raw" => p["raw"][0]["raw"] = 999.into(),
            "pause" => p["fighters"][0]["pause"] = 999.into(),
            "bits" => p["fighters"][0]["bits"] = 99.into(),
            _ => p["dotSince"] = 999.into(),
        };
        assert!(!compare(&fx).mismatches.is_empty(), "{field}");
    }
    let mut fx = fixture("fire_wand_pause");
    fx.legacy_config.modules.as_mut().unwrap().swap(0, 1);
    assert!(!compare(&fx).mismatches.is_empty());
    let mut fx = fixture("fire_wand_pause");
    fx.legacy_config.rust_slice = Some("player-engagement-holy/1".into());
    assert!(!compare(&fx).mismatches.is_empty());
}
#[test]
fn fire_checkpoint_refuses_instant_delayed_and_wrong_mode_state() {
    let fx = fixture("fire_wand_pause");
    let mut sim = build(&fx);
    for t in &fx.ticks {
        for input in fx.inputs.iter().filter(|i| i.tick == t.tick) {
            let id = PlayerId(input.player[1..].parse::<u32>().unwrap() + 1);
            sim.submit_unbudgeted(id, validate(raw_command_pub(input).unwrap()).unwrap())
                .unwrap();
        }
        sim.step();
        if !sim.faction_runtime().dot.is_empty() {
            break;
        }
    }
    let valid = serde_json::to_value(&sim).unwrap();
    assert!(Sim::restore(valid.clone()).is_ok());
    let mut disease = valid.clone();
    disease["world"]["factions"]["dot"][0]["sig"] = "Disease".into();
    assert_ne!(
        Sim::restore(disease).unwrap().state_hash(),
        sim.state_hash()
    );
    let mut instant = valid.clone();
    instant["world"]["factions"]["dot"][0]["sig"] = "Backlash".into();
    assert!(Sim::restore(instant).is_err());
    let mut mode = valid.clone();
    mode["statics"]["config"]["faction_mode"] = "EngagementHolyPlague".into();
    assert!(Sim::restore(mode).is_err());
    let mut bits = valid.clone();
    bits["world"]["players"][0]["core"]["signature"]["bits"] = 16.into();
    assert!(Sim::restore(bits).is_err());
    let mut deferred = valid;
    deferred["world"]["deferred"]["hits"] = serde_json::json!([{"terrain":false,"dot":false,"ability":null,"arena":false,"source":null,"critical":false,"critical_mult":null,"victim":2,"by":1,"packet":{"raw":1.,"phys":1.,"magic":0.,"true_":0.},"weapon":"Fists","stagger":false,"projectile":null,"scale":1.,"derived":false,"passive":false,"sig":"Backlash","execute":false}]);
    assert!(
        Sim::restore(deferred.clone()).is_ok(),
        "valid instant deferred entry"
    );
    deferred["world"]["deferred"]["hits"][0]["execute"] = true.into();
    assert!(Sim::restore(deferred).is_err());
}
#[test]
fn captures_require_real_whiffs_third_party_reflections_and_cancelled_casts() {
    let whiff = fixture("fire_whiff_thirdparty");
    let rows = |tick: u32| {
        whiff
            .ticks
            .iter()
            .find(|t| t.tick == tick)
            .unwrap()
            .plague
            .as_ref()
            .unwrap()
    };
    for t in [7, 16, 41] {
        assert!(rows(t)["performed"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["by"] == "p1"));
        assert!(rows(t)["raw"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["sig"] == "backlash" && r["victim"] == "p1"));
    }
    assert!(!rows(7)["raw"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["sig"].is_null()));
    assert!(rows(41)["raw"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["by"] == "p1" && r["victim"] == "p2" && r["sig"].is_null()));
    let missile = fixture("fire_projectile_requests");
    let mut reflected = 0;
    for t in &missile.ticks {
        if t.events.iter().any(|e| e["passive"] == true) {
            reflected += 1;
            assert!(!t.plague.as_ref().unwrap()["performed"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["by"] == "p0"));
        }
    }
    assert!(reflected >= 3);
    let cast = missile.ticks.iter().find(|t| t.tick == 64).unwrap();
    assert!(cast
        .events
        .iter()
        .any(|e| e["kind"] == "windup" && e["weapon"] == "wand"));
    for t in missile.ticks.iter().filter(|t| (64..=70).contains(&t.tick)) {
        assert!(t.plague.as_ref().unwrap()["performed"]
            .as_array()
            .unwrap()
            .is_empty());
    }
    let pause = fixture("fire_wand_pause");
    assert!(pause.ticks.iter().any(|t| {
        let p = t.plague.as_ref().unwrap();
        p["fighters"][0]["pause"].as_f64().unwrap() >= t.server_time + 50.
            && p["raw"]
                .as_array()
                .unwrap()
                .iter()
                .any(|r| r["sig"] == "backlash")
    }));
}
#[test]
fn changed_burn_or_backlash_rule_is_caught_at_its_actual_amount() {
    for sig in ["burn", "backlash"] {
        let mut fx = fixture("fire_wand_pause");
        let tick = fx
            .ticks
            .iter_mut()
            .find(|t| {
                t.plague.as_ref().unwrap()["raw"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|r| r["sig"] == sig)
            })
            .unwrap();
        let row = tick.plague.as_mut().unwrap()["raw"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|r| r["sig"] == sig)
            .unwrap();
        row["raw"] = serde_json::json!(row["raw"].as_f64().unwrap() * 1.01);
        let mismatches = compare(&fx).mismatches;
        assert!(
            mismatches
                .iter()
                .any(|m| m.contains("plague.raw") && m.contains(".raw")),
            "{sig}: {mismatches:?}"
        );
    }
}
