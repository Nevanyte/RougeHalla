//! The `dropBody` hook link (legacy loot.ts `dropBody`, and the world's default hook it replaces).
//!
//! The first hook link the slice runs through `hooks::fire`: `settle::down_player` fires `Hook::DropBody` where legacy
//! `downPlayer` calls `world.hooks.dropBody`, after the kill credit and before the down is queued for the settle.
//! Touches the downed player's weapon slots only.

use crate::hooks::{HookArgs, Hx};

/// The world's default `dropBody` (legacy createWorld: `p.weapon0 = ""; p.weapon1 = ""`): the downed player's weapon
/// slots empty. Loot's `replace` link drops it in every recorded world, so a dispatch never reaches it.
pub(crate) fn clear_slots(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::DropBody { victim } = *args else {
        return;
    };
    if let Some(i) = hx.w.idx(victim) {
        let p = &mut hx.w.players[i];
        p.weapon.weapon0 = None;
        p.weapon.weapon1 = None;
    }
}

/// Legacy `loot.dropBody`: leaves a body where the player went down holding the weapons and potions they carried, then
/// empties the slots. The slice has no containers, potions or item flow (fists were never carried, `None` in the slots),
/// so the one effect it has state for is emptying the slots; the body is P-COMBAT-4's.
pub(crate) fn drop_body(hx: &mut Hx, args: &HookArgs) {
    clear_slots(hx, args);
}
