//! Raw source lifecycle frames, never the human optimistic display or the defective transition indexes.
use super::*;
use crate::{
    validate, Arena, ContainerKind, Event, FactionId, Observation, RawCommand, Secrets, Sim,
    SimConfig, Status, TileMap, Vec2, WeaponId,
};
use serde_json::Value;

fn corpus() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/policy/owner-combat-continuation/producer.json"
    )))
    .unwrap()
}
fn number(v: &Value) -> f64 {
    v.as_f64().expect("finite source number")
}
fn secrets() -> Secrets {
    // capture.mts makeWorld uses random:mulberry32(8), no explicit rewardSalt.
    // createWorld consumes the order word, derives rewardSaltFrom(orderSalt), then saltWords.
    let mut random = crate::rng::Mulberry32::new(8);
    let order_salt = random.next_u32();
    let mut reward = crate::private_rng::fmix(order_salt ^ 0x5245_5744);
    let reward_salt = std::array::from_fn(|_| {
        reward = reward.wrapping_add(0x9e37_79b9);
        crate::private_rng::fmix(reward)
    });
    Secrets {
        order_salt,
        spawn_seed: random.state(),
        reward_salt,
    }
}
fn near(actual: f64, expected: &Value, at: &str) {
    let expected = number(expected);
    assert!(
        (actual - expected).abs() <= 1e-8,
        "{at}: native {actual:?}, source {expected:?}"
    );
}

fn arena(profile: &Value) -> Arena {
    // Native MapExport refuses mapFromTiles' empty coliseum. Use the old owner's collision-only import.
    // The requested cases never put an actor in the declared bush; no concealment equivalence is claimed.
    let map = &profile["declared"]["map"];
    let w = map["widthTiles"].as_u64().unwrap() as usize;
    let h = map["heightTiles"].as_u64().unwrap() as usize;
    let mut tiles = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                tiles[y * w + x] = 1;
            }
        }
    }
    let wall_x = map["wallColumn"]["x"].as_u64().unwrap() as usize;
    for y in map["wallColumn"]["rows"].as_array().unwrap() {
        tiles[y.as_u64().unwrap() as usize * w + wall_x] = 1;
    }
    Arena {
        map: TileMap::new(w as u32, h as u32, tiles).unwrap(),
        spawns: vec![],
    }
}

fn construct(p: &Value, case: &Value) -> Sim {
    let training = case["profile"] == "training-console";
    assert!(training || case["profile"] == "arena-weapon-only");
    let mut s = Sim::try_new(
        SimConfig {
            min_players: case["seats"].as_array().unwrap().len(),
            lobby_seconds: 0.,
            fill_seconds: 0.,
            training,
            dummies: training,
            pvp_rules: false,
            // The source's empty-spawn hand map is deliberately not admitted by native Source lifecycle.
            // Source patience is 3600s; no lifecycle timer can fire in these <=50.25s raw frames.
            lifecycle: crate::ArenaMode::Off,
            ..Default::default()
        },
        arena(&p["profile"]),
        secrets(),
    )
    .unwrap();
    for rack in case["declaredSetup"]["racks"].as_array().unwrap() {
        let actual = s
            .seed_weapon_container(
                ContainerKind::Ground,
                Vec2::new(number(&rack["at"]["x"]), number(&rack["at"]["y"])),
                &[WeaponId::parse(rack["def"].as_str().unwrap()).unwrap()],
            )
            .unwrap();
        assert_eq!(actual, source_serial(rack["id"].as_str().unwrap(), "c"));
    }
    for name in case["seats"].as_array().unwrap() {
        let name = name.as_str().unwrap();
        let faction = if name == "tgt" {
            FactionId::Fire
        } else {
            FactionId::parse(p["profile"]["declared"]["seats"][name].as_str().unwrap()).unwrap()
        };
        s.add_player(&name.to_uppercase(), Some(faction), false)
            .unwrap();
    }
    s.step();
    assert_eq!(s.phase(), crate::Phase::Active);
    assert_eq!(s.server_time(), 50.);
    // Exactly the labelled source placeAll setup: pose/path/history, no gameplay outcomes.
    for (name, at) in case["declaredSetup"]["placement"].as_object().unwrap() {
        let player = s.w.players.get_mut(human_id(name)).unwrap();
        player.body.x = number(&at[0]);
        player.body.y = number(&at[1]);
        player.body.facing = number(&at[2]);
        player.motion.path.clear();
        let (x, y) = (player.body.x, player.body.y);
        player
            .body
            .history
            .reset(crate::state::Sample { t: 50., x, y });
    }
    s.take_events();
    s
}
fn human_id(name: &str) -> PlayerId {
    PlayerId(match name {
        "own" => 1,
        "tgt" => 2,
        "thr" => 3,
        "fou" => 4,
        _ => panic!("unexpected human {name}"),
    })
}
fn source_serial(name: &str, prefix: &str) -> u32 {
    u32::from_str_radix(name.strip_prefix(prefix).unwrap(), 36).unwrap()
}
fn actor(s: &Sim, name: &str) -> PlayerId {
    if name.starts_with("mob") {
        let serial = source_serial(name, "mob");
        s.w.actor_history
            .iter()
            .find(|a| a.origin.birth_serial() == Some(serial))
            .unwrap()
            .id
    } else {
        human_id(name)
    }
}
fn train(msg: &Value) -> crate::input::TrainRaw {
    let (command, id) = match msg["cmd"].as_str().unwrap() {
        "card" => (
            1,
            crate::cards::CardId::ALL
                .into_iter()
                .position(|id| id.as_str() == msg["id"].as_str().unwrap())
                .unwrap() as u32,
        ),
        "camp" => (
            3,
            crate::mob_catalog::MobTypeId::ALL
                .into_iter()
                .position(|id| id.as_str() == msg["id"].as_str().unwrap())
                .unwrap() as u32,
        ),
        "clear" => (5, 0),
        _ => panic!("undeclared training command"),
    };
    crate::input::TrainRaw {
        command,
        id,
        count: msg["count"].as_u64().unwrap_or(1),
        options: [0; 3],
        option_count: 0,
    }
}
fn submit(s: &mut Sim, action: &Value) {
    assert_eq!(action["accepted"], true);
    let m = &action["msg"];
    let raw = match action["message"].as_str().unwrap() {
        "pickup" => RawCommand::Pickup {
            container_id: source_serial(m["containerId"].as_str().unwrap(), "c"),
        },
        "target" => RawCommand::Target {
            id: actor(s, m["id"].as_str().unwrap()),
        },
        "attack" => RawCommand::Attack {
            a: number(&m["a"]),
            t: None,
        },
        "release" => RawCommand::Release {
            a: number(&m["a"]),
            t: None,
        },
        "swap" => RawCommand::Swap {
            slot: Some(m["slot"].as_u64().unwrap() as u8),
        },
        "train" => RawCommand::Train(train(m)),
        other => panic!("unconsumed ordinary action {other}"),
    };
    s.submit(
        human_id(action["actor"].as_str().unwrap()),
        validate(raw).unwrap(),
    )
    .unwrap();
}

fn frame(s: &Sim, source: &Value, label: &str) {
    let owner = s.player(PlayerId(1)).unwrap();
    near(
        s.server_time(),
        &source["serverTime"],
        &format!("{label}/clock"),
    );
    let canonical = &source["owner"];
    let decoded = &source["ownerDecoded"];
    near(
        owner.weapon.draw_started_at,
        &canonical["drawStartedAt"],
        &format!("{label}/canonical draw"),
    );
    near(
        owner.weapon.ready_at,
        &canonical["readyAt"],
        &format!("{label}/canonical ready"),
    );
    let named = canonical["attackTarget"].as_str().unwrap();
    let target = (!named.is_empty()).then(|| actor(s, named));
    assert_eq!(
        owner.weapon.targeting.target, target,
        "{label}/canonical held"
    );
    let action = &source["probes"]["source"]["action"];
    match (owner.weapon.action, action.is_null()) {
        (None, true) => {}
        (Some(actual), false) => {
            assert_eq!(
                actual.kind,
                match action["kind"].as_str().unwrap() {
                    "draw" => crate::state::ActionKind::Draw,
                    "cast" => crate::state::ActionKind::Cast,
                    other => panic!("unexpected source action {other}"),
                },
                "{label}/actual pending action"
            );
            assert_eq!(actual.weapon.as_str(), action["weapon"].as_str().unwrap());
            near(
                actual.started_at,
                &action["startedAt"],
                &format!("{label}/action start"),
            );
            near(
                actual.lands_at,
                &action["landsAt"],
                &format!("{label}/action land"),
            );
            assert_eq!(
                actual.target,
                action["target"].as_str().map(|name| actor(s, name)),
                "{label}/action target"
            );
        }
        _ => panic!("{label}/native and source pending-action presence differ"),
    }
    let mut observation = Observation::default();
    // This private projector accepts canonical IDs BEFORE the public ActorRefs mapping.
    // ItemObserver's already-mapped NPC references belong to another namespace.
    crate::observe::observe_with(s, PlayerId(1), &[], &mut observation, None).unwrap();
    let entitled: Vec<_> = observation.visible.iter().map(|a| a.id).collect();
    if let Some(id) = target {
        assert_eq!(
            entitled.contains(&id),
            source["probes"]["target"]["entitled"]
                .as_bool()
                .unwrap_or(false),
            "{label}/CURRENT entitled membership"
        );
    }
    let before = s.state_hash();
    let group = project(owner, &entitled).unwrap();
    assert_eq!(s.state_hash(), before, "{label}/projection mutated state");
    assert_eq!(
        group.lock,
        target.map_or(Lock::Clear, |id| Lock::Held {
            target: entitled.contains(&id).then_some(id)
        }),
        "{label}/current identity"
    );
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
        "{label}/mirrors"
    );
    near(owner.vitals.hp, &canonical["hp"], &format!("{label}/hp"));
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
        u64::from(owner.weapon.slot),
        canonical["slot"].as_u64().unwrap(),
        "{label}/slot"
    );
    for (actual, key) in [
        (owner.weapon.weapon0, "weapon0"),
        (owner.weapon.weapon1, "weapon1"),
    ] {
        assert_eq!(
            actual.map_or("", |w| w.as_str()),
            canonical[key].as_str().unwrap(),
            "{label}/{key}"
        );
    }
    let expected_build = source["ownerBuild"]["entries"].as_array().unwrap();
    assert_eq!(
        owner.build.cards().count(),
        expected_build.len(),
        "{label}/build size"
    );
    for entry in expected_build {
        let card = crate::cards::CardId::ALL
            .into_iter()
            .find(|c| c.as_str() == entry[0].as_str().unwrap())
            .unwrap();
        assert_eq!(
            u64::from(owner.build.count(card)),
            entry[1].as_u64().unwrap(),
            "{label}/actual build"
        );
    }
    assert!(source["ownerMobStats"]["entries"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(
        crate::mob_catalog::MobTypeId::ALL
            .into_iter()
            .all(|id| owner.farm.count(id) == 0),
        "{label}/no fabricated farm grant"
    );
    // The omitted source bush is never occupied by any actor in these bounded cases.
    for pose in source["actors"].as_object().unwrap().values() {
        assert!(
            !(320. ..384.).contains(&number(&pose["x"]))
                || !(128. ..192.).contains(&number(&pose["y"]))
        );
    }
}

fn damage(s: &Sim, case: &Value, step: u64, label: &str) -> usize {
    let expected: Vec<_> = case["damageLog"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["step"].as_u64() == Some(step))
        .collect();
    // The source tap records only hits on/from own or tgt. These worlds have no other fighting humans.
    let actual: Vec<_> = s
        .landed_hits()
        .iter()
        .filter(|r| {
            r.victim == PlayerId(1)
                || r.victim == PlayerId(2)
                || matches!(r.by, Some(PlayerId(1) | PlayerId(2)))
        })
        .collect();
    assert_eq!(
        actual.len(),
        expected.len(),
        "{label}/real landed-hit count"
    );
    for row in expected {
        let victim = actor(s, row["victim"].as_str().unwrap());
        let by = Some(actor(s, row["by"]["id"].as_str().unwrap()));
        let weapon = WeaponId::parse(row["weapon"].as_str().unwrap());
        let hits: Vec<_> = actual
            .iter()
            .filter(|r| r.victim == victim && r.by == by && r.weapon == weapon)
            .collect();
        assert_eq!(
            hits.len(),
            1,
            "{label}/unique actual hit recipient/producer"
        );
        near(
            hits[0].amount,
            &row["applied"],
            &format!("{label}/applied hit"),
        );
        assert_eq!(hits[0].critical, row["crit"].as_bool().unwrap());
        let entries: Vec<_> = s
            .damage_entries()
            .iter()
            .filter(|r| r.victim == victim && r.by == by && r.weapon == weapon)
            .collect();
        assert_eq!(entries.len(), 1, "{label}/actual raw packet");
        near(entries[0].raw, &row["raw"], &format!("{label}/raw hit"));
    }
    actual.len()
}

fn run(id: &str) {
    let p = corpus();
    let case = p["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap();
    let mut s = construct(&p, case);
    let frames = case["frames"].as_array().unwrap();
    let last = frames.last().unwrap()["step"].as_u64().unwrap();
    let mut compared = 0;
    let mut hits = 0;
    let mut down_steps = Vec::new();
    for step in 0..=last {
        for action in case["actions"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|a| a["step"].as_u64() == Some(step))
        {
            submit(&mut s, action);
        }
        let events = s.step();
        if id == "D02" {
            assert!(
                s.w.projectiles.iter().all(|p| p.weapon() != WeaponId::Bow),
                "{id}/{step}/cancelled draw cannot launch"
            );
        }
        if id == "M05" && step == 6 {
            let mob = s.w.mobs.get(actor(&s, "moba")).unwrap();
            assert_eq!(mob.kind, crate::mob_runtime::MobKind::Practice);
            assert_eq!(
                mob.mob_type,
                Some(crate::mob_catalog::MobTypeId::Executioner)
            );
            assert!(mob.elite && mob.brain.is_some());
        }
        hits += damage(&s, case, step, &format!("{id}/{step}"));
        if events.iter().any(|e| {
            matches!(
                e,
                Event::Death {
                    id: PlayerId(1),
                    ..
                }
            )
        }) {
            down_steps.push(step);
        }
        if let Some(source) = frames.iter().find(|f| f["step"].as_u64() == Some(step)) {
            frame(&s, source, &format!("{id}/{step}"));
            compared += 1;
        }
        if id == "L08" && step == 7 {
            s.remove_player(PlayerId(2));
            assert!(s.player(PlayerId(2)).is_none());
            let direct = &case["directSnapshots"][0];
            frame(&s, direct, "L08/direct removal");
            assert_eq!(
                project(s.player(PlayerId(1)).unwrap(), &[]).unwrap().lock,
                Lock::Held { target: None }
            );
            assert!(s.w.pending_events.iter().any(|e| matches!(e,Event::Resolved{id:PlayerId(2),result,..} if result.outcome == crate::Outcome::Mia)));
        }
        if id == "L07" && step == 281 {
            assert!(events
                .iter()
                .any(|e| matches!(e,Event::Death{id,by:Some(PlayerId(1)),..} if *id==PlayerId(2))));
        }
    }
    assert_eq!(compared, frames.len());
    assert_eq!(hits, case["damageLog"].as_array().unwrap().len());
    if id == "M05" {
        assert_eq!(down_steps, vec![494, 994]);
    }
    if id == "D02" {
        assert!(s.w.projectiles.iter().all(|p| p.weapon() != WeaponId::Bow));
    }
    eprintln!(
        "owner continuation {id}: {compared} raw frames, {} actual native steps, {hits} actual matched raw/applied hits",
        last + 1,
    );
}

#[test]
fn source_l07_actual_target_death_retains_one_completed_held_frame() {
    run("L07");
}
#[test]
fn source_l08_direct_lifecycle_removal_redacts_identity_before_next_step_clear() {
    run("L08");
}
#[test]
fn source_d02_legal_swap_cancels_the_actual_bow_draw() {
    run("D02");
}
#[test]
fn source_m05_actual_practice_damage_downs_and_revives_twice() {
    run("M05");
}
#[test]
fn source_m04_refused_base_card_never_becomes_a_mirror_producer() {
    run("M04");
}
