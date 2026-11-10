//! Sealed derived reports, frozen against the completed step. Never hashed or checkpointed.
use std::sync::Arc;
// Representation limits for the bounded eight-player producer. Checked before copying.
//
// `FX_REPORT_EVENTS_MAX` is the legacy **non-Card** sealed-event bound. The private Card history rows are a
// separately admitted, cold-prepared envelope: the actual pending Card raw rows emitted by a due flush are
// bounded by the design's checked `Q` (trusted pending rows in one populated flush) plus `T0` (the actual
// serialized pending Card rows at construction/clone/restore). The two counts are checked independently so a
// valid accepted restore with more than 512 retained historical rows flushes and serves a fresh viewer without
// being refused by the legacy small-event cap.
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

/// The independent sealed-event bound: legacy non-Card events keep the legacy cap, while the private raw Card
/// history rows are checked against the cold-prepared `Q + T0` envelope. Counting is by actual emitted event, not
/// by marker count (an empty Card marker emits no rows and must not consume the history envelope).
pub(crate) fn sealed_events_bounded(events: &[Event], card_limit: usize) -> bool {
    let mut legacy = 0usize;
    let mut card = 0usize;
    for event in events {
        if matches!(event, Event::CardBleedHit { .. }) {
            card += 1;
        } else {
            legacy += 1;
        }
    }
    legacy <= FX_REPORT_EVENTS_MAX && card <= card_limit
}
use crate::systems::signatures::LandedHit;
use crate::{Event, PlayerId, Sim};
#[derive(Debug)]
pub(crate) struct Projection {
    pub(crate) identity: Arc<()>,
    pub(crate) report: FxTickReport,
    /// Every player's overhead build marks (ADR0026) as of the end of the last step, so observations read them once per
    /// player per tick instead of once per viewer and visible player. Derived, never hashed or checkpointed; empty after
    /// a clone or a restore until the next step (observers then compute them directly).
    pub(crate) marks: BuildMarkCache,
}
/// See [`Projection::marks`]. Rows ascend by player id; the buffer is reused (no allocation while the seats are steady).
/// Every production writer of the marks' inputs (cards, mob stats, kill stats, folds, the practice console) runs inside a
/// step, so the end-of-step refresh is exact; code that edits those inputs between steps (tests) calls `invalidate`.
#[derive(Debug, Default)]
pub(crate) struct BuildMarkCache {
    tick: Option<u32>,
    rows: Vec<(PlayerId, [Option<crate::kill_augments::KillStatKey>; 2])>,
}
impl BuildMarkCache {
    fn refresh(&mut self, w: &crate::state::World) {
        self.rows.clear();
        self.rows.extend(
            w.players
                .iter()
                .map(|p| (p.id, crate::kill_augments::build_marks(p))),
        );
        if !self.rows.is_sorted_by_key(|(id, _)| *id) {
            self.rows.sort_unstable_by_key(|(id, _)| *id);
        }
        self.tick = Some(w.tick);
    }
    /// Drops the cache; observers compute the marks directly until the next step.
    #[cfg(test)]
    pub(crate) fn invalidate(&mut self) {
        self.tick = None;
    }
    /// The cached marks of `p` when they belong to `tick`, else computed now.
    pub(crate) fn of(
        &self,
        p: &crate::state::Player,
        tick: u32,
    ) -> [Option<crate::kill_augments::KillStatKey>; 2] {
        if self.tick == Some(tick) {
            if let Ok(i) = self.rows.binary_search_by_key(&p.id, |(id, _)| *id) {
                // Invariant that makes the cache exact: nothing changes a mark input of a seated player between the
                // end-of-step refresh and the next step (every writer runs inside a step, and `Sim::with_cx`, the one
                // out-of-step entry, must not edit the inputs). Checked against a direct computation in debug builds.
                debug_assert_eq!(
                    self.rows[i].1,
                    crate::kill_augments::build_marks(p),
                    "stale build-mark cache row for {:?} at tick {tick}",
                    p.id
                );
                return self.rows[i].1;
            }
        }
        crate::kill_augments::build_marks(p)
    }
}
impl Projection {
    pub(crate) fn empty_at(tick: u32) -> Self {
        let identity = Arc::new(());
        let mut report = FxTickReport::empty(identity.clone());
        report.tick = tick;
        Self {
            report,
            identity,
            marks: BuildMarkCache::default(),
        }
    }
    /// Cold Clone/restore preparation for the actual NPC domain. Keep the
    /// fresh report empty/incomplete; no visibility or ownership facts are copied.
    pub(crate) fn prepare_mobs(&mut self, count: usize) {
        if self.report.mob_seen.capacity() < count {
            self.report
                .mob_seen
                .reserve_exact(count.saturating_sub(self.report.mob_seen.len()));
        }
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
    /// A Card exact-pair segment starts at this row offset of [`FxTickReport::card_rows`]. Recorded at the true
    /// first contribution position; the sealed rows are exact, never derived per-status operations.
    CardSegment(usize),
    /// The Card marker at this event index: settle the accumulated Card buckets for every viewer. Present even
    /// when the source flush had no rows.
    CardFlush(usize),
    /// The Card reset marker at this event index: clear only the Card projection state.
    CardReset(usize),
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
    /// The sealed exact raw-pair rows of this completed tick's Card segment(s), in first-occurrence order. These
    /// are the producer's exact sidecar moved in at sealing; they are never serialized or hashed.
    pub(crate) card_rows: Vec<crate::systems::card_bleed_feedback::CardExactRow>,
    /// The cold-prepared private Card raw-row envelope for this completed step (`Q + T0`, never serialized).
    pub(crate) card_event_limit: usize,
    pub(crate) events: Vec<Event>,
    /// Two viewer masks per event, frozen before catch-up: anchor and optional blink destination.
    pub(crate) wish_points: Vec<[u8; 2]>,
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
            card_rows: Vec::new(),
            card_event_limit: 0,
            events: Vec::with_capacity(FX_REPORT_EVENTS_MAX),
            wish_points: Vec::with_capacity(FX_REPORT_EVENTS_MAX),
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
        self.projection.marks.refresh(&self.w);
        let r = &mut self.projection.report;
        r.identity = self.projection.identity.clone();
        r.tick = self.w.tick;
        r.complete = true;
        r.viewers.clear();
        r.seen.clear();
        r.mob_seen.clear();
        r.ops.clear();
        r.events.clear();
        r.wish_points.clear();
        r.bounded = self.s.performed_bounded
            && self.w.players.len() <= 8
            // Independent bounds: legacy non-Card events keep the legacy 512 cap; private Card history rows are
            // checked against the cold-prepared `Q + T0` envelope (actual rows, never marker count).
            && sealed_events_bounded(events, r.card_event_limit)
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
            // At most one populated Card segment and the preserved empty markers: two CardFlush and one CardReset.
            && self
                .s
                .fx
                .ops
                .iter()
                .filter(|o| matches!(o, Op::CardSegment(_)))
                .count()
                <= 1
            && self
                .s
                .fx
                .ops
                .iter()
                .filter(|o| matches!(o, Op::CardFlush(_)))
                .count()
                <= 2
            && self
                .s
                .fx
                .ops
                .iter()
                .filter(|o| matches!(o, Op::CardReset(_)))
                .count()
                <= 1
            && self
                .s
                .fx
                .ops
                .iter()
                .filter(|o| matches!(o, Op::Contribution(_)))
                .count()
                <= 16 + ABILITY_CONTRIBUTIONS_MAX;
        // Seal the producer's exact Card sidecar into this completed tick's report and hand the previous
        // (already consumed) buffer back to the producer: both keep their prepared capacity, and neither ever
        // reads a retained previous-pass segment.
        std::mem::swap(&mut r.card_rows, &mut self.s.card_segment.rows);
        self.s.card_segment.clear();
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
        for event in events {
            let mut masks = [0; 2];
            for (i, &viewer) in r.viewers.iter().enumerate() {
                let permissions =
                    crate::observe::wish_point_permissions(&self.k, &self.w, viewer, event);
                for (mask, allowed) in masks.iter_mut().zip(permissions) {
                    if allowed {
                        *mask |= 1 << i;
                    }
                }
            }
            r.wish_points.push(masks);
        }
        r.ops
            .extend(self.s.fx.ops.iter().cloned().map(|op| match op {
                Op::Flush(i) => Op::Flush(i - offset),
                Op::AbilityFlush(i) => Op::AbilityFlush(i - offset),
                Op::Reset(i) => Op::Reset(i - offset),
                Op::InstantFlush(i) => Op::InstantFlush(i - offset),
                Op::CardFlush(i) => Op::CardFlush(i - offset),
                Op::CardReset(i) => Op::CardReset(i - offset),
                o => o,
            }));
        debug_assert!(
            events.len() <= FX_REPORT_EVENTS_MAX + r.card_event_limit,
            "sealed report events exceed the legacy + prepared Card envelope"
        );
        r.events.extend_from_slice(events);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn non_card() -> Event {
        Event::RaidStarted
    }

    fn card() -> Event {
        Event::CardBleedHit {
            victim: PlayerId(1),
            by: None,
            amount: crate::events::CardBleedAmount::Finite(1.),
        }
    }

    #[test]
    fn sealed_event_bounds_are_legacy_non_card_512_and_the_prepared_private_card_history() {
        // The legacy non-Card cap is preserved exactly at its boundary.
        assert!(sealed_events_bounded(
            &vec![non_card(); FX_REPORT_EVENTS_MAX],
            0
        ));
        assert!(!sealed_events_bounded(
            &vec![non_card(); FX_REPORT_EVENTS_MAX + 1],
            usize::MAX
        ));
        // The private Card history rows are bounded by the cold-prepared Q + T0, independently of the legacy cap.
        assert!(sealed_events_bounded(&vec![card(); 600], 600));
        assert!(!sealed_events_bounded(&vec![card(); 600], 599));
        let mut mixed = vec![non_card(); FX_REPORT_EVENTS_MAX];
        mixed.extend(vec![card(); 600]);
        assert!(sealed_events_bounded(&mixed, 600));
        let mut over_legacy = vec![non_card(); FX_REPORT_EVENTS_MAX + 1];
        over_legacy.extend(vec![card(); 600]);
        assert!(!sealed_events_bounded(&over_legacy, 600));
        // Empty Card markers emit no rows: the history envelope is consumed by actual rows, never marker count.
        assert!(sealed_events_bounded(&[], 0));
        assert!(sealed_events_bounded(&vec![non_card(); 3], 0));
    }
}
