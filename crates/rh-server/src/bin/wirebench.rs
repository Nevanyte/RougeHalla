//! Replication cost of the slice: bytes per player per second and encode time, from the same observation path the live
//! room uses (observe -> wire -> protocol encode), on a headless 8-bot match.
//!   cargo run --release -p rh-server --bin wirebench -- [--map parity/maps/seed1.map.json] [--ticks 2400] [--seed 1]
//!                                                     [--digest]
//! `--digest` adds `outcomeDigest`, the match's hash-independent behaviour fingerprint (rh_headless::digest), folded
//! outside the timed sections.
//! Protocol v3: each viewer has its own `ConnEncoder` (the connection writer's state, as `Outbox::drain_into` uses it) and
//! every snapshot is written, none skipped, so the bytes are the Full-or-delta frames a client that keeps up receives.
//! `--compare-full` adds `fullSnapshotBytesPerPlayerPerSec`, what the same snapshots cost as v2-style Full frames.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::scripted::Brawler;
use rh_protocol::{ConnEncoder, FrameKind, ServerMsg};
use rh_sim::{Event, FactionId, SimConfig};
use std::time::Instant;

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter()
        .position(|a| a == k)
        .and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arena = match arg(&args, "--map") {
        Some(p) => rh_headless::load_arena(&p).expect("map"),
        None => rh_headless::load_arena("parity/maps/seed1.map.json")
            .expect("map (run from the repo root)"),
    };
    let ticks: u32 = arg(&args, "--ticks")
        .and_then(|v| v.parse().ok())
        .unwrap_or(2400);
    let seed: u64 = arg(&args, "--seed")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);
    let blob = rh_protocol::map::MapBlob::new(
        arena.map.w as u16,
        arena.map.h as u16,
        arena.map.tiles.clone(),
    );
    let welcome = ServerMsg::Welcome {
        protocol: rh_protocol::PROTOCOL_VERSION,
        content_hash: 0,
        match_id: [0; 16],
        player_id: 1,
        session: [0; 16],
        tick_rate: 20,
        tick: 0,
        server_ms: 0.0,
        map: blob,
    }
    .encode();
    let agents = (0..8)
        .map(|i| AgentSpec {
            profile: format!("b{i}"),
            faction: FactionId::ALL[i % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Brawler::new(2)),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks: ticks,
            record: false,
        },
        agents,
        seed,
    );
    let ids: Vec<_> = env.sim.players().iter().map(|p| p.id).collect();
    let (mut bytes, mut frames, mut enc_ns, mut step_ns, mut n) = (0u64, 0u64, 0u128, 0u128, 0u64);
    let (mut snap_bytes, mut snaps, mut visible_sum) = (0u64, 0u64, 0u64);
    let (mut full_bytes, mut full_frames, mut delta_frames) = (0u64, 0u64, 0u64);
    // `--compare-full` also sizes every snapshot as a Full frame (a pass the writer itself rarely needs): off by default so the
    // measured work is the production work.
    let compare_full = args.iter().any(|a| a == "--compare-full");
    let mut encoders: Vec<ConnEncoder> = ids.iter().map(|_| ConnEncoder::new()).collect();
    let mut spares: Vec<Option<rh_protocol::SnapshotData>> = ids.iter().map(|_| None).collect();
    let (mut event_bytes, mut fx_bytes) = (0u64, 0u64);
    let mut steps = 0;
    let mut digest = args
        .iter()
        .any(|a| a == "--digest")
        .then(rh_headless::digest::OutcomeDigest::new);
    // The room's own publish path (`wire::Publisher::frames`), one wake of one step per tick, with its buffers reused.
    let mut publisher = rh_server::wire::Publisher::default();
    let mut earlier: Vec<rh_sim::SeenEvent> = Vec::new();
    for _ in 0..ticks {
        let t = Instant::now();
        let progress = env.advance(&[]);
        step_ns += t.elapsed().as_nanos();
        steps += 1;
        let events: &[Event] = env.last_events();
        if let Some(d) = digest.as_mut() {
            d.tick(&env.sim, events);
        }
        let t = Instant::now();
        for (k, id) in ids.iter().enumerate() {
            let f = publisher.frames_in(
                spares[k].take(),
                &env.sim,
                *id,
                0,
                events,
                &mut earlier,
                events,
            );
            visible_sum += publisher.observation().visible.len() as u64;
            let snap = f.snapshot.expect("snapshot encodes");
            if compare_full {
                full_bytes += snap.full_len() as u64;
            }
            // The connection writer's work: encode against the last frame it wrote, into an owned frame.
            let mut frame = Vec::with_capacity(snap.frame_capacity());
            match encoders[k].encode(snap, &mut frame) {
                FrameKind::Full => full_frames += 1,
                FrameKind::Delta => delta_frames += 1,
            }
            spares[k] = encoders[k].take_spare();
            snap_bytes += frame.len() as u64;
            snaps += 1;
            bytes += frame.len() as u64;
            frames += 1;
            if let Some(imp) = &f.important {
                bytes += imp.len() as u64;
                event_bytes += imp.len() as u64;
                frames += 1;
            }
            if let Some(fx) = &f.fx {
                bytes += fx.len() as u64;
                fx_bytes += fx.len() as u64;
                frames += 1;
            }
            n += 1;
        }
        enc_ns += t.elapsed().as_nanos();
        if progress.terminated {
            break;
        }
    }
    if args.iter().any(|a| a == "--sight-stats") {
        eprintln!(
            "sight memo: publisher {:?}, bots {:?}",
            publisher.sight_stats(),
            env.sight_stats()
        );
    }
    let secs = steps as f64 * 0.05;
    let digest = digest
        .map(|d| format!("\"outcomeDigest\":\"{}\",", d.hex()))
        .unwrap_or_default();
    println!(
        "{{\"map\":\"{}x{}\",\"players\":8,\"steps\":{steps},{digest}\"welcomeBytes\":{},\"bytesPerPlayerPerSec\":{:.0},\"snapshotBytesPerPlayerPerSec\":{:.0},\"fullSnapshotBytesPerPlayerPerSec\":{},\"fullSnapshotFrames\":{full_frames},\"deltaSnapshotFrames\":{delta_frames},\"eventBytesPerPlayerPerSec\":{:.0},\"fxBytesPerPlayerPerSec\":{:.0},\"framesPerPlayerPerSec\":{:.1},\"meanSnapshotBytes\":{:.1},\"meanVisibleActors\":{:.2},\"observeEncodeUsPerPlayerTick\":{:.2},\"simStepUsMean\":{:.2},\"note\":\"payload bytes only (no WebSocket/TCP/TLS framing); bots, no mobs: the slice\"}}",
        env.sim.arena().map.w,
        env.sim.arena().map.h,
        welcome.len(),
        bytes as f64 / 8.0 / secs,
        snap_bytes as f64 / 8.0 / secs,
        if compare_full {
            format!("{:.0}", full_bytes as f64 / 8.0 / secs)
        } else {
            "null".to_string()
        },
        event_bytes as f64 / 8.0 / secs,
        fx_bytes as f64 / 8.0 / secs,
        frames as f64 / 8.0 / secs,
        snap_bytes as f64 / snaps.max(1) as f64,
        visible_sum as f64 / n.max(1) as f64,
        enc_ns as f64 / 1000.0 / n.max(1) as f64,
        step_ns as f64 / 1000.0 / steps.max(1) as f64
    );
}
