//! P-AUG-NATIVE-5 oracle (Rust codec): protocol 20 carries every Marked Man holder's position as the optional State key 15
//! (`StateItem::Marked`): `u8 n (<= 32)`, then per row `varint id (nonzero, strictly ascending), u16 x, u16 y` at the
//! actor position quantization (1/8 u). The bytes are fixed here (brief `docs/backlog/packets/P-AUG-NATIVE-5.md`, "Wire
//! layout"), and the generated `protocol/fixtures/v20.json` must carry them under the names the C# and JS vector checks
//! read (both iterate every server and malformed vector of the file).
use rh_protocol::samples::server_samples;
use rh_protocol::state::{MAX_ROSTER, MAX_STATE_KEYS};
use rh_protocol::{
    DecodeError, ServerMsg, StateItem, WireMarked, MAX_SERVER_FRAME, PROTOCOL_VERSION,
};
use std::path::PathBuf;

/// `state_marked`: holders 2 at (100, 2000.5) and 7 at (0, 8191.875).
const MARKED_HEX: &str = "88dc01010f02022003843e070000ffff";
/// `state_marked_empty`: key 15 with no rows (it clears the client's rows).
const EMPTY_HEX: &str = "88dc01010f00";

fn marked(id: u32, x: f32, y: f32) -> WireMarked {
    WireMarked { id, x, y }
}

fn rows() -> Vec<WireMarked> {
    vec![marked(2, 100., 2000.5), marked(7, 0., 8191.875)]
}

fn frame(rows: Vec<WireMarked>) -> ServerMsg {
    ServerMsg::State {
        tick: 220,
        items: vec![StateItem::Marked(rows)],
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(h: &str) -> Vec<u8> {
    (0..h.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap())
        .collect()
}

fn patched(at: usize, with: u8) -> Vec<u8> {
    let mut b = unhex(MARKED_HEX);
    b[at] = with;
    b
}

#[test]
fn key_15_is_the_newest_state_key_inside_protocol_22() {
    assert_eq!(
        PROTOCOL_VERSION, 22,
        "brief decision 6: no bump (21 and the next free number are promised); v20.json regenerated in place; P-SYNC-ORIGIN-2 carries it as 22"
    );
    assert_eq!(MAX_STATE_KEYS, 15);
    assert_eq!(MAX_ROSTER, 32, "the row bound is the roster's");
    assert_eq!(StateItem::Marked(vec![]).key(), 15);
}

#[test]
fn marked_rows_encode_to_the_specified_bytes_and_round_trip() {
    for (rows, want) in [(rows(), MARKED_HEX), (vec![], EMPTY_HEX)] {
        let msg = frame(rows);
        let bytes = msg
            .try_encode()
            .unwrap_or_else(|e| panic!("{want}: the frame encodes: {e:?}"));
        assert_eq!(hex(&bytes), want, "the bytes");
        assert_eq!(bytes.len(), msg.encoded_len(), "{want}: encoded_len");
        assert_eq!(
            ServerMsg::decode(&bytes).as_ref(),
            Ok(&msg),
            "{want}: round trip"
        );
        for end in 0..bytes.len() {
            assert!(
                ServerMsg::decode(&bytes[..end]).is_err(),
                "{want}: prefix {end} is refused"
            );
        }
    }
    // A position is quantized like an actor's: 1/8 u, half away from zero.
    let msg = frame(vec![marked(3, 10.07, 0.0624)]);
    let bytes = msg.try_encode().expect("an off-grid position encodes");
    let ServerMsg::State { items, .. } = ServerMsg::decode(&bytes).expect("decodes") else {
        panic!("a State")
    };
    assert_eq!(items, vec![StateItem::Marked(vec![marked(3, 10.125, 0.)])]);
}

#[test]
fn key_15_follows_key_14_in_one_state_and_32_rows_fit() {
    let full: Vec<WireMarked> = (1..=MAX_ROSTER as u32)
        .map(|id| marked(id * 1000, 8191.875, 8191.875))
        .collect();
    let msg = ServerMsg::State {
        tick: 1,
        items: vec![StateItem::Readouts(vec![]), StateItem::Marked(full.clone())],
    };
    let bytes = msg.try_encode().expect("32 rows after key 14 encode");
    assert_eq!(bytes.len(), msg.encoded_len());
    assert_eq!(ServerMsg::decode(&bytes).as_ref(), Ok(&msg));
    // The largest State today plus 32 maximal rows still fits a server frame.
    let (_, budget) = server_samples()
        .into_iter()
        .find(|(name, _)| *name == "state_all_max_budget")
        .expect("state_all_max_budget");
    let ServerMsg::State { tick, mut items } = budget else {
        panic!("a State")
    };
    items.push(StateItem::Marked(full));
    let all = ServerMsg::State { tick, items };
    let bytes = all.try_encode().expect("every key at its budget encodes");
    assert!(bytes.len() <= MAX_SERVER_FRAME, "{} bytes", bytes.len());
    assert_eq!(ServerMsg::decode(&bytes).as_ref(), Ok(&all));
}

#[test]
fn the_encoder_refuses_every_invalid_row_atomically() {
    let too_many: Vec<WireMarked> = (1..=MAX_ROSTER as u32 + 1)
        .map(|id| marked(id, 1., 1.))
        .collect();
    let cases: Vec<(&str, Vec<WireMarked>)> = vec![
        ("33 rows", too_many),
        ("id 0", vec![marked(0, 1., 1.)]),
        ("equal ids", vec![marked(4, 1., 1.), marked(4, 2., 2.)]),
        ("descending ids", vec![marked(5, 1., 1.), marked(4, 2., 2.)]),
        ("x NaN", vec![marked(1, f32::NAN, 1.)]),
        ("y negative", vec![marked(1, 1., -0.5)]),
        ("x past the map range", vec![marked(1, 8192., 1.)]),
        ("y infinite", vec![marked(1, 1., f32::INFINITY)]),
    ];
    for (what, rows) in cases {
        let mut out = vec![1, 2, 3];
        assert!(
            frame(rows).encode_into(&mut out).is_err(),
            "{what} is refused"
        );
        assert_eq!(out, [1, 2, 3], "{what}: a refused frame writes nothing");
    }
}

#[test]
fn the_decoder_refuses_each_check_for_its_reason() {
    use DecodeError::BadField;
    let cases: [(&str, Vec<u8>, DecodeError); 3] = [
        ("count 33", unhex("88dc01010f21"), BadField("marked count")),
        ("id 0", patched(6, 0), BadField("marked id")),
        ("order", patched(11, 2), BadField("marked order")),
    ];
    for (what, bytes, want) in cases {
        assert_eq!(ServerMsg::decode(&bytes), Err(want), "{what}");
    }
    // Key 16 is the first unknown key, and 16 items are too many.
    assert_eq!(
        ServerMsg::decode(&[0x88, 0, 1, 16]),
        Err(BadField("state key"))
    );
    assert!(ServerMsg::decode(&[0x88, 0, 16]).is_err());
}

fn fixture_path(version: u16) -> PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../protocol/fixtures")
        .join(format!("v{version}.json"))
}

/// The hex of the first vector called `name` (the names read here are unique in the file).
fn named<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("{{\"name\": \"{name}\", \"hex\": \"");
    let line = text
        .lines()
        .map(str::trim_start)
        .find(|l| l.starts_with(&key))?;
    let hex = &line[key.len()..];
    Some(&hex[..hex.find('"').expect("closing quote")])
}

#[test]
fn v22_fixture_carries_the_marked_vectors_and_the_moved_malformed_ones() {
    // P-SYNC-ORIGIN-2: the local v20 vectors were never deployed; they live in v22.json (v20.json is origin's).
    let text = std::fs::read_to_string(fixture_path(22))
        .expect("protocol/fixtures/v22.json (cargo run -p rh-protocol --bin protocol-fixtures)");
    assert_eq!(named(&text, "state_marked"), Some(MARKED_HEX));
    assert_eq!(named(&text, "state_marked_empty"), Some(EMPTY_HEX));
    for (name, want) in [
        ("state_marked_count_33", "88dc01010f21"),
        ("state_marked_id_0", "88dc01010f02002003843e070000ffff"),
        ("state_marked_order", "88dc01010f02022003843e020000ffff"),
    ] {
        assert_eq!(named(&text, name), Some(want), "malformedServer {name}");
        assert!(
            ServerMsg::decode(&unhex(want)).is_err(),
            "{name} is refused"
        );
    }
    assert_eq!(
        named(&text, "state_unknown_key"),
        Some("88000110"),
        "key 15 is known now: the unknown key is 16"
    );
    assert_eq!(
        named(&text, "state_too_many_keys"),
        Some("880010"),
        "15 keys are allowed now: 16 are too many"
    );
}
