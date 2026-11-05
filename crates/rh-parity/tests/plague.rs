//! Qualified Plague capture provenance, exact diagnostics and every-tick continuations.
use rh_parity::{build, compare, fixtures_dir, load, raw_command_pub};
use rh_sim::{validate, PlayerId, Sim};
fn fixture(name: &str) -> rh_parity::Fixture {
    load(&fixtures_dir().join(format!("{name}.json")))
}
#[test]
fn every_plague_tick_restores_and_complete_diagnostics_are_required() {
    let mut count = 0;
    for name in [
        "plague_thresholds_swap",
        "plague_wand_pause",
        "plague_multisource_lethal",
        "plague_departure_early_end",
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
    assert_eq!(count, 449);
    let mut missing = fixture("plague_wand_pause");
    missing.ticks[0].plague = None;
    assert!(compare(&missing)
        .mismatches
        .iter()
        .any(|m| m.contains("missing Plague")));
    for key in ["raw", "landed", "dotSince", "buckets", "fighters"] {
        let mut fx = fixture("plague_wand_pause");
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
    let mut extra = fixture("plague_wand_pause");
    extra.ticks[0].plague.as_mut().unwrap()["newUncompared"] = true.into();
    assert!(!compare(&extra).mismatches.is_empty());
}
#[test]
fn a_mutated_damage_clock_bit_or_installation_cannot_false_match() {
    for field in ["raw", "pause", "bits", "dotSince"] {
        let mut fx = fixture("plague_wand_pause");
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
    let mut fx = fixture("plague_wand_pause");
    fx.legacy_config.modules.as_mut().unwrap().swap(0, 1);
    assert!(!compare(&fx).mismatches.is_empty());
    let mut fx = fixture("plague_wand_pause");
    fx.legacy_config.rust_slice = Some("player-engagement-holy/1".into());
    assert!(!compare(&fx).mismatches.is_empty());
}
