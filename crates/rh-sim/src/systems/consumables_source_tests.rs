//! Actual-source consumable proofs: `parity/consumables/source.json` (tools/consumable-fixtures/potions.ts).
//! The potion cases compare every tick's hp, both stocks, the heal clock and the Hot count; the camp cases compare the
//! reward's players, contributors and toasts.
use crate::hooks::{HookArgs, Hx};
use crate::mob_runtime::MobMode;
use crate::{Event, FactionId, PlayerId, Secrets, Sim, SimConfig, Vec2};
use serde_json::Value;

fn source() -> Value {
    serde_json::from_str(include_str!("../../../../parity/consumables/source.json")).unwrap()
}

fn num(v: &Value, k: &str) -> f64 {
    v[k].as_f64()
        .unwrap_or_else(|| panic!("{k} is not a number: {v}"))
}

fn potion_sim(max_hp_check: bool) -> Sim {
    use crate::{arenas::practice_arena, Placement};
    let ps: Vec<_> = (0..2)
        .map(|i| Placement {
            profile: format!("s{i}"),
            faction: if i == 0 {
                FactionId::Fire
            } else {
                FactionId::Holy
            },
            bot: false,
            at: Vec2::new(320.0 + 64.0 * i as f64, 320.0),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let sim = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(9),
        &ps,
    );
    if max_hp_check {
        assert_eq!(sim.w.players[0].vitals.max_hp, 950.0, "Fire max hp");
    }
    sim
}

fn use_command(sim: &mut Sim) {
    sim.submit(
        PlayerId(1),
        crate::validate(crate::RawCommand::UseConsumable).unwrap(),
    )
    .expect("the use is a valid order");
}

#[test]
fn potion_cases_match_the_source_tick_by_tick() {
    let src = source();
    let mut compared = 0usize;
    for case in src["potionCases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let max_hp = num(case, "maxHp");
        let trace = case["trace"].as_array().unwrap();
        let first = &trace[0];
        let mut sim = potion_sim(true);
        assert_eq!(sim.w.players[0].vitals.max_hp, max_hp, "{name}: max hp");
        sim.w.players[0].vitals.hp = num(first, "hp");
        // The probe's stocks before its one use (the trace starts after that use).
        let (large, small) = match name {
            "large-preferred" => (1u8, 2u8),
            "small-only" | "full-health" => (0, 1),
            "empty-bag" => (0, 0),
            "busy-three" => (0, 4),
            other => panic!("unhandled potion case {other}"),
        };
        sim.w.players[0].potion_large = large;
        sim.w.players[0].potion_small = small;
        // The case's presses queued for the first tick, exactly as the probe's intake did.
        for _ in 0..case["uses"].as_u64().unwrap() {
            use_command(&mut sim);
        }
        for (i, want) in trace.iter().enumerate() {
            let ev = sim.step();
            let p = &sim.w.players[0];
            assert_eq!(p.vitals.hp, num(want, "hp"), "{name} tick {i} hp");
            assert_eq!(
                u8::try_from(num(want, "potionLarge") as i64).unwrap(),
                p.potion_large,
                "{name} tick {i} camp stock"
            );
            assert_eq!(
                u8::try_from(num(want, "potionSmall") as i64).unwrap(),
                p.potion_small,
                "{name} tick {i} small stock"
            );
            assert_eq!(
                p.healing_until,
                num(want, "healingUntil"),
                "{name} tick {i} heal clock"
            );
            let hots = sim
                .w
                .potion_healing
                .iter()
                .find(|e| e.id == PlayerId(1))
                .map_or(0, |e| e.hots.len());
            assert_eq!(hots as u8, p.potions_healing, "{name} tick {i} Hot mirror");
            assert_eq!(
                num(want, "potionsHealing") as usize,
                hots,
                "{name} tick {i} Hot count"
            );
            // Toasts the probe saw (store toasts are not compared: the test sets the stock directly).
            let messages: Vec<&str> = ev
                .iter()
                .filter_map(|e| match e {
                    Event::PotionNotice { id, notice } if *id == PlayerId(1) => {
                        Some(notice.message())
                    }
                    _ => None,
                })
                .collect();
            let _ = messages;
        }
        compared += 1;
    }
    assert_eq!(compared, 5, "five potion cases compared");
}

#[test]
fn a_full_camp_bag_refuses_the_grant_without_losing_stock() {
    let src = source();
    let mut sim = potion_sim(true);
    let grant = &src["grantRefusal"];
    sim.w.players[0].potion_large = crate::potions::DEFINITION.cap;
    let mut ev = Vec::new();
    assert!(
        !crate::systems::potions::grant(
            &mut sim.w,
            &mut ev,
            PlayerId(1),
            crate::potions::Size::Large
        ),
        "a full camp stock refuses the grant"
    );
    assert_eq!(
        u32::from(sim.w.players[0].potion_large),
        grant["potionLarge"].as_u64().unwrap() as u32
    );
    assert!(ev.is_empty());
}

fn camp_arena() -> crate::Arena {
    let data: crate::mapdata::GameMapData = serde_json::from_str(include_str!(
        "../../../../parity/initial-loot/input-map.json"
    ))
    .unwrap();
    let hash = u32::from_str_radix(&crate::mapgen::map_hash::map_hash(&data), 16).unwrap();
    let v = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map: data,
    }
    .validate()
    .unwrap();
    let (w, h, t, l) = v.into_parts();
    let spawns = l
        .data()
        .spawns
        .iter()
        .map(|p| crate::Vec2::new(p.x, p.y))
        .collect();
    crate::Arena {
        map: crate::TileMap::new(w, h, t)
            .unwrap()
            .with_layers(std::sync::Arc::new(l))
            .unwrap(),
        spawns,
    }
}

fn camp_sim() -> Sim {
    let mut sim = Sim::new(
        SimConfig {
            consumables: true,
            initial_loot: true,
            mob_mode: MobMode::Pve,
            min_players: 2,
            fill_seconds: 0.0,
            ..Default::default()
        },
        camp_arena(),
        Secrets::from_seed(12),
    );
    sim.add_player("p0", Some(FactionId::Fire), false);
    sim.add_player("p1", Some(FactionId::Holy), false);
    let _ = sim.step();
    sim
}

#[test]
fn camp_cases_match_the_source_reward() {
    let src = source();
    for case in src["campCases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let mut sim = camp_sim();
        let centre = {
            let c = &sim.k.arena.map.layers().unwrap().data().camps[0];
            Vec2::new(c.x, c.y)
        };
        assert_eq!(centre.x, num(&case["camp"], "x"), "{name} camp x");
        assert_eq!(centre.y, num(&case["camp"], "y"), "{name} camp y");
        // The probe puts p0 on the camp centre and p1 far away.
        sim.w.players[0].body.x = centre.x;
        sim.w.players[0].body.y = centre.y;
        sim.w.players[1].body.x = 1400.0;
        sim.w.players[1].body.y = 1400.0;
        let ids: Vec<PlayerId> = sim.w.players.iter().map(|p| p.id).collect();
        let contributors: Vec<PlayerId> = match name {
            "centre-and-far" => ids.clone(),
            "full-bag-at-centre" => vec![ids[0]],
            "down-contributor" => ids.clone(),
            "nobody" => Vec::new(),
            other => panic!("unhandled camp case {other}"),
        };
        if name == "full-bag-at-centre" {
            sim.w.players[0].potion_large = crate::potions::DEFINITION.cap;
        }
        if name == "down-contributor" {
            sim.w.players[0].status = crate::Status::Dead;
            sim.w.players[0].vitals.hp = 0.0;
        }
        if !contributors.is_empty() {
            sim.w.mob_runtime.as_mut().unwrap().life[0].contributors = contributors;
            let mut ev = Vec::new();
            let k = &sim.k;
            let w = &mut sim.w;
            let mut hx = Hx {
                stats: Default::default(),
                fx: None,
                k,
                w,
                ev: &mut ev,
            };
            crate::hooks::fire(&mut hx, HookArgs::CampCleared { camp: 0 });
            let messages: Vec<&str> = ev
                .iter()
                .filter_map(|e| match e {
                    Event::PotionNotice { notice, .. } => Some(notice.message()),
                    _ => None,
                })
                .collect();
            let want: Vec<&str> = case["toasts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect();
            assert_eq!(messages, want, "{name}: toasts");
            assert!(sim.w.mob_runtime.as_ref().unwrap().life[0]
                .contributors
                .is_empty());
        }
        for (i, want) in case["players"].as_array().unwrap().iter().enumerate() {
            let p = &sim.w.players[i];
            assert_eq!(
                p.potion_large,
                want["potionLarge"].as_u64().unwrap() as u8,
                "{name} player {i} camp stock"
            );
            assert_eq!(
                p.potion_small,
                want["potionSmall"].as_u64().unwrap() as u8,
                "{name} player {i} small stock"
            );
            assert_eq!(
                u32::from(p.camps_cleared),
                want["campClears"].as_u64().unwrap() as u32,
                "{name} player {i} clears"
            );
        }
    }
}

#[test]
fn wind_emblems_match_the_source_tick_by_tick() {
    let src = source();
    let wind = &src["wind"];
    let order_salt = wind["orderSalt"].as_u64().unwrap() as u32;
    let start = wind["start"].as_array().unwrap();
    let placements: Vec<crate::Placement> = start
        .iter()
        .map(|p| crate::Placement {
            profile: p["id"].as_str().unwrap().to_string(),
            faction: if p["id"] == "p0" {
                FactionId::Fire
            } else {
                FactionId::Holy
            },
            bot: false,
            at: Vec2::new(num(p, "x"), num(p, "y")),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        camp_arena(),
        Secrets {
            order_salt,
            reward_salt: [0; 4],
            spawn_seed: 0,
        },
        &placements,
    );
    let mut compared = 0u32;
    for frame in wind["frames"].as_array().unwrap() {
        sim.step();
        let tick = frame["tick"].as_u64().unwrap();
        assert_eq!(u64::from(sim.tick()), tick, "tick sequence");
        let want: Vec<(f64, f64)> = frame["emblems"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| (num(e, "x"), num(e, "y")))
            .collect();
        let mut got: Vec<(f64, f64)> = sim
            .containers()
            .iter()
            .filter(|c| c.kind == crate::ContainerKind::WindEmblem)
            .map(|c| (c.at.x, c.at.y))
            .collect();
        got.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
        assert_eq!(got, want, "tick {tick} emblems");
        let boosts: Vec<f64> = frame["boosts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        let got_boosts: Vec<f64> = sim.players().iter().map(|p| p.speed_boost_until).collect();
        assert_eq!(got_boosts, boosts, "tick {tick} boost clock");
        compared += 1;
    }
    assert_eq!(compared, 1600);
}
