//! Source `sim/bruiserPassives.ts»: Frost's Frozen Justice (elite-contact defense) and Holy's Demon Blood camp-clear
//! mirror. The Holy side needs the source camp-clear producer (`campHeal.payCampHeal», P-MOBS-2), so only the Frost guard
//! is installed here; the two update rows and the camp-clear link are `Partial» with P-MOBS-2 as the pending remainder (see
//! the evidence README).
use super::Cx;
use crate::{
    constants::*,
    content::{self, Shape},
    fighter::{FighterCore, FighterIx},
    hooks::{HookArgs, Hx},
    state::{Status, World},
    statics::MatchStatic,
};
use crate::{FactionId, PlayerId, WeaponId};

/// One player's source Frozen Justice state: the private linger clock and the synced `frostEliteGuard» flag.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct FrostGuard {
    /// Source `PlayerState.frostEliteGuard»: the standard defense mirror is folded with the bonus while true.
    pub(crate) active: bool,
    /// Source runtime `frostEliteUntil»: the last elite contact plus the 2 s linger (private).
    pub(crate) until: Option<f64>,
}

/// Source `engageRange» for the weapon in hand (the Frozen Justice lock-reach test).
fn engage_range(weapon: WeaponId) -> f64 {
    match content::weapon(weapon).shape {
        Shape::Arc { reach, .. } => reach + PLAYER_RADIUS,
        Shape::Projectile { range, .. } => range + PLAYER_RADIUS + RANGED_SLACK,
    }
}

/// Source `reachMask»: a melee weapon's sight uses the melee collision mask, a ranged one the sight mask.
fn reach_mask(weapon: WeaponId) -> u8 {
    match content::weapon(weapon).shape {
        Shape::Arc { .. } => MASK_MELEE,
        Shape::Projectile { .. } => MASK_SIGHT,
    }
}

/// Source `lockedElite»: a live Frost seat is locked onto a live hostile elite in the current weapon's reach with line of
/// sight. Quest givers and evading targets do not exist in the admitted domain (source `isEvading» is a stub too).
fn locked_elite(k: &MatchStatic, w: &World, ix: FighterIx) -> bool {
    let p = w.core(ix);
    if p.vitals.faction != FactionId::Frost {
        return false;
    }
    let Some(target) = p.weapon.targeting.target else {
        return false;
    };
    let Some(mob) = w.mobs.get(target) else {
        return false;
    };
    if !mob.elite || mob.status != Status::Alive {
        return false;
    }
    let weapon = p.active_weapon();
    let reach = engage_range(weapon);
    let (from, to) = (p.pos(), mob.core.pos());
    if crate::math::hypot(to.x - from.x, to.y - from.y) > reach {
        return false;
    }
    crate::geometry::has_line_of_sight(
        k.collision_map(w.rt.gates_locked),
        from,
        to,
        reach_mask(weapon),
    )
}

/// Source `noteEliteContact»: a direct contact between a live Frost seat and a real elite starts or refreshes the window.
fn note_elite_contact(w: &mut World, player: PlayerId, other: PlayerId, now: f64) {
    let Some(pi) = w.idx(player) else {
        return;
    };
    if w.players[pi].vitals.faction != FactionId::Frost || w.players[pi].status != Status::Alive {
        return;
    }
    if !w.mobs.get(other).is_some_and(|m| m.elite) {
        return;
    }
    w.players[pi].frost_guard.until = Some(now + FROST_ELITE_GUARD_LINGER_MS);
}

/// Source `setFrostGuard»: a guard change refolds the player's mirrors (the bonus defense applies immediately).
fn set_guard(
    k: &MatchStatic,
    w: &mut World,
    stats: crate::status_runtime::stats::Inputs,
    ix: FighterIx,
    guarded: bool,
) {
    let i = ix.slot();
    if w.players[i].frost_guard.active == guarded {
        return;
    }
    w.players[i].frost_guard.active = guarded;
    crate::modifiers::recompute_with(k, w, ix, stats);
}

/// Source `update»: refresh every Frost seat's guard from its elite lock (and, once P-MOBS-2 lands, the camp-clear mirror).
pub(crate) fn update_all(
    k: &MatchStatic,
    w: &mut World,
    stats: crate::status_runtime::stats::Inputs,
) {
    let now = w.server_time;
    let active = w.phase == crate::Phase::Active;
    for i in 0..w.players.len() {
        let ix = FighterIx::of_slot(i);
        let invalid = !active
            || w.players[i].vitals.faction != FactionId::Frost
            || w.players[i].status != Status::Alive;
        if invalid {
            w.players[i].frost_guard.until = None;
            set_guard(k, w, stats, ix, false);
            continue;
        }
        if locked_elite(k, w, ix) {
            w.players[i].frost_guard.until = Some(now + FROST_ELITE_GUARD_LINGER_MS);
        }
        let guarded = w.players[i]
            .frost_guard
            .until
            .is_some_and(|until| until > now);
        set_guard(k, w, stats, ix, guarded);
    }
}

/// System row (`afterWeapons» and `systems», as the source registers it twice).
pub(crate) fn update(cx: &mut Cx) {
    let Cx { k, w, stats, .. } = cx;
    update_all(k, w, *stats);
}

/// `campCleared» link: the source update also syncs the camp-clear mirror; with that producer pending (P-MOBS-2) the guard
/// refresh is all this world can carry.
pub(crate) fn camp_cleared(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::CampCleared { .. } = args else {
        return;
    };
    update_all(hx.k, hx.w, hx.stats);
}

/// `hitLanded» link: a landed hit in either direction is a direct contact.
pub(crate) fn note_ledger_contact(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::HitLanded { entry, .. } = args else {
        return;
    };
    let now = hx.w.server_time;
    if let Some(by) = entry.by {
        note_elite_contact(hx.w, by, entry.victim, now);
        note_elite_contact(hx.w, entry.victim, by, now);
    }
}

/// `blocked» link: a block in either direction is a direct contact.
pub(crate) fn note_blocked_contact(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::Blocked {
        holder, attacker, ..
    } = args
    else {
        return;
    };
    let now = hx.w.server_time;
    note_elite_contact(hx.w, *holder, *attacker, now);
    note_elite_contact(hx.w, *attacker, *holder, now);
}

/// `fighterOut» link: a departed fighter's guard is cleared at once (the source clears its runtime entry and recomputes).
pub(crate) fn clear_player(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::FighterOut { id, .. } = *args else {
        return;
    };
    let Some(i) = hx.w.idx(id) else {
        return;
    };
    // Source clearPlayer: drop the clock, then setFrostGuard(false) — a refold only when the flag actually changed.
    let was_guarded = hx.w.players[i].frost_guard.active;
    hx.w.players[i].frost_guard = FrostGuard::default();
    if was_guarded {
        crate::modifiers::recompute_with(hx.k, hx.w, FighterIx::of_slot(i), hx.stats);
    }
}

/// `raidStarted»/`runEnded» link: no guard or clock survives the run boundary; every seat is refolded.
pub(crate) fn reset_run(hx: &mut Hx, args: &HookArgs) {
    if !matches!(*args, HookArgs::RaidStarted | HookArgs::RunEnded) {
        return;
    }
    for i in 0..hx.w.players.len() {
        hx.w.players[i].frost_guard = FrostGuard::default();
        crate::modifiers::recompute_with(hx.k, hx.w, FighterIx::of_slot(i), hx.stats);
    }
}

/// Source mod source `frozenJustice»: the standard defense mirror gains the bonus while the guard holds.
pub(crate) fn frozen_justice(
    w: &World,
    core: &FighterCore,
    _stats: crate::schedule::ModSourceInputs,
) -> Option<crate::schedule::ModContribution> {
    let p = w.player(core.id)?;
    if p.vitals.faction != FactionId::Frost || p.status != Status::Alive || !p.frost_guard.active {
        return None;
    }
    Some(crate::schedule::ModContribution {
        armor: Some(FROST_ELITE_GUARD_BONUS),
        shield: Some(FROST_ELITE_GUARD_BONUS),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests;

/// A trusted hit entry for tests of the contact link.
#[cfg(test)]
pub(crate) fn contact_entry(
    victim: PlayerId,
    by: PlayerId,
    weapon: Option<WeaponId>,
) -> crate::systems::ledger::Entry {
    crate::systems::ledger::Entry {
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim,
        by: Some(by),
        packet: crate::state::Packet {
            raw: 10.,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        },
        weapon,
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: false,
        passive: false,
    }
}
