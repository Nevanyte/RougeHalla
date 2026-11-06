//! Actual-source Sentenced-hunt cases, strict diagnostics and every-tick checkpoint continuation.
use rh_parity::{build, compare, fixtures_dir, load, raw_command_pub};
use rh_sim::{validate, PlayerId, Sim};

const NAMES: [&str; 6] = [
    "sentenced_hunt_select_and_death",
    "sentenced_hunt_mia_clears",
    "sentenced_hunt_hunter_death_clears",
    "sentenced_hunt_toward_move",
    "sentenced_hunt_vision_exception",
    "sentenced_hunt_run_end_clears",
];

#[test]
fn hunt_traces_match_and_every_tick_restores() {
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
            ticks += 1;
        }
    }
    assert_eq!(ticks, 534);
}

#[test]
fn hunt_diagnostics_are_required_and_exercised() {
    let fx = load(&fixtures_dir().join("sentenced_hunt_select_and_death.json"));
    assert_eq!(fx.ticks[0].hunt.as_ref().unwrap()[0]["huntTarget"], "p1");
    assert!(fx
        .ticks
        .iter()
        .any(|t| t.hunt.as_ref().unwrap()[0]["huntStacks"] == 1));
    let mut missing = load(&fixtures_dir().join("sentenced_hunt_select_and_death.json"));
    missing.ticks[0].hunt = None;
    assert!(compare(&missing)
        .mismatches
        .iter()
        .any(|m| m.contains("missing Sentenced-hunt")));

    let vision = load(&fixtures_dir().join("sentenced_hunt_vision_exception.json"));
    assert!(vision
        .ticks
        .iter()
        .filter_map(|t| t.vision.as_ref())
        .all(|v| v[0].actors == ["p1"] && v[0].points == [false, false]));

    let end = load(&fixtures_dir().join("sentenced_hunt_run_end_clears.json"));
    assert_eq!(
        end.ticks.last().unwrap().hunt.as_ref().unwrap()[0]["huntTarget"],
        ""
    );
}
