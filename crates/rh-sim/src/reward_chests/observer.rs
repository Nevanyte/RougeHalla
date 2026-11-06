//! Reliable-publication staging for reward offers. Only redacted, encoded public facts affect handles.
use super::*;
use crate::{Command, PublicCommand, Reject, Sim};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OfferError {
    EarlierTick,
    TooManyChests,
    HandlesExhausted,
    InvalidPosition,
}
struct Candidate {
    id: u32,
    row: RewardChestView,
}
struct Retired {
    tick: u32,
    first: u32,
    ids: Vec<u32>,
}
pub struct RewardChestObserver {
    viewer: PlayerId,
    next: u64,
    first: u32,
    issued: u32,
    sampled: Option<u32>,
    ids: Vec<u32>,
    rows: Vec<RewardChestView>,
    scratch: Vec<Candidate>,
    retired: Vec<Retired>,
    vision: crate::vision::TileVisionCache,
}
impl RewardChestObserver {
    pub fn new(viewer: PlayerId) -> Self {
        Self {
            viewer,
            next: 1,
            first: 1,
            issued: 0,
            sampled: None,
            ids: Vec::new(),
            rows: Vec::new(),
            scratch: Vec::new(),
            retired: Vec::new(),
            vision: Default::default(),
        }
    }
    pub fn viewer(&self) -> PlayerId {
        self.viewer
    }
    pub fn reconnect(&mut self) {
        let next = self.next;
        *self = Self::new(self.viewer);
        self.next = next;
    }
    /// Prepare against current Sim visibility. Commit only after reliable publication.
    pub fn prepare_into<'a>(
        &'a mut self,
        sim: &Sim,
        out: &mut Vec<RewardChestView>,
        build: &mut Option<BuildView>,
    ) -> Result<PreparedRewardOffer<'a>, OfferError> {
        let stage = self.stage_into(sim, out, build)?;
        Ok(PreparedRewardOffer {
            observer: self,
            tick: stage.tick,
            changed: stage.changed,
        })
    }
    pub(crate) fn stage_into(
        &mut self,
        sim: &Sim,
        out: &mut Vec<RewardChestView>,
        build: &mut Option<BuildView>,
    ) -> Result<RewardStage, OfferError> {
        let tick = sim.tick();
        if self.sampled.is_some_and(|v| v > tick) {
            return Err(OfferError::EarlierTick);
        }
        self.scratch.clear();
        *build = sim.player(self.viewer).map(|p| BuildView::from(&p.build));
        if let Some(me) = sim.player(self.viewer) {
            self.vision.begin(sim, me, self.sampled.is_some());
            for c in &sim.w.reward_chests {
                if !self.vision.sees(sim.collision_view(), me, c.at, tick) {
                    continue;
                }
                if self.scratch.len() == crate::item_view::MAX_VISIBLE_PROPS {
                    return Err(OfferError::TooManyChests);
                }
                let encode = |x: f64| -> Result<f64, OfferError> {
                    let x = x as f32;
                    if !(0.0..=65535.0 / 8.0).contains(&x) {
                        return Err(OfferError::InvalidPosition);
                    }
                    Ok((f64::from(x) * 8. + 0.5).floor() / 8.)
                };
                let options = c
                    .options
                    .iter()
                    .zip(&c.taken)
                    .filter_map(|(o, t)| {
                        o.map(|id| RewardOptionView {
                            id,
                            taken: t.is_some(),
                            taken_by: t.filter(|who| {
                                *who == self.viewer
                                    || sim.player(*who).is_some_and(|p| {
                                        crate::vision::actor_visible(
                                            sim.collision_view(),
                                            me,
                                            p,
                                            tick,
                                        )
                                    })
                            }),
                        })
                    })
                    .collect();
                let picked = c.pickers.contains(&self.viewer);
                self.scratch.push(Candidate {
                    id: c.id,
                    row: RewardChestView {
                        handle: RewardChestHandle::from_wire(1).expect("nonzero placeholder"),
                        at: Vec2::new(encode(c.at.x)?, encode(c.at.y)?),
                        expires_at: c.expires_at,
                        options,
                        picked,
                        can_choose: me.standing()
                            && !crate::status_runtime::action_blocked(
                                &me.statuses,
                                sim.server_time(),
                            )
                            && !picked
                            && c.owner.is_none_or(|id| id == self.viewer)
                            && c.held_until_tick < tick
                            && sim.server_time() < c.expires_at
                            && super::reach(&sim.k, sim.w.rt.gates_locked, me.pos(), c.at).is_ok(),
                    },
                });
            }
        }
        self.scratch.sort_by(|a, b| public_cmp(&a.row, &b.row));
        let changed = !self
            .scratch
            .iter()
            .map(|c| &c.row)
            .zip(&self.rows)
            .all(|(a, b)| public_cmp(a, b).is_eq())
            || self.scratch.len() != self.rows.len()
            || (!self.scratch.is_empty() && tick - self.issued >= 20);
        if changed && self.next + self.scratch.len() as u64 > u64::from(u32::MAX) + 1 {
            return Err(OfferError::HandlesExhausted);
        }
        out.clear();
        for (i, c) in self.scratch.iter().enumerate() {
            let mut row = c.row.clone();
            row.handle = if changed {
                RewardChestHandle::from_wire((self.next + i as u64) as u32)
                    .expect("checked handle range")
            } else {
                self.rows[i].handle
            };
            out.push(row);
        }
        Ok(RewardStage { tick, changed })
    }
    pub fn resolve(
        &self,
        sim: &Sim,
        handle: RewardChestHandle,
        pick: i8,
    ) -> Result<Command, Reject> {
        let lookup = |first: u32, ids: &[u32]| {
            handle
                .wire()
                .checked_sub(first)
                .and_then(|i| ids.get(i as usize))
                .copied()
        };
        let id = lookup(self.first, &self.ids).or_else(|| {
            self.retired
                .iter()
                .filter(|b| sim.tick().checked_sub(b.tick).is_some_and(|age| age < 20))
                .find_map(|b| lookup(b.first, &b.ids))
        });
        let chest_id = id.filter(|id| {
            sim.player(self.viewer).is_some_and(|me| {
                sim.w
                    .reward_chests
                    .iter()
                    .find(|c| c.id == *id)
                    .is_some_and(|c| {
                        crate::vision::point_visible(sim.collision_view(), me, c.at, sim.tick())
                    })
            })
        });
        crate::validate(crate::RawCommand::Choose { chest_id, pick })
    }
    pub fn resolve_public(
        &self,
        sim: &Sim,
        command: PublicCommand,
    ) -> Option<Result<Command, Reject>> {
        match command {
            PublicCommand::Choose { handle, pick } => Some(self.resolve(sim, handle, pick)),
            _ => None,
        }
    }
}
fn public_cmp(a: &RewardChestView, b: &RewardChestView) -> std::cmp::Ordering {
    let code = |v: OptionId| match v {
        OptionId::Card(c) => c.index() as u8,
        OptionId::Boost(s) => 3 + s.index() as u8,
    };
    a.at.x
        .total_cmp(&b.at.x)
        .then(a.at.y.total_cmp(&b.at.y))
        .then(a.expires_at.total_cmp(&b.expires_at))
        .then_with(|| {
            a.options
                .iter()
                .map(|o| (code(o.id), o.taken, o.taken_by))
                .cmp(b.options.iter().map(|o| (code(o.id), o.taken, o.taken_by)))
        })
        .then(a.picked.cmp(&b.picked))
        .then(a.can_choose.cmp(&b.can_choose))
}
#[must_use = "commit only after reliable publication; dropping does not issue handles"]
pub struct PreparedRewardOffer<'a> {
    observer: &'a mut RewardChestObserver,
    tick: u32,
    changed: bool,
}
impl PreparedRewardOffer<'_> {
    pub fn changed(&self) -> bool {
        self.changed
    }
    pub fn commit(self) {
        self.observer.commit_stage(RewardStage {
            tick: self.tick,
            changed: self.changed,
        });
    }
}
#[derive(Clone, Copy)]
pub(crate) struct RewardStage {
    tick: u32,
    pub(crate) changed: bool,
}
impl RewardChestObserver {
    pub(crate) fn commit_stage(&mut self, stage: RewardStage) {
        let s = self;
        if stage.changed {
            if !s.ids.is_empty() {
                s.retired.push(Retired {
                    tick: stage.tick,
                    first: s.first,
                    ids: std::mem::take(&mut s.ids),
                });
            }
            s.first = s.next as u32;
            s.next += s.scratch.len() as u64;
            s.issued = stage.tick;
        }
        s.ids.clear();
        s.ids.extend(s.scratch.iter().map(|c| c.id));
        s.rows.clear();
        for (i, c) in s.scratch.iter().enumerate() {
            let mut row = c.row.clone();
            row.handle = RewardChestHandle::from_wire(s.first + i as u32).expect("committed range");
            s.rows.push(row);
        }
        s.retired.retain(|r| stage.tick - r.tick < 20);
        s.sampled = Some(stage.tick);
    }
}
