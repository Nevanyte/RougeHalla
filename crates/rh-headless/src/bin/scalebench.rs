//! Scaling of the sim with the number of fighters: how a step, an observation and a public snapshot grow from a lobby of
//! eight to the 212 actors a crowded arena may hold, and past it.
//!
//!   cargo run --release -p rh-headless --features bench --bin scalebench -- step <N> [ticks]
//!       N fighters packed in a disc around the arena centre (every one in reach of several others), nobody able to die,
//!       a deterministic input stream: attack presses and releases every tick and a new move order every 16th tick per
//!       fighter. Prints per step and per fighter the sim's cost (wall time of `Sim::step_into` only: noise, use callgrind
//!       for counts), plus the work done (hits per tick: the ledger's entries) so a cost per entry can be derived.
//!   cargo run --release -p rh-headless --features bench --bin scalebench -- observe <N> [reps]
//!       one viewer's `observe` and one `public_snapshot` over N synthetic actors, per call and per actor.
//!
//! Deterministic counts: run the same arguments under `valgrind --tool=callgrind --toggle-collect='*step_into*'` (or
//! `*observe*`) at two tick counts and divide the difference. The fighters come from `Sim::synthetic` (rh-sim feature
//! `bench`): `MAX_PLAYERS` stays the cap of the real API.
use rh_sim::{
    arenas::practice_arena, observe, public_snapshot, validate, Event, FactionId, Placement,
    RawCommand, Secrets, Sim, SimConfig, Vec2,
};
use std::time::Instant;

/// Fighters never die: the load is the same on the last tick as on the first.
const HP: f64 = 1.0e12;

fn xorshift(state: &mut u64) -> u64 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    x
}

fn unit(state: &mut u64) -> f64 {
    (xorshift(state) >> 11) as f64 / (1u64 << 53) as f64
}

/// `n` fighters on rings around the centre, 22 u apart (a fist reaches farther than that: contacts everywhere).
fn placements(n: usize, centre: Vec2) -> Vec<Placement> {
    let mut out = Vec::with_capacity(n);
    let mut ring = 0usize;
    while out.len() < n {
        let r = ring as f64 * 22.0;
        let slots = if ring == 0 { 1 } else { ring * 6 };
        for k in 0..slots {
            if out.len() == n {
                break;
            }
            let a = std::f64::consts::TAU * k as f64 / slots as f64;
            out.push(Placement {
                profile: format!("s{}", out.len()),
                faction: FactionId::ALL[out.len() % FactionId::ALL.len()],
                bot: true,
                at: Vec2::new(centre.x + r * a.cos(), centre.y + r * a.sin()),
                hp: Some(HP),
            });
        }
        ring += 1;
    }
    out
}

fn build(n: usize, seed: u64) -> Sim {
    let arena = practice_arena();
    let centre = arena.centre();
    Sim::synthetic(
        SimConfig::default(),
        arena,
        Secrets::from_seed(seed),
        &placements(n, centre),
    )
}

fn quantiles(mut all: Vec<f64>) -> (f64, f64, f64) {
    all.sort_by(|a, b| a.total_cmp(b));
    let mean = all.iter().sum::<f64>() / all.len().max(1) as f64;
    let q = |p: f64| all[((all.len() as f64 * p) as usize).min(all.len() - 1)];
    (mean, q(0.5), q(0.99))
}

fn step(n: usize, ticks: u32) {
    let mut sim = build(n, 1);
    let ids: Vec<_> = sim.players().iter().map(|p| p.id).collect();
    let mut rngs: Vec<u64> = ids
        .iter()
        .map(|id| 0x9e37_79b9_7f4a_7c15 ^ (id.0 as u64).wrapping_mul(0xbf58_476d_1ce4_e5b9))
        .collect();
    let (w, h) = (
        sim.arena().map.w as f64 * 32.0,
        sim.arena().map.h as f64 * 32.0,
    );
    let mut ev = Vec::new();
    let (mut hits, mut swings) = (0u64, 0u64);
    let mut times = Vec::with_capacity(ticks as usize);
    // The first steps size every buffer to its high-water mark: they are run, never timed.
    let warmup = 8u32;
    for t in 0..ticks + warmup {
        for (i, id) in ids.iter().enumerate() {
            let rng = &mut rngs[i];
            let a = unit(rng) * std::f64::consts::TAU - std::f64::consts::PI;
            let cmd = if unit(rng) < 0.5 {
                RawCommand::Attack { a, t: None }
            } else {
                RawCommand::Release { a, t: None }
            };
            if let Ok(c) = validate(cmd) {
                let _ = sim.submit_unbudgeted(*id, c);
            }
            if (t as usize + i) % 16 == 0 {
                let (gx, gy) = (w * (0.35 + 0.3 * unit(rng)), h * (0.35 + 0.3 * unit(rng)));
                if let Ok(c) = validate(RawCommand::Move {
                    x: gx,
                    y: gy,
                    seq: None,
                }) {
                    let _ = sim.submit_unbudgeted(*id, c);
                }
            }
        }
        ev.clear();
        let t0 = Instant::now();
        sim.step_into(&mut ev);
        let us = t0.elapsed().as_secs_f64() * 1e6;
        if t >= warmup {
            times.push(us);
            for e in &ev {
                match e {
                    Event::Hit { .. } => hits += 1,
                    Event::Swing { .. } => swings += 1,
                    _ => {}
                }
            }
        }
    }
    let standing = sim.players().iter().filter(|p| p.standing()).count();
    let (mean, p50, p99) = quantiles(times);
    println!(
        "{{\"mode\":\"step\",\"n\":{n},\"ticks\":{ticks},\"standing\":{standing},\"hits\":{hits},\"swings\":{swings},\
\"hitsPerTick\":{:.2},\"stepUs\":{{\"mean\":{mean:.2},\"p50\":{p50:.2},\"p99\":{p99:.2}}},\
\"usPerFighter\":{:.4},\"finalStateHash\":\"{:016x}\"}}",
        hits as f64 / ticks.max(1) as f64,
        mean / n as f64,
        sim.state_hash()
    );
}

fn observe_bench(n: usize, reps: usize) {
    let mut sim = build(n, 1);
    let mut ev = Vec::new();
    for _ in 0..5 {
        ev.clear();
        sim.step_into(&mut ev);
    }
    let viewer = sim.players()[0].id;
    let mut seen = 0usize;
    let t0 = Instant::now();
    for _ in 0..reps {
        seen += observe(&sim, viewer, &ev).visible.len();
    }
    let obs_ns = t0.elapsed().as_secs_f64() * 1e9 / reps as f64;
    let mut listed = 0usize;
    let t0 = Instant::now();
    for _ in 0..reps {
        listed += public_snapshot(&sim).players.len();
    }
    let pub_ns = t0.elapsed().as_secs_f64() * 1e9 / reps as f64;
    println!(
        "{{\"mode\":\"observe\",\"n\":{n},\"reps\":{reps},\"visible\":{},\"observeNs\":{obs_ns:.0},\"observeNsPerActor\":{:.1},\
\"publishNs\":{pub_ns:.0},\"publishNsPerActor\":{:.1},\"listed\":{}}}",
        seen / reps.max(1),
        obs_ns / n as f64,
        pub_ns / n as f64,
        listed / reps.max(1)
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let num = |i: usize, d: usize| args.get(i).and_then(|v| v.parse().ok()).unwrap_or(d);
    match args.first().map(String::as_str) {
        Some("step") => step(num(1, 32), num(2, 200) as u32),
        Some("observe") => observe_bench(num(1, 204), num(2, 200)),
        _ => {
            eprintln!("usage: scalebench step <N> [ticks] | observe <N> [reps]");
            std::process::exit(2);
        }
    }
}
