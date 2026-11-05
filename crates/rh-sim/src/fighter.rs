//! What a fighter is, as components: [`FighterCore`] is everything the combat systems read and write for anything that
//! fights (a player today; a mob or a summon later), and [`Player`](crate::state::Player) adds what only a seated player
//! has (the seat, the score, the run's fate). A system that moves, swings or takes damage is written against the core (or
//! one of its components), so a new kind of fighter is a new wrapper around the same core, not a copy of the systems.
//!
//! The components own their data only; the rules live in `systems/`. All of it is plain data that serializes, hashes and
//! checkpoints (the layout is `rh-checkpoint/6`).

use crate::content::{FactionId, WeaponId};
use crate::input::{InputQueue, OrderBudget};
use crate::math::Vec2;
use crate::results::GvBreakdown;
use crate::state::{History, Path, PlayerId, WeaponRt};

/// A fighter's place in the tick's fighter list: the address the systems use for "the n-th fighter", whoever it is.
///
/// Players occupy `0..players.len()` in join order, so the order the systems iterate (and the legacy tick depends on) is
/// the index order; mobs will follow them in id order (legacy `standingCombatants`: players, then mobs). An index is valid
/// for the tick that produced it: a join or a leave between ticks renumbers the later fighters, so one is never stored
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

/// How much a fighter can take, and what it is (the faction decides its armor and shield).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Vitals {
    pub faction: FactionId,
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
    pub motion: Motion,
    pub(crate) inputs: InputQueue,
}

impl FighterCore {
    pub fn pos(&self) -> Vec2 {
        Vec2::new(self.body.x, self.body.y)
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
    pub killed_by_bot: bool,
}
