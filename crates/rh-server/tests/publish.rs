//! The publish path (docs/CONTRACTS.md C-OBS, C-NET): the frames the room sends are byte-identical to the message encoding of
//! the observation on every single-step wake, and a wake that runs several steps delivers each step's events as that step
//! saw them.

use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::scripted::Brawler;
use rh_protocol::{ServerMsg, WireEvent, WireFx};
use rh_server::outbox::Outbox;
use rh_server::room::{JoinOk, MapAssets, Room, RoomCmd, RoomConfig};
use rh_server::wire::{self, Publisher};
use rh_sim::arenas::practice_arena;
use rh_sim::observe::{Observation, SeenEvent};
use rh_sim::{
    validate, Command, Event, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig,
    Vec2,
};

/// A command through the one door in (C-INPUT): these tests only use valid ones.
fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

fn seed1_match(ticks: u32) -> Env {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/maps/seed1.map.json"
    );
    let arena = rh_headless::load_arena(path).expect("seed-1 map");
    let agents = (0..8)
        .map(|i| AgentSpec {
            profile: format!("b{i}"),
            faction: FactionId::ALL[i % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Brawler::new(2)),
            },
        })
        .collect();
    Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks: ticks,
            record: false,
        },
        agents,
        1,
    )
}

/// The frames of `obs` the long way: message structs, `ServerMsg::encode`, event lists written out by hand. Independent of
/// the publisher's streamed encoding and of its use of the declared event classes.
fn reference(
    obs: &Observation,
    ack: u32,
    viewer: PlayerId,
    all: &[Event],
) -> (Option<Vec<u8>>, Option<Vec<u8>>, Vec<u8>) {
    let mut events = Vec::new();
    let mut fx = Vec::new();
    for e in &obs.events {
        match *e {
            // Protocol 8: the teleport is the room-wide Teleport fx; the owner's deal rides State key 8, not events.
            SeenEvent::Teleported => fx.push(WireFx::Teleport),
            SeenEvent::Plan(_) => {}
            SeenEvent::CastStarted { .. } | SeenEvent::CastLanded { .. } => {
                panic!("protocol 8 reference encoder does not support Full Wish events")
            }
            SeenEvent::PotionNotice { notice } => events.push(WireEvent::PotionNotice {
                notice: match notice {
                    rh_sim::potions::Notice::Stored => 1,
                    rh_sim::potions::Notice::BagFull => 2,
                    rh_sim::potions::Notice::Used => 3,
                    rh_sim::potions::Notice::Blocked => 4,
                    rh_sim::potions::Notice::Busy => 5,
                    rh_sim::potions::Notice::Full => 6,
                    rh_sim::potions::Notice::Empty => 7,
                },
            }),
            SeenEvent::CannonNotice { notice } => events.push(WireEvent::CannonNotice {
                code: match notice {
                    rh_sim::events::CannonNotice::Sealed => 1,
                    rh_sim::events::CannonNotice::CantEnter => 2,
                    rh_sim::events::CannonNotice::Blast => 3,
                    rh_sim::events::CannonNotice::Reloading { .. } => 4,
                },
                seconds: match notice {
                    rh_sim::events::CannonNotice::Reloading { seconds } => {
                        u16::try_from(seconds).ok()
                    }
                    _ => None,
                },
            }),
            SeenEvent::MobArmed { .. } | SeenEvent::CampCleared { .. } => {}
            SeenEvent::ChestRefused { reason } => events.push(WireEvent::ChestRefused {
                reason: match reason {
                    rh_sim::reward_chests::Refusal::Busy => 1,
                    rh_sim::reward_chests::Refusal::Gone => 2,
                    rh_sim::reward_chests::Refusal::Far => 3,
                    rh_sim::reward_chests::Refusal::Blocked => 4,
                    rh_sim::reward_chests::Refusal::Picked => 5,
                    rh_sim::reward_chests::Refusal::Taken => 6,
                    rh_sim::reward_chests::Refusal::Owned => 7,
                    rh_sim::reward_chests::Refusal::Maxed => 8,
                    rh_sim::reward_chests::Refusal::NotYours => 9,
                    rh_sim::reward_chests::Refusal::Needs(_) => 10,
                },
            }),
            SeenEvent::Death { id, by } => events.push(WireEvent::Death {
                id: id.0,
                by: by.map(|b| b.0),
            }),
            SeenEvent::Bounty { id, bounty } => events.push(WireEvent::Bounty {
                id: id.0,
                bounty: bounty.min(u16::MAX as u32) as u16,
            }),
            SeenEvent::Ended { winner, draw } => events.push(WireEvent::MatchEnded {
                winner: winner.map(|w| w.0),
                draw,
            }),
            SeenEvent::Swing {
                by,
                weapon,
                x,
                y,
                a,
            } => fx.push(WireFx::Swing {
                by: by.0,
                weapon: weapon.code(),
                x: x as f32,
                y: y as f32,
                a: a as f32,
            }),
            SeenEvent::Hit {
                victim,
                by,
                amount,
                passive,
            } => fx.push(WireFx::Hit {
                victim: victim.0,
                by: by.map_or(u32::MAX, |b| b.0),
                amount: amount as f32,
                passive,
            }),
            SeenEvent::Block { id, by, weapon } => fx.push(WireFx::Block {
                id: id.0,
                by: by.map_or(u32::MAX, |b| b.0),
                weapon: weapon.code(),
            }),
            SeenEvent::Stagger { id } => fx.push(WireFx::Stagger { id: id.0 }),
            SeenEvent::AttackCancelled { .. } => {} // No cancel telegraph in protocol 7.
            SeenEvent::SignatureHit { .. } | SeenEvent::Heal { .. } => {} // No heal effect in protocol 7.
            // Scalar status/fields are transported; these separate event telegraphs remain omitted.
            SeenEvent::AbilityHit { .. }
            | SeenEvent::CastEnded { .. }
            | SeenEvent::StatusApplied { .. } => {}
            SeenEvent::PickupRefused { reason } => events.push(WireEvent::PickupRefused {
                reason: match reason {
                    rh_sim::PickupRefusal::Blocked => 1,
                    rh_sim::PickupRefusal::NothingThere => 2,
                    rh_sim::PickupRefusal::TooFar => 3,
                    rh_sim::PickupRefusal::Unreachable => 4,
                    rh_sim::PickupRefusal::NothingToTake => 5,
                },
            }),
        }
    }
    for e in all {
        if let Event::Resolved { id, result, .. } = e {
            if *id == viewer {
                events.push(WireEvent::Result(wire::result(result)));
            }
        }
    }
    let important = (!events.is_empty()).then(|| {
        ServerMsg::Events {
            tick: obs.tick,
            events,
        }
        .encode()
    });
    let fx = (!fx.is_empty()).then(|| ServerMsg::Fx { tick: obs.tick, fx }.encode());
    let snap = wire::snapshot(obs, ack).try_encode().expect("encodes");
    (important, fx, snap)
}

/// Over a whole 2400-tick match (wirebench's, 8 viewers), every viewer-tick: the publisher's three frames are the reference
/// frames, byte for byte, with one reused publisher, a changing ack, and the viewer's own result where there is one.
#[test]
fn single_step_frames_are_byte_identical_to_the_message_encoding_on_every_viewer_tick() {
    let mut env = seed1_match(2400);
    let ids: Vec<_> = env.sim.players().iter().map(|p| p.id).collect();
    let mut publisher = Publisher::default();
    let mut earlier = Vec::new();
    let (mut viewer_ticks, mut with_events, mut with_fx) = (0u32, 0u32, 0u32);
    for t in 0..2400u32 {
        let p = env.advance(&[]);
        let events = env.last_events().to_vec();
        for id in &ids {
            let ack = t.wrapping_mul(7) ^ id.0;
            let got = publisher.frames(&env.sim, *id, ack, &events, &mut earlier, &events);
            let obs = rh_sim::observe(&env.sim, *id, &events);
            assert_eq!(publisher.observation(), &obs, "tick {t} viewer {}", id.0);
            let (want_imp, want_fx, want_snap) = reference(&obs, ack, *id, &events);
            assert_eq!(got.important, want_imp, "events, tick {t} viewer {}", id.0);
            assert_eq!(got.fx, want_fx, "fx, tick {t} viewer {}", id.0);
            // The snapshot reaches the connection as wire data; its Full frame is the reference frame, byte for byte.
            let mut full = Vec::new();
            got.snapshot
                .as_ref()
                .expect("encodes")
                .encode_full_into(&mut full);
            assert_eq!(full, want_snap, "snapshot, tick {t} viewer {}", id.0);
            assert!(earlier.is_empty());
            viewer_ticks += 1;
            with_events += u32::from(got.important.is_some());
            with_fx += u32::from(got.fx.is_some());
        }
        if p.terminated {
            break;
        }
    }
    assert!(viewer_ticks > 8 * 1000, "{viewer_ticks}");
    assert!(with_fx > 100, "the match must show fx: {with_fx}");
    assert!(with_events > 0, "and reliable events: {with_events}");
}

/// A buffer that once held a long frame never leaks bytes or events into a shorter one for another viewer.
#[test]
fn one_publisher_serving_many_viewers_in_any_order_matches_a_fresh_one() {
    let mut env = seed1_match(600);
    let ids: Vec<_> = env.sim.players().iter().map(|p| p.id).collect();
    let mut shared = Publisher::default();
    let mut earlier = Vec::new();
    for _ in 0..600 {
        let p = env.advance(&[]);
        let events = env.last_events().to_vec();
        for id in ids.iter().rev().chain(ids.iter()) {
            let a = shared.frames(&env.sim, *id, 3, &events, &mut earlier, &events);
            let b =
                Publisher::default().frames(&env.sim, *id, 3, &events, &mut Vec::new(), &events);
            assert_eq!(
                (a.important, a.fx, a.snapshot.ok()),
                (b.important, b.fx, b.snapshot.ok())
            );
        }
        if p.terminated {
            break;
        }
    }
}

// ---- catch-up wakes -------------------------------------------------------------------------------------------------------

const TICK: Duration = Duration::from_millis(50);

fn decode(frames: &[Vec<u8>]) -> Vec<ServerMsg> {
    frames
        .iter()
        .map(|f| ServerMsg::decode(f).expect("decodes"))
        .collect()
}

/// What a human was told over some wakes, tick numbers aside: the reliable events, the fx, and each snapshot's tick.
#[derive(Debug, Default, PartialEq)]
struct Told {
    events: Vec<WireEvent>,
    fx: Vec<WireFx>,
    snapshot_ticks: Vec<u32>,
}

impl Told {
    fn take(&mut self, out: &Outbox) {
        let mut frames = Vec::new();
        out.drain_into(&mut frames);
        for m in decode(&frames) {
            match m {
                ServerMsg::Events { events, .. } => self.events.extend(events),
                ServerMsg::Fx { fx, .. } => self.fx.extend(fx),
                ServerMsg::Snapshot { tick, .. } => self.snapshot_ticks.push(tick),
                // Only the tick matters here, and a delta carries it.
                ServerMsg::SnapshotDelta(d) => self.snapshot_ticks.push(d.tick),
                _ => {}
            }
        }
    }
}

struct Hand {
    player: PlayerId,
    seq: u32,
    room: Room,
    now: Instant,
    out: Arc<Outbox>,
    _reports: mpsc::UnboundedReceiver<rh_server::room::RoomReport>,
}

impl Hand {
    /// A room with one idle human and seven bots on the practice arena, all secrets and bot seeds fixed: two of these given
    /// the same wakes are the same match.
    fn new() -> Self {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/maps/seed1.map.json"
        );
        let assets =
            MapAssets::new(rh_headless::load_arena(path).expect("seed-1 map")).expect("assets");
        let (tx, reports) = mpsc::unbounded_channel();
        let now = Instant::now();
        let cfg = RoomConfig {
            sim: SimConfig {
                abilities: rh_sim::abilities::Mode::Off,
                wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
                lifecycle: rh_sim::ArenaMode::Off,
                hazards: rh_sim::terrain::Mode::Off,
                mob_mode: rh_sim::mob_runtime::MobMode::Off,
                initial_loot: false,
                consumables: true,
                min_players: 1,
                lobby_seconds: 1.0,
                fill_seconds: 0.0,
                pvp_rules: true,
                weapon_specials: true,
                faction_mode: rh_sim::FactionMode::Off,
            },
            arena: assets.arena.clone(),
            welcome_map: assets.welcome_map.clone(),
            fill_bots_to: 8,
            tick: TICK,
            record: false,
            fixed_secrets: Some(Secrets {
                order_salt: 11,
                spawn_seed: 3,
                reward_salt: [11, 22, 33, 44],
            }),
            fixed_bot_seed: Some(5),
            reconnect_grace: Duration::from_secs(10),
            linger: Duration::from_secs(3600),
        };
        let mut room = Room::new([9; 16], cfg, tx, now);
        let out = Arc::new(Outbox::default());
        let (reply, mut rx) = oneshot::channel();
        room.handle(
            RoomCmd::Join {
                profile: "alpha".into(),
                faction: None,
                outbox: out.clone(),
                conn: 1,
                fence: 1,
                reply,
            },
            now,
        );
        let joined: JoinOk = rx.try_recv().expect("replied").expect("seated");
        Self {
            player: joined.player,
            seq: 0,
            room,
            now,
            out,
            _reports: reports,
        }
    }

    /// The human orders a walk to (`x`, `y`), through the room's input path (validate + submit like any client).
    fn walk_to(&mut self, x: f32, y: f32) {
        self.seq += 1;
        self.room.handle(
            RoomCmd::Input {
                player: self.player,
                conn: 1,
                seq: self.seq,
                commands: vec![rh_protocol::WireCommand::Move { x, y, seq: None }],
            },
            self.now,
        );
    }

    /// Wakes the room once, `slots` grid slots later.
    fn wake(&mut self, slots: u32) {
        self.now += TICK * slots;
        assert!(self.room.wake(self.now));
    }
}

/// A room woken once for three owed steps tells its human exactly what a room woken after each of those steps tells it:
/// the same reliable events, the same fx (each judged against the line of sight of its own step), and for the final state
/// the same single snapshot (the earlier steps' snapshots are superseded, as for any slow client).
#[test]
fn a_three_step_wake_tells_what_three_single_step_wakes_tell() {
    let (mut one, mut three) = (Hand::new(), Hand::new());
    let (mut told_one, mut told_three) = (Told::default(), Told::default());
    let mut windows = 0;
    // The lobby and the first seconds of the run, one slot at a time on both, so the two are in step before the comparison.
    for _ in 0..60 {
        one.wake(1);
        three.wake(1);
        told_one.take(&one.out);
        told_three.take(&three.out);
    }
    told_one = Told::default();
    told_three = Told::default();
    for w in 0..400u32 {
        // The human keeps walking between the corners of the arena, through its pillars and across the bots' 900 u vision
        // radius, so what it can see changes inside a wake: a viewer that stood still would hide a wrong per-step rule.
        let (x, y) = if (w / 8) % 2 == 0 {
            (150.0, 150.0)
        } else {
            (1400.0, 900.0)
        };
        one.walk_to(x, y);
        three.walk_to(x, y);
        for _ in 0..3 {
            one.wake(1);
            told_one.take(&one.out);
        }
        three.wake(3);
        told_three.take(&three.out);
        windows += 1;
        assert_eq!(
            told_one.events, told_three.events,
            "reliable events, window {windows}"
        );
        assert_eq!(told_one.fx, told_three.fx, "fx, window {windows}");
        // The one-step rooms sent a snapshot per step (a drain after each takes them all); the catch-up room sent one,
        // for the last step: the same tick as the one-step rooms' last.
        assert_eq!(
            told_one.snapshot_ticks.last(),
            told_three.snapshot_ticks.last()
        );
        assert_eq!(told_three.snapshot_ticks.len(), windows);
        assert_eq!(told_one.snapshot_ticks.len(), 3 * windows);
    }
    assert!(
        !told_one.fx.is_empty(),
        "the match must produce fx the human could see"
    );
}

/// The publisher on a wake whose steps change what the viewer can see (the 880 u / 920 u scenario of
/// rh-sim/tests/observe.rs), assembled the way the room does: per-step filtering for the steps before the last. The swing
/// is told when the viewer saw it, and not told when it did not, whatever the last step's sight says.
#[test]
fn the_publisher_tells_a_swing_by_the_sight_of_the_step_it_happened_in() {
    for (gap, to_x, told) in [(880.0, 0.0, true), (920.0, 400.0, false)] {
        let place = |n: &str, x: f64| Placement {
            profile: n.into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(x, 272.0),
            hp: None,
            weapon0: None,
            weapon1: None,
        };
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(5),
            &[place("viewer", 100.0), place("swinger", 100.0 + gap)],
        );
        let (viewer, swinger) = (PlayerId(1), PlayerId(2));
        sim.submit(swinger, cmd(RawCommand::Attack { a: 0.0, t: None }))
            .unwrap();
        sim.submit(
            viewer,
            cmd(RawCommand::Move {
                x: to_x,
                y: 272.0,
                seq: None,
            }),
        )
        .unwrap();
        let (mut all, mut earlier, mut last) = (Vec::new(), Vec::new(), Vec::new());
        for n in 0..3 {
            last.clear();
            sim.step_into(&mut last);
            if n < 2 {
                rh_sim::observe_events_into(&sim, viewer, &last, &mut earlier);
            }
            all.extend(last.iter().cloned());
        }
        let f = Publisher::default().frames(&sim, viewer, 0, &last, &mut earlier, &all);
        let swung = match f.fx {
            Some(frame) => match ServerMsg::decode(&frame).unwrap() {
                ServerMsg::Fx { fx, .. } => fx
                    .iter()
                    .any(|e| matches!(e, WireFx::Swing { by, .. } if *by == swinger.0)),
                other => panic!("{other:?}"),
            },
            None => false,
        };
        assert_eq!(swung, told, "gap {gap}");
        assert!(earlier.is_empty(), "the carry is consumed by the frames");
        // One snapshot, for the final state.
        let snap = f.snapshot.unwrap();
        assert_eq!(snap.tick(), sim.tick());
    }
}

// ---- bot event accumulation -----------------------------------------------------------------------------------------------

type Log = Arc<std::sync::Mutex<Vec<(u32, Vec<SeenEvent>)>>>;

/// Records what it is shown: (tick, events) per decision, proposes nothing.
struct Recorder {
    interval: u32,
    log: Log,
}

impl rh_policy::Policy for Recorder {
    fn spec(&self) -> rh_policy::PolicySpec {
        rh_policy::PolicySpec {
            name: "recorder".into(),
            version: "1".into(),
            contract: rh_policy::POLICY_CONTRACT_VERSION,
            observation_version: rh_sim::observe::OBSERVATION_VERSION,
            decision_interval_ticks: self.interval,
        }
    }
    fn reset(&mut self, _m: &rh_policy::MatchStart) {}
    fn decide(&mut self, obs: &Observation) -> Vec<rh_sim::PublicCommand> {
        self.log
            .lock()
            .unwrap()
            .push((obs.tick, obs.events.clone()));
        Vec::new()
    }
}

/// A bot that decides every fourth tick is told the same events, in the same order, as one that decides every tick, up to
/// its last decision: the events of the steps between its decisions are held (each judged against its own step's sight) and
/// delivered with the next observation (C-POLICY).
#[test]
fn a_slow_seat_is_told_every_event_a_fast_seat_is_told() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/maps/seed1.map.json"
    );
    let arena = rh_headless::load_arena(path).expect("seed-1 map");
    let place = |i: usize| Placement {
        profile: format!("p{i}"),
        faction: FactionId::ALL[i % 5],
        bot: true,
        at: Vec2::new(2000.0 + 70.0 * i as f64, 2000.0 + 40.0 * (i % 3) as f64),
        hp: None,
        weapon0: None,
        weapon1: None,
    };
    let places: Vec<_> = (0..7).map(place).collect();
    let mut sim = Sim::reset_active(SimConfig::default(), arena, Secrets::from_seed(5), &places);
    let ids: Vec<_> = sim.players().iter().map(|p| p.id).collect();
    let (fast, slow) = (Log::default(), Log::default());
    let mut seats = Vec::new();
    for (i, id) in ids.iter().enumerate().skip(1) {
        seats.push(rh_policy::Seat::new(
            &rh_policy::MatchStart::of(&sim, *id, i as u64),
            Box::new(Brawler::new(2)),
            Box::new(rh_policy::scripted::Idle),
        ));
    }
    let watcher = ids[0];
    for (interval, log) in [(1, &fast), (4, &slow)] {
        seats.push(rh_policy::Seat::new(
            &rh_policy::MatchStart::of(&sim, watcher, 0),
            Box::new(Recorder {
                interval,
                log: Arc::clone(log),
            }),
            Box::new(rh_policy::scripted::Idle),
        ));
    }
    let mut last = Vec::new();
    for _ in 0..800 {
        rh_policy::drive_seats(&mut sim, &mut seats, &last);
        last = sim.step();
    }
    let (fast, slow) = (fast.lock().unwrap(), slow.lock().unwrap());
    let end = slow.last().expect("the slow seat decided").0;
    let flat = |log: &[(u32, Vec<SeenEvent>)]| -> Vec<SeenEvent> {
        log.iter()
            .filter(|(t, _)| *t <= end)
            .flat_map(|(_, e)| e.iter().cloned())
            .collect()
    };
    let (told_fast, told_slow) = (flat(&fast), flat(&slow));
    assert!(
        told_fast.len() > 50,
        "the match must show the watcher events: {}",
        told_fast.len()
    );
    assert_eq!(told_slow, told_fast);
}
