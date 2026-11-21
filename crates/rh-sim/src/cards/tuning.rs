//! P-AUG-RULES-1: the card tuning table a world plays (`SimConfig::augments`), derived on `MatchStatic` as
//! `k.cards` like `abilities::definition_for` (`abilities/mod.rs:390-398`). Under `Legacy` it is the generated catalog
//! and the legacy constants; under `Rework` it reads the hand-written override table (`rework_overrides.rs`, empty in
//! this packet) and the rework numbers, so it equals legacy until a later packet fills them.
//!
//! Every reader of a card's rows or of a named card number goes through the world's table (`k.cards`, or a `&Tuning`
//! passed down to helpers that have no `k`), so an override row applies everywhere at once: the stat fold, the restore
//! checks, the ledger, the hooks, the pools and the ranged envelope. `CardId::definition()` stays the generated catalog
//! (legacy); the build bookkeeping (`Build::has_flag`, `add`, `valid`, `power`) keeps reading it because the shape guard
//! ([`check_override`]) keeps flags, `unique` and `tier` equal. How to add a row or a number: `docs/agent/AUGMENT_REWORK.md`.
use super::{Build, CardDef, CardId, CardKind, CardRow, TriggerAction};
use crate::stat_fold::{EffectKind, StatFoldDefinition};
use crate::AugmentRule;

/// The named card numbers that are not catalog rows (legacy `constants.ts:237-288`; Rust `constants.rs:100-115` and the
/// stat fold's own `outgoing_row_cap` / `hp_race_cap`, `stat_fold/definition.rs:47-52`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CardNumbers {
    /// Plant Your Feet: the armed attack's extra share (legacy `PLANT_FEET_BONUS`).
    pub plant_feet_bonus: f64,
    /// Gambler: the chance an entry doubles (legacy `GAMBLER_CHANCE`).
    pub gambler_up_chance: f64,
    /// Gambler: the chance an entry halves (legacy: the same `GAMBLER_CHANCE`, read as `roll < 2 * GAMBLER_CHANCE`).
    pub gambler_down_chance: f64,
    /// Gambler: the up factor (legacy `GAMBLER_UP`).
    pub gambler_up: f64,
    /// Gambler: the down factor (legacy `GAMBLER_DOWN`).
    pub gambler_down: f64,
    /// Wishful Thinking: the most a window may cut (legacy `WISHFUL_BUDGET_MS`).
    pub wishful_budget_ms: f64,
    /// Wishful Thinking: the window (legacy `WISHFUL_WINDOW_MS`).
    pub wishful_window_ms: f64,
    /// Wishful Thinking: the share of a cast cooldown no cut goes below (legacy `WISHFUL_FLOOR_SHARE`).
    pub wishful_floor_share: f64,
    /// Wishful Thinking (P-AUG-TUNE-1): each hit's cut as a share of the cast's full cooldown; 0 reads the card row's `ms`.
    pub wishful_hit_share: f64,
    /// Wishful Thinking (P-AUG-TUNE-1): the most a window may cut as a share of the cast's full cooldown; 0 reads
    /// `wishful_budget_ms`.
    pub wishful_budget_share: f64,
    /// G1: the outgoing row ceiling AND the stat fold's `hit` clamp (legacy `OUTGOING_ROW_CAP`, both places).
    pub outgoing_row_cap: f64,
    /// G4: the Race to 0 ceiling AND the stat fold's `hpRace` clamp (legacy `HP_RACE_CAP`, both places).
    pub hp_race_cap: f64,
    /// Third Time's the Charm: every this many hits in a row (legacy `% 3`, `onHit.ts:39`).
    pub third_time_every: u16,
    /// Third Time's the Charm: the on-hit applications that hit adds (legacy `n++`: one, so effects apply twice).
    pub third_time_extra: f64,
}

impl CardNumbers {
    /// Wishful Thinking: what `n` hits may cut from a Wish cast with full cooldown `cooldown_ms`. The legacy rule
    /// (`wishful_hit_share` 0) is `n` times the card row's `ms`; a share rule ignores `ms` (the flag row) and cuts
    /// `n` times the share of the full cooldown.
    pub fn wishful_hit_cut(&self, n: u32, ms: f64, cooldown_ms: f64) -> f64 {
        if self.wishful_hit_share > 0. {
            f64::from(n) * (self.wishful_hit_share * cooldown_ms)
        } else {
            f64::from(n) * ms
        }
    }

    /// Wishful Thinking: the most one window may cut from a Wish cast with full cooldown `cooldown_ms` (legacy
    /// `wishful_budget_ms` when `wishful_budget_share` is 0). The sim's cut and the restore bound
    /// (`abilities/checkpoint.rs`) both read it, so they agree to the bit.
    pub fn wishful_budget(&self, cooldown_ms: f64) -> f64 {
        if self.wishful_budget_share > 0. {
            self.wishful_budget_share * cooldown_ms
        } else {
            self.wishful_budget_ms
        }
    }
}

/// A world's card table. `MatchStatic::cards` holds the one for its config.
#[derive(Debug)]
pub struct Tuning {
    rule: AugmentRule,
    numbers: CardNumbers,
    /// The override rows, at most one per card, each admitted by [`check_override`] against its catalog row.
    overrides: &'static [CardDef],
    /// The interactive augments a chest may offer (legacy `INTERACTIVE_AUGMENT_IDS`); P-AUG-POOL-1 gives `Rework` its own.
    pool: &'static [CardId],
    /// P-AUG-POOL-1 (decision 5): the pool cards offered only to a chest whose eligible pickers are all one faction;
    /// every other pool card is `Offer::Any`. Empty in both real tables: the faction-only natives carry their rule in
    /// their batch table (`native::pool_members`, P-AUG-NATIVE-4).
    faction_only: &'static [(CardId, crate::FactionId)],
    /// P-AUG-POOL-1 (Appendix A "Eye for an Eye"): Eye for an Eye counts `REWORK_EYE_FOR_AN_EYE_WEIGHT` times in a
    /// chest's draws when an eligible picker owns a returned-damage source. Off under `Legacy` (no weighting).
    weight_eye_for_an_eye: bool,
}

/// Why an override row is refused: it changes more than row numbers and text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShapeError {
    pub id: CardId,
    pub what: &'static str,
}

// The two tables. Every number is a registered constant by name (`tests/content.rs` lists `LEGACY` and `REWORK` in
// NON_GAMEPLAY), except Third Time's `3` and `1.`, which legacy writes inline (`onHit.ts:39`, Rust `on_hit.rs` before
// this packet) and which P-AUG-CONTENT-1 registers. A rework number becomes `crate::constants::REWORK_<NAME>` here once
// that packet adds its registry row (`docs/agent/AUGMENT_REWORK.md`).
static LEGACY: Tuning = Tuning {
    rule: AugmentRule::Legacy,
    numbers: CardNumbers {
        plant_feet_bonus: crate::constants::PLANT_FEET_BONUS,
        gambler_up_chance: crate::constants::GAMBLER_CHANCE,
        gambler_down_chance: crate::constants::GAMBLER_CHANCE,
        gambler_up: crate::constants::GAMBLER_UP,
        gambler_down: crate::constants::GAMBLER_DOWN,
        wishful_budget_ms: crate::constants::WISHFUL_BUDGET_MS,
        wishful_window_ms: crate::constants::WISHFUL_WINDOW_MS,
        wishful_floor_share: crate::constants::WISHFUL_FLOOR_SHARE,
        wishful_hit_share: 0.,
        wishful_budget_share: 0.,
        outgoing_row_cap: crate::constants::OUTGOING_ROW_CAP,
        hp_race_cap: crate::constants::HP_RACE_CAP,
        third_time_every: 3,
        third_time_extra: 1.,
    },
    overrides: &[],
    pool: &crate::reward_chests::INTERACTIVE,
    faction_only: &[],
    weight_eye_for_an_eye: false,
};
static REWORK: Tuning = Tuning {
    rule: AugmentRule::Rework,
    numbers: CardNumbers {
        plant_feet_bonus: crate::constants::REWORK_PLANT_FEET_BONUS,
        gambler_up_chance: crate::constants::REWORK_GAMBLER_UP_CHANCE,
        gambler_down_chance: crate::constants::REWORK_GAMBLER_DOWN_CHANCE,
        gambler_up: crate::constants::GAMBLER_UP,
        gambler_down: crate::constants::GAMBLER_DOWN,
        wishful_budget_ms: crate::constants::WISHFUL_BUDGET_MS,
        wishful_window_ms: crate::constants::WISHFUL_WINDOW_MS,
        wishful_floor_share: crate::constants::WISHFUL_FLOOR_SHARE,
        wishful_hit_share: crate::constants::REWORK_WISHFUL_HIT_SHARE,
        wishful_budget_share: crate::constants::REWORK_WISHFUL_BUDGET_SHARE,
        outgoing_row_cap: crate::constants::REWORK_OUTGOING_ROW_CAP,
        hp_race_cap: crate::constants::HP_RACE_CAP,
        third_time_every: 3,
        third_time_extra: crate::constants::REWORK_THIRD_TIME_EXTRA,
    },
    overrides: super::rework_overrides::REWORK_OVERRIDES,
    pool: crate::reward_chests::REWORK_POOL,
    faction_only: &[],
    weight_eye_for_an_eye: true,
};

impl Tuning {
    /// The table a config plays (a static: no allocation, no per-call build).
    pub fn of(config: &crate::SimConfig) -> &'static Tuning {
        match config.augments {
            AugmentRule::Legacy => &LEGACY,
            AugmentRule::Rework => {
                // Every debug build re-proves the hand-written table against the catalog once per match (release
                // builds rely on `tuning_tests::the_real_override_table_passes_the_guard`).
                debug_assert_eq!(check_table(REWORK.overrides), Ok(()));
                &REWORK
            }
        }
    }
    /// P-AUG-POOL-1-fix: the static table of a rule (what [`Tuning::of`] returns for a config with that rule), for the
    /// content-hash fold of the realized tables (`content::card_table_snapshots`).
    pub fn of_rule(rule: AugmentRule) -> &'static Tuning {
        match rule {
            AugmentRule::Legacy => &LEGACY,
            AugmentRule::Rework => &REWORK,
        }
    }
    /// The legacy table (the public pool functions and the readers with no world, e.g. a bare test helper).
    pub(crate) fn legacy() -> &'static Tuning {
        &LEGACY
    }
    pub fn rule(&self) -> AugmentRule {
        self.rule
    }
    pub fn numbers(&self) -> &CardNumbers {
        &self.numbers
    }
    /// The definition this world plays for a card: the override row if the table has one, else the catalog's.
    pub fn def(&self, id: CardId) -> &'static CardDef {
        self.overrides
            .iter()
            .find(|d| d.id == id)
            .unwrap_or_else(|| id.definition())
    }
    /// The rows a card presents to a faction under this table (`CardDef::selection` of [`Tuning::def`]).
    pub fn rows(&self, id: CardId, faction: crate::FactionId) -> &'static [CardRow] {
        self.def(id).selection(faction).1
    }
    /// The stat fold's definition under this table: the default one with this table's G1 (`hit`) and G4 (`hpRace`)
    /// clamps (`stat_fold/fold.rs:205-218`). Under `Legacy` (and an empty `Rework`) it equals the default definition.
    pub(crate) fn fold_definition(&self) -> StatFoldDefinition {
        StatFoldDefinition {
            outgoing_row_cap: self.numbers.outgoing_row_cap,
            hp_race_cap: self.numbers.hp_race_cap,
            ..crate::stat_fold::default_definition()
        }
    }
    /// The interactive augments a chest may offer in this world (legacy `INTERACTIVE_AUGMENT_IDS`).
    pub fn pool(&self) -> &'static [CardId] {
        self.pool
    }
    /// P-AUG-NATIVE-4: may a chest of this world offer `id`: a catalog card of [`Tuning::pool`], or, under `Rework`,
    /// a native card a batch table lists in its `POOL` (`cards::native::pool_members`). `augment_pool`, `offer`,
    /// `offer_pool` and `reward_chests::validate_world` read it.
    pub fn in_pool(&self, id: CardId) -> bool {
        self.pool.contains(&id) || self.native_offer(id).is_some()
    }
    /// P-AUG-NATIVE-4: the offer rule of a native pool card under this table (`None` under `Legacy`, and for an id no
    /// batch table lists).
    fn native_offer(&self, id: CardId) -> Option<crate::reward_chests::Offer> {
        if self.rule != AugmentRule::Rework {
            return None;
        }
        super::native::pool_members()
            .find(|(c, _)| *c == id)
            .map(|(_, o)| o)
    }
    /// P-AUG-POOL-1-fix: the override rows this table plays (empty under `Legacy`), as listed in the table.
    pub fn overrides(&self) -> &'static [CardDef] {
        self.overrides
    }
    /// P-AUG-POOL-1-fix: the pool cards offered only to a one-faction chest (`Offer::Faction`), as listed in the table.
    pub fn faction_only(&self) -> &'static [(CardId, crate::FactionId)] {
        self.faction_only
    }
    /// P-AUG-POOL-1-fix: does this table weight Eye for an Eye for returned-damage owners (see [`Tuning::offer_pool`])?
    pub fn weights_eye_for_an_eye(&self) -> bool {
        self.weight_eye_for_an_eye
    }
    /// Source `rewardAugmentPool` under this table: live pool augments not held by every picker, in catalog order; then
    /// (P-AUG-NATIVE-4, `Rework` only) the native pool cards under the same test, in native order. Under `Legacy` nothing
    /// is appended, so its draws are unchanged.
    pub fn augment_pool(&self, pickers: &[Build]) -> Vec<CardId> {
        let live = |id: &CardId| {
            let def = self.def(*id);
            def.kind == CardKind::Augment && def.ready && !held_by_all(pickers, *id)
        };
        CardId::ALL
            .into_iter()
            .filter(|id| self.pool.contains(id) && live(id))
            .chain(
                CardId::NATIVE
                    .into_iter()
                    .filter(|id| self.native_offer(*id).is_some() && live(id)),
            )
            .collect()
    }
    /// Source `conditionalPool` under this table: live conditionals a picker's base unlocks and not every picker holds,
    /// in catalog order.
    pub fn conditional_pool(&self, pickers: &[Build]) -> Vec<CardId> {
        CardId::ALL
            .into_iter()
            .filter(|id| {
                let def = self.def(*id);
                def.kind == CardKind::Conditional
                    && def.ready
                    && def
                        .requires
                        .is_some_and(|base| pickers.iter().any(|b| self.owns_base(b, base)))
                    && !held_by_all(pickers, *id)
            })
            .collect()
    }
    /// P-AUG-POOL-1: the offer rule of a pool card in this world (`None`: not in the pool). A native pool card's rule is
    /// its batch table's (P-AUG-NATIVE-4).
    pub fn offer(&self, id: CardId) -> Option<crate::reward_chests::Offer> {
        use crate::reward_chests::Offer;
        if !self.pool.contains(&id) {
            return self.native_offer(id);
        }
        Some(
            self.faction_only
                .iter()
                .find(|(c, _)| *c == id)
                .map_or(Offer::Any, |(_, f)| Offer::Faction(*f)),
        )
    }
    /// P-AUG-POOL-1: the cards a chest offers these eligible pickers in this world: [`Tuning::augment_pool`] (catalog
    /// order) less the entries whose [`crate::reward_chests::Offer`] does not admit the pickers, then, when the table
    /// weights it and an eligible picker owns a returned-damage source, Eye for an Eye repeated beside itself to count
    /// `REWORK_EYE_FOR_AN_EYE_WEIGHT` times. The draw protocol is unchanged (`roll_with`: one tier draw and one index
    /// draw per pick; its distinct-pick filter drops every copy once picked), so the weighting adds no draw. Under
    /// `Legacy` this is exactly `augment_pool` of the pickers' builds.
    pub fn offer_pool(&self, pickers: &[crate::reward_chests::Picker]) -> Vec<CardId> {
        let builds: Vec<Build> = pickers.iter().map(|p| p.build).collect();
        let mut pool = self.augment_pool(&builds);
        // P-AUG-NATIVE-4: a `Rework` pool holds the faction table's natives (`Offer::Faction`), so it always filters.
        if !self.faction_only.is_empty() || self.rule == AugmentRule::Rework {
            pool.retain(|id| self.offer(*id).is_some_and(|o| o.admits(pickers)));
        }
        if self.weight_eye_for_an_eye && pickers.iter().any(|p| self.owns_returned_damage(p)) {
            if let Some(i) = pool.iter().position(|id| *id == CardId::EyeForAnEye) {
                // A whole number of copies (the registered weight is 2: one extra).
                let copies = crate::constants::REWORK_EYE_FOR_AN_EYE_WEIGHT as usize;
                for _ in 1..copies {
                    pool.insert(i, CardId::EyeForAnEye);
                }
            }
        }
        pool
    }
    /// P-AUG-POOL-1: does the picker own a returned-damage source, a card whose rows under this table (for its
    /// faction) hold a `TriggerAction::Return` (today Spiked Shell; legacy `cardHooks.ts:128-146`)?
    fn owns_returned_damage(&self, picker: &crate::reward_chests::Picker) -> bool {
        picker.build.cards().any(|id| {
            self.rows(id, picker.faction).iter().any(|row| {
                matches!(
                    row,
                    CardRow::Trigger(super::TriggerRow {
                        action: TriggerAction::Return { .. },
                        ..
                    })
                )
            })
        })
    }
    /// Does the build hold a base card of this base stat (source `ownedBase`)?
    pub(crate) fn owns_base(&self, build: &Build, base: super::BaseStatId) -> bool {
        build.cards().any(|id| self.def(id).base == Some(base))
    }
    /// A table for tests, built through the shape guard ([`check_override`] for every row, and one row per id).
    #[cfg(test)]
    pub(crate) fn for_test(
        rule: AugmentRule,
        numbers: CardNumbers,
        overrides: &'static [CardDef],
    ) -> Result<Tuning, ShapeError> {
        check_table(overrides)?;
        Ok(Tuning {
            rule,
            numbers,
            overrides,
            pool: &crate::reward_chests::INTERACTIVE,
            faction_only: &[],
            weight_eye_for_an_eye: false,
        })
    }
    /// P-AUG-POOL-1: a test table with its own pool and faction-only entries (`faction_only`: the cards whose offer is
    /// `Faction(f)`; every other pool card is `Any`), the legacy numbers, no override and no Eye for an Eye weighting.
    #[cfg(test)]
    pub(crate) fn for_test_pool(
        rule: AugmentRule,
        pool: &'static [CardId],
        faction_only: &'static [(CardId, crate::FactionId)],
    ) -> Tuning {
        Tuning {
            rule,
            numbers: LEGACY.numbers,
            overrides: &[],
            pool,
            faction_only,
            weight_eye_for_an_eye: false,
        }
    }
}

fn held_by_all(pickers: &[Build], id: CardId) -> bool {
    !pickers.is_empty() && pickers.iter().all(|b| b.owns(id))
}

/// Every row of an override table passes [`check_override`] against its catalog row, and no card has two rows.
pub(crate) fn check_table(overrides: &[CardDef]) -> Result<(), ShapeError> {
    for (i, row) in overrides.iter().enumerate() {
        if overrides[..i].iter().any(|o| o.id == row.id) {
            return Err(ShapeError {
                id: row.id,
                what: "two override rows for one card",
            });
        }
        check_override(row.id.definition(), row)?;
    }
    Ok(())
}

/// The override-shape guard: `rework` may differ from `legacy` only in row numbers and its `text` (and a selection's
/// `text`). Every other field, every row's variant and keys (flags, stats, mult keys, trigger events, `once`, actions
/// and their non-number fields, which numbers are present) and the selections' factions are equal; a changed number must
/// be finite.
pub fn check_override(legacy: &CardDef, rework: &CardDef) -> Result<(), ShapeError> {
    let refuse = |what| {
        Err(ShapeError {
            id: legacy.id,
            what,
        })
    };
    if rework.id != legacy.id {
        return refuse("id");
    }
    if rework.kind != legacy.kind {
        return refuse("kind");
    }
    if rework.tier != legacy.tier {
        return refuse("tier");
    }
    if rework.base != legacy.base {
        return refuse("base");
    }
    if rework.requires != legacy.requires {
        return refuse("requires");
    }
    if rework.unique != legacy.unique {
        return refuse("unique");
    }
    if rework.ready != legacy.ready {
        return refuse("ready");
    }
    if rework.title != legacy.title {
        return refuse("title");
    }
    if rework.tags != legacy.tags {
        return refuse("tags");
    }
    if let Err(what) = same_rows(legacy.rows, rework.rows) {
        return refuse(what);
    }
    if rework.selections.len() != legacy.selections.len() {
        return refuse("the selections (one added or removed)");
    }
    for (l, r) in legacy.selections.iter().zip(rework.selections) {
        if l.faction != r.faction {
            return refuse("a selection's faction");
        }
        if let Err(what) = same_rows(l.rows, r.rows) {
            return refuse(what);
        }
    }
    Ok(())
}

/// Two row lists of one card have the same shape (count, order, variant and keys) and the override's numbers are finite.
fn same_rows(legacy: &[CardRow], rework: &[CardRow]) -> Result<(), &'static str> {
    if legacy.len() != rework.len() {
        return Err("the rows (one added or removed)");
    }
    for (l, r) in legacy.iter().zip(rework) {
        if map_numbers(l, &mut |_| 0.) != map_numbers(r, &mut |_| 0.) {
            return Err("a row's variant, key, flag, trigger or action");
        }
        let mut finite = true;
        map_numbers(r, &mut |x| {
            finite &= x.is_finite();
            x
        });
        if !finite {
            return Err("a row number that is not finite");
        }
    }
    Ok(())
}

/// The row with every number (`f64`, and the value inside a present `Option<f64>`) replaced by `f(number)`. The match is
/// exhaustive, so a new row variant or field must say here whether it is a number (tunable) or part of the shape.
/// Public (P-AUG-POOL-1-fix) so the content-hash fold and its oracle walk a row's numbers in this one order.
pub fn map_numbers(row: &CardRow, f: &mut dyn FnMut(f64) -> f64) -> CardRow {
    fn opt(x: Option<f64>, f: &mut dyn FnMut(f64) -> f64) -> Option<f64> {
        x.map(f)
    }
    match *row {
        CardRow::Fold(kind) => CardRow::Fold(match kind {
            EffectKind::Stat { stat, v } => EffectKind::Stat { stat, v: f(v) },
            EffectKind::Flat { stat, v } => EffectKind::Flat { stat, v: f(v) },
            EffectKind::While(w) => EffectKind::While(crate::stat_fold::WhileRow {
                cond: w.cond,
                arg: f(w.arg),
                stat: w.stat,
                v: f(w.v),
                ms: opt(w.ms, f),
            }),
            EffectKind::Convert { from, to, per, cap } => EffectKind::Convert {
                from,
                to,
                per: f(per),
                cap: opt(cap, f),
            },
            EffectKind::Mult { key, v } => EffectKind::Mult { key, v: f(v) },
            EffectKind::Flag { flag } => EffectKind::Flag { flag },
            EffectKind::Vs => EffectKind::Vs,
            EffectKind::Scale => EffectKind::Scale,
            EffectKind::OnHit => EffectKind::OnHit,
            EffectKind::Trigger => EffectKind::Trigger,
        }),
        CardRow::Vs(v) => CardRow::Vs(super::VsRow {
            test: v.test,
            arg: f(v.arg),
            v: f(v.v),
        }),
        CardRow::Scale(s) => CardRow::Scale(super::ScaleRow {
            src: s.src,
            per: f(s.per),
            step: f(s.step),
            cap: f(s.cap),
        }),
        CardRow::OnHit(o) => CardRow::OnHit(super::OnHitRow {
            status: o.status,
            per: f(o.per),
            cap: opt(o.cap, f),
            ms: f(o.ms),
        }),
        CardRow::Trigger(t) => CardRow::Trigger(super::TriggerRow {
            on: t.on,
            arg: f(t.arg),
            once: t.once,
            action: match t.action {
                TriggerAction::Splash { radius } => TriggerAction::Splash { radius: f(radius) },
                TriggerAction::Fortify { per, cap } => TriggerAction::Fortify {
                    per: f(per),
                    cap: f(cap),
                },
                TriggerAction::Status {
                    to,
                    status,
                    ms,
                    value,
                } => TriggerAction::Status {
                    to,
                    status,
                    ms: f(ms),
                    value: opt(value, f),
                },
                TriggerAction::Boost { as_, move_, ms } => TriggerAction::Boost {
                    as_: f(as_),
                    move_: f(move_),
                    ms: f(ms),
                },
                TriggerAction::Cooldown { ms } => TriggerAction::Cooldown { ms: f(ms) },
                TriggerAction::Return { melee, share } => TriggerAction::Return {
                    melee,
                    share: f(share),
                },
                TriggerAction::Heal {
                    share,
                    ms,
                    ignore_lockout,
                } => TriggerAction::Heal {
                    share: f(share),
                    ms: opt(ms, f),
                    ignore_lockout,
                },
            },
        }),
    }
}

#[cfg(test)]
#[path = "tuning_tests.rs"]
mod tuning_tests;

#[cfg(test)]
#[path = "rework_content_tests.rs"]
mod rework_content_tests;
