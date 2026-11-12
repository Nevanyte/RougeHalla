//! fix-bot-loot: live fill bots (HumanBot) on the full source-arena map pick up weapons and answer reward chests through
//! the ordinary seat intake (resolve + validate + submit). Counts every resolved Pickup/Choose a bot submitted, from the
//! recorded replay inputs. Ignored by default (a full match); run with:
//!   cargo test --release -p rh-headless --test bot_loot -- --ignored --nocapture
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::replay::ReplayInput;
use rh_sim::{
    abilities, mob_runtime::MobMode, terrain, ArenaMode, FactionId, FactionMode, SimConfig,
};

fn live_config() -> SimConfig {
    SimConfig {
        walk_hints: Some(true),
        regen: true,
        quests: true,
        hazards: terrain::Mode::All,
        abilities: abilities::Mode::Full,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        lifecycle: ArenaMode::Source(Default::default()),
        mob_mode: MobMode::Pve,
        initial_loot: true,
        consumables: true,
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        ..SimConfig::default()
    }
}

#[derive(Debug, Default, PartialEq)]
struct Counts {
    pickup: u32,
    missing_pickup: u32,
    choose: u32,
    choose_unresolved: u32,
    armed_bots: usize,
}

fn run(seed: u64) -> Counts {
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
            sim: live_config(),
            max_ticks: 6000,
            record: true,
        },
        agents,
        seed,
    );
    let mut armed = std::collections::BTreeSet::new();
    let mut tick = 0u32;
    loop {
        let out = env.advance(&[]);
        tick += 1;
        if tick % 50 == 0 {
            let ids: Vec<_> = env.sim.players().iter().map(|p| p.id).collect();
            for id in ids {
                let obs = rh_sim::observe(&env.sim, id, &[]);
                if obs
                    .inventory
                    .is_some_and(|inv| inv.slots.iter().any(Option::is_some))
                {
                    armed.insert(id);
                }
            }
        }
        if out.terminated || out.truncated {
            break;
        }
    }
    let replay = env.into_replay().expect("recorded");
    let mut c = Counts {
        armed_bots: armed.len(),
        ..Counts::default()
    };
    for input in replay.ticks.iter().flat_map(|t| &t.inputs) {
        let ReplayInput::Command { cmd, .. } = input else {
            continue;
        };
        let v = serde_json::to_value(cmd).unwrap();
        if v == "MissingPickup" {
            c.missing_pickup += 1;
        } else if v.get("Pickup").is_some() {
            c.pickup += 1;
        } else if let Some(choose) = v.get("Choose") {
            if choose["chest_id"].is_null() {
                c.choose_unresolved += 1;
            } else {
                c.choose += 1;
            }
        }
    }
    c
}

#[test]
#[ignore = "full-map match; run with --ignored (release recommended)"]
fn live_fill_bots_pick_up_weapons_and_choose_chest_rewards() {
    let mut total = Counts::default();
    for seed in [6, 42] {
        let c = run(seed);
        println!("seed {seed}: {c:?}");
        assert_eq!(c, run(seed), "seed {seed} is deterministic");
        total.pickup += c.pickup;
        total.missing_pickup += c.missing_pickup;
        total.choose += c.choose;
        total.choose_unresolved += c.choose_unresolved;
        total.armed_bots += c.armed_bots;
    }
    println!("total: {total:?}");
    assert!(total.pickup > 0, "bots submitted resolved pickups");
    assert!(total.choose > 0, "bots submitted resolved reward choices");
    assert!(total.armed_bots > 0);
}
