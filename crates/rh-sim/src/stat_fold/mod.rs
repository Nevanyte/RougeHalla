//! Pure binary64 stat-fold kernel, ported from `packages/shared/src`.
//!
//! The source map is:
//! - `effects.ts`: [`EffectRow`], closed key enums, and [`requirements_met`].
//! - `mods.ts`: [`zero_sums`], [`add_to_sums`], [`fold_stat_rows`], [`fold_rows`],
//!   [`folded_max_hp`], [`identity_mults`], [`mirrors_from_sums`],
//!   [`mirrors_from_fold`], and the multiplier/flat/mirror codecs.
//! - `chestBoosts.ts`: [`chest_boost_bonus`] and [`chest_boost_gain`].
//! - `constants.ts` and `CHEST_BOOST_DEFS`: [`StatFoldDefinition`].
//!
//! All numeric rules introduced by this module live in [`StatFoldDefinition`].
//! [`visit_content`] emits every rule in declaration order, with boost definitions
//! in chest-stat source order. Registration in the crate-wide content hash is left
//! to the integration phase.
//!
//! # Capture projection and next-phase schema
//!
//! `vs`, `scale`, `onHit`, and `trigger` are known source rows but do not
//! participate in this fold. Capture must strictly validate their complete source
//! payloads, then may project them to [`EffectKind::Vs`], [`EffectKind::Scale`],
//! [`EffectKind::OnHit`], and [`EffectKind::Trigger`]. The payload is deliberately
//! absent here; common `requires`/`needs` fields remain on [`EffectRow`]. No other
//! row payload is projected away. In particular, all six while conditions and
//! their numeric fields remain typed. A while answer is injected for an exact
//! [`RowLocation`], not inferred from a condition name.
//!
//! Numeric records cross the fixture boundary as fixed arrays in source order:
//! [`StatKey::source_order`] (20), [`MultKey::source_order`] (8),
//! [`ChestBoostStat::source_order`] (8 boosts), and
//! [`MirrorField::source_order`] (7). Flags are an array of flag names in first
//! insertion order. A fold case contains `effects`, `farmRows`, `baseMaxHp`,
//! `boosts`, and row-location-specific while answers; its complete output is
//! `plain`, `sums`, `farmSums`, `mults`, `flags`, `maxHp`, `mirrorsFromSums`,
//! `mirrorsFromFold`, `encodedMirrors`, and `decodedMirrors`. Direct case families
//! cover stat folding, requirements, boost bonus/gain, individual mult/flat codecs,
//! and complete mirror codecs. Rust consumes only the input side of those cases.
//!
//! The kernel performs no parsing, I/O, condition evaluation, ownership lookup, or
//! gameplay scheduling. Those are caller responsibilities.

mod boost;
mod definition;
mod fold;
mod js;
mod keys;
mod mirror;
mod rows;

pub use boost::{
    chest_boost_bonus, chest_boost_bonus_with_definition, chest_boost_gain,
    chest_boost_gain_with_definition, BoostCounts,
};
pub use definition::{default_definition, visit_content, ChestBoostDefinition, StatFoldDefinition};
pub use fold::{
    add_to_sums, fold_rows, fold_rows_with_definition, fold_stat_rows, folded_max_hp,
    folded_max_hp_with_definition, identity_mults, zero_sums, FoldContext, Folded, WhileAnswer,
};
pub use keys::{
    is_flat_stat, is_product_stat, ChestBoostStat, ConvertFrom, ConvertTo, EffectFlag, EffectStat,
    FlagSet, FlatStat, MultKey, MultSums, StatKey, StatSums,
};
pub use mirror::{
    cap_as_mult, cap_as_mult_with_definition, decode_flat, decode_flat_with_definition,
    decode_mirrors, decode_mirrors_with_definition, decode_mult, decode_mult_with_definition,
    encode_flat, encode_flat_with_definition, encode_mirrors, encode_mirrors_with_definition,
    encode_mult, encode_mult_with_definition, identity_mirrors, mirrors_from_fold,
    mirrors_from_fold_with_definition, mirrors_from_fold_with_sources, mirrors_from_sums,
    no_source_mods, wire_identity_mirrors, MirrorField, SourceMods, StatMirrors, WireMirrors,
};
pub use rows::{
    requirements_met, EffectKind, EffectRow, RowList, RowLocation, WhileCond, WhileRow,
};

#[cfg(test)]
mod tests;
