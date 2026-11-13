//! P-FROST-WALL-1 oracle: Frost Wall in the sim behind `SimConfig::frost_wish` (default `Freeze`). The numbers are worked
//! from unreleased legacy 78dd8bd4 (`packages/shared/src/barriers.ts`, `packages/shared/test/barriers.test.ts`,
//! `packages/server/test/frostWall.test.ts`): a loose proof (owner direction 2026-11-10), one test per rule of the brief.
use super::*;
use crate::{
    abilities::{self as a, Slot},
    arenas::practice_arena,
    constants::{PLAYER_RADIUS, TICK_MS},
    geometry::{circle_clear, has_line_of_sight, ray_blocked},
    input::RawCommand,
    map::{MASK_MELEE, MASK_MOVE, MASK_SIGHT, TILE_LOW, TILE_WALL},
    status_runtime::{FieldKind, FieldSelector},
    Arena, FactionId, FrostWish, Placement, PlayerId, Secrets, Sim, SimConfig,
};

fn w_tiles() -> u32 {
    40
}
fn h_tiles() -> u32 {
    20
}
/// Tile centre in world units.
fn tc(t: u32) -> f64 {
    f64::from(t) * TILE + TILE / 2.
}

/// An open room with a wall border (legacy frostWall.test.ts `roomMap`).
fn room_map(w: u32, h: u32) -> TileMap {
    let mut tiles = vec![TILE_FLOOR; (w * h) as usize];
    for x in 0..w {
        tiles[x as usize] = TILE_WALL;
        tiles[((h - 1) * w + x) as usize] = TILE_WALL;
    }
    for y in 0..h {
        tiles[(y * w) as usize] = TILE_WALL;
        tiles[(y * w + w - 1) as usize] = TILE_WALL;
    }
    TileMap::new(w, h, tiles).unwrap()
}

fn room() -> Arena {
    Arena {
        map: room_map(w_tiles(), h_tiles()),
        spawns: (0..8).map(|i| Vec2::new(tc(3 + i), tc(3))).collect(),
    }
}

fn config(wish: FrostWish) -> SimConfig {
    SimConfig {
        abilities: a::Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: wish,
        ..Default::default()
    }
}

/// A Frost caster and a Fire bystander, both with a huge pool so nothing goes down.
fn rig(wish: FrostWish, caster: Vec2, other: Vec2) -> Sim {
    let p = |i: usize, faction: FactionId, at: Vec2| Placement {
        profile: format!("p{i}"),
        faction,
        bot: false,
        at,
        hp: None,
        weapon0: None,
        weapon1: None,
    };
    let mut s = Sim::reset_active(
        config(wish),
        room(),
        Secrets::from_seed(7),
        &[p(0, FactionId::Frost, caster), p(1, FactionId::Fire, other)],
    );
    s.step();
    s
}

fn id(s: &Sim, i: usize) -> PlayerId {
    s.players()[i].id
}

fn cast_at(s: &mut Sim, x: f64, y: f64) {
    let who = id(s, 0);
    let cmd = crate::validate(RawCommand::Cast {
        slot: Slot::Wish,
        x,
        y,
        id: None,
        t: None,
        seq: None,
    })
    .unwrap();
    s.submit(who, cmd).unwrap();
}

fn run_for(s: &mut Sim, ms: f64) {
    let end = s.server_time() + ms;
    while s.server_time() < end {
        s.step();
    }
}

fn walls(s: &Sim) -> Vec<crate::status_runtime::Field> {
    s.w.abilities
        .as_ref()
        .map(|a| {
            a.fields
                .iter()
                .filter(|f| f.kind == FieldKind::Wall)
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

fn barrier_cells(s: &Sim) -> Vec<u32> {
    s.w.abilities
        .as_ref()
        .map(|a| a.barriers.0.iter().flat_map(|b| b.cells.clone()).collect())
        .unwrap_or_default()
}

/// The map the body, swing and path queries read now.
fn body_tiles(s: &Sim) -> Vec<u8> {
    let held = held(&s.w);
    body_map(&s.k, &held, s.w.rt.gates_locked).tiles.clone()
}

/// The legacy cast: Frost at (5, 10) aims east at (12, 10); the wall stands across the row at column 12.
fn raised() -> Sim {
    let mut s = rig(
        FrostWish::Wall,
        Vec2::new(tc(5), tc(10)),
        Vec2::new(tc(30), tc(3)),
    );
    cast_at(&mut s, tc(12), tc(10));
    run_for(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    s
}

// ---- the pure rule (legacy shared/test/barriers.test.ts) ----

#[test]
fn wall_segment_centres_on_the_clamped_aim_square_to_the_caster() {
    let s = wall_segment_for(Vec2::new(0., 0.), Vec2::new(1000., 0.), 300., 50., 200., 0.);
    assert!((s.cx - 300.).abs() < 1e-9 && s.cy.abs() < 1e-9, "{s:?}");
    assert!((s.x1 - 300.).abs() < 1e-9 && (s.x2 - 300.).abs() < 1e-9);
    assert!(
        ((s.y1 - s.y2).abs() - 200.).abs() < 1e-9,
        "200 long, across the aim"
    );
    // Inside the minimum range: clamped out to it.
    let near = wall_segment_for(Vec2::new(0., 0.), Vec2::new(10., 0.), 300., 50., 200., 0.);
    assert!((near.cx - 50.).abs() < 1e-9, "{near:?}");
    // The Frost Wall numbers: a cursor 20 u away stands the wall FROST_WALL_MIN_RANGE (64) out.
    let frost = wall_segment_for(
        Vec2::new(100., 100.),
        Vec2::new(120., 100.),
        a::FROST_WALL_RANGE,
        a::FROST_WALL_MIN_RANGE,
        a::FROST_WALL_LENGTH,
        0.,
    );
    assert!((frost.cx - 164.).abs() < 1e-9 && (frost.cy - 100.).abs() < 1e-9);
    // A cursor on the caster aims along the facing.
    let s = wall_segment_for(
        Vec2::new(100., 100.),
        Vec2::new(100., 100.),
        300.,
        64.,
        100.,
        std::f64::consts::FRAC_PI_2,
    );
    assert!(
        (s.cx - 100.).abs() < 1e-9 && (s.cy - 164.).abs() < 1e-9,
        "{s:?}"
    );
}

#[test]
fn an_axis_aligned_wall_takes_seven_floor_tiles_in_one_column() {
    let map = room_map(w_tiles(), h_tiles());
    let seg = wall_segment_for(
        Vec2::new(tc(5), tc(10)),
        Vec2::new(tc(12), tc(10)),
        a::FROST_WALL_RANGE,
        a::FROST_WALL_MIN_RANGE,
        a::FROST_WALL_LENGTH,
        0.,
    );
    let mut cells = Vec::new();
    wall_cells(&map, &seg, &mut cells);
    // 224 long centred on row 10: tile centres within 112 + 8 of it, rows 7..=13, all in column 12.
    let expected: Vec<u32> = (7..=13).map(|y| y * w_tiles() + 12).collect();
    assert_eq!(cells, expected);
    // Into the border wall: the wall's tiles are floor only.
    let long = wall_segment_for(
        Vec2::new(tc(5), tc(10)),
        Vec2::new(tc(12), tc(10)),
        a::FROST_WALL_RANGE,
        0.,
        TILE * 30.,
        0.,
    );
    wall_cells(&map, &long, &mut cells);
    assert_eq!(cells.len() as u32, h_tiles() - 2);
    assert!(cells.iter().all(|&i| map.tiles[i as usize] == TILE_FLOOR));
    assert!(cells.windows(2).all(|p| p[0] < p[1]), "ascending");
}

#[test]
fn a_diagonal_wall_is_a_closed_staircase() {
    let (w, h) = (20, 12);
    let map = room_map(w, h);
    let seg = wall_segment_for(
        Vec2::new(tc(3), tc(3)),
        Vec2::new(tc(9), tc(7)),
        400.,
        0.,
        TILE * 6.,
        0.,
    );
    let mut cells = Vec::new();
    wall_cells(&map, &seg, &mut cells);
    assert!(cells.len() >= 6, "a diagonal wall takes tiles: {cells:?}");
    for &i in &cells {
        let (x, y) = (i % w, i / w);
        for (dx, dy) in [(1i64, 1i64), (1, -1)] {
            let (nx, ny) = (i64::from(x) + dx, i64::from(y) + dy);
            let j = (ny * i64::from(w) + nx) as u32;
            if !cells.contains(&j) {
                continue;
            }
            // A diagonal neighbour in the wall shares an orthogonal neighbour in it too: no corner gap.
            let side = (i64::from(y) * i64::from(w) + nx) as u32;
            let below = (ny * i64::from(w) + i64::from(x)) as u32;
            assert!(
                cells.contains(&side) || cells.contains(&below),
                "corner gap at {x},{y}"
            );
        }
    }
}

// ---- the sim, switch on (legacy server/test/frostWall.test.ts) ----

#[test]
fn a_frost_wish_raises_a_wall_whose_tiles_are_low_for_four_seconds() {
    let mut s = raised();
    let f = walls(&s);
    assert_eq!(f.len(), 1, "one wall field");
    assert_eq!(f[0].ends_at - f[0].started_at, a::FROST_WALL_MS);
    let expected: Vec<u32> = (7..=13).map(|y| y * w_tiles() + 12).collect();
    assert_eq!(barrier_cells(&s), expected);
    let tiles = body_tiles(&s);
    for &i in &expected {
        assert_eq!(
            tiles[i as usize], TILE_LOW,
            "tile {i} is LOW while the wall stands"
        );
        assert_eq!(
            s.k.arena.map.tiles[i as usize], TILE_FLOOR,
            "the arena itself never changes"
        );
    }
    run_for(&mut s, a::FROST_WALL_MS + TICK_MS);
    assert!(walls(&s).is_empty(), "the wall falls at its time");
    assert!(barrier_cells(&s).is_empty());
    assert!(held(&s.w).is_none(), "no overlay once it fell");
    assert!(expected
        .iter()
        .all(|&i| body_tiles(&s)[i as usize] == TILE_FLOOR));
}

#[test]
fn a_far_cursor_stands_the_wall_at_its_range() {
    let mut s = rig(
        FrostWish::Wall,
        Vec2::new(tc(3), tc(10)),
        Vec2::new(tc(30), tc(3)),
    );
    cast_at(&mut s, tc(38), tc(10));
    run_for(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    let cells = barrier_cells(&s);
    assert!(!cells.is_empty(), "a wall stood up");
    let x = cells[0] % w_tiles();
    assert!(
        (tc(x) - (tc(3) + a::FROST_WALL_RANGE)).abs() <= TILE,
        "column {x} is about FROST_WALL_RANGE from the caster"
    );
}

#[test]
fn a_walk_ordered_across_a_standing_wall_goes_round_it() {
    let mut s = rig(
        FrostWish::Wall,
        Vec2::new(tc(5), tc(16)),
        Vec2::new(tc(8), tc(10)),
    );
    // Aimed due east from (5, 16): the wall stands in column 12, rows 13..=18 (row 19 is the border).
    cast_at(&mut s, tc(12), tc(16));
    run_for(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    // The walker's straight line from (8, 10) to (16, 17) crosses column 12 at row ~13.5: through the ice.
    assert_eq!(walls(&s).len(), 1, "a wall stands");
    let walker = id(&s, 1);
    let goal = Vec2::new(tc(16), tc(17));
    s.submit(
        walker,
        crate::validate(RawCommand::Move {
            x: goal.x,
            y: goal.y,
            seq: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut inside = 0;
    for _ in 0..60 {
        s.step();
        let p = s.players()[1].pos();
        let held = held(&s.w);
        let map = body_map(&s.k, &held, s.w.rt.gates_locked);
        if !circle_clear(map, p, PLAYER_RADIUS - 1., MASK_MOVE) {
            inside += 1;
        }
    }
    assert!(
        !walls(&s).is_empty(),
        "the wall still stands: the walk went round, not after"
    );
    assert_eq!(inside, 0, "ticks the walker overlapped the ice");
    let p = s.players()[1].pos();
    assert!(
        crate::math::hypot(p.x - goal.x, p.y - goal.y) < TILE,
        "it got where it was going, round the wall: {p:?}"
    );
}

#[test]
fn swings_and_bodies_stop_at_the_wall_and_sight_and_shots_pass() {
    let s = raised();
    let held = held(&s.w);
    let map = body_map(&s.k, &held, s.w.rt.gates_locked);
    let (west, east) = (Vec2::new(tc(11), tc(10)), Vec2::new(tc(13), tc(10)));
    assert!(
        ray_blocked(map, west.x, west.y, east.x, east.y, MASK_MELEE),
        "a swing across the wall is stopped"
    );
    assert!(
        !crate::geometry::segment_clear(map, west, east, PLAYER_RADIUS, MASK_MOVE),
        "a body cannot pass"
    );
    assert!(
        has_line_of_sight(map, west, east, MASK_SIGHT),
        "sight and shots (MASK_SIGHT) pass over it"
    );
}

#[test]
fn the_wall_outlives_its_caster() {
    let s = raised();
    let f = &walls(&s)[0];
    assert!(
        !FieldSelector::Departed(id(&s, 0)).matches(f),
        "a wall is not ended by its caster leaving or going down"
    );
}

// ---- the switch, save, restore and hash ----

#[test]
fn the_switch_serializes_as_nothing_by_default_and_as_its_own_tag_when_on() {
    use serde_json::{json, Value};
    assert_eq!(SimConfig::default().frost_wish, FrostWish::Freeze);
    assert_eq!(
        serde_json::to_value(FrostWish::Freeze).unwrap(),
        Value::Null
    );
    assert_eq!(
        serde_json::to_value(FrostWish::Wall).unwrap(),
        json!("wall")
    );
    assert!(serde_json::from_value::<FrostWish>(json!("frost_wish=wall")).is_err());
    use crate::hash::hash_of;
    assert_eq!(hash_of(0, &FrostWish::Freeze), hash_of(0, &()));
    assert_eq!(hash_of(0, &FrostWish::Wall), hash_of(0, "frost_wish=wall"));
    for other in ["off", "regen_in_combat=off", "camp_buffs=themed"] {
        assert_ne!(hash_of(0, &FrostWish::Wall), hash_of(0, other));
    }
    let freeze = Sim::new(
        config(FrostWish::Freeze),
        practice_arena(),
        Secrets::from_seed(3),
    );
    let wall = Sim::new(
        config(FrostWish::Wall),
        practice_arena(),
        Secrets::from_seed(3),
    );
    assert_ne!(freeze.k.digest, wall.k.digest, "the statics digests differ");
    // Freeze stays Freeze under the default.
    assert_eq!(
        a::definition_for(&freeze.k.config, crate::status_runtime::AbilityId::Freeze),
        a::definition(crate::status_runtime::AbilityId::Freeze)
    );
    assert_eq!(
        a::definition_for(&wall.k.config, crate::status_runtime::AbilityId::Freeze),
        a::frost_wall_definition()
    );
}

#[test]
fn an_empty_barrier_row_adds_no_word_and_no_key_value() {
    use crate::hash::hash_of;
    assert_eq!(hash_of(0, &Barriers::default()), hash_of(0, &()));
    assert_eq!(
        serde_json::to_value(Barriers::default()).unwrap(),
        serde_json::Value::Null
    );
    // A Freeze world whose Frost player casts its Wish still stuns, and holds no barrier.
    let mut s = rig(
        FrostWish::Freeze,
        Vec2::new(tc(5), tc(10)),
        Vec2::new(tc(9), tc(10)),
    );
    let target = id(&s, 1);
    let who = id(&s, 0);
    s.submit(
        who,
        crate::validate(RawCommand::Cast {
            slot: Slot::Wish,
            x: tc(9),
            y: tc(10),
            id: Some(target),
            t: None,
            seq: None,
        })
        .unwrap(),
    )
    .unwrap();
    run_for(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    assert!(walls(&s).is_empty() && barrier_cells(&s).is_empty());
    assert!(s.players()[1]
        .statuses
        .instances
        .iter()
        .any(|st| st.kind == crate::status_runtime::StatusKind::Stun));
}

#[test]
fn a_standing_wall_round_trips_through_a_checkpoint_and_reaches_the_hash() {
    let s = raised();
    assert!(!barrier_cells(&s).is_empty(), "a wall stands");
    s.check_layout().expect("hash layout with a wall standing");
    let cp = serde_json::to_value(&s).unwrap();
    let back = Sim::restore(cp.clone()).expect("a standing wall restores");
    assert_eq!(back.state_hash(), s.state_hash());
    assert_eq!(barrier_cells(&back), barrier_cells(&s));
    assert_eq!(
        body_tiles(&back),
        body_tiles(&s),
        "the overlay is rebuilt on restore"
    );
    // Every barrier leaf reaches the hash: moving one tile changes it.
    let mut moved = cp.clone();
    let cells = &mut moved["world"]["abilities"]["barriers"][0]["cells"];
    let last = cells.as_array().unwrap().len() - 1;
    cells[last] = serde_json::json!(cells[last].as_u64().unwrap() + 1);
    // Either refused by check_world, or restored with a different hash.
    if let Ok(m) = Sim::restore(moved) {
        assert_ne!(m.state_hash(), s.state_hash());
    }
    // A barrier row with no wall field, or a wall under the Freeze switch, is refused.
    let mut orphan = cp.clone();
    orphan["world"]["abilities"]["fields"] = serde_json::json!([]);
    assert!(
        Sim::restore(orphan).is_err(),
        "a barrier row needs its wall field"
    );
    let mut freeze = cp;
    freeze["statics"]["config"]["frost_wish"] = serde_json::Value::Null;
    assert!(Sim::restore(freeze).is_err(), "no wall stands under Freeze");
}
