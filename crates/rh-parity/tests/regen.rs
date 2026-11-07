//! Player regeneration: the captured clock trace matches at every tick and every tick restores into an identical
//! continuation.
use rh_parity::{build, compare, fixtures_dir, load, raw_command_pub};
use rh_sim::{validate, PlayerId, Sim};

fn fixture() -> rh_parity::Fixture {
    load(&fixtures_dir().join("regen_clock.json"))
}

fn hp_at(fx: &rh_parity::Fixture, tick: u32, player: &str) -> f64 {
    let t = fx.ticks.iter().find(|t| t.tick == tick).unwrap();
    t.players.iter().find(|p| p["id"] == player).unwrap()["hp"]
        .as_f64()
        .unwrap()
}

#[test]
fn the_regen_capture_exercises_the_clock_and_restores_every_tick() {
    let fx = fixture();
    // Guard: the scenario really enabled regeneration. A capture made with it off would compare but prove nothing.
    assert_eq!(
        fx.legacy_config.options.get("regen"),
        Some(&serde_json::Value::Bool(true))
    );
    let rep = compare(&fx);
    assert!(rep.mismatches.is_empty(), "{:?}", rep.mismatches);
    // The attacker's own steps: the in-fight share right after its hit, the out-of-fight share once the three quiet
    // seconds have passed. These are the source's two shares for a Holy's 1145 max hp at 20 Hz.
    assert!((hp_at(&fx, 4, "p0") - hp_at(&fx, 3, "p0") - 1145.0 * 0.0025 * 0.05).abs() < 1e-9);
    assert!((hp_at(&fx, 200, "p0") - hp_at(&fx, 199, "p0") - 1145.0 * 0.008 * 0.05).abs() < 1e-9);
    // The untouched fighter never had a clock: out of combat from its first step.
    assert!((hp_at(&fx, 3, "p2") - hp_at(&fx, 2, "p2") - 950.0 * 0.008 * 0.05).abs() < 1e-9);

    let mut sim = build(&fx);
    let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
    let mut count = 0;
    for t in &fx.ticks {
        for input in fx.inputs.iter().filter(|i| i.tick == t.tick) {
            let id = PlayerId(input.player[1..].parse::<u32>().unwrap() + 1);
            let cmd = validate(raw_command_pub(input).unwrap()).unwrap();
            sim.submit_unbudgeted(id, cmd).unwrap();
            restored.submit_unbudgeted(id, cmd).unwrap();
        }
        assert_eq!(sim.step(), restored.step(), "tick {}", t.tick);
        assert_eq!(sim.state_hash(), restored.state_hash());
        restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
        count += 1;
    }
    assert_eq!(count, 200);
}
