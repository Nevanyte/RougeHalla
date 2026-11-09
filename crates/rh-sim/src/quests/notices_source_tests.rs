//! Actual native Toast/Gv notice consumer for the sealed quest-notice source cases. This is notice parity for the
//! declared ordinary slices, not equality of the legacy 181-record transport stream.
use crate::{Event, PlayerId, RawCommand, Sim};
use serde_json::Value as V;

fn corpus() -> V {
    serde_json::from_str(include_str!("../../../../parity/quest-notices/source.json")).unwrap()
}

fn arena() -> crate::Arena {
    super::live_tests::arena()
}

fn construct(case: &V) -> Sim {
    let input = &case["input"];
    let cfg = &input["config"];
    let seed = input["seeds"]["random"].as_u64().unwrap() as u32;
    let config = crate::SimConfig {
        min_players: cfg["minPlayers"].as_u64().unwrap() as usize,
        lobby_seconds: cfg["lobbySeconds"].as_f64().unwrap(),
        fill_seconds: cfg["fillSeconds"].as_f64().unwrap(),
        quests: true,
        initial_loot: true,
        consumables: true,
        mob_mode: crate::mob_runtime::MobMode::Pve,
        faction_mode: crate::FactionMode::Off,
        abilities: crate::abilities::Mode::Full,
        hazards: crate::terrain::Mode::Map,
        lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
            plan_seconds: cfg["planSeconds"].as_f64().unwrap(),
            first_patience_seconds: None,
            coliseum_schedule: None,
            patience_seconds: cfg["patienceSeconds"].as_f64().unwrap(),
            patience_min_seconds: cfg["patienceMinSeconds"].as_f64().unwrap(),
            sudden_death_seconds: cfg["suddenDeathSeconds"].as_f64().unwrap(),
        }),
        pvp_rules: false,
        ..Default::default()
    };
    let secrets = crate::Secrets {
        order_salt: crate::rng::Mulberry32::new(seed).next_u32(),
        spawn_seed: seed,
        reward_salt: serde_json::from_value(input["seeds"]["rewardSalt"].clone()).unwrap(),
    };
    let mut sim = Sim::try_new(config, arena(), secrets).unwrap();
    for a in input["actors"].as_array().unwrap() {
        sim.add_player(
            a["name"].as_str().unwrap(),
            Some(crate::FactionId::parse(a["faction"].as_str().unwrap()).unwrap()),
            false,
        )
        .unwrap();
    }
    sim
}

fn actor(s: &Sim, id: PlayerId) -> String {
    match s.w.actor_origin(id).expect("player actor") {
        crate::mob_runtime::ActorOrigin::Player { join_ordinal } => format!("p{join_ordinal}"),
        other => panic!("unexpected non-player notice actor {other:?}"),
    }
}

fn bind(s: &Sim, label: &str) -> PlayerId {
    s.w.actor_history
        .iter()
        .find(|a| actor(s, a.id) == label)
        .map(|a| a.id)
        .expect("typed source actor binding")
}

fn place(s: &mut Sim, id: PlayerId, x: f64, y: f64) {
    let now = s.w.server_time;
    let p = s.w.players.get_mut(id).unwrap();
    p.body.x = x;
    p.body.y = y;
    p.body.facing = 0.;
    p.body.history.reset(crate::state::Sample { t: now, x, y });
}

#[derive(Clone, Debug, PartialEq)]
struct PreviewObservation {
    def: String,
    giver_x: f64,
    giver_y: f64,
    expires_at: f64,
    entitled: bool,
    foreign_visible: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct Notice {
    tick: u32,
    time: f64,
    kind: &'static str,
    to: Option<String>,
    text: String,
    gv_id: Option<String>,
    amount: u32,
    reason: Option<String>,
}

fn source_notice(e: &V) -> Option<Notice> {
    match e["type"].as_str().unwrap() {
        "toast" => Some(Notice {
            tick: e["tick"].as_u64().unwrap() as u32,
            time: e["time"].as_f64().unwrap(),
            kind: "toast",
            to: e["to"].as_str().map(str::to_owned),
            text: e["text"].as_str().unwrap().to_owned(),
            gv_id: None,
            amount: 0,
            reason: None,
        }),
        "gv" => Some(Notice {
            tick: e["tick"].as_u64().unwrap() as u32,
            time: e["time"].as_f64().unwrap(),
            kind: "gv",
            to: None,
            text: String::new(),
            gv_id: e["id"].as_str().map(str::to_owned),
            amount: e["amount"].as_u64().unwrap() as u32,
            reason: e["reason"].as_str().map(str::to_owned),
        }),
        _ => None,
    }
}

fn native_notice(s: &Sim, tick: u32, time: f64, e: &Event) -> Option<Notice> {
    match e {
        Event::Toast { to, text } => Some(Notice {
            tick,
            time,
            kind: "toast",
            to: to.map(|id| actor(s, id)),
            text: text.clone(),
            gv_id: None,
            amount: 0,
            reason: None,
        }),
        Event::Gv { id, amount, reason } => Some(Notice {
            tick,
            time,
            kind: "gv",
            to: None,
            text: String::new(),
            gv_id: Some(actor(s, *id)),
            amount: *amount,
            reason: Some(format!("{reason:?}").to_lowercase()),
        }),
        _ => None,
    }
}

fn apply_action(s: &mut Sim, a: &V) {
    match a["kind"].as_str().unwrap() {
        "place" => place(
            s,
            bind(s, a["actor"].as_str().unwrap()),
            a["x"].as_f64().unwrap(),
            a["y"].as_f64().unwrap(),
        ),
        "hp" => {
            let id = bind(s, a["actor"].as_str().unwrap());
            s.w.players.get_mut(id).unwrap().vitals.hp = a["hp"].as_f64().unwrap();
        }
        "weapon" => {
            let id = bind(s, a["actor"].as_str().unwrap());
            let p = s.w.players.get_mut(id).unwrap();
            p.weapon.weapon0 =
                Some(crate::content::WeaponId::parse(a["weapon"].as_str().unwrap()).unwrap());
            p.weapon.weapon1 = None;
            p.weapon.slot = 0;
        }
        "input" => {
            let p = &a["payload"];
            let cmd = match a["type"].as_str().unwrap() {
                "pickup" => RawCommand::Pickup {
                    container_id: u32::from_str_radix(
                        p["containerId"]
                            .as_str()
                            .unwrap()
                            .strip_prefix('c')
                            .unwrap(),
                        36,
                    )
                    .unwrap(),
                },
                "questAccept" => RawCommand::QuestAccept {
                    quest_id: Some(
                        u32::from_str_radix(
                            p["quest"].as_str().unwrap().strip_prefix("quest").unwrap(),
                            36,
                        )
                        .unwrap(),
                    ),
                },
                "attack" => RawCommand::Attack {
                    a: p["a"].as_f64().unwrap(),
                    t: None,
                },
                "release" => RawCommand::Release {
                    a: p["a"].as_f64().unwrap(),
                    t: None,
                },
                other => panic!("unconsumed source input {other}"),
            };
            s.submit(
                bind(s, a["actor"].as_str().unwrap()),
                crate::validate(cmd).unwrap(),
            )
            .expect("source input admitted");
        }
        other => panic!("unconsumed source action {other}"),
    }
}

fn capture_previews(case: &V, sim: &Sim, previews: &mut Vec<PreviewObservation>) {
    for e in case["events"].as_array().unwrap() {
        if e["type"] != "questReveal" || e["tick"].as_u64().unwrap() as u32 != sim.tick() {
            continue;
        }
        let viewer = bind(sim, e["to"].as_str().unwrap());
        let quest = &e["quest"];
        let def = quest["def"].as_str().unwrap();
        let view = crate::observe(sim, viewer, &[])
            .quests
            .expect("entitled quest view");
        let row = view
            .rows
            .iter()
            .find(|r| r.state == crate::quest_view::RowState::Preview && r.def == def)
            .unwrap_or_else(|| panic!("no native preview for {def} at tick {}", sim.tick()));
        let foreign_visible = sim.w.players.iter().any(|p| {
            p.id != viewer
                && crate::observe(sim, p.id, &[]).quests.is_some_and(|v| {
                    v.rows
                        .iter()
                        .any(|r| r.state == crate::quest_view::RowState::Preview && r.def == def)
                })
        });
        previews.push(PreviewObservation {
            def: def.to_owned(),
            giver_x: row.giver.x,
            giver_y: row.giver.y,
            expires_at: row.expires_at,
            entitled: true,
            foreign_visible,
        });
        assert_eq!(
            (row.giver.x, row.giver.y),
            (quest["x"].as_f64().unwrap(), quest["y"].as_f64().unwrap()),
            "native prepared preview giver point"
        );
        assert_eq!(
            row.expires_at,
            quest["expiresAt"].as_f64().unwrap(),
            "native prepared preview expiry"
        );
    }
}

fn run(case: &V) -> (Sim, Vec<Notice>, usize, Vec<PreviewObservation>) {
    let mut sim = construct(case);
    let mut notices = Vec::new();
    let mut previews = Vec::new();
    let mut total_events = 0usize;
    // First active step is the source's start frame (tick 1, time 50).
    let start_frame = &case["frames"][0];
    let initial_events = sim.step();
    for e in &initial_events {
        total_events += 1;
        if let Some(n) = native_notice(&sim, sim.tick(), sim.w.server_time, e) {
            notices.push(n);
        }
    }
    capture_previews(case, &sim, &mut previews);
    for p in start_frame["players"].as_array().unwrap() {
        let id = bind(&sim, p["actor"].as_str().unwrap());
        let player = sim.w.players.get_mut(id).unwrap();
        player.vitals.hp = p["hp"].as_f64().unwrap();
        player.vitals.max_hp = p["maxHp"].as_f64().unwrap();
        place(
            &mut sim,
            id,
            p["x"].as_f64().unwrap(),
            p["y"].as_f64().unwrap(),
        );
    }
    for a in case["actions"].as_array().unwrap() {
        let tick = a["tick"].as_u64().unwrap() as u32;
        while sim.tick() < tick {
            let ev = sim.step();
            for e in &ev {
                total_events += 1;
                if let Some(n) = native_notice(&sim, sim.tick(), sim.w.server_time, e) {
                    notices.push(n);
                }
            }
            capture_previews(case, &sim, &mut previews);
        }
        apply_action(&mut sim, a);
    }
    let last_tick = case["frames"].as_array().unwrap().last().unwrap()["tick"]
        .as_u64()
        .unwrap() as u32;
    while sim.tick() < last_tick {
        let ev = sim.step();
        for e in &ev {
            total_events += 1;
            if let Some(n) = native_notice(&sim, sim.tick(), sim.w.server_time, e) {
                notices.push(n);
            }
        }
        capture_previews(case, &sim, &mut previews);
    }
    (sim, notices, total_events, previews)
}

#[test]
fn selected_parcel_and_run_end_cases_match_ordered_toast_gv_notices() {
    let c = corpus();
    for idx in [0usize, 4usize] {
        let case = &c["cases"][idx];
        let name = case["input"]["name"].as_str().unwrap();
        let (sim, native, native_total, previews) = run(case);
        let source_notices: Vec<Notice> = case["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(source_notice)
            .collect();
        let source_reveals: Vec<&V> = case["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "questReveal")
            .collect();
        let source_total = case["events"].as_array().unwrap().len();
        println!(
            "{name}: source notices {} / excluded {} / events {}; native notices {} / excluded {} / events {}; previews {}",
            source_notices.len(),
            source_total - source_notices.len(),
            source_total,
            native.len(),
            native_total - native.len(),
            native_total,
            previews.len()
        );
        assert_eq!(
            native, source_notices,
            "{name}: first ordered Toast/Gv notice mismatch (native vs source)"
        );
        assert_eq!(
            previews.len(),
            source_reveals.len(),
            "{name}: entitled preview count"
        );
        for (preview, reveal) in previews.iter().zip(&source_reveals) {
            let q = &reveal["quest"];
            assert!(preview.entitled, "{name}: preview is entitled");
            assert_eq!(
                preview.def,
                q["def"].as_str().unwrap(),
                "{name}: preview definition"
            );
            assert_eq!(
                preview.giver_x,
                q["x"].as_f64().unwrap(),
                "{name}: preview giver x"
            );
            assert_eq!(
                preview.giver_y,
                q["y"].as_f64().unwrap(),
                "{name}: preview giver y"
            );
            assert_eq!(
                preview.expires_at,
                q["expiresAt"].as_f64().unwrap(),
                "{name}: preview expiry"
            );
            assert!(!preview.foreign_visible, "{name}: preview privacy");
        }
        let _ = sim;
    }
}
