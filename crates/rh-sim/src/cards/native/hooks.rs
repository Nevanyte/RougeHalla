//! P-AUG-NATIVE-1b: the native hook points. Existing systems call [`fire`] as a plain helper at 13 points (no schedule
//! row, no hook-chain link, no RNG draw); it reaches the holder's native slots through the batch tables' handlers
//! (`weapon.rs`, `zone.rs`, `faction.rs`), only under `AugmentRule::Rework` and only for a player holding a native card.
//! The call sites and their events are listed in `docs/backlog/packets/P-AUG-NATIVE-1b.md` section 1.
use crate::cards::CardId;
use crate::state::{PlayerId, World};
use crate::statics::MatchStatic;

/// The kind of a native hook point (one per plan name; the variant names are pinned by the oracle's source scan).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum NativeHook {
    LongRangeHit,
    CreditedKill,
    FistHit,
    MobKill,
    HazardTick,
    WishCast,
    CorpseHarvest,
    BurstLanded,
    ChillInflicted,
    HuntStack,
    Block,
    Overheal,
    HitCount,
}

impl NativeHook {
    /// Every hook point, in the brief's order.
    #[allow(dead_code)] // read by the oracle (hooks_tests.rs) and by the batch tables' handler lookups
    pub(crate) const ALL: [NativeHook; 13] = [
        NativeHook::LongRangeHit,
        NativeHook::CreditedKill,
        NativeHook::FistHit,
        NativeHook::MobKill,
        NativeHook::HazardTick,
        NativeHook::WishCast,
        NativeHook::CorpseHarvest,
        NativeHook::BurstLanded,
        NativeHook::ChillInflicted,
        NativeHook::HuntStack,
        NativeHook::Block,
        NativeHook::Overheal,
        NativeHook::HitCount,
    ];
}

/// One native hook event with its payload. A field no 1b handler reads is there for the batch packets (P-AUG-NATIVE-2..5).
#[allow(dead_code)] // payload fields the batch packets' handlers read
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum NativeEvent {
    /// The holder's projectile landed a hit after flying at least the long-range share of its launch range.
    LongRangeHit,
    /// The holder is the credited killer of a player (`player`) or a mob (`elite` when it was an elite).
    CreditedKill { player: bool, elite: bool },
    /// The holder landed a fist hit.
    FistHit,
    /// The holder is credited with a mob kill of this type (the card's marks decide whether it is the first).
    MobKill {
        mob_type: crate::mob_catalog::MobTypeId,
    },
    /// The holder spent this tick on a zone hazard (0 ember, 1 bog, 2 ice).
    HazardTick { hazard: u8, ms: f64 },
    /// The holder's Wish cast landed. `row_cooldown_ms` is the cooldown of the Wish row the world cast
    /// (`abilities::definition_for`), before training, multipliers and Wish Engine (P-AUG-NATIVE-3b's step reads it).
    WishCast { row_cooldown_ms: f64 },
    /// The holder consumed a plague corpse.
    CorpseHarvest,
    /// The holder's fully charged roaming burst landed.
    BurstLanded,
    /// The holder chilled another fighter for this long.
    ChillInflicted { ms: f64 },
    /// The holder's hunt paid this many stacks.
    HuntStack { stacks: u32 },
    /// The holder's shield blocked this packet (`HookArgs::Blocked`'s `prevented`).
    Block { prevented: crate::state::Packet },
    /// The holder was healed this much beyond its max hp.
    Overheal { amount: f64 },
    /// The holder landed a weapon hit on `victim` for `amount`; `burst` is the stored-block burst the ledger added to
    /// that amount (Bastion; 0 for none).
    HitCount {
        victim: PlayerId,
        amount: f64,
        burst: f64,
    },
}

impl NativeEvent {
    /// The kind of this event.
    pub(crate) fn hook(&self) -> NativeHook {
        match self {
            NativeEvent::LongRangeHit => NativeHook::LongRangeHit,
            NativeEvent::CreditedKill { .. } => NativeHook::CreditedKill,
            NativeEvent::FistHit => NativeHook::FistHit,
            NativeEvent::MobKill { .. } => NativeHook::MobKill,
            NativeEvent::HazardTick { .. } => NativeHook::HazardTick,
            NativeEvent::WishCast { .. } => NativeHook::WishCast,
            NativeEvent::CorpseHarvest => NativeHook::CorpseHarvest,
            NativeEvent::BurstLanded => NativeHook::BurstLanded,
            NativeEvent::ChillInflicted { .. } => NativeHook::ChillInflicted,
            NativeEvent::HuntStack { .. } => NativeHook::HuntStack,
            NativeEvent::Block { .. } => NativeHook::Block,
            NativeEvent::Overheal { .. } => NativeHook::Overheal,
            NativeEvent::HitCount { .. } => NativeHook::HitCount,
        }
    }
}

/// Is `id` a player holding a native card in a `Rework` world? The guard a call site takes before it computes anything
/// for a hook (a long-range distance, a burst): a non-holder pays this check only.
pub(crate) fn holds_native(k: &MatchStatic, w: &World, id: PlayerId) -> bool {
    k.cards.rule() == crate::AugmentRule::Rework
        && w.player(id).is_some_and(|p| !p.build.native.is_empty())
}

/// Fires one native hook event for `holder`: nothing unless the world plays the `Rework` card table and the holder
/// holds a native card; then each held card's handler for this hook runs (the batch tables), in native order.
pub(crate) fn fire(k: &MatchStatic, w: &mut World, holder: PlayerId, event: NativeEvent) {
    if k.cards.rule() != crate::AugmentRule::Rework {
        return;
    }
    fire_held(w, holder, event);
    // P-AUG-NATIVE-2/-4: a counter that is a fold input (Calluses' armor, the Ledger's AD, Stoked's AP) reaches the
    // mirrors at once. Glacier's chill hooks come through `fire_held` (no `MatchStatic`): the same tick's updateMods
    // folds its armor (`faction.rs`).
    if matches!(
        event,
        NativeEvent::FistHit | NativeEvent::CreditedKill { .. } | NativeEvent::BurstLanded
    ) {
        if let Some(i) = w.idx(holder) {
            if super::feeds_fold(&w.players[i].build) {
                crate::modifiers::recompute(k, w, crate::fighter::FighterIx::of_slot(i));
            }
        }
    }
}

/// [`fire`] for the call sites that have no `MatchStatic` (`heal::apply_with`, the Frost chill passes): the holder guard
/// alone. Sound because a world whose table is not `Rework` holds no native card: `check_world` refuses one
/// (`native::check`), `trusted_build::apply` refuses to grant one, and no pool or chest offers one.
pub(crate) fn fire_held(w: &mut World, holder: PlayerId, event: NativeEvent) {
    let Some(i) = w.idx(holder) else { return };
    if w.players[i].build.native.is_empty() {
        return;
    }
    let hook = event.hook();
    #[cfg(test)]
    trace::record(holder, hook);
    let _ = hook;
    for card in CardId::NATIVE {
        if w.players[i]
            .build
            .native
            .slot(card)
            .is_some_and(|s| s.count > 0)
        {
            // Each table answers only its own cards (no card is in two tables: `hooks_tests`).
            super::weapon::handle(w, i, card, &event);
            super::zone::handle(w, i, card, &event);
            super::faction::handle(w, i, card, &event);
        }
    }
}

/// The native chill hook for one tick of attack chill on fighter `victim` (`frost::after_damage`, after it set this
/// tick's chill): every source of a chill below 1 inflicted one tick of it, `tick_ms` (the match's step) of chill.
pub(crate) fn attack_chill(w: &mut World, victim: crate::fighter::FighterIx, tick_ms: f64) {
    if !(w.core(victim).signature.chill < 1.) {
        return;
    }
    for c in 0..w.core(victim).signature.chillers.len() {
        let source = w.core(victim).signature.chillers[c];
        let ms = tick_ms;
        fire_held(w, source, NativeEvent::ChillInflicted { ms });
    }
}

/// Did projectile `id` land its hit from far: after at least `REWORK_MARKSMANS_TALLY_RANGE_SHARE` of its launch range
/// (Plant Your Feet's `range_mult` included)? Read in the ledger, where the flight that hit is still in
/// `World::projectiles` (`settle` retires it) at its contact point (`projectiles::end`). The distance flown is
/// `traveled` (the whole stretches before the hit) or the straight line from the origin to the contact, whichever is
/// longer (a straight flight's last partial stretch is only in the second). A flight not found is not far.
pub(crate) fn long_range(w: &World, projectile: u32) -> bool {
    w.projectiles
        .iter()
        .find(|pr| pr.launch.id == projectile)
        .is_some_and(|pr| {
            let o = pr.launch.origin;
            let flown = pr
                .traveled
                .max(crate::math::hypot(pr.pos.x - o.x, pr.pos.y - o.y));
            flown >= crate::constants::REWORK_MARKSMANS_TALLY_RANGE_SHARE * pr.launch.range
        })
}

/// Test-only record of every dispatch that passed the guard (thread-local: each test thread sees its own sims).
#[cfg(test)]
pub(crate) mod trace {
    use super::NativeHook;
    use crate::state::PlayerId;
    use std::cell::RefCell;

    thread_local! {
        static TRACE: RefCell<Vec<(PlayerId, NativeHook)>> = const { RefCell::new(Vec::new()) };
    }

    pub(crate) fn record(holder: PlayerId, hook: NativeHook) {
        TRACE.with(|t| t.borrow_mut().push((holder, hook)));
    }

    /// Takes (and clears) this thread's record.
    pub(crate) fn take() -> Vec<(PlayerId, NativeHook)> {
        TRACE.with(|t| std::mem::take(&mut *t.borrow_mut()))
    }
}
