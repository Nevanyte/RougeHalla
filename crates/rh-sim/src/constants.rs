//! The content registry: every gameplay number of the slice, declared exactly once.
//!
//! Tunables are copied from the legacy `packages/shared/src/constants.ts` (and the weapon module). Units: world units
//! (1 tile = [`TILE`] = 32 u), milliseconds for server time unless the unit column says otherwise. Values are the legacy
//! ones at the tested revision (docs/MIGRATION.md); a change here is a gameplay change and must move the parity fixtures
//! with it.
//!
//! ## The rule: a new gameplay number is one line in [`content!`] below
//!
//! `content!` expands each line `NAME: ty = value, "unit";` into the plain `pub const NAME: ty = value;` that call sites
//! use today (names and expressions unchanged, so f64 operation order is untouched), and into one row of [`REGISTRY`].
//! [`crate::content::content_hash`] folds the whole registry (name and value bits, in declaration order), so a number
//! cannot influence a match without also changing the rules identity that the Welcome message, `/info` and replays carry.
//! `crates/rh-sim/tests/content.rs` enforces it: it walks every `crates/rh-sim/src/**/*.rs` file and fails on any
//! `const NAME` that is neither in this registry nor in its reviewed NON_GAMEPLAY list, and it perturbs every registry
//! row and requires the hash to move. Declaration order is part of the hash: append new rows, do not shuffle.

/// A registered value. Integers keep their own variant so no gameplay count is ever routed through a lossy f64.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ContentVal {
    F64(f64),
    U64(u64),
    I64(i64),
}

/// One row of [`REGISTRY`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Entry {
    pub name: &'static str,
    /// Documentation only (not hashed).
    pub unit: &'static str,
    pub val: ContentVal,
}

macro_rules! content {
    (@val f64, $e:expr) => {
        ContentVal::F64($e)
    };
    (@val u32, $e:expr) => {
        ContentVal::U64($e as u64)
    };
    (@val u8, $e:expr) => {
        ContentVal::U64($e as u64)
    };
    (@val usize, $e:expr) => {
        ContentVal::U64($e as u64)
    };
    (@val i64, $e:expr) => {
        ContentVal::I64($e)
    };
    ($( $(#[$m:meta])* $name:ident : $ty:ident = $val:expr, $unit:literal; )*) => {
        $( $(#[$m])* pub const $name: $ty = $val; )*
        /// Every gameplay number of the slice in declaration order (see the module docs).
        pub const REGISTRY: &[Entry] = &[
            $( Entry { name: stringify!($name), unit: $unit, val: content!(@val $ty, $name) } ),*
        ];
    };
}

content! {
    // ---- time base, world and seats ----
    TICK_RATE: u32 = 20, "Hz";
    TICK_MS: f64 = 1000.0 / TICK_RATE as f64, "ms";
    MAX_REWIND_MS: f64 = 300.0, "ms";
    TILE: f64 = 32.0, "u";
    MAP_TILES_W: u32 = 160, "tiles";
    MAP_TILES_H: u32 = 160, "tiles";
    /// Client points are clamped to the world's nominal size (legacy `parsePoint`), not to the loaded map.
    WORLD_W: f64 = MAP_TILES_W as f64 * TILE, "u";
    WORLD_H: f64 = MAP_TILES_H as f64 * TILE, "u";
    PLAYER_RADIUS: f64 = 12.0, "u";
    PLAYER_SPEED: f64 = 170.0, "u/s";
    VISION_RADIUS: f64 = 900.0, "u";
    MAX_PLAYERS: usize = 8, "seats";
    MAX_ACTIONS_PER_TICK: usize = 6, "commands/tick";
    ATTACK_BUFFER_MS: f64 = 150.0, "ms";
    AIM_STALE_MS: f64 = 1000.0, "ms";
    STAGGER_IMMUNITY_SECONDS: f64 = 1.1, "s";
    SWAP_SECONDS: f64 = 0.25, "s";
    MOVE_MULT_FLOOR: f64 = 0.35, "factor";
    /// A cooldown or windup that ends exactly on a tick is due on that tick whatever way float noise falls.
    TIE_EPS_MS: f64 = 1e-6, "ms";
    RANGED_RELEASE_PAUSE_MS: f64 = 200.0, "ms";

    // ---- scoring and bounty ----
    KILL_CREDIT_SECONDS: f64 = 5.0, "s";
    GV_KILL: u32 = 10, "GV";
    GV_WIN: u32 = 50, "GV";
    WIN_BONUS_MIN_PLAYERS: usize = 3, "players";
    WIN_BONUS_MIN_OPPONENTS: usize = 2, "players";
    BOUNTY_SCALE: f64 = 10.0, "GV";
    BOUNTY_FREE_KILLS: i64 = 2, "kills";
    BOUNTY_EXPONENT: f64 = 1.5, "exponent";
    BOUNTY_ANNOUNCE_MS: f64 = 10_000.0, "ms";

    // ---- damage law ----
    DUEL_PACE: f64 = 2.0, "factor";
    PVP_F0: f64 = 0.77, "factor";
    PVP_FMAX: f64 = 3.0, "factor";
    PVP_P0: f64 = 6.0, "card power";
    PVP_HIT_CAP_SHARE: f64 = 0.35, "share of max hp";

    // ---- order budget ----
    /// Order budget per seat (legacy ORDER_BURST / ORDER_PER_SECOND, enforced at the network edge there). Here it is enforced
    /// on SIM time by the seat layer for humans, scripted bots and future policies alike (docs/CONTRACTS.md C-INPUT-3).
    ORDER_BURST: f64 = 30.0, "tokens";
    ORDER_PER_SECOND: f64 = 15.0, "tokens/s";

    // ---- player attack timings (legacy `weaponTimings(w, interval, "player")`): windup = min(MAX, SHARE * interval) ----
    BOW_WINDUP_MAX_S: f64 = 0.5, "s";
    BOW_WINDUP_INTERVAL_SHARE: f64 = 0.55, "share of interval";
    WAND_WINDUP_MAX_S: f64 = 0.45, "s";
    WAND_WINDUP_INTERVAL_SHARE: f64 = 0.5, "share of interval";

    // ---- search, mask and epsilon numbers used by pathfind.rs, map.rs and the combat systems (by name) ----
    /// Rings searched when a start or goal sits in a wall.
    SNAP_RADIUS: i64 = 4, "tiles";
    /// Candidates past the anchor that string pulling considers (legacy PULL_WINDOW).
    PULL_WINDOW: usize = 96, "waypoints";
    /// Tile-class masks of the three queries: sight (walls), movement (everything), melee (walls and low cover).
    MASK_SIGHT: u8 = 0b01, "bitmask";
    MASK_MOVE: u8 = 0xff, "bitmask";
    MASK_MELEE: u8 = 0b11, "bitmask";
    /// A barrier below this after a hit is cleared to zero.
    BARRIER_EPS: f64 = 1e-3, "hp";
    /// Movement shorter than this does not turn the player.
    FACING_EPS: f64 = 0.001, "u";
    /// Slack on the half arc plus the target's angular radius.
    ARC_EPS: f64 = 1e-9, "rad";
    /// A* f-scores closer than this tie and fall through to the g and index rules.
    PATH_TIE_EPS: f64 = 1e-9, "cost";
    /// The start tile's centre becomes a
    /// waypoint when the start is in a wall or farther than this from the centre on either axis.
    START_CENTER_SLACK: f64 = 0.5, "u";
}
