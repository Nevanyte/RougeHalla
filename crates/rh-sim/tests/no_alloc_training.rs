//! The allocation-free tick in the practice room (P-TRAINING-CAMPS-1 review note): a seated player hits a console-spawned
//! practice camp until it dies, so a contributor pair is noted (`PracticeRuntime::contributors`) and then forgotten by the
//! camp's clear payout, inside the measured steps. The same window is measured on the original world, on a `Clone` and on
//! a restored checkpoint taken at the same tick: each must allocate nothing. Like `no_alloc.rs`, one test per file (the
//! dhat profiler is process-wide), with setup (the console's camp drops, the commands) kept outside the measured section.
//!
//! IGNORED until a follow-up packet fixes the practice fight's existing allocations. Measured 2026-11-13 (original / clone
//! / restore blocks over 165 steps): 29 / 39 / 39, identical on the sources before P-TRAINING-CAMPS-1, so the contributor
//! list adds none (its buffer is proven in `systems/camp_heal.rs` `practice_tests`). The original's 29 blocks, by site:
//! `World::actor_label` from `cards::on_hit::run_on_hit` (15, an `Arc<str>` per player hit on a mob),
//! `ledger::apply_victim` collecting `OverkillHit`s (3), `mob_ai::add_threat` (3), the threat clone on a lethal hit in
//! `mob_life::hurt` (3), `mob_life::reap` (2), `Path::set_from` from the wand lock (3). `RH_TRACE_ALLOC=1` prints the
//! allocating steps with their events.

use rh_sim::events::Event;
use rh_sim::mob_catalog::MobTypeId;
use rh_sim::mob_runtime::MobKind;
use rh_sim::sim::{PlayerId, Secrets, Sim, SimConfig};
use rh_sim::state::Status;
use rh_sim::{validate, FactionId, FactionMode, RawCommand, Vec2};

#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

fn me() -> PlayerId {
    PlayerId(1)
}

/// The console's `camp` command (legacy `trainCamp`) for an Ember Imp camp of three.
fn drop_camp(sim: &mut Sim) {
    let code = MobTypeId::ALL
        .iter()
        .position(|t| *t == MobTypeId::EmberImp)
        .unwrap() as u32;
    sim.submit(
        me(),
        validate(RawCommand::Train(rh_sim::input::TrainRaw {
            command: 3,
            id: code,
            count: 0,
            options: [0; 3],
            option_count: 0,
        }))
        .unwrap(),
    )
    .unwrap();
    sim.step();
}

fn newest_camp(sim: &Sim) -> u32 {
    sim.mobs()
        .iter()
        .filter(|m| m.kind == MobKind::Practice)
        .map(|m| m.camp)
        .max()
        .unwrap()
}

fn living(sim: &Sim, camp: u32) -> Vec<(PlayerId, Vec2)> {
    sim.mobs()
        .iter()
        .filter(|m| m.kind == MobKind::Practice && m.camp == camp && m.status == Status::Alive)
        .map(|m| (m.core.id, Vec2::new(m.core.body.x, m.core.body.y)))
        .collect()
}

fn contributors(sim: &Sim) -> serde_json::Value {
    serde_json::to_value(sim).unwrap()["world"]["practice"]["contributors"].clone()
}

/// Locks the player onto the first living mob of `camp` (setup: outside any measured section).
fn engage(sim: &mut Sim, camp: u32) -> bool {
    let Some(&(id, _)) = living(sim, camp).first() else {
        return false;
    };
    sim.submit(me(), validate(RawCommand::Target { id }).unwrap())
        .unwrap();
    true
}

/// Fights `camp` to its clear, `limit` steps at most. Returns (steps measured, allocations in them, whether a contributor
/// pair was seen during the fight).
fn fight_to_clear(sim: &mut Sim, camp: u32, limit: u32) -> (u32, u64, bool) {
    let mut out: Vec<Event> = Vec::with_capacity(256);
    let (mut measured, mut allocations, mut noted) = (0u32, 0u64, false);
    let mut target = None;
    for _ in 0..limit {
        let next = living(sim, camp).first().map(|m| m.0);
        if next.is_none() {
            break;
        }
        if next != target {
            engage(sim, camp);
            target = next;
        }
        out.clear();
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        let before = dhat::HeapStats::get().total_blocks;
        sim.step_into(&mut out);
        let used = dhat::HeapStats::get().total_blocks - before;
        allocations += used;
        measured += 1;
        if used > 0 && std::env::var_os("RH_TRACE_ALLOC").is_some() {
            eprintln!("tick {} blocks {used}: {:?}", sim.tick(), out);
        }
        if !noted {
            noted = contributors(sim)
                .as_array()
                .is_some_and(|pairs| pairs.iter().any(|p| p[0] == camp));
        }
    }
    (measured, allocations, noted)
}

#[test]
#[ignore = "the practice fight allocates outside the contributor path today (29/39/39 blocks, see the file doc); fix is a follow-up packet"]
fn a_practice_camp_fight_and_clear_allocates_nothing_on_the_original_a_clone_and_a_restore() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let mut sim = Sim::reset_active(
        SimConfig {
            training: true,
            quests: false,
            consumables: true,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(23),
        &[rh_sim::Placement {
            profile: "practice".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: None,
            // The wand: the one weapon a `target` lock drives (legacy targeting).
            weapon0: Some(rh_sim::WeaponId::Wand),
            weapon1: None,
        }],
    );
    // Warm-up: a first camp fought to its clear (the first contributor note reserves the room's whole bound).
    drop_camp(&mut sim);
    let a = newest_camp(&sim);
    let (warm, _, warm_noted) = fight_to_clear(&mut sim, a, 2000);
    assert!(warm_noted, "the warm-up fight noted a contributor");
    assert!(living(&sim, a).is_empty(), "camp A cleared in {warm} steps");
    assert_eq!(sim.players()[0].camps_cleared, 1, "camp A counted");
    for _ in 0..6 {
        sim.step();
    }
    // The measured camp, dropped in setup; the three continuations start from this exact state.
    drop_camp(&mut sim);
    let b = newest_camp(&sim);
    assert_ne!(a, b);
    assert_eq!(contributors(&sim), serde_json::json!([]));
    let mut cloned = sim.clone();
    let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).expect("restores");
    assert_eq!(sim.state_hash(), cloned.state_hash());
    assert_eq!(sim.state_hash(), restored.state_hash());
    let potions = sim.players()[0].potion_large;

    let mut report = Vec::new();
    for (name, world) in [
        ("original", &mut sim),
        ("clone", &mut cloned),
        ("restore", &mut restored),
    ] {
        let (steps, allocations, noted) = fight_to_clear(world, b, 2000);
        assert!(noted, "{name}: the measured fight noted a contributor");
        assert!(living(world, b).is_empty(), "{name}: camp B cleared");
        assert_eq!(
            world.players()[0].camps_cleared,
            2,
            "{name}: camp B counted"
        );
        assert_eq!(
            world.players()[0].potion_large,
            potions + 1,
            "{name}: camp B's potion"
        );
        assert_eq!(
            contributors(world),
            serde_json::json!([]),
            "{name}: the clear forgot camp B's pair"
        );
        report.push((name, steps, allocations));
    }
    eprintln!("practice camp warm windows (name, steps, allocations): {report:?}");
    assert_eq!(sim.state_hash(), cloned.state_hash());
    assert_eq!(sim.state_hash(), restored.state_hash());
    for (name, steps, allocations) in report {
        assert_eq!(
            allocations, 0,
            "{name}: allocations over {steps} measured steps"
        );
    }
}
