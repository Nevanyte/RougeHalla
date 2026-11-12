//! Server cost of one room on a full generated map against the beta's small map (P-MAP-3 follow-up): eight live-style fill
//! bots (`HumanBot`, as `rh-server` seats them) play the live `--runtime source-arena` rules (archetype hitboxes, no regen in
//! combat, every faction, PvE mobs, quests, terrain, initial loot, source lifecycle) on
//!
//! * `maps/first-playable.json` (48x40, 3 camps: the beta), and
//! * maps the server's pool would serve (`rh_server`'s `StyledMaker`: certified styled generation, decor off) for seeds
//!   `1..=N` (160x160, about 50 camps).
//!
//! Per tick it times `Env::advance` (every bot's observation and decision plus `Sim::step`), and it reads the process's
//! resident memory from `/proc/self/status`. It is NOT the whole server tick: wire encoding, the outbox and sockets are
//! outside it (`rh-server`'s `densitybench --map` measures those for one map file). Wall times are informational, from
//! whatever machine runs it.
//!
//!   cargo run --release -p rh-headless --example full_map_cost -- [generated_maps=3] [max_ticks=6000] [first-playable map]
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::{
    abilities, mob_runtime::MobMode, terrain, ArenaMode, FactionId, FactionMode, SimConfig,
};
use std::time::Instant;

fn rss_kib(field: &str) -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with(field))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse().ok())
        })
        .unwrap_or(0)
}

/// The live source-arena rules (`rh-server` `runtime.rs` `Settings::sim`), with eight seats filled by bots at once.
fn live_rules() -> SimConfig {
    SimConfig {
        walk_hints: Some(true),
        regen: true,
        regen_in_combat: rh_sim::RegenInCombat::Off,
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
        hitboxes: rh_sim::archetype::HitboxMode::Archetypes,
        ..SimConfig::default()
    }
}

fn generated(seed: u32) -> rh_sim::Arena {
    use rh_sim::mapgen::{coliseum, map_hash, pipeline};
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let options = pipeline::Options {
        decor: false,
        ..pipeline::Options::default()
    };
    let map = generator
        .certified_styled(i64::from(seed), options)
        .unwrap()
        .unwrap_or_else(|| panic!("seed {seed} certifies in no attempt"));
    let legacy_map_hash_u32 = u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap();
    rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32,
        map,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap()
}

fn run(label: &str, arena: rh_sim::Arena, seed: u64, max_ticks: u32, gen_ms: f64) {
    let (w, h) = (arena.map.w, arena.map.h);
    let camps = arena.map.layers().map_or(0, |l| l.data().camps.len());
    let rss_before = rss_kib("VmRSS:");
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
            sim: live_rules(),
            max_ticks,
            record: false,
        },
        agents,
        seed,
    );
    let mut us: Vec<f64> = Vec::with_capacity(max_ticks as usize + 1);
    let (mut max_mobs, mut max_actors) = (0usize, 0usize);
    let out = loop {
        let t0 = Instant::now();
        let out = env.advance(&[]);
        us.push(t0.elapsed().as_secs_f64() * 1e6);
        max_mobs = max_mobs.max(env.sim.mobs().len());
        max_actors = max_actors.max(env.sim.mobs().len() + env.sim.players().len());
        if out.terminated || out.truncated {
            break out;
        }
    };
    let rss_after = rss_kib("VmRSS:");
    let ticks = us.len();
    let total: f64 = us.iter().sum();
    let mut sorted = us.clone();
    sorted.sort_by(f64::total_cmp);
    let pct = |p: f64| sorted[((ticks as f64 - 1.) * p).round() as usize];
    let budget = rh_sim::constants::TICK_MS * 1000.;
    println!(
        "{{\"map\":\"{label}\",\"size\":\"{w}x{h}\",\"camps\":{camps},\"seed\":{seed},\"genMs\":{gen_ms:.1},\
\"ticks\":{ticks},\"terminated\":{},\"maxMobs\":{max_mobs},\"maxActors\":{max_actors},\
\"tickUsMean\":{:.1},\"tickUsP50\":{:.1},\"tickUsP99\":{:.1},\"tickUsMax\":{:.1},\
\"shareOfTickBudgetMean\":{:.4},\"roomsPerCoreAtMean\":{:.1},\
\"rssKibBefore\":{rss_before},\"rssKibAfter\":{rss_after},\"rssKibPeakProcess\":{}}}",
        out.terminated,
        total / ticks as f64,
        pct(0.5),
        pct(0.99),
        sorted[ticks - 1],
        total / ticks as f64 / budget,
        budget / (total / ticks as f64),
        rss_kib("VmHWM:"),
    );
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let generated_maps: u32 = a.get(1).map_or(3, |v| v.parse().unwrap());
    let max_ticks: u32 = a.get(2).map_or(6000, |v| v.parse().unwrap());
    let small = a
        .get(3)
        .cloned()
        .unwrap_or_else(|| "maps/first-playable.json".into());
    run(
        "first-playable",
        rh_headless::load_arena(&small).unwrap(),
        1,
        max_ticks,
        0.,
    );
    for seed in 1..=generated_maps {
        let t0 = Instant::now();
        let arena = generated(seed);
        let gen_ms = t0.elapsed().as_secs_f64() * 1e3;
        run(
            &format!("generated-{seed}"),
            arena,
            u64::from(seed),
            max_ticks,
            gen_ms,
        );
    }
}
