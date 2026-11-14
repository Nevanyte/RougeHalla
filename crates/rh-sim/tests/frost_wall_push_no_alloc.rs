//! P-FROST-WALL-1b guard (beside `frost_wall_no_alloc.rs`): the landing step that sets a fighter down and re-plans a walk
//! under way may allocate a little (the barrier row, the overlay, the new path); every step while the wall stands, with
//! the walker going round it, allocates nothing.
use rh_sim::{
    abilities::{Mode, Slot, FROST_WALL_CAST_MS, FROST_WALL_MS},
    Arena, FactionId, FrostWish, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, TileMap,
    Vec2,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

fn blocks() -> u64 {
    dhat::HeapStats::get().total_blocks
}

fn tc(t: u32) -> f64 {
    f64::from(t) * 32. + 16.
}

fn standing(sim: &Sim) -> bool {
    serde_json::to_value(sim).unwrap()["world"]["abilities"]["barriers"].is_array()
}

#[test]
fn the_push_out_and_the_walk_round_a_standing_wall_allocate_nothing_per_step() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let (w, h) = (40usize, 20usize);
    let mut tiles = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                tiles[y * w + x] = 1;
            }
        }
    }
    // Frost at (3, 16), a walker at (8, 10), a fighter on the wall's line at (13, 10).
    let placements = [
        (FactionId::Frost, Vec2::new(tc(3), tc(16))),
        (FactionId::Fire, Vec2::new(tc(8), tc(10))),
        (FactionId::Holy, Vec2::new(tc(13), tc(10))),
    ]
    .into_iter()
    .enumerate()
    .map(|(i, (faction, at))| Placement {
        profile: format!("p{i}"),
        faction,
        bot: false,
        at,
        hp: Some(1e9),
        weapon0: None,
        weapon1: None,
    })
    .collect::<Vec<_>>();
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: false,
            abilities: Mode::Full,
            wish_lock_ms: 0.,
            frost_wish: FrostWish::Wall,
            ..Default::default()
        },
        Arena {
            map: TileMap::new(w as u32, h as u32, tiles).unwrap(),
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
    step(&mut sim);
    let submit = |sim: &mut Sim, who: u32, raw: RawCommand| {
        let cmd = rh_sim::validate(raw).unwrap();
        sim.submit(PlayerId(who), cmd).unwrap();
    };
    submit(
        &mut sim,
        2,
        RawCommand::Move {
            x: tc(20),
            y: tc(10),
            seq: None,
        },
    );
    step(&mut sim);
    submit(
        &mut sim,
        1,
        RawCommand::Cast {
            slot: Slot::Wish,
            x: tc(13),
            y: tc(10),
            id: None,
            t: None,
            seq: None,
        },
    );
    let ticks = |ms: f64| (ms / 50.) as usize;
    let mut raised = None;
    let on_line = sim.players()[2].pos();
    for _ in 0..ticks(FROST_WALL_CAST_MS) + 2 {
        let at = blocks();
        let landed = step(&mut sim);
        let used = blocks() - at;
        if landed {
            raised = Some(used);
            break;
        }
    }
    let raise = raised.expect("the cast lands");
    assert!(standing(&sim), "the wall rose");
    // Not vacuous: the fighter on the wall's line was set down (by at least two search steps).
    let now = sim.players()[2].pos();
    assert!(
        rh_sim::math::hypot(now.x - on_line.x, now.y - on_line.y) >= 8.,
        "the fighter on the line was set down: {on_line:?} -> {now:?}"
    );
    eprintln!("raise with a push-out and a re-plan: {raise} blocks");
    assert!(
        raise <= 48,
        "raising a wall onto a fighter and a walk: {raise} blocks"
    );
    let before = blocks();
    let stand_steps = ticks(FROST_WALL_MS) - 2;
    for _ in 0..stand_steps {
        step(&mut sim);
    }
    let stood = blocks() - before;
    assert!(standing(&sim), "the wall still stands");
    eprintln!(
        "{stand_steps} steps with the wall standing and a walker going round: {stood} blocks"
    );
    assert_eq!(stood, 0, "steps with a wall standing");
}
