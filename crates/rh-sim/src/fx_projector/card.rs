//! The settled Card projection: one viewer's exact public buckets and the Card-only marker handling.
//!
//! Card's exact producer rows are coalesced per actual raw landed pair in [`crate::systems::card_bleed_feedback`]
//! and sealed into [`crate::fx_report::FxTickReport::card_rows`]. This module merges those exact sums into the
//! viewer's public buckets **after** settled entitlement and source redaction: an unentitled invalid or
//! overflowing raw pair is skipped before its classification is ever inspected, so a hidden pair cannot poison
//! a viewer. The trusted World fold and this derived projection stay fully separate.
//!
//! At a Card marker the viewer's buckets settle in the existing stable public-key order. Failures keep the
//! existing fail-closed policy: typed `InvalidAmount` for an eligible nonfinite source amount, typed `Overflow`
//! for checked exact accumulation/merge/rounding failure and for the actual `f64 -> f32` wire conversion being
//! nonfinite. No clamp, no bucket omission, no partial prefix, no special number and no raw-total fallback.

use super::exact::ExactSum;
use super::FxError;
use crate::fx_report::FxTickReport;
use crate::systems::card_bleed_feedback::{Inserted, PairIndex};
use crate::{PlayerId, SeenEvent};

#[derive(Debug)]
struct CardBucket {
    victim: PlayerId,
    /// Already redacted: `None` when the viewer cannot see the raw source.
    by: Option<PlayerId>,
    sum: ExactSum,
    /// The raw amount was outside the exact nonnegative finite domain (`InvalidAmount` when eligible).
    invalid: bool,
    /// Checked exact accumulation/merge/carry failure (`Overflow` when eligible).
    overflow: bool,
}

#[derive(Debug)]
pub(super) struct CardBuckets {
    buckets: Vec<CardBucket>,
    index: PairIndex,
    /// The prepared `B` bound for this viewer session; exceeding it is an explicit unsupported representation.
    limit: usize,
    /// Cold preparation failed or was refused: every Card marker fails closed for this session.
    unsupported: bool,
}

/// Exact measured size of one viewer Card bucket for the capacity ledger evidence (synthetic/measured only).
#[cfg(test)]
pub(super) fn bucket_size_for_tests() -> usize {
    std::mem::size_of::<CardBucket>()
}

impl CardBuckets {
    pub(super) fn prepare(capacity: Result<usize, String>) -> Self {
        let Ok(capacity) = capacity else {
            return Self {
                buckets: Vec::new(),
                index: PairIndex::new(),
                limit: 0,
                unsupported: true,
            };
        };
        let mut buckets = Vec::new();
        let mut index = PairIndex::new();
        if buckets.try_reserve_exact(capacity).is_err() || index.reserve(capacity).is_err() {
            return Self {
                buckets: Vec::new(),
                index: PairIndex::new(),
                limit: 0,
                unsupported: true,
            };
        }
        Self {
            buckets,
            index,
            limit: capacity,
            unsupported: false,
        }
    }

    pub(super) fn clear(&mut self) {
        self.buckets.clear();
        self.index.reset();
    }

    #[cfg_attr(not(test), allow(dead_code))] // layout/allocation evidence accessor
    pub(super) fn capacity(&self) -> usize {
        self.limit
    }

    /// Prepared derived index node capacity for the capacity-ledger evidence.
    #[cfg(test)]
    pub(super) fn index_capacity_for_tests(&self) -> usize {
        self.index.capacity()
    }

    /// Actual bucket-vector capacity for the capacity-ledger evidence.
    #[cfg(test)]
    pub(super) fn bucket_vec_capacity_for_tests(&self) -> usize {
        self.buckets.capacity()
    }

    /// Merge one sealed exact row into the viewer's buckets, resolving entitlement and redaction first. The
    /// same raw pair in one sealed tick has identical settled entitlement/redaction, so this coalescing cannot
    /// change a public row; different raw pairs can only merge after both redact to the same anonymous key.
    pub(super) fn add_rows(
        &mut self,
        report: &FxTickReport,
        viewer_index: usize,
        viewer: PlayerId,
        start: usize,
    ) -> Result<(), FxError> {
        if self.unsupported || start > report.card_rows.len() {
            return Err(FxError::UnsupportedBounds);
        }
        for row in &report.card_rows[start..] {
            if !report.sees(viewer_index, row.victim) && row.by != Some(viewer) {
                continue;
            }
            let by = row.by.filter(|&source| report.sees(viewer_index, source));
            let slot = match self.index.insert(row.victim, by, self.buckets.len() as u32) {
                Inserted::Existing(row) => row as usize,
                Inserted::New => {
                    if self.buckets.len() >= self.limit {
                        return Err(FxError::UnsupportedBounds);
                    }
                    self.buckets.push(CardBucket {
                        victim: row.victim,
                        by,
                        sum: ExactSum::default(),
                        invalid: false,
                        overflow: false,
                    });
                    self.buckets.len() - 1
                }
            };
            let bucket = &mut self.buckets[slot];
            if row.invalid {
                bucket.invalid = true;
            }
            if row.overflow {
                bucket.overflow = true;
            }
            if !bucket.invalid && !bucket.overflow && bucket.sum.merge(&row.sum).is_err() {
                bucket.overflow = true;
            }
        }
        Ok(())
    }

    /// Emit the viewer's entitled positive buckets at a Card marker in stable public-key order, then clear only
    /// the Card domain. An error leaves the caller's fail-closed policy to discard everything staged.
    pub(super) fn flush_into(&mut self, events: &mut Vec<SeenEvent>) -> Result<(), FxError> {
        if self.unsupported {
            return Err(FxError::UnsupportedBounds);
        }
        self.buckets
            .sort_unstable_by_key(|bucket| (bucket.victim, bucket.by));
        for bucket in &self.buckets {
            if bucket.invalid {
                return Err(FxError::InvalidAmount);
            }
            if bucket.overflow {
                return Err(FxError::Overflow);
            }
            let amount = bucket.sum.rounded().map_err(|_| FxError::Overflow)?;
            // Representation refusal for the existing `Hit` wire field: the actual `f64 -> f32` conversion must
            // be finite. The original f64 amount is kept unchanged whenever the cast is finite.
            let cast = amount as f32;
            if !cast.is_finite() {
                return Err(FxError::Overflow);
            }
            if amount > 0.0 {
                events.push(SeenEvent::Hit {
                    victim: bucket.victim,
                    by: bucket.by,
                    amount,
                    passive: false,
                });
            }
        }
        self.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arenas::practice_arena;
    use crate::systems::card_bleed_feedback::CardExactRow;
    use crate::{Event, FactionId, FxProjector, Placement, Secrets, Sim, SimConfig, Vec2};

    fn sim(players: usize) -> Sim {
        Sim::reset_active(
            SimConfig {
                quests: false,
                consumables: false,
                ..Default::default()
            },
            practice_arena(),
            Secrets::from_seed(12),
            &(0..players)
                .map(|i| Placement {
                    profile: format!("p{i}"),
                    faction: FactionId::Holy,
                    bot: false,
                    at: Vec2::new(200. + 48. * f64::from(i as u32), 320.),
                    hp: Some(1000.),
                    weapon0: None,
                    weapon1: None,
                })
                .collect::<Vec<_>>(),
        )
    }

    fn row(victim: crate::PlayerId, by: Option<crate::PlayerId>, values: &[f64]) -> CardExactRow {
        let mut sum = ExactSum::default();
        for &value in values {
            sum.add(value).expect("exact-domain test row");
        }
        CardExactRow {
            victim,
            by,
            sum,
            invalid: false,
            overflow: false,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn sealed(
        sim: &Sim,
        tick: u32,
        viewers: Vec<crate::PlayerId>,
        seen: Vec<u8>,
        mob_seen: Vec<(crate::PlayerId, u8)>,
        rows: Vec<CardExactRow>,
        ops: Vec<crate::fx_report::Op>,
    ) -> FxTickReport {
        let mut report = FxTickReport::empty(sim.projection.identity.clone());
        report.complete = true;
        report.tick = tick;
        report.bounded = true;
        report.viewers = viewers;
        report.seen = seen;
        report.mob_seen = mob_seen;
        report.ops = ops;
        report.events = Vec::new();
        report.wish_points = Vec::new();
        report.card_rows = rows;
        report
    }

    fn hits(projector: &FxProjector) -> Vec<(crate::PlayerId, Option<crate::PlayerId>, f64)> {
        projector
            .events()
            .iter()
            .filter_map(|event| match event {
                SeenEvent::Hit {
                    victim,
                    by,
                    amount,
                    passive,
                    ..
                } => {
                    assert!(!passive, "the Card projection is never passive");
                    Some((*victim, *by, *amount))
                }
                _ => None,
            })
            .collect()
    }

    fn flush(events: usize) -> crate::fx_report::Op {
        crate::fx_report::Op::CardFlush(events)
    }

    #[test]
    fn settled_entitlement_and_redaction_happen_before_public_grouping() {
        let s = sim(4);
        let tick = s.tick() + 1;
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        // Viewer 1 sees players 1 and 2, not 3 or 4.
        let mut report = sealed(
            &s,
            tick,
            vec![
                crate::PlayerId(1),
                crate::PlayerId(2),
                crate::PlayerId(3),
                crate::PlayerId(4),
            ],
            vec![0b011, 0b111, 0b111, 0b111],
            Vec::new(),
            vec![
                // Two distinct hidden sources on one visible victim: after redaction they are the same anonymous
                // public key, so their exact sums merge into one row.
                row(crate::PlayerId(2), Some(crate::PlayerId(3)), &[1.5]),
                row(crate::PlayerId(2), Some(crate::PlayerId(4)), &[2.5]),
                // The viewer's own contribution is entitled via `by == viewer` even when the victim is unseen; the
                // viewer always sees itself, so the named source is retained.
                row(crate::PlayerId(3), Some(crate::PlayerId(1)), &[4.]),
                // A fully unentitled pair contributes nothing.
                row(crate::PlayerId(4), Some(crate::PlayerId(4)), &[99.]),
            ],
            vec![crate::fx_report::Op::CardSegment(0), flush(0)],
        );
        report.card_rows.shrink_to_fit();
        projector.feed(&report).unwrap();
        assert_eq!(
            hits(&projector),
            vec![
                (crate::PlayerId(2), None, 4.0),
                (crate::PlayerId(3), Some(crate::PlayerId(1)), 4.0),
            ]
        );
    }

    #[test]
    fn a_hidden_unentitled_invalid_or_overflowing_pair_never_poisons_a_viewer() {
        let s = sim(3);
        let tick = s.tick() + 1;
        let mut viewer = FxProjector::attach(&s, crate::PlayerId(1));
        let mut hidden_bad = row(crate::PlayerId(3), Some(crate::PlayerId(3)), &[1.]);
        hidden_bad.invalid = true;
        let mut hidden_overflow = row(crate::PlayerId(3), Some(crate::PlayerId(2)), &[1.]);
        hidden_overflow.overflow = true;
        let report = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2), crate::PlayerId(3)],
            // Viewer 1 sees only itself; player 3 is hidden, so both bad pairs are unentitled.
            vec![0b001, 0b111, 0b111],
            Vec::new(),
            vec![
                row(crate::PlayerId(2), Some(crate::PlayerId(1)), &[2.]),
                hidden_bad,
                hidden_overflow,
            ],
            vec![
                crate::fx_report::Op::CardSegment(0),
                crate::fx_report::Op::CardReset(0),
                crate::fx_report::Op::CardSegment(3),
                flush(0),
            ],
        );
        // The reset clears the accumulated viewer bucket; the second segment has no entitled rows at all.
        viewer.feed(&report).unwrap();
        assert!(hits(&viewer).is_empty());
    }

    #[test]
    fn eligible_invalid_and_overflow_fail_closed_without_a_partial_prefix() {
        let s = sim(2);
        let tick = s.tick() + 1;
        for (bad, expected) in [(true, FxError::InvalidAmount), (false, FxError::Overflow)] {
            let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
            let mut first = row(crate::PlayerId(2), Some(crate::PlayerId(1)), &[3.]);
            if bad {
                first.invalid = true;
            } else {
                first.overflow = true;
            }
            let report = sealed(
                &s,
                tick,
                vec![crate::PlayerId(1), crate::PlayerId(2)],
                vec![0b11, 0b11],
                Vec::new(),
                vec![
                    // A good row is staged before the bad bucket: fail-closed must discard it too.
                    row(crate::PlayerId(2), None, &[1.]),
                    first,
                ],
                vec![crate::fx_report::Op::CardSegment(0), flush(0)],
            );
            assert_eq!(projector.feed(&report), Err(expected));
            assert!(
                projector.events().is_empty(),
                "no partial prefix may publish"
            );
            // The failed viewer stays closed until rebind.
            assert_eq!(
                projector.feed(&report),
                Err(FxError::ForeignInstance),
                "a failed projector is disabled"
            );
        }
    }

    #[test]
    fn exact_rounding_and_the_actual_f32_cast_are_the_only_numeric_guards() {
        let s = sim(2);
        let tick = s.tick() + 1;
        // A finite binary64 that rounds past the maximum finite binary64 is a typed Overflow.
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        let rounding = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            vec![row(
                crate::PlayerId(2),
                Some(crate::PlayerId(1)),
                &[f64::MAX, f64::MAX],
            )],
            vec![crate::fx_report::Op::CardSegment(0), flush(0)],
        );
        assert_eq!(projector.feed(&rounding), Err(FxError::Overflow));
        // A finite f64 total whose actual `as f32` conversion overflows fails closed; the f64 is representable.
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        let cast = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            vec![row(crate::PlayerId(2), Some(crate::PlayerId(1)), &[1e40])],
            vec![crate::fx_report::Op::CardSegment(0), flush(0)],
        );
        assert_eq!(projector.feed(&cast), Err(FxError::Overflow));
        // A value that does round to finite f32 keeps its original f64 unchanged (no clamp, no early rounding).
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        let boundary = f64::from(f32::MAX);
        let ok = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            vec![row(
                crate::PlayerId(2),
                Some(crate::PlayerId(1)),
                &[boundary],
            )],
            vec![crate::fx_report::Op::CardSegment(0), flush(0)],
        );
        projector.feed(&ok).unwrap();
        assert_eq!(
            hits(&projector),
            vec![(crate::PlayerId(2), Some(crate::PlayerId(1)), boundary)],
            "the original f64 amount is unchanged when the actual cast is finite"
        );
    }

    #[test]
    fn only_positive_entitled_buckets_publish_and_the_empty_marker_is_silent() {
        let s = sim(2);
        let tick = s.tick() + 1;
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        let report = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            vec![
                row(crate::PlayerId(1), None, &[0.]),
                row(crate::PlayerId(2), Some(crate::PlayerId(1)), &[2.]),
            ],
            vec![crate::fx_report::Op::CardSegment(0), flush(0)],
        );
        projector.feed(&report).unwrap();
        assert_eq!(
            hits(&projector),
            vec![(crate::PlayerId(2), Some(crate::PlayerId(1)), 2.)]
        );
        // An existing report's empty flush carries the marker but publishes nothing.
        let later = sealed(
            &s,
            tick + 1,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            Vec::new(),
            vec![flush(0)],
        );
        projector.feed(&later).unwrap();
        assert!(hits(&projector).is_empty());
    }

    #[test]
    fn reset_and_signature_flush_domains_are_isolated_from_card_buckets() {
        let s = sim(2);
        let tick = s.tick() + 1;
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        // Accumulate one Card bucket, then pass a signature Reset and a signature Flush: neither may clear Card.
        let first = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            vec![row(crate::PlayerId(2), Some(crate::PlayerId(1)), &[5.])],
            vec![crate::fx_report::Op::CardSegment(0)],
        );
        projector.feed(&first).unwrap();
        let markers = sealed(
            &s,
            tick + 1,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            Vec::new(),
            vec![
                crate::fx_report::Op::Reset(0),
                crate::fx_report::Op::Flush(0),
                flush(0),
            ],
        );
        projector.feed(&markers).unwrap();
        assert_eq!(
            hits(&projector),
            vec![(crate::PlayerId(2), Some(crate::PlayerId(1)), 5.)],
            "legacy reset/flush domains must not clear the Card buckets"
        );
        // The CardReset marker clears only Card state.
        let reset = sealed(
            &s,
            tick + 2,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            Vec::new(),
            vec![
                crate::fx_report::Op::CardReset(0),
                crate::fx_report::Op::CardSegment(0),
                flush(0),
            ],
        );
        projector.feed(&reset).unwrap();
        assert!(hits(&projector).is_empty());
    }

    #[test]
    fn source_victim_departure_does_not_recheck_entitlement_at_flush() {
        let s = sim(3);
        let tick = s.tick() + 1;
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        let first = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2), crate::PlayerId(3)],
            vec![0b111, 0b111, 0b111],
            Vec::new(),
            vec![row(crate::PlayerId(2), Some(crate::PlayerId(3)), &[2.])],
            vec![crate::fx_report::Op::CardSegment(0)],
        );
        projector.feed(&first).unwrap();
        // The later report no longer lists players 2/3 as viewers; the settled entitlement of the earlier sealed
        // tick is retained and the flush still emits it (the report's frozen sight is the only authority).
        let flush_tick = sealed(
            &s,
            tick + 1,
            vec![crate::PlayerId(1)],
            vec![0b111],
            Vec::new(),
            Vec::new(),
            vec![flush(0)],
        );
        projector.feed(&flush_tick).unwrap();
        assert_eq!(
            hits(&projector),
            vec![(crate::PlayerId(2), Some(crate::PlayerId(3)), 2.)]
        );
        // A report whose viewers no longer include this projector clears the pending Card buckets (missing viewer).
        let missing = sealed(
            &s,
            tick + 2,
            vec![crate::PlayerId(2)],
            vec![0b111],
            Vec::new(),
            Vec::new(),
            vec![flush(0)],
        );
        projector.feed(&missing).unwrap();
        assert!(hits(&projector).is_empty());
    }

    #[test]
    fn npc_and_ids_above_the_seat_limit_use_the_frozen_mob_sight_mask() {
        let s = sim(2);
        let tick = s.tick() + 1;
        let mob = crate::PlayerId(40);
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        // Viewer 1 sees the regional NPC victim (mob bit 0); player 2 does not.
        let report = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b01, 0b10],
            vec![(mob, 0b01)],
            vec![
                row(mob, Some(crate::PlayerId(2)), &[3.]),
                row(crate::PlayerId(2), Some(mob), &[1.]),
            ],
            vec![crate::fx_report::Op::CardSegment(0), flush(0)],
        );
        projector.feed(&report).unwrap();
        // The source player 2 is hidden, so its contribution to the visible NPC redacts to anonymous; the NPC source
        // on player 2 is unentitled (viewer 1 does not see player 2 and is not the source).
        assert_eq!(hits(&projector), vec![(mob, None, 3.)]);
    }

    #[test]
    fn temporal_guards_foreign_duplicate_backward_gap_incomplete_and_bounds() {
        let s = sim(2);
        let tick = s.tick() + 1;
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        let report = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            vec![row(crate::PlayerId(2), Some(crate::PlayerId(1)), &[1.])],
            vec![crate::fx_report::Op::CardSegment(0), flush(0)],
        );
        projector.feed(&report).unwrap();
        assert_eq!(hits(&projector).len(), 1);
        assert_eq!(projector.feed(&report), Ok(crate::FeedStatus::Duplicate));
        assert_eq!(
            projector.feed(&report),
            Ok(crate::FeedStatus::Duplicate),
            "a duplicate never replays Card output"
        );
        // A foreign instance fails closed (a clone/restore gets fresh instance identity).
        let clone = s.clone();
        let foreign = sealed(
            &clone,
            tick + 1,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            Vec::new(),
            vec![flush(0)],
        );
        assert_eq!(projector.feed(&foreign), Err(FxError::ForeignInstance));
        // An incomplete report fails closed.
        let mut other = FxProjector::attach(&s, crate::PlayerId(1));
        let mut incomplete = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            Vec::new(),
            vec![flush(0)],
        );
        incomplete.complete = false;
        assert_eq!(other.feed(&incomplete), Err(FxError::Incomplete));
        // A gap clears the pending Card buckets rather than mixing windows.
        let mut gap = FxProjector::attach(&s, crate::PlayerId(1));
        gap.feed(&report).unwrap();
        let later = sealed(
            &s,
            tick + 2,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            Vec::new(),
            vec![flush(0)],
        );
        assert_eq!(gap.feed(&later), Ok(crate::FeedStatus::Gap));
        assert!(hits(&gap).is_empty());
        // A bounded unsupported scene fails closed.
        let mut unsupported = FxProjector::attach(&s, crate::PlayerId(1));
        let mut bad = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            Vec::new(),
            vec![flush(0)],
        );
        bad.wish_points = vec![[0, 0]]; // length disagrees with the (empty) event list
        assert_eq!(unsupported.feed(&bad), Err(FxError::UnsupportedBounds));
    }

    #[test]
    fn rebind_starts_empty_after_the_current_tick_and_reprepares_the_card_bound() {
        let s = sim(2);
        let tick = s.tick() + 1;
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        let report = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            vec![row(crate::PlayerId(2), Some(crate::PlayerId(1)), &[7.])],
            vec![crate::fx_report::Op::CardSegment(0)],
        );
        projector.feed(&report).unwrap();
        projector.rebind(&s, crate::PlayerId(2));
        assert_eq!(projector.viewer(), crate::PlayerId(2));
        assert!(projector.events().is_empty());
        // The old accumulated bucket is gone: the new session starts after the current tick with empty buckets.
        let later = sealed(
            &s,
            tick + 1,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            Vec::new(),
            vec![flush(0)],
        );
        projector.feed(&later).unwrap();
        assert!(hits(&projector).is_empty());
    }

    #[test]
    fn the_card_bucket_bound_fails_closed_instead_of_truncating() {
        let s = sim(2);
        let tick = s.tick() + 1;
        // Prepare a deliberately tiny public bound, as a cold-preparation refusal scenario would.
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        let cap = projector.card.capacity();
        assert!(cap > 0, "the prepared public bound exists");
        let rows: Vec<_> = (0..cap as u32 + 1)
            .map(|n| {
                row(
                    crate::PlayerId(2),
                    Some(crate::PlayerId(1)),
                    &[f64::from(n + 1)],
                )
            })
            .collect();
        // All rows share one pair, so only distinct pairs consume buckets; make every pair distinct instead.
        let rows: Vec<_> = rows
            .into_iter()
            .enumerate()
            .map(|(n, mut r)| {
                r.by = Some(crate::PlayerId(1));
                // Distinct raw sources would be hidden; distinct victims are the available distinct keys.
                r.victim = crate::PlayerId(2 + n as u32);
                r
            })
            .collect();
        let report = sealed(
            &s,
            tick,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0xff, 0xff],
            Vec::new(),
            rows,
            vec![crate::fx_report::Op::CardSegment(0), flush(0)],
        );
        assert_eq!(
            projector.feed(&report),
            Err(FxError::UnsupportedBounds),
            "exceeding the prepared public bound is explicit, never silently truncating"
        );
        assert!(projector.events().is_empty());
    }

    #[test]
    fn sealed_card_rows_are_private_typed_data_never_events() {
        let s = sim(2);
        let report = sealed(
            &s,
            s.tick() + 1,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            vec![row(crate::PlayerId(2), Some(crate::PlayerId(1)), &[1.])],
            vec![crate::fx_report::Op::CardSegment(0), flush(0)],
        );
        // The sealed sidecar never carries raw Card events; the only public projection is the Hit at the marker.
        assert!(report.events.is_empty());
        let mut projector = FxProjector::attach(&s, crate::PlayerId(1));
        projector.feed(&report).unwrap();
        assert!(projector
            .events()
            .iter()
            .all(|event| matches!(event, SeenEvent::Hit { .. })));
        // A tick that carries only the raw typed Event::CardBleedHit (no Card marker, no sealed rows) projects
        // nothing: the trusted diagnostic is not an observation.
        let mut raw_only = sealed(
            &s,
            s.tick() + 2,
            vec![crate::PlayerId(1), crate::PlayerId(2)],
            vec![0b11, 0b11],
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        raw_only.events.push(Event::CardBleedHit {
            victim: crate::PlayerId(2),
            by: Some(crate::PlayerId(1)),
            amount: crate::events::CardBleedAmount::Finite(1.),
        });
        raw_only.wish_points = vec![[0, 0]; raw_only.events.len()];
        let mut next = FxProjector::attach(&s, crate::PlayerId(1));
        next.feed(&raw_only).unwrap();
        assert!(
            next.events().is_empty(),
            "the raw typed Card diagnostic must never reach any observer"
        );
    }
}
