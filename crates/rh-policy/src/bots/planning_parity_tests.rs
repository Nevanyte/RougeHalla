//! The planning module against the actual-source corpus parity/policy/bot-planning.json, captured from the unmodified
//! legacy brain in the pinned linux/amd64 Node 22.23.4 container (tools/bots-planning-fixtures/). The corpus is immutable
//! source output: this test replays every declared screen frame and every shared-planning helper value through the Rust
//! module and requires the same answers, pins the module's timing/constant tables to the source, and kills mutants of the
//! expected outputs. It also drives the seat's own planning wiring through PublicCommand::Plan.
use crate::bots::bot::HumanBot;
use crate::bots::planning::*;
use crate::bots::random::Rng;
use crate::bots::types::{PersonaId, TierId};
use crate::{MatchStart, Policy};
use rh_sim::mapdata::Zone;
use rh_sim::{
    Arena, FactionId, Phase, PlayerId, PublicCommand, SimConfig, TileMap, Vec2, WeaponId,
};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../parity/policy/bot-planning.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the captured planning corpus parses")
}
fn text(v: &Value) -> &str {
    v.as_str().expect("a string")
}
fn num(v: &Value) -> f64 {
    v.as_f64().expect("a number")
}
fn r6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}
fn close(a: f64, b: f64) -> bool {
    r6(a) == b || (a - b).abs() <= 1e-6 * b.abs().max(1.)
}
fn zone(name: &str) -> Zone {
    match name {
        "fire" => Zone::Fire,
        "sentenced" => Zone::Sentenced,
        "plague" => Zone::Plague,
        "frost" => Zone::Frost,
        "holy" => Zone::Holy,
        other => panic!("unknown zone {other}"),
    }
}
fn faction(name: &str) -> FactionId {
    match name {
        "fire" => FactionId::Fire,
        "sentenced" => FactionId::Sentenced,
        "plague" => FactionId::Plague,
        "frost" => FactionId::Frost,
        "holy" => FactionId::Holy,
        other => panic!("unknown faction {other}"),
    }
}
fn weapon(name: &Value) -> Option<WeaponId> {
    let name = name.as_str()?;
    Some(match name {
        "sword" => WeaponId::Sword,
        "bow" => WeaponId::Bow,
        "wand" => WeaponId::Wand,
        "axe" => WeaponId::Axe,
        "shield" => WeaponId::Shield,
        other => panic!("unknown weapon {other}"),
    })
}
fn tier(name: &str) -> TierId {
    match name {
        "easy" => TierId::Easy,
        "normal" => TierId::Normal,
        "hard" => TierId::Hard,
        other => panic!("unknown tier {other}"),
    }
}
fn plan_map(f: &Value, name: &str) -> PlanMap {
    let map = &f["profile"]["maps"]["maps"][name];
    PlanMap {
        camps: map["camps"]
            .as_array()
            .expect("camps")
            .iter()
            .map(|c| PlanCamp {
                id: text(&c["id"]).to_string(),
                zone: zone(text(&c["zone"])),
                x: num(&c["x"]),
                y: num(&c["y"]),
                elite_spot: c["eliteSpot"].as_i64().expect("eliteSpot") as i32,
            })
            .collect(),
        spawn_pool: map["spawnPool"]
            .as_array()
            .expect("spawnPool")
            .iter()
            .map(|s| PlanSpawn {
                x: num(&s["x"]),
                y: num(&s["y"]),
                zone: zone(text(&s["zone"])),
            })
            .collect(),
    }
}
fn deal(v: &Value) -> PlanDeal {
    PlanDeal {
        ends_at: num(&v["endsAt"]),
        spawns: [
            v["spawns"][0].as_i64().expect("spawn") as i32,
            v["spawns"][1].as_i64().expect("spawn") as i32,
        ],
        taken: [
            v["taken"][0].as_bool().expect("taken"),
            v["taken"][1].as_bool().expect("taken"),
        ],
        pick: v["pick"].as_i64().expect("pick") as i8,
        boons: v["boons"]
            .as_array()
            .map(|a| a.iter().map(|b| text(b).to_string()).collect())
            .unwrap_or_default(),
        boon: v["boon"].as_i64().expect("boon") as i8,
    }
}
fn learned(case: &Value) -> PlanLearned {
    match case["learned"].as_object() {
        None => PlanLearned::default(),
        Some(bias) => PlanLearned {
            enabled: true,
            bias: bias
                .iter()
                .map(|(k, v)| (k.clone(), v.as_f64().expect("a bias")))
                .collect(),
        },
    }
}

/// Check every captured helper value (the shared planning maths) against the port, returning the first difference.
fn check_helpers(f: &Value) -> Result<(), String> {
    let maps = ["pve", "spread"];
    for row in f["helpers"]["matchup"].as_array().expect("matchup") {
        let got = matchup_share(
            faction(text(&row["me"])),
            faction(text(&row["region"])),
            row["elite"].as_bool().expect("elite"),
        );
        if !close(got, num(&row["share"])) {
            return Err(format!("matchupShare {row}: native {got}"));
        }
    }
    for row in f["helpers"]["campMatchup"].as_array().expect("campMatchup") {
        let map = plan_map(f, text(&row["map"]));
        let camp = map
            .camps
            .iter()
            .find(|c| c.id == text(&row["camp"]))
            .expect("camp");
        let got = camp_matchup(faction(text(&row["me"])), camp);
        if !close(got, num(&row["share"])) {
            return Err(format!("campMatchup {row}: native {got}"));
        }
    }
    for row in f["helpers"]["nearestCamps"]
        .as_array()
        .expect("nearestCamps")
    {
        let map = plan_map(f, text(&row["map"]));
        let at = (num(&row["at"]["x"]), num(&row["at"]["y"]));
        let got: Vec<String> = nearest_camps(&map, at, PLAN_CAMPS)
            .into_iter()
            .map(|c| c.id.clone())
            .collect();
        let want: Vec<String> = row["ids"]
            .as_array()
            .expect("ids")
            .iter()
            .map(|v| text(v).to_string())
            .collect();
        if got != want {
            return Err(format!("nearestCamps {row}: native {got:?}"));
        }
    }
    for row in f["helpers"]["spawnScore"].as_array().expect("spawnScore") {
        let map = plan_map(f, text(&row["map"]));
        let index = row["pool"].as_i64().expect("pool") as i32;
        let got = plan_spawn_score(
            &map,
            index,
            faction(text(&row["me"])),
            weapon(&row["weapon"]),
        );
        let want = num(&row["score"]);
        if !(want.is_infinite() && want < 0.) && !close(got, want) {
            return Err(format!("planSpawnScore {row}: native {got}"));
        }
    }
    for row in f["helpers"]["planPick"].as_array().expect("planPick") {
        let map = plan_map(f, text(&row["map"]));
        let mut spawns = [0i32; 2];
        let mut taken = [false; 2];
        for k in 0..2 {
            spawns[k] = row["spawns"][k].as_i64().expect("spawn") as i32;
            taken[k] = row["taken"][k].as_bool().expect("taken");
        }
        let got = plan_pick(
            &map,
            spawns,
            taken,
            faction(text(&row["me"])),
            weapon(&row["weapon"]),
        );
        let want = row["pick"].as_i64().expect("pick") as i8;
        if got != want {
            return Err(format!("planPick {row}: native {got}"));
        }
    }
    for name in maps {
        let _ = plan_map(f, name);
    }
    Ok(())
}

/// Check the captured module cases: every declared screen frame through the ported state machine, RNG streams included.
fn check_cases(f: &Value) -> Result<(), String> {
    for case in f["cases"].as_array().expect("cases") {
        let name = text(&case["name"]).to_string();
        let tier = tier(text(&case["tier"]));
        let map = plan_map(f, text(&case["map"]));
        let learned = learned(case);
        let mut module = PlanModule::new();
        let mut decide = Rng::new(case["decideSeed"].as_u64().expect("decideSeed") as u32);
        let mut lapse = Rng::new(case["lapseSeed"].as_u64().expect("lapseSeed") as u32);
        for (i, frame) in case["frames"]
            .as_array()
            .expect("frames")
            .iter()
            .enumerate()
        {
            let now = num(&frame["now"]);
            let d = if frame["deal"].is_null() {
                None
            } else {
                Some(deal(&frame["deal"]))
            };
            let faction = frame["faction"].as_str().map(faction);
            let weapon = weapon(&frame["weapon"]);
            module.observe(now, d.as_ref(), tier, &mut decide);
            let got = module.intents(
                now,
                frame["phase"].as_str() == Some("planning"),
                tier,
                &map,
                faction,
                weapon,
                &learned,
                &mut decide,
                &mut lapse,
            );
            let want = &frame["result"];
            if want.is_null() {
                if got.is_some() {
                    return Err(format!("{name} frame {i}: unexpected intent {got:?}"));
                }
            } else {
                let Some(got) = got else {
                    return Err(format!("{name} frame {i}: missing intent"));
                };
                let spawn_ok = want["spawn"].is_null() && got.spawn.is_none()
                    || want["spawn"].as_u64() == got.spawn.map(u64::from);
                let boon_ok = want["boon"].is_null() && got.boon.is_none()
                    || want["boon"].as_u64() == got.boon.map(u64::from);
                let ready_ok = want["ready"].is_null() && got.ready.is_none()
                    || want["ready"].as_bool() == got.ready;
                if !(spawn_ok && boon_ok && ready_ok && got.why == text(&want["why"])) {
                    return Err(format!("{name} frame {i}: native {got:?} source {want}"));
                }
            }
            let probe = &frame["probe"];
            let got_decide = decide.next_f64();
            let got_lapse = lapse.next_f64();
            if got_decide != num(&probe["decide"]) || got_lapse != num(&probe["lapse"]) {
                return Err(format!("{name} frame {i}: rng stream drift"));
            }
        }
    }
    Ok(())
}

#[test]
fn captured_planning_helpers_reproduce() {
    let f = fixture();
    check_helpers(&f).expect("the shared planning maths matches the source capture");
}

#[test]
fn captured_planning_cases_reproduce() {
    let f = fixture();
    check_cases(&f).expect("the planning module matches the source capture");
}

#[test]
fn captured_planning_constants_pin_the_source_tables() {
    let f = fixture();
    let c = &f["profile"]["constants"];
    assert!(close(PLAN_SECONDS_MS, num(&c["planSecondsMs"])));
    assert_eq!(PLAN_CAMPS, c["planCamps"].as_u64().unwrap() as usize);
    let rules = &c["rules"];
    assert!(close(PLAN_RULES.read_share, num(&rules["readShare"])));
    assert!(close(
        PLAN_RULES.ready_before_ms,
        num(&rules["readyBeforeMs"])
    ));
    assert!(close(
        PLAN_RULES.ready_before_share,
        num(&rules["readyBeforeShare"])
    ));
    assert!(close(PLAN_RULES.no_deal_ms, num(&rules["noDealMs"])));
    assert!(close(PLAN_RULES.resend_ms, num(&rules["resendMs"])));
    assert_eq!(
        PLAN_RULES.max_asks,
        rules["maxAsks"].as_u64().unwrap() as u32
    );
    for (i, key) in ["easy", "normal", "hard"].iter().enumerate() {
        let source = &c["tiers"][key];
        let tier = tier(key);
        let params = crate::bots::types::TierParams::by_id(tier);
        assert!(
            close(params.softmax_t, num(&source["softmaxT"])),
            "{key} softmax"
        );
        assert!(close(params.lapse_p, num(&source["lapseP"])), "{key} lapse");
        assert!(
            close(params.reaction.mu, num(&source["reactionMu"])),
            "{key} reaction"
        );
        let read = &rules["read"][key];
        assert!(close(PLAN_RULES.read[i].0, num(&read[0])));
        assert!(close(PLAN_RULES.read[i].1, num(&read[1])));
        let settle = &rules["settle"][key];
        assert!(close(PLAN_RULES.settle[i].0, num(&settle[0])));
        assert!(close(PLAN_RULES.settle[i].1, num(&settle[1])));
    }
}

#[test]
fn mutants_of_the_planning_corpus_cannot_false_match() {
    let f = fixture();
    // A flipped Ready on the no-deal case.
    let mut bad = f.clone();
    bad["cases"][0]["frames"][3]["result"]["ready"] = Value::from(false);
    assert!(check_cases(&bad).is_err(), "a flipped ready must fail");
    // A nudged matchup value.
    let mut bad = f.clone();
    let share = bad["helpers"]["matchup"][0]["share"].as_f64().unwrap();
    bad["helpers"]["matchup"][0]["share"] = Value::from(share + 0.01);
    assert!(check_helpers(&bad).is_err(), "a nudged matchup must fail");
    // A wrong chosen spawn.
    let mut bad = f.clone();
    bad["cases"][2]["frames"][2]["result"]["spawn"] = Value::from(0);
    assert!(check_cases(&bad).is_err(), "a wrong spawn must fail");
    // A drifted RNG probe.
    let mut bad = f.clone();
    let probe = bad["cases"][1]["frames"][0]["probe"]["decide"]
        .as_f64()
        .unwrap();
    bad["cases"][1]["frames"][0]["probe"]["decide"] = Value::from(probe + 1e-12);
    assert!(check_cases(&bad).is_err(), "a drifted stream must fail");
}

fn planning_arena() -> Arena {
    let rows = (0..24)
        .map(|y| {
            (0..32)
                .map(|x| {
                    if x == 0 || y == 0 || x == 31 || y == 23 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>();
    Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: (0..8)
            .map(|i| Vec2::new(200. + f64::from(i) * 60., 320.))
            .collect(),
    }
}

fn planning_view(now: f64, pick: i8) -> rh_sim::PlanningView {
    rh_sim::PlanningView {
        plan: rh_sim::PlanView {
            ends_at: now + 45000.,
            spawns: [0, 1],
            taken: [false, false],
            pick,
            boons: Vec::new(),
            boon: -1,
        },
        options: [None, None],
        ready: false,
    }
}

fn planning_me(faction: FactionId) -> rh_sim::observe::SelfView {
    rh_sim::observe::SelfView {
        archetype: Default::default(),
        wish: None,
        effects: 0,
        displace_seq: 0,
        mark_tier: 0,
        brand: 0,
        mark_by: None,
        mark_tax: 0,
        sig: 0,
        attack_target: None,
        hunt_target: None,
        hunt_stacks: 0,
        corpse_stacks: 0,
        plague_zombie: None,
        id: PlayerId(1),
        faction,
        x: 200.,
        y: 320.,
        facing: 0.,
        hp: 900.,
        max_hp: 900.,
        barrier: 0.,
        barrier_ring_step: 0,
        status: rh_sim::Status::Alive,
        weapon: WeaponId::Fists,
        ready_in_ms: 0.,
        kills: 0,
        bounty: 0,
        gv: 0,
        move_seq: 0,
        facts: Default::default(),
    }
}

fn seat() -> HumanBot {
    let arena = std::sync::Arc::new(planning_arena());
    let mut bot = HumanBot::new(TierId::Normal, PersonaId::Farmer);
    bot.reset(&MatchStart {
        me: PlayerId(1),
        seed: 7,
        arena,
        content_hash: 0,
        observation_version: rh_sim::OBSERVATION_VERSION,
        tick_ms: 50.,
        frost_wish: rh_sim::FrostWish::Freeze,
    });
    bot
}

fn observation(now: f64, plan: Option<rh_sim::PlanningView>) -> rh_sim::Observation {
    rh_sim::Observation {
        phase: Phase::Planning,
        server_time: now,
        plan,
        me: Some(planning_me(FactionId::Holy)),
        ..Default::default()
    }
}

#[test]
fn a_seat_presses_ready_without_a_deal() {
    let mut bot = seat();
    let mut ready = None;
    for step in 0..=30 {
        let now = f64::from(step) * 100.;
        for command in bot.component_commands(&observation(now, None)) {
            if let PublicCommand::Plan {
                ready: Some(true), ..
            } = command
            {
                ready = Some(now);
            }
        }
    }
    assert_eq!(ready, Some(1000.), "the source noDealMs boundary");
}

#[test]
fn a_seat_answers_a_deal_then_presses_ready() {
    let mut bot = seat();
    let mut asked_spawn = None;
    let mut ready = None;
    let mut pick = -1i8;
    for step in 0..=140 {
        let now = f64::from(step) * 100.;
        for command in bot.component_commands(&observation(now, Some(planning_view(now, pick)))) {
            if let PublicCommand::Plan {
                spawn: Some(k),
                boon,
                ready: r,
            } = command
            {
                asked_spawn = Some(k);
                if let Some(k) = asked_spawn {
                    pick = k as i8;
                }
                assert!(boon.is_none() && r.is_none());
            }
            if let PublicCommand::Plan {
                ready: Some(true), ..
            } = command
            {
                ready = Some(now);
            }
        }
    }
    assert!(asked_spawn.is_some(), "the seat asked for a spawn");
    assert!(ready.is_some(), "the seat pressed Ready after its choice");
    let _ = SimConfig::default();
}
