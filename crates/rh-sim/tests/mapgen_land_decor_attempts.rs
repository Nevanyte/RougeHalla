//! P-LAND-DECOR-ERRORS-1 (land-generation lane; asked for by reviewer-opus on P-LAND-SENTENCED-1, 2026-11-13).
//!
//! With the landmark option on and decor on (the generator's default), no attempt of seeds 1-32 stops with a
//! generation error. This guards the generator's decor-on path; no production caller uses it with the landmark option
//! today (the server's pool runs with decor off, `StyledMaker::options` in `rh-server`'s `map_pool.rs`). A refused
//! attempt is legal (the next one is tried); an `Err` fails the whole call. The lane's
//! other tests run with decor only on the attempt that made the map of seeds 1-8, so each styler's `props` step (for
//! Sentenced, `validate_plan`, which reads the church's door again) was never run on an attempt that is refused
//! afterwards, nor on seeds 9-32.
//!
//! Nothing here pins a map, a hash, an attempt number or a count of refusals: only that every attempt answers and that
//! every seed makes a map within the attempt limit, so the sweep is known to have reached each seed's landing attempt.

use rh_sim::mapgen::{coliseum, pipeline};

/// The attempts tried per seed before the sweep calls the seed unmade (the lane's other tests bound the worst
/// accepted attempt index well below it).
fn attempt_limit() -> u64 {
    16
}

fn decor_options() -> pipeline::Options {
    pipeline::Options {
        signature: true,
        ..pipeline::Options::default()
    }
}

#[test]
fn no_attempt_of_seeds_1_to_32_stops_with_a_generation_error_with_decor_on() {
    assert!(
        decor_options().decor,
        "the default options are expected to have decor on"
    );
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let (mut errors, mut unmade) = (Vec::new(), Vec::new());
    let (mut attempts, mut refused) = (0_u32, 0_u32);
    for seed in 1..=32_i64 {
        let mut made = false;
        for n in 0..attempt_limit() {
            attempts += 1;
            match generator.styled_attempt_with_trace(seed, n, decor_options()) {
                Err(e) => errors.push(format!("seed {seed} attempt {n}: {e:?}")),
                Ok((report, _)) => {
                    if report.map.is_some() {
                        made = true;
                        break;
                    }
                    refused += 1;
                }
            }
        }
        if !made {
            unmade.push(seed);
        }
    }
    println!(
        "decor on, option on, seeds 1-32: {attempts} attempts, {refused} refused, {} errors, unmade seeds {unmade:?}",
        errors.len()
    );
    assert!(
        errors.is_empty(),
        "{} attempts stopped with a generation error:\n{}",
        errors.len(),
        errors.join("\n")
    );
    assert!(
        unmade.is_empty(),
        "seeds without a map in {} attempts: {unmade:?}",
        attempt_limit()
    );
}
