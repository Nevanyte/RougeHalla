use super::*;

#[global_allocator]
static FROST_ALLOC: dhat::Alloc = dhat::Alloc;

include!("source_helpers.rs");

fn corpus() -> Value {
    let doc: Value = serde_json::from_str(include_str!(
        "../../../../../parity/frost-sources/source.json"
    ))
    .unwrap();
    assert_eq!(doc["format"], "rh-frost-sources-source/1");
    assert_eq!(doc["cases"].as_array().unwrap().len(), 8);
    assert_eq!(
        doc["profile"]["installers"],
        json!([
            "loot",
            "weapons",
            "targeting",
            "projectiles",
            "factions",
            "mobs",
            "buffs",
            "feed",
            "camps",
            "chests",
            "mobLife",
            "mobAI",
            "abilities",
            "vision",
            "cardHooks",
            "bruiserPassives",
            "mods"
        ])
    );
    for key in ["quests", "training", "dummies"] {
        assert_eq!(doc["profile"]["config"][key], false);
    }
    doc
}

fn arena(input: &Value) -> Arena {
    let mut data: Value = serde_json::from_str(include_str!(
        "../../../../../tools/frost-source-fixtures/declared-map-input.json"
    ))
    .unwrap();
    let other = data["regions"]
        .as_array()
        .unwrap()
        .iter()
        .position(|r| r["id"] == "frost")
        .unwrap();
    data["regions"][0]["id"] = json!("frost");
    data["regions"][other]["id"] = json!("fire");
    for camp in data["regions"][0]["mobCamps"].as_array_mut().unwrap() {
        camp["id"] = json!("frost-1");
        camp["region"] = json!("frost");
        camp["weapon"] = json!("shield");
    }
    for p in data["spawnPool"].as_array_mut().unwrap() {
        if p["zone"] == "fire" {
            p["zone"] = json!("frost");
        } else if p["zone"] == "frost" {
            p["zone"] = json!("fire");
        }
    }
    data["camps"][0]["zone"] = json!("frost");
    data["camps"][0]["id"] = json!("frost-1");
    for n in data["regionGrid"].as_array_mut().unwrap() {
        if *n == json!(1) {
            *n = json!(other + 1);
        } else if *n == json!(other + 1) {
            *n = json!(1);
        }
    }
    data["regions"].as_array_mut().unwrap().swap(0, other);
    data["spawns"] = Value::Array(
        data["regions"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|r| r["spawns"].as_array().unwrap().iter().cloned())
            .collect(),
    );
    if input["extraSpots"] == true {
        let spots: Vec<_> = (0..10)
            .map(|i| {
                if i == 5 {
                    json!({"x":208,"y":112})
                } else {
                    json!({"x":80+32*(i%4),"y":80+32*(i/4)})
                }
            })
            .collect();
        data["camps"][0]["spots"] = json!(spots);
        data["regions"][other]["mobCamps"][0]["spots"] = json!(spots);
    }
    let export = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: serde_json::from_value(data).unwrap(),
    };
    export.validate().unwrap().into_arena().unwrap()
}

fn scene(case: &Value) -> Sim {
    let input = &case["input"];
    let placements: Vec<_> = input["players"]
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
            consumables: false,
            quests: false,
            regen: false,
            initial_loot: false,
            min_players: placements.len(),
            lobby_seconds: 30.,
            fill_seconds: 0.,
            mob_mode: MobMode::Pve,
            faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrost,
            ..Default::default()
        },
        arena(input),
        secrets,
        &placements,
    );
    for (i, p) in input["players"].as_array().unwrap().iter().enumerate() {
        if let Some(cards) = p["cards"].as_array() {
            for card in cards {
                let id = crate::cards::CardId::ALL
                    .into_iter()
                    .find(|id| id.as_str() == card.as_str().unwrap())
                    .unwrap();
                let player = sim.players()[i].id;
                assert!(crate::cards::grant(&sim.k, &mut sim.w, player, id));
            }
        }
    }
    sim.take_events();
    sim
}

fn frost_rows(sim: &Sim, output: &Value, map: &BTreeMap<String, PlayerId>) {
    let rows = output["signatures"].as_array().unwrap();
    let mut seen = BTreeSet::new();
    for row in rows {
        let key = row[0].as_str().unwrap();
        let id = fr_npc_ref(map, key, "signature").unwrap();
        assert!(seen.insert(id));
        let Some(core) = sim.w.actor(id) else {
            panic!("missing source actor {key}")
        };
        let f = &core.signature;
        let e = &row[1];
        let expected: Vec<_> = e["chillers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| fr_npc_ref(map, s.as_str().unwrap(), "chiller").unwrap())
            .collect();
        assert_eq!(
            f.chillers,
            expected,
            "tick{} {key} ordered sources",
            sim.tick()
        );
        for (a, k) in [(f.chill, "chill"), (f.frost_move_mult, "frostMoveMult")] {
            fr_npc_close(a, e[k].as_f64().unwrap(), k).unwrap();
        }
        for (a, k) in [
            (f.exposure_started_at, "chillExposureStartedAt"),
            (f.last_near_at, "chillLastNearAt"),
            (f.ranged_chill_until, "rangedChillUntil"),
        ] {
            assert_eq!(a.is_some(), e[k].as_f64().is_some(), "{key}/{k}");
            if let Some(a) = a {
                fr_npc_close(a, e[k].as_f64().unwrap(), k).unwrap();
            }
        }
    }
    for slot in 0..sim.w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        let f = &sim.w.core(ix).signature;
        if !seen.contains(&sim.w.core(ix).id) {
            assert!(
                f.chillers.is_empty() && f.chill == 1.,
                "uncompared nonneutral Frost actor"
            );
        }
    }
}

#[test]
fn frost_sources_actual_runtime_all_frames_and_uninterrupted_restore() {
    let doc = corpus();
    let mut count = 0;
    for case in doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["input"]["kind"] == "runtime")
    {
        let name = case["input"]["name"].as_str().unwrap();
        let mut live = scene(case);
        let seats = live.players().len();
        let mut map = fr_npc_bind_initial(&live, case, seats).unwrap();
        let mut restored = Sim::restore(serde_json::to_value(&live).unwrap()).unwrap();
        assert_eq!(live.state_hash(), restored.state_hash());
        for frame in case["frames"].as_array().unwrap() {
            fr_npc_apply(
                &mut live,
                frame["commands"].as_array().unwrap(),
                &map,
                seats,
            )
            .unwrap();
            fr_npc_apply(
                &mut restored,
                frame["commands"].as_array().unwrap(),
                &map,
                seats,
            )
            .unwrap();
            let events = live.step();
            assert_eq!(events, restored.step(), "{name} restored events");
            assert_eq!(
                live.state_hash(),
                restored.state_hash(),
                "{name} uninterrupted continuation"
            );
            fr_npc_bind_missing_mobs(&live, &frame["output"], seats, &mut map).unwrap();
            fr_npc_compare_frame(&live, frame, &events, &map, seats, name, false).unwrap();
            frost_rows(&live, &frame["output"], &map);
            assert_eq!(
                live.server_time(),
                frame["output"]["time"].as_f64().unwrap()
            );
            let mut reward = crate::private_rng::Sfc32::from_words([1, 2, 3, 4]);
            for _ in 0..frame["output"]["rewardDraws"].as_u64().unwrap() {
                reward.next_f64();
            }
            assert_eq!(
                live.w.reward_rng, reward,
                "{name}: actual source reward offset"
            );
            restored = Sim::restore(serde_json::to_value(&live).unwrap()).unwrap();
        }
        let mut rng = live.w.reward_rng;
        for e in case["next"].as_array().unwrap() {
            assert_eq!(rng.next_f64(), e.as_f64().unwrap());
        }
        count += 1;
    }
    assert_eq!(count, 5);
}

#[test]
fn frost_sources_canonical_restore_history_hash_and_gates() {
    let doc = corpus();
    let case = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["name"] == "runtime-reciprocal-frost-player-npcs")
        .unwrap();
    let mut sim = scene(case);
    let seats = sim.players().len();
    let mut map = fr_npc_bind_initial(&sim, case, seats).unwrap();
    for frame in case["frames"].as_array().unwrap().iter().take(10) {
        fr_npc_apply(&mut sim, frame["commands"].as_array().unwrap(), &map, seats).unwrap();
        sim.step();
        fr_npc_bind_missing_mobs(&sim, &frame["output"], seats, &mut map).unwrap();
    }
    let owner = sim.players()[0].id;
    assert!(!sim.players()[0].signature.chillers.is_empty());
    let value = serde_json::to_value(&sim).unwrap();
    let root = "/world/players/0/core/signature";
    let bad_lists = [
        json!([owner.0]),
        json!([999999]),
        json!([sim.mobs()[0].core.id.0, sim.mobs()[0].core.id.0]),
        json!([null]),
    ];
    for bad in bad_lists {
        let mut b = value.clone();
        *b.pointer_mut(&format!("{root}/chillers")).unwrap() = bad;
        assert!(Sim::restore(b).is_err());
    }
    let mut old = value.clone();
    old["format"] = json!("rh-checkpoint/25");
    assert!(matches!(
        Sim::restore(old),
        Err(crate::CheckpointError::UnsupportedFormat { .. })
    ));
    let mut stale = value.clone();
    stale["world"]["players"][0]["core"]["signature"]["chiller_count"] = json!(1);
    assert!(
        Sim::restore(stale).is_err(),
        "removed count is not accepted in canonical26"
    );
    // Declared structural checkpoint control, not a claim of this exact historical graph: all retained actor IDs and
    // their ordering are state identity even when their minimum chill is equal.
    let ids: Vec<_> = sim.mobs().iter().map(|m| m.core.id).collect();
    let mut changed = value.clone();
    *changed.pointer_mut(&format!("{root}/chillers")).unwrap() = json!(ids);
    let baseline = Sim::restore(changed.clone()).unwrap().state_hash();
    changed
        .pointer_mut(&format!("{root}/chillers"))
        .unwrap()
        .as_array_mut()
        .unwrap()
        .reverse();
    assert_ne!(baseline, Sim::restore(changed).unwrap().state_hash());
    for i in 0..ids.len() {
        let mut fewer = value.clone();
        let list: Vec<_> = ids
            .iter()
            .enumerate()
            .filter(|(n, _)| *n != i)
            .map(|(_, id)| *id)
            .collect();
        *fewer.pointer_mut(&format!("{root}/chillers")).unwrap() = json!(list);
        assert_ne!(
            baseline,
            Sim::restore(fewer).unwrap().state_hash(),
            "each ID and length are hashed"
        );
    }
    // Cached source history survives removal. This uses a real player source produced in the reciprocal runtime.
    let mob = sim
        .mobs()
        .iter()
        .find(|m| m.core.signature.chillers.contains(&owner))
        .unwrap()
        .core
        .id;
    sim.remove_player(owner);
    assert!(sim
        .w
        .actor(mob)
        .unwrap()
        .signature
        .chillers
        .contains(&owner));
    Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
    // Genuine both-mode Full constructor/restore/Clone/replay positives now live in full_profile.rs. Retain the
    // incomplete-capability negative instead of mutating an old Frost checkpoint and expecting supported Full refusal.
    let mut lower = value.clone();
    lower["statics"]["config"]["faction_mode"] = json!(crate::FactionMode::EngagementHolyPlagueFire);
    assert!(Sim::restore(lower).is_err(), "Frost sources require the Frost capability");
    // The source budget comes from real Frost map spots, and training's live practice limit, never the old eight.
    assert_eq!(
        super::super::source_budget(&sim.k).unwrap(),
        MAX_PLAYERS + 3
    );
    let mut training = sim.k.clone();
    training.config.training = true;
    assert_eq!(
        super::super::source_budget(&training).unwrap(),
        MAX_PLAYERS + TRAIN_MAX_MOBS as usize
    );
}

#[test]
fn frost_sources_signature_reset_reuses_storage_and_zeroes_semantic_history() {
    let mut sig = crate::fighter::Signature::default();
    sig.chillers.reserve_exact(32);
    sig.chillers.extend([PlayerId(4), PlayerId(7)]);
    sig.chill = 0.68;
    sig.exposure_started_at = Some(50.);
    sig.last_near_at = Some(50.);
    sig.ranged_chill_until = Some(1250.);
    sig.frost_move_mult = 0.7;
    let pointer = sig.chillers.as_ptr();
    let capacity = sig.chillers.capacity();
    sig.reset();
    assert_eq!(sig, crate::fighter::Signature::default());
    assert_eq!(sig.chillers.as_ptr(), pointer);
    assert_eq!(sig.chillers.capacity(), capacity);
    let encoded = serde_json::to_value(&sig).unwrap();
    assert_eq!(encoded["chillers"], json!([]));
    assert!(encoded.get("chiller_count").is_none());
}

#[test]
fn frost_sources_clone_prepares_actor_and_source_budgets_without_an_input() {
    let doc = corpus();
    let case = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["name"] == "runtime-ten-frost-npc-sources")
        .unwrap();
    let mut original = scene(case);
    assert_eq!(original.w.fighter_count(), 12);
    let mut cloned = original.clone();
    assert_eq!(
        original.step(),
        cloned.step(),
        "clone continuation with no submit or join to grow scratch"
    );
    assert_eq!(original.state_hash(), cloned.state_hash());
    let budget = source_budget(&cloned.k).unwrap();
    assert!(cloned
        .players()
        .iter()
        .all(|p| p.signature.chillers.capacity() >= budget));
    assert!(cloned
        .mobs()
        .iter()
        .all(|m| m.core.signature.chillers.capacity() >= budget));
}

#[test]
fn frost_sources_wide_checked_shape_hashes_each_id_and_refuses_wrong_provenance() {
    // Declared cached-shape controls on actual births, separate from the corpus helper's deliberately transient graph.
    // No source output is installed and this does not claim acquisition/history replay of this exact checkpoint.
    let doc = corpus();
    let case = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["name"] == "helper-eleven-ordered-sources-lifecycle")
        .unwrap();
    let mut sim = scene(case);
    let owner = sim.players()[0].id;
    let mut ids: Vec<_> = sim.mobs().iter().map(|m| m.core.id).collect();
    ids.insert(1, sim.players()[1].id);
    assert_eq!(ids.len(), 11);
    assert!(source_budget(&sim.k).unwrap() >= ids.len());
    let checkpoint = serde_json::to_value(&sim).unwrap();
    let state = |list: &[PlayerId]| {
        let mut cp = checkpoint.clone();
        cp["world"]["players"][0]["core"]["signature"]["chillers"] = json!(list);
        cp["world"]["players"][0]["core"]["signature"]["chill"] = json!(1. - FROST_SLOW);
        Sim::restore(cp).unwrap()
    };
    let baseline = state(&ids);
    let mut reversed = ids.clone();
    reversed.reverse();
    assert_ne!(baseline.state_hash(), state(&reversed).state_hash());
    for i in 0..ids.len() {
        let spare = (i + 1) % ids.len();
        let mut list: Vec<_> = ids
            .iter()
            .enumerate()
            .filter(|(n, _)| *n != spare)
            .map(|(_, id)| *id)
            .collect();
        let original = state(&list);
        assert_ne!(baseline.state_hash(), original.state_hash());
        let at = list.iter().position(|id| *id == ids[i]).unwrap();
        list[at] = ids[spare];
        let edited = state(&list);
        assert_eq!(
            crate::public_snapshot(&original),
            crate::public_snapshot(&edited)
        );
        assert_ne!(
            original.state_hash(),
            edited.state_hash(),
            "actual ID value at{i} hashes independently of count"
        );
    }
    let mut sig = crate::fighter::Signature {
        chillers: vec![ids[0]; source_budget(&sim.k).unwrap() + 1],
        ..Default::default()
    };
    assert!(
        validate_signature(true, source_budget(&sim.k).unwrap(), &sim.w, owner, &sig)
            .unwrap_err()
            .contains("invalid Frost state")
    );
    // Typed recipient constructors are diagnostic inputs here; their origins must never become Frost source authority.
    let mut map = BTreeMap::from([("p0".into(), owner), ("p1".into(), sim.players()[1].id)]);
    source_helper_command(
        &mut sim,
        &json!({"kind":"helper-addMob","resultId":"dummy","spec":{"kind":"dummy","at":{"x":112.,"y":112.}}}),
        &mut map,
    );
    source_helper_command(
        &mut sim,
        &json!({"kind":"helper-placeMob","resultId":"fire","spec":{"region":"fire","at":{"x":112.,"y":112.}}}),
        &mut map,
    );
    for key in ["dummy", "fire"] {
        sig.chillers = vec![map[key]];
        assert_eq!(
            validate_signature(true, source_budget(&sim.k).unwrap(), &sim.w, owner, &sig)
                .unwrap_err(),
            "invalid Frost source"
        );
    }
    // Historical typed Frost identity remains valid with an absent body; this structural control reconstructs no graph.
    let departed = ids[0];
    sim.w.mobs.remove(departed);
    sig.chillers = vec![departed];
    validate_signature(true, source_budget(&sim.k).unwrap(), &sim.w, owner, &sig).unwrap();
}

#[test]
#[ignore = "allocation profiler must run alone: cargo test -p rh-sim --lib frost_sources_warm_alloc -- --ignored --test-threads=1"]
fn frost_sources_warm_alloc_after_birth_restore_and_actual_reset_hook() {
    let doc = corpus();
    let case = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["name"] == "runtime-ten-frost-npc-sources")
        .unwrap();
    let mut sim = scene(case);
    let mut events = Vec::with_capacity(512);
    let attack = |sim: &mut Sim| {
        let who = sim.players()[0].id;
        let target = sim.mobs()[0].core.id;
        let a = crate::math::atan2(
            sim.mobs()[0].core.body.y - sim.players()[0].body.y,
            sim.mobs()[0].core.body.x - sim.players()[0].body.x,
        );
        sim.submit(who, validate(RawCommand::Target { id: target }).unwrap())
            .unwrap();
        sim.submit(who, validate(RawCommand::Attack { a, t: None }).unwrap())
            .unwrap();
    };
    for phase in ["birth", "restore", "reset"] {
        if phase == "restore" {
            sim = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
        }
        if phase == "reset" {
            let capacities: Vec<_> = sim
                .players()
                .iter()
                .map(|p| p.signature.chillers.capacity())
                .chain(
                    sim.mobs()
                        .iter()
                        .map(|m| m.core.signature.chillers.capacity()),
                )
                .collect();
            source_helper_command(
                &mut sim,
                &json!({"kind":"helper-teleported-hook"}),
                &mut BTreeMap::new(),
            );
            let after: Vec<_> = sim
                .players()
                .iter()
                .map(|p| p.signature.chillers.capacity())
                .chain(
                    sim.mobs()
                        .iter()
                        .map(|m| m.core.signature.chillers.capacity()),
                )
                .collect();
            assert_eq!(
                capacities, after,
                "actual hook retains all actor list allocations"
            );
        }
        attack(&mut sim);
        for _ in 0..100 {
            events.clear();
            sim.step_into(&mut events);
        }
        assert!(
            sim.players().iter().any(|p| p
                .signature
                .chillers
                .iter()
                .any(|id| sim.mobs().iter().any(|m| m.core.id == *id))),
            "{phase}: actual NPC source participates"
        );
        assert!(
            sim.players().iter().any(|p| p.signature.chillers.len() > 8),
            "{phase}: real wide source list remains active"
        );
        let directory = std::env::var_os("RH_FROST_ALLOC_DIRECTORY")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let _profiler = dhat::Profiler::builder()
            .testing()
            .file_name(directory.join(format!("rh-frost-alloc-{phase}.json")))
            .build();
        for _ in 0..20 {
            events.clear();
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
            let before = dhat::HeapStats::get().total_blocks;
            sim.step_into(&mut events);
            let after = dhat::HeapStats::get().total_blocks;
            dhat::assert_eq!(after, before);
        }
    }
}

#[test]
fn frost_sources_wake_compaction_matches_old_order_and_contributor_snapshot() {
    let doc = corpus();
    let case = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["name"] == "runtime-npc-base-holy-recipient")
        .unwrap();
    let mut sim = scene(case);
    let p0 = sim.players()[0].id;
    let p1 = sim.players()[1].id;
    // Old implementation oracle: preserve complete request input, first camp occurrence and ranked/tied winner.
    let reference = |sim: &Sim, requests: &[(u32, PlayerId)], order: &[u32]| {
        let rank = |id| {
            sim.w
                .idx(id)
                .and_then(|i| order.iter().position(|&s| s as usize == i))
                .unwrap_or(usize::MAX)
        };
        let tie = |id| {
            crate::rng::tie_rank_origin(
                sim.k.secrets.order_salt,
                sim.w.tick,
                sim.w.actor_origin(id).unwrap(),
            )
        };
        let mut first: Vec<(u32, PlayerId)> = Vec::new();
        for &(camp, target) in requests {
            if !crate::systems::mob_ai::targetable(&sim.w, target) {
                continue;
            }
            if let Some((_, held)) = first.iter_mut().find(|(c, _)| *c == camp) {
                if (rank(target), tie(target)) < (rank(*held), tie(*held)) {
                    *held = target;
                }
            } else {
                first.push((camp, target));
            }
        }
        first
    };
    for tick in 1..=24 {
        sim.w.tick = tick;
        sim.w.server_time = f64::from(tick) * TICK_MS;
        let mut order = vec![0, 1];
        crate::rng::action_order_in_place(sim.k.secrets.order_salt, tick, &mut order);
        let rows = [
            (3, p1),
            (0, p0),
            (3, p0),
            (4, PlayerId(9999)),
            (0, p1),
            (3, p1),
            (7, p0),
            (7, p0),
        ];
        for shift in 0..rows.len() {
            let mut requests = rows.to_vec();
            requests.rotate_left(shift);
            let expected = reference(&sim, &requests, &order);
            let rng = (sim.w.spawn_rng.clone(), sim.w.reward_rng.clone());
            let used =
                crate::systems::mob_life::select_wakes(&sim.k, &sim.w, &mut requests, &order);
            assert_eq!(&requests[..used], expected.as_slice());
            assert_eq!((&rng.0, &rng.1), (&sim.w.spawn_rng, &sim.w.reward_rng));
        }
    }
    // Dead/absent targets are filtered before first-camp selection, just like the old snapshot.
    sim.w.players[1].status = crate::Status::Dead;
    let mut requests = vec![(1, p1), (1, PlayerId(9999)), (2, p0), (1, p0)];
    let used = crate::systems::mob_life::select_wakes(&sim.k, &sim.w, &mut requests, &[1, 0]);
    assert_eq!(&requests[..used], &[(2, p0), (1, p0)]);
    sim.w.players[1].status = crate::Status::Alive;
    sim.w.pay.mob_wakes = vec![(0, p1), (0, p0), (0, p1)];
    let capacity = sim.w.pay.mob_wakes.capacity();
    let mut order = vec![0, 1];
    crate::rng::action_order_in_place(sim.k.secrets.order_salt, sim.w.tick, &mut order);
    let expected = reference(&sim, &sim.w.pay.mob_wakes, &order)[0].1;
    crate::systems::mob_life::settle_wakes(&sim.k, &mut sim.w);
    assert!(sim.w.mobs.iter().all(|m| m.regional_brain().target == Some(expected)));
    assert!(sim.w.pay.is_settled());
    assert!(sim.w.pay.mob_wakes.capacity() >= capacity);
    // Positive present-player IDs are snapshotted in first-hit order; duplicates, None, zero, negative and unknown
    // sources do not enter the camp contributor list. No hook runs inside the streamed append.
    let npc = sim.w.mobs[0].core.id;
    let ix = sim.w.fighter_idx(npc).unwrap();
    let mut events = Vec::new();
    let hit = |by, amount| crate::systems::ledger::Hit {
        terrain: false,
        amount,
        by,
        name: None,
    };
    let hits = [
        hit(Some(p1), 0.),
        hit(Some(PlayerId(9999)), 1.),
        hit(Some(p1), 1.),
        hit(None, 1.),
        hit(Some(p1), 2.),
        hit(Some(p0), 1.),
        hit(Some(p0), -1.),
    ];
    crate::systems::mob_life::hurt(&sim.k, &mut sim.w, &mut events, ix, &hits);
    assert_eq!(
        sim.w.mob_runtime.as_ref().unwrap().life[0].contributors,
        vec![p1, p0]
    );
    let mut dirty = sim.clone();
    dirty.w.pay.mob_wake_order.push(0);
    assert!(
        serde_json::to_value(dirty).is_err(),
        "derived work cannot be silently skipped at checkpoint"
    );
}
