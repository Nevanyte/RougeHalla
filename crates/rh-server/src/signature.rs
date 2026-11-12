//! Signature landmarks (owner decision 6, 2026-11-10; P-SIGNATURE-1): a server-side pass over a generated map that adds
//! one landmark per zone made of real terrain. New design with no legacy oracle (owner rule 9: loose proof):
//!
//! * **Fire** (the volcano with its lava streams and pools), **Sentenced** (the church and graveyard) and **Plague**
//!   (the giant bog tree) are placed by the generator itself (`rh_sim::mapgen::landmarks::signature`,
//!   `pipeline::Options::signature`, P-MAPGEN-SIGNATURE-CORE-1 and P-MAPGEN-SIG-FIRE-1), before spawns and stylers;
//!   this pass no longer builds them.
//! * **Frost**: a frozen cave of rock arched around the zone's far elite camp, open towards the centre, with an ice floor.
//! * **Holy** keeps its temple (the client draws it from the existing sanctum hall).
//!
//! This pass stays for Frost until its generator packet lands; then the file is deleted.
//!
//! The pass edits only zone floor that is free (no wall, LOW, terrain or feature, outside camp, spawn, loot and chest
//! clearances), records every change as a map feature of a kind the certifier knows, and keeps a landmark only if the
//! independent certifier (`rh_sim::mapgen::certify`, every zone strict) finds zero failures (a base map that already fails is left alone).
//! A landmark that does not fit is skipped, never forced: the map stays valid either way. It runs in `rh-server` (map
//! authoring before a match exists), so `rh-sim`'s content hash and the client's expected identity do not change; the
//! terrain reaches clients through the existing map planes (collision and terrain), with no protocol change.
//!
//! Faction exemptions follow the live server's terrain mode (owner 2026-11-11: unchanged), so ember and bog affect every
//! faction there.
use rh_sim::mapdata::{FeatureJob, FeatureKind, GameMapData, MapFeature, TileRect, Zone};
use rh_sim::mapgen::certify;

const TILE: f64 = 32.0;
/// Tiles kept clear around camps (beyond their radius), spawns, loot spots and chests.
const CAMP_CLEAR: f64 = 3.0;
const SPOT_CLEAR: i32 = 2;
/// The certifier's smallest wall piece (`certify::rules` `piece_min`), as a 2x3 block.
const STONE: (i32, i32) = (2, 3);
const DIRECTIONS: i32 = 16;
/// Camp and size choices the cave tries before it is skipped.
const ATTEMPTS: usize = 5;

const T_FLOOR: u8 = 0;
const T_WALL: u8 = 1;
/// The bog tree is the generator's now; the tests still count Plague bog.
#[cfg(test)]
const BOG: u8 = 5;
const ICE: u8 = 6;

/// What the pass did, per zone.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Report {
    pub placed: Vec<&'static str>,
    pub skipped: Vec<(&'static str, String)>,
}

/// Adds the signature landmarks to `map` (a certified styled map). Never fails: a landmark that cannot be placed or that
/// the certifier would refuse is skipped and named in the report.
pub fn apply(map: &mut GameMapData) -> Report {
    let mut report = Report::default();
    match failures(map) {
        None => {
            report
                .skipped
                .push(("all", "the certifier refuses the input map".into()));
            return report;
        }
        Some(f) if !f.is_empty() => {
            report.skipped.push((
                "all",
                format!(
                    "the base map already fails the certifier: {:?}",
                    &f[..f.len().min(3)]
                ),
            ));
            return report;
        }
        Some(_) => {}
    }
    let builders: [(&'static str, Zone, Builder); 1] = [("frozen cave", Zone::Frost, frozen_cave)];
    for (name, zone, build) in builders {
        let grid = Grid::new(map, zone);
        let mut why = String::from("no room");
        for attempt in 0..ATTEMPTS {
            let Some(pieces) = build(&grid, map, attempt) else {
                continue;
            };
            // The feature grid is one byte per tile and the certifier allows at most 250 features.
            if map.features.len() + pieces.len() > 250 {
                why = "feature table full".into();
                break;
            }
            let mut candidate = map.clone();
            insert(&mut candidate, zone, pieces);
            match failures(&candidate) {
                Some(f) if f.is_empty() => {
                    *map = candidate;
                    report.placed.push(name);
                    why.clear();
                    break;
                }
                Some(f) => {
                    why = format!("certifier: {:?}", &f[..f.len().min(3)]);
                }
                None => why = "certifier refused the map".into(),
            }
        }
        if !why.is_empty() {
            report.skipped.push((name, why));
        }
    }
    report
}

/// Failures under the strictest certification (every zone strict), as `rule/subject` keys; None if refused outright.
fn failures(m: &GameMapData) -> Option<Vec<String>> {
    let o = certify::Options {
        styled: true,
        zone: true,
        strict: certify::Strict::All,
    };
    certify::certify(m, &o).ok().map(|c| {
        c.failures
            .iter()
            .map(|f| format!("{}/{}", f.rule, f.subject))
            .collect()
    })
}

type Builder = fn(&Grid, &GameMapData, usize) -> Option<Vec<Piece>>;

/// One new feature: its kind, jobs, payload, anchor and the cells it sets (tile value, terrain).
struct Piece {
    kind: FeatureKind,
    jobs: Vec<FeatureJob>,
    p: Vec<i32>,
    anchor: (i32, i32),
    cells: Vec<(usize, u8, u8)>,
}

/// Where the pass may write in one zone.
struct Grid {
    w: i32,
    h: i32,
    free: Vec<bool>,
}

impl Grid {
    fn new(m: &GameMapData, zone: Zone) -> Self {
        let (w, h) = (m.w as i32, m.h as i32);
        let n = (w * h) as usize;
        let code = zone.code();
        let mut free: Vec<bool> = (0..n)
            .map(|i| {
                m.region_grid[i] == code
                    && m.tiles[i] == T_FLOOR
                    && m.terrain[i] == 0
                    && m.feature_grid[i] == 0
            })
            .collect();
        let mut block = |cx: f64, cy: f64, r: f64| {
            let (tx, ty) = (cx / TILE, cy / TILE);
            let ri = r.ceil() as i32 + 1;
            for y in (ty as i32 - ri)..=(ty as i32 + ri) {
                for x in (tx as i32 - ri)..=(tx as i32 + ri) {
                    if x < 0 || y < 0 || x >= w || y >= h {
                        continue;
                    }
                    let (dx, dy) = (x as f64 + 0.5 - tx, y as f64 + 0.5 - ty);
                    if dx * dx + dy * dy <= r * r {
                        free[(y * w + x) as usize] = false;
                    }
                }
            }
        };
        for c in &m.camps {
            block(c.x, c.y, c.r / TILE + CAMP_CLEAR);
            block(c.chest.x, c.chest.y, f64::from(SPOT_CLEAR));
            for s in &c.spots {
                block(s.x, s.y, f64::from(SPOT_CLEAR));
            }
        }
        let spots = m
            .spawns
            .iter()
            .chain(&m.crate_spots)
            .chain(&m.ground_spots)
            .chain(&m.coliseum.inner_spawns)
            .map(|p| (p.x, p.y))
            .chain(m.spawn_pool.iter().map(|s| (s.x, s.y)));
        for (x, y) in spots.collect::<Vec<_>>() {
            block(x, y, f64::from(SPOT_CLEAR) + 1.);
        }
        // Keep a one-tile margin from existing walls, LOW tiles and features, and two tiles from the map edge.
        let solid: Vec<bool> = (0..n)
            .map(|i| m.tiles[i] != T_FLOOR || m.feature_grid[i] != 0)
            .collect();
        let mut out = free.clone();
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) as usize;
                if !free[i] {
                    continue;
                }
                if x < 2 || y < 2 || x >= w - 2 || y >= h - 2 {
                    out[i] = false;
                    continue;
                }
                'n: for dy in -1..=1 {
                    for dx in -1..=1 {
                        if solid[((y + dy) * w + x + dx) as usize] {
                            out[i] = false;
                            break 'n;
                        }
                    }
                }
            }
        }
        Self { w, h, free: out }
    }

    fn at(&self, x: i32, y: i32) -> Option<usize> {
        (x >= 0 && y >= 0 && x < self.w && y < self.h).then(|| (y * self.w + x) as usize)
    }

    fn free(&self, x: i32, y: i32) -> bool {
        self.at(x, y).is_some_and(|i| self.free[i])
    }
}

/// The 16-direction index of the vector (dx, dy) (0 = +x, counter-clockwise in screen terms as y grows down).
fn direction(dx: f64, dy: f64) -> i32 {
    let a = dy.atan2(dx).rem_euclid(std::f64::consts::TAU);
    ((a / std::f64::consts::TAU * f64::from(DIRECTIONS)).round() as i32) % DIRECTIONS
}

/// The zone's elite camps, farthest from the map centre first: (tile x, tile y, clearing radius in tiles).
fn elites(m: &GameMapData, zone: Zone) -> Vec<(f64, f64, f64)> {
    let (cx, cy) = (f64::from(m.w) * TILE / 2., f64::from(m.h) * TILE / 2.);
    let mut out: Vec<_> = m
        .camps
        .iter()
        .filter(|c| c.zone == zone && c.elite_spot >= 0)
        .map(|c| {
            (
                (c.x - cx).hypot(c.y - cy),
                (c.x / TILE, c.y / TILE, c.r / TILE),
            )
        })
        .collect();
    out.sort_by(|a, b| b.0.total_cmp(&a.0));
    out.into_iter().map(|(_, c)| c).collect()
}

/// The cells of `cells` that belong to a 4-connected piece of at least the certifier's smallest wall piece (6 tiles).
fn whole_pieces(cells: Vec<(i32, i32)>) -> Vec<(i32, i32)> {
    const PIECE_MIN: usize = (STONE.0 * STONE.1) as usize;
    let mut piece = vec![usize::MAX; cells.len()];
    let mut sizes = Vec::new();
    for start in 0..cells.len() {
        if piece[start] != usize::MAX {
            continue;
        }
        let id = sizes.len();
        let mut stack = vec![start];
        piece[start] = id;
        let mut n = 0;
        while let Some(i) = stack.pop() {
            n += 1;
            let (x, y) = cells[i];
            for (j, &(u, v)) in cells.iter().enumerate() {
                if piece[j] == usize::MAX && (u - x).abs() + (v - y).abs() == 1 {
                    piece[j] = id;
                    stack.push(j);
                }
            }
        }
        sizes.push(n);
    }
    cells
        .into_iter()
        .zip(piece)
        .filter(|(_, id)| sizes[*id] >= PIECE_MIN)
        .map(|(c, _)| c)
        .collect()
}

fn disk(cx: f64, cy: f64, r: f64) -> impl Iterator<Item = (i32, i32)> {
    let ri = r.ceil() as i32 + 1;
    let (x0, y0) = (cx.floor() as i32, cy.floor() as i32);
    (y0 - ri..=y0 + ri).flat_map(move |y| {
        (x0 - ri..=x0 + ri).filter_map(move |x| {
            let (dx, dy) = (f64::from(x) + 0.5 - cx, f64::from(y) + 0.5 - cy);
            (dx * dx + dy * dy <= r * r).then_some((x, y))
        })
    })
}

/// Frost: a two-tile-thick rock arch around the far elite camp on the side away from the centre, with ice inside, kept
/// two tiles off the rock and off the camp.
fn frozen_cave(g: &Grid, m: &GameMapData, k: usize) -> Option<Vec<Piece>> {
    let (ex, ey, er) = *elites(m, Zone::Frost).get(k % 2)?;
    let (mx, my) = (f64::from(m.w) / 2., f64::from(m.h) / 2.);
    let out = (ex - mx, ey - my);
    let len = out.0.hypot(out.1);
    if len == 0. {
        return None;
    }
    let (ox, oy) = (out.0 / len, out.1 / len);
    let inner = er + CAMP_CLEAR + 2.5 + (k / 2) as f64;
    let mut rock = Vec::new();
    let mut total = 0;
    for (x, y) in disk(ex, ey, inner + 2.) {
        let (dx, dy) = (f64::from(x) + 0.5 - ex, f64::from(y) + 0.5 - ey);
        let d = dx.hypot(dy);
        // The arch covers the outward 230 degrees; the mouth (the inward 130 degrees) stays open.
        if d < inner || (dx * ox + dy * oy) / d < -0.42 {
            continue;
        }
        total += 1;
        if g.free(x, y) {
            rock.push((x, y));
        }
    }
    if rock.len() * 2 < total {
        return None;
    }
    let rock = whole_pieces(rock);
    if rock.len() < 16 {
        return None;
    }
    let mut ice = Vec::new();
    for (x, y) in disk(ex, ey, inner - 2.) {
        let d = (f64::from(x) + 0.5 - ex).hypot(f64::from(y) + 0.5 - ey);
        if d < er + CAMP_CLEAR || !g.free(x, y) {
            continue;
        }
        let near_rock = rock
            .iter()
            .any(|&(rx, ry)| (rx - x).abs() <= 2 && (ry - y).abs() <= 2);
        if !near_rock {
            ice.push((x, y));
        }
    }
    let idx = |&(x, y): &(i32, i32)| g.at(x, y).unwrap();
    let mut pieces = vec![Piece {
        kind: FeatureKind::Headland,
        jobs: vec![FeatureJob::Lee],
        p: vec![direction(ox, oy)],
        anchor: (ex.floor() as i32, ey.floor() as i32),
        cells: rock.iter().map(|c| (idx(c), T_WALL, 0)).collect(),
    }];
    if !ice.is_empty() {
        pieces.push(Piece {
            kind: FeatureKind::Mere,
            jobs: vec![FeatureJob::Crossing],
            p: vec![0, ice.len() as i32],
            anchor: (ex.floor() as i32, ey.floor() as i32),
            cells: ice.iter().map(|c| (idx(c), T_FLOOR, ICE)).collect(),
        });
    }
    Some(pieces)
}

/// Writes the pieces' cells and inserts their features after the zone's existing non-infill features (the certifier's
/// order: zone code ascending; landmarks, then the rest, then at most one infill), renumbering the feature grid.
fn insert(m: &mut GameMapData, zone: Zone, pieces: Vec<Piece>) {
    let code = zone.code();
    let at = m
        .features
        .iter()
        .rposition(|f| f.zone.code() < code || (f.zone == zone && f.kind != FeatureKind::Infill))
        .map_or(0, |k| k + 1);
    let shift = pieces.len() as u8;
    for v in m.feature_grid.iter_mut() {
        if usize::from(*v) > at {
            *v += shift;
        }
    }
    let w = m.w as i32;
    for (k, piece) in pieces.into_iter().enumerate() {
        let id = (at + k + 1) as u8;
        let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
        for &(i, tile, terrain) in &piece.cells {
            m.tiles[i] = tile;
            m.terrain[i] = terrain;
            m.feature_grid[i] = id;
            let (x, y) = ((i as i32) % w, (i as i32) / w);
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
        let (ax, ay) = piece.anchor;
        m.features.insert(
            at + k,
            MapFeature {
                kind: piece.kind,
                variant: String::new(),
                zone,
                jobs: piece.jobs,
                ax,
                ay,
                p: piece.p,
                bbox: TileRect {
                    x: x0,
                    y: y0,
                    w: (x1 - x0 + 1) as u32,
                    h: (y1 - y0 + 1) as u32,
                },
                tiles: piece.cells.len() as u32,
            },
        );
    }
    debug_assert!(m.features.len() <= 250);
    refresh_camps(m);
}

/// Camp area and radius are derived from the territory's floor (the certifier's `camp-area-radius`): the floor tiles of
/// the camp's territory, and the farthest of them from the camp's tile, in world units. New walls and lava change both.
fn refresh_camps(m: &mut GameMapData) {
    let w = m.w as i32;
    for (ci, c) in m.camps.iter_mut().enumerate() {
        let (cx, cy) = ((c.x / TILE).floor() as i32, (c.y / TILE).floor() as i32);
        let mut area = 0;
        let mut far: f64 = 0.;
        for (i, (&t, &tile)) in m.territory_grid.iter().zip(&m.tiles).enumerate() {
            if usize::from(t) == ci + 1 && tile == T_FLOOR {
                area += 1;
                let (dx, dy) = ((i as i32) % w - cx, (i as i32) / w - cy);
                far = far.max(f64::from(dx).hypot(f64::from(dy)));
            }
        }
        c.area = area;
        c.radius = far * TILE;
    }
}

#[cfg(test)]
mod tests;
