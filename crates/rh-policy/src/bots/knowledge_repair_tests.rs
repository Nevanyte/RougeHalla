//! The Knowledge repair witness against parity/policy/bot-knowledge-repair.json, captured from the unmodified legacy brain
//! in the pinned linux/amd64 Node 22.23.4 container (tools/knowledge-repair-fixtures/): the source wiring (brain.ts
//! derive + the tag-3 Knowledge stream, read-only probed by extracting and evaluating the actual source function and
//! line), the source diagnostic strings at exact JavaScript toFixed(2) half ties (knowledge.ts odds), and the source
//! feature probe with an explicit null player (perception.ts detectFeatures probe.player ?? firstPlayer).
use crate::bots::knowledge::Knowledge;
use crate::bots::random::{derive, Rng};
use crate::bots::types::{BotWeapon, OpponentSnapshot, SelfView, TierId, TierParams};
use crate::bots::view::{detect_features, FeatureProbe, Features, MessageData};
use rh_sim::FactionId;
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../parity/policy/bot-knowledge-repair.json");

fn fixture() -> Value {
    let f: Value = serde_json::from_str(FIXTURE).expect("the captured repair corpus parses");
    assert_eq!(f["format"], "rh-bot-knowledge-repair-source/1");
    assert_eq!(f["profile"]["node"], "v22.23.4");
    assert_eq!(f["profile"]["platform"], "linux");
    assert_eq!(f["profile"]["arch"], "x64");
    assert_eq!(f["profile"]["captureSha256"].as_str().unwrap().len(), 64);
    f
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
    r6(a) == r6(b) || (a - b).abs() <= 1e-6 * b.abs().max(1.)
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
fn self_view(me: &Value) -> SelfView {
    let weapons = me["weapons"].as_array().expect("weapons");
    SelfView {
        faction: faction(&me["faction"]),
        weapons: [weapon(&weapons[0]), weapon(&weapons[1])],
        slot: me["slot"].as_u64().expect("slot") as u8,
        hp: num(&me["hp"]),
        max_hp: num(&me["maxHp"]),
        ..Default::default()
    }
}
fn snapshot(them: &Value) -> OpponentSnapshot {
    OpponentSnapshot {
        id: text(&them["id"]).to_string(),
        faction: faction(&them["faction"]),
        in_hand: weapon(&them["inHand"]),
        other_slot: weapon(&them["otherSlot"]),
        hp_frac: num(&them["hpFrac"]),
        bounty: them["bounty"].as_u64().unwrap_or(0) as u32,
        dist: num(&them["dist"]),
        tint: num(&them["tint"]),
    }
}
fn to_data(v: &Value) -> MessageData {
    match v {
        Value::Null => MessageData::Null,
        Value::Bool(b) => MessageData::Bool(*b),
        Value::Number(n) => MessageData::Num(n.as_f64().expect("a number")),
        Value::String(s) => MessageData::Str(s.clone()),
        Value::Array(items) => MessageData::Arr(items.iter().map(to_data).collect()),
        Value::Object(map) => {
            MessageData::Obj(map.iter().map(|(k, v)| (k.clone(), to_data(v))).collect())
        }
    }
}
fn features_of(v: &Value) -> Features {
    Features {
        message_types: v["messageTypes"]
            .as_array()
            .expect("messageTypes")
            .iter()
            .map(|t| text(t).to_string())
            .collect(),
        wishes: v["wishes"].as_bool().expect("wishes"),
        status_effects: v["statusEffects"].as_bool().expect("statusEffects"),
        fields: v["fields"].as_bool().expect("fields"),
        planning: v["planning"].as_bool().expect("planning"),
        chests: v["chests"].as_bool().expect("chests"),
        skills: v["skills"].as_bool().expect("skills"),
        relics: v["relics"].as_bool().expect("relics"),
        camps: v["camps"].as_bool().expect("camps"),
        hazards: v["hazards"].as_bool().expect("hazards"),
    }
}

/// Every wheel edge, the mob-share grid and one fixed odds row of one Knowledge layer.
fn check_fingerprint(k: &Knowledge, want: &Value) -> Result<(), String> {
    for row in want["factions"].as_array().expect("factions") {
        let a = faction(&row["a"]).expect("faction");
        let b = faction(&row["b"]).expect("faction");
        if i64::from(k.faction_edge(a, b)) != row["ab"].as_i64().expect("ab")
            || i64::from(k.faction_edge(b, a)) != row["ba"].as_i64().expect("ba")
        {
            return Err(format!("faction edge {row}"));
        }
    }
    for row in want["weapons"].as_array().expect("weapons") {
        let a = weapon(&row["a"]).expect("weapon");
        let b = weapon(&row["b"]).expect("weapon");
        if i64::from(k.weapon_edge(a, b)) != row["ab"].as_i64().expect("ab")
            || i64::from(k.weapon_edge(b, a)) != row["ba"].as_i64().expect("ba")
        {
            return Err(format!("weapon edge {row}"));
        }
    }
    for row in want["mobShare"].as_array().expect("mobShare") {
        let share = k.mob_share(
            faction(&row["me"]).expect("me"),
            faction(&row["region"]).expect("region"),
            row["elite"].as_bool().expect("elite"),
        );
        if !close(share, num(&row["share"])) {
            return Err(format!("mob share {row}: native {share}"));
        }
    }
    Ok(())
}

#[test]
fn knowledge_repair_derive_and_brain_wiring_match_the_source() {
    let f = fixture();
    // The derive function itself, source-derived (the corpus evaluates the extracted source text).
    for row in f["tagVectors"].as_array().expect("tagVectors") {
        let seed = row["seed"].as_u64().expect("seed") as u32;
        let tag = row["tag"].as_u64().expect("tag") as u32;
        assert_eq!(
            derive(seed, tag),
            row["expected"].as_u64().expect("expected") as u32,
            "derive({seed}, {tag})"
        );
    }
    // The wiring: the read-only probe records the actual brain lines and the tag its Knowledge stream uses.
    let wiring = &f["wiring"];
    assert_eq!(wiring["file"], "packages/server/src/bots/brain/brain.ts");
    assert_eq!(wiring["tag"].as_u64().unwrap(), 3);
    let lines: Vec<&str> = wiring["lines"]
        .as_array()
        .expect("lines")
        .iter()
        .map(|line| line["text"].as_str().expect("a wiring line"))
        .collect();
    assert!(
        lines
            .iter()
            .any(|line| line.contains("mulberry32(derive(cfg.seed, 3))")),
        "the source wires the Knowledge stream from derive(seed, 3): {lines:?}"
    );
    assert!(
        lines
            .iter()
            .any(|line| line.contains("decide: mulberry32(derive(cfg.seed, 0))")),
        "the decision stream is a different stream in the source: {lines:?}"
    );
    let line = wiring["line"].as_u64().expect("line");
    assert!(wiring["createLine"].as_u64().unwrap() > line);
    assert_eq!(wiring["deriveTextSha256"].as_str().unwrap().len(), 64);

    // For each declared seed: the source derive, the source stream's first draws, and the Knowledge layer the wiring
    // creates, against the layer the decision stream would wrongly create.
    let pair = &wiring["fingerprintPair"];
    let me = self_view(&pair["me"]);
    let them = snapshot(&pair["them"]);
    for probe in wiring["probes"].as_array().expect("probes") {
        let seed = probe["seed"].as_u64().expect("seed") as u32;
        let tag3 = derive(seed, 3);
        assert_eq!(
            u64::from(tag3),
            probe["derived"].as_u64().expect("derived"),
            "seed {seed}: the port's derive is the source derive"
        );
        let mut rng = Rng::new(tag3);
        for want in probe["firstDraws"].as_array().expect("firstDraws") {
            assert_eq!(
                rng.next_f64().to_bits(),
                num(want).to_bits(),
                "seed {seed}: the tag3 stream is the source stream"
            );
        }
        let tier = TierParams::by_id(TierId::Easy);
        let by_tag3 = Knowledge::create(tier, &mut Rng::new(tag3));
        check_fingerprint(&by_tag3, &probe["tag3Fingerprint"])
            .unwrap_or_else(|e| panic!("seed {seed}: tag3 fingerprint: {e}"));
        let by_decide = Knowledge::create(tier, &mut Rng::new(derive(seed, 0)));
        check_fingerprint(&by_decide, &probe["decideFingerprint"])
            .unwrap_or_else(|e| panic!("seed {seed}: decide fingerprint: {e}"));
        assert!(
            probe["differs"].as_bool().expect("differs"),
            "seed {seed}: the corpus must distinguish the two streams"
        );
        assert_ne!(
            by_tag3, by_decide,
            "seed {seed}: the decision stream is not the Knowledge stream"
        );
        let want = &probe["tag3Fingerprint"]["odds"];
        let odds = by_tag3.odds(&me, &them);
        assert_eq!(odds.why, text(&want["why"]));
        assert!(close(odds.edge, num(&want["edge"])));
        assert!(close(odds.score, num(&want["score"])));
        assert_eq!(odds.known, want["known"].as_bool().expect("known"));
    }
}

#[test]
fn knowledge_repair_diagnostics_use_javascript_tofixed_semantics() {
    let f = fixture();
    let setup = &f["halfTieSetup"];
    let mut rng = Rng::new(setup["seed"].as_u64().expect("seed") as u32);
    let knowledge =
        Knowledge::create_with(num(&setup["knowledge"]), num(&setup["noise"]), &mut rng);
    for case in f["halfTies"].as_array().expect("halfTies") {
        let me = self_view(&case["me"]);
        let them = snapshot(&case["them"]);
        let got = knowledge.odds(&me, &them);
        let want = &case["result"];
        assert_eq!(
            got.why,
            text(&want["why"]),
            "{}: the source string must be reproduced",
            case["name"]
        );
        assert!(close(got.edge, num(&want["edge"])), "{}", case["name"]);
        assert!(close(got.score, num(&want["score"])), "{}", case["name"]);
        assert_eq!(got.known, want["known"].as_bool().expect("known"));
    }
    // The exact half ties that separate JavaScript toFixed from Rust formatting: 0.125 -> 0.13, -0.125 -> -0.13.
    let me = self_view(&f["halfTies"][0]["me"]);
    let them = snapshot(&f["halfTies"][0]["them"]);
    assert_eq!(knowledge.odds(&me, &them).why, "partial 0.00, hp lead 0.13");
}

fn probe_of(case: &Value) -> FeatureProbe {
    let mut state = Vec::new();
    if let Some(players) = case["players"].as_array() {
        if !players.is_empty() {
            let entries: Vec<(String, MessageData)> = players
                .iter()
                .enumerate()
                .map(|(i, player)| (format!("p{i}"), to_data(player)))
                .collect();
            state.push(("players".to_string(), MessageData::Obj(entries)));
        }
    }
    if case.get("fields").is_some() {
        state.push(("fields".to_string(), MessageData::Arr(Vec::new())));
    }
    if case.get("camps").is_some() {
        state.push(("camps".to_string(), MessageData::Arr(Vec::new())));
    }
    FeatureProbe {
        state: MessageData::Obj(state),
        player: match case["player"].as_str() {
            Some("missing") => None,
            Some("null") => Some(MessageData::Null),
            None => Some(to_data(&case["player"])),
            Some(other) => panic!("unknown declared player marker {other}"),
        },
        map_terrain: case["mapTerrain"]
            .as_array()
            .map(|a| a.iter().map(|v| v.as_u64().expect("tile") as u8).collect()),
        map_hazards: false,
        message_types: case["messageTypes"]
            .as_array()
            .map(|a| a.iter().map(|t| text(t).to_string()).collect()),
    }
}

#[test]
fn knowledge_repair_explicit_null_player_probe_falls_back_to_the_first_player() {
    let f = fixture();
    for case in f["explicitNull"].as_array().expect("explicitNull") {
        let probe = probe_of(case);
        let got = detect_features(&probe);
        assert_eq!(
            got,
            features_of(&case["result"]),
            "{}: source probe.player ?? firstPlayer",
            case["name"]
        );
    }
}
