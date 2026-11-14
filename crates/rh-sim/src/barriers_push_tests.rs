//! P-FROST-WALL-1b oracle: what a rising Frost Wall does to the fighters round it, and the queries that must see it.
//! Worked from unreleased legacy 78dd8bd4 (`packages/server/src/sim/abilities.ts` `raiseWall`, `handleCast`,
//! `landCasts`; `packages/server/test/frostWall.test.ts`; `packages/server/src/sim/mobAI.ts:271-292` reading
//! `collisionMap(world)`, which carries the barrier overlay): a loose proof (owner direction 2026-11-10), one test per
//! rule of the brief. Every test runs under `frost_wish = Wall`; the default config is guarded by the parity report and
//! the ability hash tape (see the packet).
use super::*;
use crate::{
    abilities::{self as a, Slot},
    archetype::HitboxMode,
    constants::{PLAYER_RADIUS, TICK_MS},
    geometry::{circle_clear, segment_clear},
    input::RawCommand,
    map::{MASK_MOVE, TILE_WALL},
    status_runtime::FieldKind,
    Arena, FactionId, FrostWish, Placement, PlayerId, Secrets, Sim, SimConfig,
};

/// The legacy room's size in tiles (functions, not consts: the content registry counts every const).
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

/// The legacy `roomMap` (an open 40 x 20 room with a wall border), with the columns `solid` filled in on rows
/// `rows` (none for the plain room).
fn map_with(solid: &[u32], rows: std::ops::RangeInclusive<u32>) -> TileMap {
    let mut tiles = vec![TILE_FLOOR; (w_tiles() * h_tiles()) as usize];
    for y in 0..h_tiles() {
        for x in 0..w_tiles() {
            let border = x == 0 || y == 0 || x == w_tiles() - 1 || y == h_tiles() - 1;
            if border || (solid.contains(&x) && rows.contains(&y)) {
                tiles[(y * w_tiles() + x) as usize] = TILE_WALL;
            }
        }
    }
    TileMap::new(w_tiles(), h_tiles(), tiles).unwrap()
}

fn arena(map: TileMap) -> Arena {
    Arena {
        map,
        spawns: (0..8).map(|i| Vec2::new(tc(3 + i), tc(3))).collect(),
    }
}

fn config(training: bool) -> SimConfig {
    SimConfig {
        abilities: a::Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: FrostWish::Wall,
        training,
        quests: false,
        consumables: false,
        ..Default::default()
    }
}

/// A Frost caster (player 0), then a Fire player (player 1) and any further Fire players, all with a huge pool.
fn rig_on(map: TileMap, training: bool, at: &[Vec2]) -> Sim {
    let placements: Vec<Placement> = at
        .iter()
        .enumerate()
        .map(|(i, &at)| Placement {
            profile: format!("p{i}"),
            faction: if i == 0 {
                FactionId::Frost
            } else {
                FactionId::Fire
            },
            bot: false,
            at,
            hp: Some(1e9),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut s = Sim::reset_active(
        config(training),
        arena(map),
        Secrets::from_seed(7),
        &placements,
    );
    s.step();
    s
}

fn rig(at: &[Vec2]) -> Sim {
    rig_on(map_with(&[], 0..=0), false, at)
}

fn id(s: &Sim, i: usize) -> PlayerId {
    s.players()[i].id
}

fn pos(s: &Sim, i: usize) -> Vec2 {
    s.players()[i].pos()
}

fn wish_at(s: &mut Sim, who: usize, x: f64, y: f64) {
    let who = id(s, who);
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

fn walk_to(s: &mut Sim, who: usize, to: Vec2) {
    let who = id(s, who);
    let cmd = crate::validate(RawCommand::Move {
        x: to.x,
        y: to.y,
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

fn walls(s: &Sim) -> usize {
    s.w.abilities.as_ref().map_or(0, |a| {
        a.fields
            .iter()
            .filter(|f| f.kind == FieldKind::Wall)
            .count()
    })
}

fn barrier_cells(s: &Sim) -> Vec<u32> {
    s.w.abilities
        .as_ref()
        .map(|a| a.barriers.0.iter().flat_map(|b| b.cells.clone()).collect())
        .unwrap_or_default()
}

/// Is a body disc of `radius` at `p` clear on the map bodies read now (the wall's tiles LOW while it stands)?
fn clear_now(s: &Sim, p: Vec2, radius: f64) -> bool {
    let held = held(&s.w);
    circle_clear(
        body_map(&s.k, &held, s.w.rt.gates_locked),
        p,
        radius,
        MASK_MOVE,
    )
}

/// Column 12, rows 7..=13: the wall of the legacy cast from (5, 10) at (12, 10) on the open room.
fn column_12() -> Vec<u32> {
    (7..=13).map(|y| y * w_tiles() + 12).collect()
}

// ---- 1. fighters the wall lands on (legacy frostWall.test.ts "sets a fighter it lands on down on its own side") ----

#[test]
fn a_fighter_the_wall_lands_on_is_set_down_clear_on_its_own_side() {
    // The legacy case: 4 u west of the wall's line, so west (its own side), straight across along the wall's normal.
    let mut s = rig(&[Vec2::new(tc(5), tc(10)), Vec2::new(tc(12) - 4., tc(10))]);
    wish_at(&mut s, 0, tc(12), tc(10));
    run_for(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    assert_eq!(barrier_cells(&s), column_12(), "the wall stands whole");
    let p1 = pos(&s, 1);
    assert!(
        clear_now(&s, p1, PLAYER_RADIUS),
        "the fighter it landed on is clear of the ice: {p1:?}"
    );
    assert!(p1.x < tc(12), "set down west, on its own side: {p1:?}");
    // Legacy search: from its projection on the line (x = tc(12)), outward in steps of 4 until the disc
    // (PLAYER_RADIUS + 1) touches no wall tile: 32 u, the first step whose disc ends west of column 12.
    assert!(
        (p1.x - (tc(12) - 32.)).abs() < 1e-9 && (p1.y - tc(10)).abs() < 1e-9,
        "set straight across, the first clear step of 4 out from the line: {p1:?}"
    );
    assert!(
        clear_now(&s, pos(&s, 0), PLAYER_RADIUS),
        "the caster's disc is clear"
    );
    // One exactly on the line goes to the far side from the caster.
    let mut s = rig(&[Vec2::new(tc(5), tc(10)), Vec2::new(tc(12), tc(10))]);
    wish_at(&mut s, 0, tc(12), tc(10));
    run_for(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    let p1 = pos(&s, 1);
    assert!(
        (p1.x - (tc(12) + 32.)).abs() < 1e-9 && (p1.y - tc(10)).abs() < 1e-9,
        "one on the line is set down on the far side, 32 u out: {p1:?}"
    );
    assert!(clear_now(&s, p1, PLAYER_RADIUS));
}

#[test]
fn a_fighter_with_no_room_on_either_side_keeps_a_gap_and_the_rest_of_the_wall_stands() {
    // Column 12 is a one-tile north-south corridor between solid columns 9..=11 and 13..=15: no clear spot within
    // 96 u east or west of the line. The fighter's tiles within PLAYER_RADIUS + 32 (rows 9..=11) stay free.
    let map = map_with(&[9, 10, 11, 13, 14, 15], 1..=18);
    let mut s = rig_on(
        map,
        false,
        &[Vec2::new(tc(5), tc(10)), Vec2::new(tc(12), tc(10))],
    );
    wish_at(&mut s, 0, tc(12), tc(10));
    run_for(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    let expected: Vec<u32> = [7, 8, 12, 13].iter().map(|y| y * w_tiles() + 12).collect();
    assert_eq!(barrier_cells(&s), expected, "a gap round the fighter");
    assert_eq!(walls(&s), 1, "the wall's other tiles still stand");
    let p1 = pos(&s, 1);
    assert_eq!(p1, Vec2::new(tc(12), tc(10)), "not moved");
    assert!(clear_now(&s, p1, PLAYER_RADIUS), "not trapped in the ice");
}

#[test]
fn a_wall_left_with_no_tile_is_not_raised() {
    // The corridor is only rows 9..=11 long: the gap takes every tile the wall had.
    let mut tiles = map_with(&[9, 10, 11, 13, 14, 15], 1..=18).tiles.clone();
    for y in 1..h_tiles() - 1 {
        if !(9..=11).contains(&y) {
            tiles[(y * w_tiles() + 12) as usize] = TILE_WALL;
        }
    }
    let mut s = rig_on(
        TileMap::new(w_tiles(), h_tiles(), tiles).unwrap(),
        false,
        &[Vec2::new(tc(5), tc(10)), Vec2::new(tc(12), tc(10))],
    );
    wish_at(&mut s, 0, tc(12), tc(10));
    run_for(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    assert_eq!(walls(&s), 0, "no wall field");
    assert!(barrier_cells(&s).is_empty(), "no barrier row");
    assert!(held(&s.w).is_none(), "no overlay");
    assert_eq!(pos(&s, 1), Vec2::new(tc(12), tc(10)), "not moved");
}

// ---- 2. walks under way (legacy "a walk planned through it is planned again round it") ----

#[test]
fn a_walk_under_way_when_the_wall_rises_is_planned_again_round_it() {
    // The legacy case: the Fire player walks east from (8, 10) to (20, 10); one step later Frost, at (3, 16), aims at
    // (13, 10): the wall stands on a diagonal across the walk.
    let mut s = rig(&[Vec2::new(tc(3), tc(16)), Vec2::new(tc(8), tc(10))]);
    let goal = Vec2::new(tc(20), tc(10));
    walk_to(&mut s, 1, goal);
    s.step();
    wish_at(&mut s, 0, tc(13), tc(10));
    let mut inside = 0;
    let mut checked = false;
    for _ in 0..120 {
        let before = walls(&s);
        s.step();
        if before == 0 && walls(&s) == 1 {
            // The landing step: the walk in hand no longer runs into the ice.
            checked = true;
            let held = held(&s.w);
            let map = body_map(&s.k, &held, s.w.rt.gates_locked);
            let path = s.players()[1].motion.path.as_slice().to_vec();
            assert!(!path.is_empty(), "still walking");
            assert!(
                crate::math::hypot(
                    path[path.len() - 1].x - goal.x,
                    path[path.len() - 1].y - goal.y
                ) < 1e-9,
                "planned again to the same goal: {path:?}"
            );
            let mut from = pos(&s, 1);
            for &p in &path {
                assert!(
                    segment_clear(map, from, p, PLAYER_RADIUS, MASK_MOVE),
                    "the walk in hand at the landing step runs into the wall ({from:?} -> {p:?}); path {path:?}"
                );
                from = p;
            }
        }
        if !clear_now(&s, pos(&s, 1), PLAYER_RADIUS - 1.) {
            inside += 1;
        }
    }
    assert!(checked, "the wall rose during the walk");
    assert_eq!(inside, 0, "ticks the walker overlapped the ice");
    let p = pos(&s, 1);
    assert!(
        crate::math::hypot(p.x - goal.x, p.y - goal.y) < TILE,
        "it got where it was going: {p:?}"
    );
}

// ---- 3. mobs (legacy mobAI.ts:271-292 and raiseWall's standingCombatants) ----

/// A training world (practice mobs need one), Frost at (5, 10), a Fire target at (13.75, 10), and one practice Ember
/// Imp (axe: melee) at (11.25, 10), awake on the target: 80 u apart, within its stop band and swing reach.
fn mob_rig(mob_at: Vec2) -> (Sim, PlayerId) {
    let mut s = rig_on(
        map_with(&[], 0..=0),
        true,
        &[Vec2::new(tc(5), tc(10)), Vec2::new(440., tc(10))],
    );
    assert!(s.w.mob_runtime.as_ref().is_some_and(|r| r.combat));
    // A training world sets out its practice dummies near the spawns (rows 3 and 6): none near the wall's tiles.
    assert!(
        s.mobs()
            .iter()
            .all(|m| m.kind == crate::mob_runtime::MobKind::Dummy && m.core.pos().y < 7. * TILE),
        "only the practice dummies, north of the wall"
    );
    let ty = crate::mob_catalog::mob_type_by_id("emberImp").unwrap().id;
    let now = s.w.server_time;
    let mob = crate::systems::mobs::place_practice_mob(
        &mut s.w,
        ty,
        false,
        101,
        mob_at,
        0.,
        HitboxMode::LegacyCircle,
    );
    let target = id(&s, 1);
    let b = s.w.mobs.get_mut(mob).unwrap().brain.as_mut().unwrap();
    crate::systems::mob_ai::add_threat(b, target, 1.);
    crate::systems::mob_ai::wake(b, target, now);
    (s, mob)
}

#[test]
fn a_melee_mob_across_a_standing_wall_walks_round_it_instead_of_swinging_into_the_ice() {
    let (mut s, mob) = mob_rig(Vec2::new(360., tc(10)));
    wish_at(&mut s, 0, tc(12), tc(10));
    run_for(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    assert_eq!(
        barrier_cells(&s),
        column_12(),
        "the wall stands between them"
    );
    // Legacy: the mob's melee line of sight is read on collisionMap (the wall's tiles LOW stop a swing), so it chases,
    // and its walk is planned round the wall. Without it, it stands 80 u off and swings into the ice until it falls.
    let mut crossed = false;
    while walls(&s) == 1 {
        s.step();
        let m = s.w.mobs.get(mob).unwrap().core.pos();
        assert!(
            clear_now(&s, m, PLAYER_RADIUS - 1.) || walls(&s) == 0,
            "the mob never stands in the ice: {m:?}"
        );
        crossed |= m.x > tc(12);
    }
    assert!(
        crossed,
        "the mob reached the target's side of the wall while it stood: {:?}",
        s.w.mobs.get(mob).unwrap().core.pos()
    );
}

#[test]
fn a_mob_the_wall_lands_on_is_set_down_clear_too() {
    // Legacy raiseWall iterates standingCombatants: players and mobs (quest mobs excepted). 4 u east of the line: east.
    let (mut s, mob) = mob_rig(Vec2::new(tc(12) + 4., tc(10)));
    wish_at(&mut s, 0, tc(12), tc(10));
    run_for(&mut s, a::FROST_WALL_CAST_MS);
    let mut landed = false;
    for _ in 0..4 {
        s.step();
        if walls(&s) == 1 {
            landed = true;
            break;
        }
    }
    assert!(landed, "the wall rose");
    assert_eq!(barrier_cells(&s), column_12(), "the wall stands whole");
    let m = s.w.mobs.get(mob).unwrap().core.pos();
    assert!(
        clear_now(&s, m, PLAYER_RADIUS),
        "the mob it landed on is clear of the ice in the landing step: {m:?}"
    );
    assert!(m.x > tc(12), "set down east, on its own side: {m:?}");
}

// ---- 4. blinks (legacy handleCast and landCasts: blinkLanding(collisionMap(world), ...)) ----

#[test]
fn a_blaze_blink_aimed_at_a_standing_wall_lands_short_of_it() {
    let mut s = rig(&[Vec2::new(tc(5), tc(10)), Vec2::new(tc(8), tc(10))]);
    wish_at(&mut s, 0, tc(12), tc(10));
    run_for(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    assert_eq!(barrier_cells(&s), column_12(), "the wall stands");
    let from = pos(&s, 1);
    // Blaze from (8, 10) at the wall's centre, 128 u east: the farthest clear disc on the ray, in steps of 4, is west of
    // the wall's column.
    wish_at(&mut s, 1, tc(12), tc(10));
    s.step();
    s.step();
    let to = pos(&s, 1);
    assert!(to.x > from.x + 32., "the blink went: {from:?} -> {to:?}");
    assert!(
        clear_now(&s, to, PLAYER_RADIUS),
        "a blink never lands on a standing wall: {to:?}"
    );
    assert!(
        to.x + PLAYER_RADIUS <= 12. * TILE,
        "it stops short, west of the ice: {to:?}"
    );
}

// ---- guards: save, restore and the hash over a wall that moved someone ----

#[test]
fn a_checkpoint_taken_after_the_wall_set_someone_down_restores_and_runs_on_identically() {
    let mut s = rig(&[
        Vec2::new(tc(3), tc(16)),
        Vec2::new(tc(8), tc(10)),
        Vec2::new(tc(13), tc(10)),
    ]);
    walk_to(&mut s, 1, Vec2::new(tc(20), tc(10)));
    s.step();
    wish_at(&mut s, 0, tc(13), tc(10));
    while walls(&s) == 0 {
        assert!(s.server_time() < 2000., "the wall rises");
        s.step();
    }
    assert!(
        clear_now(&s, pos(&s, 2), PLAYER_RADIUS),
        "the fighter under it was set down"
    );
    s.check_layout().expect("hash layout after the push-out");
    let mut back = Sim::restore(serde_json::to_value(&s).unwrap()).expect("restores");
    assert_eq!(back.state_hash(), s.state_hash());
    for _ in 0..100 {
        s.step();
        back.step();
        assert_eq!(back.state_hash(), s.state_hash(), "tick {}", s.tick());
    }
}
