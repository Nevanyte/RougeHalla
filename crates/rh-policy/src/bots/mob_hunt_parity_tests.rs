//! The pure mob-hunt/build-route surface against the actual-source corpus parity/policy/bot-mob-hunt.json (captured
//! from bots/mobHunt.ts, brain/huntAdapter.ts and brain/buildRoute.ts in the pinned linux/amd64 Node 22.23.4 container).
//! Every declared case compares exactly: numbers by bit pattern, except retreat points which compare at the captured 1e-6
//! rounding. The stateful MobHunter and BuildRoute planner are the documented P-BOTS-4 remainder, not claimed here.
use crate::bots::build_route::{
    build_of, camp_value, ready_for_elites, type_weight, BuildGoal, FarmStat, RouteCamp,
    BUILD_GOALS, CLEAR_MS_ELITE, CLEAR_MS_PER_MOB, CONTEST_MS, CONTEST_PLAYER_RANGE,
    ELITE_AFTER_MS, ELITE_EARLY_POWER, ELITE_MIN_KILLS, ELITE_VALUE, MAX_WAIT_MS, OWN_FIGHT_SLACK,
    REPLAN_MS, ROUTE_STEPS, STAT_FLOOR, WALK_FACTOR, ZONE_AVOID_MS, ZONE_CONTESTS, ZONE_MEMORY_MS,
};
use crate::bots::mob_hunt::{
    best_edge, best_slot_vs_mob, hunt_config_for, mob_weapon, retreat_point, useless, wants_mobs,
    weapon_edge, HuntDecision, MobHuntConfig, MobLike, MOB_HUNT,
};
use crate::bots::types::{PERSONAS, TIERS};
use rh_sim::constants::{PLAYER_RADIUS, TILE};
use rh_sim::content::{FactionId, WeaponId};
use rh_sim::map::MASK_MOVE;
use rh_sim::{geometry, TileMap, Vec2};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../parity/policy/bot-mob-hunt.json");

fn fixture() -> Value {
    let f: Value = serde_json::from_str(FIXTURE).expect("the captured mob-hunt corpus parses");
    assert_eq!(f["format"], "rh-bot-mob-hunt-source/1");
    assert_eq!(f["profile"]["node"], "v22.23.4");
    assert_eq!(f["profile"]["platform"], "linux");
    assert_eq!(f["profile"]["arch"], "x64");
    assert_eq!(f["profile"]["constants"]["TILE"].as_f64(), Some(TILE));
    assert_eq!(
        f["profile"]["constants"]["PLAYER_RADIUS"].as_f64(),
        Some(PLAYER_RADIUS)
    );
    assert_eq!(f["profile"]["sourceTree"].as_str().unwrap().len(), 64);
    assert_eq!(f["profile"]["captureSha256"].as_str().unwrap().len(), 64);
    f
}

fn num(v: &Value) -> f64 {
    v.as_f64().expect("a number")
}
fn r6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}
fn eq_bits(got: f64, want: f64, ctx: &str) {
    assert_eq!(got.to_bits(), want.to_bits(), "{ctx}: {got} != {want}");
}
fn point(v: &Value) -> Vec2 {
    Vec2::new(num(&v["x"]), num(&v["y"]))
}
fn weapon(name: &str) -> WeaponId {
    WeaponId::parse(name).expect("a source weapon id")
}
fn opt_weapon(v: &Value) -> Option<WeaponId> {
    v.as_str().map(weapon)
}
fn faction(name: &str) -> FactionId {
    FactionId::parse(name).expect("a source faction id")
}
fn tier(id: &str) -> &'static crate::bots::types::TierParams {
    TIERS
        .iter()
        .find(|t| t.id.as_str() == id)
        .expect("a source tier")
}
fn persona(id: &str) -> &'static crate::bots::types::PersonaParams {
    PERSONAS
        .iter()
        .find(|p| p.id.as_str() == id)
        .expect("a source persona")
}
fn config_json(c: &MobHuntConfig) -> Value {
    serde_json::json!({
        "playerThreat": c.player_threat,
        "playerRelease": c.player_release,
        "underFireRange": c.under_fire_range,
        "underFireMs": c.under_fire_ms,
        "reach": c.reach,
        "firstReach": c.first_reach,
        "walkSlack": c.walk_slack,
        "maxCandidates": c.max_candidates,
        "startMinHp": c.start_min_hp,
        "eliteMinPower": c.elite_min_power,
        "eliteFullHp": c.elite_full_hp,
        "mobMinShare": c.mob_min_share,
        "eliteMinShare": c.elite_min_share,
        "eliteSureShare": c.elite_sure_share,
        "eliteSurePower": c.elite_sure_power,
        "retreatHp": c.retreat_hp,
        "retreatClear": c.retreat_clear,
        "retreatMinMs": c.retreat_min_ms,
        "retreatMaxMs": c.retreat_max_ms,
        "retreatBanMs": c.retreat_ban_ms,
        "killGoal": c.kill_goal,
        "focusBudgetMs": c.focus_budget_ms,
        "targetBudgetMs": c.target_budget_ms,
        "stallAttackMs": c.stall_attack_ms,
        "approachMs": c.approach_ms,
        "returnBanMs": c.return_ban_ms,
        "stallBanMs": c.stall_ban_ms,
        "awakeMoved": c.awake_moved,
        "skipRanged": c.skip_ranged,
        "repickMs": c.repick_ms,
    })
}
fn compare_config(got: &MobHuntConfig, want: &Value, ctx: &str) {
    let got = config_json(got);
    for (key, value) in want.as_object().expect("a config object") {
        match value {
            Value::Bool(b) => assert_eq!(got[key].as_bool(), Some(*b), "{ctx}/{key}"),
            Value::Number(n) => {
                eq_bits(num(&got[key]), n.as_f64().unwrap(), &format!("{ctx}/{key}"))
            }
            other => panic!("unexpected config value {other:?}"),
        }
    }
    assert_eq!(
        got.as_object().unwrap().len(),
        want.as_object().unwrap().len(),
        "{ctx}: config field count"
    );
}

#[test]
fn mob_hunt_config_and_persona_derivation_match_actual_source() {
    let f = fixture();
    compare_config(&MOB_HUNT, &f["mobHunt"], "MOB_HUNT");
    let cases = f["huntConfigs"].as_array().unwrap();
    assert_eq!(cases.len(), 12, "three tiers x four personas");
    for case in cases {
        let tier_id = case["tier"].as_str().unwrap();
        let persona_id = case["persona"].as_str().unwrap();
        let got = hunt_config_for(tier(tier_id), persona(persona_id));
        compare_config(
            &got,
            &case["config"],
            &format!("huntConfig/{tier_id}/{persona_id}"),
        );
    }
}

#[test]
fn weapon_edge_and_mob_weapon_rules_match_actual_source() {
    let f = fixture();
    for case in f["weaponEdge"].as_array().unwrap() {
        let (a, b) = (
            weapon(case["a"].as_str().unwrap()),
            weapon(case["b"].as_str().unwrap()),
        );
        assert_eq!(
            i64::from(weapon_edge(a, b)),
            case["expected"].as_i64().unwrap(),
            "weaponEdge/{}/{}",
            a.as_str(),
            b.as_str()
        );
    }
    for case in f["useless"].as_array().unwrap() {
        let (mine, theirs) = (
            weapon(case["mine"].as_str().unwrap()),
            weapon(case["theirs"].as_str().unwrap()),
        );
        assert_eq!(
            useless(mine, theirs),
            case["expected"].as_bool().unwrap(),
            "useless/{}/{}",
            mine.as_str(),
            theirs.as_str()
        );
    }
    let f = fixture();
    for case in f["bestEdge"].as_array().unwrap() {
        let weapons: Vec<Option<WeaponId>> = case["weapons"]
            .as_array()
            .unwrap()
            .iter()
            .map(opt_weapon)
            .collect();
        let theirs = weapon(case["theirs"].as_str().unwrap());
        assert_eq!(
            i64::from(best_edge(&weapons, theirs)),
            case["expected"].as_i64().unwrap(),
            "bestEdge/{:?}/{}",
            weapons,
            theirs.as_str()
        );
    }
    for case in f["bestSlotVsMob"].as_array().unwrap() {
        let slots = [opt_weapon(&case["slots"][0]), opt_weapon(&case["slots"][1])];
        let current = case["current"].as_u64().unwrap() as u8;
        let theirs = opt_weapon(&case["theirs"]);
        assert_eq!(
            u64::from(best_slot_vs_mob(slots, current, theirs)),
            case["expected"].as_u64().unwrap(),
            "bestSlotVsMob/{slots:?}/{current}/{theirs:?}"
        );
    }
    for case in f["mobWeapon"].as_array().unwrap() {
        let like = MobLike {
            weapon0: case["weapon0"].as_str().unwrap(),
            faction: case["faction"].as_str().unwrap(),
        };
        let got = mob_weapon(like).map(WeaponId::as_str);
        assert_eq!(
            got,
            case["expected"].as_str(),
            "mobWeapon/{:?}/{:?}",
            like.weapon0,
            like.faction
        );
    }
}

#[test]
fn retreat_point_matches_actual_source() {
    let f = fixture();
    let map_value = &f["profile"]["map"];
    let w = map_value["w"].as_u64().unwrap() as u32;
    let h = map_value["h"].as_u64().unwrap() as u32;
    let tiles: Vec<u8> = map_value["tiles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_u64().unwrap() as u8)
        .collect();
    let map = TileMap::new(w, h, tiles).unwrap();
    let cases = f["retreatPoints"].as_array().unwrap();
    assert_eq!(cases.len(), 9);
    for case in cases {
        let threats: Vec<Vec2> = case["threats"]
            .as_array()
            .unwrap()
            .iter()
            .map(point)
            .collect();
        let got = retreat_point(point(&case["self"]), &threats, |from, to| {
            geometry::segment_clear(&map, from, to, PLAYER_RADIUS, MASK_MOVE)
        });
        match (&case["expected"], got) {
            (Value::Null, None) => {}
            (want, Some(got)) => {
                eq_bits(r6(got.x), num(&want["x"]), &format!("{}/x", case["name"]));
                eq_bits(r6(got.y), num(&want["y"]), &format!("{}/y", case["name"]));
            }
            (want, None) => panic!("{}: expected {want:?}, got none", case["name"]),
        }
    }
}

#[test]
fn wants_mobs_matches_actual_source() {
    let f = fixture();
    for case in f["decisions"].as_array().unwrap() {
        let d = &case["decision"];
        let decision = match d["kind"].as_str().unwrap() {
            "player" => HuntDecision::Player {
                why: d["why"].as_str().unwrap().to_owned(),
            },
            "mob" => HuntDecision::Mob {
                id: d["id"].as_str().unwrap().to_owned(),
                why: d["why"].as_str().unwrap().to_owned(),
            },
            "retreat" => HuntDecision::Retreat {
                from: d["from"].as_array().unwrap().iter().map(point).collect(),
                why: d["why"].as_str().unwrap().to_owned(),
            },
            other => panic!("unconsumed decision kind {other}"),
        };
        assert_eq!(
            wants_mobs(&decision),
            case["expected"].as_bool().unwrap(),
            "decision {d:?}"
        );
    }
}

fn build_goal_matches(got: &BuildGoal, want: &Value, ctx: &str) {
    assert_eq!(got.id, want["id"].as_str().unwrap(), "{ctx}/id");
    assert_eq!(got.name, want["name"].as_str().unwrap(), "{ctx}/name");
    let weights = want["weights"].as_object().unwrap();
    for stat in FarmStat::ALL {
        let expected = weights.get(stat.as_str()).map_or(0., num);
        eq_bits(
            got.weight(stat),
            expected,
            &format!("{ctx}/{}", stat.as_str()),
        );
    }
}

#[test]
fn build_route_constants_goals_and_pure_rules_match_actual_source() {
    let f = fixture();
    let constants = &f["buildConstants"];
    for (key, got) in [
        ("STAT_FLOOR", STAT_FLOOR),
        ("ROUTE_STEPS", f64::from(ROUTE_STEPS)),
        ("MAX_WAIT_MS", MAX_WAIT_MS),
        ("CLEAR_MS_PER_MOB", CLEAR_MS_PER_MOB),
        ("CLEAR_MS_ELITE", CLEAR_MS_ELITE),
        ("ELITE_VALUE", ELITE_VALUE),
        ("ELITE_AFTER_MS", ELITE_AFTER_MS),
        ("ELITE_MIN_KILLS", ELITE_MIN_KILLS),
        ("ELITE_EARLY_POWER", ELITE_EARLY_POWER),
        ("CONTEST_MS", CONTEST_MS),
        ("ZONE_CONTESTS", f64::from(ZONE_CONTESTS)),
        ("ZONE_MEMORY_MS", ZONE_MEMORY_MS),
        ("ZONE_AVOID_MS", ZONE_AVOID_MS),
        ("CONTEST_PLAYER_RANGE", CONTEST_PLAYER_RANGE),
        ("OWN_FIGHT_SLACK", OWN_FIGHT_SLACK),
        ("WALK_FACTOR", WALK_FACTOR),
        ("REPLAN_MS", REPLAN_MS),
    ] {
        eq_bits(got, num(&constants[key]), &format!("constant/{key}"));
    }
    for (index, goals) in f["buildGoals"].as_array().unwrap().iter().enumerate() {
        let faction = FactionId::ALL[index];
        for (slot, want) in goals.as_array().unwrap().iter().enumerate() {
            build_goal_matches(
                &BUILD_GOALS[index][slot],
                want,
                &format!("buildGoals/{}/{}", faction.as_str(), slot),
            );
        }
    }
    for case in f["buildOf"].as_array().unwrap() {
        let got = build_of(
            faction(case["faction"].as_str().unwrap()),
            num(&case["draw"]),
        );
        assert_eq!(
            got.id,
            case["expected"].as_str().unwrap(),
            "buildOf {case:?}"
        );
    }
    for case in f["typeWeight"].as_array().unwrap() {
        let build = build_of(
            faction(case["faction"].as_str().unwrap()),
            num(&case["draw"]),
        );
        let kind = case["type"].as_str().unwrap();
        let mob_type = (!kind.is_empty()).then_some(kind);
        eq_bits(
            type_weight(build, mob_type),
            num(&case["expected"]),
            &format!("typeWeight/{}/{:?}", build.id, kind),
        );
    }
    for case in f["readyForElites"].as_array().unwrap() {
        assert_eq!(
            ready_for_elites(
                num(&case["runMs"]),
                num(&case["mobKills"]),
                num(&case["power"])
            ),
            case["expected"].as_bool().unwrap(),
            "readyForElites {case:?}"
        );
    }
    for case in f["campValue"].as_array().unwrap() {
        let build = build_of(
            faction(case["faction"].as_str().unwrap()),
            num(&case["draw"]),
        );
        let c = &case["camp"];
        let camp = RouteCamp {
            index: c["index"].as_u64().unwrap() as u32,
            id: c["id"].as_str().unwrap().to_owned(),
            zone: faction(c["zone"].as_str().unwrap()),
            x: num(&c["x"]),
            y: num(&c["y"]),
            r: num(&c["r"]),
            elite: c["elite"].as_bool().unwrap(),
            spots: c["spots"].as_u64().unwrap() as u32,
            mob_type: c["type"].as_str().unwrap().to_owned(),
            alive: c["alive"].as_u64().unwrap() as u32,
            state: c["state"].as_u64().unwrap() as u8,
            respawn_at: num(&c["respawnAt"]),
        };
        eq_bits(
            camp_value(build, &camp, case["elites"].as_bool().unwrap()),
            num(&case["expected"]),
            &format!("campValue/{}", build.id),
        );
    }
    // Every reward-bearing source type maps to a stat the builds actually weight (no silent floor on a real reward).
    for mob in rh_sim::mob_catalog::normal_types_of(FactionId::Fire)
        .chain(rh_sim::mob_catalog::normal_types_of(FactionId::Sentenced))
        .chain(rh_sim::mob_catalog::normal_types_of(FactionId::Plague))
        .chain(rh_sim::mob_catalog::normal_types_of(FactionId::Frost))
        .chain(rh_sim::mob_catalog::normal_types_of(FactionId::Holy))
    {
        assert!(
            crate::bots::build_route::reward_stat(Some(mob.id.as_str())).is_some(),
            "{} has no ported stat reward",
            mob.id.as_str()
        );
    }
}
