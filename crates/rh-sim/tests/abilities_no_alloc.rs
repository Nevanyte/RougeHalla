//! Warm ordinary input, all five genuine producers and their due/effect phases.
use rh_sim::{
    abilities::{Mode, Slot},
    Arena, FactionId, Placement, PlayerId, PublicCommand, Secrets, Sim, SimConfig, TileMap, Vec2,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;
#[test]
fn all_five_warmed_casts_allocate_no_heap_blocks() {
    let _profiler = dhat::Profiler::builder().testing().build();
    for faction in [
        FactionId::Frost,
        FactionId::Plague,
        FactionId::Sentenced,
        FactionId::Fire,
        FactionId::Holy,
    ] {
        let mut tiles = vec![0; 40 * 24];
        for y in 0..24 {
            for x in 0..40 {
                if x == 0 || y == 0 || x == 39 || y == 23 {
                    tiles[y * 40 + x] = 1;
                }
            }
        }
        let map = TileMap::new(40, 24, tiles).unwrap();
        let placements = [
            (faction, Vec2::new(300., 320.)),
            (FactionId::Holy, Vec2::new(440., 320.)),
            (FactionId::Frost, Vec2::new(900., 500.)),
        ]
        .into_iter()
        .enumerate()
        .map(|(i, (faction, at))| Placement {
            profile: format!("p{i}"),
            faction,
            bot: false,
            at,
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect::<Vec<_>>();
        let mut sim = Sim::reset_active(
            SimConfig {
                abilities: Mode::Full,
                lifecycle: rh_sim::ArenaMode::Source(rh_sim::ArenaRules {
                    plan_seconds: 0.,
                    first_patience_seconds: None,
                    coliseum_schedule: None,
                    patience_seconds: 3600.,
                    patience_min_seconds: 3600.,
                    sudden_death_seconds: 60.,
                }),
                wish_lock_ms: 0.,
                ..Default::default()
            },
            Arena {
                map,
                spawns: placements.iter().map(|p| p.at).collect(),
            },
            Secrets::from_seed(3),
            &placements,
        );
        let mut events = Vec::with_capacity(512);
        // Warm lazy status/field stores with a genuine cast, then wait for source recharge.
        let target =
            matches!(faction, FactionId::Frost | FactionId::Sentenced).then_some(PlayerId(2));
        let mut observer = rh_sim::ItemObserver::new(PlayerId(1));
        let mut observation = rh_sim::Observation::default();
        observer
            .observe_into(&sim, &[], &mut observation, None)
            .unwrap();
        let command = observer
            .resolve(
                &sim,
                PublicCommand::Cast {
                    slot: Slot::Wish,
                    x: 600.,
                    y: 320.,
                    id: target,
                    t: None,
                    seq: None,
                },
            )
            .unwrap();
        sim.submit(PlayerId(1), command).unwrap();
        for tick in 0..3700 {
            events.clear();
            sim.step_into(&mut events);
            if !(12..3688).contains(&tick) {
                observer
                    .observe_into(&sim, &events, &mut observation, None)
                    .unwrap();
            }
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
        let before = dhat::HeapStats::get().total_blocks;
        let command = observer
            .resolve(
                &sim,
                PublicCommand::Cast {
                    slot: Slot::Wish,
                    x: 300.,
                    y: 320.,
                    id: target,
                    t: None,
                    seq: None,
                },
            )
            .unwrap();
        sim.submit(PlayerId(1), command).unwrap();
        let mut started = 0;
        let mut landed = 0;
        for _ in 0..12 {
            events.clear();
            sim.step_into(&mut events);
            observer
                .observe_into(&sim, &events, &mut observation, None)
                .unwrap();
            for e in &events {
                started += usize::from(matches!(e, rh_sim::Event::CastStarted { .. }));
                landed += usize::from(matches!(e, rh_sim::Event::CastLanded { .. }));
            }
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
        let used = dhat::HeapStats::get().total_blocks - before;
        assert_eq!(
            (started, landed),
            (
                usize::from(!matches!(faction, FactionId::Fire | FactionId::Holy)),
                1
            ),
            "real second {faction:?} cast must execute"
        );
        assert_eq!(used, 0, "warm {faction:?} cast allocated");
    }
}
