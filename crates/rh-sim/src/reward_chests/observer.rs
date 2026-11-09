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
    pub(crate) fn renewed(&self) -> Self {
        Self {
            next: self.next,
            ..Self::new(self.viewer)
        }
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
        self.stage_into_where(sim, out, build, |_| true)
    }

    pub(crate) fn stage_into_where(
        &mut self,
        sim: &Sim,
        out: &mut Vec<RewardChestView>,
        build: &mut Option<BuildView>,
        accept: impl Fn(&[RewardOptionView]) -> bool,
    ) -> Result<RewardStage, OfferError> {
        let tick = sim.tick();
        if self.sampled.is_some_and(|v| v > tick) {
            return Err(OfferError::EarlierTick);
        }
        self.scratch.clear();
        *build = sim.player(self.viewer).map(|p| BuildView::from(&p.build));
        if let Some(me) = sim.player(self.viewer) {
            self.vision.begin(sim, me, self.sampled.is_some());
            let wards = crate::vision::WardSight::of_sim(sim);
            for c in &sim.w.reward_chests {
                // Source human readReward and bot seeChests hide another player's Trophy entirely.
                // Reject it before inspecting position/options or staging any public handle/binding.
                if c.owner.is_some_and(|owner| owner != self.viewer) {
                    continue;
                }
                if !self
                    .vision
                    .sees(sim.collision_view(), me, c.at, tick, wards)
                {
                    continue;
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
                                            wards,
                                        )
                                    })
                            }),
                        })
                    })
                    .collect::<Vec<_>>();
                // A presentation adapter may omit an entire unsupported row, never individual options.
                // Filter before handles/candidate bindings are staged, so an unpublished row grants no action.
                if !accept(&options) {
                    continue;
                }
                if self.scratch.len() == crate::item_view::MAX_VISIBLE_PROPS {
                    return Err(OfferError::TooManyChests);
                }
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
                            && super::birth_available(c.held_until_tick, tick)
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
                        crate::vision::point_visible(
                            sim.collision_view(),
                            me,
                            c.at,
                            sim.tick(),
                            crate::vision::WardSight::of_sim(sim),
                        )
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
    // Compare complete public identities, never colliding numeric ranges or private entity IDs.
    let option_cmp = |a: &RewardOptionView, b: &RewardOptionView| {
        let key = |id: OptionId| match id {
            OptionId::Card(c) => (0, c.index()),
            OptionId::Boost(s) => (1, s.index()),
            OptionId::Kill(a) => (2, a.key.index()),
        };
        key(a.id)
            .cmp(&key(b.id))
            .then_with(|| match (a.id, b.id) {
                (OptionId::Kill(a), OptionId::Kill(b)) => a.gain.total_cmp(&b.gain),
                _ => std::cmp::Ordering::Equal,
            })
            .then(a.taken.cmp(&b.taken))
            .then(a.taken_by.cmp(&b.taken_by))
    };
    a.at.x
        .total_cmp(&b.at.x)
        .then(a.at.y.total_cmp(&b.at.y))
        .then(a.expires_at.total_cmp(&b.expires_at))
        .then_with(|| {
            a.options
                .iter()
                .zip(&b.options)
                .map(|(a, b)| option_cmp(a, b))
                .find(|order| !order.is_eq())
                .unwrap_or_else(|| a.options.len().cmp(&b.options.len()))
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

#[cfg(test)]
mod presentation_filter_tests {
    use super::*;

    #[test]
    fn unsupported_mixed_rows_have_no_bindings_or_effect_on_supported_epochs() {
        let mut sim = Sim::reset_active(
            crate::SimConfig {
                consumables: false,
                ..Default::default()
            },
            crate::arenas::practice_arena(),
            crate::Secrets::from_seed(7),
            &[crate::Placement {
                profile: "owner".into(),
                faction: crate::FactionId::Fire,
                bot: false,
                at: Vec2::new(200., 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            }],
        );
        let mixed = super::super::drop_trophy(
            &mut sim.w,
            Vec2::new(200., 320.),
            PlayerId(1),
            &[crate::kill_augments::KillAugment {
                key: crate::kill_augments::KillStatKey::Ad,
                gain: 6.,
            }],
        );
        sim.w
            .reward_chests
            .iter_mut()
            .find(|c| c.id == mixed)
            .unwrap()
            .options[1] = Some(OptionId::Card(crate::cards::CardId::ALL[79]));
        let supported = super::super::drop_stat(&mut sim.w, Vec2::new(220., 320.));
        let mut observer = RewardChestObserver::new(PlayerId(1));
        let mut rows = Vec::new();
        let mut build = None;
        let accept = |options: &[RewardOptionView]| {
            options.iter().all(|o| !matches!(o.id, OptionId::Kill(_)))
        };
        let stage = observer
            .stage_into_where(&sim, &mut rows, &mut build, accept)
            .unwrap();
        assert!(stage.changed);
        assert_eq!(rows.len(), 1, "the entire mixed row is omitted");
        assert!(
            observer.ids.is_empty(),
            "preparation did not commit any candidate binding"
        );
        assert_eq!(
            observer.scratch.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![supported]
        );
        let options = rows[0].options.clone();
        let handle = rows[0].handle;
        observer.commit_stage(stage);
        assert_eq!(observer.ids, vec![supported]);
        assert_eq!(
            observer.next,
            u64::from(handle.wire()) + 1,
            "omitted rows consume no handle block"
        );
        assert_eq!(
            observer
                .resolve(
                    &sim,
                    RewardChestHandle::from_wire(handle.wire() + 1).unwrap(),
                    0
                )
                .unwrap(),
            crate::validate(crate::RawCommand::Choose {
                chest_id: None,
                pick: 0
            })
            .unwrap()
        );
        sim.w
            .reward_chests
            .iter_mut()
            .find(|c| c.id == mixed)
            .unwrap()
            .options[0] = Some(OptionId::Kill(crate::kill_augments::KillAugment {
            key: crate::kill_augments::KillStatKey::Ad,
            gain: 9.,
        }));
        sim.step();
        let stage = observer
            .stage_into_where(&sim, &mut rows, &mut build, accept)
            .unwrap();
        assert!(
            !stage.changed,
            "changes in omitted rows cannot renew supported offers"
        );
        assert_eq!(rows[0].handle, handle);
        assert_eq!(
            rows[0].options, options,
            "supported option indices remain unchanged"
        );
        let mut native = RewardChestObserver::new(PlayerId(1));
        let native_offer = native.prepare_into(&sim, &mut rows, &mut build).unwrap();
        assert_eq!(
            rows.len(),
            2,
            "the default native path includes both complete rows"
        );
        native_offer.commit();
        assert!(native.ids.contains(&mixed));
    }
}

#[cfg(test)]
#[path = "trophy_observer_tests.rs"]
mod trophy_observer_tests;

#[cfg(test)]
mod renewal_tests {
    use super::*;
    #[test]
    fn renewed_reward_epoch_preserves_counters_and_original_bindings() {
        for next in [19, u32::MAX as u64 + 1] {
            let mut old = RewardChestObserver::new(PlayerId(3));
            old.next = next;
            old.sampled = Some(7);
            old.ids.push(11);
            let replacement = old.renewed();
            assert_eq!((replacement.viewer, replacement.next), (old.viewer, next));
            assert!(
                replacement.sampled.is_none()
                    && replacement.ids.is_empty()
                    && replacement.rows.is_empty()
                    && replacement.retired.is_empty()
            );
            assert_eq!(old.ids, [11]);
            assert_eq!(old.next, next);
        }
    }
}
