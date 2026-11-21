//! Elite mode of `camp_bench` (packet P-ELITE-BENCH-1): how often a minute-5 build dies soloing an elite camp under the
//! Rework rules, plus the sampler that produces those builds.
//!
//! This file is compiled twice: by `src/bin/camp_bench.rs` under `--features elite-bench` (which turns on rh-sim's
//! `trusted-build-setup`), and by `tests/elite_bench.rs` through `#[path]`, where rh-sim's dev-dependency features
//! provide the same API. It must not be added to `lib.rs` (rh-server depends on rh-headless).
#[path = "elite_bench/duelist.rs"]
mod duelist;

use duelist::Duelist;
use rh_headless::{load_arena, Agent, AgentSpec, Env, EnvConfig};
use rh_policy::scripted::Brawler;
use rh_policy::{MatchStart, Policy};
use rh_sim::cards::CardId;
use rh_sim::events::Event;
use rh_sim::mob_catalog::{elites_of, normal_types_of, MobTypeId};
use rh_sim::reward_chests::BoostId;
use rh_sim::trusted_build::{apply, TrustedBuild};
use rh_sim::{
    Arena, ArenaMode, FactionId, Placement, PlayerId, PublicCommand, Secrets, Sim, SimConfig, Vec2,
    WeaponId,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ops::Range;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// Minute 5 at 20 Hz.
pub const MINUTE5_TICK: u32 = 6000;
/// The checked-in sample, relative to the repository root.
pub const SAMPLE_PATH: &str = "tools/balance-camps/minute5_builds.json";

/// One bot's build at the sample tick.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuildSample {
    pub seed: u64,
    pub bot: u32,
    /// `FactionId::as_str` of the bot's faction.
    pub faction: String,
    pub build: TrustedBuild,
}

/// The sample file (`SAMPLE_PATH`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SampleFile {
    pub version: u32,
    pub tick: u32,
    /// Map path as given to `source_soak`, relative to the repository root.
    pub map: String,
    /// Half-open range of match seeds tried.
    pub seeds: [u64; 2],
    /// Seeds whose match ended before `tick` (they contribute no builds).
    pub ended_early: Vec<u64>,
    /// In (seed, bot) order.
    pub builds: Vec<BuildSample>,
}

const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
/// The map the sampler and the bench use, relative to the repository root.
const MAP_REL: &str = "crates/rh-sim/src/mapdata/fixtures/seed1.map.json";
/// Start distance of the fighter from the camp (as `camp_bench`): 10 tiles, then shorter fallbacks.
const START_DIST: f64 = 320.;
const CAVEAT: &str = "Two scripted fighters, neither a player. The Brawler is an upper bound (no abilities, no kiting, \
swings from 80 u whatever the weapon, no heals), so its death rates are biased high. The duelist is nearer to a player: it \
walks to its camp, uses its weapon range (melee closes to reach, ranged weapons stand and shoot at about 80% of range) and \
casts its Wish when ready, but it never retreats and does not read dodges, so its rates remain biased upward. The ci95 is \
the Wilson interval of deaths over engaged fights: its spread is over faction x weapon x seed within the seeds run, with one \
camp placement per elite kind (the map is fixed; the world seed varies the fight and the banked draw, not where camps are). \
The headline rate (died / engaged) counts truncated fights as non-deaths, so the decided rate (died / (died + cleared)) \
is printed beside it. A fighting mob gives up after 20 s without hitting a player and regenerates to full in 2 s (the \
legacy give-up rule), so a fighter that kites resets the camp: the duelist stands and shoots at 0.8 of its range and never \
steps back, and each cell's resets counts the camps' give-ups (legacy behaviour, not a sim defect). \
Fights that never touched the camp are no_engage and fights cut off by the tick cap are truncated: both are counted, not \
hidden, and a truncated fight is a non-death, so kiting weapons can understate deaths. Banked builds hold no cards, so the \
bots' misvaluing of reworked cards (until P-AUG-BOTS-1) does not enter; the bot_sample column does carry it, and only \
from matches that reached minute 5 (survivorship). Until P-ELITE-TUNE-1 the table is a baseline.";

fn root_path(p: &str) -> std::path::PathBuf {
    std::path::Path::new(ROOT).join(p)
}

/// The live world with the overrides a lone fighter needs: no match lifecycle, no regen, no quests, one-player lobby.
fn config() -> SimConfig {
    SimConfig {
        lifecycle: ArenaMode::Off,
        regen: false,
        quests: false,
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        ..SimConfig::live_content()
    }
}

/// Plays `source_soak`-style live matches (8 `HumanBot`s, `SimConfig::live_content()`) for each seed and reads every
/// bot's build at `tick`. Deterministic.
pub fn sample_builds(map: &str, seeds: Range<u64>, tick: u32) -> Result<SampleFile, String> {
    let arena = load_arena(map)?;
    let map_field = map
        .find("crates/rh-sim/")
        .map_or(map, |i| &map[i..])
        .to_string();
    let mut out = SampleFile {
        version: 1,
        tick,
        map: map_field,
        seeds: [seeds.start, seeds.end],
        ended_early: Vec::new(),
        builds: Vec::new(),
    };
    let mobs: Vec<MobTypeId> = FactionId::ALL
        .into_iter()
        .flat_map(|z| normal_types_of(z).map(|t| t.id))
        .collect();
    for seed in seeds {
        let cfg = SimConfig {
            min_players: 1,
            lobby_seconds: 5.,
            fill_seconds: 3.,
            ..SimConfig::live_content()
        };
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
                arena: arena.clone(),
                sim: cfg,
                max_ticks: tick.max(12_000),
                record: false,
            },
            agents,
            seed,
        );
        let mut ended = false;
        for t in 1..=tick {
            let p = env.advance(&[]);
            if (p.terminated || p.truncated) && t < tick {
                ended = true;
                break;
            }
        }
        if ended {
            out.ended_early.push(seed);
            continue;
        }
        for (bot, p) in env.sim.players().iter().enumerate() {
            if !p.standing() {
                continue;
            }
            let counts = p.build.counts();
            let boosts = p.build.boosts();
            out.builds.push(BuildSample {
                seed,
                bot: bot as u32,
                faction: p.faction().as_str().to_string(),
                build: TrustedBuild {
                    cards: CardId::ALL
                        .into_iter()
                        .filter(|c| counts[c.index()] > 0)
                        .map(|c| (c, counts[c.index()]))
                        .collect(),
                    stacks: mobs
                        .iter()
                        .filter(|&&m| p.farm.count(m) > 0)
                        .map(|&m| (m, p.farm.count(m)))
                        .collect(),
                    boosts: BoostId::ALL
                        .into_iter()
                        .filter(|b| boosts[b.index()] > 0)
                        .map(|b| (b, boosts[b.index()]))
                        .collect(),
                },
            });
        }
    }
    Ok(out)
}

/// What a run prints: the JSON report (stdout) and the readable table (stderr).
pub struct Output {
    pub json: String,
    pub table: String,
}

#[derive(Serialize)]
struct CellOut {
    faction: String,
    weapon: String,
    kind: String,
    zone: String,
    elite: bool,
    seed: u64,
    camp: u32,
    fighter: &'static str,
    column: String,
    camps: Option<u32>,
    build_index: Option<usize>,
    build_applied_tick: u32,
    start_dist: f64,
    outcome: &'static str,
    engaged: bool,
    ticks: u32,
    first_hit_tick: Option<u32>,
    hp_start: f64,
    hp_remaining: f64,
    damage_dealt: f64,
    damage_taken: f64,
    actions: BTreeMap<String, u64>,
    attack_ticks: u32,
    attack_dist_mean: Option<f64>,
    resets: u64,
}
#[derive(Serialize)]
struct SkipOut {
    faction: String,
    weapon: String,
    kind: String,
    seed: u64,
}
#[derive(Serialize)]
struct ColumnOut {
    column: String,
    camps: Option<u32>,
    samples: u64,
    engaged: u64,
    deaths: u64,
    cleared: u64,
    truncated: u64,
    no_engage: u64,
    decided: u64,
    death_rate: Option<f64>,
    clear_rate: Option<f64>,
    ci95: Option<[f64; 2]>,
    decided_rate: Option<f64>,
    decided_ci95: Option<[f64; 2]>,
}
#[derive(Serialize)]
struct WeaponRow {
    fighter: &'static str,
    weapon: String,
    #[serde(flatten)]
    column: ColumnOut,
}
#[derive(Serialize)]
struct PerCamp {
    kind: String,
    zone: String,
    samples: u64,
    deaths: u64,
    death_rate: Option<f64>,
    columns: Vec<ColumnOut>,
}
#[derive(Serialize)]
struct Overall {
    samples: u64,
    deaths: u64,
    death_rate: Option<f64>,
    columns: Vec<ColumnOut>,
}
#[derive(Serialize)]
struct UpperBound {
    fighter: &'static str,
    per_camp: Vec<PerCamp>,
    overall: Overall,
}
#[derive(Serialize)]
struct Rules {
    elites: &'static str,
    augments: &'static str,
}
#[derive(Serialize)]
struct BuildsOut {
    source: String,
    tick: u32,
    count: usize,
}
#[derive(Serialize)]
struct Report {
    version: u32,
    mode: &'static str,
    quick: bool,
    max_ticks: u32,
    config: &'static str,
    rules: Rules,
    solo: bool,
    caveat: &'static str,
    fighter: &'static str,
    reference_fighter: &'static str,
    reference: String,
    builds: BuildsOut,
    cells: Vec<CellOut>,
    skipped: Vec<SkipOut>,
    per_camp: Vec<PerCamp>,
    overall: Overall,
    #[serde(skip_serializing_if = "Option::is_none")]
    upper_bound: Option<UpperBound>,
    by_weapon: Vec<WeaponRow>,
}

struct Scene {
    camp: u32,
    start: Vec2,
    dist: f64,
    /// Centroid of the camp's members at world creation, and their mob types (what the duelist is told).
    centre: Vec2,
    types: Vec<MobTypeId>,
}

fn floor_line(arena: &Arena, a: Vec2, b: Vec2) -> bool {
    (0..=40).all(|i| {
        let t = i as f64 / 40.;
        let x = a.x + (b.x - a.x) * t;
        let y = a.y + (b.y - a.y) * t;
        arena
            .map
            .is_floor(rh_sim::map::world_to_tile(x), rh_sim::map::world_to_tile(y))
    })
}

/// The first camp rolling this elite, and a floor start point near it (as `camp_bench`).
fn scene_for(probe: &Sim, arena: &Arena, elite: MobTypeId) -> Option<Scene> {
    let rosters = probe.camp_rosters();
    let camp = rosters.iter().position(|r| r.elite == Some(elite))? as u32;
    let members: Vec<(Vec2, Option<MobTypeId>)> = probe
        .mobs()
        .iter()
        .filter(|m| m.camp == camp && m.zombie.is_none())
        .map(|m| (m.core.pos(), m.mob_type))
        .collect();
    if members.is_empty() {
        return None;
    }
    let n = members.len() as f64;
    let centre = Vec2::new(
        members.iter().map(|p| p.0.x).sum::<f64>() / n,
        members.iter().map(|p| p.0.y).sum::<f64>() / n,
    );
    let mut types: Vec<MobTypeId> = Vec::new();
    for t in members.iter().filter_map(|m| m.1) {
        if !types.contains(&t) {
            types.push(t);
        }
    }
    for dist in [START_DIST, 256., 192., 128.] {
        for k in 0..16 {
            let a = k as f64 * std::f64::consts::TAU / 16.;
            let p = Vec2::new(centre.x + a.cos() * dist, centre.y + a.sin() * dist);
            if floor_line(arena, p, centre) {
                return Some(Scene {
                    camp,
                    start: p,
                    dist,
                    centre,
                    types,
                });
            }
        }
    }
    None
}

/// Which scripted fighter a fight seats.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Who {
    Duelist,
    Brawler,
}
impl Who {
    fn name(self) -> &'static str {
        match self {
            Who::Duelist => "duelist",
            Who::Brawler => "brawler",
        }
    }
}

struct Fought {
    outcome: &'static str,
    engaged: bool,
    ticks: u32,
    first_hit: Option<u32>,
    hp_start: f64,
    hp_left: f64,
    dealt: f64,
    taken: f64,
    actions: BTreeMap<String, u64>,
    attack_ticks: u32,
    attack_dist_mean: Option<f64>,
    resets: u64,
}

/// The variant name of a command (`Move`, `Attack`, `Cast`, ...), as submitted.
fn kind_name(c: &PublicCommand) -> String {
    let d = format!("{c:?}");
    let end = d
        .find(|ch: char| !ch.is_ascii_alphanumeric())
        .unwrap_or(d.len());
    d[..end].to_string()
}

#[allow(clippy::too_many_arguments)]
fn fight(
    arena: &Arc<Arena>,
    seed: u64,
    faction: FactionId,
    weapon: WeaponId,
    scene: &Scene,
    build: Option<&TrustedBuild>,
    max_ticks: u32,
    who: Who,
) -> Result<Fought, String> {
    let placement = [Placement {
        profile: "fighter".into(),
        faction,
        bot: false,
        at: scene.start,
        hp: None,
        weapon0: Some(weapon),
        weapon1: None,
    }];
    let mut sim = Sim::reset_active(
        config(),
        arena.clone(),
        Secrets::from_seed(seed),
        &placement,
    );
    let me: PlayerId = sim.players()[0].id;
    if let Some(b) = build {
        apply(&mut sim, me, b).map_err(|e| format!("a sampled build was refused: {e:?}"))?;
    }
    let hp_start = sim.players()[0].vitals.hp;
    // The camp's members (ids), for engagement: damage between the fighter and one of them.
    let members: Vec<PlayerId> = sim
        .mobs()
        .iter()
        .filter(|m| m.camp == scene.camp && m.zombie.is_none())
        .map(|m| m.core.id)
        .collect();
    let mut policy: Box<dyn Policy> = match who {
        Who::Brawler => Box::new(Brawler::new(1)),
        Who::Duelist => Box::new(Duelist::new(scene.centre, scene.types.clone(), config())),
    };
    policy.reset(&MatchStart::of(&sim, me, seed));
    let (mut env, mut obs) = Env::from_external_checkpoint(sim, max_ticks).expect("checkpoint");
    let mut m = Fought {
        outcome: "truncated",
        engaged: who == Who::Brawler,
        ticks: max_ticks,
        first_hit: None,
        hp_start,
        hp_left: hp_start,
        dealt: 0.,
        taken: 0.,
        actions: BTreeMap::new(),
        attack_ticks: 0,
        attack_dist_mean: None,
        resets: 0,
    };
    let mut was_engaged: Vec<bool> = members
        .iter()
        .map(|id| {
            env.sim
                .mobs()
                .iter()
                .any(|b| b.core.id == *id && b.engaged())
        })
        .collect();
    let mut dist_sum = 0.;
    let mut touched = false;
    let mut healed = 0.;
    for tick in 1..=max_ticks {
        let cmds = policy.decide(&obs[0]);
        for c in &cmds {
            *m.actions.entry(kind_name(c)).or_default() += 1;
        }
        if cmds
            .iter()
            .any(|c| matches!(c, PublicCommand::Attack { .. }))
        {
            if let Some(p) = &obs[0].me {
                // Sim truth: the nearest living member of the target camp.
                let d = env
                    .sim
                    .mobs()
                    .iter()
                    .filter(|b| {
                        b.camp == scene.camp
                            && b.zombie.is_none()
                            && b.status == rh_sim::state::Status::Alive
                    })
                    .map(|b| {
                        let q = b.core.pos();
                        rh_sim::math::sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y))
                    })
                    .fold(f64::INFINITY, f64::min);
                if d.is_finite() {
                    m.attack_ticks += 1;
                    dist_sum += d;
                }
            }
        }
        let out = env.step(&[cmds]);
        let mut tally = |victim: PlayerId, by: Option<PlayerId>, amount: f64| {
            if victim == me {
                m.taken += amount;
                touched |= by.is_some_and(|b| members.contains(&b));
            } else if by == Some(me) {
                m.dealt += amount;
                m.first_hit.get_or_insert(tick);
                touched |= members.contains(&victim);
            }
        };
        for e in &out.events {
            match e {
                Event::Hit {
                    victim, by, amount, ..
                }
                | Event::AbilityHit {
                    victim, by, amount, ..
                } => tally(*victim, *by, *amount),
                Event::SignatureHit {
                    victim, by, amount, ..
                } => tally(*victim, Some(*by), *amount),
                Event::CardBleedHit {
                    victim,
                    by,
                    amount: rh_sim::events::CardBleedAmount::Finite(a),
                } => tally(*victim, *by, *a),
                Event::Heal { id, amount } if *id == me => healed += amount,
                _ => {}
            }
        }
        obs = out.observations;
        m.ticks = tick;
        let hp = env.sim.player(me).map_or(0., |p| p.vitals.hp);
        m.hp_left = hp.max(0.);
        if hp <= 0. {
            m.outcome = "died";
            m.hp_left = 0.;
            break;
        }
        // A living member leaving fight mode (gave up, returned, healed to full) is a reset of the camp.
        for b in env
            .sim
            .mobs()
            .iter()
            .filter(|b| b.camp == scene.camp && b.zombie.is_none())
        {
            if let Some(i) = members.iter().position(|id| *id == b.core.id) {
                let now = b.engaged();
                if was_engaged[i] && !now && b.status == rh_sim::state::Status::Alive {
                    m.resets += 1;
                }
                was_engaged[i] = now;
            }
        }
        let alive = env.sim.camp_rosters()[scene.camp as usize].alive;
        let any = env.sim.mobs().iter().any(|b| {
            b.camp == scene.camp && b.zombie.is_none() && b.status == rh_sim::state::Status::Alive
        });
        if alive == 0 && !any {
            m.outcome = "cleared";
            break;
        }
    }
    m.taken = m.taken.max(m.hp_start - m.hp_left + healed);
    if who == Who::Duelist {
        m.engaged = touched;
        if !touched {
            m.outcome = "no_engage";
        }
    }
    m.attack_dist_mean = (m.attack_ticks > 0).then(|| dist_sum / f64::from(m.attack_ticks));
    Ok(m)
}

fn rate(deaths: u64, samples: u64) -> Option<f64> {
    (samples > 0).then(|| deaths as f64 / samples as f64)
}

fn pct(deaths: u64, samples: u64) -> String {
    rate(deaths, samples).map_or("n/a".into(), |r| format!("{:.1}%", 100. * r))
}

/// Outcome books of one (kind, column), or of a sum of them.
#[derive(Clone, Copy, Default)]
struct Tally {
    samples: u64,
    engaged: u64,
    died: u64,
    cleared: u64,
    truncated: u64,
    no_engage: u64,
}
impl Tally {
    fn add(&mut self, outcome: &str, engaged: bool) {
        self.samples += 1;
        self.engaged += u64::from(engaged);
        match outcome {
            "died" => self.died += 1,
            "cleared" => self.cleared += 1,
            "truncated" => self.truncated += 1,
            _ => self.no_engage += 1,
        }
    }
    fn plus(self, o: Tally) -> Tally {
        Tally {
            samples: self.samples + o.samples,
            engaged: self.engaged + o.engaged,
            died: self.died + o.died,
            cleared: self.cleared + o.cleared,
            truncated: self.truncated + o.truncated,
            no_engage: self.no_engage + o.no_engage,
        }
    }
}

fn columns_of(col_names: &[String], t: &[Tally]) -> Vec<ColumnOut> {
    col_names
        .iter()
        .zip(t)
        .enumerate()
        .map(|(ci, (name, t))| {
            let decided = t.died + t.cleared;
            ColumnOut {
                column: name.clone(),
                camps: BANKED_CAMPS.get(ci).copied(),
                samples: t.samples,
                engaged: t.engaged,
                deaths: t.died,
                cleared: t.cleared,
                truncated: t.truncated,
                no_engage: t.no_engage,
                decided,
                death_rate: rate(t.died, t.engaged),
                clear_rate: rate(t.cleared, t.engaged),
                ci95: wilson(t.died, t.engaged),
                decided_rate: rate(t.died, decided),
                decided_ci95: wilson(t.died, decided),
            }
        })
        .collect()
}

/// One fighter's report blocks and table text.
struct Block {
    per_camp: Vec<PerCamp>,
    overall: Overall,
    table: String,
}

fn block(
    fighter: &str,
    kinds: &[(FactionId, MobTypeId)],
    tally: &[Vec<Tally>],
    col_names: &[String],
    refc: usize,
) -> Block {
    let columns_of = |t: &[Tally]| columns_of(col_names, t);
    let per_camp: Vec<PerCamp> = kinds
        .iter()
        .zip(tally)
        .map(|(&(zone, kind), t)| PerCamp {
            kind: kind.as_str().into(),
            zone: zone.as_str().into(),
            samples: t[refc].samples,
            deaths: t[refc].died,
            death_rate: rate(t[refc].died, t[refc].engaged),
            columns: columns_of(t),
        })
        .collect();
    let all: Vec<Tally> = (0..col_names.len())
        .map(|ci| tally.iter().fold(Tally::default(), |a, t| a.plus(t[ci])))
        .collect();
    let overall = Overall {
        samples: all[refc].samples,
        deaths: all[refc].died,
        death_rate: rate(all[refc].died, all[refc].engaged),
        columns: columns_of(&all),
    };
    let mut table = format!("  {:<24} {:<8} {:>13}", "camp", "zone", "samples");
    for c in col_names {
        table += &format!(" {c:>11}");
    }
    table += "\n";
    let row = |label: &str, zone: &str, n: u64, cols: &[ColumnOut]| {
        let mut l = format!("  {label:<24} {zone:<8} {n:>13}");
        for c in cols {
            l += &format!(" {:>11}", pct(c.deaths, c.engaged));
        }
        l + "\n"
    };
    for p in &per_camp {
        table += &row(&p.kind, &p.zone, p.samples, &p.columns);
    }
    table += &row("overall", "", overall.samples, &overall.columns);
    for c in &overall.columns {
        table += &format!(
            "  counts {fighter} {}: samples={} engaged={} died={} cleared={} truncated={} no_engage={}\n",
            c.column, c.samples, c.engaged, c.deaths, c.cleared, c.truncated, c.no_engage
        );
    }
    for c in &overall.columns {
        table += &format!(
            "  decided {fighter} {}: died={} cleared={} rate={}\n",
            c.column,
            c.deaths,
            c.cleared,
            pct(c.deaths, c.decided)
        );
    }
    Block {
        per_camp,
        overall,
        table,
    }
}

/// Default `--seeds` of a full run (a quick run keeps 1).
pub const OWNER_DEFAULT_SEEDS: u64 = 3;

/// Which fighter(s) a run seats (packet P-ELITE-BENCH-2). Absent flag = `Brawler`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FighterChoice {
    Brawler,
    Duelist,
    Both,
}

/// The parsed flags of an elite run (packet P-ELITE-BENCH-2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Options {
    pub quick: bool,
    pub fighter: FighterChoice,
    pub seed0: u64,
    pub seeds: u64,
    pub max_ticks: u32,
    pub jobs: usize,
    /// `--kind ID,ID`: restrict the elite kinds (any zone, also under `--quick`); `None` = the default set.
    pub kinds: Option<Vec<String>>,
    /// `--weapon W,W`: restrict the weapons (also under `--quick`); `None` = the default set.
    pub weapons: Option<Vec<String>>,
}

/// Parses the flags of an elite run (not `--sample-builds`): `--quick`, `--fighter brawler|duelist|both`, `--seed N`,
/// `--seeds N`, `--max-ticks N`, `--jobs N` (>= 1), `--kind ID[,ID]`, `--weapon W[,W]` (unknown values are an
/// error). `--builds PATH` is read by `run`.
pub fn parse_options(args: &[String]) -> Result<Options, String> {
    let flag = |n: &str| args.iter().any(|a| a == n);
    let value = |n: &str| -> Result<Option<&str>, String> {
        match args.iter().position(|a| a == n) {
            None => Ok(None),
            Some(i) => args
                .get(i + 1)
                .map(|v| Some(v.as_str()))
                .ok_or_else(|| format!("{n} needs a value")),
        }
    };
    let quick = flag("--quick");
    let num = |n: &str, d: u64| -> Result<u64, String> {
        value(n)?.map_or(Ok(d), |v| v.parse().map_err(|_| format!("bad {n}")))
    };
    let fighter = match value("--fighter")? {
        None | Some("brawler") => FighterChoice::Brawler,
        Some("duelist") => FighterChoice::Duelist,
        Some("both") => FighterChoice::Both,
        Some(v) => return Err(format!("bad --fighter {v}: brawler, duelist or both")),
    };
    let jobs = match value("--jobs")? {
        None => std::thread::available_parallelism().map_or(1, |n| n.get()),
        Some(v) => match v.parse::<usize>() {
            Ok(n) if n >= 1 => n,
            _ => return Err(format!("bad --jobs {v}: a number of at least 1")),
        },
    };
    let list = |n: &str, valid: Vec<String>| -> Result<Option<Vec<String>>, String> {
        let Some(v) = value(n)? else { return Ok(None) };
        let items: Vec<String> = v.split(',').map(str::to_string).collect();
        match items.iter().find(|i| !valid.contains(i)) {
            Some(bad) => Err(format!("unknown {n} {bad}: one of {}", valid.join(","))),
            None => Ok(Some(items)),
        }
    };
    let kinds = list(
        "--kind",
        FactionId::ALL
            .into_iter()
            .flat_map(|z| elites_of(z).map(|t| t.id.as_str().to_string()))
            .collect(),
    )?;
    let weapons = list(
        "--weapon",
        WeaponId::ALL
            .into_iter()
            .map(|w| w.as_str().to_string())
            .collect(),
    )?;
    Ok(Options {
        quick,
        fighter,
        seed0: num("--seed", 1)?,
        seeds: num("--seeds", if quick { 1 } else { OWNER_DEFAULT_SEEDS })?,
        max_ticks: u32::try_from(num("--max-ticks", 1800)?).map_err(|_| "bad --max-ticks")?,
        jobs,
        kinds,
        weapons,
    })
}

struct Job<'a> {
    faction: FactionId,
    weapon: WeaponId,
    ki: usize,
    seed: u64,
    who: Who,
    ci: usize,
    build: &'a TrustedBuild,
    build_index: Option<usize>,
}

/// The whole elite mode minus the process: `args` are the flags after the program name (`--quick`, `--seed N`,
/// `--seeds N`, `--max-ticks N`, `--fighter F`, `--jobs N`, `--builds PATH`; or `--sample-builds [--seeds A..B]`). `Ok`
/// whenever it reported, even if every fighter died or every fight was cut off; `Err` only for bad arguments or an
/// unreadable sample.
pub fn run(args: &[String]) -> Result<Output, String> {
    let value = |n: &str| -> Result<Option<&str>, String> {
        match args.iter().position(|a| a == n) {
            None => Ok(None),
            Some(i) => args
                .get(i + 1)
                .map(|v| Some(v.as_str()))
                .ok_or_else(|| format!("{n} needs a value")),
        }
    };
    if args.iter().any(|a| a == "--sample-builds") {
        let (a, b) = match value("--seeds")? {
            None => (1, 21),
            Some(v) => {
                let (a, b) = v.split_once("..").ok_or("--seeds A..B")?;
                (
                    a.parse::<u64>().map_err(|_| "bad --seeds")?,
                    b.parse::<u64>().map_err(|_| "bad --seeds")?,
                )
            }
        };
        if a >= b {
            return Err("--seeds A..B needs A < B".into());
        }
        let map = root_path(MAP_REL);
        let file = sample_builds(map.to_str().ok_or("map path")?, a..b, MINUTE5_TICK)?;
        let table = format!(
            "{} builds from seeds {a}..{b}; ended before minute 5: {:?}",
            file.builds.len(),
            file.ended_early
        );
        let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
        return Ok(Output { json, table });
    }
    let Options {
        quick,
        fighter,
        seed0,
        seeds,
        max_ticks,
        jobs,
        kinds: kind_filter,
        weapons: weapon_filter,
    } = parse_options(args)?;
    let (source, path) = match value("--builds")? {
        Some(p) => (p.to_string(), root_path(p)),
        None => (SAMPLE_PATH.to_string(), root_path(SAMPLE_PATH)),
    };
    let sample: SampleFile = {
        let text = std::fs::read_to_string(&path)
            .map_err(|e| format!("cannot read builds {}: {e}", path.display()))?;
        serde_json::from_str(&text).map_err(|e| format!("cannot parse builds {source}: {e}"))?
    };
    if sample.builds.is_empty() {
        return Err("the build sample is empty".into());
    }
    // Duelist first (the reference), then the Brawler (the upper bound).
    let whos: Vec<Who> = match fighter {
        FighterChoice::Brawler => vec![Who::Brawler],
        FighterChoice::Duelist => vec![Who::Duelist],
        FighterChoice::Both => vec![Who::Duelist, Who::Brawler],
    };

    let factions: Vec<FactionId> = FactionId::ALL
        .into_iter()
        .filter(|f| !quick || matches!(f, FactionId::Frost | FactionId::Holy))
        .collect();
    let weapons: Vec<WeaponId> = WeaponId::ALL
        .into_iter()
        .filter(|w| match &weapon_filter {
            Some(l) => l.iter().any(|n| n == w.as_str()),
            None => !quick || matches!(w, WeaponId::Sword | WeaponId::Wand),
        })
        .collect();
    let mut kinds: Vec<(FactionId, MobTypeId)> = Vec::new();
    for zone in FactionId::ALL {
        if quick && kind_filter.is_none() && zone != FactionId::ALL[0] {
            continue;
        }
        kinds.extend(
            elites_of(zone)
                .filter(|t| {
                    kind_filter
                        .as_ref()
                        .is_none_or(|l| l.iter().any(|n| n == t.id.as_str()))
                })
                .map(|t| (zone, t.id)),
        );
    }
    let map = root_path(MAP_REL);
    let arena = Arc::new(load_arena(map.to_str().ok_or("map path")?)?);
    // One probe world per seed picks each elite's camp and the banked camps; every fighter then fights the same camp
    // from the same point.
    let mut scenes: BTreeMap<u64, Vec<Option<Scene>>> = BTreeMap::new();
    let mut banked: BTreeMap<(u64, u32), TrustedBuild> = BTreeMap::new();
    for seed in seed0..seed0.saturating_add(seeds) {
        let probe = Sim::reset_active(
            config(),
            arena.clone(),
            Secrets::from_seed(seed),
            &[Placement {
                profile: "probe".into(),
                faction: FactionId::Frost,
                bot: false,
                at: arena.centre(),
                hp: None,
                weapon0: None,
                weapon1: None,
            }],
        );
        scenes.insert(
            seed,
            kinds
                .iter()
                .map(|&(_, id)| scene_for(&probe, &arena, id))
                .collect(),
        );
        for n in BANKED_CAMPS {
            banked.insert((seed, n), banked_camp_build(&probe, seed, n));
        }
    }

    // Columns: the banked ones, then the bot sample.
    let col_names: Vec<String> = BANKED_CAMPS
        .iter()
        .map(|n| format!("banked_{n}"))
        .chain(std::iter::once(BOT_COLUMN.to_string()))
        .collect();
    let ncol = col_names.len();
    // The cell list, in report order: faction, weapon, kind, seed, fighter, column.
    let mut jobs_list: Vec<Job> = Vec::new();
    let mut skipped = Vec::new();
    let mut ordinal = 0usize;
    for &f in &factions {
        for &w in &weapons {
            for (ki, &(_, kind)) in kinds.iter().enumerate() {
                for seed in seed0..seed0.saturating_add(seeds) {
                    let ord = ordinal;
                    ordinal += 1;
                    if scenes[&seed][ki].is_none() {
                        skipped.push(SkipOut {
                            faction: f.as_str().into(),
                            weapon: w.as_str().into(),
                            kind: kind.as_str().into(),
                            seed,
                        });
                        continue;
                    }
                    for &who in &whos {
                        for ci in 0..ncol {
                            let (idx, build) = if ci < BANKED_CAMPS.len() {
                                (None, &banked[&(seed, BANKED_CAMPS[ci])])
                            } else {
                                let i = ord % sample.builds.len();
                                (Some(i), &sample.builds[i].build)
                            };
                            jobs_list.push(Job {
                                faction: f,
                                weapon: w,
                                ki,
                                seed,
                                who,
                                ci,
                                build,
                                build_index: idx,
                            });
                        }
                    }
                }
            }
        }
    }

    // Independent fights on std threads; each owns its `Sim`, results land in slots by cell index.
    let next = AtomicUsize::new(0);
    let done: Vec<Vec<(usize, Result<Fought, String>)>> = std::thread::scope(|sc| {
        let handles: Vec<_> = (0..jobs.min(jobs_list.len()).max(1))
            .map(|_| {
                sc.spawn(|| {
                    let mut mine = Vec::new();
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed);
                        let Some(j) = jobs_list.get(i) else { break };
                        let scene = scenes[&j.seed][j.ki].as_ref().expect("a fought scene");
                        mine.push((
                            i,
                            fight(
                                &arena,
                                j.seed,
                                j.faction,
                                j.weapon,
                                scene,
                                Some(j.build),
                                max_ticks,
                                j.who,
                            ),
                        ));
                    }
                    mine
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("a fight thread panicked"))
            .collect()
    });
    let mut slots: Vec<Option<Result<Fought, String>>> =
        (0..jobs_list.len()).map(|_| None).collect();
    for (i, r) in done.into_iter().flatten() {
        slots[i] = Some(r);
    }

    let mut cells = Vec::new();
    // by_tally[fighter][weapon][column], over all kinds and seeds
    let mut by_tally: Vec<Vec<Vec<Tally>>> =
        vec![vec![vec![Tally::default(); ncol]; weapons.len()]; whos.len()];
    // tallies[fighter][kind][column]
    let mut tallies: Vec<Vec<Vec<Tally>>> =
        vec![vec![vec![Tally::default(); ncol]; kinds.len()]; whos.len()];
    for (j, slot) in jobs_list.iter().zip(slots) {
        let m = slot.expect("every fight ran")?;
        let wi = whos
            .iter()
            .position(|&w| w == j.who)
            .expect("a seated fighter");
        tallies[wi][j.ki][j.ci].add(m.outcome, m.engaged);
        let wpi = weapons
            .iter()
            .position(|&w| w == j.weapon)
            .expect("a run weapon");
        by_tally[wi][wpi][j.ci].add(m.outcome, m.engaged);
        let scene = scenes[&j.seed][j.ki].as_ref().expect("a fought scene");
        let (zone, kind) = kinds[j.ki];
        cells.push(CellOut {
            faction: j.faction.as_str().into(),
            weapon: j.weapon.as_str().into(),
            kind: kind.as_str().into(),
            zone: zone.as_str().into(),
            elite: true,
            seed: j.seed,
            camp: scene.camp,
            fighter: j.who.name(),
            column: col_names[j.ci].clone(),
            camps: BANKED_CAMPS.get(j.ci).copied(),
            build_index: j.build_index,
            build_applied_tick: 0,
            start_dist: scene.dist,
            outcome: m.outcome,
            engaged: m.engaged,
            ticks: m.ticks,
            first_hit_tick: m.first_hit,
            hp_start: m.hp_start,
            hp_remaining: m.hp_left,
            damage_dealt: m.dealt,
            damage_taken: m.taken,
            actions: m.actions,
            attack_ticks: m.attack_ticks,
            attack_dist_mean: m.attack_dist_mean,
            resets: m.resets,
        });
    }
    let refc = BANKED_CAMPS
        .iter()
        .position(|&n| n == REFERENCE_CAMPS)
        .expect("the reference column is a banked column");
    let mut blocks: Vec<Block> = whos
        .iter()
        .zip(&tallies)
        .map(|(w, t)| block(w.name(), &kinds, t, &col_names, refc))
        .collect();
    let reference_fighter = whos[0].name();
    let upper = if blocks.len() > 1 { blocks.pop() } else { None };
    let reference = blocks.remove(0);

    // Per weapon (all kinds and seeds), per fighter: the duelist first, as `whos`.
    let mut by_weapon: Vec<WeaponRow> = Vec::new();
    let mut weapon_lines: Vec<String> = Vec::new();
    for (wi, who) in whos.iter().enumerate() {
        let mut lines = String::new();
        for (wpi, w) in weapons.iter().enumerate() {
            for column in columns_of(&col_names, &by_tally[wi][wpi]) {
                if column.camps == Some(REFERENCE_CAMPS) {
                    lines += &format!(
                        "  weapon {} {} banked_{REFERENCE_CAMPS}: died={} cleared={} truncated={} rate={}\n",
                        who.name(),
                        w.as_str(),
                        column.deaths,
                        column.cleared,
                        column.truncated,
                        pct(column.deaths, column.decided)
                    );
                }
                by_weapon.push(WeaponRow {
                    fighter: who.name(),
                    weapon: w.as_str().into(),
                    column,
                });
            }
        }
        weapon_lines.push(lines);
    }
    let mut table = format!("elite camps, solo fighter. {CAVEAT}\n");
    table += &format!("{reference_fighter} fighter\n");
    table += &reference.table;
    table += &weapon_lines[0];
    if let Some(u) = &upper {
        table += "Brawler (upper bound)\n";
        table += &u.table;
        table += &weapon_lines[1];
    }
    table += &format!(
        "  reference: fighter {reference_fighter}, column banked_{REFERENCE_CAMPS} (12 camps banked, 12 stacks a camp: the workbook player); bots bank far fewer camps than the workbook player, so bot_sample is the bots' reality and the two are not comparable\n"
    );
    table +=
        "  owner target: an average minute-5 build dies 10-20% of the time soloing an elite camp";
    let report = Report {
        version: 1,
        mode: "elite",
        quick,
        max_ticks,
        config: "live_content",
        rules: Rules {
            elites: "rework",
            augments: "rework",
        },
        solo: true,
        caveat: CAVEAT,
        fighter: match fighter {
            FighterChoice::Brawler => "brawler",
            FighterChoice::Duelist => "duelist",
            FighterChoice::Both => "both",
        },
        reference_fighter,
        reference: format!("banked_{REFERENCE_CAMPS}"),
        builds: BuildsOut {
            source,
            tick: sample.tick,
            count: sample.builds.len(),
        },
        cells,
        skipped,
        per_camp: reference.per_camp,
        overall: reference.overall,
        by_weapon,
        upper_bound: upper.map(|u| UpperBound {
            fighter: "brawler",
            per_camp: u.per_camp,
            overall: u.overall,
        }),
    };
    Ok(Output {
        json: serde_json::to_string(&report).map_err(|e| e.to_string())?,
        table,
    })
}

/// Wilson 95% interval of a rate (`None` without samples).
fn wilson(deaths: u64, samples: u64) -> Option<[f64; 2]> {
    if samples == 0 {
        return None;
    }
    let (n, p, z) = (
        samples as f64,
        deaths as f64 / samples as f64,
        1.959_963_984_540_054,
    );
    let denom = 1. + z * z / n;
    let centre = (p + z * z / (2. * n)) / denom;
    let half = z * (p * (1. - p) / n + z * z / (4. * n * n)).sqrt() / denom;
    Some([(centre - half).max(0.), (centre + half).min(1.)])
}

/// Banked-camp model (coordinator 2026-11-19, revising plan decision 8): workbook `Augment_Value`, assumption `banked`
/// = 12 camps already banked at minute 5, one camp = 12 stacks.
pub const CAMP_STACKS: u64 = 12;
/// The banked-camp columns of the report, in order; the bot sample is one more column after them.
pub const BANKED_CAMPS: [u32; 4] = [0, 6, 12, 18];
/// The column `per_camp` and `overall` report as their own rate.
pub const REFERENCE_CAMPS: u32 = 12;
/// Column name of the bot minute-5 sample (the banked ones are `banked_<N>`).
pub const BOT_COLUMN: &str = "bot_sample";

/// SplitMix64: the bench's own seeded draw (the sim's RNG is not touched).
fn splitmix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// A build of `camps` normal camps banked: draw `camps` non-elite camps of `probe`'s world (with replacement, seeded by
/// `seed`) and add `CAMP_STACKS` stacks of the stat each drawn camp's kills pay (`camp_buffs()[i]` when set, else the
/// camp's own `mob_type`); stacks of one stat merge into one entry. No cards, no boosts. Pure in (`probe`, `seed`,
/// `camps`).
pub fn banked_camp_build(probe: &Sim, seed: u64, camps: u32) -> TrustedBuild {
    let buffs = probe.camp_buffs();
    let pays: Vec<MobTypeId> = probe
        .camp_rosters()
        .iter()
        .enumerate()
        .filter(|(_, r)| r.elite.is_none())
        .map(|(i, r)| buffs.get(i).copied().flatten().unwrap_or(r.mob_type))
        .collect();
    let mut stacks: Vec<(MobTypeId, u64)> = Vec::new();
    if pays.is_empty() {
        return TrustedBuild::default();
    }
    let mut state = seed ^ 0xBA4C_ED00_CA3D_5EED;
    for _ in 0..camps {
        let stat = pays[(splitmix(&mut state) % pays.len() as u64) as usize];
        match stacks.iter_mut().find(|(m, _)| *m == stat) {
            Some(e) => e.1 += CAMP_STACKS,
            None => stacks.push((stat, CAMP_STACKS)),
        }
    }
    stacks.sort_by_key(|(m, _)| m.as_str());
    TrustedBuild {
        cards: Vec::new(),
        stacks,
        boosts: Vec::new(),
    }
}
