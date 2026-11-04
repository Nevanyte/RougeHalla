//! Encoder cost, isolated from observation and simulation: a fixed pool of server frames shaped like the slice's
//! (Snapshots with 0-3 visible actors and a self, plus some Fx), encoded `--frames` times. Run under valgrind and divide
//! the difference of two runs by the difference in frames, so the fixed cost (process start, building the pool) cancels:
//!   cargo build --release -p rh-protocol --example encodebench
//!   valgrind --tool=callgrind target/release/examples/encodebench --frames 20000 [--mode encode|into|stream] [--actors N]
//!   valgrind --tool=dhat      target/release/examples/encodebench --frames 20000 ...
//! Modes: `encode` = ServerMsg::encode() per frame (a fresh Vec each); `into` = encode_into() into one reused buffer;
//! `stream` = Snapshots through SnapshotWriter (actors written from the pool's slices), Fx through encode_into.
//! `--actors N` gives every Snapshot N actors instead of the slice mix. The output's fnv is a hash of every frame's bytes:
//! with `--check` it must be the same for every mode (and for any revision of the encoder); without it the frames are
//! not hashed (so a measured run counts only the encoder) and fnv stays at its seed.
use rh_protocol::{ServerMsg, WireActor, WireFx, WireSelf};

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter()
        .position(|a| a == k)
        .and_then(|i| args.get(i + 1).cloned())
}

fn pool(fixed_actors: Option<usize>) -> Vec<ServerMsg> {
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
                        hp_pct: ((i + k) % 101) as u8,
                        status: (k % 2) as u8,
                        weapon: (k % 7) as u8,
                        bounty: (k * 5) as u16,
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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let frames: usize = arg(&args, "--frames")
        .and_then(|v| v.parse().ok())
        .unwrap_or(20_000);
    let mode = arg(&args, "--mode").unwrap_or_else(|| "encode".into());
    let fixed = arg(&args, "--actors").and_then(|v| v.parse().ok());
    let hash = args.iter().any(|a| a == "--check");
    let pool = pool(fixed);
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
                        let mut s = rh_protocol::SnapshotWriter::begin(
                            &mut buf,
                            *tick,
                            *phase,
                            *ack_input,
                            me.as_ref(),
                            actors.len(),
                        );
                        for a in actors {
                            s.actor(a);
                        }
                        s.finish().expect("legal frame");
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
