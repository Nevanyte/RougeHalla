//! Protocol v4 (docs/adr/0011-protocol-v4.md): append-only varint field masks, status and phase as ordinary fields with
//! defaults, the actor kind, the reserved State message. Each test fails if the rule it names is broken.
use rh_protocol::delta::{diff, AD_KIND, AD_NEW, AD_STATUS};
use rh_protocol::*;

fn me() -> WireSelf {
    WireSelf {
        archetype: Default::default(),
        sig: 0,
        effects: 0,
        displace_seq: 0,
        id: 3,
        faction: 4,
        x: 400.0,
        y: 320.5,
        facing: 1.5,
        hp: 1145.0,
        max_hp: 1145.0,
        status: DEFAULT_STATUS,
        weapon: 5,
        ready_in_ms: 0,
        kills: 0,
        bounty: 0,
        gv: 0,
        move_seq: 0,
        hunt_target: None,
        hunt_stacks: 0,
        wish: None,
        barrier: 0.0,
        barrier_ring_step: 0,
        ..Default::default()
    }
}

fn actor(id: u32) -> WireActor {
    WireActor {
        archetype: Default::default(),
        sig: 0,
        mob_type_code: 0,
        effects: 0,
        displace_seq: 0,
        id,
        faction: 1,
        x: 100.0 + id as f32,
        y: 50.0,
        facing: 0.5,
        hp_pct: 100,
        status: DEFAULT_STATUS,
        weapon: 2,
        bounty: 0,
        kind: 0,
        barrier_pct: 0,
        barrier_ring_step: 0,
        ..Default::default()
    }
}

fn snap(tick: u32, phase: u8, me: Option<WireSelf>, actors: &[WireActor]) -> SnapshotData {
    SnapshotData::build(tick, phase, 0, me, actors.iter().copied()).unwrap()
}

/// The head varint of a Full Snapshot frame: after the tag, the tick and the ack (one byte each for these small values).
fn full_head(m: &ServerMsg) -> u32 {
    let b = m.encode();
    let mut r = Reader::new(&b[3..]);
    r.varint().unwrap()
}

fn full(me: Option<WireSelf>, phase: u8) -> ServerMsg {
    ServerMsg::Snapshot {
        training: false,
        owner_combat: None,
        tick: 1,
        server_time: snapshot_server_ms(1),
        phase,
        ack_input: 0,
        me,
        actors: vec![],
    }
}

/// The bit numbers of the Full head are wire format and append only: this table is the contract, and a change to a number (a
/// reordering, a reuse) fails here before it can reach a client.
#[test]
fn full_head_bit_numbers_are_pinned() {
    let with = |f: fn(&mut WireSelf)| {
        let mut s = me();
        s.weapon = 0;
        s.faction = 0;
        f(&mut s);
        full_head(&full(Some(s), DEFAULT_PHASE))
    };
    assert_eq!(with(|_| {}), 1 << 0, "a self follows");
    assert_eq!(with(|s| s.faction = 1), (1 << 0) | (1 << 1), "kit");
    assert_eq!(with(|s| s.hp = 1.0), (1 << 0) | (1 << 2), "hp");
    assert_eq!(with(|s| s.ready_in_ms = 1), (1 << 0) | (1 << 3), "ready");
    assert_eq!(with(|s| s.kills = 1), (1 << 0) | (1 << 4), "kills");
    assert_eq!(with(|s| s.bounty = 1), (1 << 0) | (1 << 5), "bounty");
    assert_eq!(with(|s| s.move_seq = 1), (1 << 0) | (1 << 6), "move_seq");
    assert_eq!(with(|s| s.gv = 1), (1 << 0) | (1 << 7), "gv");
    assert_eq!(
        with(|s| {
            s.max_hp = 1.5;
            s.hp = 1.5
        }),
        (1 << 0) | (1 << 8),
        "max_hp as an f32"
    );
    assert_eq!(with(|s| s.status = 2), (1 << 0) | (1 << 9), "status");
    assert_eq!(full_head(&full(None, 2)), 1 << 10, "phase, without a self");
}

/// A field at its default costs no byte: an alive player in the active phase (kind 0) adds nothing to the frame, and the
/// non-default value is carried explicitly and round-trips.
#[test]
fn defaults_cost_nothing_and_other_values_are_explicit() {
    let calm = full(Some(me()), DEFAULT_PHASE);
    let mut dead = me();
    dead.status = 2;
    let with_status = full(Some(dead), DEFAULT_PHASE);
    // A bit from 7 up widens the head varint to two bytes, and the value is one byte: the default is neither.
    assert_eq!(calm.encode().len() + 2, with_status.encode().len());
    let ended = full(Some(me()), 2);
    assert_eq!(calm.encode().len() + 2, ended.encode().len());
    for m in [&with_status, &ended] {
        assert_eq!(ServerMsg::decode(&m.encode()).as_ref(), Ok(m));
    }
    let mut a = actor(7);
    let base = ServerMsg::Snapshot {
        training: false,
        owner_combat: None,
        tick: 1,
        server_time: snapshot_server_ms(1),
        phase: DEFAULT_PHASE,
        ack_input: 0,
        me: None,
        actors: vec![a],
    };
    a.kind = 9;
    a.status = 0;
    let odd = ServerMsg::Snapshot {
        training: false,
        owner_combat: None,
        tick: 1,
        server_time: snapshot_server_ms(1),
        phase: DEFAULT_PHASE,
        ack_input: 0,
        me: None,
        actors: vec![a],
    };
    assert_eq!(base.encode().len() + 2, odd.encode().len());
    assert_eq!(
        ServerMsg::decode(&odd.encode()).unwrap(),
        ServerMsg::Snapshot {
            training: false,
            owner_combat: None,
            tick: 1,
            server_time: snapshot_server_ms(1),
            phase: DEFAULT_PHASE,
            ack_input: 0,
            me: None,
            actors: vec![a.quantized()],
        }
    );
}

/// The common delta (a moving, shooting player; actors moving) keeps its head and every actor mask in one byte, and a quiet
/// self costs a one-byte head: the room to grow is free.
#[test]
fn the_common_delta_masks_are_one_byte() {
    let a = snap(10, DEFAULT_PHASE, Some(me()), &[actor(1), actor(2)]);
    let mut m = me();
    m.x += 3.0;
    m.y += 1.0;
    m.facing = 0.25;
    m.move_seq = 4;
    m.hp -= 10.0;
    m.ready_in_ms = 300;
    let mut moved = [actor(1), actor(2)];
    moved[0].x += 1.0;
    moved[1].hp_pct = 90;
    moved[1].status = 2;
    let b = snap(11, DEFAULT_PHASE, Some(m), &moved);
    let mut enc = ConnEncoder::new();
    let mut f = Vec::new();
    assert_eq!(enc.encode(a, &mut f), FrameKind::Full);
    f.clear();
    assert_eq!(enc.encode(b.clone(), &mut f), FrameKind::Delta);
    // tag, tick, age, ack, then the head.
    assert!(
        f[4] < 0x80,
        "the head of a moving player is one byte: {:#x}",
        f[4]
    );
    let ServerMsg::SnapshotDelta(d) = ServerMsg::decode(&f).unwrap() else {
        panic!("a delta")
    };
    assert!(
        d.changed.iter().all(|c| c.mask < 0x80),
        "one-byte actor masks"
    );
    assert_eq!(d.phase, None, "the phase is carried only when it changed");
    // A self that did not change at all is a head of 1 (just the present bit).
    let quiet = snap(12, DEFAULT_PHASE, b.me().copied(), &moved);
    f.clear();
    enc.encode(quiet, &mut f);
    assert_eq!(
        (f[4], f.len()),
        (1, 6),
        "tag tick age ack head count: {f:?}"
    );
}

/// The phase is a delta field only when it changes, and the tracker keeps the old phase otherwise.
#[test]
fn a_delta_carries_the_phase_only_when_it_changed() {
    let a = snap(10, 0, None, &[actor(1)]);
    let same = snap(11, 0, None, &[actor(1)]);
    let next = snap(12, 1, None, &[actor(1)]);
    assert_eq!(diff(&a, &same).unwrap().phase, None);
    assert_eq!(diff(&same, &next).unwrap().phase, Some(1));
    let mut enc = ConnEncoder::new();
    let mut t = SnapshotTracker::new();
    for s in [a, same, next] {
        let mut f = Vec::new();
        enc.encode(s.clone(), &mut f);
        assert_eq!(t.decode(&f).unwrap(), s.decoded());
    }
}

/// A new actor starts from the default actor: only its position is required, and it carries what is not a default. A kind or a
/// status change on a known actor is a delta field of its own.
#[test]
fn new_actors_start_from_defaults_and_kind_and_status_changes_are_deltas() {
    let a = snap(10, DEFAULT_PHASE, None, &[actor(1)]);
    let mut mob = actor(5);
    mob.kind = 3;
    mob.faction = 0;
    mob.weapon = 0;
    let mut changed = actor(1);
    changed.kind = 1;
    changed.status = 2;
    let b = snap(11, DEFAULT_PHASE, None, &[changed, mob]);
    let d = diff(&a, &b).unwrap();
    assert_eq!(d.changed.len(), 2);
    assert_eq!(
        d.changed[0].mask,
        AD_KIND | AD_STATUS,
        "known actor: only what changed"
    );
    assert_eq!(
        d.changed[1].mask,
        AD_NEW | AD_KIND,
        "new actor: position and the non-default kind; kit, hp, status, bounty are defaults"
    );
    let mut enc = ConnEncoder::new();
    let mut t = SnapshotTracker::new();
    for s in [a, b] {
        let mut f = Vec::new();
        enc.encode(s.clone(), &mut f);
        assert_eq!(t.decode(&f).unwrap(), s.decoded());
    }
    assert_eq!(t.actors()[1].kind, 3);
    assert_eq!(t.actors()[0].kind, 1);
}

/// The original empty State remains valid; undefined keys are refused. A State never changes the held snapshot.
#[test]
fn an_empty_state_retains_the_snapshot_and_unknown_keys_are_refused() {
    let m = ServerMsg::State {
        tick: 300,
        items: vec![],
    };
    let b = m.encode();
    assert_eq!(b, [0x88, 0xac, 0x02, 0]);
    assert_eq!(ServerMsg::decode(&b), Ok(m.clone()));
    assert_eq!(
        ServerMsg::decode(&[0x88, 0, 1, 12]),
        Err(DecodeError::BadField("state key"))
    );
    let mut t = SnapshotTracker::new();
    let s = snap(10, DEFAULT_PHASE, None, &[actor(1)]);
    let mut f = Vec::new();
    s.encode_full_into(&mut f);
    t.decode(&f).unwrap();
    assert_eq!(t.decode(&b), Ok(m));
    assert_eq!(t.held_tick(), Some(10));
}

/// A mask bit the version does not define is refused in every mask, never skipped, and a non-canonical varint head is too.
#[test]
fn undefined_mask_bits_are_refused_never_skipped() {
    // A Full head with bit 25, a Full actor mask with bit 15, a delta head with bit 29, a delta actor mask with bit 18
    // (protocol 16 with ADR0026: the first bits no field uses).
    let full_head_bit = [0x83, 1, 0, 0x80, 0x80, 0x80, 0x10, 0];
    assert_eq!(
        ServerMsg::decode(&full_head_bit),
        Err(DecodeError::BadField("head"))
    );
    let actor_bit = [0x83, 1, 0, 0, 1, 1, 0x80, 0x80, 0x02, 0, 0, 0, 0, 0, 0];
    assert_eq!(
        ServerMsg::decode(&actor_bit),
        Err(DecodeError::BadField("actor mask"))
    );
    let delta_head_bit = [0x87, 10, 1, 0, 0x80, 0x80, 0x80, 0x80, 2, 0];
    assert_eq!(
        ServerMsg::decode(&delta_head_bit),
        Err(DecodeError::BadField("head"))
    );
    let delta_actor_bit = [0x87, 10, 1, 0, 0, 1, 1, 0x80, 0x80, 0x10];
    assert_eq!(
        ServerMsg::decode(&delta_actor_bit),
        Err(DecodeError::BadField("actor mask"))
    );
    let overlong = [0x83, 1, 0, 0x80, 0x00, 0];
    assert_eq!(ServerMsg::decode(&overlong), Err(DecodeError::BadVarint));
}

/// The Delta head and the actor-delta mask bit numbers are wire format and append only, like the Full head: this table is the
/// contract that the crate docs repeat. A number that moves fails here.
#[test]
fn delta_head_and_actor_delta_bit_numbers_are_pinned() {
    use rh_protocol::delta::*;
    let head = [
        (DH_PRESENT, 0),
        (DH_X, 1),
        (DH_Y, 2),
        (DH_FACING, 3),
        (DH_MOVE_SEQ, 4),
        (DH_HP, 5),
        (DH_READY, 6),
        (DH_DEPARTED, 7),
        (DH_PHASE, 8),
        (DH_MAX_HP, 9),
        (DH_KIT, 10),
        (DH_KILLS, 11),
        (DH_BOUNTY, 12),
        (DH_GV, 13),
        (DH_STATUS, 14),
        (DH_EFFECTS, 15),
        (DH_DISPLACE, 16),
        (DH_SIG, 17),
        (DH_HUNT_TARGET, 18),
        (DH_HUNT_STACKS, 19),
        (DH_TRAINING, 20),
        (DH_WISH, 21),
        (DH_BARRIER, 22),
        (DH_SERVER_TIME, 23),
        (DH_OWNER_COMBAT, 24),
        (DH_ARCHETYPE, 25),
        (DH_FLAGS, 26),
        (DH_BUILD_MARKS, 27),
        (DH_MARK, 28),
    ];
    for (c, bit) in head {
        assert_eq!(c, 1u32 << bit, "delta head bit {bit}");
    }
    assert_eq!(DH_KNOWN, (1 << 29) - 1);
    let ad = [
        (AD_X, 0),
        (AD_Y, 1),
        (AD_FACING, 2),
        (AD_KIT, 3),
        (AD_HP, 4),
        (AD_BOUNTY, 5),
        (AD_STATUS, 6),
        (AD_KIND, 7),
        (AD_EFFECTS, 8),
        (AD_DISPLACE, 9),
        (AD_MOB_TYPE, 10),
        (AD_SIG, 11),
        (AD_BARRIER, 12),
        (AD_ARCHETYPE, 13),
        (AD_FLAGS, 14),
        (AD_OFFHAND, 15),
        (AD_BUILD_MARKS, 16),
        (AD_MARK, 17),
    ];
    for (c, bit) in ad {
        assert_eq!(c, 1u32 << bit, "actor-delta bit {bit}");
    }
    assert_eq!(AD_ALL, 0x3_ffff);
}
