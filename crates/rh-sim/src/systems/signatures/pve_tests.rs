use crate::{
    mob_runtime::MobMode, validate, Arena, FactionId, Placement, PlayerId, RawCommand, Secrets,
    Sim, SimConfig, TileMap, Vec2, WeaponId,
};
fn arena(zone: &str) -> Arena {
    let mut map: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/mob-pve-map.json")).unwrap();
    if zone != "fire" {
        let other = map["regions"]
            .as_array()
            .unwrap()
            .iter()
            .position(|r| r["id"] == zone)
            .unwrap();
        map["regions"][0]["id"] = zone.into();
        map["regions"][other]["id"] = "fire".into();
        for camp in map["regions"][0]["mobCamps"].as_array_mut().unwrap() {
            camp["id"] = format!("{zone}-1").into();
            camp["region"] = zone.into();
            camp["weapon"] = match zone {
                "plague" => "bow",
                "holy" => "wand",
                "frost" => "shield",
                _ => "sword",
            }
            .into();
        }
        for p in map["spawnPool"].as_array_mut().unwrap() {
            if p["zone"] == "fire" {
                p["zone"] = zone.into();
            } else if p["zone"] == zone {
                p["zone"] = "fire".into();
            }
        }
        map["camps"][0]["zone"] = zone.into();
        map["camps"][0]["id"] = format!("{zone}-1").into();
        for v in map["regionGrid"].as_array_mut().unwrap() {
            let n = v.as_u64().unwrap();
            if n == 1 {
                *v = (other + 1).into();
            } else if n == other as u64 + 1 {
                *v = 1.into();
            }
        }
        map["regions"].as_array_mut().unwrap().swap(0, other);
        map["spawns"] = serde_json::Value::Array(
            map["regions"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|r| r["spawns"].as_array().unwrap().iter().cloned())
                .collect(),
        );
    }
    let data: crate::mapdata::GameMapData = serde_json::from_value(map).unwrap();
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
fn actual_source_basic_faction_pve_frames_and_restore() {
    let bytes = include_bytes!("../../../../../parity/pve-dot/source.json");
    assert_eq!(
        bytes
            .iter()
            .fold(0xcbf29ce484222325u64, |a, b| (a ^ u64::from(*b))
                .wrapping_mul(0x100000001b3)),
        3638419884095713450
    );
    let fixture: serde_json::Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(fixture["format"], "rh-pve-dot-source/1");
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 2);
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
                hp: p["hp"].as_f64(),
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
                faction_mode: crate::FactionMode::EngagementHolyPlagueFire,
                ..Default::default()
            },
            arena(case["input"]["zone"].as_str().unwrap()),
            secrets,
            &placements,
        );
        for card in case["input"]["players"][0]["cards"].as_array().unwrap() {
            let c = match card.as_str().unwrap() {
                "slowBurn" => crate::cards::CardId::SlowBurn,
                "siphon" => crate::cards::CardId::Siphon,
                _ => panic!("unknown card"),
            };
            assert!(crate::cards::grant(&sim.k, &mut sim.w, PlayerId(1), c));
        }
        let mut restored = None::<Sim>;
        for frame in case["frames"].as_array().unwrap() {
            let f = &frame["output"];
            for c in frame["commands"].as_array().unwrap() {
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
            let events = sim.step();
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
                world["phase"].as_str().unwrap().to_lowercase(),
                f["phase"].as_str().unwrap(),
                "phase tick{}",
                sim.tick()
            );

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
                        p.farm.count(crate::mob_catalog::MobTypeId::FlameCaller),
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
                assert_eq!(
                    m.core.signature.bits as u64,
                    e["state"]["sig"].as_u64().unwrap(),
                    "mob public signature bits"
                );
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
                    assert!(
                        q["mv"]["Move"].is_object(),
                        "{name} tick{} actual {} expected {}",
                        sim.tick(),
                        q["mv"],
                        eq["move"]
                    );
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
            compare_owned(&sim, f, &events, placements.len(), name);
            if sim.tick() == 20 {
                for field in ["target", "ap_hits"] {
                    let mut bad = v.clone();
                    if field == "target" {
                        bad["world"]["players"][0]["core"]["signature"][field] = 999.into();
                    } else {
                        bad["world"]["players"][0]["core"]["signature"][field]["target"] =
                            999.into();
                    }
                    assert!(
                        Sim::restore(bad).is_err(),
                        "forged actor signature provenance"
                    );
                }

                restored = Some(
                    serde_json::from_value(v).unwrap_or_else(|e| panic!("{name} restore {e}")),
                );
            }
        }
        let mut rng = sim.w.reward_rng.clone();
        for v in case["next"].as_array().unwrap() {
            close(rng.next_f64(), v, "reward continuation");
        }
        let mut terminal = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
        for _ in 0..3 {
            sim.step();
            terminal.step();
            assert_eq!(sim.state_hash(), terminal.state_hash());
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

fn compare_owned(
    s: &Sim,
    f: &serde_json::Value,
    events: &[crate::Event],
    seats: usize,
    name: &str,
) {
    for row in f["signatures"].as_array().unwrap() {
        let id = source_id(row[0].as_str().unwrap(), seats);
        let Some(p) = s.w.actor(id) else { continue };
        let e = &row[1];
        let n = &p.signature;
        assert_eq!(
            n.target,
            e["target"].as_str().map(|v| source_id(v, seats)),
            "{name} target tick{}",
            s.tick()
        );
        assert_eq!(
            n.engaged,
            e["engaged"].as_bool().unwrap(),
            "{name} engaged tick{}",
            s.tick()
        );
        if let Some(hits) = e["apHits"].as_array() {
            let cache = serde_json::to_value(&n.ap_hits).unwrap();
            assert_eq!(
                cache["target"].as_u64(),
                e["apHitsOn"]
                    .as_str()
                    .map(|id| u64::from(source_id(id, seats).0))
            );
            json_close(
                &cache["hits"],
                &serde_json::Value::Array(hits.clone()),
                "AP hits",
            );
        }
        assert_eq!(n.in_reach, e["inReach"].as_bool().unwrap());
        for (a, k) in [
            (n.hp_frac, "hpFrac"),
            (n.chill, "chill"),
            (n.dot_paused_until, "dotPausedUntil"),
        ] {
            close(a, &e[k], k);
        }
        for (a, k) in [
            (n.reach_at, "reachAt"),
            (n.contact_at, "contactAt"),
            (n.combat_at, "combatAt"),
        ] {
            if e[k].is_null() {
                assert!(a.is_none(), "{k}")
            } else {
                close(a.unwrap(), &e[k], k);
            }
        }
    }
    close(s.w.factions.dot_since, &f["dotSince"], "dot since");
    let buckets = f["dot"].as_array().unwrap();
    assert_eq!(s.w.factions.dot.len(), buckets.len());
    for (a, row) in s.w.factions.dot.iter().zip(buckets) {
        let e = &row[1];
        assert_eq!(a.by, source_id(e["by"].as_str().unwrap(), seats));
        assert_eq!(a.victim, source_id(e["victim"].as_str().unwrap(), seats));
        assert_eq!(a.sig.as_str(), e["sig"].as_str().unwrap());
        assert_eq!(a.weapon.map(|v| v.as_str()), e["weapon"].as_str());
        close(a.amount, &e["amount"], "private bucket");
    }
    let sf: Vec<_> = events
        .iter()
        .filter_map(|e| {
            if let crate::Event::SignatureHit {
                victim,
                by,
                sig,
                weapon,
                amount,
            } = e
            {
                Some((*victim, *by, *sig, *weapon, *amount))
            } else {
                None
            }
        })
        .collect();
    let ef: Vec<_> = f["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["type"] == "fx" && e["fx"]["kind"] == "hit" && e["fx"]["sig"].is_string())
        .map(|e| &e["fx"])
        .collect();
    assert_eq!(sf.len(), ef.len(), "{name} signature FX tick{}", s.tick());
    for ((victim, by, sig, weapon, amount), e) in sf.iter().zip(ef) {
        assert_eq!(*victim, source_id(e["id"].as_str().unwrap(), seats));
        assert_eq!(*by, source_id(e["by"].as_str().unwrap(), seats));
        assert_eq!(sig.as_str(), e["sig"].as_str().unwrap());
        assert_eq!(weapon.map(|v| v.as_str()), e["weapon"].as_str());
        close(*amount, &e["amount"], "signature FX");
    }
    let expected = f["landed"].as_array().unwrap();
    let actual = s.landed_hits();
    assert_eq!(
        actual.len(),
        expected.len(),
        "{name} landed tick{}",
        s.tick()
    );
    for (a, e) in actual.iter().zip(expected) {
        assert_eq!(a.by, e["by"].as_str().map(|v| source_id(v, seats)));
        assert_eq!(a.victim, source_id(e["victim"].as_str().unwrap(), seats));
        close(a.amount, &e["amount"], "landed amount");
        assert_eq!(a.sig.map(|v| v.as_str()), e["sig"].as_str());
        assert_eq!(a.weapon.map(|v| v.as_str()), e["weapon"].as_str());
    }
    let heals: Vec<_> = events
        .iter()
        .filter_map(|e| {
            if let crate::Event::Heal { id, amount } = e {
                Some((*id, *amount))
            } else {
                None
            }
        })
        .collect();
    let eh: Vec<_> = f["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["type"] == "fx" && e["fx"]["kind"] == "heal")
        .map(|e| &e["fx"])
        .collect();
    assert_eq!(heals.len(), eh.len(), "{name} heal count tick{}", s.tick());
    for ((id, a), e) in heals.iter().zip(eh) {
        assert_eq!(*id, source_id(e["id"].as_str().unwrap(), seats));
        close(*a, &e["amount"], "heal");
    }
}

#[test]
fn basic_pve_mode_content_and_join_are_closed_before_mutation() {
    let cfg = SimConfig {
        quests: false,
        mob_mode: MobMode::Pve,
        faction_mode: crate::FactionMode::EngagementHolyPlagueFire,
        ..Default::default()
    };
    assert!(Sim::try_new(cfg.clone(), arena("frost"), Secrets::from_seed(1)).is_err());
    let mut full = cfg.clone();
    full.faction_mode = crate::FactionMode::EngagementHolyPlagueFireFrostSentenced;
    assert!(Sim::try_new(full, arena("fire"), Secrets::from_seed(1)).is_err());
    let mut s = Sim::try_new(cfg, arena("fire"), Secrets::from_seed(1)).unwrap();
    let before = serde_json::to_value(&s).unwrap();
    assert!(s
        .add_player("unsupported", Some(FactionId::Frost), false)
        .is_none());
    assert_eq!(serde_json::to_value(&s).unwrap(), before);
    assert!(s
        .add_player("supported", Some(FactionId::Holy), false)
        .is_some());
}

#[test]
fn unsupported_scenario_placements_are_refused_before_loadouts_can_shift() {
    let cfg = SimConfig {
        quests: false,
        mob_mode: MobMode::Pve,
        faction_mode: crate::FactionMode::EngagementHolyPlagueFire,
        ..Default::default()
    };
    let placements = [FactionId::Frost, FactionId::Holy].map(|faction| Placement {
        profile: faction.as_str().into(),
        faction,
        bot: false,
        at: Vec2::new(112., 112.),
        hp: None,
        weapon0: Some(WeaponId::Bow),
        weapon1: None,
    });
    assert!(std::panic::catch_unwind(|| Sim::reset_active(
        cfg,
        arena("fire"),
        Secrets::from_seed(1),
        &placements
    ))
    .is_err());
}
