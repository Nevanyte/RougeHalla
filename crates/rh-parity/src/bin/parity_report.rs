//! cargo run -p rh-parity --bin parity-report : human-readable parity report over every fixture.
fn main() {
    let mut fail = false;
    for class in ["slice", "capture-only"] {
        for p in rh_parity::fixture_paths(class) {
            let fx = rh_parity::load(&p);
            if class != "slice" {
                println!(
                    "{:<22} capture-only ({} ticks): not in the Rust slice yet",
                    fx.scenario,
                    fx.ticks.len()
                );
                continue;
            }
            let r = rh_parity::compare(&fx);
            println!("{:<22} legacy {} | ticks {:>4} events {:>5} results {} | max pos err {:.2e} hp err {:.2e} | {}", fx.scenario, &fx.legacy_revision[..12.min(fx.legacy_revision.len())], r.ticks, r.events, r.results, r.max_pos_err, r.max_hp_err, if r.mismatches.is_empty() { "MATCH".to_string() } else { format!("MISMATCH x{}", r.mismatches.len()) });
            for m in r.mismatches.iter().take(5) {
                println!("    {m}");
            }
            fail |= !r.mismatches.is_empty();
        }
    }
    let (n, bad) =
        rh_parity::compare_paths(&rh_parity::fixtures_dir().join("pathfinding_seed1.json"));
    println!(
        "pathfinding_seed1      {n} queries | {}",
        if bad.is_empty() {
            "MATCH".into()
        } else {
            format!("MISMATCH x{}", bad.len())
        }
    );
    for m in bad.iter().take(3) {
        println!("    {m}");
    }
    std::process::exit(if fail || !bad.is_empty() { 1 } else { 0 });
}
