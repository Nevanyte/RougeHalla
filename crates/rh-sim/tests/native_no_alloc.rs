//! P-AUG-NATIVE-1b oracle: the native hook dispatch and the own-only readout producer allocate nothing in a warmed
//! Rework tick (brief `docs/backlog/packets/P-AUG-NATIVE-1b.md` section 7, "Zero allocations per step").
//!
//! A Marksman's Tally bow shoots a target at 0.92 of its range (long-range hits, hit counts) and a Bastion shield is
//! bashed and bashes back (blocks, meter fill and burst) while the steps and every player's readouts are counted on this
//! thread (after a 300-tick warm-up; a tick that resolves a death is left out, as in `no_alloc.rs`). The window must
//! also have exercised the hooks: the Tally earned stacks in it.
use rh_sim::arenas::practice_arena;
use rh_sim::cards::native::readouts;
use rh_sim::cards::CardId;
use rh_sim::content::{weapon, Shape};
use rh_sim::{
    validate, AugmentRule, Event, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim,
    SimConfig, Vec2, WeaponId,
};
use serde_json::json;

#[global_allocator]
static ALLOC: rh_alloc_count::CountingAlloc = rh_alloc_count::CountingAlloc;

fn seat(profile: &str, at: Vec2, w: WeaponId) -> Placement {
    Placement {
        profile: profile.into(),
        faction: FactionId::Holy,
        bot: false,
        at,
        hp: None,
        weapon0: Some(w),
        weapon1: None,
    }
}

fn native_row(card: CardId) -> serde_json::Value {
    json!([{"card": card.as_str(), "count": 1, "counter": 0.0, "meters": [0.0, 0.0, 0.0], "marks": 0}])
}

fn tally(sim: &Sim) -> f64 {
    sim.players()[0]
        .build
        .native()
        .slot(CardId::MarksmansTally)
        .unwrap()
        .counter
}

#[test]
fn native_hooks_and_readouts_allocate_nothing_in_a_warmed_tick() {
    let range = match weapon(WeaponId::Bow).shape {
        Shape::Projectile { range, .. } => range,
        Shape::Arc { .. } => unreachable!("the bow is a projectile weapon"),
    };
    let lane = Vec2::new(100., 272.);
    let shield = Vec2::new(300., 400.);
    let base = Sim::reset_active(
        SimConfig {
            augments: AugmentRule::Rework,
            ..SimConfig::default()
        },
        practice_arena(),
        Secrets::from_seed(5),
        &[
            seat("tally", lane, WeaponId::Bow),
            seat(
                "target",
                Vec2::new(lane.x + range * 0.92, lane.y),
                WeaponId::Sword,
            ),
            seat("bastion", shield, WeaponId::Shield),
            seat(
                "basher",
                Vec2::new(shield.x + 60., shield.y),
                WeaponId::Shield,
            ),
        ],
    );
    let mut cp = serde_json::to_value(&base).unwrap();
    cp["world"]["players"][0]["build"]["native"] = native_row(CardId::MarksmansTally);
    cp["world"]["players"][2]["build"]["native"] = native_row(CardId::Bastion);
    let mut sim = Sim::restore(&cp).expect("a Rework world holding two native cards restores");
    let send = |sim: &mut Sim, id: u32, raw: RawCommand| {
        let _ = sim.submit(PlayerId(id), validate(raw).unwrap());
    };
    send(&mut sim, 3, RawCommand::Aim { a: 0. });
    let viewers = [1, 2, 3, 4, 99].map(PlayerId);
    let mut events = Vec::with_capacity(512);
    let mut rows = 0usize;
    let (mut used, mut steady) = (0u64, 0u32);
    let mut after_warm_up = 0.;
    for t in 0..600u32 {
        // Player 1 shoots east every 20 ticks; player 4 bashes the Bastion holder every 16; the holder bashes back every
        // 60 (spending its meter). Commands are submitted outside the counted section.
        let cmds = [
            (1, t % 20 == 0, t % 20 == 1, 0.),
            (4, t % 16 == 0, t % 16 == 1, std::f64::consts::PI),
            (3, t % 60 == 59, t % 60 == 0 && t > 0, 0.),
        ];
        for (id, press, release, a) in cmds {
            if press {
                send(&mut sim, id, RawCommand::Attack { a, t: None });
            }
            if release {
                send(&mut sim, id, RawCommand::Release { a, t: None });
            }
        }
        events.clear();
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        let ((), n) = rh_alloc_count::blocks_on_this_thread(|| {
            sim.step_into(&mut events);
            for v in viewers {
                rows += readouts(&sim, v).rows().len();
            }
        });
        if t == 299 {
            after_warm_up = tally(&sim);
        }
        // A death resolves a run (its result record allocates on the base too, as `no_alloc.rs` excludes it).
        let ends_a_run = events.iter().any(|e| {
            matches!(
                e,
                Event::Death { .. } | Event::Resolved { .. } | Event::Victory { .. }
            )
        });
        if t >= 300 && !ends_a_run {
            steady += 1;
            used += n;
        }
    }
    assert!(steady >= 290, "{steady} steady ticks counted");
    assert_eq!(used, 0, "heap blocks in {steady} warmed native ticks");
    assert!(
        tally(&sim) > after_warm_up,
        "the Tally earned stacks in the counted window ({after_warm_up} -> {})",
        tally(&sim)
    );
    assert!(rows > 0, "the holders' readouts had rows");
}
