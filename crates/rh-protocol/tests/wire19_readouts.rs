//! P-WIRE19-B oracle (Rust codec): protocol 19 carries the viewer's own native readout rows as State key 14
//! (`StateItem::Readouts`): `u8 n (<= 28)`, then per row `u8 card (80..=93), u8 kind (0..=2), f64 value, f64 max`, with
//! `0 <= value <= max`, both finite, and cards in native order. The bytes are fixed here (brief
//! `docs/backlog/packets/P-WIRE19-B.md`, "Wire layout"), and the generated `protocol/fixtures/v19.json` must carry them
//! under the names the C# and JS oracles read.
use rh_protocol::samples::server_samples;
use rh_protocol::state::{
    MAX_READOUTS, MAX_STATE_KEYS, READOUT_KIND_COUNT, READOUT_KIND_COUNTER, READOUT_KIND_MARKS,
    READOUT_KIND_METER,
};
use rh_protocol::{
    DecodeError, ServerMsg, StateItem, WireReadout, MAX_SERVER_FRAME, PROTOCOL_VERSION,
};
use std::path::PathBuf;

/// `state_readouts`: Marksman's Tally (counter), Bastion (meter), Pathfinder (counter and marks), Marked Man (counter 0).
const READOUTS_HEX: &str = "88dc01010e055000b81e85eb51b8be3f333333333333d33f510100000000000044400000000000406f405500cdcccccccccc0c4000000000000038405502000000000000084000000000000034405d000000000000000000000000000000f03f";
/// `state_readouts_empty`: key 14 with no rows (it clears the client's rows).
const EMPTY_HEX: &str = "88dc01010e00";
/// Header: tag, tick (2), item count, key, row count.
const HEADER: usize = 6;
/// Bytes a row: card, kind, value f64, max f64.
const ROW: usize = 18;

fn row(card: u8, kind: u8, value: f64, max: f64) -> WireReadout {
    WireReadout {
        card,
        kind,
        value,
        max,
    }
}

fn rows() -> Vec<WireReadout> {
    vec![
        row(80, READOUT_KIND_COUNTER, 0.12, 0.3),
        row(81, READOUT_KIND_METER, 40., 250.),
        row(85, READOUT_KIND_COUNTER, 3.6, 24.),
        row(85, READOUT_KIND_MARKS, 3., 20.),
        row(93, READOUT_KIND_COUNTER, 0., 1.),
    ]
}

fn frame(rows: Vec<WireReadout>) -> ServerMsg {
    ServerMsg::State {
        tick: 220,
        items: vec![StateItem::Readouts(rows)],
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

/// `state_readouts` with `with` written at row `r`, byte `at` of the row.
fn patched(r: usize, at: usize, with: &[u8]) -> Vec<u8> {
    let mut b = unhex(READOUTS_HEX);
    let start = HEADER + ROW * r + at;
    b[start..start + with.len()].copy_from_slice(with);
    b
}

#[test]
fn key_14_is_the_newest_state_key_inside_protocol_22() {
    assert_eq!(
        PROTOCOL_VERSION, 22,
        "decision 1: no bump, v19.json regenerated in place; P-SYNC-ORIGIN-1 carries it as protocol 20, P-SYNC-ORIGIN-2 as 22 (v22.json)"
    );
    // P-AUG-NATIVE-5 (oracle-amend): key 15, the Marked Man rows, follows key 14.
    assert_eq!(MAX_STATE_KEYS, 15);
    assert_eq!(MAX_READOUTS, 28);
    assert_eq!(
        (
            READOUT_KIND_COUNTER,
            READOUT_KIND_METER,
            READOUT_KIND_MARKS,
            READOUT_KIND_COUNT
        ),
        (0, 1, 2, 3)
    );
    assert_eq!(StateItem::Readouts(vec![]).key(), 14);
}

#[test]
fn readout_rows_encode_to_the_specified_bytes_and_round_trip() {
    for (rows, want) in [(rows(), READOUTS_HEX), (vec![], EMPTY_HEX)] {
        let msg = frame(rows);
        let bytes = msg
            .try_encode()
            .unwrap_or_else(|e| panic!("{want}: the frame encodes: {e:?}"));
        assert_eq!(hex(&bytes), want, "the bytes");
        assert_eq!(bytes.len(), msg.encoded_len(), "{want}: encoded_len");
        assert_eq!(
            ServerMsg::decode(&bytes).unwrap(),
            msg,
            "{want}: round trip"
        );
        for end in 0..bytes.len() {
            assert!(
                ServerMsg::decode(&bytes[..end]).is_err(),
                "{want}: prefix {end} is refused"
            );
        }
    }
}

#[test]
fn key_14_follows_key_13_in_one_state_and_28_rows_fit() {
    let full: Vec<WireReadout> = (0..MAX_READOUTS)
        .map(|i| row(80 + (i / 2) as u8, (i % 3) as u8, f64::MAX, f64::MAX))
        .collect();
    let msg = ServerMsg::State {
        tick: 1,
        items: vec![StateItem::BuildSummary(None), StateItem::Readouts(full)],
    };
    let bytes = msg.try_encode().expect("28 rows after key 13 encode");
    assert_eq!(bytes.len(), msg.encoded_len());
    assert_eq!(ServerMsg::decode(&bytes).unwrap(), msg);
    // The largest State today plus 28 maximal rows still fits a server frame (the vector itself stays as it is).
    let (_, budget) = server_samples()
        .into_iter()
        .find(|(name, _)| *name == "state_all_max_budget")
        .expect("state_all_max_budget");
    let ServerMsg::State { tick, mut items } = budget else {
        panic!("a State")
    };
    items.push(StateItem::Readouts(
        (0..MAX_READOUTS)
            .map(|i| row(80 + (i / 2) as u8, 0, f64::MAX, f64::MAX))
            .collect(),
    ));
    let all = ServerMsg::State { tick, items };
    let bytes = all.try_encode().expect("every key at its budget encodes");
    assert!(bytes.len() <= MAX_SERVER_FRAME, "{} bytes", bytes.len());
    assert_eq!(ServerMsg::decode(&bytes).unwrap(), all);
}

#[test]
fn the_encoder_refuses_every_invalid_row_atomically() {
    let mut too_many = rows();
    while too_many.len() <= MAX_READOUTS {
        too_many.push(row(93, 0, 0., 1.));
    }
    let cases: Vec<(&str, Vec<WireReadout>)> = vec![
        ("29 rows", too_many),
        ("catalog card 79", vec![row(79, 0, 0., 1.)]),
        ("card 94", vec![row(94, 0, 0., 1.)]),
        ("card 0", vec![row(0, 0, 0., 1.)]),
        ("kind 3", vec![row(80, 3, 0., 1.)]),
        ("value NaN", vec![row(80, 0, f64::NAN, 1.)]),
        ("value -inf", vec![row(80, 0, f64::NEG_INFINITY, 1.)]),
        ("max +inf", vec![row(80, 0, 0., f64::INFINITY)]),
        ("max NaN", vec![row(80, 0, 0., f64::NAN)]),
        ("value negative", vec![row(80, 0, -0.5, 1.)]),
        ("value over max", vec![row(80, 0, 1.5, 1.)]),
        ("order", vec![row(81, 0, 0., 1.), row(80, 0, 0., 1.)]),
    ];
    for (what, rows) in cases {
        let mut out = vec![1, 2, 3];
        assert!(
            frame(rows).encode_into(&mut out).is_err(),
            "{what} is refused"
        );
        assert_eq!(out, [1, 2, 3], "{what}: a refused frame writes nothing");
    }
    // The boundary rows encode: value equal to max, value 0, two rows of one card, first and last native ids.
    for ok in [
        vec![row(80, 2, 20., 20.)],
        vec![row(93, 0, 0., 0.)],
        vec![row(85, 0, 1., 2.), row(85, 2, 1., 2.)],
    ] {
        frame(ok.clone())
            .try_encode()
            .unwrap_or_else(|e| panic!("{ok:?} encodes: {e:?}"));
    }
}

#[test]
fn the_decoder_refuses_each_check_for_its_reason() {
    use DecodeError::BadField;
    let cases: [(&str, Vec<u8>, DecodeError); 9] = [
        ("count 29", unhex("88dc01010e1d"), BadField("readout count")),
        ("card 79", patched(0, 0, &[79]), BadField("readout card")),
        ("card 94", patched(4, 0, &[94]), BadField("readout card")),
        ("kind 3", patched(1, 1, &[3]), BadField("readout kind")),
        (
            "value NaN",
            patched(0, 2, &f64::NAN.to_le_bytes()),
            BadField("readout value"),
        ),
        (
            "value negative",
            patched(0, 2, &(-0.5f64).to_le_bytes()),
            BadField("readout value"),
        ),
        (
            "value over max",
            patched(1, 2, &250.5f64.to_le_bytes()),
            BadField("readout value"),
        ),
        (
            "max infinite",
            patched(1, 10, &f64::INFINITY.to_le_bytes()),
            BadField("readout value"),
        ),
        ("order", patched(2, 0, &[80]), BadField("readout order")),
    ];
    for (what, bytes, want) in cases {
        assert_eq!(ServerMsg::decode(&bytes), Err(want), "{what}");
    }
    // P-AUG-NATIVE-5 (oracle-amend): key 16 is the first unknown key, and 16 items are too many.
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
fn v22_fixture_carries_the_readout_vectors_and_the_moved_malformed_ones() {
    let path = fixture_path(22);
    let v19 = std::fs::read_to_string(&path)
        .expect("protocol/fixtures/v22.json (cargo run -p rh-protocol --bin protocol-fixtures)");
    assert!(
        v19.contains("\n  \"protocol\": 22,\n"),
        "protocol 20 (P-SYNC-ORIGIN-1), 22 (P-SYNC-ORIGIN-2)"
    );
    assert_eq!(named(&v19, "state_readouts"), Some(READOUTS_HEX));
    assert_eq!(named(&v19, "state_readouts_empty"), Some(EMPTY_HEX));
    for name in [
        "state_readouts_count_29",
        "state_readouts_card_79",
        "state_readouts_card_94",
        "state_readouts_kind_3",
        "state_readouts_value_nan",
        "state_readouts_value_negative",
        "state_readouts_value_over_max",
        "state_readouts_max_infinite",
        "state_readouts_order",
    ] {
        let bytes =
            unhex(named(&v19, name).unwrap_or_else(|| panic!("malformedServer has {name}")));
        assert!(ServerMsg::decode(&bytes).is_err(), "{name} is refused");
    }
    assert_eq!(
        named(&v19, "state_unknown_key"),
        Some("88000110"),
        "P-AUG-NATIVE-5 (oracle-amend): keys 14 and 15 are known now: the unknown key is 16"
    );
    assert_eq!(
        named(&v19, "state_too_many_keys"),
        Some("880010"),
        "P-AUG-NATIVE-5 (oracle-amend): 15 keys are allowed now: 16 are too many"
    );
}
