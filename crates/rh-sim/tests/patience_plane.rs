//! P-WIRE17-MAP-2 oracle (sim): the camp patience plane is legacy's `campPatienceOutline` rule applied tile by tile, and
//! the sim's public leash predicate is legacy's `leashOk`.
//!
//! The reference below is transcribed from legacy, reading the map export's JSON (not the Rust map types):
//! `packages/shared/src/mobs.ts:230-262` (`territoryAt`, `territoryLeash`, `leashOk`),
//! `packages/shared/src/constants.ts:539,541` (`MOB_LEASH_RADIUS = MOB_LEASH_CAP = 24 * TILE`), and
//! `packages/client/src/render/CampPatience.ts:18-33` (a tile of camp `i`'s territory whose centre is in the leash of at
//! least one of the camp's spots; nothing for a camp with `area <= 0` or no spots).
//!
//! Loose proof (owner direction 2026-11-10): legacy's own `leashOk` run on this map (scratch, `tsx` on
//! `packages/shared/src/mobs.ts`, Node 25, not a capture) gives camp 0 652 tiles and 24 669 tiles over the 50 camps,
//! with no tile in two camps' ranges; the plane must be within 5% of both. The exact checks compare against the
//! transcription.
//!
//! No `const` here: `tests/content.rs` rejects numeric consts in this crate's test files.

use rh_sim::mapdata::patience::{leash_ok, patience_plane};
use rh_sim::mapdata::{LayerData, MapExport};
use rh_sim::Vec2;
use serde_json::Value;

fn tile() -> f64 {
    32.0
}
fn leash_cap() -> f64 {
    24.0 * tile()
}
fn leash_radius() -> f64 {
    24.0 * tile()
}

fn export_json() -> Value {
    serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap()
}

fn layers() -> LayerData {
    let export: MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    let arena = export.validate().unwrap().into_arena().unwrap();
    arena
        .map
        .layers()
        .expect("seed 1 carries layers")
        .data()
        .clone()
}

/// Legacy `GameMap` fields the rule reads, straight from the JSON.
struct Legacy {
    w: i64,
    h: i64,
    territory: Vec<u64>,
    camps: Vec<LegacyCamp>,
}

/// (area, radius, spots)
type LegacyCamp = (f64, f64, Vec<(f64, f64)>);

fn legacy() -> Legacy {
    let v = export_json();
    let m = &v["map"];
    Legacy {
        w: m["w"].as_i64().unwrap(),
        h: m["h"].as_i64().unwrap(),
        territory: m["territoryGrid"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_u64().unwrap())
            .collect(),
        camps: m["camps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                (
                    c["area"].as_f64().unwrap(),
                    c["radius"].as_f64().unwrap(),
                    c["spots"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|s| (s["x"].as_f64().unwrap(), s["y"].as_f64().unwrap()))
                        .collect(),
                )
            })
            .collect(),
    }
}

impl Legacy {
    /// `territoryAt`: worldToTile is `Math.floor(v / TILE)`.
    fn territory_at(&self, x: f64, y: f64) -> u64 {
        let tx = (x / tile()).floor() as i64;
        let ty = (y / tile()).floor() as i64;
        if tx < 0 || ty < 0 || tx >= self.w || ty >= self.h {
            return 0;
        }
        self.territory[(ty * self.w + tx) as usize]
    }
    /// `territoryLeash(map, campRef, home)`.
    fn territory_leash(&self, camp_ref: u64, home: (f64, f64)) -> f64 {
        if camp_ref < 1 {
            return 0.0;
        }
        let Some((area, radius, _)) = self.camps.get(camp_ref as usize - 1) else {
            return 0.0;
        };
        // `!(camp.area > 0)`, NaN included.
        if area.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater)
            || self.territory_at(home.0, home.1) != camp_ref
        {
            return 0.0;
        }
        radius.min(leash_cap())
    }
    /// `leashOk(map, campRef, home, p, margin)`.
    fn leash_ok(&self, camp_ref: u64, home: (f64, f64), p: (f64, f64), margin: f64) -> bool {
        let reach = self.territory_leash(camp_ref, home);
        let d = rh_sim::math::hypot(p.0 - home.0, p.1 - home.1);
        if reach == 0.0 {
            return d <= leash_radius() - margin;
        }
        if d > reach - margin || self.territory_at(p.0, p.1) != camp_ref {
            return false;
        }
        if margin <= 0.0 {
            return true;
        }
        [
            (p.0 + margin, p.1),
            (p.0 - margin, p.1),
            (p.0, p.1 + margin),
            (p.0, p.1 - margin),
        ]
        .iter()
        .all(|&(x, y)| self.territory_at(x, y) == camp_ref)
    }
    /// `campPatienceOutline`'s `inside` grid, every camp folded into one plane (camps never share a territory cell).
    fn plane(&self) -> Vec<u8> {
        let mut out = vec![0u8; (self.w * self.h) as usize];
        for (ci, (area, _, spots)) in self.camps.iter().enumerate() {
            let r = ci as u64 + 1;
            if *area <= 0.0 || spots.is_empty() {
                continue;
            }
            for ty in 0..self.h {
                for tx in 0..self.w {
                    let i = (ty * self.w + tx) as usize;
                    if self.territory[i] != r {
                        continue;
                    }
                    let at = ((tx as f64 + 0.5) * tile(), (ty as f64 + 0.5) * tile());
                    if spots.iter().any(|&home| self.leash_ok(r, home, at, 0.0)) {
                        assert_eq!(out[i], 0, "two camps on one tile");
                        out[i] = r as u8;
                    }
                }
            }
        }
        out
    }
}

#[test]
fn the_plane_is_legacys_rule_tile_by_tile() {
    let data = layers();
    let want = legacy().plane();
    let got = patience_plane(&data);
    assert_eq!(got.len(), want.len(), "one byte per tile");
    let differ = got.iter().zip(&want).filter(|(a, b)| a != b).count();
    assert_eq!(
        differ, 0,
        "tiles where the plane and legacy's rule disagree"
    );
}

#[test]
fn loose_proof_the_tile_counts_are_legacys() {
    let got = patience_plane(&layers());
    let camp0 = got.iter().filter(|&&v| v == 1).count() as f64;
    let covered = got.iter().filter(|&&v| v != 0).count() as f64;
    // Legacy leashOk on this map: camp 0 652 tiles, 24 669 tiles in all (see the module doc); within 5%.
    assert!(
        (camp0 - 652.0).abs() <= 0.05 * 652.0,
        "camp 0 covers {camp0} tiles; legacy 652"
    );
    assert!(
        (covered - 24_669.0).abs() <= 0.05 * 24_669.0,
        "the plane covers {covered} tiles; legacy 24 669"
    );
}

#[test]
fn a_camps_centre_carries_its_index_and_its_range_stays_inside_the_cap() {
    let data = layers();
    let plane = patience_plane(&data);
    let w = data.w as usize;
    let camp = &data.camps[0];
    let (cx, cy) = (
        (camp.x / tile()).floor() as usize,
        (camp.y / tile()).floor() as usize,
    );
    assert_eq!(plane[cy * w + cx], 1, "camp 0's centre tile");
    // No tile of camp 0's range lies beyond MOB_LEASH_CAP of every spot of camp 0 (so a tile two leash radii away is never
    // camp 0's).
    for (i, &v) in plane.iter().enumerate() {
        if v != 1 {
            continue;
        }
        let at = (
            ((i % w) as f64 + 0.5) * tile(),
            ((i / w) as f64 + 0.5) * tile(),
        );
        assert!(
            camp.spots
                .iter()
                .any(|s| rh_sim::math::hypot(at.0 - s.x, at.1 - s.y) <= leash_cap()),
            "tile {i} is camp 0's but beyond every spot's cap"
        );
    }
    // Every value names a camp of the map.
    assert!(plane.iter().all(|&v| usize::from(v) <= data.camps.len()));
}

#[test]
fn the_public_leash_predicate_is_legacys_leash_ok() {
    let data = layers();
    let legacy = legacy();
    let w = data.w as usize;
    let h = data.h as usize;
    // 100 tiles in a fixed stride across the map, each tested against the spots of the camp that owns it (or camp 0),
    // the first spot of every other camp, at margins 0 and 20 (a ranged mob's retreat), and one point off the map.
    let mut checked = 0;
    let mut inside = 0;
    for k in 0..100usize {
        let i = (k * 7919 + 1237) % (w * h);
        let p = (
            ((i % w) as f64 + 0.5) * tile(),
            ((i / w) as f64 + 0.5) * tile(),
        );
        let owner = legacy.territory[i] as usize;
        let camps = [owner.saturating_sub(1), (k % data.camps.len())];
        for ci in camps {
            for home in &data.camps[ci].spots {
                for margin in [0.0, 20.0] {
                    let want = legacy.leash_ok(ci as u64 + 1, (home.x, home.y), p, margin);
                    let got = leash_ok(
                        &data,
                        ci as u32,
                        Vec2::new(home.x, home.y),
                        Vec2::new(p.0, p.1),
                        margin,
                    );
                    assert_eq!(
                        got, want,
                        "tile {i}, camp {ci}, home {home:?}, margin {margin}"
                    );
                    checked += 1;
                    inside += usize::from(want);
                }
            }
        }
    }
    assert!(
        checked >= 400 && inside > 0,
        "{checked} checks, {inside} inside"
    );
    // A home outside its camp's territory keeps the MOB_LEASH_RADIUS circle (`territoryLeash` 0).
    let off = Vec2::new(-1000.0, -1000.0);
    assert!(leash_ok(
        &data,
        0,
        off,
        Vec2::new(-1000.0 + 700.0, -1000.0),
        0.0
    ));
    assert!(!leash_ok(
        &data,
        0,
        off,
        Vec2::new(-1000.0 + 800.0, -1000.0),
        0.0
    ));
}
