//! The snapshot builder is the one refusal path of every snapshot frame the server sends: `SnapshotData::build` / `build_with`
//! (and `build_checked`, which they share) refuse, never repair, what a decoder would reject, and the Full frame of what they
//! build is the v2 message's frame byte for byte. Each refusal below fails if its check is removed from the builder.
use rh_protocol::*;

fn actor(i: u32) -> WireActor {
    WireActor {
        sig: 0,
        mob_type_code: 0,
        effects: 0,
        displace_seq: 0,
        id: i * 3 + 1,
        faction: (i % 5) as u8,
        x: 100.25 + i as f32,
        y: 7.5 * i as f32,
        facing: (i as f32 * 0.37).sin(),
        hp_pct: (i % 101) as u8,
        status: (i % 4) as u8,
        weapon: (i % 7) as u8,
        bounty: (i * 977) as u16,
        kind: (i % 3) as u8,
    }
}

fn me() -> WireSelf {
    WireSelf {
        sig: 0,
        effects: 0,
        displace_seq: 0,
        id: 3,
        faction: 4,
        x: 400.0,
        y: 320.5,
        facing: 1.5,
        hp: 1000.25,
        max_hp: 1145.0,
        status: 1,
        weapon: 5,
        ready_in_ms: 250,
        kills: 2,
        bounty: 0,
        gv: 20,
        move_seq: 7,
    }
}

fn message(phase: u8, me: Option<WireSelf>, actors: Vec<WireActor>) -> ServerMsg {
    ServerMsg::Snapshot {
        tick: 101,
        phase,
        ack_input: 42,
        me,
        actors,
    }
}

fn build(m: &ServerMsg) -> Result<SnapshotData, EncodeError> {
    let ServerMsg::Snapshot {
        tick,
        phase,
        ack_input,
        me,
        actors,
    } = m
    else {
        panic!("not a snapshot")
    };
    SnapshotData::build(*tick, *phase, *ack_input, *me, actors.iter().copied())
}

/// An `ExactSizeIterator` that claims `claim` actors and yields `left`.
struct Liar {
    left: u32,
    claim: usize,
}

impl Iterator for Liar {
    type Item = WireActor;
    fn next(&mut self) -> Option<WireActor> {
        (self.left > 0).then(|| {
            self.left -= 1;
            actor(10 - self.left)
        })
    }
}

impl ExactSizeIterator for Liar {
    fn len(&self) -> usize {
        self.claim
    }
}

fn liar(left: u32, claim: usize) -> Result<SnapshotData, EncodeError> {
    SnapshotData::build(1, 1, 1, Some(me()), Liar { left, claim })
}

#[test]
fn the_full_frame_of_a_built_snapshot_is_the_message_frame_for_every_size() {
    for n in [0u32, 1, 2, 14, 68, 300, MAX_ACTORS as u32] {
        for me in [None, Some(me())] {
            let m = message(1, me, (0..n).map(actor).collect());
            let snap = build(&m).expect("builds");
            let mut out = vec![9, 9];
            assert_eq!(snap.encode_full_into(&mut out), m.encoded_len());
            assert_eq!(&out[..2], &[9, 9], "appends after what is there");
            assert_eq!(&out[2..], &m.encode()[..]);
            assert_eq!(snap.full_len(), m.encoded_len());
            assert!(snap.min_len() <= snap.full_len());
            assert_eq!(ServerMsg::decode(&out[2..]), Ok(snap.decoded()));
        }
    }
}

/// The announced count is the iterator's `len()`: an iterator that yields another number is a mismatch in either direction, a
/// refusal leaves nothing half built, and the block it was given is usable again.
#[test]
fn a_lying_exact_size_iterator_is_a_count_mismatch() {
    for announced in [0usize, 3, 400] {
        assert_eq!(
            liar(5, announced).err(),
            Some(EncodeError::CountMismatch {
                declared: announced,
                written: 5
            }),
            "announced {announced}"
        );
    }
    assert_eq!(
        liar(4, 5).err(),
        Some(EncodeError::CountMismatch {
            declared: 5,
            written: 4
        })
    );
    assert_eq!(
        liar(4, 3).err(),
        Some(EncodeError::CountMismatch {
            declared: 3,
            written: 4
        })
    );
    let ok = liar(4, 4).expect("a truthful iterator builds");
    assert_eq!(ok.actors().len(), 4);
    // The same refusal when built in a recycled block, and the block still builds afterwards.
    assert_eq!(
        SnapshotData::build_with(Some(ok), 1, 1, 1, None, Liar { left: 4, claim: 5 }).err(),
        Some(EncodeError::CountMismatch {
            declared: 5,
            written: 4
        })
    );
    let again = SnapshotData::build_with(
        Some(liar(4, 4).unwrap()),
        2,
        1,
        1,
        None,
        Liar { left: 2, claim: 2 },
    )
    .expect("builds");
    assert_eq!((again.tick(), again.actors().len()), (2, 2));
}

/// More than MAX_ACTORS is refused before anything is read (by the announced count) and after (by the real count).
#[test]
fn more_than_max_actors_is_refused_not_clamped() {
    assert_eq!(
        liar(1, 1000).err(),
        Some(EncodeError::TooMany {
            what: "actors",
            n: 1000,
            max: MAX_ACTORS
        })
    );
    let over = message(
        1,
        Some(me()),
        (0..MAX_ACTORS as u32 + 1).map(actor).collect(),
    );
    let err = EncodeError::TooMany {
        what: "actors",
        n: MAX_ACTORS + 1,
        max: MAX_ACTORS,
    };
    assert_eq!(build(&over).err(), Some(err.clone()));
    assert_eq!(over.try_encode(), Err(err));
    let max = message(1, Some(me()), (0..MAX_ACTORS as u32).map(actor).collect());
    assert!(build(&max).is_ok());
}

/// Every content fault a decoder would reject is refused with the reason the message encoder gives, and the message encoder and
/// the builder agree on every one of them.
#[test]
fn faulty_content_is_refused_with_the_message_encoders_reason() {
    let good: Vec<WireActor> = (0..3).map(actor).collect();
    let each = |f: &dyn Fn(&mut WireActor)| -> Vec<WireActor> {
        good.iter()
            .map(|a| {
                let mut a = *a;
                f(&mut a);
                a
            })
            .collect()
    };
    let swapped = {
        let mut v = good.clone();
        v.swap(0, 2);
        v
    };
    let repeated = {
        let mut v = good.clone();
        v[1].id = v[0].id;
        v
    };
    let cases: Vec<(&str, ServerMsg, &str)> = vec![
        (
            "hp_pct",
            message(1, Some(me()), each(&|a| a.hp_pct = 101)),
            "hp_pct",
        ),
        (
            "x nan",
            message(1, Some(me()), each(&|a| a.x = f32::NAN)),
            "position",
        ),
        (
            "y off the grid",
            message(1, None, each(&|a| a.y = 8192.0)),
            "position",
        ),
        (
            "x negative",
            message(1, None, each(&|a| a.x = -0.01)),
            "position",
        ),
        (
            "actor faction",
            message(1, None, each(&|a| a.faction = 16)),
            "faction",
        ),
        (
            "actor weapon",
            message(1, None, each(&|a| a.weapon = 16)),
            "weapon",
        ),
        (
            "actor status",
            message(1, None, each(&|a| a.status = 4)),
            "status",
        ),
        ("descending ids", message(1, None, swapped), "actor order"),
        ("repeated id", message(1, None, repeated), "actor order"),
        ("phase", message(4, Some(me()), good.clone()), "phase"),
        (
            "self faction",
            message(
                1,
                Some(WireSelf {
                    faction: 16,
                    ..me()
                }),
                good.clone(),
            ),
            "faction",
        ),
        (
            "self weapon",
            message(1, Some(WireSelf { weapon: 16, ..me() }), good.clone()),
            "weapon",
        ),
        (
            "self status",
            message(1, Some(WireSelf { status: 4, ..me() }), good.clone()),
            "status",
        ),
    ];
    for (name, m, why) in cases {
        assert_eq!(build(&m).err(), Some(EncodeError::BadValue(why)), "{name}");
        assert_eq!(
            m.try_encode().err(),
            build(&m).err(),
            "{name}: the same refusal"
        );
        // And in a recycled block.
        let ServerMsg::Snapshot {
            tick,
            phase,
            ack_input,
            me,
            actors,
        } = &m
        else {
            unreachable!()
        };
        let spare = build(&message(1, None, good.clone())).unwrap();
        assert_eq!(
            SnapshotData::build_with(
                Some(spare),
                *tick,
                *phase,
                *ack_input,
                *me,
                actors.iter().copied()
            )
            .err(),
            Some(EncodeError::BadValue(why)),
            "{name}: recycled block"
        );
    }
}

/// The top of the position range is carried exactly, bit for bit.
#[test]
fn the_top_of_the_position_range_builds_and_decodes_exactly() {
    use rh_protocol::quant::POS_MAX;
    let m = message(
        1,
        None,
        vec![WireActor {
            x: POS_MAX,
            y: 8191.5,
            ..actor(0)
        }],
    );
    let snap = build(&m).expect("builds");
    assert_eq!(m.try_encode().map(|b| b.len()), Ok(snap.full_len()));
    let ServerMsg::Snapshot { actors, .. } = snap.decoded() else {
        unreachable!()
    };
    assert_eq!((actors[0].x, actors[0].y), (POS_MAX, 8191.5));
}

/// `build_checked` is what `build_with` is made of: the same snapshot from actors checked one by one, the first faulty actor in
/// list order is the refusal, and order and count are still the list's own checks.
#[test]
fn build_checked_is_build_with_from_actors_checked_one_by_one() {
    let actors: Vec<WireActor> = (0..9).map(actor).collect();
    let checked: Vec<_> = actors.iter().map(QActor::checked).collect();
    let a = SnapshotData::build_checked(None, 5, 1, 2, Some(me()), checked.iter().copied());
    let b = SnapshotData::build_with(None, 5, 1, 2, Some(me()), actors.iter().copied());
    assert_eq!(a, b);
    assert_eq!(
        QActor::checked(&actors[4]),
        Ok(QActor::from_wire(&actors[4]))
    );

    let mut faulty = checked.clone();
    faulty[3] = Err("position");
    faulty[6] = Err("hp_pct");
    assert_eq!(
        SnapshotData::build_checked(None, 5, 1, 2, None, faulty.iter().copied()).err(),
        Some(EncodeError::BadValue("position"))
    );
    let mut unordered = checked.clone();
    unordered.swap(1, 2);
    assert_eq!(
        SnapshotData::build_checked(None, 5, 1, 2, None, unordered.iter().copied()).err(),
        Some(EncodeError::BadValue("actor order"))
    );
    // A fault in an actor outranks a disorder after it, as in the message encoder.
    let mut both = unordered.clone();
    both[1] = Err("status");
    assert_eq!(
        SnapshotData::build_checked(None, 5, 1, 2, None, both.iter().copied()).err(),
        Some(EncodeError::BadValue("status"))
    );
    assert_eq!(
        QActor::checked(&WireActor {
            hp_pct: 101,
            ..actors[0]
        }),
        Err("hp_pct")
    );
    assert_eq!(
        QActor::checked(&WireActor {
            x: f32::NAN,
            ..actors[0]
        }),
        Err("position")
    );
}
