//! The Knowledge layer against the actual-source corpus parity/policy/bot-knowledge.json, captured from the unmodified
//! legacy brain in the pinned linux/amd64 Node 22.23.4 container (tools/knowledge-fixtures/). The corpus is immutable source
//! output: this test replays every declared creation (the exact stream draw count is pinned by the probe), every wheel edge,
//! the mob-share grid and every declared fight-odds row, and kills mutants of the expected outputs.
use crate::bots::knowledge::Knowledge;
use crate::bots::random::Rng;
use crate::bots::types::{BotWeapon, OpponentSnapshot, SelfView, TierId, TierParams};
use rh_sim::FactionId;
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../parity/policy/bot-knowledge.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the captured knowledge corpus parses")
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
fn faction(v: &Value) -> Option<FactionId> {
    let name = v.as_str()?;
    Some(match name {
        "fire" => FactionId::Fire,
        "sentenced" => FactionId::Sentenced,
        "plague" => FactionId::Plague,
        "frost" => FactionId::Frost,
        "holy" => FactionId::Holy,
        other => panic!("unknown faction {other}"),
    })
}
fn weapon(v: &Value) -> Option<BotWeapon> {
    v.as_str()
        .map(|name| BotWeapon::parse(name).expect("a weapon"))
}
fn tier(v: &Value) -> TierId {
    match text(v) {
        "easy" => TierId::Easy,
        "normal" => TierId::Normal,
        "hard" => TierId::Hard,
        other => panic!("unknown tier {other}"),
    }
}

/// Check every captured creation, wheel edge, mob share and odds row, returning the first difference.
fn check(f: &Value) -> Result<(), String> {
    for case in f["cases"].as_array().expect("cases") {
        for item in case["items"].as_array().expect("items") {
            let tier = tier(&item["tier"]);
            let knowledge = num(&item["knowledge"]);
            let noise = num(&item["noise"]);
            let seed = item["seed"].as_u64().expect("seed") as u32;
            let mut rng = Rng::new(seed);
            let k = Knowledge::create_with(knowledge, noise, &mut rng);
            let tier_params = TierParams::by_id(tier);
            let _ = tier_params;
            let probe = &item["probe"];
            if rng.next_f64() != num(&probe["decide"]) || rng.next_f64() != num(&probe["next"]) {
                return Err(format!(
                    "{} seed {seed}: stream drift after creation",
                    case["name"]
                ));
            }
            for row in item["factions"].as_array().expect("factions") {
                let a = faction(&row["a"]).expect("faction");
                let b = faction(&row["b"]).expect("faction");
                if i64::from(k.faction_edge(a, b)) != row["ab"].as_i64().unwrap()
                    || i64::from(k.faction_edge(b, a)) != row["ba"].as_i64().unwrap()
                {
                    return Err(format!("{} seed {seed}: faction edge {row}", case["name"]));
                }
            }
            for row in item["weapons"].as_array().expect("weapons") {
                let a = weapon(&row["a"]).expect("weapon");
                let b = weapon(&row["b"]).expect("weapon");
                if i64::from(k.weapon_edge(a, b)) != row["ab"].as_i64().unwrap()
                    || i64::from(k.weapon_edge(b, a)) != row["ba"].as_i64().unwrap()
                {
                    return Err(format!("{} seed {seed}: weapon edge {row}", case["name"]));
                }
            }
            for row in item["mobShare"].as_array().expect("mobShare") {
                let share = k.mob_share(
                    faction(&row["me"]).expect("me"),
                    faction(&row["region"]).expect("region"),
                    row["elite"].as_bool().expect("elite"),
                );
                if !close(share, num(&row["share"])) {
                    return Err(format!(
                        "{} seed {seed}: mobShare {row}: native {share}",
                        case["name"]
                    ));
                }
            }
        }
    }
    Ok(())
}

fn check_odds(f: &Value) -> Result<(), String> {
    for case in f["cases"].as_array().expect("cases") {
        for item in case["items"].as_array().expect("items") {
            let tier = tier(&item["tier"]);
            let _ = tier;
            let mut rng = Rng::new(item["seed"].as_u64().expect("seed") as u32);
            let k = Knowledge::create_with(num(&item["knowledge"]), num(&item["noise"]), &mut rng);
            for row in item["odds"].as_array().expect("odds") {
                let me = &row["me"];
                let me_weapons = me["weapons"].as_array().expect("weapons");
                let self_view = SelfView {
                    faction: faction(&me["faction"]),
                    weapons: [weapon(&me_weapons[0]), weapon(&me_weapons[1])],
                    slot: me["slot"].as_u64().expect("slot") as u8,
                    hp: num(&me["hp"]),
                    max_hp: num(&me["maxHp"]),
                    ..Default::default()
                };
                let them = &row["them"];
                let snapshot = OpponentSnapshot {
                    id: text(&them["id"]).to_string(),
                    faction: faction(&them["faction"]),
                    in_hand: weapon(&them["inHand"]),
                    other_slot: weapon(&them["otherSlot"]),
                    hp_frac: num(&them["hpFrac"]),
                    bounty: them["bounty"].as_u64().unwrap_or(0) as u32,
                    dist: num(&them["dist"]),
                    tint: num(&them["tint"]),
                };
                let got = k.odds(&self_view, &snapshot);
                let want = &row["result"];
                if !close(got.edge, num(&want["edge"]))
                    || !close(got.score, num(&want["score"]))
                    || got.known != want["known"].as_bool().expect("known")
                    || got.why != text(&want["why"])
                {
                    return Err(format!(
                        "{} seed {}: odds native {got:?} source {want}",
                        case["name"], item["seed"]
                    ));
                }
            }
        }
    }
    Ok(())
}

#[test]
fn captured_knowledge_layer_reproduces() {
    let f = fixture();
    check(&f).expect("the Knowledge layer matches the source capture");
}

#[test]
fn captured_fight_odds_reproduce() {
    let f = fixture();
    check_odds(&f).expect("the fight odds match the source capture");
}

#[test]
fn captured_knowledge_constants() {
    let f = fixture();
    assert_eq!(f["profile"]["constants"]["maxEdge"].as_f64(), Some(2.));
    assert_eq!(f["format"], "rh-bot-knowledge-source/1");
}

#[test]
fn mutants_of_the_knowledge_corpus_cannot_false_match() {
    let f = fixture();
    let mut bad = f.clone();
    bad["cases"][0]["items"][0]["probe"]["decide"] =
        Value::from(num(&bad["cases"][0]["items"][0]["probe"]["decide"]) + 1e-12);
    assert!(check(&bad).is_err(), "a drifted creation stream must fail");
    let mut bad = f.clone();
    bad["cases"][1]["items"][0]["mobShare"][0]["share"] =
        Value::from(num(&bad["cases"][1]["items"][0]["mobShare"][0]["share"]) + 0.01);
    assert!(check(&bad).is_err(), "a nudged mob share must fail");
    let mut bad = f.clone();
    bad["cases"][2]["items"][0]["odds"][0]["result"]["why"] = Value::from("wrong why");
    assert!(check_odds(&bad).is_err(), "a wrong odds trace must fail");
    let mut bad = f.clone();
    bad["cases"][0]["items"][0]["weapons"][0]["ab"] = Value::from(1);
    assert!(check(&bad).is_err(), "a flipped wheel edge must fail");
}
