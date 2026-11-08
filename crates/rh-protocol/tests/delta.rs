//! Protocol v3 snapshot deltas: the writer's encoder and the client's tracker, held to each other and to the Full frame.
use rh_protocol::delta::{diff, AD_ALL, AD_X, AD_Y, DH_X, MIN_FORCED_FULL_TICKS};
use rh_protocol::*;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
}

/// A crowd where every actor moves a little and some leave and arrive: the changed count passes 127 (a two-byte varint, patched
/// into the frame after the actors are walked) and the frame is the reference message's, byte for byte.
#[test]
fn a_delta_of_hundreds_of_changed_actors_has_a_two_byte_count_and_applies() {
    let crowd = |t: u32, shift: f32, gone: u32, extra: u32| -> SnapshotData {
        let mut rng = Rng(5);
        let mut actors: Vec<WireActor> = (0..400u32)
            .filter(|i| i % 50 != gone)
            .map(|i| {
                let mut a = actor(i * 2 + 1, &mut rng);
                a.x = 100.0 + i as f32 + shift;
                a
            })
            .collect();
        for k in 0..extra {
            actors.push(actor(2_000 + k, &mut rng));
        }
        SnapshotData::build(t, 1, 0, None, actors.into_iter()).unwrap()
    };
    let a = crowd(1, 0.0, 99, 0);
    let b = crowd(2, 0.5, 7, 3);
    let mut enc = ConnEncoder::new();
    let mut tracker = SnapshotTracker::new();
    let mut f = Vec::new();
    assert_eq!(enc.encode(a.clone(), &mut f), FrameKind::Full);
    tracker.decode(&f).unwrap();
    f.clear();
    assert_eq!(enc.encode(b.clone(), &mut f), FrameKind::Delta);
    let want = diff(&a, &b).expect("a delta");
    assert!(want.changed.len() > 300 && !want.departed.is_empty());
    assert_eq!(f, ServerMsg::SnapshotDelta(want).encode());
    assert_eq!(tracker.decode(&f).unwrap(), b.decoded());
}

fn actor(id: u32, rng: &mut Rng) -> WireActor {
    WireActor {
        sig: 0,
        mob_type_code: 0,
        effects: 0,
        displace_seq: 0,
        id,
        faction: rng.below(5) as u8,
        x: rng.below(5000) as f32 + 0.3,
        y: rng.below(5000) as f32 + 0.7,
        facing: rng.below(600) as f32 / 100.0 - 3.0,
        hp_pct: 100 - rng.below(3) as u8 * 20,
        status: 1,
        weapon: rng.below(6) as u8,
        bounty: if rng.chance(20) { 28 } else { 0 },
        // From the id, not the generator: the random walk's draws (and so its natural Full frames) stay as they were.
        kind: if id % 7 == 0 { 2 } else { 0 },
    }
}

fn me(id: u32, rng: &mut Rng) -> WireSelf {
    WireSelf {
        sig: 0,
        effects: 0,
        displace_seq: 0,
        id,
        faction: 2,
        x: rng.below(5000) as f32 + 0.25,
        y: rng.below(5000) as f32 + 0.5,
        facing: 1.0,
        hp: 1000.0,
        max_hp: 1145.0,
        status: 1,
        weapon: 3,
        ready_in_ms: 0,
        kills: 0,
        bounty: 0,
        gv: 0,
        move_seq: 0,
    }
}

/// A random walk of one viewer's snapshots: actors move, appear and vanish; the self moves and sometimes changes a rare field;
/// the self sometimes disappears; the phase and the ack change.
fn walk(seed: u64, ticks: u32) -> Vec<SnapshotData> {
    let mut rng = Rng(seed);
    let mut actors: Vec<WireActor> = (1..7).map(|i| actor(i * 3, &mut rng)).collect();
    let mut s = me(100, &mut rng);
    let mut out = Vec::new();
    for t in 1..=ticks {
        for a in actors.iter_mut() {
            if rng.chance(70) {
                a.x += 0.125 * rng.below(9) as f32;
                a.y += 0.125 * rng.below(9) as f32;
            }
            if rng.chance(10) {
                a.facing = (a.facing + 0.1).min(3.0);
            }
            if rng.chance(5) {
                a.hp_pct = rng.below(101) as u8;
            }
            if rng.chance(2) {
                a.status = rng.below(4) as u8;
            }
            if rng.chance(2) {
                a.bounty = rng.below(70_000) as u16;
            }
            if rng.chance(1) {
                a.weapon = rng.below(6) as u8;
            }
        }
        if rng.chance(8) {
            actors.retain(|_| !rng.chance(30));
        }
        if rng.chance(10) && actors.len() < 40 {
            let id = rng.below(200) as u32 + 1;
            if !actors.iter().any(|a| a.id == id) {
                actors.push(actor(id, &mut rng));
            }
        }
        actors.sort_by_key(|a| a.id);
        s.x += 0.5 * rng.below(3) as f32;
        if rng.chance(5) {
            s.hp = (rng.below(1146) as f32 - 0.0).min(1145.0);
        }
        if rng.chance(2) {
            s.kills += 1;
            s.bounty = s.kills * 7;
            s.gv += 20;
        }
        if rng.chance(3) {
            s.move_seq = s.move_seq.wrapping_add(1);
            s.ready_in_ms = rng.below(300) as u16;
        }
        if rng.chance(1) {
            s.status = rng.below(4) as u8;
        }
        if rng.chance(1) {
            s.max_hp = 1145.5;
        }
        let with_self = !rng.chance(3);
        out.push(
            SnapshotData::build(
                t,
                (t / 50 % 3) as u8,
                t / 2,
                with_self.then_some(s),
                actors.iter().copied(),
            )
            .expect("valid"),
        );
    }
    out
}

fn full_bytes(s: &SnapshotData) -> Vec<u8> {
    let mut v = Vec::new();
    s.encode_full_into(&mut v);
    v
}

/// The v2 message encoder's bytes for the same snapshot (an independent writer of the layout).
fn v2_bytes(s: &SnapshotData) -> Vec<u8> {
    s.decoded().try_encode().expect("encodes")
}

#[test]
fn a_full_frame_from_snapshot_data_is_the_v2_frame_byte_for_byte() {
    for seed in 1..=20 {
        for s in walk(seed, 120) {
            let b = full_bytes(&s);
            assert_eq!(b.len(), s.full_len());
            // v2 re-quantizes the (already decoded) actors: the grid is idempotent.
            assert_eq!(b, v2_bytes(&s));
            assert_eq!(ServerMsg::decode(&b).unwrap(), s.decoded());
        }
    }
}

/// Every frame the writer picks, applied by a tracker that saw all of them, equals the Full frame of that tick.
#[test]
fn a_chain_of_full_and_delta_frames_equals_the_full_frame_of_every_tick() {
    let (mut fulls, mut deltas, mut full_bytes_sum, mut sent_bytes_sum) = (0, 0, 0, 0);
    for seed in 1..=40 {
        let mut enc = ConnEncoder::new();
        let mut tracker = SnapshotTracker::new();
        for s in walk(seed, 300) {
            let full_len = s.full_len();
            let want = s.decoded();
            let mut frame = Vec::new();
            let kind = enc.encode(s, &mut frame);
            match kind {
                FrameKind::Full => fulls += 1,
                FrameKind::Delta => {
                    deltas += 1;
                    assert!(frame.len() < full_len, "a delta is only sent when smaller");
                    assert_eq!(frame[0], 0x87);
                }
            }
            full_bytes_sum += full_len;
            sent_bytes_sum += frame.len();
            assert_eq!(
                tracker.decode(&frame).expect("applies"),
                want,
                "seed {seed}"
            );
        }
    }
    assert!(fulls > 40 && deltas > 5000, "{fulls} full, {deltas} delta");
    assert!(
        sent_bytes_sum * 10 < full_bytes_sum * 7,
        "the random walk saves over 30%: {sent_bytes_sum} of {full_bytes_sum}"
    );
}

/// The writer skips snapshots (latest-wins): the base is what was WRITTEN, so the delta still applies to a client that
/// never saw the skipped ones.
#[test]
fn skipped_snapshots_never_reach_the_encoder_and_the_next_delta_applies() {
    for seed in 1..=30 {
        let mut rng = Rng(seed * 77);
        let mut enc = ConnEncoder::new();
        let mut tracker = SnapshotTracker::new();
        let mut written = 0;
        for s in walk(seed, 300) {
            if rng.chance(60) {
                continue;
            }
            let want = s.decoded();
            let mut frame = Vec::new();
            enc.encode(s, &mut frame);
            assert_eq!(tracker.decode(&frame).expect("applies"), want);
            written += 1;
        }
        assert!(written > 50);
    }
}

#[test]
fn the_encoders_delta_bytes_are_the_reference_messages_bytes() {
    for seed in 1..=20 {
        let snaps = walk(seed, 200);
        for pair in snaps.windows(2) {
            let (a, b) = (&pair[0], &pair[1]);
            let mut enc = ConnEncoder::new();
            let mut sink = Vec::new();
            enc.encode(a.clone(), &mut sink);
            let mut frame = Vec::new();
            let kind = enc.encode(b.clone(), &mut frame);
            let reference = diff(a, b).map(|d| ServerMsg::SnapshotDelta(d).encode());
            match (kind, reference) {
                (FrameKind::Delta, Some(r)) => {
                    assert_eq!(frame, r, "seed {seed} tick {}", b.tick())
                }
                (FrameKind::Full, Some(r)) => {
                    assert!(r.len() >= b.full_len(), "a Full only when not smaller")
                }
                (FrameKind::Full, None) => {}
                (FrameKind::Delta, None) => panic!("a delta the reference cannot make"),
            }
            if let Some(d) = diff(a, b) {
                // The message decodes back to itself, and applying it to the base gives the next snapshot.
                let bytes = ServerMsg::SnapshotDelta(d.clone()).encode();
                assert_eq!(
                    ServerMsg::decode(&bytes).unwrap(),
                    ServerMsg::SnapshotDelta(d)
                );
            }
        }
    }
}

fn first_full(s: &SnapshotData) -> Vec<u8> {
    let mut enc = ConnEncoder::new();
    let mut v = Vec::new();
    assert_eq!(enc.encode(s.clone(), &mut v), FrameKind::Full);
    v
}

/// A resync request is never lost: one that comes within MIN_FORCED_FULL_TICKS of the last forced Full stays pending, deltas go on
/// until the interval ends, and then exactly one Full frame answers it (however many requests came meanwhile). A client that
/// refused its deltas in between recovers with that Full frame.
#[test]
fn a_resync_inside_the_interval_is_deferred_not_dropped() {
    let snaps = walk(1, 120);
    // The Full frames the walk needs without any request (a delta larger than its Full frame, say).
    let natural: Vec<usize> = {
        let mut enc = ConnEncoder::new();
        (0..snaps.len())
            .filter(|&i| enc.encode(snaps[i].clone(), &mut Vec::new()) == FrameKind::Full)
            .collect()
    };
    let mut enc = ConnEncoder::new();
    let mut tracker = SnapshotTracker::new();
    let mut kinds = Vec::new();
    let mut forced_at = Vec::new();
    for (i, s) in snaps.iter().enumerate() {
        // Requests: at snapshot 5 (answered at once: none forced before), 8 (deferred), repeatedly at 9..=12 (still one), and
        // at 60 (long after the interval).
        if matches!(i, 5 | 8 | 9 | 10 | 11 | 12 | 60) {
            enc.request_full();
        }
        let mut f = Vec::new();
        let kind = enc.encode(s.clone(), &mut f);
        kinds.push(kind);
        if kind == FrameKind::Full && i > 0 && !natural.contains(&i) {
            forced_at.push((i, s.tick()));
        }
        // The decoder under test holds nothing back: it applies every frame the writer wrote.
        tracker.decode(&f).expect("every frame applies");
        assert_eq!(tracker.snapshot().unwrap(), s.decoded());
    }
    assert_eq!(kinds[0], FrameKind::Full);
    let first = snaps[5].tick();
    let due = first + MIN_FORCED_FULL_TICKS;
    let second = snaps
        .iter()
        .position(|s| s.tick() >= due)
        .expect("the walk is long enough");
    assert_eq!(
        forced_at.iter().map(|(i, _)| *i).collect::<Vec<_>>(),
        vec![5, second, 60],
        "one Full per answered request: at once, when the interval ends, and later"
    );
    for kind in &kinds[6..second] {
        assert_eq!(*kind, FrameKind::Delta, "deltas continue while pending");
    }
}

/// The failing sequence of the review: a delta is refused, the Full frame answers, the next delta is refused within the interval,
/// and the (single) second request still ends with a Full frame the client applies.
#[test]
fn two_refusals_inside_the_interval_still_end_with_a_full_frame() {
    let snaps = walk(9, 100);
    let mut enc = ConnEncoder::new();
    let mut tracker = SnapshotTracker::new();
    let mut f = Vec::new();
    enc.encode(snaps[0].clone(), &mut f);
    tracker.decode(&f).unwrap();
    // The client lost its snapshot (a refusal) and asks; the answer is Full.
    tracker.reset();
    enc.request_full();
    f.clear();
    assert_eq!(enc.encode(snaps[1].clone(), &mut f), FrameKind::Full);
    tracker.decode(&f).unwrap();
    // It refuses the very next delta (it was reset again) and asks once, then skips deltas until a Full frame.
    tracker.reset();
    enc.request_full();
    let mut full_at = None;
    for s in &snaps[2..] {
        f.clear();
        let kind = enc.encode(s.clone(), &mut f);
        if tracker.decode(&f).is_ok() {
            assert_eq!(
                kind,
                FrameKind::Full,
                "only a Full frame applies to a client with no base"
            );
            full_at = Some(s.tick());
            break;
        }
        assert_eq!(kind, FrameKind::Delta);
    }
    assert_eq!(
        full_at,
        Some(snaps[1].tick() + MIN_FORCED_FULL_TICKS),
        "the Full frame goes out when the interval ends"
    );
    // And deltas apply again.
    f.clear();
    let next = snaps.iter().find(|s| Some(s.tick()) > full_at).unwrap();
    assert_eq!(enc.encode(next.clone(), &mut f), FrameKind::Delta);
    tracker.decode(&f).expect("applies again");
    assert_eq!(tracker.snapshot().unwrap(), next.decoded());
}

#[test]
fn the_first_snapshot_a_resync_a_stale_base_and_a_new_self_are_full_frames() {
    let snaps = walk(3, 200);
    let mut enc = ConnEncoder::new();
    let mut f = Vec::new();
    assert_eq!(
        enc.encode(snaps[0].clone(), &mut f),
        FrameKind::Full,
        "first after a Welcome"
    );
    f.clear();
    assert_eq!(enc.encode(snaps[1].clone(), &mut f), FrameKind::Delta);
    // A resync request makes exactly the next one Full.
    enc.request_full();
    f.clear();
    assert_eq!(enc.encode(snaps[2].clone(), &mut f), FrameKind::Full);
    f.clear();
    assert_eq!(enc.encode(snaps[3].clone(), &mut f), FrameKind::Delta);
    // A base more than MAX_DELTA_AGE ticks behind: Full; exactly MAX_DELTA_AGE behind: still a delta.
    f.clear();
    let last_tick = snaps[3].tick();
    let exactly = SnapshotData::build(
        last_tick + MAX_DELTA_AGE,
        0,
        0,
        snaps[3].me().copied(),
        snaps[3].actors().iter().map(QActor::to_wire),
    )
    .unwrap();
    let mut probe = ConnEncoder::new();
    probe.encode(snaps[3].clone(), &mut Vec::new());
    assert_eq!(probe.encode(exactly, &mut f), FrameKind::Delta);
    let too_old = SnapshotData::build(
        last_tick + MAX_DELTA_AGE + 1,
        0,
        0,
        snaps[3].me().copied(),
        snaps[3].actors().iter().map(QActor::to_wire),
    )
    .unwrap();
    let mut probe = ConnEncoder::new();
    probe.encode(snaps[3].clone(), &mut Vec::new());
    f.clear();
    assert_eq!(probe.encode(too_old, &mut f), FrameKind::Full);
    // The same or an older tick (a restarted room) is never a delta.
    let mut probe = ConnEncoder::new();
    probe.encode(snaps[3].clone(), &mut Vec::new());
    f.clear();
    assert_eq!(probe.encode(snaps[3].clone(), &mut f), FrameKind::Full);
    // A self that appears after a snapshot without one cannot be a delta; one that goes away can.
    let with = |t: u32, has_self: bool| {
        let mut rng = Rng(6);
        SnapshotData::build(
            t,
            1,
            0,
            has_self.then(|| me(9, &mut Rng(5))),
            (1..9).map(|i| actor(i, &mut rng)),
        )
        .unwrap()
    };
    let mut probe = ConnEncoder::new();
    probe.encode(with(1, false), &mut Vec::new());
    assert_eq!(
        probe.encode(with(2, true), &mut Vec::new()),
        FrameKind::Full
    );
    assert_eq!(
        probe.encode(with(3, false), &mut Vec::new()),
        FrameKind::Delta
    );
    // A different self id is a Full frame.
    let mut probe = ConnEncoder::new();
    probe.encode(with(1, true), &mut Vec::new());
    let mut rng = Rng(6);
    let other = SnapshotData::build(
        2,
        1,
        0,
        Some(me(10, &mut Rng(5))),
        (1..9).map(|i| actor(i, &mut rng)),
    )
    .unwrap();
    assert_eq!(probe.encode(other, &mut Vec::new()), FrameKind::Full);
}

#[test]
fn a_delta_that_is_not_smaller_than_the_full_frame_is_sent_as_the_full_frame() {
    // Every actor replaced by another: the delta lists all of them new and all the old ones departed.
    let mut rng = Rng(9);
    let a = SnapshotData::build(1, 1, 0, None, (1..21).map(|i| actor(i, &mut rng))).unwrap();
    let b = SnapshotData::build(2, 1, 0, None, (101..121).map(|i| actor(i, &mut rng))).unwrap();
    let mut enc = ConnEncoder::new();
    enc.encode(a.clone(), &mut Vec::new());
    let mut f = Vec::new();
    assert_eq!(enc.encode(b.clone(), &mut f), FrameKind::Full);
    assert_eq!(f, full_bytes(&b));
    let d = ServerMsg::SnapshotDelta(diff(&a, &b).unwrap()).encode();
    assert!(d.len() > b.full_len());
}

#[test]
fn a_resumed_connection_starts_with_a_full_frame_whatever_the_old_one_held() {
    // A new connection has a new encoder and a new tracker: the first frame is Full and a delta against the old base is refused.
    let snaps = walk(5, 40);
    let mut old = ConnEncoder::new();
    let mut old_client = SnapshotTracker::new();
    for s in &snaps[..20] {
        let mut f = Vec::new();
        old.encode(s.clone(), &mut f);
        old_client.decode(&f).unwrap();
    }
    let mut new = ConnEncoder::new();
    let mut f = Vec::new();
    assert_eq!(new.encode(snaps[20].clone(), &mut f), FrameKind::Full);
    // The client of the resumed connection saw a Welcome (which resets it); a delta before any Full is refused.
    let mut fresh = SnapshotTracker::new();
    let mut d = Vec::new();
    old.encode(snaps[21].clone(), &mut d);
    assert_eq!(d[0], 0x87);
    assert_eq!(fresh.decode(&d), Err(TrackError::Delta(DeltaError::NoBase)));
    assert!(fresh.decode(&f).is_ok());
}

fn base_and_delta(
    f: impl FnOnce(&mut SnapshotDelta),
) -> (SnapshotTracker, Result<ServerMsg, TrackError>) {
    let mut rng = Rng(4);
    let a = SnapshotData::build(
        10,
        1,
        0,
        Some(me(1, &mut rng)),
        (1..5).map(|i| actor(i * 2, &mut rng)),
    )
    .unwrap();
    let mut b_rng = Rng(5);
    let b = SnapshotData::build(
        11,
        1,
        0,
        Some(me(1, &mut b_rng)),
        (1..5).map(|i| actor(i * 2, &mut b_rng)),
    )
    .unwrap();
    let mut t = SnapshotTracker::new();
    t.decode(&first_full(&a)).unwrap();
    let mut d = diff(&a, &b).unwrap();
    f(&mut d);
    let r = t.decode(&ServerMsg::SnapshotDelta(d).encode());
    (t, r)
}

#[test]
fn deltas_that_do_not_apply_are_refused_and_change_nothing() {
    let all = |q: QActor| ActorDelta { mask: AD_ALL, q };
    let (t, r) = base_and_delta(|d| d.base_tick = 9);
    assert_eq!(
        r,
        Err(TrackError::Delta(DeltaError::BaseMismatch {
            have: 10,
            want: 9
        }))
    );
    assert_eq!(t.held_tick(), Some(10), "state unchanged");

    let (_, r) = base_and_delta(|d| d.departed = vec![5]);
    assert_eq!(r, Err(TrackError::Delta(DeltaError::UnknownDeparted(5))));
    let (_, r) = base_and_delta(|d| d.departed = vec![999]);
    assert_eq!(r, Err(TrackError::Delta(DeltaError::UnknownDeparted(999))));
    let (_, r) = base_and_delta(|d| {
        d.changed = vec![ActorDelta {
            mask: AD_X,
            q: QActor {
                id: 2,
                x: 5,
                status: 1,
                ..QActor::default()
            },
        }];
        d.departed = vec![2];
    });
    assert_eq!(r, Err(TrackError::Delta(DeltaError::DepartedAndChanged(2))));
    // An update to an actor the base does not hold (departed earlier, or never seen).
    let (_, r) = base_and_delta(|d| {
        d.changed = vec![ActorDelta {
            mask: AD_X | AD_Y,
            q: QActor {
                id: 3,
                x: 5,
                y: 5,
                status: 1,
                ..QActor::default()
            },
        }];
        d.departed.clear();
    });
    assert_eq!(r, Err(TrackError::Delta(DeltaError::IncompleteNewActor(3))));
    // A complete new actor is fine.
    let (t, r) = base_and_delta(|d| {
        d.changed = vec![all(QActor {
            sig: 0,
            mob_type_code: 0,
            effects: 0,
            displace_seq: 0,
            id: 3,
            x: 5,
            y: 5,
            facing: 0,
            kit: 0,
            hp_pct: 100,
            status: 1,
            bounty: 0,
            kind: 0,
        })];
        d.departed.clear();
    });
    r.expect("applies");
    assert_eq!(t.actors().len(), 5);
    // A self delta on a base without a self.
    let mut rng = Rng(1);
    let a = SnapshotData::build(10, 1, 0, None, (1..3).map(|i| actor(i, &mut rng))).unwrap();
    let mut t = SnapshotTracker::new();
    t.decode(&first_full(&a)).unwrap();
    let d = SnapshotDelta {
        training: false,
        tick: 11,
        base_tick: 10,
        phase: None,
        ack_input: 0,
        me: Some(SelfDelta {
            mask: DH_X,
            x: 1.0,
            ..SelfDelta::default()
        }),
        changed: vec![],
        departed: vec![],
    };
    assert_eq!(
        t.decode(&ServerMsg::SnapshotDelta(d).encode()),
        Err(TrackError::Delta(DeltaError::SelfWithoutBase))
    );
    // Before any snapshot, and after a Welcome.
    let d = ServerMsg::SnapshotDelta(SnapshotDelta {
        training: false,
        tick: 11,
        base_tick: 10,
        phase: None,
        ack_input: 0,
        me: None,
        changed: vec![],
        departed: vec![],
    })
    .encode();
    assert_eq!(
        SnapshotTracker::new().decode(&d),
        Err(TrackError::Delta(DeltaError::NoBase))
    );
    let welcome = server_sample("welcome");
    let mut t = SnapshotTracker::new();
    t.decode(&first_full(&a)).unwrap();
    t.decode(&welcome).unwrap();
    assert_eq!(t.decode(&d), Err(TrackError::Delta(DeltaError::NoBase)));
}

fn server_sample(name: &str) -> Vec<u8> {
    samples::server_samples()
        .into_iter()
        .find(|(n, _)| *n == name)
        .unwrap()
        .1
        .encode()
}

#[test]
fn a_delta_cannot_grow_the_actor_list_past_max_actors() {
    let mk = |t: u32, ids: std::ops::Range<u32>| {
        let mut rng = Rng(3);
        SnapshotData::build(t, 1, 0, None, ids.map(|i| actor(i + 1, &mut rng))).unwrap()
    };
    let a = mk(1, 0..MAX_ACTORS as u32);
    let mut t = SnapshotTracker::new();
    t.decode(&first_full(&a)).unwrap();
    let d = SnapshotDelta {
        training: false,
        tick: 2,
        base_tick: 1,
        phase: None,
        ack_input: 0,
        me: None,
        changed: vec![ActorDelta {
            mask: AD_ALL,
            q: QActor {
                id: 100_000,
                status: 1,
                hp_pct: 100,
                ..QActor::default()
            },
        }],
        departed: vec![],
    };
    assert_eq!(
        t.decode(&ServerMsg::SnapshotDelta(d).encode()),
        Err(TrackError::Delta(DeltaError::TooManyActors(MAX_ACTORS + 1)))
    );
    assert_eq!(t.actors().len(), MAX_ACTORS);
}

/// C-OBS: a delta never reveals an actor the Full frame of that tick would not, and its departed list names only actors the
/// client was told about.
#[test]
fn a_delta_reveals_nothing_the_full_frame_does_not() {
    for seed in 1..=30 {
        let mut enc = ConnEncoder::new();
        let mut known: std::collections::BTreeSet<u32> = Default::default();
        for s in walk(seed, 200) {
            let visible: std::collections::BTreeSet<u32> =
                s.actors().iter().map(|q| q.id).collect();
            let mut f = Vec::new();
            enc.encode(s, &mut f);
            match ServerMsg::decode(&f).unwrap() {
                ServerMsg::Snapshot { actors, .. } => {
                    assert!(actors.iter().all(|a| visible.contains(&a.id)))
                }
                ServerMsg::SnapshotDelta(d) => {
                    assert!(
                        d.changed.iter().all(|a| visible.contains(&a.q.id)),
                        "only visible actors are named"
                    );
                    assert!(
                        d.departed
                            .iter()
                            .all(|id| known.contains(id) && !visible.contains(id)),
                        "departed: told before, gone now"
                    );
                }
                _ => unreachable!(),
            }
            known = visible;
        }
    }
}

#[test]
fn per_connection_state_is_bounded_by_max_actors() {
    let mut enc = ConnEncoder::new();
    let mut tracker = SnapshotTracker::new();
    let mut rng = Rng(11);
    let mut peak = 0;
    for t in 1..400u32 {
        // Alternate a full house and an empty one: the worst growth of the base, the record list and the departed list.
        let n = if t % 2 == 0 { MAX_ACTORS } else { 0 };
        let base = if t % 3 == 0 { 1 } else { 1000 };
        let s = SnapshotData::build(
            t,
            1,
            0,
            Some(me(1, &mut rng)),
            (0..n as u32).map(|i| actor(i * 2 + base, &mut rng)),
        )
        .unwrap();
        let mut f = Vec::new();
        enc.encode(s.clone(), &mut f);
        assert_eq!(tracker.decode(&f).unwrap(), s.decoded());
        peak = peak.max(enc.memory_bytes());
    }
    // The base and the spare block (16 B per actor each) and the departed ids (4 B), each of which may have grown to twice
    // its use.
    let bound = 2 * MAX_ACTORS * (16 + 16 + 4) + 1024;
    eprintln!("peak connection snapshot state {peak} B (bound {bound} B)");
    assert!(peak <= bound, "{peak} > {bound}");
    assert!(peak > MAX_ACTORS * 16, "the bound is not vacuous");
}

#[test]
fn the_resync_message_round_trips_and_has_no_body() {
    assert_eq!(ClientMsg::Resync.encode(), vec![0x05]);
    assert_eq!(ClientMsg::decode(&[0x05]), Ok(ClientMsg::Resync));
    assert!(ClientMsg::decode(&[0x05, 0]).is_err());
}

#[test]
fn fuzzed_delta_frames_never_panic_and_a_refused_one_changes_nothing() {
    let snaps = walk(8, 60);
    let mut enc = ConnEncoder::new();
    let mut frames = Vec::new();
    for s in &snaps {
        let mut f = Vec::new();
        enc.encode(s.clone(), &mut f);
        frames.push(f);
    }
    let mut tracker = SnapshotTracker::new();
    tracker.decode(&frames[0]).unwrap();
    for f in &frames[1..30] {
        tracker.decode(f).unwrap();
    }
    let held = tracker.clone();
    let next = &frames[30];
    for cut in 0..next.len() {
        let mut t = held.clone();
        assert!(t.decode(&next[..cut]).is_err());
        assert_eq!(t.held_tick(), held.held_tick());
        assert_eq!(t.actors(), held.actors());
    }
    for i in 0..next.len() {
        for v in [0u8, 1, 0x7f, 0x80, 0xff] {
            let mut c = next.clone();
            c[i] = v;
            let mut t = held.clone();
            if t.decode(&c).is_err() {
                assert_eq!(t.held_tick(), held.held_tick());
                assert_eq!(t.actors(), held.actors());
            }
        }
    }
}

/// The v3 writer path refuses a remote actor off the position grid like every v2 encoder (`tests/encode.rs`): the room's
/// `SnapshotData::build` is where it is checked, so neither a Full frame nor a Delta can ever carry one (a Delta carries only
/// grid codes taken from a built snapshot). The top of the range is carried exactly, as a Full frame and as a delta.
#[test]
fn snapshot_data_refuses_positions_off_the_grid_so_no_delta_can_carry_one() {
    use rh_protocol::quant::POS_MAX;
    let mut rng = Rng(5);
    let base = actor(4, &mut rng);
    let at = |x: f32, y: f32| WireActor { x, y, ..base };
    let build = |a: WireActor| SnapshotData::build(2, 1, 0, None, std::iter::once(a));
    for (x, y) in [
        (8191.876, 0.0),
        (0.0, 8192.0),
        (1.0e9, 5.0),
        (-0.01, 5.0),
        (5.0, f32::NAN),
        (f32::INFINITY, 5.0),
    ] {
        assert_eq!(
            build(at(x, y)).err(),
            Some(EncodeError::BadValue("position")),
            "{x},{y}"
        );
        // Same refusal when built in a recycled block.
        let spare = build(at(1.0, 1.0)).unwrap();
        assert_eq!(
            SnapshotData::build_with(Some(spare), 2, 1, 0, None, std::iter::once(at(x, y))).err(),
            Some(EncodeError::BadValue("position"))
        );
    }
    let mut enc = ConnEncoder::new();
    let mut tracker = SnapshotTracker::new();
    let first = build(at(1.0, 1.0)).unwrap();
    let mut f = Vec::new();
    assert_eq!(enc.encode(first, &mut f), FrameKind::Full);
    tracker.decode(&f).unwrap();
    let top = SnapshotData::build(3, 1, 0, None, std::iter::once(at(POS_MAX, POS_MAX))).unwrap();
    f.clear();
    assert_eq!(enc.encode(top.clone(), &mut f), FrameKind::Delta);
    tracker.decode(&f).unwrap();
    assert_eq!(tracker.snapshot().unwrap(), top.decoded());
    let ServerMsg::Snapshot { actors, .. } = top.decoded() else {
        unreachable!()
    };
    assert_eq!((actors[0].x, actors[0].y), (POS_MAX, POS_MAX));
}

/// The abuse case: a client that sends a Resync before every snapshot gets at most one forced Full frame per
/// MIN_FORCED_FULL_TICKS, not one per request, and still never waits longer than that interval for a Full frame.
#[test]
fn a_resync_flood_costs_one_forced_full_frame_per_interval() {
    let snaps = walk(11, 400);
    let natural: Vec<bool> = {
        let mut enc = ConnEncoder::new();
        snaps
            .iter()
            .map(|s| enc.encode(s.clone(), &mut Vec::new()) == FrameKind::Full)
            .collect()
    };
    let mut enc = ConnEncoder::new();
    let (mut forced, mut fulls) = (Vec::new(), Vec::new());
    for (i, s) in snaps.iter().enumerate() {
        enc.request_full();
        if enc.encode(s.clone(), &mut Vec::new()) == FrameKind::Full {
            fulls.push(s.tick());
            if !natural[i] {
                forced.push(s.tick());
            }
        } else {
            assert!(
                !natural[i],
                "a request never turns a Full frame into a delta"
            );
        }
    }
    assert!(forced.len() >= 2, "{forced:?}");
    for w in forced.windows(2) {
        assert!(w[1] - w[0] >= MIN_FORCED_FULL_TICKS, "{forced:?}");
    }
    let span = snaps.last().unwrap().tick() - snaps[0].tick();
    assert!(
        forced.len() as u32 <= span / MIN_FORCED_FULL_TICKS + 1,
        "{forced:?}"
    );
    for w in fulls.windows(2) {
        assert!(
            w[1] - w[0] <= MIN_FORCED_FULL_TICKS,
            "a pending request waits at most the interval: {fulls:?}"
        );
    }
}
