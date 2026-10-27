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
/** 96x96 tiles since the roguelike zones (R2): five zones of about 1710 painted tiles each around the fixed coliseum. */
export const MAP_TILES_W = 96;
export const MAP_TILES_H = 96;
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
/**
 * Planning (roguelike R3): the live server's planning phase between the lobby and the run (env PLAN_SECONDS; the sim's
 * own default, SimConfig.planSeconds unset, is 0: no planning). It ends sooner once every connected player is ready.
 */
export const PLAN_SECONDS = 12;
/**
 * The two spawns dealt to a player lie in one walking-distance tier: both within this fraction either side of one shared
 * contour value (walking distance to the coliseum centre, gates open), i.e. the longer walk is at most
 * (1 + t) / (1 - t) times the shorter (shared/planning.ts `sameTier`).
 */
export const PLAN_WALK_TOLERANCE = 0.08;
/** The live server's first patience timer, flat whatever the player count (env FIRST_PATIENCE_SECONDS; decision 10). Timers after a death keep the scaling. */
export const FIRST_PATIENCE_SECONDS = 300;

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

// Wishes and abilities (abilities.ts). The numbers of each Wish live there.
/** A Wish's cooldown: one use per run in practice (flat: nothing shortens it). */
export const WISH_COOLDOWN_SECONDS = 300;
/** A Wish is locked this long after the run starts (SimConfig.wishLockSeconds overrides it, e.g. in the e2e). */
export const WISH_LOCK_SECONDS = 45;
/** A Wish's cooldown in a training room, so it can be practised (a best guess). */
export const TRAINING_WISH_COOLDOWN_SECONDS = 5;
/** A cast's target may be this much farther than its range when the cast is accepted or lands: the client's drawn positions are in the past. */
export const CAST_RANGE_SLACK = 32;
/**
 * A `cast` the server receives this soon after the coliseum teleport is refused, at no cost: the client aimed it at the world as it
 * was before (it had not yet seen the teleport), so it would land from the new spot toward a stale cursor and spend the Wish.
 * About a round trip.
 */
export const CAST_TELEPORT_GRACE_MS = 300;
/** Training dummies (server env DUMMIES=1): no faction (no armor or shield), and back to full hp this long after a hit. */
export const DUMMY_HP = 5000;
export const DUMMY_RESET_SECONDS = 3;

// Buffs and the feed curve (roguelike R4a: per-mob-type buffs, GAME_DESIGN 12). The maths is in buffs.ts.
/** The S-curve's midpoint (stacks) and width: S(x) = sigmoid((x - BUFF_S0) / BUFF_W) - sigmoid(-BUFF_S0 / BUFF_W). */
export const BUFF_S0 = 3;
export const BUFF_W = 1;
/** A buff's quoted numbers are its value at this many stacks (D6): value(n) = quoted x S(n) / S(BUFF_REF_STACKS). */
export const BUFF_REF_STACKS = 3;
/**
 * The most lifesteal `lifesteal` effect rows give a fighter, summed over every row (Acolyte's buff, later relics), any
 * faction. Holy's own lifesteal comes on top, and the total never exceeds LIFESTEAL_MAX.
 */
export const LS_CAP = 0.25;
/** Holy's own cap (factions.ts ls_cap): lifesteal above 100% of the damage stalls Holy against Holy. */
export const LIFESTEAL_MAX = 1;
/**
 * The attack-speed multiplier (the `asMult` mirror) from every source together never exceeds this (League's approach: one
 * cap on the total, slows apply below it). Owner ruling: x1.5, the most at which the real sim still holds all 20 kiting
 * cells against an unbuffed melee counter (harness --kiting-only; Plague > Frost is down to 2% hp there, and attack speed
 * alone first flips a faction counter at x1.65). testing/test_kite.py's model only holds to x1.25 (it fails from x1.3, 6
 * cells at x1.5, and in a tick-alignment dip at x1.08-1.105 the real sim does not show): the owner accepted that the model
 * no longer holds at the cap. Buffs alone never reach it (Plague Rat's plateau is x1.17); it binds once sources stack
 * (R5/R6 passives, skills, relics). testing/TUNING_ROGUE.md.
 */
export const AS_MULT_CAP = 1.5;
/** Mob rewards (GV and buff stacks) are x REWARD_FLOOR + (1 - REWARD_FLOOR) x (1 - sigmoid((feed - REWARD_MID) / REWARD_WIDTH)). */
export const REWARD_FLOOR = 0.3;
export const REWARD_MID = 5;
export const REWARD_WIDTH = 1.5;
/** Anyone with a feed more than CATCHUP_GAP below the lobby median gets mob rewards x CATCHUP_MULT. */
export const CATCHUP_GAP = 2;
export const CATCHUP_MULT = 1.25;
/** Killing a bountied player moves this share of their buff stacks, buff by buff, to the killer. */
export const BOUNTY_STACK_SHARE = 0.5;
/** A rampage announcement for one player goes out at most this often (ms); a rise held back goes out when the window ends. */
export const BOUNTY_ANNOUNCE_MS = 10_000;

// Regional mobs (Phase 11, GAME_DESIGN 11). A mob is its region's faction scaled by MOB_K (an elite by ELITE_K) with the
// region's weapon. MOB_K was 0.45 (a starter finished one normal mob in 24 of 25 pairings), which with R5's camp-wide aggro
// (D24: the first hit wakes the whole camp) left a starter clearing a full camp in 9 of 25 pairings at 3 mobs and 4 at 4.
// Owner ruling "weaker mobs": lowered until at least 20 of 25 clear a full camp of 4, the zone maps' mean (bench/campDuel.ts,
// camp pull, 12 seeds, cleared in every seed: 0.30 clears 11, 0.25 19, 0.24 20, 0.22 21, 0.20 21; at 3 mobs 0.22 clears 23,
// at 5 it clears 14). Left at 0.65, the elite camp (the elite and 3 normals) clears in 9 of 25 pairings, every zone beatable
// by at least one starter: elites may stay harder (the owner's ruling).
export const MOB_K = 0.22;
export const ELITE_K = 0.65;
/**
 * A mob gives up the chase when it leaves its leash, or has not dealt damage for MOB_GIVE_UP_SECONDS (damage it takes does not extend the fight).
 * The leash of a mob of a generated camp is the camp's territory inside MOB_LEASH_CAP (mobs.ts `leashOk`, ROGUELIKE_PLAN D15);
 * this circle around its spot is the leash of a mob with no territory (a wedge or hand-built map, a test's mob).
 */
export const MOB_LEASH_RADIUS = 9 * TILE;
/** The most a territory leash reaches from the mob's spot: min(camp.radius, this). Generated camps measure a radius of 10.8 to 30 tiles (7 of 3000 under 12 over seeds 1-150), so the cap binds on almost all of them, unless the territory's edge comes first. */
export const MOB_LEASH_CAP = 12 * TILE;
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
 * Stacks of its type's buff a mob gives its killer before the reward curve (m = rewardCurve x catch-up). A little over a
 * whole stack, because the curve is at most 0.976: three hungry kills of one camp (3 x 1.1 x ~0.97 = 3.2) then reach the
 * quoted value (3 stacks). An elite gives about the full quoted value on its own (3.1 x ~0.97 = 3.0).
 */
export const MOB_BUFF_STACKS = 1.1;
export const ELITE_BUFF_STACKS = 3.1;

// Camps and their shared chests (roguelike R5, ROGUELIKE_PLAN 3.3, D1-D3, D12, D24). The rules are in shared/rewards.ts
// and server sim/chests.ts.
/** A cleared camp's chest vanishes this long after it drops (D1), never extended; also at the coliseum teleport. */
export const CHEST_SECONDS = 15;
/** A pick needs the picker's server position within this of the chest's centre, with line of sight (D3). */
export const CHEST_RANGE = 96;
/**
 * Client: the chest panel enables picks from the latest SERVER position within CHEST_RANGE minus this (not the predicted
 * position), so a pick it offers is not refused as too far.
 */
export const CHEST_PANEL_SLACK = 8;
/**
 * Client: an open panel stays open until the player is this much farther than it opened at (CHEST_RANGE - CHEST_PANEL_SLACK),
 * so weaving on the edge does not open and close it (and drop a pick in flight). Still inside CHEST_RANGE.
 */
export const CHEST_PANEL_HYSTERESIS = 4;
/** Client: a mouse click on the panel is ignored this long after it opens (a spam-clicking cursor would take a pick unseen). */
export const CHEST_PANEL_CLICK_GUARD_MS = 250;
/** Client: every option greys out this long, plus half the round trip, before `expiresAt` (a later pick would be refused). */
export const CHEST_GREY_MS = 50;
/** A chest offers this many options (D6). */
export const CHEST_OPTIONS = 3;
/** A skip heals this share of max hp when the heal lockout allows it (D12)... */
export const SKIP_HEAL_SHARE = 0.15;
/** ...and pays this much GV when it heals nothing (in combat, or at full hp); it counts against GV_MOB_CAP. */
export const GV_SKIP = 3;
/** D24: damaging one camp member wakes every idle member of that camp (false: each mob wakes on its own damage only). */
export const CAMP_WIDE_AGGRO = true;
/** A heal spread over time (Second Wind) lands in steps this far apart, the first at once. */
export const HEAL_OVER_TIME_STEP_MS = 500;

// Rendering (client only, but kept here so tools/bots agree on the projection)
export const Y_SCALE = 0.8;
