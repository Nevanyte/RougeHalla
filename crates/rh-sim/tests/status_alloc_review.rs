#![cfg(feature = "trusted-status-probes")]
use rh_sim::{
    status_runtime::{probe::*, *},
    *,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;
fn cycle(h: &mut Harness, requests: &[StatusApply], now: f64) {
    h.clear_schedule_trace();
    h.execute(Operation::Clock {
        at: now,
        tick: (now / 50.) as u32,
    })
    .unwrap();
    h.execute(Operation::Collect(true)).unwrap();
    for a in requests {
        h.execute(Operation::Apply {
            id: PlayerId(2),
            apply: a.clone(),
            quiet: true,
        })
        .unwrap();
    }
    h.execute(Operation::Drain).unwrap();
    assert_eq!(
        h.sim()
            .player(PlayerId(2))
            .unwrap()
            .statuses
            .instances
            .len(),
        requests.len()
    );
    h.execute(Operation::Collect(true)).unwrap();
    h.execute(Operation::Remove {
        id: PlayerId(2),
        selector: Selector::All,
    })
    .unwrap();
    h.execute(Operation::Drain).unwrap();
    assert!(h
        .sim()
        .player(PlayerId(2))
        .unwrap()
        .statuses
        .instances
        .is_empty());
}
#[test]
fn more_than_initial_capacity_retains_all_tags_and_warms_real_fifo_refolds() {
    let _prof = dhat::Profiler::builder().testing().build();
    let placements: Vec<_> = (0..3)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400. + i as f64 * 60., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut h = Harness::new(Sim::reset_active(
        SimConfig::default(),
        arenas::practice_arena(),
        Secrets::from_seed(7),
        &placements,
    ));
    h.set_observers(false);
    let requests: Vec<_> = (0..24)
        .map(|i| StatusApply {
            kind: StatusKind::SlowAttack,
            source: StatusSource {
                id: Some(PlayerId(1)),
                name: "p0".into(),
                owner_id: None,
            },
            ms: 1000.,
            ability: None,
            tag: Some(StatusTag::from(format!("review-tag-{i}").as_str())),
            value: Some(0.01),
            add: None,
            data: None,
        })
        .collect();
    for i in 0..10 {
        cycle(&mut h, &requests, i as f64 * 50.);
    }
    let before = dhat::HeapStats::get().total_blocks;
    for i in 10..40 {
        cycle(&mut h, &requests, i as f64 * 50.);
    }
    assert_eq!(dhat::HeapStats::get().total_blocks - before, 0);
}
