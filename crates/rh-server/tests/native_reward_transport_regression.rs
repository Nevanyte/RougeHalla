use rh_protocol::{
    RewardChestHandle as WireRewardChestHandle, ServerMsg, StateItem, TrophyStatKey, WireCommand,
    WireRewardChest, WireRewardId,
};
use rh_server::{
    wire::{command as wire_command, Publisher},
    wire_state::CollectionPublisher,
};
use rh_sim::{ItemObserver, PlayerId, PublicCommand, RawCommand, Sim};
#[path = "support/trophy_fixture.rs"]
mod trophy_fixture;
use trophy_fixture::four_seat_validated_pvp_kill;

fn wire_key(key: rh_sim::kill_augments::KillStatKey) -> TrophyStatKey {
    match key {
        rh_sim::kill_augments::KillStatKey::Ad => TrophyStatKey::Ad,
        rh_sim::kill_augments::KillStatKey::Ap => TrophyStatKey::Ap,
        rh_sim::kill_augments::KillStatKey::Damage => TrophyStatKey::Damage,
        rh_sim::kill_augments::KillStatKey::Health => TrophyStatKey::Health,
        rh_sim::kill_augments::KillStatKey::AttackSpeed => TrophyStatKey::AttackSpeed,
        rh_sim::kill_augments::KillStatKey::Armor => TrophyStatKey::Armor,
        rh_sim::kill_augments::KillStatKey::Mr => TrophyStatKey::Mr,
        rh_sim::kill_augments::KillStatKey::Speed => TrophyStatKey::Speed,
        rh_sim::kill_augments::KillStatKey::Leech => TrophyStatKey::Leech,
    }
}

fn sim_key(key: TrophyStatKey) -> rh_sim::kill_augments::KillStatKey {
    match key {
        TrophyStatKey::Ad => rh_sim::kill_augments::KillStatKey::Ad,
        TrophyStatKey::Ap => rh_sim::kill_augments::KillStatKey::Ap,
        TrophyStatKey::Damage => rh_sim::kill_augments::KillStatKey::Damage,
        TrophyStatKey::Health => rh_sim::kill_augments::KillStatKey::Health,
        TrophyStatKey::AttackSpeed => rh_sim::kill_augments::KillStatKey::AttackSpeed,
        TrophyStatKey::Armor => rh_sim::kill_augments::KillStatKey::Armor,
        TrophyStatKey::Mr => rh_sim::kill_augments::KillStatKey::Mr,
        TrophyStatKey::Speed => rh_sim::kill_augments::KillStatKey::Speed,
        TrophyStatKey::Leech => rh_sim::kill_augments::KillStatKey::Leech,
    }
}

fn trophy_state(sim: &Sim, chest_id: u32) -> serde_json::Value {
    let state = serde_json::to_value(sim).unwrap();
    state["world"]["reward_chests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chest| chest["id"].as_u64() == Some(u64::from(chest_id)))
        .unwrap_or_else(|| panic!("Trophy {chest_id} remains in the authoritative sim"))
        .clone()
}

fn decoded_reward_rows(frame: &[u8]) -> Vec<WireRewardChest> {
    let ServerMsg::State { items, .. } = ServerMsg::decode(frame).unwrap() else {
        panic!("reliable collection frame must decode as State");
    };
    items
        .into_iter()
        .find_map(|item| match item {
            StateItem::RewardChests(rows) => Some(rows),
            _ => None,
        })
        .expect("full reliable state includes RewardChests")
}

/// A direct Publisher + CollectionPublisher delivery. The test commits both staged ledgers only after
/// decoding the reliable state frame, mirroring the production post-enqueue commit boundary.
fn deliver_reward_state(
    sim: &Sim,
    viewer: PlayerId,
    observer: &mut ItemObserver,
    publisher: &mut Publisher,
    collections: &mut CollectionPublisher,
    last_step: &[rh_sim::Event],
) -> Vec<WireRewardChest> {
    let (frames, offer) = publisher
        .frames_prepared(
            observer,
            None,
            sim,
            0,
            last_step,
            &mut Vec::new(),
            last_step,
        )
        .unwrap();
    assert!(frames.snapshot.is_ok() && frames.refused.is_none());
    let pending = collections
        .prepare(
            publisher.observation(),
            offer.props_changed(),
            offer.rewards_changed(),
            false,
        )
        .unwrap();
    let frame = pending
        .frame
        .as_deref()
        .expect("a new connection gets a reliable full collection state");
    let rows = decoded_reward_rows(frame);
    pending.commit(collections);
    offer.commit();
    assert_eq!(observer.viewer(), viewer);
    rows
}

fn send_wire_command_as(
    sim: &mut Sim,
    player: PlayerId,
    observer: &ItemObserver,
    message: WireCommand,
) -> Vec<rh_sim::Event> {
    let proposal = wire_command(message);
    let command = observer.resolve(sim, proposal).unwrap();
    sim.submit(player, command).unwrap();
    sim.step()
}

fn send_wire_choose_as(
    sim: &mut Sim,
    player: PlayerId,
    observer: &ItemObserver,
    handle: WireRewardChestHandle,
    pick: i8,
) -> Vec<rh_sim::Event> {
    send_wire_command_as(sim, player, observer, WireCommand::Choose { handle, pick })
}

fn send_wire_choose(
    sim: &mut Sim,
    observer: &ItemObserver,
    handle: WireRewardChestHandle,
    pick: i8,
) -> Vec<rh_sim::Event> {
    send_wire_choose_as(sim, PlayerId(1), observer, handle, pick)
}

#[test]
fn real_pvp_trophy_is_published_owner_only_and_granted_by_original_wire_index() {
    let (born, kill_events) = four_seat_validated_pvp_kill();
    assert!(kill_events.iter().any(|e| matches!(
        e,
        rh_sim::Event::Death {
            id: PlayerId(2),
            ..
        }
    )));
    let born_state = serde_json::to_value(&born).unwrap();
    let chests = born_state["world"]["reward_chests"].as_array().unwrap();
    let trophies: Vec<_> = chests
        .iter()
        .filter(|chest| chest["owner"].as_u64() == Some(1))
        .collect();
    assert_eq!(
        trophies.len(),
        1,
        "the validated credited kill creates one owner-bound Trophy"
    );
    let chest = trophies[0];
    assert_eq!(chest["owner"].as_u64(), Some(1));
    let chest_id = chest["id"].as_u64().unwrap() as u32;
    let birth_tick = born.tick();
    let held_until = chest["held_until_tick"].as_u64().unwrap() as u32;
    assert_eq!(
        held_until,
        birth_tick + 1,
        "fixture retains source one-tick birth hold"
    );

    // Owner and stranger see the same publication policy before, at, and after the hold. No
    // Trophy or stat is installed: each state derives from the actual killed player's source roll.
    for tick in [birth_tick, held_until, held_until + 1] {
        let mut probe = born.clone();
        while probe.tick() < tick {
            probe.step();
        }
        for viewer in [PlayerId(1), PlayerId(3)] {
            let mut observer = ItemObserver::new(viewer);
            let mut publisher = Publisher::default();
            let mut collections = CollectionPublisher::default();
            let rows = deliver_reward_state(
                &probe,
                viewer,
                &mut observer,
                &mut publisher,
                &mut collections,
                &[],
            );
            let trophies: Vec<_> = rows
                .iter()
                .filter(|row| {
                    row.options
                        .iter()
                        .any(|o| matches!(o.id, WireRewardId::Kill { .. }))
                })
                .collect();
            if viewer == PlayerId(1) {
                assert_eq!(trophies.len(), 1, "owner row at tick {tick}");
                assert_eq!(trophies[0].can_choose, tick > held_until);
            } else {
                assert!(
                    trophies.is_empty(),
                    "stranger never receives the private row at tick {tick}"
                );
            }
        }
    }

    // The owner has a delivered row before/at the hold but cannot spend it at the held processing
    // tick. A queued command advances one step before execution, so submit at the birth tick to
    // exercise processing exactly at held_until (submitting at held_until executes after it).
    for tick in [birth_tick] {
        let mut probe = born.clone();
        while probe.tick() < tick {
            probe.step();
        }
        let mut observer = ItemObserver::new(PlayerId(1));
        let mut publisher = Publisher::default();
        let mut collections = CollectionPublisher::default();
        let rows = deliver_reward_state(
            &probe,
            PlayerId(1),
            &mut observer,
            &mut publisher,
            &mut collections,
            &[],
        );
        let row = rows
            .iter()
            .find(|r| {
                r.options
                    .iter()
                    .any(|o| matches!(o.id, WireRewardId::Kill { .. }))
            })
            .unwrap();
        let before = probe.player(PlayerId(1)).unwrap().kill_stats;
        let events = send_wire_choose(&mut probe, &observer, row.handle, 0);
        assert!(
            !events.iter().any(|e| matches!(
                e,
                rh_sim::Event::ChestTaken { chest, .. } if *chest == chest_id
            )),
            "pre-hold Choose must not take the Trophy (id {chest_id}); events: {events:?}"
        );
        let trophy = trophy_state(&probe, chest_id);
        assert!(trophy["taken"]
            .as_array()
            .unwrap()
            .iter()
            .all(serde_json::Value::is_null));
        assert_eq!(probe.player(PlayerId(1)).unwrap().kill_stats, before);
    }

    let ready_tick = held_until + 1;
    let mut sim = born.clone();
    let mut last_step = kill_events;
    while sim.tick() < ready_tick {
        last_step = sim.step();
    }

    let mut observer = ItemObserver::new(PlayerId(1));
    let mut publisher = Publisher::default();
    let mut collections = CollectionPublisher::default();

    // A deliberately dropped prepared offer cannot issue handles or change the reliable baseline;
    // the Room/outbox rejection path is covered separately in its server unit test.
    let (_frames, offer) = publisher
        .frames_prepared(
            &mut observer,
            None,
            &sim,
            0,
            &last_step,
            &mut Vec::new(),
            &last_step,
        )
        .unwrap();
    let candidate_handle = publisher.observation().reward_chests[0].handle;
    let native_options = publisher.observation().reward_chests[0].options.clone();
    let pending = collections
        .prepare(
            publisher.observation(),
            offer.props_changed(),
            offer.rewards_changed(),
            false,
        )
        .unwrap();
    let candidate_rows = decoded_reward_rows(pending.frame.as_deref().unwrap());
    let candidate = candidate_rows
        .iter()
        .find(|r| {
            r.options
                .iter()
                .any(|o| matches!(o.id, WireRewardId::Kill { .. }))
        })
        .expect("owner reliable frame carries the complete Trophy row");
    assert_eq!(candidate.handle.get(), candidate_handle.wire());
    drop(pending);
    drop(offer);
    let retry = collections
        .prepare(publisher.observation(), true, true, false)
        .unwrap();
    assert!(
        retry.frame.is_some(),
        "dropped state did not commit its collection baseline"
    );
    drop(retry);
    assert_eq!(
        observer
            .resolve(
                &sim,
                PublicCommand::Choose {
                    handle: candidate_handle,
                    pick: 0
                }
            )
            .unwrap(),
        rh_sim::validate(RawCommand::Choose {
            chest_id: None,
            pick: 0
        })
        .unwrap(),
        "dropped observation did not commit a server-side handle binding"
    );

    // A second prepared delivery uses that still-unissued handle. Compare every typed option to
    // the native source row, then choose the original final slot through WireCommand and submit.
    let delivered = deliver_reward_state(
        &sim,
        PlayerId(1),
        &mut observer,
        &mut publisher,
        &mut collections,
        &last_step,
    );
    let row = delivered
        .iter()
        .find(|r| {
            r.options
                .iter()
                .any(|o| matches!(o.id, WireRewardId::Kill { .. }))
        })
        .expect("owner reliable retry includes Trophy");
    assert_eq!(
        row.handle.get(),
        candidate.handle.get(),
        "dropped offer did not spend the handle"
    );
    assert!(row.can_choose);
    let native_kills: Vec<_> = native_options
        .iter()
        .map(|o| match o.id {
            rh_sim::reward_chests::OptionId::Kill(a) => (wire_key(a.key), a.gain),
            _ => panic!("actual Trophy contains only Kill options"),
        })
        .collect();
    let wire_kills: Vec<_> = row
        .options
        .iter()
        .map(|o| match o.id {
            WireRewardId::Kill { key, gain } => (key, gain),
            _ => panic!("no index filtering or option rewriting is allowed"),
        })
        .collect();
    assert_eq!(
        wire_kills, native_kills,
        "wire preserves every source option in original order and exact gain"
    );

    let selected_index = row.options.len() - 1;
    let (selected_key, decoded_gain) = match row.options[selected_index].id {
        WireRewardId::Kill { key, gain } => (sim_key(key), gain),
        _ => unreachable!(),
    };
    assert_eq!(
        selected_index,
        row.options.len() - 1,
        "selection uses the original wire slot"
    );
    let before = sim
        .player(PlayerId(1))
        .unwrap()
        .kill_stats
        .get(selected_key);
    let events = send_wire_choose(&mut sim, &observer, row.handle, selected_index as i8);
    assert!(events.iter().any(|e| matches!(e,
        rh_sim::Event::ChestTaken { chest, by: PlayerId(1), pick }
            if *chest == chest_id && *pick == selected_index as i8
    )));
    let after = sim
        .player(PlayerId(1))
        .unwrap()
        .kill_stats
        .get(selected_key);
    assert_eq!(
        after - before,
        decoded_gain,
        "grant equals the exact gain decoded from reliable wire state"
    );
    let trophy = trophy_state(&sim, chest_id);
    assert_eq!(trophy["taken"][selected_index].as_u64(), Some(1));

    // ItemObserver reconnect invalidates its existing bindings without reusing the handle. The
    // observer must receive a fresh committed delivery before another wire reference can resolve.
    let old_sim_handle =
        rh_sim::reward_chests::RewardChestHandle::from_wire(row.handle.get()).unwrap();
    observer.reconnect();
    assert_eq!(
        observer
            .resolve(
                &sim,
                PublicCommand::Choose {
                    handle: old_sim_handle,
                    pick: 0
                }
            )
            .unwrap(),
        rh_sim::validate(RawCommand::Choose {
            chest_id: None,
            pick: 0
        })
        .unwrap(),
        "reconnect invalidates the previous seat-local reward handle"
    );
    let refreshed = deliver_reward_state(
        &sim,
        PlayerId(1),
        &mut observer,
        &mut publisher,
        &mut collections,
        &[],
    );
    assert!(refreshed.iter().all(|r| r.handle.get() != row.handle.get()));

    // Repeat after success is refused and does not grant another copy. Skip is a separate normal
    // Choose path: it marks the owner as picked but grants no Trophy stat.
    let before_repeat = sim.player(PlayerId(1)).unwrap().kill_stats;
    let repeat_events = send_wire_choose(
        &mut sim,
        &observer,
        refreshed[0].handle,
        selected_index as i8,
    );
    assert!(repeat_events.iter().any(|e| matches!(
        e,
        rh_sim::Event::ChestRefused {
            id: PlayerId(1),
            reason: rh_sim::reward_chests::Refusal::Picked
        }
    )));
    assert_eq!(sim.player(PlayerId(1)).unwrap().kill_stats, before_repeat);

    let mut skip_sim = born.clone();
    while skip_sim.tick() < ready_tick {
        skip_sim.step();
    }
    let mut skip_observer = ItemObserver::new(PlayerId(1));
    let mut skip_publisher = Publisher::default();
    let mut skip_collections = CollectionPublisher::default();
    let skip_rows = deliver_reward_state(
        &skip_sim,
        PlayerId(1),
        &mut skip_observer,
        &mut skip_publisher,
        &mut skip_collections,
        &[],
    );
    let skip_row = skip_rows
        .iter()
        .find(|r| {
            r.options
                .iter()
                .any(|o| matches!(o.id, WireRewardId::Kill { .. }))
        })
        .unwrap();
    let before_skip = skip_sim.player(PlayerId(1)).unwrap().kill_stats;
    send_wire_choose(&mut skip_sim, &skip_observer, skip_row.handle, -1);
    assert_eq!(
        skip_sim.player(PlayerId(1)).unwrap().kill_stats,
        before_skip
    );
    let skip_state = trophy_state(&skip_sim, chest_id);
    assert!(skip_state["pickers"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id.as_u64() == Some(1)));

    // Expiry is also checked at the actual next-step processing boundary. The row is authored by
    // the same server publication; waiting advances only the real fixed-step clock.
    let mut expiry_sim = born.clone();
    while expiry_sim.tick() < ready_tick {
        expiry_sim.step();
    }
    let mut expiry_observer = ItemObserver::new(PlayerId(1));
    let mut expiry_publisher = Publisher::default();
    let mut expiry_collections = CollectionPublisher::default();
    let expiry_rows = deliver_reward_state(
        &expiry_sim,
        PlayerId(1),
        &mut expiry_observer,
        &mut expiry_publisher,
        &mut expiry_collections,
        &[],
    );
    let expiry_row = expiry_rows
        .iter()
        .find(|r| {
            r.options
                .iter()
                .any(|o| matches!(o.id, WireRewardId::Kill { .. }))
        })
        .unwrap();
    while expiry_sim.server_time() + 50.0 < expiry_row.expires_at {
        expiry_sim.step();
    }
    assert_eq!(expiry_sim.server_time() + 50.0, expiry_row.expires_at);
    let before_expiry = expiry_sim.player(PlayerId(1)).unwrap().kill_stats;
    let expiry_events = send_wire_choose(&mut expiry_sim, &expiry_observer, expiry_row.handle, 0);
    assert!(
        !expiry_events.iter().any(|e| matches!(
            e,
            rh_sim::Event::ChestTaken { chest, .. } if *chest == chest_id
        )),
        "expired Trophy cannot be taken: {expiry_events:?}"
    );
    assert_eq!(
        expiry_sim.player(PlayerId(1)).unwrap().kill_stats,
        before_expiry
    );

    // An owner handle cannot resolve in a stranger's seat-local namespace and a stranger never
    // receives the owner Trophy row. Numeric namespaces may overlap, but bindings do not.
    let mut stranger = ItemObserver::new(PlayerId(3));
    let mut stranger_publisher = Publisher::default();
    let mut stranger_collections = CollectionPublisher::default();
    let stranger_rows = deliver_reward_state(
        &born,
        PlayerId(3),
        &mut stranger,
        &mut stranger_publisher,
        &mut stranger_collections,
        &[],
    );
    assert!(stranger_rows.iter().all(|r| r
        .options
        .iter()
        .all(|o| !matches!(o.id, WireRewardId::Kill { .. }))));
    let stranger_command = stranger
        .resolve(
            &born,
            PublicCommand::Choose {
                handle: old_sim_handle,
                pick: 0,
            },
        )
        .unwrap();
    let resolved = serde_json::to_value(stranger_command).unwrap();
    let aliased_entity = resolved["Choose"]["chest_id"].as_u64().map(|id| id as u32);
    assert_ne!(
        aliased_entity,
        Some(chest_id),
        "a numeric handle alias is never the owner's Trophy binding"
    );
    let before_owner_stats = born.player(PlayerId(1)).unwrap().kill_stats;
    let mut foreign_sim = born.clone();
    send_wire_choose_as(
        &mut foreign_sim,
        PlayerId(3),
        &stranger,
        WireRewardChestHandle::new(old_sim_handle.wire()).unwrap(),
        0,
    );
    assert_eq!(
        foreign_sim.player(PlayerId(1)).unwrap().kill_stats,
        before_owner_stats
    );
    assert!(trophy_state(&foreign_sim, chest_id)["taken"]
        .as_array()
        .unwrap()
        .iter()
        .all(serde_json::Value::is_null));
}

#[test]
fn real_trophy_wire_choose_rejects_far_and_dead_owner_without_grant() {
    let (born, _) = four_seat_validated_pvp_kill();
    let born_state = serde_json::to_value(&born).unwrap();
    let trophy_id = born_state["world"]["reward_chests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chest| chest["owner"].as_u64() == Some(1))
        .unwrap()["id"]
        .as_u64()
        .unwrap() as u32;
    let hold = trophy_state(&born, trophy_id)["held_until_tick"]
        .as_u64()
        .unwrap() as u32;
    let ready_tick = hold + 1;

    // Far: walk the real owner away using ordinary protocol Move while leaving the delivered
    // reward binding intact. The endpoint remains within observation visibility but beyond the
    // source reward range; a decoded-row Choose must reach native validation and be refused Far.
    let mut far_sim = born.clone();
    while far_sim.tick() < ready_tick {
        far_sim.step();
    }
    let mut far_observer = ItemObserver::new(PlayerId(1));
    let mut far_publisher = Publisher::default();
    let mut far_collections = CollectionPublisher::default();
    let far_rows = deliver_reward_state(
        &far_sim,
        PlayerId(1),
        &mut far_observer,
        &mut far_publisher,
        &mut far_collections,
        &[],
    );
    let far_row = far_rows
        .iter()
        .find(|r| {
            r.options
                .iter()
                .any(|o| matches!(o.id, WireRewardId::Kill { .. }))
        })
        .unwrap();
    let trophy_at = rh_sim::Vec2::new(f64::from(far_row.x) / 8., f64::from(far_row.y) / 8.);
    let destination = rh_sim::Vec2::new(trophy_at.x + 140., trophy_at.y);
    let move_events = send_wire_command_as(
        &mut far_sim,
        PlayerId(1),
        &far_observer,
        WireCommand::Move {
            x: destination.x as f32,
            y: destination.y as f32,
            seq: None,
        },
    );
    let mut distance = 0.;
    for _ in 0..80 {
        let owner_at = far_sim.player(PlayerId(1)).unwrap().pos();
        distance = (owner_at.x - trophy_at.x).hypot(owner_at.y - trophy_at.y);
        if distance > rh_sim::reward_chests::DEFINITION.range + 4. {
            break;
        }
        far_sim.step();
    }
    assert!(
        distance > rh_sim::reward_chests::DEFINITION.range,
        "ordinary Move must put the owner beyond reward range; move events {move_events:?}"
    );
    assert_eq!(
        far_sim.player(PlayerId(1)).unwrap().status,
        rh_sim::Status::Alive
    );
    assert!(
        far_sim.server_time() + 50.0 < far_row.expires_at,
        "Far Choose is processed while the Trophy is live"
    );
    let far_before = far_sim.player(PlayerId(1)).unwrap().kill_stats;
    let far_choose = far_observer
        .resolve(
            &far_sim,
            wire_command(WireCommand::Choose {
                handle: far_row.handle,
                pick: 0,
            }),
        )
        .unwrap();
    let far_resolved = serde_json::to_value(far_choose).unwrap();
    assert_eq!(
        far_resolved["Choose"]["chest_id"].as_u64(),
        Some(u64::from(trophy_id)),
        "Far control keeps the already-delivered owner binding resolvable"
    );
    far_sim.submit(PlayerId(1), far_choose).unwrap();
    let far_events = far_sim.step();
    assert!(
        far_events.iter().any(|event| matches!(
            event,
            rh_sim::Event::ChestRefused {
                id: PlayerId(1),
                reason: rh_sim::reward_chests::Refusal::Far
            }
        )),
        "expected actual Far refusal, got {far_events:?}"
    );
    assert_eq!(far_sim.player(PlayerId(1)).unwrap().kill_stats, far_before);

    // Dead owner: use only public wire controls. Release the owner's held attack, then seat 3
    // walks into range and attacks until the genuine owner dies. After death, fresh observer
    // resolution may redact the old handle; record that normal path and isolate the native guard.
    let mut dead_sim = born.clone();
    while dead_sim.tick() < ready_tick {
        dead_sim.step();
    }
    let mut owner_observer = ItemObserver::new(PlayerId(1));
    let mut owner_publisher = Publisher::default();
    let mut owner_collections = CollectionPublisher::default();
    let owner_rows = deliver_reward_state(
        &dead_sim,
        PlayerId(1),
        &mut owner_observer,
        &mut owner_publisher,
        &mut owner_collections,
        &[],
    );
    let owner_row = owner_rows
        .iter()
        .find(|r| {
            r.options
                .iter()
                .any(|o| matches!(o.id, WireRewardId::Kill { .. }))
        })
        .unwrap();
    let validated_dead_choose = owner_observer
        .resolve(
            &dead_sim,
            wire_command(WireCommand::Choose {
                handle: owner_row.handle,
                pick: 0,
            }),
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(validated_dead_choose).unwrap()["Choose"]["chest_id"].as_u64(),
        Some(u64::from(trophy_id)),
        "decoded-row Choose resolves while owner binding is live"
    );
    send_wire_command_as(
        &mut dead_sim,
        PlayerId(1),
        &owner_observer,
        WireCommand::Release { a: 0., t: None },
    );

    let owner_at = dead_sim.player(PlayerId(1)).unwrap().pos();
    let attacker_observer = ItemObserver::new(PlayerId(3));
    send_wire_command_as(
        &mut dead_sim,
        PlayerId(3),
        &attacker_observer,
        WireCommand::Move {
            x: owner_at.x as f32,
            y: owner_at.y as f32,
            seq: None,
        },
    );
    for _ in 0..60 {
        let attacker_at = dead_sim.player(PlayerId(3)).unwrap().pos();
        let d = (owner_at.x - attacker_at.x).hypot(owner_at.y - attacker_at.y);
        if d <= 48. {
            break;
        }
        dead_sim.step();
    }
    let attacker_at = dead_sim.player(PlayerId(3)).unwrap().pos();
    let approach_distance = (owner_at.x - attacker_at.x).hypot(owner_at.y - attacker_at.y);
    assert!(
        approach_distance <= 48.,
        "ordinary Move closes to attack distance: {approach_distance}"
    );
    let aim = (owner_at.y - attacker_at.y).atan2(owner_at.x - attacker_at.x) as f32;
    send_wire_command_as(
        &mut dead_sim,
        PlayerId(3),
        &attacker_observer,
        WireCommand::Attack { a: aim, t: None },
    );
    let mut owner_died = false;
    let mut final_events = Vec::new();
    let mut attack_steps = 0;
    while dead_sim.server_time() + 50.0 < owner_row.expires_at && attack_steps < 600 {
        final_events = dead_sim.step();
        attack_steps += 1;
        owner_died |= final_events.iter().any(|event| {
            matches!(
                event,
                rh_sim::Event::Death {
                    id: PlayerId(1),
                    ..
                }
            )
        });
        if dead_sim.player(PlayerId(1)).unwrap().status == rh_sim::Status::Dead {
            break;
        }
    }
    assert!(
        owner_died || dead_sim.player(PlayerId(1)).unwrap().status == rh_sim::Status::Dead,
        "seat 3 Move/Attack failed inside Trophy lifetime: hp={}, attacker={:?}, owner={:?}, events={final_events:?}",
        dead_sim.player(PlayerId(1)).unwrap().vitals.hp,
        dead_sim.player(PlayerId(3)).unwrap().pos(),
        dead_sim.player(PlayerId(1)).unwrap().pos()
    );
    assert_eq!(
        dead_sim.player(PlayerId(1)).unwrap().status,
        rh_sim::Status::Dead
    );
    assert!(
        dead_sim.server_time() + 50.0 < owner_row.expires_at,
        "dead Choose still has a processing step before the published Trophy expiry"
    );
    let unspent_trophy = trophy_state(&dead_sim, trophy_id);
    assert!(
        unspent_trophy["taken"]
            .as_array()
            .unwrap()
            .iter()
            .all(serde_json::Value::is_null),
        "owner death left the genuine Trophy live and unspent"
    );
    let before_dead_choose = dead_sim.player(PlayerId(1)).unwrap().kill_stats;
    // Diagnostic only: this decoded-row request was resolved while alive, then its validated
    // Command is submitted after death to reach the native non-standing guard with the Trophy ID.
    // This is not evidence that production input was queued in flight.
    dead_sim.submit(PlayerId(1), validated_dead_choose).unwrap();
    let dead_events = dead_sim.step();
    assert!(
        !dead_events.iter().any(|event| matches!(event,
            rh_sim::Event::ChestTaken { chest, .. } if *chest == trophy_id
        )),
        "pre-death-resolved Choose cannot take the Trophy after death: {dead_events:?}"
    );
    assert!(
        !dead_events.iter().any(|event| matches!(
            event,
            rh_sim::Event::ChestRefused {
                id: PlayerId(1),
                ..
            }
        )),
        "dead Choose uses the source silent non-standing return: {dead_events:?}"
    );
    assert_eq!(
        dead_sim.player(PlayerId(1)).unwrap().kill_stats,
        before_dead_choose
    );
    assert!(trophy_state(&dead_sim, trophy_id)["taken"]
        .as_array()
        .unwrap()
        .iter()
        .all(serde_json::Value::is_null));

    assert!(
        dead_sim.server_time() + 50.0 < owner_row.expires_at,
        "fresh post-death Choose also processes before actual expiry"
    );
    let fresh_dead_choose = owner_observer
        .resolve(
            &dead_sim,
            wire_command(WireCommand::Choose {
                handle: owner_row.handle,
                pick: 0,
            }),
        )
        .unwrap();
    assert!(
        serde_json::to_value(fresh_dead_choose).unwrap()["Choose"]["chest_id"].is_null(),
        "normal post-death observer resolution redacts the no-longer-visible Trophy binding"
    );
    let fresh_events = send_wire_choose(&mut dead_sim, &owner_observer, owner_row.handle, 0);
    assert!(!fresh_events.iter().any(|event| matches!(event,
        rh_sim::Event::ChestTaken { chest, .. } if *chest == trophy_id
    )));
    assert!(
        !fresh_events.iter().any(|event| matches!(
            event,
            rh_sim::Event::ChestRefused {
                id: PlayerId(1),
                ..
            }
        )),
        "fresh dead Choose is silent: {fresh_events:?}"
    );
    assert_eq!(
        dead_sim.player(PlayerId(1)).unwrap().kill_stats,
        before_dead_choose
    );
    assert!(trophy_state(&dead_sim, trophy_id)["taken"]
        .as_array()
        .unwrap()
        .iter()
        .all(serde_json::Value::is_null));
}

#[test]
fn a_missing_card_prerequisite_is_an_owner_toast_and_never_blocks_later_frames() {
    let (sim, _) = four_seat_validated_pvp_kill();
    let event = rh_sim::Event::ChestRefused {
        id: PlayerId(1),
        reason: rh_sim::reward_chests::Refusal::Needs(rh_sim::cards::BaseStatId::Ad),
    };
    for viewer in [PlayerId(1), PlayerId(3)] {
        let mut observer = ItemObserver::new(viewer);
        let mut publisher = Publisher::default();
        let mut carry = Vec::new();
        let (frames, offer) = publisher
            .frames_prepared(
                &mut observer,
                None,
                &sim,
                0,
                std::slice::from_ref(&event),
                &mut carry,
                &[],
            )
            .unwrap();
        assert!(frames.snapshot.is_ok() && frames.refused.is_none());
        if viewer == PlayerId(1) {
            let rh_protocol::ServerMsg::Events { events, .. } =
                rh_protocol::ServerMsg::decode(&frames.important.unwrap()).unwrap()
            else {
                panic!()
            };
            assert_eq!(
                events,
                vec![rh_protocol::WireEvent::Toast {
                    text: "Needs Offense".into()
                }]
            );
        } else {
            assert!(
                frames.important.is_none(),
                "private refusal is never sent to another seat"
            );
        }
        offer.commit();
        assert!(carry.is_empty());
        let (frames, offer) = publisher
            .frames_prepared(&mut observer, None, &sim, 0, &[], &mut carry, &[])
            .unwrap();
        assert!(frames.snapshot.is_ok() && frames.refused.is_none());
        assert!(
            frames.important.is_none(),
            "a processed private refusal cannot poison the next publication"
        );
        offer.commit();
    }
}
