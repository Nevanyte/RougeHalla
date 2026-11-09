//! Serialization/layout controls only: these values are NOT produced source gameplay parity.
use crate::state::Player;

#[test]
fn walk_hint_state_layout_report() {
    eprintln!(
        "layout Player.walk_dir={} Player.walk_ticks={}",
        std::mem::offset_of!(Player, walk_dir),
        std::mem::offset_of!(Player, walk_ticks)
    );
    eprintln!(
        "layout Player.size={} align={} FighterCore.size={} Mob.size={}",
        std::mem::size_of::<Player>(),
        std::mem::align_of::<Player>(),
        std::mem::size_of::<crate::fighter::FighterCore>(),
        std::mem::size_of::<crate::mob_runtime::Mob>()
    );
    macro_rules! offsets {
        ($($field:ident),*) => { $(eprintln!("layout Player.{}={}", stringify!($field), std::mem::offset_of!(Player, $field));)* };
    }
    offsets!(
        stocks,
        card_runtime,
        card_streak,
        card_trims,
        card_hots,
        card_fired,
        card_crit_acc,
        card_still_x,
        card_still_y,
        card_still_since,
        card_boost,
        card_prevented,
        card_tank_hp,
        roam,
        frost_guard,
        plan_ready,
        build,
        potion_small,
        healing_until,
        potions_healing,
        farm,
        kill_stats,
        trade_used,
        trade_offers,
        trade_stats,
        core,
        seat,
        vision,
        bush,
        credit,
        fate,
        status,
        down,
        resolved,
        regen_at,
        hunt_target,
        hunt_stacks,
        potion_large,
        camps_cleared,
        speed_boost_until,
        barrier_until,
        barrier_decays
    );
}

fn declared_serialization_sim() -> crate::Sim {
    let mut sim = crate::Sim::new(
        crate::SimConfig::default(),
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(49),
    );
    sim.add_player(
        "walk-hint-serialization-control",
        Some(crate::FactionId::Holy),
        false,
    )
    .unwrap();
    sim
}

fn malformed(json: &serde_json::Value) -> String {
    match super::Sim::restore(json) {
        Err(super::CheckpointError::Malformed(why)) => why,
        Err(other) => panic!("expected malformed checkpoint, got {other}"),
        Ok(_) => panic!("malformed walk-hint serialization control was accepted"),
    }
}

#[test]
fn walk_hint_state_joining_zero_and_fields_are_required_canonical_leaves() {
    let sim = declared_serialization_sim();
    assert_eq!(
        (sim.w.players[0].walk_dir, sim.w.players[0].walk_ticks),
        (0, 0)
    );
    let json = serde_json::to_value(&sim).unwrap();
    assert_eq!(json["world"]["players"][0]["walk_dir"], 0);
    assert_eq!(json["world"]["players"][0]["walk_ticks"], 0);
    for field in ["walk_dir", "walk_ticks"] {
        let mut missing = json.clone();
        missing["world"]["players"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(
            malformed(&missing).contains(field),
            "required canonical field {field}"
        );
    }
}

#[test]
fn walk_hint_state_clone_restore_and_each_field_changes_private_hash() {
    let baseline = declared_serialization_sim();
    let mut direction = baseline.clone();
    direction.w.players[0].walk_dir = 255;
    assert!(
        baseline.state_hash() != direction.state_hash(),
        "retained zero-ticks direction must be hashed"
    );
    let mut ticks = baseline.clone();
    ticks.w.players[0].walk_ticks = 3;
    assert!(
        baseline.state_hash() != ticks.state_hash(),
        "hint ticks must be hashed"
    );
    direction.w.players[0].walk_ticks = 2;
    let cloned = direction.clone();
    let json = serde_json::to_value(&direction).unwrap();
    let restored = super::Sim::restore(&json).unwrap();
    for copy in [&cloned, &restored] {
        assert_eq!(
            (copy.w.players[0].walk_dir, copy.w.players[0].walk_ticks),
            (255, 2)
        );
        assert!(
            copy.state_hash() == direction.state_hash(),
            "canonical clone/restore changed private hash"
        );
        assert_eq!(serde_json::to_value(copy).unwrap(), json);
    }
}

#[test]
fn walk_hint_state_all_direction_bytes_survive_zero_ticks_and_valid_ticks_survive_shape_guard() {
    let json = serde_json::to_value(declared_serialization_sim()).unwrap();
    // Serialization controls, NOT produced hints: no speculative phase/gate coupling is admitted.
    for dir in 0..=255u8 {
        let mut declared = json.clone();
        declared["world"]["players"][0]["walk_dir"] = dir.into();
        let restored = super::Sim::restore(&declared).unwrap();
        assert_eq!(
            (
                restored.w.players[0].walk_dir,
                restored.w.players[0].walk_ticks
            ),
            (dir, 0)
        );
    }
    for ticks in 1..=3u8 {
        let mut declared = json.clone();
        declared["world"]["players"][0]["walk_dir"] = 255.into();
        declared["world"]["players"][0]["walk_ticks"] = ticks.into();
        let restored = super::Sim::restore(&declared).unwrap();
        assert_eq!(
            (
                restored.w.players[0].walk_dir,
                restored.w.players[0].walk_ticks
            ),
            (255, ticks)
        );
    }
}

#[test]
fn walk_hint_state_malformed_ticks_and_out_of_range_direction_refuse() {
    let json = serde_json::to_value(declared_serialization_sim()).unwrap();
    for ticks in [4u8, 255] {
        let mut bad = json.clone();
        bad["world"]["players"][0]["walk_ticks"] = ticks.into();
        assert!(malformed(&bad).contains("invalid walk hint ticks"));
    }
    for dir in [-1, 256] {
        let mut bad = json.clone();
        bad["world"]["players"][0]["walk_dir"] = dir.into();
        assert!(malformed(&bad).contains("u8"));
    }
}
