#![cfg(feature = "trusted-status-probes")]
//! Measured native helper work uses the real FIFO/displacement/state owners, with observations disabled.
//! Ordinary scheduled allocation coverage remains tests/no_alloc.rs; fixture reporting is intentionally allocating.
use rh_sim::{
    status_runtime::{probe::*, *},
    FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;
fn harness() -> Harness {
    let ps = (0..3)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400. + i as f64 * 56., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect::<Vec<_>>();
    let mut h = Harness::new(Sim::reset_active(
        SimConfig::default(),
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(8),
        &ps,
    ));
    h.set_observers(false);
    h
}
fn request() -> StatusApply {
    StatusApply {
        kind: StatusKind::Shred,
        source: StatusSource {
            id: Some(PlayerId(1)),
            name: "p0".into(),
            owner_id: None,
        },
        ms: 100.,
        ability: None,
        tag: Some(StatusTag::Axe),
        value: Some(3.),
        add: None,
        data: None,
    }
}
fn pulse(h: &mut Harness, a: &StatusApply, now: f64) {
    h.clear_schedule_trace();
    h.execute(Operation::Clock {
        at: now,
        tick: (now / 50.) as u32,
    })
    .unwrap();
    // Stale reuse keeps the existing table slot and handles, then removal followed by fresh application reuses capacity.
    h.execute(Operation::Apply {
        id: PlayerId(2),
        apply: a.clone(),
        quiet: true,
    })
    .unwrap();
    h.execute(Operation::Collect(true)).unwrap();
    h.execute(Operation::Remove {
        id: PlayerId(2),
        selector: Selector::All,
    })
    .unwrap();
    h.execute(Operation::Apply {
        id: PlayerId(2),
        apply: a.clone(),
        quiet: true,
    })
    .unwrap();
    h.execute(Operation::Displace {
        id: PlayerId(2),
        to: Vec2::new(450., 400.),
    })
    .unwrap();
    h.execute(Operation::Drain).unwrap();
}
#[test]
fn warmed_removal_fresh_reapply_stale_reuse_and_queued_displace_allocate_nothing() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let a = request();
    let mut h = harness();
    h.execute(Operation::Actor {
        id: PlayerId(2),
        patch: ActorPatch {
            path: Some(vec![Vec2::new(550., 400.)]),
            ..Default::default()
        },
    })
    .unwrap();
    for i in 0..10 {
        pulse(&mut h, &a, i as f64 * 200.);
    }
    let before = dhat::HeapStats::get().total_blocks;
    for i in 10..30 {
        pulse(&mut h, &a, i as f64 * 200.);
    }
    let used = dhat::HeapStats::get().total_blocks - before;
    assert_eq!(used, 0, "warmed status/FIFO/pathfinder cycle");
    // Restore can shrink vectors to serialized lengths; warm every real path before measuring again.
    h.execute(Operation::Step).unwrap();
    let checkpoint = serde_json::to_value(h.sim()).unwrap();
    let mut h = Harness::new(Sim::restore(checkpoint).unwrap());
    h.set_observers(false);
    for i in 30..40 {
        pulse(&mut h, &a, i as f64 * 200.);
    }
    let before = dhat::HeapStats::get().total_blocks;
    for i in 40..60 {
        pulse(&mut h, &a, i as f64 * 200.);
    }
    let used = dhat::HeapStats::get().total_blocks - before;
    assert_eq!(used, 0, "restored warmed cycle");
    let mut h = harness();
    let source = a.source.clone();
    let mut events = Vec::with_capacity(256);
    for _ in 0..16 {
        scheduled_field_cycle(&mut h, &source, &mut events);
    }
    let before = dhat::HeapStats::get().total_blocks;
    for _ in 0..20 {
        scheduled_field_cycle(&mut h, &source, &mut events);
    }
    let used = dhat::HeapStats::get().total_blocks - before;
    assert_eq!(
        used, 0,
        "scheduled field contacts, DoT ledger and public FX"
    );
}

fn scheduled_field_cycle(h: &mut Harness, source: &StatusSource, out: &mut Vec<rh_sim::Event>) {
    h.clear_schedule_trace();
    out.clear();
    let now = h.sim().server_time();
    let f = Field {
        id: 0,
        kind: FieldKind::Trail,
        ability: AbilityId::Blaze,
        owner: source.clone(),
        subject: None,
        x: 450.,
        y: 400.,
        x2: 550.,
        y2: 400.,
        r: 20.,
        vx: 0.,
        vy: 0.,
        started_at: now,
        ends_at: now + 1000.,
        exit_stun_ms: None,
    };
    let Returned::Field(Some(field)) = h.execute(Operation::AddField(f)).unwrap() else {
        panic!("field")
    };
    h.step_into(out);
    h.execute(Operation::RemoveField(field.id)).unwrap();
}
