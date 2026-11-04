//! Tunables of the implemented slice, copied from the legacy `packages/shared/src/constants.ts` (and the weapon module).
//! Units: world units (1 tile = [`TILE`] = 32 u), milliseconds for server time. Values are the legacy ones at the tested
//! revision (docs/MIGRATION.md); a change here is a gameplay change and must move the parity fixtures with it.

pub const TICK_RATE: u32 = 20;
pub const TICK_MS: f64 = 1000.0 / TICK_RATE as f64;
pub const MAX_REWIND_MS: f64 = 300.0;
pub const TILE: f64 = 32.0;
pub const MAP_TILES_W: u32 = 160;
pub const MAP_TILES_H: u32 = 160;
/// Client points are clamped to the world's nominal size (legacy `parsePoint`), not to the loaded map.
pub const WORLD_W: f64 = MAP_TILES_W as f64 * TILE;
pub const WORLD_H: f64 = MAP_TILES_H as f64 * TILE;
pub const PLAYER_RADIUS: f64 = 12.0;
pub const PLAYER_SPEED: f64 = 170.0;
pub const VISION_RADIUS: f64 = 900.0;
pub const MAX_PLAYERS: usize = 8;
pub const MAX_ACTIONS_PER_TICK: usize = 6;
pub const ATTACK_BUFFER_MS: f64 = 150.0;
pub const AIM_STALE_MS: f64 = 1000.0;
pub const STAGGER_IMMUNITY_SECONDS: f64 = 1.1;
pub const SWAP_SECONDS: f64 = 0.25;
pub const MOVE_MULT_FLOOR: f64 = 0.35;
/// A cooldown or windup that ends exactly on a tick is due on that tick whatever way float noise falls.
pub const TIE_EPS_MS: f64 = 1e-6;
pub const RANGED_RELEASE_PAUSE_MS: f64 = 200.0;

pub const KILL_CREDIT_SECONDS: f64 = 5.0;
pub const GV_KILL: u32 = 10;
pub const GV_WIN: u32 = 50;
pub const WIN_BONUS_MIN_PLAYERS: usize = 3;
pub const WIN_BONUS_MIN_OPPONENTS: usize = 2;
pub const BOUNTY_SCALE: f64 = 10.0;
pub const BOUNTY_FREE_KILLS: i64 = 2;
pub const BOUNTY_EXPONENT: f64 = 1.5;
pub const BOUNTY_ANNOUNCE_MS: f64 = 10_000.0;

pub const DUEL_PACE: f64 = 2.0;
pub const PVP_F0: f64 = 0.77;
pub const PVP_FMAX: f64 = 3.0;
pub const PVP_P0: f64 = 6.0;
pub const PVP_HIT_CAP_SHARE: f64 = 0.35;

/// Order budget per seat (legacy ORDER_BURST / ORDER_PER_SECOND, enforced at the network edge there). Here it is enforced on
/// SIM time by the seat layer for humans, scripted bots and future policies alike (docs/CONTRACTS.md C-INPUT-3).
pub const ORDER_BURST: f64 = 30.0;
pub const ORDER_PER_SECOND: f64 = 15.0;
