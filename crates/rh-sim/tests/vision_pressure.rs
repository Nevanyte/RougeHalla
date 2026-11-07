//! Moving viewer with a full private 30-second trail and a dense rack on the other side of a long wall.
use rh_sim::{
    Arena, ContainerKind, FactionId, ItemObserver, Observation, Placement, PlayerId, RawCommand,
    Secrets, Sim, SimConfig, TileMap, Vec2, WeaponId, MAX_VISIBLE_PROPS,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

#[test]
#[allow(clippy::disallowed_methods, clippy::disallowed_types)] // Measurement clock is external to the simulation.
fn moving_trail_and_full_hidden_rack() {
    let rows: Vec<String> = (0..64)
        .map(|y| {
            (0..100)
                .map(|x| {
                    if x == 0 || x == 99 || x == 40 || y == 0 || y == 63 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    let from = Vec2::new(832., 1040.);
    let p = Placement {
        profile: "viewer".into(),
        faction: FactionId::Holy,
        bot: false,
        at: from,
        hp: None,
        weapon0: None,
        weapon1: None,
    };
    let other = Placement {
        profile: "remote".into(),
        at: Vec2::new(2900., 1050.),
        ..p.clone()
    };
    let mut s = Sim::reset_active(
        SimConfig {
            // The pressure scenario models a world with no consumables module (no wind props in the vision budget).
            consumables: false,
            ..SimConfig::default()
        },
        Arena {
            map: TileMap::from_rows(&rows).unwrap(),
            spawns: vec![from],
        },
        Secrets::from_seed(3),
        &[p, other],
    );
    for i in 0..MAX_VISIBLE_PROPS {
        s.seed_weapon_container(
            ContainerKind::Ground,
            Vec2::new(
                (41 + i % 16) as f64 * 32. + 16.,
                (24 + i / 16) as f64 * 32. + 16.,
            ),
            &[WeaponId::Axe],
        )
        .unwrap();
    }
    let mut ev = Vec::new();
    let mut ob = Observation::default();
    let mut viewer = ItemObserver::new(PlayerId(1));
    for _ in 0..603 {
        ev.clear();
        s.step_into(&mut ev);
    }
    // Populate the ordinary open-map sampling bound, independent of path-planner pauses at waypoint turns.
    // These origins move along the near side of the wall, all 2 ticks apart.
    let mut cp = serde_json::to_value(&s).unwrap();
    let stamps: Vec<_> = (0..300u32)
        .map(|i| {
            let offset = (i % 60).abs_diff(30) as f64 * 8.;
            serde_json::json!({"tick":s.tick()-598+i*2,"variant":"Open","ordinal":0,"origin":{"x":832.,"y":1000.+offset}})
        })
        .collect();
    cp["world"]["players"][0]["vision"]["reveals"] = serde_json::json!(stamps);
    s = Sim::restore(cp).unwrap();
    s.submit(
        PlayerId(1),
        rh_sim::validate(RawCommand::Move {
            x: from.x,
            y: 1800.,
            seq: None,
        })
        .unwrap(),
    )
    .unwrap();
    let _profiler = dhat::Profiler::builder().testing().build();
    let mut samples = Vec::with_capacity(12);
    for n in 0..16 {
        ev.clear();
        #[cfg(feature = "schedule-trace")]
        s.clear_schedule_trace();
        s.step_into(&mut ev);
        if n >= 4 {
            let before = dhat::HeapStats::get().total_blocks;
            let start = std::time::Instant::now();
            viewer.observe_into(&s, &[], &mut ob, None).unwrap();
            samples.push(start.elapsed().as_micros());
            assert_eq!(dhat::HeapStats::get().total_blocks, before);
            assert!(ob.props.is_empty());
        } else {
            viewer.observe_into(&s, &[], &mut ob, None).unwrap();
        }
    }
    let cp = serde_json::to_value(&s).unwrap();
    assert_eq!(
        cp["world"]["players"][0]["vision"]["reveals"]
            .as_array()
            .unwrap()
            .len(),
        300
    );
    samples.sort_unstable();
    eprintln!(
        "300 origins × 512 distinct hidden prop tiles, median {} us, max {} us",
        samples[6], samples[11]
    );
}
