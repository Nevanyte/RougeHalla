//! Times the Rust step() on a captured scenario's exact inputs (the workload parity/legacy-capture/bench.ts times through
//! the legacy TypeScript sim).   cargo run --release -p rh-parity --bin parity-bench -- [crowded_8] [runs]
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let name = args.get(1).cloned().unwrap_or_else(|| "crowded_8".into());
    let runs: usize = args.get(2).and_then(|v| v.parse().ok()).unwrap_or(20);
    let fx = rh_parity::load(&rh_parity::fixtures_dir().join(format!("{name}.json")));
    let mut all: Vec<f64> = Vec::new();
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
            std::hint::black_box(ev);
            if r >= 3 {
                all.push(us);
            }
            rh_parity::apply_actions(&mut sim, &fx, t.tick);
        }
    }
    all.sort_by(|a, b| a.total_cmp(b));
    let q = |p: f64| all[((all.len() as f64 * p) as usize).min(all.len() - 1)];
    let mean = all.iter().sum::<f64>() / all.len() as f64;
    println!(
        "{{\"impl\":\"rust\",\"scenario\":\"{name}\",\"runs\":{runs},\"ticks\":{},\"stepUs\":{{\"mean\":{mean:.2},\"p50\":{:.2},\"p99\":{:.2},\"max\":{:.2}}}}}",
        all.len(),
        q(0.5),
        q(0.99),
        all[all.len() - 1]
    );
}
