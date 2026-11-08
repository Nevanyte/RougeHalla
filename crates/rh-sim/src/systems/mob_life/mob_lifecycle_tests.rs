//! Captured actual-source mob lifecycle comparison: the ordered `mobKilled`/`campCleared` producer calls, the camp
//! clear reward state, the ground weapon award, and the 180 s full-roster respawn boundary driven through ordinary fixed
//! steps (with restores immediately before and at the boundary).
//!
//! The corpus is `parity/mobs/runtime-lifecycle.json`, captured from the unmodified source in the pinned linux/amd64
//! Node 22.23.4 container by `tools/mob-runtime-fixtures/capture.mts`. Its passive `world.hooks` observers write the
//! expected producer order and arguments; they change no gameplay state. The pass is not complete: the source chests,
//! camp-heal and quest consumers stay Pending in other packets (P-CARDS-2, P-MOBS-2, P-QUEST-1), so the corpus profile
//! excludes the training dummy constructor (P-ARENA-2) and only ground weapon containers are compared (the elite augment
//! chest is a reward container owned by P-MOBS-2/P-CARDS-2).
use crate::{
    mob_runtime::{ActorOrigin, BrainMode, MobMode},
    status_runtime::probe::HookRecord,
    systems::ledger::Hit,
    validate, Arena, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, TileMap,
    Vec2, WeaponId,
};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../../parity/mobs/runtime-lifecycle.json");
const MAP: &str = include_str!("../../../tests/fixtures/mob-pve-map.json");
const SEATS: usize = 3;

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the captured mob lifecycle corpus parses")
}

fn arena() -> Arena {
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
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}

fn placements(f: &Value) -> Vec<Placement> {
    f["case"]["input"]["players"]
        .as_array()
        .expect("declared players")
        .iter()
        .enumerate()
        .map(|(i, p)| Placement {
            profile: format!("p{i}"),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()),
            hp: None,
            weapon0: WeaponId::parse(p["weapon"].as_str().unwrap()),
            weapon1: None,
        })
        .collect()
}

fn make_sim(f: &Value) -> Sim {
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = 12;
    secrets.reward_salt = [1, 2, 3, 4];
    let mut sim = Sim::reset_active(
        SimConfig {
            consumables: false, // The captured lifecycle installer list omits consumables.
            quests: false,
            mob_mode: MobMode::Pve,
            ..Default::default()
        },
        arena(),
        secrets,
        &placements(f),
    );
    sim.w.trace.1.enabled = true;
    sim
}

fn close(a: f64, b: &Value, label: &str) {
    let b = b
        .as_f64()
        .unwrap_or_else(|| panic!("{label}: not a captured number"));
    assert!(
        (a - b).abs() <= 1e-10 * b.abs().max(1.),
        "{label}: native {a} source {b}"
    );
}

fn close_opt(a: Option<f64>, b: &Value, label: &str) {
    match (a, b.is_null()) {
        (None, true) => {}
        (Some(a), false) => close(a, b, label),
        (a, _) => panic!("{label}: native {a:?} source {b}"),
    }
}

fn source_id(s: &str, seats: usize) -> PlayerId {
    if let Some(n) = s.strip_prefix('p') {
        PlayerId(n.parse::<u32>().unwrap() + 1)
    } else {
        PlayerId(seats as u32 + u32::from_str_radix(s.strip_prefix("mob").unwrap(), 36).unwrap())
    }
}

fn id_name(sim: &Sim, id: PlayerId) -> String {
    if id.0 as usize <= sim.w.players.len() {
        format!("p{}", id.0 - 1)
    } else {
        match sim.w.actor_origin(id) {
            Some(ActorOrigin::Mob { birth_serial, .. }) => format!("mob{}", base36(*birth_serial)),
            _ => panic!("unexpected actor id {id:?}"),
        }
    }
}

fn base36(mut n: u32) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = vec![];
    loop {
        out.push(DIGITS[(n % 36) as usize] as char);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.iter().rev().collect()
}

fn mob_serial(sim: &Sim, id: PlayerId) -> u32 {
    match sim.w.actor_origin(id) {
        Some(ActorOrigin::Mob { birth_serial, .. }) => *birth_serial,
        _ => panic!("mob without birth provenance"),
    }
}

fn status_str(s: crate::Status) -> &'static str {
    match s {
        crate::Status::Lobby => "lobby",
        crate::Status::Alive => "alive",
        crate::Status::Dead => "dead",
        crate::Status::Mia => "mia",
    }
}

fn weapon_str(w: Option<WeaponId>) -> &'static str {
    w.map_or("", WeaponId::as_str)
}

fn mode_str(m: BrainMode) -> &'static str {
    match m {
        BrainMode::Idle => "idle",
        BrainMode::Fight => "fight",
        BrainMode::Return => "return",
    }
}

fn check_point(_sim: &Sim, got: Vec2, want: &Value, label: &str) {
    close(got.x, &want["x"], &format!("{label} x"));
    close(got.y, &want["y"], &format!("{label} y"));
}

fn check_snapshot(sim: &Sim, frame: &Value, label: &str) {
    let w = &sim.w;
    assert_eq!(
        sim.tick() as u64,
        frame["tick"].as_u64().unwrap(),
        "{label} tick"
    );
    close(sim.server_time(), &frame["time"], &format!("{label} time"));
    assert_eq!(
        w.entity_counter as u64,
        frame["counter"].as_u64().unwrap(),
        "{label} entity counter"
    );
    assert_eq!(
        format!("{:?}", sim.phase()).to_lowercase(),
        frame["phase"].as_str().unwrap(),
        "{label} phase"
    );

    let players = frame["players"].as_array().unwrap();
    assert_eq!(w.players.len(), players.len(), "{label} player count");
    for (p, e) in w.players.iter().zip(players) {
        let id = source_id(e["id"].as_str().unwrap(), SEATS);
        assert_eq!(p.id, id, "{label} player id");
        let who = &format!("{label} p{}", p.id.0 - 1);
        close(p.body.x, &e["x"], &format!("{who} x"));
        close(p.body.y, &e["y"], &format!("{who} y"));
        close(p.vitals.hp, &e["hp"], &format!("{who} hp"));
        close(p.vitals.max_hp, &e["maxHp"], &format!("{who} maxHp"));
        assert_eq!(
            status_str(p.status),
            e["status"].as_str().unwrap(),
            "{who} status"
        );
        assert_eq!(
            weapon_str(p.weapon.weapon0),
            e["weapon0"].as_str().unwrap(),
            "{who} weapon0"
        );
        assert_eq!(
            weapon_str(p.weapon.weapon1),
            e["weapon1"].as_str().unwrap(),
            "{who} weapon1"
        );
        assert_eq!(
            p.credit.mob_kills as u64,
            e["mobKills"].as_u64().unwrap(),
            "{who} mobKills"
        );
        assert_eq!(p.credit.gv as u64, e["gv"].as_u64().unwrap(), "{who} gv");
        let stats = e["stats"].as_object().unwrap();
        for row in crate::modifiers::farm::DEFINITION.rows {
            let want = stats
                .get(row.mob.as_str())
                .map_or(0, |v| v.as_u64().unwrap());
            assert_eq!(
                p.farm.count(row.mob),
                want,
                "{who} mob stat stack {}",
                row.mob.as_str()
            );
        }
    }

    let rt = w.mob_runtime.as_ref().expect("the regional runtime is on");
    let camps = frame["camps"].as_array().unwrap();
    assert_eq!(rt.camps.len(), camps.len(), "{label} camp count");
    for (c, e) in rt.camps.iter().zip(camps) {
        assert_eq!(
            c.alive as u64,
            e["alive"].as_u64().unwrap(),
            "{label} camp alive"
        );
        assert_eq!(
            c.state as u64,
            e["state"].as_u64().unwrap(),
            "{label} camp state"
        );
        close(
            c.cleared_at,
            &e["clearedAt"],
            &format!("{label} camp clearedAt"),
        );
        close(
            c.respawn_at,
            &e["respawnAt"],
            &format!("{label} camp respawnAt"),
        );
    }

    let mut mobs: Vec<_> = w.mobs.iter().collect();
    mobs.sort_by_key(|m| mob_serial(sim, m.core.id));
    let mut expected: Vec<&Value> = frame["mobs"].as_array().unwrap().iter().collect();
    expected.sort_by_key(|e| {
        u32::from_str_radix(e["id"].as_str().unwrap().trim_start_matches("mob"), 36).unwrap()
    });
    assert_eq!(mobs.len(), expected.len(), "{label} mob count");
    for (m, e) in mobs.into_iter().zip(expected) {
        let serial = mob_serial(sim, m.core.id);
        assert_eq!(format!("mob{}", base36(serial)), e["id"].as_str().unwrap());
        let who = &format!("{label} mob{}", base36(serial));
        let s = &e["state"];
        close(m.core.body.x, &s["x"], &format!("{who} x"));
        close(m.core.body.y, &s["y"], &format!("{who} y"));
        close(m.core.vitals.hp, &s["hp"], &format!("{who} hp"));
        close(m.core.vitals.max_hp, &s["maxHp"], &format!("{who} maxHp"));
        close(m.core.body.facing, &s["facing"], &format!("{who} facing"));
        assert_eq!(
            status_str(m.status),
            s["status"].as_str().unwrap(),
            "{who} status"
        );
        close(
            m.core.weapon.ready_at,
            &s["readyAt"],
            &format!("{who} readyAt"),
        );
        close(
            m.core.weapon.draw_started_at,
            &s["drawStartedAt"],
            &format!("{who} drawStartedAt"),
        );
        let b = &e["brain"];
        let brain = &m.brain;
        assert_eq!(
            mode_str(brain.mode),
            b["mode"].as_str().unwrap(),
            "{who} mode"
        );
        assert_eq!(
            brain.target.map(|t| id_name(sim, t)),
            b["target"].as_str().map(str::to_string),
            "{who} target"
        );
        close(
            brain.last_combat_at,
            &b["lastCombatAt"],
            &format!("{who} lastCombatAt"),
        );
        close(
            brain.last_move_at,
            &b["lastMoveAt"],
            &format!("{who} lastMoveAt"),
        );
        assert_eq!(
            m.repath_phase as u64,
            b["phase"].as_u64().unwrap(),
            "{who} phase"
        );
        close(brain.died_at, &b["diedAt"], &format!("{who} diedAt"));
        assert_eq!(m.elite, b["elite"].as_bool().unwrap(), "{who} elite");
        assert_eq!(
            m.core.vitals.faction.as_str(),
            b["region"].as_str().unwrap(),
            "{who} region"
        );
        check_point(sim, m.home, &b["home"], &format!("{who} home"));
        close(
            m.home_facing,
            &b["homeFacing"],
            &format!("{who} homeFacing"),
        );
        assert_eq!(
            brain.holding,
            b["holding"].as_bool().unwrap(),
            "{who} holding"
        );
        assert_eq!(brain.moving, b["moving"].as_bool().unwrap(), "{who} moving");
        match brain.goal {
            Some(goal) => check_point(sim, goal, &b["goal"], &format!("{who} goal")),
            None => assert!(b["goal"].is_null(), "{who} goal: source {b:?}"),
        }
        let threat = b["threat"].as_array().unwrap();
        assert_eq!(brain.threat.len(), threat.len(), "{who} threat length");
        for (held, e) in brain.threat.iter().zip(threat) {
            assert_eq!(
                id_name(sim, held.0),
                e[0].as_str().unwrap(),
                "{who} threat actor"
            );
            close(held.1, &e[1], &format!("{who} threat amount"));
        }
        close_opt(brain.last_aim, &b["lastAim"], &format!("{who} lastAim"));

        let queue = &m.core.inputs;
        assert_eq!(
            queue.actions.as_slice().len(),
            e["inputs"]["actions"].as_array().unwrap().len(),
            "{who} queued actions"
        );
        for (a, e) in queue
            .actions
            .as_slice()
            .iter()
            .zip(e["inputs"]["actions"].as_array().unwrap())
        {
            let (kind, angle) = match a {
                crate::input::ActionCmd::Attack { a, .. } => ("attack", *a),
                crate::input::ActionCmd::Release { a, .. } => ("release", *a),
                other => panic!("{who}: unexpected queued action {other:?}"),
            };
            assert_eq!(kind, e["kind"].as_str().unwrap(), "{who} queued kind");
            close(angle, &e["a"], &format!("{who} queued angle"));
        }
        assert_eq!(
            queue.move_before as u64,
            e["inputs"]["moveBefore"].as_u64().unwrap(),
            "{who} moveBefore"
        );
        assert_eq!(
            queue.aim_before as u64,
            e["inputs"]["aimBefore"].as_u64().unwrap(),
            "{who} aimBefore"
        );
        close_opt(queue.aim, &e["inputs"]["aim"], &format!("{who} queued aim"));
        match (&queue.mv, &e["inputs"]["move"]) {
            (None, Value::Null) => {}
            (Some(crate::input::MoveCmd::Move { x, y, .. }), m) => {
                close(*x, &m["x"], &format!("{who} move x"));
                close(*y, &m["y"], &format!("{who} move y"));
            }
            (Some(crate::input::MoveCmd::Stop { .. }), m) => {
                assert_eq!(m["kind"], "stop", "{who} move")
            }
            (got, want) => panic!("{who} move: native {got:?} source {want}"),
        }
        let path = e["path"].as_array().unwrap();
        assert_eq!(m.core.motion.path.len(), path.len(), "{who} path length");
        for (got, want) in m.core.motion.path.as_slice().iter().zip(path) {
            check_point(sim, *got, want, &format!("{who} path"));
        }
        close(m.last_hit_at, &e["lastHitAt"], &format!("{who} lastHitAt"));
    }

    let mut containers: Vec<_> = w
        .containers
        .iter()
        .filter(|c| c.kind == crate::state::ContainerKind::Ground)
        .collect();
    containers.sort_by_key(|c| c.id);
    let mut expected: Vec<&Value> = frame["containers"].as_array().unwrap().iter().collect();
    expected.sort_by_key(|c| {
        u32::from_str_radix(c["id"].as_str().unwrap().trim_start_matches('c'), 36).unwrap()
    });
    assert_eq!(
        containers.len(),
        expected.len(),
        "{label} ground container count"
    );
    for (c, e) in containers.into_iter().zip(expected) {
        assert_eq!(
            format!("c{}", base36(c.id)),
            e["id"].as_str().unwrap(),
            "{label} container id"
        );
        let items: Vec<&str> = c.items.iter().map(|i| i.def.as_str()).collect();
        let want: Vec<&str> = e["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i.as_str().unwrap())
            .collect();
        assert_eq!(items, want, "{label} container items");
        check_point(sim, c.at, e, &format!("{label} container"));
    }
}

fn producer(record: &HookRecord) -> bool {
    matches!(
        record,
        HookRecord::MobKilled { .. } | HookRecord::CampCleared { .. }
    )
}

fn check_hooks(records: &[&HookRecord], expected: &[&Value]) {
    assert_eq!(records.len(), expected.len(), "producer call count");
    for (record, e) in records.iter().zip(expected) {
        match e["kind"].as_str().unwrap() {
            "mobKilled" => {
                let HookRecord::MobKilled {
                    killer,
                    mob_type,
                    zone,
                    camp,
                    elite,
                    at,
                } = record
                else {
                    panic!("mobKilled record: {record:?}")
                };
                assert_eq!(
                    *killer,
                    source_id(e["killer"].as_str().unwrap(), SEATS),
                    "hook killer"
                );
                assert_eq!(mob_type.as_str(), e["type"].as_str().unwrap(), "hook type");
                assert_eq!(zone.as_str(), e["zone"].as_str().unwrap(), "hook zone");
                assert_eq!(*camp, e["camp"].as_i64().unwrap() as i32, "hook camp");
                assert_eq!(*elite, e["elite"].as_bool().unwrap(), "hook elite");
                close(at.x, &e["at"]["x"], "hook x");
                close(at.y, &e["at"]["y"], "hook y");
            }
            "campCleared" => {
                let HookRecord::CampCleared { camp } = record else {
                    panic!("campCleared record: {record:?}")
                };
                assert_eq!(*camp, e["camp"].as_u64().unwrap() as u32, "cleared camp");
            }
            other => panic!("unexpected captured hook kind {other}"),
        }
    }
}

fn submit_commands(sim: &mut Sim, commands: &[Value]) {
    for c in commands {
        let id = source_id(c["actor"].as_str().unwrap(), SEATS);
        let raw = match c["kind"].as_str().unwrap() {
            "target" => RawCommand::Target {
                id: source_id(c["id"].as_str().unwrap(), SEATS),
            },
            "attack" => RawCommand::Attack {
                a: c["a"].as_f64().unwrap(),
                t: None,
            },
            other => panic!("unadmitted captured command {other}"),
        };
        sim.submit(id, validate(raw).unwrap()).unwrap();
    }
}

#[test]
fn mob_lifecycle_captured_source_hooks_rewards_and_180s_respawn() {
    let f = fixture();
    assert_eq!(f["format"], "rh-mob-lifecycle-source/1");
    let case = &f["case"];
    let mut sim = make_sim(&f);
    check_snapshot(&sim, &case["initial"], "initial");

    let frames: Vec<&Value> = case["frames"].as_array().unwrap().iter().collect();
    let trace: Vec<&Value> = case["trace"].as_array().unwrap().iter().collect();
    let hooks: Vec<&Value> = case["hooks"].as_array().unwrap().iter().collect();
    // The trace records every tick from 2 through respawnTick + 2.
    assert_eq!(
        trace.len(),
        (case["respawnTick"].as_u64().unwrap() + 1) as usize
    );
    let mut frame_at = 0usize;
    let mut trace_at = 0usize;
    let mut hook_at = 0usize;
    let mut hooked = 0u64;
    let respawn_tick = case["respawnTick"].as_u64().unwrap();
    let mut restored: Vec<(u64, Sim)> = Vec::new();
    loop {
        let tick = sim.tick() as u64 + 1;
        if frame_at < frames.len() && frames[frame_at]["tick"].as_u64().unwrap() == tick {
            submit_commands(&mut sim, frames[frame_at]["commands"].as_array().unwrap());
        }
        sim.step();
        let tick = sim.tick() as u64;
        assert_eq!(tick, sim.tick() as u64);

        let t = trace[trace_at];
        assert_eq!(t[0].as_u64().unwrap(), tick, "trace tick");
        let rt = sim.w.mob_runtime.as_ref().unwrap();
        assert_eq!(
            t[1].as_u64().unwrap(),
            u64::from(rt.camps[0].alive),
            "trace camp alive"
        );
        assert_eq!(
            t[2].as_u64().unwrap(),
            u64::from(rt.camps[0].state),
            "trace camp state"
        );
        assert_eq!(
            t[3].as_u64().unwrap(),
            sim.w.mobs.len() as u64,
            "trace mob count"
        );
        trace_at += 1;

        let producers: Vec<&HookRecord> = sim
            .w
            .trace
            .1
            .records
            .iter()
            .filter(|r| producer(r))
            .collect();
        if producers.len() as u64 > hooked {
            let expected: Vec<&Value> = hooks
                .iter()
                .copied()
                .filter(|h| h["tick"].as_u64().unwrap() == tick)
                .collect();
            let new = &producers[hooked as usize..];
            check_hooks(new, &expected);
            hooked = producers.len() as u64;
            hook_at += expected.len();
        }

        if frame_at < frames.len() && frames[frame_at]["tick"].as_u64().unwrap() == tick {
            check_snapshot(&sim, frames[frame_at], &format!("frame tick {tick}"));
            frame_at += 1;
        }
        assert_eq!(
            trace_at,
            tick as usize - 1,
            "trace is contiguous from tick 2"
        );

        if tick + 1 == respawn_tick - 1 || tick + 1 == respawn_tick {
            let value = serde_json::to_value(&sim).unwrap();
            restored.push((tick, serde_json::from_value(value).unwrap()));
        }
        for (at, r) in restored.iter_mut() {
            if tick > *at {
                r.step();
                assert_eq!(
                    r.state_hash(),
                    sim.state_hash(),
                    "restored continuation at tick {tick}"
                );
            }
        }
        if tick == respawn_tick + 2 {
            break;
        }
    }
    assert_eq!(frame_at, frames.len(), "every captured frame was compared");
    assert_eq!(trace_at, trace.len(), "every captured tick was compared");
    assert_eq!(
        hook_at,
        hooks.len(),
        "every captured producer call was compared"
    );
    assert_eq!(hooked, hooks.len() as u64);
    for (at, r) in restored {
        assert_eq!(
            r.state_hash(),
            sim.state_hash(),
            "restore at {at} reaches the same end"
        );
    }
}

/// The packet's return-immunity trap: a mob walking home stays damageable, damage adds threat (and its whole-fight kill
/// credit) but never re-aggros it, while the same hit on an idle mob still wakes the camp. This is the guard the
/// `return-immunity` mutant must fail.
#[test]
fn mob_lifecycle_returning_mob_damage_adds_threat_without_reaggro() {
    let f = fixture();
    let mut sim = make_sim(&f);
    sim.step();
    let player = sim.w.players[0].id;
    let ids: Vec<PlayerId> = sim.w.mobs.iter().map(|m| m.core.id).collect();
    assert!(ids.len() >= 2, "the camp spawned");

    // A returning mob: the hit lands, the threat (kill credit) grows, the mode does not change.
    let returning = ids[0];
    sim.w.mobs.get_mut(returning).unwrap().brain.mode = BrainMode::Return;
    let ix = sim.w.fighter_idx(returning).unwrap();
    let mut ev = Vec::new();
    let hit = |amount: f64| Hit {
        terrain: false,
        amount,
        by: Some(player),
        name: None,
    };
    let removed = crate::systems::mob_life::hurt(&sim.k, &mut sim.w, &mut ev, ix, &[hit(10.)]);
    assert_eq!(removed, 10.);
    let brain = &sim.w.mobs.get(returning).unwrap().brain;
    assert_eq!(
        brain.mode,
        BrainMode::Return,
        "a returning mob never re-aggros"
    );
    assert_eq!(
        brain.threat,
        vec![(player, 10.)],
        "damage still adds whole-fight threat"
    );

    // The control: the same hit on an idle mate wakes the camp onto the attacker.
    let idle = ids[1];
    assert_eq!(sim.w.mobs.get(idle).unwrap().brain.mode, BrainMode::Idle);
    let ix = sim.w.fighter_idx(idle).unwrap();
    let removed = crate::systems::mob_life::hurt(&sim.k, &mut sim.w, &mut ev, ix, &[hit(10.)]);
    assert_eq!(removed, 10.);
    let brain = &sim.w.mobs.get(idle).unwrap().brain;
    assert_eq!(brain.mode, BrainMode::Fight, "an idle mob wakes");
    assert_eq!(brain.target, Some(player));
    assert_eq!(
        sim.w.mobs.get(returning).unwrap().brain.mode,
        BrainMode::Return
    );
}

/// The packet's per-kill-loose-drop trap: a camp's weapon drops once, for the camp clear, chosen by the earliest dying
/// mob of the pass (never once per kill, and never before the camp is empty). This is the guard the
/// `per-kill-loose-drop` mutant must fail.
#[test]
fn mob_lifecycle_camp_clear_is_the_only_loose_weapon() {
    let f = fixture();
    let mut sim = make_sim(&f);
    sim.step();
    let ids: Vec<PlayerId> = sim.w.mobs.iter().map(|m| m.core.id).collect();
    assert!(ids.len() >= 2, "the camp spawned");
    let award = |sim: &Sim, id: PlayerId| super::Award {
        mob: id,
        serial: mob_serial(sim, id),
        killer: Some(sim.w.players[0].id),
        camp: 0,
        weapon: WeaponId::Axe,
        at: Vec2::new(0., 0.),
        elite: false,
        mob_type: crate::mob_catalog::MobTypeId::EmberImp,
        zone: FactionId::Fire,
        mult: 1.,
        contributors: Vec::new(),
    };
    let first = award(&sim, ids[0]);
    let second = award(&sim, ids[1]);
    // A camp that still has members alive drops nothing for a kill.
    sim.w.pay.mob_deaths = vec![first.clone()];
    assert!(!super::dropper(&sim.w, &first));
    // Once the camp is empty only the earliest dying mob of the camp leaves its weapon.
    sim.w.mob_runtime.as_mut().unwrap().camps[0].alive = 0;
    sim.w.pay.mob_deaths = vec![second.clone(), first.clone()];
    assert!(super::dropper(&sim.w, &first));
    assert!(!super::dropper(&sim.w, &second));
    // A clear whose deaths were already settled (empty pass list) still leaves its own weapon.
    sim.w.pay.mob_deaths.clear();
    assert!(super::dropper(&sim.w, &first));
}
