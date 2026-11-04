//! The differential gate: every `parity: "slice"` legacy fixture must replay identically through the Rust core.

use rh_parity::*;

#[test]
fn every_slice_fixture_matches_legacy() {
    let paths = fixture_paths("slice");
    assert!(paths.len() >= 8, "expected the captured slice fixtures, found {}", paths.len());
    let mut failed = Vec::new();
    for p in &paths {
        let fx = load(p);
        let rep = compare(&fx);
        eprintln!("{:<22} ticks {:>4} events {:>5} results {} max pos err {:.2e} max hp err {:.2e} {}", fx.scenario, rep.ticks, rep.events, rep.results, rep.max_pos_err, rep.max_hp_err, if rep.mismatches.is_empty() { "OK" } else { "MISMATCH" });
        if !rep.mismatches.is_empty() {
            failed.push(format!("{}:\n  {}", fx.scenario, rep.mismatches.join("\n  ")));
        }
    }
    assert!(failed.is_empty(), "parity failures:\n{}", failed.join("\n"));
}

#[test]
fn pathfinding_matches_legacy_on_a_generated_map() {
    let (n, bad) = compare_paths(&fixtures_dir().join("pathfinding_seed1.json"));
    assert_eq!(n, 300);
    assert!(bad.is_empty(), "path mismatches:\n{}", bad.join("\n"));
}

#[test]
fn a_changed_rule_is_caught() {
    // The harness must not hide a changed rule: fight the duel with another faction (other damage, other mitigation)
    // and the comparison must fail; replay the brawl under another secret order salt and it must fail too.
    let mut fx = load(&fixtures_dir().join("fists_duel.json"));
    fx.players[1].faction = "frost".into();
    assert!(!compare(&fx).mismatches.is_empty(), "a changed faction must change the outcome");
    let mut crowd = load(&fixtures_dir().join("crowded_8.json"));
    crowd.legacy_config.order_salt ^= 0x5555;
    assert!(!compare(&crowd).mismatches.is_empty(), "another action order must be detected");
}
