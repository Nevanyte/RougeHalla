//! Sealed derived reports, frozen against the completed step. Never hashed or checkpointed.
use std::sync::Arc;
// Representation limits for the bounded eight-player producer. Checked before copying.
pub(crate) const FX_REPORT_EVENTS_MAX: usize = 512;
pub(crate) const ABILITY_CONTRIBUTIONS_MAX: usize = crate::constants::MAX_PLAYERS
    * (crate::constants::MAX_PLAYERS + 1)
    * crate::status_runtime::AbilityId::ALL.len();
pub(crate) const FX_REPORT_OPS_MAX: usize = 20 + ABILITY_CONTRIBUTIONS_MAX;
pub(crate) const FX_PUBLIC_BUCKETS_MAX: usize = 128
    + crate::constants::MAX_PLAYERS
        * (crate::constants::MAX_PLAYERS + 1)
        * crate::status_runtime::AbilityId::ALL.len();
pub(crate) const FX_INSTANT_BUCKETS_MAX: usize = 16;
pub(crate) const FX_OUTPUT_EVENTS_MAX: usize =
    FX_REPORT_EVENTS_MAX + 2 * FX_PUBLIC_BUCKETS_MAX + FX_INSTANT_BUCKETS_MAX;
use crate::systems::signatures::LandedHit;
use crate::{Event, PlayerId, Sim};
#[derive(Debug)]
pub(crate) struct Projection {
    pub(crate) identity: Arc<()>,
    pub(crate) report: FxTickReport,
}
impl Projection {
    pub(crate) fn empty_at(tick: u32) -> Self {
        let identity = Arc::new(());
        let mut report = FxTickReport::empty(identity.clone());
        report.tick = tick;
        Self { report, identity }
    }
}
impl Default for Projection {
    fn default() -> Self {
        Self::empty_at(0)
    }
}
impl Clone for Projection {
    fn clone(&self) -> Self {
        Self::empty_at(self.report.tick)
    }
}
#[derive(Clone, Debug)]
pub(crate) enum Op {
    Contribution(LandedHit),
    Flush(usize),
    AbilityFlush(usize),
    Reset(usize),
    InstantFlush(usize),
}
#[derive(Debug, Default)]
pub(crate) struct TickFx {
    pub(crate) ops: Vec<Op>,
}
#[derive(Debug)]
pub struct FxTickReport {
    pub(crate) identity: Arc<()>,
    pub(crate) tick: u32,
    pub(crate) complete: bool,
    pub(crate) viewers: Vec<PlayerId>,
    pub(crate) seen: Vec<u8>,
    // One viewer bitmask per mob; actor count is independent of the seat limit.
    pub(crate) mob_seen: Vec<(PlayerId, u8)>,
    pub(crate) ops: Vec<Op>,
    pub(crate) events: Vec<Event>,
    pub(crate) bounded: bool,
}
impl FxTickReport {
    pub(crate) fn empty(identity: Arc<()>) -> Self {
        Self {
            identity,
            tick: 0,
            complete: false,
            viewers: Vec::with_capacity(8),
            seen: Vec::with_capacity(8),
            mob_seen: Vec::new(),
            ops: Vec::with_capacity(FX_REPORT_OPS_MAX),
            events: Vec::with_capacity(FX_REPORT_EVENTS_MAX),
            bounded: true,
        }
    }
    pub fn tick(&self) -> u32 {
        self.tick
    }
    pub(crate) fn sees(&self, viewer: usize, id: PlayerId) -> bool {
        self.viewers
            .iter()
            .position(|&v| v == id)
            .is_some_and(|j| self.seen[viewer] & (1 << j) != 0)
            || self
                .mob_seen
                .binary_search_by_key(&id, |(id, _)| *id)
                .is_ok_and(|j| self.mob_seen[j].1 & (1 << viewer) != 0)
    }
}
impl Sim {
    /// Last complete step only. Restore/clone have no complete report until their next step.
    pub fn fx_report(&self) -> &FxTickReport {
        &self.projection.report
    }
    pub(crate) fn finish_fx_report(&mut self, events: &[Event], offset: usize) {
        let r = &mut self.projection.report;
        r.identity = self.projection.identity.clone();
        r.tick = self.w.tick;
        r.complete = true;
        r.viewers.clear();
        r.seen.clear();
        r.mob_seen.clear();
        r.ops.clear();
        r.events.clear();
        r.bounded = self.s.performed_bounded
            && self.w.players.len() <= 8
            && events.len() <= FX_REPORT_EVENTS_MAX
            && events
                .iter()
                .filter(|e| {
                    matches!(
                        e,
                        Event::SignatureHit {
                            sig: crate::factions::SignatureKind::Backlash
                                | crate::factions::SignatureKind::Mark,
                            ..
                        }
                    )
                })
                .count()
                <= FX_REPORT_EVENTS_MAX
            && self
                .s
                .fx
                .ops
                .iter()
                .filter(|o| matches!(o, Op::InstantFlush(_)))
                .count()
                <= 1
            && self
                .s
                .fx
                .ops
                .iter()
                .filter(|o| matches!(o, Op::Reset(_)))
                .count()
                <= 1
            && self.s.fx.ops.len() <= FX_REPORT_OPS_MAX
            && self
                .s
                .fx
                .ops
                .iter()
                .filter(|o| matches!(o, Op::Flush(_)))
                .count()
                <= 2
            && self
                .s
                .fx
                .ops
                .iter()
                .filter(|o| matches!(o, Op::Contribution(_)))
                .count()
                <= 16 + ABILITY_CONTRIBUTIONS_MAX;
        if !r.bounded {
            return;
        }
        r.viewers.extend(self.w.players.iter().map(|p| p.id));
        let wards = crate::vision::WardSight::of(&self.k, &self.w);
        for me in &self.w.players {
            let mut mask = 0;
            for (j, p) in self.w.players.iter().enumerate() {
                if me.id == p.id
                    || crate::vision::actor_visible(
                        self.k.collision_view(self.w.rt.gates_locked),
                        me,
                        p,
                        self.w.tick,
                        wards,
                    )
                {
                    mask |= 1 << j;
                }
            }
            r.seen.push(mask);
        }
        for mob in &self.w.mobs {
            let mut mask = 0;
            if !crate::status_runtime::hidden(&mob.core.statuses.instances, self.w.server_time) {
                for (i, me) in self.w.players.iter().enumerate() {
                    if crate::vision::point_visible(
                        self.k.collision_view(self.w.rt.gates_locked),
                        me,
                        mob.core.pos(),
                        self.w.tick,
                        wards,
                    ) {
                        mask |= 1 << i;
                    }
                }
            }
            r.mob_seen.push((mob.core.id, mask));
        }
        r.mob_seen.sort_unstable_by_key(|(id, _)| *id);
        r.ops
            .extend(self.s.fx.ops.iter().cloned().map(|op| match op {
                Op::Flush(i) => Op::Flush(i - offset),
                Op::AbilityFlush(i) => Op::AbilityFlush(i - offset),
                Op::Reset(i) => Op::Reset(i - offset),
                Op::InstantFlush(i) => Op::InstantFlush(i - offset),
                o => o,
            }));
        r.events.extend_from_slice(events);
    }
}
