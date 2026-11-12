//! Complete private source feature modules (P-BOT-MODULES-1). New-file lease only.
//!
//! `brain/modules/{wishes,planning,chests,hazards}.ts`, the genuinely missing chest dependencies
//! (`chestHunt.ts`, `abilityPolicy.ts`, `bots/chests.ts`) and the ordered registry (`brain/modules/index.ts`),
//! ported against the frozen `rh-bot-private-modules-source/1` witness. No public Bot/Brain activation, no World
//! read, no hidden chest content, no fabricated actor identity and no authoritative movement/combat rule.
#![allow(dead_code)] // Private seam: inactive until the separately reviewed private Brain composer drives it.

mod chest_hunt;
mod chests;
mod choice;
mod hazards;
mod planning;
pub(super) mod registry;
pub(super) mod types;
mod wishes;

// P-BOT-BRAIN-NATIVE-1 final interface lease: the private Brain composer imports the four actual builtin structs and
// the caller-owned ordered registry/types/context surface from this facade. Their children/engines stay private and no
// new module engine is registered.
pub(super) use chests::ChestsModule;
pub(super) use hazards::HazardsModule;
pub(super) use planning::PlanningModule;
pub(super) use registry::Registry;
pub(super) use wishes::WishesModule;

// Live loot seat lease (fix-bot-loot): the live HumanBot's chest pick/walk executor reuses the two parity-captured leaves
// as they are (source `chooseOption` and the `ChestHunter` class), never the private module engine or Brain composer.
pub(crate) mod live_chests {
    pub(crate) use super::chest_hunt::{ChestDecision, ChestHunter, ChestInput, CHEST_HUNT};
    pub(crate) use super::choice::choose_option;
    pub(crate) use super::types::{CardCounts, ChestSelf, HuntChest, HuntSelf};
}

#[cfg(test)]
mod catalog_tests;
#[cfg(test)]
mod controls_tests;
#[cfg(test)]
mod planning_core_tests;
#[cfg(test)]
mod source_input;
#[cfg(test)]
pub(super) mod source_reader;
#[cfg(test)]
mod source_tests;
#[cfg(test)]
pub(super) mod source_trace;
// One selected pure helper for the new Brain intake: the existing strict raw JSON parse (duplicate decoded keys,
// depth bound, no trailing bytes). The component-specific typed reader itself stays private.
#[cfg(test)]
pub(super) use source_input::parse_raw;
