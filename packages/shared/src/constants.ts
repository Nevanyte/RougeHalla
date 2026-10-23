// Network
export const ROOM_NAME = "raid";
export const SERVER_PORT = 2567;
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const PATCH_MS = TICK_MS;
/** Clients render this far behind the estimated server clock (two ticks). */
export const INTERP_DELAY_MS = 100;
/**
 * How far back the server rewinds targets to match what an attacker saw (lag compensation).
 * Covers INTERP_DELAY_MS + RTT + one tick for clients up to ~150 ms RTT.
 */
export const MAX_REWIND_MS = 300;
/** A per-tick jump larger than this is treated as a teleport and not interpolated. */
export const TELEPORT_DISTANCE = 200;

// World
export const TILE = 32;
export const MAP_TILES_W = 64;
export const MAP_TILES_H = 64;
export const WORLD_W = MAP_TILES_W * TILE;
export const WORLD_H = MAP_TILES_H * TILE;
export const PLAYER_RADIUS = 12;
export const PLAYER_SPEED = 170;
export const PLAYER_MAX_HP = 100;
export const INTERACT_RANGE = 56;
export const INVENTORY_SLOTS = 6;

// Run flow
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS_TO_START = 2;
/** Lobby timer from the first join; long enough to open a second browser tab and join by hand. */
export const LOBBY_SECONDS = 30;
/** Once MIN players are in, the lobby waits at most this long for more before starting. */
export const LOBBY_FILL_SECONDS = 5;
export const RECONNECT_SECONDS = 10;
/** How long an ended room lingers so clients receive their results before disconnect. */
export const ENDED_LINGER_SECONDS = 5;
/** Only mapgen v1 still reads this (its extract circles); Phase 8b's map drops it. */
export const EXTRACT_RADIUS = 64;

// Arena
/**
 * With no death for this long, everyone alive is teleported into the coliseum and the gates lock. Any death restarts it.
 * PATIENCE_SECONDS with PATIENCE_FULL_ALIVE or more standing, shrinking linearly to PATIENCE_MIN_SECONDS at
 * PATIENCE_MIN_ALIVE or fewer (see patienceSecondsFor). A restart after a death uses the new count.
 */
export const PATIENCE_SECONDS = 300;
export const PATIENCE_MIN_SECONDS = 120;
export const PATIENCE_FULL_ALIVE = 8;
export const PATIENCE_MIN_ALIVE = 3;
/** Locked in the coliseum this long with no death, sudden death starts. */
export const SUDDEN_DEATH_SECONDS = 60;
/** Sudden death burns this share of max hp per second during its first second... */
export const SUDDEN_DEATH_START_FRACTION = 0.02;
/** ...and this much more share per second for every further whole second (a share of max hp, so every hp pool lasts as long). */
export const SUDDEN_DEATH_RAMP_FRACTION = 0.02;
/** Damage is ignored this long after a teleport, so nobody lands on a swing that started before they arrived. */
export const TELEPORT_IMMUNITY_MS = 1500;
/** A player who leaves within this long of being hit by another player counts as that player's kill (kill GV, bounty). */
export const KILL_CREDIT_SECONDS = 5;
/** Teleport spots sit on a ring this far from the map centre until mapgen v2 supplies coliseum spots. */
export const COLISEUM_RING_RADIUS = 5 * TILE;

// Glorious Victory (cosmetics-only currency). Earned GV is kept on death; it banks when the player's run resolves.
export const GV_WIN = 50;
/**
 * Anti alt-farming: the win bonus needs a run that went active with at least this many players, and a winner who
 * damaged at least WIN_BONUS_MIN_OPPONENTS different players. Otherwise the winner still wins, without the bonus.
 */
export const WIN_BONUS_MIN_PLAYERS = 3;
export const WIN_BONUS_MIN_OPPONENTS = 2;
export const GV_KILL = 10;
export const GV_MOB = 2;
export const GV_ELITE = 10;
/** Mob GV (normal and elite together) stops counting past this per run, so farming can't beat winning. */
export const GV_MOB_CAP = 30;

// Feed and bounty (LoL-style shutdown gold): see bountyFor in rules.ts.
/** Feed score per run = player kills + this × mob kills. */
export const FEED_MOB_KILL_WEIGHT = 0.25;
/** Bounty GV = BOUNTY_SCALE × max(0, feed − BOUNTY_FREE_FEED)^BOUNTY_EXPONENT, rounded to whole GV. */
export const BOUNTY_SCALE = 10;
export const BOUNTY_FREE_FEED = 2;
export const BOUNTY_EXPONENT = 1.5;

// Rendering (client only, but kept here so tools/bots agree on the projection)
export const Y_SCALE = 0.8;
