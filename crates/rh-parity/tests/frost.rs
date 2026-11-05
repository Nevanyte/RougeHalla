//! Every ordinary Frost trace is independently compared and restored after every tick, including old ongoing Draws.
use rh_parity::{build, compare, fixtures_dir, load, raw_command_pub};
use rh_sim::{validate, PlayerId, Sim};
const NAMES: [&str; 10] = [
    "frost_reverse_asymmetric",
    "frost_weapon_fists",
    "frost_weapon_sword",
    "frost_weapon_axe",
    "frost_weapon_shield",
    "frost_weapon_bow",
    "frost_weapon_wand",
    "frost_multisource_thaw",
    "frost_mixed_pause",
    "frost_ranged_splash",
];
#[test]
fn all_source_ticks_and_every_checkpoint_continue_exactly() {
    let mut draws = 0;
    let mut ticks = 0;
    for name in NAMES {
        let fx = load(&fixtures_dir().join(format!("{name}.json")));
        let report = compare(&fx);
        assert!(
            report.mismatches.is_empty(),
            "{name}: {:?}",
            report.mismatches
        );
        let mut sim = build(&fx);
        let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
        for t in &fx.ticks {
            for input in fx.inputs.iter().filter(|i| i.tick == t.tick) {
                let id = PlayerId(input.player[1..].parse::<u32>().unwrap() + 1);
                let cmd = validate(raw_command_pub(input).unwrap()).unwrap();
                sim.submit_unbudgeted(id, cmd).unwrap();
                restored.submit_unbudgeted(id, cmd).unwrap();
            }
            assert_eq!(sim.step(), restored.step(), "{name} {}", t.tick);
            for action in fx.actions.iter().filter(|a| a.tick == t.tick) {
                let id = PlayerId(action.player[1..].parse::<u32>().unwrap() + 1);
                assert_eq!(action.kind, "remove");
                sim.remove_player(id);
                restored.remove_player(id);
            }
            assert_eq!(sim.state_hash(), restored.state_hash(), "{name} {}", t.tick);
            if sim.players().iter().any(|p| {
                p.weapon
                    .action
                    .is_some_and(|a| a.kind == rh_sim::state::ActionKind::Draw)
                    && p.signature.chill < 1.
            }) {
                draws += 1;
            }
            restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
            ticks += 1;
        }
    }
    assert!(ticks > 1900 && draws > 100, "{ticks} {draws}");
}
#[test]
fn diagnostic_and_exact_installation_mutations_fail() {
    for key in [
        "chill",
        "chillers",
        "exposureStartedAt",
        "lastNearAt",
        "rangedUntil",
        "move",
        "readyAt",
        "bufferedUntil",
        "pressedAt",
        "drawStartedAt",
        "action",
    ] {
        let mut fx = load(&fixtures_dir().join("frost_weapon_bow.json"));
        fx.ticks[0].frost.as_mut().unwrap()[0]
            .as_object_mut()
            .unwrap()
            .remove(key);
        assert!(!compare(&fx).mismatches.is_empty(), "{key}");
    }
    for marker in [
        "player-engagement-holy-plague-fire/1",
        "player-engagement-holy-plague/1",
    ] {
        let mut fx = load(&fixtures_dir().join("frost_weapon_bow.json"));
        fx.legacy_config.rust_slice = Some(marker.into());
        assert!(!compare(&fx).mismatches.is_empty());
    }
    for empty in [false, true] {
        let mut fx = load(&fixtures_dir().join("frost_weapon_bow.json"));
        if empty {
            fx.ticks[0].frost = Some(serde_json::json!([]));
        } else {
            fx.ticks[0].frost = None;
        }
        assert!(!compare(&fx).mismatches.is_empty());
    }
}
