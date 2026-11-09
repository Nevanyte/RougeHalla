//! Camps-specific warm gate for the pass-start snapshot path: a real >8-actor training world (ordinary Train commands), then
//! the same finite input-free windows measured for allocations on the original, a Clone and a real restore. The snapshot
//! internals (population, cleanup, >8 prepared capacity) are asserted by the focused lib controls; this gate proves the
//! ordinary warm pass path those controls sit on allocates nothing and continues identically after Clone/restore.
#![cfg(not(feature = "schedule-trace"))]
use rh_sim::mob_catalog::MobTypeId;
use rh_sim::{validate, Event, FactionId, FactionMode, RawCommand, Secrets, Sim, SimConfig};

#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

const WARM: usize = 100;
const WINDOW: usize = 40;

fn grown_training_world() -> Sim {
    let mut sim = Sim::new(
        SimConfig {
            training: true,
            quests: false,
            consumables: false,
            min_players: 1,
            lobby_seconds: 0.,
            fill_seconds: 0.,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrost,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(12),
    );
    let id = sim
        .add_player("warm-growth", Some(FactionId::Holy), false)
        .unwrap();
    sim.step();
    let ty = MobTypeId::ALL
        .into_iter()
        .find(|ty| {
            rh_sim::mob_catalog::mob_type_by_id(ty.as_str())
                .is_some_and(|t| t.zone == FactionId::Fire && !t.elite)
        })
        .unwrap();
    let code = MobTypeId::ALL.iter().position(|t| *t == ty).unwrap() as u32;
    for _ in 0..2 {
        sim.submit(
            id,
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
        for _ in 0..6 {
            sim.step();
        }
    }
    assert!(
        sim.players().len() + sim.mobs().len() > 8,
        "prepared capacity above 8 actors"
    );
    sim
}

fn allocations_over_window(sim: &mut Sim, out: &mut Vec<Event>) -> u64 {
    let mut allocations = 0u64;
    for _ in 0..WINDOW {
        out.clear();
        let before = dhat::HeapStats::get().total_blocks;
        sim.step_into(out);
        allocations += dhat::HeapStats::get().total_blocks - before;
        assert!(!out
            .iter()
            .any(|e| matches!(e, Event::Resolved { .. } | Event::Victory { .. })));
    }
    allocations
}

#[test]
fn camps_snapshot_warm_original_clone_restore_allocates_nothing() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let mut sim = grown_training_world();
    for _ in 0..WARM {
        sim.step();
    }
    let mut out = Vec::with_capacity(128);

    let original_allocs = allocations_over_window(&mut sim, &mut out);
    assert_eq!(original_allocs, 0, "original warm window allocations");

    let mut cloned = sim.clone();
    let clone_allocs = allocations_over_window(&mut cloned, &mut out);
    assert_eq!(clone_allocs, 0, "clone warm window allocations");

    // The real produced state restores (construction outside the measured window).
    let mut restored =
        Sim::restore(serde_json::to_value(&sim).unwrap()).expect("real produced state restores");
    let restore_allocs = allocations_over_window(&mut restored, &mut out);
    assert_eq!(restore_allocs, 0, "restore warm window allocations");

    assert_eq!(sim.state_hash(), cloned.state_hash());
    assert_eq!(sim.state_hash(), restored.state_hash());
    assert_eq!(
        sim.players()[0].camps_cleared,
        cloned.players()[0].camps_cleared
    );
    println!("warm windows: original={original_allocs} clone={clone_allocs} restore={restore_allocs} actors={}", sim.players().len() + sim.mobs().len());
}
