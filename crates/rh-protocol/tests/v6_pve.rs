use rh_protocol::*;

fn camp() -> WireCamp {
    WireCamp {
        mob_type: 29,
        elite: Some(29),
        alive: 512,
        state: 2,
        cleared_at: 1000.,
        respawn_at: 181000.,
    }
}

#[test]
fn camp_bounds_are_symmetric_and_refusals_do_not_append() {
    let valid = camp();
    let msg = ServerMsg::State {
        tick: 0,
        items: vec![StateItem::Camps(vec![valid; 512])],
    };
    assert_eq!(msg.encoded_len(), msg.encode().len());
    assert_eq!(ServerMsg::decode(&msg.encode()), Ok(msg));
    let mut bad = vec![];
    for change in 0..9 {
        let mut c = valid;
        match change {
            0 => c.mob_type = 30,
            1 => c.elite = Some(30),
            2 => c.alive = 513,
            3 => c.state = 3,
            4 => c.cleared_at = -1.,
            5 => c.cleared_at = f64::NAN,
            6 => c.respawn_at = f64::INFINITY,
            7 => c.respawn_at = 999.,
            _ => c.respawn_at = -1.,
        }
        bad.push(vec![c]);
    }
    bad.push(vec![valid; 513]);
    for rows in bad {
        let msg = ServerMsg::State {
            tick: 0,
            items: vec![StateItem::Camps(rows)],
        };
        let mut out = vec![77];
        assert!(msg.encode_into(&mut out).is_err());
        assert_eq!(out, [77]);
    }
}

#[test]
fn new_command_and_notice_refusals_are_atomic() {
    for command in [
        WireCommand::Target { actor: 0 },
        WireCommand::AttackMove {
            x: f32::NAN,
            y: 0.,
            seq: None,
        },
        WireCommand::AttackMove {
            x: 0.,
            y: f32::INFINITY,
            seq: Some(0),
        },
    ] {
        let mut out = vec![77];
        assert!(ClientMsg::Input {
            seq: 0,
            commands: vec![command]
        }
        .encode_into(&mut out)
        .is_err());
        assert_eq!(out, [77]);
    }
    for notice in [0, 11, 255] {
        let mut out = vec![77];
        assert!(ServerMsg::Events {
            tick: 0,
            events: vec![WireEvent::PotionNotice { notice }]
        }
        .encode_into(&mut out)
        .is_err());
        assert_eq!(out, [77]);
    }
}

#[test]
fn maximum_full_records_and_reference_delta_preserve_new_scalars() {
    let me = WireSelf {
        id: u32::MAX,
        faction: 15,
        x: 1.,
        y: 2.,
        facing: 3.,
        hp: 1.,
        max_hp: 2.5,
        status: 3,
        weapon: 15,
        ready_in_ms: u16::MAX,
        kills: u16::MAX,
        bounty: u16::MAX,
        gv: u16::MAX,
        move_seq: 255,
        hunt_target: None,
        hunt_stacks: 0,
        effects: u16::MAX,
        displace_seq: 255,
        sig: 255,
    };
    let actor = WireActor {
        id: u32::MAX,
        faction: 15,
        x: 1.,
        y: 2.,
        facing: 3.,
        hp_pct: 0,
        status: 3,
        weapon: 15,
        bounty: u16::MAX,
        kind: 255,
        effects: u16::MAX,
        displace_seq: 255,
        mob_type_code: 30,
        sig: 255,
    };
    let data = SnapshotData::build(u32::MAX, 3, u32::MAX, Some(me), [actor].into_iter()).unwrap();
    let mut fast = vec![];
    data.encode_full_into(&mut fast);
    assert_eq!(fast.len(), data.full_len());
    assert_eq!(fast, data.decoded().encode());
    assert_eq!(ServerMsg::decode(&fast), Ok(data.decoded()));
    let mut invalid = actor;
    invalid.mob_type_code = 31;
    assert_eq!(QActor::checked(&invalid), Err("mob type"));
    assert!(SnapshotData::build(1, 1, 0, None, [invalid].into_iter()).is_err());
    assert!(ServerMsg::Snapshot {
        training: false,
        tick: 1,
        phase: 1,
        ack_input: 0,
        me: None,
        actors: vec![invalid]
    }
    .try_encode()
    .is_err());
    let bad_delta = SnapshotDelta {
        training: false,
        tick: 2,
        base_tick: 1,
        phase: None,
        ack_input: 0,
        me: None,
        departed: vec![],
        changed: vec![ActorDelta {
            mask: rh_protocol::delta::AD_MOB_TYPE,
            q: QActor {
                id: 1,
                mob_type_code: 31,
                ..QActor::NEW
            },
        }],
    };
    assert!(ServerMsg::SnapshotDelta(bad_delta).try_encode().is_err());
}

#[test]
fn projectile_rows_preserve_duplicates_and_strict_owner_bounds() {
    let row = WireProjectile {
        kind: 1,
        x: u16::MAX,
        y: 0,
        facing: u16::MAX,
        owner: Some(u32::MAX),
    };
    for owner in [None, Some(1), Some(u32::MAX)] {
        let msg = ServerMsg::State {
            tick: 1,
            items: vec![StateItem::Projectiles(vec![
                WireProjectile { owner, ..row };
                512
            ])],
        };
        let bytes = msg.encode();
        assert_eq!(bytes.len(), msg.encoded_len());
        assert_eq!(ServerMsg::decode(&bytes), Ok(msg));
    }
    for rows in [
        vec![WireProjectile { kind: 2, ..row }],
        vec![WireProjectile {
            owner: Some(0),
            ..row
        }],
        vec![row; 513],
    ] {
        let mut out = vec![77];
        assert!(ServerMsg::State {
            tick: 1,
            items: vec![StateItem::Projectiles(rows)]
        }
        .encode_into(&mut out)
        .is_err());
        assert_eq!(out, [77]);
    }
    let msg = ServerMsg::State {
        tick: 1,
        items: vec![StateItem::Projectiles(vec![row, row])],
    };
    let bytes = msg.encode();
    for end in 0..bytes.len() {
        assert!(ServerMsg::decode(&bytes[..end]).is_err());
    }
}
