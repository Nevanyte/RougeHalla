//! The trusted runner's behaviour fingerprint, independent of the state hash and serde layout.
//! It folds all fighters and authoritative events, including the identity, origin, owner and target
//! of hidden projectiles. It is private match diagnostics; policies and clients receive only their
//! own filtered observations. Explicit field folds keep replay/performance comparisons sensitive
//! to individual event payloads across serialization changes.
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

    /// Trusted declared-workload wrapper. Arbitrary-checkpoint diagnostics use [`Self::try_tick`].
    pub fn tick(&mut self, sim: &Sim, events: &[Event]) {
        self.try_tick(sim, events)
            .expect("trusted digest snapshot is not representable");
    }

    /// Checked private fingerprint; a refusal leaves the digest unchanged.
    pub fn try_tick(&mut self, sim: &Sim, events: &[Event]) -> Result<(), rh_sim::OfferError> {
        let snap = rh_sim::try_public_snapshot(sim)?;
        self.ticks += 1;
        self.s("tick");
        self.w(snap.tick as u64);
        self.f(snap.server_time);
        self.s(phase(snap.phase));
        if let Some(a) = snap.arena {
            self.s("source_arena");
            for value in [
                a.lobby_ends_at,
                a.plan_ends_at,
                a.raid_started_at,
                a.sudden_death_at,
            ] {
                self.f(value);
            }
            self.opt(a.patience_ends_at.map(f64::to_bits));
            self.w(u64::from(a.in_coliseum));
            self.w(u64::from(a.gates_locked));
            self.w(a.started_with.into());
        }
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
            if p.barrier.to_bits() != 0 {
                self.s("public_barrier");
                self.f(p.barrier);
            }
            self.s(status(p.status));
            self.w(p.kills as u64);
            self.w(p.bounty as u64);
            if p.effects != 0 || p.displace_seq != 0 {
                self.s("status_motion");
                self.w(p.effects.into());
                self.w(p.displace_seq.into());
            }
        }
        if !snap.mobs.is_empty() || !snap.camps.is_empty() {
            self.s("regional_actors");
            self.w(snap.mobs.len() as u64);
            for m in &snap.mobs {
                self.w(m.id.0.into());
                self.w(m.kind.into());
                self.s(m.mob_type.expect("mob type").as_str());
                self.s(m.faction.as_str());
                for n in [m.x, m.y, m.facing, m.hp_frac] {
                    self.f(n);
                }
                self.s(status(m.status));
                self.s(m.weapon.as_str());
                self.w(m.effects.into());
                self.w(m.displace_seq.into());
            }
            self.w(snap.camps.len() as u64);
            for c in &snap.camps {
                self.s(c.mob_type.as_str());
                self.s(c.elite.map_or("", |e| e.as_str()));
                self.w(c.alive.into());
            }
        }
        if !snap.fields.is_empty() {
            self.s("visible_fields");
            self.w(snap.fields.len() as u64);
            for f in &snap.fields {
                self.w(f.kind as u64);
                self.s(f.ability.as_str());
                self.opt(f.owner.map(|id| id.0.into()));
                self.opt(f.subject.map(|id| id.0.into()));
                for n in [
                    f.x,
                    f.y,
                    f.x2,
                    f.y2,
                    f.r,
                    f.vx,
                    f.vy,
                    f.started_at,
                    f.ends_at,
                ] {
                    self.f(n);
                }
            }
        }
        self.w(events.len() as u64);
        for e in events {
            self.event(e);
        }
        Ok(())
    }

    fn flight(&mut self, p: &rh_sim::ProjectileLaunch) {
        self.w(u64::from(p.id));
        self.w(p.kind as u64);
        self.w(u64::from(p.owner.0));
        self.w(p.reflected as u64);
        for n in [
            p.origin.x,
            p.origin.y,
            p.velocity.x,
            p.velocity.y,
            p.time,
            p.range,
        ] {
            self.f(n);
        }
        self.opt(p.target.map(|id| u64::from(id.0)));
    }
    fn event(&mut self, e: &Event) {
        self.events += 1;
        match e {
            Event::PlanningStarted => self.s("planningStarted"),
            Event::Teleported => self.s("teleported"),
            Event::Plan { to, plan } => {
                self.s("ownerPlan");
                self.w(to.0.into());
                self.f(plan.ends_at);
                for n in plan.spawns {
                    self.w(n as u64);
                }
                for taken in plan.taken {
                    self.w(u64::from(taken));
                }
                self.w(plan.pick as u64);
                self.w(plan.boons.len() as u64);
                for boon in &plan.boons {
                    self.s(boon);
                }
                self.w(plan.boon as u64);
            }
            Event::PotionNotice { id, notice } => {
                self.s("potion_notice");
                self.w(id.0.into());
                self.s(notice.message());
            }
            Event::Toast { to, text } => {
                self.s("toast");
                self.w(to.0.into());
                self.s(text);
            }
            Event::CannonNotice { id, notice } => {
                self.s("cannon_notice");
                self.w(id.0.into());
                self.s(&notice.message());
            }
            Event::WindEmblem { id } => {
                self.s("wind_emblem");
                self.w(id.0.into());
            }
            Event::MobArmed { id, weapon } => {
                self.s("mob_armed");
                self.w(id.0.into());
                self.s(weapon.as_str());
            }
            Event::CampCleared { camp } => {
                self.s("camp_cleared");
                self.w((*camp).into());
            }
            Event::ChestRefused { id, reason } => {
                self.s("chest_refused");
                self.w(id.0.into());
                self.s(&reason.message());
            }
            Event::ChestTaken { chest, by, pick } => {
                self.s("chest_taken");
                self.w((*chest).into());
                self.w(by.0.into());
                self.w(i64::from(*pick) as u64);
            }
            Event::AbilityHit {
                victim,
                by,
                ability,
                amount,
            } => {
                self.s("ability_hit");
                self.w(victim.0.into());
                self.opt(by.map(|p| p.0.into()));
                self.s(ability.as_str());
                self.f(*amount);
            }
            Event::CastStarted {
                id,
                ability,
                ms,
                target,
                x,
                y,
            } => {
                self.s("cast_started");
                self.w(id.0.into());
                self.s(ability.as_str());
                self.f(*ms);
                self.opt(target.map(|p| p.0.into()));
                self.f(*x);
                self.f(*y);
            }
            Event::CastLanded {
                id,
                ability,
                target,
                x,
                y,
                to,
            } => {
                self.s("cast_landed");
                self.w(id.0.into());
                self.s(ability.as_str());
                self.opt(target.map(|p| p.0.into()));
                self.f(*x);
                self.f(*y);
                match to {
                    None => self.w(0),
                    Some(to) => {
                        self.w(1);
                        self.f(to.x);
                        self.f(to.y);
                    }
                }
            }
            Event::CastEnded {
                id,
                ability,
                reason,
            } => {
                self.s("cast_ended");
                self.w(id.0.into());
                self.s(ability.as_str());
                self.w(*reason as u64);
            }
            Event::StatusApplied { id, kind, ms, by } => {
                self.s("status_applied");
                self.w(id.0.into());
                self.w(*kind as u64);
                self.f(*ms);
                self.opt(by.map(|p| p.0.into()));
            }
            Event::PlagueNotice { recipient, notice } => {
                self.s("plague_notice");
                self.w(recipient.0 as u64);
                match notice {
                    rh_sim::events::PlagueNotice::Consumed { player } => {
                        self.w(1);
                        self.w(player.0 as u64);
                    }
                    other => {
                        self.w(0);
                        self.s(other.message());
                    }
                }
            }
            Event::MarkNotice { recipient, notice } => {
                self.s("mark_notice");
                self.w(recipient.0 as u64);
                match notice {
                    rh_sim::events::MarkNotice::Hunting { target } => {
                        self.s("hunting");
                        self.w(target.0 as u64);
                    }
                    rh_sim::events::MarkNotice::HuntComplete { stacks } => {
                        self.s("hunt_complete");
                        self.w(u64::from(*stacks));
                    }
                    other => self.s(other.message()),
                }
            }
            Event::SignatureHit {
                victim,
                by,
                sig,
                weapon,
                amount,
            } => {
                self.s("signature_hit");
                self.w(victim.0 as u64);
                self.w(by.0 as u64);
                self.w(*sig as u64);
                self.s(weapon.map_or("-", |w| w.as_str()));
                self.f(*amount);
            }
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
            Event::ProjectileLaunched(p) => {
                self.s("projectile");
                self.flight(p);
            }
            Event::ProjectileEnded { launch, at, reason } => {
                self.s("projEnd");
                self.flight(launch);
                self.f(at.x);
                self.f(at.y);
                self.w(*reason as u64);
            }
            Event::Block {
                id,
                by,
                weapon,
                passive,
            } => {
                if *passive {
                    self.s("passive");
                }
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
            Event::Heal { id, amount } => {
                self.s("heal");
                self.w(id.0 as u64);
                self.f(*amount);
            }
            Event::AttackCancelled { id } => {
                self.s("cancel");
                self.w(id.0 as u64);
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
                    GvReason::Skip => "skip",
                    GvReason::Mob => "mob",
                    GvReason::Elite => "elite",
                    GvReason::Quest => "quest",
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
        self.s(r.faction.map_or("-", |f| f.as_str()));
        self.s(r.weapon.map_or("-", |w| w.as_str()));
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
        Phase::Planning => "planning",
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

#[cfg(test)]
mod ending_metadata_tests {
    use super::*;
    #[test]
    fn the_private_digest_includes_both_result_metadata_fields() {
        let mut r = RunResult {
            outcome: Outcome::Won,
            profile: "Subject".into(),
            faction: None,
            weapon: None,
            duration_sec: 1,
            kills: 0,
            killed_by: None,
            killed_by_bot: false,
            place: 1,
            players: 3,
            gv: Default::default(),
            win_bonus_withheld: false,
            win_bonus_why: None,
        };
        let digest = |r: &RunResult| {
            let mut d = OutcomeDigest::new();
            d.result(r);
            d.value()
        };
        let original = digest(&r);
        r.faction = Some(rh_sim::FactionId::Holy);
        assert_ne!(original, digest(&r));
        r.faction = None;
        r.weapon = Some(rh_sim::WeaponId::Wand);
        assert_ne!(original, digest(&r));
    }
}
