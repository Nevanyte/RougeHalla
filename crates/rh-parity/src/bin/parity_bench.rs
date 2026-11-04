//! Times the Rust core on captured legacy workloads.
//!
//!   cargo run --release -p rh-parity --bin parity-bench -- [crowded_8] [runs] [--digest]
//!       step() on a captured scenario's exact inputs (the workload parity/legacy-capture/bench.ts times through the legacy
//!       TypeScript sim); 3 untimed warm-up passes, then `runs` timed ones. `ticks` counts the timed steps.
//!   cargo run --release -p rh-parity --bin parity-bench -- paths [runs] [--digest]
//!       the 300 legacy findPath queries of pathfinding_seed1.json, `runs` passes, timed per query. `queries` counts them.
//!
//! Both print `finalStateHash` / `mismatches` and, with `--digest`, `outcomeDigest`: the hash-independent behaviour
//! fingerprint of the first pass (rh_headless::digest over every step; for paths, a fold of every returned waypoint).
use std::time::Instant;

#[path = "../../../rh-headless/src/digest.rs"]
#[allow(dead_code)]
mod digest;

fn quantiles(mut all: Vec<f64>) -> String {
    if all.is_empty() {
        return "null".into(); // runs = 0: nothing timed
    }
    all.sort_by(|a, b| a.total_cmp(b));
    let q = |p: f64| all[((all.len() as f64 * p) as usize).min(all.len() - 1)];
    let mean = all.iter().sum::<f64>() / all.len() as f64;
    format!(
        "{{\"mean\":{mean:.2},\"p50\":{:.2},\"p99\":{:.2},\"max\":{:.2}}}",
        q(0.5),
        q(0.99),
        all[all.len() - 1]
    )
}

fn paths(runs: usize, want_digest: bool) {
    let (fx, map) =
        rh_parity::load_paths(&rh_parity::fixtures_dir().join("pathfinding_seed1.json"));
    let mut pf = rh_sim::pathfind::Pathfinder::default();
    let mut all: Vec<f64> = Vec::new();
    let mut mismatches = 0;
    let mut d = digest::OutcomeDigest::new();
    for r in 0..runs {
        for q in &fx.queries {
            let (from, to) = (
                rh_sim::Vec2::new(q.from[0], q.from[1]),
                rh_sim::Vec2::new(q.to[0], q.to[1]),
            );
            let t0 = Instant::now();
            let got = pf.find_path(&map, from, to, fx.radius);
            all.push(t0.elapsed().as_secs_f64() * 1e6);
            if r == 0 {
                mismatches += !rh_parity::same_path(&got, &q.path) as u32;
                if want_digest {
                    d.word(got.len() as u64);
                    for p in &got {
                        d.num(p.x);
                        d.num(p.y);
                    }
                }
            }
            std::hint::black_box(got);
        }
    }
    let digest = if want_digest {
        format!(",\"outcomeDigest\":\"{}\"", d.hex())
    } else {
        String::new()
    };
    println!(
        "{{\"impl\":\"rust\",\"mode\":\"paths\",\"runs\":{runs},\"queries\":{},\"mismatches\":{mismatches}{digest},\"queryUs\":{}}}",
        all.len(),
        quantiles(all)
    );
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let want_digest = args.iter().any(|a| a == "--digest");
    let pos: Vec<&String> = args[1..].iter().filter(|a| !a.starts_with("--")).collect();
    let name = pos.first().map_or("crowded_8", |s| s.as_str()).to_string();
    let runs: usize = pos.get(1).and_then(|v| v.parse().ok()).unwrap_or(20);
    if name == "paths" {
        paths(runs, want_digest);
        return;
    }
    let fx = rh_parity::load(&rh_parity::fixtures_dir().join(format!("{name}.json")));
    let mut all: Vec<f64> = Vec::new();
    let mut d = digest::OutcomeDigest::new();
    let mut final_hash = 0;
    for r in 0..runs + 3 {
        let mut sim = rh_parity::build(&fx);
        let mut inputs = fx.inputs.iter().peekable();
        for t in &fx.ticks {
            while let Some(i) = inputs.peek() {
                if i.tick > t.tick {
                    break;
                }
                let i = inputs.next().unwrap();
                if let Some(raw) = rh_parity::raw_command_pub(i) {
                    if let Ok(c) = rh_sim::validate(raw) {
                        let _ = sim.submit_unbudgeted(rh_parity::pid(&i.player), c);
                    }
                }
            }
            let t0 = Instant::now();
            let ev = sim.step();
            let us = t0.elapsed().as_secs_f64() * 1e6;
            if r == 0 && want_digest {
                d.tick(&sim, &ev);
            }
            std::hint::black_box(ev);
            if r >= 3 {
                all.push(us);
            }
            rh_parity::apply_actions(&mut sim, &fx, t.tick);
        }
        if r == 0 {
            final_hash = sim.state_hash();
        }
    }
    let digest = if want_digest {
        format!(",\"outcomeDigest\":\"{}\"", d.hex())
    } else {
        String::new()
    };
    println!(
        "{{\"impl\":\"rust\",\"scenario\":\"{name}\",\"runs\":{runs},\"ticks\":{},\"finalStateHash\":\"{final_hash:016x}\"{digest},\"stepUs\":{}}}",
        all.len(),
        quantiles(all)
    );
}
