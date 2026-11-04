//! rh-headless: bot-vs-bot matches with no waiting, on the same core and seats as the live server.
//!
//!   cargo run --release -p rh-headless -- --matches 20 --players 8 --seed 1 [--map parity/maps/seed1.map.json]
//!                                       [--max-ticks 12000] [--replay-out run.json] [--verify-replay run.json]
use std::time::Instant;

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter()
        .position(|a| a == k)
        .and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(path) = arg(&args, "--verify-replay") {
        let text = std::fs::read_to_string(&path).expect("replay file");
        let mut r: rh_sim::replay::Replay = serde_json::from_str(&text).expect("replay json");
        r.arena.map.rebuild();
        match rh_sim::replay::run_replay(&r) {
            Ok((sim, _)) => println!(
                "{{\"verified\":true,\"steps\":{},\"finalHash\":\"{:016x}\"}}",
                r.hashes.len(),
                sim.state_hash()
            ),
            Err(e) => {
                println!("{{\"verified\":false,\"error\":\"{e:?}\"}}");
                std::process::exit(1);
            }
        }
        return;
    }
    let matches: u64 = arg(&args, "--matches")
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    let players: usize = arg(&args, "--players")
        .and_then(|v| v.parse().ok())
        .unwrap_or(8);
    let seed: u64 = arg(&args, "--seed")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);
    let max_ticks: u32 = arg(&args, "--max-ticks")
        .and_then(|v| v.parse().ok())
        .unwrap_or(12_000);
    let arena = match arg(&args, "--map") {
        Some(p) => rh_headless::load_arena(&p).unwrap_or_else(|e| panic!("{e}")),
        None => rh_sim::arenas::practice_arena(),
    };
    let replay_out = arg(&args, "--replay-out");
    let t0 = Instant::now();
    let (mut ticks, mut ended, mut truncated) = (0u64, 0, 0);
    let mut step_ns: Vec<u128> = Vec::new();
    for m in 0..matches {
        let started = Instant::now();
        let (env, s) = rh_headless::run_bot_match(
            &arena,
            players,
            seed + m,
            max_ticks,
            replay_out.is_some() && m == 0,
        );
        step_ns.push(started.elapsed().as_nanos() / (s.ticks.max(1) as u128));
        ticks += s.ticks as u64;
        ended += s.terminated as u32;
        truncated += s.truncated as u32;
        if m == 0 {
            if let (Some(path), Some(r)) = (&replay_out, env.into_replay()) {
                std::fs::write(path, serde_json::to_string(&r).unwrap()).expect("write replay");
            }
        }
    }
    let wall = t0.elapsed().as_secs_f64();
    step_ns.sort_unstable();
    println!(
        "{{\"matches\":{matches},\"players\":{players},\"ticks\":{ticks},\"terminated\":{ended},\"truncated\":{truncated},\"wallSec\":{wall:.3},\"ticksPerSec\":{:.0},\"meanStepUsPerMatchP50\":{:.2},\"realTimeFactor\":{:.0}}}",
        ticks as f64 / wall,
        step_ns[step_ns.len() / 2] as f64 / 1000.0,
        ticks as f64 * 0.05 / wall
    );
}
