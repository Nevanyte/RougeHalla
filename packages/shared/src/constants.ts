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
/**
 * Clients render this far behind the estimated server clock (two ticks): the delay a client starts with and the one the harness
 * and the bots assume a player sees. The client then adapts it to its network between the two bounds below (shared/interp.ts RenderClock).
 */
export const INTERP_DELAY_MS = 100;
export const MIN_INTERP_DELAY_MS = 70;
export const MAX_INTERP_DELAY_MS = 150;
/**
 * How far back the server rewinds targets to match what an attacker saw (lag compensation).
 * Covers INTERP_DELAY_MS + RTT + one tick for clients up to ~150 ms RTT.
 */
export const MAX_REWIND_MS = 300;
/** A per-tick jump larger than this is treated as a teleport and not interpolated. */
export const TELEPORT_DISTANCE = 200;

// World
export const TILE = 32;
/**
 * 136x136 tiles since the zone shapes (zone-shapes contract 0.1.1; 96x96 in R2): five zones of about 3534 painted tiles each around
 * the fixed coliseum. Even, so the coliseum centre CX = W / 2 stays a tile corner and the pillar shift CX - 32 an integer.
 */
export const MAP_TILES_W = 136;
export const MAP_TILES_H = 136;
export const WORLD_W = MAP_TILES_W * TILE;
export const WORLD_H = MAP_TILES_H * TILE;
/**
 * The zone stylers (terrain, hazards, props) on the maps the game builds: the generator's hook (styler.ts) runs the five
 * zone stylers while this is on, and none when it is off (plain zones with their landmarks, for tests and what-if runs). It is a
 * compile-time switch: the server, the bots and every client must be built with the same value, and the map's `mapHash`
 * is what tells them apart.
 */
export const MAP_STYLERS: boolean = true;
export const PLAYER_RADIUS = 12;
/** A projectile's own radius: it hits a body whose centre comes within PLAYER_RADIUS + this of its path. */
export const RANGED_SLACK = 2;
/** A projectile hits a player whose centre comes within this of its path. Arrows and balls both use exactly this. */
export const RANGED_HIT_REACH = PLAYER_RADIUS + RANGED_SLACK;
export const PLAYER_SPEED = 170;
/** Player and owned camp ward sight, in ground-plane world units. */
export const VISION_RADIUS = 900;
/** A tile seen by a player continues to reveal live activity for two minutes after its last refresh. */
export const VISION_TRAIL_MS = 120_000;
/** Full camps return three minutes after their last member dies. The clearing player's ward ends at this deadline. */
export const CAMP_RESPAWN_MS = 180_000;
/** Tile sight scans are bounded to ten per second per source; exact current sight remains available between scans. */
export const VISION_UPDATE_MS = 100;
/** Picking up a weapon (F) reaches containers whose centre is this close, with line of sight. */
export const INTERACT_RANGE = 56;
export const WEAPON_SLOTS = 2;

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

// Power and the PvP factor (balance pass, BALANCE_CONTRACT 3.4 / 4.6). Every player-to-player ledger entry (a weapon hit, a
// signature's damage; not a Wish, not the arena, never a mob) is multiplied by pvpFactor(P), P the attacker's card power
// (cards.ts cardPower): f(P) = PVP_F0 + (PVP_FMAX - PVP_F0) x (1 - exp(-P / PVP_P0)). Mark pulses use the same factor;
// the real-sim benches check equal-power outcomes and pace. A fed player kills a fresh one many times sooner.
// f(0) 0.77, f(1) 1.11, f(2) 1.40, f(3) 1.65, f(5) 2.03, f(6) 2.18, f(10) 2.58, f(15) 2.82.
export const PVP_F0 = 0.77;
export const PVP_FMAX = 3.0;
export const PVP_P0 = 6;
/** G2: no single player-to-player hit (not a damage-over-time tick) takes more than this share of the victim's max hp. */
export const PVP_HIT_CAP_SHARE = 0.35;
/** G3: one source's damage over time on one player takes at most this share of the victim's max hp per second. */
export const PVP_DOT_CAP_SHARE = 0.15;
/** G4: A Race to 0 multiplies the damage its holder deals and takes by 1 / hp fraction, but never by more than this. */
export const HP_RACE_CAP = 2.5;

// The card engine's caps (balance pass, BALANCE_CONTRACT 3.2 / 3.3 / 4.6: guards G1 and G5-G13). Every number a stack of cards
// could otherwise push without bound is one of these; shared/mods.ts folds with them and sim/mods.ts reads them.
/** G1: the damage rows an entry carries (1 + the damage sum, with its `vs` and `scale` rows) times the `hit`, `dot` or `returned` mult of its kind never pass this. */
export const OUTGOING_ROW_CAP = 2.5;
/** G6: a barrier (Second Skin) never holds more than this share of max hp... */
export const BARRIER_MAX_SHARE = 0.25;
/** ...and loses this share of max hp every second. */
export const BARRIER_DECAY_SHARE_PER_SECOND = 0.05;
/** G7: bonus armor and bonus magic resist (cards, conversions, sources together) stop here. */
export const BONUS_DEFENSE_CAP = 200;
/** G8: max hp never falls below this share of the faction's (Glass Cannon's -25% is the card that asks for less). */
export const MAX_HP_FLOOR_SHARE = 0.5;
/** G10: the move-speed bonus of the rows (cards, conversions) stops here (+30%); a slow below it is untouched. */
export const MOVE_BONUS_CAP = 0.3;
/** G11: the AD and the AP that conversions give (Spellsword, Big Brain, Arcane Tempo...) are each at most this, a conversion never feeding another. */
export const CONVERT_AD_AP_CAP = 60;
/** G12: critical strike chance stops here, and a critical strike deals this multiple of the hit. */
export const CRIT_CHANCE_MAX = 0.5;
export const CRIT_MULT = 1.5;
/** G9: the `asPost` mults (Boom x0.5, Machine Gun x2) multiply AFTER the attack-speed cap and are held to this range, so attack speed ends at 0.5 to 3.0 of base. */
export const AS_POST_MIN = 0.5;
export const AS_POST_MAX = 2;
/** G13: Wishes are flat; the only card that moves their cooldown (Arcane Overload x2) is a `wishCooldown` mult, and none takes it under this share. */
export const WISH_COOLDOWN_MULT_MIN = 0.5;
/** 3.3: every running damage-over-time signature (burn, disease, the mark) adds this much of the owner's AP as magic damage per second. */
export const AP_DOT_RATIO = 0.6;
/** A fighter is "in a fight" (the `fightTime` condition) from its first landed or taken hit until this long passes with none. */
export const FIGHT_GAP_SECONDS = 3;

// The phase-B cards' hooks (balance pass, BALANCE_CONTRACT 4.4 / 4.6, agent A4): the numbers a card's text states live in its rows
// (cards.ts); these are the rules around them.
/** A crit accumulator fires when it reaches 1 (minus this, so three adds of 1/3 are a crit despite float error). */
export const CRIT_EPSILON = 1e-9;
/** Streaks (Tunnel Vision, First Impressions, Third Time's the Charm): the memory of "the same target" ends after this long without a hit on it. */
export const STREAK_GAP_SECONDS = FIGHT_GAP_SECONDS;
/** Plant Your Feet: standing still this long arms the next attack, which then has this much more range and damage. */
export const PLANT_FEET_MS = 1000;
export const PLANT_FEET_BONUS = 0.25;
/** Wishful Thinking (G13): at most this much cooldown is shaved in any window of this length, and the cooldown never drops under this share of itself. */
export const WISHFUL_BUDGET_MS = 30_000;
export const WISHFUL_WINDOW_MS = 60_000;
export const WISHFUL_FLOOR_SHARE = 0.5;
/** Festering Arcana: this many extra ticks, one every FESTERING_TICK_MS, each FESTERING_AP_SHARE of the owner's AP as magic damage. */
export const FESTERING_TICKS = 4;
export const FESTERING_TICK_MS = 1000;
export const FESTERING_AP_SHARE = 1 / 8;
/** Gambler: a hit has this chance to deal double (and the same chance to deal half) damage. */
export const GAMBLER_CHANCE = 0.15;
export const GAMBLER_UP = 2;
export const GAMBLER_DOWN = 0.5;
/** Overkill: the damage beyond a kill splashes onto the nearest enemy within this many units of the victim. */
export const OVERKILL_RADIUS = 200;
/** G8: Tank Engine gives at most this much max health in all. */
export const TANK_ENGINE_CAP = 250;

// Weapon specials (BALANCE_CONTRACT 3.3). The axe shreds armor, the wand splashes, the sword's and fists' on-hit effects hit harder.
/**
 * Axe: each hit takes this much armor off its target for AXE_SHRED_MS, stacking up to AXE_SHRED_CAP (the target's armor never goes
 * below 0). A re-applied stack refreshes whole, so a slow axe keeps its full stack going: the CAP is the shred a fight actually
 * sees. Small on purpose (acceptance pass, testing/TUNING_BALANCE.md): the shred is flat armor, so it is worth most against the
 * factions with the least of it (at 8 up to 24 it strips all of Frost's 20 armor, +20% physical damage, and Frost > Holy of the
 * axe-only faction set and the weapon harness's Sword > Axe Frost column flipped, as they do at any cap of 9 or more);
 * 3 up to 6 keeps both (the dense probe of that cell holds 100%) and leaves the axe its status without a faction edge.
 */
export const AXE_SHRED_ARMOR = 3;
export const AXE_SHRED_MS = 3000;
export const AXE_SHRED_CAP = 6;
/** Wand: the ball's impact also hits every other enemy within this many units for this share of the ball's damage. */
export const WAND_SPLASH_SHARE = 0.3;
export const WAND_SPLASH_RADIUS = 48;
/** On-hit power: how hard a weapon makes the on-hit effects of its hits (a bleed, a slow, a shred) land. 1 for every other weapon. */
export const SWORD_ON_HIT_POWER = 1.5;
export const FISTS_ON_HIT_POWER = 1.2;

// Combat (Phase 9). Weapon numbers and the faction x weapon formula live in weapons.ts; the rules between weapons
// (blocks, reflections, interceptions, stagger) in interactions.ts.
/** Duel pace k: every faction damage number is multiplied by k (Sentenced's mark share included), hp is not. */
export const DUEL_PACE = 2;

// The mark (docs/SENTENCED_REDESIGN.md). Sentenced marks the enemy it hits: every landed hit adds a share of that enemy's max hp as
// true damage, and the mark climbs four tiers by hits landed (or by the target's weapon swaps). The faction's own numbers (the share,
// the tax, the suppression) are `FactionSpec.params`; these are the rules around them.
/** Hits landed on the marked target per tier: tier 2 at this many, tier 3 at twice, tier 4 at three times (1 + floor(hits / this)). */
export const MARK_TIER_HITS = 3;
export const MARK_TOP_TIER = 4;
/** Beyond this (centre to centre) the pulse halves and the attack-speed tax lifts; inside the owner's Trial ring they never do. */
export const MARK_NEAR_RANGE = 300;
export const MARK_FAR_SHARE = 0.5;
/** The tax only touches an attack rate above this (attacks a second); the taxed rate is never above `tax_cap`. */
export const MARK_TAX_THRESHOLD = 1.0;
/** Kill-stacks: most a run's Sentenced can hold. */
export const MARK_KILL_STACK_CAP = 5;
/** A denied execute makes the tier-4 amplifier last this long after the mark ends. */
export const MARK_DENIAL_LINGER_MS = 2000;
/** Heavier Sentence: the pulse's share grows by this x the fighter's bonus max hp over its faction's (bonus hp / base hp). */
export const HEAVIER_SENTENCE_PER_BONUS = 1.5;
/** Gallows' Patience: the zone Wish lasts this much longer, and its escape stun is this long. */
export const GALLOWS_PATIENCE_EXTRA_MS = 2000;
export const GALLOWS_PATIENCE_STUN_MS = 1500;
/** Projectiles fly in present server time and are swept in steps this long, so a fast arrow can't skip a body. */
export const PROJECTILE_SUBSTEP_MS = 10;
/** A wand ball deletes an enemy arrow whose centre comes within this of the ball's. */
export const BALL_ARROW_RADIUS = 28;
/**
 * A ball that deletes an enemy arrow keeps this share of its damage (balance pass, BALANCE_CONTRACT 5.5): the wand's
 * "answer to the bow" costs it some of the ball, so Wand > Bow is a win and not a wall. Acceptance pass (A7, pooled over the 25
 * faction pairs, minute 0 / minute 5): 0.7 gave 74 / 83 (the cards favour the wand against the bow), 0.6 gives 70 / 77, 0.5 65 / 70.
 * The floor is the signature-weapon set (Holy's wand against Sentenced's bow, Plague's bow against Holy's wand), which this one
 * number pulls two ways: at 0.5 Holy > Sentenced is lost (36%) at minute 0, at 0.6 it is 43% and Plague > Holy 73%, and at minute 5
 * the two are 60% and 48%. At 0.4 the true mark kept going while the wand's balls were spent on arrows and Holy > Sentenced was
 * lost outright. Provisional.
 */
export const BALL_AFTER_ARROW = 0.6;
/** A raised shield covers hits arriving within this angle either side of where it faces (60 degrees). */
export const SHIELD_HALF_ARC = Math.PI / 3;
/**
 * A frontal sword or bash hit on a raised shield is blocked only in part (balance pass, BALANCE_CONTRACT 5.5): this share of
 * it is stopped, the rest (1 - this) goes through as a normal hit with no stagger (a blocked hit never staggers, which is what
 * keeps the shield's edge over the sword). It ends the shield's "never hurt" matchups and the shield-mirror stalemate (two shields
 * used to block every bash). Tuned against the weapon-edge target (A7, testing/TUNING_BALANCE.md): the contract's first value was
 * 0.35 (Shield > Sword 80% pooled at minute 0, and the shield-only faction set lost Holy > Fire and Holy > Sentenced outright:
 * every share of a hit a shield stops is taken off the hit-only factions' damage and not off the damage-over-time factions').
 * At 0.10 Shield > Sword is 64% at minute 0 and 80% at minute 5 (the armor cards of a shield's kit make it a wall against a
 * sword); 0.07 gives 60% / 64% and every edge of the shield-only set still holds (hp left 11-36%). Provisional.
 */
export const SHIELD_BLOCK_SHARE = 0.07;
/** The riposte: this share of the BLOCKED part of a sword hit (SHIELD_BLOCK_SHARE of it) is dealt back to the swordsman. */
export const RIPOSTE_SHARE = 0.5;
/**
 * An arrow that meets a raised shield is reflected carrying only this share of its damage; the holder takes the rest
 * (1 - this) as a normal hit (balance pass, BALANCE_CONTRACT 5.5; 0.35 in the contract, 0.25 after the first A7 sweep, 0.15 after
 * the acceptance pass: Shield > Bow 73 / 87 -> 56 / 74 pooled at minute 0 / minute 5, where the shield's armor cards double as a wall
 * against arrows). Provisional.
 */
export const ARROW_REFLECT_SHARE = 0.15;
/**
 * An arrow is reflected at most this many times; the next shield front just blocks it. Two shields face to face at
 * contact range would otherwise bounce one forever (each reflection starts inside the other's reach).
 */
export const MAX_ARROW_REFLECTIONS = 2;
/** A sword swing that meets an enemy wand ball scales that ball's damage by this (once per ball). */
export const SWORD_BALL_SCALE = 0.5;
/**
 * After a stagger the target can't be staggered again for this long (0.5 s until the balance pass: a sword could lock down
 * a slow wand or axe; at 1.2 s Sword > Wand falls 85% -> 71% and Sword > Axe 71% -> 60% pooled). The acceptance pass found
 * the edge a step and not a slope: at 1.2 s the sword's cards leave Sword > Axe under its floor at minute 5 (45%), at 1.0 s
 * Sword > Wand jumps from 71% to 81% at minute 0; 1.1 s keeps Sword > Wand at 71 / 74 and Sword > Axe at 60 / 55 (with the
 * scalings of weapons.ts). Provisional.
 */
export const STAGGER_IMMUNITY_SECONDS = 1.1;
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

// The feed curve (GAME_DESIGN 12): the mob reward curve and catch-up scale a mob's GV and a quest's card tier. Fixed mob-stat
// progression is handled independently in mobStats.ts and never scales with feed.
/**
 * The most lifesteal `lifesteal` effect rows give a fighter, summed over every row (Leech cards, later relics), any
 * faction. Holy's own lifesteal comes on top, and the total never exceeds LIFESTEAL_MAX.
 */
export const LS_CAP = 0.25;
/**
 * G5: the whole lifesteal share (Holy's own plus the rows, `lifestealMult` and `lifestealDot` included) stops here (was 1, Holy's
 * own cap: lifesteal above 100% of the damage stalls Holy against Holy). The rows alone are held to LS_CAP before Bloodthirst's x2.
 */
export const LIFESTEAL_MAX = 0.85;
/**
 * The attack-speed multiplier (the `asMult` mirror) from every source together never exceeds this (League's approach: one
 * cap on the total, slows apply below it). Owner ruling: x1.5, the most at which the real sim still holds all 20 kiting
 * cells against an unbuffed melee counter (harness --kiting-only; Plague > Frost is down to 2% hp there, and attack speed
 * alone first flips a faction counter at x1.65). testing/test_kite.py's model only holds to x1.25 (it fails from x1.3, 6
 * cells at x1.5, and in a tick-alignment dip at x1.08-1.105 the real sim does not show): the owner accepted that the model
 * no longer holds at the cap. Card rows reach it only by stacking several Haste cards; it binds once sources stack
 * (cards, skills, relics). testing/TUNING_ROGUE.md. The balance pass's `asPost` mults (Here Comes the Boom x0.5,
 * Machine Gun x2) multiply AFTER this cap (AS_POST_MIN..AS_POST_MAX), so the mirror ends between 0.5 and 3.0.
 */
export const AS_MULT_CAP = 1.5;
/** Mob rewards (GV; a quest's card tier) are x REWARD_FLOOR + (1 - REWARD_FLOOR) x (1 - sigmoid((feed - REWARD_MID) / REWARD_WIDTH)). */
export const REWARD_FLOOR = 0.3;
export const REWARD_MID = 5;
export const REWARD_WIDTH = 1.5;
/** Anyone with a feed more than CATCHUP_GAP below the lobby median gets mob rewards x CATCHUP_MULT. */
export const CATCHUP_GAP = 2;
export const CATCHUP_MULT = 1.25;
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
 * this circle around its spot is the leash of a mob with no territory (a hand-built map, a test's mob).
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
/**
 * The tier odds of a chest's cards in percent, T1 / T2 / T3 (BALANCE_CONTRACT 4.8): the base card and the augment of a normal camp's
 * chest, and both of an elite camp's. A conditional is always tier 2.
 */
export const CHEST_TIER_ODDS = {
  normal: { base: [70, 25, 5], augment: [50, 45, 5] },
  elite: { base: [10, 60, 30], augment: [10, 60, 30] },
} as const;
/** The chance that a chest's second card is a conditional (when a picker owns the base of one it could offer); else it is a second base card. */
export const CHEST_CONDITIONAL_CHANCE = 0.5;
/** A skip heals this share of max hp when the heal lockout allows it (D12)... */
export const SKIP_HEAL_SHARE = 0.15;
/** ...and pays this much GV when it heals nothing (in combat, or at full hp); it counts against GV_MOB_CAP. */
export const GV_SKIP = 3;
/** D24: damaging one camp member wakes every idle member of that camp (false: each mob wakes on its own damage only). */
export const CAMP_WIDE_AGGRO = true;
/**
 * Camp-clear heal (balance contract 7, shared/rules.ts `campHealAmount`): everyone who damaged a camp and stands when its last
 * mob dies is healed `missing x f(m)`, m = the share of max hp missing, f(m) = LO + (HI - LO) x sigmoid((m - MID) / WIDTH). A
 * scratched player gets a little back (95% hp: +1.4% of max), one ganked low nearly all of it (10% hp: +85%); everyone leaves a
 * camp at 83-96%.
 */
export const CAMP_HEAL_LO = 0.25;
export const CAMP_HEAL_HI = 0.95;
export const CAMP_HEAL_MID = 0.40;
export const CAMP_HEAL_WIDTH = 0.10;
/** A player counts for a camp's clear heal inside its territory or within this of its centre. */
export const CAMP_HEAL_RANGE = 12 * TILE;
/** A heal spread over time (Second Wind) lands in steps this far apart, the first at once. */
export const HEAL_OVER_TIME_STEP_MS = 500;
/**
 * Swift Boots (R5, owner ruling "No boost while shooting"): its move-speed bonus is off from the moment a bow or wand attack
 * starts until this long after the shot leaves, so the boots help walking, chasing and melee but never buy a shooter the walk
 * back between shots (the ranged windups are the anti-kiting lever). 2.5 s because Frost's chill stretches a chilled shooter's
 * cooldown 2.5x: Fire's wand then idles 2.1 s between shots, and a shorter pause lets the boots back in that gap (at rank 2 a
 * 1.0 s pause leaves Frost > Fire's wand cell at 44% against 68% without the boots, testing/TUNING_ROGUE.md 7.5).
 */
export const SWIFT_BOOTS_PAUSE_MS = 2500;

// Rendering (client only, but kept here so tools/bots agree on the projection)
export const Y_SCALE = 0.8;

// Quests (GAME_DESIGN 2.2, shared/quests.ts): optional NPC quests that pull a player across the map.
/** Quests offered per run. */
export const QUEST_COUNT = 10;
/** Of those, this many (and their giver's position) are public from the start, so a run can be planned around them. */
export const QUEST_KNOWN_COUNT = 5;
/** The rest stay server-only until scouted; only this numeric count is public. */
export const QUEST_UNKNOWN_COUNT = QUEST_COUNT - QUEST_KNOWN_COUNT;
/** A standing player this close to an unknown quest's giver discovers it. */
export const QUEST_REVEAL_RADIUS = 12 * TILE;
/** The finder gets a private reveal this long before the quest enters synced state for everyone. */
export const QUEST_REVEAL_HEAD_START_MS = 4000;
/** Turn-in reach: standing this close to the giver with the objective met completes the quest (INTERACT_RANGE is for loot). */
export const QUEST_TURN_IN_RANGE = 64;
/** Talk reach: standing this close to a giver (with a clear line) lets a player accept its offer (F, then `questAccept`). The turn-in's own radius. */
export const QUEST_ACCEPT_RANGE = QUEST_TURN_IN_RANGE;
/** A giver never spawns closer than this to a player start. */
export const QUEST_NPC_SPAWN_MIN_TILES = 8;
/** Givers keep at least this far apart (relaxed to half when a map runs out of room). */
export const QUEST_NPC_GAP_TILES = 7;
/** A fetch quest's parcel lies at least this many tiles from its giver (Chebyshev), when the map has room. */
export const QUEST_FETCH_MIN_TILES = 36;
/** Item def prefix of quest tokens and parcels: loot.ts hands any of these to the quests module. */
export const QUEST_ITEM_PREFIX = "quest:";
/** Parcels one player may carry at once. */
export const QUEST_MAX_CARRIED = 1;
/** Separate from mob and bounty GV; supports roughly four or five completions instead of exhausting after two or three. */
export const QUEST_GV_CAP = 40;
