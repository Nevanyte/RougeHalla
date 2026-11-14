//! P-FROST-WALL-1c oracle: the remaining body-map readers see a standing Frost Wall (travel-cannon landings, Plague
//! zombie placement and hit line, the Frost bruiser passive's reach, Wind emblem spawns and pick-ups). Legacy: unreleased
//! patch 78dd8bd4 makes `collisionMap(world)` (`packages/server/src/sim/world.ts:1079` there) carry the wall's tiles LOW, and
//! these in-repo readers call it: `consumables.ts:107` (`useCannon`), `:159` and `:172` (`updateWindEmblems`),
//! `plagueZombies.ts:25` (placement beside the owner) and `:138` (`canHit`), `bruiserPassives.ts:48` (`lockedElite`).
//! A loose proof (owner direction 2026-11-10): one test per reader with the wall standing, and one guard per reader with
//! the switch off (`FrostWish::Freeze`) pinning today's exact result.
use super::*;
use crate::{
    abilities::{self as a, Slot},
    constants::{CANNON_COOLDOWN_MS, PLAYER_RADIUS, TICK_MS, WIND_SPAWN_MAX_MS, WIND_SPAWN_MIN_MS},
    events::{CannonNotice, Event},
    geometry::{circle_clear, has_line_of_sight},
    input::RawCommand,
    map::{MASK_MELEE, MASK_MOVE, TILE_WALL},
    rng::Mulberry32,
    state::ContainerKind,
    status_runtime::FieldKind,
    Arena, FactionId, FactionMode, FrostWish, Placement, PlayerId, Secrets, Sim, SimConfig,
    WeaponId,
};

// ---- the room and the rig (as barriers_push_tests: the legacy 40 x 20 `roomMap`) ----

/// The room's size in tiles (functions, not consts: the content registry counts every const in `src`).
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

/// The open room with a wall border, plus every tile for which `solid(x, y)` holds.
fn map_where(solid: impl Fn(u32, u32) -> bool) -> TileMap {
    let mut tiles = vec![TILE_FLOOR; (w_tiles() * h_tiles()) as usize];
    for y in 0..h_tiles() {
        for x in 0..w_tiles() {
            let border = x == 0 || y == 0 || x == w_tiles() - 1 || y == h_tiles() - 1;
            if border || solid(x, y) {
                tiles[(y * w_tiles() + x) as usize] = TILE_WALL;
            }
        }
    }
    TileMap::new(w_tiles(), h_tiles(), tiles).unwrap()
}

fn open_room() -> TileMap {
    map_where(|_, _| false)
}

/// Column 12, rows 7..=13: the wall of a cast from row 10 west of it, aimed at (12, 10).
fn column_12() -> Vec<u32> {
    (7..=13).map(|y| y * w_tiles() + 12).collect()
}

struct Seat {
    faction: FactionId,
    at: Vec2,
    weapon: Option<WeaponId>,
}

fn seat(faction: FactionId, at: Vec2) -> Seat {
    Seat {
        faction,
        at,
        weapon: None,
    }
}

fn config(wish: FrostWish) -> SimConfig {
    SimConfig {
        abilities: a::Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: wish,
        quests: false,
        consumables: false,
        ..Default::default()
    }
}

fn rig(cfg: SimConfig, map: TileMap, seats: &[Seat]) -> Sim {
    let placements: Vec<Placement> = seats
        .iter()
        .enumerate()
        .map(|(i, s)| Placement {
            profile: format!("p{i}"),
            faction: s.faction,
            bot: false,
            at: s.at,
            hp: Some(1e9),
            weapon0: s.weapon,
            weapon1: None,
        })
        .collect();
    let spawns = (0..8).map(|i| Vec2::new(tc(3 + i), tc(3))).collect();
    let mut s = Sim::reset_active(
        cfg,
        Arena { map, spawns },
        Secrets::from_seed(11),
        &placements,
    );
    s.step();
    s
}

fn id(s: &Sim, i: usize) -> PlayerId {
    s.players()[i].id
}

fn pos(s: &Sim, i: usize) -> Vec2 {
    s.players()[i].pos()
}

fn submit(s: &mut Sim, who: usize, raw: RawCommand) {
    let who = id(s, who);
    let cmd = crate::validate(raw).unwrap();
    s.submit(who, cmd).unwrap();
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

/// Seat `caster` (Frost) raises a wall aimed at (12, 10); returns once it stands, whole, on column 12.
fn raise_wall_at_column_12(s: &mut Sim, caster: usize) {
    submit(
        s,
        caster,
        RawCommand::Cast {
            slot: Slot::Wish,
            x: tc(12),
            y: tc(10),
            id: None,
            t: None,
            seq: None,
        },
    );
    let end = s.server_time() + a::FROST_WALL_CAST_MS + 4. * TICK_MS;
    while walls(s) == 0 && s.server_time() < end {
        s.step();
    }
    assert_eq!(walls(s), 1, "the wall rose");
    assert_eq!(barrier_cells(s), column_12(), "the wall stands whole");
}

/// The map bodies read now (the wall's tiles LOW while it stands).
fn with_body_map<R>(s: &Sim, f: impl FnOnce(&TileMap) -> R) -> R {
    let held = held(&s.w);
    f(body_map(&s.k, &held, s.w.rt.gates_locked))
}

/// Does a body disc of `PLAYER_RADIUS` at `p` touch no wall tile (and nothing else solid)?
fn clear_of_the_ice(s: &Sim, p: Vec2) -> bool {
    with_body_map(s, |m| circle_clear(m, p, PLAYER_RADIUS, MASK_MOVE))
}

/// Is `p`'s tile one of the wall's?
fn on_a_wall_tile(s: &Sim, p: Vec2) -> bool {
    let tx = crate::math::floor_i64(p.x / TILE);
    let ty = crate::math::floor_i64(p.y / TILE);
    let i = (ty * i64::from(w_tiles()) + tx) as u32;
    barrier_cells(s).contains(&i)
}

// ---- 1. travel cannons (legacy consumables.ts:107 `if (!circleClear(collisionMap(world), landing, PLAYER_RADIUS)) return;`) ----

/// A travel cannon beside seat 1 at (20, 10) whose landing is `landing`; seat 1 fires it. Returns (events of the firing
/// steps, the cannon's `ready_at` after them).
fn fire_cannon(s: &mut Sim, landing: Vec2) -> (Vec<Event>, f64) {
    let at = Vec2::new(pos(s, 1).x + 8., pos(s, 1).y);
    let tick = s.w.tick;
    let cid = crate::systems::items::add_container(
        &mut s.w,
        ContainerKind::Cannon,
        at,
        [None, None],
        tick,
        false,
    );
    let i = s.w.containers.iter().position(|c| c.id == cid).unwrap();
    s.w.containers[i].target = Some(landing);
    s.step();
    submit(s, 1, RawCommand::Pickup { container_id: cid });
    let mut ev = Vec::new();
    s.step_into(&mut ev);
    s.step_into(&mut ev);
    let ready_at =
        s.w.containers
            .iter()
            .find(|c| c.id == cid)
            .expect("the cannon stays")
            .ready_at;
    (ev, ready_at)
}

fn blasts(ev: &[Event]) -> usize {
    ev.iter()
        .filter(|e| {
            matches!(
                e,
                Event::CannonNotice {
                    notice: CannonNotice::Blast,
                    ..
                }
            )
        })
        .count()
}

#[test]
fn a_cannon_whose_landing_is_on_a_standing_wall_does_not_fire() {
    let mut s = rig(
        config(FrostWish::Wall),
        open_room(),
        &[
            seat(FactionId::Frost, Vec2::new(tc(5), tc(10))),
            seat(FactionId::Fire, Vec2::new(tc(20), tc(10))),
        ],
    );
    raise_wall_at_column_12(&mut s, 0);
    let before = pos(&s, 1);
    let landing = Vec2::new(tc(12), tc(10));
    assert!(
        on_a_wall_tile(&s, landing),
        "premise: the landing is in the ice"
    );
    let (ev, ready_at) = fire_cannon(&mut s, landing);
    assert_eq!(walls(&s), 1, "premise: the wall still stands");
    let p = pos(&s, 1);
    assert!(
        clear_of_the_ice(&s, p),
        "the shot never lands a player in the ice: {p:?}"
    );
    // Legacy declines a blocked landing silently: no blast, no reload, the player stays where it stood.
    assert_eq!(p, before, "a blocked landing is declined: {p:?}");
    assert_eq!(blasts(&ev), 0, "no blast");
    assert_eq!(ready_at, 0., "no reload stamped");
}

#[test]
fn guard_switch_off_a_cannon_lands_exactly_on_its_target() {
    let mut s = rig(
        config(FrostWish::Freeze),
        open_room(),
        &[
            seat(FactionId::Frost, Vec2::new(tc(5), tc(10))),
            seat(FactionId::Fire, Vec2::new(tc(20), tc(10))),
        ],
    );
    let landing = Vec2::new(tc(12), tc(10));
    let fired_at = s.server_time();
    let (ev, ready_at) = fire_cannon(&mut s, landing);
    assert_eq!(pos(&s, 1), landing, "the blast lands on the target");
    assert_eq!(blasts(&ev), 1, "one blast");
    // The pickup applies in the first of the two steps after submission.
    assert_eq!(
        ready_at,
        fired_at + 2. * TICK_MS + CANNON_COOLDOWN_MS,
        "reload stamped at the firing step"
    );
}

// ---- 2. Plague zombies (legacy plagueZombies.ts:25 placement, :138 `canHit`, both on collisionMap with MASK_MOVE) ----

fn plague_config(wish: FrostWish) -> SimConfig {
    SimConfig {
        faction_mode: FactionMode::EngagementHolyPlagueFireFrost,
        ..config(wish)
    }
}

/// Legacy `plagueZombies.ts:24-35`: the first of distances 32, 24, 16 x turns pi, pi/2, -pi/2, 0 from the owner's facing
/// whose disc is clear on `map` and in the owner's line of sight (MASK_MOVE); the owner's spot when none is.
fn legacy_beside_owner(map: &TileMap, from: Vec2, facing: f64) -> Vec2 {
    for distance in [32., 24., 16.] {
        for turn in [
            std::f64::consts::PI,
            std::f64::consts::FRAC_PI_2,
            -std::f64::consts::FRAC_PI_2,
            0.,
        ] {
            let a = facing + turn;
            let at = Vec2::new(
                from.x + crate::math::cos(a) * distance,
                from.y + crate::math::sin(a) * distance,
            );
            if circle_clear(map, at, PLAYER_RADIUS, MASK_MOVE)
                && has_line_of_sight(map, from, at, MASK_MOVE)
            {
                return at;
            }
        }
    }
    from
}

fn raise_zombie(s: &mut Sim, owner: usize) -> PlayerId {
    let owner_id = id(s, owner);
    crate::systems::plague_zombies::raise_or_grow(&s.k, &mut s.w, owner_id);
    crate::systems::plague_zombies::zombie_of(&s.w, owner_id).expect("a zombie was raised")
}

fn zombie_pos(s: &Sim, z: PlayerId) -> Vec2 {
    s.w.mobs.get(z).unwrap().core.pos()
}

#[test]
fn a_zombie_raised_beside_an_owner_against_the_wall_is_not_placed_in_the_ice() {
    // The owner stands against the wall's east face, facing east: the first candidate (behind it, 32 u west) is the
    // wall's tile; legacy rejects it on collisionMap and takes the next (pi/2: 32 u south).
    let mut s = rig(
        plague_config(FrostWish::Wall),
        open_room(),
        &[
            seat(FactionId::Frost, Vec2::new(tc(5), tc(10))),
            seat(FactionId::Plague, Vec2::new(tc(13), tc(10))),
        ],
    );
    raise_wall_at_column_12(&mut s, 0);
    assert_eq!(
        pos(&s, 1),
        Vec2::new(tc(13), tc(10)),
        "premise: the owner was not moved"
    );
    s.w.players[1].body.facing = 0.;
    let z = raise_zombie(&mut s, 1);
    let at = zombie_pos(&s, z);
    assert!(
        !on_a_wall_tile(&s, at),
        "the zombie is not on a wall tile: {at:?}"
    );
    assert!(
        clear_of_the_ice(&s, at),
        "the zombie's disc is clear of the ice: {at:?}"
    );
    let want = with_body_map(&s, |m| legacy_beside_owner(m, pos(&s, 1), 0.));
    assert_eq!(at, want, "legacy's pick on the map with the wall");
}

#[test]
fn guard_switch_off_a_zombie_is_raised_behind_its_owner() {
    let mut s = rig(
        plague_config(FrostWish::Freeze),
        open_room(),
        &[
            seat(FactionId::Frost, Vec2::new(tc(5), tc(10))),
            seat(FactionId::Plague, Vec2::new(tc(13), tc(10))),
        ],
    );
    s.w.players[1].body.facing = 0.;
    let z = raise_zombie(&mut s, 1);
    let from = pos(&s, 1);
    let behind = Vec2::new(
        from.x + crate::math::cos(std::f64::consts::PI) * 32.,
        from.y + crate::math::sin(std::f64::consts::PI) * 32.,
    );
    assert_eq!(
        zombie_pos(&s, z),
        behind,
        "today's first candidate, 32 u behind"
    );
}

/// The Frost caster at (5, 4), the Plague owner at (9, 10), a Fire target at (430, 336) east of column 12; the owner's
/// zombie is put at (370, 336), 60 u from the target (within legacy's 66), and set to assist on it.
fn zombie_duel(wish: FrostWish) -> (Sim, PlayerId, PlayerId) {
    let mut s = rig(
        plague_config(wish),
        open_room(),
        &[
            seat(FactionId::Frost, Vec2::new(tc(5), tc(10))),
            seat(FactionId::Plague, Vec2::new(tc(9), tc(10))),
            seat(FactionId::Fire, Vec2::new(430., tc(10))),
        ],
    );
    if wish == FrostWish::Wall {
        raise_wall_at_column_12(&mut s, 0);
    }
    assert_eq!(
        pos(&s, 2),
        Vec2::new(430., tc(10)),
        "premise: the target was not moved"
    );
    let z = raise_zombie(&mut s, 1);
    let target = id(&s, 2);
    let now = s.server_time();
    let at = Vec2::new(370., tc(10));
    let m = s.w.mobs.get_mut(z).unwrap();
    m.core.body.x = at.x;
    m.core.body.y = at.y;
    m.core.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
    let zs = m.zombie.as_mut().unwrap();
    zs.target = Some(target);
    zs.assist_until = now + 60_000.;
    (s, z, target)
}

#[test]
fn a_zombie_whose_hit_line_crosses_the_wall_does_not_swing_through_it() {
    let (mut s, z, target) = zombie_duel(FrostWish::Wall);
    let hp = s.w.player(target).unwrap().vitals.hp;
    for _ in 0..10 {
        s.step();
        assert_eq!(walls(&s), 1, "premise: the wall stands");
        let zp = zombie_pos(&s, z);
        let tp = s.w.player(target).unwrap().pos();
        let crosses = with_body_map(&s, |m| !has_line_of_sight(m, zp, tp, MASK_MOVE));
        let held = s.w.mobs.get(z).unwrap().core.weapon.held;
        assert!(
            !(held && crosses),
            "legacy canHit reads collisionMap: no swing held across the ice (zombie {zp:?}, target {tp:?}, tick {})",
            s.tick()
        );
    }
    assert_eq!(
        s.w.player(target).unwrap().vitals.hp,
        hp,
        "nothing connected across the ice"
    );
}

#[test]
fn guard_switch_off_a_zombie_in_reach_swings_at_once() {
    let (mut s, z, target) = zombie_duel(FrostWish::Freeze);
    let start = zombie_pos(&s, z);
    s.step();
    s.step();
    assert!(
        s.w.mobs.get(z).unwrap().core.weapon.held,
        "today: in reach, in line, it holds its swing"
    );
    assert_eq!(zombie_pos(&s, z), start, "and stands");
    let _ = target;
}

// ---- 3. Frost bruiser passive (legacy bruiserPassives.ts:48 `hasLineOfSight(collisionMap(world), ..., reachMask(weapon))`) ----

/// The Frost caster at (10, 10) with `weapon`, the wall raised on column 12 (64 u: the minimum range) when `wish` is
/// `Wall`, and an elite mob at (440, 336) east of it, 104 u away (a sword's lock reach is 112 + 12), locked by the caster.
fn bruiser_rig(wish: FrostWish, weapon: WeaponId) -> (Sim, PlayerId) {
    let mut s = rig(
        config(wish),
        open_room(),
        &[Seat {
            faction: FactionId::Frost,
            at: Vec2::new(tc(10), tc(10)),
            weapon: Some(weapon),
        }],
    );
    if wish == FrostWish::Wall {
        raise_wall_at_column_12(&mut s, 0);
    }
    assert_eq!(
        s.players()[0].active_weapon(),
        weapon,
        "premise: the weapon in hand"
    );
    let ty = crate::mob_catalog::mob_type_by_id("emberImp").unwrap().id;
    let mob = crate::systems::mobs::place_practice_mob(
        &mut s.w,
        ty,
        true,
        101,
        Vec2::new(440., tc(10)),
        0.,
        crate::archetype::HitboxMode::LegacyCircle,
    );
    s.w.players[0].weapon.targeting.target = Some(mob);
    s.w.players[0].frost_guard = Default::default();
    (s, mob)
}

fn guard_after_update(s: &mut Sim) -> bool {
    crate::systems::bruiser::update_all(&s.k, &mut s.w, Default::default());
    s.w.players[0].frost_guard.active
}

#[test]
fn the_bruiser_passive_does_not_reach_across_a_wall_a_swing_cannot_cross() {
    let (mut s, mob) = bruiser_rig(FrostWish::Wall, WeaponId::Sword);
    let from = pos(&s, 0);
    let to = s.w.mobs.get(mob).unwrap().core.pos();
    assert!(
        with_body_map(&s, |m| !has_line_of_sight(m, from, to, MASK_MELEE)),
        "premise: a sword swing does not cross the standing wall"
    );
    assert!(
        has_line_of_sight(s.k.collision_map(false), from, to, MASK_MELEE),
        "premise: only the wall is between them"
    );
    assert!(
        !guard_after_update(&mut s),
        "Frozen Justice's elite lock reads the wall as the swing does"
    );
}

#[test]
fn the_bruiser_passive_with_a_ranged_weapon_still_sees_over_the_wall() {
    // reachMask(bow) is MASK_SIGHT: shots and sight pass the wall, so the ranged lock holds (legacy and today alike).
    let (mut s, _) = bruiser_rig(FrostWish::Wall, WeaponId::Bow);
    assert!(
        guard_after_update(&mut s),
        "a bow's lock passes over the ice"
    );
}

#[test]
fn guard_switch_off_the_bruiser_passive_reaches_the_elite() {
    let (mut s, _) = bruiser_rig(FrostWish::Freeze, WeaponId::Sword);
    assert!(
        guard_after_update(&mut s),
        "today: in reach and in line, the guard is up"
    );
}

// ---- 4. Wind emblems (legacy consumables.ts:159 pick-up line, :172-177 spawn on collisionMap) ----

fn wind_config(wish: FrostWish) -> SimConfig {
    SimConfig {
        consumables: true,
        ..config(wish)
    }
}

/// A strip four tiles wide (columns 10..=13, rows 1..=18) in solid rock: the wall's seven tiles are a tenth of the
/// floor a spawn may take, so a seeded run draws many candidates on them.
fn strip() -> TileMap {
    map_where(|x, _| !(10..=13).contains(&x))
}

/// Legacy `updateWindEmblems`' spawn (consumables.ts:170-177) with no other emblem standing: one timer draw, then up to
/// 40 attempts of two draws each, the first candidate whose disc is clear on `map` taken. Returns the spawn and the
/// number of candidates rejected.
fn legacy_spawn(map: &TileMap, rng: &mut Mulberry32) -> (Option<Vec2>, u32) {
    let _timer = WIND_SPAWN_MIN_MS + rng.next_f64() * (WIND_SPAWN_MAX_MS - WIND_SPAWN_MIN_MS);
    let mut rejected = 0;
    for _ in 0..40 {
        let x = ((rng.next_f64() * f64::from(map.w)).floor() + 0.5) * TILE;
        let y = ((rng.next_f64() * f64::from(map.h)).floor() + 0.5) * TILE;
        let at = Vec2::new(x, y);
        if circle_clear(map, at, PLAYER_RADIUS, MASK_MOVE) {
            return (Some(at), rejected);
        }
        rejected += 1;
    }
    (None, rejected)
}

fn emblems(s: &Sim) -> Vec<Vec2> {
    s.w.containers
        .iter()
        .filter(|c| c.kind == ContainerKind::WindEmblem)
        .map(|c| c.at)
        .collect()
}

/// Forces the spawn timer due each step while `standing` holds, clearing the emblems after each so the cap and the
/// spacing never decide; checks each spawn and the stream against [`legacy_spawn`] on the map bodies read. Returns
/// (forced timers checked, spawns, spawns that differ from the open map's).
fn run_spawns(s: &mut Sim, steps: usize, standing: impl Fn(&Sim) -> bool) -> (usize, usize, u32) {
    let mut checked = 0;
    let mut spawns = 0;
    let mut on_wall = 0;
    for _ in 0..steps {
        if !standing(s) {
            break;
        }
        s.w.wind_next_at = s.server_time();
        let mut rng = s.w.wind_rng.clone();
        let (want, _) = with_body_map(s, |m| legacy_spawn(m, &mut rng));
        let plain = {
            let mut r = s.w.wind_rng.clone();
            legacy_spawn(s.k.collision_map(s.w.rt.gates_locked), &mut r)
        };
        s.step();
        if !standing(s) {
            break;
        }
        checked += 1;
        let got = emblems(s);
        assert_eq!(
            got.first().copied(),
            want,
            "the spawn is legacy's on the map with the wall (tick {})",
            s.tick()
        );
        assert_eq!(got.len(), usize::from(want.is_some()), "one spawn at most");
        assert_eq!(
            s.w.wind_rng.state(),
            rng.state(),
            "the stream advanced by legacy's draw count (tick {})",
            s.tick()
        );
        if let Some(at) = got.first() {
            assert!(!on_a_wall_tile(s, *at), "an emblem in the ice: {at:?}");
            spawns += 1;
        }
        if plain.0 != want {
            on_wall += 1;
        }
        s.w.containers
            .retain(|c| c.kind != ContainerKind::WindEmblem);
    }
    (checked, spawns, on_wall)
}

#[test]
fn wind_emblems_never_spawn_in_the_ice_and_a_rejected_candidate_draws_again() {
    let mut s = rig(
        wind_config(FrostWish::Wall),
        strip(),
        &[seat(FactionId::Frost, Vec2::new(tc(10), tc(10)))],
    );
    raise_wall_at_column_12(&mut s, 0);
    let (checked, spawns, on_wall) = run_spawns(&mut s, 200, |s| walls(s) == 1);
    assert!(
        checked >= 70 && spawns >= 60,
        "premise: the run spawned while the wall stood ({spawns} of {checked})"
    );
    assert!(
        on_wall > 0,
        "premise: the seeded run drew candidates on the wall's tiles ({on_wall} spawns differ from the open map)"
    );
}

#[test]
fn guard_switch_off_wind_spawns_and_draws_are_todays() {
    let mut s = rig(
        wind_config(FrostWish::Freeze),
        strip(),
        &[seat(FactionId::Frost, Vec2::new(tc(10), tc(10)))],
    );
    let (checked, spawns, on_wall) = run_spawns(&mut s, 80, |_| true);
    assert_eq!(checked, 80, "every forced timer checked");
    assert!(
        spawns >= 70,
        "a spawn for (nearly) every forced timer: {spawns}"
    );
    assert_eq!(on_wall, 0, "no wall: the body map is the open map");
}

/// An emblem lying on a wall tile (the wall rose over it) and a player 29.5 u east of it, outside the ice.
fn emblem_under_the_wall(wish: FrostWish) -> Sim {
    let mut s = rig(
        wind_config(wish),
        open_room(),
        &[
            seat(FactionId::Frost, Vec2::new(tc(5), tc(10))),
            seat(FactionId::Fire, Vec2::new(tc(12) + 29.5, tc(10))),
        ],
    );
    if wish == FrostWish::Wall {
        raise_wall_at_column_12(&mut s, 0);
    }
    assert_eq!(
        pos(&s, 1),
        Vec2::new(tc(12) + 29.5, tc(10)),
        "premise: not moved"
    );
    s.w.wind_next_at = f64::INFINITY;
    s.w.containers
        .retain(|c| c.kind != ContainerKind::WindEmblem);
    let tick = s.w.tick;
    crate::systems::items::add_wind_emblem(&mut s.w, Vec2::new(tc(12), tc(10)), tick);
    s
}

#[test]
fn a_wind_emblem_in_the_ice_is_not_picked_up_from_beside_it() {
    let mut s = emblem_under_the_wall(FrostWish::Wall);
    for _ in 0..4 {
        s.step();
    }
    assert_eq!(walls(&s), 1, "premise: the wall stands");
    assert_eq!(
        emblems(&s).len(),
        1,
        "legacy's pick-up line (MASK_MOVE) is stopped by the ice"
    );
    assert_eq!(s.w.players[1].speed_boost_until, 0., "no boost");
}

#[test]
fn guard_switch_off_a_wind_emblem_in_reach_is_picked_up() {
    let mut s = emblem_under_the_wall(FrostWish::Freeze);
    for _ in 0..4 {
        s.step();
    }
    assert!(emblems(&s).is_empty(), "today: taken");
    assert!(s.w.players[1].speed_boost_until > 0., "boosted");
}
