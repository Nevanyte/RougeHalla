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
//! Integer geometry only: offsets and squared distances in tiles (the tree) and rectangles (the church).
mod bog_tree;
mod cave;
mod church;
mod volcano;

use crate::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
use crate::mapdata::{
    FeatureJob, FeatureKind, GameMapData, MapFeature, TilePt, TileRect, Zone, ZoneAnchor,
};
use crate::mapgen::attempt::{AttemptFrame, AttemptInputError};
use crate::mapgen::certify::rules::R;
use crate::mapgen::coliseum::{FixedLayout, CX, CY, H, W};
use crate::mapgen::spawns;
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
        }
    }

    pub fn definition(&self) -> &Definition {
        &self.rules
    }

    /// Places each zone's signature landmark (Fire: the volcano with its streams and pools; Sentenced: the church and its
    /// graveyard; Plague: the bog tree) into the stage's layers and masks, in that order, each keeping out of the aprons
    /// marked before it. `Ok(None)` refuses the attempt (G5: a zone that cannot hold its landmark is never
    /// built without it; the pipeline tries the next attempt).
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
        for zone in [Zone::Fire, Zone::Sentenced, Zone::Plague] {
            let Some(slot) = prefix
                .order
                .iter()
                .position(|&f| f.as_str() == zone.as_str())
                .map(|s| (s + 1) as u8)
            else {
                return Ok(None);
            };
            let mut rng = Mulberry32::new(hash_seed(
                prefix.seed as u32,
                prefix.attempt as u32,
                u32::from(slot),
                self.rules.stream,
            ));
            let site = Site {
                ctx: self,
                zone: &prefix.partition.zone,
                slot,
                tiles: &stage.state.tiles,
                owner: &stage.state.feature_owner,
                protect: &stage.protect,
                apron: &stage.masks.near1,
                halo: &halo,
            };
            let built = match zone {
                Zone::Fire => volcano::place(&site, &prefix.layout.camps, &mut rng),
                Zone::Sentenced => church::place(&site, &prefix.layout.camps, &mut rng),
                _ => bog_tree::place(&site, &mut rng),
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
    /// of it): a tree of trunk walls and bog floor, a church and graveyard of walls, an open door, all in their zone.
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
        owned_ok && door_ok && apron_ok
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
}

impl Site<'_> {
    /// Free floor of this zone, owned by no feature, off the coliseum, road and lanes.
    fn floor(&self, x: i32, y: i32) -> bool {
        at(x, y).is_some_and(|i| {
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
