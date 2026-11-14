//! P-FROST-WALL-PUBLIC-1 oracle (brief `docs/backlog/packets/P-FROST-WALL-PUBLIC-1.md`): a standing Frost Wall is
//! temporary terrain, public like the map. Owner decision 2026-11-14 (chat): "to avoid bugs and stay consistent please
//! send to everyone, it effectively should be a temp wall within the engine".
//!
//! `status_runtime/observe.rs` `project` sends every standing wall, whole (both ends, tiles, start and end times,
//! ability), to every seated viewer, alive or dead, wherever it stands. Unchanged: the owner is named only to the owner
//! and to a viewer who sees the owner (C-OBS keeps the actor hidden; legacy synced the owner id too); zone, cloud and
//! trail fields keep their sight rules; an unseated viewer gets nothing; `public()` is unchanged.
//!
//! Today (P-FROST-WALL-NOWALL-1) a viewer who is not the owner and sees neither the first end nor any tile is sent no
//! wall, so the tests below that put such a viewer in the scene fail on that assertion.
use super::*;
use crate::{
    abilities::{self as a, Slot},
    constants::TICK_MS,
    input::RawCommand,
    map::TILE_WALL,
    mapdata::FeatureKind,
    status_runtime::{AbilityId, Field, FieldKind, FieldView, StatusSource},
    Arena, FactionId, FrostWish, Placement, PlayerId, Secrets, Sim, SimConfig,
};

/// Tile centre in world units.
fn tc(t: u32) -> f64 {
    f64::from(t) * TILE + TILE / 2.
}

fn id(s: &Sim, i: usize) -> PlayerId {
    s.players()[i].id
}

/// Casts slot 0's Wish at `to` and steps past the 250 ms cast.
fn cast(s: &mut Sim, to: Vec2) {
    let who = id(s, 0);
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

/// The standing walls as the public snapshot carries them (whole, owner named): the reference a viewer's row is
/// compared with.
fn public_walls(s: &Sim) -> Vec<FieldView> {
    crate::public_snapshot(s)
        .fields
        .into_iter()
        .filter(|f| f.kind == FieldKind::Wall)
        .collect()
}

/// Kills slot `i` in place (as `quest_view/carrier_actor_tests.rs` does): a seated, dead viewer.
fn kill(s: &mut Sim, i: usize) {
    let who = id(s, i);
    let k = s.w.idx(who).unwrap();
    s.w.players[k].status = crate::sim::Status::Dead;
}

/// The sim's own sight test for `viewer` (radius, line, sight memory, wards): what `project` asks today.
fn point_seen(s: &Sim, viewer: PlayerId, p: Vec2) -> bool {
    let me = s.player(viewer).unwrap();
    crate::vision::point_visible(
        s.collision_view(),
        me,
        p,
        s.w.tick,
        crate::vision::WardSight::of_sim(s),
    )
}

/// Does `viewer` see none of `wall` (neither its first end nor any tile centre)? Under today's rule such a viewer,
/// if it is not the owner, is sent nothing.
fn sees_none_of(s: &Sim, viewer: PlayerId, wall: &FieldView, w: u32) -> bool {
    !point_seen(s, viewer, Vec2::new(wall.x, wall.y))
        && wall
            .tiles
            .iter()
            .all(|&i| !point_seen(s, viewer, Vec2::new(tc(i % w), tc(i / w))))
}

/// Every standing wall reaches `viewer`, whole: the public row, with the owner named exactly when the viewer is the
/// owner or the owner is among the actors the viewer is sent. Returns a description of each failure.
fn check_every_wall_reaches(s: &Sim, viewer: PlayerId, label: &str) -> Vec<String> {
    let obs = crate::observe(s, viewer, &[]);
    let mut got: Vec<&FieldView> = obs
        .fields
        .iter()
        .filter(|f| f.kind == FieldKind::Wall)
        .collect();
    let mut problems = Vec::new();
    for want in public_walls(s) {
        let owner_seen = want
            .owner
            .is_some_and(|o| o == viewer || obs.visible.iter().any(|a| a.id == o));
        let mut want = want.clone();
        if !owner_seen {
            want.owner = None;
        }
        match got.iter().position(|f| **f == want) {
            Some(k) => {
                got.remove(k);
            }
            None => problems.push(format!(
                "{label} ({viewer:?}) was not sent the wall {:?}..{:?} on {} tiles (owner shown: {}); it was sent {} wall(s): {:?}",
                (want.x, want.y),
                (want.x2, want.y2),
                want.tiles.len(),
                owner_seen,
                obs.fields.iter().filter(|f| f.kind == FieldKind::Wall).count(),
                obs.fields
                    .iter()
                    .filter(|f| f.kind == FieldKind::Wall)
                    .map(|f| (f.owner, f.tiles.len()))
                    .collect::<Vec<_>>()
            )),
        }
    }
    if !got.is_empty() {
        problems.push(format!(
            "{label} ({viewer:?}) was sent {} wall row(s) no wall stands for",
            got.len()
        ));
    }
    problems
}

// ---- a room with a rock screen (the legacy 40 x 20 `roomMap`, as the other barrier tests) ----

const W: u32 = 40;
const H: u32 = 20;

/// The open room with a wall border, plus a full rock screen on columns 20..=21 (every row).
fn screened_room() -> TileMap {
    let mut tiles = vec![TILE_FLOOR; (W * H) as usize];
    for y in 0..H {
        for x in 0..W {
            let border = x == 0 || y == 0 || x == W - 1 || y == H - 1;
            if border || (20..=21).contains(&x) {
                tiles[(y * W + x) as usize] = TILE_WALL;
            }
        }
    }
    TileMap::new(W, H, tiles).unwrap()
}

/// Slots: 0 Frost caster at tile (5, 10); 1 `near` Fire at (8, 4), in sight of everything west of the screen;
/// 2 `far` Holy at (30, 10), behind the screen: it sees no tile of the wall and not the caster;
/// 3 `dead` Plague at (6, 16), west of the screen (it would see the wall alive), killed after the wall stands.
const CASTER: usize = 0;
const NEAR: usize = 1;
const FAR: usize = 2;
const DEAD: usize = 3;

fn room() -> Sim {
    let at = [
        (FactionId::Frost, Vec2::new(tc(5), tc(10))),
        (FactionId::Fire, Vec2::new(tc(8), tc(4))),
        (FactionId::Holy, Vec2::new(tc(30), tc(10))),
        (FactionId::Plague, Vec2::new(tc(6), tc(16))),
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
    let config = SimConfig {
        abilities: a::Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: FrostWish::Wall,
        quests: false,
        consumables: false,
        ..Default::default()
    };
    let mut s = Sim::reset_active(
        config,
        Arena {
            map: screened_room(),
            spawns,
        },
        Secrets::from_seed(11),
        &placements,
    );
    // Past the 30 s sight memory (`VISION_TRAIL_MS`; spawns are dealt round-robin), so each sees only from where it
    // stands, as the other barrier tests do.
    for _ in 0..640 {
        s.step();
    }
    s
}

/// Column 12, rows 7..=13: the wall of a cast from (5, 10) aimed at (12, 10).
fn column_12() -> Vec<u32> {
    (7..=13).map(|y| y * W + 12).collect()
}

/// A room with a wall standing (the dead viewer killed after it rose).
fn room_with_wall() -> Sim {
    let mut s = room();
    cast(&mut s, Vec2::new(tc(12), tc(10)));
    let up = public_walls(&s);
    assert_eq!(up.len(), 1, "setup: the cast raised one wall: {up:?}");
    assert_eq!(up[0].tiles, column_12(), "setup: on column 12, rows 7..=13");
    assert_eq!(up[0].owner, Some(id(&s, CASTER)));
    kill(&mut s, DEAD);
    s
}

/// (1) and (2) in a room: the viewer behind the screen, who sees none of the wall and not its caster, and a dead viewer
/// are each sent the whole wall, with no owner. The caster and the near viewer keep receiving it with the owner named.
#[test]
fn every_seated_viewer_far_or_dead_receives_the_whole_wall_and_only_a_viewer_who_sees_the_caster_is_told_the_owner(
) {
    let s = room_with_wall();
    let wall = &public_walls(&s)[0];
    let (caster, far, dead) = (id(&s, CASTER), id(&s, FAR), id(&s, DEAD));
    // The scene: today's rule withholds the wall from `far` and `dead`.
    assert!(
        sees_none_of(&s, far, wall, W),
        "the screen hides every tile and the first end from the far viewer"
    );
    assert!(
        sees_none_of(&s, dead, wall, W),
        "a dead viewer sees nothing"
    );
    let far_obs = crate::observe(&s, far, &[]);
    assert!(
        far_obs.visible.iter().all(|a| a.id != caster),
        "the far viewer does not see the caster"
    );
    let mut problems = Vec::new();
    for (slot, label) in [
        (CASTER, "the caster"),
        (NEAR, "the near viewer"),
        (FAR, "the far viewer behind the screen"),
        (DEAD, "the dead viewer"),
    ] {
        problems.extend(check_every_wall_reaches(&s, id(&s, slot), label));
    }
    assert!(
        problems.is_empty(),
        "a standing Frost Wall is public like the map:\n{}",
        problems.join("\n")
    );
    // (2), stated on its own: the far viewer and the dead viewer are not told who raised it.
    for v in [far, dead] {
        let o = crate::observe(&s, v, &[]);
        let w: Vec<_> = o
            .fields
            .iter()
            .filter(|f| f.kind == FieldKind::Wall)
            .collect();
        assert_eq!(w.len(), 1, "{v:?} is sent the wall");
        assert_eq!(
            w[0].owner, None,
            "{v:?} does not see the caster: the wall's owner stays hidden (C-OBS)"
        );
        assert_eq!(w[0].tiles, column_12(), "{v:?} gets every tile");
    }
    // Who is told the owner: the caster itself and the near viewer, who sees it.
    for v in [caster, id(&s, NEAR)] {
        let o = crate::observe(&s, v, &[]);
        let w = o.fields.iter().find(|f| f.kind == FieldKind::Wall).unwrap();
        assert_eq!(w.owner, Some(caster), "{v:?} sees the caster: owner named");
    }
}

fn extra(id: u32, kind: FieldKind, ability: AbilityId, at: Vec2, to: Vec2, r: f64) -> Field {
    Field {
        id,
        kind,
        ability,
        owner: StatusSource {
            id: None,
            name: "a field west of the screen".into(),
            owner_id: None,
        },
        subject: None,
        x: at.x,
        y: at.y,
        x2: to.x,
        y2: to.y,
        r,
        vx: 0.,
        vy: 0.,
        started_at: 0.,
        ends_at: 1e9,
        exit_stun_ms: None,
    }
}

/// (3): the other three field kinds keep their sight rules. With the wall standing, a zone, a cloud and a trail are
/// placed west of the screen: the near viewer is sent all four fields, the far viewer and the dead viewer only the
/// wall. Green today for the zone, cloud and trail; red today only because the far and dead viewers get no wall.
#[test]
fn zone_cloud_and_trail_fields_are_still_withheld_from_a_viewer_who_cannot_see_them() {
    let mut s = room_with_wall();
    let fields = &mut s.w.abilities.as_mut().unwrap().fields;
    let first = fields.iter().map(|f| f.id).max().unwrap() + 1;
    fields.push(extra(
        first,
        FieldKind::Zone,
        AbilityId::Trial,
        Vec2::new(tc(12), tc(3)),
        Vec2::new(tc(12), tc(3)),
        40.,
    ));
    fields.push(extra(
        first + 1,
        FieldKind::Cloud,
        AbilityId::Swarm,
        Vec2::new(tc(8), tc(14)),
        Vec2::new(tc(8), tc(14)),
        40.,
    ));
    fields.push(extra(
        first + 2,
        FieldKind::Trail,
        AbilityId::Blaze,
        Vec2::new(tc(10), tc(2)),
        Vec2::new(tc(16), tc(2)),
        16.,
    ));
    let kinds = |v: PlayerId| {
        let mut k: Vec<FieldKind> = crate::observe(&s, v, &[])
            .fields
            .iter()
            .map(|f| f.kind)
            .collect();
        k.sort();
        k
    };
    let mut all = vec![
        FieldKind::Wall,
        FieldKind::Zone,
        FieldKind::Cloud,
        FieldKind::Trail,
    ];
    all.sort();
    assert_eq!(
        kinds(id(&s, NEAR)),
        all,
        "guard: the near viewer sees every field, so the scene is not vacuous"
    );
    for (slot, label) in [(FAR, "the far viewer"), (DEAD, "the dead viewer")] {
        assert_eq!(
            kinds(id(&s, slot)),
            vec![FieldKind::Wall],
            "{label} is sent the standing wall (public) and no zone, cloud or trail (they keep their sight rules)"
        );
    }
}

// ---- the Web round 13 map (P-FROST-WALL-NOWALL-1) ----

/// The certified signature-landmark map the round-13 room played (pool seed 263678495, map hash 75bf127e), as the
/// server's `StyledMaker` builds it (no decor, `signature: true`), with its generator map.
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

/// (1) on the round-13 map, in the live content world: Frost on bog by the bog tree (the aim vector's spot, map
/// (122, 22), as `bog_tree_past_trunk`) casts its Wall in eight directions at 160 u and 300 u. Seated with it: a
/// Plague viewer three tiles away, a Holy viewer on the floor tile farthest from the caster (it sees none of any wall),
/// and a Fire viewer three tiles away who is dead when the wall is observed. Every raised wall must reach all four,
/// whole, with the owner named only to the caster and to a viewer whose observation carries the caster.
#[test]
fn round13_every_wall_cast_by_the_bog_tree_reaches_every_seated_viewer_far_or_dead() {
    let (arena, m) = round13();
    assert!(
        m.anchors.iter().any(|a| a.kind == FeatureKind::BogTree),
        "the signature map has a bog tree"
    );
    let floor =
        |x: u32, y: u32| x < m.w && y < m.h && m.tiles[(y * m.w + x) as usize] == TILE_FLOOR;
    let (cx, cy) = (122u32, 22u32);
    assert!(floor(cx, cy), "setup: the caster's spot is floor");
    let near = [(cx + 3, cy), (cx - 3, cy), (cx, cy + 3), (cx, cy - 3)]
        .into_iter()
        .filter(|&(x, y)| floor(x, y))
        .collect::<Vec<_>>();
    assert!(
        near.len() >= 2,
        "setup: two floor tiles three tiles from the caster"
    );
    // The floor tile farthest from the caster (row-major, first of the farthest).
    let mut far = (0, 0);
    let mut best = 0u64;
    for y in 0..m.h {
        for x in 0..m.w {
            let d = u64::from(x.abs_diff(cx)).pow(2) + u64::from(y.abs_diff(cy)).pow(2);
            if floor(x, y) && d > best {
                best = d;
                far = (x, y);
            }
        }
    }
    let at = |(x, y): (u32, u32)| Vec2::new(tc(x), tc(y));
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
        p("caster", FactionId::Frost, at((cx, cy))),
        p("near", FactionId::Plague, at(near[0])),
        p("far", FactionId::Holy, at(far)),
        p("dead", FactionId::Fire, at(near[1])),
    ];
    let mut base = Sim::reset_active(cfg, arena, Secrets::from_seed(7), &seats);
    // Past the 30 s sight memory of the dealt spawns.
    for _ in 0..640 {
        base.step();
    }
    let (mut raised, mut far_blind) = (0, 0);
    let mut problems = Vec::new();
    for k in 0..8 {
        for dist in [160., 300.] {
            let angle = f64::from(k) * std::f64::consts::FRAC_PI_4;
            let from = base.players()[0].pos();
            let to = Vec2::new(
                from.x + crate::math::cos(angle) * dist,
                from.y + crate::math::sin(angle) * dist,
            );
            let mut s = base.clone();
            cast(&mut s, to);
            let up = public_walls(&s);
            let Some(wall) = up.first() else {
                continue;
            };
            raised += 1;
            kill(&mut s, 3);
            let far_id = id(&s, 2);
            if sees_none_of(&s, far_id, wall, m.w) {
                far_blind += 1;
            }
            for (slot, label) in [
                (0, "the caster"),
                (1, "the near viewer"),
                (2, "the far viewer"),
                (3, "the dead viewer"),
            ] {
                problems.extend(
                    check_every_wall_reaches(&s, id(&s, slot), label)
                        .into_iter()
                        .map(|e| format!("aim {k}/8 turn at {dist} u: {e}")),
                );
            }
            let far_obs = crate::observe(&s, far_id, &[]);
            if let Some(w) = far_obs.fields.iter().find(|f| f.kind == FieldKind::Wall) {
                if w.owner.is_some() {
                    problems.push(format!(
                        "aim {k}/8 turn at {dist} u: the far viewer was told the owner {:?}",
                        w.owner
                    ));
                }
            }
        }
    }
    assert!(
        raised >= 4,
        "the scene raises walls ({raised} of 16 casts did)"
    );
    assert_eq!(
        far_blind, raised,
        "the far viewer (map {far:?}) sees none of any raised wall, so today's rule withholds every one"
    );
    assert!(
        problems.is_empty(),
        "{} problem(s) over {raised} raised walls, e.g.\n{}",
        problems.len(),
        problems[..problems.len().min(8)].join("\n")
    );
}
