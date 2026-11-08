//! The tournament runner over the headless environment (legacy packages/server/src/bots/tournament/): the deterministic
//! per-game schedule, the pure report statistics (Wilson intervals, percentiles, mean intervals and the per-tier,
//! per-persona and per-faction aggregates) and the runner that plays a plan through rh-headless policy seats.
//!
//! Scope and honest gaps. The schedule and the report primitives reproduce the actual source functions
//! (parity/policy/bot-tournament.json, captured from tournament/report.ts, tournament/worker.ts and
//! tournament/runTournament.ts in the pinned Linux amd64 Node 22.23.4 container); the ported surfaces are pinned exactly.
//! Game OUTCOMES cannot match the legacy tournament yet: a legacy game is played by the full bot brain
//! (strategy/tactics/memory: the P-BOTS-1/P-BOTS-3/P-BOTS-4 remainder) and the remaining gameplay producers. The summary
//! therefore carries only what the ported Env exposes publicly: no humanizer behaviour telemetry (commands/reactions/
//! APM), no mob-kill or mob-damage split, and no sudden-death start time (the public Env has no event for it). Those
//! columns are absent by design, not zeroed; the report prints those shares as NaN (the source prints "-").
//!
//! Perception only from Observation, actions only through validate + submit: the runner builds ordinary rh-headless
//! seats (Agent::Policy), so the Env enforces both. No wall clock is read here: a tournament is a pure function of its
//! plan, so the same plan replays byte-identically (the CLI wrapper may time itself outside).

use crate::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::bots::{HumanBot, PersonaId, TierId};
use rh_sim::constants::{MAX_PLAYERS, TICK_MS};
use rh_sim::content::FactionId;
use rh_sim::rng::Mulberry32;
use rh_sim::{Arena, ArenaMode, ArenaRules, Event, Outcome, PlayerId, RunResult, SimConfig};

/// A game is cut off after this much simulated time since it started (12 minutes; source game.ts MAX_GAME_MS).
pub const MAX_GAME_MS: f64 = 12. * 60_000.;
/// The source e2e stall bound (source report.ts STALL_LIMIT_MS): the report's informational criterion.
pub const STALL_LIMIT_MS: f64 = 8_000.;
/// The default lineup: two easy, two normal, two hard seats (source runTournament.ts --lineup default).
pub const DEFAULT_LINEUP: [&str; 6] = ["E", "E", "N", "N", "H", "H"];
/// The seat tiers in source order (source types.ts TIER_IDS).
pub const TIER_IDS: [TierId; 3] = [TierId::Easy, TierId::Normal, TierId::Hard];
/// The personas in source order (source types.ts PERSONA_IDS).
pub const PERSONA_IDS: [PersonaId; 4] = [
    PersonaId::Farmer,
    PersonaId::Hunter,
    PersonaId::Opportunist,
    PersonaId::Cautious,
];
/// The factions in source order (source FACTION_IDS = rh-sim FactionId::ALL).
pub const FACTION_IDS: [FactionId; 5] = FactionId::ALL;

/// One tournament seat: the three things a game fixes about a bot (source game.ts SeatSpec).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SeatSpec {
    pub tier: TierId,
    pub persona: PersonaId,
    pub faction: FactionId,
}

/// How a plan picks a seat's persona: rotated evenly, or one for every bot (source plan.persona).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PersonaChoice {
    Mix,
    One(PersonaId),
}

/// How a plan picks a seat's faction: dealt evenly, or one for every bot (source plan.faction).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FactionChoice {
    Mix,
    One(FactionId),
}

impl PersonaChoice {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mix => "mix",
            Self::One(persona) => persona.as_str(),
        }
    }
}

impl FactionChoice {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mix => "mix",
            Self::One(faction) => faction.as_str(),
        }
    }
}

/// Everything a tournament is, as plain data (source worker.ts TournamentPlan).
#[derive(Clone, Debug, PartialEq)]
pub struct TournamentPlan {
    pub games: u32,
    pub seed: u32,
    /// One tier per seat, in seating order (the sim shuffles who spawns where).
    pub tiers: Vec<TierId>,
    pub persona: PersonaChoice,
    pub faction: FactionChoice,
    /// Simulated-time cap of one game, since its raid started (0 or less means MAX_GAME_MS).
    pub max_sim_ms: f64,
}

impl Default for TournamentPlan {
    fn default() -> Self {
        Self {
            games: 400,
            seed: 1,
            tiers: parse_lineup("E,E,N,N,H,H").expect("the default lineup"),
            persona: PersonaChoice::Mix,
            faction: FactionChoice::Mix,
            max_sim_ms: MAX_GAME_MS,
        }
    }
}

impl TournamentPlan {
    /// The plan a tournament CLI describes, with the source defaults for everything the caller does not override.
    pub fn with_tiers(games: u32, seed: u32, tiers: Vec<TierId>, max_sim_ms: f64) -> Self {
        Self {
            games,
            seed,
            tiers,
            persona: PersonaChoice::Mix,
            faction: FactionChoice::Mix,
            max_sim_ms,
        }
    }
}

/// One game's fixed options: its world seed, the bot streams' seed and the lineup (source worker.ts planGame).
#[derive(Clone, Debug, PartialEq)]
pub struct GamePlan {
    /// The world's seed (the map, the spawn shuffle, the loot, the mobs; source PLAN_GAME_SEED tag 1_000_000 + index,
    /// in the Room's own 2^31 map-seed range).
    pub seed: u32,
    /// Seeds the bots' streams (source tag 2_000_000 + index).
    pub bot_seed: u32,
    pub lineup: Vec<SeatSpec>,
}

/// A 32-bit mix of a seed and a tag (a murmur finaliser; source worker.ts mix), so the streams of one tournament do not
/// march together.
pub fn mix(seed: u32, tag: u32) -> u32 {
    let mut h = seed.wrapping_mul(0x9e37_79b1) ^ tag.wrapping_add(1).wrapping_mul(0x85eb_ca6b);
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    h ^ (h >> 16)
}

/// An even draw of kinds over the seats (source worker.ts dealEvenly): per block of kinds.length games the seats are dealt
/// a random slot each (a shuffle of the seat numbers, mod the number of kinds) and a random order of the kinds; game g of
/// the block gives a seat the kind at (its slot + g), so over a block every seat, and so every tier, sees every kind once.
pub fn deal_evenly<K: Clone>(kinds: &[K], seats: usize, seed: u32, tag: u32, index: u32) -> Vec<K> {
    let k = kinds.len();
    assert!(k > 0, "deal_evenly needs at least one kind");
    let block = index / k as u32;
    let mut rng = Mulberry32::new(mix(seed, tag.wrapping_mul(100_003).wrapping_add(block)));
    let mut order = kinds.to_vec();
    shuffle(&mut rng, &mut order);
    let mut slots: Vec<u32> = (0..seats).map(|i| (i % k) as u32).collect();
    shuffle(&mut rng, &mut slots);
    slots
        .into_iter()
        .map(|slot| order[((slot + index % k as u32) % k as u32) as usize].clone())
        .collect()
}

/// Fisher-Yates with the source's randInt (floor of a scaled draw); in place.
fn shuffle<T>(rng: &mut Mulberry32, values: &mut [T]) {
    let mut i = values.len();
    while i > 1 {
        i -= 1;
        let j = (rng.next_f64() * (i + 1) as f64) as usize;
        values.swap(i, j);
    }
}

/// The options of game index: its seed, and a lineup that is fully fixed (tier, persona, faction) before the game starts
/// (source worker.ts planGame).
pub fn plan_game(plan: &TournamentPlan, index: u32) -> GamePlan {
    let seats = plan.tiers.len();
    let factions: Vec<FactionId> = match plan.faction {
        FactionChoice::One(faction) => vec![faction; seats],
        FactionChoice::Mix => deal_evenly(&FACTION_IDS, seats, plan.seed, 1, index),
    };
    let personas: Option<Vec<PersonaId>> = match plan.persona {
        PersonaChoice::One(_) => None,
        PersonaChoice::Mix => Some(deal_evenly(&PERSONA_IDS, seats, plan.seed, 2, index)),
    };
    let lineup = plan
        .tiers
        .iter()
        .enumerate()
        .map(|(i, tier)| {
            let persona = match (&personas, plan.persona) {
                (Some(personas), PersonaChoice::Mix) => personas[i],
                (_, PersonaChoice::One(persona)) => persona,
                (None, PersonaChoice::Mix) => unreachable!("a mix floor is dealt"),
            };
            SeatSpec {
                tier: *tier,
                persona,
                faction: factions[i],
            }
        })
        .collect();
    GamePlan {
        seed: mix(plan.seed, 1_000_000u32.wrapping_add(index)) & 0x7fff_ffff,
        bot_seed: mix(plan.seed, 2_000_000u32.wrapping_add(index)),
        lineup,
    }
}

/// Game g goes to worker g mod W: a fixed split, so a run replays whatever the machine's load does to the order of
/// arrival (source runTournament.ts split).
pub fn split(games: u32, workers: u32) -> Vec<Vec<u32>> {
    let w = workers.max(1).min(games.max(1)) as usize;
    let mut out = vec![Vec::new(); w];
    for g in 0..games {
        out[g as usize % w].push(g);
    }
    out
}

/// The default worker count (source runTournament.ts defaultWorkers): leave a core for the main thread, and six is where
/// a laptop stops gaining.
pub fn default_workers(cores: usize) -> usize {
    cores.saturating_sub(1).clamp(1, 6)
}

/// The tier letters the source lineup parser accepts, lowercased.
fn tier_letter(token: &str) -> Option<TierId> {
    match token {
        "e" | "easy" => Some(TierId::Easy),
        "n" | "normal" => Some(TierId::Normal),
        "h" | "hard" => Some(TierId::Hard),
        _ => None,
    }
}

/// "E,E,N,N,H,H" (or easy/normal/hard) to tiers; errors on a bad token or a lobby size the arena does not take
/// (source runTournament.ts parseLineup).
pub fn parse_lineup(text: &str) -> Result<Vec<TierId>, String> {
    let mut tiers = Vec::new();
    for token in text.split(',') {
        let token = token.trim().to_lowercase();
        if token.is_empty() {
            continue;
        }
        let Some(tier) = tier_letter(&token) else {
            return Err(format!(
                "unknown tier \"{token}\" in --lineup (use E, N or H)"
            ));
        };
        tiers.push(tier);
    }
    if !(2..=MAX_PLAYERS).contains(&tiers.len()) {
        return Err(format!(
            "--lineup needs 2 to {MAX_PLAYERS} seats, got {}",
            tiers.len()
        ));
    }
    Ok(tiers)
}

/// How the source headless room configures a tournament game (HEADLESS_CONFIG): the run's timers. A fixed lineup starts
/// the raid at once, so this port sets fill_seconds 0; mobs stay Off (the default arena has no camps/loot layers: enable
/// them with a layered arena and initial_loot through the sim config passed to play).
pub fn default_sim_config() -> SimConfig {
    SimConfig {
        min_players: 2,
        lobby_seconds: 30.,
        fill_seconds: 0.,
        lifecycle: ArenaMode::Source(ArenaRules {
            plan_seconds: 0.,
            first_patience_seconds: None,
            coliseum_schedule: None,
            patience_seconds: 120.,
            patience_min_seconds: 48.,
            sudden_death_seconds: 30.,
        }),
        ..SimConfig::default()
    }
}

/// A bot's outcome in one game: the source RunOutcome, plus the source "capped" for survivors of a cut-off game.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameOutcome {
    Won,
    Draw,
    Died,
    Mia,
    Capped,
}

impl GameOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Won => "won",
            Self::Draw => "draw",
            Self::Died => "died",
            Self::Mia => "mia",
            Self::Capped => "capped",
        }
    }
}

/// What killed a bot (source game.ts DiedTo).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiedTo {
    Bot,
    Mob,
    Arena,
}

impl DiedTo {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bot => "bot",
            Self::Mob => "mob",
            Self::Arena => "arena",
        }
    }
}

/// What one bot measured about itself in a game, as the ported Env exposes it (source game.ts BotGameSummary, reduced:
/// the humanizer behaviour block is not ported here and stays absent, never zeroed).
#[derive(Clone, Debug, PartialEq)]
pub struct BotSummary {
    pub seat: SeatSpec,
    /// The seat's index in the game's lineup.
    pub index: u32,
    /// 1 = the winner; a draw's players share 1; players downed in one tick share a place; a capped survivor is 1.
    pub place: f64,
    pub outcome: GameOutcome,
    pub kills: f64,
    pub deaths: f64,
    pub gv: f64,
    /// Milliseconds since the raid started, null while standing at the end (or at the cap).
    pub died_at_ms: Option<f64>,
    pub died_to: Option<DiedTo>,
}

/// The manager's command counters (source GameSummary.manager): what the seats proposed and what validate + submit
/// accepted; lost and errors must stay 0.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ManagerCounts {
    pub sent: u64,
    pub applied: u64,
    pub refused: u64,
    pub lost: u64,
    pub frames: u64,
    pub errors: u64,
}

/// One tournament game, summarised as plain data (source game.ts GameSummary, reduced to the publicly observable part).
#[derive(Clone, Debug, PartialEq)]
pub struct GameSummary {
    /// The world seed this game played under (source planGame seed).
    pub seed: u32,
    /// The game's fixed lineup, in seat order.
    pub lineup: Vec<SeatSpec>,
    pub ended: bool,
    /// Index into lineup of the winner, or null (a draw, or a capped game).
    pub winner: Option<usize>,
    pub draw: bool,
    /// Simulated ms from the raid's start to its end (or to the cap).
    pub duration_ms: f64,
    /// Ticks the environment stepped.
    pub ticks: u32,
    /// Since the raid started; null when it never happened.
    pub first_death_ms: Option<f64>,
    /// The coliseum teleport, since the raid started; null when it never happened.
    pub teleport_ms: Option<f64>,
    /// The moment sudden death's burn began; the public Env exposes no such event, so this is always null (reported as
    /// NaN, the source prints "-").
    pub sudden_death_ms: Option<f64>,
    pub bots: Vec<BotSummary>,
    pub manager: ManagerCounts,
}

/// One game's result: its plan index and summary (source worker.ts GameResult; the source wallMs is not part of the
/// deterministic summary and is not read here).
#[derive(Clone, Debug, PartialEq)]
pub struct GameResult {
    pub index: u32,
    pub summary: GameSummary,
}

/// Play one game of the plan through rh-headless policy seats (source game.ts runGame).
pub fn run_game(index: u32, plan: &TournamentPlan, arena: &Arena, sim: &SimConfig) -> GameSummary {
    let game = plan_game(plan, index);
    let agents: Vec<AgentSpec> = game
        .lineup
        .iter()
        .enumerate()
        .map(|(i, seat)| AgentSpec {
            profile: format!("bot{i}"),
            faction: seat.faction,
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(HumanBot::new(seat.tier, seat.persona)),
            },
        })
        .collect();
    let ticks_cap = ((if plan.max_sim_ms > 0. {
        plan.max_sim_ms
    } else {
        MAX_GAME_MS
    }) / TICK_MS)
        .ceil() as u32;
    let mut env = Env::new(
        EnvConfig {
            arena: arena.clone(),
            sim: sim.clone(),
            max_ticks: ticks_cap.saturating_add(2),
            record: false,
        },
        agents,
        // The source seeds the world from the game seed and the bots from a separate bot seed; the public Env derives
        // both from one seed, so the game seed is used here (documented deviation; the schedule parity is exact).
        u64::from(game.seed),
    );
    let ids: Vec<PlayerId> = env.sim.players().iter().map(|p| p.id).collect();
    let mut resolved: Vec<Option<RunResult>> = vec![None; ids.len()];
    let mut deaths: Vec<Option<(f64, Option<usize>)>> = vec![None; ids.len()];
    let mut raid_start_tick: Option<u32> = None;
    let mut teleport_tick: Option<u32> = None;
    let mut first_death_ms: Option<f64> = None;
    let mut end_tick;
    let ended;
    loop {
        let progress = env.advance(&[]);
        end_tick = progress.tick;
        for event in env.last_events() {
            match event {
                Event::RaidStarted if raid_start_tick.is_none() => {
                    raid_start_tick = Some(progress.tick);
                }
                Event::Teleported if teleport_tick.is_none() => {
                    teleport_tick = Some(progress.tick);
                }
                Event::Death { id, by, .. } => {
                    let Some(victim) = ids.iter().position(|candidate| candidate == id) else {
                        continue;
                    };
                    let killer = by.and_then(|killer| ids.iter().position(|c| *c == killer));
                    let at = since_ms(raid_start_tick, progress.tick);
                    if deaths[victim].is_none() {
                        deaths[victim] = Some((at, killer));
                        first_death_ms = Some(first_death_ms.map_or(at, |old| old.min(at)));
                    }
                }
                Event::Resolved { id, result, .. } => {
                    if let Some(i) = ids.iter().position(|candidate| candidate == id) {
                        resolved[i] = Some(result.clone());
                    }
                }
                _ => {}
            }
        }
        if progress.terminated || progress.truncated {
            ended = progress.terminated;
            break;
        }
    }
    let mut bots = Vec::with_capacity(ids.len());
    let mut winner = None;
    let mut draw = false;
    for (i, seat) in game.lineup.iter().enumerate() {
        let result = resolved[i].clone();
        let outcome = match result.as_ref().map(|r| r.outcome) {
            Some(Outcome::Won) => {
                winner = Some(i);
                GameOutcome::Won
            }
            Some(Outcome::Draw) => {
                draw = true;
                GameOutcome::Draw
            }
            Some(Outcome::Died) => GameOutcome::Died,
            Some(Outcome::Mia) => GameOutcome::Mia,
            None => {
                if ended {
                    draw = true;
                    GameOutcome::Draw
                } else {
                    GameOutcome::Capped
                }
            }
        };
        let died_to = result.as_ref().and_then(|r| {
            (r.outcome == Outcome::Died).then(|| {
                if r.killed_by.as_deref() == Some("sudden death") {
                    DiedTo::Arena
                } else if r.killed_by_bot {
                    DiedTo::Bot
                } else {
                    DiedTo::Mob
                }
            })
        });
        bots.push(BotSummary {
            seat: *seat,
            index: i as u32,
            place: result.as_ref().map_or(1., |r| f64::from(r.place)),
            outcome,
            kills: result.as_ref().map_or(0., |r| f64::from(r.kills)),
            deaths: if matches!(outcome, GameOutcome::Died | GameOutcome::Mia) {
                1.
            } else {
                0.
            },
            gv: result.as_ref().map_or(0., |r| f64::from(r.gv.total)),
            died_at_ms: deaths[i].map(|(at, _)| at),
            died_to,
        });
    }
    let mut manager = ManagerCounts::default();
    for (_, stats, fault) in env.seat_stats() {
        manager.sent += stats.proposed;
        manager.applied += stats.accepted;
        manager.refused += stats.rejected;
        manager.frames += stats.decisions;
        if fault.is_some() {
            manager.errors += 1;
        }
    }
    let duration_ms = raid_start_tick.map_or(0., |start| since_ms(Some(start), end_tick));
    GameSummary {
        seed: game.seed,
        lineup: game.lineup,
        ended,
        winner,
        draw,
        duration_ms,
        ticks: end_tick,
        first_death_ms,
        teleport_ms: teleport_tick.and_then(|tick| {
            raid_start_tick.map(|start| (f64::from(tick.saturating_sub(start))) * TICK_MS)
        }),
        sudden_death_ms: None,
        bots,
        manager,
    }
}

fn since_ms(raid_start_tick: Option<u32>, tick: u32) -> f64 {
    raid_start_tick.map_or(0., |start| f64::from(tick.saturating_sub(start)) * TICK_MS)
}

/// The Wilson score interval of k successes in n trials (z = 1.96 is 95%; source report.ts wilson).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Proportion {
    pub k: f64,
    pub n: f64,
    pub p: f64,
    pub lo: f64,
    pub hi: f64,
}

pub fn wilson(k: f64, n: f64, z: f64) -> Proportion {
    if n <= 0. {
        return Proportion {
            k,
            n,
            p: f64::NAN,
            lo: f64::NAN,
            hi: f64::NAN,
        };
    }
    let p = k / n;
    let z2 = z * z;
    let denom = 1. + z2 / n;
    let centre = (p + z2 / (2. * n)) / denom;
    let half = (z * ((p * (1. - p)) / n + z2 / (4. * n * n)).sqrt()) / denom;
    Proportion {
        k,
        n,
        p,
        lo: (centre - half).max(0.),
        hi: (centre + half).min(1.),
    }
}

/// The q-quantile (0..1) of an ascending list, linearly interpolated between neighbours; NaN for an empty list
/// (source report.ts percentile).
pub fn percentile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let pos = q.clamp(0., 1.) * (sorted.len() - 1) as f64;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo as f64)
}

/// Mean and a normal-approximation interval (z = 1.645 is 90%) from the standard error of the mean
/// (source report.ts meanInterval).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MeanInterval {
    pub n: f64,
    pub mean: f64,
    pub lo: f64,
    pub hi: f64,
}

pub fn mean_interval(xs: &[f64], z: f64) -> MeanInterval {
    let n = xs.len() as f64;
    if n == 0. {
        return MeanInterval {
            n,
            mean: f64::NAN,
            lo: f64::NAN,
            hi: f64::NAN,
        };
    }
    let mean = sum_of(xs) / n;
    if n < 2. {
        return MeanInterval {
            n,
            mean,
            lo: mean,
            hi: mean,
        };
    }
    let ss = xs.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>();
    let se = (ss / (n - 1.) / n).sqrt();
    MeanInterval {
        n,
        mean,
        lo: mean - z * se,
        hi: mean + z * se,
    }
}

fn mean(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        f64::NAN
    } else {
        sum_of(xs) / xs.len() as f64
    }
}

/// The source's reduce starts at +0, not at the f64 Sum identity (-0): fold from +0 so an empty sum keeps its sign.
fn sum_of(xs: &[f64]) -> f64 {
    xs.iter().fold(0., |sum, x| sum + x)
}

/// Stimuli whose delay is the plain reaction time; the others are scaled by attention or reading, or are the daze
/// (source report.ts READING_KINDS/SCALED_KINDS).
const READING_KINDS: [&str; 3] = ["announcement", "chestUp", "planOffer"];

/// The mean the tier table promises for a stimulus kind, before attention (source report.ts tableReactionMean).
pub fn table_reaction_mean(tier: TierId, kind: &str) -> f64 {
    let t = tier_params(tier);
    if kind == "teleport" {
        return t.daze.mu + t.daze.tau;
    }
    let base = t.reaction.mu + t.reaction.tau;
    if READING_KINDS.contains(&kind) {
        base * 1.5
    } else {
        base
    }
}

fn tier_params(id: TierId) -> &'static rh_policy::bots::TierParams {
    rh_policy::bots::TIERS
        .iter()
        .find(|t| t.id == id)
        .expect("a known tier")
}

/// A per-key aggregate of bot-games (source report.ts GroupAgg): the source group().
#[derive(Clone, Debug, PartialEq)]
pub struct GroupAgg {
    pub key: String,
    pub bot_games: f64,
    pub win_rate: Proportion,
    pub mean_place: f64,
    pub kills_per_bot: f64,
}

pub fn group(key: &str, rows: &[&BotSummary]) -> GroupAgg {
    let wins = rows
        .iter()
        .filter(|b| b.outcome == GameOutcome::Won)
        .count() as f64;
    GroupAgg {
        key: key.to_owned(),
        bot_games: rows.len() as f64,
        win_rate: wilson(wins, rows.len() as f64, 1.96),
        mean_place: mean(&rows.iter().map(|b| b.place).collect::<Vec<_>>()),
        kills_per_bot: mean(&rows.iter().map(|b| b.kills).collect::<Vec<_>>()),
    }
}

/// How many bot-games ended by each kind (source TierAgg.diedTo).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DiedToCounts {
    pub bot: f64,
    pub mob: f64,
    pub arena: f64,
}

/// One tier's aggregate (source report.ts TierAgg, reduced to the columns the ported summary carries: the humanizer
/// behaviour and reaction blocks are the P-BOTS-1 remainder, not zeroed here).
#[derive(Clone, Debug, PartialEq)]
pub struct TierAgg {
    pub tier: TierId,
    pub bot_games: f64,
    pub wins: f64,
    pub draws: f64,
    pub capped: f64,
    pub win_rate: Proportion,
    pub share_of_wins: f64,
    pub place: MeanInterval,
    pub kills_per_bot: f64,
    pub deaths_per_bot: f64,
    pub gv_per_bot: f64,
    /// Mean seconds alive since the raid started.
    pub alive_seconds: f64,
    pub died_to: DiedToCounts,
}

/// The run-duration summary (source Report.duration).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DurationSummary {
    pub mean_s: f64,
    pub p50_s: f64,
    pub min_s: f64,
    pub max_s: f64,
}

/// The whole tournament report (source report.ts Report, reduced as described on TierAgg).
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub games: f64,
    pub decided: f64,
    pub draws: f64,
    pub capped: f64,
    pub duration: DurationSummary,
    pub first_death_median_s: f64,
    pub teleport_share: f64,
    pub sudden_death_share: f64,
    pub refused: f64,
    pub lost: f64,
    pub errors: f64,
    pub tiers: Vec<TierAgg>,
    pub personas: Vec<GroupAgg>,
    pub factions: Vec<GroupAgg>,
}

/// Aggregate every game into the report (source report.ts aggregate, reduced).
pub fn aggregate(games: &[GameSummary]) -> Report {
    let all: Vec<&BotSummary> = games.iter().flat_map(|g| g.bots.iter()).collect();
    let total_wins = all.iter().filter(|b| b.outcome == GameOutcome::Won).count() as f64;
    let mut secs: Vec<f64> = games.iter().map(|g| g.duration_ms / 1000.).collect();
    secs.sort_by(|a, b| a.total_cmp(b));
    let mut first_deaths: Vec<f64> = games
        .iter()
        .filter_map(|g| g.first_death_ms.map(|ms| ms / 1000.))
        .collect();
    first_deaths.sort_by(|a, b| a.total_cmp(b));
    let share = |pred: fn(&GameSummary) -> bool| -> f64 {
        if games.is_empty() {
            f64::NAN
        } else {
            games.iter().filter(|g| pred(g)).count() as f64 / games.len() as f64
        }
    };
    Report {
        games: games.len() as f64,
        decided: games.iter().filter(|g| g.winner.is_some()).count() as f64,
        draws: games.iter().filter(|g| g.draw).count() as f64,
        capped: games.iter().filter(|g| !g.ended).count() as f64,
        duration: DurationSummary {
            mean_s: mean(&secs),
            p50_s: percentile(&secs, 0.5),
            min_s: secs.first().copied().unwrap_or(f64::NAN),
            max_s: secs.last().copied().unwrap_or(f64::NAN),
        },
        first_death_median_s: percentile(&first_deaths, 0.5),
        teleport_share: share(|g| g.teleport_ms.is_some()),
        sudden_death_share: share(|g| g.sudden_death_ms.is_some()),
        refused: sum_of(
            &games
                .iter()
                .map(|g| g.manager.refused as f64)
                .collect::<Vec<_>>(),
        ),
        lost: sum_of(
            &games
                .iter()
                .map(|g| g.manager.lost as f64)
                .collect::<Vec<_>>(),
        ),
        errors: sum_of(
            &games
                .iter()
                .map(|g| g.manager.errors as f64)
                .collect::<Vec<_>>(),
        ),
        tiers: TIER_IDS
            .iter()
            .filter(|tier| all.iter().any(|b| b.seat.tier == **tier))
            .map(|tier| tier_agg(*tier, games, total_wins))
            .collect(),
        personas: PERSONA_IDS
            .iter()
            .map(|persona| {
                group(
                    persona.as_str(),
                    &all.iter()
                        .copied()
                        .filter(|b| b.seat.persona == *persona)
                        .collect::<Vec<_>>(),
                )
            })
            .filter(|g| g.bot_games > 0.)
            .collect(),
        factions: FACTION_IDS
            .iter()
            .map(|faction| {
                group(
                    faction.as_str(),
                    &all.iter()
                        .copied()
                        .filter(|b| b.seat.faction == *faction)
                        .collect::<Vec<_>>(),
                )
            })
            .filter(|g| g.bot_games > 0.)
            .collect(),
    }
}

fn tier_agg(tier: TierId, games: &[GameSummary], total_wins: f64) -> TierAgg {
    let mut rows: Vec<&BotSummary> = Vec::new();
    let mut per_game_place: Vec<f64> = Vec::new();
    for game in games {
        let mine: Vec<&BotSummary> = game.bots.iter().filter(|b| b.seat.tier == tier).collect();
        if mine.is_empty() {
            continue;
        }
        per_game_place.push(mean(&mine.iter().map(|b| b.place).collect::<Vec<_>>()));
        rows.extend(mine);
    }
    let n = rows.len() as f64;
    let wins = rows
        .iter()
        .filter(|b| b.outcome == GameOutcome::Won)
        .count() as f64;
    let per = |f: fn(&BotSummary) -> f64| -> f64 {
        if n == 0. {
            f64::NAN
        } else {
            sum_of(&rows.iter().map(|b| f(b)).collect::<Vec<_>>()) / n
        }
    };
    let alive_ms =
        |game: &GameSummary, b: &BotSummary| -> f64 { b.died_at_ms.unwrap_or(game.duration_ms) };
    let mut alive_total = 0.;
    for game in games {
        for b in &game.bots {
            if b.seat.tier == tier {
                alive_total += alive_ms(game, b);
            }
        }
    }
    TierAgg {
        tier,
        bot_games: n,
        wins,
        draws: rows
            .iter()
            .filter(|b| b.outcome == GameOutcome::Draw)
            .count() as f64,
        capped: rows
            .iter()
            .filter(|b| b.outcome == GameOutcome::Capped)
            .count() as f64,
        win_rate: wilson(wins, n, 1.96),
        share_of_wins: if total_wins == 0. {
            f64::NAN
        } else {
            wins / total_wins
        },
        place: mean_interval(&per_game_place, 1.645),
        kills_per_bot: per(|b| b.kills),
        deaths_per_bot: per(|b| b.deaths),
        gv_per_bot: per(|b| b.gv),
        alive_seconds: if n == 0. {
            f64::NAN
        } else {
            alive_total / n / 1000.
        },
        died_to: DiedToCounts {
            bot: rows
                .iter()
                .filter(|b| b.died_to == Some(DiedTo::Bot))
                .count() as f64,
            mob: rows
                .iter()
                .filter(|b| b.died_to == Some(DiedTo::Mob))
                .count() as f64,
            arena: rows
                .iter()
                .filter(|b| b.died_to == Some(DiedTo::Arena))
                .count() as f64,
        },
    }
}

/// What a tournament ran, as plain data (source ReportMeta, reduced: no wall-clock timing here).
#[derive(Clone, Debug, PartialEq)]
pub struct TournamentMeta {
    pub games: u32,
    pub seed: u32,
    pub lineup: Vec<TierId>,
    pub persona: String,
    pub faction: String,
    pub max_sim_ms: f64,
}

/// Play every game of the plan in index order (source worker.ts/runTournament.ts play, one thread).
pub fn play(plan: &TournamentPlan, arena: &Arena, sim: &SimConfig) -> Vec<GameResult> {
    (0..plan.games)
        .map(|index| GameResult {
            index,
            summary: run_game(index, plan, arena, sim),
        })
        .collect()
}

/// The whole run: meta, the per-game summaries and their report (source runTournament.ts main's json payload).
#[derive(Clone, Debug, PartialEq)]
pub struct TournamentReport {
    pub meta: TournamentMeta,
    pub report: Report,
    pub games: Vec<GameSummary>,
}

/// Play a whole plan and aggregate it (the tournament runner's entry point).
pub fn run(plan: &TournamentPlan, arena: &Arena, sim: &SimConfig) -> TournamentReport {
    let results = play(plan, arena, sim);
    let games: Vec<GameSummary> = results.into_iter().map(|r| r.summary).collect();
    TournamentReport {
        meta: TournamentMeta {
            games: plan.games,
            seed: plan.seed,
            lineup: plan.tiers.clone(),
            persona: plan.persona.as_str().to_owned(),
            faction: plan.faction.as_str().to_owned(),
            max_sim_ms: plan.max_sim_ms,
        },
        report: aggregate(&games),
        games,
    }
}

/// The report as the CLI prints it: the source print layout, reduced to the ported columns. NaN prints as "-".
pub fn format_report(tournament: &TournamentReport) -> String {
    let show = |v: f64| -> String {
        if v.is_finite() {
            format!("{v:.3}")
        } else {
            "-".to_owned()
        }
    };
    let rate = |p: &Proportion| -> String {
        format!(
            "{}/{} = {} [{}, {}]",
            show(p.k),
            show(p.n),
            show(p.p),
            show(p.lo),
            show(p.hi)
        )
    };
    let mut out = String::new();
    let meta = &tournament.meta;
    out.push_str(&format!(
        "tournament: {} games, seed {}, lineup {}, persona {}, faction {}, cap {:.0}s\n",
        meta.games,
        meta.seed,
        meta.lineup
            .iter()
            .map(|t| t.as_str().to_uppercase())
            .collect::<Vec<_>>()
            .join(","),
        meta.persona,
        meta.faction,
        meta.max_sim_ms / 1000.
    ));
    let report = &tournament.report;
    out.push_str(&format!(
        "overall: games {}, decided {}, draws {}, capped {}, duration mean {}s p50 {}s min {}s max {}s, first death p50 {}s, teleport {}, sudden death {}, refused {}, lost {}, errors {}\n",
        show(report.games),
        show(report.decided),
        show(report.draws),
        show(report.capped),
        show(report.duration.mean_s),
        show(report.duration.p50_s),
        show(report.duration.min_s),
        show(report.duration.max_s),
        show(report.first_death_median_s),
        show(report.teleport_share),
        show(report.sudden_death_share),
        show(report.refused),
        show(report.lost),
        show(report.errors),
    ));
    for tier in &report.tiers {
        out.push_str(&format!(
            "tier {}: bot-games {}, win rate {}, share {}, place {} [{}, {}], kills/bot {}, deaths/bot {}, gv/bot {}, alive {}s, died to bot/mob/arena {}/{}/{}\n",
            tier.tier.as_str(),
            show(tier.bot_games),
            rate(&tier.win_rate),
            show(tier.share_of_wins),
            show(tier.place.mean),
            show(tier.place.lo),
            show(tier.place.hi),
            show(tier.kills_per_bot),
            show(tier.deaths_per_bot),
            show(tier.gv_per_bot),
            show(tier.alive_seconds),
            show(tier.died_to.bot),
            show(tier.died_to.mob),
            show(tier.died_to.arena),
        ));
    }
    for (label, groups) in [("persona", &report.personas), ("faction", &report.factions)] {
        for group in groups {
            out.push_str(&format!(
                "{label} {}: bot-games {}, win rate {}, place {}, kills/bot {}\n",
                group.key,
                show(group.bot_games),
                rate(&group.win_rate),
                show(group.mean_place),
                show(group.kills_per_bot),
            ));
        }
    }
    out
}
