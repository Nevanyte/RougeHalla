//! Full-map soak with the live `--runtime source-arena` configuration (rh-server runtime.rs `Settings::sim`) and the live
//! fill bots (HumanBot): every faction seated, so Plague zombies are raised and removed mid-match. Seeds 6, 17, 28, 42 and
//! 62 panicked the room in the ledger pass before the stale-victim-slot fix (World::core "len is N but the index is N").
//! ADR0024: the same seeds also run with `SimConfig::hitboxes = Archetypes` (the opt-in `--hitboxes archetypes` live mode):
//! no panic, no hang, deterministic. Ignored by default (about a minute per mode in a debug build):
//!   cargo test --release -p rh-headless --test source_arena_soak -- --ignored
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::archetype::HitboxMode;
use rh_sim::{
    abilities, mob_runtime::MobMode, terrain, ArenaMode, FactionId, FactionMode, SimConfig,
};

fn live_config(hitboxes: HitboxMode) -> SimConfig {
    SimConfig {
        walk_hints: Some(true),
        regen: true,
        // As the live profile (runtime.rs `Settings::sim`, P-REGEN-COMBAT-1): passive regeneration out of combat only.
        regen_in_combat: rh_sim::RegenInCombat::Off,
        camp_buffs: rh_sim::CampBuffRule::Legacy,
        quests: true,
        hazards: terrain::Mode::Map,
        abilities: abilities::Mode::Full,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        lifecycle: ArenaMode::Source(Default::default()),
        mob_mode: MobMode::Pve,
        initial_loot: true,
        consumables: true,
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        hitboxes,
        ..SimConfig::default()
    }
}

fn run(hitboxes: HitboxMode, seed: u64, max_ticks: u32) -> (u32, u64) {
    let arena = rh_headless::load_arena(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .unwrap();
    let agents = (0..8)
        .map(|i| AgentSpec {
            profile: format!("bot{i}"),
            faction: FactionId::ALL[(i + seed as usize) % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(rh_policy::bots::HumanBot::new(
                    rh_policy::bots::TierId::ALL[(i + seed as usize) % 3],
                    rh_policy::bots::PersonaId::ALL[i % 4],
                )),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim: live_config(hitboxes),
            max_ticks,
            record: false,
        },
        agents,
        seed,
    );
    let mut ticks = 0;
    loop {
        let out = env.advance(&[]);
        ticks += 1;
        if out.terminated || out.truncated {
            return (ticks, env.sim.state_hash());
        }
    }
}

#[test]
#[ignore = "full-map soak; run with --ignored (release recommended)"]
fn full_map_bot_matches_with_zombie_churn_run_to_completion_deterministically() {
    for seed in [6, 17, 28, 42, 62] {
        let a = run(HitboxMode::LegacyCircle, seed, 6000);
        assert_eq!(
            a,
            run(HitboxMode::LegacyCircle, seed, 6000),
            "seed {seed} is deterministic"
        );
    }
}

#[test]
#[ignore = "full-map soak; run with --ignored (release recommended)"]
fn full_map_bot_matches_with_archetype_hitboxes_run_to_completion_deterministically() {
    for seed in [6, 17, 28, 42, 62] {
        let a = run(HitboxMode::Archetypes, seed, 6000);
        assert_eq!(
            a,
            run(HitboxMode::Archetypes, seed, 6000),
            "seed {seed} is deterministic"
        );
    }
}
