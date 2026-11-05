//! Peak public item load, including a full replacement every tick and all 20 grace batches.
use rh_sim::{
    arenas::practice_arena, ContainerKind, FactionId, ItemObserver, Observation, OfferError,
    Placement, PlayerId, Secrets, Sim, SimConfig, Vec2, WeaponId, MAX_VISIBLE_PROPS,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

fn rack(count: usize, x: f64) -> Sim {
    let ps = [
        Placement {
            profile: "Ása".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(100., 272.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "other".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(1300., 272.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut s = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(4),
        &ps,
    );
    for i in 0..count {
        s.seed_weapon_container(
            ContainerKind::Body(PlayerId(1)),
            Vec2::new(x + (i % 32) as f64, 272.),
            &[WeaponId::Sword, WeaponId::Axe],
        )
        .unwrap();
    }
    s
}

#[test]
fn bounded_maximum_load_allocates_nothing_after_warmup() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let mut worlds = [rack(MAX_VISIBLE_PROPS, 105.), rack(MAX_VISIBLE_PROPS, 106.)];
    let mut seat = ItemObserver::new(PlayerId(1));
    let mut out = Observation::default();
    let mut ev = Vec::new();
    for i in 0..85 {
        // Two deterministic layouts emulate a single publicly moving prop rack. Same increasing tick,
        // viewer and physical ids; every sample must replace its entire visibly changed offer.
        for world in &mut worlds {
            ev.clear();
            #[cfg(feature = "schedule-trace")]
            world.clear_schedule_trace();
            world.step_into(&mut ev);
        }
        let before = dhat::HeapStats::get().total_blocks;
        seat.observe_into(&worlds[i % 2], &[], &mut out, None)
            .unwrap();
        let allocated = dhat::HeapStats::get().total_blocks - before;
        assert_eq!(out.props.len(), MAX_VISIBLE_PROPS);
        assert_eq!(
            out.props[0].handle.get(),
            (i * MAX_VISIBLE_PROPS + 1) as u32
        );
        if i >= 24 {
            assert_eq!(allocated, 0, "full offer at tick {i}");
        }
    }
    let oversized = rack(MAX_VISIBLE_PROPS + 1, 105.);
    let mut seat = ItemObserver::new(PlayerId(1));
    assert_eq!(
        seat.observe_into(&oversized, &[], &mut out, None),
        Err(OfferError::TooManyProps)
    );
    seat.observe_into(&worlds[0], &[], &mut out, None).unwrap();
    assert_eq!(
        out.props[0].handle.get(),
        1,
        "failed sample must not consume any handles"
    );
}
