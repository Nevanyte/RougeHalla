//! Signature landmarks inside the generator (P-MAPGEN-SIGNATURE-CORE-1; owner rules G1-G8, 2026-11-12). No legacy
//! counterpart (DEV-020): reached only through `pipeline::Options::signature` (default off), so default-mode maps,
//! parity fixtures and pinned maps never move (G8).
//!
//! The step runs in the Landmarks phase, right after the legacy landmark stage (`stage::StageContext::apply`) and
//! before the spawn preparation, so spawns, the route guard and every zone styler see the landmark as existing terrain
//! (G1, G2). It writes through the stage's own layers (`LandmarkStage::state`: tiles, features, feature owners) and
//! marks the footprint and its apron in `LandmarkStage::masks` (`boxes` and `near1`), which feed `spawns::PoolInput`,
//! `SpawnContext::style_protect` (the stylers' `protect` / `no_block`), repair's keep mask and the ground spots. It
//! draws only from its own per-zone stream, `hash_seed(seed, attempt, zone index, Definition::stream)`; the attempt's
//! main stream and the stylers' streams are untouched (G6).
//!
//! STUB: `apply` places nothing, `finish` writes no anchor and `band` answers `Far`; the implementer fills them.
use crate::mapdata::{GameMapData, ZoneAnchor};
use crate::mapgen::attempt::{AttemptFrame, AttemptInputError};
use crate::mapgen::coliseum::{FixedLayout, H, W};

use super::stage::LandmarkStage;

/// Every signature tunable (G4's band table included) in one definition. Not folded into `content_hash` while the
/// option is off by default (listed in `tests/content.rs` NON_GAMEPLAY; the owner decides when it is promoted).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    /// The `hash_seed` stream id of the signature draws (0-2 are the stylers', 3 the landmark recipes', 4 the bushes').
    pub stream: u32,
    /// G4: the outer edge, in tiles of Chebyshev distance from the anchor's footprint rectangle, of the core, near and
    /// mid bands (inclusive); beyond the last is far. The core band is also the apron kept clear round the landmark.
    pub bands: [i32; 3],
}

pub const DEFAULT_DEFINITION: Definition = Definition {
    stream: 5,
    bands: [2, 6, 14],
};

/// G4: the band of a tile relative to a zone's anchor, nearest first.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub enum Band {
    Core,
    Near,
    Mid,
    Far,
}

/// G4: the band of tile (x, y): its Chebyshev distance from `anchor.footprint` (0 inside it) against
/// `DEFAULT_DEFINITION.bands`. Stylers and `rh-mapdress` call this; nothing else defines the bands.
pub fn band(anchor: &ZoneAnchor, x: i32, y: i32) -> Band {
    let _ = (anchor, x, y);
    Band::Far
}

/// What the step placed in one attempt: the anchors of the zones it built (zone-code order) and the terrain layer the
/// attempt starts its styler pass from (all zero except the landmarks' own terrain, such as the bog tree's bands).
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub anchors: Vec<ZoneAnchor>,
    pub terrain: Vec<u8>,
}

/// Immutable per-pipeline context, reused by every attempt.
pub struct SignatureContext<'f> {
    fixed: &'f FixedLayout,
    rules: Definition,
}

impl<'f> SignatureContext<'f> {
    pub fn new(fixed: &'f FixedLayout) -> Self {
        Self::from_definition(fixed, &DEFAULT_DEFINITION)
    }

    pub fn from_definition(fixed: &'f FixedLayout, d: &Definition) -> Self {
        Self { fixed, rules: *d }
    }

    pub fn definition(&self) -> &Definition {
        &self.rules
    }

    /// Places each zone's signature landmark (Plague: the bog tree; Sentenced: the church and its graveyard) into the
    /// stage's layers and masks. `Ok(None)` refuses the attempt (G5: a zone that cannot hold its landmark is never
    /// built without it; the pipeline tries the next attempt).
    pub fn apply(
        &self,
        frame: &AttemptFrame,
        stage: &mut LandmarkStage,
    ) -> Result<Option<Placed>, AttemptInputError> {
        let _ = (self.fixed, frame, &stage.state);
        Ok(Some(Placed {
            anchors: Vec::new(),
            terrain: vec![0; W * H],
        }))
    }

    /// Writes the finished map's anchors (G3) from the step's anchors and the finished features: the bog tree's and
    /// the church's, re-read from their features after records renumbered them, plus the Holy hall's (the largest
    /// `Hall` feature, placed by the Holy styler), in zone-code order.
    pub fn finish(&self, map: &mut GameMapData, anchors: Vec<ZoneAnchor>) {
        let _ = (map, anchors);
    }
}
