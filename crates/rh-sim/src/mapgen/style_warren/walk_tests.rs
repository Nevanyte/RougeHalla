//! Oracle of P-LAND-PLAGUE-1-fix-2 (brief `docs/backlog/packets/P-LAND-PLAGUE-1-fix-2.md`), review note 1: the styler's
//! walk guard (`walk.rs`) on hand-built grids. `Walk::keeps` refuses a pool or merge whose tiles leave a spawn no walk
//! within its limit, and `give_way` gives back whole bodies, last laid first, once walls laid after the pools block the
//! dry way round one.
//!
//! Every grid is the full map (the walk starts at the coliseum centre `(CX, CY)`), all wall except a strip of floor five
//! tiles high (rows `CY - 2..=CY + 2`) from the centre to one spawn 20 tiles east of it, so the spawn's walk is 20 steps
//! with bog allowed and its limit is 22. The fixed layout's gate tiles are dropped so that the centre is the only start.
use super::walk::{give_way, Walk};
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::Zone;
use crate::mapgen::coliseum::{self, FixedLayout, CX, CY, H, W};
use crate::mapgen::style_runtime::{self, BaseContext, Geometry, Inputs, Metadata, Runtime, State};
use crate::mapgen::terrain_gate;

/// The detour `POOLS.walk_detour` allows (2), as the styler passes it.
fn detour() -> i32 {
    2
}

fn idx(x: i32, y: i32) -> i32 {
    y * W as i32 + x
}

/// The spawn: 20 tiles east of the centre, on the strip's middle row.
fn spawn() -> i32 {
    idx(CX + 20, CY)
}

/// The fixed layout with no gate: the coliseum centre is the walk's only start.
fn no_gates() -> FixedLayout {
    let mut fixed = coliseum::fixed_layout();
    fixed.gates.clear();
    fixed
}

/// All wall but the strip, plus `extra` floor tiles, less `walls`.
fn grid(extra: &[i32], walls: &[i32]) -> Vec<u8> {
    let mut tiles = vec![TILE_WALL; W * H];
    for y in CY - 2..=CY + 2 {
        for x in CX..=CX + 20 {
            tiles[idx(x, y) as usize] = TILE_FLOOR;
        }
    }
    for &i in extra {
        tiles[i as usize] = TILE_FLOOR;
    }
    for &i in walls {
        tiles[i as usize] = TILE_WALL;
    }
    tiles
}

/// Tiles `x0..=x1` on row `y`.
fn row(x0: i32, x1: i32, y: i32) -> Vec<i32> {
    (x0..=x1).map(|x| idx(x, y)).collect()
}

/// A Plague zone covering the whole map, with `tiles` as the styler sees them and one spawn; runs `f` on its base
/// context.
fn with_base<R>(tiles: &[u8], f: impl FnOnce(&BaseContext<'_>) -> R) -> R {
    let n = W * H;
    let mut state = State::new(
        W,
        H,
        tiles.to_vec(),
        vec![0; n],
        Vec::new(),
        Vec::new(),
        vec![0; n],
    )
    .expect("state");
    let zone = vec![1u8; n];
    let geometry = Geometry::new(1, Zone::Plague, &zone, tiles, W, H, &[]).expect("geometry");
    let zeros = vec![0u8; n];
    let spawns = [spawn()];
    let catalog = terrain_gate::default_definition();
    let rules = style_runtime::default_definition();
    let rt = Runtime::new(
        &mut state,
        Inputs {
            geometry: &geometry,
            hard: &zeros,
            no_block: &zeros,
            no_prop: &zeros,
            territory: None,
            spawns: &spawns,
            centre_walk: None,
            seed: 1,
            attempt: 0,
        },
        Metadata {
            terrain: catalog.kinds,
            props: catalog.props,
            tile_size: 32.0,
        },
        &rules,
    )
    .expect("runtime");
    f(&rt.base())
}

/// The pool across the strip's middle row, 10 tiles from the centre: the dry way round it takes the row above or
/// below, 2 steps longer (within the limit).
fn middle_pool() -> Vec<i32> {
    row(CX + 9, CX + 11, CY)
}

/// The walls a later step lays above and below `middle_pool`: the dry way round must then take the strip's edge rows,
/// 4 steps longer (past the limit).
fn later_walls() -> Vec<i32> {
    let mut walls = row(CX + 9, CX + 11, CY - 1);
    walls.extend(row(CX + 9, CX + 11, CY + 1));
    walls
}

#[test]
fn keeps_takes_a_pool_within_the_detour_and_refuses_a_merge_that_crosses_a_band() {
    let tiles = grid(&[], &[]);
    let fixed = no_gates();
    with_base(&tiles, |b| {
        let mut walk = Walk::new(b, &fixed, detour());
        assert!(walk.keeps(&[]), "no pool: every walk keeps");
        assert!(
            walk.keeps(&middle_pool()),
            "a pool the dry way passes 2 steps longer is within the detour"
        );
        walk.refresh(&middle_pool());
        // Merged discs above and below the laid pool: the dry way must take an edge row, 4 steps longer.
        let mut merge = row(CX + 9, CX + 11, CY - 1);
        merge.extend(row(CX + 9, CX + 11, CY + 1));
        assert!(
            !walk.keeps(&merge),
            "a merge that leaves the spawn only a walk 4 steps longer is refused"
        );
        // A merge in the band that leaves a way within the limit, and one off every band.
        assert!(
            walk.keeps(&[idx(CX + 15, CY + 1)]),
            "a merge on a band tile with a way round within the limit is taken"
        );
        assert!(
            walk.keeps(&[idx(CX + 5, CY - 2)]),
            "a merge on the edge row, off every walk within the limit, is taken"
        );
    });
}

#[test]
fn give_way_gives_back_the_body_a_later_wall_traps_and_keeps_a_body_off_the_walks() {
    // A side room north of the strip's east end, joined to its edge row: body 2 lies there, off every walk.
    let mut room: Vec<i32> = Vec::new();
    for y in CY - 8..=CY - 6 {
        room.extend(row(CX + 15, CX + 17, y));
    }
    let mut extra = room.clone();
    extra.extend([
        idx(CX + 16, CY - 5),
        idx(CX + 16, CY - 4),
        idx(CX + 16, CY - 3),
    ]);
    let fixed = no_gates();
    // When the pools are laid (no wall yet): both bodies keep every walk.
    with_base(&grid(&extra, &[]), |b| {
        let mut walk = Walk::new(b, &fixed, detour());
        assert!(walk.keeps(&middle_pool()), "body 1 is laid");
        walk.refresh(&middle_pool());
        assert!(walk.keeps(&room), "body 2 is laid");
    });
    // After the barrows: walls above and below body 1.
    let mut pools = middle_pool();
    pools.extend(&room);
    let mut owner = vec![1u16; middle_pool().len()];
    owner.extend(vec![2u16; room.len()]);
    with_base(&grid(&extra, &later_walls()), |b| {
        assert!(
            !Walk::new(b, &fixed, detour()).keeps(&pools),
            "the later walls put the spawn's dry walk past its limit"
        );
        let given = give_way(b, &fixed, detour(), &mut pools, &mut owner);
        assert_eq!(given, 1, "one body given back");
        assert_eq!(
            pools, room,
            "body 1 (on the walk) is given back, body 2 (off it) stays"
        );
        assert_eq!(owner, vec![2u16; room.len()], "owners follow their tiles");
        assert!(
            Walk::new(b, &fixed, detour()).keeps(&pools),
            "the spawn's walk is back within its limit"
        );
    });
}

#[test]
fn give_way_gives_back_the_last_laid_crossing_body_first_and_stops_when_the_walks_keep() {
    // Body 1: one tile on a band, harmless (the walk keeps with it). Body 2, laid after it: the pool the later walls trap.
    let harmless = vec![idx(CX + 15, CY + 1)];
    let mut pools = harmless.clone();
    pools.extend(middle_pool());
    let mut owner = vec![1u16];
    owner.extend(vec![2u16; middle_pool().len()]);
    let fixed = no_gates();
    with_base(&grid(&[], &later_walls()), |b| {
        assert!(
            Walk::new(b, &fixed, detour()).keeps(&harmless),
            "body 1 alone keeps the walk"
        );
        let given = give_way(b, &fixed, detour(), &mut pools, &mut owner);
        assert_eq!(given, 1, "only the last-laid crossing body is given back");
        assert_eq!(pools, harmless, "body 1 stays");
        assert_eq!(owner, vec![1u16]);
        assert!(Walk::new(b, &fixed, detour()).keeps(&pools));
    });
}
