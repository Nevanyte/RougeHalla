//! P-TICK-3 oracle (ADR 0029, protocol 21): a snapshot's server time is `tick * tick_ms` with `tick_ms = 1000 /
//! Welcome.tick_rate`; only 20 Hz (50 ms) and 40 Hz (25 ms) are accepted, so a Welcome at 30 is refused. The rate is a
//! property of the connection, not of the frame: the same snapshot bytes stand for `tick * 50` at 20 and `tick * 25` at
//! 40, and a source-time override equal to the default AT THE CONNECTION'S RATE is refused (the encoder would have
//! omitted it). A tracker that waits for its Welcome refuses a snapshot that arrives first (it has no rate). At 20 Hz
//! every v21 vector is the v20 vector with the version substituted; the 40 Hz vectors are a section of their own.
//!
//! The same facts are held in C# (`client-unity/RoguehallaNet.Tests/TickRateProtocolTests.cs`) and JS
//! (`tools/protocol-js/check-tick-rate.mjs`).
use rh_protocol::samples::server_samples;
use rh_protocol::*;
use std::path::PathBuf;

/// Byte offset of `tick_rate` in a Welcome frame: tag 1 + protocol 2 + content hash 8 + match 16 + player 4 + session 16.
const WELCOME_RATE_AT: usize = 47;

fn snapshot(tick: u32, server_time: f64) -> ServerMsg {
    ServerMsg::Snapshot {
        tick,
        server_time,
        phase: 1,
        ack_input: 3,
        me: None,
        actors: Vec::new(),
        training: false,
        owner_combat: None,
    }
}

fn time_of(msg: &ServerMsg) -> (u32, f64) {
    match msg {
        ServerMsg::Snapshot {
            tick, server_time, ..
        } => (*tick, *server_time),
        ServerMsg::SnapshotDelta(d) => (d.tick, d.server_time),
        other => panic!("a snapshot frame decodes to a snapshot: {other:?}"),
    }
}

/// The sample Welcome's frame (tick rate 20) with its rate byte replaced.
fn welcome_at(rate: u8) -> Vec<u8> {
    let (_, welcome) = server_samples()
        .into_iter()
        .find(|(name, _)| *name == "welcome")
        .expect("the welcome sample");
    let mut frame = welcome.encode();
    assert_eq!(
        frame[WELCOME_RATE_AT], 20,
        "the sample Welcome says tick rate 20 at byte {WELCOME_RATE_AT}"
    );
    frame[WELCOME_RATE_AT] = rate;
    frame
}

/// A Full frame of tick 10 and the Delta of tick 11 against it, both with the default time (no override on the wire).
fn full_and_delta() -> (Vec<u8>, Vec<u8>) {
    let crowd = |tick: u32, shift: f32| {
        let actors: Vec<WireActor> = (1..=12u32)
            .map(|id| WireActor {
                id,
                x: 100.0 + id as f32 * 40.0 + if id == 3 { shift } else { 0.0 },
                y: 200.0 + id as f32 * 16.0,
                hp_pct: 100,
                status: 1,
                ..Default::default()
            })
            .collect();
        SnapshotData::build(tick, 1, tick, None, actors.into_iter()).unwrap()
    };
    let mut enc = ConnEncoder::new();
    let (mut full, mut delta) = (Vec::new(), Vec::new());
    assert_eq!(enc.encode(crowd(10, 0.0), &mut full), FrameKind::Full);
    assert_eq!(enc.encode(crowd(11, 8.0), &mut delta), FrameKind::Delta);
    (full, delta)
}

#[test]
fn the_wire_speaks_protocol_22() {
    assert_eq!(
        PROTOCOL_VERSION, 22,
        "snapshot time read from Welcome.tick_rate is an incompatible wire change: 20 -> 21 (origin); P-SYNC-ORIGIN-2 carries it as 22"
    );
}

#[test]
fn tick_ms_is_1000_over_the_rate_for_20_and_40_only() {
    assert_eq!(tick_ms_for_rate(20), Some(50));
    assert_eq!(tick_ms_for_rate(40), Some(25));
    for rate in [0u8, 1, 10, 25, 30, 50, 60, 80, 120, 255] {
        assert_eq!(tick_ms_for_rate(rate), None, "tick rate {rate} is refused");
    }
    for tick in [0u32, 1, 7, 101, 16_384, 1_000_000, u32::MAX] {
        assert_eq!(
            snapshot_server_ms_at(tick, 50).to_bits(),
            (tick as f64 * 50.0).to_bits()
        );
        assert_eq!(
            snapshot_server_ms_at(tick, 25).to_bits(),
            (tick as f64 * 25.0).to_bits(),
            "tick {tick} at 40 Hz"
        );
        assert_eq!(
            snapshot_server_ms(tick).to_bits(),
            snapshot_server_ms_at(tick, 50).to_bits(),
            "the 20 Hz helper is the 50 ms case"
        );
    }
}

#[test]
fn the_same_full_snapshot_bytes_decode_to_tick_times_50_at_20_and_tick_times_25_at_40() {
    for tick in [1u32, 7, 101, 16_384, 1_000_000] {
        let frame = snapshot(tick, tick as f64 * 50.0).encode();
        let plain = ServerMsg::decode(&frame).expect("decodes");
        assert_eq!(
            ServerMsg::decode_at(&frame, 20).as_ref(),
            Ok(&plain),
            "decode is the 20 Hz decode"
        );
        assert_eq!(time_of(&plain), (tick, tick as f64 * 50.0));
        let at40 = ServerMsg::decode_at(&frame, 40).expect("decodes at 40");
        assert_eq!(
            time_of(&at40),
            (tick, tick as f64 * 25.0),
            "tick {tick} at 40 Hz is tick * 25 ms"
        );
        assert_eq!(
            at40,
            snapshot(tick, tick as f64 * 25.0),
            "only the time depends on the rate"
        );
    }
}

#[test]
fn a_delta_without_override_decodes_to_tick_times_the_rate() {
    let (_, delta) = full_and_delta();
    assert_eq!(
        time_of(&ServerMsg::decode_at(&delta, 20).unwrap()),
        (11, 550.0)
    );
    assert_eq!(
        time_of(&ServerMsg::decode_at(&delta, 40).unwrap()),
        (11, 275.0),
        "a SnapshotDelta of tick 11 at 40 Hz is 275 ms"
    );
}

#[test]
fn an_override_is_kept_at_both_rates_but_one_equal_to_the_rate_default_is_refused() {
    // 888.75 is the default at neither rate: it is on the wire at both and decodes as written.
    let odd = snapshot(20, 888.75).encode();
    assert_eq!(time_of(&ServerMsg::decode_at(&odd, 20).unwrap()).1, 888.75);
    assert_eq!(time_of(&ServerMsg::decode_at(&odd, 40).unwrap()).1, 888.75);
    // 500 is tick 20's default at 40 Hz, an override at 20 Hz. A 40 Hz encoder never writes it, so a 40 Hz decoder refuses it
    // (the bit-pattern comparison reads the connection's rate, ServerMsg.Snapshot.cs's trap in the brief).
    let half = snapshot(20, 500.0).encode();
    assert_eq!(time_of(&ServerMsg::decode_at(&half, 20).unwrap()).1, 500.0);
    assert_eq!(
        ServerMsg::decode_at(&half, 40),
        Err(DecodeError::BadField("server time")),
        "an override equal to tick * 25 is refused at 40 Hz"
    );
}

#[test]
fn a_welcome_at_30_is_refused_and_20_and_40_are_accepted() {
    for rate in [20u8, 40] {
        match ServerMsg::decode(&welcome_at(rate)) {
            Ok(ServerMsg::Welcome { tick_rate, .. }) => assert_eq!(tick_rate, rate),
            other => panic!("a Welcome at {rate} Hz decodes: {other:?}"),
        }
    }
    for rate in [30u8, 0, 60] {
        assert_eq!(
            ServerMsg::decode(&welcome_at(rate)).err(),
            Some(DecodeError::BadField("tick rate")),
            "a Welcome at {rate} Hz is refused"
        );
    }
    let frame = snapshot(7, 350.0).encode();
    assert_eq!(
        ServerMsg::decode_at(&frame, 30),
        Err(DecodeError::BadField("tick rate")),
        "a snapshot cannot be read at 30 Hz"
    );
    // A tracker that refuses the Welcome keeps what it held and its rate.
    let (full, _) = full_and_delta();
    let mut t = SnapshotTracker::new();
    t.decode(&welcome_at(40)).unwrap();
    t.decode(&full).unwrap();
    assert_eq!(
        t.decode(&welcome_at(30)).err(),
        Some(TrackError::Decode(DecodeError::BadField("tick rate")))
    );
    assert_eq!(t.held_tick(), Some(10), "a refused Welcome resets nothing");
    let again = snapshot(12, 0.0).encode(); // 0 is an override at both rates for tick 12
    assert_eq!(time_of(&t.decode(&again).unwrap()), (12, 0.0));
    let plain = snapshot(13, 650.0).encode();
    assert_eq!(
        time_of(&t.decode(&plain).unwrap()),
        (13, 325.0),
        "still at 40 Hz"
    );
}

#[test]
fn a_tracker_reads_snapshots_at_its_latest_welcomes_rate() {
    let (full, delta) = full_and_delta();
    let mut t = SnapshotTracker::new();
    t.decode(&welcome_at(40)).unwrap();
    assert_eq!(time_of(&t.decode(&full).unwrap()), (10, 250.0));
    assert_eq!(
        time_of(&t.decode(&delta).unwrap()),
        (11, 275.0),
        "the delta resolves at 40 Hz"
    );
    assert_eq!(
        time_of(&t.snapshot().unwrap()),
        (11, 275.0),
        "the held snapshot too"
    );
    t.decode(&welcome_at(20)).unwrap();
    assert_eq!(time_of(&t.decode(&full).unwrap()), (10, 500.0));
    assert_eq!(time_of(&t.decode(&delta).unwrap()), (11, 550.0));
    // A plain tracker that never saw a Welcome reads at the legacy 20 Hz (every vNN.json chain and the delta tests start so).
    let mut plain = SnapshotTracker::new();
    assert_eq!(time_of(&plain.decode(&full).unwrap()), (10, 500.0));
}

#[test]
fn a_snapshot_before_the_welcome_is_refused() {
    let (full, delta) = full_and_delta();
    let mut t = SnapshotTracker::awaiting_welcome();
    assert_eq!(
        t.decode(&full).err(),
        Some(TrackError::NoWelcome),
        "a Full frame before a Welcome has no rate"
    );
    assert_eq!(
        t.decode(&delta).err(),
        Some(TrackError::NoWelcome),
        "nor has a delta"
    );
    assert_eq!(t.held_tick(), None, "nothing is held");
    assert_eq!(
        t.decode(&welcome_at(30)).err(),
        Some(TrackError::Decode(DecodeError::BadField("tick rate")))
    );
    assert_eq!(
        t.decode(&full).err(),
        Some(TrackError::NoWelcome),
        "a refused Welcome gives no rate"
    );
    t.decode(&welcome_at(40)).unwrap();
    assert_eq!(time_of(&t.decode(&full).unwrap()), (10, 250.0));
    assert_eq!(time_of(&t.decode(&delta).unwrap()), (11, 275.0));
}

// ---- protocol/fixtures/v21.json -------------------------------------------------------------------------------------

/// The section of v21.json that holds the 40 Hz vectors, one entry per line:
/// `{"name": "...", "hex": "...", "decoded": {... "serverMs": <tick * 25> ...}}`. Every other section is at 20 Hz.
const SECTION_40: &str = "serverTickRate40";

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
    std::fs::read_to_string(&path).expect("readable vectors")
}

/// Splits v21.json into (its lines outside the 40 Hz section, the lines of entries inside it).
fn split_40(text: &str) -> (Vec<String>, Vec<String>) {
    let open = format!("  \"{SECTION_40}\": [");
    let (mut rest, mut inside) = (Vec::new(), Vec::new());
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        if line == open {
            for l in lines.by_ref() {
                if l == "  ]" || l == "  ]," {
                    break;
                }
                inside.push(l.to_owned());
            }
            continue;
        }
        rest.push(line.to_owned());
    }
    (rest, inside)
}

fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let k = format!("\"{key}\": ");
    let at = line.find(&k)? + k.len();
    let v = &line[at..];
    if let Some(s) = v.strip_prefix('"') {
        return Some(&s[..s.find('"')?]);
    }
    let end = v.find([',', '}']).unwrap_or(v.len());
    Some(v[..end].trim())
}

fn unhex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex"))
        .collect()
}

/// Trailing commas move when a section is added or removed; the format tag may be bumped for the new section.
fn normalized(lines: impl IntoIterator<Item = String>) -> Vec<String> {
    lines
        .into_iter()
        .filter(|l| !l.starts_with("  \"format\": "))
        .map(|l| l.strip_suffix(',').map(str::to_owned).unwrap_or(l))
        .collect()
}

/// v19 -> v20 moved exactly these: the header, the version u16 LE after a Hello tag 0x01 or a Welcome tag 0x81, and the
/// debug text (protocol_18_stamp.rs did the same for 17 -> 18).
#[test]
fn v21_at_20_hz_is_v20_with_the_version_substituted() {
    let v20 = fixture(20);
    let v21 = fixture(21);
    let expected: Vec<String> = v20
        .lines()
        .map(|line| {
            if line == "  \"protocol\": 20," {
                "  \"protocol\": 21,".to_owned()
            } else {
                line.replacen("\"hex\": \"011400", "\"hex\": \"011500", 1)
                    .replacen("\"hex\": \"811400", "\"hex\": \"811500", 1)
                    .replace("protocol: 20,", "protocol: 21,")
            }
        })
        .collect();
    assert!(
        expected.iter().any(|l| l.contains("\"hex\": \"811500")),
        "the substitutions apply to v20.json"
    );
    let (rest, _) = split_40(&v21);
    let (want, got) = (normalized(expected), normalized(rest));
    let first_difference = want.iter().zip(&got).position(|(a, b)| a != b);
    assert!(
        want == got,
        "v21.json outside \"{SECTION_40}\" differs from v20.json beyond the protocol version (first differing line \
         {first_difference:?}: {:?} vs {:?}; line counts {} vs {})",
        first_difference.map(|i| &want[i]),
        first_difference.map(|i| &got[i]),
        want.len(),
        got.len()
    );
}

#[test]
fn v21_40_hz_snapshots_decode_to_tick_times_25() {
    let v21 = fixture(21);
    assert!(
        v21.contains("\n  \"protocol\": 21,\n"),
        "the v21 header names protocol 21"
    );
    let (_, entries) = split_40(&v21);
    assert!(
        entries.len() >= 3,
        "v21.json has a \"{SECTION_40}\" section with at least three 40 Hz snapshot vectors, got {}",
        entries.len()
    );
    let mut with_override = 0;
    for line in &entries {
        let name = field(line, "name").expect("a named vector");
        let frame = unhex(field(line, "hex").expect("a hex field"));
        assert_eq!(frame.first(), Some(&0x83), "{name} is a Full snapshot");
        let at40 =
            ServerMsg::decode_at(&frame, 40).unwrap_or_else(|e| panic!("{name} at 40 Hz: {e:?}"));
        let (tick, time) = time_of(&at40);
        let want: f64 = field(line, "serverMs")
            .unwrap_or_else(|| panic!("{name} lists its decoded serverMs"))
            .parse()
            .expect("a number");
        assert_eq!(time.to_bits(), want.to_bits(), "{name}: decoded serverMs");
        let (_, at20) = time_of(&ServerMsg::decode_at(&frame, 20).expect("decodes at 20"));
        if time.to_bits() == (tick as f64 * 25.0).to_bits() {
            // No override on the wire: the same bytes are tick * 50 at 20 Hz.
            assert_eq!(at20, tick as f64 * 50.0, "{name}: no override written");
        } else {
            with_override += 1;
            assert_eq!(
                at20.to_bits(),
                time.to_bits(),
                "{name}: an override reads the same at both rates"
            );
        }
    }
    assert!(
        entries.len() - with_override >= 2,
        "at least two 40 Hz vectors carry the default time tick * 25 (no override)"
    );
}
