//! The seat boundary for the competitive netcode checkpoint: a wire command goes in through the room's intake
//! (`RoomCmd::Input`: render-time clamp, observer-reference resolution, `validate`, order budget, input queue) and the test
//! follows it to what the simulation finally did. A `CastStarted`, a launch or an accepted command alone is not an outcome:
//! every test here reads the terminal event (landing, cancel, hit, miss) or the state that event leaves.
//!
//! Every scenario runs twice, with the live runtime profile's `lag_fairness` on and off (`SimConfig` of
//! `runtime::Settings::sim`, DEV-009..012). These are tests of existing behaviour, not a benchmark: nothing here measures
//! performance.

use super::*;
use rh_protocol::WireCommand;
use rh_sim::constants::ORDER_BURST;
use rh_sim::events::Event;
use rh_sim::status_runtime::{AbilityId, CastEndReason, StatusKind};
use rh_sim::{Placement, ProjectileEnd, Vec2, WeaponId};
use std::sync::atomic::Ordering;

const TICK: Duration = Duration::from_millis(50);

/// The live runtime profile's simulation config (the training profile, as `main` builds it for `--runtime training`), made
/// a two-seat duel: real Wish cooldowns, no dummies, `lag_fairness` as asked. Everything else is what the live room runs.
fn live_sim(fair: bool) -> SimConfig {
    let live = crate::runtime::Settings::from_args(&["--runtime".into(), "training".into()])
        .unwrap()
        .unwrap()
        .sim();
    assert!(live.lag_fairness, "the live profile has lag fairness");
    SimConfig {
        lag_fairness: fair,
        training: false,
        dummies: false,
        min_players: 2,
        wish_lock_ms: 0.,
        regen: false,
        ..live
    }
}

fn place(n: u32, faction: FactionId, x: f64, y: f64, weapon: Option<WeaponId>) -> Placement {
    Placement {
        profile: format!("p{n}"),
        faction,
        bot: false,
        at: Vec2::new(x, y),
        hp: None,
        weapon0: weapon,
        weapon1: None,
    }
}

/// Two seated humans in one room, driven by hand on the 50 ms grid, with every event the simulation reported.
struct Rig {
    room: Room,
    now: Instant,
    outs: [Arc<Outbox>; 2],
    player: [PlayerId; 2],
    next_seq: [u32; 2],
    /// (sim time of the step, event), in order.
    log: Vec<(f64, Event)>,
    /// This rig's own counters (the process-wide ones are shared by every test running in parallel).
    metrics: &'static crate::metrics::Metrics,
}

impl Rig {
    fn new(fair: bool, placements: [Placement; 2]) -> Self {
        let assets = MapAssets::new(rh_sim::arenas::practice_arena()).expect("assets");
        let (reports, _rx) = mpsc::unbounded_channel();
        let now = Instant::now();
        let sim = live_sim(fair);
        let room = Room::new(
            [5; 16],
            RoomConfig {
                sim: sim.clone(),
                arena: assets.arena.clone(),
                welcome_map: assets.welcome_map.clone(),
                fill_bots_to: 0,
                tick: TICK,
                record: false,
                fixed_secrets: Some(Secrets::from_seed(7)),
                fixed_bot_seed: None,
                reconnect_grace: Duration::from_secs(10),
                linger: Duration::from_secs(5),
            },
            reports,
            now,
        );
        let metrics: &'static crate::metrics::Metrics =
            Box::leak(Box::new(crate::metrics::Metrics::new()));
        let mut room = room.with_metrics(metrics);
        let outs = [Arc::new(Outbox::default()), Arc::new(Outbox::default())];
        let mut player = [PlayerId(0); 2];
        for i in 0..2 {
            let (reply, mut rx) = oneshot::channel();
            room.handle(
                RoomCmd::Join {
                    profile: format!("p{}", i + 1),
                    faction: None,
                    outbox: outs[i].clone(),
                    conn: i as u64 + 1,
                    fence: 1,
                    reply,
                },
                now,
            );
            player[i] = rx.try_recv().expect("replied").expect("seated").player;
        }
        // The placed duel replaces the lobby sim (the pattern of the room's other tests); the seats are rebound to it.
        room.sim = Sim::reset_active(
            sim,
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(7),
            &placements,
        );
        for h in &mut room.humans {
            h.fx.rebind(&room.sim, h.player);
            h.items = rh_sim::ItemObserver::new(h.player);
        }
        let mut rig = Self {
            room,
            now,
            outs,
            player,
            next_seq: [1; 2],
            log: Vec::new(),
            metrics,
        };
        // One idle wake delivers each seat its first observation (the references a later command may name).
        rig.step();
        rig
    }

    fn step(&mut self) {
        self.now += TICK;
        assert!(self.room.wake(self.now), "the room stays open");
        let at = self.room.sim.server_time();
        let events = self.room.wake_events.clone();
        self.log.extend(events.into_iter().map(|e| (at, e)));
    }

    fn steps(&mut self, n: u32) {
        for _ in 0..n {
            self.step();
        }
    }

    fn input(&mut self, who: usize, commands: Vec<WireCommand>) {
        let seq = self.next_seq[who];
        self.next_seq[who] += 1;
        self.room.handle(
            RoomCmd::Input {
                received: std::time::Instant::now(),
                player: self.player[who],
                conn: who as u64 + 1,
                seq,
                commands,
            },
            self.now,
        );
    }

    fn sample_rtt(&mut self, who: usize, rtt_ms: f64) {
        self.room.handle(
            RoomCmd::RttSample {
                player: self.player[who],
                conn: who as u64 + 1,
                rtt_ms,
            },
            self.now,
        );
    }

    /// The `t` a client with view lag `lag` ms stamps on a command applied by the next step.
    fn stamp(&self, lag: f64) -> f64 {
        self.room.sim.server_time() + 50.0 - lag
    }

    /// The reference seat `who` was delivered for the other seat: read from the Full snapshot the room wrote, never from
    /// the private id.
    fn reference_of_other(&mut self, who: usize) -> u32 {
        let mut raw = Vec::new();
        let _ = self.outs[who].drain_into(&mut raw);
        for frame in raw {
            if let Ok(ServerMsg::Snapshot { actors, .. }) = ServerMsg::decode(&frame) {
                if let Some(a) = actors.first() {
                    return a.id;
                }
            }
        }
        panic!("seat {who} was delivered no remote actor");
    }

    fn pos(&self, who: usize) -> Vec2 {
        self.room.sim.player(self.player[who]).unwrap().core.pos()
    }

    fn hp(&self, who: usize) -> f64 {
        self.room
            .sim
            .player(self.player[who])
            .unwrap()
            .core
            .vitals
            .hp
    }

    fn stunned(&self, who: usize) -> bool {
        let p = self.room.sim.player(self.player[who]).unwrap();
        rh_sim::status_runtime::has(
            &p.core.statuses.instances,
            StatusKind::Stun,
            self.room.sim.server_time(),
        )
    }

    /// The order-budget tokens left (and the sim time they were last refilled at) for seat `who`.
    fn budget(&self, who: usize) -> (f64, f64) {
        self.room
            .sim
            .player(self.player[who])
            .unwrap()
            .seat
            .budget
            .state()
    }
}

fn wish(actor: Option<u32>, t: Option<f64>) -> WireCommand {
    WireCommand::Cast {
        slot: 0,
        x: 0.0,
        y: 0.0,
        actor,
        t,
        seq: None,
    }
}

fn stop(seq: u8) -> WireCommand {
    WireCommand::Stop { seq: Some(seq) }
}

fn press(a: f32, t: Option<f64>) -> WireCommand {
    WireCommand::Attack { a, t }
}

fn release(a: f32) -> WireCommand {
    WireCommand::Release { a, t: None }
}

/// Runs `f` once with lag fairness on (the live profile) and once with it off.
fn both(f: impl Fn(bool)) {
    for fair in [true, false] {
        f(fair);
    }
}

impl Rig {
    /// The (sim time, launch) of every flight `who` launched.
    fn launches(&self, who: usize) -> Vec<(f64, rh_sim::ProjectileLaunch)> {
        self.log
            .iter()
            .filter_map(|(t, e)| match e {
                Event::ProjectileLaunched(l) if l.owner == self.player[who] => Some((*t, *l)),
                _ => None,
            })
            .collect()
    }

    /// The (sim time, damage) of every hit `by` landed on `victim`.
    fn hits(&self, by: usize, victim: usize) -> Vec<(f64, f64)> {
        self.log
            .iter()
            .filter_map(|(t, e)| match e {
                Event::Hit {
                    victim: v,
                    by: Some(b),
                    amount,
                    ..
                } if *v == self.player[victim] && *b == self.player[by] => Some((*t, *amount)),
                _ => None,
            })
            .collect()
    }

    fn swings(&self, who: usize) -> usize {
        self.log
            .iter()
            .filter(|(_, e)| matches!(e, Event::Swing { by, .. } if *by == self.player[who]))
            .count()
    }

    fn windups(&self, who: usize) -> usize {
        self.log
            .iter()
            .filter(|(_, e)| matches!(e, Event::Windup { by, .. } if *by == self.player[who]))
            .count()
    }

    /// The Wish events of seat `who`, in order, as (sim time, name).
    fn wish_events(&self, who: usize) -> Vec<(f64, &'static str)> {
        let me = self.player[who];
        self.log
            .iter()
            .filter_map(|(t, e)| match e {
                Event::CastStarted { id, .. } if *id == me => Some((*t, "started")),
                Event::CastLanded { id, .. } if *id == me => Some((*t, "landed")),
                Event::CastEnded {
                    id,
                    reason: CastEndReason::Fizzle,
                    ..
                } if *id == me => Some((*t, "fizzle")),
                Event::CastEnded {
                    id,
                    reason: CastEndReason::Interrupted,
                    ..
                } if *id == me => Some((*t, "interrupted")),
                Event::CastEnded {
                    id,
                    reason: CastEndReason::Cancelled,
                    ..
                } if *id == me => Some((*t, "cancelled")),
                Event::CastEnded { id, .. } if *id == me => Some((*t, "ended")),
                _ => None,
            })
            .collect()
    }

    fn stun_applied(&self, who: usize) -> Vec<f64> {
        self.log
            .iter()
            .filter_map(|(_, e)| match e {
                Event::StatusApplied {
                    id,
                    kind: StatusKind::Stun,
                    ms,
                    ..
                } if *id == self.player[who] => Some(*ms),
                _ => None,
            })
            .collect()
    }

    /// When seat `who`'s Wish is next ready (sim time).
    fn wish_ready_at(&self, who: usize) -> f64 {
        self.room
            .sim
            .player(self.player[who])
            .unwrap()
            .stocks
            .wish_ready_at
    }

    fn aim(&self, who: usize) -> f64 {
        self.room
            .sim
            .player(self.player[who])
            .unwrap()
            .core
            .weapon
            .aim
    }
}

const FREEZE_COOLDOWN_MS: f64 = 45_000.0;
const FREEZE_STUN_MS: f64 = 1_250.0;

/// A real Wish that lands: the cast starts when the next step applies it, lands exactly `cast_ms` later with its target,
/// stuns that target for the row's duration, and spends the cooldown. Terminal effect, not just `CastStarted`.
#[test]
fn a_wish_that_lands_stuns_its_target_and_spends_the_cooldown() {
    both(|fair| {
        let mut r = Rig::new(
            fair,
            [
                place(1, FactionId::Frost, 300., 260., None),
                place(2, FactionId::Fire, 480., 260., None),
            ],
        );
        let target = r.reference_of_other(0);
        r.input(0, vec![wish(Some(target), None)]);
        r.steps(6);
        let events = r.wish_events(0);
        let started = events[0].0;
        assert_eq!(
            events,
            vec![(started, "started"), (started + 250.0, "landed")],
            "fair {fair}: one start, one landing 250 ms later, no cancel"
        );
        let landed = r.log.iter().find_map(|(_, e)| match e {
            Event::CastLanded {
                ability, target, ..
            } => Some((*ability, *target)),
            _ => None,
        });
        assert_eq!(
            landed,
            Some((AbilityId::Freeze, Some(r.player[1]))),
            "fair {fair}: the wire reference resolved to the seat's opponent"
        );
        assert_eq!(r.stun_applied(1), vec![FREEZE_STUN_MS], "fair {fair}");
        assert!(r.stunned(1), "fair {fair}: the target is stunned");
        assert!(!r.stunned(0), "fair {fair}: the caster is not");
        assert_eq!(
            r.wish_ready_at(0),
            started + FREEZE_COOLDOWN_MS,
            "fair {fair}: the cooldown is spent from the start of the cast"
        );
        r.steps(26);
        assert!(!r.stunned(1), "fair {fair}: the stun ran out after 1250 ms");
        assert_eq!(r.stun_applied(1).len(), 1, "fair {fair}: and only once");
    });
}

/// A Wish cancelled by a stun: both seats cast Freeze at each other, the second a tick later. The first lands and stuns the
/// second mid-cast; the second ends `Interrupted` at that same tick, never lands, never stuns the first, and its cooldown
/// stays spent (every cancel in the sim passes `refund = false`).
#[test]
fn a_wish_cancelled_by_a_stun_ends_interrupted_and_no_effect_lands() {
    both(|fair| {
        let mut r = Rig::new(
            fair,
            [
                place(1, FactionId::Frost, 300., 260., None),
                place(2, FactionId::Frost, 480., 260., None),
            ],
        );
        let at_2 = r.reference_of_other(0);
        let at_1 = r.reference_of_other(1);
        r.input(0, vec![wish(Some(at_2), None)]);
        r.step();
        r.input(1, vec![wish(Some(at_1), None)]);
        r.steps(10);
        let first = r.wish_events(0);
        let second = r.wish_events(1);
        let (s1, s2) = (first[0].0, second[0].0);
        assert_eq!(
            s2,
            s1 + 50.0,
            "fair {fair}: the second cast began a tick later"
        );
        assert_eq!(
            first,
            vec![(s1, "started"), (s1 + 250.0, "landed")],
            "fair {fair}"
        );
        assert_eq!(
            second,
            vec![(s2, "started"), (s1 + 250.0, "interrupted")],
            "fair {fair}: cancelled at the first cast's landing tick, never landed"
        );
        assert_eq!(r.stun_applied(1), vec![FREEZE_STUN_MS], "fair {fair}");
        assert!(
            r.stun_applied(0).is_empty() && !r.stunned(0),
            "fair {fair}: the cancelled cast stunned nobody"
        );
        assert_eq!(
            r.wish_ready_at(1),
            s2 + FREEZE_COOLDOWN_MS,
            "fair {fair}: a cancelled cast keeps its cooldown spent"
        );
    });
}

/// A Wish cancelled by death: the caster is killed in the same step that starts its cast. The cast ends `Cancelled` in the
/// tick of the death, never lands, and nothing is applied to the target. (A two-seat run ends with that death; the checks are
/// on the events of that tick and on the target.)
#[test]
fn a_wish_cancelled_by_death_ends_cancelled_and_no_effect_lands() {
    both(|fair| {
        let mut victim = place(2, FactionId::Frost, 340., 260., None);
        victim.hp = Some(1.0);
        let mut r = Rig::new(
            fair,
            [
                place(1, FactionId::Holy, 300., 260., Some(WeaponId::Sword)),
                victim,
            ],
        );
        let at_1 = r.reference_of_other(1);
        r.input(1, vec![wish(Some(at_1), None)]);
        r.input(0, vec![press(0.0, None)]);
        r.steps(10);
        let events = r.wish_events(1);
        let started = events[0].0;
        assert_eq!(
            events,
            vec![(started, "started"), (started, "cancelled")],
            "fair {fair}: started and cancelled in the tick the sword killed it"
        );
        assert!(
            r.log.iter().any(|(t, e)| *t == started
                && matches!(e, Event::Death { id, by: Some(b), .. } if *id == r.player[1] && *b == r.player[0])),
            "fair {fair}: the death is in that tick"
        );
        assert!(r.stun_applied(0).is_empty() && !r.stunned(0), "fair {fair}");
        assert_eq!(r.hp(1), 0.0, "fair {fair}");
        assert_eq!(r.hits(0, 1).len(), 1, "fair {fair}: one killing swing");
    });
}

#[derive(Debug, PartialEq)]
enum Wished {
    /// No `CastStarted`: refused at intake, no cooldown spent.
    Refused,
    /// `CastStarted`, then `CastEnded(Fizzle)` at the landing: nothing applied, the cooldown spent.
    Fizzled,
    Landed,
}

/// Seat 1 (Frost) casts Freeze at seat 2, a runner leaving at full speed, with a 200 ms view lag (`t`), `before` steps into
/// the run. Returns (distance when the order was queued, outcome).
fn lagged_cast_on_a_runner(fair: bool, before: u32) -> (f64, Wished) {
    let mut r = Rig::new(
        fair,
        [
            place(1, FactionId::Frost, 120., 260., None),
            place(2, FactionId::Fire, 400., 260., None),
        ],
    );
    let target = r.reference_of_other(0);
    let ready_before = r.wish_ready_at(0);
    r.sample_rtt(0, 100.0);
    r.input(
        1,
        vec![WireCommand::Move {
            x: 1400.,
            y: 260.,
            seq: Some(1),
        }],
    );
    r.steps(before + 1);
    let distance = r.pos(1).x - 120.0;
    let t = r.stamp(200.0);
    r.input(0, vec![wish(Some(target), Some(t))]);
    r.steps(8);
    let events = r.wish_events(0);
    let outcome = match events
        .iter()
        .map(|(_, n)| *n)
        .collect::<Vec<_>>()
        .as_slice()
    {
        [] => Wished::Refused,
        ["started", "fizzle"] => Wished::Fizzled,
        ["started", "landed"] => Wished::Landed,
        other => panic!("fair {fair}: unexpected Wish events {other:?}"),
    };
    let spent = r.wish_ready_at(0) != ready_before;
    assert_eq!(
        spent,
        outcome != Wished::Refused,
        "fair {fair}: the cooldown is spent exactly when the cast started ({outcome:?})"
    );
    assert_eq!(
        r.stunned(1),
        outcome == Wished::Landed,
        "fair {fair}: the target is stunned exactly when the cast landed ({outcome:?})"
    );
    (distance, outcome)
}

/// DEV-011 at the seat: a unit Wish is judged at intake AND again at landing against the target rewound by the cast's lag.
/// For a runner leaving at full speed, a 200 ms view lag moves each edge of the Freeze range (450 u + 32 u slack) outward by
/// the same ~26 u and leaves a ~36 u band in which the cast is accepted and then fizzles (cooldown not refunded) -- the band
/// the legacy rule has too, shifted. Table: (steps into the run, distance queued) -> (fair, legacy).
#[test]
fn a_lagged_wish_on_a_runner_lands_fizzles_or_is_refused_by_where_the_runner_was() {
    use Wished::*;
    for (before, near, fair_outcome, legacy_outcome) in [
        (14, 409.0, Landed, Landed),
        (20, 461.0, Landed, Fizzled),
        (25, 505.0, Fizzled, Refused),
        (26, 514.0, Refused, Refused),
    ] {
        let (d_fair, fair) = lagged_cast_on_a_runner(true, before);
        let (d_legacy, legacy) = lagged_cast_on_a_runner(false, before);
        assert!(
            (d_fair - near).abs() < 1.0 && (d_legacy - near).abs() < 1.0,
            "queued at {d_fair} / {d_legacy}, expected about {near}"
        );
        assert_eq!(fair, fair_outcome, "lag_fairness on at {near} u");
        assert_eq!(legacy, legacy_outcome, "lag_fairness off at {near} u");
    }
}

/// Press, then release one tick later, for each weapon class: exactly one attack, and it ends in exactly one hit that takes
/// that much hit point off the target. The release does not undo a draw or a swing already begun, and nothing fires after it.
#[test]
fn a_press_and_a_release_follow_through_to_one_hit_for_each_weapon() {
    both(|fair| {
        for (weapon, gap, ticks) in [
            (WeaponId::Bow, 180.0, 24),
            (WeaponId::Wand, 100.0, 30),
            (WeaponId::Sword, 40.0, 12),
        ] {
            let mut r = Rig::new(
                fair,
                [
                    place(1, FactionId::Holy, 300., 260., Some(weapon)),
                    place(2, FactionId::Fire, 300. + gap, 260., None),
                ],
            );
            let before = r.hp(1);
            r.input(0, vec![press(0.0, None)]);
            r.step();
            r.input(0, vec![release(0.0)]);
            r.steps(ticks);
            let hits = r.hits(0, 1);
            assert_eq!(hits.len(), 1, "fair {fair} {weapon:?}: one hit {hits:?}");
            assert!(hits[0].1 > 0.0, "fair {fair} {weapon:?}");
            assert!(
                (before - r.hp(1) - hits[0].1).abs() < 1e-9,
                "fair {fair} {weapon:?}: the hit is the hit points lost"
            );
            match weapon {
                WeaponId::Sword => {
                    assert_eq!(r.swings(0), 1, "fair {fair}");
                    assert!(r.launches(0).is_empty());
                }
                _ => {
                    let flights = r.launches(0);
                    assert_eq!(
                        flights.len(),
                        1,
                        "fair {fair} {weapon:?}: one shot, none after the release"
                    );
                    assert!(r.log.iter().any(|(_, e)| matches!(
                        e,
                        Event::ProjectileEnded { launch, reason: ProjectileEnd::Hit, .. } if launch.id == flights[0].1.id
                    )));
                }
            }
        }
    });
}

/// Order inside a message is order of arrival: press-then-release fires once (the 150 ms press buffer outlives the release in
/// the same tick); a release alone fires nothing; release-then-press leaves the trigger held and the bow keeps shooting until
/// a later release.
#[test]
fn press_and_release_admission_follows_arrival_order() {
    both(|fair| {
        let rig = || {
            Rig::new(
                fair,
                [
                    place(1, FactionId::Holy, 300., 260., Some(WeaponId::Bow)),
                    place(2, FactionId::Fire, 480., 260., None),
                ],
            )
        };
        let mut r = rig();
        r.input(0, vec![press(0.0, None), release(0.0)]);
        r.steps(30);
        assert_eq!(
            r.launches(0).len(),
            1,
            "fair {fair}: press+release in one message fires once"
        );
        assert_eq!(r.hits(0, 1).len(), 1, "fair {fair}: and it hits");

        let mut r = rig();
        r.input(0, vec![release(0.0)]);
        r.steps(30);
        assert_eq!(
            r.windups(0) + r.swings(0) + r.launches(0).len(),
            0,
            "fair {fair}: a lone release fires nothing"
        );

        let mut r = rig();
        r.input(0, vec![release(0.0), press(0.0, None)]);
        r.steps(40);
        let shots = r.launches(0).len();
        assert!(
            shots >= 2,
            "fair {fair}: release then press stays held and repeats ({shots} shots)"
        );
        r.input(0, vec![release(0.0)]);
        r.steps(3);
        let stopped = r.launches(0).len();
        r.steps(40);
        assert_eq!(
            r.launches(0).len(),
            stopped,
            "fair {fair}: a later release stops the repeating"
        );
    });
}

/// DEV-010 through the intake: the `t` the client stamps reaches the sim (inside the RTT-bounded window), and with lag
/// fairness a shot stamped 200 ms late hits 150 ms (3 ticks) earlier than the same shot without it; at the one-tick baseline
/// both are the same. Same launch, same damage.
#[test]
fn a_stamped_shot_hits_earlier_only_with_lag_fairness() {
    let hit_at = |fair: bool, lag: f64| {
        let mut r = Rig::new(
            fair,
            [
                place(1, FactionId::Holy, 300., 260., Some(WeaponId::Bow)),
                place(2, FactionId::Fire, 480., 260., None),
            ],
        );
        r.sample_rtt(0, 100.0);
        let t = r.stamp(lag);
        r.input(0, vec![press(0.0, Some(t))]);
        r.step();
        r.input(0, vec![release(0.0)]);
        r.steps(24);
        assert_eq!(r.launches(0).len(), 1, "fair {fair} lag {lag}");
        assert_eq!(
            r.room.stats().rewind_clamps,
            0,
            "an honest stamp is not clamped"
        );
        let hits = r.hits(0, 1);
        assert_eq!(hits.len(), 1, "fair {fair} lag {lag}");
        (hits[0].0, hits[0].1)
    };
    assert_eq!(
        hit_at(true, 50.0),
        hit_at(false, 50.0),
        "baseline lag: identical"
    );
    let (on_t, on_dmg) = hit_at(true, 200.0);
    let (off_t, off_dmg) = hit_at(false, 200.0);
    assert_eq!(on_dmg, off_dmg);
    assert_eq!(
        off_t - on_t,
        150.0,
        "caught up (200 - 50) ms: on {on_t}, off {off_t}"
    );
}

/// Ten presses in one message with distinct aims: the order budget charges all ten, the six-action tick queue admits the
/// first six, and the sim does what the sixth said (one shot at its aim). The four after it are dropped silently.
#[test]
fn a_burst_of_presses_in_one_tick_admits_six_and_charges_all_ten() {
    both(|fair| {
        let mut r = Rig::new(
            fair,
            [
                place(1, FactionId::Holy, 300., 260., Some(WeaponId::Bow)),
                place(2, FactionId::Fire, 480., 260., None),
            ],
        );
        assert_eq!(r.budget(0).0, ORDER_BURST);
        r.input(0, (1..=10).map(|k| press(k as f32 * 0.1, None)).collect());
        assert_eq!(
            (
                r.metrics.intake_queue_full.load(Ordering::Relaxed),
                r.metrics.intake_over_budget.load(Ordering::Relaxed),
            ),
            (4, 0),
            "fair {fair}: the four presses past the tick queue are counted, none over budget"
        );
        assert_eq!(
            r.budget(0).0,
            ORDER_BURST - 10.0,
            "fair {fair}: dropped presses were charged too"
        );
        r.steps(12);
        let flights = r.launches(0);
        assert_eq!(flights.len(), 1, "fair {fair}: one draw, one shot");
        let v = flights[0].1.velocity;
        assert!(
            (v.y.atan2(v.x) - 0.6).abs() < 1e-6,
            "fair {fair}: the shot follows the sixth press, not the tenth ({})",
            v.y.atan2(v.x)
        );
    });
}

/// The same six-action cap holds across messages within one tick, and a Wish is an action: a Wish queued behind six presses
/// is dropped, its token spent, while the same Wish alone, or in the next tick, is admitted.
#[test]
fn six_queued_presses_crowd_a_wish_out_of_the_tick() {
    both(|fair| {
        let rig = || {
            let mut r = Rig::new(
                fair,
                [
                    place(1, FactionId::Frost, 300., 260., Some(WeaponId::Bow)),
                    place(2, FactionId::Fire, 480., 260., None),
                ],
            );
            let target = r.reference_of_other(0);
            (r, target)
        };
        // Six presses across two messages, then the Wish: same tick.
        let (mut r, target) = rig();
        r.input(
            0,
            vec![press(0.1, None), press(0.2, None), press(0.3, None)],
        );
        r.input(
            0,
            vec![press(0.4, None), press(0.5, None), press(0.6, None)],
        );
        let ready_before = r.wish_ready_at(0);
        r.input(0, vec![wish(Some(target), None)]);
        assert_eq!(
            r.budget(0).0,
            ORDER_BURST - 7.0,
            "fair {fair}: the dropped Wish was charged"
        );
        r.steps(10);
        assert!(
            r.wish_events(0).is_empty(),
            "fair {fair}: the Wish never started"
        );
        assert_eq!(
            r.wish_ready_at(0),
            ready_before,
            "fair {fair}: and its cooldown is untouched"
        );

        // Control: the Wish alone is admitted.
        let (mut r, target) = rig();
        r.input(0, vec![wish(Some(target), None)]);
        r.steps(10);
        assert_eq!(r.wish_events(0).len(), 2, "fair {fair}: started and landed");

        // The queue is per tick: the dropped Wish, sent again after a step, is admitted.
        let (mut r, target) = rig();
        r.input(0, (1..=6).map(|k| press(k as f32 * 0.1, None)).collect());
        r.input(0, vec![wish(Some(target), None)]);
        r.step();
        r.input(0, vec![wish(Some(target), None)]);
        r.steps(10);
        let events = r.wish_events(0);
        assert_eq!(events.len(), 2, "fair {fair}: {events:?}");
        assert_eq!(events[1].1, "landed");
    });
}

/// Across the order budget (30 tokens, 15 per second, `Aim` free): a drained seat drops a press silently (nothing happens),
/// still turns its aim, and a Release dropped for want of a token leaves the trigger held, so the bow keeps shooting until a
/// Release is admitted once tokens come back.
#[test]
fn an_exhausted_order_budget_drops_presses_and_releases_but_not_aim() {
    both(|fair| {
        let rig = || {
            Rig::new(
                fair,
                [
                    place(1, FactionId::Holy, 300., 260., Some(WeaponId::Bow)),
                    place(2, FactionId::Fire, 480., 260., None),
                ],
            )
        };
        let drain = |r: &mut Rig, n: u8| {
            for chunk in (0..n).collect::<Vec<_>>().chunks(15) {
                r.input(0, chunk.iter().map(|k| stop(*k)).collect());
            }
        };

        // A press with no tokens left is dropped; an Aim in the same tick is not.
        let mut r = rig();
        drain(&mut r, 30);
        assert_eq!(r.budget(0).0, 0.0);
        r.input(0, vec![press(2.5, None), WireCommand::Aim { a: 2.0 }]);
        let m = r.metrics;
        assert_eq!(
            (
                m.intake_over_budget.load(Ordering::Relaxed),
                m.intake_over_budget_trigger.load(Ordering::Relaxed),
                m.intake_queue_full.load(Ordering::Relaxed),
            ),
            (1, 1, 0),
            "fair {fair}: the dropped press is counted, the free Aim is not"
        );
        r.steps(20);
        assert!(r.budget(0).0 < 1.0);
        assert_eq!(
            r.windups(0) + r.swings(0) + r.launches(0).len(),
            0,
            "fair {fair}: the dropped press started nothing"
        );
        assert!(
            (r.aim(0) - 2.0).abs() < 1e-6,
            "fair {fair}: the free Aim turned the seat ({})",
            r.aim(0)
        );

        // Control: with tokens, press + release shoots once and stops.
        let mut r = rig();
        r.input(0, vec![press(0.0, None)]);
        r.step();
        r.input(0, vec![release(0.0)]);
        r.steps(40);
        assert_eq!(r.launches(0).len(), 1, "fair {fair}: control");

        // The press is admitted, then the budget is drained in the tick of the release: the release is dropped.
        let mut r = rig();
        r.input(0, vec![press(0.0, None)]);
        r.step();
        drain(&mut r, 29);
        r.input(0, vec![release(0.0)]);
        assert!(r.budget(0).0 < 1.0, "fair {fair}: {:?}", r.budget(0));
        assert_eq!(
            r.metrics.intake_over_budget_trigger.load(Ordering::Relaxed),
            1,
            "fair {fair}: the dropped release is counted as a press-or-release refusal"
        );
        r.steps(40);
        let shots = r.launches(0).len();
        assert!(
            shots >= 2,
            "fair {fair}: the dropped release left the trigger held ({shots} shots in 2 s)"
        );
        // Tokens return at 15 per second; a release sent then is admitted and ends the repeating.
        r.input(0, vec![release(0.0)]);
        r.steps(4);
        let stopped = r.launches(0).len();
        r.steps(40);
        assert_eq!(
            r.launches(0).len(),
            stopped,
            "fair {fair}: the later release stopped it"
        );
    });
}
