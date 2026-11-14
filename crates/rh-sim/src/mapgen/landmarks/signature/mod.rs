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
//! Every landmark stands in the site its zone reserved in the Prefix (P-MAPGEN-SIG-RESERVE-1): the volcano, the church,
//! the bog tree and the cave are their approved drawings, read and landed from the per-landmark table (`spec`,
//! `blueprint`, `stamp`); the volcano's three lava streams continue from its outlets (`volcano::streams`,
//! P-MAPGEN-SIG-SCALE-4). Integer geometry only.
pub mod blueprint;
mod bog_tree;
mod cave;
mod church;
pub mod frame;
pub mod spec;
mod volcano;

use crate::content::FactionId;
use crate::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
use crate::mapdata::{
    FeatureJob, FeatureKind, GameMapData, MapFeature, TilePt, TileRect, Zone, ZoneAnchor,
};
use crate::mapgen::attempt::{AttemptFrame, AttemptInputError};
use crate::mapgen::certify::rules::R;
use crate::mapgen::coliseum::{FixedLayout, CX, CY, H, W};
use crate::mapgen::spawns;
use crate::mapgen::terrain_gate;
use crate::mapgen::zones::camps::CampSite;
use crate::rng::{hash_seed, Mulberry32};

use super::recipe_support::DIR16;
use super::stage::LandmarkStage;
use blueprint::{Blueprint, Legality, Orientation, Placement, Target, Write};

/// Every signature tunable (G4's band table included) in one definition. Not folded into `content_hash` while the
/// option is off by default (listed in `tests/content.rs` NON_GAMEPLAY; the owner decides when it is promoted).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    /// The `hash_seed` stream id of the signature draws (0-2 are the stylers', 3 the landmark recipes', 4 the bushes').
    pub stream: u32,
    /// G4: the outer edge, in tiles of Chebyshev distance from the anchor's footprint rectangle, of the core, near and
    /// mid bands (inclusive); beyond the last is far. The core band is also the apron kept clear round the landmark.
    pub bands: [i32; 3],
    /// The terrain codes of the bog (the tree's marsh), the lava (LOW), the ember (floor) and the ice (floor):
    /// documented mirrors of the terrain catalog's codes of the kinds keyed `bog`, `lava`, `ember` and `ice`
    /// (`terrain_gate::DEFAULT_DEFINITION.kinds`; homes Plague, Fire, Fire, Frost), for the readers outside the step (the
    /// stylers, the Plague pools, the tests). The step itself writes and checks the catalog's codes
    /// (`SignatureContext::terrain_codes`, resolved by key when the context is built; a debug build asserts they agree).
    pub bog: u8,
    pub lava: u8,
    pub ember: u8,
    pub ice: u8,
    /// Plague site: the tiles its centre must stand beyond the start of the Plague zone's outer third (slack for later
    /// rezoning; `SignatureContext::reserve`).
    pub outer_slack: f64,
    /// Fire, Sentenced and Frost sites: the tiles a site's centre stands beyond the zone centroid's distance from the map
    /// centre (the back edge, with slack for later rezoning; `SignatureContext::reserve`).
    pub back_slack: f64,
    /// Volcano streams (P-MAPGEN-SIG-SCALE-4: laid from the drawing's outlet runs, `volcano::streams`): the shortest
    /// path tried (tiles), how many heading steps beyond its outlet run's centre the path's first tile lies, how far a
    /// path may bend from its own heading and from the drawing's front (DIR16 steps), the Chebyshev gap kept from every
    /// other stream and pool, and the squared distance from its outlet run within which that gap is not asked.
    pub stream_min: usize,
    pub stream_start: i32,
    pub stream_bend: i32,
    pub front_max: i32,
    pub stream_gap: i32,
    pub start_d2: i32,
    /// Pools: the squared radii tried, largest first.
    pub pool_d2: &'static [i32],
    /// Volcano: the zone's total lava (the cone's crater lake, channels and outlets, the streams and the pools;
    /// inclusive). PROVISIONAL (P-MAPGEN-SIG-SCALE-4): the window round the prototype's measured 221-244; the coordinator
    /// finalises it after measurement on the build.
    pub lava_budget: (usize, usize),
    /// The tiles beyond each entrance tile, along the front, that must be `Site::open` for an entry whose table row says
    /// `doorway` (the church's main gate, the cave's mouth; `stamp`).
    pub doorway: i32,
    /// Frost styler in signature mode: the mere's seed is an allowed tile at most `lake_reach` floor steps from the
    /// cave's mouth; the first of `lake_tries` candidates that grows a lake is kept. It is regrown off the spawn routes
    /// at most `lake_rounds` times. The second lake grows to at most `second_share` percent of the mere's area.
    pub lake_reach: usize,
    pub lake_tries: usize,
    pub lake_rounds: usize,
    pub second_share: usize,
    /// The end-of-attempt check (`SignatureContext::intact`): the Frost zone's largest ice body outside the cave lies
    /// within `lake_reach + lake_slack` floor steps of the cave's mouth, else the map is discarded (P-MAPGEN-SIG-FROST-2).
    pub lake_slack: usize,
    /// P-MAPGEN-SIG-RESERVE-1: the side (tiles) of the square site each styled zone reserves in the Prefix before its
    /// camps (the landmark's target footprint plus the apron, `bands[0]`, on each side), and the depth (tiles) of the
    /// church's or the cave's camp from the site's far edge, on the site's centre line (its halo and the landmark's back
    /// wall stay inside the site's inner rect).
    pub site_side: i32,
    pub site_depth: i32,
    /// P-MAPGEN-SIG-SCALE-1: the Frost cave's approved blueprint (owner decision 2026-11-13; ADR 0028 G9), the text of
    /// `cave.txt` beside this file, a byte-equal copy of `docs/landmarks/blueprints/cave.txt` (the docs are not in the
    /// server image's build context, so the crate carries its own copy). Lines starting `;` are its legend; the rest is
    /// the 29 x 29 grid, front (toward the coliseum) at the bottom. Parsed once per context by `blueprint::Blueprint::parse`
    /// with the table's legend (`spec::specs`); a grid that does not parse refuses every option-on attempt at the cave
    /// (`Refusal::Signature`).
    pub cave_grid: &'static str,
    /// P-MAPGEN-SIG-SCALE-3: the Plague bog tree's approved blueprint (owner decision 2026-11-13; ADR 0028 G9), the text
    /// of `bog.txt` beside this file, a byte-equal copy of `docs/landmarks/blueprints/bog.txt` (the docs are not in the
    /// server image's build context). Lines starting `;` are its legend; the rest is the 29 x 29 grid, front (toward the
    /// coliseum) at the bottom. Parsed as `cave_grid`; a grid that does not parse refuses every option-on attempt at the
    /// tree (`Refusal::Signature`).
    pub bog_grid: &'static str,
    /// P-MAPGEN-SIG-SCALE-2: the Sentenced church's approved blueprint with its graveyard and churchyard (owner decision
    /// 2026-11-13; ADR 0028 G9), the text of `church.txt` beside this file, a byte-equal copy of
    /// `docs/landmarks/blueprints/church.txt` (as `cave_grid`). Lines starting `;` are its legend; the rest is the 29 x 29
    /// grid, front (toward the coliseum) at the bottom. Parsed as `cave_grid`; a grid that does not parse refuses every
    /// option-on attempt at the church (`Refusal::Signature`).
    pub church_grid: &'static str,
    /// P-MAPGEN-SIG-SCALE-4: the Fire volcano's approved blueprint (owner decisions 2026-11-13, requirements L1 and L4,
    /// and 2026-11-14, "22 across"; ADR 0028 G9), the text of `volcano.txt` beside this file, a byte-equal copy of
    /// `docs/landmarks/blueprints/volcano.txt` (as `cave_grid`). Lines starting `;` are its legend; the rest is the 22 x 22
    /// grid, front (toward the coliseum) at the bottom, its six outlet tiles `O` in three runs of two on the front row.
    /// It lands centred in the Fire site's unchanged 30 x 30 inner rect (4 tiles spare on every side).
    /// Parsed as `cave_grid`; a grid that does not parse refuses every option-on attempt at the volcano.
    pub volcano_grid: &'static str,
    /// P-MAPGEN-SIG-SCALE-4: per outlet run of the volcano drawing, in grid order (left, middle, right: ascending `gx`),
    /// the stream's heading as a grid direction (front = `(0, 1)`; turned with the drawing by `Orientation::turn`) and
    /// its path length range in tiles (inclusive; two lava tiles per path tile; measured as the oracle measures it,
    /// `volcano::length`). The owner's numbers (requirement L4; lengths by the owner decision of 2026-11-14): the side
    /// streams 45 degrees off straight ahead, 7-10 tiles; the middle one straight ahead, 10-14, strictly the longest.
    pub outlet_heading: [(i32, i32); 3],
    pub outlet_len: [(i32, i32); 3],
    /// P-MAPGEN-SIG-SCALE-4 (owner decision 2026-11-14): the Fire fan, a rectangle in front of the Fire site's inner
    /// rect (toward the coliseum, along the front axis of the site's centre tile), `fan_depth` tiles deep and as wide
    /// as the inner rect plus `fan_side` tiles on each side, clipped to the map. Camp halos (the Prefix's camp
    /// placement) and the legacy landmark stage's buildings (its protection) keep out of it; the streams and their
    /// pools run in it (`fan`).
    pub fan_depth: i32,
    pub fan_side: i32,
}

pub const DEFAULT_DEFINITION: Definition = Definition {
    stream: 5,
    bands: [2, 6, 14],
    bog: 5,
    lava: 1,
    ember: 4,
    ice: 6,
    outer_slack: 2.0,
    back_slack: 2.0,
    stream_min: 4,
    stream_start: 1,
    stream_bend: 2,
    front_max: 3,
    stream_gap: 3,
    start_d2: 20,
    pool_d2: &[4, 2],
    lava_budget: (200, 270),
    doorway: 2,
    lake_reach: 8,
    lake_tries: 8,
    lake_rounds: 3,
    second_share: 75,
    lake_slack: 2,
    site_side: 34,
    site_depth: 9,
    cave_grid: include_str!("cave.txt"),
    bog_grid: include_str!("bog.txt"),
    church_grid: include_str!("church.txt"),
    volcano_grid: include_str!("volcano.txt"),
    outlet_heading: [(-1, 1), (0, 1), (1, 1)],
    outlet_len: [(7, 10), (10, 14), (7, 10)],
    fan_depth: 14,
    fan_side: 14,
};

/// One zone's reserved landmark site (P-MAPGEN-SIG-RESERVE-1): chosen in the Prefix, after the partition and before
/// the camps, with the option on only (`SignatureContext::reserve`). `rect` is the whole site (the landmark's footprint
/// plus its apron); `camp` is the tile of the camp placed inside it (the church's and the cave's elite camp), `None`
/// for the volcano and the tree. `stream` is the zone's signature stream after the reservation's draws: the Landmarks
/// phase continues it, never re-using a draw. Generator working state only: nothing reads it after the Landmarks phase
/// and it is never exported.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReservedSite {
    pub zone: Zone,
    pub rect: TileRect,
    pub camp: Option<usize>,
    pub stream: Mulberry32,
}

/// The zones that reserve a site, in the order of `AttemptState::reserved` (Holy keeps its hall rule). A function, not a
/// const: `tests/content.rs` reads consts as tunables.
pub fn reserved_zones() -> [Zone; 4] {
    [Zone::Fire, Zone::Sentenced, Zone::Plague, Zone::Frost]
}

/// P-MAPGEN-SIG-SCALE-1: the zones whose reserved site is relabelled to its inside camp's territory (`relabel_sites`):
/// the Sentenced site, round which the blueprint church stands (P-MAPGEN-SIG-SCALE-2), and the Frost site, round which
/// the blueprint cave stands (public so that the church's oracle, `tests/mapgen_signature_church.rs`, can read the list).
pub fn relabelled_zones() -> [Zone; 2] {
    [Zone::Sentenced, Zone::Frost]
}

/// P-MAPGEN-SIG-SCALE-1 (coordinator decision 2026-11-13): before repair runs, no tile of a reserved site with an inside
/// camp belongs to another camp's territory. Every tile of such a site (the whole `rect`, apron included) of a
/// `relabelled_zones` zone takes the inside camp's label, its index in `camps` (the prefix's) + 1. The reservation keeps
/// the other camps' halos out of the site, not their territories: without this the blueprint's walls cut those
/// territories and repair hands the pieces to camps beyond the territory radius (`Repair(RadiusPost)`). Called by the
/// pipeline on repair's copy of the territory grid on option-on attempts only (no sites otherwise: nothing changes). A
/// pure write: no draw. Public so that P-MAPGEN-SIG-SCALE-2's oracle (`tests/mapgen_signature_church.rs`) can call it.
pub fn relabel_sites(reserved: &[ReservedSite], camps: &[CampSite], territory: &mut [u8]) {
    for r in reserved
        .iter()
        .filter(|r| relabelled_zones().contains(&r.zone))
    {
        let Some(inside) = r.camp.and_then(|t| camps.iter().position(|c| c.site == t)) else {
            continue;
        };
        let Ok(label) = u8::try_from(inside + 1) else {
            continue;
        };
        // `place_camps_reserving` keeps every other camp's halo, so its site tile, out of the rect; a camp left inside
        // would lose its own tile's territory here and fail far away (repair's safety nets admission).
        debug_assert!(
            stray_camp(r, camps, inside).is_none(),
            "relabel_sites: camp {:?} (zone {}) lies in the {:?} site {:?} of camp {inside}",
            stray_camp(r, camps, inside),
            stray_camp(r, camps, inside).map_or(0, |k| camps[k].zone),
            r.zone,
            r.rect
        );
        for y in r.rect.y..r.rect.y + r.rect.h as i32 {
            for x in r.rect.x..r.rect.x + r.rect.w as i32 {
                if let Some(i) = at(x, y) {
                    territory[i] = label;
                }
            }
        }
    }
}

/// The first camp other than `inside` (indices into `camps`) whose site tile lies in site `r`'s rect; `None` when there is
/// none, as `place_camps_reserving` guarantees (`relabel_sites`'s precondition).
fn stray_camp(r: &ReservedSite, camps: &[CampSite], inside: usize) -> Option<usize> {
    let (x0, y0) = (r.rect.x, r.rect.y);
    let (x1, y1) = (x0 + r.rect.w as i32, y0 + r.rect.h as i32);
    camps.iter().enumerate().position(|(k, c)| {
        let (x, y) = ((c.site % W) as i32, (c.site / W) as i32);
        k != inside && x >= x0 && x < x1 && y >= y0 && y < y1
    })
}

/// The zone's one-based slot in the attempt's faction order.
fn slot_of(order: &[FactionId], zone: Zone) -> Option<u8> {
    order
        .iter()
        .position(|f| f.as_str() == zone.as_str())
        .map(|s| (s + 1) as u8)
}

/// The front axis of a landmark drawn from the table (`stamp`) and of a reserved site's camp (`inside_camp`): the
/// dominant axis of DIR16 `f` (x on a tie), as a unit vector.
fn axis(f: u8) -> (i32, i32) {
    let v = DIR16[usize::from(f)];
    if v[0].abs() >= v[1].abs() {
        (v[0].signum(), 0)
    } else {
        (0, v[1].signum())
    }
}

/// P-MAPGEN-SIG-SCALE-4 (owner decision 2026-11-14): the Fire fan of reserved site `r`, inclusive (x0, y0, x1, y1)
/// clipped to the map; `None` for a zone other than Fire. It lies in front of the site's inner rect (the site less its
/// apron, `bands[0]`), along the front axis read at the site's centre tile (`front`, then `axis`: the tile and rule of
/// the volcano's anchor, so the fan and the drawing's front row agree), `fan_depth` tiles deep and as wide as the inner
/// rect plus `fan_side` tiles on each side. The Prefix computes it once, with its own definition, and records it
/// (`AttemptState::fans`); its two readers: the Prefix's camp placement keeps every camp's halo out of it (`attempt`),
/// the legacy landmark stage keeps its buildings out of the recorded fan (`stage`). Nothing else is forbidden there:
/// the volcano's streams and pools run in it.
pub fn fan(r: &ReservedSite, d: &Definition) -> Option<(usize, usize, usize, usize)> {
    if r.zone != Zone::Fire {
        return None;
    }
    let b = d.bands[0];
    let (w, h) = (r.rect.w as i32, r.rect.h as i32);
    let (x0, y0, x1, y1) = (
        r.rect.x + b,
        r.rect.y + b,
        r.rect.x + w - 1 - b,
        r.rect.y + h - 1 - b,
    );
    let (depth, side) = (d.fan_depth, d.fan_side);
    let (a0, b0, a1, b1) = match axis(front(r.rect.x + w / 2, r.rect.y + h / 2)) {
        (0, 1) => (x0 - side, y1 + 1, x1 + side, y1 + depth),
        (0, -1) => (x0 - side, y0 - depth, x1 + side, y0 - 1),
        (1, 0) => (x1 + 1, y0 - side, x1 + depth, y1 + side),
        _ => (x0 - depth, y0 - side, x0 - 1, y1 + side),
    };
    let clip = |v: i32, n: usize| v.clamp(0, n as i32 - 1) as usize;
    Some((clip(a0, W), clip(b0, H), clip(a1, W), clip(b1, H)))
}

/// P-MAPGEN-SIG-SCALE-4: whether the certifier's halo of a camp placed inside a reserved site (the church's, the cave's)
/// reaches into the Fire fan. Those camps are fixed with the sites, before camp placement can keep them out of the fan:
/// the Prefix fails the round when one does (the partition and the sites are drawn again).
pub(crate) fn fan_holds_a_site_camp(reserved: &[ReservedSite], d: &Definition) -> bool {
    let Some((x0, y0, x1, y1)) = reserved.iter().find_map(|r| fan(r, d)) else {
        return false;
    };
    let mut halo = vec![0u8; W * H];
    for t in reserved.iter().filter_map(|r| r.camp) {
        mark_halo(&mut halo, t);
    }
    (y0..=y1).any(|y| (x0..=x1).any(|x| halo[y * W + x] != 0))
}

/// The signature landmarks' feature kinds: each zone's landmark and its parts, not the stylers' features (the legacy
/// `LavaRiver`, the craters) nor the legacy landmark recipes' `Landmark`.
pub fn landmark_kind(kind: FeatureKind) -> bool {
    matches!(
        kind,
        FeatureKind::Volcano
            | FeatureKind::LavaStream
            | FeatureKind::LavaPool
            | FeatureKind::Church
            | FeatureKind::Graveyard
            | FeatureKind::BogTree
            | FeatureKind::Cave
    )
}

/// P-MAPGEN-SIG-SCALE-4 (owner decision 2026-11-14): terrain rule T5 (a LOW tile lies within the snap reach of floor)
/// does not count tile `i` of `m` when it is a signature landmark's own lava: LOW, of terrain `lava` (the lava code of
/// the reader's own terrain table), owned (the feature grid) by a `landmark_kind` feature: the volcano's walled-in
/// crater lake. Every other far LOW tile still fails. The one definition the terrain gate and the certifier both read.
/// Option-off maps have no signature feature, so no option-off verdict changes.
pub fn t5_exempt(m: &GameMapData, i: usize, lava: Option<u8>) -> bool {
    m.tiles.get(i) == Some(&TILE_LOW)
        && lava.is_some_and(|lava| m.terrain.get(i) == Some(&lava))
        && m.feature_grid
            .get(i)
            .and_then(|&f| usize::from(f).checked_sub(1))
            .and_then(|k| m.features.get(k))
            .is_some_and(|f| landmark_kind(f.kind))
}

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
    let f = anchor.footprint;
    let (x1, y1) = (f.x + f.w as i32 - 1, f.y + f.h as i32 - 1);
    let d = (f.x - x)
        .max(x - x1)
        .max(0)
        .max((f.y - y).max(y - y1).max(0));
    let b = DEFAULT_DEFINITION.bands;
    if d <= b[0] {
        Band::Core
    } else if d <= b[1] {
        Band::Near
    } else if d <= b[2] {
        Band::Mid
    } else {
        Band::Far
    }
}

/// What the step placed in one attempt: the terrain layer the attempt starts its styler pass from (all zero except the
/// landmarks' own terrain, such as the bog tree's bands) and (P-MAPGEN-LANDMARK-FRAME-1) one `LandmarkFrame` per zone it
/// built, in placement order (`reserved_zones`): the one record of what was placed. The zones' anchors and the drawn
/// landmarks' landings are read through `Placed::anchors()` and `Placed::landed()`.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub terrain: Vec<u8>,
    pub frames: Vec<frame::LandmarkFrame>,
}

/// P-MAPGEN-SIG-BLUEPRINT-1: one landmark placed from its drawing: the zone, the landing (orientation, origin, box) and
/// every mark of its legend (ascending by character) with the map tiles it landed on, row-major. Generator working
/// state, derived from the frames (`Placed::landed()`); never exported.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Landed {
    pub zone: Zone,
    pub landing: blueprint::Landing,
    pub marks: Vec<(u8, Vec<TilePt>)>,
}

/// P-MAPGEN-SIG-BLUEPRINT-2: the terrain codes (indices into the terrain catalog, `terrain_gate::DEFAULT_DEFINITION.kinds`)
/// of the catalog kinds `bog`, `lava`, `ember` and `ice`, as the context uses them (`SignatureContext::terrain_codes`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerrainCodes {
    pub bog: u8,
    pub lava: u8,
    pub ember: u8,
    pub ice: u8,
}

/// The terrain catalog's codes of the kinds keyed `bog`, `lava`, `ember` and `ice` (each its index in
/// `terrain_gate::DEFAULT_DEFINITION.kinds`). Panics when the catalog lacks one: the step cannot run without them.
pub(crate) fn catalog_codes() -> TerrainCodes {
    let code = |key: &str| {
        let k = terrain_gate::DEFAULT_DEFINITION
            .kinds
            .iter()
            .position(|k| k.key == key)
            .unwrap_or_else(|| panic!("signature: no terrain kind {key:?} in the catalog"));
        u8::try_from(k).expect("signature: terrain code")
    };
    TerrainCodes {
        bog: code("bog"),
        lava: code("lava"),
        ember: code("ember"),
        ice: code("ice"),
    }
}

/// What `intact` accepts on a tile owned by a feature of one member kind: (tile, terrain), `None` terrain for any.
type Owned = Vec<(u8, Option<u8>)>;

/// What `intact` accepts on an entrance tile of one drawn landmark: exactly what the glyph of its entrance writes there
/// (one glyph write per entry, `SignatureContext::from_definition`). `write`: the (tile, terrain) written, `None` for a
/// glyph that writes nothing (floor, any terrain, as before P-MAPGEN-SIG-SCALE-4). `owner`: the feature kind that owns
/// the tile (a feature of the landmark's zone), `None` for a glyph no feature owns (no feature of the landmark may own
/// it; any other owner is judged as before, by the apron rule).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Door {
    write: Option<(u8, u8)>,
    owner: Option<FeatureKind>,
}

/// Immutable per-pipeline context, reused by every attempt.
pub struct SignatureContext<'f> {
    _fixed: core::marker::PhantomData<&'f FixedLayout>,
    rules: Definition,
    /// The catalog's terrain codes (`catalog_codes`), resolved once.
    codes: TerrainCodes,
    /// Tiles no landmark wall may take: the border, the coliseum, its road (with the legacy landmark margin) and lanes.
    hard: Vec<u8>,
    /// P-MAPGEN-SIG-BLUEPRINT-1: the per-landmark table (`spec::specs`), each entry with its drawing parsed once; `None`
    /// for an entry without a drawing or with one that does not parse (which refuses every option-on attempt at that
    /// landmark, after its mirror draw: `Refusal::Signature`).
    landmarks: Vec<(spec::Spec, Option<Blueprint>)>,
    /// P-MAPGEN-SIG-BLUEPRINT-2: per member kind of the table, what `intact` accepts on the tiles its features own: for a
    /// drawing, the (tile, terrain) its legend's glyphs of that kind write (any terrain for the entry's `any_terrain`
    /// kinds); for the volcano's streams and pools, which no drawing writes, `volcano::owned`.
    owned: Vec<(FeatureKind, Owned)>,
    /// Per table entry whose drawing has an entrance, by zone: what `intact` accepts on its entrance tiles (`Door`).
    doors: Vec<(Zone, Door)>,
}

impl<'f> SignatureContext<'f> {
    pub fn new(fixed: &'f FixedLayout) -> Self {
        Self::from_definition(fixed, &DEFAULT_DEFINITION)
    }

    pub fn from_definition(fixed: &'f FixedLayout, d: &Definition) -> Self {
        let sd = spawns::DEFAULT_DEFINITION;
        let road = u16::from(crate::mapgen::coliseum::default_definition().ring_road)
            + u16::from(sd.landmark_road_margin);
        let mut hard: Vec<u8> = (0..W * H)
            .map(|i| {
                u8::from(
                    fixed.border[i] != 0
                        || fixed.fp[i] != 0
                        || fixed.lane_in[i] != 0
                        || u16::from(fixed.dist_fp[i]) <= road,
                )
            })
            .collect();
        for t in &fixed.lane_out {
            let m = sd.landmark_lane_margin;
            for y in t.y - m..=t.y + m {
                for x in t.x - m..=t.x + m {
                    if let Some(i) = at(x, y) {
                        hard[i] = 1;
                    }
                }
            }
        }
        let codes = catalog_codes();
        debug_assert_eq!(
            codes,
            TerrainCodes {
                bog: d.bog,
                lava: d.lava,
                ember: d.ember,
                ice: d.ice,
            },
            "signature: the definition's terrain codes are not the catalog's"
        );
        let table = spec::specs(d);
        let mut owned: Vec<(FeatureKind, Owned)> = volcano::owned(&codes);
        for s in table.iter().filter(|s| s.drawing.is_some()) {
            for g in &s.legend.0 {
                let (Some(kind), Some((tile, terrain))) = (g.feature, written(g.write)) else {
                    continue;
                };
                let pair = (tile, (!s.any_terrain.contains(&kind)).then_some(terrain));
                match owned.iter_mut().find(|(k, _)| *k == kind) {
                    Some((_, pairs)) if !pairs.contains(&pair) => pairs.push(pair),
                    Some(_) => {}
                    None => owned.push((kind, vec![pair])),
                }
            }
        }
        // A member kind without a rule would pass `intact`'s owned-tile check whatever its tiles hold.
        debug_assert!(
            table
                .iter()
                .flat_map(|s| &s.members)
                .all(|m| owned.iter().any(|(k, _)| k == m)),
            "signature: a member kind with no owned-tile rule"
        );
        let landmarks: Vec<(spec::Spec, Option<Blueprint>)> = table
            .into_iter()
            .map(|s| {
                let drawing = s.drawing.and_then(|t| Blueprint::parse(t, &s.legend).ok());
                (s, drawing)
            })
            .collect();
        // A frame records marks by their tiles (`LandmarkFrame::marks`): a legend mark no tile of its drawing carries
        // would drop out of `Placed::landed()`.
        debug_assert!(
            landmarks
                .iter()
                .filter_map(|(_, bp)| bp.as_ref())
                .all(|bp| bp.marks().iter().all(|(_, gs)| !gs.is_empty())),
            "signature: a legend mark with no tile in its drawing"
        );
        // The entrance tiles' glyph writes, read from each drawing's legend: the volcano's outlets `O` (LOW lava, owned
        // by the volcano); the church's gate, the tree's causeways and the cave's mouth write nothing. An anchor's
        // entrance is sorted by map tile, which loses the glyph of each tile: an entry's entrance glyphs must all write
        // one thing.
        let doors: Vec<(Zone, Door)> = landmarks
            .iter()
            .filter_map(|(s, bp)| {
                let bp = bp.as_ref()?;
                let writes: Vec<Door> = bp
                    .entrance(s.entrance)
                    .into_iter()
                    .filter_map(|g| bp.char_at(g).and_then(|ch| bp.legend().glyph(ch)))
                    .map(|g| Door {
                        write: written(g.write),
                        owner: g.feature,
                    })
                    .collect();
                let first = *writes.first()?;
                debug_assert!(
                    writes.iter().all(|w| *w == first),
                    "signature: the {:?} entrance's glyphs write different things",
                    s.zone
                );
                Some((s.zone, first))
            })
            .collect();
        Self {
            _fixed: core::marker::PhantomData,
            rules: *d,
            codes,
            hard,
            landmarks,
            owned,
            doors,
        }
    }

    pub fn definition(&self) -> &Definition {
        &self.rules
    }

    /// P-MAPGEN-SIG-BLUEPRINT-2 (review finding 6): the terrain codes this context writes and checks for the bog, the
    /// lava, the ember and the ice: the terrain catalog's (`catalog_codes`), looked up by key when the context is built.
    pub fn terrain_codes(&self) -> TerrainCodes {
        self.codes
    }

    /// The index of the table entry whose member kinds hold `k` (`spec::Spec::members`), `None` for a kind that is no
    /// signature landmark's.
    fn entry_of(&self, k: FeatureKind) -> Option<usize> {
        self.landmarks
            .iter()
            .position(|(s, _)| s.members.contains(&k))
    }

    /// Whether `k` is a member kind of a signature landmark.
    fn is_signature(&self, k: FeatureKind) -> bool {
        self.entry_of(k).is_some()
    }

    /// Whether `k`'s apron and keep mask follow its own tiles rather than its box (`spec::Spec::by_tile`: the lava
    /// streams and pools).
    fn by_tile(&self, k: FeatureKind) -> bool {
        self.landmarks.iter().any(|(s, _)| s.by_tile.contains(&k))
    }

    /// P-MAPGEN-SIG-RESERVE-1: each reserving zone's signature stream, `hash_seed(seed, attempt, zone slot, stream)`, in
    /// `reserved_zones` order: the streams the Landmarks phase draws from, begun in the Prefix.
    pub(crate) fn streams(
        &self,
        seed: i64,
        attempt: u64,
        order: &[FactionId],
    ) -> Option<Vec<Mulberry32>> {
        reserved_zones()
            .iter()
            .map(|&z| {
                slot_of(order, z).map(|slot| {
                    Mulberry32::new(hash_seed(
                        seed as u32,
                        attempt as u32,
                        u32::from(slot),
                        self.rules.stream,
                    ))
                })
            })
            .collect()
    }

    /// P-MAPGEN-SIG-RESERVE-1: one prefix round's sites, in `reserved_zones` order, on the round's partition `zone`. A
    /// zone's candidates are the `site_side` squares wholly of its tiles, off `hard` (border, coliseum, road, lanes) and
    /// off the open map corners, whose centre point lies beyond the zone's line: Fire, Sentenced and Frost the zone
    /// centroid's distance from the map centre plus `back_slack`, Plague the start of its outer third plus
    /// `outer_slack`. A Sentenced or Frost square also needs its camp tile (`inside_camp`). One uniform draw among the
    /// candidates, the zone's one draw of the round on its stream; without a candidate, Plague takes the deepest square
    /// still beyond its centroid (largest centre distance, first in row order), drawing nothing. `None` when a zone has
    /// no square: the round fails as a camp failure does. Draws only from `streams` (`reserved_zones` order).
    pub(crate) fn reserve(
        &self,
        zone: &[u8],
        order: &[FactionId],
        streams: &mut [Mulberry32],
    ) -> Option<Vec<ReservedSite>> {
        let d = &self.rules;
        let side = usize::try_from(d.site_side)
            .ok()
            .filter(|&s| s > 0 && s <= W.min(H))?;
        let co = spawns::DEFAULT_DEFINITION.corner_open;
        let corner = |x: usize, y: usize| x.min(W - 1 - x) <= co && y.min(H - 1 - y) <= co;
        let from_centre = |x: f64, y: f64| {
            let (dx, dy) = (x - W as f64 / 2.0, y - H as f64 / 2.0);
            crate::math::sqrt(dx * dx + dy * dy)
        };
        let half = side as f64 / 2.0;
        // Summed-area table of the tiles a site may not hold.
        let stride = W + 1;
        let mut bad = vec![0i32; stride * (H + 1)];
        let mut out = Vec::with_capacity(reserved_zones().len());
        for (k, &z) in reserved_zones().iter().enumerate() {
            let slot = slot_of(order, z)?;
            let (mut sx, mut sy, mut n) = (0i64, 0i64, 0i64);
            let (mut lo, mut hi) = (f64::MAX, 0.0f64);
            for y in 0..H {
                for x in 0..W {
                    let i = y * W + x;
                    let no = zone[i] != slot || self.hard[i] != 0 || corner(x, y);
                    bad[(y + 1) * stride + x + 1] =
                        i32::from(no) + bad[y * stride + x + 1] + bad[(y + 1) * stride + x]
                            - bad[y * stride + x];
                    if zone[i] == slot {
                        sx += 2 * x as i64 + 1;
                        sy += 2 * y as i64 + 1;
                        n += 1;
                        let r = from_centre(x as f64 + 0.5, y as f64 + 0.5);
                        lo = lo.min(r);
                        hi = hi.max(r);
                    }
                }
            }
            if n == 0 {
                return None;
            }
            let centroid = from_centre(sx as f64 / (2 * n) as f64, sy as f64 / (2 * n) as f64);
            let line = if z == Zone::Plague {
                lo + (hi - lo) * 2.0 / 3.0 + d.outer_slack
            } else {
                centroid + d.back_slack
            };
            let camp_zone = matches!(z, Zone::Sentenced | Zone::Frost);
            let mut candidates = Vec::new();
            let mut deepest: Option<(f64, usize, usize)> = None;
            for y in 0..=H - side {
                for x in 0..=W - side {
                    let held = bad[(y + side) * stride + x + side] + bad[y * stride + x]
                        - bad[y * stride + x + side]
                        - bad[(y + side) * stride + x];
                    if held != 0 {
                        continue;
                    }
                    let camp = if camp_zone {
                        match self.inside_camp(x as i32, y as i32) {
                            Some(c) => Some(c),
                            None => continue,
                        }
                    } else {
                        None
                    };
                    let r = from_centre(x as f64 + half, y as f64 + half);
                    if r > line {
                        candidates.push((x, y, camp));
                    } else if z == Zone::Plague
                        && r >= centroid
                        && deepest.is_none_or(|(best, _, _)| r > best)
                    {
                        deepest = Some((r, x, y));
                    }
                }
            }
            let rng = &mut streams[k];
            let (x, y, camp) = if candidates.is_empty() {
                let (_, x, y) = deepest?;
                (x, y, None)
            } else {
                candidates[pick(rng, candidates.len())]
            };
            out.push(ReservedSite {
                zone: z,
                rect: TileRect {
                    x: x as i32,
                    y: y as i32,
                    w: side as u32,
                    h: side as u32,
                },
                camp,
                stream: rng.clone(),
            });
        }
        Some(out)
    }

    /// The camp tile of the church's or the cave's site with top-left (x, y): on the site's centre line along the door
    /// axis (`axis` of DIR16 from the site's centre tile toward the coliseum), `site_depth` tiles from the far edge.
    /// Offsets from (x, y) at side 34 and depth 9: (9, 17) with the coliseum toward +x, (24, 17) toward -x, (17, 9)
    /// toward +y, (17, 24) toward -y.
    ///
    /// `None` when the camp tile's own door axis (the church's and the cave's rule) differs. A guard only, not a filter
    /// on where sites go: the camp moves deeper along the axis that already dominates, which cannot turn it, and at these
    /// numbers it refuses none of the 16,129 square positions on the 160x160 map (P-MAPGEN-SIG-RESERVE-1 review).
    fn inside_camp(&self, x: i32, y: i32) -> Option<usize> {
        let (side, depth) = (self.rules.site_side, self.rules.site_depth);
        let (mx, my) = (x + side / 2, y + side / 2);
        let u = axis(front(mx, my));
        let along = |lo: i32, sign: i32| {
            if sign > 0 {
                lo + depth
            } else {
                lo + side - 1 - depth
            }
        };
        let (tx, ty) = if u.0 != 0 {
            (along(x, u.0), my)
        } else {
            (mx, along(y, u.1))
        };
        if axis(front(tx, ty)) != u {
            return None;
        }
        at(tx, ty)
    }

    /// Places each zone's signature landmark (Fire: the volcano with its streams and pools; Sentenced: the church and its
    /// graveyard; Plague: the bog tree; Frost: the cave) into the stage's layers and masks, in that order (`place`). Each
    /// zone's table entry (`spec::specs`) is drawn by the generic `stamp`, and its landing is recorded in
    /// `Placed::landed`; the volcano's streams continue from its outlets (`volcano::streams`). Only the volcano and the
    /// bog tree keep their tiles out of the aprons marked before them (`Site::ground`: their legends'
    /// `Legality::WallGround`, and the streams' own test); the church and the
    /// cave place their walls on any free wall tile (`Site::wall`). The rule that no landmark lies in another's apron is
    /// the end-of-attempt discard (`intact`). `Ok(None)` refuses the attempt (G5: a zone that cannot hold its landmark is
    /// never built without it; the pipeline tries the next attempt), and so does a prefix without a zone's reserved site
    /// (`begin_attempt`'s, the option-off prefix): every landmark is built inside its site.
    pub fn apply(
        &self,
        frame: &AttemptFrame,
        stage: &mut LandmarkStage,
    ) -> Result<Option<Placed>, AttemptInputError> {
        let halo = camp_halo(frame);
        let mut terrain = vec![0u8; W * H];
        let mut frames = Vec::with_capacity(reserved_zones().len());
        for zone in reserved_zones() {
            let Some(f) = self.place(frame, stage, &halo, &mut terrain, zone) else {
                return Ok(None);
            };
            frames.push(f);
        }
        Ok(Some(Placed { terrain, frames }))
    }

    /// P-MAPGEN-SIG-BLUEPRINT-2 (review finding 5): `apply` for the one landmark of `zone` alone, as if the zones placed
    /// before it in `apply` had placed nothing: the same site, stream, draws and checks (`place`), its features written
    /// into `stage`, and a `Placed` holding only its terrain and its frame (built as `apply` builds it). A test seam: what
    /// each landmark's own oracle pins without depending on the others. `Ok(None)` where `apply` would refuse at this
    /// zone, and for a zone that reserves no site (Holy).
    pub fn apply_only(
        &self,
        frame: &AttemptFrame,
        stage: &mut LandmarkStage,
        zone: Zone,
    ) -> Result<Option<Placed>, AttemptInputError> {
        if !reserved_zones().contains(&zone) {
            return Ok(None);
        }
        let halo = camp_halo(frame);
        let mut terrain = vec![0u8; W * H];
        Ok(self
            .place(frame, stage, &halo, &mut terrain, zone)
            .map(|f| Placed {
                terrain,
                frames: vec![f],
            }))
    }

    /// One zone's landmark in its reserved site, continuing the zone's signature stream the Prefix began there
    /// (P-MAPGEN-SIG-RESERVE-1): drawn from its table entry by `stamp` (one draw, the mirror), for the volcano then its
    /// three streams and pools laid from its outlet runs (`volcano::streams`: one draw per run, in grid order) before
    /// anything is written; its features written into `stage` and their terrain into `terrain`. Its frame (P-MAPGEN-
    /// LANDMARK-FRAME-1): the anchor, the landing and the landed marks, each written feature's kind and box
    /// in write order, and every written tile ascending (the last writer's tile and terrain where pieces overlap, as the
    /// layers hold them); `None` refuses (no slot, no reserved site, or the site cannot hold the landmark). `halo` is
    /// every prefix camp's certifier halo (`camp_halo`).
    fn place(
        &self,
        frame: &AttemptFrame,
        stage: &mut LandmarkStage,
        halo: &[u8],
        terrain: &mut [u8],
        zone: Zone,
    ) -> Option<frame::LandmarkFrame> {
        let prefix = &frame.state;
        let slot = slot_of(&prefix.order, zone)?;
        let r = prefix.reserved.iter().find(|r| r.zone == zone)?;
        let (spec, drawing) = self.landmarks.iter().find(|(s, _)| s.zone == zone)?;
        let mut rng = r.stream.clone();
        // The reserved site less its apron.
        let b = self.rules.bands[0];
        let inner = TileRect {
            x: r.rect.x + b,
            y: r.rect.y + b,
            w: r.rect.w.saturating_sub(2 * b as u32),
            h: r.rect.h.saturating_sub(2 * b as u32),
        };
        let corners = (
            inner.x,
            inner.y,
            inner.x + inner.w as i32 - 1,
            inner.y + inner.h as i32 - 1,
        );
        let site = Site {
            ctx: self,
            zone: &prefix.partition.zone,
            slot,
            tiles: &stage.state.tiles,
            owner: &stage.state.feature_owner,
            protect: &stage.protect,
            apron: &stage.masks.near1,
            halo,
            inner: Some(corners),
        };
        let target = Target {
            inner,
            camp: r.camp.map(|t| ((t % W) as i32, (t / W) as i32)),
        };
        let (mut built, landing, marks) = stamp(&site, &mut rng, spec, drawing.as_ref(), &target)?;
        if zone == Zone::Fire {
            // P-MAPGEN-SIG-SCALE-4: the three streams continue from the cone's outlet runs, before anything is written
            // (after the write, `near1` holds the cone's own apron). They leave the site: their `Site` is unconfined.
            let open = Site {
                inner: None,
                ..site
            };
            let bp = drawing.as_ref()?;
            volcano::streams(&open, &mut rng, bp, spec, &landing, &mut built)?;
        }
        let landing = Some(landing);
        let mut features = Vec::with_capacity(built.pieces.len());
        let mut wrote: Vec<(u32, u8, u8)> = Vec::new();
        for piece in &built.pieces {
            features.push((piece.kind, self.write(stage, terrain, zone, piece)));
            wrote.extend(piece.cells.iter().map(|&(i, t, k)| (i as u32, t, k)));
        }
        // Ascending by tile, one entry per tile: the stable sort keeps write order among a tile's entries, and the last
        // one (the layers' value) replaces the earlier.
        wrote.sort_by_key(|c| c.0);
        let mut cells: Vec<(u32, u8, u8)> = Vec::with_capacity(wrote.len());
        for c in wrote {
            match cells.last_mut() {
                Some(last) if last.0 == c.0 => *last = c,
                _ => cells.push(c),
            }
        }
        Some(frame::LandmarkFrame {
            anchor: built.anchor,
            landing,
            marks,
            features,
            cells,
        })
    }

    /// Writes piece `p` of zone `zone`'s landmark into the stage (tiles, owners, masks, the feature) and its terrain
    /// into `terrain`; the written feature's box.
    fn write(
        &self,
        stage: &mut LandmarkStage,
        terrain: &mut [u8],
        zone: Zone,
        p: &Piece,
    ) -> TileRect {
        let id = u16::try_from(stage.state.features.len() + 1).expect("feature id");
        let bbox = bounds(p.cells.iter().map(|c| c.0));
        for &(i, tile, kind) in &p.cells {
            stage.state.tiles[i] = tile;
            terrain[i] = kind;
            stage.state.feature_owner[i] = id;
        }
        let b = self.rules.bands[0];
        if self.by_tile(p.kind) {
            // A stream's or pool's box is a long diagonal: its apron and keep mask follow its own tiles.
            for &(i, _, _) in &p.cells {
                stage.masks.boxes[i] = 1;
                let (cx, cy) = ((i % W) as i32, (i / W) as i32);
                for y in cy - b..=cy + b {
                    for x in cx - b..=cx + b {
                        if let Some(j) = at(x, y) {
                            stage.masks.near1[j] = 1;
                        }
                    }
                }
            }
        } else {
            let (x1, y1) = (bbox.x + bbox.w as i32 - 1, bbox.y + bbox.h as i32 - 1);
            for y in bbox.y - b..=y1 + b {
                for x in bbox.x - b..=x1 + b {
                    if let Some(i) = at(x, y) {
                        stage.masks.near1[i] = 1;
                        if x >= bbox.x && x <= x1 && y >= bbox.y && y <= y1 {
                            stage.masks.boxes[i] = 1;
                        }
                    }
                }
            }
        }
        stage.state.features.push(MapFeature {
            kind: p.kind,
            variant: String::new(),
            zone,
            jobs: vec![p.job],
            ax: p.anchor.0,
            ay: p.anchor.1,
            p: Vec::new(),
            bbox,
            tiles: p.cells.len() as u32,
        });
        bbox
    }

    /// Writes the finished map's anchors (G3): each frame's anchor as the Landmarks phase placed it (P-MAPGEN-LANDMARK-
    /// FRAME-1: no footprint is re-read from the finished features; records keep every landmark feature's box), plus
    /// the Holy hall's (the largest `Hall` feature, placed by the Holy styler, until P-MAPGEN-SIG-HOLY-1 gives the hall a
    /// frame), in zone-code order.
    pub fn finish(&self, map: &mut GameMapData, frames: &[frame::LandmarkFrame]) {
        let mut out: Vec<ZoneAnchor> = frames.iter().map(|f| f.anchor.clone()).collect();
        let hall = map
            .features
            .iter()
            .enumerate()
            .filter(|(_, f)| f.kind == FeatureKind::Hall && f.zone == Zone::Holy)
            .max_by_key(|&(k, f)| (f.tiles, core::cmp::Reverse(k)));
        if let Some((_, f)) = hall {
            out.push(ZoneAnchor {
                zone: Zone::Holy,
                kind: FeatureKind::Hall,
                centre: TilePt { x: f.ax, y: f.ay },
                footprint: f.bbox,
                front: front(f.ax, f.ay),
                entrance: Vec::new(),
            });
        }
        out.sort_by_key(|a| a.zone.code());
        map.anchors = out;
    }

    /// The finished map still holds every signature landmark as it was placed (G5: later steps may have taken nothing
    /// of it): every tile a member feature owns lies in the feature's zone and holds what the table writes there
    /// (`owned`: the legend's walls, LOW and floor with their terrain; the streams' and pools' list, `volcano::owned`),
    /// every entrance tile holds exactly what its drawing wrote there (`doors_intact`: the volcano's outlets LOW lava owned
    /// by the volcano, the other entrances floor no feature of their landmark owns); no styler feature in an apron; no
    /// landmark's tiles in another landmark's apron, either way round
    /// (`aprons_apart`). A pure predicate: it draws nothing and changes nothing. The stylers' own end-of-attempt rules
    /// (the Frost lake, the Plague pools) are not judged here: the pipeline runs them after this and the certifier
    /// (`style_zones::guarantees`, P-MAPGEN-GUARANTEES-1).
    pub fn intact(&self, map: &GameMapData) -> bool {
        let rules: Vec<Option<&Owned>> = map
            .features
            .iter()
            .map(|f| {
                self.owned
                    .iter()
                    .find(|(kind, _)| *kind == f.kind)
                    .map(|(_, pairs)| pairs)
            })
            .collect();
        let owned_ok = (0..map.feature_grid.len()).all(|i| {
            let id = usize::from(map.feature_grid[i]);
            let Some(k) = id.checked_sub(1).filter(|&k| k < map.features.len()) else {
                return true;
            };
            let Some(pairs) = rules[k] else {
                return true;
            };
            let (t, terrain) = (map.tiles[i], map.terrain[i]);
            map.region_grid[i] == map.features[k].zone.code()
                && pairs
                    .iter()
                    .any(|&(tile, want)| tile == t && want.is_none_or(|w| w == terrain))
        });
        let door_ok = self.doors_intact(map);
        // Styler floor claims (`style_runtime` transactions) do not read `no_block`: a styler feature owning a tile of
        // a landmark's apron discards the map (G1: steps 3 and 4 build around the landmark, never into it).
        let b = self.rules.bands[0];
        let mut apron = vec![false; map.feature_grid.len()];
        let mut mark = |x0: i32, y0: i32, x1: i32, y1: i32| {
            for y in y0..=y1 {
                for x in x0..=x1 {
                    if let Some(i) = at(x, y) {
                        apron[i] = true;
                    }
                }
            }
        };
        let signature: Vec<bool> = map
            .features
            .iter()
            .map(|f| self.is_signature(f.kind))
            .collect();
        for (k, f) in map.features.iter().enumerate() {
            if !signature[k] {
                continue;
            }
            if self.by_tile(f.kind) {
                for i in (0..map.feature_grid.len())
                    .filter(|&i| usize::from(map.feature_grid[i]) == k + 1)
                {
                    let (x, y) = ((i % W) as i32, (i / W) as i32);
                    mark(x - b, y - b, x + b, y + b);
                }
            } else {
                let (x1, y1) = (
                    f.bbox.x + f.bbox.w as i32 - 1,
                    f.bbox.y + f.bbox.h as i32 - 1,
                );
                mark(f.bbox.x - b, f.bbox.y - b, x1 + b, y1 + b);
            }
        }
        let apron_ok = (0..apron.len()).filter(|&i| apron[i]).all(|i| {
            usize::from(map.feature_grid[i])
                .checked_sub(1)
                .and_then(|k| map.features.get(k).map(|g| (k, g)))
                .is_none_or(|(k, g)| {
                    signature[k]
                        || matches!(
                            g.kind,
                            FeatureKind::Landmark | FeatureKind::Infill | FeatureKind::Bush
                        )
                })
        });
        owned_ok && door_ok && apron_ok && self.aprons_apart(map)
    }

    /// `intact`'s entrance check: every entrance tile of every anchor holds exactly what its landmark's drawing wrote
    /// there (`Door`, from the entry's legend): the volcano's outlets LOW with the lava terrain, owned by a volcano
    /// feature of the anchor's zone; the church's gate, the tree's causeways and the cave's mouth floor that no feature
    /// of their landmark owns. An anchor without a drawn entrance (the Holy hall's, which is empty) keeps the rule from
    /// before P-MAPGEN-SIG-SCALE-4: floor.
    fn doors_intact(&self, map: &GameMapData) -> bool {
        map.anchors.iter().all(|a| {
            let members = self
                .landmarks
                .iter()
                .find(|(s, _)| s.zone == a.zone)
                .map(|(s, _)| &s.members[..])
                .unwrap_or(&[]);
            let door = self
                .doors
                .iter()
                .find(|(z, _)| *z == a.zone)
                .map(|&(_, d)| d);
            a.entrance.iter().all(|p| {
                at(p.x, p.y).is_some_and(|i| {
                    let Some(d) = door else {
                        return map.tiles[i] == TILE_FLOOR;
                    };
                    let owner = usize::from(map.feature_grid[i])
                        .checked_sub(1)
                        .and_then(|k| map.features.get(k));
                    let holds = match d.write {
                        Some((tile, terrain)) => map.tiles[i] == tile && map.terrain[i] == terrain,
                        None => map.tiles[i] == TILE_FLOOR,
                    };
                    let owned = match d.owner {
                        Some(kind) => owner.is_some_and(|f| f.kind == kind && f.zone == a.zone),
                        None => owner.is_none_or(|f| !members.contains(&f.kind)),
                    };
                    holds && owned
                })
            })
        })
    }

    /// G1, G5 (P-MAPGEN-SIG-FROST-2): no tile of one landmark lies in another landmark's apron, for every ordered pair
    /// of the five. At placement only the volcano and the bog tree keep out of the aprons marked before them
    /// (`Site::ground`); the church and the cave read no apron (`Site::wall` only), and no landmark keeps the earlier
    /// ones out of its own apron. This check is the rule for all five, and symmetric, so the placement order decides
    /// nothing. The landmarks: each table entry's member features (`spec::Spec::members`: the volcano with its streams
    /// and pools, whose by-tile aprons this check skips, so its apron is the cone's box; the church with its graveyard;
    /// the bog tree; the cave), and the Holy hall (the Holy `Hall` on the Holy anchor's footprint). An apron is each of
    /// the landmark's boxes grown by the core band.
    fn aprons_apart(&self, map: &GameMapData) -> bool {
        let holy = map
            .anchors
            .iter()
            .find(|a| a.zone == Zone::Holy)
            .map(|a| a.footprint);
        let hall = holy.and_then(|fp| {
            map.features
                .iter()
                .position(|f| f.kind == FeatureKind::Hall && f.zone == Zone::Holy && f.bbox == fp)
        });
        // Each feature's landmark: its table entry (`spec::Spec::members`), the hall one past the table's last.
        let landmark: Vec<Option<usize>> = map
            .features
            .iter()
            .enumerate()
            .map(|(k, f)| {
                self.entry_of(f.kind)
                    .or_else(|| (hall == Some(k)).then_some(self.landmarks.len()))
            })
            .collect();
        let b = self.rules.bands[0];
        map.features.iter().enumerate().all(|(k, f)| {
            let Some(host) = landmark[k] else {
                return true;
            };
            if self.by_tile(f.kind) {
                return true;
            }
            let (x1, y1) = (
                f.bbox.x + f.bbox.w as i32 - 1,
                f.bbox.y + f.bbox.h as i32 - 1,
            );
            (f.bbox.y - b..=y1 + b).all(|y| {
                (f.bbox.x - b..=x1 + b).all(|x| {
                    at(x, y)
                        .and_then(|i| usize::from(map.feature_grid[i]).checked_sub(1))
                        .and_then(|g| landmark.get(g).copied().flatten())
                        .is_none_or(|guest| guest == host)
                })
            })
        })
    }
}

/// The (tile, terrain) a glyph's write leaves on its map tile; `None` for `Write::Nothing`.
fn written(w: Write) -> Option<(u8, u8)> {
    match w {
        Write::Nothing => None,
        Write::Wall => Some((TILE_WALL, 0)),
        Write::Low(k) => Some((TILE_LOW, k)),
        Write::Floor(k) => Some((TILE_FLOOR, k)),
    }
}

/// Every prefix camp's certifier halo (`mark_halo`): the tiles no landmark wall may take.
fn camp_halo(frame: &AttemptFrame) -> Vec<u8> {
    let mut halo = vec![0u8; W * H];
    for c in &frame.state.layout.camps {
        mark_halo(&mut halo, c.site);
    }
    halo
}

/// P-MAPGEN-SIG-BLUEPRINT-1: one landmark drawn from its table entry `spec` and its parsed drawing in the zone's
/// reserved site `target`, with the landing it used and every mark tile of its legend in grid order (by character, then
/// the drawing's row-major order) on the map tile it landed on; `None` refuses the attempt (G5: the drawing is never served
/// smaller). In order, each step as the cave's, the church's and the tree's own code did before this packet:
/// 1. the zone's one draw on its signature stream, `pick(rng, 2) == 1` = mirrored, before anything can refuse;
/// 2. a drawing that did not parse refuses;
/// 3. the centre `t` is the camp tile (`Placement::Pin`) or the inner rect's centre tile (`Placement::Centre`); the
///    front row faces `axis(front(t))`; the drawing lands by the entry's placement rule (`Blueprint::land`);
/// 4. every tile passes its glyph's legality class;
/// 5. where the entry says `doorway`, the `Definition::doorway` tiles beyond each entrance tile, along the front, are
///    `Site::open`;
/// 6. the wall tiles form no 8-connected piece under `R.piece_min`, and the walls with the LOW tiles do not split the
///    zone's floor;
/// 7. each feature of the entry, in its order, owns the tiles its glyphs write, sorted by tile index.
///
/// The anchor: centre `t`, footprint the landing's box, front `front(t)`, entrance the entry's entrance rule landed,
/// row-major (by y, then x) without repeats. The volcano's centre is the site's centre tile: one of the drawing's four
/// middle crater-lake tiles (10|11, 10|11) of the 22 x 22 drawing centred in the 30 x 30 inner rect, which one depending
/// on the orientation, so `front == front(centre)` holds for it as for every anchor (P-MAPGEN-SIG-SCALE-4);
/// `FeatureAnchor::EntranceMiddle` reads the landed entrance in the drawing's grid order (index `len / 2`), as before the
/// sort. Pure but for the one draw.
fn stamp(
    s: &Site<'_>,
    rng: &mut Mulberry32,
    spec: &spec::Spec,
    drawing: Option<&Blueprint>,
    target: &Target,
) -> Option<(Built, blueprint::Landing, Vec<frame::Mark>)> {
    let mirrored = pick(rng, 2) == 1;
    let bp = drawing?;
    let t = match spec.placement {
        Placement::Pin(_) => target.camp?,
        Placement::Centre => (
            target.inner.x + target.inner.w as i32 / 2,
            target.inner.y + target.inner.h as i32 / 2,
        ),
    };
    let f = front(t.0, t.1);
    let u = axis(f);
    let landing = bp.land(spec.placement, Orientation { front: u, mirrored }, target)?;
    let legal = |l: Legality, (x, y): (i32, i32)| match l {
        Legality::Wall => s.wall(x, y),
        Legality::WallGround => s.wall(x, y) && s.ground(x, y),
        Legality::Floor => s.floor(x, y),
    };
    let mut cells: Vec<Vec<(usize, u8, u8)>> = vec![Vec::new(); spec.features.len()];
    let (mut walls, mut solid) = (Vec::new(), Vec::new());
    for (g, glyph) in bp.glyphs() {
        let p = landing.tile(g);
        if !legal(glyph.legality, p) {
            return None;
        }
        let i = at(p.0, p.1)?;
        let Some((tile, terrain)) = written(glyph.write) else {
            continue;
        };
        let owner = spec
            .features
            .iter()
            .position(|fs| Some(fs.kind) == glyph.feature);
        debug_assert!(
            owner.is_some(),
            "stamp: glyph '{}' of the {:?} legend writes a tile no feature of the entry owns",
            glyph.ch as char,
            spec.zone
        );
        cells[owner?].push((i, tile, terrain));
        if matches!(glyph.write, Write::Wall | Write::Low(_)) {
            solid.push(i);
        }
        if glyph.write == Write::Wall {
            walls.push(i);
        }
    }
    let landed_tile = |g| {
        let (x, y) = landing.tile(g);
        TilePt { x, y }
    };
    let entrance: Vec<TilePt> = bp
        .entrance(spec.entrance)
        .into_iter()
        .map(landed_tile)
        .collect();
    let doorway = !spec.doorway
        || entrance
            .iter()
            .all(|p| (1..=s.ctx.rules.doorway).all(|a| s.open(p.x + a * u.0, p.y + a * u.1)));
    if !doorway
        || church::smallest_piece(&walls) < R.piece_min
        || s.floor_pieces(&solid) > s.floor_pieces(&[])
    {
        return None;
    }
    let mut pieces = Vec::with_capacity(spec.features.len());
    for (fs, mut cells) in spec.features.iter().zip(cells) {
        cells.sort_unstable_by_key(|c| c.0);
        let anchor = match fs.anchor {
            spec::FeatureAnchor::Centre => t,
            spec::FeatureAnchor::EntranceMiddle => {
                let m = entrance.get(entrance.len() / 2)?;
                (m.x, m.y)
            }
        };
        pieces.push(Piece {
            kind: fs.kind,
            job: fs.job,
            anchor,
            cells,
        });
    }
    // Grid order: by character, then the drawing's row-major order (`Blueprint::marks`).
    let marks: Vec<frame::Mark> = bp
        .marks()
        .into_iter()
        .flat_map(|(ch, gs)| {
            gs.into_iter().map(move |grid| frame::Mark {
                ch,
                grid,
                tile: landed_tile(grid),
            })
        })
        .collect();
    // The anchor's entrance is row-major (P-MAPGEN-SIG-BLUEPRINT-2); the grid order above stays the feature anchors'.
    let mut entrance = entrance;
    entrance.sort_unstable_by_key(|p| (p.y, p.x));
    entrance.dedup();
    let anchor = ZoneAnchor {
        zone: spec.zone,
        kind: spec.kind,
        centre: TilePt { x: t.0, y: t.1 },
        footprint: landing.footprint,
        front: f,
        entrance,
    };
    Some((Built { pieces, anchor }, landing, marks))
}

/// One feature the step writes: kind, job, anchor point and its cells (index, tile, terrain).
pub(crate) struct Piece {
    kind: FeatureKind,
    job: FeatureJob,
    anchor: (i32, i32),
    cells: Vec<(usize, u8, u8)>,
}

/// A zone's landmark: its features (the anchor feature first) and its anchor.
pub(crate) struct Built {
    pieces: Vec<Piece>,
    anchor: ZoneAnchor,
}

/// What the step may read while choosing one zone's site.
pub(crate) struct Site<'a> {
    ctx: &'a SignatureContext<'a>,
    zone: &'a [u8],
    slot: u8,
    tiles: &'a [u8],
    owner: &'a [u16],
    /// The legacy landmark stage's protection (border, coliseum road, lanes, camp clearings with margin, corners).
    protect: &'a [u8],
    /// The aprons marked so far (`LandmarkStage::masks.near1`: the legacy buildings grown by the spawn rules' margin and
    /// every signature landmark placed before this one).
    apron: &'a [u8],
    /// The certifier's camp halo of every camp (no wall may stand there).
    halo: &'a [u8],
    /// P-MAPGEN-SIG-RESERVE-1: the zone's reserved site less its apron (x0, y0, x1, y1 inclusive), which confines
    /// `floor` (and with it `wall` and `ground`) for every landmark drawn from the table; `None` for the volcano's
    /// streams and pools, which leave the site (`volcano::streams`).
    inner: Option<(i32, i32, i32, i32)>,
}

impl Site<'_> {
    /// Free floor of this zone, owned by no feature, off the coliseum, road and lanes (and inside `inner`, if any).
    fn floor(&self, x: i32, y: i32) -> bool {
        self.inner
            .is_none_or(|r| x >= r.0 && x <= r.2 && y >= r.1 && y <= r.3)
            && at(x, y).is_some_and(|i| {
                self.zone[i] == self.slot
                    && self.tiles[i] == TILE_FLOOR
                    && self.owner[i] == 0
                    && self.ctx.hard[i] == 0
            })
    }
    /// Floor of any zone, owned by no feature, off the coliseum, road and lanes: walkable ground beside a landmark.
    fn open(&self, x: i32, y: i32) -> bool {
        at(x, y).is_some_and(|i| {
            self.zone[i] != 0
                && self.tiles[i] == TILE_FLOOR
                && self.owner[i] == 0
                && self.ctx.hard[i] == 0
        })
    }
    /// As `floor`, and outside every camp's halo: a landmark wall may stand here.
    fn wall(&self, x: i32, y: i32) -> bool {
        self.floor(x, y) && self.halo[at(x, y).unwrap()] == 0
    }
    /// As `floor`, outside the legacy landmark protection and outside every apron marked so far: landmark terrain may
    /// lie here.
    fn ground(&self, x: i32, y: i32) -> bool {
        self.floor(x, y) && {
            let i = at(x, y).unwrap();
            self.protect[i] == 0 && self.apron[i] == 0
        }
    }
    /// 4-connected pieces of this zone's floor with `walls` added.
    fn floor_pieces(&self, walls: &[usize]) -> usize {
        let mut seen: Vec<bool> = (0..W * H)
            .map(|i| self.zone[i] != self.slot || self.tiles[i] != TILE_FLOOR)
            .collect();
        for &i in walls {
            seen[i] = true;
        }
        let mut pieces = 0;
        let mut stack = Vec::new();
        for s in 0..W * H {
            if seen[s] {
                continue;
            }
            pieces += 1;
            seen[s] = true;
            stack.push(s);
            while let Some(i) = stack.pop() {
                let (x, y) = ((i % W) as i32, (i / W) as i32);
                for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    if let Some(j) = at(x + dx, y + dy).filter(|&j| !seen[j]) {
                        seen[j] = true;
                        stack.push(j);
                    }
                }
            }
        }
        pieces
    }
}

pub(crate) fn at(x: i32, y: i32) -> Option<usize> {
    (x >= 0 && y >= 0 && (x as usize) < W && (y as usize) < H).then(|| y as usize * W + x as usize)
}

fn bounds(cells: impl Iterator<Item = usize>) -> TileRect {
    let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for i in cells {
        let (x, y) = ((i % W) as i32, (i / W) as i32);
        x0 = x0.min(x);
        y0 = y0.min(y);
        x1 = x1.max(x);
        y1 = y1.max(y);
    }
    TileRect {
        x: x0,
        y: y0,
        w: (x1 - x0 + 1) as u32,
        h: (y1 - y0 + 1) as u32,
    }
}

/// The DIR16 index from tile (x, y) toward the coliseum centre tile: the largest dot product, first on a tie.
pub(crate) fn front(x: i32, y: i32) -> u8 {
    let (dx, dy) = (i64::from(CX - x), i64::from(CY - y));
    let mut best = (0, i64::MIN);
    for (k, v) in DIR16.iter().enumerate() {
        let dot = dx * i64::from(v[0]) + dy * i64::from(v[1]);
        if dot > best.1 {
            best = (k, dot);
        }
    }
    best.0 as u8
}

/// The certifier's camp halo (`certify` `protected`): the clearing grown by the halo span.
fn mark_halo(out: &mut [u8], site: usize) {
    let (cx, cy) = ((site % W) as i32, (site / W) as i32);
    let s = R.protection_span;
    for dy in -s..=s {
        for dx in -s..=s {
            let near = (-R.halo..=R.halo).any(|oy| {
                (-R.halo..=R.halo).any(|ox| {
                    f64::from((dx + ox).pow(2) + (dy + oy).pow(2)) <= R.clearing * R.clearing
                })
            });
            if let Some(i) = at(cx + dx, cy + dy).filter(|_| near) {
                out[i] = 1;
            }
        }
    }
}

/// A uniform pick from `n > 0` choices.
fn pick(rng: &mut Mulberry32, n: usize) -> usize {
    (rng.next_u32() % n as u32) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    fn camp(zone: u8, x: usize, y: usize) -> CampSite {
        CampSite {
            zone,
            site: y * W + x,
            elite: true,
            spots: Vec::new(),
        }
    }

    fn site(zone: Zone, x: i32, y: i32, camp: Option<usize>) -> ReservedSite {
        ReservedSite {
            zone,
            rect: TileRect { x, y, w: 4, h: 3 },
            camp,
            stream: Mulberry32::new(1),
        }
    }

    /// `relabel_sites`'s precondition predicate: a second camp in the rect is found; one just outside it is not. (Which
    /// sites take which label is P-MAPGEN-SIG-SCALE-2's oracle, `tests/mapgen_signature_church.rs`
    /// `relabel_sites_labels_the_frost_and_the_sentenced_sites`, moved there from this test.)
    #[test]
    fn stray_camp_finds_a_second_camp_in_the_site() {
        let camps = [camp(1, 5, 5), camp(2, 30, 31), camp(3, 61, 61)];
        let frost = site(Zone::Frost, 60, 60, Some(camps[2].site));
        let crowded = [camp(4, 61, 61), camp(4, 63, 62), camp(4, 64, 62)];
        assert_eq!(stray_camp(&frost, &crowded, 0), Some(1));
        assert_eq!(
            stray_camp(&frost, &[crowded[0].clone(), crowded[2].clone()], 0),
            None
        );
    }

    /// `relabel_sites`'s precondition (its `debug_assert!`) on real reserving prefixes, seeds 1-8, attempts 0-1: no
    /// camp but the inside camp has its site tile in a relabelled site, and the inside camp is one of the prefix's.
    #[test]
    fn no_other_camp_stands_in_a_relabelled_site_on_real_prefixes() {
        let fixed = crate::mapgen::coliseum::fixed_layout();
        let context = crate::mapgen::attempt::AttemptContext::new(&fixed);
        let mut checked = 0;
        for seed in 1..=8 {
            for n in 0..2 {
                let Some(frame) =
                    crate::mapgen::attempt::begin_attempt_signature(&context, seed, n, true)
                        .expect("prefix input")
                else {
                    continue;
                };
                let (reserved, camps) = (&frame.state.reserved, &frame.state.layout.camps);
                for r in reserved
                    .iter()
                    .filter(|r| relabelled_zones().contains(&r.zone))
                {
                    let t = r.camp.expect("a relabelled site carries its camp");
                    let inside = camps
                        .iter()
                        .position(|c| c.site == t)
                        .unwrap_or_else(|| panic!("seed {seed} attempt {n}: no camp on {t}"));
                    assert_eq!(
                        stray_camp(r, camps, inside),
                        None,
                        "seed {seed} attempt {n}: a camp in the {:?} site",
                        r.zone
                    );
                    checked += 1;
                }
            }
        }
        assert!(checked >= 8, "only {checked} relabelled sites checked");
    }

    /// One finished option-on map (seed 1, its first accepted attempt), shared by the entrance tests below.
    fn signature_map() -> &'static GameMapData {
        static MAP: std::sync::OnceLock<GameMapData> = std::sync::OnceLock::new();
        MAP.get_or_init(|| {
            let fixed = crate::mapgen::coliseum::fixed_layout();
            let generator = crate::mapgen::pipeline::Pipeline::new(&fixed);
            let options = crate::mapgen::pipeline::Options {
                decor: false,
                signature: true,
                ..crate::mapgen::pipeline::Options::default()
            };
            (0..16)
                .find_map(|n| {
                    generator
                        .styled_attempt(1, n, options)
                        .expect("generator error")
                })
                .expect("seed 1: no option-on map in 16 attempts")
        })
    }

    /// The map's anchor of `zone`, the feature id (one-based, as `feature_grid`) of its feature of `kind`, and the tile
    /// index of its first entrance tile.
    fn door_of(m: &GameMapData, zone: Zone, kind: FeatureKind) -> (&ZoneAnchor, u8, usize) {
        let a = m
            .anchors
            .iter()
            .find(|a| a.zone == zone)
            .unwrap_or_else(|| panic!("no {zone:?} anchor"));
        let k = m
            .features
            .iter()
            .position(|f| f.kind == kind && f.zone == zone)
            .unwrap_or_else(|| panic!("no {kind:?} feature"));
        let p = a.entrance.first().expect("an entrance");
        (
            a,
            u8::try_from(k + 1).expect("feature id"),
            at(p.x, p.y).unwrap(),
        )
    }

    /// P-MAPGEN-SIG-SCALE-4 review note 1: the volcano's six outlets as built are LOW lava owned by the volcano, and the
    /// map, outlets included, is intact.
    #[test]
    fn the_volcanos_outlets_as_built_are_intact() {
        let fixed = crate::mapgen::coliseum::fixed_layout();
        let ctx = SignatureContext::new(&fixed);
        let m = signature_map();
        let (a, volcano, _) = door_of(m, Zone::Fire, FeatureKind::Volcano);
        assert_eq!(a.entrance.len(), 6, "the volcano's outlets");
        for p in &a.entrance {
            let i = at(p.x, p.y).unwrap();
            assert_eq!(
                (m.tiles[i], m.terrain[i], m.feature_grid[i]),
                (TILE_LOW, ctx.terrain_codes().lava, volcano),
                "outlet {p:?}"
            );
        }
        assert!(ctx.doors_intact(m));
        assert!(ctx.intact(m));
    }

    /// An outlet turned to wall, still owned by the volcano (a wall the volcano may own elsewhere: `owned_ok` accepts
    /// it), is not what the drawing wrote there: the map is not intact.
    #[test]
    fn an_outlet_turned_to_a_volcano_wall_is_not_intact() {
        let fixed = crate::mapgen::coliseum::fixed_layout();
        let ctx = SignatureContext::new(&fixed);
        let mut m = signature_map().clone();
        let (_, volcano, i) = door_of(&m, Zone::Fire, FeatureKind::Volcano);
        m.tiles[i] = TILE_WALL;
        m.terrain[i] = 0;
        assert_eq!(m.feature_grid[i], volcano);
        assert!(!ctx.doors_intact(&m));
        assert!(!ctx.intact(&m));
    }

    /// A tile of the church's main gate turned to a church wall (owned by the church, which may own any wall) is not
    /// what the drawing wrote there (nothing): the map is not intact.
    #[test]
    fn a_church_doorway_turned_to_an_owned_church_wall_is_not_intact() {
        let fixed = crate::mapgen::coliseum::fixed_layout();
        let ctx = SignatureContext::new(&fixed);
        let mut m = signature_map().clone();
        let (_, church, i) = door_of(&m, Zone::Sentenced, FeatureKind::Church);
        assert_eq!((m.tiles[i], m.feature_grid[i]), (TILE_FLOOR, 0));
        m.tiles[i] = TILE_WALL;
        m.feature_grid[i] = church;
        assert!(!ctx.doors_intact(&m));
        assert!(!ctx.intact(&m));
    }

    /// A tile of the cave's mouth owned by the cave, as the cave's ice floor (a tile the cave may own elsewhere), is not
    /// what the drawing wrote there (nothing): the map is not intact.
    #[test]
    fn a_cave_mouth_tile_owned_by_the_cave_is_not_intact() {
        let fixed = crate::mapgen::coliseum::fixed_layout();
        let ctx = SignatureContext::new(&fixed);
        let mut m = signature_map().clone();
        let (_, cave, i) = door_of(&m, Zone::Frost, FeatureKind::Cave);
        assert_eq!((m.tiles[i], m.feature_grid[i]), (TILE_FLOOR, 0));
        m.feature_grid[i] = cave;
        m.terrain[i] = ctx.terrain_codes().ice;
        assert!(!ctx.doors_intact(&m));
        assert!(!ctx.intact(&m));
    }
}
