//! P-AUG-BOTS-1 oracle: `MatchStart` carries the room's elite rule (`SimConfig::elites`), so a bot reads the numbers the
//! world plays.
use rh_policy::MatchStart;
use rh_sim::{Arena, EliteRule, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

fn start(rule: EliteRule) -> MatchStart {
    let file: rh_sim::mapdata::MapExport = serde_json::from_str(include_str!(
        "../../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .expect("seed1 map");
    let arena: Arena = file.validate().unwrap().into_arena().unwrap();
    let sim = Sim::reset_active(
        SimConfig {
            quests: false,
            pvp_rules: false,
            elites: rule,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(7),
        &[Placement {
            profile: "bot".into(),
            faction: FactionId::Holy,
            bot: true,
            at: Vec2::new(500., 500.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    MatchStart::of(&sim, PlayerId(1), 7)
}

#[test]
fn match_start_carries_the_elite_rule() {
    assert_eq!(start(EliteRule::Rework).elites, EliteRule::Rework);
    assert_eq!(start(EliteRule::Legacy).elites, EliteRule::Legacy);
}
