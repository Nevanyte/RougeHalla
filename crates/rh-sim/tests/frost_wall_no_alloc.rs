//! P-FROST-WALL-1-fix (review note 3): under `frost_wish = Wall`, a step with a wall standing allocates nothing. Raising
//! and dropping a wall may allocate (the barrier row and the overlay maps): the counts are printed, and checked small.
use rh_sim::{
    abilities::{Mode, Slot, FROST_WALL_CAST_MS, FROST_WALL_COOLDOWN_MS, FROST_WALL_MS},
    Arena, FactionId, FrostWish, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, TileMap,
    Vec2,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

fn standing(sim: &Sim) -> bool {
    serde_json::to_value(sim).unwrap()["world"]["abilities"]["barriers"].is_array()
}

fn blocks() -> u64 {
    dhat::HeapStats::get().total_blocks
}

#[test]
fn steps_with_a_frost_wall_standing_allocate_no_blocks() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let mut tiles = vec![0; 40 * 24];
    for y in 0..24 {
        for x in 0..40 {
            if x == 0 || y == 0 || x == 39 || y == 23 {
                tiles[y * 40 + x] = 1;
            }
        }
    }
    let placements = [
        (FactionId::Frost, Vec2::new(300., 320.)),
        (FactionId::Holy, Vec2::new(900., 500.)),
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
            quests: false,
            consumables: false,
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
            frost_wish: FrostWish::Wall,
            ..Default::default()
        },
        Arena {
            map: TileMap::new(40, 24, tiles).unwrap(),
            spawns: placements.iter().map(|p| p.at).collect(),
        },
        Secrets::from_seed(3),
        &placements,
    );
    let mut events = Vec::with_capacity(512);
    let mut step = |sim: &mut Sim| {
        events.clear();
        sim.step_into(&mut events);
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        events
            .iter()
            .any(|e| matches!(e, rh_sim::Event::CastLanded { .. }))
    };
    let cast = |sim: &mut Sim| {
        let cmd = rh_sim::validate(RawCommand::Cast {
            slot: Slot::Wish,
            x: 600.,
            y: 320.,
            id: None,
            t: None,
            seq: None,
        })
        .unwrap();
        sim.submit(PlayerId(1), cmd).unwrap();
    };
    // Warm: one whole wall (cast, stand, fall), then the cooldown.
    step(&mut sim);
    cast(&mut sim);
    let ticks = |ms: f64| (ms / 50.) as usize;
    for _ in 0..ticks(FROST_WALL_COOLDOWN_MS + 1000.) {
        step(&mut sim);
    }
    assert!(!standing(&sim), "the warm-up wall fell");

    // The measured wall: up to its landing.
    cast(&mut sim);
    let before = blocks();
    let mut landed = false;
    let mut to_landing = 0;
    while !landed {
        to_landing += 1;
        assert!(
            to_landing <= ticks(FROST_WALL_CAST_MS) + 2,
            "the cast lands"
        );
        let at = blocks();
        landed = step(&mut sim);
        if landed {
            let raise = blocks() - at;
            let start = at - before;
            eprintln!(
                "cast start..landing: {start} blocks before the landing step, raise {raise} blocks"
            );
            assert_eq!(start, 0, "the cast's steps before the landing");
            assert!(raise > 0 && raise <= 32, "raising a wall: {raise} blocks");
        }
    }
    assert!(standing(&sim), "the wall stands");
    // Every step strictly between the raise and the fall.
    let stand_steps = ticks(FROST_WALL_MS) - 2;
    let before = blocks();
    for _ in 0..stand_steps {
        step(&mut sim);
    }
    let stood = blocks() - before;
    assert!(
        standing(&sim),
        "the wall still stands after {stand_steps} steps"
    );
    eprintln!("{stand_steps} steps with the wall standing: {stood} blocks");
    assert_eq!(stood, 0, "steps with a wall standing");
    // The fall.
    let mut fell = None;
    for _ in 0..4 {
        let at = blocks();
        step(&mut sim);
        let used = blocks() - at;
        if !standing(&sim) {
            fell = Some(used);
            break;
        }
        assert_eq!(used, 0, "a step with the wall standing");
    }
    let fell = fell.expect("the wall falls at its time");
    eprintln!("drop: {fell} blocks");
    assert!(fell <= 32, "dropping a wall: {fell} blocks");
}
