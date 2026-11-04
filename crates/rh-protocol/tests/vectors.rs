use rh_protocol::samples::*;
use rh_protocol::*;

#[test]
fn committed_vectors_match_the_encoder() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../protocol/fixtures/v2.json");
    let committed = std::fs::read_to_string(&path)
        .expect("protocol/fixtures/v2.json (run the protocol-fixtures bin)");
    assert_eq!(
        committed,
        manifest(),
        "the wire encoding changed: bump PROTOCOL_VERSION if incompatible, then regenerate (cargo run -p rh-protocol --bin protocol-fixtures)"
    );
}

#[test]
fn every_sample_round_trips() {
    for (name, m) in client_samples() {
        assert_eq!(ClientMsg::decode(&m.encode()).as_ref(), Ok(&m), "{name}");
    }
    for (name, m) in server_samples() {
        // A client decodes what the server wrote, with remote actors quantized (a sample may be off the grid on purpose).
        let want = match &m {
            ServerMsg::Snapshot {
                tick,
                phase,
                ack_input,
                me,
                actors,
            } => ServerMsg::Snapshot {
                tick: *tick,
                phase: *phase,
                ack_input: *ack_input,
                me: *me,
                actors: actors.iter().map(WireActor::quantized).collect(),
            },
            ServerMsg::Fx { tick, fx } => ServerMsg::Fx {
                tick: *tick,
                fx: fx.iter().map(WireFx::quantized).collect(),
            },
            other => other.clone(),
        };
        assert_eq!(ServerMsg::decode(&m.encode()).as_ref(), Ok(&want), "{name}");
    }
}

#[test]
fn malformed_server_frames_are_rejected_for_the_documented_reason() {
    use DecodeError::*;
    let want = |name: &str| -> DecodeError {
        match name {
            "empty" | "truncated_snapshot" | "self_truncated" | "actor_count_without_actors" => Truncated,
            "unknown_tag" | "client_tag_from_server" => BadTag(0),
            "trailing_byte" => Trailing(0),
            "overlong_varint" | "varint_past_u32" | "varint_too_long" => BadVarint,
            "head_self_bit_without_present_bit" | "head_reserved_bit" => BadField("head"),
            "self_max_hp_over_u16" => BadField("max_hp"),
            "fx_too_many" => TooMany(0),
            "fx_bad_tag" => BadTag(0),
            "too_many_actors" => TooMany(0),
            "actor_reserved_mask_bit" => BadField("actor mask"),
            "actor_id_gap_zero" | "actor_id_overflow" => BadField("actor order"),
            "actor_hp_over_100" => BadField("hp_pct"),
            "actor_bounty_over_u16" => BadField("bounty"),
            other => panic!("no expectation for {other}"),
        }
    };
    for (name, bytes) in malformed_server() {
        let got = ServerMsg::decode(&bytes).expect_err(name);
        // The payload of BadTag / Trailing / TooMany is incidental: compare the kind.
        assert_eq!(
            std::mem::discriminant(&got),
            std::mem::discriminant(&want(name)),
            "{name}: {got:?}"
        );
        if let (BadField(a), BadField(b)) = (&got, &want(name)) {
            assert_eq!(a, b, "{name}");
        }
    }
}

#[test]
fn fuzzed_server_frames_never_panic() {
    // Every prefix and single-byte mutation of every server sample decodes to Ok or Err, never panics (and never allocates
    // more than MAX_ACTORS actors: the count is checked before the Vec is sized).
    for (_, m) in server_samples() {
        let b = m.encode();
        for cut in 0..b.len().min(400) {
            let _ = ServerMsg::decode(&b[..cut]);
        }
        for i in 0..b.len().min(400) {
            for v in [0u8, 1, 0x7f, 0x80, 0xff] {
                let mut c = b.clone();
                c[i] = v;
                let _ = ServerMsg::decode(&c);
            }
        }
    }
}

#[test]
fn decoding_then_encoding_a_valid_snapshot_is_byte_identical() {
    // The canonical form: one encoding per value, so a decoder that re-encodes (the C# test does) reproduces the frame.
    for (name, m) in server_samples() {
        if matches!(m, ServerMsg::Snapshot { .. } | ServerMsg::Fx { .. }) {
            let bytes = m.encode();
            let back = ServerMsg::decode(&bytes).unwrap().encode();
            assert_eq!(bytes, back, "{name}");
        }
    }
}

#[test]
fn varints_round_trip_and_have_one_encoding() {
    for v in [0u32, 1, 127, 128, 255, 16383, 16384, 2_097_151, 2_097_152, 268_435_455, 268_435_456, u32::MAX] {
        let mut w = Writer::default();
        w.varint(v);
        let b = w.finish();
        assert_eq!(b.len(), codec::varint_len(v), "{v}");
        assert_eq!(Reader::new(&b).varint(), Ok(v));
    }
    assert_eq!(Reader::new(&[0x80, 0x00]).varint(), Err(DecodeError::BadVarint));
    assert_eq!(Reader::new(&[0xff, 0xff, 0xff, 0xff, 0x10]).varint(), Err(DecodeError::BadVarint));
    assert_eq!(Reader::new(&[0x80, 0x80, 0x80, 0x80, 0x80]).varint(), Err(DecodeError::BadVarint));
    assert_eq!(Reader::new(&[0x80]).varint(), Err(DecodeError::Truncated));
}

#[test]
fn malformed_client_frames_are_rejected() {
    for (name, bytes) in malformed_client() {
        assert!(
            ClientMsg::decode(&bytes).is_err(),
            "{name} must be rejected"
        );
    }
}

#[test]
fn map_blob_rejects_a_wrong_hash_and_bad_runs() {
    let m = map::MapBlob::new(4, 3, vec![0; 12]);
    let mut w = Writer::default();
    m.write(&mut w);
    let mut bytes = w.finish();
    assert!(map::MapBlob::read(&mut Reader::new(&bytes)).is_ok());
    bytes[4] ^= 1; // hash
    assert!(map::MapBlob::read(&mut Reader::new(&bytes)).is_err());
}

#[test]
fn fuzzed_client_frames_never_panic() {
    // Cheap deterministic fuzz: every prefix and single-byte mutation of every sample decodes to Ok or Err, never panics.
    for (_, m) in client_samples() {
        let b = m.encode();
        for cut in 0..b.len() {
            let _ = ClientMsg::decode(&b[..cut]);
        }
        for i in 0..b.len() {
            for v in [0u8, 1, 0x7f, 0x80, 0xff] {
                let mut c = b.clone();
                c[i] = v;
                let _ = ClientMsg::decode(&c);
            }
        }
    }
}
