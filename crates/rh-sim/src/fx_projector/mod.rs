//! Session-local public temporal projection. Feeding never grants action handles.
mod card;
pub(crate) mod exact;
use crate::factions::SignatureKind;
use crate::fx_report::{
    FxTickReport, Op, FX_INSTANT_BUCKETS_MAX, FX_OUTPUT_EVENTS_MAX, FX_PUBLIC_BUCKETS_MAX,
};
use crate::{PlayerId, SeenEvent, Sim};
use card::CardBuckets;
use exact::ExactSum;
use std::sync::Arc;

/// Reserve one projector-owned output buffer for the legacy output bound plus the viewer's cold-prepared Card
/// public bound (`B`). Checked arithmetic and fallible reserve: a refused capacity makes the session fail closed
/// with `UnsupportedBounds` instead of growing warm or truncating.
fn prepared_event_buffer(extra: Result<usize, String>) -> (Vec<SeenEvent>, bool) {
    let Ok(extra) = extra else {
        return (Vec::new(), true);
    };
    let Some(capacity) = FX_OUTPUT_EVENTS_MAX.checked_add(extra) else {
        return (Vec::new(), true);
    };
    let mut events = Vec::new();
    if events.try_reserve_exact(capacity).is_err() {
        return (Vec::new(), true);
    }
    (events, false)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FxError {
    ForeignInstance,
    AlreadyBound,
    WrongViewer,
    StaleOutput,
    Backwards,
    Incomplete,
    UnsupportedBounds,
    InvalidAmount,
    Overflow,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeedStatus {
    Advanced,
    Duplicate,
    Gap,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum BucketKind {
    Signature(SignatureKind),
    Ability(crate::status_runtime::AbilityId),
}
#[derive(Debug)]
struct Bucket {
    victim: PlayerId,
    by: Option<PlayerId>,
    kind: BucketKind,
    weapon: Option<crate::WeaponId>,
    sum: ExactSum,
}
/// One instance and viewer session. Reconnect/restore attach at the current tick, never replaying it.
#[derive(Debug)]
pub struct FxProjector {
    identity: Arc<()>,
    viewer: PlayerId,
    last: u32,
    disabled: bool,
    buckets: Vec<Bucket>,
    instant: Vec<Bucket>,
    /// Card-only public buckets: a separate vector/index so legacy sort/retain operations on the mixed-domain
    /// buckets can never leave a stale Card link.
    card: CardBuckets,
    /// Test-only transparent observer of the actual Card projection path: exactly the public rows the Card marker
    /// emits in this feed, recorded before they mix with ordinary filtered `Hit` fx. It classifies nothing and is
    /// absent from production builds.
    #[cfg(test)]
    pub(crate) card_outputs: Vec<SeenEvent>,
    /// Cold preparation of the owned output/event buffers was refused or unrepresentable: fail closed.
    bounds_unsupported: bool,
    events: Vec<SeenEvent>,
}
impl FxProjector {
    pub fn attach(sim: &Sim, viewer: PlayerId) -> Self {
        let extra = crate::systems::card_bleed_feedback::viewer_capacity(&sim.k, &sim.w);
        let (events, bounds_unsupported) = prepared_event_buffer(extra.clone());
        #[cfg(test)]
        let (card_outputs, _) = prepared_event_buffer(extra);
        Self {
            identity: sim.projection.identity.clone(),
            viewer,
            last: sim.tick(),
            disabled: false,
            buckets: Vec::with_capacity(FX_PUBLIC_BUCKETS_MAX),
            instant: Vec::with_capacity(FX_INSTANT_BUCKETS_MAX),
            card: CardBuckets::prepare(crate::systems::card_bleed_feedback::viewer_capacity(
                &sim.k, &sim.w,
            )),
            bounds_unsupported,
            #[cfg(test)]
            card_outputs,
            events,
        }
    }
    pub fn rebind(&mut self, sim: &Sim, viewer: PlayerId) {
        self.identity = sim.projection.identity.clone();
        self.viewer = viewer;
        self.last = sim.tick();
        self.disabled = false;
        self.buckets.clear();
        self.instant.clear();
        self.card = CardBuckets::prepare(crate::systems::card_bleed_feedback::viewer_capacity(
            &sim.k, &sim.w,
        ));
        let extra = crate::systems::card_bleed_feedback::viewer_capacity(&sim.k, &sim.w);
        let (events, bounds_unsupported) = prepared_event_buffer(extra.clone());
        self.bounds_unsupported = bounds_unsupported;
        self.events = events;
        #[cfg(test)]
        {
            let (card_outputs, _) = prepared_event_buffer(extra);
            self.card_outputs = card_outputs;
        }
    }
    pub fn viewer(&self) -> PlayerId {
        self.viewer
    }
    pub fn tick(&self) -> u32 {
        self.last
    }
    /// Trusted diagnostic only. Canonical consumers use `append_into` to check delivery identity.
    pub fn events(&self) -> &[SeenEvent] {
        &self.events
    }

    /// Test-only owned-output capacity after cold preparation (legacy output bound + the viewer Card bound).
    #[cfg(test)]
    pub(crate) fn event_capacity_for_tests(&self) -> usize {
        self.events.capacity()
    }

    /// Test-only measured size of one Card bucket type (capacity-ledger evidence).
    #[cfg(test)]
    pub(crate) fn card_bucket_size_for_tests() -> usize {
        card::bucket_size_for_tests()
    }

    /// Test-only Card bucket limit and derived index capacity for this session (capacity-ledger evidence).
    #[cfg(test)]
    pub(crate) fn card_capacity_for_tests(&self) -> (usize, usize) {
        (self.card.capacity(), self.card.index_capacity_for_tests())
    }

    /// Test-only actual prepared bucket-vector capacity for the capacity ledger.
    #[cfg(test)]
    pub(crate) fn card_bucket_vec_capacity_for_tests(&self) -> usize {
        self.card.bucket_vec_capacity_for_tests()
    }

    /// Test-only actual capacity of the transparent Card observer buffer.
    #[cfg(test)]
    pub(crate) fn card_outputs_capacity_for_tests(&self) -> usize {
        self.card_outputs.capacity()
    }

    /// Test-only transparent view of this feed's actual Card projection rows (the rows the Card marker emitted),
    /// used by the source comparator to assert every emitted row including unexpected extras. Never a production
    /// observation path.
    #[cfg(test)]
    pub(crate) fn card_outputs(&self) -> &[SeenEvent] {
        &self.card_outputs
    }

    pub fn check_delivery(&self, sim: &Sim, viewer: PlayerId) -> Result<(), FxError> {
        if self.disabled || !Arc::ptr_eq(&self.identity, &sim.projection.identity) {
            return Err(FxError::ForeignInstance);
        }
        if self.viewer != viewer {
            return Err(FxError::WrongViewer);
        }
        if self.last != sim.tick() {
            return Err(FxError::StaleOutput);
        }
        Ok(())
    }
    /// Copy the current cached tick only after checking instance, viewer and completed tick.
    /// This trusted intermediate retains private actor IDs. Merge it through
    /// `ItemObserver::prepare_with_seen` before delivery; never append it to a projected scene.
    /// It does not prepare or commit an action observation.
    pub fn append_into(
        &self,
        sim: &Sim,
        viewer: PlayerId,
        out: &mut Vec<SeenEvent>,
    ) -> Result<(), FxError> {
        self.check_delivery(sim, viewer)?;
        out.extend_from_slice(&self.events);
        Ok(())
    }
    fn fail(&mut self, e: FxError) -> Result<FeedStatus, FxError> {
        self.buckets.clear();
        self.instant.clear();
        self.card.clear();
        #[cfg(test)]
        self.card_outputs.clear();
        self.events.clear();
        self.disabled = true;
        Err(e)
    }
    pub fn feed(&mut self, r: &FxTickReport) -> Result<FeedStatus, FxError> {
        if self.disabled || !Arc::ptr_eq(&self.identity, &r.identity) {
            return self.fail(FxError::ForeignInstance);
        }
        if self.bounds_unsupported {
            return self.fail(FxError::UnsupportedBounds);
        }
        if r.tick < self.last {
            return self.fail(FxError::Backwards);
        }
        if r.tick == self.last {
            return Ok(FeedStatus::Duplicate);
        }
        if !r.complete {
            return self.fail(FxError::Incomplete);
        }
        if !r.bounded || r.wish_points.len() != r.events.len() {
            return self.fail(FxError::UnsupportedBounds);
        }
        let gap = self.last.checked_add(1) != Some(r.tick);
        if gap {
            self.buckets.clear();
            self.card.clear();
        }
        self.last = r.tick;
        self.events.clear();
        #[cfg(test)]
        self.card_outputs.clear();
        let Some(viewer) = r.viewers.iter().position(|&id| id == self.viewer) else {
            self.buckets.clear();
            self.card.clear();
            return Ok(if gap {
                FeedStatus::Gap
            } else {
                FeedStatus::Advanced
            });
        };
        self.instant.clear();
        let markers = r
            .ops
            .iter()
            .filter(|o| matches!(o, Op::InstantFlush(_)))
            .count();
        let raw_instant = r
            .events
            .iter()
            .filter(|e| matches!(e, crate::Event::SignatureHit { sig, .. } if !sig.is_dot()))
            .count();
        if markers > 1
            || raw_instant > crate::fx_report::FX_REPORT_EVENTS_MAX
            || (raw_instant > 0 && markers != 1)
        {
            return self.fail(FxError::UnsupportedBounds);
        }
        for event in &r.events {
            let crate::Event::SignatureHit {
                victim,
                by,
                sig,
                weapon,
                amount,
            } = *event
            else {
                continue;
            };
            if sig.is_dot() || (!r.sees(viewer, victim) && by != self.viewer) {
                continue;
            }
            let by = r.sees(viewer, by).then_some(by);
            let weapon = if by.is_some() { weapon } else { None };
            let index =
                if let Some(i) = self.instant.iter().position(|b| {
                    (b.victim, b.by, b.kind) == (victim, by, BucketKind::Signature(sig))
                }) {
                    i
                } else {
                    if self.instant.len() == FX_INSTANT_BUCKETS_MAX {
                        return self.fail(FxError::UnsupportedBounds);
                    }
                    self.instant.push(Bucket {
                        victim,
                        by,
                        kind: BucketKind::Signature(sig),
                        weapon,
                        sum: ExactSum::default(),
                    });
                    self.instant.len() - 1
                };
            if self.instant[index].sum.add(amount).is_err() {
                return self.fail(FxError::InvalidAmount);
            }
        }
        let mut cursor = 0;
        for op in &r.ops {
            match *op {
                Op::Contribution(h) => {
                    if !r.sees(viewer, h.victim) && h.by != Some(self.viewer) {
                        continue;
                    }
                    let Some(kind) = h
                        .sig
                        .map(BucketKind::Signature)
                        .or_else(|| h.ability.map(BucketKind::Ability))
                    else {
                        continue;
                    };
                    let by = h.by.filter(|&id| r.sees(viewer, id));
                    let weapon = if by.is_some() { h.weapon } else { None };
                    let index = self
                        .buckets
                        .iter()
                        .position(|b| (b.victim, b.by, b.kind) == (h.victim, by, kind));
                    let index = if let Some(i) = index {
                        i
                    } else {
                        if self.buckets.len() == FX_PUBLIC_BUCKETS_MAX {
                            return self.fail(FxError::UnsupportedBounds);
                        }
                        self.buckets.push(Bucket {
                            victim: h.victim,
                            by,
                            kind,
                            weapon,
                            sum: ExactSum::default(),
                        });
                        self.buckets.len() - 1
                    };
                    if self.buckets[index].sum.add(h.amount).is_err() {
                        return self.fail(FxError::InvalidAmount);
                    }
                }
                Op::Flush(at) | Op::AbilityFlush(at) | Op::Reset(at) | Op::InstantFlush(at) => {
                    if at < cursor || at > r.events.len() {
                        return self.fail(FxError::UnsupportedBounds);
                    }
                    crate::observe::filter_events(
                        &r.events[cursor..at],
                        Some(self.viewer),
                        |id| r.sees(viewer, id),
                        |i| r.wish_points[cursor + i].map(|mask| mask & (1 << viewer) != 0),
                        &mut self.events,
                    );
                    cursor = at;
                    if matches!(op, Op::Flush(_) | Op::AbilityFlush(_) | Op::InstantFlush(_)) {
                        let buckets = if matches!(op, Op::InstantFlush(_)) {
                            &mut self.instant
                        } else {
                            &mut self.buckets
                        };
                        buckets.sort_unstable_by_key(|b| (b.victim, b.by, b.kind));
                        for b in buckets.iter().filter(|b| match op {
                            Op::AbilityFlush(_) => matches!(b.kind, BucketKind::Ability(_)),
                            _ => matches!(b.kind, BucketKind::Signature(_)),
                        }) {
                            let Ok(amount) = b.sum.rounded() else {
                                return self.fail(FxError::Overflow);
                            };
                            if amount > 0.0 {
                                self.events.push(match b.kind {
                                    BucketKind::Signature(sig) => SeenEvent::SignatureHit {
                                        victim: b.victim,
                                        by: b.by,
                                        sig,
                                        weapon: b.weapon,
                                        amount,
                                    },
                                    BucketKind::Ability(ability) => SeenEvent::AbilityHit {
                                        victim: b.victim,
                                        by: b.by,
                                        ability,
                                        amount,
                                    },
                                });
                            }
                        }
                    }
                    if matches!(op, Op::InstantFlush(_)) {
                        self.instant.clear();
                    } else if matches!(op, Op::AbilityFlush(_)) {
                        self.buckets
                            .retain(|b| !matches!(b.kind, BucketKind::Ability(_)));
                    } else if matches!(op, Op::Flush(_)) {
                        self.buckets
                            .retain(|b| !matches!(b.kind, BucketKind::Signature(_)));
                    } else {
                        self.buckets.clear();
                    }
                }
                Op::CardSegment(start) => {
                    if let Err(e) = self.card.add_rows(r, viewer, self.viewer, start) {
                        return self.fail(e);
                    }
                }
                Op::CardFlush(at) => {
                    if at < cursor || at > r.events.len() {
                        return self.fail(FxError::UnsupportedBounds);
                    }
                    crate::observe::filter_events(
                        &r.events[cursor..at],
                        Some(self.viewer),
                        |id| r.sees(viewer, id),
                        |i| r.wish_points[cursor + i].map(|mask| mask & (1 << viewer) != 0),
                        &mut self.events,
                    );
                    cursor = at;
                    #[cfg(test)]
                    let staged = self.events.len();
                    if let Err(e) = self.card.flush_into(&mut self.events) {
                        return self.fail(e);
                    }
                    #[cfg(test)]
                    self.card_outputs.extend_from_slice(&self.events[staged..]);
                }
                Op::CardReset(at) => {
                    if at < cursor || at > r.events.len() {
                        return self.fail(FxError::UnsupportedBounds);
                    }
                    crate::observe::filter_events(
                        &r.events[cursor..at],
                        Some(self.viewer),
                        |id| r.sees(viewer, id),
                        |i| r.wish_points[cursor + i].map(|mask| mask & (1 << viewer) != 0),
                        &mut self.events,
                    );
                    cursor = at;
                    self.card.clear();
                }
            }
        }
        crate::observe::filter_events(
            &r.events[cursor..],
            Some(self.viewer),
            |id| r.sees(viewer, id),
            |i| r.wish_points[cursor + i].map(|mask| mask & (1 << viewer) != 0),
            &mut self.events,
        );
        self.instant.clear();
        Ok(if gap {
            FeedStatus::Gap
        } else {
            FeedStatus::Advanced
        })
    }
}

#[cfg(test)]
mod tests;
