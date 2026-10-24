// Network
export const ROOM_NAME = "raid";
/**
 * The same room class with its mode forced to "training" by the server's handler options (a client can't choose the mode:
 * Colyseus merges the handler's options over the client's). Private rooms of one: see sim/training.ts.
 */
export const TRAINING_ROOM_NAME = "training";
/** A training room whose player sends nothing for this long is closed, so an abandoned tab can't hold a room forever. */
export const TRAINING_IDLE_SECONDS = 300;
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
/** A projectile's own radius: it hits a body whose centre comes within PLAYER_RADIUS + this of its path. */
export const RANGED_SLACK = 2;
/**
 * A projectile hits a player whose centre comes within this of its path; mapgen's spawn screens use it. Arrows and
 * balls both use exactly this, so a spawn pair that passes the screen can't be hit from spawn.
 */
export const RANGED_HIT_REACH = PLAYER_RADIUS + RANGED_SLACK;
export const PLAYER_SPEED = 170;
/** Picking up a weapon (F) reaches containers whose centre is this close, with line of sight. */
export const INTERACT_RANGE = 56;
export const WEAPON_SLOTS = 2;
/**
 * Anti-kiting: with the coliseum gates open, mapgen guarantees that every straight strip SIGHT_CORRIDOR_WIDTH (one
 * tile) wide, at any angle and offset, runs at most MAX_SIGHT_CORRIDOR through open floor. Open floor includes every
 * region, the gates-closed coliseum and lines through the gates. The cap was the bow's range (480) so an archer could
 * not backpedal forever; the 9.1 tuning cut the bow to 240 and the wand to 220 (and nearly rooted them while they
 * shoot), so today it only has to stay at or above every projectile's range, and the spawn screens are certified for
 * the full 480. Narrower corridors are not guaranteed: a 24 u gap (PLAYER_RADIUS is 12, so a player fits) measured up
 * to 473 u and a 16 u gap up to about 580 u. The owner deferred those.
 */
export const MAX_SIGHT_CORRIDOR = 480;
export const SIGHT_CORRIDOR_WIDTH = 32;

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
/** Teleported players are spread around a ring this far from the coliseum centre (see coliseumSpots). */
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

// Combat (Phase 9). Weapon numbers and the faction x weapon formula live in weapons.ts; the rules between weapons
// (blocks, reflections, interceptions, stagger) in interactions.ts.
/** Duel pace k: every faction damage number is multiplied by k (Sentenced's mark ramp by k squared), hp is not. */
export const DUEL_PACE = 2;
/** Projectiles fly in present server time and are swept in steps this long, so a fast arrow can't skip a body. */
export const PROJECTILE_SUBSTEP_MS = 10;
/** A wand ball deletes an enemy arrow whose centre comes within this of the ball's. */
export const BALL_ARROW_RADIUS = 28;
/** A raised shield covers hits arriving within this angle either side of where it faces (60 degrees). */
export const SHIELD_HALF_ARC = Math.PI / 3;
/** A frontal sword hit on a raised shield is negated, and this share of it is dealt back to the swordsman. */
export const RIPOSTE_SHARE = 0.5;
/**
 * An arrow is reflected at most this many times; the next shield front just blocks it. Two shields face to face at
 * contact range would otherwise bounce one forever (each reflection starts inside the other's reach).
 */
export const MAX_ARROW_REFLECTIONS = 2;
/** A sword swing that meets an enemy wand ball scales that ball's damage by this (once per ball). */
export const SWORD_BALL_SCALE = 0.5;
/** After a stagger the target can't be staggered again for this long. */
export const STAGGER_IMMUNITY_SECONDS = 0.5;
/** Swapping weapons cancels the current action and adds this to the shared attack cooldown. */
export const SWAP_SECONDS = 0.25;
/**
 * Move speed multipliers: drawing a bow, a wand's cast slow, and after any ranged attack until the cooldown ends. They are
 * nearly a root on purpose (9.1 tuning): a shooter that backs away while it fires gets only a few percent more free fire
 * than one that stands, so the design's standing-shooter check (testing/realtime.py, `kite`) holds in the real sim.
 */
export const BOW_DRAW_MOVE = 0.1;
export const WAND_CAST_MOVE = 0.1;
export const RANGED_RECOVERY_MOVE = 0.1;
/** A press this long before the cooldown ends still attacks the moment it does, even if released meanwhile. */
export const ATTACK_BUFFER_MS = 150;
/** With no aim input for this long, walking turns a fighter again (a client that stopped aiming, such as a bot). */
export const AIM_STALE_MS = 1000;
/** Training dummies (server env DUMMIES=1): no faction (no armor or shield), and back to full hp this long after a hit. */
export const DUMMY_HP = 5000;
export const DUMMY_RESET_SECONDS = 3;

// Rendering (client only, but kept here so tools/bots agree on the projection)
export const Y_SCALE = 0.8;
