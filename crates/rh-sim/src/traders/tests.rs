//! Source `shared/traders.ts` + `server/src/sim/traders.ts`: the barter cycle, the stat-offer rules, the trade action's
//! validation, and the pinned-container replay of the captured trader corpus through the real C-INPUT door.
use super::*;
use crate::input::{validate, RawCommand};
use crate::{Arena, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

fn arena() -> Arena {
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
        .expect("seed 1 attempt 0");
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

fn player(ordinal: u64) -> PlayerId {
    PlayerId(ordinal as u32 + 1)
}

fn ordinal(sim: &Sim, id: PlayerId) -> Option<u64> {
    (0..3u64).find(|i| sim.w.players[*i as usize].id == id)
}

fn ms(value: f64) -> f64 {
    (value * 1e6).round() / 1e6
}

fn snapshot(sim: &Sim) -> serde_json::Value {
    let traders: Vec<serde_json::Value> = sim.w.traders.as_ref().map_or(Vec::new(), |rt| {
        rt.traders
            .iter()
            .map(|t| {
                serde_json::json!({
                    "id": t.kind.id(),
                    "kind": t.kind.as_str(),
                    "name": t.kind.name(),
                    "x": t.at.x,
                    "y": t.at.y,
                    "nextWalkAt": t.next_walk_at,
                })
            })
            .collect()
    });
    let destinations =
        sim.w
            .traders
            .as_ref()
            .map_or(serde_json::json!({"count":0,"fold":"0"}), |rt| {
                let mut fold: u64 = 0;
                for p in &rt.destinations {
                    fold = fold
                        .wrapping_mul(1099511628211)
                        .wrapping_add((p.x.round() as i64 as u64).wrapping_mul(1000003))
                        .wrapping_add(p.y.round() as i64 as u64);
                }
                serde_json::json!({"count": rt.destinations.len(), "fold": format!("{fold:x}")})
            });
    let mut barter_at = serde_json::Map::new();
    if let Some(rt) = sim.w.traders.as_ref() {
        let mut rows: Vec<(u64, f64)> = rt
            .barter_at
            .iter()
            .filter_map(|(id, at)| ordinal(sim, *id).map(|ord| (ord, ms(*at))))
            .collect();
        rows.sort_by_key(|(ord, _)| *ord);
        for (ord, at) in rows {
            barter_at.insert(format!("p{ord}"), serde_json::json!(at));
        }
    }
    let players: Vec<serde_json::Value> = (0..3usize)
        .map(|i| {
            let p = &sim.w.players[i];
            let m = p.modifiers.mirrors();
            let mut stats = serde_json::Map::new();
            let mut rows: Vec<(Stat, f64)> = p.trade_stats.clone();
            rows.sort_by_key(|(stat, _)| stat.index());
            for (stat, value) in rows {
                stats.insert(stat.as_str().to_string(), serde_json::json!(ms(value)));
            }
            serde_json::json!({
                "id": i,
                "weapon0": p.weapon.weapon0.map_or("", |w| w.as_str()),
                "weapon1": p.weapon.weapon1.map_or("", |w| w.as_str()),
                "slot": p.weapon.slot,
                "potionSmall": p.potion_small,
                "hp": ms(p.vitals.hp),
                "maxHp": ms(p.vitals.max_hp),
                "mirrors": {
                    "asMult": (m.as_mult * 1000.).round() as i64,
                    "windupMult": (m.windup_mult * 1000.).round() as i64,
                    "speedMult": (m.speed_mult * 1000.).round() as i64,
                    "armorBonus": m.armor_bonus.round() as i64,
                    "shieldBonus": m.shield_bonus.round() as i64,
                    "adBonus": m.ad_bonus.round() as i64,
                    "apBonus": m.ap_bonus.round() as i64,
                },
                "tradeUsed": p.trade_used,
                "tradeOffers": p.trade_offers.iter().map(|offer| serde_json::json!({
                    "cost": offer.cost.as_str(),
                    "costValue": ms(offer.cost_value),
                    "gain": offer.gain.as_str(),
                    "gainValue": ms(offer.gain_value),
                    "label": offer.label,
                })).collect::<Vec<_>>(),
                "tradeStats": serde_json::Value::Object(stats),
            })
        })
        .collect();
    serde_json::json!({
        "traders": traders,
        "destinations": destinations,
        "barterAt": serde_json::Value::Object(barter_at),
        "players": players,
    })
}

fn first_diff(got: &serde_json::Value, want: &serde_json::Value, path: &str) -> Option<String> {
    match (got, want) {
        (serde_json::Value::Object(a), serde_json::Value::Object(b)) => {
            let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                let sub = format!("{path}.{key}");
                match (a.get(key), b.get(key)) {
                    (Some(x), Some(y)) => {
                        if let Some(d) = first_diff(x, y, &sub) {
                            return Some(d);
                        }
                    }
                    (x, y) => return Some(format!("{sub}: got {x:?} want {y:?}")),
                }
            }
            None
        }
        (serde_json::Value::Array(a), serde_json::Value::Array(b)) => {
            if a.len() != b.len() {
                return Some(format!("{path}: array length {} != {}", a.len(), b.len()));
            }
            for (i, (x, y)) in a.iter().zip(b).enumerate() {
                if let Some(d) = first_diff(x, y, &format!("{path}[{i}]")) {
                    return Some(d);
                }
            }
            None
        }
        (serde_json::Value::Number(x), serde_json::Value::Number(y)) => {
            let (a, b) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            let scale = a.abs().max(b.abs()).max(1.);
            if (a - b).abs() <= 1e-6 * scale {
                None
            } else {
                Some(format!("{path}: got {a} want {b}"))
            }
        }
        (x, y) => {
            if x == y {
                None
            } else {
                Some(format!("{path}: got {x} want {y}"))
            }
        }
    }
}

fn place(sim: &mut Sim, actor: u64, at: Vec2) {
    let i = actor as usize;
    let now = sim.w.server_time;
    let p = &mut sim.w.players[i];
    p.body.x = at.x;
    p.body.y = at.y;
    p.body.facing = 0.;
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
}

fn set_weapon(sim: &mut Sim, actor: u64, weapon: &str) {
    let parsed = crate::content::WeaponId::parse(weapon).expect("captured weapon");
    let i = actor as usize;
    let p = &mut sim.w.players[i];
    p.weapon.weapon0 = Some(parsed);
    p.weapon.weapon1 = None;
    p.weapon.slot = 0;
}

fn apply_action(sim: &mut Sim, action: &serde_json::Value) {
    match action["kind"].as_str().unwrap() {
        "place" => place(
            sim,
            action["actor"].as_u64().unwrap(),
            Vec2::new(action["x"].as_f64().unwrap(), action["y"].as_f64().unwrap()),
        ),
        "weapon" => set_weapon(
            sim,
            action["actor"].as_u64().unwrap(),
            action["weapon"].as_str().unwrap(),
        ),
        // The capture's declared bootstrap grants a card through the source's real grantCard; the replay uses the
        // port's real grant producer (which folds the card in and syncs max hp), so the trade check sees the same build.
        "grantCard" => {
            let actor = action["actor"].as_u64().unwrap();
            let name = action["card"].as_str().unwrap();
            let card = crate::cards::CardId::ALL
                .iter()
                .copied()
                .find(|card| card.as_str() == name)
                .unwrap_or_else(|| panic!("captured card {name} is a catalog card"));
            assert!(
                crate::cards::grant(&sim.k, &mut sim.w, player(actor), card),
                "the real grant producer accepts the declared card"
            );
        }
        // The capture's declared bootstrap sets the small-potion count (the source state field directly; no producer).
        "potion" => {
            let i = action["actor"].as_u64().unwrap() as usize;
            sim.w.players[i].potion_small = action["count"].as_u64().unwrap() as u8;
        }
        "input" => {
            let actor = action["actor"].as_u64().unwrap();
            let payload = &action["payload"];
            let trader = match payload["trader"].as_str().unwrap() {
                "trader-barter" => 0u8,
                "trader-stats" => 1u8,
                other => panic!("unexpected captured trader {other}"),
            };
            let raw = RawCommand::Trade {
                trader: Some(trader),
                pick: payload["pick"].as_i64().unwrap() as i8,
            };
            sim.submit(player(actor), validate(raw).expect("valid captured trade"))
                .expect("accepted");
        }
        other => panic!("unexpected captured action {other}"),
    }
}

#[test]
fn the_captured_trader_lifecycle_replays_through_the_input_door() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/trade/runtime.json"
    );
    let doc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("trade corpus")).expect("json");
    assert_eq!(doc["format"], "rh-trade-source/1");
    for case in doc["cases"].as_array().unwrap() {
        let name = case["input"]["name"].as_str().unwrap();
        let initial = case["input"]["initial"].as_array().unwrap();
        let placements: Vec<Placement> = initial
            .iter()
            .map(|p| Placement {
                profile: p["faction"].as_str().unwrap().into(),
                faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
                bot: false,
                at: Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect();
        let mut sim = Sim::reset_active(
            SimConfig {
                quests: true,
                mob_mode: crate::mob_runtime::MobMode::Pve,
                initial_loot: true,
                pvp_rules: false,
                ..Default::default()
            },
            arena(),
            Secrets {
                order_salt: crate::rng::Mulberry32::new(12).next_u32(),
                spawn_seed: 0,
                reward_salt: [1, 2, 3, 4],
            },
            &placements,
        );
        let actions = case["actions"].as_array().unwrap();
        let mut ai = 0usize;
        for frame in case["frames"].as_array().unwrap() {
            let target = frame["tick"].as_u64().unwrap() as u32;
            let want_actions = frame["actionCount"].as_u64().unwrap() as usize;
            while ai < want_actions {
                let action = &actions[ai];
                let tick = action["tick"].as_u64().unwrap() as u32;
                while sim.w.tick < tick {
                    sim.step();
                }
                apply_action(&mut sim, action);
                ai += 1;
            }
            while sim.w.tick < target {
                sim.step();
            }
            let got = snapshot(&sim);
            let want = serde_json::json!({
                "traders": frame["traders"],
                "destinations": frame["destinations"],
                "barterAt": frame["barterAt"],
                "players": frame["players"],
            });
            if let Some(diff) = first_diff(&got, &want, "") {
                panic!("{name}: frame {} at tick {target}: {diff}", frame["label"]);
            }
        }
    }
}

#[test]
fn the_barter_cycle_follows_the_held_weapon_counter_cycle() {
    use crate::content::WeaponId;
    assert_eq!(
        barter_weapons(Some(WeaponId::Sword)),
        [WeaponId::Bow, WeaponId::Wand]
    );
    assert_eq!(
        barter_weapons(Some(WeaponId::Fists)),
        [WeaponId::Sword, WeaponId::Bow]
    );
    assert_eq!(barter_weapons(None), [WeaponId::Sword, WeaponId::Bow]);
    assert_eq!(
        barter_weapons(Some(WeaponId::Axe)),
        [WeaponId::Fists, WeaponId::Sword]
    );
    assert_eq!(barter_labels(Some(WeaponId::Sword))[0], "Give Sword → Bow");
}

#[test]
fn a_rolled_stat_trade_costs_one_positive_rolled_stat() {
    let p = crate::state::Player::joining(
        player(0),
        "p0",
        false,
        FactionId::Holy,
        Vec2::new(0., 0.),
        crate::content::faction(FactionId::Holy).hp,
    );
    let mut seed = 0u64;
    let mut random = || {
        seed += 1;
        ((seed * 2654435761) % 1000) as f64 / 1000.
    };
    let offers = roll_stat_trades(&p, &mut random);
    assert_eq!(offers.len(), 3);
    for offer in &offers {
        assert!(offer.valid());
        assert_ne!(offer.cost, offer.gain);
        assert!(offer.label.contains("→"));
    }
    let mut flat = 0;
    let mut stat = 0;
    for offer in &offers {
        let (rows, n) = trade_effects(&[
            (offer.cost, -offer.cost_value),
            (offer.gain, offer.gain_value),
        ]);
        for row in &rows[..n] {
            match row.kind {
                crate::stat_fold::EffectKind::Flat { .. } => flat += 1,
                crate::stat_fold::EffectKind::Stat { .. } => stat += 1,
                _ => panic!("trade effects are flat/stat rows only"),
            }
        }
    }
    assert!(flat + stat >= 2);
}

#[test]
fn the_trade_message_round_trips_and_rejects_out_of_range_picks() {
    let ok = RawCommand::Trade {
        trader: Some(1),
        pick: 2,
    };
    assert!(validate(ok).is_ok(), "a valid trade round-trips the door");
    for bad in [
        RawCommand::Trade {
            trader: None,
            pick: 0,
        },
        RawCommand::Trade {
            trader: Some(2),
            pick: 0,
        },
        RawCommand::Trade {
            trader: Some(0),
            pick: 3,
        },
        RawCommand::Trade {
            trader: Some(0),
            pick: -1,
        },
    ] {
        assert!(
            validate(bad).is_err(),
            "{bad:?} must be refused at the door"
        );
    }
}

/// Focused refusal check at the source position (negative control: without the lockSecondSlot branch the locked sim would
/// trade into slot 1, so every assertion below fails). The captured barter-locked-second-slot case pins the same
/// behaviour through the real input door and the full captured surfaces.
#[test]
fn the_committed_flag_refuses_the_second_weapon_barter() {
    fn barter_sim(committed: bool) -> Sim {
        use crate::content::WeaponId;
        let arena = arena();
        let spots = arena.spawns.clone();
        let placements = vec![
            Placement {
                profile: "p0".into(),
                faction: FactionId::Holy,
                bot: false,
                at: spots[0],
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "p1".into(),
                faction: FactionId::Fire,
                bot: false,
                at: spots[1],
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        let mut sim = Sim::reset_active(
            SimConfig {
                quests: true,
                mob_mode: crate::mob_runtime::MobMode::Pve,
                initial_loot: true,
                pvp_rules: false,
                ..Default::default()
            },
            arena,
            Secrets {
                order_salt: crate::rng::Mulberry32::new(12).next_u32(),
                spawn_seed: 0,
                reward_salt: [1, 2, 3, 4],
            },
            &placements,
        );
        if committed {
            assert!(crate::cards::grant(
                &sim.k,
                &mut sim.w,
                player(0),
                crate::cards::CardId::Committed
            ));
        }
        let p = &mut sim.w.players[0];
        p.weapon.weapon0 = Some(WeaponId::Sword);
        p.weapon.weapon1 = None;
        p.weapon.slot = 0;
        p.potion_small = 1;
        let spot = sim.w.players[0].core.pos();
        let at = Vec2::new(spot.x + 32., spot.y);
        sim.w.traders = Some(Traders {
            traders: vec![Trader {
                kind: Kind::Barter,
                at,
                path: Vec::new(),
                next_walk_at: 0.,
            }],
            destinations: Vec::new(),
            barter_at: Vec::new(),
        });
        sim
    }

    let step_trade = |sim: &mut Sim| {
        sim.submit(
            player(0),
            validate(RawCommand::Trade {
                trader: Some(0),
                pick: 2,
            })
            .expect("a valid trade command"),
        )
        .expect("submitted");
        sim.step();
    };

    let mut locked = barter_sim(true);
    step_trade(&mut locked);
    assert_eq!(
        locked.w.players[0].weapon.weapon1, None,
        "the locked slot stays empty"
    );
    assert_eq!(
        locked.w.players[0].potion_small, 1,
        "the refusal spends no potion"
    );
    assert!(
        locked.w.traders.as_ref().unwrap().barter_at.is_empty(),
        "the refusal does not start the barter cooldown"
    );

    let mut unlocked = barter_sim(false);
    step_trade(&mut unlocked);
    // Held sword -> the counter-cycle's second weapon (wand) goes into the free slot; the potion is spent.
    assert_eq!(
        unlocked.w.players[0].weapon.weapon1,
        Some(crate::content::WeaponId::Wand)
    );
    assert_eq!(unlocked.w.players[0].potion_small, 0);
    assert!(!unlocked.w.traders.as_ref().unwrap().barter_at.is_empty());
}
