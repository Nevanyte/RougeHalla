//! Map dressing: a pure function from a generated map and a rule file to props and a ground-variant plane, in the
//! shapes the protocol 17 map blob reserves. Cosmetic only: nothing here is read by the sim, a bot or the certifier.
//!
//! Position unit: WORLD UNITS as `u16` (1 tile = 32 u, the same unit as `MapCamp`), clamped to `u16::MAX`. A prop belongs
//! to the tile `floor(x / 32), floor(y / 32)`; every rule is judged on that tile.
//!
//! Stages, in output order: (1) keep-clear mask, (2) legacy props, (3) signature rings, (4) clusters with clearings,
//! (5) edge dressing, (6) filler. The output lists legacy props first (in `GameMapData.props` order, converted), then
//! ring, cluster, edge and filler props. When the total would pass [`MAX_PROPS`] the list is cut to that length, so later
//! stages lose first.
//!
//! The rule file is in `rules/zones.json`; see [`rules`] for the schema types. Each stage is seeded from `map_hash` and
//! the stage name by hash noise (no RNG state), so a run is byte-identical everywhere.
pub mod rules;

use rh_sim::mapdata::GameMapData;
pub use rules::{Rules, TileClass};

/// The wire cap on props (`rh_protocol::map::MAX_MAP_PROPS`).
pub const MAX_PROPS: usize = 8192;
/// The prop is drawn tall (fades when a unit stands behind it).
pub const FLAG_TALL: u8 = 1;
/// The prop is a generator `GameMapData.props` entry kept as is: `kind` is the legacy kind index clamped to 255 and not
/// a rule-file code.
pub const FLAG_LEGACY: u8 = 2;

/// Mirrors `rh_protocol::map::MapProp`. `x` and `y` are world units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DressProp {
    pub kind: u8,
    pub x: u16,
    pub y: u16,
    pub variant: u8,
    pub flags: u8,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Dressing {
    pub props: Vec<DressProp>,
    /// Exactly `w * h` bytes, row-major; 0 where no rule set a variant.
    pub ground_variants: Vec<u8>,
}

/// One cluster site chosen by [`cluster_sites`]; `x`, `y` in world units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClusterSite {
    pub zone: rh_sim::mapdata::Zone,
    /// Index into that zone's `clusters`.
    pub rule: usize,
    pub x: u16,
    pub y: u16,
}

/// The dressing of `map`. Placeholder: dresses nothing.
pub fn dress(map: &GameMapData, _map_hash: u64, _rules: &Rules) -> Dressing {
    Dressing {
        props: Vec::new(),
        ground_variants: vec![0; map.w as usize * map.h as usize],
    }
}

/// Stage 1, the general mask: one flag per tile (`w * h`, row-major), true where NO prop may stand. Covers camps
/// (`r` + `campMargin` tiles around the centre), spawns, crate spots, ground spots (the tile holding each point), the
/// coliseum rectangle and each gate tile (+ `coliseumMargin`), and every tile `feature_grid` names a bush feature.
/// Placeholder: all false.
pub fn keep_clear(map: &GameMapData, _rules: &Rules) -> Vec<bool> {
    vec![false; map.w as usize * map.h as usize]
}

/// Stage 1, the extra mask for TALL props only: for each camp, the straight line from its centre to the centre of the
/// nearest coliseum gate (squared world distance on `GateDef.x/y`, first gate on a tie), `corridorWidth` tiles wide
/// (every tile whose centre is within half the width of the line segment, in world units). Placeholder: all false.
pub fn tall_corridor(map: &GameMapData, _rules: &Rules) -> Vec<bool> {
    vec![false; map.w as usize * map.h as usize]
}

/// The sites stage 4 uses, in the order it creates them. `dress` must place cluster members around exactly these.
/// Placeholder: none.
pub fn cluster_sites(_map: &GameMapData, _map_hash: u64, _rules: &Rules) -> Vec<ClusterSite> {
    Vec::new()
}
