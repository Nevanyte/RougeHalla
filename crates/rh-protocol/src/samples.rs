//! The golden vectors: deterministic sample messages, and frames that must be rejected. `protocol/fixtures/v1.json` is
//! generated from these (`cargo run -p rh-protocol --bin protocol-fixtures`) and read by the Rust and C# tests.

use crate::map::MapBlob;
use crate::*;

// The aim of -3.1415927 is deliberate: an f32 at the -PI edge of the angle range.
#[allow(clippy::approx_constant)]
pub fn client_samples() -> Vec<(&'static str, ClientMsg)> {
    vec![
        (
            "hello",
            ClientMsg::Hello {
                protocol: PROTOCOL_VERSION,
                content_hash: 0x1122_3344_5566_7788,
                build: "web-0.1.0".into(),
                profile: "Nevan_01".into(),
                token: "tok-abc".into(),
                faction: Some(4),
                resume: None,
            },
        ),
        (
            "hello_resume",
            ClientMsg::Hello {
                protocol: PROTOCOL_VERSION,
                content_hash: 7,
                build: "".into(),
                profile: "Ünïcode".into(),
                token: "".into(),
                faction: None,
                resume: Some([9; 16]),
            },
        ),
        (
            "input_all_commands",
            ClientMsg::Input {
                seq: 42,
                commands: vec![
                    WireCommand::Move { x: 1234.5, y: -0.25, seq: Some(7) },
                    WireCommand::Stop { seq: None },
                    WireCommand::Aim { a: -3.1415927 },
                    WireCommand::Attack { a: 0.5, t: Some(12345.75) },
                    WireCommand::Release { a: 0.5, t: None },
                ],
            },
        ),
        ("ping", ClientMsg::Ping { nonce: 0xdead_beef, client_ms: 1.5 }),
        ("leave", ClientMsg::Leave),
    ]
}

pub fn server_samples() -> Vec<(&'static str, ServerMsg)> {
    let tiles: Vec<u8> = (0..12).map(|i| if i < 4 || i % 4 == 0 { 1 } else if i == 6 { 2 } else { 0 }).collect();
    vec![
        (
            "welcome",
            ServerMsg::Welcome {
                protocol: PROTOCOL_VERSION,
                content_hash: 0x0102_0304_0506_0708,
                match_id: [1; 16],
                player_id: 3,
                session: [2; 16],
                tick_rate: 20,
                tick: 100,
                server_ms: 5000.0,
                map: MapBlob::new(4, 3, tiles),
            },
        ),
        ("reject", ServerMsg::Reject { code: RejectCode::ProtocolMismatch, reason: "client protocol 2, server 1".into() }),
        (
            "snapshot",
            ServerMsg::Snapshot {
                tick: 101,
                server_ms: 5050.0,
                phase: 1,
                ack_input: 42,
                me: Some(WireSelf { id: 3, faction: 4, x: 400.0, y: 320.5, facing: 1.5, hp: 1000.25, max_hp: 1145.0, status: 1, weapon: 5, ready_in_ms: 250, kills: 2, bounty: 0, gv: 20, move_seq: 7 }),
                actors: vec![WireActor { id: 1, faction: 0, x: 456.0, y: 320.0, facing: -1.0, hp_pct: 87, status: 1, weapon: 5, bounty: 28 }],
            },
        ),
        ("snapshot_spectator", ServerMsg::Snapshot { tick: 1, server_ms: 50.0, phase: 0, ack_input: 0, me: None, actors: vec![] }),
        (
            "events",
            ServerMsg::Events {
                tick: 281,
                events: vec![
                    WireEvent::Death { id: 1, by: Some(2) },
                    WireEvent::Bounty { id: 2, bounty: 28 },
                    WireEvent::MatchEnded { winner: Some(2), draw: false },
                    WireEvent::Result(WireResult { outcome: 0, place: 1, players: 2, kills: 1, killed_by: None, gv_total: 10, gv_win: 0, duration_sec: 14, win_bonus_withheld: true }),
                    WireEvent::Result(WireResult { outcome: 2, place: 2, players: 2, kills: 0, killed_by: Some("P1".into()), gv_total: 0, gv_win: 0, duration_sec: 14, win_bonus_withheld: false }),
                ],
            },
        ),
        (
            "fx",
            ServerMsg::Fx { tick: 3, fx: vec![WireFx::Swing { by: 1, weapon: 5, x: 400.0, y: 320.0, a: 0.0 }, WireFx::Hit { victim: 2, by: 1, amount: 17.690966 }] },
        ),
        ("pong", ServerMsg::Pong { nonce: 0xdead_beef, client_ms: 1.5, server_ms: 5051.25 }),
    ]
}

/// Client frames the server must reject, with the reason.
pub fn malformed_client() -> Vec<(&'static str, Vec<u8>)> {
    let input = ClientMsg::Input { seq: 1, commands: vec![WireCommand::Aim { a: 0.0 }] }.encode();
    let mut nan = input.clone();
    let n = nan.len();
    nan[n - 4..].copy_from_slice(&f32::NAN.to_le_bytes());
    let mut trailing = input.clone();
    trailing.push(0);
    let truncated = input[..input.len() - 1].to_vec();
    let mut too_many = vec![0x02, 1, 0, 0, 0];
    too_many.extend_from_slice(&(17u16).to_le_bytes());
    for _ in 0..17 {
        too_many.extend_from_slice(&[3, 0, 0, 0, 0]);
    }
    let mut bad_utf8 = vec![0x01, 1, 0];
    bad_utf8.extend_from_slice(&[0; 8]);
    bad_utf8.extend_from_slice(&[2, 0xff, 0xfe]);
    vec![
        ("empty", vec![]),
        ("unknown_tag", vec![0x7f]),
        ("server_tag_from_client", vec![0x81]),
        ("nan_angle", nan),
        ("trailing_byte", trailing),
        ("truncated", truncated),
        ("too_many_commands", too_many),
        ("bad_utf8", bad_utf8),
        ("oversize", vec![0x03; MAX_CLIENT_FRAME + 1]),
        ("bad_option_flag", vec![0x02, 1, 0, 0, 0, 1, 0, 2, 2]),
    ]
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// The manifest JSON (hand-written to keep this crate dependency-free; field names are the C# test's contract).
pub fn manifest() -> String {
    let mut out = String::from("{\n  \"format\": \"rh-protocol-vectors/1\",\n  \"protocol\": ");
    out.push_str(&PROTOCOL_VERSION.to_string());
    out.push_str(",\n  \"client\": [\n");
    let c = client_samples();
    for (i, (name, m)) in c.iter().enumerate() {
        out.push_str(&format!("    {{\"name\": \"{name}\", \"hex\": \"{}\", \"debug\": \"{}\"}}{}\n", hex(&m.encode()), escape(&format!("{m:?}")), if i + 1 < c.len() { "," } else { "" }));
    }
    out.push_str("  ],\n  \"server\": [\n");
    let s = server_samples();
    for (i, (name, m)) in s.iter().enumerate() {
        out.push_str(&format!("    {{\"name\": \"{name}\", \"hex\": \"{}\", \"debug\": \"{}\"}}{}\n", hex(&m.encode()), escape(&format!("{m:?}")), if i + 1 < s.len() { "," } else { "" }));
    }
    out.push_str("  ],\n  \"malformedClient\": [\n");
    let b = malformed_client();
    for (i, (name, bytes)) in b.iter().enumerate() {
        out.push_str(&format!("    {{\"name\": \"{name}\", \"hex\": \"{}\"}}{}\n", hex(bytes), if i + 1 < b.len() { "," } else { "" }));
    }
    out.push_str("  ]\n}\n");
    out
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
