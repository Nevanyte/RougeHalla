//! P-AUG-NATIVE-1b / -3: the zone and generalist batch table: Pathfinder, Hazard Walker and Overflow (P-AUG-NATIVE-3),
//! Wish Engine (P-AUG-NATIVE-3b), then Marked Man (P-AUG-NATIVE-5). Each card's hook handlers, readout rows, pool
//! membership and the pure reads the tick makes of its state live here. Membership is not read by any pool until
//! P-AUG-NATIVE-4 wires `pool_members`.
use super::hooks::NativeEvent;
use super::readout::Source;
use super::NativeCards;
use crate::cards::CardId;
use crate::constants::{
    REWORK_HAZARD_WALKER_CAP, REWORK_HAZARD_WALKER_HP_PER, REWORK_HAZARD_WALKER_IMMUNE_MS,
    REWORK_HAZARD_WALKER_RESIST_PER, REWORK_HAZARD_WALKER_STACK_MS, REWORK_PATHFINDER_CAP,
    REWORK_PATHFINDER_PER,
};
use crate::reward_chests::Offer;
use crate::state::World;

/// The zone batch's chest pool membership and offer rule (read by no pool yet).
pub(super) static POOL: &[(CardId, Offer)] = &[
    (CardId::Pathfinder, Offer::Any),
    (CardId::HazardWalker, Offer::Any),
    (CardId::Overflow, Offer::Any),
    (CardId::WishEngine, Offer::Any),
    (CardId::MarkedMan, Offer::Any),
];

/// The hook handlers of this table's cards; see `weapon::handle`.
pub(super) fn handle(w: &mut World, i: usize, card: CardId, event: &NativeEvent) {
    match (card, *event) {
        // Pathfinder: the first kill of each normal mob type sets its mark; the counter follows the marks.
        (CardId::Pathfinder, NativeEvent::MobKill { mob_type }) => {
            let Some(bit) = crate::mob_catalog::MobTypeId::ALL
                .iter()
                .position(|t| *t == mob_type)
            else {
                return;
            };
            let allowed = super::rule(card).map_or(0, |r| r.marks);
            if let Some(s) = w.players[i].build.native.slot_mut(card) {
                let m = 1u32 << bit;
                if allowed & m != 0 && s.marks & m == 0 {
                    s.marks |= m;
                    s.counter = REWORK_PATHFINDER_CAP
                        .min(REWORK_PATHFINDER_PER * f64::from(s.marks.count_ones()));
                }
            }
        }
        // Hazard Walker: hazard time fills that hazard's meter (to the immunity cap); stacks follow the total.
        (CardId::HazardWalker, NativeEvent::HazardTick { hazard, ms }) if hazard < 3 => {
            let mut changed = false;
            if let Some(s) = w.players[i].build.native.slot_mut(card) {
                let h = usize::from(hazard);
                s.meters[h] = REWORK_HAZARD_WALKER_IMMUNE_MS.min(s.meters[h] + ms);
                if s.meters[h] >= REWORK_HAZARD_WALKER_IMMUNE_MS {
                    s.marks |= 1 << h;
                }
                let total: f64 = s.meters.iter().sum();
                let stacks =
                    REWORK_HAZARD_WALKER_CAP.min((total / REWORK_HAZARD_WALKER_STACK_MS).floor());
                if stacks != s.counter {
                    s.counter = stacks;
                    changed = true;
                }
            }
            if changed {
                crate::modifiers::sync_max_hp(&mut w.players[i]);
            }
        }
        // Wish Engine: a landed Wish moves the share to the next point of its row's lattice (`WishEngineGrid`: the
        // workbook's step `CAP x row cooldown / CAP_MS`, bit-exact, capped). The next cast spends `1 - share` of the
        // cooldown (`abilities::wish_mult`); this cast already spent at the share before its landing.
        (CardId::WishEngine, NativeEvent::WishCast { row_cooldown_ms }) => {
            let Some(grid) = crate::abilities::WishEngineGrid::of(row_cooldown_ms) else {
                return;
            };
            if let Some(s) = w.players[i].build.native.slot_mut(card) {
                s.counter = grid.next(s.counter);
            }
        }
        // Overflow: the heal's excess beyond max hp becomes a barrier (clamped to the G6 cap by the grant).
        (CardId::Overflow, NativeEvent::Overheal { amount }) => {
            let now = w.server_time;
            crate::systems::buffs::grant_heal_barrier(w, i, amount, now);
        }
        _ => {}
    }
}

/// The readout rows of this table's cards (`None` for a card of another table, or one not filled yet).
pub(super) fn readouts(card: CardId) -> Option<&'static [Source]> {
    match card {
        CardId::Pathfinder => Some(&[Source::Counter, Source::Marks]),
        CardId::HazardWalker => Some(&[
            Source::Counter,
            Source::Meter(0),
            Source::Meter(1),
            Source::Meter(2),
        ]),
        CardId::WishEngine => Some(&[Source::Counter]),
        _ => None,
    }
}

fn held(native: &NativeCards, card: CardId) -> Option<&super::NativeSlot> {
    native.slot(card).filter(|s| s.count > 0)
}

/// Pathfinder's move speed share (0 when not held).
pub(super) fn move_speed_share(native: &NativeCards) -> f64 {
    held(native, CardId::Pathfinder).map_or(0., |s| s.counter)
}

/// Hazard Walker's resistance to `hazard` (0 ember, 1 bog, 2 ice) and whether it is immune to it.
pub(super) fn hazard_guard(native: &NativeCards, hazard: usize) -> (f64, bool) {
    held(native, CardId::HazardWalker).map_or((0., false), |s| {
        (
            REWORK_HAZARD_WALKER_RESIST_PER * s.counter,
            s.marks & (1 << hazard) != 0,
        )
    })
}

/// P-AUG-NATIVE-3c: Hazard Walker's grip on the ice (hazard 2): its slip time shrinks by the resistance (the ice
/// acceleration it meets is the raw one over `1 - resist`), and the ice mark makes it ground (acceleration 0).
pub(super) fn ice_grip(native: &NativeCards) -> super::IceGrip {
    if held(native, CardId::HazardWalker).is_none() {
        return super::IceGrip::Raw;
    }
    match hazard_guard(native, 2) {
        (_, true) => super::IceGrip::Immune,
        (resist, false) => super::IceGrip::Resisted(1. - resist),
    }
}

/// Hazard Walker's flat max hp term over a base of `base_hp`.
pub(super) fn flat_max_hp(native: &NativeCards, base_hp: f64) -> f64 {
    held(native, CardId::HazardWalker)
        .map_or(0., |s| base_hp * REWORK_HAZARD_WALKER_HP_PER * s.counter)
}

/// Wish Engine's earned share of the Wish cooldown (0 when not held).
pub(super) fn wish_engine_share(native: &NativeCards) -> f64 {
    held(native, CardId::WishEngine).map_or(0., |s| s.counter)
}

/// Overflow is held: the holder's barriers fade over `REWORK_OVERFLOW_FADE_MS`.
pub(super) fn holds_overflow(native: &NativeCards) -> bool {
    held(native, CardId::Overflow).is_some()
}

/// Marked Man's normal-kill grant (P-AUG-NATIVE-5 decision 2): `(amount, Some(carry))` for a holder, where
/// `e = kill_stacks x (MULT - 1) + counter` splits into the whole stacks paid now (`kill_stacks + floor(e)`) and the
/// carry `e - floor(e)` (exact in f64: 0 or 0.5); `(kill_stacks, None)` for a non-holder.
pub(super) fn marked_man_stacks(native: &NativeCards, kill_stacks: u64) -> (u64, Option<f64>) {
    held(native, CardId::MarkedMan).map_or((kill_stacks, None), |s| {
        let e =
            kill_stacks as f64 * (crate::constants::REWORK_MARKED_MAN_STACK_MULT - 1.) + s.counter;
        let whole = e.floor();
        (kill_stacks + whole as u64, Some(e - whole))
    })
}

/// Marked Man is held (its `Alive` holder is on every minimap).
pub(super) fn holds_marked_man(native: &NativeCards) -> bool {
    held(native, CardId::MarkedMan).is_some()
}
