//! A derived memo of line-of-sight verdicts, outside the deterministic world (never hashed, checkpointed or serialized).
//!
//! `ray_blocked(map, ax, ay, bx, by, MASK_SIGHT)` is a pure function of its arguments over an arena that never changes, so
//! the verdict for a pair whose two endpoints are bit-identical to the last time that pair was asked is the same bool.
//! Dead bodies stay observed and idle fighters keep their positions, so a share of the in-radius pairs repeats from one
//! observation to the next. An entry stores the four coordinate bit patterns it was computed for and is used only when all
//! four match exactly, so a hit returns precisely what `ray_blocked` would (no epoch, no invalidation to get wrong).
//!
//! * Ordered: the key is (viewer, other); sight is not assumed symmetric.
//! * Bounded: a direct-mapped table sized from the player count (a colliding pair just overwrites: a miss, never a wrong answer).
//! * Pure: no hash-map iteration, no clock, no entropy; the index is a fixed multiplicative hash of the two ids.
//! * Arena-keyed: the table is dropped when it meets a different arena (a restore, a new match), by the arena's
//!   identity and statics digest, so an entry can never outlive the map it was computed on.

use crate::geometry::ray_blocked;
use crate::map::{TileMap, MASK_SIGHT};
use crate::state::PlayerId;

/// Table entries per ordered pair of players (a direct-mapped table collides less with room to spare).
const SLOTS_PER_PAIR: usize = 4;
const MIN_ENTRIES: usize = 64;
/// 2^16 entries (about 3 MB) is the most a room ever holds: above ~128 players the table is shared by more pairs than
/// it has entries, which only costs hit rate.
const MAX_ENTRIES: usize = 1 << 16;

#[derive(Clone, Copy)]
struct Entry {
    bits: [u64; 4],
    /// `viewer << 32 | other`, or [`NO_KEY`] for an empty entry.
    key: u64,
    blocked: bool,
}

/// The key of an empty entry: no pair is asked under it (a lookup with this key bypasses the table).
const NO_KEY: u64 = u64::MAX;

const EMPTY: Entry = Entry {
    bits: [0; 4],
    key: NO_KEY,
    blocked: false,
};

/// What the cache remembers of one viewer: where it stood the last tick it was observed, and whether it stood still.
/// A viewer that moved cannot hit any entry it owns (every key carries its position), so it skips the table.
#[derive(Clone, Copy)]
struct Viewer {
    id: u32,
    tick: u64,
    pos: [u64; 2],
    /// Probe the table for this viewer this tick (it stood exactly where it stood the previous tick it was observed).
    probe: bool,
}

const NO_VIEWER: Viewer = Viewer {
    id: u32::MAX,
    tick: u64::MAX,
    pos: [0; 2],
    probe: false,
};

/// Hit and miss counts (diagnostics only; they never influence a verdict).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SightStats {
    pub hits: u64,
    pub misses: u64,
}

pub struct SightCache {
    entries: Vec<Entry>,
    /// `entries.len() - 1` (a power of two).
    mask: usize,
    /// Direct-mapped by viewer id (a power-of-two length); a collision only resets the mode: a bypass or a probe,
    /// never a different verdict.
    viewers: Vec<Viewer>,
    /// The tick of the current pass (set by `begin`).
    tick: u64,
    arena: usize,
    digest: u64,
    /// The roster size the table is sized for.
    players: usize,
    stats: SightStats,
}

impl Default for SightCache {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for SightCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SightCache")
            .field("entries", &self.entries.len())
            .field("stats", &self.stats)
            .finish()
    }
}

impl SightCache {
    /// An empty cache; it allocates on first use, sized to the sim it meets.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            viewers: Vec::new(),
            tick: 0,
            mask: 0,
            arena: 0,
            digest: 0,
            players: 0,
            stats: SightStats::default(),
        }
    }

    /// Empties the table (the next lookups all miss).
    pub fn clear(&mut self) {
        self.entries.fill(EMPTY);
        self.viewers.fill(NO_VIEWER);
    }

    pub fn stats(&self) -> SightStats {
        self.stats
    }

    /// Readies the cache for one observation pass over a sim with `players` players on the arena `(arena, digest)`:
    /// drops the table when the arena differs from the one it was filled on, grows it when the roster outgrew it.
    #[inline]
    pub(crate) fn begin(&mut self, arena: usize, digest: u64, players: usize, tick: u64) {
        self.tick = tick;
        if arena != self.arena
            || digest != self.digest
            || players > self.players
            || self.entries.is_empty()
        {
            self.resize(arena, digest, players);
        }
    }

    #[cold]
    fn resize(&mut self, arena: usize, digest: u64, players: usize) {
        let want = (players * players * SLOTS_PER_PAIR)
            .next_power_of_two()
            .clamp(MIN_ENTRIES, MAX_ENTRIES);
        self.entries.clear();
        self.entries.resize(want, EMPTY);
        self.viewers.clear();
        self.viewers
            .resize(players.next_power_of_two().max(8), NO_VIEWER);
        self.mask = want - 1;
        self.arena = arena;
        self.digest = digest;
        self.players = players;
    }

    /// `ray_blocked(map, ax, ay, bx, by, MASK_SIGHT)`, reusing the stored verdict when this ordered pair was last asked
    /// for exactly these endpoints. Call [`SightCache::begin`] first.
    #[inline]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn blocked(
        &mut self,
        map: &TileMap,
        viewer: PlayerId,
        other: PlayerId,
        ax: f64,
        ay: f64,
        bx: f64,
        by: f64,
    ) -> bool {
        debug_assert!(!self.entries.is_empty(), "begin() first");
        // The viewer's mode for this tick, decided on its first lookup of the tick: a viewer that moved since the last
        // tick it was observed owns no entry that can hit, so it takes the plain traversal with no probe and no store.
        let vi = viewer.0 as usize & (self.viewers.len() - 1);
        let v = &mut self.viewers[vi];
        if v.id != viewer.0 || v.tick != self.tick {
            let pos = [ax.to_bits(), ay.to_bits()];
            v.probe = v.id == viewer.0 && v.pos == pos;
            v.id = viewer.0;
            v.tick = self.tick;
            v.pos = pos;
        }
        if !v.probe {
            return ray_blocked(map, ax, ay, bx, by, MASK_SIGHT);
        }
        let bits = [ax.to_bits(), ay.to_bits(), bx.to_bits(), by.to_bits()];
        let key = (u64::from(viewer.0) << 32) | u64::from(other.0);
        if key == NO_KEY {
            return ray_blocked(map, ax, ay, bx, by, MASK_SIGHT);
        }
        let h = key.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        let e = &mut self.entries[(h >> 40) as usize & self.mask];
        if e.key == key && e.bits == bits {
            self.stats.hits += 1;
            #[cfg(debug_assertions)]
            debug_assert_eq!(e.blocked, ray_blocked(map, ax, ay, bx, by, MASK_SIGHT));
            return e.blocked;
        }
        self.stats.misses += 1;
        let blocked = ray_blocked(map, ax, ay, bx, by, MASK_SIGHT);
        *e = Entry { bits, key, blocked };
        blocked
    }
}
