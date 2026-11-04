//! cargo run -p rh-parity --bin parity-report : human-readable parity report over every fixture.
//! The gate: every `slice` scenario MATCHes, `capture-only` scenarios are listed (not compared), and the 300 legacy
//! findPath queries MATCH. Exits 1 on any mismatch, any unreadable scenario fixture, or any JSON file in parity/fixtures
//! whose format is neither a scenario nor the pathfinding fixture (discovery is loud: nothing leaves the gate unseen).
fn main() {
    let mut fail = false;
    let (mut slice, mut capture_only) = (0, 0);
    let files = rh_parity::discover(&rh_parity::fixtures_dir());
    for m in files.problems() {
        println!("UNRECOGNISED {m}");
        fail = true;
    }
    for p in files.scenarios {
        let text = std::fs::read_to_string(&p).expect("fixture");
        let fx = match rh_parity::parse(&text) {
            Ok(fx) => fx,
            Err(e) => {
                println!("{} UNREADABLE: {e}", p.display());
                fail = true;
                continue;
            }
        };
        if fx.parity == "capture-only" {
            capture_only += 1;
            println!(
                "{:<22} capture-only ({} ticks): not in the Rust slice yet",
                fx.scenario,
                fx.ticks.len()
            );
            continue;
        }
        // Anything else is compared (an unknown class fails its preconditions).
        slice += 1;
        let r = rh_parity::compare(&fx);
        println!("{:<22} legacy {} | ticks {:>4} events {:>5} results {} | max pos err {:.2e} hp err {:.2e} | {}", fx.scenario, &fx.legacy_revision[..12.min(fx.legacy_revision.len())], r.ticks, r.events, r.results, r.max_pos_err, r.max_hp_err, if r.mismatches.is_empty() { "MATCH".to_string() } else { format!("MISMATCH x{}", r.mismatches.len()) });
        for m in r.mismatches.iter().take(5) {
            println!("    {m}");
        }
        fail |= !r.mismatches.is_empty();
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
    fail |= !bad.is_empty();
    println!(
        "{slice} slice scenarios + {capture_only} capture-only, {n} pathfinding queries{}: {}",
        if files.unrecognised.is_empty() {
            String::new()
        } else {
            format!(", {} unrecognised files", files.unrecognised.len())
        },
        if fail { "FAIL" } else { "all MATCH" }
    );
    std::process::exit(if fail { 1 } else { 0 });
}
