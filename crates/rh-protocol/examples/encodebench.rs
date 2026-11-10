//! Cost of the shipped snapshot writer, isolated from observation and simulation: a fixed ring of one viewer's snapshots (a
//! self and `--actors N` remote actors drifting a little each tick, as in a fight; default the slice's mix of 0 to 3), written
//! `--frames` times by a connection's `ConnEncoder` (protocol v3), with an Fx frame every eighth. Run under valgrind and divide
//! the difference of two runs by the difference in frames, so the fixed cost (process start, building the ring) cancels:
//!   cargo build --release -p rh-protocol --example encodebench
//!   valgrind --tool=callgrind target/release/examples/encodebench --frames 20000 [--mode delta|full] [--actors N]
//!   valgrind --tool=dhat      target/release/examples/encodebench --frames 20000 ...
//! Modes: `delta` = `ConnEncoder::encode_frame` (the writer's path: a Delta against the last frame written, a Full frame when
//! that is smaller or first); `full` = `SnapshotData::encode_full_into` into one reused buffer (the v2 layout, what a Resync or
//! a first frame costs). `--check` hashes every frame's bytes (FNV-1a) into `fnv`; without it the frames are not hashed, so a
//! measured run counts only the encoder.
//! Each frame clones its ring entry (one allocation, which the writer gets from the room in production).
//! The bench for the whole publish path (observation, quantization, encode) is `wirebench`, which also takes `--synthetic N`.
use rh_protocol::{ConnEncoder, ServerMsg, SnapshotData, WireActor, WireFx, WireSelf};

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter()
        .position(|a| a == k)
        .and_then(|i| args.get(i + 1).cloned())
}

/// 64 consecutive snapshots of one viewer. Actors move on most ticks, turn, and sometimes change health, as on the seed-1 map.
fn ring(fixed_actors: Option<usize>) -> Vec<SnapshotData> {
    // The slice's mean is 1.49 visible actors per snapshot; this mix averages 1.5.
    const MIX: [usize; 8] = [1, 2, 1, 0, 2, 3, 1, 2];
    (0..64u32)
        .map(|i| {
            let n = fixed_actors.unwrap_or(MIX[i as usize % 8]) as u32;
            let me = WireSelf {
                sig: 0,
                effects: 0,
                displace_seq: 0,
                id: 1000,
                faction: (i % 5) as u8,
                x: 100.0 + i as f32 * 0.5,
                y: 200.5,
                facing: 0.1 * i as f32,
                hp: 1000.0 - (i / 8) as f32,
                max_hp: 1145.0,
                status: 1,
                weapon: 3,
                ready_in_ms: (i * 10 % 300) as u16,
                kills: (i / 32) as u16,
                bounty: 0,
                gv: 0,
                move_seq: i as u8,
                hunt_target: None,
                hunt_stacks: 0,
                wish: None,
                barrier: 0.0,
                barrier_ring_step: 0,
            };
            let actors = (0..n).map(|k| WireActor {
                sig: 0,
                mob_type_code: 0,
                effects: 0,
                displace_seq: 0,
                id: k * 2 + 1,
                faction: (k % 5) as u8,
                x: 300.0
                    + k as f32 * 3.0
                    + if (i + k) % 4 != 0 {
                        i as f32 * 0.25
                    } else {
                        0.0
                    },
                y: 410.25 - k as f32,
                facing: -1.0 + 0.01 * ((i / 3) + k) as f32,
                hp_pct: 100 - ((i / 16 + k) % 4) as u8 * 10,
                status: 1,
                weapon: 1 + (k % 5) as u8,
                bounty: 0,
                kind: 0,
                barrier_pct: 0,
                barrier_ring_step: 0,
                windup: None,
            });
            SnapshotData::build(100 + i, 1, i * 3, Some(me), actors).expect("a legal snapshot")
        })
        .collect()
}

fn fx_frame(i: usize) -> ServerMsg {
    ServerMsg::Fx {
        tick: i as u32,
        fx: vec![WireFx::Swing {
            by: 1,
            weapon: (i % 7) as u8,
            x: 400.0 + (i % 64) as f32,
            y: 320.0,
            a: 0.25,
        }],
    }
}

fn fnv(mut h: u64, b: &[u8]) -> u64 {
    for &x in b {
        h ^= x as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// Hashes the frame with `--check`; otherwise only keeps the optimiser from discarding it.
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
    let mode = arg(&args, "--mode").unwrap_or_else(|| "delta".into());
    let fixed = arg(&args, "--actors").and_then(|v| v.parse().ok());
    let hash = args.iter().any(|a| a == "--check");
    let ring = ring(fixed);
    let fx: Vec<ServerMsg> = (0..8).map(fx_frame).collect();
    let (mut bytes, mut h, mut full, mut delta) = (0u64, 0xcbf2_9ce4_8422_2325u64, 0u64, 0u64);
    let mut enc = ConnEncoder::new();
    let mut buf = Vec::new();
    for i in 0..frames {
        if i % 8 == 7 {
            buf.clear();
            fx[i / 8 % 8].encode_into(&mut buf).expect("legal frame");
            bytes += buf.len() as u64;
            h = sink(hash, h, &buf);
            continue;
        }
        let snap = ring[i % ring.len()].clone();
        match mode.as_str() {
            "delta" => {
                let (frame, kind) = enc.encode_frame(snap);
                match kind {
                    rh_protocol::FrameKind::Full => full += 1,
                    rh_protocol::FrameKind::Delta => delta += 1,
                }
                bytes += frame.len() as u64;
                h = sink(hash, h, &frame);
            }
            "full" => {
                buf.clear();
                snap.encode_full_into(&mut buf);
                full += 1;
                bytes += buf.len() as u64;
                h = sink(hash, h, &buf);
            }
            other => panic!("unknown --mode {other}"),
        }
    }
    println!(
        "{{\"mode\":\"{mode}\",\"frames\":{frames},\"bytes\":{bytes},\"fullFrames\":{full},\"deltaFrames\":{delta},\"fnv\":\"{h:016x}\"}}"
    );
}
