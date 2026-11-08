//! Native map-backed, warmed terrain passes allocate no steady-state heap blocks.
use rh_sim::{terrain::Mode, Arena, FactionId, Placement, Secrets, Sim, SimConfig, Vec2};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;
static PROFILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[test]
fn warmed_terrain_passes_allocate_nothing() {
    let _guard = PROFILE_LOCK.lock().unwrap();
    let _profiler = dhat::Profiler::builder().testing().build();
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    let arena: std::sync::Arc<Arena> = export.validate().unwrap().into_arena().unwrap().into();
    for kind in [4, 5, 6, 7] {
        let i = arena
            .map
            .layers()
            .unwrap()
            .data()
            .terrain
            .iter()
            .position(|k| *k == kind)
            .unwrap();
        let at = Vec2::new(
            (i % arena.map.w as usize) as f64 * 32. + 16.,
            (i / arena.map.w as usize) as f64 * 32. + 16.,
        );
        let ps = (0..3)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: FactionId::Holy,
                bot: false,
                at: if i == 0 { at } else { arena.spawns[i] },
                hp: Some(500.),
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>();
        let mut sim = Sim::reset_active(
            SimConfig {
                quests: false,
                consumables: true,
                lifecycle: rh_sim::ArenaMode::Off,
                hazards: Mode::All,
                ..Default::default()
            },
            arena.clone(),
            Secrets::from_seed(4),
            &ps,
        );
        let mut events = vec![];
        for _ in 0..40 {
            events.clear();
            sim.step_into(&mut events);
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
        let before = dhat::HeapStats::get().total_blocks;
        for _ in 0..120 {
            events.clear();
            sim.step_into(&mut events);
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
        let used = dhat::HeapStats::get().total_blocks - before;
        assert_eq!(used, 0, "terrain kind {kind}");
    }
}

#[cfg(feature = "trusted-status-probes")]
#[test]
fn source_junction_collision_replans_allocate_nothing_after_warmup() {
    let _guard = PROFILE_LOCK.lock().unwrap();
    let _profiler = dhat::Profiler::builder().testing().build();
    let corpus: serde_json::Value =
        serde_json::from_slice(include_bytes!("../../../parity/terrain/source.json")).unwrap();
    let case = corpus["walkCases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "junction-grip-continuation")
        .unwrap();
    let input = &case["input"];
    let w = input["map"]["w"].as_u64().unwrap() as u32;
    let h = input["map"]["h"].as_u64().unwrap() as u32;
    let mut tiles = vec![1; (w * h) as usize];
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            if y == 5 || x == 10 && (5..=12).contains(&y) {
                tiles[(y * w + x) as usize] = 0;
            }
        }
    }
    let pt = |v: &serde_json::Value| Vec2::new(v["x"].as_f64().unwrap(), v["y"].as_f64().unwrap());
    let body = pt(&input["body"]);
    let goal = pt(&input["goal"]);
    let actions = input["actions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| {
            (
                a["dtMs"].as_f64().unwrap(),
                a["cap"].as_f64().unwrap(),
                a["now"].as_f64().unwrap(),
            )
        })
        .collect::<Vec<_>>();
    let mut probe = rh_sim::terrain::probe::Slide::new(
        rh_sim::TileMap::new(w, h, tiles).unwrap(),
        body,
        goal,
        input["radius"].as_f64().unwrap(),
    );
    for &(dt, cap, now) in &actions {
        probe.step(dt, cap, now);
    }
    probe.restart(body, goal);
    let before = dhat::HeapStats::get().total_blocks;
    let (mut replans, mut grips) = (0, 0);
    for &(dt, cap, now) in &actions {
        let (r, g) = probe.step(dt, cap, now);
        replans += usize::from(r);
        grips += usize::from(g);
    }
    let used = dhat::HeapStats::get().total_blocks - before;
    assert!(
        replans > 0 && grips > 0,
        "actual source collision and grip paths must execute"
    );
    assert_eq!(used, 0, "replans {replans}, grip frames {grips}");
}
