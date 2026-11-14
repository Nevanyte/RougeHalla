//! P-SIM-LIVE-CONTENT-1 oracle (rh-headless half; the server half is `crates/rh-server/tests/live_content.rs`).
//!
//! (b) The Brain tournament world (`tournament_world(plan, SeatPolicy::Brain)`, used by the `tournament` and `tune`
//!     binaries) plays `SimConfig::live_content()` in every field, hitboxes included, except the plan's own timers
//!     (`lifecycle`, `min_players`, `lobby_seconds`, `fill_seconds` from `sim_config_for(plan)`). Compared as whole
//!     structs, so a new `SimConfig` field is compared by default.
//! (c) The next literal copy of the live content world fails a test: no non-test source under `crates/rh-headless/src`,
//!     `crates/rh-server/src` or `crates/rh-headless/examples` (added by P-FROST-WALL-3) writes a live-only content
//!     value (see [`LIVE_ONLY_MARKERS`]); those values belong to `SimConfig::live_content()` in `rh-sim`.
use rh_headless::tournament::{sim_config_for, TournamentPlan};
use rh_headless::tournament_learning::{tournament_world, SeatPolicy};
use rh_policy::bots::TierId;
use rh_sim::SimConfig;
use std::path::{Path, PathBuf};

fn plan() -> TournamentPlan {
    let mut plan = TournamentPlan::with_tiers(
        2,
        7,
        vec![TierId::Easy, TierId::Normal, TierId::Hard],
        3. * 60_000.,
    );
    // Non-default timers, so the plan's lifecycle visibly differs from the live one.
    plan.patience_seconds = Some(60.);
    plan.sudden_death_seconds = Some(20.);
    plan
}

#[test]
fn the_brain_tournament_world_is_live_content_with_the_plans_timers() {
    let plan = plan();
    let (_, sim) = tournament_world(&plan, SeatPolicy::Brain);
    let timers = sim_config_for(&plan);
    let expected = SimConfig {
        lifecycle: timers.lifecycle.clone(),
        min_players: timers.min_players,
        lobby_seconds: timers.lobby_seconds,
        fill_seconds: timers.fill_seconds,
        ..SimConfig::live_content()
    };
    assert_eq!(
        sim, expected,
        "the Brain world is SimConfig::live_content() except lifecycle, min_players, lobby_seconds and fill_seconds"
    );
}

#[test]
fn the_brain_tournament_world_plays_the_live_hitbox_mode() {
    let (_, sim) = tournament_world(&plan(), SeatPolicy::Brain);
    assert_eq!(
        sim.hitboxes,
        SimConfig::live_content().hitboxes,
        "the learner and the tuner play the hitboxes the live server plays"
    );
    assert_ne!(
        SimConfig::live_content(),
        SimConfig::default(),
        "live_content() is the live world, not the headless default"
    );
}

/// Content values that only the live content world writes. A config that writes one of them in source is a copy of the
/// live world; after this packet the only place they are written is `SimConfig::live_content()` in `rh-sim`.
const LIVE_ONLY_MARKERS: [&str; 4] = [
    "RegenInCombat::Off",
    "CampBuffRule::Themed",
    "EngagementHolyPlagueFireFrostSentencedFireRoam",
    "terrain::Mode::Map",
];

/// (file suffix, marker): sanctioned writes that are not copies of the live world.
/// `camp_bench.rs`: a camp measurement bench with its own world (regen off, quests off, hazards All, consumables off,
/// lifecycle Off); it uses the full faction set, not a live copy.
const ALLOWED: [(&str, &str); 1] = [(
    "rh-headless/src/bin/camp_bench.rs",
    "EngagementHolyPlagueFireFrostSentencedFireRoam",
)];

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .map(|e| e.unwrap().path())
        .collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            rust_files(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

/// Is this file test-only by name (`tests.rs`, `*_tests.rs`, or under a `tests/` directory inside `src`)? `shown` is
/// the path relative to `crates/`, so the checkout's own location never matters.
fn test_file(shown: &str) -> bool {
    let name = shown.rsplit('/').next().unwrap_or(shown);
    name == "tests.rs" || name.ends_with("_tests.rs") || shown.split('/').any(|c| c == "tests")
}

/// The code lines of a file: comments removed (`//` to end of line), and every `#[cfg(test)]` item (an inline
/// `mod … { … }` block, counted by braces) skipped.
fn code_lines(text: &str) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let mut skipping_test = false;
    let mut pending_cfg_test = false;
    let mut depth: i64 = 0;
    for (i, raw) in text.lines().enumerate() {
        let line = raw.split("//").next().unwrap_or("");
        let trimmed = line.trim();
        if skipping_test {
            depth += line.matches('{').count() as i64 - line.matches('}').count() as i64;
            if depth <= 0 {
                skipping_test = false;
            }
            continue;
        }
        if trimmed == "#[cfg(test)]" {
            pending_cfg_test = true;
            continue;
        }
        if pending_cfg_test && !trimmed.is_empty() {
            pending_cfg_test = false;
            let opens = line.matches('{').count() as i64;
            let closes = line.matches('}').count() as i64;
            if opens > closes {
                skipping_test = true;
                depth = opens - closes;
            }
            // A one-line test item (`mod foo_tests;`, `use …;`) is skipped as well.
            continue;
        }
        out.push((i + 1, line.to_owned()));
    }
    out
}

#[test]
fn no_source_outside_rh_sim_writes_the_live_content_values() {
    let crates = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut files = Vec::new();
    // P-FROST-WALL-3: the headless examples too (`source_soak.rs` and `full_map_cost.rs` were whole live copies).
    for dir in ["rh-headless/src", "rh-server/src", "rh-headless/examples"] {
        rust_files(&crates.join(dir), &mut files);
    }
    assert!(
        files.len() > 20,
        "the scan found the sources ({})",
        files.len()
    );
    let mut hits = Vec::new();
    for path in &files {
        let shown = path
            .strip_prefix(&crates)
            .expect("under crates/")
            .to_string_lossy()
            .replace('\\', "/");
        if test_file(&shown) {
            continue;
        }
        let text = std::fs::read_to_string(path).unwrap();
        for (n, line) in code_lines(&text) {
            for marker in LIVE_ONLY_MARKERS {
                if line.contains(marker)
                    && !ALLOWED
                        .iter()
                        .any(|(f, m)| shown.ends_with(f) && *m == marker)
                {
                    hits.push(format!("{shown}:{n}: {marker}"));
                }
            }
        }
    }
    assert!(
        hits.is_empty(),
        "live content values written outside SimConfig::live_content() (build on the constructor instead):\n{}",
        hits.join("\n")
    );
}

#[test]
fn guard_the_source_scan_sees_through_comments_and_test_modules() {
    let text = "\
fn a() {}
// RegenInCombat::Off in a comment
let x = 1; // CampBuffRule::Themed trailing
#[cfg(test)]
mod tests {
    fn t() { let _ = RegenInCombat::Off; }
    fn u() {
        terrain::Mode::Map;
    }
}
let live = RegenInCombat::Off;
";
    let lines = code_lines(text);
    let hits: Vec<usize> = lines
        .iter()
        .filter(|(_, l)| LIVE_ONLY_MARKERS.iter().any(|m| l.contains(m)))
        .map(|(n, _)| *n)
        .collect();
    assert_eq!(
        hits,
        vec![11],
        "only the code line outside the test module counts"
    );
}
