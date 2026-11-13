//! Soak: bot-only matches on a full rh-map/2 map with the live `--runtime source-arena` SimConfig (factions incl. Plague,
//! PvE mobs, quests, initial loot, source lifecycle). Panics surface the room-killing crash family.
//!
//!   cargo run --release -p rh-headless --example source_soak -- <map> <seed_from> <seed_to> [max_ticks] [legacy|archetypes]
//!
//! The last argument is the ADR0024 hitbox mode (default `legacy`; `archetypes` is the opt-in `--hitboxes archetypes`).
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::{
    abilities, mob_runtime::MobMode, terrain, ArenaMode, FactionId, FactionMode, SimConfig,
};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let arena = rh_headless::load_arena(&a[1]).unwrap();
    let (from, to): (u64, u64) = (a[2].parse().unwrap(), a[3].parse().unwrap());
    let max_ticks: u32 = a.get(4).map_or(12_000, |v| v.parse().unwrap());
    let hitboxes = match a.get(5).map(String::as_str) {
        None | Some("legacy") => rh_sim::archetype::HitboxMode::LegacyCircle,
        Some("archetypes") => rh_sim::archetype::HitboxMode::Archetypes,
        Some(other) => panic!("the hitbox mode must be legacy or archetypes, not {other:?}"),
    };
    for seed in from..to {
        let cfg = SimConfig {
            walk_hints: Some(true),
            regen: true,
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
            regen_in_combat: rh_sim::RegenInCombat::Off,
            camp_buffs: rh_sim::CampBuffRule::Themed,
            frost_wish: rh_sim::FrostWish::Freeze,
            ..SimConfig::default()
        };
        let agents = (0..8)
            .map(|i| AgentSpec {
                profile: format!("bot{i}"),
                faction: FactionId::ALL[(i + seed as usize) % 5],
                bot: true,
                // The live fill bots (rh-server room.rs seats HumanBot by tier and persona).
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
                arena: arena.clone(),
                sim: cfg,
                max_ticks,
                record: false,
            },
            agents,
            seed,
        );
        let mut ticks = 0u32;
        let (mut max_mobs, mut zombies) = (0, 0);
        let out = loop {
            let out = env.advance(&[]);
            ticks += 1;
            max_mobs = max_mobs.max(env.sim.mobs().len());
            zombies = zombies.max(env.sim.mobs().iter().filter(|m| m.zombie.is_some()).count());
            if out.terminated || out.truncated {
                break out;
            }
        };
        println!(
            "seed {seed} ({hitboxes:?}): ticks {ticks} terminated {} truncated {} maxMobs {max_mobs} maxZombies {zombies} hash {:016x}",
            out.terminated,
            out.truncated,
            env.sim.state_hash()
        );
    }
}
