//! The outcome digest: a behaviour fingerprint of a run that depends only on what the sim publicly did, never on
//! `Sim::state_hash` or on any serde layout. Each tick folds the public snapshot ([`rh_sim::public_snapshot`]: every
//! player's public fields, the clock, the phase and the winner) and the step's events in order (kind, ids and payload,
//! including each resolved [`RunResult`]). Two runs with the same digest showed the same public behaviour bit for bit
//! (f64s by their bits), so it stays a valid A/B fingerprint when later packages restructure state or redefine the state
//! hash. Fields are folded explicitly, one by one, with stable tags: adding a public field or an event variant means
//! extending this file (the matches are exhaustive, so the compiler says so).
//!
//! Also compiled into `rh-parity`'s parity-bench (`#[path]`), so it may use `rh_sim` and `std` only.

use rh_sim::sim::{GvReason, Outcome, Phase, Status, WinBonusWhy};
use rh_sim::{Event, RunResult, Sim};

/// A fold of 64-bit words (multiply-rotate, as FxHash), finished with a SplitMix64 avalanche.
#[derive(Clone, Debug)]
pub struct OutcomeDigest {
    h: u64,
    ticks: u64,
    events: u64,
}

impl Default for OutcomeDigest {
    fn default() -> Self {
        Self {
            h: 0x6a09_e667_f3bc_c908,
            ticks: 0,
            events: 0,
        }
    }
}

const K: u64 = 0x9e37_79b9_7f4a_7c15;

impl OutcomeDigest {
    pub fn new() -> Self {
        Self::default()
    }

    /// Folds a raw word (for fingerprints of other outputs, e.g. pathfinding waypoints).
    pub fn word(&mut self, w: u64) {
        self.w(w);
    }
    /// Folds an f64 by its bits.
    pub fn num(&mut self, x: f64) {
        self.f(x);
    }

    fn w(&mut self, w: u64) {
        self.h = (self.h.rotate_left(5) ^ w).wrapping_mul(K);
    }
    fn f(&mut self, x: f64) {
        self.w(x.to_bits());
    }
    fn s(&mut self, s: &str) {
        self.w(s.len() as u64);
        for c in s.as_bytes().chunks(8) {
            let mut b = [0u8; 8];
            b[..c.len()].copy_from_slice(c);
            self.w(u64::from_le_bytes(b));
        }
    }
    fn opt(&mut self, v: Option<u64>) {
        match v {
            None => self.w(0),
            Some(v) => {
                self.w(1);
                self.w(v);
            }
        }
    }

    /// Folds one step: call right after `sim.step()` with the events it returned.
    pub fn tick(&mut self, sim: &Sim, events: &[Event]) {
        let snap = rh_sim::public_snapshot(sim);
        self.ticks += 1;
        self.s("tick");
        self.w(snap.tick as u64);
        self.f(snap.server_time);
        self.s(phase(snap.phase));
        match &snap.winner {
            None => self.w(0),
            Some(n) => {
                self.w(1);
                self.s(n);
            }
        }
        self.w(snap.players.len() as u64);
        for p in &snap.players {
            self.w(p.id.0 as u64);
            self.s(&p.name);
            self.w(p.bot as u64);
            self.s(p.faction.as_str());
            self.f(p.x);
            self.f(p.y);
            self.f(p.facing);
            self.f(p.hp);
            self.f(p.max_hp);
            self.s(status(p.status));
            self.w(p.kills as u64);
            self.w(p.bounty as u64);
        }
        self.w(events.len() as u64);
        for e in events {
            self.event(e);
        }
    }

    fn event(&mut self, e: &Event) {
        self.events += 1;
        match e {
            Event::RaidStarted => self.s("raidStarted"),
            Event::Windup { by, weapon, a, ms } => {
                self.s("windup");
                self.w(by.0 as u64);
                self.s(weapon.as_str());
                self.f(*a);
                self.f(*ms);
            }
            Event::Swing {
                by,
                weapon,
                x,
                y,
                a,
            } => {
                self.s("swing");
                self.w(by.0 as u64);
                self.s(weapon.as_str());
                self.f(*x);
                self.f(*y);
                self.f(*a);
            }
            Event::Hit {
                victim,
                by,
                amount,
                weapon,
                passive,
            } => {
                self.s("hit");
                self.w(victim.0 as u64);
                // A fighter's hit folds exactly as before; a sourceless one folds as a source no id can be and a weapon
                // name no weapon has.
                self.w(by.map_or(u64::MAX, |b| b.0 as u64));
                self.f(*amount);
                self.s(weapon.map_or("", |w| w.as_str()));
                // False is the legacy default, so old non-passive outcomes keep their
                // fingerprint. The explicit marker still detects a newly passive hit.
                if *passive {
                    self.s("passive");
                }
            }
            Event::Block { id, by, weapon } => {
                self.s("block");
                self.w(id.0 as u64);
                self.w(by.0 as u64);
                self.s(weapon.as_str());
            }
            Event::PickupRefused {
                id,
                reason,
                target_visible,
            } => {
                self.s("pickupRefused");
                self.w(id.0 as u64);
                self.s(reason.message());
                self.w(*target_visible as u64);
            }
            Event::Stagger { id } => {
                self.s("stagger");
                self.w(id.0 as u64);
            }
            Event::Death { id, x, y, by } => {
                self.s("death");
                self.w(id.0 as u64);
                self.f(*x);
                self.f(*y);
                self.opt(by.map(|b| b.0 as u64));
            }
            Event::Gv { id, amount, reason } => {
                self.s("gv");
                self.w(id.0 as u64);
                self.w(*amount as u64);
                self.s(match reason {
                    GvReason::Kill => "kill",
                    GvReason::Bounty => "bounty",
                    GvReason::Win => "win",
                });
            }
            Event::Bounty { id, bounty } => {
                self.s("bounty");
                self.w(id.0 as u64);
                self.w(*bounty as u64);
            }
            Event::Victory { id, draw } => {
                self.s("victory");
                self.opt(id.map(|i| i.0 as u64));
                self.w(*draw as u64);
            }
            Event::RaidEnded => self.s("raidEnded"),
            Event::Resolved { id, result, bot } => {
                self.s("resolved");
                self.w(id.0 as u64);
                self.w(*bot as u64);
                self.result(result);
            }
        }
    }

    fn result(&mut self, r: &RunResult) {
        self.s(match r.outcome {
            Outcome::Won => "won",
            Outcome::Draw => "draw",
            Outcome::Died => "died",
            Outcome::Mia => "mia",
        });
        self.s(&r.profile);
        self.w(r.duration_sec as u64);
        self.w(r.kills as u64);
        match &r.killed_by {
            None => self.w(0),
            Some(k) => {
                self.w(1);
                self.s(k);
            }
        }
        self.w(r.killed_by_bot as u64);
        self.w(r.place as u64);
        self.w(r.players as u64);
        let g = r.gv;
        for v in [g.kills, g.mobs, g.bounty, g.quest, g.win, g.total] {
            self.w(v as u64);
        }
        self.w(r.win_bonus_withheld as u64);
        self.s(match r.win_bonus_why {
            None => "-",
            Some(WinBonusWhy::Starters) => "starters",
            Some(WinBonusWhy::Opponents) => "opponents",
        });
    }

    /// Ticks folded so far.
    pub fn ticks(&self) -> u64 {
        self.ticks
    }
    /// Events folded so far.
    pub fn events(&self) -> u64 {
        self.events
    }

    /// The digest of everything folded so far (folding goes on afterwards).
    pub fn value(&self) -> u64 {
        let mut z = self.h ^ self.ticks.wrapping_mul(K) ^ self.events.rotate_left(32);
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// The digest as 16 hex digits (how the bench binaries print it).
    pub fn hex(&self) -> String {
        format!("{:016x}", self.value())
    }
}

/// Folds a sequence of digests (e.g. one per match) into one, order-sensitive.
pub fn fold_all(values: impl IntoIterator<Item = u64>) -> u64 {
    let mut d = OutcomeDigest::new();
    for v in values {
        d.w(v);
    }
    d.value()
}

fn phase(p: Phase) -> &'static str {
    match p {
        Phase::Lobby => "lobby",
        Phase::Active => "active",
        Phase::Ended => "ended",
    }
}

fn status(s: Status) -> &'static str {
    match s {
        Status::Lobby => "lobby",
        Status::Alive => "alive",
        Status::Dead => "dead",
        Status::Mia => "mia",
    }
}
