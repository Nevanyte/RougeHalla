//! P-NET-1 source-fixture integrity: the two committed client goldens under protocol/fixtures/ must be exactly what
//! the current integrated Rust core produces.
//!
//! pathfinding_v1.json (the C# pathfinder oracle) retains the seed-1 collision-only MapBlob bytes plus the 300
//! legacy findPath queries; server_walk_v1.json (the C# LocalMotion oracle) holds three corner walks of 241 per-tick
//! rows from rh-sim. This test decodes and re-encodes the MapBlob straight from the wire spec (rh-parity does not
//! depend on rh-protocol, and this packet adds no dependency), replays every pathfinding query through
//! rh_sim::pathfind, and rebuilds every walk from Sim::reset_active + one validated Move. A drift in the map encoding,
//! the layer hash, the pathfinder or the walk fails here instead of reaching a client.
//!
//! Fixtures are read from the repository (env!("CARGO_MANIFEST_DIR")/../../), like the rest of rh-parity. Tolerances:
//! 1e-6 on waypoint coordinates, exact (or at worst <=1e-12) on the recorded walk rows, 1e-9 on the final position.

use rh_parity::{load_paths, PATHFINDING_FORMAT};
use rh_sim::pathfind::Pathfinder;
use rh_sim::{
    validate, Arena, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, TileMap,
    Vec2,
};
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// The format of the pathfinding golden.
const PATH_GOLDEN_FORMAT: &str = "rh-pathfinding-golden/1";
/// The format of the server-walk golden.
const WALK_GOLDEN_FORMAT: &str = "rh-server-walk/1";
/// Waypoint tolerance: the task's 1e-6, one decimal tighter than rh_parity::TOL (2e-6).
const PATH_TOL: f64 = 1e-6;
/// The final walk position must reach its goal to within this.
const GOAL_TOL: f64 = 1e-9;
/// The seed-1 walk recorded at tickMs 50 and player speed 170.
const PLAYER_SPEED: f64 = 170.0;
const TICK_MS: f64 = 50.0;
const RADIUS: f64 = 12.0;
const TILE: f64 = 32.0;

type Point = [f64; 2];

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn protocol_fixture(name: &str) -> PathBuf {
    repo_path(&format!("protocol/fixtures/{name}"))
}

fn parity_pathfinding_fixture() -> PathBuf {
    repo_path("parity/fixtures/pathfinding_seed1.json")
}

fn load_json<T: for<'de> Deserialize<'de>>(path: &Path) -> T {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

// ---------------------------------------------------------------------------------------------------------------------
// Fixture shapes. Every golden struct denies unknown keys, so a key newly emitted by a generator fails loudly instead of
// being ignored (the same false-MATCH protection rh-parity uses). Fields only a generator records are declared so that
// check stays complete; not every metadata string is asserted here.

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[allow(dead_code)]
struct PathGolden {
    description: String,
    format: String,
    generated_from_commit: String,
    generator: String,
    map_blob: MapBlobJson,
    queries: Vec<PathQueryJson>,
    radius: f64,
    source: String,
    source_attempt: u32,
    source_format: String,
    source_map_hash_u32: u32,
    source_max_abs_coordinate_error: f64,
    source_seed: u32,
    tile: f64,
    tolerance: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MapBlobJson {
    w: u16,
    h: u16,
    hex: String,
    layer_hash: u32,
    run_count: u32,
    wire_bytes: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PathQueryJson {
    from: Point,
    to: Point,
    path: Vec<Point>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[allow(dead_code)]
struct WalkGolden {
    format: String,
    map: String,
    player_speed: f64,
    radius: f64,
    source: String,
    tick_ms: f64,
    cases: Vec<WalkCaseJson>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WalkCaseJson {
    name: String,
    query_index: u32,
    start: Point,
    goal: Point,
    waypoints: Vec<Point>,
    ticks: Vec<WalkTickJson>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WalkTickJson {
    t: f64,
    tick: u32,
    x: f64,
    y: f64,
    move_seq: u8,
}

/// The seed-1 map file the walk golden names (parity/maps/seed1.map.json): its rows and spawn pool build the arena.
/// The metadata fields are compared with the parity fixture; other rh-map/1 keys are not this test's concern.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedMapJson {
    w: usize,
    h: usize,
    tile: f64,
    map_hash_u32: u32,
    rows: Vec<String>,
    spawns: Vec<Point>,
}

// ---------------------------------------------------------------------------------------------------------------------
// MapBlob wire format (crates/rh-protocol/src/map.rs): w u16 LE, h u16 LE, layer_hash u32 LE, runs u32 LE, then runs of
// [tile u8, len u16 LE]; the hash is FNV-1a-32 over (w u32 LE, h u32 LE, tiles).

struct DecodedMapBlob {
    w: u16,
    h: u16,
    layer_hash: u32,
    runs: u32,
    tiles: Vec<u8>,
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn decode_hex(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    assert_eq!(bytes.len() % 2, 0, "hex string has an odd length");
    bytes
        .chunks_exact(2)
        .map(|pair| {
            let hi = hex_digit(pair[0])
                .unwrap_or_else(|| panic!("not a hex digit: {:?}", pair[0] as char));
            let lo = hex_digit(pair[1])
                .unwrap_or_else(|| panic!("not a hex digit: {:?}", pair[1] as char));
            (hi << 4) | lo
        })
        .collect()
}

fn decode_map_blob(hex: &str) -> DecodedMapBlob {
    let bytes = decode_hex(hex);
    assert!(
        bytes.len() >= 12,
        "MapBlob is shorter than its 12-byte header ({} bytes)",
        bytes.len()
    );
    let w = u16::from_le_bytes([bytes[0], bytes[1]]);
    let h = u16::from_le_bytes([bytes[2], bytes[3]]);
    let layer_hash = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let runs = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    assert_eq!(
        bytes.len(),
        12 + 3 * runs as usize,
        "header + {runs} runs of 3 bytes must be the whole blob ({} bytes)",
        bytes.len()
    );
    let total = w as usize * h as usize;
    let mut tiles = Vec::with_capacity(total);
    for k in 0..runs as usize {
        let at = 12 + 3 * k;
        let tile = bytes[at];
        let len = u16::from_le_bytes([bytes[at + 1], bytes[at + 2]]) as usize;
        assert!(tile <= 2, "run {k}: tile class {tile} is not 0/1/2");
        assert!(len != 0, "run {k}: zero-length run");
        assert!(
            tiles.len() + len <= total,
            "run {k}: lengths exceed w*h = {w}x{h} = {total}"
        );
        tiles.resize(tiles.len() + len, tile);
    }
    assert_eq!(
        tiles.len(),
        total,
        "run lengths sum to {} instead of w*h = {total}",
        tiles.len()
    );
    DecodedMapBlob {
        w,
        h,
        layer_hash,
        runs,
        tiles,
    }
}

fn fnv1a_layer_hash(w: u32, h: u32, tiles: &[u8]) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in w
        .to_le_bytes()
        .into_iter()
        .chain(h.to_le_bytes())
        .chain(tiles.iter().copied())
    {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

/// Appends the canonical runs of tiles (maximal stretches of one tile class, split at u16::MAX, exactly as the
/// protocol's Runs iterator); returns how many runs were written.
fn push_runs(out: &mut Vec<u8>, tiles: &[u8]) -> u32 {
    let mut runs = 0u32;
    let mut i = 0usize;
    while i < tiles.len() {
        let tile = tiles[i];
        let mut len = 1usize;
        while i + len < tiles.len() && tiles[i + len] == tile && len < u16::MAX as usize {
            len += 1;
        }
        out.push(tile);
        out.extend_from_slice(&(len as u16).to_le_bytes());
        runs += 1;
        i += len;
    }
    runs
}

/// The retained collision-prefix bytes, rebuilt from the decoded tiles. Protocol14 appends its separate ground section.
fn encode_map_blob(w: u16, h: u16, layer_hash: u32, tiles: &[u8]) -> (u32, Vec<u8>) {
    let mut out = Vec::new();
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&layer_hash.to_le_bytes());
    let count_at = out.len();
    out.extend_from_slice(&0u32.to_le_bytes());
    let runs = push_runs(&mut out, tiles);
    out[count_at..count_at + 4].copy_from_slice(&runs.to_le_bytes());
    (runs, out)
}

// ---------------------------------------------------------------------------------------------------------------------
// Tests

#[test]
fn pathfinding_v1_map_blob_retains_the_collision_prefix_encoding() {
    let golden: PathGolden = load_json(&protocol_fixture("pathfinding_v1.json"));
    assert_eq!(golden.format, PATH_GOLDEN_FORMAT);
    assert_eq!(golden.source_format, PATHFINDING_FORMAT);
    assert_eq!(golden.radius, RADIUS);
    assert_eq!(golden.tile, TILE);

    let (paths, _) = load_paths(&parity_pathfinding_fixture());
    assert_eq!(
        golden.source_map_hash_u32, paths.map_hash,
        "sourceMapHashU32 must be the parity fixture's legacy mapHashU32 (the MapBlob's layer hash is a different hash by design)"
    );
    assert_eq!(
        golden.source_seed, paths.seed,
        "the golden records a different source seed"
    );
    assert_eq!(
        golden.source_attempt, paths.attempt,
        "the golden records a different source attempt"
    );
    assert_eq!(
        golden.tile, paths.map.tile,
        "the golden's world tile differs from the parity fixture's"
    );
    assert_eq!(
        golden.tolerance, 2e-6,
        "the golden declares a different tolerance"
    );

    let blob = &golden.map_blob;
    let decoded = decode_map_blob(&blob.hex);
    assert_eq!(
        decoded.w, blob.w,
        "mapBlob.w does not match the wire header"
    );
    assert_eq!(
        decoded.h, blob.h,
        "mapBlob.h does not match the wire header"
    );
    assert_eq!(
        decoded.runs, blob.run_count,
        "mapBlob.runCount does not match the wire header"
    );
    assert_eq!(
        decoded.tiles.len(),
        decoded.w as usize * decoded.h as usize,
        "decoded tiles must cover w*h"
    );
    assert_eq!(
        blob.hex.len() / 2,
        blob.wire_bytes,
        "mapBlob.wireBytes does not match the hex length"
    );

    assert_eq!(
        decoded.layer_hash,
        fnv1a_layer_hash(decoded.w as u32, decoded.h as u32, &decoded.tiles),
        "mapBlob.layerHash is not FNV-1a-32 over (w u32 LE, h u32 LE, tiles)"
    );
    let map = TileMap::new(decoded.w as u32, decoded.h as u32, decoded.tiles.clone())
        .expect("the decoded MapBlob is a valid TileMap");
    assert_eq!(
        map.layer_hash(),
        blob.layer_hash,
        "rh_sim::TileMap::layer_hash differs from the golden's layerHash"
    );
    assert_eq!(map.layer_hash(), decoded.layer_hash);

    let (runs, bytes) = encode_map_blob(decoded.w, decoded.h, decoded.layer_hash, &decoded.tiles);
    assert_eq!(runs, blob.run_count, "re-encoding changed the run count");
    let golden_bytes = decode_hex(&blob.hex);
    assert_eq!(
        bytes.len(),
        golden_bytes.len(),
        "re-encoding changed the byte length"
    );
    if let Some(at) = bytes
        .iter()
        .zip(&golden_bytes)
        .position(|(ours, theirs)| ours != theirs)
    {
        panic!(
            "re-encoded MapBlob differs from the fixture hex at byte {at}: rust {:#04x} vs golden {:#04x}",
            bytes[at], golden_bytes[at]
        );
    }
    assert_eq!(
        bytes, golden_bytes,
        "re-encoded MapBlob is not byte-identical"
    );

    // The decoded tiles are the parity fixture's rows, exactly: '.' floor 0, '#' wall 1, '~' low 2.
    assert_eq!(
        paths.map.rows.len(),
        paths.map.h,
        "parity fixture row count"
    );
    let mut row_tiles = Vec::with_capacity(paths.map.w * paths.map.h);
    for (y, row) in paths.map.rows.iter().enumerate() {
        assert_eq!(
            row.chars().count(),
            paths.map.w,
            "parity fixture row {y} length"
        );
        for (x, ch) in row.chars().enumerate() {
            row_tiles.push(match ch {
                '.' => 0u8,
                '#' => 1,
                '~' => 2,
                other => panic!("parity fixture row {y} col {x}: unexpected {other:?}"),
            });
        }
    }
    assert_eq!(paths.map.w, decoded.w as usize, "parity fixture width");
    assert_eq!(paths.map.h, decoded.h as usize, "parity fixture height");
    assert_eq!(
        row_tiles.len(),
        decoded.tiles.len(),
        "parity rows and MapBlob cover a different number of tiles"
    );
    if let Some(at) = row_tiles
        .iter()
        .zip(&decoded.tiles)
        .position(|(row, blob)| row != blob)
    {
        panic!(
            "MapBlob tile {at} (x {}, y {}) is {} but the parity fixture row is {}",
            at % decoded.w as usize,
            at / decoded.w as usize,
            decoded.tiles[at],
            row_tiles[at]
        );
    }
    assert_eq!(
        row_tiles, decoded.tiles,
        "MapBlob tiles differ from the parity rows"
    );

    println!(
        "pathfinding_v1 map: {}x{}, {} runs, {} wire bytes, layerHash {:#010x} (FNV-1a-32), round-trip byte-identical, tiles equal to parity rows",
        decoded.w,
        decoded.h,
        decoded.runs,
        golden_bytes.len(),
        decoded.layer_hash
    );
}

#[test]
fn pathfinding_v1_queries_are_the_current_pathfinder() {
    let golden: PathGolden = load_json(&protocol_fixture("pathfinding_v1.json"));
    let (paths, map) = load_paths(&parity_pathfinding_fixture());
    assert_eq!(golden.format, PATH_GOLDEN_FORMAT);
    assert_eq!(golden.radius, RADIUS);
    assert_eq!(
        golden.queries.len(),
        300,
        "the golden carries the 300 captured legacy queries"
    );
    assert_eq!(
        paths.queries.len(),
        golden.queries.len(),
        "parity fixture query count differs from the golden"
    );

    // One pathfinder for all 300, exactly as rh_parity::compare_paths replays them.
    let mut pf = Pathfinder::default();
    let mut max_err = 0.0f64;
    let mut max_at = String::from("none");
    let mut diverged = 0usize;
    let mut report = Vec::new();
    for (k, (golden_query, parity_query)) in golden.queries.iter().zip(&paths.queries).enumerate() {
        assert_eq!(
            golden_query.from, parity_query.from,
            "query {k}: the golden's from differs from the parity fixture"
        );
        assert_eq!(
            golden_query.to, parity_query.to,
            "query {k}: the golden's to differs from the parity fixture"
        );
        let got = pf.find_path(
            &map,
            Vec2::new(parity_query.from[0], parity_query.from[1]),
            Vec2::new(parity_query.to[0], parity_query.to[1]),
            golden.radius,
        );
        if got.len() != golden_query.path.len() {
            diverged += 1;
            if report.len() < 10 {
                report.push(format!(
                    "query {k} ({:?} -> {:?}): {} waypoints vs golden {}",
                    parity_query.from,
                    parity_query.to,
                    got.len(),
                    golden_query.path.len()
                ));
            }
            continue;
        }
        let mut query_bad = None;
        for (j, (p, want)) in got.iter().zip(&golden_query.path).enumerate() {
            let dx = (p.x - want[0]).abs();
            let dy = (p.y - want[1]).abs();
            let err = dx.max(dy);
            if err > max_err {
                max_err = err;
                max_at = format!("query {k} waypoint {j}");
            }
            if (dx > PATH_TOL || dy > PATH_TOL) && query_bad.is_none() {
                query_bad = Some(format!(
                    "query {k} waypoint {j}: rust ({}, {}) vs golden ({}, {}) (dx {dx:e}, dy {dy:e})",
                    p.x, p.y, want[0], want[1]
                ));
            }
        }
        if let Some(bad) = query_bad {
            diverged += 1;
            if report.len() < 10 {
                report.push(bad);
            }
        }
    }
    assert_eq!(
        diverged, 0,
        "{diverged} of {} pathfinding queries diverge from the golden (max abs coordinate error {max_err:e} at {max_at}):\n  {}",
        golden.queries.len(),
        report.join("\n  ")
    );
    assert!(
        max_err <= PATH_TOL,
        "max abs coordinate error {max_err:e} at {max_at} exceeds {PATH_TOL:e}"
    );
    println!(
        "pathfinding_v1: {}/{} queries reproduced, max abs coordinate error {max_err:e} at {max_at}",
        golden.queries.len(),
        golden.queries.len()
    );
}

/// The state the walk golden records after one step (or before the first one).
struct WalkRow {
    t: f64,
    tick: u32,
    x: f64,
    y: f64,
    move_seq: u8,
}

fn record(sim: &Sim) -> WalkRow {
    let player = sim
        .player(PlayerId(1))
        .expect("the walk fixture seats one walker");
    let pos = player.pos();
    WalkRow {
        t: sim.server_time(),
        tick: sim.tick(),
        x: pos.x,
        y: pos.y,
        move_seq: player.motion.move_seq,
    }
}

#[test]
fn server_walk_v1_is_the_current_walk() {
    let golden: WalkGolden = load_json(&protocol_fixture("server_walk_v1.json"));
    assert_eq!(golden.format, WALK_GOLDEN_FORMAT);
    assert_eq!(
        golden.cases.len(),
        3,
        "the golden carries three corner walks"
    );
    assert_eq!(golden.player_speed, PLAYER_SPEED);
    assert_eq!(golden.tick_ms, TICK_MS);
    assert_eq!(golden.radius, RADIUS);

    let (paths, map) = load_paths(&parity_pathfinding_fixture());
    let seed_map: SeedMapJson = load_json(&repo_path(&golden.map));
    assert_eq!(
        seed_map.rows, paths.map.rows,
        "{} must hold the seed-1 rows the parity fixture records",
        golden.map
    );
    assert_eq!(seed_map.w, paths.map.w, "{} width", golden.map);
    assert_eq!(seed_map.h, paths.map.h, "{} height", golden.map);
    assert_eq!(seed_map.tile, paths.map.tile, "{} tile size", golden.map);
    assert_eq!(
        seed_map.map_hash_u32, paths.map_hash,
        "{} mapHashU32",
        golden.map
    );

    let names: Vec<&str> = golden.cases.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(
        names,
        ["corner-a", "corner-b", "corner-c"],
        "walk case names/order"
    );
    assert!(
        !seed_map.spawns.is_empty(),
        "{} carries no spawns for the arena",
        golden.map
    );
    let spawns: Vec<Vec2> = seed_map
        .spawns
        .iter()
        .map(|p| Vec2::new(p[0], p[1]))
        .collect();

    let mut pf = Pathfinder::default();
    for case in &golden.cases {
        let query = paths
            .queries
            .get(case.query_index as usize)
            .unwrap_or_else(|| {
                panic!(
                    "case {}: queryIndex {} is outside the parity fixture's {} queries",
                    case.name,
                    case.query_index,
                    paths.queries.len()
                )
            });
        assert_eq!(
            query.from, case.start,
            "case {}: start is not parity query {}",
            case.name, case.query_index
        );
        assert_eq!(
            query.to, case.goal,
            "case {}: goal is not parity query {}",
            case.name, case.query_index
        );
        assert_eq!(
            case.ticks.len(),
            241,
            "case {}: the golden records 241 per-tick rows",
            case.name
        );

        let arena = Arena {
            map: map.clone(),
            spawns: spawns.clone(),
        };
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arena,
            Secrets::from_seed(11),
            &[Placement {
                profile: "walker".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(case.start[0], case.start[1]),
                hp: None,
                weapon0: None,
                weapon1: None,
            }],
        );
        let command = validate(RawCommand::Move {
            x: case.goal[0],
            y: case.goal[1],
            seq: Some(1),
        })
        .expect("the golden's goal is a finite, in-world move");
        sim.submit(PlayerId(1), command)
            .expect("the walker accepts one move order");

        // The golden's first row is the reset state the order was submitted into (tick 1, time 50), before the first
        // step applies it; the remaining 240 rows are the 240 steps.
        let mut rows = Vec::with_capacity(241);
        rows.push(record(&sim));
        for _ in 0..240 {
            sim.step();
            rows.push(record(&sim));
        }
        assert_eq!(rows.len(), 241, "case {}: recorded rows", case.name);
        assert_eq!(
            rows.len(),
            case.ticks.len(),
            "case {}: recorded vs golden rows",
            case.name
        );

        let mut diverged = 0usize;
        let mut first: Option<String> = None;
        let mut max_t = 0.0f64;
        let mut max_x = 0.0f64;
        let mut max_y = 0.0f64;
        for (k, (got, want)) in rows.iter().zip(&case.ticks).enumerate() {
            max_t = max_t.max((got.t - want.t).abs());
            max_x = max_x.max((got.x - want.x).abs());
            max_y = max_y.max((got.y - want.y).abs());
            let mut diffs = Vec::new();
            if got.tick != want.tick {
                diffs.push(format!("tick {} vs {}", got.tick, want.tick));
            }
            if got.t != want.t {
                diffs.push(format!("t {} vs {}", got.t, want.t));
            }
            if got.x != want.x {
                diffs.push(format!("x {} vs {}", got.x, want.x));
            }
            if got.y != want.y {
                diffs.push(format!("y {} vs {}", got.y, want.y));
            }
            if got.move_seq != want.move_seq {
                diffs.push(format!("moveSeq {} vs {}", got.move_seq, want.move_seq));
            }
            if !diffs.is_empty() {
                diverged += 1;
                if first.is_none() {
                    first = Some(format!(
                        "row {k} (tick {}): {}",
                        want.tick,
                        diffs.join(", ")
                    ));
                }
            }
        }
        // serde_json writes shortest round-trip floats and rh-parity parses with float_roundtrip, so every recorded f64
        // must come back exactly; a value that round-tripped inexactly would still have to meet 1e-12 (max_* below).
        assert_eq!(
            diverged, 0,
            "case {}: {diverged}/{} rows differ from the golden (max |dt| {max_t:e}, |dx| {max_x:e}, |dy| {max_y:e}); first divergence: {}",
            case.name,
            rows.len(),
            first.as_deref().unwrap_or("none")
        );
        assert!(
            max_t <= 1e-12,
            "case {}: max |dt| {max_t:e} exceeds 1e-12",
            case.name
        );
        assert!(
            max_x <= 1e-12,
            "case {}: max |dx| {max_x:e} exceeds 1e-12",
            case.name
        );
        assert!(
            max_y <= 1e-12,
            "case {}: max |dy| {max_y:e} exceeds 1e-12",
            case.name
        );

        let last = rows.last().expect("241 rows");
        let goal_err = ((last.x - case.goal[0]).powi(2) + (last.y - case.goal[1]).powi(2)).sqrt();
        assert!(
            goal_err <= GOAL_TOL,
            "case {}: final position ({}, {}) is {goal_err:e} from the goal ({}, {})",
            case.name,
            last.x,
            last.y,
            case.goal[0],
            case.goal[1]
        );

        let got = pf.find_path(
            &map,
            Vec2::new(case.start[0], case.start[1]),
            Vec2::new(case.goal[0], case.goal[1]),
            golden.radius,
        );
        assert_eq!(
            got.len(),
            case.waypoints.len(),
            "case {}: {} waypoints vs golden {}",
            case.name,
            got.len(),
            case.waypoints.len()
        );
        let mut wp_err = 0.0f64;
        for (j, (p, want)) in got.iter().zip(&case.waypoints).enumerate() {
            let err = (p.x - want[0]).abs().max((p.y - want[1]).abs());
            wp_err = wp_err.max(err);
            assert!(
                err <= PATH_TOL,
                "case {} waypoint {j}: rust ({}, {}) vs golden ({}, {}) (error {err:e})",
                case.name,
                p.x,
                p.y,
                want[0],
                want[1]
            );
        }
        println!(
            "server_walk_v1 case {}: 241/241 rows exact (max |dt| {max_t:e}, |dx| {max_x:e}, |dy| {max_y:e}), final |pos-goal| {goal_err:e}, {} waypoints (max error {wp_err:e})",
            case.name,
            got.len()
        );
    }
}
