//! rh-headless: bot-vs-bot matches with no waiting, on the same core and seats as the live server.
//!
//!   cargo run --release -p rh-headless -- --matches 20 --players 8 --seed 1 [--map parity/maps/seed1.map.json]
//!                                       [--max-ticks 12000] [--replay-out run.json] [--digest]
//!   cargo run --release -p rh-headless -- --verify-replay run.json [--ignore-content-hash]
//!
//! Output (one JSON line): `ticks`, `terminated`, `truncated`, `stateHashFold` (the final `Sim::state_hash` of every
//! match, folded in order), and with `--digest` the hash-independent behaviour fingerprint `outcomeDigest` (all matches)
//! and `outcomeDigests` (per match; see `rh_headless::digest`). `meanTickUsPerMatchP50` is the median over matches of
//! wall time per TICK, and a tick here is everything the runner does for it: observe, decide (the bot seats), the sim
//! step and the bookkeeping, not `Sim::step` alone.
//!
//! `--ignore-content-hash` (development only) verifies a replay recorded by a build with other content: it skips the
//! content gate and nothing else. Every step's state hash is still compared, so a pass proves the two builds produce
//! bit-identical state on that replay.
use rh_headless::digest::fold_all;
use std::time::Instant;

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter()
        .position(|a| a == k)
        .and_then(|i| args.get(i + 1).cloned())
}

fn flag(args: &[String], k: &str) -> bool {
    args.iter().any(|a| a == k)
}

fn verify(path: &str, ignore_content_hash: bool) {
    let text = std::fs::read_to_string(path).expect("replay file");
    let mut r: rh_sim::replay::Replay = serde_json::from_str(&text).expect("replay json");
    r.arena.map.rebuild();
    let build = rh_sim::content::content_hash();
    let content = if r.content_hash == build {
        "same"
    } else if ignore_content_hash {
        // Only the content gate is skipped: run_replay still checks every recorded step hash.
        r.content_hash = build;
        "ignored"
    } else {
        "differs"
    };
    match rh_sim::replay::run_replay(&r) {
        Ok((sim, _)) => println!(
            "{{\"verified\":true,\"steps\":{},\"finalHash\":\"{:016x}\",\"contentHash\":\"{content}\"}}",
            r.hashes.len(),
            sim.state_hash()
        ),
        Err(e) => {
            // `steps` is the work actually done: the steps replayed up to and including the diverging one.
            let done = match e {
                rh_sim::replay::ReplayError::Diverged { step, .. } => step + 1,
                rh_sim::replay::ReplayError::ContentMismatch { .. } => 0,
            };
            println!(
                "{{\"verified\":false,\"steps\":{done},\"recordedSteps\":{},\"contentHash\":\"{content}\",\"error\":\"{e:?}\"}}",
                r.hashes.len()
            );
            std::process::exit(1);
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(path) = arg(&args, "--verify-replay") {
        verify(&path, flag(&args, "--ignore-content-hash"));
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
    let digest = flag(&args, "--digest");
    let t0 = Instant::now();
    let (mut ticks, mut ended, mut truncated) = (0u64, 0, 0);
    let mut tick_ns: Vec<u128> = Vec::new();
    let (mut hashes, mut digests) = (Vec::new(), Vec::new());
    for m in 0..matches {
        let started = Instant::now();
        let (env, s) = rh_headless::run_bot_match_with(
            &arena,
            players,
            seed + m,
            max_ticks,
            replay_out.is_some() && m == 0,
            digest,
        );
        tick_ns.push(started.elapsed().as_nanos() / (s.ticks.max(1) as u128));
        ticks += s.ticks as u64;
        ended += s.terminated as u32;
        truncated += s.truncated as u32;
        hashes.push(s.state_hash);
        digests.extend(s.outcome_digest);
        if m == 0 {
            if let (Some(path), Some(r)) = (&replay_out, env.into_replay()) {
                std::fs::write(path, serde_json::to_string(&r).unwrap()).expect("write replay");
            }
        }
    }
    let wall = t0.elapsed().as_secs_f64();
    tick_ns.sort_unstable();
    let digest_keys = if digest {
        format!(
            ",\"outcomeDigest\":\"{:016x}\",\"outcomeDigests\":[{}]",
            fold_all(digests.iter().copied()),
            digests
                .iter()
                .map(|d| format!("\"{d:016x}\""))
                .collect::<Vec<_>>()
                .join(",")
        )
    } else {
        String::new()
    };
    println!(
        "{{\"matches\":{matches},\"players\":{players},\"ticks\":{ticks},\"terminated\":{ended},\"truncated\":{truncated},\"stateHashFold\":\"{:016x}\"{digest_keys},\"wallSec\":{wall:.3},\"ticksPerSec\":{:.0},\"meanTickUsPerMatchP50\":{:.2},\"realTimeFactor\":{:.0}}}",
        fold_all(hashes.iter().copied()),
        ticks as f64 / wall,
        tick_ns[tick_ns.len() / 2] as f64 / 1000.0,
        ticks as f64 * 0.05 / wall
    );
}
