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

fn source_quest_id(label: &str) -> u32 {
    u32::from_str_radix(
        label
            .strip_prefix("quest")
            .unwrap_or_else(|| panic!("quest id without prefix: {label}")),
        36,
    )
    .unwrap_or_else(|_| panic!("invalid quest id {label}"))
}

fn source_container_id(label: &str) -> u32 {
    u32::from_str_radix(
        label
            .strip_prefix('c')
            .unwrap_or_else(|| panic!("container id without prefix: {label}")),
        36,
    )
    .unwrap_or_else(|_| panic!("invalid container id {label}"))
}

fn offer_index(s: &Sim, quest: &str) -> usize {
    let id = source_quest_id(quest);
    s.w.quests
        .as_ref()
        .and_then(|q| q.offers.iter().position(|o| o.id == id))
        .unwrap_or_else(|| panic!("typed source offer {quest} does not resolve"))
}

fn container_has_quest(s: &Sim, container: u32, quest: u32) -> bool {
    s.w.containers.iter().any(|c| {
        c.id == container
            && c.items.first().map(|i| i.def) == Some(crate::initial_world::ItemDef::Quest(quest))
    })
}

fn record_produced(s: &Sim, events: &[Event], notices: &mut Vec<Notice>, total: &mut usize) {
    let tick = s.tick();
    let time = s.w.server_time;
    for event in events {
        *total += 1;
        if let Some(notice) = native_notice(s, tick, time, event) {
            notices.push(notice);
        }
    }
}

fn published_open(s: &Sim) -> usize {
    s.w.quests.as_ref().map_or(0, |q| {
        q.offers
            .iter()
            .filter(|o| o.published && o.status == crate::quests::live::Status::Open)
            .count()
    })
}

fn apply_action(s: &mut Sim, a: &V, notices: &mut Vec<Notice>, total: &mut usize) {
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
                "pickup" => {
                    let container_id = source_container_id(p["containerId"].as_str().unwrap());
                    assert!(
                        s.w.containers.iter().any(|c| c.id == container_id),
                        "declared pickup source box must actually exist"
                    );
                    RawCommand::Pickup { container_id }
                }
                "questAccept" => {
                    let quest_id = source_quest_id(p["quest"].as_str().unwrap());
                    offer_index(s, p["quest"].as_str().unwrap());
                    RawCommand::QuestAccept {
                        quest_id: Some(quest_id),
                    }
                }
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
        "noncanonicalSetup" => {
            let setup = a["setup"]
                .as_str()
                .unwrap_or_else(|| panic!("missing setup kind"));
            let quest = a["quest"].as_str().unwrap();
            let box_id = source_container_id(a["box"].as_str().unwrap());
            let quest_id = source_quest_id(quest);
            assert!(
                container_has_quest(s, box_id, quest_id),
                "case1 guard state must retain the real produced box/item"
            );
            let oi = offer_index(s, quest);
            match setup {
                "staleClosedStatus" => {
                    let status = a["status"].as_str().unwrap();
                    assert_eq!(status, "expired", "only declared stale-closed status");
                    s.w.quests.as_mut().unwrap().offers[oi].status =
                        crate::quests::live::Status::Expired;
                }
                "restoreOpenForSibling" => {
                    let status = a["status"].as_str().unwrap();
                    assert_eq!(status, "open", "only declared sibling restore");
                    s.w.quests.as_mut().unwrap().offers[oi].status =
                        crate::quests::live::Status::Open;
                }
                "staleCarrier" => {
                    let carrier = bind(s, a["carrier"].as_str().unwrap());
                    s.w.quests.as_mut().unwrap().offers[oi].carrier = Some(carrier);
                }
                other => panic!("unexpected noncanonical setup {other}"),
            }
            assert!(
                container_has_quest(s, box_id, quest_id),
                "case1 setup must leave box/item retained"
            );
        }
        "expireSoon" => {
            let quest = a["quest"].as_str().unwrap();
            let ms = a["ms"].as_f64().unwrap();
            let oi = offer_index(s, quest);
            let expires = s.w.server_time + ms;
            s.w.quests.as_mut().unwrap().offers[oi].expires_at = expires;
        }
        "inlineProducer" => match a["producer"].as_str().unwrap() {
            "teleportToColiseum" => {
                assert_eq!(
                    published_open(s),
                    10,
                    "case3 ten published Open before teleport"
                );
                let mut produced = Vec::new();
                let mut fx = crate::fx_report::TickFx::default();
                crate::systems::coliseum::teleport(
                    &s.k,
                    &mut s.w,
                    &mut produced,
                    &mut fx,
                    crate::status_runtime::stats::Inputs::default(),
                );
                let expired_at = produced.iter().position(
                    |e| matches!(e, Event::Toast { text, .. } if text == "10 quests expired"),
                );
                let teleported_at = produced.iter().position(|e| matches!(e, Event::Teleported));
                assert!(
                    expired_at.is_some() && teleported_at.is_some() && expired_at < teleported_at,
                    "case3 aggregate expired toast must precede real Teleported event"
                );
                assert_eq!(published_open(s), 0, "case3 all published offers expire");
                assert_eq!(
                    s.w.quests
                        .as_ref()
                        .unwrap()
                        .offers
                        .iter()
                        .filter(|o| !o.published)
                        .count(),
                    0,
                    "case3 hidden offers must be removed silently"
                );
                record_produced(s, &produced, notices, total);
            }
            "killMob" => {
                let region = crate::FactionId::parse(a["region"].as_str().unwrap()).unwrap();
                let expected = a["mobs"].as_u64().unwrap() as usize;
                let ids: Vec<PlayerId> =
                    s.w.mobs
                        .iter()
                        .filter(|m| m.status == crate::state::Status::Alive)
                        .filter(|m| {
                            m.mob_type
                                .and_then(|ty| crate::mob_catalog::mob_type_by_id(ty.as_str()))
                                .is_some_and(|def| def.zone == region)
                        })
                        .map(|m| m.core.id)
                        .collect();
                assert_eq!(
                    ids.len(),
                    expected,
                    "case5 exact living region supply before wipe"
                );
                let mut produced = Vec::new();
                for id in ids {
                    let ix = s.w.fighter_idx(id).expect("regional mob fighter");
                    let hp = s.w.core(ix).vitals.hp;
                    let hit = crate::systems::ledger::Hit {
                        terrain: false,
                        amount: hp,
                        by: None,
                        name: None,
                    };
                    let removed =
                        crate::systems::mob_life::hurt(&s.k, &mut s.w, &mut produced, ix, &[hit]);
                    assert!(removed > 0., "case5 real kill producer removes target");
                    crate::systems::ledger::pay_all(&s.k, &mut s.w, &mut produced, &mut s.pf);
                }
                assert_eq!(
                    s.w.mobs
                        .iter()
                        .filter(|m| m.status == crate::state::Status::Alive)
                        .filter(|m| {
                            m.mob_type
                                .and_then(|ty| crate::mob_catalog::mob_type_by_id(ty.as_str()))
                                .is_some_and(|def| def.zone == region)
                        })
                        .count(),
                    0,
                    "case5 selected region supply exhausted"
                );
                assert!(!s.w.pay.collecting);
                record_produced(s, &produced, notices, total);
            }
            other => panic!("unconsumed inline producer {other}"),
        },
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
        // Bind to the first frozen public boundary at or after the reveal/capture tick. This is the
        // same-tick frame where one exists; case2's tick3 reveal uses its next captured tick5 boundary.
        // A later publication (case5 cull-fire/cull-frost) is not a violation at the reveal boundary.
        let source_frame = case["frames"]
            .as_array()
            .unwrap()
            .iter()
            .find(|frame| frame["tick"].as_u64().unwrap() as u32 >= sim.tick())
            .unwrap_or_else(|| panic!("no source boundary at/after reveal tick {}", sim.tick()));
        assert!(
            !source_frame["quests"]
                .as_array()
                .unwrap()
                .iter()
                .any(|q| q["def"] == def),
            "source public boundary {} unexpectedly publishes {def}",
            source_frame["label"]
        );
        // Privacy is absence of the row regardless of RowState (an erroneous Open row must fail too).
        let foreign_visible = sim.w.players.iter().any(|p| {
            p.id != viewer
                && crate::observe(sim, p.id, &[])
                    .quests
                    .is_some_and(|v| v.rows.iter().any(|r| r.def == def))
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

struct RunOutcome {
    sim: Sim,
    notices: Vec<Notice>,
    total_events: usize,
    previews: Vec<PreviewObservation>,
}

fn run(case: &V) -> RunOutcome {
    let name = case["input"]["name"].as_str().unwrap();
    let mut sim = construct(case);
    let mut notices = Vec::new();
    let mut previews = Vec::new();
    let mut total_events = 0usize;
    let initial_events = sim.step();
    record_produced(&sim, &initial_events, &mut notices, &mut total_events);
    capture_previews(case, &sim, &mut previews);
    let start_frame = &case["frames"][0];
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
    let frames = case["frames"].as_array().unwrap();
    let mut applied = 0usize;
    for a in case["actions"].as_array().unwrap() {
        let tick = a["tick"].as_u64().unwrap() as u32;
        while sim.tick() < tick {
            let ev = sim.step();
            record_produced(&sim, &ev, &mut notices, &mut total_events);
            capture_previews(case, &sim, &mut previews);
        }
        apply_action(&mut sim, a, &mut notices, &mut total_events);
        applied += 1;
        if name == "pickup-closed-guard" {
            let box_id = source_container_id("c7n");
            let quest_id = source_quest_id("quest7l");
            assert!(
                container_has_quest(&sim, box_id, quest_id),
                "case1 box/item retained after action {applied}"
            );
        }
        if name == "expiry-cohort-order" && applied == 9 {
            let oi = offer_index(&sim, "quest75");
            let offer = &sim.w.quests.as_ref().unwrap().offers[oi];
            assert!(offer.accepted.contains(&bind(&sim, "p0")));
            assert_eq!(
                offer
                    .progress
                    .iter()
                    .find(|(id, _)| *id == bind(&sim, "p0"))
                    .map_or(0, |(_, n)| *n),
                3,
                "case2 three real token pickups before expiry order setup"
            );
        }
    }
    let last_tick = frames.last().unwrap()["tick"].as_u64().unwrap() as u32;
    while sim.tick() < last_tick {
        let ev = sim.step();
        record_produced(&sim, &ev, &mut notices, &mut total_events);
        capture_previews(case, &sim, &mut previews);
    }
    RunOutcome {
        sim,
        notices,
        total_events,
        previews,
    }
}

fn compare_case(index: usize) {
    let c = corpus();
    let case = &c["cases"][index];
    let name = case["input"]["name"].as_str().unwrap();
    let outcome = run(case);
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
        outcome.notices.len(),
        outcome.total_events - outcome.notices.len(),
        outcome.total_events,
        outcome.previews.len()
    );
    assert_eq!(
        outcome.notices, source_notices,
        "{name}: first ordered Toast/Gv notice mismatch"
    );
    assert_eq!(
        outcome.previews.len(),
        source_reveals.len(),
        "{name}: entitled preview count"
    );
    for (preview, reveal) in outcome.previews.iter().zip(&source_reveals) {
        let q = &reveal["quest"];
        assert!(preview.entitled, "{name}: preview entitled");
        assert_eq!(
            preview.def,
            q["def"].as_str().unwrap(),
            "{name}: preview def"
        );
        assert_eq!(
            preview.giver_x,
            q["x"].as_f64().unwrap(),
            "{name}: preview x"
        );
        assert_eq!(
            preview.giver_y,
            q["y"].as_f64().unwrap(),
            "{name}: preview y"
        );
        assert_eq!(
            preview.expires_at,
            q["expiresAt"].as_f64().unwrap(),
            "{name}: preview expiry"
        );
        assert!(!preview.foreign_visible, "{name}: foreign preview absence");
    }
    if name == "teleport-close-notices" {
        assert_eq!(outcome.sim.w.quests.as_ref().unwrap().offers.len(), 10);
        assert!(outcome
            .sim
            .w
            .quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .all(|o| o.status != crate::quests::live::Status::Open));
        assert!(outcome.sim.w.rt.gates_locked);
        let teleported = outcome
            .notices
            .iter()
            .any(|n| n.text == "10 quests expired");
        assert!(teleported, "case3 aggregate expiry toast retained");
    }
    if name == "pickup-closed-guard" {
        assert!(container_has_quest(
            &outcome.sim,
            source_container_id("c7n"),
            source_quest_id("quest7l")
        ));
    }
}

#[test]
fn case1_pickup_closed_guard_real_box_guards() {
    compare_case(1);
}

#[test]
fn case2_expiry_cohort_order_real_collect_turn_in() {
    compare_case(2);
}

#[test]
fn case3_teleport_close_notices_real_producer_queue() {
    compare_case(3);
}

#[test]
fn case5_camp_publication_closure_real_region_kills() {
    compare_case(5);
}

#[test]
fn continuation_intake_controls_reject_unknown_action_and_wrong_binding() {
    let c = corpus();
    let case = &c["cases"][1];
    let mut sim = construct(case);
    let mut notices = Vec::new();
    let mut total = 0usize;
    let unknown = serde_json::json!({"kind":"unknownAction"});
    let rejected = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        apply_action(&mut sim, &unknown, &mut notices, &mut total);
    }));
    assert!(rejected.is_err(), "unknown source action must be rejected");
    let wrong = serde_json::json!({"kind":"input","actor":"p0","type":"questAccept","payload":{"quest":"questZZ"}});
    let rejected = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut local = construct(case);
        let mut local_notices = Vec::new();
        let mut local_total = 0usize;
        apply_action(&mut local, &wrong, &mut local_notices, &mut local_total);
    }));
    assert!(
        rejected.is_err(),
        "wrong typed offer binding must be rejected"
    );
    let source = case["events"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(source_notice)
        .expect("source notice");
    let mut wrong_recipient = source.clone();
    wrong_recipient.to = Some("p2".into());
    assert_ne!(wrong_recipient, source, "recipient comparator must matter");
}
