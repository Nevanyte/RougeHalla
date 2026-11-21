use super::*;
use rh_sim::{PlanView, PlanningView, SpawnOptionView, Vec2};

#[test]
fn typed_trophy_rows_preserve_order_and_invalid_gain_refuses_without_commit() {
    let mut obs = Observation::default();
    obs.reward_chests
        .push(rh_sim::reward_chests::RewardChestView {
            handle: rh_sim::reward_chests::RewardChestHandle::from_wire(7).unwrap(),
            at: rh_sim::Vec2::new(100., 100.),
            expires_at: 1000.,
            options: vec![
                rh_sim::reward_chests::RewardOptionView {
                    id: rh_sim::reward_chests::OptionId::Card(rh_sim::cards::CardId::ALL[79]),
                    taken: false,
                    taken_by: None,
                },
                rh_sim::reward_chests::RewardOptionView {
                    id: rh_sim::reward_chests::OptionId::Kill(rh_sim::kill_augments::KillAugment {
                        key: rh_sim::kill_augments::KillStatKey::AttackSpeed,
                        gain: 0.0,
                    }),
                    taken: false,
                    taken_by: None,
                },
                rh_sim::reward_chests::RewardOptionView {
                    id: rh_sim::reward_chests::OptionId::Boost(
                        rh_sim::reward_chests::BoostId::ALL[7],
                    ),
                    taken: false,
                    taken_by: None,
                },
            ],
            picked: false,
            can_choose: true,
            first_pick: None,
        });
    let mut publisher = CollectionPublisher::default();
    for gain in [0.0, -0.0, -1.0, f64::NAN, f64::INFINITY] {
        obs.reward_chests[0].options[1].id =
            rh_sim::reward_chests::OptionId::Kill(rh_sim::kill_augments::KillAugment {
                key: rh_sim::kill_augments::KillStatKey::AttackSpeed,
                gain,
            });
        assert!(publisher.prepare(&obs, true, true, false).is_err());
        assert!(
            !publisher.sent,
            "invalid gain {gain:?} refuses the complete offer before any baseline can commit"
        );
    }

    obs.reward_chests[0].options[1].id =
        rh_sim::reward_chests::OptionId::Kill(rh_sim::kill_augments::KillAugment {
            key: rh_sim::kill_augments::KillStatKey::AttackSpeed,
            gain: f64::from_bits(0x4019_0000_0000_0001),
        });
    let pending = publisher.prepare(&obs, true, true, false).unwrap();
    assert!(!publisher.sent, "prepare does not commit the baseline");
    let ServerMsg::State { items, .. } =
        ServerMsg::decode(pending.frame.as_ref().unwrap()).unwrap()
    else {
        panic!()
    };
    assert_eq!(
        items.iter().map(StateItem::key).collect::<Vec<_>>(),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
    );
    let StateItem::RewardChests(rows) = &items[3] else {
        panic!()
    };
    assert_eq!(rows[0].options.len(), 3);
    assert_eq!(rows[0].options[0].id, WireRewardId::Card(79));
    assert_eq!(
        rows[0].options[1].id,
        WireRewardId::Kill {
            key: rh_protocol::TrophyStatKey::AttackSpeed,
            gain: f64::from_bits(0x4019_0000_0000_0001),
        }
    );
    assert_eq!(rows[0].options[2].id, WireRewardId::Boost(7));
    assert_eq!(
        rows[0]
            .options
            .iter()
            .map(|option| match option.id {
                WireRewardId::Card(_) => "card",
                WireRewardId::Kill { .. } => "trophy",
                WireRewardId::Boost(_) => "boost",
            })
            .collect::<Vec<_>>(),
        ["card", "trophy", "boost"],
        "wire indices must preserve the native row order"
    );
    pending.commit(&mut publisher);
    assert!(publisher.sent);
}
#[test]
fn collection_baselines_commit_after_enqueue_and_defer_flooded_resyncs() {
    let mut publisher = CollectionPublisher::default();
    let mut obs = Observation::default();
    let first = publisher.prepare(&obs, false, false, false).unwrap();
    assert!(first.frame.is_some());
    drop(first); // Failed enqueue must leave the first complete replacement pending.
    let first = publisher.prepare(&obs, false, false, false).unwrap();
    let ServerMsg::State { items, .. } = ServerMsg::decode(first.frame.as_ref().unwrap()).unwrap()
    else {
        panic!()
    };
    assert_eq!(
        items.iter().map(StateItem::key).collect::<Vec<_>>(),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
    );
    first.commit(&mut publisher);
    assert!(publisher
        .prepare(&obs, false, false, false)
        .unwrap()
        .frame
        .is_none());
    obs.tick = 1;
    assert!(publisher
        .prepare(&obs, false, false, true)
        .unwrap()
        .commit(&mut publisher));
    obs.tick = 2;
    assert!(publisher
        .prepare(&obs, false, false, true)
        .unwrap()
        .frame
        .is_none());
    obs.tick = 21;
    assert!(publisher
        .prepare(&obs, false, false, true)
        .unwrap()
        .frame
        .is_some());
    publisher.reconnect();
    assert!(publisher
        .prepare(&obs, false, false, false)
        .unwrap()
        .frame
        .is_some());
}
#[test]
fn actual_potions_camps_and_projectiles_commit_retain_clear_and_reconnect() {
    let mut publisher = CollectionPublisher::default();
    let mut obs = Observation {
        inventory: Some(Inventory {
            active_slot: 0,
            slots: [None, None],
            potion_small: 5,
            potion_large: 4,
            potions_healing: 3,
            healing_until: None,
            speed_boost_until: None,
        }),
        ..Observation::default()
    };
    obs.camps.push(rh_sim::mob_runtime::CampRoster {
        mob_type: rh_sim::mob_catalog::MobTypeId::EmberImp,
        elite: Some(rh_sim::mob_catalog::MobTypeId::Archon),
        alive: 2,
        state: 0,
        cleared_at: 0.,
        respawn_at: 0.,
    });
    let flight = rh_sim::ProjectileView {
        height: Default::default(),
        kind: rh_sim::ProjectileKind::Ball,
        x: 800,
        y: 900,
        facing: 12345,
        owner: Some(rh_sim::PlayerId(0x8000_0201)),
    };
    obs.projectiles.extend([flight, flight]);
    let pending = publisher.prepare(&obs, false, false, false).unwrap();
    let first = pending.frame.clone().unwrap();
    let ServerMsg::State { items, .. } = ServerMsg::decode(&first).unwrap() else {
        panic!()
    };
    assert_eq!(
        items.iter().map(StateItem::key).collect::<Vec<_>>(),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
    );
    assert!(matches!(
        items[0],
        StateItem::Inventory(Some(WireInventory {
            potion_small: 5,
            potions_healing: 3,
            ..
        }))
    ));
    assert!(
        matches!(&items[5],StateItem::Camps(v) if v[0].mob_type==0 && v[0].elite==Some(29) && v[0].alive==2)
    );
    assert!(
        matches!(&items[6],StateItem::Projectiles(v) if v.len()==2 && v[0]==v[1] && v[0].kind==1 && v[0].owner==Some(0x8000_0201))
    );
    drop(pending);
    assert_eq!(
        publisher.prepare(&obs, false, false, false).unwrap().frame,
        Some(first)
    );
    publisher
        .prepare(&obs, false, false, false)
        .unwrap()
        .commit(&mut publisher);
    assert!(publisher
        .prepare(&obs, false, false, false)
        .unwrap()
        .frame
        .is_none());
    obs.tick = 1;
    obs.camps.clear();
    obs.projectiles.clear();
    let clear = publisher.prepare(&obs, false, false, false).unwrap();
    let ServerMsg::State { items, .. } = ServerMsg::decode(clear.frame.as_ref().unwrap()).unwrap()
    else {
        panic!()
    };
    assert_eq!(
        items,
        vec![StateItem::Camps(vec![]), StateItem::Projectiles(vec![])]
    );
    clear.commit(&mut publisher);
    assert!(publisher
        .prepare(&obs, false, false, false)
        .unwrap()
        .frame
        .is_none());
    publisher.reconnect();
    let full = publisher.prepare(&obs, false, false, false).unwrap();
    let ServerMsg::State { items, .. } = ServerMsg::decode(full.frame.as_ref().unwrap()).unwrap()
    else {
        panic!()
    };
    assert_eq!(
        items.iter().map(StateItem::key).collect::<Vec<_>>(),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
    );
}

#[test]
fn malformed_authoritative_collections_refuse_before_baseline_changes() {
    let publisher = CollectionPublisher::default();
    let good = Observation::default();
    let expected = publisher.prepare(&good, false, false, false).unwrap().frame;
    let mut invalid = Observation::default();
    invalid.projectiles.push(rh_sim::ProjectileView {
        height: Default::default(),
        kind: rh_sim::ProjectileKind::Arrow,
        x: 0,
        y: 0,
        facing: 0,
        owner: Some(rh_sim::PlayerId(0)),
    });
    assert!(publisher.prepare(&invalid, false, false, false).is_err());
    assert_eq!(
        publisher.prepare(&good, false, false, false).unwrap().frame,
        expected
    );
}

#[test]
fn invalid_plan_walk_time_is_refused_rather_than_changed_to_absent() {
    let publisher = CollectionPublisher::default();
    let good = Observation::default();
    let expected = publisher.prepare(&good, false, false, false).unwrap().frame;
    for value in [-1., f64::INFINITY, f64::NAN, f64::MAX] {
        let obs = Observation {
            plan: Some(PlanningView {
                plan: PlanView {
                    ends_at: 1000.,
                    spawns: [0, -1],
                    taken: [false; 2],
                    pick: -1,
                    boons: vec![],
                    boon: -1,
                },
                options: [
                    Some(SpawnOptionView {
                        index: 0,
                        at: Vec2::new(10., 20.),
                        zone: rh_sim::mapdata::Zone::Fire,
                        walk_distance: None,
                        walk_seconds: Some(value),
                    }),
                    None,
                ],
                ready: false,
            }),
            ..Observation::default()
        };
        assert!(matches!(
            publisher.prepare(&obs, false, false, false),
            Err(EncodeError::BadValue("plan walk seconds"))
        ));
        assert_eq!(
            publisher.prepare(&good, false, false, false).unwrap().frame,
            expected
        );
    }
}

/// The pinned-container capture's actual owner plan messages project field for field into wire State key 8. The deal
/// values come from `parity/arena/source.json` (a captured legacy corpus, never regenerated from Rust); the resolved
/// option facts cross-check the captured seed-1 spawn pool and the captured `spawnWalks` helper vectors.
#[test]
fn captured_plan_messages_project_field_for_field_into_state_key_8() {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/arena/source.json"
    ))
    .expect("arena capture");
    let source: serde_json::Value = serde_json::from_str(&text).unwrap();
    let pool = source["map"]["export"]["map"]["spawnPool"]
        .as_array()
        .unwrap();
    let walks = source["maths"]["spawnWalks"].as_array().unwrap();
    assert_eq!(pool.len(), walks.len());
    let mut checked = 0;
    let mut cleared = 0;
    let mut projected_first = None;
    for case in source["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        if !name.starts_with("planning-")
            || case["input"]["map"] == "no-pool"
            || case["input"].get("poolIndices").is_some()
        {
            continue;
        }
        for frame in case["frames"].as_array().unwrap() {
            let Some(owner_plans) = frame["ownerPlans"].as_array() else {
                continue;
            };
            for owner in owner_plans {
                let legacy = &owner["plan"];
                if legacy.is_null() {
                    // Past planning the owner's key is cleared (the observation carries no plan).
                    assert!(plan(&Observation::default()).unwrap().is_none());
                    cleared += 1;
                    continue;
                }
                let ends_at = legacy["endsAt"].as_f64().unwrap();
                let spawns: [i32; 2] =
                    std::array::from_fn(|i| legacy["spawns"][i].as_i64().unwrap() as i32);
                let taken: [bool; 2] =
                    std::array::from_fn(|i| legacy["taken"][i].as_bool().unwrap());
                let boons: Vec<String> = legacy["boons"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|b| b.as_str().unwrap().to_owned())
                    .collect();
                let pick = legacy["pick"].as_i64().unwrap() as i8;
                let boon = legacy["boon"].as_i64().unwrap() as i8;
                let options: [Option<SpawnOptionView>; 2] = std::array::from_fn(|i| {
                    let index = spawns[i];
                    (index >= 0).then(|| {
                        let point = &pool[index as usize];
                        let distance = walks[index as usize].as_f64().unwrap();
                        SpawnOptionView {
                            index: index as u32,
                            at: Vec2::new(
                                point["x"].as_f64().unwrap(),
                                point["y"].as_f64().unwrap(),
                            ),
                            zone: serde_json::from_value(point["zone"].clone()).unwrap(),
                            walk_distance: Some(distance),
                            walk_seconds: Some(distance / rh_sim::constants::PLAYER_SPEED),
                        }
                    })
                });
                let observation = Observation {
                    plan: Some(PlanningView {
                        plan: PlanView {
                            ends_at,
                            spawns,
                            taken,
                            pick,
                            boons: boons.clone(),
                            boon,
                        },
                        options,
                        ready: false,
                    }),
                    ..Default::default()
                };
                let expected = WirePlan {
                    ends_at,
                    spawns: std::array::from_fn(|i| (spawns[i] >= 0).then_some(spawns[i] as u32)),
                    taken,
                    pick: (pick >= 0).then_some(pick as u8),
                    boons: boons.clone(),
                    boon: (boon >= 0).then_some(boon as u8),
                    ready: false,
                    options: std::array::from_fn(|i| {
                        let index = spawns[i];
                        (index >= 0).then(|| {
                            let index = index as usize;
                            let point = &pool[index];
                            let (x, y) = (
                                point["x"].as_f64().unwrap() as f32,
                                point["y"].as_f64().unwrap() as f32,
                            );
                            let zone: rh_sim::mapdata::Zone =
                                serde_json::from_value(point["zone"].clone()).unwrap();
                            WirePlanOption {
                                index: index as u32,
                                x: rh_protocol::quant::quantize_pos(x),
                                y: rh_protocol::quant::quantize_pos(y),
                                zone: zone.code(),
                                walk_seconds: Some(
                                    (walks[index].as_f64().unwrap()
                                        / rh_sim::constants::PLAYER_SPEED)
                                        as f32,
                                ),
                            }
                        })
                    }),
                };
                let wire = plan(&observation)
                    .expect("the projection encodes")
                    .expect("the observation carries an owner plan");
                assert_eq!(wire, expected, "{name}/{}", owner["id"]);
                if projected_first.is_none() {
                    projected_first = Some(wire.clone());
                }
                // The complete-replacement State frame carries the same facts on the wire and round-trips strictly.
                let message = ServerMsg::State {
                    tick: 5,
                    items: vec![StateItem::Plan(Some(wire.clone())), StateItem::Arena(None)],
                };
                let bytes = message.try_encode().unwrap();
                assert_eq!(ServerMsg::decode(&bytes).unwrap(), message);
                checked += 1;
                if checked >= 30 {
                    break;
                }
            }
            if checked >= 30 {
                break;
            }
        }
        if checked >= 30 {
            break;
        }
    }
    assert!(
        checked >= 30,
        "captured owner plan messages project exactly"
    );
    assert!(cleared > 0, "a captured post-planning frame clears the key");
    // Mutation guard: the capture comparison is not vacuous. A changed pick or a shifted spawn must not compare equal.
    let first = projected_first.expect("a captured owner plan");
    let mut tampered = first.clone();
    tampered.pick = Some(u8::from(tampered.pick == Some(0)));
    assert_ne!(tampered, first);
    let mut shifted = first.clone();
    shifted.spawns[0] = Some(shifted.spawns[0].map_or(0, |v| v + 1));
    assert_ne!(shifted, first);
}
#[test]
fn quest_item_cross_refs_refuse_without_committing_and_empty_is_available() {
    let mut obs = Observation::default();
    obs.props.push(rh_sim::VisibleProp {
        handle: rh_sim::PickupHandle::new(1).unwrap(),
        cue: rh_sim::PropCue {
            x: 8,
            y: 8,
            focused: false,
            body_hint: None,
            kind: PropKind::QuestItem {
                quest: rh_sim::quest_view::QuestHandle::new(1).unwrap(),
                fetch: false,
            },
        },
    });
    assert!(
        props(&obs).is_ok(),
        "prop payload is supported, its quest ref needs the reconstructed view"
    );
    assert!(CollectionPublisher::default()
        .prepare(&obs, true, false, false)
        .is_err());
    assert!(CollectionPublisher::default()
        .prepare(&obs, false, false, false)
        .is_err());
    obs.props.clear();
    obs.quests = Some(rh_sim::quest_view::QuestView::default());
    let pending = CollectionPublisher::default()
        .prepare(&obs, false, false, false)
        .unwrap();
    let ServerMsg::State { items, .. } =
        ServerMsg::decode(pending.frame.as_ref().unwrap()).unwrap()
    else {
        panic!()
    };
    assert!(items
        .iter()
        .any(|item| matches!(item, StateItem::Quests(Some(view)) if view.rows.is_empty())));
}

#[test]
fn quest_projection_preserves_duplicate_labels_owner_facts_and_transactional_baselines() {
    let view: rh_sim::quest_view::QuestView = serde_json::from_value(serde_json::json!({
        "unknown_count": 3, "display_unknown_count": 2, "owner_roster": 2,
        "roster": [{"id":1,"label":"same"},{"id":2,"label":"same"}],
        "rows": [{"handle":1,"def":"cache","giver":{"x":100.125,"y":200.25},
            "name":"same","giver_label":"decorative same","brief":"opaque brief",
            "objective":"server objective","reward":"saved reward wording",
            "state":"Done","expires_at":999.5,
            "participants":[{"id":1,"accepted":true,"progress":4,"visited":0},
                {"id":2,"accepted":true,"progress":3,"visited":0}],
            "carrier":null,"done_by":"same","can_accept":false,"owner_accepted":true,
            "owner_progress":3,"owner_visited":0,"owner_completed":false,"owner_ready":false}],
        "objectives": []
    }))
    .unwrap();
    let admitted = view.clone();
    let mut obs = Observation {
        quests: Some(view),
        ..Default::default()
    };
    let mut publisher = CollectionPublisher::default();
    let pending = publisher.prepare(&obs, false, false, false).unwrap();
    let first_bytes = pending.frame.clone();
    drop(pending);
    let retry = publisher.prepare(&obs, false, false, false).unwrap();
    assert_eq!(
        retry.frame, first_bytes,
        "discarded guard advances no baselines"
    );
    let ServerMsg::State { items, .. } = ServerMsg::decode(retry.frame.as_ref().unwrap()).unwrap()
    else {
        panic!()
    };
    let projected = items
        .iter()
        .find_map(|item| match item {
            StateItem::Quests(Some(view)) => Some(view),
            _ => None,
        })
        .unwrap();
    assert_eq!(projected.roster[0].label, projected.roster[1].label);
    assert_ne!(projected.roster[0].id, projected.roster[1].id);
    assert!(
        !projected.rows[0].owner_completed,
        "display label never infers completion identity"
    );
    assert_eq!(projected.rows[0].owner_progress, 3);
    assert_eq!(projected.rows[0].giver.x, 100.125);
    assert_eq!(projected.rows[0].name, "same");
    assert_eq!(projected.rows[0].giver_label, "decorative same");
    assert_eq!(projected.rows[0].brief, "opaque brief");
    assert_eq!(projected.rows[0].objective, "server objective");
    assert_eq!(projected.rows[0].reward, "saved reward wording");
    retry.commit(&mut publisher);
    assert!(publisher
        .prepare(&obs, false, false, false)
        .unwrap()
        .frame
        .is_none());
    for field in 0..5 {
        let mut changed = obs.clone();
        let row = &mut changed.quests.as_mut().unwrap().rows[0];
        match field {
            0 => row.name.push('!'),
            1 => row.giver_label.push('!'),
            2 => row.brief.push('!'),
            3 => row.objective.push('!'),
            _ => row.reward.push('!'),
        }
        let pending = publisher.prepare(&changed, false, false, false).unwrap();
        let ServerMsg::State { items, .. } =
            ServerMsg::decode(pending.frame.as_ref().unwrap()).unwrap()
        else {
            panic!()
        };
        assert!(
            matches!(&items[..], [StateItem::Quests(Some(_))]),
            "metadata-only change{field}"
        );
        drop(pending);
        assert!(publisher
            .prepare(&obs, false, false, false)
            .unwrap()
            .frame
            .is_none());
    }
    let mut oversized = obs.clone();
    let template = oversized.quests.as_ref().unwrap().rows[0].clone();
    oversized.quests.as_mut().unwrap().rows = (1..=20)
        .map(|id| {
            let mut row = template.clone();
            row.handle = rh_sim::quest_view::QuestHandle::new(id).unwrap();
            row.name = "n".repeat(255);
            row.giver_label = "g".repeat(255);
            row.brief = "b".repeat(255);
            row.objective = "o".repeat(255);
            row.reward = "r".repeat(255);
            row
        })
        .collect();
    assert!(
        matches!(
            publisher.prepare(&oversized, false, false, false),
            Err(EncodeError::TooLarge { max: 24576, .. })
        ),
        "individually valid metadata cannot bypass the aggregate value bound"
    );
    assert!(publisher
        .prepare(&obs, false, false, false)
        .unwrap()
        .frame
        .is_none());
    obs.quests.as_mut().unwrap().rows[0].giver.x = f64::NAN;
    assert!(publisher.prepare(&obs, false, false, false).is_err());
    obs.quests.as_mut().unwrap().rows[0].giver.x = 100.125;
    assert!(
        publisher
            .prepare(&obs, false, false, false)
            .unwrap()
            .frame
            .is_none(),
        "failed encode advances no baseline"
    );
    obs.quests = None;
    let cleared = publisher.prepare(&obs, false, false, false).unwrap();
    let ServerMsg::State { items, .. } =
        ServerMsg::decode(cleared.frame.as_ref().unwrap()).unwrap()
    else {
        panic!()
    };
    assert_eq!(items, vec![StateItem::Quests(None)]);
    obs.quests = Some(admitted);
    obs.quests.as_mut().unwrap().rows[0].state = rh_sim::quest_view::RowState::Open;
    obs.quests.as_mut().unwrap().rows[0].done_by = None;
    obs.props.push(rh_sim::VisibleProp {
        handle: rh_sim::PickupHandle::new(3).unwrap(),
        cue: rh_sim::PropCue {
            x: 8,
            y: 8,
            focused: false,
            body_hint: None,
            kind: PropKind::QuestItem {
                quest: rh_sim::quest_view::QuestHandle::new(1).unwrap(),
                fetch: false,
            },
        },
    });
    publisher
        .prepare(&obs, true, false, false)
        .unwrap()
        .commit(&mut publisher);
    obs.props.clear();
    obs.quests = None;
    assert!(
        publisher.prepare(&obs, false, false, false).is_err(),
        "quest removal cannot orphan a retained prop even when current observation has cleared it"
    );
    assert!(
        publisher.prepare(&obs, true, false, false).is_ok(),
        "matching prop and quest clears are one valid atomic replacement"
    );
}
