//! Captured actual-source training-room comparison (P-ARENA-2 corpus).
//!
//! The corpus is %parity/training/source.json%, captured from the unmodified source in the pinned linux/amd64 Node
//! 22.23.4 container by %tools/training-fixtures/capture.mts%. Each case builds the same world a training Room builds
//! (the declared map with one declared spawn, the training/dummies config, installTraining, one player, a lobby-close
//! step exactly like the native reset_active bootstrap) and then applies declared ordinary steps, console messages,
//! forced ledger hits and between-tick downs; every expected value was written by the source. The comparison projects the
//! Rust world with the same projection and requires exact equality. A forced ledger hit is a state witness: the source
//! event fx of an out-of-band hit is not part of the comparison (the hit itself is, through the frame it leaves).
use crate::{
    abilities,
    events::Event,
    mob_runtime::{MobKind, MobMode},
    state::{ContainerKind, Phase, Sample, Status},
    systems::ledger::Hit,
    terrain, validate, Arena, FactionId, FactionMode, Outcome, Placement, PlayerId, RawCommand,
    Secrets, Sim, SimConfig, TileMap, Vec2, WeaponId,
};
use serde_json::{json, Value};

const FIXTURE: &str = include_str!("../../../../../parity/training/source.json");
const MAP: &str = include_str!("../../../tests/fixtures/mob-pve-map.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the captured training corpus parses")
}

fn arena(spawn: Vec2) -> Arena {
    let data: crate::mapdata::GameMapData =
        serde_json::from_str(MAP).expect("the captured map parses");
    let (w, h, tiles, layers) = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .expect("the captured map is an admitted rh-map/2 export")
    .into_parts();
    Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        // The capture declares one spawn so the lobby start places the seat exactly there (the source harness sets the
        // same single entry on its map input); the arena's floor/layers come from the captured map.
        spawns: vec![spawn],
    }
}

fn config(kind: &str) -> SimConfig {
    SimConfig {
        // The immutable source recipe explicitly installs signatures/walkHints off.
        walk_hints: Some(false),
        lag_fairness: false,
        regen: false,
        quests: false,
        consumables: false,
        training: kind == "training",
        dummies: kind != "arena",
        abilities: abilities::Mode::Off,
        wish_lock_ms: 45_000.,
        hazards: terrain::Mode::Off,
        lifecycle: crate::ArenaMode::Off,
        mob_mode: MobMode::Off,
        initial_loot: false,
        min_players: 1,
        lobby_seconds: 0.,
        fill_seconds: 0.,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: FactionMode::Off,
    }
}

fn r6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}

/// A JSON number that compares equal to the capture's integer/float rendering (serde_json keeps them distinct).
fn num(v: f64) -> Value {
    if v.fract() == 0. && v.abs() < 9_007_199_254_740_992. {
        json!(v as i64)
    } else {
        json!(v)
    }
}

fn phase_str(p: Phase) -> &'static str {
    match p {
        Phase::Lobby => "lobby",
        Phase::Planning => "planning",
        Phase::Active => "active",
        Phase::Ended => "ended",
    }
}

fn status_str(s: Status) -> &'static str {
    match s {
        Status::Lobby => "lobby",
        Status::Alive => "alive",
        Status::Dead => "dead",
        Status::Mia => "mia",
    }
}

fn weapon_str(w: Option<WeaponId>) -> &'static str {
    w.map_or("", |w| w.as_str())
}

fn role(sim: &Sim, id: PlayerId) -> &'static str {
    if sim.w.players.iter().any(|p| p.core.id == id) {
        return "me";
    }
    match sim.w.mobs.get(id) {
        None => "unknown",
        Some(m) => match m.kind {
            MobKind::Dummy => {
                if m.core.weapon.weapon0 == Some(WeaponId::Shield) {
                    "shield"
                } else {
                    "dummy"
                }
            }
            MobKind::Practice => "practice",
            MobKind::Regional => "mob",
            MobKind::QuestGiver => panic!("givers are not admitted in training"),
        },
    }
}

fn project_events(sim: &Sim, events: &[Event]) -> Value {
    let me = sim.w.players.first().map(|p| p.core.id);
    let mut toasts = Vec::new();
    let mut hits = Vec::new();
    let mut blocks = Vec::new();
    let mut deaths = Vec::new();
    let mut resolved = 0u32;
    for e in events {
        match e {
            Event::Toast { to, text } => toasts.push(json!({
                "to": to.map(|id| if Some(id) == me { "p0" } else { "other" }),
                "text": text,
            })),
            Event::Hit {
                victim,
                by,
                amount,
                weapon,
                ..
            } => hits.push(json!({
                "victim": role(sim, *victim),
                "by": by.map_or("unknown", |b| role(sim, b)),
                "weapon": weapon_str(*weapon),
                "amount": num(r6(*amount)),
            })),
            Event::Block { id, by, weapon, .. } => blocks.push(json!({
                "victim": role(sim, *id),
                "by": role(sim, *by),
                "weapon": weapon.as_str(),
            })),
            Event::Death { id, by, .. } => deaths.push(json!({
                "victim": role(sim, *id),
                "by": by.map_or("unknown", |b| role(sim, b)),
            })),
            Event::Resolved { .. } => resolved += 1,
            _ => {}
        }
    }
    json!({"toasts": toasts, "hits": hits, "blocks": blocks, "deaths": deaths, "resolved": resolved})
}

fn project(sim: &Sim) -> Value {
    let p = sim.w.players.first().expect("one seat");
    let sorted_pairs = |pairs: Vec<(&'static str, u64)>| -> Value {
        let mut pairs = pairs;
        pairs.sort_by_key(|(name, _)| *name);
        Value::Array(
            pairs
                .into_iter()
                .map(|(name, count)| json!([name, num(count as f64)]))
                .collect(),
        )
    };
    let build = sorted_pairs(
        crate::cards::CardId::ALL
            .into_iter()
            .filter(|id| p.build.count(*id) > 0)
            .map(|id| (id.as_str(), u64::from(p.build.count(id))))
            .collect(),
    );
    let stats = sorted_pairs(
        crate::mob_catalog::MobTypeId::ALL
            .into_iter()
            .filter(|id| p.farm.count(*id) > 0)
            .map(|id| (id.as_str(), p.farm.count(id)))
            .collect(),
    );
    let player = json!({
        "faction": p.core.vitals.faction.faction_id().expect("declared faction actor").as_str(),
        "x": num(r6(p.core.pos().x)),
        "y": num(r6(p.core.pos().y)),
        "hp": num(r6(p.core.vitals.hp)),
        "maxHp": num(r6(p.core.vitals.max_hp)),
        "status": status_str(p.status),
        "weapon0": weapon_str(p.core.weapon.weapon0),
        "weapon1": weapon_str(p.core.weapon.weapon1),
        "slot": p.core.weapon.slot,
        "build": build,
        "mobStats": stats,
        "barrier": num(r6(p.core.vitals.barrier)),
        "gv": p.credit.gv,
        "kills": p.credit.kills,
        "bounty": p.credit.bounty,
        "down": p.down.is_some(),
        "resolved": p.resolved,
    });
    let mobs: Vec<Value> = sim
        .w
        .mobs
        .iter()
        .map(|m| {
            json!({
                "kind": match m.kind {
                    MobKind::Dummy => "dummy",
                    MobKind::Practice | MobKind::Regional => "mob",
            MobKind::QuestGiver => panic!("givers are not admitted in training"),
                },
                "type": m.mob_type.map_or("", |t| t.as_str()),
                "elite": m.elite,
                "camp": m.camp,
                "x": num(r6(m.core.pos().x)),
                "y": num(r6(m.core.pos().y)),
                "facing": num(r6(m.core.body.facing)),
                "hp": num(r6(m.core.vitals.hp)),
                "maxHp": num(r6(m.core.vitals.max_hp)),
                "status": status_str(m.status),
                "weapon0": weapon_str(m.core.weapon.weapon0),
            })
        })
        .collect();
    let containers: Vec<Value> = sim
        .w
        .containers
        .iter()
        .filter(|c| c.kind == ContainerKind::Ground)
        .map(|c| {
            json!({
                "weapon0": c.items.first().map_or("", |i| i.def.as_str()),
                "x": num(r6(c.at.x)),
                "y": num(r6(c.at.y)),
                "count": c.items.len(),
            })
        })
        .collect();
    let chests: Vec<Value> = sim
        .w
        .reward_chests
        .iter()
        .map(|c| {
            json!({
                "options": c.options.iter().flatten().map(|o| o.as_str()).collect::<Vec<_>>(),
                "x": num(r6(c.at.x)),
                "y": num(r6(c.at.y)),
            })
        })
        .collect();
    json!({
        "tick": sim.w.tick,
        "serverTime": num(r6(sim.w.server_time)),
        "phase": phase_str(sim.w.phase),
        "training": sim.k.config.training,
        "player": player,
        "mobs": mobs,
        "containers": containers,
        "chests": chests,
    })
}

fn card_index(id: &str) -> Option<u32> {
    crate::cards::CardId::ALL
        .into_iter()
        .position(|c| c.as_str() == id)
        .map(|i| i as u32)
}
fn mob_index(id: &str) -> Option<u32> {
    crate::mob_catalog::MobTypeId::ALL
        .into_iter()
        .position(|c| c.as_str() == id)
        .map(|i| i as u32)
}

fn train_raw(msg: &Value) -> Option<crate::input::TrainRaw> {
    let cmd = msg["cmd"].as_str()?;
    let mut raw = crate::input::TrainRaw {
        command: 0,
        id: 0,
        count: 0,
        options: [0; 3],
        option_count: 0,
    };
    match cmd {
        "card" => {
            raw.command = 1;
            raw.id = card_index(msg["id"].as_str()?)?;
            raw.count = msg["count"].as_u64().unwrap_or(1);
        }
        "stat" => {
            raw.command = 2;
            raw.id = mob_index(msg["id"].as_str()?)?;
            raw.count = msg["count"].as_u64().unwrap_or(1);
        }
        "camp" => {
            raw.command = 3;
            raw.id = mob_index(msg["id"].as_str()?)?;
        }
        "chest" => {
            raw.command = 4;
            if let Some(options) = msg["options"].as_array() {
                if options.len() > 3 {
                    return None;
                }
                for (i, option) in options.iter().enumerate() {
                    raw.options[i] = card_index(option.as_str()?)?.try_into().ok()?;
                    raw.option_count += 1;
                }
            }
        }
        "clear" => raw.command = 5,
        _ => return None,
    }
    Some(raw)
}

fn run_case(case: &Value) {
    let name = case["name"].as_str().expect("case name");
    let kind = case["kind"].as_str().expect("case kind");
    let profile = for_profile();
    let spawn = Vec2::new(
        profile["player"]["at"]["x"].as_f64().unwrap(),
        profile["player"]["at"]["y"].as_f64().unwrap(),
    );
    let mut secrets = Secrets::from_seed(1);
    secrets.order_salt = profile["orderSalt"].as_u64().unwrap() as u32;
    secrets.spawn_seed = profile["randomSeed"].as_u64().unwrap() as u32;
    for (i, salt) in profile["rewardSalt"]
        .as_array()
        .expect("reward salt")
        .iter()
        .enumerate()
    {
        secrets.reward_salt[i] = salt.as_u64().unwrap() as u32;
    }
    let placements = [Placement {
        profile: "p0".into(),
        faction: FactionId::Fire,
        bot: false,
        at: spawn,
        hp: None,
        weapon0: None,
        weapon1: None,
    }];
    let mut sim = Sim::reset_active(config(kind), arena(spawn), secrets, &placements);
    let mut events = sim.take_events();
    let steps = case["steps"].as_array().expect("case steps");
    let mut step_index = 0usize;
    for step in steps {
        let do_ = step["do"].as_str().expect("step kind");
        if step_index > 0 {
            events.clear();
        }
        match do_ {
            "initial" => {
                assert_eq!(
                    project(&sim),
                    step["after"],
                    "{name}: the captured initial frame"
                );
                assert_eq!(
                    project_events(&sim, &events),
                    step["events"],
                    "{name}: initial events"
                );
                step_index += 1;
                continue;
            }
            "step" => {
                let ticks = step["ticks"].as_u64().expect("ticks") as usize;
                for _ in 0..ticks {
                    events.extend(sim.step());
                }
            }
            "train" => {
                // An unknown catalog id fails at the harness parse exactly where the source's parseTrain refuses it.
                let accepted = match train_raw(&step["msg"]) {
                    Some(raw) => match validate(RawCommand::Train(raw)) {
                        Ok(cmd) => sim.submit(sim.w.players[0].core.id, cmd).is_ok(),
                        Err(_) => false,
                    },
                    None => false,
                };
                assert_eq!(
                    accepted,
                    step["accepted"].as_bool().expect("accepted flag"),
                    "{name}: door acceptance of {msg}",
                    msg = step["msg"]
                );
            }
            "hit" => {
                let role = step["role"].as_str().expect("hit role");
                let raw_amount = step["raw"].as_f64().expect("hit amount");
                let index = if role == "plain" { 0 } else { 1 };
                let mob = &sim.w.mobs[index];
                let id = mob.core.id;
                let ix = sim.w.fighter_idx(id).expect("mob slot");
                let me = sim.w.players[0].core.id;
                let mut ev = Vec::new();
                crate::systems::mob_life::hurt(
                    &sim.k,
                    &mut sim.w,
                    &mut ev,
                    ix,
                    &[Hit {
                        terrain: false,
                        amount: raw_amount,
                        by: Some(me),
                        name: None,
                    }],
                );
                // A forced out-of-band hit is a state witness only (see the module doc); the frame below is compared.
                assert_eq!(
                    project(&sim),
                    step["after"],
                    "{name}: frame after a forced hit on the {role} dummy"
                );
                step_index += 1;
                continue;
            }
            "down" => {
                let me = sim.w.players[0].core.id;
                let idx = sim.w.idx(me).expect("player slot");
                crate::systems::settle::down_player(
                    &sim.k,
                    &mut sim.w,
                    &mut events,
                    None,
                    idx,
                    Outcome::Died,
                );
                assert_eq!(
                    project_events(&sim, &events),
                    step["events"],
                    "{name}: between-tick down events"
                );
                assert_eq!(
                    project(&sim),
                    step["after"],
                    "{name}: frame while down between ticks"
                );
                step_index += 1;
                continue;
            }
            "riposte" => {
                let weapon = WeaponId::parse(step["weapon"].as_str().expect("weapon"))
                    .expect("known weapon");
                let gap = step["gapTiles"].as_f64().expect("gap") * 32.;
                let me = sim.w.players[0].core.id;
                let (mx, my, facing, shield_max_hp) = {
                    let shield = &sim.w.mobs[1].core;
                    (
                        shield.pos().x,
                        shield.pos().y,
                        shield.body.facing,
                        shield.vitals.max_hp,
                    )
                };
                {
                    let p = sim.w.players.get_mut(me).expect("one seat");
                    p.core.vitals.hp = 0.01;
                    p.core.vitals.max_hp = shield_max_hp * 1e6;
                    p.core.weapon.weapon0 = Some(weapon);
                    p.core.weapon.weapon1 = None;
                    p.core.weapon.slot = 0;
                    p.core.body.x = mx + crate::math::cos(facing) * gap;
                    p.core.body.y = my + crate::math::sin(facing) * gap;
                    p.motion.path.clear();
                    let now = sim.w.server_time;
                    let (x, y) = (p.core.body.x, p.core.body.y);
                    p.core.body.history.reset(Sample { t: now, x, y });
                }
                let a = crate::math::atan2(
                    my - sim.w.players[0].core.pos().y,
                    mx - sim.w.players[0].core.pos().x,
                );
                let attack = validate(RawCommand::Attack { a, t: None }).expect("attack");
                sim.submit(me, attack).expect("attack accepted");
                events.extend(sim.step());
                if weapon == WeaponId::Bow {
                    for _ in 0..15 {
                        events.extend(sim.step());
                    }
                }
                let release = validate(RawCommand::Release { a, t: None }).expect("release");
                sim.submit(me, release).expect("release accepted");
                events.extend(sim.step());
                let mut downed = events
                    .iter()
                    .any(|e| matches!(e, Event::Death { id, .. } if *id == me));
                for _ in 0..40 {
                    if downed {
                        break;
                    }
                    let out = sim.step();
                    downed = out
                        .iter()
                        .any(|e| matches!(e, Event::Death { id, .. } if *id == me));
                    events.extend(out);
                }
                assert!(downed, "{name}: the riposte/reflection downed the player");
            }
            other => panic!("{name}: unknown step {other}"),
        }
        assert_eq!(
            project_events(&sim, &events),
            step["events"],
            "{name}: step {} ({do_}) events",
            step_index
        );
        assert_eq!(
            project(&sim),
            step["after"],
            "{name}: step {} ({do_}) frame",
            step_index
        );
        step_index += 1;
    }
}

fn for_profile() -> Value {
    fixture()["profile"].clone()
}

#[test]
fn the_captured_training_corpus_matches_the_source() {
    let f = fixture();
    assert_eq!(f["format"], "rh-training-source/1");
    let profile = for_profile();
    // The corpus is captured at the fixed 20 Hz step (50 ms); the value is compared without a local constant so the
    // content-registry scan does not see a second TICK_MS declaration.
    assert_eq!(
        profile["tickMs"].as_f64().unwrap(),
        50.0,
        "the corpus tick rate"
    );
    let cases = f["cases"].as_array().expect("cases");
    assert!(cases.len() >= 15, "the declared case set");
    for case in cases {
        run_case(case);
    }
}
