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
//! Integer geometry only: offsets and squared distances in tiles (the tree) and rectangles (the church, the cave).
mod bog_tree;
mod cave;
mod church;
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
use crate::mapgen::zones::camps::CampSite;
use crate::rng::{hash_seed, Mulberry32};

use super::recipe_support::DIR16;
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
    /// Bog tree: squared tile distance from the trunk's centre tile of the trunk (wall), of the dry ground kept round
    /// it, and the inclusive squared-distance ranges of the two bog bands.
    pub trunk_d2: i32,
    /// The terrain code of the bog bands (`terrain_gate` kind `bog`, home Plague).
    pub bog: u8,
    pub dry_d2: i32,
    pub bog_d2: [(i32, i32); 2],
    /// Bog tree: the fewest bog tiles a site may keep (of about 90 a whole tree has), and the tiles its centre must stand
    /// beyond the start of the Plague zone's outer third (slack for later rezoning).
    pub bog_min: usize,
    pub outer_slack: f64,
    /// Church: the distance from the camp tile of each wall line (inclusive range); a side may instead lean on the map
    /// border when the border is at most `border_max` away, and must when an own wall would leave a gap under
    /// `border_gap` tiles to it.
    pub church_side: (i32, i32),
    pub border_max: i32,
    pub border_gap: i32,
    /// Graveyard layouts, most preferred first: each stone of one half as (across from the door axis, along from the
    /// door line), first..=last inclusive; the other half is its mirror. Every stone starts `grave_gap` past the door line.
    pub graveyards: [&'static [Stone]; 3],
    pub grave_gap: i32,
    /// Church: how far (tiles) the door axis may move off the camp's axis, nearest first.
    pub door_shift: i32,
    /// Volcano: the terrain codes of its lava (LOW) and ember (floor) (`terrain_gate` kinds `lava`, `ember`, home Fire).
    pub lava: u8,
    pub ember: u8,
    /// Volcano: squared tile distance from the centre tile of the cone (wall) and of its crater (lava inside the cone).
    pub cone_d2: i32,
    pub crater_d2: i32,
    /// Volcano: tiles its centre stands beyond the Fire centroid's distance from the map centre (the back edge, with
    /// slack for later rezoning).
    pub back_slack: f64,
    /// Volcano site tiers, tried in order: the cone's Chebyshev distance from every Fire camp tile is at least the
    /// tier's value; `site_tries` uniform draws per tier.
    pub camp_room: [i32; 3],
    pub site_tries: usize,
    /// Streams: the count drawn (inclusive range); per count, the heading offsets from the front (DIR16 steps) to draw
    /// from, and the path length range (tiles; two lava tiles per path tile).
    pub streams: (usize, usize),
    pub spreads: [&'static [&'static [i32]]; 2],
    pub stream_len: [(i32, i32); 2],
    /// Streams: the shortest path kept (tiles), where the path starts (tiles from the cone's centre), how far a path
    /// may bend from its own heading and from the front (DIR16 steps), the Chebyshev gap kept from every other stream
    /// and pool, and the squared distance from the centre within which streams may meet (beside the cone).
    pub stream_min: usize,
    pub stream_start: i32,
    pub stream_bend: i32,
    pub front_max: i32,
    pub stream_gap: i32,
    pub start_d2: i32,
    /// Pools: the squared radii tried, largest first.
    pub pool_d2: &'static [i32],
    /// Volcano: the zone's total lava (crater, streams and pools; inclusive), inside the legacy river's 107-158.
    pub lava_budget: (usize, usize),
    /// Cave: the distance from the camp tile of each wall line (inclusive range; a side may lean on the border as the
    /// church's), the mouth's half-width (tiles each side of its axis), the free Frost floor beyond the mouth (tiles),
    /// the fewest ice tiles inside, and the terrain code of that ice (`terrain_gate` kind `ice`, home Frost). A mouth is
    /// first sought with a forecourt: the square of Frost `2 * forecourt + 1` tiles wide just beyond it.
    pub cave_side: (i32, i32),
    pub mouth: i32,
    pub doorway: i32,
    pub forecourt: i32,
    pub cave_ice_min: usize,
    pub ice: u8,
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
    /// the 29 x 29 grid, front (toward the coliseum) at the bottom. Parsed once per context (`cave::Blueprint`); a grid
    /// that does not parse refuses every option-on attempt at the cave (`Refusal::Signature`).
    pub cave_grid: &'static str,
    /// P-MAPGEN-SIG-SCALE-3: the Plague bog tree's approved blueprint (owner decision 2026-11-13; ADR 0028 G9), the text
    /// of `bog.txt` beside this file, a byte-equal copy of `docs/landmarks/blueprints/bog.txt` (the docs are not in the
    /// server image's build context). Lines starting `;` are its legend; the rest is the 29 x 29 grid, front (toward the
    /// coliseum) at the bottom. Parsed once per context (`bog_tree::Drawing`); a grid that does not parse refuses every
    /// option-on attempt at the tree (`Refusal::Signature`).
    pub bog_grid: &'static str,
}

/// One headstone of a graveyard half: (across from the door axis, along from the door line), each first..=last.
pub type Stone = ((i32, i32), (i32, i32));

pub const DEFAULT_DEFINITION: Definition = Definition {
    stream: 5,
    bands: [2, 6, 14],
    trunk_d2: 4,
    bog: 5,
    dry_d2: 10,
    bog_d2: [(13, 21), (36, 56)],
    bog_min: 60,
    outer_slack: 2.0,
    church_side: (4, 7),
    border_max: 9,
    border_gap: 3,
    graveyards: [
        &[((4, 5), (3, 5)), ((4, 5), (7, 9))],
        &[((2, 3), (3, 5)), ((2, 3), (7, 9))],
        &[((2, 3), (3, 5)), ((5, 6), (3, 5))],
    ],
    grave_gap: 3,
    door_shift: 5,
    lava: 1,
    ember: 4,
    cone_d2: 6,
    crater_d2: 1,
    back_slack: 2.0,
    camp_room: [12, 9, 6],
    site_tries: 24,
    streams: (2, 3),
    spreads: [
        &[&[-2, 2], &[-3, 1], &[-1, 3]],
        &[&[-3, 0, 3], &[-3, 1, 3], &[-3, -1, 3]],
    ],
    stream_len: [(15, 22), (9, 14)],
    stream_min: 4,
    stream_start: 3,
    stream_bend: 2,
    front_max: 3,
    stream_gap: 3,
    start_d2: 20,
    pool_d2: &[4, 2],
    lava_budget: (80, 150),
    cave_side: (4, 7),
    mouth: 1,
    doorway: 2,
    forecourt: 4,
    cave_ice_min: 8,
    ice: 6,
    lake_reach: 8,
    lake_tries: 8,
    lake_rounds: 3,
    second_share: 75,
    lake_slack: 2,
    site_side: 34,
    site_depth: 9,
    cave_grid: include_str!("cave.txt"),
    bog_grid: include_str!("bog.txt"),
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
/// the Frost site, round which the blueprint cave stands. P-MAPGEN-SIG-SCALE-2 adds the Sentenced site with its church.
fn relabelled_zones() -> [Zone; 1] {
    [Zone::Frost]
}

/// P-MAPGEN-SIG-SCALE-1 (coordinator decision 2026-11-13): before repair runs, no tile of a reserved site with an inside
/// camp belongs to another camp's territory. Every tile of such a site (the whole `rect`, apron included) of a
/// `relabelled_zones` zone takes the inside camp's label, its index in `camps` (the prefix's) + 1. The reservation keeps
/// the other camps' halos out of the site, not their territories: without this the blueprint's walls cut those
/// territories and repair hands the pieces to camps beyond the territory radius (`Repair(RadiusPost)`). Called by the
/// pipeline on repair's copy of the territory grid on option-on attempts only (no sites otherwise: nothing changes). A
/// pure write: no draw.
pub(crate) fn relabel_sites(reserved: &[ReservedSite], camps: &[CampSite], territory: &mut [u8]) {
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

/// The church's and the cave's door/mouth axis rule: the dominant axis of DIR16 `f` (x on a tie), as a unit vector.
fn axis(f: u8) -> (i32, i32) {
    let v = DIR16[usize::from(f)];
    if v[0].abs() >= v[1].abs() {
        (v[0].signum(), 0)
    } else {
        (0, v[1].signum())
    }
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

/// What the step placed in one attempt: the anchors of the zones it built (zone-code order) and the terrain layer the
/// attempt starts its styler pass from (all zero except the landmarks' own terrain, such as the bog tree's bands).
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub anchors: Vec<ZoneAnchor>,
    pub terrain: Vec<u8>,
}

/// Immutable per-pipeline context, reused by every attempt.
pub struct SignatureContext<'f> {
    _fixed: core::marker::PhantomData<&'f FixedLayout>,
    rules: Definition,
    /// Tiles no landmark wall may take: the border, the coliseum, its road (with the legacy landmark margin) and lanes.
    hard: Vec<u8>,
    /// The cave's drawing (`Definition::cave_grid`), parsed once; `None` when it does not parse.
    cave: Option<cave::Blueprint>,
    /// The bog tree's drawing (`Definition::bog_grid`), parsed once; `None` when it does not parse.
    bog: Option<bog_tree::Drawing>,
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
        Self {
            _fixed: core::marker::PhantomData,
            rules: *d,
            hard,
            cave: cave::Blueprint::parse(d.cave_grid, d.mouth),
            bog: bog_tree::Drawing::parse(d.bog_grid),
        }
    }

    pub fn definition(&self) -> &Definition {
        &self.rules
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
    /// graveyard; Plague: the bog tree; Frost: the cave) into the stage's layers and masks, in that order. Only the
    /// volcano and the bog tree keep their tiles out of the aprons marked before them (`Site::ground`); the church and
    /// the cave place their walls on any free wall tile (`Site::wall`). The rule that no landmark lies in another's
    /// apron is the end-of-attempt discard (`intact`). `Ok(None)` refuses the attempt (G5: a zone that cannot hold its
    /// landmark is never built without it; the pipeline tries the next attempt).
    pub fn apply(
        &self,
        frame: &AttemptFrame,
        stage: &mut LandmarkStage,
    ) -> Result<Option<Placed>, AttemptInputError> {
        let prefix = &frame.state;
        let mut halo = vec![0u8; W * H];
        for c in &prefix.layout.camps {
            mark_halo(&mut halo, c.site);
        }
        let mut terrain = vec![0u8; W * H];
        let mut anchors = Vec::new();
        for zone in reserved_zones() {
            let Some(slot) = slot_of(&prefix.order, zone) else {
                return Ok(None);
            };
            // P-MAPGEN-SIG-RESERVE-1: a zone with a reserved site builds inside it, continuing the stream the Prefix
            // began; without one (the prefix of `begin_attempt`), today's rules on a fresh stream.
            let reserved = prefix.reserved.iter().find(|r| r.zone == zone);
            let mut rng = match reserved {
                Some(r) => r.stream.clone(),
                None => Mulberry32::new(hash_seed(
                    prefix.seed as u32,
                    prefix.attempt as u32,
                    u32::from(slot),
                    self.rules.stream,
                )),
            };
            let b = self.rules.bands[0];
            let inner = reserved.map(|r| {
                (
                    r.rect.x + b,
                    r.rect.y + b,
                    r.rect.x + r.rect.w as i32 - 1 - b,
                    r.rect.y + r.rect.h as i32 - 1 - b,
                )
            });
            let site = Site {
                ctx: self,
                zone: &prefix.partition.zone,
                slot,
                tiles: &stage.state.tiles,
                owner: &stage.state.feature_owner,
                protect: &stage.protect,
                apron: &stage.masks.near1,
                halo: &halo,
                // The volcano's streams and pools leave its site: only its cone is confined (`volcano::place`).
                inner: inner.filter(|_| zone != Zone::Fire),
            };
            let camp = reserved.and_then(|r| r.camp);
            let built = match zone {
                Zone::Fire => volcano::place(&site, &prefix.layout.camps, &mut rng, inner),
                Zone::Sentenced => church::place(&site, &prefix.layout.camps, &mut rng, camp),
                Zone::Plague => bog_tree::place(
                    &site,
                    &mut rng,
                    reserved.map(|r| (r.rect.x + r.rect.w as i32 / 2, r.rect.y + r.rect.h as i32 / 2)),
                ),
                _ => cave::place(&site, &prefix.layout.camps, &mut rng, camp),
            };
            let Some(built) = built else {
                return Ok(None);
            };
            for piece in &built.pieces {
                self.write(stage, &mut terrain, zone, piece);
            }
            anchors.push(built.anchor);
        }
        Ok(Some(Placed { anchors, terrain }))
    }

    fn write(&self, stage: &mut LandmarkStage, terrain: &mut [u8], zone: Zone, p: &Piece) {
        let id = u16::try_from(stage.state.features.len() + 1).expect("feature id");
        let bbox = bounds(p.cells.iter().map(|c| c.0));
        for &(i, tile, kind) in &p.cells {
            stage.state.tiles[i] = tile;
            terrain[i] = kind;
            stage.state.feature_owner[i] = id;
        }
        let b = self.rules.bands[0];
        if by_tile(p.kind) {
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
    }

    /// Writes the finished map's anchors (G3) from the step's anchors and the finished features: the bog tree's and
    /// the church's, re-read from their features after records renumbered them, plus the Holy hall's (the largest
    /// `Hall` feature, placed by the Holy styler), in zone-code order.
    pub fn finish(&self, map: &mut GameMapData, anchors: Vec<ZoneAnchor>) {
        let mut out: Vec<ZoneAnchor> = anchors
            .into_iter()
            .map(|mut a| {
                if let Some(f) = map
                    .features
                    .iter()
                    .find(|f| f.kind == a.kind && f.zone == a.zone)
                {
                    a.footprint = f.bbox;
                }
                a
            })
            .collect();
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
    /// of it): a tree of trunk walls and bog floor, a church and graveyard of walls, an open door, all in their zone; no
    /// styler feature in an apron; no landmark's tiles in another landmark's apron, either way round
    /// (`aprons_apart`); and the Frost zone's largest ice body outside the cave at the cave's mouth
    /// (`cave::lake_at_mouth`). A pure predicate: it draws nothing and changes nothing.
    pub fn intact(&self, map: &GameMapData) -> bool {
        let owned_ok = (0..map.feature_grid.len()).all(|i| {
            let id = usize::from(map.feature_grid[i]);
            let Some(f) = id.checked_sub(1).and_then(|k| map.features.get(k)) else {
                return true;
            };
            let (t, k) = (map.tiles[i], map.terrain[i]);
            let zone_ok = map.region_grid[i] == f.zone.code();
            match f.kind {
                FeatureKind::BogTree => {
                    zone_ok
                        && ((t == TILE_WALL && k == 0) || (t == TILE_FLOOR && k == self.rules.bog))
                }
                FeatureKind::Church | FeatureKind::Graveyard => zone_ok && t == TILE_WALL,
                FeatureKind::Volcano => {
                    zone_ok
                        && ((t == TILE_WALL && k == 0) || (t == TILE_LOW && k == self.rules.lava))
                }
                FeatureKind::LavaStream | FeatureKind::LavaPool => {
                    zone_ok
                        && ((t == TILE_LOW && k == self.rules.lava)
                            || (t == TILE_FLOOR && k == self.rules.ember))
                }
                FeatureKind::Cave => {
                    zone_ok
                        && ((t == TILE_WALL && k == 0) || (t == TILE_FLOOR && k == self.rules.ice))
                }
                _ => true,
            }
        });
        let door_ok = map.anchors.iter().all(|a| {
            a.entrance
                .iter()
                .all(|p| at(p.x, p.y).is_some_and(|i| map.tiles[i] == TILE_FLOOR))
        });
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
        for (k, f) in map.features.iter().enumerate() {
            if !is_signature(f.kind) {
                continue;
            }
            if by_tile(f.kind) {
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
                .and_then(|k| map.features.get(k))
                .is_none_or(|g| {
                    is_signature(g.kind)
                        || matches!(
                            g.kind,
                            FeatureKind::Landmark | FeatureKind::Infill | FeatureKind::Bush
                        )
                })
        });
        owned_ok
            && door_ok
            && apron_ok
            && self.aprons_apart(map)
            && cave::lake_at_mouth(map, &self.rules)
    }

    /// G1, G5 (P-MAPGEN-SIG-FROST-2): no tile of one landmark lies in another landmark's apron, for every ordered pair
    /// of the five. At placement only the volcano and the bog tree keep out of the aprons marked before them
    /// (`Site::ground`); the church and the cave read no apron (`Site::wall` only), and no landmark keeps the earlier
    /// ones out of its own apron. This check is the rule for all five, and symmetric, so the placement order decides
    /// nothing. The
    /// landmarks: the volcano (its streams and pools count as its tiles; its apron is the cone's box), the church with
    /// its graveyard, the bog tree, the cave, and the Holy hall (the Holy `Hall` on the Holy anchor's footprint). An
    /// apron is each of the landmark's boxes grown by the core band.
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
        let landmark: Vec<Option<u8>> = map
            .features
            .iter()
            .enumerate()
            .map(|(k, f)| match f.kind {
                FeatureKind::Volcano | FeatureKind::LavaStream | FeatureKind::LavaPool => Some(0),
                FeatureKind::Church | FeatureKind::Graveyard => Some(1),
                FeatureKind::BogTree => Some(2),
                FeatureKind::Cave => Some(3),
                _ if hall == Some(k) => Some(4),
                _ => None,
            })
            .collect();
        let b = self.rules.bands[0];
        map.features.iter().enumerate().all(|(k, f)| {
            let Some(host) = landmark[k] else {
                return true;
            };
            if by_tile(f.kind) {
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

fn is_signature(k: FeatureKind) -> bool {
    matches!(
        k,
        FeatureKind::BogTree
            | FeatureKind::Church
            | FeatureKind::Graveyard
            | FeatureKind::Volcano
            | FeatureKind::LavaStream
            | FeatureKind::LavaPool
            | FeatureKind::Cave
    )
}

/// Kinds whose apron and keep mask follow their own tiles rather than their box (the lava streams and pools).
fn by_tile(k: FeatureKind) -> bool {
    matches!(k, FeatureKind::LavaStream | FeatureKind::LavaPool)
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
    /// `floor` (and with it `wall` and `ground`) for the church, the tree and the cave; `None` without a reservation.
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

    /// P-MAPGEN-SIG-SCALE-1: the Frost site (whole rect) takes its camp's label (index + 1); a Sentenced site, a site
    /// without a camp and no sites at all leave the grid as it was.
    #[test]
    fn only_the_frost_sites_tiles_take_its_camps_label() {
        let camps = vec![camp(1, 5, 5), camp(2, 30, 31), camp(3, 61, 61)];
        let before = vec![7u8; W * H];
        let mut grid = before.clone();
        relabel_sites(&[], &camps, &mut grid);
        assert_eq!(grid, before, "no sites");
        let others = [
            site(Zone::Sentenced, 29, 30, Some(camps[1].site)),
            site(Zone::Plague, 10, 10, None),
            site(Zone::Frost, 40, 40, None),
        ];
        relabel_sites(&others, &camps, &mut grid);
        assert_eq!(grid, before, "no Frost site with a camp");
        relabel_sites(
            &[site(Zone::Frost, 60, 60, Some(camps[2].site))],
            &camps,
            &mut grid,
        );
        for (i, &label) in grid.iter().enumerate() {
            let (x, y) = ((i % W) as i32, (i / W) as i32);
            let inside = (60..64).contains(&x) && (60..63).contains(&y);
            assert_eq!(label, if inside { 3 } else { 7 }, "({x}, {y})");
        }
        // The precondition's predicate: a second camp in the rect is found; one just outside it is not.
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
}
