//! P-UNITY-FROST-WALL-1 Rust-native goldens for the Unity Frost Wall aim preview (not legacy parity): what
//! `rh_sim::barriers::wall_segment_for` and `wall_cells` give for a set of casters, cursors and small maps, so the C# mirror
//! (`client-unity/RoguehallaNet/Net/Ui/FrostWallAim.cs`) is checked against the sim itself (ADR 0008, the walk-prediction
//! precedent in `hitbox_goldens`). `cargo run -p rh-parity --bin frost-wall-aim-fixtures` writes
//! `protocol/fixtures/frost_wall_aim_v1.json`; `--check` (and `tests/frost_wall_aim_golden.rs`) fails when the committed
//! file differs from what the current core produces.
//!
//! Each case's map is the body map the server reads at the landing (open map, closed gates as WALL, standing walls LOW);
//! the gate case also lists the open map and its gate tiles, so the client's plan-map step can be checked too.

use rh_sim::abilities::{FROST_WALL_LENGTH, FROST_WALL_MIN_RANGE, FROST_WALL_RANGE};
use rh_sim::barriers::{wall_cells, wall_segment_for, WALL_CELL_REACH, WALL_END_SLACK};
use rh_sim::constants::TILE;
use rh_sim::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
use rh_sim::{TileMap, Vec2};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const FROST_WALL_AIM_FILE: &str = "protocol/fixtures/frost_wall_aim_v1.json";

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

/// Tile centre in world units.
fn tc(t: u32) -> f64 {
    f64::from(t) * TILE + TILE / 2.
}

/// An open room with a wall border.
fn room(w: u32, h: u32) -> Vec<u8> {
    let mut tiles = vec![TILE_FLOOR; (w * h) as usize];
    for x in 0..w {
        tiles[x as usize] = TILE_WALL;
        tiles[((h - 1) * w + x) as usize] = TILE_WALL;
    }
    for y in 0..h {
        tiles[(y * w) as usize] = TILE_WALL;
        tiles[(y * w + w - 1) as usize] = TILE_WALL;
    }
    tiles
}

/// A closed-gate map's open tiles and the gate tiles it sets to WALL.
type Gates = (Vec<u8>, Vec<(u32, u32)>);

struct MapCase {
    name: &'static str,
    w: u32,
    h: u32,
    tiles: Vec<u8>,
    /// For the gate map: the open map and the gate tiles the closed map sets to WALL.
    gates: Option<Gates>,
}

fn maps() -> Vec<MapCase> {
    let (w, h) = (40, 20);
    let mut rock = room(w, h);
    for y in 0..h {
        for x in 10..=14 {
            rock[(y * w + x) as usize] = TILE_WALL;
        }
    }
    let mut low = room(w, h);
    low[(9 * w + 12) as usize] = TILE_LOW;
    low[(10 * w + 12) as usize] = TILE_LOW;
    low[(11 * w + 12) as usize] = TILE_WALL;
    let open_gate = room(w, h);
    let gate_tiles: Vec<(u32, u32)> = (8..=11).map(|y| (12, y)).collect();
    let mut closed = open_gate.clone();
    for &(x, y) in &gate_tiles {
        closed[(y * w + x) as usize] = TILE_WALL;
    }
    vec![
        MapCase {
            name: "room",
            w,
            h,
            tiles: room(w, h),
            gates: None,
        },
        MapCase {
            name: "rock",
            w,
            h,
            tiles: rock,
            gates: None,
        },
        MapCase {
            name: "low",
            w,
            h,
            tiles: low,
            gates: None,
        },
        MapCase {
            name: "gate_closed",
            w,
            h,
            tiles: closed,
            gates: Some((open_gate, gate_tiles)),
        },
        MapCase {
            name: "open",
            w: 10,
            h: 10,
            tiles: vec![TILE_FLOOR; 100],
            gates: None,
        },
    ]
}

/// (name, map, from, cursor, facing)
fn cases() -> Vec<(&'static str, &'static str, Vec2, Vec2, f64)> {
    let at = |x: f64, y: f64| Vec2::new(x, y);
    vec![
        ("axis", "room", at(tc(5), tc(10)), at(tc(12), tc(10)), 0.),
        (
            "inside_min_range",
            "room",
            at(tc(5), tc(10)),
            at(tc(5) + 20., tc(10)),
            0.,
        ),
        (
            "beyond_range",
            "room",
            at(tc(5), tc(10)),
            at(tc(5) + 1000., tc(10) + 100.),
            0.,
        ),
        ("diagonal", "room", at(tc(5), tc(5)), at(tc(12), tc(10)), 0.),
        (
            "cursor_on_caster",
            "room",
            at(tc(20), tc(10)),
            at(tc(20), tc(10)),
            2.,
        ),
        (
            "into_rock",
            "rock",
            at(tc(5), tc(10)),
            at(tc(12), tc(10)),
            0.,
        ),
        (
            "partly_low",
            "low",
            at(tc(5), tc(10)),
            at(tc(12), tc(10)),
            0.,
        ),
        (
            "closed_gate",
            "gate_closed",
            at(tc(5), tc(10)),
            at(tc(12), tc(10)),
            0.,
        ),
        ("top_edge", "open", at(tc(2), tc(1)), at(tc(6), tc(1)), 0.),
        ("right_edge", "open", at(tc(8), tc(2)), at(tc(8), tc(6)), 0.),
        // The wall's first end at y 360: row 11's centre (368) is exactly WALL_END_SLACK past it (taken, inclusive)...
        (
            "end_slack_inclusive",
            "room",
            at(tc(5), 248.),
            at(tc(12), 248.),
            0.,
        ),
        // ...and 1 u further, 9 u past it (not taken).
        (
            "end_slack_just_out",
            "room",
            at(tc(5), 247.),
            at(tc(12), 247.),
            0.,
        ),
    ]
}

/// `protocol/fixtures/frost_wall_aim_v1.json`.
pub fn frost_wall_aim_json() -> String {
    let maps = maps();
    let map_rows: Vec<Value> = maps
        .iter()
        .map(|m| {
            let mut row = json!({"name": m.name, "w": m.w, "h": m.h, "tiles": m.tiles});
            if let Some((open, gates)) = &m.gates {
                row["openTiles"] = json!(open);
                row["gateTiles"] = json!(gates
                    .iter()
                    .map(|&(x, y)| json!([x, y]))
                    .collect::<Vec<_>>());
            }
            row
        })
        .collect();
    let mut cells = Vec::new();
    let case_rows: Vec<Value> = cases()
        .into_iter()
        .map(|(name, map, from, cursor, facing)| {
            let m = maps.iter().find(|m| m.name == map).expect("case map");
            let tm = TileMap::new(m.w, m.h, m.tiles.clone()).expect("map");
            let seg = wall_segment_for(
                from,
                cursor,
                FROST_WALL_RANGE,
                FROST_WALL_MIN_RANGE,
                FROST_WALL_LENGTH,
                facing,
            );
            wall_cells(&tm, &seg, &mut cells);
            json!({
                "name": name,
                "map": map,
                "from": [from.x, from.y],
                "cursor": [cursor.x, cursor.y],
                "facing": facing,
                "segment": {"cx": seg.cx, "cy": seg.cy, "x1": seg.x1, "y1": seg.y1, "x2": seg.x2, "y2": seg.y2},
                "cells": cells,
            })
        })
        .collect();
    let v = json!({
        "format": "rh-frost-wall-aim/1",
        "generator": "cargo run -p rh-parity --bin frost-wall-aim-fixtures",
        "tile": TILE,
        "numbers": {
            "range": FROST_WALL_RANGE,
            "minRange": FROST_WALL_MIN_RANGE,
            "length": FROST_WALL_LENGTH,
            "cellReach": WALL_CELL_REACH,
            "endSlack": WALL_END_SLACK,
        },
        "maps": map_rows,
        "cases": case_rows,
    });
    let mut s = serde_json::to_string_pretty(&v).expect("json");
    s.push('\n');
    s
}

pub fn all() -> Vec<(&'static str, String)> {
    vec![(FROST_WALL_AIM_FILE, frost_wall_aim_json())]
}

/// Writes the golden (`check == false`) or lists the files that differ from the committed ones.
pub fn write_or_check(check: bool) -> Vec<&'static str> {
    let mut stale = Vec::new();
    for (path, text) in all() {
        let full = repo(path);
        if check {
            if std::fs::read_to_string(&full).ok().as_deref() != Some(text.as_str()) {
                stale.push(path);
            }
        } else {
            std::fs::write(&full, text).unwrap_or_else(|e| panic!("{}: {e}", full.display()));
        }
    }
    stale
}
