//! Golden vectors for the client's fog-of-war mirror (`protocol/fixtures/sight_v1.json`).
//!
//! The Unity client dims the area its player cannot see. It must use the server's rule, so this module samples the
//! real private functions (`scene_line_blocked`, `reveals_tile`, `in_radius`) on the committed seed-1 map and writes
//! what they answer. `client-unity/RoguehallaNet.Tests/SightGoldenTests.cs` replays every row through the C# mirror
//! (`Roguehalla.Net.VisionRule`). Test-only: it changes no gameplay code.
//!
//! `cargo test -p rh-sim vision::golden` compares the committed file with a fresh generation (a drift in the sight rule
//! fails here). `RH_WRITE_FIXTURES=1 cargo test -p rh-sim vision::golden` rewrites the file.

use super::{in_radius, reveals_tile, scene_line_blocked};
use crate::constants::{
    BUSH_REVEAL_MS, BUSH_REVEAL_RADIUS, MASK_SIGHT, TICK_MS, TILE, VISION_RADIUS, VISION_TRAIL_MS,
    VISION_UPDATE_MS,
};
use crate::mapdata::MapExport;
use crate::{TileMap, Vec2};
use serde_json::{json, Value};

const FORMAT: &str = "rh-sight-golden/1";
const BLOCKED_QUERIES: usize = 4200;
const REVEAL_ORIGINS: usize = 48;
/// A reveal sample covers the tiles within this many tiles of the origin (the radius is 900 u = 28.1 tiles).
const REVEAL_SPAN: i64 = 30;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*; deterministic, no entropy.
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(A[(n >> 18) as usize & 63] as char);
        out.push(A[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            A[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            A[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn load() -> (TileMap, Vec<u8>) {
    let export: MapExport =
        serde_json::from_str(include_str!("../mapdata/fixtures/seed1.map.json")).unwrap();
    let admitted = export.validate().unwrap();
    let (w, h, tiles, layers) = admitted.into_parts();
    let regions = layers.data().region_grid.clone();
    let map = TileMap::new(w, h, tiles)
        .unwrap()
        .with_layers(layers)
        .unwrap();
    (map, regions)
}

fn generate() -> Value {
    let (map, regions) = load();
    let (w, h) = (i64::from(map.w), i64::from(map.h));
    let mut rng = Rng(0x5167_47A1_90D3_1E57);
    let floor: Vec<(i64, i64)> = (0..h)
        .flat_map(|y| (0..w).map(move |x| (x, y)))
        .filter(|&(x, y)| map.tiles[(y * w + x) as usize] == 0)
        .collect();
    let world_w = w as f64 * TILE;
    let world_h = h as f64 * TILE;

    // ---- line-of-sight queries, in the shapes that matter: free points, grid-aligned and exact-corner lines, walls ----
    let mut blocked = Vec::with_capacity(BLOCKED_QUERIES);
    let mut push = |ax: f64, ay: f64, bx: f64, by: f64| {
        let b = scene_line_blocked(&map, ax, ay, bx, by);
        blocked.push(json!([ax, ay, bx, by, b]));
    };
    for i in 0..BLOCKED_QUERIES {
        let (tx, ty) = floor[rng.below(floor.len())];
        let (ax, ay) = match i % 5 {
            0 => (tx as f64 * TILE + 16.0, ty as f64 * TILE + 16.0), // tile centre
            1 => (tx as f64 * TILE, ty as f64 * TILE),               // exact tile corner
            _ => (
                (tx as f64 + rng.unit()) * TILE,
                (ty as f64 + rng.unit()) * TILE,
            ),
        };
        let reach = VISION_RADIUS * 1.5;
        let (bx, by) = match i % 7 {
            0 => {
                // exact multiple of a tile away on both axes: diagonals through tile corners
                let k = 1 + rng.below(24) as i64;
                let sx = if rng.below(2) == 0 { k } else { -k };
                let sy = if rng.below(2) == 0 { k } else { -k };
                (ax + sx as f64 * TILE, ay + sy as f64 * TILE)
            }
            1 => (ax + (rng.unit() * 2.0 - 1.0) * reach, ay), // horizontal
            2 => (ax, ay + (rng.unit() * 2.0 - 1.0) * reach), // vertical
            3 => {
                // the centre of any tile within reach (what the trail asks)
                let (cx, cy) = (rng.below(w as usize) as f64, rng.below(h as usize) as f64);
                (cx * TILE + 16.0, cy * TILE + 16.0)
            }
            _ => (
                ax + (rng.unit() * 2.0 - 1.0) * reach,
                ay + (rng.unit() * 2.0 - 1.0) * reach,
            ),
        };
        let (bx, by) = if i % 7 == 3 && i % 2 == 0 {
            // keep half of the tile-centre queries near the viewer, where the answer is interesting
            (
                ax + ((bx - ax) * 0.18).round(),
                ay + ((by - ay) * 0.18).round(),
            )
        } else {
            (bx, by)
        };
        push(ax, ay, bx, by);
    }
    // Edge cases: a wall start, an off-map end, negative coordinates, the world boundary, identical points.
    let wall = (0..h)
        .flat_map(|y| (0..w).map(move |x| (x, y)))
        .find(|&(x, y)| map.tiles[(y * w + x) as usize] == 1 && x > 3 && y > 3)
        .unwrap();
    let (fx, fy) = floor[floor.len() / 2];
    let (fcx, fcy) = (fx as f64 * TILE + 16.0, fy as f64 * TILE + 16.0);
    push(
        wall.0 as f64 * TILE + 16.0,
        wall.1 as f64 * TILE + 16.0,
        fcx,
        fcy,
    );
    push(
        fcx,
        fcy,
        wall.0 as f64 * TILE + 16.0,
        wall.1 as f64 * TILE + 16.0,
    );
    push(fcx, fcy, -5.0, fcy);
    push(fcx, fcy, fcx, -0.5);
    push(fcx, fcy, world_w, fcy);
    push(fcx, fcy, fcx, world_h + 4.0);
    push(fcx, fcy, world_w - 0.001, world_h - 0.001);
    push(fcx, fcy, fcx, fcy);
    push(fcx, fcy, fcx + 0.5, fcy);

    // ---- which tiles an origin reveals (the trail's per-tile rule, including the standing tile and the coliseum) ----
    let rect = map.layers().unwrap().coliseum().rect;
    let mut origins: Vec<Vec2> = Vec::new();
    // Inside the coliseum (region 6), at its middle and near a wall.
    origins.push(Vec2::new(2576.0, 2576.0));
    origins.push(Vec2::new(
        f64::from(rect.x) * TILE + 20.0,
        f64::from(rect.y) * TILE + 20.0,
    ));
    // Just outside it.
    origins.push(Vec2::new((f64::from(rect.x) - 2.0) * TILE + 7.5, 2576.0));
    // Standing at the radius boundary of a wall, on exact tile boundaries, and at random floor points.
    while origins.len() < REVEAL_ORIGINS {
        let (tx, ty) = floor[rng.below(floor.len())];
        let o = match origins.len() % 4 {
            0 => Vec2::new(tx as f64 * TILE, ty as f64 * TILE),
            1 => Vec2::new(tx as f64 * TILE + 16.0, ty as f64 * TILE + 16.0),
            _ => Vec2::new(
                (tx as f64 + rng.unit()) * TILE,
                (ty as f64 + rng.unit()) * TILE,
            ),
        };
        origins.push(o);
    }
    let mut reveals = Vec::new();
    for o in &origins {
        let (ox, oy) = ((o.x / TILE).floor() as i64, (o.y / TILE).floor() as i64);
        let (x0, y0) = ((ox - REVEAL_SPAN).max(0), (oy - REVEAL_SPAN).max(0));
        let (x1, y1) = ((ox + REVEAL_SPAN).min(w - 1), (oy + REVEAL_SPAN).min(h - 1));
        let (bw, bh) = (x1 - x0 + 1, y1 - y0 + 1);
        let mut bits = vec![0u8; ((bw * bh) as usize).div_ceil(8)];
        for y in y0..=y1 {
            for x in x0..=x1 {
                let centre = Vec2::new((x as f64 + 0.5) * TILE, (y as f64 + 0.5) * TILE);
                if reveals_tile(&map, *o, x, y, centre) {
                    let i = ((y - y0) * bw + (x - x0)) as usize;
                    bits[i / 8] |= 1 << (i % 8);
                }
            }
        }
        reveals.push(json!({
            "origin": [o.x, o.y], "x0": x0, "y0": y0, "w": bw, "h": bh, "bitsB64": base64(&bits),
            "inRadiusProbe": [in_radius(*o, Vec2::new(o.x + VISION_RADIUS, o.y)), in_radius(*o, Vec2::new(o.x + VISION_RADIUS + 0.001, o.y))],
        }));
    }

    json!({
        "format": FORMAT,
        "description": "Sight golden: rh-sim vision::scene_line_blocked on seed-1 and vision::reveals_tile. The C# VisionRule must answer every row identically. Regenerate with RH_WRITE_FIXTURES=1 cargo test -p rh-sim vision::golden.",
        "constants": {
            "visionRadius": VISION_RADIUS, "tile": TILE, "visionTrailMs": VISION_TRAIL_MS,
            "visionUpdateMs": VISION_UPDATE_MS, "tickMs": TICK_MS, "maskSight": MASK_SIGHT,
            "bushRevealRadius": BUSH_REVEAL_RADIUS, "bushRevealMs": BUSH_REVEAL_MS,
            "regionColiseum": 6,
        },
        "map": {
            "seed": 1, "w": w, "h": h,
            "tilesB64": base64(&map.tiles), "regionsB64": base64(&regions),
            "coliseumRect": [rect.x, rect.y, rect.w, rect.h],
        },
        "blocked": blocked,
        "reveals": reveals,
    })
}

#[test]
fn sight_golden_matches_the_committed_fixture() {
    let text = serde_json::to_string(&generate()).unwrap() + "\n";
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../protocol/fixtures/sight_v1.json");
    if std::env::var("RH_WRITE_FIXTURES").as_deref() == Ok("1") {
        std::fs::write(&path, &text).unwrap();
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == text,
        "protocol/fixtures/sight_v1.json is stale: run RH_WRITE_FIXTURES=1 cargo test -p rh-sim vision::golden"
    );
}

#[test]
fn the_golden_exercises_both_verdicts_and_the_coliseum() {
    let v = generate();
    let rows = v["blocked"].as_array().unwrap();
    let blocked = rows.iter().filter(|r| r[4] == true).count();
    assert!(
        blocked > rows.len() / 10 && blocked < rows.len() * 9 / 10,
        "{blocked} of {}",
        rows.len()
    );
    // The coliseum origin reveals its whole 18 x 18 rectangle.
    let c = &v["reveals"][0];
    assert_eq!(c["origin"][0], 2576.0);
}
