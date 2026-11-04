//! Replication cost of the slice: bytes per player per second and encode time, from the same observation path the live
//! room uses (observe -> wire -> protocol encode), on a headless 8-bot match.
//!   cargo run --release -p rh-server --bin wirebench -- [--map parity/maps/seed1.map.json] [--ticks 2400] [--seed 1]
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::scripted::Brawler;
use rh_protocol::ServerMsg;
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
        protocol: 1,
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
    let mut steps = 0;
    for _ in 0..ticks {
        let t = Instant::now();
        let out = env.step(&[]);
        step_ns += t.elapsed().as_nanos();
        steps += 1;
        let events: &Vec<Event> = &out.events;
        let t = Instant::now();
        for id in &ids {
            let obs = rh_sim::observe(&env.sim, *id, events);
            visible_sum += obs.visible.len() as u64;
            let snap = rh_server::wire::snapshot(&obs, 0).encode();
            snap_bytes += snap.len() as u64;
            snaps += 1;
            bytes += snap.len() as u64;
            frames += 1;
            let imp = rh_server::wire::important(events, &obs);
            if !imp.is_empty() {
                bytes += ServerMsg::Events {
                    tick: obs.tick,
                    events: imp,
                }
                .encode()
                .len() as u64;
                frames += 1;
            }
            let fx = rh_server::wire::fx_seen(&obs);
            if !fx.is_empty() {
                bytes += ServerMsg::Fx { tick: obs.tick, fx }.encode().len() as u64;
                frames += 1;
            }
            n += 1;
        }
        enc_ns += t.elapsed().as_nanos();
        if out.terminated {
            break;
        }
    }
    let secs = steps as f64 * 0.05;
    println!(
        "{{\"map\":\"{}x{}\",\"players\":8,\"steps\":{steps},\"welcomeBytes\":{},\"bytesPerPlayerPerSec\":{:.0},\"framesPerPlayerPerSec\":{:.1},\"meanSnapshotBytes\":{:.1},\"meanVisibleActors\":{:.2},\"observeEncodeUsPerPlayerTick\":{:.2},\"simStepUsMean\":{:.2},\"note\":\"payload bytes only (no WebSocket/TCP/TLS framing); bots, no mobs: the slice\"}}",
        env.sim.arena.map.w,
        env.sim.arena.map.h,
        welcome.len(),
        bytes as f64 / 8.0 / secs,
        frames as f64 / 8.0 / secs,
        snap_bytes as f64 / snaps.max(1) as f64,
        visible_sum as f64 / n.max(1) as f64,
        enc_ns as f64 / 1000.0 / n.max(1) as f64,
        step_ns as f64 / 1000.0 / steps.max(1) as f64
    );
}
