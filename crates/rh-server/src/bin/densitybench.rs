//! Deterministic server density benchmark: N rooms x H humans through the production room task, outbox and pacer, on a
//! paused clock (see `densitybench/engine.rs` for exactly what is and is not in the path).
//!
//!   cargo build --release -p rh-server --features bench --bin densitybench
//!   target/release/densitybench --rooms 4 --humans 8 --secs 20 [--fill-to 8] [--profile active|idle]
//!       [--map parity/maps/seed1.map.json] [--lobby-secs 2] [--seed 1] [--check]
//!       [--ir-per-match-sec N --ips N] [--headroom 0.5]
//!
//! Reproducible instruction counts (the reproducibility proof, and the way to get Ir per match-second):
//!
//!   valgrind --tool=callgrind --callgrind-out-file=/dev/null target/release/densitybench --rooms 4 --secs 20
//!   Ir per match-second = (Ir at --secs S2 - Ir at --secs S1) / (rooms x (S2 - S1)): the difference removes setup.
//!
//! The JSON on stdout has two kinds of numbers. Deterministic counts (identical run to run): matchSeconds, steps, frames,
//! bytes, notifies and writer wakes per human-tick (heap per room: see the DHAT recipe in engine.rs). Informational and NOT deterministic: `wallSeconds` and
//! everything derived from it. The capacity block is an ESTIMATE from this machine's single-thread paused-clock speed with
//! no sockets, TLS or kernel network cost in it: it is not measured capacity on any cloud instance.
#[path = "densitybench/engine.rs"]
mod engine;

use engine::{Opts, Profile};

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter()
        .position(|a| a == k)
        .and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arena = match arg(&args, "--map") {
        Some(p) => rh_headless::load_arena(&p).unwrap_or_else(|e| panic!("{e}")),
        None => rh_sim::arenas::practice_arena(),
    };
    let num = |k: &str, d: f64| {
        arg(&args, k)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(d)
    };
    let mut o = Opts::new(arena);
    o.rooms = num("--rooms", 4.0) as usize;
    o.humans = num("--humans", 8.0) as usize;
    o.fill_to = num("--fill-to", 8.0) as usize;
    o.secs = num("--secs", 20.0) as u64;
    o.lobby_secs = num("--lobby-secs", 2.0);
    o.seed = num("--seed", 1.0) as u64;
    o.profile = match arg(&args, "--profile").as_deref() {
        None | Some("active") => Profile::Active,
        Some("idle") => Profile::Idle,
        Some(p) => panic!("unknown --profile {p}"),
    };
    assert!(
        (1..=rh_sim::constants::MAX_PLAYERS).contains(&o.humans),
        "--humans must be 1..={}",
        rh_sim::constants::MAX_PLAYERS
    );
    let check = args.iter().any(|a| a == "--check");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .start_paused(true)
        .build()
        .expect("runtime");
    let r = rt.block_on(engine::run(&o, check));
    let cpu_per_match_s = r.wall.as_secs_f64() / r.match_seconds.max(1e-9);
    let headroom = num("--headroom", 0.5);
    let mut est = serde_json::json!({
        "label": "ESTIMATE from this machine's deterministic counts and its paused-clock speed; not measured capacity on any cloud instance (no sockets, TLS, kernel network or noisy neighbours in it)",
        "headroom": headroom,
        "cpuSecondsPerMatchSecondWall": cpu_per_match_s,
        "matchesPerVcpuFromWall": headroom / cpu_per_match_s,
    });
    if let (Some(ir), Some(ips)) = (arg(&args, "--ir-per-match-sec"), arg(&args, "--ips")) {
        let (ir, ips): (f64, f64) = (ir.parse().expect("ir"), ips.parse().expect("ips"));
        est["matchesPerVcpuFromIr"] = serde_json::json!(headroom * ips / ir);
        est["irPerMatchSecond"] = serde_json::json!(ir);
        est["assumedInstructionsPerSecond"] = serde_json::json!(ips);
    }
    let out = serde_json::json!({
        "rooms": r.rooms,
        "roomsClosed": r.rooms_closed,
        "humansPerRoom": r.humans,
        "fillTo": o.fill_to,
        "profile": format!("{:?}", o.profile),
        "matchSeconds": r.match_seconds,
        "humanTicks": r.human_ticks,
        "steps": r.steps,
        "droppedSteps": r.dropped_steps,
        "frames": r.frames,
        "bytes": r.bytes,
        "framesPerHumanTick": r.per_human_tick(r.frames),
        "bytesPerHumanTick": r.per_human_tick(r.bytes),
        "notifiesPerHumanTick": r.per_human_tick(r.notifies),
        "writerWakesPerHumanTick": r.per_human_tick(r.writer_wakes),
        "rssPerRoomBytes": r.rss_per_room,
        "heapNote": "exact heap per room: run under valgrind --tool=dhat at --rooms 1 and --rooms N and divide the t-gmax difference (rssPerRoomBytes is informational)",
        "wallSeconds": r.wall.as_secs_f64(),
        "wallNote": "informational only; not deterministic",
        "capacity": est,
        "processMetrics": r.metrics,
    });
    println!("{}", serde_json::to_string_pretty(&out).expect("json"));
}
