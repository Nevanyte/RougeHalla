//! The human-like bot brain's ported core (docs/BOTS.md; docs/backlog P-BOTS-1): the tier/persona tables, the seeded
//! distributions, the click model, the humanizer that turns intents into the clicks a person would have made, fair
//! perception built only from Observation, and the deterministic policy seat that plays through them.
//!
//! Scope: the hand and the decision cadence are expected to match the frozen source corpus in parity/policy/bot-core.json
//! exactly. The legacy memory, strategy scoring, feature modules and the full perception.ts fair-view constructor are NOT
//! ported here (P-BOTS-1 remainder: perception.ts, memory.ts, strategy.ts, tactics/*, modules/*, mobHunt/chestHunt).
pub mod bot;
pub mod clicks;
pub mod humanizer;
pub mod perception;
pub mod random;
pub mod types;
pub mod wish;

#[cfg(test)]
mod parity_tests;
#[cfg(test)]
mod wish_module_tests;
#[cfg(test)]
mod wish_parity_tests;

pub use bot::{assign_seats, HumanBot};
pub use clicks::{BotMap, MoveClickKind};
pub use humanizer::{Context, Humanizer, HumanizerStats};
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
