//! P-BOT-BRAIN-RECONCILE-1: the seat fence (`SeatComposer14`) refuses a stale frame without touching the fence or the
//! composer, and the derived `self.mobKills` counts only the seat's own credited deaths of delivered regional mobs.
use super::super::trace::BVal;
use super::{Composer14, SeatComposer14, Setup14};
use crate::bots::types::TierId;
use crate::bots::view::Features;
use crate::delivery::{AcceptedFrame14, DeliverySession};
use crate::InputRefusal;
use rh_sim::observe::{ActorKind, SeenEvent};
use rh_sim::{
    FactionId, ItemObserver, Observation, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2,
    WeaponId,
};

const OWNER: PlayerId = PlayerId(1);
const ENEMY: PlayerId = PlayerId(2);

fn sim() -> Sim {
    let at = |profile: &str, faction, x: f64| Placement {
        profile: profile.into(),
        faction,
        bot: false,
        at: Vec2::new(x, 272.),
        hp: None,
        weapon0: Some(WeaponId::Wand),
        weapon1: None,
    };
    Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[
            at("owner", FactionId::Fire, 300.),
            at("other", FactionId::Holy, 440.),
        ],
    )
}

fn scene(sim: &Sim, time: f64, tick: u32) -> Observation {
    let mut obs = Observation::default();
    ItemObserver::new(OWNER)
        .prepare_into(sim, &[], &mut obs, None)
        .expect("owner scene")
        .commit();
    obs.tick = tick;
    obs.server_time = time;
    obs.arena = Some(rh_sim::ArenaView {
        lobby_ends_at: 0.,
        plan_ends_at: 0.,
        raid_started_at: 500.,
        patience_ends_at: Some(60_000.),
        in_coliseum: false,
        gates_locked: false,
        sudden_death_at: 0.,
        started_with: 2,
    });
    obs
}

fn setup(sim: &Sim) -> Setup14 {
    Setup14::public(
        sim.shared_arena(),
        Features {
            message_types: ["move", "stop", "target", "attack"]
                .map(String::from)
                .to_vec(),
            ..Features::default()
        },
        0.6,
    )
}

fn accept(session: &mut DeliverySession, obs: &Observation) -> AcceptedFrame14 {
    let prepared = session.prepare(obs, true, true, &[]).expect("scene");
    session.commit(prepared)
}

#[test]
fn a_stale_frame_is_refused_at_the_seat_and_leaves_fence_and_composer_untouched() {
    let sim = sim();
    let mut session = DeliverySession::new(OWNER);
    let frames: Vec<AcceptedFrame14> = [(1000., 20), (1050., 21), (1100., 22)]
        .into_iter()
        .map(|(t, tick)| accept(&mut session, &scene(&sim, t, tick)))
        .collect();
    let mut seat = SeatComposer14::new(OWNER, TierId::Hard, setup(&sim));
    assert!(seat.compose(&frames[0]).expect("first").is_some());
    // The same accepted frame again: refused before anything changes.
    assert_eq!(
        seat.compose(&frames[0]).err(),
        Some(InputRefusal::ClockResetRequired)
    );
    assert_eq!(
        seat.check(frames[0].frame()),
        Err(InputRefusal::ClockResetRequired)
    );
    let second = seat.compose(&frames[1]).expect("second").expect("owner");
    let third = seat.compose(&frames[2]).expect("third").expect("owner");
    // A composer that never saw the refused frame composes the same records.
    let mut clean = Composer14::new(setup(&sim));
    clean.compose(frames[0].frame()).expect("first");
    assert_eq!(second, clean.compose(frames[1].frame()).expect("second"));
    assert_eq!(third, clean.compose(frames[2].frame()).expect("third"));
    assert!(third.covered, "100 ms of history covers the view time");
}

#[test]
fn mob_kills_count_only_the_seats_own_credited_deaths_of_delivered_mobs() {
    let sim = sim();
    let mut composer = Composer14::new(Setup14 {
        world_delay_ms: 0.,
        ..setup(&sim)
    });
    let mut session = DeliverySession::new(OWNER);
    let mob = |obs: &Observation, id: u32| {
        let mut a = obs
            .visible
            .iter()
            .find(|a| a.id == ENEMY)
            .expect("enemy")
            .clone();
        a.id = PlayerId(id);
        a.kind = ActorKind::Regional;
        a.mob_type = Some(rh_sim::mob_catalog::MobTypeId::ALL[0]);
        a.x = 360.;
        a
    };
    let mut kills = Vec::new();
    for (i, (by, delivered)) in [
        (Some(OWNER), true),  // credited and drawn: counts
        (Some(ENEMY), true),  // another killer: does not
        (Some(OWNER), false), // the dead row was not delivered: not seen, not counted
        (None, true),         // no killer: does not
    ]
    .into_iter()
    .enumerate()
    {
        let mut obs = scene(&sim, 1000. + 50. * i as f64, 20 + i as u32);
        let id = 0x8000_0100 + i as u32;
        if delivered {
            let row = mob(&obs, id);
            obs.visible.push(row);
        }
        obs.events.push(SeenEvent::Death {
            id: PlayerId(id),
            by,
        });
        let raw = composer
            .compose(accept(&mut session, &obs).frame())
            .expect("composes")
            .percept
            .raw;
        kills.push(raw.get("self").and_then(|s| s.get("mobKills")).cloned());
    }
    let n = |v: f64| Some(BVal::num(v));
    assert_eq!(kills, [n(1.), n(1.), n(1.), n(1.)]);
}
