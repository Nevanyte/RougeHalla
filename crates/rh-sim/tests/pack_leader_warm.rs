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

fn allocations_over_step(sim: &mut Sim, out: &mut Vec<Event>, world: usize) -> (u64, u64) {
    out.clear();
    let before = dhat::HeapStats::get();
    let _ = world;
    sim.step_into(out);
    let after = dhat::HeapStats::get();
    let allocations = (
        after.total_blocks - before.total_blocks,
        after.total_bytes - before.total_bytes,
    );
    assert!(!out
        .iter()
        .any(|e| matches!(e, Event::Resolved { .. } | Event::Victory { .. })));
    allocations
}

#[test]
fn camps_snapshot_warm_original_clone_restore_allocates_nothing() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let mut sim = grown_training_world();
    for _ in 0..WARM {
        sim.step();
    }
    // Construct every continuation from this exact checkpoint before any window.
    let mut cloned = sim.clone();
    let mut restored =
        Sim::restore(serde_json::to_value(&sim).unwrap()).expect("real produced state restores");
    let initial_tick = sim.tick();
    assert_eq!(sim.state_hash(), cloned.state_hash());
    assert_eq!(sim.state_hash(), restored.state_hash());
    let mut original_events = Vec::with_capacity(128);
    let mut clone_events = Vec::with_capacity(128);
    let mut restore_events = Vec::with_capacity(128);
    let mut original_allocs = 0;
    let mut clone_allocs = 0;
    let mut restore_allocs = 0;
    // Fixed recording storage: no recorder allocation, formatting or callback
    // inside the measured step; no recursive global-allocator instrumentation.
    let mut trace = [[(0u64, 0u64); 3]; WINDOW];
    for samples in &mut trace {
        samples[0] = allocations_over_step(&mut sim, &mut original_events, 0);
        samples[1] = allocations_over_step(&mut cloned, &mut clone_events, 1);
        samples[2] = allocations_over_step(&mut restored, &mut restore_events, 2);
        original_allocs += samples[0].0;
        clone_allocs += samples[1].0;
        restore_allocs += samples[2].0;
        assert_eq!(original_events, clone_events);
        assert_eq!(original_events, restore_events);
    }
    for (step, samples) in trace.iter().enumerate() {
        for (world, (blocks, bytes)) in samples.iter().enumerate() {
            if *blocks != 0 {
                println!(
                    "allocation trace world={world} tick={} blocks={blocks} bytes={bytes}",
                    initial_tick + step as u32 + 1
                );
            }
        }
    }
    // Equal-window controls precede allocation assertions, even on an allocation red.
    assert_eq!(sim.tick(), initial_tick + WINDOW as u32);
    assert_eq!(sim.tick(), cloned.tick());
    assert_eq!(sim.tick(), restored.tick());
    assert_eq!(sim.state_hash(), cloned.state_hash());
    assert_eq!(sim.state_hash(), restored.state_hash());
    println!("same-checkpoint warm windows: original={original_allocs} clone={clone_allocs} restore={restore_allocs} start_tick={initial_tick} end_tick={} actors={}", sim.tick(), sim.players().len() + sim.mobs().len());
    assert_eq!(original_allocs, 0, "original warm window allocations");
    assert_eq!(clone_allocs, 0, "clone warm window allocations");
    assert_eq!(restore_allocs, 0, "restore warm window allocations");

    assert_eq!(
        sim.players()[0].camps_cleared,
        cloned.players()[0].camps_cleared
    );
    println!("warm windows: original={original_allocs} clone={clone_allocs} restore={restore_allocs} actors={}", sim.players().len() + sim.mobs().len());
}
