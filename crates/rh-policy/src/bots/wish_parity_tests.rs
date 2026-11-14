//! The Wish module and cast policy against the actual-source corpus parity/policy/bot-wish.json, captured from the unmodified
//! legacy policy in the pinned linux/amd64 Node 22.23.4 container (tools/wish-fixtures/). The corpus is immutable source
//! output: this test replays every declared situation through the Rust policy and requires the same decision, and it pins the
//! static Wish rows, the hidesCaster answers, the module's rule table and the policy constants. It also cross-checks the policy
//! rows against the sim's own public ability definitions, so the bot's table cannot drift from the mechanics it plays.
use crate::bots::wish::*;
use rh_sim::abilities::{blink, Effect, Side, Target};
use rh_sim::status_runtime::{AbilityId, StatusKind};
use rh_sim::TileMap;
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../parity/policy/bot-wish.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the captured wish corpus parses")
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
    r6(a) == r6(b)
}
fn ability(v: &Value) -> AbilityId {
    match text(v) {
        "freeze" => AbilityId::Freeze,
        "swarm" => AbilityId::Swarm,
        "trial" => AbilityId::Trial,
        "blaze" => AbilityId::Blaze,
        "lastStand" => AbilityId::LastStand,
        other => panic!("unknown ability {other}"),
    }
}
fn intent(v: &Value) -> AiIntent {
    match text(v) {
        "escape" => AiIntent::Escape,
        "sustain" => AiIntent::Sustain,
        "engage" => AiIntent::Engage,
        "control" => AiIntent::Control,
        "peel" => AiIntent::Peel,
        "burst" => AiIntent::Burst,
        "zone" => AiIntent::Zone,
        "buff" => AiIntent::Buff,
        other => panic!("unknown intent {other}"),
    }
}
fn blocked(v: &Value) -> BlockedBy {
    match text(v) {
        "stun" => BlockedBy::Stun,
        "silence" => BlockedBy::Silence,
        "root" => BlockedBy::Root,
        other => panic!("unknown blockedBy {other}"),
    }
}
fn targeting(v: &Value) -> TargetRule {
    match text(&v["kind"]) {
        "self" => TargetRule::Self_,
        "unit" => TargetRule::Unit {
            range: num(&v["range"]),
            los: v["los"].as_bool().unwrap_or(false),
            snap_radius: num(&v["snapRadius"]),
        },
        "point" => TargetRule::Point {
            range: num(&v["range"]),
            min_range: num(&v["minRange"]),
        },
        other => panic!("unknown target rule {other}"),
    }
}

#[test]
fn the_wish_static_rows_match_the_source() {
    let f = fixture();
    assert_eq!(text(&f["format"]), "rh-wish-source/1");
    assert_eq!(text(&f["profile"]["node"]), "v22.23.4");
    assert_eq!(text(&f["profile"]["platform"]), "linux");
    assert_eq!(text(&f["profile"]["arch"]), "x64");
    let defs = f["defs"].as_array().expect("defs");
    assert_eq!(defs.len(), 5, "the five Wish rows");
    for row in defs {
        let id = ability(&row["id"]);
        let def = wish_by_id(id).expect("the policy has every Wish");
        assert_eq!(def.name, text(&row["name"]), "{} name", def.name);
        let ai: Vec<AiIntent> = row["ai"]
            .as_array()
            .expect("ai")
            .iter()
            .map(intent)
            .collect();
        assert_eq!(def.ai, ai.as_slice(), "{} intent order", def.name);
        let blocked_by: Vec<BlockedBy> = row["blockedBy"]
            .as_array()
            .expect("blockedBy")
            .iter()
            .map(blocked)
            .collect();
        assert_eq!(
            def.blocked_by,
            blocked_by.as_slice(),
            "{} blockedBy",
            def.name
        );
        assert_eq!(def.drops_lock, row["dropsLock"].as_bool().unwrap());
        assert_eq!(
            r6(def.rank.cast_ms),
            r6(num(&row["castMs"])),
            "{} castMs",
            def.name
        );
        assert_eq!(
            def.rank.targeting,
            targeting(&row["targeting"]),
            "{} targeting",
            def.name
        );
        let effects = &row["effects"];
        assert_eq!(
            hides_caster(def, 1),
            effects["hidesCaster"].as_bool().unwrap(),
            "{} hidesCaster",
            def.name
        );
        let corpus_blink = if effects["blink"].is_null() {
            None
        } else {
            Some((
                num(&effects["blink"]["maxDist"]),
                num(&effects["blink"]["minDist"]),
            ))
        };
        let policy_blink = def.rank.effects.iter().find_map(|e| match e {
            PolicyEffect::Blink { max_dist, min_dist } => Some((*max_dist, *min_dist)),
            PolicyEffect::HidesCaster | PolicyEffect::Wall { .. } => None,
        });
        assert_eq!(policy_blink, corpus_blink, "{} blink", def.name);

        // The sim's own definition must agree with the captured source row the bot plays.
        let sim = sim_definition(id);
        assert_eq!(
            r6(sim.cast_ms),
            r6(num(&row["castMs"])),
            "{} sim castMs",
            def.name
        );
        assert_eq!(
            u32::from(sim.charges),
            row["charges"].as_u64().unwrap() as u32,
            "{} sim charges",
            def.name
        );
        match (sim.target, targeting(&row["targeting"])) {
            (Target::Self_, TargetRule::Self_) => {}
            (Target::Unit(range), TargetRule::Unit { range: want, .. }) => {
                assert_eq!(r6(range), r6(want), "{} sim unit range", def.name)
            }
            (Target::Point, TargetRule::Point { range, min_range }) => {
                assert_eq!(range, blink::MAX_DIST, "{} sim point range", def.name);
                assert_eq!(min_range, blink::MIN_DIST, "{} sim point min", def.name);
            }
            (got, want) => panic!("{} sim target {got:?} != captured {want:?}", def.name),
        }
        let sim_hidden = sim.effects.iter().any(|e| {
            matches!(
                e,
                Effect::Status {
                    to: Side::Self_,
                    kind: StatusKind::Hidden,
                    ..
                }
            )
        });
        assert_eq!(
            sim_hidden,
            effects["hidesCaster"].as_bool().unwrap(),
            "{} sim hidden",
            def.name
        );
        let sim_blink = sim.effects.iter().any(|e| matches!(e, Effect::Blink));
        assert_eq!(
            sim_blink,
            !effects["blink"].is_null(),
            "{} sim blink",
            def.name
        );
    }
}

#[test]
fn hides_caster_matches_the_source_for_every_rank() {
    let f = fixture();
    let hides = f["hides"].as_array().expect("hides");
    assert!(!hides.is_empty());
    for row in hides {
        let def = wish_by_id(ability(&row["id"])).expect("the policy has every Wish");
        let rank = row["rank"].as_u64().expect("an integer rank") as u8;
        assert_eq!(
            hides_caster(def, rank),
            row["hidden"].as_bool().unwrap(),
            "{} hidesCaster at rank {rank}",
            def.name
        );
    }
}

#[test]
fn the_block_bits_match_the_sim_status_bits() {
    use rh_sim::status_runtime::StatusKind;
    assert_eq!(EFFECT_STUNNED, sim_status_bit(StatusKind::Stun));
    assert_eq!(EFFECT_SILENCED, sim_status_bit(StatusKind::Silence));
    assert_eq!(EFFECT_ROOTED, sim_status_bit(StatusKind::Root));
}

#[test]
fn the_wish_rule_table_matches_the_source() {
    let f = fixture();
    let rules = &f["rules"];
    let r = WISH_RULES;
    assert_eq!(r.retry_ms, num(&rules["retryMs"]));
    assert_eq!(r.recent_hit_ms, num(&rules["recentHitMs"]));
    assert_eq!(r.chase_closing, num(&rules["chaseClosing"]));
    assert_eq!(r.chase_cos, num(&rules["chaseCos"]));
    assert_eq!(r.on_it_distance, num(&rules["onItDistance"]));
    assert_eq!(r.easy_remembers, num(&rules["easyRemembers"]));
    assert_eq!(r.slip_pending_ms, num(&rules["slipPendingMs"]));
    assert_eq!(r.slip_grace_ms, num(&rules["slipGraceMs"]));
    assert_eq!(r.slip_utility, num(&rules["slipUtility"]));
    assert_eq!(r.slip_step_u, num(&rules["slipStepU"]));
    assert_eq!(r.slip_keep_ms, num(&rules["slipKeepMs"]));
    assert_eq!(r.slip_arrived_u, num(&rules["slipArrivedU"]));
}

fn situation<'a>(row: &Value, map: &'a TileMap, ring: &'a blink::Ring) -> CastSituation<'a> {
    let me = &row["me"];
    let me_view = MeView {
        x: num(&me["x"]),
        y: num(&me["y"]),
        hp_frac: num(&me["hpFrac"]),
        effects: me["effects"].as_u64().unwrap() as u16,
        recently_hit: me["recentlyHit"].as_bool().unwrap(),
    };
    let foe = if row["foe"].is_null() {
        None
    } else {
        let f = &row["foe"];
        Some(FoeView {
            id: text(&f["id"]).into(),
            x: num(&f["x"]),
            y: num(&f["y"]),
            d: num(&f["d"]),
            los: f["los"].as_bool().unwrap_or(true),
            targetable: f["targetable"].as_bool().unwrap_or(true),
            mob: f["mob"].as_bool().unwrap_or(false),
        })
    };
    let threat = if row["threat"].is_null() {
        None
    } else {
        let t = &row["threat"];
        Some(ThreatView {
            x: num(&t["x"]),
            y: num(&t["y"]),
            d: num(&t["d"]),
            chasing: t["chasing"].as_bool().unwrap_or(false),
            id: t["id"].as_str().map(str::to_owned),
            los: t["los"].as_bool(),
            targetable: t["targetable"].as_bool(),
        })
    };
    CastSituation {
        me: me_view,
        foe,
        threat,
        map,
        ring,
        gates_locked: row["gatesLocked"].as_bool().unwrap_or(false),
    }
}

#[test]
fn every_captured_cast_decision_matches_the_source() {
    let f = fixture();
    let map_value = &f["profile"]["map"];
    let w = map_value["w"].as_u64().unwrap() as u32;
    let h = map_value["h"].as_u64().unwrap() as u32;
    let tiles: Vec<u8> = map_value["tiles"]
        .as_array()
        .expect("map tiles")
        .iter()
        .map(|t| t.as_u64().unwrap() as u8)
        .collect();
    let map = TileMap::new(w, h, tiles).expect("the declared map is admitted");
    let ring = blink::Ring::new(&map);
    let cases = f["cases"].as_array().expect("cases");
    assert!(cases.len() >= 100, "the declared case set: {}", cases.len());
    let mut checked = 0usize;
    for row in cases {
        let name = text(&row["name"]);
        let def = wish_by_id(ability(&row["def"])).expect("the policy has every Wish");
        let rank = row["rank"]
            .as_f64()
            .map(|r| r.clamp(1., 255.) as u8)
            .unwrap_or(1);
        let s = situation(row, &map, &ring);
        let got = decide_cast(def, rank, &s);
        let want = &row["choice"];
        match (&got, want.is_null()) {
            (None, true) => {}
            (Some(c), false) => {
                assert!(
                    close(c.x, num(&want["x"])) && close(c.y, num(&want["y"])),
                    "{name}: ({}, {}) != ({}, {})",
                    r6(c.x),
                    r6(c.y),
                    num(&want["x"]),
                    num(&want["y"])
                );
                assert_eq!(c.id.as_deref(), want["id"].as_str(), "{name}: target id");
            }
            (got, want_null) => panic!("{name}: choice {got:?} vs captured null={want_null}"),
        }
        checked += 1;
    }
    assert_eq!(checked, cases.len());
}

#[test]
fn the_policy_constants_match_the_source() {
    let f = fixture();
    let c = &f["profile"]["constants"];
    assert_eq!(ESCAPE_THREAT_DISTANCE, num(&c["escapeThreatDistance"]));
    assert_eq!(ESCAPE_HP_THREATENED, num(&c["escapeHpThreatened"]));
    assert_eq!(ESCAPE_HP_HIT, num(&c["escapeHpHit"]));
    assert_eq!(SUSTAIN_HP, num(&c["sustainHp"]));
    assert_eq!(ENGAGE_RANGE_MARGIN, num(&c["engageRangeMargin"]));
    assert_eq!(PEEL_DISTANCE, num(&c["peelDistance"]));
}
