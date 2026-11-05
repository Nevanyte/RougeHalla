//! Session-local public temporal projection. Feeding never grants action handles.
mod exact;
use crate::factions::SignatureKind;
use crate::fx_report::{
    FxTickReport, Op, FX_INSTANT_BUCKETS_MAX, FX_OUTPUT_EVENTS_MAX, FX_PUBLIC_BUCKETS_MAX,
};
use crate::{PlayerId, SeenEvent, Sim};
use exact::ExactSum;
use std::sync::Arc;
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
#[derive(Debug)]
struct Bucket {
    victim: PlayerId,
    by: Option<PlayerId>,
    sig: SignatureKind,
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
    events: Vec<SeenEvent>,
}
impl FxProjector {
    pub fn attach(sim: &Sim, viewer: PlayerId) -> Self {
        Self {
            identity: sim.projection.identity.clone(),
            viewer,
            last: sim.tick(),
            disabled: false,
            buckets: Vec::with_capacity(FX_PUBLIC_BUCKETS_MAX),
            instant: Vec::with_capacity(FX_INSTANT_BUCKETS_MAX),
            events: Vec::with_capacity(FX_OUTPUT_EVENTS_MAX),
        }
    }
    pub fn rebind(&mut self, sim: &Sim, viewer: PlayerId) {
        self.identity = sim.projection.identity.clone();
        self.viewer = viewer;
        self.last = sim.tick();
        self.disabled = false;
        self.buckets.clear();
        self.instant.clear();
        self.events.clear();
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
    /// This is presentation-only and never prepares or commits an action observation.
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
        self.events.clear();
        self.disabled = true;
        Err(e)
    }
    pub fn feed(&mut self, r: &FxTickReport) -> Result<FeedStatus, FxError> {
        if self.disabled || !Arc::ptr_eq(&self.identity, &r.identity) {
            return self.fail(FxError::ForeignInstance);
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
        if !r.bounded {
            return self.fail(FxError::UnsupportedBounds);
        }
        let gap = self.last.checked_add(1) != Some(r.tick);
        if gap {
            self.buckets.clear();
        }
        self.last = r.tick;
        self.events.clear();
        let Some(viewer) = r.viewers.iter().position(|&id| id == self.viewer) else {
            self.buckets.clear();
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
            let index = if let Some(i) = self
                .instant
                .iter()
                .position(|b| (b.victim, b.by, b.sig) == (victim, by, sig))
            {
                i
            } else {
                if self.instant.len() == FX_INSTANT_BUCKETS_MAX {
                    return self.fail(FxError::UnsupportedBounds);
                }
                self.instant.push(Bucket {
                    victim,
                    by,
                    sig,
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
                    let Some(sig) = h.sig else { continue };
                    let by = h.by.filter(|&id| r.sees(viewer, id));
                    let weapon = if by.is_some() { h.weapon } else { None };
                    let index = self
                        .buckets
                        .iter()
                        .position(|b| (b.victim, b.by, b.sig) == (h.victim, by, sig));
                    let index = if let Some(i) = index {
                        i
                    } else {
                        if self.buckets.len() == FX_PUBLIC_BUCKETS_MAX {
                            return self.fail(FxError::UnsupportedBounds);
                        }
                        self.buckets.push(Bucket {
                            victim: h.victim,
                            by,
                            sig,
                            weapon,
                            sum: ExactSum::default(),
                        });
                        self.buckets.len() - 1
                    };
                    if self.buckets[index].sum.add(h.amount).is_err() {
                        return self.fail(FxError::InvalidAmount);
                    }
                }
                Op::Flush(at) | Op::Reset(at) | Op::InstantFlush(at) => {
                    if at < cursor || at > r.events.len() {
                        return self.fail(FxError::UnsupportedBounds);
                    }
                    crate::observe::filter_events(
                        &r.events[cursor..at],
                        Some(self.viewer),
                        |id| r.sees(viewer, id),
                        &mut self.events,
                    );
                    cursor = at;
                    if matches!(op, Op::Flush(_) | Op::InstantFlush(_)) {
                        let buckets = if matches!(op, Op::InstantFlush(_)) {
                            &mut self.instant
                        } else {
                            &mut self.buckets
                        };
                        buckets.sort_unstable_by_key(|b| (b.victim, b.by, b.sig));
                        for b in buckets.iter() {
                            let Ok(amount) = b.sum.rounded() else {
                                return self.fail(FxError::Overflow);
                            };
                            if amount > 0.0 {
                                self.events.push(SeenEvent::SignatureHit {
                                    victim: b.victim,
                                    by: b.by,
                                    sig: b.sig,
                                    weapon: b.weapon,
                                    amount,
                                });
                            }
                        }
                    }
                    if matches!(op, Op::InstantFlush(_)) {
                        self.instant.clear();
                    } else {
                        self.buckets.clear();
                    }
                }
            }
        }
        crate::observe::filter_events(
            &r.events[cursor..],
            Some(self.viewer),
            |id| r.sees(viewer, id),
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
