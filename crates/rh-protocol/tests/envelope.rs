//! The cross-version envelope: the only bytes an older and a newer build must always agree on.
use rh_protocol::*;

#[test]
fn hello_prefix_is_read_without_decoding_the_rest() {
    let hello = ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: 1,
        build: "b".into(),
        profile: "p".into(),
        token: "t".into(),
        faction: None,
        resume: None,
    }
    .encode();
    assert_eq!(ClientMsg::hello_protocol(&hello), Some(PROTOCOL_VERSION));
    // Another version with arbitrary trailing bytes: the prefix answers, the full decode would not.
    let future = [0x01, 4, 0, 0xde, 0xad, 0xbe, 0xef, 0x01];
    assert_eq!(ClientMsg::hello_protocol(&future), Some(4));
    assert!(ClientMsg::decode(&future).is_err());
    assert_eq!(ClientMsg::hello_protocol(&[0x01, 4]), None);
    assert_eq!(ClientMsg::hello_protocol(&[]), None);
    assert_eq!(ClientMsg::hello_protocol(&[0x02, 3, 0, 0]), None);
}

#[test]
fn unknown_reject_codes_decode_and_keep_their_value() {
    for code in [12u16, 300, 0xffff] {
        let m = ServerMsg::Reject {
            code: RejectCode::Unknown(code),
            reason: "update required".into(),
        };
        let bytes = m.encode();
        assert_eq!(bytes[..3], [0x82, code as u8, (code >> 8) as u8]);
        assert_eq!(ServerMsg::decode(&bytes), Ok(m));
    }
    // Known codes keep their names; 0 is not a code.
    assert_eq!(RejectCode::from_u16(11), RejectCode::Kicked);
    assert_eq!(RejectCode::Kicked.code(), 11);
    assert_eq!(RejectCode::from_u16(0), RejectCode::Unknown(0));
    assert_eq!(
        ServerMsg::decode(&[0x82, 0, 0, 0]),
        Err(DecodeError::BadTag(0))
    );
}

#[test]
fn every_named_reject_code_round_trips() {
    for v in 1..=11u16 {
        assert_eq!(RejectCode::from_u16(v).code(), v);
        assert!(!matches!(RejectCode::from_u16(v), RejectCode::Unknown(_)));
    }
}

#[test]
fn strings_over_255_bytes_are_refused_not_truncated() {
    let long = "é".repeat(128); // 256 bytes
    let ok = "x".repeat(255);
    let hello = |build: &str, profile: &str, token: &str| ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: 0,
        build: build.into(),
        profile: profile.into(),
        token: token.into(),
        faction: None,
        resume: None,
    };
    assert!(hello(&ok, &ok, &ok).try_encode().is_ok());
    for (what, m) in [
        ("build", hello(&long, "", "")),
        ("profile", hello("", &long, "")),
        ("token", hello("", "", &long)),
    ] {
        assert_eq!(
            m.try_encode(),
            Err(EncodeError::StringTooLong { what, len: 256 })
        );
        let mut out = Vec::new();
        assert!(m.encode_into(&mut out).is_err());
        assert!(out.is_empty());
    }
    let reject = |reason: String| ServerMsg::Reject {
        code: RejectCode::Malformed,
        reason,
    };
    assert!(reject(ok.clone()).try_encode().is_ok());
    assert_eq!(
        reject(long.clone()).try_encode(),
        Err(EncodeError::StringTooLong {
            what: "reason",
            len: 256
        })
    );
}

#[test]
#[should_panic(expected = "does not fit the wire")]
fn the_writer_itself_never_truncates() {
    let mut w = Writer::default();
    w.str(&"x".repeat(256));
}

#[test]
fn reject_code_zero_and_misnamed_unknowns_are_refused_by_the_encoder() {
    let m = |code| ServerMsg::Reject {
        code,
        reason: String::new(),
    };
    assert_eq!(
        m(RejectCode::Unknown(0)).try_encode(),
        Err(EncodeError::BadValue("reject code"))
    );
    assert_eq!(
        m(RejectCode::Unknown(7)).try_encode(),
        Err(EncodeError::BadValue("reject code"))
    );
    assert!(m(RejectCode::Unknown(12)).try_encode().is_ok());
    assert!(m(RejectCode::Kicked).try_encode().is_ok());
}

#[test]
fn an_events_frame_with_an_overlong_killer_name_is_refused() {
    let ev = |name: String| ServerMsg::Events {
        tick: 1,
        events: vec![WireEvent::Result(WireResult {
            outcome: 0,
            place: 1,
            players: 2,
            kills: 0,
            killed_by: Some(name),
            gv_total: 0,
            gv_win: 0,
            duration_sec: 0,
            win_bonus_withheld: false,
        })],
    };
    assert!(ev("k".repeat(255)).try_encode().is_ok());
    assert_eq!(
        ev("k".repeat(256)).try_encode(),
        Err(EncodeError::StringTooLong {
            what: "killed_by",
            len: 256
        })
    );
}
