//! Exact installed-module Holy cases, strict diagnostics and checkpoint continuations.
use rh_parity::{build, compare, fixtures_dir, load, raw_command_pub};
use rh_sim::{validate, PlayerId, Sim};
fn fixture(name: &str) -> rh_parity::Fixture {
    load(&fixtures_dir().join(format!("{name}.json")))
}
#[test]
fn holy_diagnostics_are_required_and_every_real_tick_restores() {
    let mut steps = 0;
    for name in [
        "holy_reach_low",
        "holy_passive_then_active_retarget",
        "signature_holy",
        "holy_lifesteal_low_hp",
        "holy_sword_shield",
        "holy_arrow_reflection",
        "holy_block_without_damage",
        "holy_wand_splash",
        "holy_contact_forget",
        "holy_contact_tie_12",
        "holy_contact_tie_91",
        "holy_lethal_no_revive",
        "holy_overkill_clamp",
        "holy_barrier_20",
        "holy_barrier_400",
    ] {
        let fx = fixture(name);
        assert!(compare(&fx).mismatches.is_empty(), "{name}");
        let mut sim = build(&fx);
        let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
        for tick in &fx.ticks {
            for input in fx.inputs.iter().filter(|i| i.tick == tick.tick) {
                let id = PlayerId(input.player[1..].parse::<u32>().unwrap() + 1);
                let cmd = validate(raw_command_pub(input).unwrap()).unwrap();
                sim.submit_unbudgeted(id, cmd).unwrap();
                restored.submit_unbudgeted(id, cmd).unwrap();
            }
            assert_eq!(sim.step(), restored.step(), "{name} tick {}", tick.tick);
            assert_eq!(sim.state_hash(), restored.state_hash());
            restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
            steps += 1;
        }
    }
    assert!(steps > 1400);
    for key in ["signatures", "landed"] {
        let mut fx = fixture("holy_lifesteal_low_hp");
        if key == "signatures" {
            fx.ticks[0].signatures = None;
        } else {
            fx.ticks[0].landed = None;
        }
        assert!(compare(&fx).mismatches.iter().any(|m| m.contains(key)));
    }
}
#[test]
fn actual_blocks_ties_barriers_forgetting_and_overkill_are_exercised() {
    let fx = fixture("holy_block_without_damage");
    let block = fx
        .ticks
        .iter()
        .find(|t| t.events.iter().any(|e| e["kind"] == "block"))
        .unwrap();
    assert!(block.landed.as_ref().unwrap().is_empty());
    for s in block.signatures.as_ref().unwrap() {
        assert!(s["combatAt"].is_null());
        assert_eq!(s["contactAt"], block.server_time);
        assert!(s["target"].is_string());
    }
    let a = fixture("holy_contact_tie_12");
    let b = fixture("holy_contact_tie_91");
    assert_eq!(a.ticks[1].signatures.as_ref().unwrap()[0]["target"], "p2");
    assert_eq!(b.ticks[1].signatures.as_ref().unwrap()[0]["target"], "p1");
    let fx = fixture("holy_contact_forget");
    let before = &fx
        .ticks
        .iter()
        .find(|t| t.tick == 237)
        .unwrap()
        .signatures
        .as_ref()
        .unwrap()[0];
    let after = &fx
        .ticks
        .iter()
        .find(|t| t.tick == 238)
        .unwrap()
        .signatures
        .as_ref()
        .unwrap()[0];
    assert_eq!(before["target"], "p1");
    assert!(after["target"].is_null());
    assert_eq!(before["contactAt"], after["contactAt"]);
    let fx = fixture("holy_barrier_20");
    let hit = fx
        .ticks
        .iter()
        .find(|t| !t.landed.as_ref().unwrap().is_empty())
        .unwrap();
    assert!(hit.landed.as_ref().unwrap().iter().any(|h| hit
        .events
        .iter()
        .any(|e| e["kind"] == "hit"
            && e["id"] == h["victim"]
            && e["amount"].as_f64().unwrap() > h["amount"].as_f64().unwrap())));
    let fx = fixture("holy_reach_low");
    let sig = |tick| {
        &fx.ticks
            .iter()
            .find(|t| t.tick == tick)
            .unwrap()
            .signatures
            .as_ref()
            .unwrap()[0]
    };
    assert_eq!(sig(20)["inReach"], false);
    assert_eq!(sig(44)["engaged"], true);
    assert_eq!(sig(45)["engaged"], false);
    assert_eq!(sig(55)["inReach"], true);
    let fx = fixture("holy_passive_then_active_retarget");
    let sig = |tick| {
        &fx.ticks
            .iter()
            .find(|t| t.tick == tick)
            .unwrap()
            .signatures
            .as_ref()
            .unwrap()[1]
    };
    assert_eq!(sig(18)["target"], "p2");
    assert_eq!(sig(65)["target"], "p0");
    let fx = fixture("holy_overkill_clamp");
    let heals: Vec<_> = fx
        .ticks
        .iter()
        .flat_map(|t| &t.events)
        .filter(|e| e["kind"] == "heal")
        .collect();
    assert_eq!(heals.len(), 1);
    assert_eq!(heals[0]["amount"], 1.0);
    let fx = fixture("holy_lethal_no_revive");
    assert!(!fx
        .ticks
        .iter()
        .flat_map(|t| &t.events)
        .any(|e| e["kind"] == "heal"));
}
#[test]
fn fabricated_faction_metadata_or_hidden_full_installer_effects_cannot_pass() {
    let mut fx = fixture("holy_lifesteal_low_hp");
    fx.legacy_config.rust_slice = None;
    assert!(!compare(&fx).mismatches.is_empty());
    let mut fx = fixture("holy_lifesteal_low_hp");
    fx.players[0].faction = "fire".into();
    assert!(!compare(&fx).mismatches.is_empty());
    let mut fx = fixture("signature_holy");
    fx.ticks[1].holy_inactive.as_mut().unwrap()["corpses"] = 1.into();
    assert!(compare(&fx)
        .mismatches
        .iter()
        .any(|m| m.contains("inactivity")));
    let mut fx = fixture("signature_holy");
    fx.ticks[1].fields = Some(vec![serde_json::json!({"id":"hidden field"})]);
    assert!(!compare(&fx).mismatches.is_empty());
}
