//! P-AUG-NATIVE-1b / -4: the faction batch table: Corpse Hoarder (Plague), Stoked (Fire), Glacier (Frost) and Trophy
//! Hunter (Sentenced), each offered only to a one-faction chest (`Offer::Faction`, plan decision 5). Each card's hook
//! handlers, readout rows, pool membership and the pure reads the stat fold makes of its counter live here.
//!
//! Where each counter reaches the holder (P-AUG-NATIVE-4):
//! - Corpse Hoarder: a flat max hp term of `counter * base hp` (`flat_max_hp`, read by `modifiers::sync_max_hp`); the
//!   handler syncs max hp without healing, as the corpse's own row does (`plague_corpses.rs`).
//! - Stoked: AP, a farm-class fold row (`fold_stats`); `hooks::fire` refolds after a `BurstLanded`.
//! - Glacier: armor, a farm-class fold row (`fold_stats`). Its chill hooks come through `hooks::fire_held` (the Frost
//!   passes have no `MatchStatic`), so no refold runs at the hook: the same tick's `mods.updateMods` row
//!   (`items::fold_armor`, after the damage phase that chilled) folds the new armor for every fighter.
//! - Trophy Hunter: a damage share beside Marksman's Tally (`outgoing_share`).
use super::hooks::NativeEvent;
use super::readout::Source;
use super::NativeCards;
use crate::cards::CardId;
use crate::constants::{
    REWORK_CORPSE_HOARDER_PER, REWORK_GLACIER_PER, REWORK_STOKED_PER, REWORK_TROPHY_HUNTER_PER,
};
use crate::reward_chests::Offer;
use crate::state::World;
use crate::FactionId;

/// The faction batch's chest pool membership and offer rule: each card only to a chest whose eligible pickers are all
/// its faction.
pub(super) static POOL: &[(CardId, Offer)] = &[
    (CardId::CorpseHoarder, Offer::Faction(FactionId::Plague)),
    (CardId::Stoked, Offer::Faction(FactionId::Fire)),
    (CardId::Glacier, Offer::Faction(FactionId::Frost)),
    (CardId::TrophyHunter, Offer::Faction(FactionId::Sentenced)),
];

/// Adds `step` to the card's counter up to its rule's cap; true when the counter moved.
fn add(w: &mut World, i: usize, card: CardId, step: f64) -> bool {
    let cap = super::rule(card).map_or(0., |r| r.counter_cap);
    match w.players[i].build.native.slot_mut(card) {
        Some(s) => {
            let next = cap.min(s.counter + step);
            let moved = next != s.counter;
            s.counter = next;
            moved
        }
        None => false,
    }
}

/// The hook handlers of this table's cards; see `weapon::handle`.
pub(super) fn handle(w: &mut World, i: usize, card: CardId, event: &NativeEvent) {
    match (card, *event) {
        // Corpse Hoarder (Augment_Tuning: +3% max hp per corpse, cap 24%): the max hp follows at once, without a heal.
        (CardId::CorpseHoarder, NativeEvent::CorpseHarvest) => {
            if add(w, i, card, REWORK_CORPSE_HOARDER_PER) {
                let p = &mut w.players[i];
                let hp_before = p.vitals.hp;
                crate::modifiers::sync_max_hp(p);
                p.vitals.hp = hp_before.min(p.vitals.max_hp);
            }
        }
        // Stoked (+2 AP per charged roaming burst, counted when `fire_roam` queues it; cap 30).
        (CardId::Stoked, NativeEvent::BurstLanded) => {
            add(w, i, card, REWORK_STOKED_PER);
        }
        // Glacier (+0.15 armor per chill second, cap 30): every chill the holder inflicts, ranged (1.2 s per hit) and
        // attack chill (one tick per source per tick).
        (CardId::Glacier, NativeEvent::ChillInflicted { ms }) => {
            add(w, i, card, REWORK_GLACIER_PER * ms / 1000.);
        }
        // Trophy Hunter (+2% damage per hunt stack, cap 15%).
        (CardId::TrophyHunter, NativeEvent::HuntStack { stacks }) => {
            add(w, i, card, REWORK_TROPHY_HUNTER_PER * f64::from(stacks));
        }
        _ => {}
    }
}

/// The readout rows of this table's cards (`None` for a card of another table).
pub(super) fn readouts(card: CardId) -> Option<&'static [Source]> {
    match card {
        CardId::CorpseHoarder | CardId::Stoked | CardId::Glacier | CardId::TrophyHunter => {
            Some(&[Source::Counter])
        }
        _ => None,
    }
}

fn counter(native: &NativeCards, card: CardId) -> f64 {
    native
        .slot(card)
        .filter(|s| s.count > 0)
        .map_or(0., |s| s.counter)
}

/// This table's share of the holder's outgoing damage sum: Trophy Hunter's counter.
pub(super) fn outgoing_share(native: &NativeCards) -> f64 {
    counter(native, CardId::TrophyHunter)
}

/// The armor and AP this table's counters add to the holder's stat fold (farm rows: outside the card caps): Glacier's
/// armor and Stoked's AP.
pub(super) fn fold_stats(native: &NativeCards) -> (f64, f64) {
    (
        counter(native, CardId::Glacier),
        counter(native, CardId::Stoked),
    )
}

/// Corpse Hoarder's flat max hp term over a base of `base_hp`.
pub(super) fn flat_max_hp(native: &NativeCards, base_hp: f64) -> f64 {
    base_hp * counter(native, CardId::CorpseHoarder)
}
