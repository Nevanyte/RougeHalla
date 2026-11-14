//! P-MAPGEN-LANDMARK-FRAME-1 (architecture review 2026-11-13, finding 1): what the generator knows about one zone's
//! signature landmark after the Landmarks phase, handed to that zone's styler (`style_zones::Input::landmarks`, then
//! `style_runtime::BaseContext::landmark`) so that no styler rebuilds the landmark from map features. `None` there (the
//! option off, or a zone without a landmark) is the one typed branch point for "signature mode" in a styler.
//!
//! Generator working state: never serialized, exported, hashed or sent. Built by `SignatureContext::apply` (one per
//! zone it builds, in `reserved_zones` order) and carried in `Placed::frames`; `SignatureContext::finish` exports each
//! frame's `anchor` as it stands.
use super::blueprint::{Cell, Landing};
use crate::mapdata::{FeatureKind, TilePt, TileRect, Zone, ZoneAnchor};

/// One zone's signature landmark as the Landmarks phase left it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LandmarkFrame {
    /// Exactly the anchor the finished map exports for this zone (`GameMapData::anchors`): centre, footprint (the
    /// landing's box for a drawing; the volcano's feature box), front and entrance.
    pub anchor: ZoneAnchor,
    /// Where the drawing landed (orientation, origin, box); `None` for a landmark placed by its own code (the volcano
    /// until P-MAPGEN-SIG-SCALE-4).
    pub landing: Option<Landing>,
    /// Every tile of every mark of the drawing's legend, in GRID order (by character ascending, then the drawing's
    /// row-major order, `gy` then `gx`), so a mark's identity survives the turn and the mirror. Empty without a landing.
    pub marks: Vec<Mark>,
    /// Each feature the landmark wrote, in write order: its kind and its box as written (the anchor's feature first).
    pub features: Vec<(FeatureKind, TileRect)>,
    /// Every tile the landmark wrote, as (tile index, tile, terrain), ascending by tile index.
    pub cells: Vec<(u32, u8, u8)>,
}

/// One landed tile of a named mark: the character, its grid tile in the drawing and the map tile it landed on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mark {
    pub ch: u8,
    pub grid: Cell,
    pub tile: TilePt,
}

/// The step's per-zone results, read through the frames (the implementation removes the `anchors` and `landed` fields:
/// the frames are the one record of what was placed).
impl super::Placed {
    /// Each built zone's anchor, in placement order (`reserved_zones`): `frames[i].anchor`.
    pub fn anchors(&self) -> impl Iterator<Item = &ZoneAnchor> + '_ {
        // Stub (P-MAPGEN-LANDMARK-FRAME-1): today's field; the implementer reads `frames`.
        self.anchors.iter()
    }

    /// One `Landed` per landmark placed from a drawing (a frame with a landing), in placement order, its marks grouped
    /// by character ascending, each mark's tiles row-major on the map (P-MAPGEN-SIG-BLUEPRINT-1's record).
    pub fn landed(&self) -> Vec<super::Landed> {
        // Stub (P-MAPGEN-LANDMARK-FRAME-1): today's field; the implementer derives it from `frames`.
        self.landed.clone()
    }
}

impl LandmarkFrame {
    /// The zone the landmark belongs to (the anchor's).
    pub fn zone(&self) -> Zone {
        self.anchor.zone
    }

    /// The map tiles of mark `ch`, in grid order (the drawing's row-major order, not the map's).
    pub fn mark(&self, ch: u8) -> impl Iterator<Item = TilePt> + '_ {
        // Stub (P-MAPGEN-LANDMARK-FRAME-1): the implementer returns `ch`'s tiles from `marks`, in their order.
        let _ = ch;
        core::iter::empty()
    }

    /// The map direction of the drawing's direction `grid_dir` (`Orientation::turn` of the landing): `heading((0, 1))`
    /// is the drawing's front. `None` without a landing.
    pub fn heading(&self, grid_dir: Cell) -> Option<Cell> {
        // Stub (P-MAPGEN-LANDMARK-FRAME-1): the implementer turns `grid_dir` by `landing`'s orientation.
        let _ = grid_dir;
        None
    }
}
