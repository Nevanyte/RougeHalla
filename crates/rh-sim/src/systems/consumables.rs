//! The consumables system (legacy `updateConsumables`) and the module's hook links: wind emblems first, then the
//! potion Hots, then the boosts that ran out.
use crate::hooks::{HookArgs, Hx};
use crate::schedule::ModContribution;
use crate::state::World;
use crate::systems::{potions, wind, Cx};

pub(crate) fn update(cx: &mut Cx) {
    wind::update(cx);
    potions::update_hots(cx);
    wind::expire(cx);
}

pub(crate) fn raid_started(hx: &mut Hx, args: &HookArgs) {
    wind::raid_started(hx, args);
}

pub(crate) fn fighter_out(hx: &mut Hx, args: &HookArgs) {
    potions::fighter_out(hx, args);
    wind::fighter_out(hx, args);
}

pub(crate) fn speed_source(
    w: &World,
    core: &crate::fighter::FighterCore,
    view: crate::status_runtime::StatView,
) -> Option<ModContribution> {
    wind::speed_source(w, core, view)
}
