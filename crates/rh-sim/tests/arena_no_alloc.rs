//! Allocation pressure in real planning and locked worlds after their transition allocations.
use rh_sim::{
    Arena, ArenaMode, ArenaRules, FactionId, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;
#[test]
fn warmed_planning_and_locked_movement_allocate_no_blocks() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    let arena: Arena = export.validate().unwrap().into_arena().unwrap();
    let config = |plan| SimConfig {
        quests: false,
        lifecycle: ArenaMode::Source(ArenaRules {
            plan_seconds: plan,
            first_patience_seconds: Some(0.1),
            coliseum_schedule: None,
            sudden_death_seconds: 60.,
            ..Default::default()
        }),
        min_players: 2,
        fill_seconds: 0.,
        hazards: rh_sim::terrain::Mode::Off,
        ..Default::default()
    };
    let mut planning = Sim::new(config(45.), arena.clone(), Secrets::from_seed(12));
    for name in ["a", "b"] {
        planning
            .add_player(name, Some(FactionId::Holy), false)
            .unwrap();
    }
    let mut ev = Vec::new();
    for _ in 0..40 {
        ev.clear();
        planning.step_into(&mut ev);
        #[cfg(feature = "schedule-trace")]
        planning.clear_schedule_trace();
    }
    let before = dhat::HeapStats::get().total_blocks;
    for _ in 0..120 {
        ev.clear();
        planning.step_into(&mut ev);
        #[cfg(feature = "schedule-trace")]
        planning.clear_schedule_trace();
    }
    assert_eq!(
        dhat::HeapStats::get().total_blocks - before,
        0,
        "planning idle"
    );
    let col = arena.map.layers().unwrap().coliseum();
    let gate = &col.gates[0];
    let tile = gate.tiles[gate.tiles.len() / 2];
    let gate_at = Vec2::new(f64::from(tile.x) * 32. + 16., f64::from(tile.y) * 32. + 16.);
    let outside = Vec2::new(gate_at.x, gate_at.y - 64.);
    let inner = col
        .inner_spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect::<Vec<_>>();
    let mut locked = Sim::new(config(0.), arena, Secrets::from_seed(12));
    for name in ["a", "b"] {
        locked
            .add_player(name, Some(FactionId::Holy), false)
            .unwrap();
    }
    for _ in 0..4 {
        ev.clear();
        locked.step_into(&mut ev);
    }
    assert!(rh_sim::public_snapshot(&locked).arena.unwrap().gates_locked);
    let commands = [inner[0], outside, inner[4], outside].map(|at| {
        rh_sim::validate(RawCommand::Move {
            x: at.x,
            y: at.y,
            seq: None,
        })
        .unwrap()
    });
    let run = |sim: &mut Sim, ev: &mut Vec<_>| {
        let mut accepted = 0;
        let mut moved = 0;
        for i in 0..160 {
            if i % 10 == 0 && sim.submit(PlayerId(1), commands[(i / 10) % 4]).is_ok() {
                accepted += 1;
            }
            let at = sim.player(PlayerId(1)).unwrap().pos();
            ev.clear();
            sim.step_into(ev);
            moved += usize::from(sim.player(PlayerId(1)).unwrap().pos() != at);
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
        (accepted, moved)
    };
    run(&mut locked, &mut ev);
    let before = dhat::HeapStats::get().total_blocks;
    let (accepted, moved) = run(&mut locked, &mut ev);
    let blocks = dhat::HeapStats::get().total_blocks - before;
    assert!(
        accepted > 0 && moved > 0,
        "locked path and movement must execute"
    );
    assert_eq!(blocks, 0, "locked moving/path requests");
}
