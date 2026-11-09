//! Bounded seen-player/owner-motion memory, shared by the decoded-frame diagnostic and
//! the Observation-only policy's explicitly copied Scene. No Sim, raw events, locks,
//! NPC brains, minimap or action-binding access exists. These field/stimulus/last-sent
//! folds are not full memory/FrameRing parity or proof of network delivery.
use super::delivered::{Epoch, Fact, Frame, PlayerRef};
use super::types::{Command, Stimulus, StimulusKind, TimedCommand};
use super::types::{TierId, TierParams};
use rh_sim::{FactionId, Status, Vec2, WeaponId};
const HP_FORGET_MS: f64 = 20_000.;
/// Policy-owned scene of already observed facts. This is not an attested network delivery.
/// Names, bot tags, draws, immunity, hidden actors and missing event origins are not manufactured.
#[derive(Clone, Copy)]
pub struct OwnerSight {
    pub at: Vec2,
    pub status: Status,
}
#[derive(Clone, Copy)]
pub struct PlayerSight {
    pub id: PlayerRef,
    pub at: Vec2,
    pub faction: FactionId,
    pub in_hand: Option<WeaponId>,
    pub hp_share: f64,
    pub bounty: u32,
    pub status: Status,
    pub hidden: bool,
}
pub struct Scene<'a> {
    pub epoch: Epoch,
    pub viewer: PlayerRef,
    pub now: f64,
    pub owner: Option<OwnerSight>,
    pub players: &'a [PlayerSight],
}
#[derive(Clone, Debug, PartialEq)]
struct Aux {
    visible: bool,
    announced: bool,
    hidden_suspect: bool,
}

pub const MAX_RECORDS: usize = 512;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Limit,
    Epoch,
    ClockResetRequired,
    OwnerAbsent,
    InvalidScene,
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
    pub bounty: u32,
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
    aux: Vec<Aux>,
    stimuli: Vec<Stimulus>,
    last_order: Option<TimedCommand>,
    last_cast: Option<TimedCommand>,
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
            aux: Vec::new(),
            stimuli: Vec::new(),
            last_order: None,
            last_cast: None,
        })
    }
    /// Explicit match/reconnect/training-reset/source-clock epoch boundary; no prior identity or input survives.
    pub fn reset(&mut self, epoch: Epoch, viewer: PlayerRef) {
        self.epoch = epoch;
        self.viewer = viewer;
        self.last_time = None;
        self.records.clear();
        self.motion = None;
        self.aux.clear();
        self.stimuli.clear();
        self.last_order = None;
        self.last_cast = None;
    }
    /// Refusal is atomic: caller must not run a new decision from a failed frame.
    /// Equal/backward clocks require an explicit reset, not guessed tick arithmetic or replayed events.
    pub fn observe(&mut self, frame: &Frame) -> Result<(), Error> {
        let players: Vec<_> = frame
            .actors()
            .iter()
            .filter_map(|a| {
                Some(PlayerSight {
                    id: a.reference.player()?,
                    at: Vec2::new(a.x, a.y),
                    faction: a.faction,
                    in_hand: (a.weapon != WeaponId::Fists).then_some(a.weapon),
                    hp_share: f64::from(a.hp_pct) / 100.,
                    bounty: u32::from(a.bounty),
                    status: a.status,
                    hidden: a.effects & super::wish::EFFECT_HIDDEN != 0,
                })
            })
            .collect();
        let Fact::Delivered(owner) = frame.owner() else {
            return Err(Error::OwnerAbsent);
        };
        self.observe_scene(Scene {
            epoch: frame.epoch(),
            viewer: frame.viewer(),
            now: frame.source_time(),
            owner: owner.map(|o| OwnerSight {
                at: Vec2::new(o.x, o.y),
                status: o.status,
            }),
            players: &players,
        })
    }
    /// Same field-fold kernel for an Observation-only policy adapter. All refusals precede mutation.
    /// The source FrameRing/delay, minimap and full event memory remain separate work.
    pub fn observe_scene(&mut self, scene: Scene<'_>) -> Result<(), Error> {
        if scene.epoch != self.epoch || scene.viewer != self.viewer {
            return Err(Error::Epoch);
        }
        let now = scene.now;
        if self.last_time.is_some_and(|t| now <= t) {
            return Err(Error::ClockResetRequired);
        }
        let owner = scene.owner.ok_or(Error::OwnerAbsent)?;
        if !now.is_finite()
            || now < 0.
            || !owner.at.x.is_finite()
            || !owner.at.y.is_finite()
            || scene.players.iter().enumerate().any(|(i, a)| {
                !a.at.x.is_finite()
                    || !a.at.y.is_finite()
                    || !a.hp_share.is_finite()
                    || !(0. ..=1.).contains(&a.hp_share)
                    || a.id == self.viewer
                    || scene.players[..i].iter().any(|prior| prior.id == a.id)
            })
        {
            return Err(Error::InvalidScene);
        }
        let eligible = |a: &&PlayerSight| {
            !a.hidden && super::view::in_view(owner.at.x, owner.at.y, a.at.x, a.at.y, 0.)
        };
        let incoming = scene
            .players
            .iter()
            .filter(eligible)
            .filter(|a| !self.records.iter().any(|r| r.id == a.id))
            .count();
        if self.records.len() + incoming > self.limit {
            return Err(Error::Limit);
        }
        self.stimuli.clear();
        // Source foldSelf's anchor changes only after >1u, not after every subpixel sample.
        let pos = owner.at;
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
        for a in scene.players.iter().filter(eligible) {
            let id = a.id;
            let index = match self.records.iter().position(|r| r.id == id) {
                Some(i) => i,
                None => {
                    self.aux.push(Aux {
                        visible: false,
                        announced: false,
                        hidden_suspect: false,
                    });
                    self.records.push(RememberedPlayer {
                        id,
                        pos: a.at,
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
            let aux = &mut self.aux[index];
            let known = aux.announced && !aux.hidden_suspect && now - r.seen_at <= 3000.;
            let central = (a.at.x - owner.at.x).abs()
                <= super::types::BOT_VIEW_HALF_W * TierParams::by_id(self.tier).attention.central
                && (a.at.y - owner.at.y).abs()
                    <= super::types::BOT_VIEW_HALF_H
                        * TierParams::by_id(self.tier).attention.central;
            let subject = Some(format!("p{}", id.get()));
            if matches!(a.status, Status::Dead | Status::Mia) && r.alive {
                r.alive = false;
                r.died_at = Some(now);
            }
            let held = a.in_hand;
            if let Some(weapon) = held {
                if !r.weapons_seen.contains(&weapon) {
                    r.weapons_seen.push(weapon);
                }
                if r.last_nonempty.is_some_and(|prior| prior != weapon) {
                    r.other_slot = r.last_nonempty;
                }
                if known && r.alive && r.in_hand.is_some_and(|prior| prior != weapon) {
                    self.stimuli.push(Stimulus {
                        kind: StimulusKind::FoeSwapped,
                        at: now,
                        subject: subject.clone(),
                        central,
                        value: None,
                    });
                }
                r.last_nonempty = Some(weapon);
            }
            r.in_hand = held;
            r.faction = a.faction;
            r.pos = a.at;
            if r.alive && a.status == Status::Alive {
                if !known {
                    self.stimuli.push(Stimulus {
                        kind: StimulusKind::NewThreat,
                        at: now,
                        subject,
                        central,
                        value: Some(rh_sim::math::hypot(
                            a.at.x - owner.at.x,
                            a.at.y - owner.at.y,
                        )),
                    });
                }
                aux.announced = true;
                aux.hidden_suspect = false;
            }
            aux.visible = true;
            r.seen_at = now;
            r.hp_share = a.hp_share;
            r.bounty = a.bounty;
        }
        for (r, a) in self.records.iter().zip(&mut self.aux) {
            if scene.players.iter().filter(eligible).any(|p| p.id == r.id) {
                continue;
            }
            if a.visible {
                a.visible = false;
                // Status-effect support is present in the admitted source/native client. Disappearance
                // from the middle can be hidden; this is a policy belief, never a new hidden fact.
                a.hidden_suspect = r.alive
                    && (r.pos.x - owner.at.x).abs() <= super::types::BOT_VIEW_HALF_W - 80.
                    && (r.pos.y - owner.at.y).abs() <= super::types::BOT_VIEW_HALF_H - 80.;
            }
        }
        if matches!(owner.status, Status::Dead | Status::Mia) {
            self.stimuli.clear();
        }
        self.last_time = Some(now);
        Ok(())
    }
    /// Historical facts only. Positions are exposed for navigation only through whereabouts,
    /// which enforces the actual tier expiry at the last accepted delivered source time.
    /// Source noteSent's observable last-order/last-cast fold, only after the policy
    /// actually emitted the released command. Pending reflection/arrival is not ported here.
    pub fn note_sent(&mut self, timed: &TimedCommand) {
        match timed.cmd {
            Command::Move { .. } | Command::Stop { .. } | Command::Target { .. } => {
                self.last_order = Some(timed.clone())
            }
            Command::Cast { .. } => self.last_cast = Some(timed.clone()),
            _ => {}
        }
    }
    pub fn last_order(&self) -> Option<&TimedCommand> {
        self.last_order.as_ref()
    }
    pub fn last_cast(&self) -> Option<&TimedCommand> {
        self.last_cast.as_ref()
    }
    pub fn stimuli(&self) -> &[Stimulus] {
        &self.stimuli
    }
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
