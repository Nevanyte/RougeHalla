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
    CARD_FIGHT_GAP_MS: f64 = 3000.0, "ms";
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
    /// Holy player's lifesteal per camp cleared (legacy `HOLY_CAMP_LIFESTEAL_PER_CLEAR`); outside `LS_CAP` and `LIFESTEAL_MAX`.
    HOLY_CAMP_LIFESTEAL_PER_CLEAR: f64 = 0.005, "fraction";

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

    // Fire roam (shared/fireRoam.ts).
    FIRE_ROAM_RAMP_MS: f64 = 20_000.0, "ms";
    FIRE_ROAM_MAX_SPEED_MULT: f64 = 1.5, "multiplier";
    FIRE_ROAM_CHARGE_MAX: f64 = 1_000.0, "charge units";
    FIRE_ROAM_BURST_BASE: f64 = 50.0, "damage";
    FIRE_ROAM_BURST_AD_SHARE: f64 = 0.4, "damage per bonus Offense";

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
    // Frost Frozen Justice (shared/constants + sim/bruiserPassives.ts).
    FROST_ELITE_GUARD_BONUS: f64 = 25.0, "armor and magic resist";
    FROST_ELITE_GUARD_LINGER_MS: f64 = 2_000.0, "ms";

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
    MARK_TAX_THRESHOLD: f64 = 1.0, "attacks/s";
    MARK_TAX_KEEP: f64 = 1.0, "fraction";
    MARK_TAX_RATE_CAP: f64 = 99.0, "attacks/s";
    SIG_TAXED: u8 = 16, "bits";
    MARK_PHYS_SHARE: f64 = 0.4, "fraction";
    MARK_MAGIC_SHARE: f64 = 0.6, "fraction";
    MARK_TRUE_SHARE: f64 = 0.0, "fraction";
    SIG_EXEC_BLOCKED: u8 = 64, "bits";

    // Base power-zero player Sentenced hunt (shared/sentencedHunt).
    SENTENCED_HUNT_MOVE_BONUS: f64 = 0.05, "multiplier";
    SENTENCED_HUNT_TOWARD_DOT: f64 = 0.3, "dot";
    SENTENCED_HUNT_MARK_PER_STACK: f64 = 0.02, "fraction/stack";

    // Base power-zero Plague corpse harvest and owned zombie (shared/plagueCorpses).
    PLAGUE_CORPSE_AUTO_RANGE: f64 = 24.0, "u";
    PLAGUE_CORPSE_INTERACT_RANGE: f64 = 24.0, "u";
    PLAGUE_CORPSE_HP_SHARE: f64 = 0.03, "fraction";
    PLAGUE_CORPSE_HEAL_SHARE: f64 = 0.03, "fraction";
    PLAGUE_ZOMBIE_HP_SHARE: f64 = 0.08, "fraction";
    PLAGUE_ZOMBIE_HP_PER_BONUS: f64 = 0.8, "fraction/bonus hp";
    PLAGUE_ZOMBIE_HIT_SHARE: f64 = 0.003, "fraction";
    PLAGUE_ZOMBIE_HIT_PER_BONUS: f64 = 0.025, "fraction/bonus hp";
    PLAGUE_ZOMBIE_REGEN_SHARE_PER_SECOND: f64 = 0.05, "fraction/s";
    PLAGUE_ZOMBIE_REGEN_COMBAT_FACTOR: f64 = 0.25, "multiplier";
    PLAGUE_ZOMBIE_REGEN_QUIET_MS: f64 = 4000.0, "ms";
    PLAGUE_ZOMBIE_REGEN_STEP_MS: f64 = 500.0, "ms";
    PLAGUE_ZOMBIE_GROWTH_PER_BODY: f64 = 0.1, "multiplier/body";
    PLAGUE_ZOMBIE_INTERVAL_MS: f64 = 1000.0, "ms";
    PLAGUE_ZOMBIE_WINDUP_MS: f64 = 200.0, "ms";
    PLAGUE_ZOMBIE_ASSIST_MS: f64 = 5000.0, "ms";
    PLAGUE_ZOMBIE_ASSIST_RANGE: f64 = 640.0, "u";
    PLAGUE_ZOMBIE_FOLLOW_DISTANCE: f64 = 48.0, "u";
    PLAGUE_ZOMBIE_AD_SHARE: f64 = 0.15, "fraction";
    PLAGUE_ZOMBIE_HIT_CAP_SHARE: f64 = 0.03, "fraction";
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

    // ---- passive player regeneration (regen.ts) ----
    /// Max hp a standing player regains per second with no hit dealt or taken for PLAYER_REGEN_QUIET_MS.
    PLAYER_REGEN_SHARE_OUT: f64 = 0.008, "fraction/s";
    /// The same per second while the player is in a fight.
    PLAYER_REGEN_SHARE_IN: f64 = 0.0025, "fraction/s";
    PLAYER_REGEN_QUIET_MS: f64 = 3000.0, "ms";
    // ---- K1 quests (shared/quests.ts, shared/constants.ts) ----
    QUEST_COUNT: u32 = 20, "offers";
    QUEST_KNOWN_COUNT: u32 = 10, "offers";
    QUEST_REVEAL_RADIUS: f64 = 12. * TILE, "u";
    QUEST_REVEAL_HEAD_START_MS: f64 = 4000., "ms";
    QUEST_TURN_IN_RANGE: f64 = 64., "u";
    QUEST_ACCEPT_RANGE: f64 = 64., "u";
    QUEST_NPC_SPAWN_MIN_TILES: u32 = 8, "tiles";
    QUEST_NPC_GAP_TILES: u32 = 7, "tiles";
    QUEST_FETCH_MIN_TILES: u32 = 36, "tiles";
    QUEST_MAX_CARRIED: u32 = 1, "items";
    QUEST_GV_CAP: u32 = 50, "GV";
    FARM_SECONDS_PER_MOB: f64 = 12., "s";
    CAMP_SECONDS: f64 = 4. * FARM_SECONDS_PER_MOB, "s";
    CARD_TIER_RATE: f64 = 1.35, "tier/camp";
    FARM_GV_RATE: f64 = 2. / FARM_SECONDS_PER_MOB, "GV/s";
    TRAVEL_RATE_SHARE: f64 = 0.4, "share";
    STACK_PREMIUM: f64 = 1.15, "multiplier";
    QUEST_FEED_BRAKE: f64 = 0.65, "curve";
    QUEST_MIN_STAT_STACKS: u32 = 10, "stacks";
    QUEST_MAX_STAT_STACKS: u32 = 20, "stacks";
    QUEST_STAT_STACKS_PER_FARM_EQUIVALENT: f64 = 2.5, "stacks";
    CLOSED_QUEST_LINGER_MS: f64 = 20000., "ms";
    QUEST_SPOT_OVERSAMPLE: u32 = 4, "spots";

    // ---- neutral traders (shared/traders.ts, server/src/sim/traders.ts) ----
    TRADER_RANGE: f64 = 112., "u";
    TRADER_SPEED: f64 = 42., "u/s";
    TRADER_STOP_MS: f64 = 8000., "ms";
    TRADER_BARTER_COOLDOWN_MS: f64 = 5000., "ms";
    TRADER_DEST_STEP_TILES: u32 = 4, "tiles";
    TRADER_DEST_EDGE_TILES: u32 = 2, "tiles";
    TRADER_PATH_RADIUS: f64 = 12., "u";
    TRADER_GOAL_COUNT: u32 = 8, "goals";
    TRADER_GOAL_MIN_TILES: u32 = 3, "tiles";
    TRADE_OFFER_COUNT: u32 = 3, "offers";
    TRADE_COST_SHARE: f64 = 0.12, "share";
    TRADE_GAIN_SHARE: f64 = 0.18, "share";
    TRADE_GAIN_FLAT_FLOOR: f64 = 60., "stat";
    TRADE_COST_MIN_FLAT: f64 = 1., "stat";
    TRADE_COST_MIN_PCT: f64 = 0.3, "stat";
    TRADE_AP_DIVISOR_FLOOR: f64 = 0.1, "multiplier";
    TRADE_FLAT_SCALE: f64 = 10., "1/step";
    TRADE_PCT_SCALE: f64 = 1000., "1/step";
    QUEST_HIDDEN_MIN_SPOTS_PER_OFFER: u32 = 2, "spots";
    // Training rooms and the practice console (P-ARENA-2; legacy packages/shared/src/constants.ts and training.ts).
    DUMMY_HP: f64 = 5000., "hp";
    DUMMY_RESET_SECONDS: f64 = 3., "s";
    TRAINING_MIN_TILES: f64 = 3., "tiles";
    TRAINING_MAX_TILES: f64 = 6., "tiles";
    TRAIN_DEFAULT_CARD_COUNT: u32 = 1, "cards";
    TRAIN_MAX_CARD_COUNT: u32 = 9, "cards";
    TRAIN_MAX_MOB_STAT_COUNT: f64 = 9_007_199_254_740_991., "stacks";
    TRAIN_MAX_MOBS: u32 = 12, "mobs";
    TRAIN_MAX_MOBS_SPAWNED: u32 = 150, "mobs";
    TRAIN_MAX_CHESTS: u32 = 6, "chests";
    TRAIN_SPAWN_GAP_MS: f64 = 300., "ms";
    TRAIN_CAMP_SIZE: u32 = 3, "mobs";
    TRAIN_CAMP_MIN_TILES: f64 = 5., "tiles";
    TRAIN_CAMP_MAX_TILES: f64 = 9., "tiles";
    TRAIN_CAMP_TARGET_TILES: f64 = 7., "tiles";
    TRAIN_CAMP_SPREAD_TILES: f64 = 2., "tiles";
    TRAIN_CHEST_MIN_TILES: f64 = 1.5, "tiles";
    TRAIN_CHEST_MAX_TILES: f64 = 3., "tiles";
    TRAIN_CHEST_TARGET_TILES: f64 = 2., "tiles";
    PRACTICE_CAMP_FIRST: u32 = 101, "camp ref";
    PRACTICE_CAMP_LAST: u32 = 255, "camp ref";
    CANNON_COOLDOWN_MS: f64 = 75_000., "ms";

    // ---- wind emblems (consumables.ts updateWindEmblems) ----
    WIND_SPAWN_MIN_MS: f64 = 8000.0, "ms";
    WIND_SPAWN_MAX_MS: f64 = 15000.0, "ms";
    WIND_EMBLEM_LIMIT: usize = 12, "emblems";
    WIND_PICKUP_RADIUS: f64 = 30.0, "u";
    /// Minimum spacing between emblems, in tiles.
    WIND_EMBLEM_SPACING: f64 = 3.0, "tiles";
    /// The private wind stream is mulberry32(orderSalt ^ this), as source.
    WIND_SEED_XOR: u32 = 0x6a2c_581f, "seed xor";
    SPEED_BOOST_MS: f64 = 5000.0, "ms";
    SPEED_BOOST_MULT: f64 = 1.5, "multiplier";

    // ---- G6 barrier (shared/constants.ts BARRIER_MAX_SHARE / BARRIER_DECAY_SHARE_PER_SECOND) ----
    /// G6: the most barrier a grant may leave on a fighter, as a share of its then-current max hp.
    BARRIER_MAX_SHARE: f64 = 0.25, "fraction of max hp";
    /// G6: a heal-made barrier loses this share of max hp every second.
    BARRIER_DECAY_SHARE_PER_SECOND: f64 = 0.05, "fraction of max hp/s";

    /// Source Overkill fires only for excess damage strictly above this threshold.
    OVERKILL_EPS: f64 = 1e-9, "damage";

    // Source walkHint.ts: presentation-only bounds, independent of authoritative movement.
    WALK_HINT_MAX_TICKS: u8 = 3, "ticks";
    WALK_DIR_HYSTERESIS: u8 = 3, "byte-directions";
    WALK_HINT_SPEED_SLACK: f64 = 1.01, "multiplier";
    WALK_HINT_ICE_PROBE_U: f64 = 8.0, "u";
    WALK_HINT_SEGMENT_EPS_U: f64 = 1e-3, "u";
    WALK_HINT_WAYPOINT_SLACK_U: f64 = 1e-6, "u";

    // ---- mob spacing (ADR0024 addendum "Mob spacing", owner 2026-11-10; HitboxMode::Archetypes only, systems/mob_spacing.rs) ----
    /// Added to a mob's foot-box half-extent to make its personal-space radius: with the shared 10 x 6 foot box, two mobs
    /// keep 40 u centre to centre, one foot-box width of ground between their foot boxes.
    MOB_SPACING_MARGIN: f64 = 10.0, "u";
    /// The longest step one think may order (about two ticks of walking).
    MOB_SPACING_STEP_MAX: f64 = 16.0, "u";
    /// A shorter step is not ordered: the pack counts as settled (no jitter).
    MOB_SPACING_STEP_MIN: f64 = 1.0, "u";
    /// A step stays this far inside the policy's stop band round the target, so it never wakes a chase or a retreat.
    MOB_SPACING_BAND_SLACK: f64 = 8.0, "u";
    /// The neighbour index's cell (the sum order of a step's push depends on it); at least the widest pair of rooms.
    MOB_SPACING_CELL: f64 = 2. * TILE, "u";
    /// A mob that stays put looks for a spacing step on one tick in this many (staggered by id): a crowd with no room
    /// left re-weighs its candidates a quarter as often. At most 150 ms of delay before a step.
    MOB_SPACING_LOOK_TICKS: u32 = 4, "ticks";

    // ---- camp buffs (unreleased legacy a7b5c4ce shared/constants.ts:593-614, mob_catalog/camp_buffs.rs; only under
    // SimConfig::camp_buffs = Themed, P-CAMP-BUFF-THEMES-1) ----
    /// The repair's first aim: from every camp, the nearest camp of each buff within this (or the camp's ninth-nearest
    /// camp distance, itself included, where that is farther).
    CAMP_BUFF_MAX_DISTANCE_TILES: f64 = 65., "tiles";
    /// The draw's theme factor of a buff outside the camp's zone's four (its own four weigh 1).
    CAMP_BUFF_OFF_THEME_WEIGHT: f64 = 0.15, "multiplier";
    /// The draw's need factor: 1 + (d / REF)^2, d the distance to the nearest camp already given the buff, capped at CAP.
    CAMP_BUFF_NEED_REF_TILES: f64 = 30., "tiles";
    CAMP_BUFF_NEED_CAP_TILES: f64 = 90., "tiles";
    /// The draw's balance factor: (even share / (camps given the buff so far + 1))^POWER, a loop of multiplications.
    CAMP_BUFF_BALANCE_POWER: u32 = 2, "exponent";
    /// At most this many repair moves after the draw.
    CAMP_BUFF_REPAIR_STEPS: u32 = 160, "moves";

    // ---- Frost Wall (unreleased legacy 78dd8bd4; P-FROST-WALL-1/1b, registered in P-FROST-WALL-2a). Read only under
    // SimConfig::frost_wish = Wall (default Freeze). Re-exported from abilities/mod.rs and barriers.rs. ----
    /// The farthest a wall's centre may be placed from the caster (`shared/src/abilities.ts` `FROST_WALL_RANGE`).
    FROST_WALL_RANGE: f64 = 450., "u";
    /// An aim point closer than this is pushed out to it (`FROST_WALL_MIN_RANGE`).
    FROST_WALL_MIN_RANGE: f64 = 64., "u";
    /// The wall's length, end to end: seven tiles (`FROST_WALL_LENGTH`).
    FROST_WALL_LENGTH: f64 = 224., "u";
    /// How long a wall stands (`FROST_WALL_MS`).
    FROST_WALL_MS: f64 = 4000., "ms";
    /// The cast time (`FROST_WALL_CAST_MS`).
    FROST_WALL_CAST_MS: f64 = 250., "ms";
    /// The cooldown (`shared/src/constants.ts` `FROST_WALL_COOLDOWN_SECONDS` 45).
    FROST_WALL_COOLDOWN_MS: f64 = 45000., "ms";
    /// A tile is under a wall when its centre is this close to the wall's line (`shared/src/barriers.ts`
    /// `WALL_CELL_REACH`): one tile thick along an axis, a closed staircase on a diagonal.
    WALL_CELL_REACH: f64 = TILE * 0.75, "u";
    /// A tile past a wall's end is under it only within this much (`WALL_END_SLACK`).
    WALL_END_SLACK: f64 = TILE / 4., "u";
    /// The rising wall's push-out searches outward in steps of this (`server/src/sim/abilities.ts:532`
    /// `WALL_PUSH_STEP`, module-local in legacy).
    WALL_PUSH_STEP: f64 = 4., "u";
    /// ... up to this far from the wall's line (`:533` `WALL_PUSH_MAX`, module-local).
    WALL_PUSH_MAX: f64 = 96., "u";
    /// A fighter with no room on either side keeps a gap: every wall tile whose centre is within this of it on both
    /// axes leaves the wall (legacy `raiseWall` `:585` `PLAYER_RADIUS + 32`, unnamed in legacy).
    WALL_GAP_REACH: f64 = PLAYER_RADIUS + 32., "u";
}
