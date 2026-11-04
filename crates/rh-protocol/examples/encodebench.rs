//! Encoder cost, isolated from observation and simulation: a fixed pool of server frames shaped like the slice's
//! (Snapshots with 0-3 visible actors and a self, plus some Fx), encoded `--frames` times. Run under valgrind and divide
//! the difference of two runs by the difference in frames, so the fixed cost (process start, building the pool) cancels:
//!   cargo build --release -p rh-protocol --example encodebench
//!   valgrind --tool=callgrind target/release/examples/encodebench --frames 20000 [--mode encode|into|stream] [--actors N]
//!   valgrind --tool=dhat      target/release/examples/encodebench --frames 20000 ...
//! Modes: `encode` = ServerMsg::encode() per frame (a fresh Vec each); `into` = encode_into() into one reused buffer;
//! `stream` = Snapshots through encode_snapshot_into (actors streamed from the pool's slices, the server's path), Fx
//! through encode_into.
//! `--actors N` gives every Snapshot N actors instead of the slice mix. The output's fnv is a hash of every frame's bytes:
//! with `--check` it must be the same for every mode (and for any revision of the encoder); without it the frames are
//! not hashed (so a measured run counts only the encoder) and fnv stays at its seed.
//!
//! `--report [--actors N] [--shape slice|worst]` encodes the pool once and prints the wire cost against protocol v1's fixed
//! layout (a v1 Snapshot was 18 + (1 or 37, the self) + 2 + 22 per actor bytes; no encoder for it is kept, the formula is
//! the layout in the v1 docs): total bytes of the Snapshots, the per-actor cost of both, and their ratio. `slice` (the
//! default) gives every actor the field mix the slice measures (a faction on 4 of 5, damaged, alive or dead, a weapon, no
//! bounty); `worst` sets every optional field (a faction, a weapon, a bounty, damage).
use rh_protocol::{ServerMsg, WireActor, WireFx, WireSelf};

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter()
        .position(|a| a == k)
        .and_then(|i| args.get(i + 1).cloned())
}

fn pool(fixed_actors: Option<usize>, slice: bool) -> Vec<ServerMsg> {
    // The slice's mean is 1.49 visible actors per snapshot; this mix averages 1.5.
    const MIX: [usize; 8] = [1, 2, 1, 0, 2, 3, 1, 2];
    (0..64u32)
        .map(|i| {
            if i % 8 == 7 {
                let mut fx = vec![WireFx::Swing {
                    by: i,
                    weapon: (i % 7) as u8,
                    x: 400.0 + i as f32,
                    y: 320.0,
                    a: 0.25 * i as f32,
                }];
                if i % 16 == 15 {
                    fx.push(WireFx::Hit {
                        victim: i + 1,
                        by: i,
                        amount: 17.5,
                    });
                }
                return ServerMsg::Fx { tick: i, fx };
            }
            let n = fixed_actors.unwrap_or(MIX[i as usize % 8]);
            ServerMsg::Snapshot {
                tick: 100 + i,
                phase: 1,
                ack_input: i * 3,
                me: Some(WireSelf {
                    id: i % 8 + 1,
                    faction: (i % 5) as u8,
                    x: 100.0 + i as f32,
                    y: 200.5 + i as f32,
                    facing: 0.1 * i as f32,
                    hp: 1000.0 - i as f32,
                    max_hp: 1145.0,
                    status: 0,
                    weapon: (i % 7) as u8,
                    ready_in_ms: (i * 10) as u16,
                    kills: (i % 3) as u16,
                    bounty: (i % 4) as u16,
                    gv: i as u16,
                    move_seq: i as u8,
                }),
                actors: (0..n as u32)
                    .map(|k| WireActor {
                        id: k * 2 + 1,
                        faction: (k % 5) as u8,
                        x: 300.0 + (i * 7 + k) as f32,
                        y: 410.25 - k as f32,
                        facing: -1.0 + 0.01 * (i + k) as f32,
                        hp_pct: if slice {
                            ((i + k) % 100) as u8
                        } else {
                            ((i + k) % 101) as u8
                        },
                        status: if slice {
                            1 + (k % 2) as u8
                        } else {
                            (k % 2) as u8
                        },
                        weapon: if slice {
                            1 + (k % 5) as u8
                        } else {
                            (k % 7) as u8
                        },
                        bounty: if slice { 0 } else { (k * 5) as u16 },
                    })
                    .collect(),
            }
        })
        .collect()
}

fn fnv(mut h: u64, b: &[u8]) -> u64 {
    for &x in b {
        h ^= x as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// Hashes the frame with `--check`; otherwise only keeps the optimiser from discarding it (so a measured run counts the
/// encoder, not the hash).
fn sink(hash: bool, h: u64, b: &[u8]) -> u64 {
    if hash {
        fnv(h, b)
    } else {
        std::hint::black_box(b);
        h
    }
}

/// Protocol v1's Snapshot size (fixed layout: 18 header + self flag/36 + 2 count + 22 per actor).
fn v1_snapshot_len(me: bool, actors: usize) -> usize {
    18 + if me { 37 } else { 1 } + 2 + 22 * actors
}

fn report(pool: &[ServerMsg], fixed: Option<usize>, slice: bool) {
    let (mut v1, mut v2, mut v2_empty, mut actors, mut snaps) =
        (0usize, 0usize, 0usize, 0usize, 0usize);
    for m in pool {
        if let ServerMsg::Snapshot {
            tick,
            phase,
            ack_input,
            me,
            actors: a,
        } = m
        {
            snaps += 1;
            actors += a.len();
            v1 += v1_snapshot_len(me.is_some(), a.len());
            v2 += m.encoded_len();
            v2_empty += ServerMsg::Snapshot {
                tick: *tick,
                phase: *phase,
                ack_input: *ack_input,
                me: *me,
                actors: vec![],
            }
            .encoded_len();
        }
    }
    let per_actor_v2 = (v2 - v2_empty) as f64 / actors.max(1) as f64;
    println!(
        "{{\"shape\":\"{}\",\"actorsPerSnapshot\":\"{}\",\"snapshots\":{snaps},\"v1Bytes\":{v1},\"v2Bytes\":{v2},\"ratio\":{:.3},\"bytesPerActorV1\":22,\"bytesPerActorV2\":{per_actor_v2:.2},\"actorRatio\":{:.3}}}",
        if slice { "slice" } else { "worst" },
        fixed.map_or("mix".to_string(), |n| n.to_string()),
        v2 as f64 / v1 as f64,
        per_actor_v2 / 22.0
    );
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let frames: usize = arg(&args, "--frames")
        .and_then(|v| v.parse().ok())
        .unwrap_or(20_000);
    let mode = arg(&args, "--mode").unwrap_or_else(|| "encode".into());
    let fixed = arg(&args, "--actors").and_then(|v| v.parse().ok());
    let hash = args.iter().any(|a| a == "--check");
    let slice = arg(&args, "--shape").as_deref() != Some("worst");
    let pool = pool(fixed, slice);
    if args.iter().any(|a| a == "--report") {
        report(&pool, fixed, slice);
        return;
    }
    let (mut bytes, mut h) = (0u64, 0xcbf2_9ce4_8422_2325u64);
    let mut buf = Vec::new();
    for i in 0..frames {
        let m = &pool[i % pool.len()];
        match mode.as_str() {
            "encode" => {
                let b = m.encode();
                bytes += b.len() as u64;
                h = sink(hash, h, &b);
            }
            "into" => {
                buf.clear();
                m.encode_into(&mut buf).expect("legal frame");
                bytes += buf.len() as u64;
                h = sink(hash, h, &buf);
            }
            "stream" => {
                buf.clear();
                match m {
                    ServerMsg::Snapshot {
                        tick,
                        phase,
                        ack_input,
                        me,
                        actors,
                    } => {
                        rh_protocol::encode_snapshot_into(
                            &mut buf,
                            *tick,
                            *phase,
                            *ack_input,
                            me.as_ref(),
                            actors.iter().copied(),
                        )
                        .expect("legal frame");
                    }
                    _ => {
                        m.encode_into(&mut buf).expect("legal frame");
                    }
                }
                bytes += buf.len() as u64;
                h = sink(hash, h, &buf);
            }
            other => panic!("unknown --mode {other}"),
        }
    }
    println!("{{\"mode\":\"{mode}\",\"frames\":{frames},\"bytes\":{bytes},\"fnv\":\"{h:016x}\"}}");
}
