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
mod registry;
mod types;
mod wishes;

#[cfg(test)]
mod catalog_tests;
#[cfg(test)]
mod controls_tests;
#[cfg(test)]
mod planning_core_tests;
#[cfg(test)]
mod source_input;
#[cfg(test)]
mod source_reader;
#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod source_trace;
