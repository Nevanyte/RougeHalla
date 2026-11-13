//! P-CAMP-BUFF-THEMES-1 oracle: the live profiles play zone-themed camp buffs (owner decision 2026-11-10, legacy
//! a7b5c4ce), while `SimConfig::default()` (tests, parity, benches) keeps the in-repo legacy roll.
use rh_server::runtime::Settings;
use rh_sim::{CampBuffRule, Secrets, Sim, SimConfig};

fn settings(args: &str) -> Settings {
    Settings::from_args(
        &args
            .split_whitespace()
            .map(str::to_owned)
            .collect::<Vec<_>>(),
    )
    .unwrap()
    .unwrap()
}

const SEED1: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    // The certified full map (camps, zones): `parity/maps/seed1.map.json` is the collision-only `rh-map/1` file the
    // source-arena runtime refuses (coordinator amendment 2026-11-12).
    "/../rh-sim/src/mapdata/fixtures/seed1.map.json"
);

#[test]
fn the_live_profiles_opt_into_themed_camp_buffs() {
    assert_eq!(SimConfig::default().camp_buffs, CampBuffRule::Legacy);
    let source = settings(&format!("--runtime source-arena --map {SEED1}"));
    assert_eq!(
        source.sim().camp_buffs,
        CampBuffRule::Themed,
        "source-arena plays the a7b5c4ce camp buffs"
    );
    // Legacy has no switch: the training room plays the same rule (it has no camps, so nothing is rolled).
    let training = settings("--runtime training");
    assert_eq!(training.sim().camp_buffs, CampBuffRule::Themed);

    // A world built from the live profile and map publishes one buff per camp, some off their zone's theme.
    let sim = Sim::try_new(source.sim(), source.arena().unwrap(), Secrets::from_seed(5))
        .expect("the live profile admits the seed1 map");
    assert!(!sim.camp_rosters().is_empty());
    assert_eq!(sim.camp_buffs().len(), sim.camp_rosters().len());
    assert!(sim.camp_buffs().iter().any(Option::is_some));
}
