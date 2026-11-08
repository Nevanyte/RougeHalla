//! Real attack history, then timer-driven faction reset and warmed public projection.
use rh_sim::{
    Arena, ArenaMode, ArenaRules, Event, FactionId, FactionMode, ItemObserver, Observation,
    PlayerId, PublicCommand, Secrets, Sim, SimConfig, TileMap, Vec2,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;
#[test]
fn all_five_player_post_reset_combat_allocates_no_blocks() {
    let _profiler = dhat::Profiler::builder().testing().build();
    for faction in [
        FactionId::Holy,
        FactionId::Fire,
        FactionId::Plague,
        FactionId::Frost,
        FactionId::Sentenced,
    ] {
        let mut sim = Sim::new(
            SimConfig {
                // This bounded player reset profile installs no consumables/wind module.
                consumables: false,
                abilities: rh_sim::abilities::Mode::Full,
                faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
                lifecycle: ArenaMode::Source(ArenaRules {
                    plan_seconds: 0.,
                    first_patience_seconds: Some(5.1),
                    coliseum_schedule: None,
                    patience_seconds: 5.1,
                    patience_min_seconds: 5.1,
                    sudden_death_seconds: 60.,
                }),
                min_players: 3,
                lobby_seconds: 0.,
                fill_seconds: 0.,
                ..Default::default()
            },
            Arena {
                map: TileMap::new(40, 24, vec![0; 960]).unwrap(),
                spawns: vec![
                    Vec2::new(300., 320.),
                    Vec2::new(332., 320.),
                    Vec2::new(316., 336.),
                ],
            },
            Secrets::from_seed(3),
        );
        for (i, f) in [faction, FactionId::Holy, FactionId::Fire]
            .into_iter()
            .enumerate()
        {
            sim.add_player(&format!("p{i}"), Some(f), false).unwrap();
        }
        let mut events = Vec::with_capacity(256);
        sim.step_into(&mut events);
        let mut observer = ItemObserver::new(PlayerId(1));
        let mut observation = Observation::default();
        observer
            .observe_into(&sim, &events, &mut observation, None)
            .unwrap();
        let own = observation.me.as_ref().unwrap();
        let other = &observation.visible[0];
        let a = rh_sim::math::atan2(other.y - own.y, other.x - own.x);
        let command = observer
            .resolve(&sim, PublicCommand::Attack { a, t: None })
            .unwrap();
        sim.submit(PlayerId(1), command).unwrap();
        for _ in 0..98 {
            events.clear();
            sim.step_into(&mut events);
            observer
                .observe_into(&sim, &events, &mut observation, None)
                .unwrap();
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
        assert!(sim
            .player(PlayerId(1))
            .unwrap()
            .signature
            .combat_at
            .is_some());
        let before = dhat::HeapStats::get().total_blocks;
        let mut teleported = false;
        for _ in 0..12 {
            events.clear();
            sim.step_into(&mut events);
            observer
                .observe_into(&sim, &events, &mut observation, None)
                .unwrap();
            teleported |= events.iter().any(|e| matches!(e, Event::Teleported));
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
        let allocated = dhat::HeapStats::get().total_blocks - before;
        assert!(teleported);
        println!("{faction:?}: first arena transition allocates {allocated} blocks (includes existing cold arena/vision owners)");
        for _ in 0..30 {
            events.clear();
            sim.step_into(&mut events);
            observer
                .observe_into(&sim, &events, &mut observation, None)
                .unwrap();
        }
        let target = observation
            .visible
            .first()
            .expect("visible continuation target");
        let goal = Vec2::new(target.x + 24., target.y);
        let target = target.id;
        let command = observer
            .resolve(
                &sim,
                PublicCommand::Move {
                    x: goal.x,
                    y: goal.y,
                    seq: None,
                },
            )
            .unwrap();
        sim.submit(PlayerId(1), command).unwrap();
        for _ in 0..80 {
            events.clear();
            sim.step_into(&mut events);
            observer
                .observe_into(&sim, &events, &mut observation, None)
                .unwrap();
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
        let own = observation.me.as_ref().unwrap();
        let foe = observation.visible.iter().find(|p| p.id == target).unwrap();
        let a = rh_sim::math::atan2(foe.y - own.y, foe.x - own.x);
        let command = observer
            .resolve(&sim, PublicCommand::Attack { a, t: None })
            .unwrap();
        sim.submit(PlayerId(1), command).unwrap();
        for _ in 0..40 {
            events.clear();
            sim.step_into(&mut events);
            observer
                .observe_into(&sim, &events, &mut observation, None)
                .unwrap();
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
        assert!(
            sim.player(PlayerId(1))
                .unwrap()
                .signature
                .combat_at
                .unwrap()
                > 5150.,
            "actual post-reset combat"
        );
        let before = dhat::HeapStats::get().total_blocks;
        for _ in 0..12 {
            events.clear();
            sim.step_into(&mut events);
            observer
                .observe_into(&sim, &events, &mut observation, None)
                .unwrap();
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
        let allocated = dhat::HeapStats::get().total_blocks - before;
        assert_eq!(
            allocated, 0,
            "{faction:?}: warmed post-reset combat/observation allocations"
        );
    }
}
