//! Fire roam slice: actual-source traces, strict diagnostics, module provenance, mutants and every-tick continuations.
use rh_parity::{build, compare, fixtures_dir, load, raw_command_pub};
use rh_sim::{validate, PlayerId, Sim};

fn fixture(name: &str) -> rh_parity::Fixture {
    load(&fixtures_dir().join(format!("{name}.json")))
}

#[test]
fn every_fire_roam_tick_restores_and_complete_diagnostics_are_required() {
    let mut count = 0;
    for name in ["fire_roam_charge_burst", "fire_roam_ranged_arm"] {
        let fx = fixture(name);
        let mismatches = compare(&fx).mismatches;
        assert!(mismatches.is_empty(), "{name}: {mismatches:?}");
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
            assert_eq!(sim.state_hash(), restored.state_hash());
            restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
            count += 1;
        }
    }
    assert_eq!(count, 480 + 470);
    // A fixture without the roam stream must not pass silently.
    let mut missing = fixture("fire_roam_charge_burst");
    missing.ticks[0].roam = None;
    assert!(compare(&missing)
        .mismatches
        .iter()
        .any(|m| m.contains("missing Fire roam")));
    // A key the harness does not read is refused, even inside a compared roam row.
    let mut extra = fixture("fire_roam_charge_burst");
    extra.ticks[0].roam.as_mut().unwrap()[0]["newUncompared"] = true.into();
    assert!(!compare(&extra).mismatches.is_empty());
}

#[test]
fn a_mutated_charge_ready_or_installation_cannot_false_match() {
    for field in ["charge", "ready"] {
        let mut fx = fixture("fire_roam_charge_burst");
        let tick = fx
            .ticks
            .iter_mut()
            .find(|t| t.tick > 401)
            .expect("a charged tick");
        let row = &mut tick.roam.as_mut().unwrap()[0];
        if field == "charge" {
            row["charge"] = 999.into();
        } else {
            row["ready"] = false.into();
        }
        assert!(
            !compare(&fx).mismatches.is_empty(),
            "a mutated {field} must fail"
        );
    }
    // The installed module list is part of the provenance: a swapped installer fails.
    let mut fx = fixture("fire_roam_charge_burst");
    fx.legacy_config.modules.as_mut().unwrap().swap(20, 21);
    assert!(!compare(&fx).mismatches.is_empty());
    // The provenance slice names the explicit partial foundation exactly.
    let mut fx = fixture("fire_roam_charge_burst");
    fx.legacy_config.rust_slice =
        Some("player-engagement-holy-plague-fire-frost-sentenced/1".into());
    assert!(!compare(&fx).mismatches.is_empty());
    // A packet from another backlog packet cannot claim the Fire roam stream.
    let mut fx = fixture("fire_roam_ranged_arm");
    fx.packet = Some("P-FACTION-1".into());
    assert!(!compare(&fx).mismatches.is_empty());
}
