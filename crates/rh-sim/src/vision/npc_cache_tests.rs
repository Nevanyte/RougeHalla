//! Native differential projection controls, not additional produced-source parity.
use super::*;
use crate::{
    ContainerKind, FactionId, ItemObserver, Observation, Placement, Secrets, SimConfig, WeaponId,
};

fn scene() -> Sim {
    let map = serde_json::from_str(include_str!("../../tests/fixtures/mob-pve-map.json")).unwrap();
    let arena = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap();
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = 12;
    secrets.reward_salt = [1, 2, 3, 4];
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: true,
            mob_mode: crate::mob_runtime::MobMode::Pve,
            ..Default::default()
        },
        arena,
        secrets,
        &[
            Placement {
                profile: "viewer".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(80., 112.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "distant".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(624., 624.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    );
    for x in [80., 112.] {
        sim.seed_weapon_container(
            ContainerKind::Ground,
            Vec2::new(x, 112.),
            &[WeaponId::Sword],
        )
        .unwrap();
    }
    assert!(
        !sim.mobs().is_empty(),
        "actual PvE constructor must birth NPCs"
    );
    sim
}

// Declared native arrangement: retain first-room discoveries, then view from an isolated floor.
fn remembered_scene() -> Sim {
    let mut sim = scene();
    sim.w.tick = 5;
    sim.w.server_time = 5. * TICK_MS;
    let p = &mut sim.w.players[0];
    p.vision = VisionTrail::default();
    p.vision.refresh_on(Vec2::new(80., 112.), 1, Variant::Open);
    p.vision.refresh_on(Vec2::new(112., 112.), 3, Variant::Open);
    p.body.x = 624.;
    p.body.y = 624.;
    assert_eq!(p.vision.reveals.len(), 2);
    sim
}

fn raw(sim: &Sim) -> Observation {
    let mut out = Observation::default();
    crate::observe::observe_with(sim, PlayerId(1), &[], &mut out, None).unwrap();
    out
}

fn compare(sim: &Sim, memo: &mut TileVisionCache) -> Observation {
    memo.begin(sim, sim.player(PlayerId(1)).unwrap(), true);
    let before = sim.state_hash();
    let mut out = Observation::default();
    crate::observe::observe_with_tiles(sim, PlayerId(1), &[], &mut out, None, Some(memo)).unwrap();
    assert_eq!(
        out,
        raw(sim),
        "complete raw observation differs at tick {}",
        sim.tick()
    );
    assert_eq!(
        before,
        sim.state_hash(),
        "projection changed canonical state"
    );
    out
}

#[test]
fn npc_tile_memo_matches_raw_through_stationary_tail_and_exclusive_expiry() {
    let mut sim = remembered_scene();
    let npc = sim.mobs()[0].core.id;
    let mut memo = TileVisionCache::default();
    assert!(compare(&sim, &mut memo).visible.iter().any(|a| a.id == npc));
    assert_eq!(
        memo.tick,
        Some(5),
        "must exercise active memo, not fallback"
    );
    sim.w.players[0]
        .vision
        .refresh_on(Vec2::new(112., 112.), 5, Variant::Open);
    assert_eq!(
        sim.w.players[0].vision.reveals.len(),
        2,
        "stationary tail coalesces"
    );
    for tick in [5, 6, 9, 600, 601, 604, 605] {
        sim.w.tick = tick;
        sim.w.server_time = f64::from(tick) * TICK_MS;
        compare(&sim, &mut memo);
    }
    assert!(
        !raw(&sim).visible.iter().any(|a| a.id == npc),
        "remembered NPC must expire"
    );
}

#[test]
fn npc_tile_memo_keeps_same_tick_movement_hidden_and_death_checks_fresh() {
    let mut sim = remembered_scene();
    let id = sim.mobs()[0].core.id;
    let mut memo = TileVisionCache::default();
    compare(&sim, &mut memo);
    let now = sim.server_time();
    let mob = sim.w.mobs.get_mut(id).unwrap();
    crate::status_runtime::apply(
        &mut mob.core.statuses,
        now,
        crate::status_runtime::StatusApply {
            kind: crate::status_runtime::StatusKind::Hidden,
            source: crate::status_runtime::StatusSource {
                id: None,
                name: "control".into(),
                owner_id: None,
            },
            ms: 1000.,
            ability: None,
            tag: None,
            value: None,
            add: None,
            data: None,
        },
    );
    assert!(!compare(&sim, &mut memo).visible.iter().any(|a| a.id == id));
    let mob = sim.w.mobs.get_mut(id).unwrap();
    mob.core.statuses.instances.clear();
    mob.core.body.x = 624.;
    mob.core.body.y = 624.;
    assert!(compare(&sim, &mut memo).visible.iter().any(|a| a.id == id));
    let mob = sim.w.mobs.get_mut(id).unwrap();
    mob.status = Status::Dead;
    mob.core.vitals.hp = 0.;
    compare(&sim, &mut memo);
}

#[test]
fn npc_prepare_revalidates_same_tick_discarded_history_and_cold_lifecycle() {
    let mut sim = remembered_scene();
    let npc = sim.mobs()[0].core.id;
    let mut seat = ItemObserver::new(PlayerId(1));
    let mut shown = Observation::default();
    seat.observe_into(&sim, &[], &mut shown, None).unwrap();
    // The first committed sample is deliberately cold. A second tick must populate the
    // persistent NPC memo before the same-tick discarded clone can test stale-cell reuse.
    sim.w.tick = 6;
    sim.w.server_time = 6. * TICK_MS;
    seat.observe_into(&sim, &[], &mut shown, None).unwrap();
    assert!(raw(&sim).visible.iter().any(|a| a.id == npc));
    let original = shown.clone();
    let mut unseen = sim.clone();
    unseen.w.players[0].vision = VisionTrail::default();
    let offer = seat.prepare_into(&unseen, &[], &mut shown, None).unwrap();
    assert!(!shown
        .visible
        .iter()
        .any(|a| a.kind != crate::observe::ActorKind::Player));
    drop(offer);
    seat.observe_into(&sim, &[], &mut shown, None).unwrap();
    assert_eq!(
        shown, original,
        "discarded same-tick clone must not poison the live memo or handles"
    );
    let mut memo = TileVisionCache::default();
    compare(&sim, &mut memo);
    assert!(raw(&sim).visible.iter().any(|a| a.id == npc));
    compare(&unseen, &mut memo);
    compare(&sim, &mut memo);
    // Restore an untouched admitted constructor, not the synthetic visibility arrangement above.
    let admitted = scene();
    let restored = Sim::restore(serde_json::to_value(&admitted).unwrap()).unwrap();
    compare(&restored, &mut memo);
    compare(&admitted.clone(), &mut memo);
    let renewed = seat.renewed();
    assert_eq!(renewed.viewer(), PlayerId(1));
    seat.reconnect();
    seat.observe_into(&sim, &[], &mut shown, None).unwrap();
    assert_eq!(shown.visible.len(), original.visible.len());
}

#[test]
fn tile_memo_keeps_precise_same_tile_los_and_invalid_point_fallback() {
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        crate::arenas::practice_arena(),
        Secrets::from_seed(3),
        &[Placement {
            profile: "viewer".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(181., 220.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    for x in [80., 112.] {
        sim.seed_weapon_container(
            ContainerKind::Ground,
            Vec2::new(x, 112.),
            &[WeaponId::Sword],
        )
        .unwrap();
    }
    sim.w.tick = 5;
    sim.w.server_time = 5. * TICK_MS;
    let p = &mut sim.w.players[0];
    p.vision = VisionTrail::default();
    p.vision
        .refresh_on(Vec2::new(1200., 800.), 1, Variant::Open);
    p.vision
        .refresh_on(Vec2::new(1240., 800.), 3, Variant::Open);
    let viewer = sim.player(PlayerId(1)).unwrap();
    let map = sim.collision_view();
    let wards = WardSight::of_sim(&sim);
    let mut memo = TileVisionCache::default();
    memo.begin(&sim, viewer, true);
    assert_eq!(memo.tick, Some(5));
    let blocked = Vec2::new(225., 225.);
    let clear = Vec2::new(225., 255.);
    assert_eq!(tile(blocked), tile(clear));
    assert!(!point_visible(map, viewer, blocked, 5, wards));
    assert!(point_visible(map, viewer, clear, 5, wards));
    for point in [
        clear,
        blocked,
        clear,
        Vec2::new(f64::NAN, 0.),
        Vec2::new(f64::INFINITY, 0.),
        Vec2::new(-1., -1.),
    ] {
        assert_eq!(
            memo.sees(map, viewer, point, 5, wards),
            point_visible(map, viewer, point, 5, wards)
        );
    }
    // Deliberately noncanonical numeric-domain control: a positive tile-0 history entry must
    // not make NaN (whose numeric tile cast is zero) visible. No such point is installed on an actor.
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        crate::Arena {
            map: TileMap::from_rows(&vec![".".repeat(48); 32]).unwrap(),
            spawns: vec![Vec2::new(1200., 800.)],
        },
        Secrets::from_seed(3),
        &[Placement {
            profile: "numeric-control".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(1200., 800.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    for x in [80., 112.] {
        sim.seed_weapon_container(
            ContainerKind::Ground,
            Vec2::new(x, 112.),
            &[WeaponId::Sword],
        )
        .unwrap();
    }
    sim.w.tick = 5;
    sim.w.server_time = 5. * TICK_MS;
    let p = &mut sim.w.players[0];
    p.vision = VisionTrail::default();
    p.vision.refresh_on(Vec2::new(16., 16.), 1, Variant::Open);
    p.vision.refresh_on(Vec2::new(48., 16.), 3, Variant::Open);
    p.body.x = 1200.;
    p.body.y = 800.;
    let viewer = sim.player(PlayerId(1)).unwrap();
    let map = sim.collision_view();
    let wards = WardSight::of_sim(&sim);
    memo.begin(&sim, viewer, true);
    assert!(memo.sees(map, viewer, Vec2::new(16., 16.), 5, wards));
    let invalid = Vec2::new(f64::NAN, 0.);
    assert!(!point_visible(map, viewer, invalid, 5, wards));
    assert!(!memo.sees(map, viewer, invalid, 5, wards));
}
