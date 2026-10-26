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
/**
 * The zone stylers (terrain, hazards, props) on the maps the game builds: `buildGameMap` (gameMapBuild.ts) styles a finished
 * wedge map when this is on. Off = every map is exactly generateMap's. Flip only with the client's ice model merged.
 */
export const MAP_STYLERS: boolean = false;
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
 * not backpedal forever; the 9.1 tuning cut the bow to 240 and the wand to 220, and every attack now roots its shooter
 * for a windup (the controls rework: the bow's and the wand's are what holds an orb-walking shooter to the kite check,
 * testing/test_kite.py), so today it only has to stay at or above every projectile's range, and the spawn screens are
 * certified for the full 480. Narrower corridors are not guaranteed: a 24 u gap (PLAYER_RADIUS is 12, so a player fits)
 * measured up to 473 u and a 16 u gap up to about 580 u. The owner deferred those.
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

// Feed and bounty (LoL-style shutdown gold): see feedScore and bountyFor in rules.ts.
/** Feed score per run = player kills + this × mob kills. It sets the mob reward curve and the catch-up; the bounty ignores mobs. */
export const FEED_MOB_KILL_WEIGHT = 0.25;
/** Bounty GV = BOUNTY_SCALE × max(0, player kills − BOUNTY_FREE_KILLS)^BOUNTY_EXPONENT, rounded to whole GV. Mob kills don't count. */
export const BOUNTY_SCALE = 10;
export const BOUNTY_FREE_KILLS = 2;
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
/** A press this long before the cooldown ends still attacks the moment it does, even if released meanwhile. */
export const ATTACK_BUFFER_MS = 150;
/** With no aim input for this long, walking turns a fighter again (a client that stopped aiming, such as a bot). */
export const AIM_STALE_MS = 1000;

// Target lock (the LoL-style controls): a left click locks an enemy; the server walks into range and auto-attacks it.
/**
 * Client: a left click locks the enemy (player or mob) whose drawn feet are nearest the cursor's ground point, within this
 * many world units (two tiles: a forgiving click, so a near miss still locks). Nothing within it: the click does nothing.
 */
export const TARGET_SNAP_RADIUS = 64;
/**
 * Server: a `target` is accepted only within this distance (centre to centre), and a lock is dropped once its target is
 * farther than this (it left for good). Twenty tiles: about half a screen.
 */
export const TARGET_RANGE = 640;
/**
 * A lock whose target, once seen, has been out of line of sight this long is dropped; until then the chase paths around the
 * wall. A target locked behind a wall is chased until it is first seen.
 */
export const TARGET_LOS_GRACE_MS = 1500;
/**
 * A locked fighter re-plans its chase at most this often (the walk to a moving target), and a `target` order may cost a
 * path search at most this often per player (an order out of sight sooner than that is refused).
 */
export const TARGET_REPATH_MS = 250;
/** Training dummies (server env DUMMIES=1): no faction (no armor or shield), and back to full hp this long after a hit. */
export const DUMMY_HP = 5000;
export const DUMMY_RESET_SECONDS = 3;

// Buffs and the feed curve (Phase 11, GAME_DESIGN 12). The maths is in buffs.ts.
/** Largest bonus each stat's S-curve approaches: +70% max hp, +50% attack speed, +30% move speed. */
export const BUFF_BMAX_HP = 0.7;
export const BUFF_BMAX_ATTACK_SPEED = 0.5;
export const BUFF_BMAX_MOVE_SPEED = 0.3;
/** The S-curve's midpoint (stacks) and width: the spike is the 3rd to 5th stack. */
export const BUFF_S0 = 3;
export const BUFF_W = 1;
/** Stacks of one stat that unlock a combo tier (GAME_DESIGN 12.2). */
export const COMBO_TIER1_STACKS = 3;
export const COMBO_TIER2_STACKS = 5;
/** Mob rewards (GV and buff stacks) are x REWARD_FLOOR + (1 - REWARD_FLOOR) x (1 - sigmoid((feed - REWARD_MID) / REWARD_WIDTH)). */
export const REWARD_FLOOR = 0.3;
export const REWARD_MID = 5;
export const REWARD_WIDTH = 1.5;
/** Anyone with a feed more than CATCHUP_GAP below the lobby median gets mob rewards x CATCHUP_MULT. */
export const CATCHUP_GAP = 2;
export const CATCHUP_MULT = 1.25;
/** Killing a bountied player moves this share of their buff stacks, stat by stat, to the killer. */
export const BOUNTY_STACK_SHARE = 0.5;
/** A rampage announcement for one player goes out at most this often (ms); a rise held back goes out when the window ends. */
export const BOUNTY_ANNOUNCE_MS = 10_000;

// Regional mobs (Phase 11, GAME_DESIGN 11). A mob is its region's faction scaled by MOB_K (an elite by ELITE_K) with the
// region's weapon. Measured in the real sim (bench/mobDuel.ts, side-session-notes/phase11-mob-strength-report.md): at 0.45
// a starting player who stands and fights finishes a normal mob in 24 of 25 pairings with about 80% hp left; an elite at 0.65 is
// finished in 23 of 25 with about 58% hp left (at 0.60 it was 24 and 64%, too soft for 10 GV and two stacks).
export const MOB_K = 0.45;
export const ELITE_K = 0.65;
/** A mob gives up the chase when it is this far from its camp, or has not dealt damage for MOB_GIVE_UP_SECONDS (damage it takes does not extend the fight). */
export const MOB_LEASH_RADIUS = 9 * TILE;
export const MOB_GIVE_UP_SECONDS = 6;
/** Back within this of its camp spot, a returning mob is home again. */
export const MOB_HOME_RADIUS = 10;
/** The pace of a mob's regeneration, in seconds from empty to full. A mob walking home is whole on arrival (`rest`); an idle one that is hurt anyway heals at this pace once it has been left alone for 3 s. */
export const MOB_REGEN_SECONDS = 4;
/** A mob re-plans its walk at most this often (ms); each mob's schedule is offset so they don't all path on one tick. */
export const MOB_REPATH_MS = 500;
/** A fighting mob re-aims only when the aim moved more than this (2 degrees): its facing is synced, and a new angle every tick costs bandwidth. */
export const MOB_AIM_DEADBAND = (2 * Math.PI) / 180;
/** A dead mob stays in the state this long (ms) so every client sees it fall. */
export const MOB_CORPSE_MS = 1500;
/**
 * Buff stacks a mob drops before the reward curve; its stat is the region's own with MOB_PRIMARY_BUFF_SHARE, else another.
 * A little over a whole stack, because the curve is at most 0.976: three hungry drops of one stat (3 x 1.1 x ~0.97 = 3.2)
 * then reach the first combo at 3 stacks, where with 1.0 they would stop at 2.91.
 */
export const MOB_BUFF_STACKS = 1.1;
export const ELITE_BUFF_STACKS = 2.2;
export const MOB_PRIMARY_BUFF_SHARE = 0.6;

// Rendering (client only, but kept here so tools/bots agree on the projection)
export const Y_SCALE = 0.8;
