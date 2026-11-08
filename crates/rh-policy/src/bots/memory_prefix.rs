//! Bounded seen-player/owner-motion memory. Only delivered::Frame is accepted; no Sim,
//! raw Observation, raw events, locks, NPC brains, minimap or action-binding access exists.
//! This is the source memory's field-fold subset, not full memory/FrameRing parity.
use super::delivered::{Actor, Epoch, Fact, Frame, PlayerRef};
use super::types::{TierId, TierParams};
use rh_sim::{FactionId, Status, Vec2, WeaponId};
const HP_FORGET_MS: f64 = 20_000.;
pub const MAX_RECORDS: usize = 512;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Limit,
    Epoch,
    ClockResetRequired,
    OwnerAbsent,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum HpBelief {
    Observed { share: f64, at: f64 },
    ForgottenAssumedFull,
}
impl HpBelief {
    /// Source policy's explicit forgetting heuristic, NOT a current authoritative hp fact.
    pub fn source_estimate(self) -> f64 {
        match self {
            Self::Observed { share, .. } => share,
            Self::ForgottenAssumedFull => 1.,
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct RememberedPlayer {
    pub id: PlayerRef,
    pos: Vec2,
    pub seen_at: f64,
    pub faction: FactionId,
    pub in_hand: Option<WeaponId>,
    pub other_slot: Option<WeaponId>,
    pub weapons_seen: Vec<WeaponId>,
    pub alive: bool,
    pub died_at: Option<f64>,
    pub bounty: u16,
    hp_share: f64,
    last_nonempty: Option<WeaponId>,
}
impl RememberedPlayer {
    fn hp_belief(&self, now: f64) -> HpBelief {
        if now - self.seen_at > HP_FORGET_MS {
            HpBelief::ForgottenAssumedFull
        } else {
            HpBelief::Observed {
                share: self.hp_share,
                at: self.seen_at,
            }
        }
    }
}
/// Navigation uncertainty only. This is deliberately not an action target/reference capability.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Whereabouts {
    pub at: Vec2,
    pub radius: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OwnMotion {
    pub anchor: Vec2,
    pub still_since: f64,
    pub last_position: Vec2,
    pub source_time: f64,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Memory {
    epoch: Epoch,
    viewer: PlayerRef,
    tier: TierId,
    limit: usize,
    last_time: Option<f64>,
    records: Vec<RememberedPlayer>,
    motion: Option<OwnMotion>,
}
impl Memory {
    pub fn new(epoch: Epoch, viewer: PlayerRef, tier: TierId, limit: usize) -> Result<Self, Error> {
        if limit == 0 || limit > MAX_RECORDS {
            return Err(Error::Limit);
        }
        Ok(Self {
            epoch,
            viewer,
            tier,
            limit,
            last_time: None,
            records: Vec::new(),
            motion: None,
        })
    }
    /// Explicit match/reconnect/training-reset/source-clock epoch boundary; no prior identity or input survives.
    pub fn reset(&mut self, epoch: Epoch, viewer: PlayerRef) {
        self.epoch = epoch;
        self.viewer = viewer;
        self.last_time = None;
        self.records.clear();
        self.motion = None;
    }
    /// Refusal is atomic: caller must not run a new decision from a failed frame.
    /// Equal/backward clocks require an explicit reset, not guessed tick arithmetic or replayed events.
    pub fn observe(&mut self, frame: &Frame) -> Result<(), Error> {
        if frame.epoch() != self.epoch || frame.viewer() != self.viewer {
            return Err(Error::Epoch);
        }
        let now = frame.source_time();
        if self.last_time.is_some_and(|t| now <= t) {
            return Err(Error::ClockResetRequired);
        }
        let Fact::Delivered(Some(owner)) = frame.owner() else {
            return Err(Error::OwnerAbsent);
        };
        // A delivered interest scene is not a source camera percept. This instantaneous
        // subset may only narrow it; delayed/render-time FrameRing parity is still held.
        let eligible = |a: &Actor| {
            a.reference.player().is_some()
                && a.effects & super::wish::EFFECT_HIDDEN == 0
                && super::view::in_view(owner.x, owner.y, a.x, a.y, 0.)
        };
        let incoming = frame
            .actors()
            .iter()
            .filter(|a| eligible(a))
            .filter_map(|a| a.reference.player())
            .filter(|id| !self.records.iter().any(|r| r.id == *id))
            .count();
        if self.records.len() + incoming > self.limit {
            return Err(Error::Limit);
        }
        // Source foldSelf's anchor changes only after >1u, not after every subpixel sample.
        let pos = Vec2::new(owner.x, owner.y);
        let mut motion = self.motion.unwrap_or(OwnMotion {
            anchor: pos,
            still_since: now,
            last_position: pos,
            source_time: now,
        });
        if rh_sim::math::hypot(pos.x - motion.anchor.x, pos.y - motion.anchor.y) > 1. {
            motion.anchor = pos;
            motion.still_since = now;
        }
        motion.last_position = pos;
        motion.source_time = now;
        self.motion = Some(motion);
        for a in frame.actors().iter().filter(|a| eligible(a)) {
            let Some(id) = a.reference.player() else {
                continue;
            };
            let index = match self.records.iter().position(|r| r.id == id) {
                Some(i) => i,
                None => {
                    self.records.push(RememberedPlayer {
                        id,
                        pos: Vec2::new(a.x, a.y),
                        seen_at: now,
                        faction: a.faction,
                        in_hand: None,
                        other_slot: None,
                        weapons_seen: Vec::new(),
                        alive: true,
                        died_at: None,
                        bounty: 0,
                        hp_share: 1.,
                        last_nonempty: None,
                    });
                    self.records.len() - 1
                }
            };
            let r = &mut self.records[index];
            if matches!(a.status, Status::Dead | Status::Mia) && r.alive {
                r.alive = false;
                r.died_at = Some(now);
            }
            let held = (a.weapon != WeaponId::Fists).then_some(a.weapon);
            if let Some(weapon) = held {
                if !r.weapons_seen.contains(&weapon) {
                    r.weapons_seen.push(weapon);
                }
                if r.last_nonempty.is_some_and(|prior| prior != weapon) {
                    r.other_slot = r.last_nonempty;
                }
                r.last_nonempty = Some(weapon);
            }
            r.in_hand = held;
            r.faction = a.faction;
            r.pos = Vec2::new(a.x, a.y);
            r.seen_at = now;
            r.hp_share = f64::from(a.hp_pct) / 100.;
            r.bounty = a.bounty;
        }
        self.last_time = Some(now);
        Ok(())
    }
    /// Historical facts only. Positions are exposed for navigation only through whereabouts,
    /// which enforces the actual tier expiry at the last accepted delivered source time.
    pub fn records(&self) -> &[RememberedPlayer] {
        &self.records
    }
    pub fn own_motion(&self) -> Option<OwnMotion> {
        self.motion
    }
    pub fn hp_belief(&self, id: PlayerRef) -> Option<HpBelief> {
        Some(
            self.records
                .iter()
                .find(|r| r.id == id)?
                .hp_belief(self.last_time?),
        )
    }
    pub fn whereabouts(&self, id: PlayerRef) -> Option<Whereabouts> {
        let now = self.last_time?;
        let record = self.records.iter().find(|r| r.id == id)?;
        if !record.alive {
            return None;
        }
        let age = (now - record.seen_at).max(0.);
        if age > TierParams::by_id(self.tier).memory_span_ms {
            return None;
        }
        Some(Whereabouts {
            at: record.pos,
            radius: 0.6 * rh_sim::constants::PLAYER_SPEED * (age / 1000.),
        })
    }
}
#[cfg(test)]
mod tests;
