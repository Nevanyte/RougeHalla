//! P-WIRE19-A oracle (Rust codec): protocol 19 carries native card ids (80..=93, `CardId::NATIVE`) in a reward option
//! and the killer first-pick window as one trailing field of a reward chest row (`first_pick: Option<{ until, mine }>`,
//! after `can_choose`). The bytes are fixed here (brief `docs/backlog/packets/P-WIRE19-A.md`, "Wire layout"), and the
//! generated `protocol/fixtures/v19.json` must carry them under the names the C# and JS oracles read.
use rh_protocol::{
    DecodeError, RewardChestHandle, ServerMsg, StateItem, WireFirstPick, WireRewardChest,
    WireRewardId, WireRewardOption, PROTOCOL_VERSION,
};
use std::path::PathBuf;

/// `state_reward_first_pick_other`: the window as a viewer who is not the killer sees it (row A), beside a row without
/// one (row B).
const OTHER_HEX: &str = "88dc01010402052003c003000000000082d44003015d0000015000000202000000000100000000007cc54000066400c80000000000004ccd4001014f010104000000";
/// `state_reward_first_pick_killer`: the same rows as the killer sees them (row A: `can_choose` and `mine` true).
const KILLER_HEX: &str = "88dc01010402052003c003000000000082d44003015d0000015000000202000000010100000000007cc54001066400c80000000000004ccd4001014f010104000000";

fn option(id: WireRewardId) -> WireRewardOption {
    WireRewardOption {
        id,
        taken: false,
        taken_by: None,
    }
}

/// Row A: Marked Man (93), Marksman's Tally (80) and a boost, under a window ending at 11000 that is `mine` or not.
fn row_a(mine: bool) -> WireRewardChest {
    WireRewardChest {
        handle: RewardChestHandle::new(5).unwrap(),
        x: 800,
        y: 960,
        expires_at: 21000.,
        options: vec![
            option(WireRewardId::Card(93)),
            option(WireRewardId::Card(80)),
            option(WireRewardId::Boost(2)),
        ],
        picked: false,
        can_choose: mine,
        first_pick: Some(WireFirstPick {
            until: 11000.,
            mine,
        }),
    }
}

/// Row B: the last catalog card, taken by player 4, no window.
fn row_b() -> WireRewardChest {
    WireRewardChest {
        handle: RewardChestHandle::new(6).unwrap(),
        x: 100,
        y: 200,
        expires_at: 15000.,
        options: vec![WireRewardOption {
            id: WireRewardId::Card(79),
            taken: true,
            taken_by: Some(4),
        }],
        picked: false,
        can_choose: false,
        first_pick: None,
    }
}

fn frame(rows: Vec<WireRewardChest>) -> ServerMsg {
    ServerMsg::State {
        tick: 220,
        items: vec![StateItem::RewardChests(rows)],
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

#[test]
fn protocol_version_is_22() {
    // P-SYNC-ORIGIN-1 carries these bytes as protocol 20 (the local 19 was never deployed); P-SYNC-ORIGIN-2 as 22.
    assert_eq!(PROTOCOL_VERSION, 22);
}

#[test]
fn a_native_card_option_and_a_first_pick_window_encode_to_the_specified_bytes() {
    for (mine, want) in [(false, OTHER_HEX), (true, KILLER_HEX)] {
        let msg = frame(vec![row_a(mine), row_b()]);
        let bytes = msg
            .try_encode()
            .unwrap_or_else(|e| panic!("mine={mine}: the frame encodes: {e:?}"));
        assert_eq!(hex(&bytes), want, "mine={mine}: the bytes");
        assert_eq!(bytes.len(), msg.encoded_len(), "mine={mine}: encoded_len");
        assert_eq!(
            ServerMsg::decode(&bytes).unwrap(),
            msg,
            "mine={mine}: round trip"
        );
        for end in 0..bytes.len() {
            assert!(
                ServerMsg::decode(&bytes[..end]).is_err(),
                "mine={mine}: prefix {end} is refused"
            );
        }
    }
}

#[test]
fn card_ids_run_to_93_and_94_is_refused_atomically() {
    for id in [0u8, 79, 80, 93] {
        let mut row = row_b();
        row.options[0].id = WireRewardId::Card(id);
        let msg = frame(vec![row]);
        let bytes = msg
            .try_encode()
            .unwrap_or_else(|e| panic!("card {id} encodes: {e:?}"));
        assert_eq!(ServerMsg::decode(&bytes).unwrap(), msg, "card {id}");
    }
    let mut row = row_b();
    row.options[0].id = WireRewardId::Card(94);
    let mut out = vec![1, 2, 3];
    assert!(
        frame(vec![row]).encode_into(&mut out).is_err(),
        "card 94 is past the native ids"
    );
    assert_eq!(out, [1, 2, 3], "a refused frame writes nothing");
    let mut bytes = unhex(OTHER_HEX);
    let at = bytes
        .windows(4)
        .position(|w| w == [1, 93, 0, 0])
        .expect("Marked Man's option");
    bytes[at + 1] = 94;
    assert_eq!(
        ServerMsg::decode(&bytes),
        Err(DecodeError::BadField("reward id"))
    );
}

#[test]
fn a_window_must_be_finite_and_end_by_the_chests_expiry() {
    let encode = |until: f64| {
        let mut row = row_a(false);
        row.first_pick = Some(WireFirstPick { until, mine: false });
        frame(vec![row]).try_encode()
    };
    assert!(encode(21000.).is_ok(), "a window may end with the chest");
    for until in [21000.5, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(encode(until).is_err(), "until {until} is refused");
    }
    // The decoder refuses the same rows, and a tag or flag byte that is not 0 or 1.
    let other = unhex(OTHER_HEX);
    // Header (tag, tick 2, item count, key, row count), then row A: handle, x, y, expiry, n, three options, picked and
    // can_choose.
    let until_at = 6 + 1 + 2 + 2 + 8 + 1 + 3 * 4 + 2;
    assert_eq!(other[until_at], 1, "the window's tag");
    let patch = |at: usize, with: &[u8]| {
        let mut b = other.clone();
        b[at..at + with.len()].copy_from_slice(with);
        ServerMsg::decode(&b)
    };
    assert_eq!(patch(until_at, &[2]), Err(DecodeError::BadTag(2)), "tag 2");
    assert_eq!(
        patch(until_at + 9, &[2]),
        Err(DecodeError::BadField("flag")),
        "mine 2"
    );
    assert_eq!(
        patch(until_at + 1, &f64::NAN.to_le_bytes()),
        Err(DecodeError::BadField("reward chest")),
        "until NaN"
    );
    assert_eq!(
        patch(until_at + 1, &21000.5f64.to_le_bytes()),
        Err(DecodeError::BadField("reward chest")),
        "until after the expiry"
    );
}

fn fixture_path(version: u16) -> PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../protocol/fixtures")
        .join(format!("v{version}.json"))
}

fn fixture(version: u16) -> String {
    let path = fixture_path(version);
    assert!(
        path.exists(),
        "protocol/fixtures/v{version}.json is missing (cargo run -p rh-protocol --bin protocol-fixtures)"
    );
    std::fs::read_to_string(&path).unwrap()
}

/// The hex of the first vector called `name` (client vectors come first, then server, then malformed; the names read
/// here are unique in the file).
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
fn v22_fixture_carries_the_new_vectors_and_its_hello_and_welcome_say_22() {
    // P-SYNC-ORIGIN-1: these vectors live in v20.json (v19.json is origin's protocol 19); P-SYNC-ORIGIN-2: in v22.json
    // (v20.json and v21.json are origin's).
    let v19 = fixture(22);
    assert!(
        v19.contains("\n  \"protocol\": 22,\n"),
        "the v22 header names protocol 22"
    );
    let hello = unhex(named(&v19, "hello").expect("a hello vector"));
    assert_eq!(rh_protocol::ClientMsg::hello_protocol(&hello), Some(22));
    match ServerMsg::decode(&unhex(named(&v19, "welcome").expect("a welcome vector"))) {
        Ok(ServerMsg::Welcome { protocol, .. }) => assert_eq!(protocol, 22),
        other => panic!("the welcome vector decodes to a Welcome: {other:?}"),
    }
    assert_eq!(
        named(&v19, "state_reward_first_pick_other"),
        Some(OTHER_HEX)
    );
    assert_eq!(
        named(&v19, "state_reward_first_pick_killer"),
        Some(KILLER_HEX)
    );
    for name in [
        "state_reward_card_id_94",
        "state_reward_first_pick_tag_2",
        "state_reward_first_pick_mine_2",
        "state_reward_first_pick_nonfinite",
        "state_reward_first_pick_after_expiry",
    ] {
        let bytes =
            unhex(named(&v19, name).unwrap_or_else(|| panic!("malformedServer has {name}")));
        assert!(ServerMsg::decode(&bytes).is_err(), "{name} is refused");
    }
    assert!(
        named(&v19, "state_reward_card_id_80").is_none(),
        "card 80 is a native id now, not a malformed one"
    );
}
