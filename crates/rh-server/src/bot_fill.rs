//! The lobby fill policy (legacy packages/server/src/bots/BotManager.ts and callsigns.ts): BOT_FILL_TO, the tier and
//! persona mixes, the arrival schedule, the callsigns and the yield seat.
//!
//! This is the manager's lobby surface as plain data and deterministic streams: no clock, no I/O, no entropy. The same
//! config and manager seed always draw the same arrival times, the same tiers, personas, factions and names, and the
//! same seats yield in the same order. The parity fixture (parity/policy/bot-fill.json) is the actual source manager's
//! behaviour over a real headless world in the pinned Linux amd64 Node 22.23.4 container.
//!
//! Scope: fill decisions only. The bots' brains, the command delay line (latency/jitter), the learning store and the
//! stats file are not part of this slice; the drawn spec (tier/persona/faction/name/seed) is applied to the room's seats.
//! A bot never touches a profile, a token or quest progress; the draw never creates a profile.

use rh_policy::bots::learning::LearnedBias;
use rh_policy::bots::{PersonaId, TierId};
use rh_sim::constants::MAX_PLAYERS;
use rh_sim::content::FactionId;
use rh_sim::rng::Mulberry32;

/// Ids of server-filled bots (source brain/types.ts BOT_ID_PREFIX): "~" never appears in a session id.
pub const BOT_ID_PREFIX: &str = "bot~";
/// findPath calls all the bots of one room may make per tick (source BOT_PATH_BUDGET_PER_TICK).
pub const BOT_PATH_BUDGET_PER_TICK: usize = 8;
/// At most this many bots-and-humans of one faction in a lobby, as far as the state shows (source BotManager.ts).
pub const MAX_PER_FACTION: u32 = 2;
/// The faction softmax temperature (source FACTION_TEMPERATURE).
pub const FACTION_TEMPERATURE: f64 = 0.3;
/// The last arrival is this long before the countdown ends (source ARRIVAL_END_MARGIN_MS).
pub const ARRIVAL_END_MARGIN_MS: f64 = 1000.;
/// The learning store's exploration floor (source LEARN.explore) re-exported: the store itself is `rh-persist::bot_stats`
/// (P-BOTS-5) and its read path is the `learned` snapshot on [`BotFillConfig`].
pub use rh_policy::bots::learning::LEARN_EXPLORE;

/// The callsigns (source callsigns.ts CALLSIGN_POOL, in order).
pub const CALLSIGN_POOL: [&str; 64] = [
    "Wren",
    "Kestrel_7",
    "mossy",
    "Varga",
    "Ashlyn",
    "grimm",
    "Tovik",
    "Pip",
    "Marrow",
    "Jorund",
    "Sable",
    "dusk_rat",
    "Orrin",
    "Lyra",
    "Brannock",
    "Halvar",
    "Quill",
    "redfox",
    "Nettle",
    "Iska",
    "Fenwick",
    "Thorne",
    "Mags",
    "cinder",
    "Rook",
    "Elowen",
    "Bjorn_k",
    "Tamsin",
    "Skarn",
    "Odalys",
    "vexx",
    "Corwin",
    "Isolde",
    "Baldr",
    "junebug",
    "Hale",
    "Ragnhild",
    "Dax",
    "Yara",
    "Wolfe",
    "Mirren",
    "Torvald",
    "kitsune",
    "Eryx",
    "Bramble",
    "Sigrun",
    "Oskar",
    "nox",
    "Ptolemy",
    "Leif",
    "Saffi",
    "Garrick",
    "Rue",
    "Ulf",
    "Zephyr_9",
    "Maren",
    "Draven",
    "tinker",
    "Hollis",
    "Svea",
    "Kodi",
    "Finnick",
    "Aldous",
    "lowtide",
];

/// The fill config (source BotFillConfig, minus the learning-file and room-seed fields that are not this slice).
#[derive(Clone, Debug, PartialEq)]
pub struct BotFillConfig {
    /// Top the arena lobby up to this many players (0 = no fill bots).
    pub fill_to: usize,
    /// Bots start arriving this long before the countdown ends.
    pub arrival_seconds: f64,
    /// Relative tier weights, in TierId::ALL order (easy, normal, hard).
    pub tier_mix: [f64; 3],
    /// Relative persona weights, in PersonaId::ALL order (farmer, hunter, opportunist, cautious).
    pub persona_mix: [f64; 4],
    /// Simulated one-way latency and jitter of the bots' commands (ms): the delay line is not part of this slice.
    pub latency_ms: f64,
    pub jitter_ms: f64,
    /// The learning store's frozen bias snapshot (P-BOTS-5). [`LearnedBias::NO_BIAS`] is learning off: every faction
    /// utility is 0 and the draw reproduces the captured manager stream exactly.
    pub learned: LearnedBias,
    /// The manager seed (source BOTS_SEED): `None` seeds every room from entropy; `Some` makes the fill and delay
    /// streams deterministic (tests and reproducible servers).
    pub seed: Option<u32>,
    /// The source BOT_STATS_FILE setting. The port has no file backend (its durable learning store is the PostgreSQL one,
    /// P-BOTS-5), so this setting is this slice's switch: Off suppresses the whole learning subsystem — no store is
    /// started, no snapshot is applied and no run is recorded through it.
    pub stats_file: StatsFile,
    /// Which lobby timing the room follows (P-LOBBY-TIMING-1). `Legacy` is every rule above, unchanged.
    pub lobby_timing: LobbyTiming,
}

/// The lobby timing a fill room follows. New owner direction (2026-11-10), not legacy: see P-LOBBY-TIMING-1.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum LobbyTiming {
    /// Legacy and the flags exactly as they are today (`--min-players`, `--lobby-seconds`, `--fill-seconds`, and bots
    /// arriving over `arrival_seconds`).
    #[default]
    Legacy,
    /// "Wait 15 seconds; if by second 13 no match can be found, add bots": measured from the first human's arrival,
    /// no bot before `bots_at_seconds`, the lobby filled to the fill target at `bots_at_seconds`, the match started at
    /// `lobby_seconds`, or earlier when the lobby is full of humans.
    Matchmaking {
        lobby_seconds: f64,
        bots_at_seconds: f64,
    },
}

impl BotFillConfig {
    /// Adjusts the sim's lobby knobs for this timing. The director calls it on the room's `SimConfig` before the room
    /// is built, so the sim's own deadline rule (legacy, unchanged) holds the timing. `Matchmaking` sets the lobby length and
    /// makes the human-minimum pull-in unreachable (minimum = `MAX_PLAYERS`, fill seconds 0); `Legacy` changes nothing.
    pub fn apply_lobby_timing(&self, sim: &mut rh_sim::SimConfig) {
        if let LobbyTiming::Matchmaking { lobby_seconds, .. } = self.lobby_timing {
            sim.lobby_seconds = lobby_seconds;
            sim.min_players = MAX_PLAYERS;
            sim.fill_seconds = 0.;
        }
    }
}

/// Source BOT_STATS_FILE: unset (the default profile-adjacent path), `off` (learning off) or an explicit file path. The
/// port's learning store is the PostgreSQL one; this setting only records what the environment asked for.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum StatsFile {
    #[default]
    Default,
    Off,
    Path(String),
}

impl StatsFile {
    /// The source's learning switch: an empty statsFile ("off") means no learning store at all — no reads, no updates,
    /// and no learned bias reaching any decision. The port has no file backend to create, so this is the whole gate.
    pub fn learning_enabled(&self) -> bool {
        !matches!(self, StatsFile::Off)
    }
}

impl Default for BotFillConfig {
    /// BOT_FILL_DEFAULTS exactly.
    fn default() -> Self {
        Self {
            fill_to: 8,
            arrival_seconds: 12.,
            tier_mix: [0.3, 0.45, 0.25],
            persona_mix: [4., 1., 2., 3.],
            latency_ms: 30.,
            jitter_ms: 8.,
            learned: LearnedBias::NO_BIAS,
            seed: None,
            stats_file: StatsFile::Default,
            lobby_timing: LobbyTiming::Legacy,
        }
    }
}

impl BotFillConfig {
    /// The default mix with a given fill count (the director's --fill-bots).
    pub fn with_fill_to(fill_to: usize) -> Self {
        Self {
            fill_to,
            ..Self::default()
        }
    }

    /// The same config reading one learning snapshot (a store's `snapshot()`); learning off is the default.
    pub fn with_learned(mut self, learned: LearnedBias) -> Self {
        self.learned = learned;
        self
    }

    /// Whether this configuration permits learning at all: the source BOT_STATS_FILE gate. The startup must not construct
    /// or install a learning store when this is false, and no snapshot may be applied (the fill softmax then draws the
    /// captured NO_BIAS stream).
    pub fn learning_enabled(&self) -> bool {
        self.stats_file.learning_enabled()
    }
}

/// The server startup's fill configuration (the source config surface plus the runtime learning decision):
/// - the BOTS_* environment parses through BotFillConfig::from_env;
/// - the CLI/first-playable fill count overrides fill_to when asked for, otherwise the server keeps its historical
///   default of no fill unless the environment set BOTS_FILL_TO (the source distribution defaults to 8);
/// - learning is the live store's frozen snapshot when this startup actually started one. The source BOT_STATS_FILE gate
///   runs here too: an off statsFile disables the subsystem, so even a snapshot handed in is dropped and the fill policy
///   receives NO_BIAS (no applied biases).
///
/// main builds its config through this function; the focused tests drive the same composition to prove the used
/// configuration and sink are learning-free under off.
pub fn server_fill_config(
    env: impl Fn(&str) -> Option<String>,
    cli_fill_to: Option<usize>,
    learning: Option<LearnedBias>,
) -> BotFillConfig {
    let env_fill_set = env("BOTS_FILL_TO").is_some();
    let mut cfg = BotFillConfig::from_env(env);
    match cli_fill_to {
        Some(fill_to) => cfg.fill_to = fill_to,
        None if !env_fill_set => cfg.fill_to = 0,
        None => {}
    }
    cfg.learned = if cfg.learning_enabled() {
        learning.unwrap_or(LearnedBias::NO_BIAS)
    } else {
        LearnedBias::NO_BIAS
    };
    cfg
}

/// One fill bot as the policy draws it (source BotSeatSpec).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BotSeatSpec {
    /// The bot's sequence number in this room (1, 2, ...; never reused after a yield).
    pub number: u32,
    pub name: String,
    pub tier: TierId,
    pub persona: PersonaId,
    pub faction: FactionId,
    pub seed: u32,
}

impl BotSeatSpec {
    pub fn id(&self) -> String {
        bot_id(self.number)
    }

    /// The spec as one comparable line (the parity fixture's rendering).
    pub fn line(&self) -> String {
        format!(
            "{} {} {} {} {} {}",
            self.id(),
            self.name,
            self.tier.as_str(),
            self.persona.as_str(),
            self.faction.as_str(),
            self.seed
        )
    }
}

/// The synced id of the n-th bot of a room (source callsigns.ts botId).
pub fn bot_id(n: u32) -> String {
    format!("{BOT_ID_PREFIX}{n}")
}

/// What the policy needs to know about the room as it stands.
pub struct FillView<'a> {
    /// Players in the room (humans and bots).
    pub players: usize,
    pub humans: usize,
    /// Faction counts of the players whose faction is known (source counts only valid factions).
    pub factions: [u32; 5],
    /// The room's names, lowercased (bots are named like players; the callsign predicate is case-insensitive).
    pub names_lower: Vec<String>,
    /// True when a real profile owns the name (a read-only lookup; the live server's profile registry is not reachable
    /// from the room, so the room path passes a constant false and documents the gap).
    pub taken: &'a dyn Fn(&str) -> bool,
}

/// The manager's lobby counters (source BotManagerStats, the fill part).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BotFillStats {
    pub arrived: u64,
    pub yielded: u64,
}

/// What an explicit seat may fix instead of drawing (source BotManager.ts BotSeatOverrides): the tier, persona, faction and
/// callsign. Every other field is still drawn, and every draw is still made whether or not it is overridden, so fixing one
/// thing never reshuffles the rest (source addBot comments, BotManager.ts:264-288).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BotSeatOverrides {
    pub tier: Option<TierId>,
    pub persona: Option<PersonaId>,
    pub faction: Option<FactionId>,
    pub name: Option<String>,
}

/// The lobby fill policy: the manager's arrival schedule, closing top-up, yield seat and explicit addBot seam over
/// deterministic streams (source BotManager.lobbyTick/lobbyClosing/yieldSeat/addBot).
pub struct BotFillState {
    cfg: BotFillConfig,
    /// The manager seed, as the source's 32-bit number.
    seed: u32,
    fill_rng: Mulberry32,
    next_n: u32,
    target: usize,
    /// Server times at which the next bots arrive, ascending.
    pending: Vec<f64>,
    scheduled: bool,
    schedule_end: f64,
    last_humans: usize,
    seated: Vec<BotSeatSpec>,
    stats: BotFillStats,
    learning: Option<std::sync::Arc<dyn crate::bot_learning::LearningSink>>,
}

impl BotFillState {
    /// Only immutable in-memory faction bias is refreshed here; no storage or planner/strategy activation.
    pub fn set_learning_sink(
        &mut self,
        sink: std::sync::Arc<dyn crate::bot_learning::LearningSink>,
    ) {
        self.learning = Some(sink);
    }
    pub fn new(cfg: BotFillConfig, seed: u64) -> Self {
        let seed = seed as u32;
        let target = cfg.fill_to.min(MAX_PLAYERS);
        Self {
            fill_rng: Mulberry32::new(mix(seed, 0)),
            cfg,
            seed,
            next_n: 0,
            target,
            pending: Vec::new(),
            scheduled: false,
            schedule_end: 0.,
            last_humans: 0,
            seated: Vec::new(),
            stats: BotFillStats::default(),
            learning: None,
        }
    }

    pub fn config(&self) -> &BotFillConfig {
        &self.cfg
    }

    pub fn seed(&self) -> u32 {
        self.seed
    }

    pub fn target(&self) -> usize {
        self.target
    }

    pub fn stats(&self) -> BotFillStats {
        self.stats
    }

    pub fn specs(&self) -> &[BotSeatSpec] {
        &self.seated
    }

    /// Before each lobby step: once a human is in and the countdown is within arrival_seconds of its end, draw the
    /// arrival times of the bots still missing and seat each when its time comes (source BotManager.lobbyTick).
    pub fn lobby_tick(
        &mut self,
        now: f64,
        lobby_ends_at: f64,
        view: &FillView,
    ) -> Vec<BotSeatSpec> {
        let mut out = Vec::new();
        if self.target == 0 {
            return out;
        }
        let humans = view.humans;
        while self.last_humans < humans && !self.pending.is_empty() {
            self.pending.pop();
            self.last_humans += 1;
        }
        self.last_humans = humans;
        // A lobby with no human in it gets no bots (the last client leaving disposes the room anyway).
        if humans == 0 {
            return out;
        }
        if let LobbyTiming::Matchmaking {
            lobby_seconds,
            bots_at_seconds,
        } = self.cfg.lobby_timing
        {
            // Nothing before the mark; at the mark (and after, for a leaver) fill to the target at once.
            if now < lobby_ends_at - (lobby_seconds - bots_at_seconds) * 1000. {
                return out;
            }
            let mut shadow = Shadow::from(view);
            while shadow.players < self.target {
                match self.draw_bot(&mut shadow, &BotSeatOverrides::default()) {
                    Some(spec) => out.push(spec),
                    None => break,
                }
            }
            return out;
        }
        if !self.scheduled {
            if lobby_ends_at - now > self.cfg.arrival_seconds * 1000. {
                return out;
            }
            self.scheduled = true;
            self.schedule_end = lobby_ends_at;
            let need = self.target.saturating_sub(view.players);
            let last_at = now.max(lobby_ends_at - ARRIVAL_END_MARGIN_MS);
            for _ in 0..need {
                self.pending
                    .push(now + self.fill_rng.next_f64() * (last_at - now));
            }
            self.pending.sort_by(|a, b| a.total_cmp(b));
        } else if lobby_ends_at < self.schedule_end {
            self.squeeze(now, lobby_ends_at);
        }
        let mut shadow = Shadow::from(view);
        let mut i = 0;
        while i < self.pending.len() && self.pending[i] <= now {
            if shadow.players < self.target {
                if let Some(spec) = self.draw_bot(&mut shadow, &BotSeatOverrides::default()) {
                    out.push(spec);
                }
            }
            i += 1;
        }
        self.pending.drain(0..i);
        out
    }

    /// The lobby is about to start the raid: seat whoever has not arrived yet, at once (source BotManager.lobbyClosing).
    pub fn lobby_closing(&mut self, view: &FillView) -> Vec<BotSeatSpec> {
        self.pending.clear();
        let mut out = Vec::new();
        if self.target == 0 || view.humans == 0 {
            return out;
        }
        let mut shadow = Shadow::from(view);
        while shadow.players < self.target && shadow.players < MAX_PLAYERS {
            match self.draw_bot(&mut shadow, &BotSeatOverrides::default()) {
                Some(spec) => out.push(spec),
                None => break,
            }
        }
        out
    }

    /// Seats one bot now, drawing everything and letting over fix what it names (source BotManager.addBot): tier,
    /// persona, faction and callsign. Every draw is still made in the source order, so fixing one thing never reshuffles
    /// the rest, and an overridden tier/persona/faction/name only replaces the value that draw produced. A full lobby
    /// returns None before any draw and without consuming an id. The caller owns the source's lobby-phase check (as for
    /// lobby_tick/lobby_closing; Room checks the phase). Unlike the automatic fill an explicit seat needs no human in the
    /// room: the source headless tournament seats its fixed lineup into an empty lobby this way (headlessRoom.ts:137).
    pub fn add_bot(&mut self, view: &FillView, over: &BotSeatOverrides) -> Option<BotSeatSpec> {
        let mut shadow = Shadow::from(view);
        self.draw_bot(&mut shadow, over)
    }

    /// A human is joining a full lobby: the newest bot gives its seat up (source BotManager.yieldSeat). The caller must
    /// be in the lobby; the manager checked the phase.
    pub fn yield_seat(&mut self) -> Option<BotSeatSpec> {
        let spec = self.seated.pop()?;
        self.stats.yielded += 1;
        Some(spec)
    }

    /// The countdown got shorter (enough humans joined): the arrivals still to come keep their order inside what is
    /// left (source BotManager.squeeze).
    fn squeeze(&mut self, now: f64, ends_at: f64) {
        let old_span = (self.schedule_end - ARRIVAL_END_MARGIN_MS - now).max(0.);
        let new_span = (ends_at - ARRIVAL_END_MARGIN_MS - now).max(0.);
        self.schedule_end = ends_at;
        if old_span <= 0. {
            return;
        }
        for t in &mut self.pending {
            *t = now + (*t - now).max(0.) * (new_span / old_span);
        }
    }

    /// Seats one bot now, drawing everything (source BotManager.addBot): every draw is made in the source order, then
    /// the overrides replace what they name. Only a real seating touches the streams or the id sequence.
    fn draw_bot(&mut self, shadow: &mut Shadow, over: &BotSeatOverrides) -> Option<BotSeatSpec> {
        if shadow.players >= MAX_PLAYERS {
            return None;
        }
        if let Some(sink) = &self.learning {
            self.cfg.learned = sink.snapshot();
        }
        let n = self.next_n + 1;
        self.next_n = n;
        // All four draws happen whether or not the override fixes them (source addBot: every draw is made, so fixing
        // one thing never reshuffles the rest).
        let drawn_tier = TierId::ALL[pick_weighted(&mut self.fill_rng, &self.cfg.tier_mix)];
        let drawn_persona =
            PersonaId::ALL[pick_weighted(&mut self.fill_rng, &self.cfg.persona_mix)];
        let tier = over.tier.unwrap_or(drawn_tier);
        let persona = over.persona.unwrap_or(drawn_persona);
        // The faction draw uses the effective persona for the learned key, exactly as the source passes it to pickFaction.
        let drawn_faction = self.pick_faction(&shadow.factions, persona);
        let faction = over.faction.unwrap_or(drawn_faction);
        let drawn_name = {
            let taken = |candidate: &str| {
                (*shadow.taken)(candidate)
                    || shadow
                        .names_lower
                        .iter()
                        .any(|name| name == &candidate.to_lowercase())
            };
            pick_callsign(&mut self.fill_rng, taken)
        };
        let name = over.name.clone().unwrap_or(drawn_name);
        let spec = BotSeatSpec {
            number: n,
            name: name.clone(),
            tier,
            persona,
            faction,
            seed: mix(self.seed, 1000 + n),
        };
        shadow.players += 1;
        shadow.factions[faction_index(faction)] += 1;
        shadow.names_lower.push(name.to_lowercase());
        self.seated.push(spec.clone());
        self.stats.arrived += 1;
        Some(spec)
    }

    /// A softmax over the learned faction biases among the factions with room, plus an exploration floor (source
    /// pickFaction). The utilities are the store's `faction|<persona>|<faction>` biases (0 with learning off, which is
    /// exactly the captured manager stream); every draw of the stream stays in the source order.
    fn pick_faction(&mut self, counts: &[u32; 5], persona: PersonaId) -> FactionId {
        let mut open: Vec<usize> = (0..5).filter(|&i| counts[i] < MAX_PER_FACTION).collect();
        if open.is_empty() {
            open = (0..5).collect();
        }
        if self.fill_rng.next_f64() < LEARN_EXPLORE {
            let idx = (self.fill_rng.next_f64() * open.len() as f64) as usize % open.len();
            return FactionId::ALL[open[idx]];
        }
        let utilities: Vec<f64> = open
            .iter()
            .map(|&i| {
                self.cfg.learned.bias(&format!(
                    "faction|{}|{}",
                    persona.as_str(),
                    FactionId::ALL[i].as_str()
                ))
            })
            .collect();
        FactionId::ALL[open[softmax_index(&mut self.fill_rng, &utilities, FACTION_TEMPERATURE)]]
    }
}

/// The room as it stands, shadowed while the policy seats the bots it draws in one call.
struct Shadow<'a> {
    players: usize,
    factions: [u32; 5],
    names_lower: Vec<String>,
    taken: &'a dyn Fn(&str) -> bool,
}

impl<'a> Shadow<'a> {
    fn from(view: &'a FillView<'a>) -> Self {
        Self {
            players: view.players,
            factions: view.factions,
            names_lower: view.names_lower.clone(),
            taken: view.taken,
        }
    }
}

fn faction_index(faction: FactionId) -> usize {
    FactionId::ALL
        .iter()
        .position(|f| *f == faction)
        .expect("a known faction")
}

/// A 32-bit mix of a seed and a tag (a murmur finaliser; source BotManager.mix).
pub fn mix(seed: u32, tag: u32) -> u32 {
    rh_policy::bots::random::mix(seed, tag)
}

/// An id by cumulative weight (source BotManager.pickWeighted): weights are relative, not normalised; a mix with
/// nothing above 0 falls back to the first id. Returns the index into the weight array.
pub fn pick_weighted<const N: usize>(rng: &mut Mulberry32, weights: &[f64; N]) -> usize {
    let mut total = 0.;
    for weight in weights {
        total += weight.max(0.);
    }
    let r = rng.next_f64();
    if total.is_nan() || total <= 0. {
        return 0;
    }
    let mut acc = r * total;
    for (i, weight) in weights.iter().enumerate() {
        acc -= weight.max(0.);
        if acc < 0. {
            return i;
        }
    }
    N - 1
}

/// A softmax draw (source brain/random.ts softmaxIndex): the best option wins outright at temperature <= 0 or with one
/// option; otherwise the draw walks the weights and takes the first that covers it.
pub fn softmax_index(rng: &mut Mulberry32, utilities: &[f64], temperature: f64) -> usize {
    let n = utilities.len();
    if n == 0 {
        return 0;
    }
    let mut best = 0;
    for i in 1..n {
        if utilities[i] > utilities[best] {
            best = i;
        }
    }
    if temperature <= 0. || n == 1 {
        return best;
    }
    let top = utilities[best];
    let weights: Vec<f64> = utilities
        .iter()
        .map(|u| ((u - top) / temperature).exp())
        .collect();
    let sum: f64 = weights.iter().fold(0., |sum, w| sum + w);
    let mut r = rng.next_f64() * sum;
    for (i, weight) in weights.iter().enumerate() {
        r -= weight;
        if r <= 0. {
            return i;
        }
    }
    best
}

fn two(n: usize) -> String {
    format!("{n:02}")
}

/// A callsign that the predicate refuses neither as written nor in lower case (source callsigns.ts pickCallsign). One
/// draw picks among the free names; with the whole pool taken, a name gets two digits appended, walking on from a random
/// start until one is free; every spelling taken returns any name.
pub fn pick_callsign(rng: &mut Mulberry32, taken: impl Fn(&str) -> bool) -> String {
    let refused = |name: &str| taken(name) || taken(&name.to_lowercase());
    let free: Vec<&str> = CALLSIGN_POOL
        .iter()
        .copied()
        .filter(|name| !refused(name))
        .collect();
    if !free.is_empty() {
        let idx = (rng.next_f64() * free.len() as f64) as usize % free.len();
        return free[idx].to_owned();
    }
    let start = (rng.next_f64() * CALLSIGN_POOL.len() as f64 * 100.) as usize;
    let total = CALLSIGN_POOL.len() * 100;
    for i in 0..total {
        let k = (start + i) % total;
        let name = format!("{}{}", CALLSIGN_POOL[k / 100], two(k % 100));
        if !refused(&name) {
            return name;
        }
    }
    format!(
        "{}{}",
        CALLSIGN_POOL[start % CALLSIGN_POOL.len()],
        two(start % 100)
    )
}

#[cfg(test)]
#[path = "bot_fill_tests.rs"]
mod tests;

/// The manager's read-only profile-name set (source isNameTaken): lower-cased callsigns no fill bot may draw.
pub fn name_set<I: IntoIterator<Item = String>>(
    names: I,
) -> std::sync::Arc<std::collections::HashSet<String>> {
    std::sync::Arc::new(
        names
            .into_iter()
            .map(|name| name.to_ascii_lowercase())
            .collect(),
    )
}

impl BotFillConfig {
    /// The source `config.ts parseBots` surface (docs/BOTS.md 7.3): BOTS_FILL_TO, BOTS_ARRIVAL_SECONDS, BOTS_TIER_MIX,
    /// BOTS_PERSONA_MIX, BOTS_LATENCY_MS, BOTS_JITTER_MS, BOTS_SEED and BOT_STATS_FILE. `get` is the environment lookup
    /// (a closure so tests can pass a declared map). The CLI's --fill-bots still overrides `fill_to` at the server edge.
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Self {
        let default = Self::default();
        let env = |key: &str| get(key);
        let tier_ids = [
            TierId::Easy.as_str(),
            TierId::Normal.as_str(),
            TierId::Hard.as_str(),
        ];
        let persona_ids = [
            PersonaId::Farmer.as_str(),
            PersonaId::Hunter.as_str(),
            PersonaId::Opportunist.as_str(),
            PersonaId::Cautious.as_str(),
        ];
        // Source: Math.min(MAX_PLAYERS, Math.round(nonNegative(BOTS_FILL_TO, default))). Math.round is not
        // floor(x + 0.5) for every double (0.49999999999999994 must round to 0), so js_round states the rule.
        let fill_to = js_round(non_negative(
            env("BOTS_FILL_TO").as_deref(),
            default.fill_to as f64,
        ))
        .min(MAX_PLAYERS as f64);
        let stats_file = match env("BOT_STATS_FILE").map(|s| trim_js_whitespace(&s).to_string()) {
            None => StatsFile::Default,
            Some(text) if text.is_empty() => StatsFile::Default,
            Some(text) if text.eq_ignore_ascii_case("off") => StatsFile::Off,
            Some(text) => StatsFile::Path(text),
        };
        Self {
            fill_to: fill_to.max(0.) as usize,
            arrival_seconds: non_negative(
                env("BOTS_ARRIVAL_SECONDS").as_deref(),
                default.arrival_seconds,
            ),
            tier_mix: array_mix(parse_mix(
                env("BOTS_TIER_MIX").as_deref(),
                &tier_ids,
                &default.tier_mix,
            )),
            persona_mix: array_mix(parse_mix(
                env("BOTS_PERSONA_MIX").as_deref(),
                &persona_ids,
                &default.persona_mix,
            )),
            latency_ms: non_negative(env("BOTS_LATENCY_MS").as_deref(), default.latency_ms),
            jitter_ms: non_negative(env("BOTS_JITTER_MS").as_deref(), default.jitter_ms),
            learned: default.learned,
            // Source A: undefined, a whitespace-only value or a non-finite Number keeps the default seed; B: the finite
            // number is truncated and converted with the specification's ToUint32 (so -1 wraps to 4294967295).
            seed: env("BOTS_SEED").and_then(|raw| {
                if trim_js_whitespace(&raw).is_empty() {
                    None
                } else {
                    let n = js_number(&raw);
                    n.is_finite().then(|| to_uint32(n.trunc()))
                }
            }),
            stats_file,
            lobby_timing: default.lobby_timing,
        }
    }
}

fn array_mix<const N: usize>(mix: Vec<f64>) -> [f64; N] {
    let mut out = [0.; N];
    out[..mix.len()].copy_from_slice(&mix[..mix.len()]);
    out
}

/// The source config surface's number pipeline, exactly: undefined or the empty string falls back (source num), any other
/// value goes through ECMAScript Number and a non-finite result falls back; a finite negative value is clamped to 0.
fn number_or_fallback(raw: Option<&str>, fallback: f64) -> f64 {
    let Some(text) = raw else {
        return fallback;
    };
    if text.is_empty() {
        return fallback;
    }
    let n = js_number(text);
    if n.is_finite() {
        n
    } else {
        fallback
    }
}

/// The ECMAScript StringToNumber for the classes the declared BOTS_* surface can see: decimal/scientific literals,
/// hexadecimal/binary/octal literals (unsigned only, as the grammar requires), Infinity/-Infinity, empty and invalid
/// text. Not a claim of complete ECMAScript certification (numeric separators and BigInt are not accepted, matching the
/// source): every class is pinned by the additive captured corpus and its negative controls.
fn js_number(raw: &str) -> f64 {
    let text = trim_js_whitespace(raw);
    if text.is_empty() {
        return 0.;
    }
    match text {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    // Non-decimal integer literals: no sign, at least one digit of that radix, exact integer value rounded once.
    if let Some(digits) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        return radix_number(digits, 16);
    }
    if let Some(digits) = text.strip_prefix("0b").or_else(|| text.strip_prefix("0B")) {
        return radix_number(digits, 2);
    }
    if let Some(digits) = text.strip_prefix("0o").or_else(|| text.strip_prefix("0O")) {
        return radix_number(digits, 8);
    }
    if !decimal_literal(text) {
        return f64::NAN;
    }
    // The grammar above is exactly the decimal literal Rust parses and rounds correctly, like the source engine.
    text.parse::<f64>().unwrap_or(f64::NAN)
}

fn radix_number(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }
    // Up to 128 bits the mathematical value is exact, so one final rounding to f64 matches the specification. A longer
    // literal continues in f64 from the exact prefix (the declared corpus pins one 2^128 case); values past 128 bits are
    // not certified and are not part of the declared config surface (documented in the evidence).
    let mut exact: Option<u128> = Some(0);
    let mut approx = 0f64;
    for c in digits.chars() {
        let Some(d) = c.to_digit(radix) else {
            return f64::NAN;
        };
        match exact {
            Some(v) => match v
                .checked_mul(u128::from(radix))
                .and_then(|scaled| scaled.checked_add(u128::from(d)))
            {
                Some(next) => exact = Some(next),
                None => {
                    approx = v as f64 * f64::from(radix) + f64::from(d);
                    exact = None;
                }
            },
            None => approx = approx * f64::from(radix) + f64::from(d),
        }
    }
    exact.map_or(approx, |v| v as f64)
}

/// ECMAScript's StrDecimalLiteral grammar (the sign, digits, optional fraction and optional exponent).
fn decimal_literal(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut i = 0usize;
    if matches!(bytes.first(), Some(b'+') | Some(b'-')) {
        i += 1;
    }
    let mut digits = 0usize;
    while bytes.get(i).is_some_and(u8::is_ascii_digit) {
        i += 1;
        digits += 1;
    }
    if bytes.get(i) == Some(&b'.') {
        i += 1;
        while bytes.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
            digits += 1;
        }
    }
    if digits == 0 {
        return false;
    }
    if matches!(bytes.get(i), Some(b'e') | Some(b'E')) {
        i += 1;
        if matches!(bytes.get(i), Some(b'+') | Some(b'-')) {
            i += 1;
        }
        let mut exponent = 0usize;
        while bytes.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
            exponent += 1;
        }
        if exponent == 0 {
            return false;
        }
    }
    i == bytes.len()
}

/// The source trim membership: the complete ECMAScript trim set as the pinned linux/amd64 Node 22.23.4 runtime evaluates
/// it for the unchanged legacy config source. Captured exhaustively over every Unicode scalar value through config.ts
/// parseMix's String.prototype.trim (parity/policy/bot-runtime.json, "trim"); the committed list is the small 25 code
/// points below. Input scope: exactly the BOTS_* environment surface's trims (num, parseMix items, BOT_STATS_FILE and
/// BOTS_SEED); runtime scope: the pinned container. NEL U+0085 is NOT a member (Rust's char::is_whitespace wrongly
/// includes it: that turned BOTS_FILL_TO="\u{85}" into 0 instead of the source fallback 8, and
/// BOT_STATS_FILE="\u{85}off\u{85}" into learning off instead of a literal path). U+FEFF (BOM) and the line
/// separators ARE members. Do not replace this with a broad Unicode property.
fn is_js_trim_space(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// ECMAScript TrimString over those exact members (the source trims env values with String.prototype.trim).
fn trim_js_whitespace(text: &str) -> &str {
    text.trim_matches(is_js_trim_space)
}

/// ECMAScript Math.round (non-negative inputs here): halves round toward +Infinity, and the near-half double
/// 0.49999999999999994 must stay 0 rather than become 1 through a rounded x + 0.5.
fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let floor = x.floor();
    if x - floor < 0.5 {
        floor
    } else {
        floor + 1.
    }
}

/// Source nonNegative: a bad value falls back, a negative one is 0 (0 is meaningful: "no limit").
fn non_negative(raw: Option<&str>, fallback: f64) -> f64 {
    number_or_fallback(raw, fallback).max(0.)
}

/// Source `parseMix`: "name:weight,..." over `ids`; a name with no weight counts 1, an unknown name or a non-numeric or
/// extra-part entry is ignored, a negative weight is 0, a listed set with nothing above 0 (or an unset/empty value) is the
/// fallback mix. Returns the mix in `ids` order.
fn parse_mix(raw: Option<&str>, ids: &[&str], fallback: &[f64]) -> Vec<f64> {
    let mut given: Vec<Option<f64>> = vec![None; ids.len()];
    for part in raw.unwrap_or("").split(',') {
        let pieces: Vec<&str> = part.split(':').map(trim_js_whitespace).collect();
        let Some(name) = pieces.first() else { continue };
        let Some(index) = ids.iter().position(|id| *id == name.to_ascii_lowercase()) else {
            continue;
        };
        if pieces.len() > 2 {
            continue;
        }
        let weight = match pieces.get(1).copied() {
            None => 1.,
            Some("") => f64::NAN,
            Some(text) => js_number(text),
        };
        if weight.is_finite() {
            given[index] = Some(weight.max(0.));
        }
    }
    let mix: Vec<f64> = ids
        .iter()
        .enumerate()
        .map(|(i, _)| given[i].unwrap_or(0.))
        .collect();
    if mix.iter().sum::<f64>() > 0. {
        mix
    } else {
        fallback.to_vec()
    }
}

/// The specification's ToUint32 of a finite number: truncate toward zero, then modulo 2^32 (so -1 wraps to
/// 4294967295, as source Math.trunc(x) >>> 0). Non-finite input is filtered before this point.
fn to_uint32(value: f64) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    let modulo = value.trunc().rem_euclid(4_294_967_296.);
    modulo as u32
}
