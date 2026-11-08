//! The human-like bot brain's ported core (docs/BOTS.md; docs/backlog P-BOTS-1): the tier/persona tables, the seeded
//! distributions, the click model, the humanizer that turns intents into the clicks a person would have made, fair
//! perception built only from Observation, and the deterministic policy seat that plays through them.
//!
//! Scope: the hand and the decision cadence are expected to match the frozen source corpus in parity/policy/bot-core.json
//! exactly. The legacy memory, strategy scoring, feature modules and the full perception.ts fair-view constructor are NOT
//! ported here (P-BOTS-1 remainder: perception.ts, memory.ts, strategy.ts, tactics/*, modules/*, mobHunt/chestHunt).
pub mod bot;
pub mod build_route;
pub mod clicks;
pub mod humanizer;
pub mod kite;
pub mod learning;
pub mod mob_hunt;
pub mod paths;
pub mod perception;
pub mod random;
pub mod types;
pub mod wish;

#[cfg(test)]
mod mob_hunt_parity_tests;
#[cfg(test)]
mod parity_tests;
#[cfg(test)]
mod paths_parity_tests;
#[cfg(test)]
mod wish_module_tests;
#[cfg(test)]
mod wish_parity_tests;

pub use bot::{assign_seats, HumanBot};
pub use build_route::{
    build_of, camp_value, ready_for_elites, type_weight, BuildGoal, FarmStat, RouteCamp,
    BUILD_GOALS, ELITE_AFTER_MS, ELITE_EARLY_POWER, ELITE_MIN_KILLS, ELITE_VALUE, STAT_FLOOR,
};
pub use clicks::{BotMap, MoveClickKind};
pub use humanizer::{Context, Humanizer, HumanizerStats};
pub use kite::{away_point, LENGTHS as KITE_LENGTHS, TURNS as KITE_TURNS};
pub use mob_hunt::{
    best_edge, best_slot_vs_mob, hunt_config_for, is_ranged, mob_weapon, retreat_point, useless,
    wants_mobs, weapon_edge, HuntDecision, MobHuntConfig, MobLike, MOB_HUNT, NO_MOB_IN_REACH,
};
pub use paths::{PathBudget, PathStats, RoomPathService, WalkAnswer, BOT_PATH_BUDGET_PER_TICK};
pub use perception::Perception;
pub use random::Rng;
pub use types::{
    BotWeapon, Command, CommandType, ExGaussian, Intent, IntentBody, IntentChannel, IntentKind,
    IntentTiming, PerceptExtras, PersonaId, PersonaParams, Stimulus, StimulusKind, TierId,
    TierParams, TimedCommand, WishView, PERSONAS, TIERS,
};
pub use wish::{
    CastChoice, CastSituation, FoeView, MeView, ThreatView, WishDef, WishFoe, WishModule, WISHES,
    WISH_RULES,
};
