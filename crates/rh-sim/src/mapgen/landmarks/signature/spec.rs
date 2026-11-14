//! P-MAPGEN-SIG-BLUEPRINT-1: the per-landmark table (architecture review 2026-11-13, finding 2). One `Spec` per
//! signature landmark, in the order `apply` places them (`reserved_zones`): what it is, its drawing and legend, the
//! features it writes and in which order, how it is placed and what its entrance is. The generic stamp reads only this
//! table; nothing per landmark is written by hand. A function, not a const: `tests/content.rs` reads consts as
//! tunables.
//!
//! Each legend is today's reading of its drawing (the legend lines of the `*.txt` files say the same in prose): what
//! each character writes, which feature owns it and which `Site` test it must pass. Where the landmarks differ (the
//! tree's tiles keep out of earlier aprons, the cave's ice is floor, the church's fence is LOW), the difference is a
//! glyph here, not code.
use super::blueprint::{EntranceRule, Glyph, Legality, Legend, Placement, Write};
use super::{catalog_codes, Definition};
use crate::mapdata::{FeatureJob, FeatureKind, Zone};
use crate::mapgen::certify::rules::R;

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
    /// P-MAPGEN-SIG-BLUEPRINT-2: every feature kind that belongs to this landmark (its own features and, for the volcano,
    /// its streams and pools): what `SignatureContext::is_signature`, `aprons_apart` and the owned-tile part of `intact`
    /// read. A kind belongs to one entry only.
    pub members: Vec<FeatureKind>,
    /// P-MAPGEN-SIG-BLUEPRINT-2: the member kinds whose apron and keep mask follow their own tiles rather than their box
    /// (the volcano's lava streams and pools): what `SignatureContext::by_tile` reads.
    pub by_tile: Vec<FeatureKind>,
    /// P-MAPGEN-SIG-BLUEPRINT-2: the member kinds whose owned tiles `intact` checks by tile only, any terrain: the church
    /// building, whose end-of-attempt check has always read its wall tiles only (the legend writes terrain 0). Kept
    /// exactly: a stricter check would discard more maps and move attempts; tightening it is a behaviour change.
    pub any_terrain: Vec<FeatureKind>,
}

/// A glyph that writes `write`, owned by `feature`, on a tile passing `legality`.
fn solid(ch: u8, write: Write, feature: FeatureKind, legality: Legality) -> Glyph {
    Glyph {
        ch,
        write,
        feature: Some(feature),
        legality,
        mark: false,
    }
}

/// Plain floor, or a decoration the generator does not name (the church's lantern posts `*`, the tree's causeways
/// `:`): writes nothing; the tile must be `Site::floor`.
fn plain(ch: u8) -> Glyph {
    Glyph {
        ch,
        write: Write::Nothing,
        feature: None,
        legality: Legality::Floor,
        mark: false,
    }
}

/// A named mark on plain floor (`E` the camp tile, `D` a door or mouth).
fn mark(ch: u8) -> Glyph {
    Glyph {
        mark: true,
        ..plain(ch)
    }
}

/// The landmark's own feature: job `Landmark`, anchor point the landmark's centre.
fn landmark(kind: FeatureKind) -> FeatureSpec {
    FeatureSpec {
        kind,
        job: FeatureJob::Landmark,
        anchor: FeatureAnchor::Centre,
    }
}

/// The table for definition `d`, one entry per landmark in `reserved_zones` order (Fire, Sentenced, Plague, Frost).
/// The terrain codes the legends write are the terrain catalog's (`super::catalog_codes`), not `d`'s mirrors.
pub fn specs(d: &Definition) -> Vec<Spec> {
    use FeatureKind::{BogTree, Cave, Church, Graveyard, LavaPool, LavaStream, Volcano};
    let codes = catalog_codes();
    vec![
        // The volcano: still `volcano::place` (P-MAPGEN-SIG-SCALE-4 makes it an entry with a drawing).
        Spec {
            zone: Zone::Fire,
            kind: Volcano,
            drawing: None,
            legend: Legend::default(),
            features: Vec::new(),
            placement: Placement::Centre,
            entrance: EntranceRule::None,
            doorway: false,
            members: vec![Volcano, LavaStream, LavaPool],
            by_tile: vec![LavaStream, LavaPool],
            any_terrain: Vec::new(),
        },
        // The church (`#` walls, `P` pillars) and its graveyard (`G` headstones, `+` the LOW fence), `E` on the camp;
        // the entrance is the main gate, the open front row through `E`'s column.
        Spec {
            zone: Zone::Sentenced,
            kind: Church,
            drawing: Some(d.church_grid),
            legend: Legend(vec![
                solid(b'#', Write::Wall, Church, Legality::Wall),
                solid(b'P', Write::Wall, Church, Legality::Wall),
                solid(b'G', Write::Wall, Graveyard, Legality::Wall),
                solid(b'+', Write::Low(R.fence_kind), Graveyard, Legality::Wall),
                plain(b'.'),
                plain(b'*'),
                mark(b'E'),
                mark(b'D'),
            ]),
            features: vec![
                landmark(Church),
                FeatureSpec {
                    kind: Graveyard,
                    job: FeatureJob::Cover,
                    anchor: FeatureAnchor::EntranceMiddle,
                },
            ],
            placement: Placement::Pin(b'E'),
            entrance: EntranceRule::FrontRun(b'E'),
            doorway: true,
            members: vec![Church, Graveyard],
            by_tile: Vec::new(),
            any_terrain: vec![Church],
        },
        // The bog tree (`T` trunk, `r` roots, `%` marsh), off every apron marked before it, centred in its site; the
        // entrance is the causeways `:` on the box's edge.
        Spec {
            zone: Zone::Plague,
            kind: BogTree,
            drawing: Some(d.bog_grid),
            legend: Legend(vec![
                solid(b'T', Write::Wall, BogTree, Legality::WallGround),
                solid(b'r', Write::Wall, BogTree, Legality::WallGround),
                solid(b'%', Write::Floor(codes.bog), BogTree, Legality::WallGround),
                plain(b'.'),
                plain(b':'),
            ]),
            features: vec![landmark(BogTree)],
            placement: Placement::Centre,
            entrance: EntranceRule::Edge(b':'),
            doorway: false,
            members: vec![BogTree],
            by_tile: Vec::new(),
            any_terrain: Vec::new(),
        },
        // The cave (`#` walls, `R` rock, `=` ice floor), `E` on the camp; the entrance is the mouth `D`.
        Spec {
            zone: Zone::Frost,
            kind: Cave,
            drawing: Some(d.cave_grid),
            legend: Legend(vec![
                solid(b'#', Write::Wall, Cave, Legality::Wall),
                solid(b'R', Write::Wall, Cave, Legality::Wall),
                solid(b'=', Write::Floor(codes.ice), Cave, Legality::Floor),
                plain(b'.'),
                mark(b'E'),
                mark(b'D'),
            ]),
            features: vec![landmark(Cave)],
            placement: Placement::Pin(b'E'),
            entrance: EntranceRule::Mark(b'D'),
            doorway: true,
            members: vec![Cave],
            by_tile: Vec::new(),
            any_terrain: Vec::new(),
        },
    ]
}
