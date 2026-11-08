//! P-NET-1 Phase 3: a connection's attack render time is bounded by the RTT the **server** measured for it.
//!
//! These tests drive a real [`Room`] by hand (`wake` on the 50 ms grid), so the clamp is exercised exactly where production
//! puts it: `RoomCmd::Input`, after the incoming command is decoded and before `Sim::submit`. Positions, hit points and the
//! weapon's recorded `lag_ms` are read from the room's own simulation; the RTT samples are injected through
//! `RoomCmd::RttSample`, the same command the connection reader sends for a real Pong.

use rh_protocol::WireCommand;
use rh_server::outbox::Outbox;
use rh_server::room::{JoinOk, MapAssets, Room, RoomCmd, RoomConfig};
use rh_sim::{Arena, Phase, PlayerId, SimConfig, TileMap, Vec2};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

const TICK: Duration = Duration::from_millis(50);

/// A 24x24 walled room, open inside. The two spawns put the attacker 54 u west of the target: inside the fists' 72 u reach
/// (+ the 12 u player radius) while the target is at its spawn.
fn arena() -> Arena {
    let rows: Vec<String> = (0..24)
        .map(|y| {
            (0..24)
                .map(|x| {
                    if x == 0 || y == 0 || x == 23 || y == 23 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: vec![Vec2::new(336.0, 336.0), Vec2::new(390.0, 336.0)],
    }
}

fn sim_config() -> SimConfig {
    SimConfig {
        abilities: rh_sim::abilities::Mode::Off,
        wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
        lifecycle: rh_sim::ArenaMode::Off,
        hazards: rh_sim::terrain::Mode::Off,
        mob_mode: rh_sim::mob_runtime::MobMode::Off,
        initial_loot: false,
        min_players: 2,
        lobby_seconds: 30.0,
        fill_seconds: 0.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
        // The integration base added SimConfig fields (collections, training, quests, ...): keep their defaults.
        ..Default::default()
    }
}

/// A room driven by hand: one 50 ms step per [`Hand::step`], no wall-clock waiting.
struct Hand {
    room: Room,
    now: Instant,
}

impl Hand {
    fn new() -> Self {
        let assets = MapAssets::new(arena()).expect("assets");
        let (tx, _reports) = mpsc::unbounded_channel();
        let now = Instant::now();
        let cfg = RoomConfig {
            sim: sim_config(),
            arena: assets.arena.clone(),
            welcome_map: assets.welcome_map.clone(),
            fill_bots_to: 0,
            tick: TICK,
            record: false,
            fixed_secrets: Some(rh_sim::Secrets::from_seed(7)),
            fixed_bot_seed: None,
            reconnect_grace: Duration::from_secs(10),
            linger: Duration::from_secs(5),
        };
        Self {
            room: Room::new([3; 16], cfg, tx, now),
            now,
        }
    }

    fn join(&mut self, profile: &str, conn: u64) -> JoinOk {
        let (reply, mut rx) = oneshot::channel();
        self.room.handle(
            RoomCmd::Join {
                profile: profile.into(),
                faction: None,
                outbox: Arc::new(Outbox::default()),
                conn,
                fence: 1,
                reply,
            },
            self.now,
        );
        rx.try_recv().expect("replied").expect("seated")
    }

    fn resume(&mut self, session: [u8; 16], conn: u64) -> JoinOk {
        let (reply, mut rx) = oneshot::channel();
        self.room.handle(
            RoomCmd::Resume {
                session,
                outbox: Arc::new(Outbox::default()),
                conn,
                reply,
            },
            self.now,
        );
        rx.try_recv().expect("replied").expect("resumed")
    }

    fn sample(&mut self, player: PlayerId, conn: u64, rtt_ms: f64) {
        self.room.handle(
            RoomCmd::RttSample {
                player,
                conn,
                rtt_ms,
            },
            self.now,
        );
    }

    fn input(&mut self, player: PlayerId, conn: u64, seq: u32, commands: Vec<WireCommand>) {
        self.room.handle(
            RoomCmd::Input {
                player,
                conn,
                seq,
                commands,
            },
            self.now,
        );
    }

    fn step(&mut self) {
        self.now += TICK;
        assert!(self.room.wake(self.now), "the room stays open");
    }

    fn pos(&self, player: PlayerId) -> Vec2 {
        self.room
            .sim()
            .player(player)
            .expect("a seated player")
            .core
            .pos()
    }

    fn hp(&self, player: PlayerId) -> f64 {
        self.room
            .sim()
            .player(player)
            .expect("a seated player")
            .core
            .vitals
            .hp
    }

    fn lag_ms(&self, player: PlayerId) -> f64 {
        self.room
            .sim()
            .player(player)
            .expect("a seated player")
            .core
            .weapon
            .lag_ms
    }
}

/// Two seated humans, past the lobby: the first is the attacker, the second the (moving) target.
fn two_players() -> (Hand, JoinOk, JoinOk) {
    let mut h = Hand::new();
    let attacker = h.join("attacker", 1);
    let target = h.join("target", 2);
    h.step();
    assert_eq!(h.room.sim().phase(), Phase::Active, "the run started");
    (h, attacker, target)
}

fn distance(a: Vec2, b: Vec2) -> f64 {
    let (dx, dy) = (a.x - b.x, a.y - b.y);
    (dx * dx + dy * dy).sqrt()
}

/// The position `position_at` would interpolate from the tick samples this test recorded (the same linear rule).
fn recorded_at(history: &[(f64, Vec2)], t: f64) -> Vec2 {
    assert!(
        history.len() >= 2 && history[0].0 <= t && t <= history[history.len() - 1].0,
        "the rewind time {t} is inside the recorded history"
    );
    let i = history.iter().rposition(|(at, _)| *at <= t).unwrap();
    let (t0, p0) = history[i];
    let (t1, p1) = history[i + 1];
    let k = (t - t0) / (t1 - t0);
    Vec2::new(p0.x + (p1.x - p0.x) * k, p0.y + (p1.y - p0.y) * k)
}

/// At 150 ms RTT the packet's formula allows `150 / 2 + 100 + 50 = 225` ms of rewind. A target that has walked out of the
/// fists' reach by the time the swing lands is still hit against its body at that bound, and the attack is not clamped.
#[test]
fn a_150ms_connection_hits_a_moving_target_at_the_225ms_bound() {
    let (mut h, attacker, target) = two_players();
    // A real Pong path measured 150 ms (tests/transport.rs covers the measurement itself); the room's estimator is the
    // only thing between the sample and the clamp.
    h.sample(attacker.player, 1, 150.0);
    let stats = h.room.stats();
    assert_eq!(stats.rtt_samples, 1);
    assert_eq!(stats.rtt_last_ms, 150.0);
    assert_eq!(stats.rewind_clamps, 0);

    let attacker_at = h.pos(attacker.player);
    let spawn = h.pos(target.player);
    let mut history = vec![(h.room.sim().server_time(), spawn)];

    // The target walks north, across the attacker's front. It travels ~8.5 u per tick.
    h.input(
        target.player,
        2,
        1,
        vec![WireCommand::Move {
            x: spawn.x as f32,
            y: 700.0,
            seq: Some(1),
        }],
    );
    loop {
        h.step();
        let at = h.room.sim().server_time();
        let pos = h.pos(target.player);
        history.push((at, pos));
        let walked = pos.y - spawn.y;
        assert!(walked < 200.0, "the press distance was reached");
        if walked >= 80.0 {
            break;
        }
    }

    // The next step will apply the command; the sim adds TICK_MS before its input phase, so `now_apply` is one tick ahead.
    let now_apply = h.room.sim().server_time() + 50.0;
    let allowed_ms = 225.0;
    let t = now_apply - allowed_ms;
    let aim = recorded_at(&history, t);
    let aim_distance = distance(attacker_at, aim);
    let current_distance = distance(attacker_at, h.pos(target.player));
    assert!(
        aim_distance < 84.0,
        "the rewound body is inside the fists' reach (+player radius): {aim_distance}"
    );
    assert!(
        current_distance > 84.0,
        "without the rewind the target is out of reach: {current_distance}"
    );
    let angle = (aim.y - attacker_at.y).atan2(aim.x - attacker_at.x);
    let hp_before = h.hp(target.player);

    h.input(
        attacker.player,
        1,
        1,
        vec![WireCommand::Attack {
            a: angle as f32,
            t: Some(t),
        }],
    );
    h.step();

    assert!(
        h.hp(target.player) < hp_before,
        "the hit lands at the 225 ms bound (hp {} -> {})",
        hp_before,
        h.hp(target.player)
    );
    assert_eq!(
        h.lag_ms(attacker.player),
        allowed_ms,
        "note_lag recorded the full 225 ms window at the bound"
    );
    let stats = h.room.stats();
    assert_eq!(
        stats.rewind_clamps, 0,
        "an honest t at the bound is not clamped"
    );
    assert_eq!(stats.rtt_last_ms, 150.0);
}

/// At 20 ms RTT the formula allows `20 / 2 + 100 + 50 = 160` ms. A forged `t = now - 300` is clamped to the oldest edge
/// (`now_apply - 160`, i.e. 110 ms before the current sim time) and counted once. A future `t` is clamped to `now_apply`
/// (and `note_lag` then floors the lag at `TICK_MS`); an inside `t` is untouched and not counted.
#[test]
fn a_forged_old_render_time_at_20ms_rtt_is_clamped_and_counted() {
    let (mut h, attacker, _target) = two_players();
    h.sample(attacker.player, 1, 20.0);
    assert_eq!(
        h.room.stats().rtt_last_ms,
        20.0,
        "the estimator floor keeps a 20 ms sample at 20 ms"
    );

    let now = h.room.sim().server_time();
    h.input(
        attacker.player,
        1,
        1,
        vec![WireCommand::Attack {
            a: 0.0,
            t: Some(now - 300.0),
        }],
    );
    h.step();
    assert_eq!(
        h.room.stats().rewind_clamps,
        1,
        "the forged old t is counted"
    );
    assert_eq!(
        h.lag_ms(attacker.player),
        160.0,
        "300 ms was clamped to the 160 ms the 20 ms RTT allows"
    );

    let now = h.room.sim().server_time();
    h.input(
        attacker.player,
        1,
        2,
        vec![WireCommand::Attack {
            a: 0.0,
            t: Some(now + 1_000.0),
        }],
    );
    h.step();
    assert_eq!(h.room.stats().rewind_clamps, 2, "a future t is counted too");
    assert_eq!(
        h.lag_ms(attacker.player),
        50.0,
        "clamped to now_apply; note_lag's TICK_MS floor"
    );

    let now_apply = h.room.sim().server_time() + 50.0;
    h.input(
        attacker.player,
        1,
        3,
        vec![WireCommand::Attack {
            a: 0.0,
            t: Some(now_apply - 150.0),
        }],
    );
    h.step();
    assert_eq!(
        h.room.stats().rewind_clamps,
        2,
        "a t inside the 160 ms window costs nothing"
    );
    assert_eq!(h.lag_ms(attacker.player), 150.0);
}

/// Locked attacks carry no `t`; they keep the sim's `lagMs = TICK_MS` and never touch the clamp counter.
#[test]
fn a_locked_attack_without_a_render_time_keeps_the_tick_ms_lag() {
    let (mut h, attacker, _target) = two_players();
    h.input(
        attacker.player,
        1,
        1,
        vec![WireCommand::Attack { a: 0.0, t: None }],
    );
    h.step();
    assert_eq!(h.lag_ms(attacker.player), 50.0);
    assert_eq!(h.room.stats().rewind_clamps, 0);

    h.sample(attacker.player, 1, 150.0);
    h.input(
        attacker.player,
        1,
        2,
        vec![WireCommand::Attack { a: 0.0, t: None }],
    );
    h.step();
    assert_eq!(h.lag_ms(attacker.player), 50.0, "still the TICK_MS rule");
    assert_eq!(h.room.stats().rewind_clamps, 0);
}

/// A resume is a new path for the same seat: the estimator is fresh (the new connection's first sample *is* the
/// estimate, not an EWMA blended with the old connection's), and a late `RttSample` naming the replaced connection is
/// ignored. These are room-level samples injected through `RoomCmd::RttSample`, not a measured network experiment; the
/// room's stats counters show exactly which samples were accepted.
#[test]
fn a_resume_resets_the_rtt_estimator_and_ignores_the_old_connections_samples() {
    let mut h = Hand::new();
    let seat = h.join("resumer", 1);
    h.sample(seat.player, 1, 200.0);
    let stats = h.room.stats();
    assert_eq!((stats.rtt_samples, stats.rtt_last_ms), (1, 200.0));

    let resumed = h.resume(seat.session, 2);
    assert_eq!(resumed.player, seat.player, "the resume keeps the seat");

    // A late Pong from the connection the resume replaced is ignored, not folded into the fresh estimator.
    h.sample(seat.player, 1, 20.0);
    let stats = h.room.stats();
    assert_eq!(
        (stats.rtt_samples, stats.rtt_last_ms),
        (1, 200.0),
        "a replaced connection's sample is ignored"
    );

    // The first sample from the new connection is the estimate itself. An inherited 200 ms EWMA would give 160 ms for
    // this 40 ms sample; a fresh estimator gives 40 ms.
    h.sample(seat.player, 2, 40.0);
    let stats = h.room.stats();
    assert_eq!(
        (stats.rtt_samples, stats.rtt_last_ms),
        (2, 40.0),
        "the resumed connection's first sample is the estimate"
    );

    // The new estimator then smooths normally, and the replaced connection stays ignored.
    h.sample(seat.player, 2, 20.0);
    assert_eq!(
        h.room.stats().rtt_last_ms,
        35.0,
        "0.25 * 20 + 0.75 * 40 = 35"
    );
    h.sample(seat.player, 1, 150.0);
    let stats = h.room.stats();
    assert_eq!(
        (stats.rtt_samples, stats.rtt_last_ms),
        (3, 35.0),
        "the replaced connection never contributes again"
    );
}
