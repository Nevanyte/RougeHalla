//! Combat v5: strict new command values, refusal reasons and hit flags.
use rh_protocol::*;

#[test]
fn v5_encoders_refuse_invalid_combat_values() {
    assert!(PickupHandle::new(0).is_none());
    for command in [
        WireCommand::Swap { slot: Some(2) },
        WireCommand::Swap {
            slot: Some(u8::MAX),
        },
    ] {
        let msg = ClientMsg::Input {
            seq: 1,
            commands: vec![command],
        };
        assert_eq!(msg.try_encode(), Err(EncodeError::BadValue("command")));
    }
    for reason in [0, 6, u8::MAX] {
        let msg = ServerMsg::Events {
            tick: 1,
            events: vec![WireEvent::PickupRefused { reason }],
        };
        assert_eq!(
            msg.try_encode(),
            Err(EncodeError::BadValue("pickup reason"))
        );
    }
}

#[test]
fn hit_flags_are_strict_and_a_v4_hit_is_incomplete() {
    // V4 hit: tag, tick, count, Hit tag, victim, source, amount f32.
    let mut old = vec![0x85, 0, 1, 2, 1, 2, 0, 0, 0, 0];
    assert_eq!(ServerMsg::decode(&old), Err(DecodeError::Truncated));
    // Protocol 16 (ADR0026): bit 0 passive, bit 1 critical; any other bit is refused.
    for flag in [0, 1, 2, 3] {
        old.push(flag);
        let ServerMsg::Fx { fx, .. } = ServerMsg::decode(&old).unwrap() else {
            panic!("Fx")
        };
        assert!(
            matches!(fx[0], WireFx::Hit { passive, critical, .. } if passive == (flag & 1 == 1) && critical == (flag & 2 == 2))
        );
        old.pop();
    }
    old.push(4);
    assert_eq!(
        ServerMsg::decode(&old),
        Err(DecodeError::BadField("hit flags"))
    );
}

#[test]
fn combat_frames_obey_the_exact_server_byte_boundary() {
    let block = WireFx::Block {
        id: 1,
        by: u32::MAX,
        weapon: 1,
    };
    let mut fx = vec![block; 32767];
    fx.push(WireFx::Stagger { id: 128 });
    let max = ServerMsg::Fx {
        tick: 0,
        fx: fx.clone(),
    }
    .try_encode()
    .unwrap();
    assert_eq!(max.len(), MAX_SERVER_FRAME);
    assert!(ServerMsg::decode(&max).is_ok());
    fx[32767] = WireFx::Stagger { id: 16384 };
    assert_eq!(
        ServerMsg::Fx { tick: 0, fx }.try_encode(),
        Err(EncodeError::TooLarge {
            len: MAX_SERVER_FRAME + 1,
            max: MAX_SERVER_FRAME
        })
    );
    let mut over = max;
    over.push(0);
    assert_eq!(
        ServerMsg::decode(&over),
        Err(DecodeError::TooLarge(MAX_SERVER_FRAME + 1))
    );
    assert_eq!(
        ServerMsg::Fx {
            tick: 0,
            fx: vec![block; 32768]
        }
        .try_encode(),
        Err(EncodeError::TooLarge {
            len: 262149,
            max: MAX_SERVER_FRAME
        })
    );
}
