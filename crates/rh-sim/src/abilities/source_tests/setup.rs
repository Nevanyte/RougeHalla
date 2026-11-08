use super::*;
thread_local! {static PLAYER_COUNT:std::cell::Cell<u32>=const {std::cell::Cell::new(0)};}
pub(super) fn corpus() -> V {
    serde_json::from_str(include_str!("../../../../../parity/abilities/source.json")).unwrap()
}

pub(super) fn num(v: &V) -> f64 {
    v.as_f64().unwrap()
}

pub(super) fn pt(v: &V) -> Vec2 {
    serde_json::from_value(v.clone()).unwrap()
}

pub(super) fn id(v: &V) -> Option<PlayerId> {
    if let Some(n) = v
        .as_str()
        .and_then(|v| v.strip_prefix("@m"))
        .and_then(|n| n.parse::<u32>().ok())
    {
        return Some(PlayerId(PLAYER_COUNT.get() + n + 1));
    }
    v.as_str()
        .and_then(|s| s.strip_prefix('p'))
        .and_then(|s| s.parse::<u32>().ok())
        .map(|i| PlayerId(i + 1))
}

pub(super) fn label(id: PlayerId) -> String {
    let n = PLAYER_COUNT.get();
    if n > 0 && id.0 > n {
        format!("mob{}", id.0 - n)
    } else {
        format!("p{}", id.0 - 1)
    }
}

pub(super) fn room(input: &V) -> crate::TileMap {
    let d = &input["room"];
    let w = d["w"].as_u64().unwrap_or(40) as u32;
    let h = d["h"].as_u64().unwrap_or(24) as u32;
    let mut tiles = vec![0; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                tiles[(y * w + x) as usize] = 1;
            }
        }
    }
    if let Some(walls) = d["walls"].as_array() {
        for wall in walls {
            tiles
                [(wall[1].as_u64().unwrap() * u64::from(w) + wall[0].as_u64().unwrap()) as usize] =
                1;
        }
    }
    crate::TileMap::new(w, h, tiles).unwrap()
}

pub(super) fn construct(input: &V) -> Sim {
    construct_with_birth(input, &mut |_, _| {})
}
pub(super) fn construct_with_birth(input: &V, on_birth: &mut dyn FnMut(&Sim, &[Event])) -> Sim {
    construct_with_stages(input, &mut |_, _| {}, on_birth)
}
pub(super) fn construct_with_stages(
    input: &V,
    on_stage: &mut dyn FnMut(&Sim, &str),
    on_birth: &mut dyn FnMut(&Sim, &[Event]),
) -> Sim {
    assert!(matches!(
        input["profile"].as_str(),
        Some("core" | "signatures" | "roster" | "rosterSignatures" | "cards" | "training")
    ));
    PLAYER_COUNT.set(input["players"].as_array().unwrap().len() as u32);
    assert!(matches!(
        input["map"].as_str(),
        Some("room" | "born" | "seed1")
    ));
    let arena = arena(input);
    let seed = input["mainSeed"].as_u64().unwrap_or(12) as u32;
    let mut random = crate::rng::Mulberry32::new(seed);
    let secrets = Secrets {
        order_salt: random.next_u32(),
        spawn_seed: seed,
        reward_salt: serde_json::from_value(input["rewardSalt"].clone()).unwrap(),
    };
    let placements: Vec<_> = input["players"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, p)| Placement {
            profile: format!("name{i}"),
            faction: match p["faction"].as_str().unwrap() {
                "frost" => crate::FactionId::Frost,
                "fire" => crate::FactionId::Fire,
                "plague" => crate::FactionId::Plague,
                "sentenced" => crate::FactionId::Sentenced,
                "holy" => crate::FactionId::Holy,
                _ => panic!("unknown source faction"),
            },
            bot: p["bot"].as_bool().unwrap_or(false),
            at: point(&arena.map, &p["at"]),
            hp: p["hp"].as_f64(),
            weapon0: p.get("weapon").map(|w| {
                serde_json::from_value(V::String({
                    let v = w.as_str().unwrap();
                    let mut c = v.chars();
                    c.next().unwrap().to_uppercase().collect::<String>() + c.as_str()
                }))
                .unwrap()
            }),
            weapon1: p.get("weapon1").map(|w| {
                serde_json::from_value(V::String({
                    let v = w.as_str().unwrap();
                    let mut c = v.chars();
                    c.next().unwrap().to_uppercase().collect::<String>() + c.as_str()
                }))
                .unwrap()
            }),
        })
        .collect();
    let training = input["profile"] == "training" || input["config"]["training"] == true;
    let config = SimConfig {
        quests: false,
        consumables: false,
        // The ability source capture installs weapons and abilities only: no consumables module, so no wind timer.
        min_players: placements.iter().filter(|p| !p.bot).count(),
        fill_seconds: 0.,
        abilities: Mode::Full,
        // Both source profiles install loot; in an empty room this consumes only the constructor order draw.
        initial_loot: matches!(
            input["profile"].as_str(),
            Some("roster" | "rosterSignatures" | "training")
        ),
        training,
        dummies: input["config"]["dummies"] == true,
        lifecycle: if training {
            crate::ArenaMode::Off
        } else {
            crate::ArenaMode::Source(crate::ArenaRules {
                plan_seconds: input["config"]["planSeconds"].as_f64().unwrap_or(0.),
                first_patience_seconds: input["config"]["firstPatienceSeconds"].as_f64(),
                coliseum_schedule: None,
                patience_seconds: input["config"]["patienceSeconds"].as_f64().unwrap_or(3600.),
                patience_min_seconds: input["config"]["patienceMinSeconds"]
                    .as_f64()
                    .unwrap_or(3600.),
                sudden_death_seconds: input["config"]["suddenDeathSeconds"]
                    .as_f64()
                    .unwrap_or(60.),
            })
        },
        mob_mode: if matches!(
            input["profile"].as_str(),
            Some("roster" | "rosterSignatures")
        ) {
            crate::mob_runtime::MobMode::Pve
        } else {
            crate::mob_runtime::MobMode::Off
        },
        faction_mode: if matches!(
            input["profile"].as_str(),
            Some("signatures" | "rosterSignatures")
        ) {
            crate::FactionMode::EngagementHolyPlagueFireFrostSentenced
        } else {
            crate::FactionMode::Off
        },
        wish_lock_ms: input["config"]["wishLockSeconds"].as_f64().unwrap_or(0.) * 1000.,
        ..Default::default()
    };
    let closed = input["profile"] == "rosterSignatures";
    let mut sim =
        Sim::try_new(config, arena, secrets).expect("admitted source profile constructor");
    on_stage(&sim, "constructed");
    #[cfg(feature = "trusted-status-probes")]
    if closed {
        sim.w.trace.1.enabled = true;
    }
    for p in &placements {
        sim.add_player(&p.profile, Some(p.faction), p.bot)
            .expect("admitted source profile join");
    }
    on_stage(&sim, "joined");
    let events = sim.step();
    on_birth(&sim, &events);
    let now = sim.w.server_time;
    for ((p, declared), spec) in sim
        .w
        .players
        .iter_mut()
        .zip(input["players"].as_array().unwrap())
        .zip(&placements)
    {
        p.body.x = spec.at.x;
        p.body.y = spec.at.y;
        p.body.history.reset(crate::state::Sample {
            t: now,
            x: spec.at.x,
            y: spec.at.y,
        });
        p.motion.slip = None;
        if let Some(hp) = spec.hp {
            p.vitals.hp = hp;
        }
        if declared.get("weapon").is_some() {
            p.weapon.weapon0 = spec.weapon0;
        }
        if declared.get("weapon1").is_some() {
            p.weapon.weapon1 = spec.weapon1;
        }
    }
    // The source rig's declared-player bootstrap: grantCard (an owned card folds in at once). Only the declared
    // ordinary producer path is used; the snapshot can never seed card state.
    for (i, declared) in input["players"].as_array().unwrap().iter().enumerate() {
        for card in declared["cards"].as_array().into_iter().flatten() {
            let card: crate::cards::CardId =
                serde_json::from_value(card.clone()).expect("declared source card id");
            let id = sim.w.players[i].id;
            assert!(
                crate::cards::grant(&sim.k, &mut sim.w, id, card),
                "declared source card grant"
            );
        }
    }
    sim
}

pub(super) fn enqueue(s: &mut Sim, input: &V) {
    let p = &input["payload"];
    let seq = p["seq"].as_u64().filter(|n| *n <= 255).map(|n| n as u8);
    let t = p["t"].as_f64();
    let raw_point = p.get("point").unwrap_or(p);
    let resolved;
    let point = if raw_point.get("anchor").is_some() {
        resolved = json!(point(&s.k.arena.map, raw_point));
        &resolved
    } else {
        raw_point
    };
    let command = match input["type"].as_str().unwrap() {
        "cast" => {
            let Ok(slot) = serde_json::from_value(p["slot"].clone()) else {
                return;
            };
            let (Some(x), Some(y)) = (point["x"].as_f64(), point["y"].as_f64()) else {
                return;
            };
            if p.get("id")
                .is_some_and(|id| id.as_str().is_none_or(|id| id.is_empty() || id.len() > 64))
            {
                return;
            }
            RawCommand::Cast {
                slot,
                x,
                y,
                id: p
                    .get("id")
                    .and_then(id)
                    .or_else(|| p.get("id").map(|_| PlayerId(1000000))),
                t,
                seq,
            }
        }
        "move" => RawCommand::Move {
            x: num(&point["x"]),
            y: num(&point["y"]),
            seq,
        },
        "attackMove" => RawCommand::AttackMove {
            x: num(&point["x"]),
            y: num(&point["y"]),
            seq,
        },
        "stop" => RawCommand::Stop { seq },
        "aim" => RawCommand::Aim { a: num(&p["a"]) },
        "attack" => RawCommand::Attack { a: num(&p["a"]), t },
        "release" => RawCommand::Release { a: num(&p["a"]), t },
        "target" => p
            .get("id")
            .and_then(id)
            .map_or(RawCommand::MissingTarget, |id| RawCommand::Target { id }),
        "swap" => RawCommand::Swap {
            slot: p["slot"].as_u64().map(|n| n as u8),
        },
        other => panic!("unsupported source action {other}"),
    };
    let command = crate::validate(command).unwrap();
    let result = s.submit_unbudgeted(id(&input["actor"]).unwrap(), command);
    if s.k.config.mob_mode == crate::mob_runtime::MobMode::Pve
        && s.k.config.faction_mode.sentenced()
    {
        result.expect("declared strict Full command passes the real input door");
    }
}

pub(super) fn born_arena(input: &V) -> Arena {
    let mut map: V = serde_json::from_str(include_str!(
        "../../../../../tools/ability-fixtures/born-input.json"
    ))
    .unwrap();
    let zone = input["zone"].as_str().unwrap();
    if zone != "fire" {
        let other = map["regions"]
            .as_array()
            .unwrap()
            .iter()
            .position(|r| r["id"] == zone)
            .unwrap();
        map["regions"][0]["id"] = zone.into();
        map["regions"][other]["id"] = "fire".into();
        for c in map["regions"][0]["mobCamps"].as_array_mut().unwrap() {
            c["id"] = format!("{zone}-1").into();
            c["region"] = zone.into();
            c["weapon"] = match zone {
                "holy" => "wand",
                "plague" => "bow",
                "frost" => "shield",
                _ => "sword",
            }
            .into();
        }
        for p in map["spawnPool"].as_array_mut().unwrap() {
            if p["zone"] == "fire" {
                p["zone"] = zone.into()
            } else if p["zone"] == zone {
                p["zone"] = "fire".into()
            }
        }
        map["camps"][0]["zone"] = zone.into();
        map["camps"][0]["id"] = format!("{zone}-1").into();
        for v in map["regionGrid"].as_array_mut().unwrap() {
            let x = v.as_u64().unwrap();
            if x == 1 {
                *v = (other + 1).into()
            } else if x == other as u64 + 1 {
                *v = 1.into()
            }
        }
        map["regions"].as_array_mut().unwrap().swap(0, other);
        map["spawns"] = json!(map["regions"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|r| r["spawns"].as_array().unwrap().iter().cloned())
            .collect::<Vec<_>>());
    }
    let data = serde_json::from_value(map).unwrap();
    let (w, h, tiles, layers) = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .unwrap()
    .into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Arena {
        map: crate::TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}

fn arena(input: &V) -> Arena {
    if input["map"] == "born" {
        return born_arena(input);
    }
    if input["map"] == "seed1" {
        let export: crate::mapdata::MapExport = serde_json::from_str(include_str!(
            "../../../../../tools/ability-fixtures/seed1-input.json"
        ))
        .unwrap();
        return export.validate().unwrap().into_arena().unwrap();
    }
    let spawns = input["room"]["spawns"]
        .as_array()
        .map(|v| v.iter().map(pt).collect())
        .unwrap_or_else(|| {
            vec![
                Vec2::new(112., 112.),
                Vec2::new(400., 112.),
                Vec2::new(800., 112.),
                Vec2::new(112., 624.),
                Vec2::new(800., 624.),
            ]
        });
    Arena {
        map: room(input),
        spawns,
    }
}
pub(super) fn point(map: &crate::TileMap, p: &V) -> Vec2 {
    let Some(anchor) = p["anchor"].as_str() else {
        return pt(p);
    };
    let c = &map.layers().unwrap().data().coliseum;
    let index = p["index"].as_u64().unwrap_or(0) as usize;
    match anchor {
        "inner" => {
            let q = c.inner_spawns[index];
            Vec2::new(
                q.x + p["dx"].as_f64().unwrap_or(0.),
                q.y + p["dy"].as_f64().unwrap_or(0.),
            )
        }
        "centre" => Vec2::new(c.centre.x, c.centre.y),
        "gateIn" | "gateOut" => {
            let g = &c.gates[index];
            let t = g.tiles[g.tiles.len() / 2];
            let (x, y) = match g.side {
                crate::mapdata::GateSide::North => (0., 1.),
                crate::mapdata::GateSide::East => (-1., 0.),
                crate::mapdata::GateSide::South => (0., -1.),
                crate::mapdata::GateSide::West => (1., 0.),
            };
            let d =
                if anchor == "gateIn" { 1. } else { -1. } * p["distance"].as_f64().unwrap_or(64.);
            Vec2::new(
                f64::from(t.x) * 32. + 16. + x * d,
                f64::from(t.y) * 32. + 16. + y * d,
            )
        }
        other => panic!("unknown source anchor {other}"),
    }
}

pub(super) fn set_player_count(n: u32) {
    PLAYER_COUNT.set(n);
}
