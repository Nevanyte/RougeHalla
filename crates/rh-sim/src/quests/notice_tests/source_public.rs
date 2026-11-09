//! Actual fourteen-case public action emissions. Setups below are only the corpus's declared inputs.
use super::*;
use crate::{FactionMode, Secrets, SimConfig};
use serde_json::{json, Value as V};
fn source() -> V {
    serde_json::from_str(include_str!(
        "../../../../../parity/quest-public/doors.json"
    ))
    .unwrap()
}
fn construct(v: &V) -> Sim {
    let c = &v["world"]["config"];
    let seed = v["world"]["random"]["seed"].as_u64().unwrap() as u32;
    let mut s = Sim::try_new(
        SimConfig {
            min_players: c["minPlayers"].as_u64().unwrap() as usize,
            lobby_seconds: c["lobbySeconds"].as_f64().unwrap(),
            fill_seconds: c["fillSeconds"].as_f64().unwrap(),
            quests: true,
            initial_loot: true,
            consumables: true,
            regen: false,
            mob_mode: crate::mob_runtime::MobMode::Pve,
            faction_mode: FactionMode::Off,
            abilities: crate::abilities::Mode::Full,
            hazards: crate::terrain::Mode::Map,
            lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
                plan_seconds: 0.,
                first_patience_seconds: None,
                coliseum_schedule: None,
                patience_seconds: c["patienceSeconds"].as_f64().unwrap(),
                patience_min_seconds: c["patienceMinSeconds"].as_f64().unwrap(),
                sudden_death_seconds: c["suddenDeathSeconds"].as_f64().unwrap(),
            }),
            pvp_rules: false,
            ..Default::default()
        },
        super::super::live_tests::arena(),
        Secrets {
            order_salt: crate::rng::Mulberry32::new(seed).next_u32(),
            spawn_seed: seed,
            reward_salt: serde_json::from_value(v["world"]["random"]["rewardSalt"].clone())
                .unwrap(),
        },
    )
    .unwrap();
    for p in v["world"]["players"].as_array().unwrap() {
        s.add_player(
            p["name"].as_str().unwrap(),
            Some(crate::FactionId::parse(p["faction"].as_str().unwrap()).unwrap()),
            false,
        )
        .unwrap();
    }
    s.step();
    assert_eq!(s.tick(), 1);
    assert_eq!(s.phase(), crate::Phase::Active);
    assert_eq!(
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .filter(|q| q.published)
            .count(),
        10
    );
    s
}
fn pid(label: &str) -> PlayerId {
    PlayerId(label.strip_prefix('p').unwrap().parse::<u32>().unwrap() + 1)
}
fn qid(s: &Sim, label: &str) -> Option<u32> {
    let id = u32::from_str_radix(label.strip_prefix("quest")?, 36).ok()?;
    s.w.quests
        .as_ref()?
        .offers
        .iter()
        .find(|o| o.id == id)
        .map(|o| o.id)
}
fn declared(s: &mut Sim, d: &V) {
    match d["kind"].as_str().unwrap() {
        "place" => place(
            s,
            pid(d["actor"].as_str().unwrap()),
            crate::Vec2::new(d["x"].as_f64().unwrap(), d["y"].as_f64().unwrap()),
        ),
        "status" if d.get("quest").is_some() => {
            assert_eq!(d["to"], "expired");
            let id = qid(s, d["quest"].as_str().unwrap()).unwrap();
            s.w.quests
                .as_mut()
                .unwrap()
                .offers
                .iter_mut()
                .find(|o| o.id == id)
                .unwrap()
                .status = super::super::live::Status::Expired;
        }
        "status" if d["to"] == "dead" => {
            s.w.players
                .get_mut(pid(d["actor"].as_str().unwrap()))
                .unwrap()
                .status = crate::Status::Dead;
        }
        "status" => {
            assert_eq!(d["status"], "stun");
            assert!(crate::systems::status::operations::apply(
                &s.k,
                &mut s.w,
                &mut Vec::new(),
                pid(d["actor"].as_str().unwrap()),
                crate::status_runtime::StatusApply {
                    kind: crate::status_runtime::StatusKind::Stun,
                    source: crate::status_runtime::StatusSource {
                        id: None,
                        name: std::sync::Arc::from(""),
                        owner_id: None
                    },
                    ms: d["ms"].as_f64().unwrap_or(1000.),
                    ability: None,
                    tag: None,
                    value: None,
                    add: None,
                    data: None,
                },
                true
            )
            .is_some());
        }
        "phase" => {
            assert_eq!(d["to"], "ended");
            s.w.phase = crate::Phase::Ended;
        }
        "forced-wall" => {
            // The source deliberately mutates this one tile; this is not a canonical map/restore fixture.
            let m = &s.k.arena.map;
            let mut tiles = m.tiles.clone();
            tiles[d["index"].as_u64().unwrap() as usize] = d["to"].as_u64().unwrap() as u8;
            let map = m.source_collision_fixture(tiles);
            std::sync::Arc::make_mut(&mut s.k.arena).map = map;
        }
        other => panic!("unhandled declared source setup {other}"),
    }
}
fn message(s: &mut Sim, m: &V, events: &mut Vec<crate::Event>) {
    assert_eq!(m["type"], "questAccept");
    let quest_id = qid(s, m["payload"]["quest"].as_str().unwrap());
    s.submit(
        pid(m["actor"].as_str().unwrap()),
        crate::validate(crate::RawCommand::QuestAccept { quest_id }).unwrap(),
    )
    .unwrap();
    events.extend(s.step());
}
fn toasts(s: &Sim, events: &[crate::Event]) -> V {
    json!(events.iter().filter_map(|e|match e {
        crate::Event::Toast{to,text}=>Some(json!({"to":to.map(|id|match s.w.actor_origin(id).unwrap(){crate::mob_runtime::ActorOrigin::Player{join_ordinal}=>format!("p{}",join_ordinal),_=>panic!("notice recipient is not a player")}),"text":text})),
        _=>None,
    }).collect::<Vec<_>>())
}
fn preview(s: &Sim, reveals: &[V]) {
    for reveal in reveals {
        let id = pid(reveal["to"].as_str().unwrap());
        let q = &reveal["quest"];
        let view = crate::observe(s, id, &[]);
        let quests = view.quests.unwrap();
        let row = quests
            .rows
            .iter()
            .find(|r| {
                r.state == crate::quest_view::RowState::Preview
                    && r.def == q["def"].as_str().unwrap()
            })
            .unwrap();
        assert_eq!(
            row.giver,
            crate::Vec2::new(q["x"].as_f64().unwrap(), q["y"].as_f64().unwrap())
        );
        assert_eq!(row.expires_at, q["expiresAt"].as_f64().unwrap());
        assert!(!row.can_accept);
        for other in [PlayerId(1), PlayerId(2), PlayerId(3)]
            .into_iter()
            .filter(|p| *p != id)
        {
            assert!(crate::observe(s, other, &[])
                .quests
                .unwrap()
                .rows
                .iter()
                .all(|r| r.state != crate::quest_view::RowState::Preview || r.def != row.def));
        }
    }
}
#[test]
fn notices_match_all_fourteen_actual_public_source_action_cases() {
    let corpus = source();
    let cases = corpus["actions"]["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 14);
    for c in cases {
        let mut s = construct(&corpus);
        let mut events = Vec::new();
        let a = &c["actual"];
        let ds = c["declared"].as_array().unwrap();
        if c["id"] == "order-range-before-already" {
            declared(&mut s, &ds[0]);
            message(&mut s, &a["message"], &mut events);
            declared(&mut s, &ds[1]);
            message(&mut s, &a["message"], &mut events);
        } else {
            for d in ds {
                declared(&mut s, d);
            }
            if c["id"] == "hidden-reveal-publish" {
                events.extend(s.step());
                preview(&s, a["reveals"].as_array().unwrap());
                for _ in 0..80 {
                    events.extend(s.step());
                }
            } else if c["id"] == "repeat-already" {
                message(&mut s, &a["first"], &mut events);
                message(&mut s, &a["second"], &mut events);
            } else {
                message(&mut s, &a["message"], &mut events);
                preview(&s, a["reveals"].as_array().unwrap());
            }
        }
        // The native terminal phase deliberately drains intake; root holds that separate
        // source queueAfter=1 discrepancy. Its exact silent notice stream is still compared.
        if let Some(n) = a["queueAfter"]
            .as_u64()
            .filter(|_| c["id"] != "phase-ended-not-drained")
        {
            assert_eq!(
                s.w.players[0].inputs.actions.as_slice().len(),
                n as usize,
                "source intake drain {}",
                c["id"]
            );
        }
        if let Some(accepted) = a["accepted"].as_bool() {
            let msg = if a.get("message").is_some() {
                &a["message"]
            } else {
                &a["first"]
            };
            let id = qid(&s, msg["payload"]["quest"].as_str().unwrap()).unwrap();
            assert_eq!(
                s.w.quests
                    .as_ref()
                    .unwrap()
                    .offers
                    .iter()
                    .find(|o| o.id == id)
                    .unwrap()
                    .accepted
                    .contains(&PlayerId(1)),
                accepted,
                "source acceptance {}",
                c["id"]
            );
        }
        assert_eq!(
            toasts(&s, &events),
            a["toasts"],
            "actual source action {}",
            c["id"]
        );
    }
}
