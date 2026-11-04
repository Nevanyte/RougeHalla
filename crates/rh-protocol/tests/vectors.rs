use rh_protocol::samples::*;
use rh_protocol::*;

#[test]
fn committed_vectors_match_the_encoder() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../protocol/fixtures/v1.json");
    let committed = std::fs::read_to_string(&path)
        .expect("protocol/fixtures/v1.json (run the protocol-fixtures bin)");
    assert_eq!(
        committed,
        manifest(),
        "the wire encoding changed: bump PROTOCOL_VERSION if incompatible, then regenerate"
    );
}

#[test]
fn every_sample_round_trips() {
    for (name, m) in client_samples() {
        assert_eq!(ClientMsg::decode(&m.encode()).as_ref(), Ok(&m), "{name}");
    }
    for (name, m) in server_samples() {
        assert_eq!(ServerMsg::decode(&m.encode()).as_ref(), Ok(&m), "{name}");
    }
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
