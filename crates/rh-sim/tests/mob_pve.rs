use rh_sim::{
    mob_runtime::MobMode, validate, Arena, FactionId, Placement, PlayerId, RawCommand, Secrets,
    Sim, SimConfig, TileMap, Vec2, WeaponId,
};
fn arena() -> Arena {
    let data: rh_sim::mapdata::GameMapData =
        serde_json::from_str(include_str!("fixtures/mob-pve-map.json")).unwrap();
    let (w, h, tiles, layers) = rh_sim::mapdata::MapExport {
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
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}
fn close(a: f64, b: &serde_json::Value, label: &str) {
    let b = b.as_f64().unwrap();
    assert!(
        (a - b).abs() <= 1e-10 * b.abs().max(1.),
        "{label}: native {a} source {b}"
    );
}
fn source_id(s: &str, seats: usize) -> PlayerId {
    if let Some(n) = s.strip_prefix('p') {
        PlayerId(n.parse::<u32>().unwrap() + 1)
    } else {
        PlayerId(seats as u32 + u32::from_str_radix(s.strip_prefix("mob").unwrap(), 36).unwrap())
    }
}
#[test]
fn actual_source_pve_frames_and_restore() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/mob-pve-source.json")).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let name = case["input"]["name"].as_str().unwrap();
        let placements: Vec<_> = case["input"]["players"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, p)| Placement {
                profile: format!("name{i}"),
                faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
                bot: false,
                at: Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()),
                hp: None,
                weapon0: WeaponId::parse(p["weapon"].as_str().unwrap()),
                weapon1: None,
            })
            .collect();
        let mut secrets = Secrets::from_seed(1);
        secrets.spawn_seed = 12;
        secrets.reward_salt = [1, 2, 3, 4];
        let mut sim = Sim::reset_active(
            SimConfig {
                quests: false,
                mob_mode: MobMode::Pve,
                ..Default::default()
            },
            arena(),
            secrets,
            &placements,
        );
        let mut restored = None::<Sim>;
        for f in case["frames"].as_array().unwrap() {
            for c in f["commands"].as_array().unwrap() {
                let raw = match c["kind"].as_str().unwrap() {
                    "attack" => RawCommand::Attack {
                        a: c["a"].as_f64().unwrap(),
                        t: None,
                    },
                    "target" => RawCommand::Target {
                        id: source_id(c["id"].as_str().unwrap(), placements.len()),
                    },
                    _ => panic!("unadmitted command"),
                };
                let id = source_id(c["actor"].as_str().unwrap(), placements.len());
                let cmd = validate(raw).unwrap();
                sim.submit(id, cmd).unwrap();
                if let Some(r) = restored.as_mut() {
                    r.submit(id, cmd).unwrap();
                }
            }
            sim.step();
            if let Some(r) = restored.as_mut() {
                r.step();
                assert_eq!(
                    sim.state_hash(),
                    r.state_hash(),
                    "{name} restored tick {}",
                    sim.tick()
                );
            }
            let v = serde_json::to_value(&sim).unwrap();
            let world = &v["world"];
            assert_eq!(
                world["entity_counter"],
                f["counter"],
                "{name} counter tick {}",
                sim.tick()
            );
            for (p, e) in sim.players().iter().zip(f["players"].as_array().unwrap()) {
                for (a, k) in [
                    (p.body.x, "x"),
                    (p.body.y, "y"),
                    (p.vitals.hp, "hp"),
                    (p.vitals.max_hp, "maxHp"),
                ] {
                    close(
                        a,
                        &e[k],
                        &format!("{name} player{} {k} tick{}", p.id.0, sim.tick()),
                    );
                }
                assert_eq!(p.credit.mob_kills as u64, e["mobKills"].as_u64().unwrap());
                assert_eq!(p.credit.gv as u64, e["gv"].as_u64().unwrap());
                if let Some(count) = e["stats"]["flameCaller"].as_u64() {
                    assert_eq!(
                        p.farm.count(rh_sim::mob_catalog::MobTypeId::FlameCaller),
                        count
                    );
                }
            }
            let mobs = f["mobs"].as_array().unwrap();
            assert_eq!(
                sim.mobs().len(),
                mobs.len(),
                "{name} mob count tick{}",
                sim.tick()
            );
            for ((m, e), j) in sim
                .mobs()
                .iter()
                .zip(mobs)
                .zip(world["mobs"].as_array().unwrap())
            {
                assert_eq!(
                    m.core.id,
                    source_id(e["id"].as_str().unwrap(), placements.len())
                );
                for (a, k) in [
                    (m.core.body.x, "x"),
                    (m.core.body.y, "y"),
                    (m.core.body.facing, "facing"),
                    (m.core.vitals.hp, "hp"),
                    (m.core.vitals.max_hp, "maxHp"),
                    (m.core.weapon.ready_at, "readyAt"),
                    (m.core.weapon.draw_started_at, "drawStartedAt"),
                ] {
                    close(
                        a,
                        &e["state"][k],
                        &format!("{name} mob{} {k} tick{}", m.core.id.0, sim.tick()),
                    );
                }
                let b = &j["brain"];
                let eb = &e["brain"];
                for (a, k) in [
                    ("last_combat_at", "lastCombatAt"),
                    ("last_move_at", "lastMoveAt"),
                    ("died_at", "diedAt"),
                ] {
                    close(
                        b[a].as_f64().unwrap(),
                        &eb[k],
                        &format!("{name} mob{} {k} tick{}", m.core.id.0, sim.tick()),
                    )
                }
                assert_eq!(
                    b["mode"].as_str().unwrap().to_lowercase(),
                    eb["mode"].as_str().unwrap()
                );
                assert_eq!(b["holding"], eb["holding"]);
                assert_eq!(b["moving"], eb["moving"]);
                json_close(&b["goal"], &eb["goal"], "goal");
                json_close(&j["core"]["motion"]["path"][1], &e["path"], "path");
                close(
                    j["last_hit_at"].as_f64().unwrap(),
                    &e["lastHitAt"],
                    "lastHitAt",
                );
                let expected_target = eb["target"]
                    .as_str()
                    .map(|s| source_id(s, placements.len()).0);
                assert_eq!(b["target"].as_u64(), expected_target.map(u64::from));
                json_close(&b["last_aim"], &eb["lastAim"], "lastAim");
                let threat = b["threat"].as_array().unwrap();
                let expected = eb["threat"].as_array().unwrap();
                assert_eq!(threat.len(), expected.len());
                for (a, b) in threat.iter().zip(expected) {
                    assert_eq!(
                        a[0].as_u64().unwrap(),
                        u64::from(source_id(b[0].as_str().unwrap(), placements.len()).0)
                    );
                    close(a[1].as_f64().unwrap(), &b[1], "threat");
                }
                let q = &j["core"]["inputs"];
                let eq = &e["inputs"];
                json_close(&q["aim"], &eq["aim"], "queued aim");
                assert_eq!(q["move_before"], eq["moveBefore"]);
                assert_eq!(q["aim_before"], eq["aimBefore"]);
                let actions = q["actions"].as_array().unwrap();
                let ea = eq["actions"].as_array().unwrap();
                assert_eq!(actions.len(), ea.len());
                for (a, e) in actions.iter().zip(ea) {
                    let kind = if e["kind"] == "attack" {
                        "Attack"
                    } else {
                        "Release"
                    };
                    close(
                        a[kind]["a"].as_f64().unwrap(),
                        &e["a"],
                        "queued attack/release",
                    );
                }
                if eq["move"].is_null() {
                    assert!(q["mv"].is_null())
                } else if eq["move"]["kind"] == "stop" {
                    assert!(q["mv"]["Stop"].is_object())
                } else {
                    close(
                        q["mv"]["Move"]["x"].as_f64().unwrap(),
                        &eq["move"]["x"],
                        "queued x",
                    );
                    close(
                        q["mv"]["Move"]["y"].as_f64().unwrap(),
                        &eq["move"]["y"],
                        "queued y",
                    );
                }
            }
            for (c, e) in sim
                .camp_rosters()
                .iter()
                .zip(f["camps"].as_array().unwrap())
            {
                assert_eq!(c.alive as u64, e["alive"].as_u64().unwrap());
                assert_eq!(c.state as u64, e["state"].as_u64().unwrap());
                close(c.cleared_at, &e["clearedAt"], "clearedAt");
                close(c.respawn_at, &e["respawnAt"], "respawnAt");
            }
            if sim.tick() == 80 {
                restored = Some(
                    serde_json::from_value(v).unwrap_or_else(|e| panic!("{name} restore {e}")),
                );
            }
        }
        assert!(restored.is_some());
        assert_eq!(sim.players().len(), placements.len());
    }
}

fn json_close(a: &serde_json::Value, b: &serde_json::Value, label: &str) {
    match (a, b) {
        (serde_json::Value::Number(a), serde_json::Value::Number(_)) => {
            close(a.as_f64().unwrap(), b, label)
        }
        (serde_json::Value::Array(a), serde_json::Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{label}");
            for (a, b) in a.iter().zip(b) {
                json_close(a, b, label)
            }
        }
        (serde_json::Value::Object(a), serde_json::Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{label}");
            for (k, v) in a {
                json_close(v, &b[k], label)
            }
        }
        _ => assert_eq!(a, b, "{label}"),
    }
}
