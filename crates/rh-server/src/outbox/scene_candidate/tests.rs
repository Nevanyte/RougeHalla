use super::*;
use rh_protocol::{ServerMsg, StateItem, WireProps};
fn codec() -> Limits {
    Limits {
        body_bytes: 2048,
        retained_body_bytes: 4096,
        part_bytes: 32,
        parts: 100,
        frames: 4,
        frame_bytes: 1024,
    }
}
fn frames() -> Vec<Vec<u8>> {
    vec![
        ServerMsg::Snapshot {
            tick: 1,
            server_time: 50.,
            phase: 1,
            ack_input: 0,
            me: None,
            actors: vec![],
            training: false,
            owner_combat: None,
        }
        .try_encode()
        .unwrap(),
        ServerMsg::State {
            tick: 1,
            items: vec![
                StateItem::Inventory(None),
                StateItem::Props(WireProps::default()),
                StateItem::Fields(vec![]),
                StateItem::RewardChests(vec![]),
                StateItem::Build(None),
                StateItem::Camps(vec![]),
                StateItem::Projectiles(vec![]),
                StateItem::Plan(None),
                StateItem::Arena(None),
                StateItem::Quests(None),
                StateItem::Trade(None),
            ],
        }
        .try_encode()
        .unwrap(),
    ]
}
fn meta(scene: u64) -> Meta {
    Meta {
        epoch: 7,
        scene,
        tick: 1,
        source_time: 50.,
        cue_from: 0,
        cue_through: 0,
    }
}
fn queue(scenes: usize) -> Queue {
    Queue::new(
        3,
        7,
        codec(),
        QueueLimits {
            outstanding_bytes: 4096,
            scenes,
            pending_bytes: 8192,
            pending_scenes: 3,
            scratch_bytes: 1024,
        },
    )
    .unwrap()
}
fn pending(q: &Queue, scene: u64) -> Pending {
    q.prepare(
        meta(scene),
        frames(),
        Publication {
            alias_cursor: scene * 512,
            sample_cursor: scene,
        },
    )
    .unwrap()
}
fn ack(scene: u64) -> Ack {
    Ack {
        epoch: 7,
        scene,
        cue_through: 0,
    }
}
#[test]
fn early_ack_full_refusal_exact_retry_and_lease_lifetime() {
    let q = queue(1);
    let mut a = pending(&q, 1);
    q.try_admit(&mut a).unwrap();
    let mut b = pending(&q, 2);
    let before = q.meter();
    assert!(q.ack(3, ack(1)).is_err());
    assert_eq!(q.meter(), before);
    assert!(q.try_admit(&mut b).is_err());
    assert_eq!(q.meter(), before);
    let mut w = q.begin_write().unwrap().unwrap();
    loop {
        let Some(mut record) = w.next_record().unwrap() else {
            break;
        };
        if record.bytes()[9] == 3 {
            let before = q.meter();
            assert!(q.ack(3, ack(1)).is_err());
            assert_eq!(q.meter(), before);
        }
        record.start().unwrap();
        if record.bytes()[9] == 3 {
            assert!(!q.ack(3, ack(1)).unwrap());
            assert_eq!(q.meter().acked, 0);
        }
        record.complete().unwrap();
    }
    assert_eq!(q.meter().written, 1);
    assert_eq!(q.meter().acked, 1);
    assert_eq!(q.meter().scenes, 1, "writer still holds charged original");
    assert!(q.try_admit(&mut b).is_err());
    drop(w);
    assert_eq!(q.meter().scenes, 0);
    q.try_admit(&mut b).unwrap();
    assert_eq!(q.meter().publication.alias_cursor, 1024);
}
#[test]
fn every_write_cancellation_closes_and_prevents_next_scene() {
    let count = PreparedScene::prepare(meta(1), &frames(), codec())
        .unwrap()
        .record_count();
    for stop in 0..count {
        let q = queue(2);
        let mut a = pending(&q, 1);
        q.try_admit(&mut a).unwrap();
        let mut b = pending(&q, 2);
        q.try_admit(&mut b).unwrap();
        let mut w = q.begin_write().unwrap().unwrap();
        for _ in 0..stop {
            let mut r = w.next_record().unwrap().unwrap();
            r.start().unwrap();
            r.complete().unwrap();
        }
        let r = w.next_record().unwrap().unwrap();
        drop(r);
        assert!(q.meter().closed);
        assert_eq!(q.meter().written, 0);
        assert!(q.begin_write().is_err());
        assert!(q.ack(3, ack(2)).is_err());
        drop(w);
        assert_eq!(q.meter().outstanding_bytes, 0);
        assert_eq!(q.meter().scratch_bytes, 0);
    }
}
#[test]
fn exact_ack_tuple_generation_and_both_completion_orders() {
    let q = queue(1);
    let mut a = pending(&q, 1);
    q.try_admit(&mut a).unwrap();
    let mut w = q.begin_write().unwrap().unwrap();
    while let Some(mut r) = w.next_record().unwrap() {
        r.start().unwrap();
        r.complete().unwrap();
    }
    for bad in [
        Ack {
            cue_through: 1,
            ..ack(1)
        },
        Ack { epoch: 8, ..ack(1) },
        ack(2),
    ] {
        let m = q.meter();
        assert!(q.ack(3, bad).is_err());
        assert_eq!(q.meter(), m);
    }
    assert!(q.ack(4, ack(1)).is_err());
    assert!(q.ack(3, ack(1)).unwrap());
    let m = q.meter();
    assert!(q.ack(3, ack(1)).unwrap());
    assert_eq!(q.meter(), m);
    drop(w);
    assert_eq!(q.meter().scenes, 0);
}
#[test]
fn failed_source_retention_or_dropped_pending_closes_without_publication() {
    let q = queue(1);
    let old = q.meter();
    let p = pending(&q, 1);
    drop(p);
    assert!(q.meter().closed);
    assert_eq!(q.meter().published, old.published);
    assert_eq!(q.meter().publication, old.publication);
    assert_eq!(q.meter().pending_bytes, 0);
    let q = Queue::new(
        3,
        7,
        codec(),
        QueueLimits {
            outstanding_bytes: 1,
            scenes: 1,
            pending_bytes: 1,
            pending_scenes: 1,
            scratch_bytes: 1,
        },
    )
    .unwrap();
    assert!(q
        .prepare(meta(1), frames(), Publication::default())
        .is_err());
    assert!(q.meter().closed);
    assert_eq!(q.meter().published, 0);
}
#[test]
fn fifo_no_second_writer_and_partial_commit_claim_never_credits() {
    let q = queue(2);
    let mut a = pending(&q, 1);
    q.try_admit(&mut a).unwrap();
    let mut b = pending(&q, 2);
    q.try_admit(&mut b).unwrap();
    let mut w = q.begin_write().unwrap().unwrap();
    assert!(q.begin_write().is_err());
    while let Some(mut r) = w.next_record().unwrap() {
        r.start().unwrap();
        if r.bytes()[9] == 3 {
            assert!(!q.ack(3, ack(1)).unwrap());
            drop(r);
            break;
        }
        r.complete().unwrap();
    }
    assert!(q.meter().closed);
    assert_eq!(q.meter().acked, 0);
    assert_eq!(q.meter().written, 0);
    drop(w);
    assert_eq!(q.meter().scenes, 0);
}

#[path = "fixture.rs"]
mod fixture;
#[test]
fn native_fixture_roundtrip_and_explicit_export() {
    let document = fixture::document();
    assert_eq!(document["cases"].as_array().unwrap().len(), 8);
    for case in document["cases"].as_array().unwrap() {
        let unhex = |s: &str| {
            (0..s.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
                .collect::<Vec<_>>()
        };
        let m = &case["meta"];
        let epoch = m["epoch"].as_str().unwrap().parse().unwrap();
        let l = &document["limits"];
        let codec = Limits {
            body_bytes: l["bodyBytes"].as_u64().unwrap() as usize,
            retained_body_bytes: l["retainedBodyBytes"].as_u64().unwrap() as usize,
            part_bytes: l["partBytes"].as_u64().unwrap() as usize,
            parts: l["parts"].as_u64().unwrap() as usize,
            frames: l["frames"].as_u64().unwrap() as usize,
            frame_bytes: l["frameBytes"].as_u64().unwrap() as usize,
        };
        let mut r = rh_protocol::scene_candidate::Receiver::new(epoch, codec).unwrap();
        for record in case["recordsHex"].as_array().unwrap() {
            let raw = unhex(record.as_str().unwrap());
            assert!(ServerMsg::decode(&raw).is_err());
            r.push(&raw).unwrap();
        }
        assert_eq!(
            r.current().unwrap().body(),
            unhex(case["bodyHex"].as_str().unwrap())
        );
        for bad in [
            case.get("badQuestRecordsHex"),
            case.get("badArenaRecordsHex"),
            case.get("badTimeRecordsHex"),
        ]
        .into_iter()
        .flatten()
        {
            let mut r = rh_protocol::scene_candidate::Receiver::new(epoch, codec).unwrap();
            let mut refused = false;
            for record in bad.as_array().unwrap() {
                if r.push(&unhex(record.as_str().unwrap())).is_err() {
                    refused = true;
                    break;
                }
            }
            assert!(refused);
            assert!(r.current().is_none());
            let mut prior = rh_protocol::scene_candidate::Receiver::new(epoch, codec).unwrap();
            for record in case["recordsHex"].as_array().unwrap() {
                prior.push(&unhex(record.as_str().unwrap())).unwrap();
            }
            let held = prior.current().unwrap().clone();
            let from = m["cueThrough"].as_str().unwrap().parse::<u64>().unwrap();
            let through = 2 * from;
            let records = bad.as_array().unwrap();
            for (index, record) in records.iter().enumerate() {
                let mut bytes = unhex(record.as_str().unwrap());
                bytes[18..26].copy_from_slice(&2u64.to_le_bytes());
                if bytes[9] == 1 {
                    bytes[47..55].copy_from_slice(&from.to_le_bytes());
                    bytes[55..63].copy_from_slice(&through.to_le_bytes());
                }
                if bytes[9] == 3 {
                    bytes[32..40].copy_from_slice(&through.to_le_bytes());
                }
                if index + 1 < records.len() {
                    assert!(!prior.push(&bytes).unwrap());
                } else {
                    assert!(prior.push(&bytes).is_err());
                    assert!(std::sync::Arc::ptr_eq(&held, prior.current().unwrap()));
                }
            }
        }
    }
    if let Ok(path) = std::env::var("RH_SCENE_FIXTURE_OUT") {
        std::fs::write(
            path,
            format!("{}\n", serde_json::to_string_pretty(&document).unwrap()),
        )
        .unwrap();
    }
}
#[test]
fn ack_and_successful_completion_cross_threads_in_both_orders() {
    for ack_first in [true, false] {
        let q = queue(1);
        let mut p = pending(&q, 1);
        q.try_admit(&mut p).unwrap();
        let mut w = q.begin_write().unwrap().unwrap();
        let mut final_record = loop {
            let mut r = w.next_record().unwrap().unwrap();
            if r.bytes()[9] == 3 {
                break r;
            }
            r.start().unwrap();
            r.complete().unwrap();
        };
        let before = q.meter();
        assert!(q.ack(3, ack(1)).is_err());
        assert_eq!(q.meter(), before, "prepared COMMIT is not in flight");
        final_record.start().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let (go_tx, go_rx) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            tx.send(()).unwrap();
            go_rx.recv().unwrap();
            final_record.complete().unwrap();
        });
        rx.recv().unwrap();
        if ack_first {
            assert!(!q.ack(3, ack(1)).unwrap());
            assert!(q.meter().pending_ack);
            assert_eq!(q.meter().acked, 0);
        }
        go_tx.send(()).unwrap();
        thread.join().unwrap();
        assert!(q.ack(3, ack(1)).unwrap());
        assert_eq!(q.meter().written, 1);
        assert!(!q.meter().pending_ack);
        assert!(q.meter().outstanding_bytes > 0);
        drop(w);
        assert_eq!(q.meter().outstanding_bytes, 0);
    }
}
#[test]
fn stale_closed_writer_callbacks_cannot_mutate_a_new_context() {
    let old = queue(1);
    let mut p = pending(&old, 1);
    old.try_admit(&mut p).unwrap();
    let mut writer = old.begin_write().unwrap().unwrap();
    let mut record = writer.next_record().unwrap().unwrap();
    record.start().unwrap();
    old.close();
    let new = Queue::new(
        4,
        8,
        codec(),
        QueueLimits {
            outstanding_bytes: 4096,
            scenes: 1,
            pending_bytes: 8192,
            pending_scenes: 1,
            scratch_bytes: 1024,
        },
    )
    .unwrap();
    let before = new.meter();
    assert!(record.complete().is_err());
    assert!(old.ack(3, ack(1)).is_err());
    drop(writer);
    assert_eq!(new.meter(), before);
    assert_eq!(old.meter().outstanding_bytes, 0);
    assert_eq!(old.meter().scratch_bytes, 0);
}
#[test]
fn real_observer_offer_and_collection_stage_survive_refused_admission() {
    use crate::{wire::Publisher, wire_state::CollectionPublisher};
    use rh_sim::{FactionId, ItemObserver, Secrets, Sim, SimConfig};
    let mut sim = Sim::new(
        SimConfig {
            training: true,
            dummies: true,
            min_players: 1,
            lobby_seconds: 0.,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(2),
    );
    let viewer = sim
        .add_player("staged-owner", Some(FactionId::Fire), false)
        .unwrap();
    let events = sim.step();
    let mut observer = ItemObserver::new(viewer);
    let mut publisher = Publisher::default();
    let mut collections = CollectionPublisher::default();
    let mut carry = Vec::new();
    let pack = |frames: crate::wire::ViewFrames, state: Vec<u8>| {
        assert!(frames.refused.is_none());
        let (snapshot, kind) =
            rh_protocol::ConnEncoder::new().encode_frame(frames.snapshot.unwrap());
        assert_eq!(kind, rh_protocol::FrameKind::Full);
        let mut out = vec![snapshot, state];
        if let Some(b) = frames.important {
            out.push(b);
        }
        if let Some(b) = frames.fx {
            out.push(b);
        }
        out
    };
    let (frames, offer) = publisher
        .frames_prepared(&mut observer, None, &sim, 0, &events, &mut carry, &events)
        .unwrap();
    let state = collections
        .prepare(
            publisher.observation(),
            offer.props_changed(),
            offer.rewards_changed(),
            false,
        )
        .unwrap();
    let original = pack(frames, state.frame.as_ref().unwrap().clone());
    let ServerMsg::Snapshot {
        tick, server_time, ..
    } = ServerMsg::decode(&original[0]).unwrap()
    else {
        panic!("Full")
    };
    let occurrences: u64 = original
        .iter()
        .skip(2)
        .map(|b| match ServerMsg::decode(b).unwrap() {
            ServerMsg::Events { events, .. } => events.len() as u64,
            ServerMsg::Fx { fx, .. } => fx.len() as u64,
            _ => panic!("batch"),
        })
        .sum();
    let m = Meta {
        epoch: 7,
        scene: 1,
        tick,
        source_time: server_time,
        cue_from: 0,
        cue_through: occurrences,
    };
    let refused = Queue::new(
        3,
        7,
        codec(),
        QueueLimits {
            outstanding_bytes: 1,
            scenes: 1,
            pending_bytes: 8192,
            pending_scenes: 1,
            scratch_bytes: 1024,
        },
    )
    .unwrap();
    let mut pending = refused
        .prepare(
            m,
            original.clone(),
            Publication {
                alias_cursor: 512,
                sample_cursor: 1,
            },
        )
        .unwrap();
    let before = refused.meter();
    assert!(refused.try_admit(&mut pending).is_err());
    assert_eq!(refused.meter(), before);
    // The exact pending bytes remain owned until explicit close. Actual native offer/state
    // objects have not committed, so no private observer binding/counter can be spent.
    drop(pending);
    drop(state);
    drop(offer);
    assert!(refused.meter().closed);
    let (frames, offer) = publisher
        .frames_prepared(&mut observer, None, &sim, 0, &events, &mut carry, &events)
        .unwrap();
    let state = collections
        .prepare(
            publisher.observation(),
            offer.props_changed(),
            offer.rewards_changed(),
            false,
        )
        .unwrap();
    let retry = pack(frames, state.frame.as_ref().unwrap().clone());
    assert_eq!(
        original, retry,
        "real current NPC aliases/pickup handles and full collections did not advance on refusal"
    );
    let accepted = queue(1);
    let mut pending = accepted
        .prepare(
            m,
            retry,
            Publication {
                alias_cursor: 512,
                sample_cursor: 1,
            },
        )
        .unwrap();
    accepted.try_admit(&mut pending).unwrap();
    state.commit(&mut collections);
    offer.commit();
    assert_eq!(accepted.meter().published, 1);
    accepted.close();
}
