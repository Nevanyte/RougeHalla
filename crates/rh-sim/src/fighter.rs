//! What a fighter is, as components: [`FighterCore`] is everything the combat systems read and write for anything that
//! fights (players, regional mobs, summons and practice targets), and [`Player`](crate::state::Player) adds what only a seated player
//! has (the seat, the score, the run's fate). A system that moves, swings or takes damage is written against the core (or
//! one of its components), so a new kind of fighter is a new wrapper around the same core, not a copy of the systems.
//!
//! The components own their data only; the rules live in `systems/`. All of it is plain data that serializes, hashes and
//! checkpoints (the composed layout is `rh-checkpoint/31`).

use crate::content::{FactionId, WeaponId};
use crate::input::{InputQueue, OrderBudget};
use crate::math::Vec2;
use crate::results::GvBreakdown;
use crate::state::{History, Path, PlayerId, WeaponRt};

/// A fighter's place in the tick's fighter list: the address the systems use for "the n-th fighter", whoever it is.
///
/// Players occupy `0..players.len()` in join order, so the order the systems iterate (and the legacy tick depends on) is
/// the index order; mobs follow them in insertion order (legacy `standingCombatants`: players, then mobs). An index is valid
/// only until the next structural store mutation: a join, removal, compaction or birth can renumber later fighters. It is never stored
/// across a step, a checkpoint or a replay (the stable name of a fighter is its [`PlayerId`] / `EntityId`). It is not
/// serialized, not hashed and has no wire form.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct FighterIx(pub u32);

impl FighterIx {
    /// The index of the fighter in slot `slot` of the player store.
    #[inline]
    pub(crate) fn of_slot(slot: usize) -> Self {
        Self(slot as u32)
    }

    /// The slot in the player store (valid for a player: see [`crate::state::World::is_player`]).
    #[inline]
    pub(crate) fn slot(self) -> usize {
        self.0 as usize
    }
}

/// Where a fighter is and what it faces, with the short history the rewind (lag compensation) reads.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Body {
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub history: History,
}

/// An actor's actual faction affiliation. Neutral actors have no faction content row.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Deserialize)]
#[serde(untagged)]
pub enum FighterAffiliation {
    Faction(FactionId),
    Neutral,
}
impl serde::Serialize for FighterAffiliation {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // JSON preserves the actual faction string / neutral null. The canonical serializer must
        // also hash the explicit Some/None discriminant; an untagged unit would contribute no word.
        serde::Serialize::serialize(&self.faction_id(), serializer)
    }
}
impl FighterAffiliation {
    pub const fn faction_id(self) -> Option<FactionId> {
        match self {
            Self::Faction(id) => Some(id),
            Self::Neutral => None,
        }
    }
}
impl From<FactionId> for FighterAffiliation {
    fn from(value: FactionId) -> Self {
        Self::Faction(value)
    }
}
impl PartialEq<FactionId> for FighterAffiliation {
    fn eq(&self, other: &FactionId) -> bool {
        self.faction_id() == Some(*other)
    }
}
impl PartialEq<FighterAffiliation> for FactionId {
    fn eq(&self, other: &FighterAffiliation) -> bool {
        other == self
    }
}

/// How much a fighter can take, and what it is (the faction decides its armor and shield).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Vitals {
    pub faction: FighterAffiliation,
    pub hp: f64,
    pub max_hp: f64,
    pub barrier: f64,
    pub immune_until: f64,
    pub hp_frac_at_tick_start: f64,
}

/// The route a fighter walks and the last move order the client may see acknowledged.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Motion {
    pub path: Path,
    pub move_seq: u8,
    pub displace_seq: u8,
    pub slip: Option<SlipState>,
}

/// Shared terrain movement memory. P-TERRAIN supplies and advances it; displacement only clears it.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SlipState {
    pub vx: f64,
    pub vy: f64,
    pub ax: f64,
    pub ay: f64,
    pub path: Option<u64>,
    pub replan_at: Option<f64>,
    pub stuck_x: Option<f64>,
    pub stuck_y: Option<f64>,
    pub stuck_n: Option<f64>,
    pub stuck_best: Option<f64>,
    pub stuck_at: Option<f64>,
    pub grip_until: Option<f64>,
}

/// Everything the combat systems need of one fighter, whoever it is. Its `inputs` are the commands that reached it through
/// `validate` + `Sim::submit` (C-INPUT) and wait for the next tick.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FighterCore {
    pub id: PlayerId,
    pub body: Body,
    pub vitals: Vitals,
    /// The weapon state: the carried items, the active slot and the runtime of the swing in progress.
    pub weapon: WeaponRt,
    /// Private engagement and sustain clocks, independent of weapon target locks.
    pub signature: Signature,
    pub statuses: crate::status_runtime::StatusRuntime,
    /// Encoded source-timed attack-speed mirror; the shared kernel owns its codec.
    pub modifiers: crate::modifiers::Runtime,
    /// Player card runtime; the status ticker shares the source one-roll-per-tick cache.
    pub card_dot_crit: Option<crate::status_runtime::DotCritState>,
    pub motion: Motion,
    /// The hitbox row (ADR0024), written once by the constructor through [`crate::archetype::assign`]; never changes.
    pub archetype: crate::archetype::ArchetypeId,
    pub(crate) inputs: InputQueue,
}

impl FighterCore {
    pub const fn faction_id(&self) -> Option<FactionId> {
        self.vitals.faction.faction_id()
    }

    pub fn pos(&self) -> Vec2 {
        Vec2::new(self.body.x, self.body.y)
    }

    /// The hitbox row (ADR0024).
    #[inline]
    pub fn hull(&self) -> &'static crate::archetype::Archetype {
        self.archetype.row()
    }

    /// What the fighter occupies for walls and paths.
    #[inline]
    pub fn foot(&self) -> crate::geometry::Footprint {
        self.hull().foot()
    }

    /// The weapon in hand: the item in the active slot, or fists.
    pub fn active_weapon(&self) -> WeaponId {
        let w = &self.weapon;
        let item = if w.slot == 0 { w.weapon0 } else { w.weapon1 };
        item.unwrap_or(WeaponId::Fists)
    }

    /// Where the fighter was at server time `t` (lerped between ticks, clamped to history; legacy `positionAt`).
    pub fn position_at(&self, t: f64) -> Vec2 {
        let h = self.body.history.as_slice();
        if h.is_empty() || t >= h[h.len() - 1].t {
            return self.pos();
        }
        if t <= h[0].t {
            return Vec2::new(h[0].x, h[0].y);
        }
        let mut i = h.len() - 2;
        while i > 0 && h[i].t > t {
            i -= 1;
        }
        let (a, b) = (h[i], h[i + 1]);
        let k = (t - a.t) / (b.t - a.t);
        Vec2::new(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)
    }
}

/// A read-only view of one fighter: its id, its core and whether it still stands in the run. What an observer, a bot
/// brain or a future mob targeting pass takes, so none of them depends on the seated-player record.
#[derive(Clone, Copy, Debug)]
pub struct FighterRef<'a> {
    pub core: &'a FighterCore,
    pub standing: bool,
}

impl<'a> FighterRef<'a> {
    pub fn id(&self) -> PlayerId {
        self.core.id
    }
    pub fn pos(&self) -> Vec2 {
        self.core.pos()
    }
    pub fn position_at(&self, t: f64) -> Vec2 {
        self.core.position_at(t)
    }
    pub fn hp(&self) -> f64 {
        self.core.vitals.hp
    }
}

/// The seat a player occupies: who it is for banking and display, and how fast it may give orders.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Seat {
    /// Private persistence provenance: only an explicit join choice earns faction win progress.
    pub(crate) picked_faction: Option<FactionId>,
    /// The profile (callsign) the result is banked to; for a bot only its display name.
    pub profile: String,
    pub name: String,
    pub bot: bool,
    pub budget: OrderBudget,
    /// When the client's connection dropped (a run only): leave credit is judged at that time.
    pub dropped_at: Option<f64>,
}

/// What a fighter has earned and whom it hurt.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Credit {
    pub mob_kills: u32,
    pub sentence: u8,
    pub kills: u32,
    pub bot_kills: u32,
    pub bounty: u32,
    pub gv: u32,
    pub gv_parts: GvBreakdown,
    pub announce: Option<(f64, u32)>,
    pub last_hit: Option<(PlayerId, f64)>,
    pub damaged: Vec<PlayerId>,
    pub damaged_humans: Vec<PlayerId>,
}

/// How a fighter's run ended, as far as the result needs to know (the killer is resolved to a name through the roster when
/// the result is built).
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Fate {
    pub killed_by: Option<PlayerId>,
    pub killed_by_name: Option<std::sync::Arc<str>>,
    pub killed_by_bot: bool,
}

/// Shared actor engagement and faction sustain state. Optional timestamps encode the legacy negative-infinity sentinel.
/// This is trusted checkpoint state, never an observation or a target-admission source.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signature {
    pub ap_hits: crate::modifiers::HitWindow,
    pub mark: Mark,

    pub chill: f64,
    /// Stable private actor IDs, unique in source first-insertion order. Capacity is retained derived storage.
    pub chillers: Vec<PlayerId>,
    pub exposure_started_at: Option<f64>,
    pub last_near_at: Option<f64>,
    pub ranged_chill_until: Option<f64>,
    pub frost_move_mult: f64,
    pub dot_paused_until: f64,
    pub bits: u8,
    pub target: Option<PlayerId>,
    pub in_reach: bool,
    pub engaged: bool,
    pub reach_at: Option<f64>,
    pub contact_at: Option<f64>,
    pub combat_at: Option<f64>,
    /// The target the damage-over-time signature was running on at the last after-damage pass (source `engagedOn`).
    #[serde(default)]
    pub engaged_on: Option<PlayerId>,
    /// HP/maxHP immediately before the ledger, excluding barrier.
    pub hp_frac: f64,
}
impl Default for Signature {
    fn default() -> Self {
        Self {
            ap_hits: Default::default(),
            mark: Mark::default(),
            chill: 1.0,
            chillers: Vec::new(),
            exposure_started_at: None,
            last_near_at: None,
            ranged_chill_until: None,
            frost_move_mult: 1.0,
            dot_paused_until: 0.0,
            bits: 0,
            target: None,
            in_reach: false,
            engaged: false,
            reach_at: None,
            contact_at: None,
            combat_at: None,
            engaged_on: None,
            hp_frac: 1.0,
        }
    }
}
impl Signature {
    /// Reset semantic state while retaining warmed owned buffers. Capacity has no checkpoint/hash meaning.
    pub(crate) fn reset(&mut self) {
        let mut chillers = std::mem::take(&mut self.chillers);
        chillers.clear();
        let mut ap_hits = std::mem::take(&mut self.ap_hits);
        ap_hits.reset();
        *self = Self {
            chillers,
            ap_hits,
            ..Self::default()
        };
    }
    pub(crate) fn clear_target(&mut self) {
        self.mark.reset();
        self.target = None;
        self.in_reach = false;
        self.engaged = false;
        self.reach_at = None;
    }
    pub(crate) fn set_target(&mut self, target: PlayerId, now: f64) {
        self.clear_target();
        self.target = Some(target);
        self.contact_at = Some(now);
    }
}

/// Private typed historical target group; source labels stay outside the simulation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MarkGroup {
    Fighter(PlayerId),
    Camp(u32),
}

/// Private Mark state. Amplifier linger survives target resets.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mark {
    pub group: Option<MarkGroup>,
    pub group_size: usize,
    pub tier: u8,
    pub hits: u64,
    pub progress: f64,
    pub swaps: u64,
    pub denied: bool,
    pub far_since: Option<f64>,
    pub amp_until: f64,
}
impl Default for Mark {
    fn default() -> Self {
        Self {
            group: None,
            group_size: 1,
            tier: 0,
            hits: 0,
            progress: 0.,
            swaps: 0,
            denied: false,
            far_since: None,
            amp_until: 0.,
        }
    }
}
impl Mark {
    pub(crate) fn reset(&mut self) {
        let amp_until = self.amp_until;
        *self = Self {
            amp_until,
            ..Self::default()
        };
    }
}
