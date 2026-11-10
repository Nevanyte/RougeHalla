//! Frozen source tour-supply regression: replays both captured cases through the real input door and the
//! real mob-kill/pay producer, then compares the actual captured quest/reward/notice surfaces. No quest progress,
//! visited mask, recheck, status or expected reward is installed by this consumer.
use super::catalog;
use super::live::Status as QuestStatus;
use crate::events::Event;
use crate::input::{validate, RawCommand};
use crate::results::GvReason;
use crate::{FactionId, PlayerId, Secrets, Sim, SimConfig, Vec2};

const CORPUS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../parity/quest-tour-supply/source.json"
);

fn load() -> serde_json::Value {
    let text = std::fs::read_to_string(CORPUS).expect("frozen tour-supply source corpus");
    assert_eq!(text.len(), 638_109, "frozen source corpus byte length");
    let doc: serde_json::Value = serde_json::from_str(&text).expect("source corpus json");
    assert_eq!(doc["format"], "rh-quest-tour-supply-source/1");
    assert_eq!(doc["cases"].as_array().map(Vec::len), Some(2));
    doc
}

fn arena() -> crate::Arena {
    use crate::mapgen::{coliseum, map_hash, pipeline};
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let map = generator
        .generate_styled(
            1,
            Some(0),
            pipeline::Options {
                decor: false,
                ..Default::default()
            },
        )
        .expect("seed 1 attempt 0 generates");
    let hash = u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap();
    crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map,
    }
    .validate()
    .expect("admitted")
    .into_arena()
    .expect("arena")
}

fn player(ordinal: usize) -> PlayerId {
    PlayerId(ordinal as u32 + 1)
}
fn ordinal(sim: &Sim, alias: &str) -> Option<usize> {
    let n: usize = alias.strip_prefix('p')?.parse().ok()?;
    (0..3).find(|i| sim.w.players[*i].id == player(*i) && *i == n)
}
fn status_name(status: crate::state::Status) -> &'static str {
    match status {
        crate::state::Status::Alive => "alive",
        crate::state::Status::Dead => "dead",
        crate::state::Status::Mia => "mia",
        crate::state::Status::Lobby => "lobby",
    }
}
fn quest_status(status: QuestStatus) -> &'static str {
    match status {
        QuestStatus::Open => "open",
        QuestStatus::Done => "done",
        QuestStatus::Expired => "expired",
    }
}
fn weapon_name(value: Option<crate::WeaponId>) -> &'static str {
    value.map_or("", crate::WeaponId::as_str)
}
fn approx(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-6
}
fn json_num(value: &serde_json::Value) -> f64 {
    value.as_f64().expect("source number")
}
fn rust_offer_index(sim: &Sim, def: &str) -> usize {
    let def_index = catalog::DEFINITION
        .iter()
        .position(|d| d.id == def)
        .unwrap_or_else(|| panic!("catalog def {def}")) as u16;
    sim.w
        .quests
        .as_ref()
        .expect("quest runtime")
        .offers
        .iter()
        .position(|o| o.def == def_index)
        .unwrap_or_else(|| panic!("rust offer {def}"))
}
fn config(case: &serde_json::Value) -> SimConfig {
    let c = &case["input"]["config"];
    SimConfig {
        min_players: c["minPlayers"].as_u64().unwrap() as usize,
        lobby_seconds: json_num(&c["lobbySeconds"]),
        fill_seconds: json_num(&c["fillSeconds"]),
        pvp_rules: c["pvpRules"].as_bool().unwrap_or(false),
        lifecycle: crate::ArenaMode::Source(crate::systems::arena_rules::ArenaRules {
            plan_seconds: c["planSeconds"].as_f64().unwrap_or(0.),
            first_patience_seconds: None,
            coliseum_schedule: None,
            patience_seconds: c["patienceSeconds"].as_f64().unwrap_or(300.),
            patience_min_seconds: c["patienceMinSeconds"].as_f64().unwrap_or(120.),
            sudden_death_seconds: c["suddenDeathSeconds"].as_f64().unwrap_or(60.),
        }),
        abilities: crate::abilities::Mode::Full,
        hazards: crate::terrain::Mode::Map,
        mob_mode: if c["mobs"].as_bool().unwrap_or(false) {
            crate::mob_runtime::MobMode::Pve
        } else {
            crate::mob_runtime::MobMode::Off
        },
        quests: c["quests"].as_bool().unwrap_or(false),
        training: c["training"].as_bool().unwrap_or(false),
        dummies: c["dummies"].as_bool().unwrap_or(false),
        faction_mode: crate::statics::FactionMode::Off,
        walk_hints: Some(
            case["input"]["options"]["walkHints"]
                .as_bool()
                .unwrap_or(false),
        ),
        // The capture's unchanged source constructor uses the normal initial world; native admission needs explicit
        // MVP storage for those nonempty objects.
        initial_loot: true,
        ..Default::default()
    }
}
fn setup(case: &serde_json::Value) -> Sim {
    let input = &case["input"];
    let secrets = Secrets {
        order_salt: input["orderSalt"].as_u64().unwrap() as u32,
        // Source startRaid's shuffled spawn assignment draws from source world.random (randomSeed); the separate
        // captured spawnSeed field is not that stream. The native replacement for this stream is Secrets.spawn_seed.
        spawn_seed: input["randomSeed"].as_u64().unwrap() as u32,
        reward_salt: serde_json::from_value(input["rewardSalt"].clone()).unwrap(),
    };
    // Normal constructor/join/first-step path: captured initial positions and HP are constructor OUTPUTS, not
    // placement overrides. A mismatch here is a real constructor discrepancy and must not be hidden.
    let mut sim = Sim::new(config(case), arena(), secrets);
    for seat in input["seats"].as_array().unwrap() {
        let name = seat["name"].as_str().unwrap();
        let faction = FactionId::parse(seat["faction"].as_str().unwrap()).unwrap();
        let bot = seat["bot"].as_bool().unwrap();
        assert!(
            sim.add_player(name, Some(faction), bot).is_some(),
            "source seat joins"
        );
    }
    sim.step();
    assert_eq!(
        sim.w.phase,
        crate::state::Phase::Active,
        "ordinary first step activates the source run"
    );
    sim
}
fn place(sim: &mut Sim, alias: &str, x: f64, y: f64) {
    let i = ordinal(sim, alias).unwrap();
    let now = sim.w.server_time;
    let p = &mut sim.w.players[i];
    p.body.x = x;
    p.body.y = y;
    p.body.facing = 0.;
    p.body.history.reset(crate::state::Sample { t: now, x, y });
}
fn set_weapon(sim: &mut Sim, alias: &str, weapon: &str) {
    let parsed = crate::WeaponId::parse(weapon).expect("captured weapon");
    let i = ordinal(sim, alias).unwrap();
    let p = &mut sim.w.players[i];
    p.weapon.weapon0 = Some(parsed);
    p.weapon.weapon1 = None;
    p.weapon.slot = 0;
}
fn rust_def_for_source_offer(case: &serde_json::Value, source_id: &str) -> String {
    for frame in case["frames"].as_array().unwrap() {
        for offer in frame["offers"].as_array().unwrap() {
            if offer["id"].as_str() == Some(source_id) {
                return offer["def"].as_str().unwrap().to_string();
            }
        }
    }
    panic!("source offer id {source_id} not in frames")
}
fn b36(mut n: u32) -> String {
    let mut bytes = Vec::new();
    loop {
        let d = (n % 36) as u8;
        bytes.push(if d < 10 { b'0' + d } else { b'a' + d - 10 });
        n /= 36;
        if n == 0 {
            break;
        }
    }
    bytes.reverse();
    String::from_utf8(bytes).unwrap()
}
fn bind_mob(sim: &Sim, source_id: &str) -> PlayerId {
    let suffix = source_id.strip_prefix("mob").expect("source mob id");
    sim.w
        .actor_history
        .iter()
        .find_map(|a| {
            let serial = match a.origin {
                crate::mob_runtime::ActorOrigin::Mob { birth_serial, .. } => Some(birth_serial),
                _ => None,
            }?;
            (b36(serial) == suffix).then_some(a.id)
        })
        .unwrap_or_else(|| {
            panic!("captured source actor {source_id} resolves by real birth identity")
        })
}
fn validate_source_mob(
    sim: &Sim,
    id: PlayerId,
    region: &str,
    ty: &str,
    camp_one_based: u32,
    elite: bool,
    pose: Vec2,
) {
    let m = sim
        .w
        .mobs
        .get(id)
        .expect("bound source mob is a native mob");
    assert_eq!(
        m.status,
        crate::state::Status::Alive,
        "source mob alive {id:?}"
    );
    assert_eq!(
        m.mob_type
            .and_then(|ty| crate::mob_catalog::mob_type_by_id(ty.as_str()))
            .map(|d| d.zone.as_str()),
        Some(region),
        "source mob catalog zone {id:?}"
    );
    assert_eq!(
        m.mob_type,
        crate::mob_catalog::MobTypeId::parse(ty),
        "source mob type {id:?}"
    );
    assert_eq!(m.elite, elite, "source mob elite {id:?}");
    assert_eq!(
        m.camp + 1,
        camp_one_based,
        "source camp is one-based, native regional camp zero-based"
    );
    assert!(
        approx(m.core.body.x, pose.x) && approx(m.core.body.y, pose.y),
        "captured pose for {id:?}: native=({},{}) source=({},{})",
        m.core.body.x,
        m.core.body.y,
        pose.x,
        pose.y
    );
}
fn locate_mob(
    sim: &Sim,
    source_id: &str,
    region: &str,
    ty: &str,
    camp: u32,
    elite: bool,
    pose: Vec2,
) -> PlayerId {
    let id = bind_mob(sim, source_id);
    validate_source_mob(sim, id, region, ty, camp, elite, pose);
    id
}

fn apply_action(
    sim: &mut Sim,
    case: &serde_json::Value,
    action: &serde_json::Value,
    pending: &mut Vec<Event>,
) {
    match action["kind"].as_str().unwrap() {
        "place" => place(
            sim,
            action["actor"].as_str().unwrap(),
            json_num(&action["x"]),
            json_num(&action["y"]),
        ),
        "weapon" => set_weapon(
            sim,
            action["actor"].as_str().unwrap(),
            action["weapon"].as_str().unwrap(),
        ),
        "mobHp" => {
            let m = &action["mob"];
            let pose = Vec2::new(json_num(&m["x"]), json_num(&m["y"]));
            let id = locate_mob(
                sim,
                m["id"].as_str().unwrap(),
                m["region"].as_str().unwrap(),
                m["type"].as_str().unwrap(),
                m["camp"].as_u64().unwrap() as u32,
                m["elite"].as_bool().unwrap(),
                pose,
            );
            let ix = sim.w.fighter_idx(id).expect("mob fighter");
            let hp = json_num(&action["hp"]);
            sim.w.mobs.get_mut(id).unwrap().core.vitals.hp = hp;
            assert!(sim.w.core(ix).vitals.hp == hp);
        }
        "wipeExceptRegions" => {
            let keep: Vec<&str> = action["keepRegions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_str().unwrap())
                .collect();
            // The declared batch is out-of-step, but attribution is not installed: each target is killed by the
            // real mob producer, which folds the victim's existing brain threat and pays the resulting credited award.
            for target in action["targets"].as_array().unwrap() {
                let region = target["region"].as_str().unwrap();
                assert!(
                    !keep.contains(&region),
                    "fixture target is outside keepRegions"
                );
                let at = Vec2::new(json_num(&target["at"]["x"]), json_num(&target["at"]["y"]));
                let id = locate_mob(
                    sim,
                    target["id"].as_str().unwrap(),
                    region,
                    target["type"].as_str().unwrap(),
                    target["camp"].as_u64().unwrap() as u32,
                    target["elite"].as_bool().unwrap(),
                    at,
                );
                let ix = sim.w.fighter_idx(id).expect("mob fighter");
                let hp = sim.w.core(ix).vitals.hp;
                assert!(hp > 0., "target already dead");
                let hit = crate::systems::ledger::Hit {
                    terrain: false,
                    amount: hp,
                    by: None,
                    name: None,
                };
                let mut direct = Vec::new();
                let removed =
                    crate::systems::mob_life::hurt(&sim.k, &mut sim.w, &mut direct, ix, &[hit]);
                assert!(removed > 0., "real producer kills target");
                crate::systems::ledger::pay_all(&sim.k, &mut sim.w, &mut direct, &mut sim.pf);
                pending.extend(direct);
            }
            assert!(!sim.w.pay.collecting);
            // Every direct event remains held for the next ordinary step, exactly like source world.events.
        }
        "input" => {
            let actor = ordinal(sim, action["actor"].as_str().unwrap()).unwrap();
            let payload = &action["payload"];
            let raw = match action["type"].as_str().unwrap() {
                "questAccept" => {
                    let source_id = payload["quest"].as_str().unwrap();
                    let def = rust_def_for_source_offer(case, source_id);
                    let oi = rust_offer_index(sim, &def);
                    RawCommand::QuestAccept {
                        quest_id: Some(sim.w.quests.as_ref().unwrap().offers[oi].id),
                    }
                }
                "attack" => RawCommand::Attack {
                    a: json_num(&payload["a"]),
                    t: None,
                },
                "release" => RawCommand::Release {
                    a: json_num(&payload["a"]),
                    t: None,
                },
                other => panic!("unexpected captured input {other}"),
            };
            sim.submit(
                player(actor),
                validate(raw).expect("valid captured command"),
            )
            .expect("accepted captured input");
        }
        other => panic!("unexpected captured action {other}"),
    }
}
fn native_notice(event: &Event, tick: u32, time: f64) -> Option<serde_json::Value> {
    match event {
        Event::Toast { to, text } => Some(serde_json::json!({
            "tick": tick, "time": time,
            "event": {"type": "toast", "to": to.map(|id| format!("p{}", id.0 - 1)), "text": text}
        })),
        Event::Gv {
            id,
            amount,
            reason: GvReason::Quest,
        } => Some(serde_json::json!({
            "tick": tick, "time": time,
            "event": {"type": "gv", "id": format!("p{}", id.0 - 1), "amount": amount, "reason": "quest"}
        })),
        Event::PotionNotice { id, notice } => Some(serde_json::json!({
            "tick": tick, "time": time,
            "event": {"type": "toast", "to": format!("p{}", id.0 - 1), "text": notice.message()}
        })),
        _ => None,
    }
}
fn record_notices(events: &[Event], tick: u32, time: f64, out: &mut Vec<serde_json::Value>) {
    for event in events {
        if let Some(notice) = native_notice(event, tick, time) {
            out.push(notice);
        }
    }
}
fn source_notice_prefix(case: &serde_json::Value, tick: u32) -> Vec<serde_json::Value> {
    case["notices"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["tick"].as_u64().unwrap() <= tick as u64)
        .cloned()
        .collect()
}
fn notices_match(got: &[serde_json::Value], want: &[serde_json::Value]) -> bool {
    got.len() == want.len()
        && got.iter().zip(want).all(|(a, b)| {
            a["tick"] == b["tick"]
                && (a["time"].as_f64().unwrap() - b["time"].as_f64().unwrap()).abs() <= 1e-9
                && a["event"] == b["event"]
        })
}
fn source_public_visits(value: &serde_json::Value) -> Vec<String> {
    match value {
        serde_json::Value::String(text) => {
            let mut z: Vec<String> = text
                .split(',')
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
            z.sort();
            z
        }
        serde_json::Value::Number(n) if n.as_u64() == Some(0) => Vec::new(),
        other => panic!("source visitedRegions is string or absent numeric zero, got {other:?}"),
    }
}
fn native_giver_present(sim: &Sim, offer: &super::live::Offer) -> bool {
    offer.giver.is_some_and(|id| {
        sim.w
            .mobs
            .get(id)
            .is_some_and(|m| m.status == crate::state::Status::Alive)
    })
}
fn native_containers_present(sim: &Sim, offer: &super::live::Offer) -> bool {
    offer
        .containers
        .iter()
        .all(|id| sim.w.containers.iter().any(|c| c.id == *id))
}
fn visits_from_mask(mask: u8) -> Vec<String> {
    ["fire", "sentenced", "plague", "frost", "holy"]
        .iter()
        .enumerate()
        .filter(|(i, _)| mask & (1 << i) != 0)
        .map(|(_, z)| z.to_string())
        .collect()
}
fn source_visits(source: &serde_json::Value, alias: &str) -> Vec<String> {
    source
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p[0].as_str() == Some(alias))
        .map(|p| {
            let mut z: Vec<String> = p[1]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_str().unwrap().to_string())
                .collect();
            z.sort();
            z
        })
        .unwrap_or_default()
}
fn compare_offer(
    case: &serde_json::Value,
    frame: &serde_json::Value,
    sim: &Sim,
    source: &serde_json::Value,
) {
    let def = source["def"].as_str().unwrap();
    let oi = rust_offer_index(sim, def);
    let got = &sim.w.quests.as_ref().unwrap().offers[oi];
    assert_eq!(
        quest_status(got.status),
        source["status"].as_str().unwrap(),
        "offer {def} status at {}",
        frame["label"]
    );
    assert_eq!(
        got.published,
        source["published"].as_bool().unwrap(),
        "offer {def} published"
    );
    assert_eq!(
        got.publish_at,
        json_num(&source["publishAt"]),
        "offer {def} publishAt"
    );
    assert_eq!(
        got.expires_at,
        json_num(&source["expiresAt"]),
        "offer {def} expiresAt"
    );
    assert_eq!(
        got.closed_at,
        json_num(&source["closedAt"]),
        "offer {def} closedAt"
    );
    assert_eq!(
        native_giver_present(sim, got),
        source["giverPresent"].as_bool().unwrap(),
        "offer {def} giverPresent"
    );
    assert_eq!(
        got.containers.len(),
        source["containers"].as_array().unwrap().len(),
        "offer {def} containers"
    );
    assert!(
        native_containers_present(sim, got),
        "offer {def} actual containers exist"
    );
    let want: Vec<(usize, u32)> = source["progress"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p[0].as_str().unwrap()[1..].parse().unwrap(),
                p[1].as_u64().unwrap() as u32,
            )
        })
        .collect();
    let mut gotp: Vec<(usize, u32)> = got
        .progress
        .iter()
        .map(|(id, n)| ((id.0 - 1) as usize, *n))
        .collect();
    gotp.sort();
    let mut wantp = want;
    wantp.sort();
    assert_eq!(gotp, wantp, "offer {def} progress");
    for (alias, zones) in source["visits"].as_array().unwrap().iter().map(|p| {
        (
            p[0].as_str().unwrap(),
            source_visits(&source["visits"], p[0].as_str().unwrap()),
        )
    }) {
        let ord: usize = alias[1..].parse().unwrap();
        let mask = got
            .visits
            .iter()
            .find(|(id, _)| *id == player(ord))
            .map_or(0, |(_, m)| *m);
        assert_eq!(visits_from_mask(mask), zones, "offer {def} visits {alias}");
    }
    let want_alias = source["doneBy"].as_str().unwrap_or("");
    assert_eq!(
        got.done_by
            .map(|id| format!("p{}", id.0 - 1))
            .unwrap_or_default(),
        want_alias,
        "offer {def} doneBy"
    );
    assert_eq!(
        got.carrier
            .map(|id| format!("p{}", id.0 - 1))
            .unwrap_or_default(),
        source["carrier"].as_str().unwrap(),
        "offer {def} carrier"
    );
    let at = &source["at"];
    assert!(
        approx(got.at.x, json_num(&at["x"])) && approx(got.at.y, json_num(&at["y"])),
        "offer {def} at"
    );
    let parcel = source["parcel"]
        .as_object()
        .map(|p| Vec2::new(json_num(&p["x"]), json_num(&p["y"])));
    assert_eq!(got.parcel, parcel, "offer {def} parcel");
    let tokens: Vec<Vec2> = source["tokens"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| Vec2::new(json_num(&p["x"]), json_num(&p["y"])))
        .collect();
    assert_eq!(got.tokens, tokens, "offer {def} tokens");
    let _ = case;
}
fn compare_frame(
    case: &serde_json::Value,
    frame: &serde_json::Value,
    sim: &Sim,
    notices: &[serde_json::Value],
    compare_pose: bool,
) {
    assert_eq!(sim.w.phase, crate::state::Phase::Active, "phase");
    assert_eq!(sim.w.tick, frame["tick"].as_u64().unwrap() as u32, "tick");
    assert_eq!(sim.w.server_time, json_num(&frame["time"]), "time");
    let def = case["input"]["quest"]["def"].as_str().unwrap();
    let oi = rust_offer_index(sim, def);
    let got = &sim.w.quests.as_ref().unwrap().offers[oi];
    let want = &frame["quest"];
    assert_eq!(
        quest_status(got.status),
        want["status"].as_str().unwrap(),
        "grand-tour status at {}",
        frame["label"]
    );
    assert_eq!(
        got.expires_at,
        json_num(&want["expiresAt"]),
        "grand-tour expiresAt"
    );
    assert_eq!(
        got.closed_at,
        json_num(&want["closedAt"]),
        "grand-tour closedAt"
    );
    assert_eq!(
        native_giver_present(sim, got),
        want["giverPresent"].as_bool().unwrap(),
        "grand-tour giverPresent"
    );
    assert_eq!(
        got.containers.len(),
        want["containers"].as_array().unwrap().len(),
        "grand-tour containers"
    );
    assert!(
        native_containers_present(sim, got),
        "grand-tour actual containers exist"
    );
    for (alias, zones) in want["visits"].as_array().unwrap().iter().map(|p| {
        (
            p[0].as_str().unwrap(),
            source_visits(&want["visits"], p[0].as_str().unwrap()),
        )
    }) {
        let ord: usize = alias[1..].parse().unwrap();
        let mask = got
            .visits
            .iter()
            .find(|(id, _)| *id == player(ord))
            .map_or(0, |(_, m)| *m);
        assert_eq!(visits_from_mask(mask), zones, "grand-tour visits {alias}");
    }
    let mut wantp: Vec<(usize, u32)> = want["progress"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p[0].as_str().unwrap()[1..].parse().unwrap(),
                p[1].as_u64().unwrap() as u32,
            )
        })
        .collect();
    let mut gotp: Vec<(usize, u32)> = got
        .progress
        .iter()
        .map(|(id, n)| ((id.0 - 1) as usize, *n))
        .collect();
    wantp.sort();
    gotp.sort();
    assert_eq!(gotp, wantp, "grand-tour progress");
    for source in frame["offers"].as_array().unwrap() {
        compare_offer(case, frame, sim, source);
    }
    let mut supply = std::collections::BTreeMap::new();
    for region in ["fire", "sentenced", "plague", "frost", "holy"] {
        supply.insert(region.to_string(), 0u64);
    }
    for m in sim
        .w
        .mobs
        .iter()
        .filter(|m| m.status == crate::state::Status::Alive)
    {
        if let Some(def) = m
            .mob_type
            .and_then(|ty| crate::mob_catalog::mob_type_by_id(ty.as_str()))
        {
            *supply.entry(def.zone.as_str().to_string()).or_insert(0) += 1;
        }
    }
    for region in ["fire", "sentenced", "plague", "frost", "holy"] {
        assert_eq!(
            supply[region],
            frame["supply"][region].as_u64().unwrap(),
            "supply {region}"
        );
    }
    let mut want_supply_comp: Vec<(String, String, bool, u32)> = frame["liveMobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                m["region"].as_str().unwrap().to_string(),
                m["type"].as_str().unwrap().to_string(),
                m["elite"].as_bool().unwrap(),
                m["camp"].as_u64().unwrap() as u32,
            )
        })
        .collect();
    want_supply_comp.sort();
    let mut got_supply_comp: Vec<(String, String, bool, u32)> = sim
        .w
        .mobs
        .iter()
        .filter(|m| m.status == crate::state::Status::Alive)
        .filter_map(|m| {
            let ty = m.mob_type?;
            let def = crate::mob_catalog::mob_type_by_id(ty.as_str())?;
            Some((
                def.zone.as_str().to_string(),
                ty.as_str().to_string(),
                m.elite,
                m.camp + 1,
            ))
        })
        .collect();
    got_supply_comp.sort();
    assert_eq!(
        got_supply_comp, want_supply_comp,
        "full live supply composition at {}",
        frame["label"]
    );
    if frame["label"].as_str() == Some("real-camp-producer-before-recheck") {
        assert_eq!(
            frame["quest"]["progress"][0][1].as_u64(),
            Some(1),
            "captured pre-recheck progress"
        );
        assert_eq!(
            frame["quest"]["visits"][0][1][0].as_str(),
            Some("frost"),
            "captured pre-recheck visit"
        );
        assert_eq!(
            frame["recheck"].as_bool(),
            Some(true),
            "captured pre-recheck flag"
        );
    }
    for human in frame["humans"].as_array().unwrap() {
        let alias = human["id"].as_str().unwrap();
        let ord = ordinal(sim, alias).unwrap();
        let p = &sim.w.players[ord];
        assert_eq!(
            status_name(p.status),
            human["status"].as_str().unwrap(),
            "human {alias} status"
        );
        assert_eq!(
            human["down"].as_bool().unwrap(),
            p.down.is_some(),
            "human {alias} down"
        );
        assert_eq!(
            human["resolved"].as_bool().unwrap(),
            p.resolved,
            "human {alias} resolved"
        );
        assert!(
            approx(p.vitals.hp, json_num(&human["hp"])),
            "human {alias} hp {} vs {}",
            p.vitals.hp,
            human["hp"]
        );
        assert_eq!(
            weapon_name(p.weapon.weapon0),
            human["weapon0"].as_str().unwrap(),
            "human {alias} weapon0"
        );
        assert_eq!(
            weapon_name(p.weapon.weapon1),
            human["weapon1"].as_str().unwrap(),
            "human {alias} weapon1"
        );
        if compare_pose {
            assert!(
                approx(p.body.x, json_num(&human["x"])),
                "human {alias} x native {} source {}",
                p.body.x,
                human["x"]
            );
            assert!(
                approx(p.body.y, json_num(&human["y"])),
                "human {alias} y native {} source {}",
                p.body.y,
                human["y"]
            );
        }
        let gv = &human["gv"];
        assert_eq!(
            p.credit.gv_parts.kills,
            gv["kills"].as_u64().unwrap() as u32,
            "human {alias} gv.kills"
        );
        assert_eq!(
            p.credit.gv_parts.mobs,
            gv["mobs"].as_u64().unwrap() as u32,
            "human {alias} gv.mobs"
        );
        assert_eq!(
            p.credit.gv_parts.bounty,
            gv["bounty"].as_u64().unwrap() as u32,
            "human {alias} gv.bounty"
        );
        assert_eq!(
            p.credit.gv_parts.quest,
            gv["quest"].as_u64().unwrap() as u32,
            "human {alias} gv.quest"
        );
        let mut want_stats: Vec<(String, u64)> = human["mobStats"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p[0].as_str().unwrap().to_string(), p[1].as_u64().unwrap()))
            .collect();
        want_stats.sort();
        let mut got_stats: Vec<(String, u64)> = crate::mob_catalog::MobTypeId::ALL
            .iter()
            .filter_map(|ty| {
                let n = p.farm.count(*ty);
                (n > 0).then(|| (ty.as_str().to_string(), n))
            })
            .collect();
        got_stats.sort();
        assert_eq!(
            got_stats, want_stats,
            "human {alias} mobStats at {}",
            frame["label"]
        );
        assert_eq!(
            human["accepted"].as_bool().unwrap(),
            got.accepted.contains(&player(ord)),
            "human {alias} accepted"
        );
        assert_eq!(
            human["progress"].as_u64().unwrap() as u32,
            got.progress
                .iter()
                .find(|(id, _)| *id == player(ord))
                .map_or(0, |(_, n)| *n),
            "human {alias} progress"
        );
        let native_mask = got
            .visits
            .iter()
            .find(|(id, _)| *id == player(ord))
            .map_or(0, |(_, m)| *m);
        assert_eq!(
            source_public_visits(&human["visitedRegions"]),
            visits_from_mask(native_mask),
            "human {alias} public string/absent representation vs native mask"
        );
    }
    assert_eq!(
        sim.w
            .quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .filter(|o| !o.published)
            .count(),
        frame["unknown"].as_u64().unwrap() as usize,
        "unknown"
    );
    assert_eq!(
        sim.w.quests.as_ref().unwrap().recheck,
        frame["recheck"].as_bool().unwrap(),
        "recheck"
    );
    assert_eq!(
        notices.len(),
        frame["noticeCount"].as_u64().unwrap() as usize,
        "notice count at {}: native {:?}",
        frame["label"],
        notices
    );
    let expected_notices = source_notice_prefix(case, sim.w.tick);
    assert!(notices_match(notices, &expected_notices), "ordered notice payload/tick/recipient at {}: native {notices:?} source {expected_notices:?}", frame["label"]);
    assert_eq!(sim.w.phase, crate::state::Phase::Active, "active phase");
}
fn replay_case(case: &serde_json::Value) {
    let name = case["name"].as_str().unwrap();
    let initial = setup(case);
    for human in case["frames"][0]["humans"].as_array().unwrap() {
        let alias = human["id"].as_str().unwrap();
        let ord = ordinal(&initial, alias).unwrap();
        let p = &initial.w.players[ord];
        if !approx(p.body.x, json_num(&human["x"])) || !approx(p.body.y, json_num(&human["y"])) {
            eprintln!(
                "CONSTRUCTOR_POSE_MISMATCH {name} {alias}: native=({},{}) source=({},{})",
                p.body.x, p.body.y, human["x"], human["y"]
            );
        }
    }
    let expected = case["expectedStatus"].as_str().unwrap();
    let mut sim = initial;
    let actions = case["actions"].as_array().unwrap();
    let mut pending: Vec<Event> = Vec::new();
    let mut notices: Vec<serde_json::Value> = Vec::new();
    let mut ai = 0usize;
    let step_holding =
        |sim: &mut Sim, pending: &mut Vec<Event>, notices: &mut Vec<serde_json::Value>| {
            if !pending.is_empty() {
                sim.w.pending_events.append(pending);
            }
            let ev = sim.step();
            let tick = sim.w.tick;
            let time = sim.w.server_time;
            record_notices(&ev, tick, time, notices);
        };
    assert_eq!(sim.w.tick, 1);
    assert_eq!(sim.w.server_time, 50.);
    for frame in case["frames"].as_array().unwrap() {
        let target = frame["tick"].as_u64().unwrap() as u32;
        let want_actions = frame["actionCount"].as_u64().unwrap() as usize;
        while ai < want_actions {
            let action = &actions[ai];
            let tick = action["tick"].as_u64().unwrap() as u32;
            while sim.w.tick < tick {
                step_holding(&mut sim, &mut pending, &mut notices);
            }
            apply_action(&mut sim, case, action, &mut pending);
            ai += 1;
        }
        while sim.w.tick < target {
            step_holding(&mut sim, &mut pending, &mut notices);
        }
        compare_frame(case, frame, &sim, &notices, true);
    }
    let def = case["input"]["quest"]["def"].as_str().unwrap();
    let oi = rust_offer_index(&sim, def);
    let got = &sim.w.quests.as_ref().unwrap().offers[oi];
    assert_eq!(
        quest_status(got.status),
        expected,
        "{name}: final source status"
    );
    assert!(
        sim.w.players.iter().all(|p| p.credit.gv_parts.quest == 0),
        "{name}: no quest GV installed"
    );
}
#[test]
fn case_frost_visit_fire_holy_stays_open_replays_both_status_path() {
    let doc = load();
    replay_case(&doc["cases"][0]);
}
#[test]
fn case_frost_visit_frost_sentenced_expires_replays_both_status_path() {
    let doc = load();
    replay_case(&doc["cases"][1]);
}
