//! P-FROST-WALL-1d oracle: the last body-map readers see a standing Frost Wall: loot pick-up and the observation's F-focus,
//! Plague corpse consume (F and auto), trader reach (the trade, the visitor rule, the walker). Legacy: unreleased patch
//! 78dd8bd4 makes `collisionMap(world)` (`packages/server/src/sim/world.ts:1079` there) carry the wall's tiles LOW, and
//! these in-repo readers call it with MASK_MOVE: `loot.ts:146` (handlePickup), `plagueCorpses.ts:51` (F) and `:86`
//! (auto), `traders.ts:65` (handleTrade) and `:103` (updateTraders' one `map`: the visitor line `:109`, `findPath` `:120`,
//! `segmentClear` `:129`).
//! A loose proof (owner direction 2026-11-10): one red test per reader with the wall standing; green guards with the
//! switch off (`FrostWish::Freeze`, today's exact result), with the thing on the player's own side of a standing wall, and
//! for the sight reads the wall must not stop.
use super::*;
use crate::{
    abilities::{self as a, Slot},
    constants::{PLAYER_RADIUS, TICK_MS, TRADER_STOP_MS},
    events::{Event, PlagueNotice},
    geometry::circle_clear,
    input::RawCommand,
    item_view::PropKind,
    map::{MASK_MOVE, TILE_WALL},
    state::ContainerKind,
    status_runtime::FieldKind,
    traders::{Kind, Stat, StatTrade, Trader, Traders},
    Arena, FactionId, FactionMode, FrostWish, PickupRefusal, Placement, PlayerId, Secrets, Sim,
    SimConfig, WeaponId,
};

// ---- the room and the rig (as barriers_readers_tests: the legacy 40 x 20 `roomMap`) ----

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

/// The open room with a wall border.
fn open_room() -> TileMap {
    let mut tiles = vec![TILE_FLOOR; (w_tiles() * h_tiles()) as usize];
    for y in 0..h_tiles() {
        for x in 0..w_tiles() {
            if x == 0 || y == 0 || x == w_tiles() - 1 || y == h_tiles() - 1 {
                tiles[(y * w_tiles() + x) as usize] = TILE_WALL;
            }
        }
    }
    TileMap::new(w_tiles(), h_tiles(), tiles).unwrap()
}

/// Column 12 (x 384..416), rows 7..=13: the wall of a cast from row 10 west of it, aimed at (12, 10).
fn column_12() -> Vec<u32> {
    (7..=13).map(|y| y * w_tiles() + 12).collect()
}

/// Plague is in the faction set (corpse consume is a signature-gated system); traders run in every non-training world.
fn config(wish: FrostWish) -> SimConfig {
    SimConfig {
        abilities: a::Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: wish,
        quests: false,
        consumables: false,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrost,
        ..Default::default()
    }
}

/// Seat 0: the Frost caster at (5, 10). Seat 1: `faction` at `at`, empty-handed.
fn rig(wish: FrostWish, faction: FactionId, at: Vec2) -> Sim {
    rig_with(config(wish), faction, at)
}

/// [`rig`] with `cfg` (its `frost_wish` decides whether the wall is raised).
fn rig_with(cfg: SimConfig, faction: FactionId, at: Vec2) -> Sim {
    let wish = cfg.frost_wish;
    let placements: Vec<Placement> = [(FactionId::Frost, Vec2::new(tc(5), tc(10))), (faction, at)]
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
    let spawns = (0..8).map(|i| Vec2::new(tc(3 + i), tc(3))).collect();
    let mut s = Sim::reset_active(
        cfg,
        Arena {
            map: open_room(),
            spawns,
        },
        Secrets::from_seed(11),
        &placements,
    );
    s.step();
    if wish == FrostWish::Wall {
        raise_wall_at_column_12(&mut s);
    }
    assert_eq!(pos(&s, 1), at, "premise: seat 1 was not moved");
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

/// Seat 0 (Frost) raises a wall aimed at (12, 10); returns once it stands, whole, on column 12.
fn raise_wall_at_column_12(s: &mut Sim) {
    submit(
        s,
        0,
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

/// Does a disc of `PLAYER_RADIUS` (a trader's path radius too) at `p` touch no wall tile?
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

/// Does the straight line from `a` to `b` cross the ice (MASK_MOVE on the body map) while the plain map leaves it open?
fn only_the_ice_between(s: &Sim, a: Vec2, b: Vec2) -> bool {
    let plain = s.k.collision_map(s.w.rt.gates_locked);
    !crate::geometry::ray_blocked(plain, a.x, a.y, b.x, b.y, MASK_MOVE)
        && with_body_map(s, |m| {
            crate::geometry::ray_blocked(m, a.x, a.y, b.x, b.y, MASK_MOVE)
        })
}

// ---- 1. loot pick-up (legacy loot.ts:146 `hasLineOfSight(collisionMap(world), p, box, MASK_MOVE)`) and the F-focus the
// observation derives from the same rule (item_view.rs:110 `pickup_reach`) ----

/// The taker east of the wall: 14 u clear of column 12's east face.
fn taker() -> Vec2 {
    Vec2::new(430., tc(10))
}

/// West of the wall, 54 u from the taker (INTERACT_RANGE 56): in reach but for the ice.
fn loot_across() -> Vec2 {
    Vec2::new(376., tc(10))
}

/// East of the wall, on the taker's side, 40 u from it.
fn loot_own_side() -> Vec2 {
    Vec2::new(470., tc(10))
}

/// A ground axe at `at`; returns its container id.
fn drop_axe(s: &mut Sim, at: Vec2) -> u32 {
    let tick = s.w.tick;
    let cid = crate::systems::items::add_container(
        &mut s.w,
        ContainerKind::Ground,
        at,
        [Some(WeaponId::Axe), None],
        tick,
        false,
    );
    s.step();
    cid
}

fn items_in(s: &Sim, cid: u32) -> usize {
    s.w.containers
        .iter()
        .find(|c| c.id == cid)
        .map_or(0, |c| c.items.len())
}

/// Seat 1 asks for container `cid`; the events of the step that applies it.
fn pick_up(s: &mut Sim, cid: u32) -> Vec<Event> {
    submit(s, 1, RawCommand::Pickup { container_id: cid });
    let mut ev = Vec::new();
    s.step_into(&mut ev);
    ev
}

fn refusals(ev: &[Event], who: PlayerId) -> Vec<(PickupRefusal, bool)> {
    ev.iter()
        .filter_map(|e| match e {
            Event::PickupRefused {
                id,
                reason,
                target_visible,
            } if *id == who => Some((*reason, *target_visible)),
            _ => None,
        })
        .collect()
}

/// The observation's ground-weapon row at `at` for seat 1, if published.
fn ground_row(s: &Sim, at: Vec2) -> Option<crate::item_view::PropCue> {
    let obs = crate::observe(s, id(s, 1), &[]);
    let (x, y) = (
        crate::item_view::position(at.x).unwrap(),
        crate::item_view::position(at.y).unwrap(),
    );
    obs.props
        .iter()
        .find(|p| p.cue.x == x && p.cue.y == y && matches!(p.cue.kind, PropKind::Ground(_)))
        .map(|p| p.cue.clone())
}

#[test]
fn loot_across_the_ice_is_not_picked_up() {
    let mut s = rig(FrostWish::Wall, FactionId::Fire, taker());
    let cid = drop_axe(&mut s, loot_across());
    assert!(
        only_the_ice_between(&s, taker(), loot_across()),
        "premise: only the wall's tiles cross the hand line"
    );
    let ev = pick_up(&mut s, cid);
    assert_eq!(walls(&s), 1, "premise: the wall still stands");
    assert_eq!(
        items_in(&s, cid),
        1,
        "legacy's hand line (MASK_MOVE on collisionMap) is stopped by the ice: the axe stays"
    );
    assert_eq!(s.players()[1].weapon.weapon0, None, "nothing taken");
    assert_eq!(
        refusals(&ev, id(&s, 1)),
        vec![(PickupRefusal::Unreachable, true)],
        "refused \"Can't reach that\"; sight passes the ice, so the target stays visible"
    );
}

#[test]
fn the_f_focus_is_not_offered_across_the_ice() {
    let mut s = rig(FrostWish::Wall, FactionId::Fire, taker());
    drop_axe(&mut s, loot_across());
    let row = ground_row(&s, loot_across()).expect("premise: the axe is seen over the ice");
    assert!(
        !row.focused,
        "the observation's F-focus follows the same hand reach as the pick-up (item_view.rs:110)"
    );
}

#[test]
fn guard_the_loot_across_the_ice_is_still_seen() {
    // Sight is not stopped by the wall: the row is published (only its focus may change).
    let mut s = rig(FrostWish::Wall, FactionId::Fire, taker());
    drop_axe(&mut s, loot_across());
    assert!(
        ground_row(&s, loot_across()).is_some(),
        "the axe's row is published"
    );
}

#[test]
fn guard_switch_off_loot_in_reach_is_picked_up_and_focused() {
    let mut s = rig(FrostWish::Freeze, FactionId::Fire, taker());
    let cid = drop_axe(&mut s, loot_across());
    assert!(
        ground_row(&s, loot_across()).unwrap().focused,
        "today: the axe has the F-focus"
    );
    let ev = pick_up(&mut s, cid);
    assert!(refusals(&ev, id(&s, 1)).is_empty(), "no refusal");
    assert_eq!(items_in(&s, cid), 0, "today: taken");
    assert_eq!(
        s.players()[1].weapon.weapon0,
        Some(WeaponId::Axe),
        "into the hand"
    );
}

#[test]
fn guard_loot_on_the_takers_side_of_a_standing_wall_is_picked_up_and_focused() {
    let mut s = rig(FrostWish::Wall, FactionId::Fire, taker());
    let cid = drop_axe(&mut s, loot_own_side());
    assert!(
        ground_row(&s, loot_own_side()).unwrap().focused,
        "the own-side axe has the F-focus"
    );
    let ev = pick_up(&mut s, cid);
    assert_eq!(walls(&s), 1, "premise: the wall still stands");
    assert!(refusals(&ev, id(&s, 1)).is_empty(), "no refusal");
    assert_eq!(items_in(&s, cid), 0, "taken");
    assert_eq!(
        s.players()[1].weapon.weapon0,
        Some(WeaponId::Axe),
        "into the hand"
    );
}

#[test]
fn guard_switch_off_the_observation_is_todays() {
    // A whole observation of the taker with the axe in reach (focused), the switch off: its digest is today's value, so
    // moving the reach read to the body map changes no byte of what a Freeze world sends.
    let mut s = rig(FrostWish::Freeze, FactionId::Fire, taker());
    drop_axe(&mut s, loot_across());
    let obs = crate::observe(&s, id(&s, 1), &[]);
    assert!(
        obs.props.iter().any(|p| p.cue.focused),
        "premise: a focused row"
    );
    assert_eq!(
        crate::hash::hash_of(0, &obs),
        observation_digest(),
        "the switch-off observation is byte-identical to today's"
    );
}

/// `hash_of(0, observe(taker))` in `guard_switch_off_the_observation_is_todays`, recorded on `85bfd025e` (a function, not a
/// const: the content registry counts every const in `src`).
fn observation_digest() -> u64 {
    0x1087_87a4_c319_b356
}

// ---- 2. Plague corpse consume (legacy plagueCorpses.ts:51 F, :86 auto; both `hasLineOfSight(collisionMap, p, corpse,
// MASK_MOVE)`). Both ranges are 24 u, so the corpse a player meets behind the ice is one the wall rose over. ----

/// The Plague owner 14 u clear of the wall's east face.
fn eater() -> Vec2 {
    Vec2::new(430., tc(10))
}

/// On column 12 (a wall tile when the wall stands), 20 u from the eater.
fn corpse_in_the_ice() -> Vec2 {
    Vec2::new(410., tc(10))
}

/// On the eater's side, 20 u from it.
fn corpse_own_side() -> Vec2 {
    Vec2::new(450., tc(10))
}

/// Lays seat 0's corpse at `at` (no step).
fn lay_corpse(s: &mut Sim, at: Vec2) -> PlayerId {
    let player = id(s, 0);
    s.w.plague_corpses.push(crate::state::PlagueCorpse {
        player,
        x: at.x,
        y: at.y,
    });
    player
}

fn corpse_stacks(s: &Sim) -> u32 {
    u32::from(s.w.players[1].farm.corpse_stacks())
}

fn plague_notices(ev: &[Event], to: PlayerId) -> Vec<PlagueNotice> {
    ev.iter()
        .filter_map(|e| match e {
            Event::PlagueNotice { recipient, notice } if *recipient == to => Some(*notice),
            _ => None,
        })
        .collect()
}

/// Seat 1 presses F on `corpse` (submitted before any step, so the auto-harvest has had no tick first).
fn consume_by_f(s: &mut Sim, corpse: PlayerId) -> Vec<Event> {
    submit(s, 1, RawCommand::ConsumeCorpse { corpse });
    let mut ev = Vec::new();
    s.step_into(&mut ev);
    ev
}

#[test]
fn a_corpse_in_the_ice_is_not_consumed_by_f_from_beside_it() {
    let mut s = rig(FrostWish::Wall, FactionId::Plague, eater());
    assert!(
        on_a_wall_tile(&s, corpse_in_the_ice()),
        "premise: in the ice"
    );
    assert!(
        only_the_ice_between(&s, eater(), corpse_in_the_ice()),
        "premise: only the wall's tiles cross the line"
    );
    let corpse = lay_corpse(&mut s, corpse_in_the_ice());
    let ev = consume_by_f(&mut s, corpse);
    assert_eq!(walls(&s), 1, "premise: the wall still stands");
    assert_eq!(
        s.w.plague_corpses.len(),
        1,
        "legacy's line (MASK_MOVE) is stopped by the ice: the corpse stays"
    );
    assert_eq!(corpse_stacks(&s), 0, "no stack");
    assert_eq!(
        plague_notices(&ev, id(&s, 1)),
        vec![PlagueNotice::Unreachable],
        "\"Can't reach that\" (the auto-harvest refuses silently)"
    );
}

#[test]
fn a_corpse_in_the_ice_is_not_auto_consumed() {
    let mut s = rig(FrostWish::Wall, FactionId::Plague, eater());
    lay_corpse(&mut s, corpse_in_the_ice());
    let mut ev = Vec::new();
    for _ in 0..3 {
        s.step_into(&mut ev);
    }
    assert_eq!(walls(&s), 1, "premise: the wall still stands");
    assert_eq!(
        s.w.plague_corpses.len(),
        1,
        "the auto-harvest's line (plagueCorpses.ts:86) is stopped by the ice"
    );
    assert_eq!(corpse_stacks(&s), 0, "no stack");
    assert!(plague_notices(&ev, id(&s, 1)).is_empty(), "silent");
}

#[test]
fn guard_switch_off_a_corpse_in_reach_is_consumed_by_f() {
    let mut s = rig(FrostWish::Freeze, FactionId::Plague, eater());
    let corpse = lay_corpse(&mut s, corpse_in_the_ice());
    let ev = consume_by_f(&mut s, corpse);
    assert!(s.w.plague_corpses.is_empty(), "today: eaten");
    assert_eq!(corpse_stacks(&s), 1, "one stack");
    assert_eq!(
        plague_notices(&ev, id(&s, 1)),
        vec![PlagueNotice::Consumed { player: corpse }],
        "today: one Consumed notice"
    );
}

#[test]
fn guard_switch_off_a_corpse_in_reach_is_auto_consumed() {
    let mut s = rig(FrostWish::Freeze, FactionId::Plague, eater());
    lay_corpse(&mut s, corpse_in_the_ice());
    s.step();
    assert!(
        s.w.plague_corpses.is_empty(),
        "today: auto-eaten in one step"
    );
    assert_eq!(corpse_stacks(&s), 1, "one stack");
}

#[test]
fn guard_a_corpse_on_the_eaters_side_of_a_standing_wall_is_consumed() {
    let mut s = rig(FrostWish::Wall, FactionId::Plague, eater());
    let corpse = lay_corpse(&mut s, corpse_own_side());
    let ev = consume_by_f(&mut s, corpse);
    assert_eq!(walls(&s), 1, "premise: the wall still stands");
    assert!(s.w.plague_corpses.is_empty(), "eaten");
    assert_eq!(corpse_stacks(&s), 1, "one stack");
    assert_eq!(
        plague_notices(&ev, id(&s, 1)),
        vec![PlagueNotice::Consumed { player: corpse }],
        "one Consumed notice"
    );
}

#[test]
fn guard_a_corpse_on_the_eaters_side_of_a_standing_wall_is_auto_consumed() {
    let mut s = rig(FrostWish::Wall, FactionId::Plague, eater());
    lay_corpse(&mut s, corpse_own_side());
    s.step();
    assert_eq!(walls(&s), 1, "premise: the wall still stands");
    assert!(s.w.plague_corpses.is_empty(), "auto-eaten in one step");
    assert_eq!(corpse_stacks(&s), 1, "one stack");
}

// ---- 3. trader reach (legacy traders.ts:65 handleTrade; :103 `map` read by the visitor line :109, `findPath` :120 and
// `segmentClear` :129; all MASK_MOVE on collisionMap). TRADER_RANGE is 112 u. ----

/// The visitor east of the wall.
fn visitor() -> Vec2 {
    Vec2::new(440., tc(10))
}

/// West of the wall (column 10), 100 u from the visitor and 164 u from the Frost caster (no visitor).
fn trader_across() -> Vec2 {
    Vec2::new(340., tc(10))
}

/// East of the wall, 60 u from the visitor.
fn trader_own_side() -> Vec2 {
    Vec2::new(500., tc(10))
}

/// Installs the Soul Broker (stat trader) at `at` with `path`, not due to walk for a long while.
fn place_broker(s: &mut Sim, at: Vec2, path: Vec<Vec2>) {
    let next_walk_at = s.server_time() + 1e6;
    s.w.traders = Some(Traders {
        traders: vec![Trader {
            kind: Kind::Stats,
            at,
            path,
            next_walk_at,
        }],
        destinations: Vec::new(),
        barter_at: Vec::new(),
    });
}

fn broker(s: &Sim) -> &Trader {
    &s.w.traders.as_ref().expect("the broker").traders[0]
}

fn an_offer() -> StatTrade {
    StatTrade {
        cost: Stat::Armor,
        cost_value: 1.,
        gain: Stat::Ad,
        gain_value: 2.,
        label: "test offer".into(),
    }
}

/// Seat 1, already holding an offer (so the broker's roll does not run), takes it.
fn trade_with_the_broker(s: &mut Sim) -> Vec<Event> {
    s.w.players[1].trade_offers = vec![an_offer()];
    submit(
        s,
        1,
        RawCommand::Trade {
            trader: Some(Kind::Stats.index() as u8),
            pick: 0,
        },
    );
    let mut ev = Vec::new();
    s.step_into(&mut ev);
    ev
}

fn toasts(ev: &[Event], who: PlayerId) -> Vec<String> {
    ev.iter()
        .filter_map(|e| match e {
            Event::Toast { to, text } if *to == Some(who) => Some(text.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn a_player_cannot_trade_across_the_ice() {
    let mut s = rig(FrostWish::Wall, FactionId::Fire, visitor());
    place_broker(&mut s, trader_across(), Vec::new());
    assert!(
        only_the_ice_between(&s, visitor(), trader_across()),
        "premise: only the wall's tiles cross the line"
    );
    let ev = trade_with_the_broker(&mut s);
    assert_eq!(walls(&s), 1, "premise: the wall still stands");
    assert!(
        !s.players()[1].trade_used,
        "legacy's trade line (MASK_MOVE) is stopped by the ice"
    );
    assert_eq!(
        toasts(&ev, id(&s, 1)),
        vec!["Move closer to the trader".to_string()],
        "the reach notice"
    );
}

#[test]
fn a_player_across_the_ice_is_not_a_visitor() {
    let mut s = rig(FrostWish::Wall, FactionId::Fire, visitor());
    place_broker(&mut s, trader_across(), Vec::new());
    let due = broker(&s).next_walk_at;
    s.step();
    assert_eq!(walls(&s), 1, "premise: the wall still stands");
    assert!(
        s.players()[1].trade_offers.is_empty(),
        "legacy's visitor line (traders.ts:109) is stopped by the ice: no offers rolled"
    );
    assert_eq!(
        broker(&s).next_walk_at,
        due,
        "the broker does not stop for them"
    );
}

#[test]
fn a_walking_trader_never_steps_into_the_ice() {
    // The seat-1 player stands far from the broker (no visitor), whose path runs east straight through column 12.
    let mut s = rig(FrostWish::Wall, FactionId::Fire, Vec2::new(tc(30), tc(4)));
    place_broker(&mut s, trader_across(), vec![Vec2::new(480., tc(10))]);
    for _ in 0..40 {
        s.step();
        assert_eq!(walls(&s), 1, "premise: the wall stands");
        let at = broker(&s).at;
        assert!(
            clear_of_the_ice(&s, at),
            "legacy's walker steps with segmentClear(collisionMap, .., 12) (traders.ts:129): broker at {at:?}, tick {}",
            s.tick()
        );
    }
    assert!(broker(&s).path.is_empty(), "its path was cut at the ice");
}

#[test]
fn guard_switch_off_a_player_in_reach_trades() {
    let mut s = rig(FrostWish::Freeze, FactionId::Fire, visitor());
    place_broker(&mut s, trader_across(), Vec::new());
    let ev = trade_with_the_broker(&mut s);
    assert!(s.players()[1].trade_used, "today: traded");
    assert_eq!(
        toasts(&ev, id(&s, 1)),
        vec!["Stat trade: test offer".to_string()],
        "today's notice"
    );
}

#[test]
fn guard_switch_off_a_player_in_reach_is_a_visitor() {
    let mut s = rig(FrostWish::Freeze, FactionId::Fire, visitor());
    place_broker(&mut s, trader_across(), Vec::new());
    s.step();
    assert_eq!(
        s.players()[1].trade_offers.len(),
        3,
        "today: three offers rolled"
    );
    assert_eq!(
        broker(&s).next_walk_at,
        s.server_time() + TRADER_STOP_MS,
        "today: the broker stops for them"
    );
}

#[test]
fn guard_switch_off_a_walking_trader_walks_its_path() {
    let mut s = rig(FrostWish::Freeze, FactionId::Fire, Vec2::new(tc(30), tc(4)));
    place_broker(&mut s, trader_across(), vec![Vec2::new(480., tc(10))]);
    for _ in 0..40 {
        s.step();
    }
    let at = broker(&s).at;
    assert!(
        (at.x - 424.).abs() < 0.01 && at.y == tc(10),
        "today: 40 steps of 2.1 u east from x 340: {at:?}"
    );
    assert_eq!(broker(&s).path.len(), 1, "still walking");
}

#[test]
fn guard_a_trader_on_the_players_side_of_a_standing_wall_trades_and_stops() {
    let mut s = rig(FrostWish::Wall, FactionId::Fire, visitor());
    place_broker(&mut s, trader_own_side(), Vec::new());
    s.step();
    assert_eq!(
        s.players()[1].trade_offers.len(),
        3,
        "a visitor: three offers rolled"
    );
    assert_eq!(
        broker(&s).next_walk_at,
        s.server_time() + TRADER_STOP_MS,
        "the broker stops for them"
    );
    let ev = trade_with_the_broker(&mut s);
    assert_eq!(walls(&s), 1, "premise: the wall still stands");
    assert!(s.players()[1].trade_used, "traded");
    assert_eq!(
        toasts(&ev, id(&s, 1)),
        vec!["Stat trade: test offer".to_string()],
        "the trade's notice"
    );
}

#[test]
fn guard_the_trade_view_still_lists_a_merchant_across_the_ice() {
    // The trade view lists merchants by sight (trade_view.rs:69), which the wall does not stop. It is published only in a
    // world with the quest module (`traders::runtime::enabled`).
    let cfg = SimConfig {
        quests: true,
        ..config(FrostWish::Wall)
    };
    let mut s = rig_with(cfg, FactionId::Fire, visitor());
    place_broker(&mut s, trader_across(), Vec::new());
    s.step();
    let obs = crate::observe(&s, id(&s, 1), &[]);
    let merchants = obs.trade.expect("a trade view").merchants;
    assert!(
        merchants
            .iter()
            .any(|m| m.kind == Kind::Stats && m.at == trader_across()),
        "the broker is seen over the ice: {merchants:?}"
    );
}

// ---- identities: this packet moves none. The guard follows `GOLDEN_CONTENT_HASH` in `tests/content.rs`. ----

#[test]
fn guard_the_content_hash_is_the_golden_value() {
    // The needle is split so the const scan of `tests/content.rs` does not read this line as a declaration.
    let needle = ["const", "GOLDEN_CONTENT_HASH"].join(" ");
    let src = include_str!("../tests/content.rs");
    let line = src
        .lines()
        .find(|l| l.trim_start().starts_with(&needle))
        .expect("tests/content.rs declares GOLDEN_CONTENT_HASH");
    let hex = line
        .split('=')
        .nth(1)
        .expect("a value")
        .trim()
        .trim_end_matches(';')
        .trim()
        .trim_start_matches("0x")
        .replace('_', "");
    let golden = u64::from_str_radix(&hex, 16).expect("GOLDEN_CONTENT_HASH is a hex literal");
    assert_eq!(
        crate::content::content_hash(),
        golden,
        "the content hash moves only together with GOLDEN_CONTENT_HASH (tests/content.rs)"
    );
}
