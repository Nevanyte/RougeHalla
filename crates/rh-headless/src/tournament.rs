//! The tournament runner over the headless environment (legacy packages/server/src/bots/tournament/): the deterministic
//! per-game schedule, the pure report statistics (Wilson intervals, percentiles, mean intervals and the per-tier,
//! per-persona and per-faction aggregates) and the runner that plays a plan through rh-headless policy seats.
//!
//! Scope and honest gaps. The schedule and the report primitives reproduce the actual source functions
//! (parity/policy/bot-tournament.json, captured from tournament/report.ts, tournament/worker.ts and
//! tournament/runTournament.ts in the pinned Linux amd64 Node 22.23.4 container); the ported surfaces are pinned exactly.
//! Game outcomes are reduced native diagnostics, not full source-brain parity. Humanizer counters are
//! available; unported hunt/tactics counters remain absent. Damage/first-hit telemetry is available
//! only in the reduced melee profile; advanced profiles explicitly return unavailable fields.
//! Learning is off and actual play rejects an enabled plan. Command delay is optional, bounded and
//! per-seat: its RNG ownership and undelayed observations deliberately differ from the source manager.
//!
//! Policies see only Observation and act through validate + submit. Pure play returns deterministic
//! values; play_measured adds worker durations outside simulation and never feeds clocks to policies.

use crate::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::bots::{HumanBot, PersonaId, TierId};

use rh_sim::constants::{MAX_PLAYERS, TICK_MS};
use rh_sim::content::FactionId;
use rh_sim::rng::Mulberry32;
use rh_sim::{
    Arena, ArenaMode, ArenaRules, Event, Outcome, PlayerId, RunResult, SimConfig, Status,
};

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
    /// Independent games are split across this many workers and returned in plan order.
    pub workers: u32,
    /// Learning on (`--learn on`, with `--policy brain`): the games are played one after another in plan order through
    /// one in-memory store (`tournament_learning::play_learning`); `workers` does not apply. `play`/`run_game` need false.
    pub learn: bool,
    /// Patience seconds at a full lobby, scaling to 40% (source planOf config.patienceSeconds; None = the headless
    /// defaults).
    pub patience_seconds: Option<f64>,
    /// Sudden death seconds (source planOf config.suddenDeathSeconds; None = the headless default).
    pub sudden_death_seconds: Option<f64>,
    /// Command-only diagnostic delay with independent per-seat jitter (source: shared manager RNG).
    /// Observations are not delayed. None/zero preserves the ordinary Env path.
    pub latency_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    /// The source tune.ts table patch (`--tune`): applied to the Brain tables for this tournament only (`tune::plan_tables`);
    /// an invalid patch is refused before any game.
    pub tune: Option<serde_json::Value>,
    /// Write every game's reduced summary NDJSON to this directory (the source telemetry record is the P-BOTS-6
    /// remainder item 3; this is the ported telemetry surface).
    pub telemetry_dir: Option<String>,
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
            workers: 1,
            learn: false,
            patience_seconds: None,
            sudden_death_seconds: None,
            latency_ms: None,
            jitter_ms: None,
            tune: None,
            telemetry_dir: None,
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
            workers: 1,
            learn: false,
            patience_seconds: None,
            sudden_death_seconds: None,
            latency_ms: None,
            jitter_ms: None,
            tune: None,
            telemetry_dir: None,
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

/// The headless sim config a plan asks for: the source plan.config patience/sudden-death overrides over the fixed
/// headless defaults (a tournament is a pure function of its plan).
pub fn sim_config_for(plan: &TournamentPlan) -> SimConfig {
    let mut config = default_sim_config();
    if let ArenaMode::Source(rules) = &mut config.lifecycle {
        if let Some(patience) = plan.patience_seconds {
            rules.patience_seconds = patience;
            rules.patience_min_seconds = patience * 0.4;
        }
        if let Some(sudden) = plan.sudden_death_seconds {
            rules.sudden_death_seconds = sudden;
        }
    }
    config
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

/// The humanizer/brain telemetry block of one bot-game (source game.ts BotBehaviour). The humanizer counters are ported
/// and always present; the hunt/tactics/goals counters are written by the brain layers that are still the
/// P-BOTS-1/P-BOTS-3/P-BOTS-4 remainder, so they are None (absent, never zeroed) until those layers land.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BotBehaviour {
    /// Command type -> count, sorted by name (source sortedRecord).
    pub commands: Vec<(String, u64)>,
    pub commands_total: u64,
    /// Stimulus kind -> click delays (ms, rounded), sorted by kind (source game.ts rounds with Math.round).
    pub reactions: Vec<(String, Vec<u64>)>,
    pub target_clicks: u64,
    pub click_missed: u64,
    pub click_wrong: u64,
    pub hesitations: u64,
    pub lapses: u64,
    pub throttled: u64,
    pub superseded: u64,
    pub apm_peak: u64,
    pub mob_targets: Option<u64>,
    pub mob_drops: Option<u64>,
    pub retreats: Option<u64>,
    pub mob_focus_ms: Option<u64>,
    pub grabs: Option<u64>,
    pub max_stall_ms: Option<u64>,
    pub dodges: Option<u64>,
    pub jukes: Option<u64>,
    pub kite_cycles: Option<u64>,
    pub goals: Option<Vec<(String, u64)>>,
}

/// What one bot measured about itself in a game, as the ported Env exposes it (source game.ts BotGameSummary).
#[derive(Clone, Debug, PartialEq)]
pub struct BotSummary {
    pub seat: SeatSpec,
    /// The seat's index in the game's lineup.
    pub index: u32,
    /// 1 = the winner; a draw's players share 1; players downed in one tick share a place; a capped survivor is 1.
    pub place: f64,
    pub outcome: GameOutcome,
    pub kills: f64,
    pub mob_kills: f64,
    /// Damage to players and to mobs, from the public hit events (the same hit fx the source tallies).
    /// Unavailable outside the reduced melee profile.
    pub damage: Option<f64>,
    pub mob_damage: Option<f64>,
    pub deaths: f64,
    pub gv: f64,
    /// Milliseconds since the raid started, null while standing at the end (or at the cap).
    pub died_at_ms: Option<f64>,
    /// Since the raid started: the first mob this bot killed (null: none). A tuning diagnostic.
    pub first_mob_kill_ms: Option<f64>,
    /// Its hp share when the coliseum teleport came (null: it was down already, or there was no teleport).
    pub tp_hp: Option<f64>,
    pub died_to: Option<DiedTo>,
    pub behaviour: BotBehaviour,
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

/// One hit between two players: [ms since the raid started, attacker index, victim index, attacker hp share, victim hp
/// share, victim busy, attacker busy] (source game.ts firstHits tuple).
pub type FirstHit = (f64, usize, usize, f64, f64, u8, u8);

/// One tournament game, summarised as plain data (source game.ts GameSummary).
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
    /// Since the raid started: the first player a bot killed; null when none. A tuning diagnostic.
    pub first_kill_ms: Option<f64>,
    /// Every bot's death in order: (ms since the raid started, victim index, killer index or None for a mob/arena).
    pub death_log: Vec<(f64, usize, Option<usize>)>,
    pub first_hits: Option<Vec<FirstHit>>,
    /// The coliseum teleport, since the raid started; null when it never happened.
    pub teleport_ms: Option<f64>,
    /// The moment sudden death's burn began; null when it never happened.
    pub sudden_death_ms: Option<f64>,
    pub bots: Vec<BotSummary>,
    pub manager: ManagerCounts,
}

/// One game's result: its plan index and summary (source worker.ts GameResult).
#[derive(Clone, Debug, PartialEq)]
pub struct GameResult {
    pub index: u32,
    pub summary: GameSummary,
}

/// The hp share the source prints: the fraction, rounded to hundredths (Math.round(x * 100) / 100).
fn hp_share(p: &rh_sim::state::Player) -> f64 {
    if p.vitals.max_hp > 0. {
        (p.vitals.hp / p.vitals.max_hp * 100.).round() / 100.
    } else {
        0.
    }
}

/// Round to the nearest integer the way the source Math.round does for the non-negative reaction delays.
fn js_round(x: f64) -> u64 {
    if !x.is_finite() || x <= 0. {
        0
    } else {
        (x + 0.5).floor() as u64
    }
}

/// One bot's combat tally while a game plays (source game.ts Tally and the fx observer).
#[derive(Clone, Default)]
struct Tally {
    kills: u64,
    mob_kills: u64,
    damage: f64,
    mob_damage: f64,
    died_at: Option<f64>,
    first_mob_kill: Option<f64>,
    tp_hp: Option<f64>,
    /// The last hit between bots: (since ms, other bot index).
    last_trade: Option<(f64, usize)>,
}

/// The plan's simulated command delay line, when the plan asks for one: latencyMs/jitterMs (None or 0 = no line, so the
/// zero-delay behaviour is exactly the unwrapped runner and stays byte-identical).
fn plan_delay(plan: &TournamentPlan) -> Option<(f64, f64)> {
    let latency = plan.latency_ms.unwrap_or(0.).max(0.);
    let jitter = plan.jitter_ms.unwrap_or(0.).max(0.);
    (latency > 0. || jitter > 0.).then_some((latency, jitter))
}

/// Hit-only telemetry is complete only for this reduced profile. Advanced profiles still play,
/// but damage and first-hit fields return None instead of omitting landed chunks silently.
fn damage_telemetry_supported(sim: &SimConfig) -> bool {
    sim.faction_mode == rh_sim::FactionMode::Off
        && sim.abilities == rh_sim::abilities::Mode::Off
        && sim.mob_mode == rh_sim::mob_runtime::MobMode::Off
        && !sim.initial_loot
        && !sim.quests
        && !sim.training
        && sim.hazards == rh_sim::terrain::Mode::Off
}

/// Play one game of the plan through rh-headless policy seats (source game.ts runGame).
pub fn run_game(index: u32, plan: &TournamentPlan, arena: &Arena, sim: &SimConfig) -> GameSummary {
    assert!(
        !plan.learn,
        "tournament learning runs through tournament_learning::play_learning"
    );
    run_game_seats(
        index,
        plan,
        arena,
        sim,
        |seat| Box::new(HumanBot::new(seat.tier, seat.persona)),
        |_, _, _, _| {},
    )
}

/// [`run_game`] with the seats' policies built by `policy_of`, calling `on_resolved(env, seat index, player id, result)` the moment
/// each seat's result arrives, in event order (source `BotManager.onResult`). The learning series uses it; `run_game`
/// is this with HumanBot seats and no hook.
pub fn run_game_seats(
    index: u32,
    plan: &TournamentPlan,
    arena: &Arena,
    sim: &SimConfig,
    policy_of: impl Fn(&SeatSpec) -> Box<dyn rh_policy::Policy>,
    mut on_resolved: impl FnMut(&mut Env, usize, PlayerId, &RunResult),
) -> GameSummary {
    let game = plan_game(plan, index);
    let damage_available = damage_telemetry_supported(sim);
    let delay = plan_delay(plan);
    let agents: Vec<AgentSpec> = game
        .lineup
        .iter()
        .enumerate()
        .map(|(i, seat)| AgentSpec {
            profile: format!("bot{i}"),
            faction: seat.faction,
            bot: true,
            agent: Agent::Policy {
                policy: policy_of(seat),
            },
        })
        .collect();
    let ticks_cap = ((if plan.max_sim_ms > 0. {
        plan.max_sim_ms
    } else {
        MAX_GAME_MS
    }) / TICK_MS)
        .ceil() as u32;
    let mut env = Env::new_delayed(
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
        delay,
    );
    let ids: Vec<PlayerId> = env.sim.players().iter().map(|p| p.id).collect();
    let mut resolved: Vec<Option<RunResult>> = vec![None; ids.len()];
    let mut tallies: Vec<Tally> = vec![Tally::default(); ids.len()];
    let mut raid_start_tick: Option<u32> = None;
    let mut teleport_tick: Option<u32> = None;
    let mut first_death_ms: Option<f64> = None;
    let mut first_kill_ms: Option<f64> = None;
    let mut death_log: Vec<(f64, usize, Option<usize>)> = Vec::new();
    let mut first_hits: Vec<FirstHit> = Vec::new();
    let mut pair_seen: std::collections::BTreeSet<u32> = std::collections::BTreeSet::new();
    let mut end_tick;
    let ended;
    loop {
        let progress = env.advance(&[]);
        end_tick = progress.tick;
        for event in env.last_events().to_vec() {
            match event {
                Event::RaidStarted if raid_start_tick.is_none() => {
                    raid_start_tick = Some(progress.tick);
                }
                Event::Teleported if teleport_tick.is_none() => {
                    teleport_tick = Some(progress.tick);
                    for (i, tally) in tallies.iter_mut().enumerate() {
                        let player = env.sim.player(ids[i]).expect("the seat's player");
                        tally.tp_hp = (player.status == Status::Alive).then(|| hp_share(player));
                    }
                }
                Event::Hit {
                    victim,
                    by: Some(by),
                    amount,
                    ..
                } if by != victim => {
                    let Some(victim_index) = ids.iter().position(|id| *id == victim) else {
                        // A mob victim: attribute to the attacker (source tally.mobDamage).
                        if let Some(by_index) = ids.iter().position(|id| *id == by) {
                            tallies[by_index].mob_damage += amount;
                        }
                        continue;
                    };
                    let Some(by_index) = ids.iter().position(|id| *id == by) else {
                        continue;
                    };
                    tallies[by_index].damage += amount;
                    let at = since_ms(raid_start_tick, progress.tick);
                    let a = by_index;
                    let v = victim_index;
                    let key = (a.min(v) * 16 + a.max(v)) as u32;
                    if pair_seen.insert(key) {
                        let hp = |player: &rh_sim::state::Player| hp_share(player);
                        let attacker = env.sim.player(ids[a]).expect("attacker");
                        let victim_player = env.sim.player(ids[v]).expect("victim");
                        let busy = |who: usize, other: usize| -> u8 {
                            match tallies[who].last_trade {
                                Some((last, partner)) if partner != other && at - last <= 3000. => {
                                    1
                                }
                                _ => 0,
                            }
                        };
                        first_hits.push((
                            at,
                            a,
                            v,
                            hp(attacker),
                            hp(victim_player),
                            busy(v, a),
                            busy(a, v),
                        ));
                    }
                    tallies[a].last_trade = Some((at, v));
                    tallies[v].last_trade = Some((at, a));
                }
                Event::Death { id, by, .. } => {
                    let at = since_ms(raid_start_tick, progress.tick);
                    let Some(victim) = ids.iter().position(|candidate| *candidate == id) else {
                        // A mob death: the player who dealt it killed a mob.
                        if let Some(killer_id) = by {
                            if let Some(killer) =
                                ids.iter().position(|candidate| *candidate == killer_id)
                            {
                                tallies[killer].mob_kills += 1;
                                tallies[killer].first_mob_kill = Some(
                                    tallies[killer].first_mob_kill.map_or(at, |old| old.min(at)),
                                );
                            }
                        }
                        continue;
                    };
                    let killer = by.and_then(|killer| ids.iter().position(|c| *c == killer));
                    if tallies[victim].died_at.is_none() {
                        tallies[victim].died_at = Some(at);
                        first_death_ms = Some(first_death_ms.map_or(at, |old| old.min(at)));
                        death_log.push((at, victim, killer));
                    }
                    if let Some(killer) = killer.filter(|k| *k != victim) {
                        tallies[killer].kills += 1;
                        first_kill_ms = Some(first_kill_ms.map_or(at, |old| old.min(at)));
                    }
                }
                Event::Resolved { id, result, .. } => {
                    if let Some(i) = ids.iter().position(|candidate| *candidate == id) {
                        on_resolved(&mut env, i, id, &result);
                        resolved[i] = Some(result);
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
    let telemetry = env.seat_telemetry();
    let behaviour = |stats: Option<rh_policy::PolicyStats>| -> BotBehaviour {
        let Some(stats) = stats else {
            return BotBehaviour::default();
        };
        let mut commands = stats.commands;
        commands.sort_by(|a, b| a.0.cmp(&b.0));
        let commands_total = commands.iter().map(|(_, n)| *n).sum();
        let mut reactions: Vec<(String, Vec<u64>)> = stats
            .reactions
            .into_iter()
            .map(|(kind, samples)| (kind, samples.into_iter().map(js_round).collect()))
            .collect();
        reactions.sort_by(|a, b| a.0.cmp(&b.0));
        BotBehaviour {
            commands,
            commands_total,
            reactions,
            target_clicks: stats.target_clicks,
            click_missed: stats.click_missed,
            click_wrong: stats.click_wrong,
            hesitations: stats.hesitations,
            lapses: stats.lapses,
            throttled: stats.throttled,
            superseded: stats.superseded,
            apm_peak: stats.apm_peak,
            mob_targets: None,
            mob_drops: None,
            retreats: None,
            mob_focus_ms: None,
            grabs: None,
            max_stall_ms: None,
            dodges: None,
            jukes: None,
            kite_cycles: None,
            goals: None,
        }
    };
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
        let tally = &tallies[i];
        bots.push(BotSummary {
            seat: *seat,
            index: i as u32,
            place: result.as_ref().map_or(1., |r| f64::from(r.place)),
            outcome,
            kills: tally.kills as f64,
            mob_kills: tally.mob_kills as f64,
            damage: damage_available.then(|| tally.damage.round()),
            mob_damage: damage_available.then(|| tally.mob_damage.round()),
            deaths: result.as_ref().map_or(0., |r| {
                if matches!(r.outcome, Outcome::Died | Outcome::Mia) {
                    1.
                } else {
                    0.
                }
            }),
            gv: result.as_ref().map_or(0., |r| f64::from(r.gv.total)),
            died_at_ms: tally.died_at,
            first_mob_kill_ms: tally.first_mob_kill,
            tp_hp: tally.tp_hp,
            died_to: match outcome {
                GameOutcome::Died | GameOutcome::Mia => result.as_ref().map(died_to),
                _ => None,
            },
            behaviour: behaviour(telemetry[i].clone()),
        });
    }
    let duration_ms = since_ms(raid_start_tick, end_tick);
    GameSummary {
        seed: game.seed,
        lineup: game.lineup,
        ended,
        winner,
        draw,
        duration_ms,
        ticks: end_tick,
        first_death_ms,
        first_kill_ms,
        death_log,
        first_hits: damage_available.then_some(first_hits),
        teleport_ms: teleport_tick.map(|tick| since_ms(raid_start_tick, tick)),
        sudden_death_ms: None,
        bots,
        manager: manager_counts(&env),
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

/// A fold from positive zero: Iterator::sum for f64 starts at -0.0, which the source (0) does not.
fn sum_iter(xs: impl Iterator<Item = f64>) -> f64 {
    xs.fold(0., |sum, x| sum + x)
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

/// A per-key aggregate of bot-games (source report.ts GroupAgg).
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

/// One reaction-delay row (source report.ts ReactionRow).
#[derive(Clone, Debug, PartialEq)]
pub struct ReactionRow {
    pub kind: String,
    pub n: f64,
    pub p10: f64,
    pub p50: f64,
    pub p90: f64,
    pub mean: f64,
    pub table: f64,
}

/// The pooled plain-reaction row (source TierAgg.pooled).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PooledReaction {
    pub n: f64,
    pub mean: f64,
    pub table: f64,
    pub ratio: f64,
}

/// One tier's aggregate (source report.ts TierAgg). The hunt/tactics columns whose counters are not in the ported policy
/// telemetry yet are NaN and print as "-" (the source's own absent-figure rendering); they fill in when the brain layers
/// land. Nothing is zeroed to stand in for absent data.
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
    pub damage_per_bot: f64,
    pub mob_damage_per_bot: f64,
    pub mob_kills_per_bot: f64,
    pub gv_per_bot: f64,
    pub alive_seconds: f64,
    pub never_fought: f64,
    pub died_to: DiedToCounts,
    pub reactions: Vec<ReactionRow>,
    pub pooled: PooledReaction,
    pub target_clicks: f64,
    pub miss_rate: f64,
    pub wrong_rate: f64,
    pub apm_mean: f64,
    pub apm_peak_mean: f64,
    pub apm_peak_max: f64,
    pub apm_limit: f64,
    pub apm_breaches: f64,
    pub dodges_per_bot: f64,
    pub jukes_per_bot: f64,
    pub kite_cycles_per_bot: f64,
    pub hesitations_per_bot: f64,
    pub throttled_per_bot: f64,
    pub max_stall_ms: f64,
    pub stalls: f64,
}

/// The run-duration summary (source Report.duration).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DurationSummary {
    pub mean_s: f64,
    pub p50_s: f64,
    pub min_s: f64,
    pub max_s: f64,
}

/// The whole tournament report (source report.ts Report).
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

/// The stimulus kinds the source does not pool as plain reaction (scaled by attention or reading).
const SCALED_KINDS: [&str; 5] = [
    "newThreat",
    "teleport",
    "announcement",
    "chestUp",
    "planOffer",
];

/// Aggregate every game into the report (source report.ts aggregate).
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
    let present = |t: TierId| all.iter().any(|b| b.seat.tier == t);
    let tiers = TIER_IDS
        .into_iter()
        .filter(|t| present(*t))
        .map(|t| tier_agg(t, games, total_wins))
        .collect();
    let personas: Vec<GroupAgg> = PERSONA_IDS
        .iter()
        .map(|p| {
            let rows: Vec<&BotSummary> = all
                .iter()
                .copied()
                .filter(|b| b.seat.persona == *p)
                .collect();
            group(p.as_str(), &rows)
        })
        .filter(|g| g.bot_games > 0.)
        .collect();
    let factions: Vec<GroupAgg> = FACTION_IDS
        .iter()
        .map(|f| {
            let rows: Vec<&BotSummary> = all
                .iter()
                .copied()
                .filter(|b| b.seat.faction == *f)
                .collect();
            group(f.as_str(), &rows)
        })
        .filter(|g| g.bot_games > 0.)
        .collect();
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
        refused: sum_iter(games.iter().map(|g| g.manager.refused as f64)),
        lost: sum_iter(games.iter().map(|g| g.manager.lost as f64)),
        errors: sum_iter(games.iter().map(|g| g.manager.errors as f64)),
        tiers,
        personas,
        factions,
    }
}

fn tier_agg(tier: TierId, games: &[GameSummary], total_wins: f64) -> TierAgg {
    let params = tier_params(tier);
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
    let per = |f: &dyn Fn(&BotSummary) -> f64| -> f64 {
        if n == 0. {
            f64::NAN
        } else {
            sum_iter(rows.iter().map(|b| f(b))) / n
        }
    };
    // Reaction samples per kind, then the pooled plain kinds.
    let mut by_kind: std::collections::BTreeMap<String, Vec<f64>> =
        std::collections::BTreeMap::new();
    for b in &rows {
        for (kind, samples) in &b.behaviour.reactions {
            by_kind
                .entry(kind.clone())
                .or_default()
                .extend(samples.iter().map(|x| *x as f64));
        }
    }
    let mut reactions: Vec<ReactionRow> = Vec::new();
    let mut pool: Vec<f64> = Vec::new();
    for (kind, mut xs) in by_kind {
        xs.sort_by(|a, b| a.total_cmp(b));
        reactions.push(ReactionRow {
            kind: kind.clone(),
            n: xs.len() as f64,
            p10: percentile(&xs, 0.1),
            p50: percentile(&xs, 0.5),
            p90: percentile(&xs, 0.9),
            mean: mean(&xs),
            table: table_reaction_mean(tier, &kind),
        });
        if !SCALED_KINDS.contains(&kind.as_str()) {
            pool.extend(xs);
        }
    }
    let pooled_mean = mean(&pool);
    let table = params.reaction.mu + params.reaction.tau;
    let alive_ms =
        |game: &GameSummary, b: &BotSummary| -> f64 { b.died_at_ms.unwrap_or(game.duration_ms) };
    let mut alive_min = 0.;
    let mut commands = 0.;
    let mut clicks = 0.;
    for game in games {
        for b in &game.bots {
            if b.seat.tier != tier {
                continue;
            }
            commands += b.behaviour.commands_total as f64;
            alive_min += alive_ms(game, b) / 60_000.;
            clicks += b.behaviour.target_clicks as f64;
        }
    }
    let apm_limit = params.apm + params.burst;
    let all_opt = |get: &dyn Fn(&BotBehaviour) -> Option<u64>| -> Option<Vec<f64>> {
        let mut out = Vec::new();
        for b in &rows {
            out.push(get(&b.behaviour)?.to_owned() as f64);
        }
        (!out.is_empty()).then_some(out)
    };
    let opt_mean = |get: &dyn Fn(&BotBehaviour) -> Option<u64>| -> f64 {
        all_opt(get).map_or(f64::NAN, |xs| mean(&xs))
    };
    let opt_max = |get: &dyn Fn(&BotBehaviour) -> Option<u64>| -> f64 {
        all_opt(get).map_or(f64::NAN, |xs| xs.iter().copied().fold(0., f64::max))
    };
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
        kills_per_bot: per(&|b| b.kills),
        deaths_per_bot: per(&|b| b.deaths),
        damage_per_bot: per(&|b| b.damage.unwrap_or(f64::NAN)),
        mob_damage_per_bot: per(&|b| b.mob_damage.unwrap_or(f64::NAN)),
        mob_kills_per_bot: per(&|b| b.mob_kills),
        gv_per_bot: per(&|b| b.gv),
        alive_seconds: if n == 0. {
            f64::NAN
        } else {
            let mut total = 0.;
            for game in games {
                for b in &game.bots {
                    if b.seat.tier == tier {
                        total += alive_ms(game, b);
                    }
                }
            }
            total / n / 1000.
        },
        never_fought: if rows
            .iter()
            .any(|b| b.damage.is_none() || b.mob_damage.is_none())
        {
            f64::NAN
        } else {
            rows.iter()
                .filter(|b| b.damage == Some(0.) && b.mob_damage == Some(0.))
                .count() as f64
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
        reactions,
        pooled: PooledReaction {
            n: pool.len() as f64,
            mean: pooled_mean,
            table,
            ratio: pooled_mean / table,
        },
        target_clicks: clicks,
        miss_rate: if clicks == 0. {
            f64::NAN
        } else {
            sum_iter(rows.iter().map(|b| b.behaviour.click_missed as f64)) / clicks
        },
        wrong_rate: if clicks == 0. {
            f64::NAN
        } else {
            sum_iter(rows.iter().map(|b| b.behaviour.click_wrong as f64)) / clicks
        },
        apm_mean: if alive_min == 0. {
            f64::NAN
        } else {
            commands / alive_min
        },
        apm_peak_mean: per(&|b| b.behaviour.apm_peak as f64),
        apm_peak_max: rows
            .iter()
            .map(|b| b.behaviour.apm_peak as f64)
            .fold(0., f64::max),
        apm_limit,
        apm_breaches: rows
            .iter()
            .filter(|b| b.behaviour.apm_peak as f64 > apm_limit)
            .count() as f64,
        dodges_per_bot: opt_mean(&|b| b.dodges),
        jukes_per_bot: opt_mean(&|b| b.jukes),
        kite_cycles_per_bot: opt_mean(&|b| b.kite_cycles),
        hesitations_per_bot: per(&|b| b.behaviour.hesitations as f64),
        throttled_per_bot: per(&|b| b.behaviour.throttled as f64),
        max_stall_ms: opt_max(&|b| b.max_stall_ms),
        stalls: all_opt(&|b| b.max_stall_ms).map_or(f64::NAN, |xs| {
            xs.iter().filter(|x| **x > STALL_LIMIT_MS).count() as f64
        }),
    }
}
/// The source diedTo(result): arena for sudden death, bot when a player dealt the blow, otherwise a mob.
fn died_to(result: &RunResult) -> DiedTo {
    if result.killed_by.as_deref() == Some("sudden death") {
        DiedTo::Arena
    } else if result.killed_by_bot {
        DiedTo::Bot
    } else {
        DiedTo::Mob
    }
}

/// The manager counters from the seats (source manager.stats).
fn manager_counts(env: &Env) -> ManagerCounts {
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
    manager
}

/// A pass criterion (source report.ts Criterion): ok = null when the tier data is missing.
#[derive(Clone, Debug, PartialEq)]
pub struct Criterion {
    pub ok: Option<bool>,
    pub text: String,
}

/// Informational bands of docs/BOTS.md 9.3: the starting win shares to tune toward (source WIN_BANDS).
pub fn win_band(tier: TierId) -> (f64, f64) {
    match tier {
        TierId::Hard => (0.25, 0.35),
        TierId::Normal => (0.13, 0.2),
        TierId::Easy => (0.04, 0.1),
    }
}

fn fixed(x: f64, digits: usize) -> String {
    if !x.is_finite() {
        return "-".to_owned();
    }
    format!("{:.*}", digits, x)
}
fn f0(x: f64) -> String {
    if x.is_finite() {
        format!("{}", (x + 0.5).floor())
    } else {
        "-".to_owned()
    }
}
fn f1(x: f64) -> String {
    fixed(x, 1)
}
fn f2(x: f64) -> String {
    fixed(x, 2)
}
fn pct(x: f64, d: usize) -> String {
    if x.is_finite() {
        format!("{}%", fixed(x * 100., d))
    } else {
        "-".to_owned()
    }
}
/// The source String(number) rendering: integers as integers, non-integers shortest, NaN as "NaN".
fn js_num(x: f64) -> String {
    if !x.is_finite() {
        return "NaN".to_owned();
    }
    if x.fract() == 0. {
        format!("{}", x as i64)
    } else {
        format!("{x}")
    }
}
fn interval(p: &Proportion) -> String {
    format!("{} [{}, {}]", pct(p.p, 1), pct(p.lo, 1), pct(p.hi, 1))
}
fn pad(s: &str, w: usize) -> String {
    if s.len() >= w {
        s.to_owned()
    } else {
        format!("{s}{}", " ".repeat(w - s.len()))
    }
}
fn lpad(s: &str, w: usize) -> String {
    if s.len() >= w {
        s.to_owned()
    } else {
        format!("{}{s}", " ".repeat(w - s.len()))
    }
}
fn table(head: &[&str], rows: &[Vec<String>]) -> Vec<String> {
    let widths: Vec<usize> = head
        .iter()
        .enumerate()
        .map(|(i, h)| {
            rows.iter()
                .map(|r| r.get(i).map_or(0, String::len))
                .max()
                .unwrap_or(0)
                .max(h.len())
        })
        .collect();
    let line = |r: &[String]| -> String {
        let cells: Vec<String> = r
            .iter()
            .enumerate()
            .map(|(i, c)| {
                if i == 0 {
                    pad(c, widths[i])
                } else {
                    lpad(c, widths[i])
                }
            })
            .collect();
        cells.join("  ").trim_end().to_owned()
    };
    let mut out = vec![line(
        &head.iter().map(|h| (*h).to_owned()).collect::<Vec<_>>(),
    )];
    out.push(line(
        &widths.iter().map(|w| "-".repeat(*w)).collect::<Vec<_>>(),
    ));
    for r in rows {
        out.push(line(r));
    }
    out
}

/// The source evaluate(r): the informational pass criteria of docs/BOTS.md 9.3 (a tool always exits 0).
pub fn evaluate(r: &Report) -> Vec<Criterion> {
    let by: std::collections::BTreeMap<&str, &TierAgg> =
        r.tiers.iter().map(|t| (t.tier.as_str(), t)).collect();
    let easy = by.get("easy").copied();
    let normal = by.get("normal").copied();
    let hard = by.get("hard").copied();
    let mut out = Vec::new();
    let order = |out: &mut Vec<Criterion>, label: &str, vals: Vec<(&str, f64)>, higher: bool| {
        let have: Vec<(&str, f64)> = vals.into_iter().filter(|(_, v)| v.is_finite()).collect();
        if have.len() < 2 {
            out.push(Criterion {
                ok: None,
                text: format!("{label}: needs two tiers in the lineup"),
            });
            return;
        }
        let mut ok = true;
        for i in 1..have.len() {
            ok &= if higher {
                have[i - 1].1 > have[i].1
            } else {
                have[i - 1].1 < have[i].1
            };
        }
        let joined: Vec<String> = have
            .iter()
            .map(|(n, v)| format!("{n} {}", f2(*v)))
            .collect();
        out.push(Criterion {
            ok: Some(ok),
            text: format!(
                "{label}: {}",
                joined.join(if higher { " > " } else { " < " })
            ),
        });
    };
    let tiers: Vec<&TierAgg> = [hard, normal, easy].into_iter().flatten().collect();
    order(
        &mut out,
        "mean placement orders Hard < Normal < Easy (lower is better)",
        tiers
            .iter()
            .map(|t| (t.tier.as_str(), t.place.mean))
            .collect(),
        false,
    );
    order(
        &mut out,
        "win share orders Hard > Normal > Easy (per-bot)",
        tiers
            .iter()
            .map(|t| (t.tier.as_str(), t.win_rate.p))
            .collect(),
        true,
    );
    for i in 1..tiers.len() {
        let a = tiers[i - 1];
        let b = tiers[i];
        out.push(Criterion {
            ok: Some(a.place.hi < b.place.lo),
            text: format!(
                "mean-placement 90% intervals {} [{}, {}] and {} [{}, {}] do not overlap",
                a.tier.as_str(),
                f2(a.place.lo),
                f2(a.place.hi),
                b.tier.as_str(),
                f2(b.place.lo),
                f2(b.place.hi)
            ),
        });
    }
    if let Some(hard) = hard {
        out.push(Criterion {
            ok: Some(hard.win_rate.p <= 0.4),
            text: format!("Hard per-bot win share {} <= 0.40", f2(hard.win_rate.p)),
        });
    }
    if let Some(easy) = easy {
        out.push(Criterion {
            ok: Some(easy.win_rate.p >= 0.03),
            text: format!("Easy per-bot win share {} >= 0.03", f2(easy.win_rate.p)),
        });
    }
    for t in &tiers {
        let (lo, hi) = win_band(t.tier);
        out.push(Criterion {
            ok: Some(t.win_rate.p >= lo && t.win_rate.p <= hi),
            text: format!(
                "{} per-bot win share {} in the starting band {}-{}",
                t.tier.as_str(),
                f2(t.win_rate.p),
                f2(lo),
                f2(hi)
            ),
        });
    }
    for t in tiers.iter().rev() {
        out.push(Criterion {
            ok: if t.pooled.ratio.is_finite() {
                Some((t.pooled.ratio - 1.).abs() <= 0.1)
            } else {
                None
            },
            text: format!(
                "{} measured reaction mean {} ms (n={}) within +-10% of the table's {} ms (ratio {})",
                t.tier.as_str(),
                f0(t.pooled.mean),
                f0(t.pooled.n),
                f0(t.pooled.table),
                f2(t.pooled.ratio)
            ),
        });
    }
    out.push(Criterion {
        ok: Some(r.refused == 0.),
        text: format!(
            "zero commands refused by enqueueClientMessage ({})",
            js_num(r.refused)
        ),
    });
    out.push(Criterion {
        ok: Some(r.errors == 0.),
        text: format!("zero brain errors ({})", js_num(r.errors)),
    });
    let breaches = sum_iter(r.tiers.iter().map(|t| t.apm_breaches));
    out.push(Criterion {
        ok: Some(breaches == 0.),
        text: format!(
            "zero APM breaches (a 60 s window above the tier's apm + burst): {}",
            js_num(breaches)
        ),
    });
    out.push(Criterion {
        ok: Some(r.capped == 0.),
        text: format!("no game hit the 12-minute cap ({})", js_num(r.capped)),
    });
    let stalls = sum_iter(r.tiers.iter().map(|t| t.stalls));
    out.push(Criterion {
        ok: if stalls.is_finite() {
            Some(stalls == 0.)
        } else {
            None
        },
        text: format!(
            "no bot stood stalled for more than {} s ({} bot-games)",
            STALL_LIMIT_MS / 1000.,
            f0(stalls)
        ),
    });
    out
}

/// What a tournament ran, for the printed header and the JSON payload (source report.ts ReportMeta).
#[derive(Clone, Debug, PartialEq)]
pub struct ReportMeta {
    pub lineup: String,
    pub seed: u32,
    pub learn: bool,
    pub persona: String,
    pub faction: String,
    pub workers: u32,
    /// Wall time of the whole run, ms (null when the report is of stored games).
    pub wall_ms: Option<f64>,
    /// Mean wall time of one game in a worker, ms (the rate without the workers' start-up).
    pub game_ms: Option<f64>,
}

/// The report as the source formatReport prints it, over the source meta.
pub fn format_report_with(r: &Report, meta: &ReportMeta) -> String {
    let mut l: Vec<String> = Vec::new();
    let sim_total_s = r.duration.mean_s * r.games;
    l.push(format!(
        "TOURNAMENT  {} games  lineup {}  seed {}  persona {}  faction {}  learning {}",
        js_num(r.games),
        meta.lineup,
        meta.seed,
        meta.persona,
        meta.faction,
        if meta.learn {
            "on (per worker, in memory)"
        } else {
            "off"
        }
    ));
    l.push(format!(
        "games: {} with a winner, {} draws, {} cut off at the cap",
        js_num(r.decided),
        js_num(r.draws),
        js_num(r.capped)
    ));
    l.push(format!(
        "length: mean {} s, median {} s, min {} s, max {} s (simulated, raid start to end)",
        f1(r.duration.mean_s),
        f1(r.duration.p50_s),
        f1(r.duration.min_s),
        f1(r.duration.max_s)
    ));
    l.push(format!(
        "first death: median {} s into the raid; teleport in {} of games, sudden death in {}",
        f1(r.first_death_median_s),
        pct(r.teleport_share, 0),
        pct(r.sudden_death_share, 0)
    ));
    if let Some(wall) = meta.wall_ms.filter(|wall| *wall > 0.) {
        let sec = wall / 1000.;
        l.push(format!(
            "throughput: {} games in {} s wall = {} games/s with {} worker{} ({} simulated s per wall s)",
            js_num(r.games),
            f1(sec),
            f2(r.games / sec),
            meta.workers,
            if meta.workers == 1 { "" } else { "s" },
            f1(sim_total_s / sec)
        ));
        if let Some(game_ms) = meta.game_ms {
            l.push(format!(
                "per game: {} ms of wall in a worker on average ({} simulated s per wall s per worker, so {} games/s per worker once started)",
                f0(game_ms),
                f1(r.duration.mean_s * 1000. / game_ms),
                f1(1000. / game_ms)
            ));
        }
    }
    l.push(String::new());
    l.push("PER TIER  (a bot-game is one bot in one game; win/bot = wins per bot-game, Wilson 95%; place = mean of the tier's placements per game, 90% interval)".to_owned());
    let tier_rows: Vec<Vec<String>> = r
        .tiers
        .iter()
        .map(|t| {
            vec![
                t.tier.as_str().to_owned(),
                js_num(t.bot_games),
                js_num(t.wins),
                interval(&t.win_rate),
                pct(t.share_of_wins, 1),
                js_num(t.draws),
                format!(
                    "{} [{}, {}]",
                    f2(t.place.mean),
                    f2(t.place.lo),
                    f2(t.place.hi)
                ),
                f2(t.kills_per_bot),
                f2(t.deaths_per_bot),
                f0(t.damage_per_bot),
                f0(t.mob_damage_per_bot),
                f2(t.mob_kills_per_bot),
                f1(t.gv_per_bot),
                f1(t.alive_seconds),
            ]
        })
        .collect();
    l.extend(table(
        &[
            "tier",
            "bot-games",
            "wins",
            "win/bot [95%]",
            "share of wins",
            "draws",
            "place [90%]",
            "kills",
            "deaths",
            "dmg",
            "mob dmg",
            "mob kills",
            "gv",
            "alive s",
        ],
        &tier_rows,
    ));
    l.push("(kills, deaths, dmg, mob dmg, mob kills, gv are per bot-game; dmg is damage to players, from the hit fx)".to_owned());
    l.push(String::new());
    l.push("HOW THEY DIED  (bot-games; a bot that won or was cut off is in none)".to_owned());
    let died_rows: Vec<Vec<String>> = r
        .tiers
        .iter()
        .map(|t| {
            vec![
                t.tier.as_str().to_owned(),
                js_num(t.died_to.bot),
                js_num(t.died_to.mob),
                js_num(t.died_to.arena),
                js_num(t.never_fought),
            ]
        })
        .collect();
    l.extend(table(
        &[
            "tier",
            "to a bot",
            "to a mob",
            "to sudden death",
            "never fought",
        ],
        &died_rows,
    ));
    l.push(String::new());
    l.push("REACTION DELAYS  (ms from the percept that first showed the stimulus to the click; the last 256 per bot, pooled)".to_owned());
    l.push("table = the tier's mu + tau (daze for a teleport, x1.5 for reading); newThreat, teleport and reading are further scaled by attention".to_owned());
    for t in &r.tiers {
        let mut rows: Vec<Vec<String>> = t
            .reactions
            .iter()
            .map(|x| {
                vec![
                    x.kind.clone(),
                    js_num(x.n),
                    f0(x.p10),
                    f0(x.p50),
                    f0(x.p90),
                    f0(x.mean),
                    f0(x.table),
                    f2(x.mean / x.table),
                ]
            })
            .collect();
        rows.push(vec![
            "pooled (plain)".to_owned(),
            js_num(t.pooled.n),
            String::new(),
            String::new(),
            String::new(),
            f0(t.pooled.mean),
            f0(t.pooled.table),
            f2(t.pooled.ratio),
        ]);
        l.extend(table(
            &[
                t.tier.as_str(),
                "n",
                "p10",
                "p50",
                "p90",
                "mean",
                "table",
                "ratio",
            ],
            &rows,
        ));
        l.push(String::new());
    }
    l.push("CLICKS, RATE AND MANEUVERS  (per bot-game unless stated)".to_owned());
    let click_rows: Vec<Vec<String>> = r
        .tiers
        .iter()
        .map(|t| {
            vec![
                t.tier.as_str().to_owned(),
                js_num(t.target_clicks),
                pct(t.miss_rate, 1),
                pct(t.wrong_rate, 1),
                f1(t.apm_mean),
                f1(t.apm_peak_mean),
                js_num(t.apm_peak_max),
                js_num(t.apm_limit),
                js_num(t.apm_breaches),
                f2(t.dodges_per_bot),
                f2(t.jukes_per_bot),
                f2(t.kite_cycles_per_bot),
                f2(t.hesitations_per_bot),
                f2(t.throttled_per_bot),
                js_num(t.max_stall_ms),
            ]
        })
        .collect();
    l.extend(table(
        &[
            "tier",
            "lock clicks",
            "miss",
            "wrong",
            "APM mean",
            "APM peak mean",
            "peak max",
            "limit",
            "breaches",
            "dodges",
            "jukes",
            "orb-walk cycles",
            "hesitations",
            "throttled",
            "max stall ms",
        ],
        &click_rows,
    ));
    l.push("(miss / wrong are per lock click; the table's lone-bot rates: easy ~7.4% / normal ~1.2% / hard ~0.2% misses; move-scatter RMS is not measured)".to_owned());
    l.push(String::new());
    for (title, groups) in [("PER PERSONA", &r.personas), ("PER FACTION", &r.factions)] {
        l.push(title.to_owned());
        let rows: Vec<Vec<String>> = groups
            .iter()
            .map(|g| {
                vec![
                    g.key.clone(),
                    js_num(g.bot_games),
                    interval(&g.win_rate),
                    f2(g.mean_place),
                    f2(g.kills_per_bot),
                ]
            })
            .collect();
        l.extend(table(
            &["", "bot-games", "win/bot [95%]", "mean place", "kills"],
            &rows,
        ));
        l.push(String::new());
    }
    l.push(format!(
        "MANAGER  refused {}, lost {}, brain errors {}",
        js_num(r.refused),
        js_num(r.lost),
        js_num(r.errors)
    ));
    l.push(String::new());
    l.push("CRITERIA  (informational; the tool exits 0)".to_owned());
    for c in evaluate(r) {
        l.push(format!(
            "  {}  {}",
            match c.ok {
                None => "n/a ",
                Some(true) => "PASS",
                Some(false) => "FAIL",
            },
            c.text
        ));
    }
    l.join("\n")
}

/// What a tournament ran, as plain data (source TournamentMeta, reduced: no wall-clock timing here).
#[derive(Clone, Debug, PartialEq)]
pub struct TournamentMeta {
    pub games: u32,
    pub seed: u32,
    pub lineup: Vec<TierId>,
    pub persona: String,
    pub faction: String,
    pub max_sim_ms: f64,
}

/// A game measured outside the simulation. Durations never enter policy input.
pub struct MeasuredGame {
    pub result: GameResult,
    pub wall_ms: f64,
}

/// Mean worker game duration, separate from parallel throughput's elapsed / games.
pub fn mean_game_ms(results: &[MeasuredGame]) -> Option<f64> {
    (!results.is_empty())
        .then(|| results.iter().map(|r| r.wall_ms).sum::<f64>() / results.len() as f64)
}

/// Games split across workers by [`split`], returned in plan order.
pub(crate) fn play_each<T: Send>(
    plan: &TournamentPlan,
    workers: u32,
    execute: impl Fn(u32) -> T + Sync,
) -> Vec<T> {
    // The plan's --tune patch (legacy applyTune): installed around every game on the thread that plays it.
    let tables = crate::tune::plan_tables(plan).unwrap_or_else(|error| panic!("{error}"));
    let batches = split(plan.games, workers);
    let mut results: Vec<(u32, T)> = std::thread::scope(|scope| {
        let execute = &execute;
        let handles: Vec<_> = batches
            .into_iter()
            .map(|batch| {
                scope.spawn(move || {
                    batch
                        .into_iter()
                        .map(|index| (index, crate::tune::scoped(tables, || execute(index))))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().expect("a tournament worker panicked"))
            .collect()
    });
    results.sort_by_key(|(index, _)| *index);
    results.into_iter().map(|(_, value)| value).collect()
}

/// Pure game values in plan order; no clock enters simulation or policy input.
pub fn play(plan: &TournamentPlan, arena: &Arena, sim: &SimConfig) -> Vec<GameResult> {
    play_parallel(plan, arena, sim, 1)
}

/// Independent games split across workers, returned in plan order.
pub fn play_parallel(
    plan: &TournamentPlan,
    arena: &Arena,
    sim: &SimConfig,
    workers: u32,
) -> Vec<GameResult> {
    play_each(plan, workers, |index| GameResult {
        index,
        summary: run_game(index, plan, arena, sim),
    })
}

/// Actual per-game worker wall durations, kept separate from deterministic game values.
pub fn play_measured(plan: &TournamentPlan, arena: &Arena, sim: &SimConfig) -> Vec<MeasuredGame> {
    play_each(plan, plan.workers, |index| {
        let started = std::time::Instant::now();
        let summary = run_game(index, plan, arena, sim);
        MeasuredGame {
            result: GameResult { index, summary },
            wall_ms: started.elapsed().as_secs_f64() * 1000.,
        }
    })
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

/// The report as printed with the pure run meta (no wall clock: a stored-games report).
pub fn format_report(tournament: &TournamentReport) -> String {
    let meta = &tournament.meta;
    let lineup = meta
        .lineup
        .iter()
        .map(|t| t.as_str().to_uppercase())
        .collect::<Vec<_>>()
        .join(",");
    format_report_with(
        &tournament.report,
        &ReportMeta {
            lineup,
            seed: meta.seed,
            learn: false,
            persona: meta.persona.clone(),
            faction: meta.faction.clone(),
            workers: 1,
            wall_ms: None,
            game_ms: None,
        },
    )
}
