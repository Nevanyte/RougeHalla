//! The evolving match state: players and their runtime, and the arena's run bookkeeping.

use crate::constants::{MAX_PLAYERS, MAX_REWIND_MS, TICK_MS};
use crate::content::{FactionId, WeaponId};
use crate::events::Event;
use crate::fighter::{
    Body, Credit, Fate, FighterCore, FighterIx, FighterRef, Motion, Seat, Vitals,
};
use crate::input::{InputQueue, OrderBudget};
use crate::math::Vec2;
use crate::results::{GvBreakdown, Outcome};
use crate::rng::Mulberry32;
use crate::statics::Secrets;
use crate::store::{Keyed, Store};
use crate::systems::ledger::Entry;

/// A player's public entity id: assigned at join, never reused within a match.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub struct PlayerId(pub u32);

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Phase {
    Lobby,
    Planning,
    Active,
    Ended,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Status {
    Lobby,
    Alive,
    Dead,
    Mia,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Sample {
    pub t: f64,
    pub x: f64,
    pub y: f64,
}

/// How many rewind samples a fighter keeps: the window [`MAX_REWIND_MS`] + one tick (see [`History::record`]) holds at
/// most `window / TICK_MS + 1` samples one tick apart; one more is slack. Derived from the constants so a change to the
/// rewind window or the tick rate resizes the ring instead of silently dropping samples (`History::push` and `History::record`
/// refuse to drop one, in every build).
const fn history_cap() -> usize {
    ((MAX_REWIND_MS + TICK_MS) / TICK_MS) as usize + 2
}

/// A fighter's rewind history: the last [`history_cap`] samples, oldest first, in a fixed inline ring (no heap, no shifting
/// on trim). Every sample is written twice, `cap` apart, so the live samples are always one contiguous slice
/// ([`History::as_slice`]) and a read needs no modulo. Serialized and hashed as the plain oldest-first sequence a
/// `Vec<Sample>` was, so checkpoints keep their shape and state hashes keep their values.
#[derive(Clone, Copy, Debug)]
pub struct History {
    buf: [Sample; 2 * history_cap()],
    head: u8,
    len: u8,
}

impl Default for History {
    fn default() -> Self {
        const { assert!(history_cap() <= u8::MAX as usize) };
        const { assert!(history_cap() as f64 * TICK_MS > MAX_REWIND_MS + TICK_MS) };
        Self {
            buf: [Sample {
                t: 0.0,
                x: 0.0,
                y: 0.0,
            }; 2 * history_cap()],
            head: 0,
            len: 0,
        }
    }
}

impl History {
    pub fn len(&self) -> usize {
        self.len as usize
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    /// The samples, oldest first.
    pub fn as_slice(&self) -> &[Sample] {
        let head = self.head as usize;
        &self.buf[head..head + self.len()]
    }
    /// The `i`-th oldest sample.
    pub fn get(&self, i: usize) -> Option<Sample> {
        self.as_slice().get(i).copied()
    }
    /// Oldest first.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = Sample> + '_ {
        self.as_slice().iter().copied()
    }
    pub fn clear(&mut self) {
        self.head = 0;
        self.len = 0;
    }
    /// Starts over with one sample (a raid start, a scenario placement).
    pub fn reset(&mut self, s: Sample) {
        self.clear();
        self.push(s);
    }
    pub fn push(&mut self, s: Sample) {
        // Unreachable while the ring is sized from the rewind window (samples are a tick apart and the trim runs before the
        // push). A full ring is never answered by dropping a sample: that would silently shorten the rewind in a release
        // build, so it is a hard failure in every build.
        assert!(self.len() < history_cap(), "rewind history ring is full");
        let mut at = self.head as usize + self.len();
        if at >= history_cap() {
            at -= history_cap();
        }
        self.buf[at] = s;
        self.buf[at + history_cap()] = s;
        self.len += 1;
    }
    pub fn pop_front(&mut self) {
        if self.len > 0 {
            self.head += 1;
            if self.head as usize == history_cap() {
                self.head = 0;
            }
            self.len -= 1;
        }
    }
    /// Records the fighter's position at `now` and drops what the rewind window no longer needs: the oldest samples older
    /// than `now - MAX_REWIND_MS - TICK_MS`, always keeping two (legacy `recordHistory`: push, then trim while longer than
    /// two). The trim runs first here, so the ring never holds more than the window; the resulting sequence is the same.
    pub fn record(&mut self, now: f64, x: f64, y: f64) {
        let cutoff = now - MAX_REWIND_MS - TICK_MS;
        let cap = history_cap();
        let (mut head, mut len) = (self.head as usize, self.len as usize);
        while len >= 2 && self.buf[head].t < cutoff {
            head += 1;
            if head == cap {
                head = 0;
            }
            len -= 1;
        }
        // Unreachable while the ring is sized from the rewind window (see `push`): a hard failure, never a dropped sample.
        assert!(len < cap, "rewind history ring is full");
        let mut at = head + len;
        if at >= cap {
            at -= cap;
        }
        let s = Sample { t: now, x, y };
        self.buf[at] = s;
        self.buf[at + cap] = s;
        self.head = head as u8;
        self.len = len as u8 + 1;
    }
}

impl std::ops::Index<usize> for History {
    type Output = Sample;
    fn index(&self, i: usize) -> &Sample {
        &self.as_slice()[i]
    }
}

impl PartialEq for History {
    fn eq(&self, o: &Self) -> bool {
        self.len == o.len && self.iter().eq(o.iter())
    }
}

impl serde::Serialize for History {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(self.iter())
    }
}

impl<'de> serde::Deserialize<'de> for History {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = Vec::<Sample>::deserialize(d)?;
        if v.len() > history_cap() {
            return Err(serde::de::Error::custom(format!(
                "rewind history of {} samples exceeds the ring of {}",
                v.len(),
                history_cap()
            )));
        }
        let mut h = History::default();
        for s in v {
            h.push(s);
        }
        Ok(h)
    }
}

/// The waypoints a fighter still walks, consumed from the front with a cursor instead of `remove(0)`. Only the logical
/// content (`pts[cursor..]`) and a replacement generation are serialized, compared and hashed; ice anchors
/// against that generation, preserving JavaScript path-array identity through restore. The consumed prefix is dead data. The buffer is compacted
/// whenever the path is replaced or runs out, so the cursor never outlives a path.
#[derive(Clone, Debug, Default)]
pub struct Path {
    pts: Vec<Vec2>,
    cursor: usize,
    pub(crate) generation: u64,
}

impl Path {
    pub fn as_slice(&self) -> &[Vec2] {
        &self.pts[self.cursor..]
    }
    pub fn is_empty(&self) -> bool {
        self.cursor >= self.pts.len()
    }
    pub fn len(&self) -> usize {
        self.pts.len() - self.cursor
    }
    /// The next waypoint.
    pub fn first(&self) -> Option<Vec2> {
        self.pts.get(self.cursor).copied()
    }
    /// Consumes the next waypoint.
    pub fn advance(&mut self) {
        self.cursor += 1;
        if self.cursor >= self.pts.len() {
            self.pts.clear();
            self.cursor = 0;
        }
    }
    pub fn clear(&mut self) {
        self.generation = self
            .generation
            .checked_add(1)
            .expect("path generation exhausted");
        self.pts.clear();
        self.cursor = 0;
    }
    pub(crate) fn replan(
        &mut self,
        pf: &mut crate::pathfind::Pathfinder,
        map: &crate::TileMap,
        from: Vec2,
        goal: Vec2,
    ) {
        self.generation = self
            .generation
            .checked_add(1)
            .expect("path generation exhausted");
        self.cursor = 0;
        crate::pathfind::plan_path_into(pf, map, from, goal, &mut self.pts);
    }
    pub(crate) fn replan_in_place(
        &mut self,
        pf: &mut crate::pathfind::Pathfinder,
        map: &crate::TileMap,
        from: Vec2,
        goal: Vec2,
        radius: f64,
    ) {
        self.cursor = 0;
        pf.find_path_into(map, from, goal, radius, &mut self.pts);
    }
    /// Replaces the path with `pts` (compacting: the cursor restarts at 0); the buffer keeps its capacity.
    pub fn set_from(&mut self, pts: &[Vec2]) {
        self.generation = self
            .generation
            .checked_add(1)
            .expect("path generation exhausted");
        self.pts.clear();
        self.pts.extend_from_slice(pts);
        self.cursor = 0;
    }
}

impl PartialEq for Path {
    fn eq(&self, o: &Self) -> bool {
        self.as_slice() == o.as_slice() && self.generation == o.generation
    }
}

impl serde::Serialize for Path {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        serde::Serialize::serialize(&(self.generation, self.as_slice()), s)
    }
}

impl<'de> serde::Deserialize<'de> for Path {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let (generation, pts) = <(u64, Vec<Vec2>)>::deserialize(d)?;
        Ok(Path {
            pts,
            cursor: 0,
            generation,
        })
    }
}

/// Every player that joined this match, in join order, kept for leavers: the one place a name is resolved from an id (a
/// kill's `killed_by`, the winner), at result time. The tick itself carries ids only (the ledger, the melee queue and the
/// payouts are `Copy`), so a hit never clones a name and a shooter who already left is still named.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub(crate) struct Roster {
    names: Vec<(PlayerId, std::sync::Arc<str>)>,
}

impl Roster {
    /// Appends a join. Ids ascend strictly (the name lookup is a binary search), in every build, like [`Store::push`].
    pub(crate) fn push(&mut self, id: PlayerId, name: &str) {
        assert!(
            self.names.last().is_none_or(|(l, _)| *l < id),
            "roster ids must be appended in ascending order"
        );
        self.names.push((id, name.into()));
    }

    /// How many players ever joined.
    pub(crate) fn len(&self) -> usize {
        self.names.len()
    }

    /// The id of the latest join, if any.
    pub(crate) fn last_id(&self) -> Option<PlayerId> {
        self.names.last().map(|(id, _)| *id)
    }

    /// The display name `id` joined with (a leaver's too).
    pub(crate) fn name(&self, id: PlayerId) -> Option<&str> {
        self.label(id).map(AsRef::as_ref)
    }

    pub(crate) fn label(&self, id: PlayerId) -> Option<&std::sync::Arc<str>> {
        let i = self.names.binary_search_by_key(&id, |(p, _)| *p).ok()?;
        Some(&self.names[i].1)
    }
}

impl<'de> serde::Deserialize<'de> for Roster {
    /// Refuses ids that are not strictly ascending, as [`Store`] does: a disordered roster would answer `name` wrongly.
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(rename = "Roster")]
        struct Raw {
            names: Vec<(PlayerId, std::sync::Arc<str>)>,
        }
        let Raw { names } = Raw::deserialize(d)?;
        if names.windows(2).any(|w| w[0].0 >= w[1].0) {
            return Err(serde::de::Error::custom(
                "roster ids are not in strictly ascending order",
            ));
        }
        Ok(Self { names })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ActionKind {
    Swing,
    Cast,
    Draw,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Packet {
    pub raw: f64,
    pub phys: f64,
    pub magic: f64,
    pub true_: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PendingAction {
    pub target: Option<PlayerId>,
    pub kind: ActionKind,
    pub weapon: WeaponId,
    pub started_at: f64,
    pub lands_at: f64,
    pub a: f64,
    pub packet: Packet,
}

/// A run-only item. Its identity is allocated by the world without consuming any RNG.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WeaponItem {
    pub uid: u64,
    pub weapon: WeaponId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ContainerKind {
    Ground,
    Chest,
    Body(PlayerId),
    /// A quest token or fetch parcel (source `ContainerKind` "quest"): its one item names the offer, and the pickup path
    /// hands it to the quest runtime instead of the weapon/potion logic.
    Quest,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Container {
    pub id: u32,
    pub kind: ContainerKind,
    pub at: Vec2,
    pub opened: bool,
    /// First item at index zero, second if a body held both weapons.
    pub items: Vec<crate::initial_world::Item>,
    pub(crate) stat_offer: bool,
    pub(crate) born_tick: u32,
}

/// A fighter's weapon state: the carried items and the active slot, and the runtime of the swing in progress.
/// Private wand chase state. Search budgets survive a dropped or replaced lock.
#[derive(Clone, Copy, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Targeting {
    pub target: Option<PlayerId>,
    pub seen: bool,
    pub lost_at: Option<f64>,
    pub plan_at: Option<f64>,
    pub search_at: Option<f64>,
    pub goal: Option<Vec2>,
    pub attack_move: Option<Vec2>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WeaponRt {
    pub targeting: Targeting,
    /// Carried items; an empty slot fights with fists.
    pub weapon0: Option<WeaponId>,
    pub weapon1: Option<WeaponId>,
    pub slot: u8,
    pub ready_at: f64,
    pub draw_started_at: f64,
    pub action: Option<PendingAction>,
    pub root_until: f64,
    pub stagger_immune_until: f64,
    pub held: bool,
    pub pressed_at: f64,
    pub buffered_until: f64,
    pub aim: f64,
    pub aim_at: f64,
    pub lag_ms: f64,
    /// Source weapon.lastShotAt; None represents its initial -Infinity.
    pub last_shot_at: Option<f64>,
}

impl Default for WeaponRt {
    fn default() -> Self {
        Self {
            targeting: Targeting::default(),
            weapon0: None,
            weapon1: None,
            slot: 0,
            ready_at: 0.0,
            draw_started_at: 0.0,
            action: None,
            root_until: 0.0,
            stagger_immune_until: 0.0,
            held: false,
            pressed_at: 0.0,
            buffered_until: 0.0,
            aim: 0.0,
            aim_at: 0.0,
            lag_ms: 0.0,
            last_shot_at: None,
        }
    }
}

impl WeaponRt {
    /// The start of a run: the swing in progress, the trigger and the aim are forgotten; what is carried and the slot stay.
    pub fn reset_runtime(&mut self) {
        *self = Self {
            weapon0: self.weapon0,
            weapon1: self.weapon1,
            slot: self.slot,
            ..Self::default()
        };
    }
}

/// A seated player: the shared [`FighterCore`] plus what only a player has. The core is reachable through `Deref`
/// (`p.body`, `p.vitals`, `p.weapon`, `p.motion`, `p.id`), also mutably; take `p.core` explicitly when another part of the
/// player is borrowed at the same time. `status`, `down` and `resolved` are the run bookkeeping the settle owns.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Player {
    pub stocks: crate::abilities::Stocks,
    pub card_runtime: Option<crate::cards::runtime::Runtime>,
    /// Source card-state streak memory (written by the after-damage system, read by on-hit/Twist of Fate).
    #[serde(default)]
    pub card_streak: Option<crate::cards::Streak>,
    /// Wishful Thinking's trims inside the source window (written by the after-damage system).
    #[serde(default)]
    pub card_trims: Vec<crate::cards::Trim>,
    /// Pending heal-over-time runs (Second Wind and other trigger heals).
    #[serde(default)]
    pub card_hots: Vec<crate::cards::Hot>,
    /// The once-trigger cards that already fired this run (source `PlayerRuntime.fired`).
    #[serde(default)]
    pub card_fired: Vec<crate::cards::CardId>,
    /// The attack-critical accumulator (source `cards.critAcc`): deterministic, fires at 1.
    #[serde(default)]
    pub card_crit_acc: f64,
    /// Plant Your Feet's last-seen position and still-since time (source `cards.stillX/stillY/stillSince`).
    #[serde(default)]
    pub card_still_x: f64,
    #[serde(default)]
    pub card_still_y: f64,
    #[serde(default)]
    pub card_still_since: f64,
    /// Adrenaline's running boost (source `cards.boostAs/boostMove/boostUntil`).
    #[serde(default)]
    pub card_boost: crate::cards::Boost,
    /// Tank Engine's prevented-damage tally (source `cards.prevented`).
    #[serde(default)]
    pub card_prevented: f64,
    /// Tank Engine's earned flat max-health bonus (source `cards.tankHp`).
    #[serde(default)]
    pub card_tank_hp: f64,
    pub plan_ready: bool,
    pub build: crate::cards::Build,
    pub potion_small: u8,
    pub(crate) healing_until: f64,
    pub potions_healing: u8,
    pub farm: crate::modifiers::Farm,
    /// Stats earned through kill-augment Trophies (source PlayerState.extra.killStats): farm rows outside the card
    /// caps, keyed by the source killStats store names.
    #[serde(default)]
    pub kill_stats: crate::kill_augments::KillStats,
    pub core: FighterCore,
    pub seat: Seat,
    pub(crate) vision: crate::vision::VisionTrail,
    pub(crate) bush: crate::vision::BushExposure,
    pub credit: Credit,
    pub fate: Fate,
    pub status: Status,
    pub down: Option<Outcome>,
    pub resolved: bool,
}

impl Keyed for Player {
    fn key(&self) -> PlayerId {
        self.core.id
    }
}

impl std::ops::Deref for Player {
    type Target = FighterCore;
    fn deref(&self) -> &FighterCore {
        &self.core
    }
}

impl std::ops::DerefMut for Player {
    fn deref_mut(&mut self) -> &mut FighterCore {
        &mut self.core
    }
}

impl Player {
    /// A fresh lobby seat (legacy `addPlayer`): fists in hand, full hp, nothing earned.
    pub(crate) fn joining(
        id: PlayerId,
        profile: &str,
        bot: bool,
        faction: FactionId,
        spot: Vec2,
        hp: f64,
    ) -> Self {
        Self {
            stocks: Default::default(),
            card_runtime: None,
            card_streak: None,
            card_trims: Vec::new(),
            card_hots: Vec::new(),
            card_fired: Vec::new(),
            card_crit_acc: 0.,
            card_still_x: 0.,
            card_still_y: 0.,
            card_still_since: 0.,
            card_boost: crate::cards::Boost::default(),
            card_prevented: 0.,
            card_tank_hp: 0.,
            build: Default::default(),
            potion_small: 0,
            healing_until: 0.,
            potions_healing: 0,
            farm: Default::default(),
            kill_stats: Default::default(),
            vision: Default::default(),
            bush: Default::default(),
            core: FighterCore {
                id,
                body: Body {
                    x: spot.x,
                    y: spot.y,
                    facing: 0.0,
                    history: History::default(),
                },
                vitals: Vitals {
                    faction,
                    hp,
                    max_hp: hp,
                    barrier: 0.0,
                    immune_until: 0.0,
                    hp_frac_at_tick_start: 1.0,
                },
                weapon: WeaponRt::default(),
                signature: Default::default(),
                statuses: Default::default(),
                modifiers: Default::default(),
                card_dot_crit: None,
                motion: Motion::default(),
                inputs: InputQueue::default(),
            },
            seat: Seat {
                picked_faction: None,
                profile: profile.to_string(),
                name: profile.to_string(),
                bot,
                budget: OrderBudget::default(),
                dropped_at: None,
            },
            credit: Credit {
                mob_kills: 0,
                sentence: 0,
                kills: 0,
                bot_kills: 0,
                bounty: 0,
                gv: 0,
                gv_parts: GvBreakdown::default(),
                announce: None,
                last_hit: None,
                // Everyone else in the lobby fits, so a normal match never grows them mid-fight.
                damaged: Vec::with_capacity(MAX_PLAYERS),
                damaged_humans: Vec::with_capacity(MAX_PLAYERS),
            },
            fate: Fate::default(),
            status: Status::Lobby,
            down: None,
            resolved: false,
            plan_ready: false,
        }
    }

    pub fn standing(&self) -> bool {
        self.status == Status::Alive && self.down.is_none() && !self.resolved
    }

    /// A read-only view of the fighter in this seat.
    pub fn fighter(&self) -> FighterRef<'_> {
        FighterRef {
            core: &self.core,
            standing: self.standing(),
        }
    }
}

/// The arena's run bookkeeping that outlives a tick (legacy `world.arena`).
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct ArenaRt {
    pub(crate) voided: bool,
    pub(crate) patience_ends_at: Option<f64>,
    pub(crate) in_coliseum: bool,
    pub(crate) sudden_death_at: f64,
    /// Internal arena ownership seam; no public command can set this.
    pub(crate) gates_locked: bool,
    pub(crate) started_with: u32,
    pub(crate) started_humans: usize,
    pub(crate) downs_between_ticks: u32,
}

/// Server-private projectile identity uses the same run-local counter as containers (legacy nextId).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ProjectileKind {
    Arrow,
    Ball,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ProjectileEnd {
    Range,
    Wall,
    Deleted,
    Hit,
    Reflected,
    Blocked,
    Destroyed,
    Cleared,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ProjectileLaunch {
    pub id: u32,
    pub kind: ProjectileKind,
    pub owner: PlayerId,
    pub reflected: bool,
    pub origin: Vec2,
    pub velocity: Vec2,
    pub time: f64,
    pub range: f64,
    pub target: Option<PlayerId>,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Projectile {
    pub(crate) launch: ProjectileLaunch,
    pub(crate) pos: Vec2,
    pub(crate) velocity: Vec2,
    pub(crate) time: f64,
    pub(crate) traveled: f64,
    pub(crate) packet: Packet,
    pub(crate) halved: bool,
    pub(crate) reflections: u8,
}
impl Projectile {
    pub(crate) fn weapon(&self) -> WeaponId {
        match (self.launch.kind, self.launch.reflected) {
            (ProjectileKind::Arrow, true) => WeaponId::Shield,
            (ProjectileKind::Arrow, false) => WeaponId::Bow,
            (ProjectileKind::Ball, _) => WeaponId::Wand,
        }
    }
}

/// The evolving match state: everything a later tick can depend on. With [`crate::statics::MatchStatic`] it is the whole
/// checkpoint, and it is what [`crate::Sim::state_hash`] hashes. Per-tick working sets live in
/// [`crate::scratch::TickScratch`] instead.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct World {
    pub(crate) planning: Option<crate::systems::planning::Runtime>,
    pub(crate) plan_ends_at: f64,
    pub(crate) terrain: crate::terrain::Runtime,
    pub(crate) reward_chests: Vec<crate::reward_chests::Chest>,
    /// The quest runtime (source `world.quests`): absent until `spawnQuests`; serialized and hashed like every other
    /// lifecycle state.
    #[serde(default)]
    pub(crate) quests: Option<crate::quests::live::Quests>,
    pub(crate) factions: crate::factions::FactionRuntime,
    pub(crate) abilities: Option<crate::status_runtime::AbilityRuntime>,
    pub(crate) tick: u32,
    pub(crate) server_time: f64,
    pub(crate) phase: Phase,
    pub(crate) lobby_ends_at: f64,
    pub(crate) raid_started_at: f64,
    pub(crate) winner: Option<PlayerId>,
    /// In join order (legacy Map insertion order).
    pub(crate) players: Store<Player>,
    pub(crate) mobs: Store<crate::mob_runtime::Mob>,
    pub(crate) actor_history: Store<crate::mob_runtime::ActorProvenance>,
    pub(crate) mob_runtime: Option<crate::mob_runtime::MobRuntime>,
    pub(crate) next_id: u32,
    pub(crate) projectiles: Vec<Projectile>,
    pub(crate) containers: Vec<Container>,
    pub(crate) initial_birth_serial: u32,
    pub(crate) potion_healing: Vec<crate::potions::Healing>,
    /// Legacy nextId: container and projectile prefixes share one ascending run-local serial.
    pub(crate) entity_counter: u32,
    pub(crate) item_counter: u64,
    /// Names of everyone who joined, leavers included (append-only; see [`Roster`]).
    pub(crate) roster: Roster,
    pub(crate) joined: usize,
    pub(crate) spawn_rng: Mulberry32,
    pub(crate) reward_rng: crate::private_rng::Sfc32,
    pub(crate) rt: ArenaRt,
    /// Events emitted between steps (a leave's result) wait here for the next step: part of a checkpoint and the hash.
    pub(crate) pending_events: Vec<Event>,
    /// Effects a hook link queued for the next tick (legacy `combat.deferred`): they open its ledger. Empty in the slice,
    /// which has no link that defers. Always serialized (a skipped field would be ambiguous to the state hash, see
    /// `hash.rs`); `default` still reads checkpoints written while it was omitted.
    #[serde(default)]
    pub(crate) deferred: DeferredQueue,
    /// Overkill splash requests recorded during the pass and resolved by the after-damage system (never serialized).
    #[serde(skip)]
    pub(crate) card_splashes: Vec<crate::cards::SplashReq>,
    /// The same-tick payouts (legacy `payLater`, `combat.collecting` and `combat.payouts`): queued while the ledger pass
    /// runs, paid at its end, or at once outside it. Never part of a checkpoint or the hash: it is empty and not
    /// collecting at every step boundary, where both are taken.
    #[serde(skip)]
    pub(crate) pay: PayQueue,
    /// The execution trace of the tick schedule (feature `schedule-trace`, tests only): never serialized, never hashed.
    #[cfg(feature = "schedule-trace")]
    #[serde(skip)]
    pub(crate) trace: crate::schedule::TraceLog,
}

/// Effects queued across a tick boundary, as typed data (never closures, so they checkpoint, hash and replay). Legacy has
/// two deferrals and they are not interchangeable: `combat.deferred` (entries the cards queue for the NEXT tick's ledger:
/// Spiked Shell's returned damage, Overkill's splash) is this queue; `payLater` (pay after the ledger pass, in the SAME
/// tick, or at once outside the pass) is [`PayQueue`]. Mapping a `payLater` onto this queue lands the effect one tick
/// late and breaks parity.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct DeferredQueue {
    /// Ledger entries for the next tick (`ledger:openWithDeferred` moves them into that tick's ledger).
    pub(crate) hits: Vec<Entry>,
}

impl DeferredQueue {
    /// Queues a hit to open the next tick's ledger (legacy `deferHit`).
    #[cfg_attr(not(test), allow(dead_code))] // the first producer is a card link (P-CARDS-1); tests exercise it now
    pub(crate) fn defer_hit(&mut self, e: Entry) {
        self.hits.push(e);
    }
}

/// Legacy `payLater` (world.ts): while the ledger pass runs (`collecting`) a payout waits in `items`, in the order it was
/// queued, until every victim has taken their damage (the pass's end, `ledger::apply`); outside the pass it is paid at
/// once. Typed data ([`crate::systems::ledger::PayLater`]), never a closure. Reach it with `ledger::pay_later` (or
/// `Hx::pay_later` from a hook link); never push to `items` directly.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct PayQueue {
    pub(crate) mob_wakes: Vec<(u32, PlayerId)>,
    pub(crate) mob_deaths: Vec<crate::systems::mob_life::Award>,
    pub(crate) mob_settled: Vec<PlayerId>,
    pub(crate) median_feed: f64,
    pub(crate) mob_feeds: Vec<f64>,
    pub(crate) collecting: bool,
    pub(crate) items: Vec<crate::systems::ledger::Payout>,
}

impl World {
    pub(crate) fn known_actor(&self, id: PlayerId) -> bool {
        self.actor_history.contains(id)
    }
    pub(crate) fn actor_origin(&self, id: PlayerId) -> Option<&crate::mob_runtime::ActorOrigin> {
        self.actor_history.get(id).map(|row| &row.origin)
    }

    pub(crate) fn next_entity_id(&mut self) -> u32 {
        self.entity_counter = self
            .entity_counter
            .checked_add(1)
            .expect("run entity id exhausted");
        self.entity_counter
    }

    pub(crate) fn actor_label(&self, id: PlayerId) -> Option<std::sync::Arc<str>> {
        self.roster
            .label(id)
            .cloned()
            .or_else(|| match self.actor_origin(id) {
                Some(crate::mob_runtime::ActorOrigin::Mob { mob_type, .. }) => {
                    crate::mob_catalog::mob_type_by_id(mob_type.as_str())
                        .map(|t| std::sync::Arc::from(t.name))
                }
                _ => None,
            })
    }
    pub(crate) fn actor(&self, id: PlayerId) -> Option<&FighterCore> {
        self.fighter_idx(id).map(|ix| self.core(ix))
    }
    pub(crate) fn base_sheet(&self, ix: FighterIx) -> crate::content::FactionSpec {
        let p = self.core(ix);
        let mut f = crate::content::faction(p.vitals.faction);
        if let Some(m) = self.mobs.get(p.id) {
            let ty = crate::mob_catalog::mob_type_by_id(m.mob_type.as_str()).expect("catalog type");
            let k = if m.elite {
                crate::constants::ELITE_K
            } else {
                crate::constants::MOB_K
            };
            f.hp = (f.hp * k)
                * (crate::constants::MOB_HP_MULT
                    * if m.elite {
                        crate::constants::ELITE_HP_MULT
                    } else {
                        1.
                    })
                * ty.role_def().hp_mult;
            f.hit = self.point_damage(ix, f.hit, false);
        }
        f
    }
    /// Source scaledFaction -> mobFaction -> mobTypeFaction -> pacedFaction order for point-damage params.
    fn point_damage(&self, ix: FighterIx, raw: f64, execute: bool) -> f64 {
        let Some(m) = self.mobs.get(self.core(ix).id) else {
            return raw;
        };
        let ty = crate::mob_catalog::mob_type_by_id(m.mob_type.as_str()).expect("catalog type");
        let k = if m.elite {
            crate::constants::ELITE_K
        } else {
            crate::constants::MOB_K
        };
        let d = crate::constants::MOB_DMG_MULT
            * if m.elite {
                crate::constants::ELITE_DMG_MULT
            } else {
                1.
            };
        let zone = match ty.zone {
            crate::FactionId::Plague => crate::constants::MOB_PLAGUE_DAMAGE,
            crate::FactionId::Holy => crate::constants::MOB_HOLY_DAMAGE,
            _ => 1.,
        };
        let reach = if m.elite {
            1.
        } else if matches!(
            crate::content::weapon(ty.weapon).shape,
            crate::content::Shape::Projectile { .. }
        ) {
            crate::constants::MOB_RANGED_DMG_MULT
        } else {
            crate::constants::MOB_MELEE_DMG_MULT
        };
        (((raw * k) * d) * if execute { k } else { 1. }) * (ty.role_def().dmg_mult * zone * reach)
    }
    pub(crate) fn signature_damage(&self, ix: FighterIx, raw: f64, execute: bool) -> f64 {
        self.point_damage(ix, raw, execute) * crate::constants::DUEL_PACE
    }
    pub(crate) fn paced_sheet(&self, ix: FighterIx) -> crate::content::FactionSpec {
        let mut f = self.base_sheet(ix);
        f.hit *= crate::constants::DUEL_PACE;
        f
    }
    /// The slot of a present player (join order = id order): a binary search.
    pub(crate) fn idx(&self, id: PlayerId) -> Option<usize> {
        self.players.idx(id)
    }

    pub(crate) fn player(&self, id: PlayerId) -> Option<&Player> {
        self.players.get(id)
    }

    // The fighter list is players in join order followed by mobs in insertion order.
    // FighterIx must be reacquired after any structural store mutation.

    /// How many fighters there are (present, standing or not).
    #[inline]
    pub(crate) fn fighter_count(&self) -> usize {
        self.players.len() + self.mobs.len()
    }

    /// The index of the fighter with id `id`, if present.
    #[inline]
    pub(crate) fn fighter_idx(&self, id: PlayerId) -> Option<FighterIx> {
        self.players.idx(id).map(FighterIx::of_slot).or_else(|| {
            self.mobs
                .idx(id)
                .map(|i| FighterIx::of_slot(self.players.len() + i))
        })
    }

    /// Whether the fighter at `ix` is a seated player (the PvP rules, the order budget and the run's bookkeeping apply to
    /// players only).
    #[inline]
    pub(crate) fn is_player(&self, ix: FighterIx) -> bool {
        ix.slot() < self.players.len()
    }

    /// The core every fighter has.
    #[inline]
    pub(crate) fn core(&self, ix: FighterIx) -> &FighterCore {
        if self.is_player(ix) {
            &self.players[ix.slot()].core
        } else {
            &self.mobs[ix.slot() - self.players.len()].core
        }
    }

    #[inline]
    pub(crate) fn core_mut(&mut self, ix: FighterIx) -> &mut FighterCore {
        if self.is_player(ix) {
            &mut self.players[ix.slot()].core
        } else {
            let slot = ix.slot() - self.players.len();
            &mut self.mobs[slot].core
        }
    }

    /// Whether the fighter at `ix` still stands in the run.
    #[inline]
    pub(crate) fn standing(&self, ix: FighterIx) -> bool {
        if self.is_player(ix) {
            self.players[ix.slot()].standing()
        } else {
            self.mobs[ix.slot() - self.players.len()].status == Status::Alive
        }
    }

    /// Whether the fighter at `ix` is alive (its status, not its settle state: a downed player not yet resolved is not).
    #[inline]
    pub(crate) fn alive(&self, ix: FighterIx) -> bool {
        if self.is_player(ix) {
            self.players[ix.slot()].status == Status::Alive
        } else {
            self.mobs[ix.slot() - self.players.len()].status == Status::Alive
        }
    }

    /// Where a command for the fighter at `ix` is queued and the order budget it spends: a player's seat budget; an actor
    /// that is not a seat (a mob) has none (legacy rate-limits at the network edge, not in the sim).
    #[inline]
    pub(crate) fn intake(&mut self, ix: FighterIx) -> (&mut InputQueue, Option<&mut OrderBudget>) {
        if self.is_player(ix) {
            let p = &mut self.players[ix.slot()];
            (&mut p.core.inputs, Some(&mut p.seat.budget))
        } else {
            let slot = ix.slot() - self.players.len();
            (&mut self.mobs[slot].core.inputs, None)
        }
    }

    pub(crate) fn new(secrets: &Secrets) -> Self {
        Self {
            planning: None,
            plan_ends_at: 0.,
            reward_chests: Vec::new(),
            quests: None,
            terrain: Default::default(),
            factions: Default::default(),
            abilities: None,
            tick: 0,
            server_time: 0.0,
            phase: Phase::Lobby,
            lobby_ends_at: 0.0,
            raid_started_at: 0.0,
            winner: None,
            players: Store::new(),
            mobs: Store::new(),
            actor_history: Store::new(),
            mob_runtime: None,
            next_id: 1,
            containers: Vec::with_capacity(4 * MAX_PLAYERS),
            initial_birth_serial: 0,
            potion_healing: Vec::with_capacity(MAX_PLAYERS),
            projectiles: Vec::new(),
            entity_counter: 0,
            item_counter: 0,
            roster: Roster::default(),
            joined: 0,
            spawn_rng: Mulberry32::new(secrets.spawn_seed),
            reward_rng: crate::private_rng::Sfc32::from_words(secrets.reward_salt),
            rt: ArenaRt::default(),
            pending_events: Vec::new(),
            deferred: DeferredQueue::default(),
            card_splashes: Vec::new(),
            pay: PayQueue::default(),
            #[cfg(feature = "schedule-trace")]
            trace: Default::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The recorder as it was: push, then trim from the front while longer than two and the oldest is out of the window.
    fn reference(h: &mut Vec<Sample>, now: f64, x: f64, y: f64) {
        h.push(Sample { t: now, x, y });
        let cutoff = now - MAX_REWIND_MS - TICK_MS;
        while h.len() > 2 && h[0].t < cutoff {
            h.remove(0);
        }
    }

    #[test]
    fn the_history_ring_is_the_trimmed_vec_it_replaced() {
        let mut ring = History::default();
        let mut vec: Vec<Sample> = Vec::new();
        let mut now = 50.0;
        // Mostly one tick apart, with gaps (a fighter that did not stand records nothing for a while).
        for n in 0..2000u32 {
            now += TICK_MS
                * if n % 97 < 5 {
                    1.0 + (n % 13) as f64
                } else {
                    1.0
                };
            let (x, y) = (n as f64 * 0.37, 1000.0 - n as f64 * 0.11);
            ring.record(now, x, y);
            reference(&mut vec, now, x, y);
            assert_eq!(ring.iter().collect::<Vec<_>>(), vec, "tick {n}");
            assert_eq!(
                serde_json::to_value(ring).unwrap(),
                serde_json::to_value(&vec).unwrap()
            );
            assert!(ring.len() <= history_cap());
        }
        // Restarting keeps one sample, and a checkpoint of the ring restores it.
        let s = Sample {
            t: now,
            x: 1.0,
            y: 2.0,
        };
        ring.reset(s);
        assert_eq!(ring.iter().collect::<Vec<_>>(), [s]);
        let back: History = serde_json::from_value(serde_json::to_value(ring).unwrap()).unwrap();
        assert_eq!(back, ring);
    }

    #[test]
    fn the_ring_holds_the_whole_rewind_window() {
        // Samples one tick apart: the window plus the tick of slack, never more than the capacity, so nothing the rewind can
        // ask for is dropped.
        let mut ring = History::default();
        for n in 0..100u32 {
            ring.record(TICK_MS * n as f64, 0.0, 0.0);
        }
        let want = ((MAX_REWIND_MS + TICK_MS) / TICK_MS) as usize + 1;
        assert_eq!(ring.len(), want);
        assert!(ring.len() < history_cap());
        assert_eq!(ring[ring.len() - 1].t, TICK_MS * 99.0);
        assert_eq!(ring[0].t, TICK_MS * (99 - want + 1) as f64);
        assert!(serde_json::from_value::<History>(
            serde_json::to_value(vec![
                Sample {
                    t: 0.0,
                    x: 0.0,
                    y: 0.0
                };
                history_cap() + 1
            ])
            .unwrap()
        )
        .is_err());
    }

    #[test]
    #[should_panic(expected = "ring is full")]
    fn a_full_history_ring_refuses_a_push_in_every_build() {
        let mut ring = History::default();
        for n in 0..=history_cap() {
            ring.push(Sample {
                t: n as f64,
                x: 0.0,
                y: 0.0,
            });
        }
    }

    #[test]
    fn a_path_serializes_only_what_is_left_and_compacts_on_replace() {
        let pts: Vec<Vec2> = (0..5).map(|i| Vec2::new(i as f64, -(i as f64))).collect();
        let mut p = Path::default();
        p.set_from(&pts);
        p.advance();
        p.advance();
        assert_eq!(p.first(), Some(pts[2]));
        assert_eq!(p.len(), 3);
        assert_eq!(
            serde_json::to_value(&p).unwrap(),
            serde_json::to_value((p.generation, &pts[2..])).unwrap(),
            "the consumed prefix is not serialized"
        );
        let mut fresh = Path::default();
        fresh.set_from(&pts[2..]);
        assert_eq!(
            p, fresh,
            "equality sees the logical path and replacement generation"
        );
        let back: Path = serde_json::from_value(serde_json::to_value(&p).unwrap()).unwrap();
        assert_eq!(back, p);
        p.set_from(&pts[..1]);
        assert_eq!((p.cursor, p.pts.len()), (0, 1), "replacing compacts");
        p.advance();
        assert!(p.is_empty() && p.first().is_none());
        assert_eq!(
            (p.cursor, p.pts.len()),
            (0, 0),
            "running out resets the cursor"
        );
        assert_eq!(
            serde_json::to_value(&p).unwrap(),
            serde_json::json!([2, []])
        );
    }

    #[test]
    fn the_roster_names_leavers_too() {
        let mut r = Roster::default();
        r.push(PlayerId(1), "a");
        r.push(PlayerId(2), "b");
        r.push(PlayerId(5), "c");
        assert_eq!(r.name(PlayerId(2)), Some("b"));
        assert_eq!(r.name(PlayerId(5)), Some("c"));
        assert_eq!(r.name(PlayerId(3)), None);
    }
}
