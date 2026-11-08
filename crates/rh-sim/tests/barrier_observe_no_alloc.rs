//! Publication primitives add no heap blocks to warmed persistent owner/visible-player observations.
use rh_sim::{
    FactionId, ItemObserver, Observation, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;
#[test]
fn seeded_owner_and_visible_barriers_allocate_no_heap_blocks_when_warmed() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let mut arena = rh_sim::arenas::practice_arena();
    arena.spawns = vec![Vec2::new(400., 320.)];
    let placements = [400., 456.]
        .into_iter()
        .enumerate()
        .map(|(i, x)| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(x, 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect::<Vec<_>>();
    let sim = Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(3),
        &placements,
    );
    let mut setup = serde_json::to_value(&sim).unwrap();
    for row in setup["world"]["players"].as_array_mut().unwrap() {
        row["core"]["vitals"]["barrier"] = 25.into();
    }
    let mut sim =
        Sim::restore(&mut serde_json::Deserializer::from_str(&setup.to_string())).unwrap();
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut out = Observation::default();
    let mut events = Vec::with_capacity(64);
    let mut cache = rh_sim::SightCache::new();
    for _ in 0..20 {
        sim.step_into(&mut events);
        observer
            .observe_into(&sim, &events, &mut out, Some(&mut cache))
            .unwrap();
        events.clear();
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
    }
    assert_eq!(out.me.as_ref().unwrap().barrier, 25.);
    assert!(out.visible[0].barrier_frac > 0.);
    let before = dhat::HeapStats::get().total_blocks;
    for _ in 0..200 {
        sim.step_into(&mut events);
        observer
            .observe_into(&sim, &events, &mut out, Some(&mut cache))
            .unwrap();
        events.clear();
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
    }
    assert_eq!(dhat::HeapStats::get().total_blocks - before, 0);
}
