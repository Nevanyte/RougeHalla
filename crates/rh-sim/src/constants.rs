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
    TARGET_RANGE: f64 = 640.0, "u";
    TARGET_REPATH_MS: f64 = 250.0, "ms";
    TARGET_LOS_GRACE_MS: f64 = 1500.0, "ms";
    TARGET_GOAL_MOVED: f64 = 8.0, "u";
    ATTACK_MOVE_ARRIVAL: f64 = 10.0, "u";
    LOCK_CONTACT: f64 = 40.0, "u";
    LOCK_INTERCEPT_EPS: f64 = 1e-9, "quadratic coefficient";
    LOCK_FAR_SHARE: f64 = 0.88, "share of range";
    LOCK_ATTACK_SHARE: f64 = 0.96, "share of range";
    MOB_AIM_DEADBAND: f64 = 2.0 * crate::math::PI / 180.0, "rad";
    VELOCITY_WINDOW_MS: f64 = 100.0, "ms";
    VISION_TRAIL_MS: f64 = 30_000.0, "ms";
    VISION_UPDATE_MS: f64 = 100.0, "ms";
    BUSH_REVEAL_RADIUS: f64 = 64.0, "u";
    BUSH_REVEAL_MS: f64 = 1000.0, "ms";
    MAX_PLAYERS: usize = 8, "seats";
    MAX_ACTIONS_PER_TICK: usize = 6, "commands/tick";
    ATTACK_BUFFER_MS: f64 = 150.0, "ms";
    AIM_STALE_MS: f64 = 1000.0, "ms";
    STAGGER_IMMUNITY_SECONDS: f64 = 1.1, "s";
    INTERACT_RANGE: f64 = 56.0, "u";
    SHIELD_HALF_ARC: f64 = std::f64::consts::PI / 3.0, "rad";
    SHIELD_BLOCK_SHARE: f64 = 0.07, "fraction";
    RIPOSTE_SHARE: f64 = 0.5, "fraction";
    STREAK_GAP_MS: f64 = 3000.0, "ms";
    WISHFUL_BUDGET_MS: f64 = 30_000.0, "ms";
    WISHFUL_WINDOW_MS: f64 = 60_000.0, "ms";
    WISHFUL_FLOOR_SHARE: f64 = 0.5, "share";
    HEAL_OVER_TIME_STEP_MS: f64 = 500.0, "ms";
    OUTGOING_ROW_CAP: f64 = 2.5, "x";
    GAMBLER_CHANCE: f64 = 0.15, "chance";
    GAMBLER_UP: f64 = 2.0, "x";
    GAMBLER_DOWN: f64 = 0.5, "x";
    FESTERING_TICKS: u32 = 4, "ticks";
    FESTERING_TICK_MS: f64 = 1000.0, "ms";
    FESTERING_AP_SHARE: f64 = 0.125, "share";
    HP_RACE_CAP: f64 = 2.5, "x";
    GALLOWS_PATIENCE_EXTRA_MS: f64 = 2000.0, "ms";
    GALLOWS_PATIENCE_STUN_MS: f64 = 2250.0, "ms";
    PLANT_FEET_MS: f64 = 1000.0, "ms";
    PLANT_FEET_BONUS: f64 = 0.25, "share";

    SWORD_ON_HIT_POWER: f64 = 1.5, "x";
    FISTS_ON_HIT_POWER: f64 = 1.2, "x";
    PLAIN_ON_HIT_POWER: f64 = 1.0, "x";
    AXE_SHRED_ARMOR: f64 = 3.0, "armor";
    AXE_SHRED_CAP: f64 = 6.0, "armor";
    AXE_SHRED_MS: f64 = 3000.0, "ms";
    ARROW_RADIUS: f64 = 7.0, "u";
    RANGED_SLACK: f64 = 2.0, "u";
    PROJECTILE_SUBSTEP_MS: f64 = 10.0, "ms";
    HOMING_LIFETIME_MS: f64 = 5000.0, "ms";
    BALL_ARROW_RADIUS: f64 = 28.0, "u";
    BALL_AFTER_ARROW: f64 = 0.6, "factor";
    ARROW_REFLECT_SHARE: f64 = 0.15, "fraction";
    MAX_ARROW_REFLECTIONS: u8 = 2, "reflections";
    SWORD_BALL_SCALE: f64 = 0.5, "factor";
    BALL_SAMPLE_STEP: f64 = 1.0, "u";
    WAND_SPLASH_RADIUS: f64 = 48.0, "u";
    WAND_SPLASH_SHARE: f64 = 0.3, "fraction";
    SWAP_SECONDS: f64 = 0.25, "s";
    MOVE_MULT_FLOOR: f64 = 0.35, "factor";
    /// A cooldown or windup that ends exactly on a tick is due on that tick whatever way float noise falls.
    TIE_EPS_MS: f64 = 1e-6, "ms";
    RANGED_RELEASE_PAUSE_MS: f64 = 200.0, "ms";

    // ---- player engagement and Holy sustain (partial faction foundation) ----
    ENGAGE_LINGER_MS: f64 = 1250.0, "ms";
    ENGAGE_TRADE_SECONDS: f64 = 3.0, "s";
    ENGAGE_TRADE_SLACK_SECONDS: f64 = 0.5, "s";
    TARGET_FORGET_MS: f64 = 10000.0, "ms";
    HEAL_LOCKOUT_MS: f64 = 3000.0, "ms";
    HOLY_LEECH_BASE: f64 = 0.07, "fraction";
    HOLY_LEECH_MISSING: f64 = 0.6, "fraction";
    HOLY_LEECH_CAP: f64 = 0.6, "fraction";

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
    /// The start tile's centre becomes a waypoint when the start is in a wall or farther than this from the centre on
    /// either axis.
    START_CENTER_SLACK: f64 = 0.5, "u";
    PLAGUE_DPS: f64 = 52.0, "damage/s";
    PLAGUE_EXECUTE_DPS: f64 = 325.0, "damage/s";
    PLAGUE_EXECUTE_BAND: f64 = 0.5, "fraction";
    DOT_FX_MS: f64 = 500.0, "ms";
    PVP_DOT_CAP_SHARE: f64 = 0.15, "fraction/s";
    SIG_DISEASED: u8 = 4, "bits";
    SIG_EXECUTE: u8 = 8, "bits";
    FIRE_BURN_DPS: f64 = 28.0, "damage/s";
    FIRE_BACKLASH: f64 = 128.0, "damage/s times foe interval";
    SIG_BURNING: u8 = 2, "bits";
    LANDMARK_GAP: f64 = 3.0, "tiles";

    // Base power-zero player Frost (shared factions/signatures).
    FROST_SLOW: f64 = 0.32, "fraction";
    CHILL_MOVE_RADIUS: f64 = 100., "u";
    CHILL_MOVE_MULT: f64 = 0.7, "multiplier";
    CHILL_MOVE_HOLD_MS: f64 = 1000., "ms";
    CHILL_MOVE_THAW_MS: f64 = 3000., "ms";
    CHILL_MOVE_RESET_MS: f64 = CHILL_MOVE_HOLD_MS + CHILL_MOVE_THAW_MS, "ms";
    FROST_RANGED_CHILL_MS: f64 = 1200., "ms";
    FROST_RANGED_CHILL_MULT: f64 = 0.85, "multiplier";
    FROST_MOVE_QUANTIZATION: f64 = 1000., "steps/multiplier";
    SIG_CHILLED: u8 = 1, "bits";

    // Base power-zero player Sentenced.
    MARK_BASE_PCT: f64 = 0.045, "fraction";
    MARK_KILL_PCT: f64 = 0.00675, "fraction/stack";
    HEAVIER_SENTENCE_PER_BONUS: f64 = 1.5, "x per bonus-hp share";
    MARK_TIER_HITS: f64 = 3.0, "hits";
    MARK_TOP_TIER: u8 = 4, "tier";
    MARK_NEAR_RANGE: f64 = 300.0, "u";
    MARK_FAR_SHARE: f64 = 0.5, "fraction";
    MARK_KILL_STACK_CAP: u8 = 5, "stacks";
    MARK_DENIAL_LINGER_MS: f64 = 2000.0, "ms";
    MARK_TIER_EPS: f64 = 1e-9, "hits";
    MARK_CHILL_FLOOR: f64 = 0.05, "multiplier";
    MARK_EXECUTE_EPS: f64 = 1e-9, "damage";
    MARK_PHYS_SHARE: f64 = 0.4, "fraction";
    MARK_MAGIC_SHARE: f64 = 0.6, "fraction";
    MARK_TRUE_SHARE: f64 = 0.0, "fraction";
    SIG_EXEC_BLOCKED: u8 = 64, "bits";
    // Source regional mob spawn foundation (shared/constants + mobLife birth phase).
    MOB_K: f64 = 0.22, "multiplier";
    ELITE_K: f64 = 0.65, "multiplier";
    MOB_HP_MULT: f64 = 2., "multiplier";
    ELITE_HP_MULT: f64 = 2., "multiplier";
    MOB_REPATH_PHASE_MULT: u32 = 137, "ms/birth";
    MOB_REPATH_PHASE_PERIOD: u32 = 500, "ms";

    // Source NPC weapon/policy and regional combat profile.
    NPC_SWORD_WINDUP: f64 = 0.1, "s";
    NPC_BASH_WINDUP: f64 = 0.1, "s";
    NPC_FISTS_WINDUP: f64 = 0.1, "s";
    NPC_AXE_WINDUP: f64 = 0.25, "s";
    NPC_AXE_WINDUP_SHARE: f64 = 0.25, "share";
    NPC_AXE_ROOT: f64 = 0., "s";
    NPC_AXE_ROOT_SHARE: f64 = 0., "share";
    NPC_BOW_WINDUP: f64 = 0.6, "s";
    NPC_BOW_WINDUP_SHARE: f64 = 0.92, "share";
    NPC_WAND_WINDUP: f64 = 0.4, "s";
    NPC_WAND_WINDUP_SHARE: f64 = 0.8, "share";
    NPC_MELEE_FAR_SHARE: f64 = 0.85, "share";
    NPC_MELEE_EDGE: f64 = 6., "u";
    NPC_BOW_FAR_SHARE: f64 = 400./480., "share";
    NPC_BOW_ATTACK_SHARE: f64 = 0.92, "share";
    NPC_BOW_RETREAT_SHARE: f64 = 220./480., "share";
    NPC_WAND_FAR_SHARE: f64 = 280./420., "share";
    NPC_WAND_ATTACK_SHARE: f64 = 0.8, "share";
    NPC_WAND_RETREAT_SHARE: f64 = 160./420., "share";
    NPC_POLICY_CONTACT: f64 = 40., "u";
    NPC_POLICY_STEP: f64 = 160., "u";
    NPC_RETREAT_TURN1: f64 = 0.7, "rad";
    NPC_RETREAT_TURN2: f64 = 1.4, "rad";
    NPC_RETREAT_TURN3: f64 = 2.1, "rad";
    NPC_INTERCEPT_EPS: f64 = 1e-9, "epsilon";
    MOB_DMG_MULT: f64 = 0.5, "multiplier";
    ELITE_DMG_MULT: f64 = 1.5, "multiplier";
    MOB_MELEE_DMG_MULT: f64 = 1.6, "multiplier";
    MOB_RANGED_DMG_MULT: f64 = 1.2, "multiplier";
    MOB_PLAGUE_DAMAGE: f64 = 0.85, "multiplier";
    MOB_HOLY_DAMAGE: f64 = 0.92, "multiplier";
    MOB_GIVE_UP_SECONDS: f64 = 20., "s";
    MOB_HOME_RADIUS: f64 = 10., "u";
    MOB_LEASH_RADIUS: f64 = 24.*TILE, "u";
    MOB_LEASH_CAP: f64 = 24.*TILE, "u";
    MOB_CORPSE_MS: f64 = 1500., "ms";
    MOB_REGEN_SECONDS: f64 = 4., "s";
    MOB_RETURN_REGEN_SECONDS: f64 = 2., "s";
    MOB_REGEN_LOCK_MS: f64 = 3000., "ms";
    MOB_LEASH_MARGIN: f64 = 24., "u";
    MOB_HEADING_HOME: f64 = 0.5, "u";
    MOB_ON_SPOT: f64 = 0.01, "u";
    MOB_GV_NORMAL:u32=6,"GV";
    MOB_GV_ELITE:u32=30,"GV";
    MOB_FEED_WEIGHT:f64=0.25,"feed/kill";
    MOB_REWARD_FLOOR:f64=0.3,"multiplier";
    MOB_REWARD_MID:f64=5.,"feed";
    MOB_REWARD_WIDTH:f64=1.5,"feed";
    MOB_CATCHUP_GAP:f64=2.,"feed";
    MOB_CATCHUP_MULT:f64=1.25,"multiplier";
    CAMP_WARD_MS:f64=120000.,"ms";
    CAMP_HEAL_RANGE:f64=12.*TILE,"u";
    CAMP_RESPAWN_MS: f64 = 180000., "ms";

    TERRAIN_BURN: f64 = 0.02, "terrain source rule";
    TERRAIN_BOG: f64 = 0.7, "terrain source rule";
    TERRAIN_SLIP_MS: f64 = 400., "terrain source rule";
    TERRAIN_HEAL: f64 = 0.03, "terrain source rule";
    TERRAIN_HOME_HEAL: f64 = 2., "terrain source rule";
    TERRAIN_LIGHT_FX_MS: f64 = 1000., "terrain source rule";
    TERRAIN_LIGHT_FX_MIN: f64 = 0.5, "terrain source rule";
    TERRAIN_REACH: f64 = 4., "terrain source rule";
    TERRAIN_REPLAN_MS: f64 = 250., "terrain source rule";
    TERRAIN_STUCK_REPLANS: f64 = 3., "terrain source rule";
    TERRAIN_STUCK_WINDOW_MS: f64 = 2000., "terrain source rule";
    TERRAIN_GRIP_MS: f64 = 1000., "terrain source rule";
    TERRAIN_ARRIVE_EPS: f64 = 0.5, "terrain source rule";
    TERRAIN_EPS: f64 = 1e-9, "terrain source rule";
    TERRAIN_V_EPS: f64 = 1e-6, "terrain source rule";

    // ---- kill augments (shared/killAugments.ts) ----
    /// Share of the victim bonus a Trophy pick grants.
    KILL_AUG_SHARE: f64 = 0.5, "share";
    /// Options on a Trophy (the source KILL_AUG_OPTIONS).
    KILL_AUG_OPTIONS: u32 = 3, "options";
    /// A Trophy outlives a chest: a killer may still be fighting (source KILL_AUG_SECONDS).
    KILL_AUG_SECONDS: f64 = 30.0, "s";

}
