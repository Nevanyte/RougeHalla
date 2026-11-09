//! Source `shared/quests.ts` + `server/src/sim/quests.ts`: the K1 quest catalog as typed rows, the run's roster selection,
//! map placement of givers/tokens/parcels (known and hidden passes) and the reward rules/wording.
//!
//! This slice is the quest **data layer**: catalog, roster, placement and rewards, certified against a pinned-container
//! source corpus. The accept action, lifecycle systems (reveal, turn-in, expiry, carriers), quest items/NPC bodies and the
//! public transport are not part of it and are listed in `docs/evidence/stage2-quest-1/README.md`.
pub mod catalog;
pub(crate) mod giver;
#[cfg(test)]
mod giver_tests;
#[cfg(test)]
mod lifecycle_tests;
pub mod live;
#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod notice_tests;
mod notices;
pub mod placement;
pub mod roster;
pub mod rules;
#[cfg(test)]
mod tests;

pub use catalog::{Def, Kind, Tokens};
pub use placement::Placement;
pub use roster::RosterEntry;

/// The source catalog row for an id, if the catalog has it.
pub fn def_by_id(id: &str) -> Option<&'static Def> {
    catalog::by_id(id)
}
