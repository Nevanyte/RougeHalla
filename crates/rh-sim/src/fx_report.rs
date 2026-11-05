//! Sealed derived reports, frozen against the completed step. Never hashed or checkpointed.
use std::sync::Arc;
// Representation limits for the bounded eight-player producer. Checked before copying.
pub(crate) const FX_REPORT_EVENTS_MAX: usize = 512;
pub(crate) const FX_REPORT_OPS_MAX: usize = 20;
pub(crate) const FX_PUBLIC_BUCKETS_MAX: usize = 64;
pub(crate) const FX_OUTPUT_EVENTS_MAX: usize = FX_REPORT_EVENTS_MAX + 2 * FX_PUBLIC_BUCKETS_MAX;
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
    Reset(usize),
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
        r.ops.clear();
        r.events.clear();
        r.bounded = self.w.players.len() <= 8
            && events.len() <= FX_REPORT_EVENTS_MAX
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
                <= 16;
        if !r.bounded {
            return;
        }
        r.viewers.extend(self.w.players.iter().map(|p| p.id));
        for me in &self.w.players {
            let mut mask = 0;
            for (j, p) in self.w.players.iter().enumerate() {
                if me.id == p.id
                    || crate::vision::actor_visible(&self.k.arena.map, me, p, self.w.tick)
                {
                    mask |= 1 << j;
                }
            }
            r.seen.push(mask);
        }
        r.ops
            .extend(self.s.fx.ops.iter().cloned().map(|op| match op {
                Op::Flush(i) => Op::Flush(i - offset),
                Op::Reset(i) => Op::Reset(i - offset),
                o => o,
            }));
        r.events.extend_from_slice(events);
    }
}
