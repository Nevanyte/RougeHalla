//! P-FROST-WALL-1-fix (review notes of reviewer-opus): the overlay follows the gates, and two walls landing in one tick
//! share no tile. Separate from the packet's oracle (`barriers_tests.rs`).
use super::*;
use crate::{
    abilities::{self as a, Slot},
    constants::TICK_MS,
    input::RawCommand,
    map::TILE_LOW,
    status_runtime::FieldKind,
    Arena, ArenaMode, ArenaRules, FactionId, FrostWish, Placement, PlayerId, Secrets, Sim,
    SimConfig,
};

fn seed1() -> Arena {
    let export: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("mapdata/fixtures/seed1.map.json")).unwrap();
    export.validate().unwrap().into_arena().unwrap()
}

fn cast(s: &mut Sim, who: PlayerId, at: Vec2) {
    let cmd = crate::validate(RawCommand::Cast {
        slot: Slot::Wish,
        x: at.x,
        y: at.y,
        id: None,
        t: None,
        seq: None,
    })
    .unwrap();
    s.submit(who, cmd).unwrap();
}

fn walk(s: &mut Sim, who: PlayerId, to: Vec2) {
    let cmd = crate::validate(RawCommand::Move {
        x: to.x,
        y: to.y,
        seq: None,
    })
    .unwrap();
    s.submit(who, cmd).unwrap();
}

fn rows(s: &Sim) -> Vec<Barrier> {
    s.w.abilities
        .as_ref()
        .map(|a| a.barriers.0.clone())
        .unwrap_or_default()
}

/// Review note 1. A wall stands in the coliseum while the gates are locked; a fighter leaves, and the next settle opens
/// the gates (`coliseum::settle`). A checkpoint taken at that boundary and the continuous world must step alike, and a
/// move order through the now-open gate must be planned on the open map in both.
#[test]
fn a_wall_standing_when_the_gates_open_does_not_keep_them_closed() {
    let arena = seed1();
    let col = arena.map.layers().unwrap().coliseum().clone();
    let gate = &col.gates[0];
    let tile = gate.tiles[gate.tiles.len() / 2];
    let gate_at = Vec2::new(
        f64::from(tile.x) * TILE + TILE / 2.,
        f64::from(tile.y) * TILE + TILE / 2.,
    );
    let outside = Vec2::new(gate_at.x, gate_at.y - 64.);
    let config = SimConfig {
        quests: false,
        consumables: false,
        abilities: a::Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: FrostWish::Wall,
        lifecycle: ArenaMode::Source(ArenaRules {
            plan_seconds: 0.,
            first_patience_seconds: Some(0.1),
            coliseum_schedule: None,
            patience_seconds: 3600.,
            patience_min_seconds: 3600.,
            sudden_death_seconds: 3600.,
        }),
        min_players: 2,
        fill_seconds: 0.,
        hazards: crate::terrain::Mode::Off,
        ..Default::default()
    };
    let mut s = Sim::new(config, arena, Secrets::from_seed(12));
    let frost = s.add_player("a", Some(FactionId::Frost), false).unwrap();
    let mover = s.add_player("b", Some(FactionId::Holy), false).unwrap();
    let leaver = s.add_player("c", Some(FactionId::Holy), false).unwrap();
    for _ in 0..200 {
        if s.w.rt.gates_locked {
            break;
        }
        s.step();
    }
    assert!(s.w.rt.gates_locked, "the run teleported into the coliseum");
    // No cast inside the teleport grace.
    run_ms(&mut s, a::TELEPORT_GRACE_MS + TICK_MS);
    // The wall goes up on the far side of the caster from the gate, off the mover's way out.
    let from = s.player(frost).unwrap().pos();
    let (dx, dy) = (from.x - gate_at.x, from.y - gate_at.y);
    let d = crate::math::sqrt(dx * dx + dy * dy);
    cast(
        &mut s,
        frost,
        Vec2::new(from.x + dx / d * 120., from.y + dy / d * 120.),
    );
    run_ms(&mut s, a::FROST_WALL_CAST_MS + TICK_MS);
    assert_eq!(rows(&s).len(), 1, "a wall stands in the locked coliseum");
    assert!(s.w.rt.gates_locked);
    s.remove_player(leaver);
    s.step();
    assert!(!s.w.rt.gates_locked, "the leave opened the gates");
    assert_eq!(rows(&s).len(), 1, "the wall still stands");
    // The checkpoint at the boundary the gates opened on.
    let mut back = Sim::restore(serde_json::to_value(&s).unwrap()).expect("restores");
    assert_eq!(back.state_hash(), s.state_hash());
    walk(&mut s, mover, outside);
    walk(&mut back, mover, outside);
    let mut first_split = None;
    for tick in 0..200 {
        s.step();
        back.step();
        if first_split.is_none() && s.state_hash() != back.state_hash() {
            first_split = Some(tick);
        }
    }
    let passed = |sim: &Sim| {
        let p = sim.player(mover).unwrap().pos();
        crate::math::hypot(p.x - outside.x, p.y - outside.y) < TILE
    };
    assert_eq!(
        first_split,
        None,
        "the continuous and the restored world split (ticks after the boundary); the mover passed the gate: \
         continuous {}, restored {}",
        passed(&s),
        passed(&back)
    );
    assert!(passed(&back), "the restored mover passed the open gate");
    assert!(passed(&s), "the continuous mover passed the open gate");
}

fn run_ms(s: &mut Sim, ms: f64) {
    let end = s.server_time() + ms;
    while s.server_time() < end {
        s.step();
    }
}

fn room() -> Arena {
    let (w, h) = (40u32, 20u32);
    let mut tiles = vec![TILE_FLOOR; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                tiles[(y * w + x) as usize] = crate::map::TILE_WALL;
            }
        }
    }
    let tc = |t: u32| f64::from(t) * TILE + TILE / 2.;
    Arena {
        map: TileMap::new(w, h, tiles).unwrap(),
        spawns: (0..8).map(|i| Vec2::new(tc(3 + i), tc(3))).collect(),
    }
}

/// The reviewer's same-tick case: two Frost walls landing in the same tick on overlapping stretches of one column. The
/// second is cut against the map the first left (legacy bumps the barrier version between them), so it takes only the
/// tiles the first did not, and every tile of both is LOW for bodies.
#[test]
fn two_walls_landing_in_one_tick_share_no_tile() {
    let tc = |t: u32| f64::from(t) * TILE + TILE / 2.;
    let p = |i: usize, at: Vec2| Placement {
        profile: format!("p{i}"),
        faction: FactionId::Frost,
        bot: false,
        at,
        hp: None,
        weapon0: None,
        weapon1: None,
    };
    let config = SimConfig {
        abilities: a::Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: FrostWish::Wall,
        ..Default::default()
    };
    // West of column 12 aiming at (12, 10): rows 7..=13. East of it aiming at (12, 13): rows 10..=16, of which the
    // first already holds 10..=13.
    let mut s = Sim::reset_active(
        config,
        room(),
        Secrets::from_seed(7),
        &[p(0, Vec2::new(tc(5), tc(10))), p(1, Vec2::new(tc(19), tc(13)))],
    );
    s.step();
    let (one, two) = (s.players()[0].id, s.players()[1].id);
    cast(&mut s, one, Vec2::new(tc(12), tc(10)));
    cast(&mut s, two, Vec2::new(tc(12), tc(13)));
    let mut landed_together = false;
    let end = s.server_time() + a::FROST_WALL_CAST_MS + TICK_MS;
    while s.server_time() < end {
        let before = rows(&s).len();
        s.step();
        landed_together |= before == 0 && rows(&s).len() == 2;
    }
    assert!(landed_together, "both walls rose in one tick");
    let r = rows(&s);
    // Whichever lands first takes its whole stretch; the second only what is left of its own.
    let column = |rows: std::ops::RangeInclusive<u32>| -> Vec<u32> { rows.map(|y| y * 40 + 12).collect() };
    let (west, east) = (column(7..=13), column(10..=16));
    let (whole, rest) = if r[0].cells == west {
        (west, column(14..=16))
    } else {
        (east, column(7..=9))
    };
    assert_eq!(r[0].cells, whole, "the first takes its whole stretch");
    assert_eq!(r[1].cells, rest, "the second excludes the first's tiles");
    let walls = s
        .w
        .abilities
        .as_ref()
        .unwrap()
        .fields
        .iter()
        .filter(|f| f.kind == FieldKind::Wall)
        .count();
    assert_eq!(walls, 2, "two wall fields, one row each");
    let held = held(&s.w);
    let map = body_map(&s.k, &held, s.w.rt.gates_locked);
    assert!(r
        .iter()
        .flat_map(|b| &b.cells)
        .all(|&c| map.tiles[c as usize] == TILE_LOW));
    s.check_layout().expect("hash layout with two walls");
    let back = Sim::restore(serde_json::to_value(&s).unwrap()).expect("two walls restore");
    assert_eq!(back.state_hash(), s.state_hash());
}
