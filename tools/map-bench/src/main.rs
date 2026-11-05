use rh_sim::mapgen::{
    coliseum::fixed_layout,
    map_hash::map_hash,
    pipeline::{Options, Pipeline},
};
use serde::Serialize;
use std::{hint::black_box, path::PathBuf, time::Instant};

#[derive(Serialize)]
struct Sample {
    seed: u32,
    attempt: u64,
    hash: String,
    elapsed_ns: u128,
}
#[derive(Serialize)]
struct Summary {
    median_ns: u128,
    p95_ns: u128,
    min_ns: u128,
    max_ns: u128,
}
#[derive(Serialize)]
struct Mode {
    options: &'static str,
    samples: Vec<Sample>,
    summary: Summary,
}

fn summary(samples: &[Sample]) -> Summary {
    let mut v: Vec<u128> = samples.iter().map(|s| s.elapsed_ns).collect();
    v.sort_unstable();
    Summary {
        median_ns: (v[19] + v[20]) / 2,
        p95_ns: v[((v.len() as f64 * 0.95).ceil() as usize).saturating_sub(1)],
        min_ns: v[0],
        max_ns: *v.last().unwrap(),
    }
}

fn verify_pin(pins: &serde_json::Value, mode: usize, seed: u32, attempt: u64, hash: &str) {
    let expected = format!("{seed}:{attempt}:{hash}");
    let pinned = pins[["plain", "styled"][mode]][seed as usize]
        .as_str()
        .unwrap();
    assert_eq!(
        expected,
        pinned,
        "{} seed {seed} differs from original pin",
        ["plain", "styled"][mode]
    );
}

fn main() {
    assert!(!cfg!(debug_assertions), "run --release");
    let state =
        PathBuf::from(std::env::var("RH_MAP_BENCH_STATE").expect("RH_MAP_BENCH_STATE must be set"));
    let pin_text = std::fs::read_to_string(state.join("pins.json")).expect("prepared pin snapshot");
    let pins: serde_json::Value = serde_json::from_str(&pin_text).unwrap();
    let fixed = fixed_layout();
    let pipeline = Pipeline::new(&fixed);
    let plain_options = Options {
        decor: false,
        ..Options::default()
    };
    let styled_options = Options {
        decor: false,
        ..Options::default()
    };
    let mut samples = [Vec::with_capacity(40), Vec::with_capacity(40)];
    let modes = ["plain", "styled"];

    // Warm the same reusable pipeline, outside recorded samples.
    for mode in 0..2 {
        for seed in 0..5_i64 {
            let map = if mode == 0 {
                pipeline.certified_plain(seed, plain_options)
            } else {
                pipeline.certified_styled(seed, styled_options)
            }
            .expect("map generation")
            .expect("certified map");
            verify_pin(&pins, mode, seed as u32, map.attempt, &map_hash(&map));
        }
    }

    for seed in 0..40_u32 {
        let order = if seed % 2 == 0 { [0, 1] } else { [1, 0] };
        for mode in order {
            let start = Instant::now();
            let generated = if mode == 0 {
                pipeline.certified_plain(seed as i64, plain_options)
            } else {
                pipeline.certified_styled(seed as i64, styled_options)
            };
            let elapsed_ns = start.elapsed().as_nanos();
            let map = generated.expect("map generation").expect("certified map");
            let hash = map_hash(&map);
            verify_pin(&pins, mode, seed, map.attempt, &hash);
            let sample = Sample {
                seed,
                attempt: map.attempt,
                hash,
                elapsed_ns,
            };
            samples[mode].push(black_box(sample));
        }
    }
    let mut result = serde_json::Map::new();
    for mode in 0..2 {
        let rows = std::mem::take(&mut samples[mode]);
        let summary = summary(&rows);
        result.insert(
            modes[mode].into(),
            serde_json::to_value(Mode {
                options: if mode == 0 {
                    "styleZones:null,decor:false,shapeGates:true,bushes:true"
                } else {
                    "default:styled,decor:false,shapeGates:true,bushes:true"
                },
                samples: rows,
                summary,
            })
            .unwrap(),
        );
    }
    println!("{}", serde_json::Value::Object(result));
}
