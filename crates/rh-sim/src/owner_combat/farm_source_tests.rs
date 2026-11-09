//! Actual native consumer for the sealed owner-combat farm source corpus.
//! One real generated-map, nontraining PvE kill of a plagueRat earns the real +3 attackSpeed
//! (mobStats) through native grantMobStat/recompute/recomputeMirrors, then the owner public
//! clocks/lock/mirror rows are compared frame by frame to the sealed source capture.
//! Declared setup only: seed/map/config/seats/positions/loadout. NPC stats, death, farm gain,
//! build, mirrors and RNG outcomes are never installed here.
use super::*;
use crate::{
    mob_runtime::ActorOrigin, validate, Arena, ContainerKind, Event, FactionId, Observation,
    Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Status, Vec2, WeaponId,
};
use serde_json::Value;
use std::collections::BTreeMap;

fn corpus() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/policy/owner-combat-farm/source.json"
    )))
    .unwrap()
}
fn number(v: &Value) -> f64 {
    v.as_f64().expect("finite source number")
}
fn exact(actual: f64, expected: &Value, at: &str) {
    let expected = number(expected);
    assert_eq!(
        actual.to_bits(),
        expected.to_bits(),
        "{at}: native {actual:?} ({:016x}) source {expected:?} ({:016x})",
        actual.to_bits(),
        expected.to_bits()
    );
}
/// Bind the sealed source target (campRef 21, slot 0) to the native camp roster's real actor.
/// The source alias "mob36" is a source serial; native actor serials are not assumed equal.
fn target_actor(s: &Sim) -> PlayerId {
    s.w.actor_history
        .iter()
        .find(|a| {
            matches!(
                a.origin,
                ActorOrigin::Mob {
                    camp: 20,
                    spot: 0,
                    ..
                }
            )
        })
        .map(|a| a.id)
        .unwrap_or_else(|| panic!("native camp 20 slot 0 actor is missing"))
}
fn secrets(setup: &Value) -> Secrets {
    // The source capture is createGameWorld({random: mulberry32(8), rewardSalt:[1,2,3,4]}).
    // orderSalt is the first draw; the native spawn seed is the mulberry state after it.
    let mut random = crate::rng::Mulberry32::new(8);
    let order_salt = random.next_u32();
    assert_eq!(
        u64::from(order_salt),
        setup["rng"]["orderSalt"].as_u64().unwrap(),
        "orderSalt mirrors the sealed source RNG input"
    );
    Secrets {
        order_salt,
        spawn_seed: random.state(),
        reward_salt: [1, 2, 3, 4],
    }
}
fn arena(setup: &Value) -> Arena {
    use crate::mapgen::{coliseum, map_hash, pipeline};
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    // Source generateMap(seed) with no explicit options; native default options mirror the admitted source map.
    let map = generator
        .generate_styled(
            setup["map"]["seed"].as_i64().unwrap(),
            Some(setup["map"]["attempt"].as_u64().unwrap()),
            pipeline::Options::default(),
        )
        .expect("declared source seed/attempt generates the map");
    let hash = u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap();
    assert_eq!(
        u64::from(hash),
        setup["map"]["hashU32"].as_u64().unwrap(),
        "native generated map hash mirrors the sealed source map"
    );
    assert_eq!(
        map.w as u64,
        setup["map"]["width"].as_u64().unwrap(),
        "map width"
    );
    assert_eq!(
        map.h as u64,
        setup["map"]["height"].as_u64().unwrap(),
        "map height"
    );
    assert_eq!(
        map.camps.len() as u64,
        setup["map"]["camps"].as_u64().unwrap(),
        "camp count"
    );
    crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map,
    }
    .validate()
    .expect("sealed generated map is admitted")
    .into_arena()
    .expect("validated map builds the arena")
}
fn placements(setup: &Value) -> Vec<Placement> {
    setup["seats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|seat| Placement {
            profile: seat["profile"].as_str().unwrap().into(),
            faction: FactionId::parse(seat["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(
                number(&seat["declaredPlacement"]["x"]),
                number(&seat["declaredPlacement"]["y"]),
            ),
            // Declared initial HP from the sealed setup (the allies are kept alive as setup).
            hp: Some(number(&seat["afterRaid"]["hp"])),
            weapon0: None,
            weapon1: None,
        })
        .collect()
}
fn construct(setup: &Value) -> (Sim, u32) {
    let config = SimConfig {
        min_players: 3,
        lobby_seconds: 0.,
        fill_seconds: 0.,
        pvp_rules: true,
        weapon_specials: true,
        initial_loot: true,
        consumables: true,
        regen: true,
        hazards: crate::terrain::Mode::Map,
        mob_mode: crate::mob_runtime::MobMode::Pve,
        faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        abilities: crate::abilities::Mode::Full,
        lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
            plan_seconds: 0.,
            first_patience_seconds: Some(3600.),
            coliseum_schedule: None,
            patience_seconds: 3600.,
            patience_min_seconds: 3600.,
            sudden_death_seconds: 3600.,
        }),
        ..Default::default()
    };
    let mut sim = Sim::reset_active(config, arena(setup), secrets(setup), &placements(setup));
    // Real ground rack (sim/loot.ts dropWeapon equivalent), created at tick 1 after the synthetic lobby step.
    let owner = setup["owner"]["declaredLoadout"]["rackAt"]["x"]
        .as_f64()
        .map(|x| {
            Vec2::new(
                x,
                setup["owner"]["declaredLoadout"]["rackAt"]["y"]
                    .as_f64()
                    .unwrap(),
            )
        })
        .unwrap();
    let rack = sim
        .seed_weapon_container(ContainerKind::Ground, owner, &[WeaponId::Wand])
        .expect("real ground rack");
    (sim, rack)
}
fn frame(s: &Sim, source: &Value, label: &str) -> PlayerId {
    let owner = s.player(PlayerId(1)).expect("owner");
    exact(
        s.server_time(),
        &source["serverTime"],
        &format!("{label}/clock"),
    );
    let canonical = &source["owner"];
    let decoded = &source["ownerDecoded"];
    exact(
        owner.weapon.draw_started_at,
        &canonical["drawStartedAt"],
        &format!("{label}/canonical draw"),
    );
    exact(
        owner.weapon.ready_at,
        &canonical["readyAt"],
        &format!("{label}/canonical ready"),
    );
    let named = canonical["attackTarget"].as_str().unwrap();
    let target = (!named.is_empty()).then(|| {
        assert_eq!(named, "mob36", "{label}/sealed target alias");
        target_actor(s)
    });
    assert_eq!(
        owner.weapon.targeting.target, target,
        "{label}/canonical held"
    );
    let mut observation = Observation::default();
    crate::observe::observe_with(s, PlayerId(1), &[], &mut observation, None).unwrap();
    let entitled: Vec<_> = observation.visible.iter().map(|a| a.id).collect();
    let group = project(owner, &entitled).unwrap();
    assert_eq!(
        u64::from(group.draw_started_at),
        decoded["drawStartedAt"].as_u64().unwrap(),
        "{label}/decoded draw"
    );
    assert_eq!(
        u64::from(group.ready_at),
        decoded["readyAt"].as_u64().unwrap(),
        "{label}/decoded ready"
    );
    assert_eq!(
        [group.as_milli, group.windup_milli, group.speed_milli],
        [
            number(&decoded["asMult"]),
            number(&decoded["windupMult"]),
            number(&decoded["speedMult"])
        ],
        "{label}/decoded mirrors"
    );
    assert_eq!(
        [group.lock],
        [target.map_or(Lock::Clear, |id| Lock::Held {
            target: entitled.contains(&id).then_some(id)
        })],
        "{label}/current identity"
    );
    for (native, key) in [(owner.vitals.hp, "hp"), (owner.vitals.max_hp, "maxHp")] {
        exact(native, &canonical[key], &format!("{label}/{key}"));
    }
    assert_eq!(
        owner.status,
        match canonical["status"].as_str().unwrap() {
            "alive" => Status::Alive,
            "dead" => Status::Dead,
            "mia" => Status::Mia,
            other => panic!("unexpected status {other}"),
        },
        "{label}/status"
    );
    assert_eq!(
        owner.weapon.weapon0.map_or("", |w| w.as_str()),
        canonical["weapon0"].as_str().unwrap(),
        "{label}/weapon0"
    );
    assert_eq!(
        owner.weapon.weapon1.map_or("", |w| w.as_str()),
        canonical["weapon1"].as_str().unwrap(),
        "{label}/weapon1"
    );
    assert_eq!(
        u64::from(owner.weapon.slot),
        canonical["slot"].as_u64().unwrap(),
        "{label}/slot"
    );
    let mut expected_farm: BTreeMap<String, u64> = BTreeMap::new();
    for entry in source["ownerMobStats"]["entries"].as_array().unwrap() {
        expected_farm.insert(
            entry[0].as_str().unwrap().to_owned(),
            entry[1].as_u64().unwrap(),
        );
    }
    let mut actual_farm: BTreeMap<String, u64> = BTreeMap::new();
    for id in crate::mob_catalog::MobTypeId::ALL {
        let count = owner.farm.count(id);
        if count > 0 {
            actual_farm.insert(id.as_str().to_owned(), count);
        }
    }
    assert_eq!(
        actual_farm, expected_farm,
        "{label}/typed farm map (extra native types or wrong per-type counts are rejected)"
    );
    owner.id
}
fn run() {
    let p = corpus();
    let setup = &p["setup"];
    let (mut sim, rack) = construct(setup);
    // The sealed source rack alias is c12; the native engine assigns its own ground-container serial.
    // Bind the native actual rack id for the ordinary pickup input; the declared rack position/loadout
    // is the same setup, not a source outcome.
    assert_eq!(
        setup["owner"]["declaredLoadout"]["rackId"]
            .as_str()
            .unwrap(),
        "c12",
        "sealed source ground-rack alias"
    );
    // The source target alias "mob36" resolves through the real native camp roster by its
    // 0-based camp index/spot (camp 20 slot 0), not by assuming equal actor serials.
    let source_target_id = target_actor(&sim);
    assert_eq!(
        sim.w.mobs.get(source_target_id).unwrap().mob_type,
        Some(crate::mob_catalog::MobTypeId::PlagueRat),
        "native camp 20 slot 0 roster type"
    );
    assert!(
        !sim.w.mobs.get(source_target_id).unwrap().elite,
        "camp 20 is a nonelite roster"
    );
    let actions = p["actions"].as_array().unwrap();
    let frames = p["frames"].as_array().unwrap();
    let last = frames.last().unwrap()["step"].as_u64().unwrap();
    let mut compared = 0;
    for step in 1..=last {
        for action in actions.iter().filter(|a| a["step"].as_u64() == Some(step)) {
            assert_eq!(action["accepted"], true, "source action accepted");
            let raw = match action["message"].as_str().unwrap() {
                "pickup" => RawCommand::Pickup { container_id: rack },
                "target" => RawCommand::Target {
                    id: source_target_id,
                },
                other => panic!("unexpected farm action {other}"),
            };
            sim.submit(PlayerId(1), validate(raw).unwrap())
                .expect("ordinary native C-INPUT action");
        }
        let events = sim.step();
        if let Some(source) = frames.iter().find(|f| f["step"].as_u64() == Some(step)) {
            frame(&sim, source, &format!("farm/{step}"));
            compared += 1;
        }
        // The actual kill must be a real native ledger death and farm write, never an installed value.
        if step == p["kill"]["step"].as_u64().unwrap() {
            let native = target_actor(&sim);
            let mob = sim.w.mobs.get(native).expect("actual target mob retained");
            assert_eq!(mob.status, Status::Dead, "actual recorded target death");
            assert!(
                events
                    .iter()
                    .any(|e| matches!(e, Event::Death { id, .. } if *id == native)),
                "native death event for the target"
            );
            let owner = sim.player(PlayerId(1)).unwrap();
            assert_eq!(
                owner.farm.count(crate::mob_catalog::MobTypeId::PlagueRat),
                3,
                "actual +3 farm stacks after the real kill"
            );
            assert_eq!(
                project(owner, &[]).unwrap().as_milli,
                1030.,
                "actual asMult mirror 1030 after the real farm write"
            );
        }
    }
    assert_eq!(compared, frames.len(), "all sealed source frames compared");
    let owner = sim.player(PlayerId(1)).unwrap();
    let final_frame = frames.last().unwrap();
    frame(&sim, final_frame, "farm/final");
    assert_eq!(
        owner.farm.count(crate::mob_catalog::MobTypeId::PlagueRat),
        3,
        "final actual farm stacks"
    );
    assert!(sim.phase() == crate::Phase::Active, "run remains active");
    eprintln!(
        "owner-combat farm: {} sealed frames replayed, rack c12, target {} killed, farm 3, asMult 1030",
        compared,
        p["target"]["id"].as_str().unwrap()
    );
}
#[test]
fn actual_native_farm_kill_earns_attack_speed_mirror() {
    run();
}
