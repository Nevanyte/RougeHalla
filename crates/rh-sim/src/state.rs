//! The evolving match state: players and their runtime, and the arena's run bookkeeping.

use crate::content::{FactionId, WeaponId};
use crate::events::Event;
use crate::input::{InputQueue, OrderBudget};
use crate::math::Vec2;
use crate::results::{GvBreakdown, Outcome};
use crate::rng::Mulberry32;
use crate::statics::Secrets;
use crate::systems::ledger::Entry;

/// A player's public entity id: assigned at join, never reused within a match.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub struct PlayerId(pub u32);

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Phase {
    Lobby,
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
    pub kind: ActionKind,
    pub weapon: WeaponId,
    pub started_at: f64,
    pub lands_at: f64,
    pub a: f64,
    pub packet: Packet,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WeaponRt {
    pub action: Option<PendingAction>,
    pub root_until: f64,
    pub stagger_immune_until: f64,
    pub held: bool,
    pub pressed_at: f64,
    pub buffered_until: f64,
    pub aim: f64,
    pub aim_at: f64,
    pub lag_ms: f64,
}

impl Default for WeaponRt {
    fn default() -> Self {
        Self {
            action: None,
            root_until: 0.0,
            stagger_immune_until: 0.0,
            held: false,
            pressed_at: 0.0,
            buffered_until: 0.0,
            aim: 0.0,
            aim_at: 0.0,
            lag_ms: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Player {
    pub id: PlayerId,
    /// The profile (callsign) the result is banked to; for a bot only its display name.
    pub profile: String,
    pub name: String,
    pub bot: bool,
    pub faction: FactionId,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub barrier: f64,
    pub status: Status,
    /// Carried items; `None` fights with fists. The slice has no item flow, so these stay `None`.
    pub weapon0: Option<WeaponId>,
    pub weapon1: Option<WeaponId>,
    pub slot: u8,
    pub ready_at: f64,
    pub draw_started_at: f64,
    pub move_seq: u8,
    pub kills: u32,
    pub bounty: u32,
    pub gv: u32,
    pub immune_until: f64,
    // runtime (server-only)
    pub(crate) inputs: InputQueue,
    pub budget: OrderBudget,
    pub path: Vec<Vec2>,
    pub history: Vec<Sample>,
    pub weapon: WeaponRt,
    pub killed_by: Option<String>,
    pub killed_by_bot: bool,
    pub gv_parts: GvBreakdown,
    pub last_hit: Option<(PlayerId, f64)>,
    pub damaged: Vec<PlayerId>,
    pub damaged_humans: Vec<PlayerId>,
    pub dropped_at: Option<f64>,
    pub hp_frac_at_tick_start: f64,
    pub down: Option<Outcome>,
    pub resolved: bool,
    pub bot_kills: u32,
    pub announce: Option<(f64, u32)>,
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
            id,
            profile: profile.to_string(),
            name: profile.to_string(),
            bot,
            faction,
            x: spot.x,
            y: spot.y,
            facing: 0.0,
            hp,
            max_hp: hp,
            barrier: 0.0,
            status: Status::Lobby,
            weapon0: None,
            weapon1: None,
            slot: 0,
            ready_at: 0.0,
            draw_started_at: 0.0,
            move_seq: 0,
            kills: 0,
            bounty: 0,
            gv: 0,
            immune_until: 0.0,
            inputs: InputQueue::default(),
            budget: OrderBudget::default(),
            path: Vec::new(),
            history: Vec::new(),
            weapon: WeaponRt::default(),
            killed_by: None,
            killed_by_bot: false,
            gv_parts: GvBreakdown::default(),
            last_hit: None,
            damaged: Vec::new(),
            damaged_humans: Vec::new(),
            dropped_at: None,
            hp_frac_at_tick_start: 1.0,
            down: None,
            resolved: false,
            bot_kills: 0,
            announce: None,
        }
    }

    pub fn standing(&self) -> bool {
        self.status == Status::Alive && self.down.is_none() && !self.resolved
    }
    pub fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
    /// The weapon in hand: the item in the active slot, or fists.
    pub fn active_weapon(&self) -> WeaponId {
        let item = if self.slot == 0 {
            self.weapon0
        } else {
            self.weapon1
        };
        item.unwrap_or(WeaponId::Fists)
    }
    /// Where the fighter was at server time `t` (lerped between ticks, clamped to history; legacy `positionAt`).
    pub fn position_at(&self, t: f64) -> Vec2 {
        let h = &self.history;
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

/// The arena's run bookkeeping that outlives a tick (legacy `world.arena`).
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct ArenaRt {
    pub(crate) started_with: u32,
    pub(crate) started_humans: usize,
    pub(crate) downs_between_ticks: u32,
}

/// The evolving match state: everything a later tick can depend on. With [`crate::statics::MatchStatic`] it is the whole
/// checkpoint, and it is what [`crate::Sim::state_hash`] hashes. Per-tick working sets live in
/// [`crate::scratch::TickScratch`] instead.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct World {
    pub(crate) tick: u32,
    pub(crate) server_time: f64,
    pub(crate) phase: Phase,
    pub(crate) lobby_ends_at: f64,
    pub(crate) raid_started_at: f64,
    pub(crate) winner: Option<String>,
    /// In join order (legacy Map insertion order).
    pub(crate) players: Vec<Player>,
    pub(crate) next_id: u32,
    pub(crate) joined: usize,
    pub(crate) spawn_rng: Mulberry32,
    pub(crate) rt: ArenaRt,
    /// Events emitted between steps (a leave's result) wait here for the next step: part of a checkpoint and the hash.
    pub(crate) pending_events: Vec<Event>,
    /// Effects a hook link queued for the next tick (legacy `combat.deferred`): they open its ledger. Empty in the slice,
    /// which has no link that defers; absent from a checkpoint while empty, so checkpoints and hashes are unchanged.
    #[serde(default, skip_serializing_if = "DeferredQueue::is_empty")]
    pub(crate) deferred: DeferredQueue,
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
    pub(crate) fn is_empty(&self) -> bool {
        self.hits.is_empty()
    }

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
    pub(crate) collecting: bool,
    pub(crate) items: Vec<crate::systems::ledger::PayLater>,
}

impl World {
    /// The index of a present player (join order).
    pub(crate) fn idx(&self, id: PlayerId) -> Option<usize> {
        self.players.iter().position(|p| p.id == id)
    }

    pub(crate) fn player(&self, id: PlayerId) -> Option<&Player> {
        self.players.iter().find(|p| p.id == id)
    }

    pub(crate) fn new(secrets: &Secrets) -> Self {
        Self {
            tick: 0,
            server_time: 0.0,
            phase: Phase::Lobby,
            lobby_ends_at: 0.0,
            raid_started_at: 0.0,
            winner: None,
            players: Vec::new(),
            next_id: 1,
            joined: 0,
            spawn_rng: Mulberry32::new(secrets.spawn_seed),
            rt: ArenaRt::default(),
            pending_events: Vec::new(),
            deferred: DeferredQueue::default(),
            pay: PayQueue::default(),
            #[cfg(feature = "schedule-trace")]
            trace: Default::default(),
        }
    }
}
