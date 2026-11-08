//! Ordinary submitted choices acquire cards, then the same warmed combat path remains allocation-free.
#![cfg(not(feature = "schedule-trace"))]
use rh_sim::{
    validate, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2, WeaponId,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;
#[test]
fn acquired_cards_use_the_warmed_real_tick_without_allocating() {
    let ps = [
        Placement {
            profile: "a".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(400., 400.),
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        },
        Placement {
            profile: "b".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(456., 400.),
            hp: None,
            weapon0: Some(WeaponId::Shield),
            weapon1: None,
        },
    ];
    let base = Sim::reset_active(
        SimConfig {
            quests: false,
            pvp_rules: false,
            faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFire,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(8),
        &ps,
    );
    // Trusted PRE-offer facts only. Each actual choice/refold executes below through validate + submit.
    let mut state = serde_json::to_value(base).unwrap();
    let boxes = state["world"]["reward_chests"].as_array_mut().unwrap();
    for (i, id) in ["slowBurn", "siphon", "pocketSand"].iter().enumerate() {
        boxes.push(serde_json::json!({"id":i+1,"at":{"x":400.,"y":400.},"expires_at":15000.,"held_until_tick":0,"options":[{"Card":id},null,null],"taken":[null,null,null],"pickers":[],"camp":null,"owner":null}));
    }
    state["world"]["entity_counter"] = serde_json::json!(3);
    let mut sim: Sim = serde_json::from_value(state).unwrap();
    for (id, player) in [(1, 1), (2, 1), (3, 2)] {
        sim.submit(
            PlayerId(player),
            validate(RawCommand::Choose {
                chest_id: Some(id),
                pick: 0,
            })
            .unwrap(),
        )
        .unwrap();
        sim.step();
    }
    assert_eq!(sim.players()[0].build.cards().count(), 2);
    assert_eq!(sim.players()[1].build.cards().count(), 1);
    sim.submit(
        PlayerId(2),
        validate(RawCommand::Aim {
            a: std::f64::consts::PI,
        })
        .unwrap(),
    )
    .unwrap();
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    let mut events = Vec::with_capacity(512);
    for _ in 0..50 {
        sim.step_into(&mut events);
    }
    let _prof = dhat::Profiler::builder().testing().build();
    let before = dhat::HeapStats::get();
    for _ in 0..30 {
        sim.step_into(&mut events);
    }
    let after = dhat::HeapStats::get();
    assert_eq!(after.total_blocks - before.total_blocks, 0);
    assert!(sim.players().iter().all(|p| p.standing()));
}
