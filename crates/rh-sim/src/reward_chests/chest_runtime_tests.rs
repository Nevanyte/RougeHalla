//! Captured actual-source chest runtime comparison (pinned linux/amd64 Node 22.23.4 container): the camp-clear elite
//! augment chest drop (options, camp, expiry and reward draws at the source's draw order), real `choose` intake for a card
//! and a skip, another player's refusal, the skip's heal/GV split, and the stat-crate first-open boost drop and pick.
//!
//! The corpus is `parity/chests/runtime.json` from `tools/chest-fixtures/capture.mts`; its only observers are passive
//! `world.hooks` taps, and the declared placements/picks are set up before real fixed steps. The comparison checks the
//! chest-domain state the packet owns (chests, build/boost facts, mirrors, camp state, reward draws and the relevant
//! events); mob combat beyond the camp clear stays P-MOBS scope and is not claimed here.
use crate::{
    mob_runtime::{ActorOrigin, MobMode},
    state::PlayerId,
    validate, Arena, Event, FactionId, Placement, RawCommand, Secrets, Sim, SimConfig, TileMap,
    Vec2, WeaponId,
};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../parity/chests/runtime.json");
const CAMP_MAP: &str = include_str!("../../tests/fixtures/mob-pve-map.json");
const STAT_MAP: &str = include_str!("../../../../parity/initial-loot/input-map.json");

fn arena_of(json: &str) -> Arena {
    let data: crate::mapdata::GameMapData =
        serde_json::from_str(json).expect("captured map parses");
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

fn secrets() -> Secrets {
    let mut s = Secrets::from_seed(1);
    s.spawn_seed = 12;
    s.reward_salt = [1, 2, 3, 4];
    s
}

fn placements(players: &Value) -> Vec<Placement> {
    players
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

fn side_of(scenario: &str) -> bool {
    scenario != "stat-boost"
}

fn make_sim(case: &Value) -> Sim {
    let input = &case["input"];
    let scenario = input["scenario"].as_str().unwrap();
    if side_of(scenario) {
        Sim::reset_active(
            SimConfig {
                mob_mode: MobMode::Pve,
                ..Default::default()
            },
            arena_of(CAMP_MAP),
            secrets(),
            &placements(&input["players"]),
        )
    } else {
        let mut sim = Sim::new(
            SimConfig {
                initial_loot: true,
                min_players: 2,
                fill_seconds: 0.,
                ..Default::default()
            },
            arena_of(STAT_MAP),
            secrets(),
        );
        sim.add_player("p0", Some(FactionId::Fire), false).unwrap();
        sim.add_player("p1", Some(FactionId::Sentenced), false)
            .unwrap();
        sim.step();
        let players = input["players"].as_array().unwrap();
        for (i, p) in players.iter().enumerate() {
            let id = PlayerId(i as u32 + 1);
            let at = Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap());
            let ix = sim.w.idx(id).unwrap();
            let now = sim.w.server_time;
            let c = &mut sim.w.players[ix];
            c.body.x = at.x;
            c.body.y = at.y;
            c.motion.path.clear();
            c.body.history.reset(crate::state::Sample {
                t: now,
                x: at.x,
                y: at.y,
            });
        }
        sim.take_events();
        sim
    }
}

fn base36(mut n: u32) -> String {
    let mut out = vec![];
    loop {
        out.push(char::from_digit(n % 36, 36).unwrap());
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.iter().rev().collect()
}

fn mob_with_serial(sim: &Sim, serial: u32) -> PlayerId {
    sim.w
        .mobs
        .iter()
        .find_map(|m| match sim.w.actor_origin(m.core.id) {
            Some(ActorOrigin::Mob { birth_serial, .. }) if *birth_serial == serial => {
                Some(m.core.id)
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("mob serial {serial} is not in the world"))
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

fn close(a: f64, b: &Value, label: &str) {
    let b = b
        .as_f64()
        .unwrap_or_else(|| panic!("{label}: not a captured number"));
    assert!(
        (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.),
        "{label}: native {a:?} source {b:?}"
    );
}

/// The clone advanced `draws` values must be the world's stream: the draw count is a checked fact, not a counter the
/// implementation asserts about itself.
fn check_draws(sim: &Sim, start: &crate::private_rng::Sfc32, draws: u64, label: &str) {
    let mut probe = start.clone();
    for _ in 0..draws {
        probe.next_f64();
    }
    assert_eq!(
        probe.words(),
        sim.w.reward_rng.words(),
        "{label}: reward draw count {draws}"
    );
}

fn build_json(p: &crate::state::Player) -> Vec<(String, u8)> {
    let mut out: Vec<(String, u8)> = p
        .build
        .cards()
        .map(|id| (id.as_str().to_string(), p.build.count(id)))
        .filter(|(_, n)| *n > 0)
        .collect();
    out.sort();
    out
}

fn boosts_json(p: &crate::state::Player) -> Vec<(String, u8)> {
    let mut out: Vec<(String, u8)> = crate::reward_chests::BoostId::ALL
        .into_iter()
        .filter_map(|id| {
            let n = p.build.boosts()[id.index()];
            (n > 0).then(|| (id.as_str()[6..].to_string(), n))
        })
        .collect();
    out.sort();
    out
}

fn check_player(sim: &Sim, seat: usize, want: &Value, label: &str) {
    let id = PlayerId(seat as u32 + 1);
    let ix = sim.w.idx(id).unwrap();
    let p = &sim.w.players[ix];
    let who = format!("{label} p{seat}");
    close(p.body.x, &want["x"], &format!("{who} x"));
    close(p.body.y, &want["y"], &format!("{who} y"));
    if !want["hp"].is_null() {
        close(p.vitals.hp, &want["hp"], &format!("{who} hp"));
        close(p.vitals.max_hp, &want["maxHp"], &format!("{who} maxHp"));
    }
    assert_eq!(p.credit.gv as u64, want["gv"].as_u64().unwrap(), "{who} gv");
    let build: Vec<(String, u8)> = want["build"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e[0].as_str().unwrap().to_string(),
                u8::try_from(e[1].as_u64().unwrap()).unwrap(),
            )
        })
        .collect();
    assert_eq!(build_json(p), build, "{who} build");
    let boosts: Vec<(String, u8)> = want["boosts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e[0].as_str().unwrap().to_string(),
                u8::try_from(e[1].as_u64().unwrap()).unwrap(),
            )
        })
        .collect();
    assert_eq!(boosts_json(p), boosts, "{who} boosts");

    let m = p.modifiers.mirrors();
    close(m.as_mult, &want["mods"]["asMult"], &format!("{who} asMult"));
    close(
        m.windup_mult,
        &want["mods"]["windupMult"],
        &format!("{who} windupMult"),
    );
    close(
        m.speed_mult,
        &want["mods"]["speedMult"],
        &format!("{who} speedMult"),
    );
    close(
        m.armor_bonus,
        &want["mods"]["armorBonus"],
        &format!("{who} armorBonus"),
    );
    close(
        m.shield_bonus,
        &want["mods"]["shieldBonus"],
        &format!("{who} shieldBonus"),
    );
    close(
        m.ad_bonus,
        &want["mods"]["adBonus"],
        &format!("{who} adBonus"),
    );
    close(
        m.ap_bonus,
        &want["mods"]["apBonus"],
        &format!("{who} apBonus"),
    );
    // The boost stats mirrors do not carry: the cached row/farm sums.
    let stats = crate::status_runtime::stats::Inputs::default();
    let view = stats.view(&p.core);
    let sums = &want["sums"];
    close(
        view.lifesteal_rows,
        &sums["lifesteal"],
        &format!("{who} lifesteal rows"),
    );
    close(
        view.lifesteal_mult,
        &sums["lifestealMult"],
        &format!("{who} lifesteal mult"),
    );
    close(
        view.lifesteal_dot,
        &sums["lifestealDot"],
        &format!("{who} lifesteal dot"),
    );
    close(
        view.heal_taken_mult,
        &json_add_one(&sums["healTaken"]),
        &format!("{who} healTaken"),
    );
}

fn json_add_one(v: &Value) -> Value {
    Value::from(v.as_f64().unwrap() + 1.)
}

fn chest_name(id: u32) -> String {
    format!("c{}", base36(id))
}

fn check_chests(sim: &Sim, want: &Value, label: &str) {
    let want = want.as_array().unwrap();
    assert_eq!(sim.w.reward_chests.len(), want.len(), "{label} chest count");
    for e in want {
        let name = e["id"].as_str().unwrap();
        let c = sim
            .w
            .reward_chests
            .iter()
            .find(|c| chest_name(c.id) == name)
            .unwrap_or_else(|| panic!("{label}: native chest {name} missing"));
        close(c.at.x, &e["x"], &format!("{label} {name} x"));
        close(c.at.y, &e["y"], &format!("{label} {name} y"));
        let camp = e["camp"].as_u64().unwrap();
        assert_eq!(
            c.camp.map(|c| u64::from(c) + 1),
            (camp > 0).then_some(camp),
            "{label} {name} camp"
        );
        close(
            c.expires_at,
            &e["expiresAt"],
            &format!("{label} {name} expiry"),
        );
        let options: Vec<String> = c
            .options
            .iter()
            .flatten()
            .map(|o| o.as_str().into_owned())
            .collect();
        let want_options: Vec<String> = e["options"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o.as_str().unwrap().to_string())
            .collect();
        assert_eq!(options, want_options, "{label} {name} options");
        let is_stat = c
            .options
            .iter()
            .flatten()
            .any(|o| matches!(o, crate::reward_chests::OptionId::Boost(_)));
        assert_eq!(
            is_stat,
            e["label"].as_str().unwrap() == "Stat Chest",
            "{label} {name} label kind"
        );
        let taken: Vec<String> = c
            .taken
            .iter()
            .map(|t| t.map_or(String::new(), |id| id_name(sim, id)))
            .collect();
        let want_taken: Vec<String> = e["takenBy"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_str().unwrap().to_string())
            .collect();
        assert_eq!(taken, want_taken, "{label} {name} taken");
        let pickers: Vec<String> = c.pickers.iter().map(|id| id_name(sim, *id)).collect();
        let want_pickers: Vec<String> = e["pickers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().unwrap().to_string())
            .collect();
        assert_eq!(pickers, want_pickers, "{label} {name} pickers");
    }
}

fn check_camps(sim: &Sim, want: &Value, label: &str) {
    let want = want.as_array().unwrap();
    let camps = sim.w.mob_runtime.as_ref().map_or(&[][..], |r| &r.camps[..]);
    assert_eq!(camps.len(), want.len(), "{label} camp count");
    for (c, e) in camps.iter().zip(want) {
        assert_eq!(
            u64::from(c.alive),
            e["alive"].as_u64().unwrap(),
            "{label} alive"
        );
        assert_eq!(
            u64::from(c.state),
            e["state"].as_u64().unwrap(),
            "{label} state"
        );
        close(c.cleared_at, &e["clearedAt"], &format!("{label} clearedAt"));
        close(c.respawn_at, &e["respawnAt"], &format!("{label} respawnAt"));
    }
}

fn check_frame(
    sim: &Sim,
    frame: &Value,
    label: &str,
    rng_start: &crate::private_rng::Sfc32,
    compare_hp: bool,
) {
    assert_eq!(
        u64::from(sim.tick()),
        frame["tick"].as_u64().unwrap(),
        "{label} tick"
    );
    close(sim.server_time(), &frame["time"], &format!("{label} time"));
    check_camps(sim, &frame["camp"], label);
    check_chests(sim, &frame["chests"], label);
    let players = frame["players"].as_array().unwrap();
    assert_eq!(sim.w.players.len(), players.len(), "{label} player count");
    for (seat, want) in players.iter().enumerate() {
        let mut want = want.clone();
        if !compare_hp {
            // Mobile combat damage beyond the chest slice is P-MOBS scope (the held-pool scenario grants a combat
            // augment on purpose, so its fights are its own packet's certification).
            want["hp"] = Value::Null;
        }
        check_player(sim, seat, &want, label);
    }
    check_draws(sim, rng_start, frame["draws"].as_u64().unwrap(), label);
}

#[test]
fn chest_runtime_captured_source_drop_choose_skip_and_boost() {
    let f: Value = serde_json::from_str(FIXTURE).expect("the captured chest corpus parses");
    assert_eq!(f["format"], "rh-chest-runtime-source/1");
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 5, "five declared chest scenarios");
    for case in cases {
        run_case(case);
    }
}

fn run_case(case: &Value) {
    let scenario = case["input"]["scenario"].as_str().unwrap();
    let camp = side_of(scenario);
    let mut sim = make_sim(case);
    // Declared bootstrap cards (the cards corpus's grant helper): an owned augment changes what the source pool offers.
    for g in case["input"]["grants"].as_array().map_or(&[][..], |v| v) {
        let actor = PlayerId(g["actor"].as_str().unwrap()[1..].parse::<u32>().unwrap() + 1);
        let card: crate::cards::CardId = serde_json::from_value(g["card"].clone()).unwrap();
        assert!(crate::cards::grant(&sim.k, &mut sim.w, actor, card));
    }
    let rng_start = sim.w.reward_rng.clone();
    let frames = case["frames"].as_array().unwrap();
    let mut next_frame = 1usize;
    let mut events: Vec<Vec<Value>> = Vec::new();

    let step_and = |sim: &mut Sim, events: &mut Vec<Vec<Value>>| {
        let evs = sim.step();
        for e in evs {
            if let Some(n) = normalize_event(sim, &e) {
                events.push(n);
            }
        }
    };

    let compare_hp = scenario != "card-pick-held";
    let check = |sim: &Sim, frame: &Value, label: &str| {
        check_frame(
            sim,
            frame,
            &format!("{scenario} {label}"),
            &rng_start,
            compare_hp,
        );
    };
    // The baseline is the state after construction + declared placements.
    check(&sim, &frames[0], "baseline");

    if camp {
        let trace = case["trace"].as_array().unwrap();
        let commands = case["commands"].as_array().unwrap();
        let chest_clear = frames
            .iter()
            .find(|f| f["label"].as_str() == Some("clear"))
            .expect("clear frame");
        let clear_tick = chest_clear["tick"].as_u64().unwrap();
        let held_tick = frames
            .iter()
            .find(|f| f["label"].as_str() == Some("held"))
            .unwrap()["tick"]
            .as_u64()
            .unwrap();
        let chosen_tick = frames
            .iter()
            .find(|f| f["label"].as_str() == Some("chosen"))
            .unwrap()["tick"]
            .as_u64()
            .unwrap();
        let pick = case["input"]["chestPick"].as_i64().unwrap() as i8;
        let mut trace_at = 0usize;
        let picks_a_card = scenario.starts_with("card-pick");
        while (sim.tick() as u64) < chosen_tick + u64::from(picks_a_card) {
            let tick = sim.tick() as u64;
            // The choose actions are declared setup at the capture's boundaries.
            if tick == held_tick {
                if scenario == "skip-heal" {
                    for _ in 0..62 {
                        step_and(&mut sim, &mut events);
                    }
                    let ix = sim.w.idx(PlayerId(1)).unwrap();
                    let p = &mut sim.w.players[ix];
                    p.vitals.hp = p.vitals.max_hp * 0.4;
                }
                let chest = sim.w.reward_chests[0].clone();
                place(&mut sim, PlayerId(1), chest.at);
                choose(&mut sim, PlayerId(1), chest.id, pick);
            }
            if tick == chosen_tick && picks_a_card {
                let chest = sim.w.reward_chests[0].clone();
                place(&mut sim, PlayerId(2), chest.at);
                choose(&mut sim, PlayerId(2), chest.id, 0);
            }
            for c in commands {
                if c[0].as_u64().unwrap() == tick + 1 {
                    let actor = PlayerId(c[1].as_str().unwrap()[1..].parse::<u32>().unwrap() + 1);
                    let serial = u32::from_str_radix(&c[2].as_str().unwrap()[3..], 36).unwrap();
                    let target = mob_with_serial(&sim, serial);
                    let raw = RawCommand::Target { id: target };
                    sim.submit(actor, validate(raw).expect("valid target"))
                        .unwrap();
                }
            }
            step_and(&mut sim, &mut events);
            let tick = sim.tick() as u64;
            if trace_at < trace.len() {
                let t = &trace[trace_at];
                assert_eq!(t[0].as_u64().unwrap(), tick, "{scenario} trace tick");
                let camps = sim.w.mob_runtime.as_ref().unwrap();
                assert_eq!(
                    t[1].as_u64().unwrap(),
                    u64::from(camps.camps[0].alive),
                    "{scenario} trace camp alive at {tick}"
                );
                assert_eq!(
                    t[2].as_u64().unwrap(),
                    u64::from(camps.camps[0].state),
                    "{scenario} trace camp state at {tick}"
                );
                assert_eq!(
                    t[3].as_u64().unwrap(),
                    sim.w.reward_chests.len() as u64,
                    "{scenario} trace chest count at {tick}"
                );
                check_draws(
                    &sim,
                    &rng_start,
                    t[4].as_u64().unwrap(),
                    &format!("{scenario} trace at {tick}"),
                );
                trace_at += 1;
                if tick == clear_tick {
                    check(&sim, chest_clear, "clear");
                    next_frame = frames
                        .iter()
                        .position(|f| f["label"].as_str() == Some("clear"))
                        .unwrap()
                        + 1;
                }
            }
            while next_frame < frames.len() && frames[next_frame]["tick"].as_u64().unwrap() == tick
            {
                let frame = frames[next_frame].clone();
                check(&sim, &frame, frame["label"].as_str().unwrap());
                next_frame += 1;
            }
        }
    } else {
        // The stat-crate first opening: declared setup (place at the crate, pickup) then the real choose.
        let crate_name = case["input"]["statCrates"][0].as_str().unwrap();
        let crate_id = sim
            .w
            .containers
            .iter()
            .find(|c| chest_name(c.id) == crate_name)
            .unwrap_or_else(|| panic!("stat crate {crate_name} is not in the world"))
            .id;
        let at = sim
            .w
            .containers
            .iter()
            .find(|c| c.id == crate_id)
            .unwrap()
            .at;
        place(&mut sim, PlayerId(1), at);
        sim.submit(
            PlayerId(1),
            validate(RawCommand::Pickup {
                container_id: crate_id,
            })
            .expect("valid pickup"),
        )
        .unwrap();
        step_and(&mut sim, &mut events);
        let dropped = frames[next_frame].clone();
        check(&sim, &dropped, "stat-dropped");
        next_frame += 1;
        for _ in 0..2 {
            step_and(&mut sim, &mut events);
        }
        let held = frames[next_frame].clone();
        check(&sim, &held, "stat-held");
        next_frame += 1;
        let chest = sim.w.reward_chests[0].clone();
        place(&mut sim, PlayerId(1), chest.at);
        choose(&mut sim, PlayerId(1), chest.id, 0);
        step_and(&mut sim, &mut events);
        let picked = frames[next_frame].clone();
        check(&sim, &picked, "boost-picked");
        next_frame += 1;
    }
    assert_eq!(
        next_frame,
        frames.len(),
        "{scenario}: every captured frame was compared"
    );
    // The source's continuation: the same draw count and the same next values.
    let draws = case["draws"].as_u64().unwrap();
    check_draws(&sim, &rng_start, draws, &format!("{scenario} final"));
    let mut probe = sim.w.reward_rng.clone();
    for (i, want) in case["next"].as_array().unwrap().iter().enumerate() {
        assert_eq!(
            probe.next_f64(),
            want.as_f64().unwrap(),
            "{scenario} next reward draw {i}"
        );
    }
    // The chest-domain events: gv lines, heals, chest takes and refusals.
    let want_events: Vec<Vec<Value>> = case["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| normalize_source_event(&e[1]))
        .collect();
    assert_eq!(events, want_events, "{scenario} events");
}

fn place(sim: &mut Sim, id: PlayerId, at: Vec2) {
    let ix = sim.w.idx(id).unwrap();
    let now = sim.w.server_time;
    let p = &mut sim.w.players[ix];
    p.body.x = at.x;
    p.body.y = at.y;
    p.motion.path.clear();
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
}

fn choose(sim: &mut Sim, id: PlayerId, chest: u32, pick: i8) {
    let raw = RawCommand::Choose {
        chest_id: Some(chest),
        pick,
    };
    sim.submit(id, validate(raw).expect("valid choose"))
        .unwrap();
}

fn normalize_source_event(e: &Value) -> Vec<Value> {
    match e["type"].as_str().unwrap() {
        "gv" => vec![
            Value::from("gv"),
            e["id"].clone(),
            e["amount"].clone(),
            e["reason"].clone(),
        ],
        "toast" => vec![Value::from("refusal"), e["to"].clone(), e["text"].clone()],
        "fx" => {
            let fx = &e["fx"];
            match fx["kind"].as_str().unwrap() {
                "chestTaken" => vec![
                    Value::from("chestTaken"),
                    fx["chest"].clone(),
                    fx["by"].clone(),
                    fx["option"].clone(),
                ],
                "heal" => vec![Value::from("heal"), fx["id"].clone(), fx["amount"].clone()],
                other => panic!("unexpected captured chest fx {other}"),
            }
        }
        other => panic!("unexpected captured chest event {other}"),
    }
}

fn normalize_event(sim: &Sim, e: &Event) -> Option<Vec<Value>> {
    match e {
        Event::Gv { id, amount, reason } => Some(vec![
            Value::from("gv"),
            Value::from(id_name(sim, *id)),
            Value::from(*amount),
            Value::from(gv_reason(*reason)),
        ]),
        Event::ChestTaken { chest, by, pick } => Some(vec![
            Value::from("chestTaken"),
            Value::from(chest_name(*chest)),
            Value::from(id_name(sim, *by)),
            Value::from(*pick),
        ]),
        Event::ChestRefused { id, reason } => Some(vec![
            Value::from("refusal"),
            Value::from(id_name(sim, *id)),
            Value::from(reason.message().into_owned()),
        ]),
        Event::Heal { id, amount } => Some(vec![
            Value::from("heal"),
            Value::from(id_name(sim, *id)),
            Value::from(*amount),
        ]),
        _ => None,
    }
}

fn gv_reason(reason: crate::results::GvReason) -> &'static str {
    use crate::results::GvReason;
    match reason {
        GvReason::Mob => "mob",
        GvReason::Elite => "elite",
        GvReason::Skip => "skip",
        GvReason::Kill => "kill",
        GvReason::Bounty => "bounty",
        GvReason::Win => "win",
    }
}
