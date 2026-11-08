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
/// The learning store's exploration floor (source LEARN.explore); the store itself is P-BOTS-5 remainder, but the draw
/// is part of the manager's stream and is reproduced.
pub const LEARN_EXPLORE: f64 = 0.05;

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

/// The lobby fill policy: the manager's arrival schedule, closing top-up and yield seat over deterministic streams
/// (source BotManager.lobbyTick/lobbyClosing/yieldSeat/addBot).
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
}

impl BotFillState {
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
                if let Some(spec) = self.add_bot(&mut shadow) {
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
            match self.add_bot(&mut shadow) {
                Some(spec) => out.push(spec),
                None => break,
            }
        }
        out
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

    /// Seats one bot now, drawing everything (source BotManager.addBot, without the test overrides). Every draw is made
    /// in the source order and only on a real seating, so fixing nothing here ever reshuffles the rest.
    fn add_bot(&mut self, shadow: &mut Shadow) -> Option<BotSeatSpec> {
        if shadow.players >= MAX_PLAYERS {
            return None;
        }
        let n = self.next_n + 1;
        self.next_n = n;
        let tier = TierId::ALL[pick_weighted(&mut self.fill_rng, &self.cfg.tier_mix)];
        let persona = PersonaId::ALL[pick_weighted(&mut self.fill_rng, &self.cfg.persona_mix)];
        let faction = self.pick_faction(&shadow.factions);
        let name = {
            let taken = |candidate: &str| {
                (*shadow.taken)(candidate)
                    || shadow
                        .names_lower
                        .iter()
                        .any(|name| name == &candidate.to_lowercase())
            };
            pick_callsign(&mut self.fill_rng, taken)
        };
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
    /// pickFaction). The learning store is P-BOTS-5 remainder: the biases are the NO_BIAS zeros, but every draw of the
    /// stream is reproduced in the source order.
    fn pick_faction(&mut self, counts: &[u32; 5]) -> FactionId {
        let mut open: Vec<usize> = (0..5).filter(|&i| counts[i] < MAX_PER_FACTION).collect();
        if open.is_empty() {
            open = (0..5).collect();
        }
        if self.fill_rng.next_f64() < LEARN_EXPLORE {
            let idx = (self.fill_rng.next_f64() * open.len() as f64) as usize % open.len();
            return FactionId::ALL[open[idx]];
        }
        let utilities = vec![0.; open.len()];
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
    let mut h = seed.wrapping_mul(0x9e37_79b1) ^ tag.wrapping_add(1).wrapping_mul(0x85eb_ca6b);
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    h ^ (h >> 16)
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
