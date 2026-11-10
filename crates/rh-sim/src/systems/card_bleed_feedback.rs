//! Card bleed feedback (P-CARD-BLEED-FEEDBACK-1): the trusted raw pair aggregate, its source cadence, and
//! the separately admitted exact pair sidecar the settled-tick public projection consumes.
//!
//! Source: `packages/server/src/sim/cardHooks.ts` (`afterDamage`'s bleed map, `flushBleeds`, `resetAll`).
//! The source keeps one global insertion-ordered `Map<"victim|by", {victim, by, amount}>` per world; the first
//! eligible landed DoT creates the report with `since = now`, repeats fold with the ordinary binary64 `+=` in
//! landed order, and `flushBleeds` emits one `hit`/`weapon:null` fx per stored row then clears the map. The
//! 500 ms periodic check runs after the after-damage pass; the ending pass is retained and the registered
//! `runEnded` link flushes it. `resetAll` (raid start) drops the report. Teleport does not touch it.
//!
//! Two outputs are deliberately separate here:
//!
//! * [`CardBleedReport`] is trusted serialized/hashed World state: the exact source-ordered tagged fold
//!   ([`CardBleedAmount`]: a nonnegative finite binary64 with its bits, or the payload-free `PositiveInfinity` /
//!   `NotANumber` tags). It is never viewer-filtered and never becomes public output.
//! * [`CardSegment`] is a per-tick exact sidecar (`ExactSum` limbs per actual raw pair) that is sealed into the
//!   FX report and projected per viewer at the next Card marker. Its per-pair `invalid`/`overflow`
//!   classifications stay local until settled entitlement and source redaction are known, so an unentitled bad
//!   pair cannot poison a viewer.
//!
//! No helper here is called from tests as a substitute for a scheduled producer: `contribute`/`periodic` run
//! inside `cards::after_damage` at the source positions, and `run_ended`/`reset` are the registered hook links.

mod index;

use crate::events::Event;
use crate::fx_projector::exact::{ExactSum, SumError};
use crate::fx_report::{Op, TickFx};
use crate::hooks::{HookArgs, Hx};
use crate::scratch::TickScratch;
use crate::state::{PlayerId, World};
use crate::statics::MatchStatic;
use crate::systems::signatures::LandedHit;

#[cfg_attr(not(test), allow(unused_imports))] // measured layout evidence accessor
pub(crate) use index::node_size;
pub(crate) use index::{Inserted, PairIndex};

/// The closed trusted Card amount domain (Root-approved B3).
///
/// `Finite` carries a nonnegative finite binary64 **payload** (its bits are the source-observable number,
/// signed zero included); the two special outcomes are payload-free tags so no IEEE nonfinite float is ever
/// serialized. The fold in [`CardBleedAmount::fold`] reproduces the source's ordinary ordered `+=`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CardBleedAmount {
    Finite(f64),
    PositiveInfinity,
    NotANumber,
}

impl CardBleedAmount {
    fn variants() -> &'static [&'static str] {
        &["Finite", "PositiveInfinity", "NotANumber"]
    }

    /// Classify one source-observable landed amount.
    ///
    /// The admitted landed algebra is nonnegative (`ledger.rs`: the pre-scaled amount test and nonnegative
    /// landed share), reaching `Finite(..)`, `PositiveInfinity` and `NotANumber`; a negative value is not an
    /// admitted outcome and has no B3 encoding, so it fails closed to the absorbing tag instead of silently
    /// clamping or inventing a negative tag. The debug assertion surfaces an admission regression in tests.
    pub(crate) fn from_landed(amount: f64) -> Self {
        if amount.is_nan() {
            Self::NotANumber
        } else if amount == f64::INFINITY {
            Self::PositiveInfinity
        } else if amount < 0.0 {
            debug_assert!(false, "admitted Card landing is nonnegative, got {amount}");
            Self::NotANumber
        } else {
            // Includes -0.0: `-0.0 < 0.0` is false and the bit pattern is preserved verbatim.
            Self::Finite(amount)
        }
    }

    /// The source's `acc.amount += h.amount`: one ordinary finite addition per landed repeat, ordinary
    /// rounding, finite overflow to `PositiveInfinity`, NaN absorbing. No exact sum, no reordering, no clamp.
    pub(crate) fn fold(&mut self, amount: f64) {
        match *self {
            Self::NotANumber => {}
            Self::PositiveInfinity => {
                // +Infinity + finite stays +Infinity; +Infinity + NaN is NaN. The negative operand the
                // source could only see outside the admitted landed algebra fails closed.
                if amount.is_nan() || amount < 0.0 {
                    *self = Self::NotANumber;
                }
            }
            Self::Finite(current) => {
                let folded = current + amount;
                if folded.is_nan() {
                    *self = Self::NotANumber;
                } else if folded == f64::INFINITY {
                    *self = Self::PositiveInfinity;
                } else if folded < 0.0 {
                    debug_assert!(
                        false,
                        "admitted Card fold is nonnegative, got {folded} from {current} + {amount}"
                    );
                    *self = Self::NotANumber;
                } else {
                    *self = Self::Finite(folded);
                }
            }
        }
    }

    /// The tag discriminant used by the trusted/private headless diagnostic (never a float decode).
    pub fn tag(self) -> u64 {
        match self {
            Self::Finite(_) => 0,
            Self::PositiveInfinity => 1,
            Self::NotANumber => 2,
        }
    }

    /// The finite payload's bits, or `None` for the payload-free tags.
    pub fn finite_bits(self) -> Option<u64> {
        match self {
            Self::Finite(v) => Some(v.to_bits()),
            Self::PositiveInfinity | Self::NotANumber => None,
        }
    }
}

impl serde::Serialize for CardBleedAmount {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match *self {
            Self::Finite(value) => {
                s.serialize_newtype_variant("CardBleedAmount", 0, "Finite", &value)
            }
            Self::PositiveInfinity => {
                s.serialize_unit_variant("CardBleedAmount", 1, "PositiveInfinity")
            }
            Self::NotANumber => s.serialize_unit_variant("CardBleedAmount", 2, "NotANumber"),
        }
    }
}

impl<'de> serde::Deserialize<'de> for CardBleedAmount {
    /// Strict canonical B3 intake. The stored checkpoint codec is self-describing (the workspace's JSON
    /// checkpoint/pending-event storage), so the raw shape is inspected directly: a special tag must be the bare
    /// unit string, `Finite` must be the one-key map with a nonnegative finite f64 payload, and the externally
    /// tagged `{"PositiveInfinity": null}`-style or map-with-payload aliases, unknown/ambiguous tags, a duplicate
    /// discriminant and any null IEEE alias are refused instead of coerced.
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(AmountVisitor)
    }
}

struct AmountVisitor;

impl<'de> serde::de::Visitor<'de> for AmountVisitor {
    type Value = CardBleedAmount;

    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(
            "a canonical CardBleedAmount: {\"Finite\": nonnegative finite number}, \"PositiveInfinity\" or \"NotANumber\"",
        )
    }

    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
        match value {
            "PositiveInfinity" => Ok(CardBleedAmount::PositiveInfinity),
            "NotANumber" => Ok(CardBleedAmount::NotANumber),
            other => Err(E::unknown_variant(other, CardBleedAmount::variants())),
        }
    }

    fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> {
        self.visit_str(&value)
    }

    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        use serde::de::Error;
        let Some(tag) = map.next_key::<String>()? else {
            return Err(A::Error::invalid_type(serde::de::Unexpected::Map, &self));
        };
        if tag != "Finite" {
            return Err(A::Error::custom(format!(
                "non-canonical or unknown CardBleedAmount tag `{tag}`: special tags are payload-free unit strings"
            )));
        }
        let value = map.next_value::<f64>()?;
        if !value.is_finite() {
            return Err(A::Error::custom(
                "CardBleedAmount::Finite payload must be finite",
            ));
        }
        if value < 0.0 {
            return Err(A::Error::custom(
                "CardBleedAmount::Finite payload must be nonnegative",
            ));
        }
        if map.next_key::<serde::de::IgnoredAny>()?.is_some() {
            return Err(A::Error::custom(
                "duplicate or extra CardBleedAmount discriminant/field",
            ));
        }
        Ok(CardBleedAmount::Finite(value))
    }
}

/// One ordered trusted row: the actual raw landed pair and the source-ordered tagged fold.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CardBleedBucket {
    pub(crate) victim: PlayerId,
    pub(crate) by: Option<PlayerId>,
    pub(crate) amount: CardBleedAmount,
}

/// The trusted World report (source `bleeds` WeakMap entry). `since: None` is the source's absent report;
/// `Some(now)` with empty rows is a report that exists after a flush (its interval keeps running).
///
/// The pair index is a derived acceleration table: it is skipped by serde (never serialized, never hashed)
/// and rebuilt from `rows` on restore, so it is excluded from equality as well.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CardBleedReport {
    #[serde(default)]
    pub(crate) since: Option<f64>,
    #[serde(default)]
    pub(crate) rows: Vec<CardBleedBucket>,
    #[serde(skip)]
    pub(crate) index: PairIndex,
}

impl PartialEq for CardBleedReport {
    fn eq(&self, other: &Self) -> bool {
        self.since == other.since && self.rows == other.rows
    }
}

/// The derived index/row ordinals are `u32` with `NO_NODE = u32::MAX` reserved: a prepared row count must fit the
/// ordinal domain exactly (the largest valid count is `u32::MAX` rows; `u32::MAX + 1` is unrepresentable). This is
/// a representation refusal, never a gameplay cap.
pub(crate) const MAX_INDEXED_ROWS: usize = u32::MAX as usize;

/// Whether `count` rows fit the derived-index ordinal domain. The sentinel value itself is reserved for an empty
/// link, so the largest **count** whose last ordinal is still representable is `u32::MAX`.
pub(crate) const fn indexed_rows_representable(count: usize) -> bool {
    count <= MAX_INDEXED_ROWS
}

impl CardBleedReport {
    pub(crate) fn exists(&self) -> bool {
        self.since.is_some()
    }

    /// Reserve the derived capacities for the accepted state in BOTH the row vector and the derived pair
    /// index, then rebuild the index from the restored rows. The full `Q` bound is reserved so the first unseen
    /// raw pairs after cold preparation never grow a container on the hot path.
    pub(crate) fn prepare(&mut self, rows_capacity: usize) -> Result<(), ()> {
        // Refuse an unrepresentable capacity BEFORE allocating any (possibly enormous) row vector.
        if !indexed_rows_representable(rows_capacity)
            || !indexed_rows_representable(self.rows.len())
        {
            return Err(());
        }
        let extra = rows_capacity.saturating_sub(self.rows.len());
        self.rows.try_reserve_exact(extra).map_err(|_| ())?;
        self.rebuild_index()?;
        self.index.reserve(rows_capacity)
    }

    /// Rebuild the derived index from the validated ordered rows (cold restore/preparation).
    pub(crate) fn rebuild_index(&mut self) -> Result<(), ()> {
        self.index.reset();
        self.index.reserve(self.rows.len())?;
        for (row, bucket) in self.rows.iter().enumerate() {
            let row = u32::try_from(row).map_err(|_| ())?;
            if let Inserted::Existing(_) = self.index.insert(bucket.victim, bucket.by, row) {
                return Err(());
            }
        }
        Ok(())
    }

    /// Source `bleedsOf` + the eligible landed loop: the first hit creates the report with the true
    /// first-use clock, a repeat of the same raw pair folds its trusted binary64 sum in landed order, and a
    /// new pair appends in first-occurrence order.
    pub(crate) fn note(&mut self, now: f64, victim: PlayerId, by: Option<PlayerId>, amount: f64) {
        if self.since.is_none() {
            self.since = Some(now);
        }
        match self.index.insert(victim, by, self.rows.len() as u32) {
            Inserted::Existing(row) => self.rows[row as usize].amount.fold(amount),
            Inserted::New => self.rows.push(CardBleedBucket {
                victim,
                by,
                amount: CardBleedAmount::from_landed(amount),
            }),
        }
    }

    /// Source `flushBleeds`: emit the stored rows in insertion order and clear them while retaining capacity,
    /// then restart the interval clock. An existing report flushes even when its rows are empty.
    pub(crate) fn flush(&mut self, now: f64, ev: &mut Vec<Event>, fx: Option<&mut TickFx>) {
        let Some(_) = self.since else { return };
        if let Some(fx) = fx {
            fx.ops.push(Op::CardFlush(ev.len()));
        }
        for row in &self.rows {
            ev.push(Event::CardBleedHit {
                victim: row.victim,
                by: row.by,
                amount: row.amount,
            });
        }
        self.rows.clear();
        self.index.reset();
        self.since = Some(now);
    }

    /// Source `resetAll`'s `bleeds.delete(world)`: the report stops existing. Derived capacity is retained.
    pub(crate) fn reset(&mut self) {
        self.since = None;
        self.rows.clear();
        self.index.reset();
    }

    /// Strict canonical invariant audit for the serialized trusted path (and coherent post-restore state).
    /// The report clock records `world.server_time`, so an accepted baseline/lifecycle-off world with a
    /// fractional accepted clock records a fractional `since`; only finiteness, prior-time and the report's own
    /// state invariants are required. No tick<->clock equality and no fit tolerance is imposed here.
    pub(crate) fn validate(
        &self,
        server_time: f64,
        known_actor: &impl Fn(PlayerId) -> bool,
    ) -> Result<(), String> {
        match self.since {
            None => {
                if !self.rows.is_empty() {
                    return Err("Card report has rows without a report clock".into());
                }
            }
            Some(since) => {
                if !since.is_finite() || since < 0.0 || since > server_time {
                    return Err(format!(
                        "Card report clock {since} is not a finite prior server time"
                    ));
                }
            }
        }
        if self.rows.len() > u32::MAX as usize {
            return Err("Card report row count exceeds its representable capacity".into());
        }
        let mut seen = PairIndex::new();
        seen.reserve(self.rows.len())
            .map_err(|_| "Card report pair index capacity".to_string())?;
        for (row, bucket) in self.rows.iter().enumerate() {
            if !known_actor(bucket.victim) {
                return Err(format!(
                    "Card report row {row}: victim {} has no retained actor provenance",
                    bucket.victim.0
                ));
            }
            if let Some(by) = bucket.by {
                if !known_actor(by) {
                    return Err(format!(
                        "Card report row {row}: source {} has no retained actor provenance",
                        by.0
                    ));
                }
            }
            match seen.insert(bucket.victim, bucket.by, row as u32) {
                Inserted::New => {}
                Inserted::Existing(previous) => {
                    return Err(format!(
                        "Card report rows {previous} and {row} repeat the raw pair ({}, {:?})",
                        bucket.victim.0,
                        bucket.by.map(|p| p.0)
                    ))
                }
            }
        }
        Ok(())
    }
}

/// One exact derived row for the current tick's Card segment (the producer sidecar). Finite limbs are exact;
/// the two classifications are local and are only inspected after settled entitlement and redaction.
#[derive(Clone, Debug)]
pub(crate) struct CardExactRow {
    pub(crate) victim: PlayerId,
    pub(crate) by: Option<PlayerId>,
    pub(crate) sum: ExactSum,
    /// The raw landed amount is outside the exact nonnegative finite domain (a source-invalid B3 input).
    pub(crate) invalid: bool,
    /// Checked exact accumulation/limb-carry failure for this raw pair.
    pub(crate) overflow: bool,
}

impl CardExactRow {
    fn new(victim: PlayerId, by: Option<PlayerId>) -> Self {
        Self {
            victim,
            by,
            sum: ExactSum::default(),
            invalid: false,
            overflow: false,
        }
    }
}

/// The producer's exact per-tick segment: one row per actual raw pair, appended in first-occurrence order and
/// exact-merged for finite repeats. Cleared after sealing, capacity retained.
#[derive(Clone, Debug, Default)]
pub(crate) struct CardSegment {
    pub(crate) rows: Vec<CardExactRow>,
    pub(crate) index: PairIndex,
}

impl CardSegment {
    pub(crate) fn prepare(&mut self, rows_capacity: usize) -> Result<(), ()> {
        if !indexed_rows_representable(rows_capacity) {
            return Err(());
        }
        self.rows.try_reserve_exact(rows_capacity).map_err(|_| ())?;
        self.index.reserve(rows_capacity)
    }

    pub(crate) fn clear(&mut self) {
        self.rows.clear();
        self.index.reset();
    }

    /// Add one landed amount to its exact raw-pair row. The exact domain keeps the two local classifications
    /// distinct (source-invalid input vs checked limb/carry failure); it never rounds.
    fn note(&mut self, victim: PlayerId, by: Option<PlayerId>, amount: f64) {
        let row = match self.index.insert(victim, by, self.rows.len() as u32) {
            Inserted::Existing(row) => row as usize,
            Inserted::New => {
                self.rows.push(CardExactRow::new(victim, by));
                self.rows.len() - 1
            }
        };
        let slot = &mut self.rows[row];
        if slot.invalid {
            return;
        }
        if slot.overflow {
            // A prior checked limb/carry failure keeps its arithmetic skipped, but a later source-invalid amount
            // for the SAME raw pair must still be classified: the eligible public error precedence is
            // InvalidAmount when both local flags exist (the viewer bucket checks `invalid` first), so suppress-
            // ing the later invalid flag would change which typed error a viewer sees. No arithmetic is attempted
            // for the already-overflowed pair.
            if !amount.is_finite() || amount < 0.0 {
                slot.invalid = true;
            }
            return;
        }
        match slot.sum.add(amount) {
            Ok(()) => {}
            Err(SumError::Invalid) => slot.invalid = true,
            Err(SumError::Overflow) => slot.overflow = true,
        }
    }
}

/// Candidate capacities for the private producer/sealed sidecars, the trusted pending rows and one viewer's
/// public buckets, from the accepted state (design "Capacity model"). All math is checked; `Err` refuses cold
/// preparation instead of silently under-reserving.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CardCapacities {
    /// `K = U0 + P*V`: exact raw-pair rows in each producer/sealed sidecar.
    pub(crate) k: usize,
    /// `Q = Q0 + U0 + P*V`: trusted pending ordered rows in one populated flush.
    pub(crate) q: usize,
    /// `B = 2*U0 + (P+1)*V`: public Card buckets for one viewer in one populated flush.
    pub(crate) b: usize,
    /// The actual inventory factors, printed by the layout/allocation evidence.
    pub(crate) v: usize,
    pub(crate) pristine_player_only: bool,
    pub(crate) players: usize,
    pub(crate) actors: usize,
    pub(crate) camp_spots: usize,
    pub(crate) initial_pairs: usize,
    pub(crate) trusted_rows: usize,
}

fn checked(parts: &[Option<usize>]) -> Result<usize, String> {
    let mut total = 0usize;
    for part in parts {
        let v = part.ok_or_else(|| "Card capacity arithmetic overflowed".to_string())?;
        total = total
            .checked_add(v)
            .ok_or_else(|| "Card capacity arithmetic overflowed".to_string())?;
    }
    Ok(total)
}

/// `R`: the checked sum of actual possible regional camp spots for this arena/config.
pub(crate) fn camp_spots(k: &MatchStatic) -> Result<usize, String> {
    let mut total = 0usize;
    if k.config.mob_mode != crate::mob_runtime::MobMode::Off {
        if let Some(layers) = k.arena.map.layers() {
            for camp in &layers.data().camps {
                total = total
                    .checked_add(camp.spots.len())
                    .ok_or_else(|| "Card camp spot budget overflowed".to_string())?;
            }
        }
    }
    Ok(total)
}

/// Distinct eligible initial raw pairs (`U0`), deduplicated by the full pair and including `None`. Eligible
/// initial rows are no-ability DoT status instances plus eligible deferred DoT entries; stale rows are a safe
/// overestimate and are not required to expire. Provenance is validated by the checkpoint audit.
pub(crate) fn initial_pairs(w: &World) -> Vec<(PlayerId, Option<PlayerId>)> {
    let mut pairs: Vec<(PlayerId, Option<PlayerId>)> =
        Vec::with_capacity(w.fighter_count() + w.deferred.hits.len());
    for slot in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        let core = w.core(ix);
        for status in &core.statuses.instances {
            if status.kind == crate::status_runtime::StatusKind::Dot && status.ability.is_none() {
                pairs.push((core.id, status.source.id));
            }
        }
    }
    for entry in &w.deferred.hits {
        if entry.dot && entry.ability.is_none() {
            pairs.push((entry.victim, entry.by));
        }
    }
    pairs.sort_unstable();
    pairs.dedup();
    pairs
}

/// The design's actual capacity set for this accepted (or freshly constructed) state.
pub(crate) fn capacities(k: &MatchStatic, w: &World) -> Result<CardCapacities, String> {
    let players = w.players.len().max(8);
    let actors = w.fighter_count();
    let camp_spots = camp_spots(k)?;
    let pristine_player_only = pristine_player_only(k, w, camp_spots)?;
    capacity_from(
        players,
        actors,
        camp_spots,
        initial_pairs(w).len(),
        w.card_bleed.rows.len(),
        pristine_player_only,
    )
}

/// `R`-free pristine-player-only predicate: no further actor can ever be born under these proven prerequisites.
fn pristine_player_only(k: &MatchStatic, w: &World, camp_spots: usize) -> Result<bool, String> {
    Ok(k.config.mob_mode == crate::mob_runtime::MobMode::Off
        && k.config.faction_mode == crate::FactionMode::Off
        && !k.config.training
        && !k.config.dummies
        && !k.config.quests
        && w.practice.is_none()
        && camp_spots == 0
        && w.mobs.is_empty()
        && w.actor_history.len() == w.players.len()
        && w.players.len() <= 8)
}

/// Pure checked capacity arithmetic over the actual inventory factors, used by [`capacities`] and by the
/// oversized/arithmetic representation controls. `Err` is a representation refusal (checked overflow, or an indexed
/// bound past the `u32` ordinal domain with `u32::MAX` reserved) and allocates nothing.
pub(crate) fn capacity_from(
    players: usize,
    actors: usize,
    camp_spots: usize,
    initial_pairs: usize,
    trusted_rows: usize,
    pristine_player_only: bool,
) -> Result<CardCapacities, String> {
    // The proven pristine player-only specialization takes a smaller V (`P = 8` bounds every future raw pair,
    // design table 64/64/72 at U0=Q0=0). Every other accepted world takes the general restore bound
    // `V = A0 + 14P + 2R + 150`; it is deliberately larger, and the evidence reports its measured footprint.
    let v = if pristine_player_only {
        players
    } else {
        checked(&[
            Some(actors),
            players.checked_mul(14),
            camp_spots.checked_mul(2),
            Some(150),
        ])?
    };
    let new_pairs = players
        .checked_mul(v)
        .ok_or_else(|| "Card capacity arithmetic overflowed".to_string())?;
    let k = checked(&[Some(initial_pairs), Some(new_pairs)])?;
    let q = checked(&[Some(trusted_rows), Some(initial_pairs), Some(new_pairs)])?;
    let b = checked(&[
        initial_pairs.checked_mul(2),
        players.checked_add(1).and_then(|p| p.checked_mul(v)),
    ])?;
    // The derived indexes store u32 ordinals with `u32::MAX` reserved, so every indexed bound must be
    // representable BEFORE any allocation (row allocation included). This refuses an unrepresentable accepted
    // state, never a gameplay value.
    if !indexed_rows_representable(k)
        || !indexed_rows_representable(q)
        || !indexed_rows_representable(b)
    {
        return Err("Card capacity exceeds the derived u32 index ordinal domain".into());
    }
    Ok(CardCapacities {
        k,
        q,
        b,
        v,
        pristine_player_only,
        players,
        actors,
        camp_spots,
        initial_pairs,
        trusted_rows,
    })
}

/// One viewer's public Card bucket capacity (`B`).
pub(crate) fn viewer_capacity(k: &MatchStatic, w: &World) -> Result<usize, String> {
    capacities(k, w).map(|c| c.b)
}

impl crate::fx_report::Projection {
    /// Cold preparation of the sealed report: the per-step exact segment bound, the private Card raw-row
    /// envelope `Q + T0`, and the sealed report event/wish buffers sized for `legacy 512 + Card envelope`.
    /// The sealed report stays empty/incomplete; capacity is the only thing prepared. Checked arithmetic and
    /// fallible reserve; a refused capacity is an explicit cold refusal, never a warm grow or truncation.
    pub(crate) fn prepare_card(&mut self, rows: usize, card_events: usize) -> Result<(), ()> {
        if !indexed_rows_representable(rows) {
            return Err(());
        }
        let event_capacity = crate::fx_report::FX_REPORT_EVENTS_MAX
            .checked_add(card_events)
            .ok_or(())?;
        self.report
            .card_rows
            .try_reserve_exact(rows.saturating_sub(self.report.card_rows.len()))
            .map_err(|_| ())?;
        self.report
            .events
            .try_reserve_exact(event_capacity.saturating_sub(self.report.events.len()))
            .map_err(|_| ())?;
        self.report
            .wish_points
            .try_reserve_exact(event_capacity.saturating_sub(self.report.wish_points.len()))
            .map_err(|_| ())?;
        self.report.card_event_limit = card_events;
        Ok(())
    }
}

/// The private Card raw-row history envelope at cold preparation: the checked `Q + T0`, where `T0` is the actual
/// number of serialized pending Card raw rows (valid intake, appended by `step_into` before the step's work) at
/// construction/clone/restore. `Q0`, initial status/deferred pairs and trusted rows do not include `T0`.
pub(crate) fn card_history_envelope(w: &World, q: usize) -> Result<usize, String> {
    let pending = w
        .pending_events
        .iter()
        .filter(|event| matches!(event, Event::CardBleedHit { .. }))
        .count();
    q.checked_add(pending)
        .ok_or_else(|| "Card prepared raw-history envelope overflowed".to_string())
}

/// Count of serialized pending Card raw rows at the accepted cut (part of the prepared `Q + T0` envelope).
#[cfg_attr(not(test), allow(dead_code))] // cold-preparation/evidence accessor
pub(crate) fn pending_card_rows(w: &World) -> usize {
    w.pending_events
        .iter()
        .filter(|event| matches!(event, Event::CardBleedHit { .. }))
        .count()
}

/// Cold constructor/clone/restore preparation: trusted rows/index, producer segment, sealed report sidecar and
/// the sealed report event envelopes (`legacy 512 + Q + T0`).
pub(crate) fn prepare(
    k: &MatchStatic,
    w: &mut World,
    s: &mut TickScratch,
    projection: &mut crate::fx_report::Projection,
) -> Result<(), String> {
    let c = capacities(k, w)?;
    let card_events = card_history_envelope(w, c.q)?;
    w.card_bleed
        .prepare(c.q)
        .map_err(|_| "Card report capacity".to_string())?;
    s.card_segment
        .prepare(c.k)
        .map_err(|_| "Card segment capacity".to_string())?;
    projection
        .prepare_card(c.k, card_events)
        .map_err(|_| "Card sealed report/event capacity".to_string())?;
    Ok(())
}

/// Run inside `cards::after_damage` at the source position: consume only this pass's actual `s.landed` in its
/// existing order. Eligible rows are exactly `dot && ability == None && sig == None` (no passive/weapon filter).
pub(crate) fn contribute(
    w: &mut World,
    landed: &[LandedHit],
    fx: &mut TickFx,
    segment: &mut CardSegment,
) {
    let now = w.server_time;
    let mut started = false;
    for h in landed {
        if !(h.dot && h.ability.is_none() && h.sig.is_none()) {
            continue;
        }
        if !started {
            // Small segment/range reference at the true first contribution position. The sealed report sidecar
            // for this completed tick starts at this row offset.
            fx.ops.push(Op::CardSegment(segment.rows.len()));
            started = true;
        }
        w.card_bleed.note(now, h.victim, h.by, h.amount);
        segment.note(h.victim, h.by, h.amount);
    }
}

/// The source periodic check after stillness: flush only when a report exists and its interval has aged 500 ms.
/// The marker is recorded at the exact current event index even for empty rows.
pub(crate) fn periodic(w: &mut World, ev: &mut Vec<Event>, fx: &mut TickFx) {
    let Some(since) = w.card_bleed.since else {
        return;
    };
    if w.server_time - since >= crate::constants::DOT_FX_MS {
        w.card_bleed.flush(w.server_time, ev, Some(fx));
    }
}

/// The registered `runEnded` link (replaces only the pending `cardHooks.flushBleeds` position).
pub(crate) fn run_ended(h: &mut Hx, args: &HookArgs) {
    if *args != HookArgs::RunEnded {
        return;
    }
    if !h.w.card_bleed.exists() {
        return;
    }
    let now = h.w.server_time;
    h.w.card_bleed.flush(now, h.ev, h.fx.as_deref_mut());
}

/// The GateAlways `cardHooks.resetAll` raid-start addition: clear only the Card report and record the marker
/// that clears the derived Card projection state. Legacy reset/flush domains are untouched.
pub(crate) fn reset(h: &mut Hx) {
    h.w.card_bleed.reset();
    if let Some(fx) = h.fx.as_deref_mut() {
        fx.ops.push(Op::CardReset(h.ev.len()));
    }
}

/// Content identity of the Card feedback rules: the closed B3 tag set and the exact C-TICK flush clock. Folded
/// under the new `card-bleed-feedback/1` visitor marker; the marker exists because this mechanic changes
/// trusted state/hash and the public knowledge semantics.
pub(crate) fn visit_content(mut emit: impl FnMut(u64)) {
    emit(3); // the closed B3 tag count
    emit(0); // Finite
    emit(1); // PositiveInfinity
    emit(2); // NotANumber
    emit(crate::constants::DOT_FX_MS.to_bits());
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod source_tests;
