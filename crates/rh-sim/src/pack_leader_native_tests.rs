//! Pack Leader native29: replay the released genuine one-clear source tape through the ordinary native path.
//! The projection compares only the claimed facts (count/camp clear/deaths/order/later nonneutral player hit); the
//! declared card/bulk-stat bootstrap is setup only and no HP/death/clear/outgoing/cache/event is installed.
use crate::mob_runtime::MobMode;
use crate::statics::FactionMode;
use crate::{
    cards::CardId, validate, Arena, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim,
    SimConfig, Vec2, WeaponId,
};
use serde_json::Value;

const SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../parity/pack-leader/repair/source.json"
));
const BORN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tools/card-runtime-fixtures/born-input.json"
));

fn source() -> Value {
    serde_json::from_str(SOURCE).expect("released repaired source corpus")
}

fn arena() -> Arena {
    let mut map: Value = serde_json::from_str(BORN).expect("born map fixture");
    // Exact source `makeMap` born/holy transform (setup only).
    let other = map["regions"]
        .as_array()
        .unwrap()
        .iter()
        .position(|r| r["id"] == "holy")
        .expect("holy region");
    {
        let regions = map["regions"].as_array_mut().unwrap();
        let fire_id = regions[0]["id"].clone();
        regions[0]["id"] = Value::String("holy".into());
        regions[other]["id"] = fire_id;
        if let Some(camps) = regions[0]["mobCamps"].as_array_mut() {
            for camp in camps {
                camp["id"] = Value::String("holy-1".into());
                camp["region"] = Value::String("holy".into());
                camp["weapon"] = Value::String("wand".into());
            }
        }
        let tmp = regions[0].clone();
        regions[0] = regions[other].clone();
        regions[other] = tmp;
        let spawns: Vec<Value> = regions
            .iter()
            .flat_map(|r| r["spawns"].as_array().cloned().unwrap_or_default())
            .collect();
        map["spawns"] = Value::Array(spawns);
    }
    for p in map["spawnPool"].as_array_mut().unwrap() {
        let zone = p["zone"].as_str().unwrap_or("fire");
        p["zone"] = Value::String(
            if zone == "fire" {
                "holy"
            } else if zone == "holy" {
                "fire"
            } else {
                zone
            }
            .into(),
        );
    }
    let mapped: Vec<Value> = map["regionGrid"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let n = v.as_u64().unwrap();
            Value::from(if n == 1 {
                other as u64 + 1
            } else if n == other as u64 + 1 {
                1
            } else {
                n
            })
        })
        .collect();
    map["regionGrid"] = Value::Array(mapped);
    map["camps"][0]["zone"] = Value::String("holy".into());
    map["camps"][0]["id"] = Value::String("holy-1".into());
    let data: crate::mapdata::GameMapData = serde_json::from_value(map).expect("born map data");
    let hash = u32::from_str_radix(&crate::mapgen::map_hash::map_hash(&data), 16).unwrap();
    let v = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map: data,
    }
    .validate()
    .expect("born map validates");
    let (w, h, t, l) = v.into_parts();
    let spawns = l
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Arena {
        map: crate::TileMap::new(w, h, t)
            .unwrap()
            .with_layers(std::sync::Arc::new(l))
            .unwrap(),
        spawns,
    }
}

fn card(name: &str) -> CardId {
    match name {
        "packLeader" => CardId::PackLeader,
        "bigGameHunter" => CardId::BigGameHunter,
        "thickSkull" => CardId::ThickSkull,
        "secondWind" => CardId::SecondWind,
        "siphon" => CardId::Siphon,
        "ap3" => CardId::Ap3,
        "vitality3" => CardId::Vitality3,
        "armor3" => CardId::Armor3,
        "mr3" => CardId::Mr3,
        other => panic!("declared bootstrap card {other}"),
    }
}

fn build() -> (Sim, Vec<PlayerId>) {
    let doc = source();
    let input = &doc["input"];
    let players = input["players"].as_array().unwrap();
    let placements: Vec<Placement> = players
        .iter()
        .map(|p| Placement {
            profile: p["faction"].as_str().unwrap().to_uppercase(),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(
                p["at"]["x"].as_f64().unwrap(),
                p["at"]["y"].as_f64().unwrap(),
            ),
            hp: None,
            weapon0: p["weapon"].as_str().and_then(WeaponId::parse),
            weapon1: None,
        })
        .collect();
    let config = SimConfig {
        abilities: crate::abilities::Mode::Full,
        initial_loot: true,
        consumables: true,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        mob_mode: MobMode::Pve,
        quests: true,
        min_players: players.len(),
        fill_seconds: 0.,
        ..Default::default()
    };
    let seed = input["mainSeed"].as_u64().unwrap() as u32;
    let mut main = crate::rng::Mulberry32::new(seed);
    let secrets = Secrets {
        order_salt: main.next_u32(),
        spawn_seed: seed,
        reward_salt: [1, 2, 3, 4],
    };
    let mut sim = Sim::reset_active(config, arena(), secrets, &placements);
    for (p, slot) in players.iter().zip(0u32..) {
        if let Some(cards) = p["cards"].as_array() {
            for name in cards {
                assert!(crate::cards::grant(
                    &sim.k,
                    &mut sim.w,
                    PlayerId(slot + 1),
                    card(name.as_str().unwrap())
                ));
            }
        }
    }
    let mobs: Vec<PlayerId> = sim.mobs().iter().map(|m| m.core.id).collect();
    assert_eq!(mobs.len(), 3, "source camp roster");
    (sim, mobs)
}

fn submit(sim: &mut Sim, raw: RawCommand) {
    sim.submit(PlayerId(1), validate(raw).unwrap()).unwrap();
}

struct Facts {
    step: u64,
    reward_before: Vec<(u64, Vec<f64>)>,
    reward_after_build: Vec<f64>,
    landed: Vec<(u64, f64, String, f64, String)>,
    pre_counts: Vec<(u64, u16)>,
    deaths: Vec<(u64, PlayerId)>,
    clear: Option<(u64, f64)>,
    later: Option<(u64, f64, f64)>,
}

fn advance(sim: &mut Sim, f: &mut Facts) {
    let next_step = f.step + 1;
    let burst = match next_step {
        146 => Some(6usize),
        181 => Some(7usize),
        341 => Some(7usize),
        _ => None,
    };
    if let Some(n) = burst {
        let mut r = sim.w.reward_rng.clone();
        f.reward_before
            .push((next_step, (0..n).map(|_| r.next_f64()).collect()));
    }
    f.pre_counts
        .push((f.step + 1, sim.players()[0].camps_cleared));
    let events = sim.step();
    f.step += 1;
    for e in events {
        if let crate::events::Event::CampCleared { camp } = e {
            if f.clear.is_none() {
                assert_eq!(camp, 0, "the source's single camp");
                f.clear = Some((f.step, sim.server_time()));
            }
        }
    }
    for m in sim.mobs() {
        if m.status == crate::state::Status::Dead
            && !f.deaths.iter().any(|(_, id)| *id == m.core.id)
        {
            f.deaths.push((f.step, m.core.id));
        }
    }
    for h in sim.s.landed.iter() {
        if h.by == Some(PlayerId(1)) && h.amount > 0. {
            f.landed.push((
                f.step,
                sim.server_time(),
                h.victim.0.to_string(),
                h.amount,
                h.weapon
                    .map(|w| format!("{w:?}").to_lowercase())
                    .unwrap_or_default(),
            ));
        }
        if h.by == Some(PlayerId(1))
            && h.victim == PlayerId(2)
            && h.amount > 0.
            && f.later.is_none()
        {
            f.later = Some((f.step, sim.server_time(), h.amount));
        }
    }
}

#[test]
fn the_genuine_source_tape_produces_the_native_camp_count_and_later_player_damage() {
    let doc = source();
    let witness = &doc["witness"];
    let expected_clear = witness["clearTick"].as_u64().unwrap();
    let expected_clear_time = witness["clearTime"].as_f64().unwrap();
    let later = &witness["laterHit"];
    let expected_hit_tick = later["tick"].as_u64().unwrap();
    let expected_hit_time = later["time"].as_f64().unwrap();
    let expected_amount = later["amount"].as_f64().unwrap();
    let camp_mobs: Vec<String> = witness["campMobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m.as_str().unwrap().into())
        .collect();
    // The source's own real death ticks (fighterOut hooks of the camp members), from the immutable tape.
    let mut expected_deaths: Vec<u64> = Vec::new();
    for h in doc["result"]["completeOrdinaryHookTape"]
        .as_array()
        .unwrap()
    {
        for k in h["hooks"].as_array().unwrap() {
            if k["hook"] == "fighterOut"
                && k["kind"] == "arguments"
                && k["args"][0]
                    .as_str()
                    .is_some_and(|a| camp_mobs.iter().any(|m| m == a))
            {
                let tick = h["tick"].as_u64().unwrap();
                if !expected_deaths.contains(&tick) {
                    expected_deaths.push(tick);
                }
            }
        }
    }
    expected_deaths.sort_unstable();

    let (mut sim, mobs) = build();
    println!(
        "build: p0 at {:?} weapon {:?} mobs {:?}",
        (sim.players()[0].body.x, sim.players()[0].body.y),
        sim.players()[0].active_weapon(),
        sim.mobs()
            .iter()
            .map(|m| (m.core.id, m.core.pos(), m.status))
            .collect::<Vec<_>>()
    );
    let mut f = Facts {
        step: 1,
        reward_before: Vec::new(),
        reward_after_build: {
            let mut r = sim.w.reward_rng.clone();
            (0..6).map(|_| r.next_f64()).collect()
        },
        landed: Vec::new(),
        pre_counts: Vec::new(),
        deaths: Vec::new(),
        clear: None,
        later: None,
    };
    // action 0: ordinary target of the first birth camp member (the source's @m0).
    submit(&mut sim, RawCommand::Target { id: mobs[0] });
    advance(&mut sim, &mut f);
    for k in 0..300 {
        advance(&mut sim, &mut f);
        if k == 20 {
            println!(
                "at step {}: p0 pos {:?} weapon {:?} target {:?} held {} action {:?} mobs {:?}",
                f.step,
                (sim.players()[0].body.x, sim.players()[0].body.y),
                sim.players()[0].active_weapon(),
                sim.players()[0].weapon.targeting.target,
                sim.players()[0].weapon.held,
                sim.players()[0].weapon.action,
                sim.mobs()
                    .iter()
                    .map(|m| (m.core.id, m.core.pos(), m.core.vitals.hp, m.status))
                    .collect::<Vec<_>>()
            );
        }
    }
    // action 2: ordinary target of the later-damage witness player.
    submit(&mut sim, RawCommand::Target { id: PlayerId(2) });
    advance(&mut sim, &mut f);
    for _ in 0..80 {
        advance(&mut sim, &mut f);
    }
    submit(&mut sim, RawCommand::Release { a: 0., t: None });
    advance(&mut sim, &mut f);

    println!(
        "native facts: steps={} clear={:?} deaths={:?} later={:?} count={} rosters={:?} expected: clear {}/{} deaths {:?} later {}/{}/{}",
        f.step,
        f.clear,
        f.deaths,
        f.later,
        sim.players()[0].camps_cleared,
        sim.camp_rosters().iter().map(|r| (r.state, r.alive)).collect::<Vec<_>>(),
        expected_clear, expected_clear_time, expected_deaths, expected_hit_tick, expected_hit_time, expected_amount
    );
    assert_eq!(f.step, 384, "the tape's 384 ordinary steps");
    assert_eq!(
        sim.players()[0].camps_cleared,
        1,
        "real native camp clear count"
    );
    assert_eq!(
        f.clear,
        Some((expected_clear, expected_clear_time)),
        "source camp clear ordering"
    );
    assert_eq!(
        f.deaths.iter().map(|(t, _)| *t).collect::<Vec<_>>(),
        expected_deaths,
        "source camp-member death order/ticks"
    );
    let pre_clear = f
        .pre_counts
        .iter()
        .find(|(step, _)| *step == expected_clear)
        .map(|(_, count)| *count)
        .expect("the clear step's pre-step sample");
    assert_eq!(
        pre_clear, 0,
        "the clear pass used the pre-clear canonical count"
    );
    let (hit_tick, hit_time, amount) = f.later.expect("a genuine later p0 -> p1 ordinary hit");
    assert_eq!((hit_tick, hit_time), (expected_hit_tick, expected_hit_time));
    assert!(
        (amount - expected_amount).abs() < 1e-9,
        "later ordinary wand hit {amount} != source {expected_amount}"
    );
    assert_eq!(
        sim.secrets_for_replay().reward_salt,
        [1, 2, 3, 4],
        "declared source reward RNG setup"
    );

    // Ordered relevant source `hitLanded` argument records: p0 -> the three camp members or p1, with tick/time/victim/
    // amount/weapon; 338 records in the immutable capture (chunks included), compared in order, no set/totals reduction.
    let source_hits: Vec<(u64, f64, String, f64, String)> = doc["result"]["completeOrdinaryHookTape"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|h| h["hooks"].as_array().unwrap().iter().filter_map(|k| {
            if k["hook"] != "hitLanded" || k["kind"] != "arguments" { return None; }
            let a = &k["args"][0];
            let by = a["by"]["id"].as_str().unwrap_or("");
            let victim = a["victim"].as_str().unwrap_or("");
            if by != "p0" || !["mob1", "mob2", "mob3", "p1"].contains(&victim) { return None; }
            Some((h["tick"].as_u64().unwrap(), h["time"].as_f64().unwrap(), victim.to_string(), k["args"][1].as_f64().unwrap(), a["weapon"].as_str().unwrap_or("").to_string()))
        }))
        .collect();
    let mob_names: Vec<String> = witness["campMobs"].as_array().unwrap().iter().map(|m| m.as_str().unwrap().into()).collect();
    let native_hits: Vec<(u64, f64, String, f64, String)> = f.landed.iter().map(|(tick, time, victim, amount, weapon)| {
        let id: u32 = victim.parse().unwrap();
        let name = if id == 2 { "p1".to_string() } else {
            let ix = mobs.iter().position(|m| m.0 == id).expect("native camp member");
            mob_names[ix].clone()
        };
        (*tick, *time, name, *amount, weapon.clone())
    }).collect();
    assert_eq!(source_hits.len(), 338, "captured relevant hitLanded argument records");
    assert_eq!(native_hits.len(), source_hits.len(), "ordered relevant landed chunks");
    // Normalization of the one established typed projection difference: on a FATAL pass the native LandedHit/death-floor
    // representation clips every chunk of that victim's pass proportionally to remaining HP, while source hitLanded args
    // record the unclipped landed amounts. Nonfatal chunks must match exactly; fatal groups compare by the same ratio.
    let mut i = 0usize;
    while i < source_hits.len() {
        let (tick, _t, ref victim, _, _) = source_hits[i];
        let mut j = i;
        while j < source_hits.len() && source_hits[j].0 == tick && source_hits[j].2 == *victim { j += 1; }
        let source_group = &source_hits[i..j];
        let native_group = &native_hits[i..j];
        assert_eq!(native_group.len(), source_group.len());
        let is_fatal = source_group.iter().map(|r| r.3).sum::<f64>() > native_group.iter().map(|r| r.3).sum::<f64>() + 1e-9;
        if is_fatal {
            let s_sum: f64 = source_group.iter().map(|r| r.3).sum();
            let n_sum: f64 = native_group.iter().map(|r| r.3).sum();
            for (want, got) in source_group.iter().zip(native_group.iter()) {
                let scaled = want.3 * n_sum / s_sum;
                assert!((got.3 - scaled).abs() < 1e-9, "fatal-group normalized amount mismatch tick {} victim {}", tick, victim);
            }
        } else {
            for (want, got) in source_group.iter().zip(native_group.iter()) {
                assert_eq!(got, want, "nonfatal relevant landed record mismatch");
            }
        }
        i = j;
    }
    // Exact lifecycle facts from the same ordered tape.
    let source_deaths: Vec<(u64, String, String)> = doc["result"]["completeOrdinaryHookTape"].as_array().unwrap().iter().flat_map(|h| h["hooks"].as_array().unwrap().iter().filter_map(|k| {
        (k["hook"] == "fighterOut" && k["kind"] == "arguments").then(|| (h["tick"].as_u64().unwrap(), k["args"][0].as_str().unwrap().to_string(), k["args"][1].as_str().unwrap().to_string()))
    })).collect();
    let native_deaths: Vec<(u64, String, String)> = f.deaths.iter().map(|(tick, id)| {
        let ix = mobs.iter().position(|m| *m == *id).expect("native camp death");
        (*tick, mob_names[ix].clone(), "down".to_string())
    }).collect();
    assert_eq!(native_deaths, source_deaths, "ordered fighterOut lifecycle facts");

    // Actual live RNG boundary states against the immutable captured randomTape. Reward burst boundaries in the filtered
    // reward sequence are lobby[0..9), tick1[9..16), tick146[16..22), tick181[22..29), tick341[29..36). Construction
    // consumes constructor main draw plus the lobby reward burst; after the birth step the live reward stream must continue
    // at the tick146 burst, and the same stream must reach the later bursts in order. Main: the source constructor main draw
    // fixes order_salt; the native spawn stream is a separate seeded stream (declared setup projection), so no source main
    // tick1 draws are claimed as spawn-stream continuation.
    let source_reward: Vec<f64> = doc["result"]["randomTape"].as_array().unwrap().iter()
        .filter(|d| d["stream"] == "reward").map(|d| d["value"].as_f64().unwrap()).collect();
    let source_main: Vec<f64> = doc["result"]["randomTape"].as_array().unwrap().iter()
        .filter(|d| d["stream"] == "main").map(|d| d["value"].as_f64().unwrap()).collect();
    assert!((f64::from(sim.secrets_for_replay().order_salt) / 4_294_967_296.0 - source_main[0]).abs() < 1e-12,
        "source constructor main draw fixes native order_salt");
    let align = |values: &[f64]| -> Option<usize> {
        source_reward.windows(values.len()).position(|w| w == values)
    };
    assert_eq!(align(&f.reward_after_build), Some(16), "live reward stream continues at the source tick146 burst after birth");
    for (step, values) in &f.reward_before {
        let expected = match *step { 146 => 16, 181 => 22, 341 => 29, _ => unreachable!() };
        let got = align(values);
        assert_eq!(got, Some(expected), "live reward stream at source boundary tick {step}");
    }
    assert_eq!(source_reward.len(), 36, "the captured reward tape length");
    let mut live = sim.w.reward_rng.clone();
    let live_next: Vec<f64> = (0..3).map(|_| live.next_f64()).collect();
    assert_eq!(align(&live_next), None, "no captured source reward draws remain after the tick341 burst");

    // Clone/restore continue the same real produced state with ordinary input-free steps (no expected state installed).
    let mut cloned = sim.clone();
    let mut restored: Sim =
        Sim::restore(serde_json::to_value(&sim).unwrap()).expect("real produced state restores");
    let original_events = sim.step();
    assert_eq!(
        cloned.step(),
        original_events,
        "clone continues identically"
    );
    assert_eq!(
        restored.step(),
        original_events,
        "restore continues identically"
    );
    assert_eq!(sim.state_hash(), cloned.state_hash());
    assert_eq!(sim.state_hash(), restored.state_hash());
    assert_eq!(
        sim.players()[0].camps_cleared,
        cloned.players()[0].camps_cleared
    );
    assert_eq!(
        sim.players()[0].camps_cleared,
        restored.players()[0].camps_cleared
    );
}
