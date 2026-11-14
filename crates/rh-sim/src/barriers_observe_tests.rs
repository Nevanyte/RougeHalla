//! P-FROST-WALL-NOWALL-1 oracle (brief `docs/backlog/packets/P-FROST-WALL-NOWALL-1.md`): a standing Frost Wall is sent,
//! with all its tiles, to its owner always, and to any other viewer who can see at least one of its tiles.
//!
//! Web round 13 (pooled seed 263678495, `--signature-landmarks`): a Frost player standing in the Plague bog beside the
//! bog tree cast twice; each cast was accepted, spent the Wish and raised a wall (it blocks), but no wall reached the
//! client. Cause: `status_runtime/observe.rs` `project` shows a wall only when its FIRST end `(x1, y1)` is visible to the
//! viewer, and the tree's trunk (WALL tiles) hid that end from the caster while the caster saw the rest of the wall (and
//! the aim preview had drawn every tile). Legacy 78dd8bd4 drew by the same first-end rule
//! (`client/src/render/FieldView.ts:161-162`) but synced every wall to every client, whose plan map took every wall's
//! tiles (`client/src/scenes/RaidScene.ts:1012-1029`); the Rust observation is the only delivery, so the client neither
//! draws nor predicts the wall.
//!
//! The rule pinned here (proposed DEV-036, see the brief): the wall's owner receives it whatever the sight; any other
//! viewer receives the whole wall when one of its tiles is visible to it (`vision::point_visible` on a tile centre), and
//! nothing when none is. `tests/frost_wall_observe.rs` is amended to the same rule (coordinator-approved).
use super::*;
use crate::{
    abilities::{self as a, Slot},
    constants::TICK_MS,
    input::RawCommand,
    map::TILE_WALL,
    mapdata::FeatureKind,
    status_runtime::{FieldKind, FieldView},
    Arena, FactionId, FrostWish, Placement, PlayerId, Secrets, Sim, SimConfig,
};

// ---- a room with a rock (the legacy 40 x 20 `roomMap`, as the other barrier tests) ----

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

/// The open room with a wall border, plus every tile for which `rock(x, y)` holds.
fn map_where(rock: impl Fn(u32, u32) -> bool) -> TileMap {
    let mut tiles = vec![TILE_FLOOR; (w_tiles() * h_tiles()) as usize];
    for y in 0..h_tiles() {
        for x in 0..w_tiles() {
            let border = x == 0 || y == 0 || x == w_tiles() - 1 || y == h_tiles() - 1;
            if border || rock(x, y) {
                tiles[(y * w_tiles() + x) as usize] = TILE_WALL;
            }
        }
    }
    TileMap::new(w_tiles(), h_tiles(), tiles).unwrap()
}

fn config() -> SimConfig {
    SimConfig {
        abilities: a::Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: FrostWish::Wall,
        quests: false,
        consumables: false,
        ..Default::default()
    }
}

/// Frost at tile (5, 10) and a Fire bystander.
fn rig(map: TileMap, bystander: Vec2) -> Sim {
    let at = [
        (FactionId::Frost, Vec2::new(tc(5), tc(10))),
        (FactionId::Fire, bystander),
    ];
    let placements: Vec<Placement> = at
        .iter()
        .enumerate()
        .map(|(i, &(faction, at))| Placement {
            profile: format!("p{i}"),
            faction,
            bot: false,
            at,
            hp: Some(1e9),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let spawns = placements.iter().map(|p| p.at).collect();
    let mut s = Sim::reset_active(
        config(),
        Arena { map, spawns },
        Secrets::from_seed(11),
        &placements,
    );
    // Past the 30 s sight memory (`VISION_TRAIL_MS`; spawns are dealt round-robin, so a fighter's first reveal may be
    // from the other's spot), as `tests/frost_wall_observe.rs` does: each sees only from where it stands.
    for _ in 0..640 {
        s.step();
    }
    s
}

fn id(s: &Sim, i: usize) -> PlayerId {
    s.players()[i].id
}

/// Casts the Wish at `to` and steps past the 250 ms cast.
fn cast(s: &mut Sim, caster: usize, to: Vec2) {
    let who = id(s, caster);
    let cmd = crate::validate(RawCommand::Cast {
        slot: Slot::Wish,
        x: to.x,
        y: to.y,
        id: None,
        t: None,
        seq: None,
    })
    .unwrap();
    s.submit(who, cmd).unwrap();
    let end = s.server_time() + a::FROST_WALL_CAST_MS + 2. * TICK_MS;
    while s.server_time() < end {
        s.step();
    }
}

/// The standing wall fields and their barrier rows, in field order: `(owner, first end, tiles)`.
fn standing(s: &Sim) -> Vec<(Option<PlayerId>, Vec2, Vec<u32>)> {
    let Some(a) = s.w.abilities.as_ref() else {
        return Vec::new();
    };
    a.fields
        .iter()
        .filter(|f| f.kind == FieldKind::Wall)
        .map(|f| {
            let cells = a
                .barriers
                .0
                .iter()
                .find(|b| b.field == f.id)
                .map(|b| b.cells.clone())
                .unwrap_or_default();
            (f.owner.id, Vec2::new(f.x, f.y), cells)
        })
        .collect()
}

fn observed_walls(s: &Sim, viewer: PlayerId) -> Vec<FieldView> {
    crate::observe(s, viewer, &[])
        .fields
        .into_iter()
        .filter(|f| f.kind == FieldKind::Wall)
        .collect()
}

/// Does a viewer at `from` have a clear line to `to` on the arena map (the observation's own sight test, without the
/// radius)?
fn in_sight(s: &Sim, from: Vec2, to: Vec2) -> bool {
    !crate::vision::scene_line_blocked(&s.k.arena.map, from.x, from.y, to.x, to.y)
}

/// Is `to` within the vision radius of `from` and in its line of sight (what `point_visible` grants from where the
/// viewer stands, before memory and wards)?
fn sees(s: &Sim, from: Vec2, to: Vec2) -> bool {
    let (dx, dy) = (to.x - from.x, to.y - from.y);
    let r = crate::constants::VISION_RADIUS;
    dx * dx + dy * dy <= r * r && in_sight(s, from, to)
}

/// The centre of row-major tile `i` on a map `w` tiles wide.
fn centre(i: u32, w: u32) -> Vec2 {
    Vec2::new(tc(i % w), tc(i / w))
}

/// Column 12, rows 7..=13: the wall of a cast from (5, 10) aimed at (12, 10). Its first end is (400, 448), the bottom.
fn column_12() -> Vec<u32> {
    (7..=13).map(|y| y * w_tiles() + 12).collect()
}

/// The round-13 scene in a room: a rock at tiles (8..=9, 11..=13) stands between the caster and the wall's first end
/// (400, 448); the caster sees rows 7..=10 of the wall. The wall is raised (it blocks: the barrier row), the Wish is
/// spent, and today the caster's observation carries no wall.
#[test]
fn the_caster_receives_its_wall_when_a_rock_hides_the_first_end() {
    let map = map_where(|x, y| (8..=9).contains(&x) && (11..=13).contains(&y));
    let mut s = rig(map, Vec2::new(tc(30), tc(3)));
    let caster = id(&s, 0);
    cast(&mut s, 0, Vec2::new(tc(12), tc(10)));
    let up = standing(&s);
    assert_eq!(up.len(), 1, "the cast raised one wall: {up:?}");
    assert_eq!(up[0].2, column_12(), "on column 12, rows 7..=13");
    assert_eq!(up[0].0, Some(caster), "the caster owns it");
    assert!(
        s.players()[0].stocks.wish_ready_at > s.server_time(),
        "the Wish is spent"
    );
    let from = s.players()[0].pos();
    assert!(
        !in_sight(&s, from, up[0].1),
        "the scene is the defect's: the rock hides the first end {:?}",
        up[0].1
    );
    assert!(
        in_sight(&s, from, Vec2::new(tc(12), tc(8))),
        "and the caster sees the wall's upper tiles"
    );
    let seen = observed_walls(&s, caster);
    assert_eq!(
        seen.len(),
        1,
        "the caster is sent its own standing wall (round 13: accepted, spent, raised, never delivered)"
    );
    assert_eq!(seen[0].tiles, column_12(), "with the tiles it blocks on");
    assert_eq!(seen[0].owner, Some(caster));
}

/// The owner's rule is not "some tile in sight": a rock column (8..=9, every row) hides the whole wall from its caster,
/// who still receives it. The bystander on the caster's side, who is not its owner, sees none of it and is sent nothing
/// (guard, green today and after).
#[test]
fn the_caster_receives_its_wall_even_when_none_of_it_is_in_sight() {
    let map = map_where(|x, _| (8..=9).contains(&x));
    let mut s = rig(map, Vec2::new(tc(4), tc(16)));
    let (caster, other) = (id(&s, 0), id(&s, 1));
    cast(&mut s, 0, Vec2::new(tc(12), tc(10)));
    let up = standing(&s);
    assert_eq!(up.len(), 1, "the cast raised one wall: {up:?}");
    assert_eq!(up[0].2, column_12());
    let from = s.players()[0].pos();
    assert!(
        up[0].2.iter().all(|&i| !in_sight(
            &s,
            from,
            Vec2::new(tc(i % w_tiles()), tc(i / w_tiles()))
        )),
        "the scene hides every tile of the wall from the caster"
    );
    assert!(
        observed_walls(&s, other).is_empty(),
        "guard: a viewer who is not the owner and sees nothing of the wall is sent nothing"
    );
    let seen = observed_walls(&s, caster);
    assert_eq!(seen.len(), 1, "the owner is sent its wall whatever it sees");
    assert_eq!(seen[0].tiles, column_12());
}

/// A bystander east of the wall sees it only through a one-row gap in a rock screen (columns 15..=16, every row but
/// 10): the middle tile (12, 10) is in its sight, the first end (400, 448) and the end tiles are not. It is not the
/// owner, and today it is sent nothing; it must receive the whole wall.
#[test]
fn a_bystander_who_sees_a_middle_tile_but_not_the_first_end_receives_the_whole_wall() {
    let map = map_where(|x, y| (15..=16).contains(&x) && y != 10);
    let mut s = rig(map, Vec2::new(tc(20), tc(10)));
    let other = id(&s, 1);
    cast(&mut s, 0, Vec2::new(tc(12), tc(10)));
    let up = standing(&s);
    assert_eq!(up.len(), 1, "the cast raised one wall: {up:?}");
    assert_eq!(up[0].2, column_12());
    let from = s.players()[1].pos();
    assert!(
        !sees(&s, from, up[0].1),
        "the screen hides the first end {:?} from the bystander",
        up[0].1
    );
    assert!(
        sees(&s, from, Vec2::new(tc(12), tc(10))),
        "the bystander sees the middle tile (12, 10)"
    );
    assert!(
        !sees(&s, from, Vec2::new(tc(12), tc(7))) && !sees(&s, from, Vec2::new(tc(12), tc(13))),
        "but not the wall's end tiles"
    );
    let seen = observed_walls(&s, other);
    assert_eq!(
        seen.len(),
        1,
        "a viewer who sees one tile of a wall is sent it (else it walks into ice it was never shown)"
    );
    assert_eq!(seen[0].tiles, column_12(), "the whole wall, every tile");
    assert_eq!(
        seen[0].owner, None,
        "the caster is out of its sight: no owner"
    );
}

/// Guard (green today): on open floor the caster and a bystander in sight of the first end both receive the wall.
#[test]
fn guard_on_open_floor_the_caster_and_a_bystander_in_sight_receive_the_wall() {
    let mut s = rig(map_where(|_, _| false), Vec2::new(tc(5), tc(16)));
    let (caster, other) = (id(&s, 0), id(&s, 1));
    cast(&mut s, 0, Vec2::new(tc(12), tc(10)));
    for v in [caster, other] {
        let seen = observed_walls(&s, v);
        assert_eq!(seen.len(), 1, "{v:?} receives the wall");
        assert_eq!(seen[0].tiles, column_12());
    }
}

// ---- the round-13 map ----

/// The certified signature-landmark map the round-13 room played (pool seed 263678495, map hash 75bf127e), as the
/// server's `StyledMaker` builds it (no decor, `signature: true`), with its generator map for the bog tree's anchor.
fn round13() -> (Arena, crate::mapdata::GameMapData) {
    use crate::mapgen::{coliseum, map_hash, pipeline};
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let options = pipeline::Options {
        decor: false,
        signature: true,
        ..pipeline::Options::default()
    };
    let m = generator
        .certified_styled(263_678_495, options)
        .expect("generator")
        .expect("a certified map");
    let hash = u32::from_str_radix(&map_hash::map_hash(&m), 16).unwrap();
    let export = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map: m.clone(),
    };
    (export.validate().unwrap().into_arena().unwrap(), m)
}

/// The live world on the round-13 map, Frost standing at `at` and a Plague bystander at `other` (the live content world;
/// the default lifecycle, since a source arena starts from a lobby; no Wish lock).
fn live_on(arena: &Arena, at: Vec2, other: Vec2) -> Sim {
    let cfg = SimConfig {
        wish_lock_ms: 0.,
        lifecycle: SimConfig::default().lifecycle,
        ..SimConfig::live_content()
    };
    let p = |profile: &str, faction, at| Placement {
        profile: profile.into(),
        faction,
        bot: false,
        at,
        hp: Some(1e9),
        weapon0: None,
        weapon1: None,
    };
    let seats = [
        p("s1", FactionId::Frost, at),
        p("s2", FactionId::Plague, other),
    ];
    let mut s = Sim::reset_active(cfg, arena.clone(), Secrets::from_seed(7), &seats);
    s.step();
    s
}

/// Round 13 in the sim: Frost standing on bog tiles in and round the bog tree's footprint casts its Wall in eight
/// directions at 160 u and 300 u, with a Plague bystander three tiles away (the first floor tile east, west, south or
/// north). Every accepted cast that raised a wall must reach its caster (today about a third do not: the tree's trunk
/// hides the first end), and must reach the bystander whenever the bystander, from where it stands after the landing,
/// sees one of its tiles but not its first end. The test also requires at least one raised wall with its first end out
/// of the caster's sight, and at least one the bystander saw in part without its first end, so it keeps testing the
/// defect if the generator moves the tree.
#[test]
fn round13_every_wall_cast_by_the_bog_tree_reaches_its_caster_and_the_bystanders_who_see_part_of_it(
) {
    let (arena, m) = round13();
    let tree = m
        .anchors
        .iter()
        .find(|a| a.kind == FeatureKind::BogTree)
        .expect("the signature map has a bog tree");
    let (fx, fy) = (i64::from(tree.footprint.x), i64::from(tree.footprint.y));
    let (fw, fh) = (i64::from(tree.footprint.w), i64::from(tree.footprint.h));
    let w = i64::from(m.w);
    let bog = crate::mapgen::landmarks::signature::DEFAULT_DEFINITION.bog;
    let (mut raised, mut hidden_end, mut missing) = (0, 0, Vec::new());
    let (mut partly, mut unsent) = (0, Vec::new());
    for ty in (fy - 2).max(1)..(fy + fh + 2).min(i64::from(m.h) - 1) {
        for tx in (fx - 2).max(1)..(fx + fw + 2).min(w - 1) {
            let i = (ty * w + tx) as usize;
            // One bog tile in nine (a lattice), to keep the debug-build run short.
            if (tx + 3 * ty) % 9 != 0 || m.tiles[i] != TILE_FLOOR || m.terrain[i] != bog {
                continue;
            }
            let at = Vec2::new(tc(tx as u32), tc(ty as u32));
            let floor = |x: i64, y: i64| {
                (0..w).contains(&x)
                    && (0..i64::from(m.h)).contains(&y)
                    && m.tiles[(y * w + x) as usize] == TILE_FLOOR
            };
            let Some((ox, oy)) = [(3, 0), (-3, 0), (0, 3), (0, -3)]
                .into_iter()
                .map(|(dx, dy)| (tx + dx, ty + dy))
                .find(|&(x, y)| floor(x, y))
            else {
                continue;
            };
            let base = live_on(&arena, at, Vec2::new(tc(ox as u32), tc(oy as u32)));
            let (caster, other) = (base.players()[0].id, base.players()[1].id);
            for k in 0..8 {
                for dist in [160., 300.] {
                    let angle = f64::from(k) * std::f64::consts::FRAC_PI_4;
                    let to = Vec2::new(
                        at.x + crate::math::cos(angle) * dist,
                        at.y + crate::math::sin(angle) * dist,
                    );
                    let mut s = base.clone();
                    cast(&mut s, 0, to);
                    let up = standing(&s);
                    let Some((_, first, cells)) = up.first() else {
                        continue;
                    };
                    raised += 1;
                    let from = s.players()[0].pos();
                    if !in_sight(&s, from, *first) {
                        hidden_end += 1;
                    }
                    let seen = observed_walls(&s, caster);
                    if seen.len() != 1 || &seen[0].tiles != cells {
                        missing.push(format!(
                            "caster on bog ({tx},{ty}) aiming {k}/8 turn at {dist} u: wall raised on {} tiles, first end {:?}, caster sent {} wall(s)",
                            cells.len(),
                            first,
                            seen.len()
                        ));
                    }
                    let by = s.players()[1].pos();
                    if !sees(&s, by, *first) && cells.iter().any(|&c| sees(&s, by, centre(c, m.w)))
                    {
                        partly += 1;
                        let got = observed_walls(&s, other);
                        if got.len() != 1 || &got[0].tiles != cells {
                            unsent.push(format!(
                                "caster ({tx},{ty}) aiming {k}/8 turn at {dist} u, bystander at ({:.0},{:.0}): sees part of a {}-tile wall, not its first end {:?}; sent {} wall(s)",
                                by.x,
                                by.y,
                                cells.len(),
                                first,
                                got.len()
                            ));
                        }
                    }
                }
            }
        }
    }
    assert!(
        raised > 0 && hidden_end > 0,
        "the scene must include walls whose first end the caster cannot see ({raised} raised, {hidden_end} with a hidden first end)"
    );
    assert!(
        partly > 0,
        "the scene must include walls a bystander sees in part but not by their first end ({partly})"
    );
    assert!(
        missing.is_empty() && unsent.is_empty(),
        "{} of {raised} raised walls never reached their caster, e.g.\n{}\n{} of {partly} walls a bystander saw in part, not by their first end, never reached it, e.g.\n{}",
        missing.len(),
        missing[..missing.len().min(6)].join("\n"),
        unsent.len(),
        unsent[..unsent.len().min(6)].join("\n")
    );
}
