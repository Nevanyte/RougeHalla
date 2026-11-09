use super::*;
use crate::{WireActor, WireOwnerCombat, WireOwnerLock, WireProps, WireSelf};
fn limits() -> Limits {
    Limits {
        body_bytes: 4096,
        retained_body_bytes: 8192,
        part_bytes: 23,
        parts: 200,
        frames: 8,
        frame_bytes: 2048,
    }
}
fn meta(scene: u64) -> Meta {
    Meta {
        epoch: (1u64 << 53) + 7,
        scene,
        tick: 10,
        source_time: 503.5,
        cue_from: 0,
        cue_through: 0,
    }
}
fn frames() -> Vec<Vec<u8>> {
    vec![
        ServerMsg::Snapshot {
            tick: 10,
            server_time: 503.5,
            phase: 1,
            ack_input: 3,
            me: Some(WireSelf {
                id: 1,
                hp: 10.,
                max_hp: 20.,
                ..Default::default()
            }),
            actors: vec![WireActor {
                id: 2,
                x: 12.,
                y: 16.,
                hp_pct: 100,
                status: 1,
                ..Default::default()
            }],
            training: false,
            owner_combat: Some(WireOwnerCombat {
                lock: WireOwnerLock::Held { target: Some(2) },
                draw_started_at: 0,
                ready_at: 500,
                as_milli: 1000.,
                windup_milli: 50.,
                speed_milli: 1000.,
            }),
        }
        .try_encode()
        .unwrap(),
        ServerMsg::State {
            tick: 10,
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
#[test]
fn full_atomic_copy_owned_and_not_live_wire() {
    let p = PreparedScene::prepare(meta(1), &frames(), limits()).unwrap();
    let mut r = Receiver::new(meta(1).epoch, limits()).unwrap();
    for i in 0..p.record_count() {
        let mut b = p.record(i).unwrap();
        assert!(crate::ServerMsg::decode(&b).is_err());
        assert_eq!(r.push(&b).unwrap(), i + 1 == p.record_count());
        b.fill(0);
        if i + 1 < p.record_count() {
            assert!(r.current().is_none());
        }
    }
    let held = r.current().unwrap().clone();
    assert_eq!(held.meta(), meta(1));
    assert_eq!(
        held.messages().unwrap()[0],
        ServerMsg::decode(&frames()[0]).unwrap()
    );
    let mut copy = held.messages().unwrap();
    if let ServerMsg::Snapshot { me: Some(me), .. } = &mut copy[0] {
        me.hp = 0.;
    }
    assert_eq!(
        held.messages().unwrap()[0],
        ServerMsg::decode(&frames()[0]).unwrap()
    );
}
#[test]
fn every_record_prefix_refuses_and_preserves_prior_view() {
    let one = PreparedScene::prepare(meta(1), &frames(), limits()).unwrap();
    let two = PreparedScene::prepare(meta(2), &frames(), limits()).unwrap();
    for index in 0..two.record_count() {
        let whole = two.record(index).unwrap();
        for end in 0..whole.len() {
            let mut r = Receiver::new(meta(1).epoch, limits()).unwrap();
            for i in 0..one.record_count() {
                r.push(&one.record(i).unwrap()).unwrap();
            }
            let held = r.current().unwrap().clone();
            for i in 0..index {
                r.push(&two.record(i).unwrap()).unwrap();
            }
            assert!(
                r.push(&whole[..end]).is_err(),
                "record {index} prefix {end}"
            );
            assert!(r.closed());
            assert!(Arc::ptr_eq(&held, r.current().unwrap()));
        }
    }
}
#[test]
fn missing_repeated_reordered_wrong_commit_close_without_exposure() {
    let p = PreparedScene::prepare(meta(1), &frames(), limits()).unwrap();
    for sequence in [
        vec![0, 0],
        vec![0, 2],
        vec![0, p.record_count() - 1],
        vec![1],
    ] {
        let mut r = Receiver::new(meta(1).epoch, limits()).unwrap();
        let mut failed = false;
        for i in sequence {
            if r.push(&p.record(i).unwrap()).is_err() {
                failed = true;
                break;
            }
        }
        assert!(failed);
        assert!(r.current().is_none());
    }
    for offset in [10, 18, 26, 28, 32] {
        let mut r = Receiver::new(meta(1).epoch, limits()).unwrap();
        for i in 0..p.record_count() - 1 {
            r.push(&p.record(i).unwrap()).unwrap();
        }
        let mut c = p.record(p.record_count() - 1).unwrap();
        c[offset] ^= 1;
        assert!(r.push(&c).is_err());
        assert!(r.current().is_none());
    }
}
#[test]
fn exact_caps_missing_group_wrong_tuple_and_exhaustion() {
    let p = PreparedScene::prepare(meta(1), &frames(), limits()).unwrap();
    let mut l = limits();
    l.body_bytes = p.body().len();
    assert!(PreparedScene::prepare(meta(1), &frames(), l).is_ok());
    l.body_bytes -= 1;
    assert!(PreparedScene::prepare(meta(1), &frames(), l).is_err());
    let mut f = frames();
    if let ServerMsg::State { tick, mut items } = ServerMsg::decode(&f[1]).unwrap() {
        items.pop();
        f[1] = ServerMsg::State { tick, items }.try_encode().unwrap();
    }
    assert!(PreparedScene::prepare(meta(1), &f, limits()).is_err());
    let mut m = meta(1);
    m.source_time = 500.;
    assert!(PreparedScene::prepare(m, &frames(), limits()).is_err());
    m = meta(u64::MAX);
    assert!(PreparedScene::prepare(m, &frames(), limits()).is_err());
    let a = Ack {
        epoch: (1u64 << 53) + 1,
        scene: (1u64 << 53) + 2,
        cue_through: (1u64 << 53) + 3,
    };
    assert_eq!(decode_ack(&encode_ack(a)).unwrap(), a);
    assert!(crate::ClientMsg::decode(&encode_ack(a)).is_err());
    assert!(crate::ServerMsg::decode(&encode_ack(a)).is_err());
    let mut r = Receiver::new(meta(1).epoch, limits()).unwrap();
    let mut b = p.record(0).unwrap();
    b[38] = 1;
    assert!(r.push(&b).is_err()); // mode Delta unsupported.
}
#[test]
fn original_event_ticks_empty_distinctions_and_occurrences() {
    let mut f = frames();
    f.push(
        ServerMsg::Events {
            tick: 9,
            events: vec![],
        }
        .try_encode()
        .unwrap(),
    );
    f.push(
        ServerMsg::Fx {
            tick: 9,
            fx: vec![
                crate::WireFx::Stagger { id: 2 },
                crate::WireFx::Stagger { id: 2 },
            ],
        }
        .try_encode()
        .unwrap(),
    );
    let mut m = meta(1);
    m.cue_through = 2;
    let p = PreparedScene::prepare(m, &f, limits()).unwrap();
    let mut r = Receiver::new(m.epoch, limits()).unwrap();
    for i in 0..p.record_count() {
        r.push(&p.record(i).unwrap()).unwrap();
    }
    assert_eq!(
        r.current().unwrap().messages().unwrap()[3],
        ServerMsg::decode(&f[3]).unwrap()
    );
    if let ServerMsg::State { items, .. } = ServerMsg::decode(&f[1]).unwrap() {
        assert!(matches!(items[0], StateItem::Inventory(None)));
        assert!(matches!(&items[2],StateItem::Fields(v)if v.is_empty()));
    }
}
#[test]
fn retained_views_have_a_finite_conservative_epoch_budget() {
    let one = PreparedScene::prepare(meta(1), &frames(), limits()).unwrap();
    let mut l = limits();
    l.body_bytes = one.body().len();
    l.retained_body_bytes = one.body().len();
    let mut r = Receiver::new(meta(1).epoch, l).unwrap();
    for i in 0..one.record_count() {
        r.push(&one.record(i).unwrap()).unwrap();
    }
    let held = r.current().unwrap().clone();
    let owned = r.owned_body_bytes();
    let second = PreparedScene::prepare(meta(2), &frames(), limits()).unwrap();
    assert!(r.push(&second.record(0).unwrap()).is_err());
    assert_eq!(r.owned_body_bytes(), owned);
    assert!(Arc::ptr_eq(&held, r.current().unwrap()));
    assert!(r.closed());
    let mut bad = limits();
    bad.frame_bytes = 68;
    assert!(bad.check().is_err());
    bad = limits();
    bad.part_bytes = bad.frame_bytes;
    assert!(bad.check().is_err());
}
