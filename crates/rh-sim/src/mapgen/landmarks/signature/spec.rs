//! P-MAPGEN-SIG-BLUEPRINT-1: the per-landmark table (architecture review 2026-11-13, finding 2). One `Spec` per
//! signature landmark, in the order `apply` places them (`reserved_zones`): what it is, its drawing and legend, the
//! features it writes and in which order, how it is placed and what its entrance is. The generic stamp reads only this
//! table; nothing per landmark is written by hand. A function, not a const: `tests/content.rs` reads consts as
//! tunables.
//!
//! STUB: `specs` returns an empty table; the implementer fills it.
use super::blueprint::{EntranceRule, Legend, Placement};
use super::Definition;
use crate::mapdata::{FeatureJob, FeatureKind, Zone};

/// Where a feature's anchor point (`MapFeature::ax`, `ay`) lies.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeatureAnchor {
    /// The landmark anchor's centre: the pinned tile (`Placement::Pin`) or the site's centre tile (`Placement::Centre`).
    Centre,
    /// The middle tile of the entrance as drawn (grid order, index `len / 2`), landed: the graveyard's (the main gate's
    /// middle tile).
    EntranceMiddle,
}

/// One feature a landmark writes: its kind, job and anchor point. The tiles it owns are the drawing's tiles whose
/// glyph names this kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeatureSpec {
    pub kind: FeatureKind,
    pub job: FeatureJob,
    pub anchor: FeatureAnchor,
}

/// One signature landmark.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spec {
    pub zone: Zone,
    /// The anchor's kind (`ZoneAnchor::kind`).
    pub kind: FeatureKind,
    /// The drawing's text (a `Definition` grid field), `None` for a landmark still placed by its own code (the Fire
    /// volcano until P-MAPGEN-SIG-SCALE-4).
    pub drawing: Option<&'static str>,
    pub legend: Legend,
    /// The features written, in write order (the first is the anchor's feature).
    pub features: Vec<FeatureSpec>,
    pub placement: Placement,
    pub entrance: EntranceRule,
    /// Whether the `Definition::doorway` tiles beyond each entrance tile, along the front, must be `Site::open`.
    pub doorway: bool,
}

/// The table for definition `d`, one entry per landmark in `reserved_zones` order (Fire, Sentenced, Plague, Frost).
/// STUB: empty.
pub fn specs(_d: &Definition) -> Vec<Spec> {
    Vec::new()
}
