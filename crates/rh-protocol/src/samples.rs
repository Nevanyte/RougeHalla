//! The golden vectors: deterministic sample messages, and frames that must be rejected. `protocol/fixtures/v2.json` is
//! generated from these (`cargo run -p rh-protocol --bin protocol-fixtures`) and read by the Rust, C# and JS tests. A
//! Snapshot or Fx vector also carries what a client must DECODE (floats as their exact bit patterns), so the three decoders are
//! held to the same quantization, not just to the same bytes.

use crate::map::MapBlob;
use crate::*;
use crate::{AM_BOUNTY, AM_HP};

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
                    WireCommand::Move {
                        x: 1234.5,
                        y: -0.25,
                        seq: Some(7),
                    },
                    WireCommand::Stop { seq: None },
                    WireCommand::Aim { a: -3.1415927 },
                    WireCommand::Attack {
                        a: 0.5,
                        t: Some(12345.75),
                    },
                    WireCommand::Release { a: 0.5, t: None },
                ],
            },
        ),
        (
            "ping",
            ClientMsg::Ping {
                nonce: 0xdead_beef,
                client_ms: 1.5,
            },
        ),
        ("leave", ClientMsg::Leave),
    ]
}

#[allow(clippy::approx_constant)]
pub fn server_samples() -> Vec<(&'static str, ServerMsg)> {
    let tiles: Vec<u8> = (0..12)
        .map(|i| {
            if i < 4 || i % 4 == 0 {
                1
            } else if i == 6 {
                2
            } else {
                0
            }
        })
        .collect();
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
        (
            "reject",
            ServerMsg::Reject {
                code: RejectCode::ProtocolMismatch,
                reason: "client protocol 1, server 2".into(),
            },
        ),
        (
            "snapshot",
            ServerMsg::Snapshot {
                tick: 101,
                phase: 1,
                ack_input: 42,
                me: Some(WireSelf {
                    id: 3,
                    faction: 4,
                    x: 400.0,
                    y: 320.5,
                    facing: 1.5,
                    hp: 1000.25,
                    max_hp: 1145.0,
                    status: 1,
                    weapon: 5,
                    ready_in_ms: 250,
                    kills: 2,
                    bounty: 0,
                    gv: 20,
                    move_seq: 7,
                }),
                actors: vec![WireActor {
                    id: 1,
                    faction: 0,
                    x: 456.0,
                    y: 320.0,
                    facing: -1.0,
                    hp_pct: 87,
                    status: 1,
                    weapon: 5,
                    bounty: 28,
                }],
            },
        ),
        (
            "snapshot_spectator",
            ServerMsg::Snapshot {
                tick: 1,
                phase: 0,
                ack_input: 0,
                me: None,
                actors: vec![],
            },
        ),
        // Every default: the self and the actor omit all their optional fields.
        (
            "snapshot_defaults",
            ServerMsg::Snapshot {
                tick: 127,
                phase: 1,
                ack_input: 128,
                me: Some(WireSelf {
                    id: 1,
                    faction: 0,
                    x: 160.0,
                    y: 96.0,
                    facing: 0.0,
                    hp: 1145.0,
                    max_hp: 1145.0,
                    status: 1,
                    weapon: 0,
                    ready_in_ms: 0,
                    kills: 0,
                    bounty: 0,
                    gv: 0,
                    move_seq: 0,
                }),
                actors: vec![WireActor {
                    id: 2,
                    faction: 0,
                    x: 0.0,
                    y: 0.0,
                    facing: 0.0,
                    hp_pct: 100,
                    status: 1,
                    weapon: 0,
                    bounty: 0,
                }],
            },
        ),
        // Every field set, multi-byte varints everywhere, off-grid and edge positions and angles (a tie rounds away from
        // zero, the facing of +pi wraps to -pi, a position past the range saturates, a negative one clamps to 0).
        (
            "snapshot_full",
            ServerMsg::Snapshot {
                tick: 1_000_000,
                phase: 2,
                ack_input: 300,
                me: Some(WireSelf {
                    id: 300,
                    faction: 3,
                    x: 5119.875,
                    y: 0.1,
                    facing: -3.1415927,
                    hp: -0.0,
                    max_hp: 1145.5,
                    status: 2,
                    weapon: 1,
                    ready_in_ms: 65535,
                    kills: 200,
                    bounty: 65535,
                    gv: 16384,
                    move_seq: 255,
                }),
                actors: vec![
                    WireActor {
                        id: 2,
                        faction: 1,
                        x: 0.0625,
                        y: 5120.0,
                        facing: 3.1415927,
                        hp_pct: 0,
                        status: 2,
                        weapon: 5,
                        bounty: 127,
                    },
                    WireActor {
                        id: 128,
                        faction: 4,
                        x: 1234.5678,
                        y: 9000.0,
                        facing: 0.7853982,
                        hp_pct: 100,
                        status: 3,
                        weapon: 0,
                        bounty: 128,
                    },
                    WireActor {
                        id: 70_000,
                        faction: 0,
                        x: -3.0,
                        y: 8191.875,
                        facing: -1.0,
                        hp_pct: 33,
                        status: 1,
                        weapon: 2,
                        bounty: 65535,
                    },
                    WireActor {
                        id: u32::MAX,
                        faction: 0,
                        x: 2559.9375,
                        y: 77.7,
                        facing: 6.2831855,
                        hp_pct: 99,
                        status: 1,
                        weapon: 0,
                        bounty: 0,
                    },
                ],
            },
        ),
        // A zero max_hp (a varint 0) and a hp of -0.0 (bits preserved: the hp bit is set, as the bit patterns differ).
        (
            "snapshot_zero_hp",
            ServerMsg::Snapshot {
                tick: 16384,
                phase: 3,
                ack_input: 16383,
                me: Some(WireSelf {
                    id: 8,
                    faction: 15,
                    x: 0.0,
                    y: 8191.875,
                    facing: 3.0,
                    hp: -0.0,
                    max_hp: 0.0,
                    status: 3,
                    weapon: 15,
                    ready_in_ms: 1,
                    kills: 1,
                    bounty: 1,
                    gv: 1,
                    move_seq: 1,
                }),
                actors: vec![],
            },
        ),
        (
            "events",
            ServerMsg::Events {
                tick: 281,
                events: vec![
                    WireEvent::Death { id: 1, by: Some(2) },
                    WireEvent::Bounty { id: 2, bounty: 28 },
                    WireEvent::MatchEnded {
                        winner: Some(2),
                        draw: false,
                    },
                    WireEvent::Result(WireResult {
                        outcome: 0,
                        place: 1,
                        players: 2,
                        kills: 1,
                        killed_by: None,
                        gv_total: 10,
                        gv_win: 0,
                        duration_sec: 14,
                        win_bonus_withheld: true,
                    }),
                    WireEvent::Result(WireResult {
                        outcome: 2,
                        place: 2,
                        players: 2,
                        kills: 0,
                        killed_by: Some("P1".into()),
                        gv_total: 0,
                        gv_win: 0,
                        duration_sec: 14,
                        win_bonus_withheld: false,
                    }),
                ],
            },
        ),
        (
            "fx",
            ServerMsg::Fx {
                tick: 3,
                fx: vec![
                    WireFx::Swing {
                        by: 1,
                        weapon: 5,
                        x: 400.0,
                        y: 320.0,
                        a: 0.0,
                    },
                    WireFx::Hit {
                        victim: 2,
                        by: 1,
                        amount: 17.690966,
                    },
                ],
            },
        ),
        // Swings quantized like remote actors; multi-byte ids; an empty list.
        (
            "fx_quantized",
            ServerMsg::Fx {
                tick: 300,
                fx: vec![
                    WireFx::Swing {
                        by: 70_000,
                        weapon: 2,
                        x: 1234.5678,
                        y: -2.0,
                        a: -2.5,
                    },
                    WireFx::Hit {
                        victim: 128,
                        by: u32::MAX,
                        amount: 0.5,
                    },
                ],
            },
        ),
        (
            "fx_empty",
            ServerMsg::Fx {
                tick: 0,
                fx: vec![],
            },
        ),
        (
            "pong",
            ServerMsg::Pong {
                nonce: 0xdead_beef,
                client_ms: 1.5,
                server_ms: 5051.25,
            },
        ),
    ]
}

/// Client frames the server must reject, with the reason.
pub fn malformed_client() -> Vec<(&'static str, Vec<u8>)> {
    let input = ClientMsg::Input {
        seq: 1,
        commands: vec![WireCommand::Aim { a: 0.0 }],
    }
    .encode();
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

/// A small valid Snapshot to corrupt: tick 1, ack 0, `head`, then `body` (a self, if the head says so), an actor count and
/// the actors' bytes.
fn snapshot_bytes(head: u16, body: &[u8], count: u32, actors: &[u8]) -> Vec<u8> {
    let mut w = Writer::default();
    w.u8(0x83);
    w.varint(1);
    w.varint(0);
    w.u16(head);
    w.bytes(body);
    w.varint(count);
    w.bytes(actors);
    w.finish()
}

/// One minimal actor record: id 1, `mask`, x y facing all 0, then `extra`.
fn actor_bytes(mask: u8, extra: &[u8]) -> Vec<u8> {
    let mut a = vec![1, mask, 0, 0, 0, 0, 0, 0];
    a.extend_from_slice(extra);
    a
}

/// Server frames a client must reject (the C# and JS tests check the same names against the reason they expect).
pub fn malformed_server() -> Vec<(&'static str, Vec<u8>)> {
    let good = ServerMsg::Snapshot {
        tick: 5,
        phase: 1,
        ack_input: 0,
        me: None,
        actors: vec![WireActor {
            id: 1,
            faction: 0,
            x: 1.0,
            y: 2.0,
            facing: 0.5,
            hp_pct: 50,
            status: 1,
            weapon: 0,
            bounty: 0,
        }],
    }
    .encode();
    let mut trailing = good.clone();
    trailing.push(0);
    vec![
        ("empty", vec![]),
        ("unknown_tag", vec![0x7f]),
        ("client_tag_from_server", vec![0x01]),
        ("truncated_snapshot", good[..good.len() - 1].to_vec()),
        ("trailing_byte", trailing),
        // tick 0x80 0x00 is a two-byte zero: the canonical form is one byte.
        ("overlong_varint", vec![0x83, 0x80, 0x00, 0, 0, 0, 0, 0, 0]),
        // Five groups whose last carries more than the top 4 bits of a u32.
        (
            "varint_past_u32",
            vec![0x83, 0xff, 0xff, 0xff, 0xff, 0x1f, 0, 0, 0, 0, 0, 0],
        ),
        // Six continuation bytes.
        (
            "varint_too_long",
            vec![0x83, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01, 0, 0, 0, 0, 0],
        ),
        (
            "head_self_bit_without_present_bit",
            snapshot_bytes(0x0001, &[], 0, &[]),
        ),
        ("head_reserved_bit", snapshot_bytes(0x8400, &[], 0, &[])),
        ("self_truncated", snapshot_bytes(0x8000, &[], 0, &[])),
        (
            "self_max_hp_over_u16",
            snapshot_bytes(
                0x8000,
                &[vec![1], vec![0; 12], vec![0x80, 0x80, 0x04]].concat(),
                0,
                &[],
            ),
        ),
        (
            "too_many_actors",
            snapshot_bytes(0, &[], MAX_ACTORS as u32 + 1, &[]),
        ),
        ("actor_count_without_actors", snapshot_bytes(0, &[], 1, &[])),
        (
            "actor_reserved_mask_bit",
            snapshot_bytes(0, &[], 1, &actor_bytes(0x20, &[])),
        ),
        (
            "actor_id_gap_zero",
            snapshot_bytes(
                0,
                &[],
                2,
                &[actor_bytes(0, &[]), vec![0, 0, 0, 0, 0, 0, 0, 0]].concat(),
            ),
        ),
        (
            "actor_id_overflow",
            snapshot_bytes(
                0,
                &[],
                2,
                &[
                    vec![0xff, 0xff, 0xff, 0xff, 0x0f, 0, 0, 0, 0, 0, 0, 0],
                    vec![1, 0, 0, 0, 0, 0, 0, 0],
                ]
                .concat(),
            ),
        ),
        (
            "actor_hp_over_100",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_HP, &[101])),
        ),
        (
            "actor_bounty_over_u16",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_BOUNTY, &[0x80, 0x80, 0x04])),
        ),
        // Fx: a count past u16, a bad item tag.
        ("fx_too_many", vec![0x85, 0, 0x80, 0x80, 0x04]),
        ("fx_bad_tag", vec![0x85, 0, 1, 9]),
    ]
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A decoded float as the vectors carry it: its exact bit pattern.
fn bits(v: f32) -> u32 {
    v.to_bits()
}

/// What a decoder must produce for a Snapshot: every field, floats as bit patterns, server time derived from the tick.
fn decoded_snapshot_json(m: &ServerMsg) -> String {
    let ServerMsg::Snapshot {
        tick,
        phase,
        ack_input,
        me,
        actors,
    } = m
    else {
        unreachable!("only snapshots carry a decoded form")
    };
    let me = match me {
        None => "null".to_string(),
        Some(s) => format!(
            "{{\"id\": {}, \"faction\": {}, \"xBits\": {}, \"yBits\": {}, \"facingBits\": {}, \"hpBits\": {}, \"maxHpBits\": {}, \"status\": {}, \"weapon\": {}, \"readyInMs\": {}, \"kills\": {}, \"bounty\": {}, \"gv\": {}, \"moveSeq\": {}}}",
            s.id,
            s.faction,
            bits(s.x),
            bits(s.y),
            bits(s.facing),
            bits(s.hp),
            bits(s.max_hp),
            s.status,
            s.weapon,
            s.ready_in_ms,
            s.kills,
            s.bounty,
            s.gv,
            s.move_seq
        ),
    };
    let actors: Vec<String> = actors
        .iter()
        .map(|a| {
            format!(
                "{{\"id\": {}, \"faction\": {}, \"xBits\": {}, \"yBits\": {}, \"facingBits\": {}, \"hpPct\": {}, \"status\": {}, \"weapon\": {}, \"bounty\": {}}}",
                a.id,
                a.faction,
                bits(a.x),
                bits(a.y),
                bits(a.facing),
                a.hp_pct,
                a.status,
                a.weapon,
                a.bounty
            )
        })
        .collect();
    format!(
        "{{\"tick\": {tick}, \"serverMs\": {}, \"phase\": {phase}, \"ack\": {ack_input}, \"me\": {me}, \"actors\": [{}]}}",
        snapshot_server_ms(*tick),
        actors.join(", ")
    )
}

/// What a decoder must produce for an Fx: floats as bit patterns.
fn decoded_fx_json(m: &ServerMsg) -> String {
    let ServerMsg::Fx { tick, fx } = m else {
        unreachable!("not an Fx")
    };
    let items: Vec<String> = fx
        .iter()
        .map(|f| match *f {
            WireFx::Swing { by, weapon, x, y, a } => format!(
                "{{\"k\": \"swing\", \"by\": {by}, \"weapon\": {weapon}, \"xBits\": {}, \"yBits\": {}, \"aBits\": {}}}",
                bits(x),
                bits(y),
                bits(a)
            ),
            WireFx::Hit { victim, by, amount } => format!(
                "{{\"k\": \"hit\", \"victim\": {victim}, \"by\": {by}, \"amountBits\": {}}}",
                bits(amount)
            ),
        })
        .collect();
    format!("{{\"tick\": {tick}, \"fx\": [{}]}}", items.join(", "))
}

/// The manifest JSON (hand-written to keep this crate dependency-free; field names are the C# and JS tests' contract).
/// A server vector's `debug` is the message a client DECODES (quantized), not the sample as written.
pub fn manifest() -> String {
    let mut out = String::from("{\n  \"format\": \"rh-protocol-vectors/2\",\n  \"protocol\": ");
    out.push_str(&PROTOCOL_VERSION.to_string());
    out.push_str(",\n  \"client\": [\n");
    let c = client_samples();
    for (i, (name, m)) in c.iter().enumerate() {
        out.push_str(&format!(
            "    {{\"name\": \"{name}\", \"hex\": \"{}\", \"debug\": \"{}\"}}{}\n",
            hex(&m.encode()),
            escape(&format!("{m:?}")),
            if i + 1 < c.len() { "," } else { "" }
        ));
    }
    out.push_str("  ],\n  \"server\": [\n");
    let s = server_samples();
    for (i, (name, m)) in s.iter().enumerate() {
        let bytes = m.encode();
        let decoded = ServerMsg::decode(&bytes).expect("a sample decodes");
        let snapshot = match decoded {
            ServerMsg::Snapshot { .. } => {
                format!(", \"decoded\": {}", decoded_snapshot_json(&decoded))
            }
            ServerMsg::Fx { .. } => format!(", \"decoded\": {}", decoded_fx_json(&decoded)),
            _ => String::new(),
        };
        out.push_str(&format!(
            "    {{\"name\": \"{name}\", \"hex\": \"{}\", \"debug\": \"{}\"{snapshot}}}{}\n",
            hex(&bytes),
            escape(&format!("{decoded:?}")),
            if i + 1 < s.len() { "," } else { "" }
        ));
    }
    for (section, list) in [
        ("malformedClient", malformed_client()),
        ("malformedServer", malformed_server()),
    ] {
        out.push_str(&format!("  ],\n  \"{section}\": [\n"));
        for (i, (name, bytes)) in list.iter().enumerate() {
            out.push_str(&format!(
                "    {{\"name\": \"{name}\", \"hex\": \"{}\"}}{}\n",
                hex(bytes),
                if i + 1 < list.len() { "," } else { "" }
            ));
        }
    }
    out.push_str("  ]\n}\n");
    out
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
