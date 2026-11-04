//! The evolving match state: players and their runtime, and the arena's run bookkeeping.

use crate::constants::{MAX_PLAYERS, MAX_REWIND_MS, TICK_MS};
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

/// How many rewind samples a fighter keeps: the window [`MAX_REWIND_MS`] + one tick (see [`History::record`]) holds at
/// most `window / TICK_MS + 1` samples one tick apart; one more is slack. Derived from the constants so a change to the
/// rewind window or the tick rate resizes the ring instead of silently dropping samples (`History::push` also refuses
/// to drop one in a debug build).
const fn history_cap() -> usize {
    ((MAX_REWIND_MS + TICK_MS) / TICK_MS) as usize + 2
}

/// A fighter's rewind history: the last [`history_cap`] samples, oldest first, in a fixed inline ring (no heap, no shifting
/// on trim). Serialized and hashed as the plain oldest-first sequence a `Vec<Sample>` was, so checkpoints keep their shape
/// and state hashes keep their values.
#[derive(Clone, Copy, Debug)]
pub struct History {
    buf: [Sample; history_cap()],
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
            }; history_cap()],
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
    /// The `i`-th oldest sample.
    pub fn get(&self, i: usize) -> Option<Sample> {
        (i < self.len()).then(|| self.buf[(self.head as usize + i) % history_cap()])
    }
    /// Oldest first.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = Sample> + '_ {
        (0..self.len()).map(|i| self.buf[(self.head as usize + i) % history_cap()])
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
        if self.len() == history_cap() {
            // Unreachable while the ring is sized from the rewind window (samples are a tick apart and the trim runs before
            // the push); never drop one silently if a later change breaks that.
            debug_assert!(false, "rewind history ring is full");
            self.pop_front();
        }
        let at = (self.head as usize + self.len()) % history_cap();
        self.buf[at] = s;
        self.len += 1;
    }
    pub fn pop_front(&mut self) {
        if self.len > 0 {
            self.head = ((self.head as usize + 1) % history_cap()) as u8;
            self.len -= 1;
        }
    }
    /// Records the fighter's position at `now` and drops what the rewind window no longer needs: the oldest samples older
    /// than `now - MAX_REWIND_MS - TICK_MS`, always keeping two (legacy `recordHistory`: push, then trim while longer than
    /// two). The trim runs first here, so the ring never holds more than the window; the resulting sequence is the same.
    pub fn record(&mut self, now: f64, x: f64, y: f64) {
        let cutoff = now - MAX_REWIND_MS - TICK_MS;
        while self.len() >= 2 && self.get(0).is_some_and(|s| s.t < cutoff) {
            self.pop_front();
        }
        self.push(Sample { t: now, x, y });
    }
}

impl std::ops::Index<usize> for History {
    type Output = Sample;
    fn index(&self, i: usize) -> &Sample {
        assert!(i < self.len(), "history index {i} out of {}", self.len());
        &self.buf[(self.head as usize + i) % history_cap()]
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
/// content (`pts[cursor..]`) is serialized, compared and hashed: the consumed prefix is dead data. The buffer is compacted
/// whenever the path is replaced or runs out, so the cursor never outlives a path.
#[derive(Clone, Debug, Default)]
pub struct Path {
    pts: Vec<Vec2>,
    cursor: usize,
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
            self.clear();
        }
    }
    pub fn clear(&mut self) {
        self.pts.clear();
        self.cursor = 0;
    }
    /// Replaces the path with `pts` (compacting: the cursor restarts at 0); the buffer keeps its capacity.
    pub fn set_from(&mut self, pts: &[Vec2]) {
        self.pts.clear();
        self.pts.extend_from_slice(pts);
        self.cursor = 0;
    }
}

impl PartialEq for Path {
    fn eq(&self, o: &Self) -> bool {
        self.as_slice() == o.as_slice()
    }
}

impl serde::Serialize for Path {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(self.as_slice())
    }
}

impl<'de> serde::Deserialize<'de> for Path {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Path {
            pts: Vec::<Vec2>::deserialize(d)?,
            cursor: 0,
        })
    }
}

/// Every player that joined this match, in join order, kept for leavers: the one place a name is resolved from an id (a
/// kill's `killed_by`, the winner), at result time. The tick itself carries ids only (the ledger, the melee queue and the
/// payouts are `Copy`), so a hit never clones a name and a shooter who already left is still named.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Roster {
    names: Vec<(PlayerId, String)>,
}

impl Roster {
    pub(crate) fn push(&mut self, id: PlayerId, name: &str) {
        debug_assert!(self.names.last().is_none_or(|(l, _)| *l < id));
        self.names.push((id, name.to_string()));
    }

    /// The display name `id` joined with (a leaver's too).
    pub(crate) fn name(&self, id: PlayerId) -> Option<&str> {
        let i = self.names.binary_search_by_key(&id, |(p, _)| *p).ok()?;
        Some(self.names[i].1.as_str())
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
    pub path: Path,
    pub history: History,
    pub weapon: WeaponRt,
    /// Who dealt the killing blow (resolved to a display name through the roster when the result is built).
    pub killed_by: Option<PlayerId>,
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
            path: Path::default(),
            history: History::default(),
            weapon: WeaponRt::default(),
            killed_by: None,
            killed_by_bot: false,
            gv_parts: GvBreakdown::default(),
            last_hit: None,
            // Everyone else in the lobby fits, so a normal match never grows them mid-fight.
            damaged: Vec::with_capacity(MAX_PLAYERS),
            damaged_humans: Vec::with_capacity(MAX_PLAYERS),
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
    pub(crate) winner: Option<PlayerId>,
    /// In join order (legacy Map insertion order).
    pub(crate) players: Vec<Player>,
    pub(crate) next_id: u32,
    /// Names of everyone who joined, leavers included (append-only; see [`Roster`]).
    pub(crate) roster: Roster,
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
            roster: Roster::default(),
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
            now += TICK_MS * if n % 97 < 5 { 1.0 + (n % 13) as f64 } else { 1.0 };
            let (x, y) = (n as f64 * 0.37, 1000.0 - n as f64 * 0.11);
            ring.record(now, x, y);
            reference(&mut vec, now, x, y);
            assert_eq!(ring.iter().collect::<Vec<_>>(), vec, "tick {n}");
            assert_eq!(serde_json::to_value(ring).unwrap(), serde_json::to_value(&vec).unwrap());
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
            serde_json::to_value(&pts[2..]).unwrap(),
            "the consumed prefix is not serialized"
        );
        let mut fresh = Path::default();
        fresh.set_from(&pts[2..]);
        assert_eq!(p, fresh, "equality sees the logical path only");
        let back: Path = serde_json::from_value(serde_json::to_value(&p).unwrap()).unwrap();
        assert_eq!(back, p);
        p.set_from(&pts[..1]);
        assert_eq!((p.cursor, p.pts.len()), (0, 1), "replacing compacts");
        p.advance();
        assert!(p.is_empty() && p.first().is_none());
        assert_eq!((p.cursor, p.pts.len()), (0, 0), "running out resets the cursor");
        assert_eq!(serde_json::to_value(&p).unwrap(), serde_json::json!([]));
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
