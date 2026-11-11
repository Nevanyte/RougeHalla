//! P-LOBBY-TIMING-1: the lobby's timeline, driven by hand on simulated time (one `wake` per 50 ms grid slot).
//!
//! Two kinds of test live here.
//! - `matchmaking_*`: the owner's rule (2026-11-10, new direction, not legacy): "wait 15 seconds; if by second 13 no match
//!   can be found, add bots to the lobby". Times run from the first human's arrival.
//! - `legacy_*`: the default timing (30 s lobby, pulled to 5 s at two humans, bots over the last 12 s) as the server runs
//!   today. These pass before and after the packet and must not be edited to make the new mode pass.
//!
//! The three coordinator readings that the owner may flip each have a test of their own, named in `FLIP`:
//! - `matchmaking_a_full_human_lobby_starts_early_with_no_bot`: a lobby full of humans starts at once;
//! - `matchmaking_bots_fill_the_lobby_at_second_13`: the bots arrive together at second 13 (not spread over 13..15);
//! - `matchmaking_clock_runs_from_the_first_humans_arrival`: the clock starts at the first human, not at room creation.
//!
//! Tick convention: `wake` number `i` runs at `i * 50 ms` after the room opened. The assertions leave one tick of slack at
//! each boundary (a bot "at second 13" is present from the wake at 13.1 s; none is present through 12.95 s).

use rh_server::bot_fill::{BotFillConfig, LobbyTiming};
use rh_server::outbox::Outbox;
use rh_server::room::{JoinOk, MapAssets, Room, RoomCmd, RoomConfig, RoomReport};
use rh_sim::{Phase, SimConfig};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

const TICK: Duration = Duration::from_millis(50);

/// The sim flags a host passes: `(--min-players, --lobby-seconds, --fill-seconds)`. The first is today's default, the
/// second the beta host's (`hosting/technical-demo/bootstrap.py`), the third a host that closes the lobby the moment the
/// human minimum is met. The new mode must give the same timeline whichever it is given.
const FLAG_SETS: [(usize, f64, f64); 3] = [(2, 30., 5.), (1, 10., 3.), (1, 15., 0.)];

const MATCHMAKING: LobbyTiming = LobbyTiming::Matchmaking {
    lobby_seconds: 15.,
    bots_at_seconds: 13.,
};

/// A slot index for a time in seconds.
fn slot(seconds: f64) -> usize {
    (seconds * 20.).round() as usize
}

struct Lobby {
    room: Room,
    now: Instant,
    reports: mpsc::UnboundedReceiver<RoomReport>,
    /// The last wake's slot number.
    slot: usize,
    open: bool,
    conn: u64,
}

impl Lobby {
    /// A room built the way the director builds one: the fill config adjusts the room's `SimConfig` (the
    /// `apply_lobby_timing` seam) before `Room::new`, then `with_bot_fill`.
    fn new(timing: LobbyTiming, flags: (usize, f64, f64), fill_to: usize) -> Self {
        let (min_players, lobby_seconds, fill_seconds) = flags;
        let fill = BotFillConfig {
            fill_to,
            lobby_timing: timing,
            seed: Some(11),
            ..BotFillConfig::default()
        };
        let mut sim = SimConfig {
            min_players,
            lobby_seconds,
            fill_seconds,
            ..SimConfig::default()
        };
        fill.apply_lobby_timing(&mut sim);
        let assets = MapAssets::new(rh_sim::arenas::practice_arena()).unwrap();
        let (tx, reports) = mpsc::unbounded_channel();
        let now = Instant::now();
        let cfg = RoomConfig {
            sim,
            arena: assets.arena.clone(),
            welcome_map: assets.welcome_map.clone(),
            fill_bots_to: fill_to,
            tick: TICK,
            record: false,
            fixed_secrets: Some(rh_sim::Secrets::from_seed(7)),
            fixed_bot_seed: Some(7),
            reconnect_grace: Duration::from_secs(10),
            linger: Duration::from_secs(5),
        };
        Self {
            room: Room::new([5; 16], cfg, tx, now).with_bot_fill(fill),
            now,
            reports,
            slot: 0,
            open: true,
            conn: 0,
        }
    }

    fn join(&mut self, profile: &str) -> JoinOk {
        self.conn += 1;
        let (reply, mut rx) = oneshot::channel();
        self.room.handle(
            RoomCmd::Join {
                profile: profile.into(),
                faction: None,
                outbox: Arc::new(Outbox::default()),
                conn: self.conn,
                fence: 1,
                reply,
            },
            self.now,
        );
        rx.try_recv().expect("replied").expect("seated")
    }

    fn leave(&mut self, ok: &JoinOk, conn: u64) {
        self.room.handle(
            RoomCmd::Leave {
                player: ok.player,
                conn,
            },
            self.now,
        );
    }

    fn wake(&mut self) {
        self.now += TICK;
        self.slot += 1;
        self.open = self.room.wake(self.now);
    }

    fn bots(&self) -> usize {
        self.room
            .sim()
            .players()
            .iter()
            .filter(|p| p.seat.bot)
            .count()
    }

    fn humans(&self) -> usize {
        self.room
            .sim()
            .players()
            .iter()
            .filter(|p| !p.seat.bot)
            .count()
    }

    fn players(&self) -> usize {
        self.room.sim().players().len()
    }

    fn active(&self) -> bool {
        self.room.sim().phase() == Phase::Active
    }

    /// Wakes until slot `to` (inclusive), calling `each` after every wake.
    fn run_to(&mut self, to: usize, mut each: impl FnMut(&Lobby)) {
        while self.slot < to {
            self.wake();
            each(self);
        }
    }

    /// The whole lobby as one timeline up to `to` seconds: bots and players after each wake, and the first slot at which
    /// the raid was running.
    fn timeline(&mut self, to: f64) -> Timeline {
        let mut t = Timeline {
            first_slot: self.slot + 1,
            ..Timeline::default()
        };
        self.run_to(slot(to), |l| {
            t.bots.push(l.bots());
            t.players.push(l.players());
            if t.active_slot.is_none() && l.active() {
                t.active_slot = Some(l.slot);
            }
        });
        t
    }

    fn reports(&mut self) -> Vec<RoomReport> {
        std::iter::from_fn(|| self.reports.try_recv().ok()).collect()
    }
}

/// Index `i` of `bots`/`players` is the state after wake number `first_slot + i`.
#[derive(Default, Debug, PartialEq)]
struct Timeline {
    first_slot: usize,
    bots: Vec<usize>,
    players: Vec<usize>,
    active_slot: Option<usize>,
}

impl Timeline {
    fn after(&self, slot: usize) -> (usize, usize) {
        (
            self.bots[slot - self.first_slot],
            self.players[slot - self.first_slot],
        )
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The new mode.
// ---------------------------------------------------------------------------------------------------------------------

/// One human at second 0: no bot through 12.95 s, whatever the sim flags say.
#[test]
fn matchmaking_no_bot_joins_before_second_13() {
    for flags in FLAG_SETS {
        let mut lobby = Lobby::new(MATCHMAKING, flags, 6);
        lobby.join("alpha");
        let t = lobby.timeline(14.);
        for s in 1..=slot(12.95) {
            assert_eq!(
                t.after(s),
                (0, 1),
                "flags {flags:?}: no bot may join before second 13 (slot {s})"
            );
        }
    }
}

/// FLIP: the bots arrive together at second 13. If the owner wants the arrivals spread over 13..15 instead, this is the
/// test to relax (keep "none before 13" and "at the target by the start").
#[test]
fn matchmaking_bots_fill_the_lobby_at_second_13() {
    for flags in FLAG_SETS {
        let mut lobby = Lobby::new(MATCHMAKING, flags, 6);
        lobby.join("alpha");
        let t = lobby.timeline(14.);
        assert_eq!(
            t.after(slot(13.1)),
            (5, 6),
            "flags {flags:?}: at second 13 the lobby is filled to the fill target of 6"
        );
        assert_eq!(lobby.humans(), 1);
    }
}

/// The match starts at second 15 and not before, whatever the sim flags say (with `--min-players 1` the sim alone would
/// start it at once or after `--fill-seconds`).
#[test]
fn matchmaking_match_starts_at_second_15() {
    for flags in FLAG_SETS {
        let mut lobby = Lobby::new(MATCHMAKING, flags, 6);
        lobby.join("alpha");
        let t = lobby.timeline(16.);
        let started = t.active_slot.unwrap_or(usize::MAX);
        assert!(
            started >= slot(14.95) && started <= slot(15.1),
            "flags {flags:?}: the raid starts at second 15, started at slot {started}"
        );
        assert_eq!(
            t.after(started),
            (5, 6),
            "flags {flags:?}: it starts with the lobby at the fill target"
        );
        assert_eq!(lobby.humans(), 1);
    }
}

/// A second human at second 6 does not restart the clock, does not close the lobby early, and does not bring bots early.
#[test]
fn matchmaking_a_second_human_does_not_restart_the_clock() {
    for flags in FLAG_SETS {
        let mut lobby = Lobby::new(MATCHMAKING, flags, 6);
        lobby.join("alpha");
        lobby.run_to(slot(6.), |l| {
            assert_eq!((l.bots(), l.players()), (0, 1), "flags {flags:?}");
        });
        lobby.join("bravo");
        let mut first_active = None;
        let mut bots_at_13 = None;
        lobby.run_to(slot(16.), |l| {
            if l.slot < slot(13.) {
                assert_eq!(
                    l.bots(),
                    0,
                    "flags {flags:?}: no bot before 13 s (slot {})",
                    l.slot
                );
            }
            if l.slot == slot(13.1) {
                bots_at_13 = Some((l.bots(), l.players()));
            }
            if first_active.is_none() && l.active() {
                first_active = Some(l.slot);
            }
        });
        assert_eq!(
            bots_at_13,
            Some((4, 6)),
            "flags {flags:?}: two humans and bots up to the fill target of 6 at second 13"
        );
        assert!(first_active.is_some(), "flags {flags:?}: the raid starts");
        let started = first_active.unwrap();
        assert!(
            started >= slot(14.95) && started <= slot(15.1),
            "flags {flags:?}: still second 15 from the first human, started at slot {started}"
        );
        assert_eq!(lobby.humans(), 2);
    }
}

/// FLIP: a lobby that fills with humans before second 13 starts at once through the existing rule, with no bot. If the
/// owner wants every lobby to wait the full 15 s, this is the test to change.
#[test]
fn matchmaking_a_full_human_lobby_starts_early_with_no_bot() {
    for flags in FLAG_SETS {
        let mut lobby = Lobby::new(MATCHMAKING, flags, 8);
        lobby.join("h0");
        lobby.run_to(slot(4.), |_| {});
        assert!(
            !lobby.active(),
            "flags {flags:?}: one human alone is still in the lobby at 4 s"
        );
        for i in 1..rh_sim::constants::MAX_PLAYERS {
            lobby.join(&format!("h{i}"));
        }
        assert_eq!(lobby.humans(), rh_sim::constants::MAX_PLAYERS);
        lobby.run_to(slot(4.2), |_| {});
        assert!(
            lobby.active(),
            "flags {flags:?}: eight humans start the raid within a few ticks, at 4 s rather than 15 s"
        );
        assert_eq!(lobby.bots(), 0, "flags {flags:?}: no bot joined");
    }
}

/// A human who leaves at second 14 is replaced before the start: the match starts at 15 at the fill target.
#[test]
fn matchmaking_replaces_a_human_who_leaves_at_second_14() {
    for flags in FLAG_SETS {
        let mut lobby = Lobby::new(MATCHMAKING, flags, 6);
        let alpha = lobby.join("alpha");
        let alpha_conn = lobby.conn;
        lobby.join("bravo");
        lobby.run_to(slot(14.), |_| {});
        assert_eq!((lobby.bots(), lobby.players()), (4, 6), "flags {flags:?}");
        assert!(!lobby.active(), "flags {flags:?}: still the lobby at 14 s");
        lobby.leave(&alpha, alpha_conn);
        let mut first_active = None;
        lobby.run_to(slot(16.), |l| {
            if first_active.is_none() && l.active() {
                first_active = Some((l.slot, l.humans(), l.players()));
            }
        });
        assert!(first_active.is_some(), "flags {flags:?}: the raid starts");
        let (started, humans, players) = first_active.unwrap();
        assert!(
            started >= slot(14.95) && started <= slot(15.1),
            "flags {flags:?}: started at slot {started}"
        );
        assert_eq!(humans, 1, "flags {flags:?}: the leaver is gone");
        assert_eq!(
            players, 6,
            "flags {flags:?}: the lobby was topped up before the start"
        );
    }
}

/// Zero humans never start a match: an unjoined room stays a lobby with no bots, and a lone human who leaves takes the
/// lobby with them (the room closes, no raid, no bots).
#[test]
fn matchmaking_zero_humans_never_start_a_match() {
    for flags in FLAG_SETS {
        let mut empty = Lobby::new(MATCHMAKING, flags, 6);
        empty.run_to(slot(25.), |l| {
            assert!(
                l.open,
                "flags {flags:?}: an unclaimed room waits for its first player"
            );
            assert_eq!((l.bots(), l.players()), (0, 0), "flags {flags:?}");
            assert!(!l.active(), "flags {flags:?}: no raid without a human");
        });

        let mut left = Lobby::new(MATCHMAKING, flags, 6);
        let alpha = left.join("alpha");
        left.run_to(slot(5.), |_| {});
        left.leave(&alpha, 1);
        left.run_to(slot(20.), |l| {
            assert!(
                !l.active(),
                "flags {flags:?}: no raid after the last human left"
            );
        });
        assert!(
            !left.open,
            "flags {flags:?}: the lobby closes with its last human"
        );
        assert!(
            left.reports()
                .iter()
                .all(|r| !matches!(r, RoomReport::Result { .. })),
            "flags {flags:?}: no result is banked"
        );
    }
}

/// FLIP: 13 s and 15 s are measured from the first human's arrival, not from room creation. A human who arrives 5 s after
/// the room opened gets bots at 18 s and a start at 20 s.
#[test]
fn matchmaking_clock_runs_from_the_first_humans_arrival() {
    for flags in FLAG_SETS {
        let mut lobby = Lobby::new(MATCHMAKING, flags, 6);
        lobby.run_to(slot(5.), |_| {});
        lobby.join("alpha");
        let mut first_bot = None;
        let mut first_active = None;
        lobby.run_to(slot(21.), |l| {
            if first_bot.is_none() && l.bots() > 0 {
                first_bot = Some(l.slot);
            }
            if first_active.is_none() && l.active() {
                first_active = Some(l.slot);
            }
        });
        assert!(first_bot.is_some(), "flags {flags:?}: bots join");
        assert!(first_active.is_some(), "flags {flags:?}: the raid starts");
        let (first_bot, first_active) = (first_bot.unwrap(), first_active.unwrap());
        assert!(
            first_bot >= slot(17.95) && first_bot <= slot(18.1),
            "flags {flags:?}: bots at 5 + 13 s, first at slot {first_bot}"
        );
        assert!(
            first_active >= slot(19.95) && first_active <= slot(20.1),
            "flags {flags:?}: start at 5 + 15 s, started at slot {first_active}"
        );
    }
}

/// The legacy timing helper accepts the new field and the default leaves the sim's knobs alone.
#[test]
fn legacy_timing_leaves_the_sim_knobs_alone() {
    assert_eq!(BotFillConfig::default().lobby_timing, LobbyTiming::Legacy);
    for (min_players, lobby_seconds, fill_seconds) in FLAG_SETS {
        let mut sim = SimConfig {
            min_players,
            lobby_seconds,
            fill_seconds,
            ..SimConfig::default()
        };
        BotFillConfig::default().apply_lobby_timing(&mut sim);
        assert_eq!(
            (sim.min_players, sim.lobby_seconds, sim.fill_seconds),
            (min_players, lobby_seconds, fill_seconds)
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The default (legacy) timing, as it runs today. Values recorded from the unmodified code.
// ---------------------------------------------------------------------------------------------------------------------

/// One human, `--min-players 2 --lobby-seconds 30 --fill-seconds 5`, fill target 6: no bot for the first 18 s, then bots
/// arrive through the last 12 s (the first at slot 389, 19.45 s) and the lobby is topped up to 6 as the raid starts at
/// slot 600 (30 s).
#[test]
fn legacy_one_human_waits_the_full_lobby_and_bots_arrive_over_the_last_twelve_seconds() {
    let mut lobby = Lobby::new(LobbyTiming::Legacy, (2, 30., 5.), 6);
    lobby.join("alpha");
    let t = lobby.timeline(31.);
    let first_bot = t.bots.iter().position(|b| *b > 0).map(|i| i + t.first_slot);
    assert_eq!(first_bot, LEGACY_ONE_HUMAN.first_bot_slot);
    assert_eq!(t.active_slot, LEGACY_ONE_HUMAN.active_slot);
    assert_eq!(
        t.after(slot(30.)),
        LEGACY_ONE_HUMAN.at_30s,
        "bots and players at second 30"
    );
    assert_eq!(
        [slot(18.), slot(21.), slot(24.), slot(27.)].map(|s| t.after(s)),
        LEGACY_ONE_HUMAN.samples,
        "bots arrive over the window"
    );
}

/// Two humans pull the deadline in to five seconds from the moment the second arrives (at second 3: start at 8), and the
/// lobby is topped up to the fill target when it closes.
#[test]
fn legacy_the_second_human_pulls_the_start_in_to_five_seconds() {
    let mut lobby = Lobby::new(LobbyTiming::Legacy, (2, 30., 5.), 6);
    lobby.join("alpha");
    lobby.run_to(slot(3.), |_| {});
    lobby.join("bravo");
    let t = lobby.timeline(10.);
    assert_eq!(t.active_slot, LEGACY_TWO_HUMANS.active_slot);
    assert_eq!(
        t.after(t.active_slot.unwrap_or(t.first_slot)),
        LEGACY_TWO_HUMANS.at_start,
        "bots and players when the raid starts"
    );
    assert_eq!(
        t.bots.iter().position(|b| *b > 0).map(|i| i + t.first_slot),
        LEGACY_TWO_HUMANS.first_bot_slot
    );
}

struct LegacyOneHuman {
    first_bot_slot: Option<usize>,
    active_slot: Option<usize>,
    at_30s: (usize, usize),
    samples: [(usize, usize); 4],
}
struct LegacyTwoHumans {
    first_bot_slot: Option<usize>,
    active_slot: Option<usize>,
    at_start: (usize, usize),
}

const LEGACY_ONE_HUMAN: LegacyOneHuman = LegacyOneHuman {
    first_bot_slot: Some(389),
    active_slot: Some(600),
    at_30s: (5, 6),
    samples: [(0, 1), (1, 2), (2, 3), (2, 3)],
};
const LEGACY_TWO_HUMANS: LegacyTwoHumans = LegacyTwoHumans {
    first_bot_slot: Some(101),
    active_slot: Some(161),
    at_start: (4, 6),
};
