//! Cursor's training Wish witness, using the canonical P-ARENA-2 dummy lifecycle.
use super::*;
use crate::status_runtime::{FieldKind, StatusKind};

fn training_case() -> V {
    corpus()["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == "training-swarm-real-five-second-recast-replacement")
        .unwrap()
        .clone()
}

#[test]
fn genuine_training_swarm_recast_matches_the_frozen_source() {
    let sim = run_case(&training_case());
    sim.check_layout().expect("canonical training hash layout");
    let dummies: Vec<_> = sim.w.mobs.iter().collect();
    assert_eq!(dummies.len(), 2);
    for dummy in dummies {
        assert!(matches!(
            sim.w.actor_origin(dummy.core.id),
            Some(crate::mob_runtime::ActorOrigin::Dummy { .. })
        ));
    }
}

#[test]
fn repeated_training_swarm_recasts_keep_one_cloud_and_restore_the_original_hidden_start() {
    let case = training_case();
    let mut sim = construct(&case["input"]);
    let mut first_start = None;
    for _ in 0..6 {
        while sim.w.players[0].stocks.wish_ready_at > sim.w.server_time + crate::constants::TICK_MS
        {
            sim.step();
        }
        let cmd = crate::validate(RawCommand::Cast {
            slot: Slot::Wish,
            x: 0.,
            y: 0.,
            id: None,
            t: None,
            seq: None,
        })
        .unwrap();
        sim.submit(PlayerId(1), cmd).unwrap();
        sim.step();
        assert_eq!(
            sim.w.players[0]
                .card_runtime
                .unwrap()
                .wish_cast
                .unwrap()
                .cooldown_ms,
            TRAINING_COOLDOWN_MS
        );
        for _ in 0..5 {
            sim.step();
        }
        let hidden = sim.w.players[0]
            .statuses
            .instances
            .iter()
            .find(|st| st.kind == StatusKind::Hidden)
            .expect("a genuine Swarm landing hides its owner");
        let start = *first_start.get_or_insert(hidden.started_at);
        assert_eq!(
            hidden.started_at, start,
            "recast keeps the original Hidden start"
        );
        let fields = &sim.w.abilities.as_ref().unwrap().fields;
        assert_eq!(fields.len(), 1, "the new cloud replaces the old cloud");
        assert_eq!(fields[0].kind, FieldKind::Cloud);
        assert_eq!(fields[0].ends_at, hidden.until);
        assert_eq!(fields[0].started_at + SWARM_MS, hidden.until);
        sim.check_layout()
            .expect("canonical hash layout after every recast");
        checkpoint(&mut sim, "repeated-training-swarm");
    }
    // A forged refresh without a matching cloud is not a reachable producer state.
    sim.w.players[0]
        .statuses
        .instances
        .iter_mut()
        .find(|st| st.kind == StatusKind::Hidden)
        .unwrap()
        .until += crate::constants::TICK_MS;
    assert!(Sim::restore(serde_json::to_value(&sim).unwrap()).is_err());
}
