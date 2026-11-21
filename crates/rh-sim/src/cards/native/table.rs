//! P-AUG-NATIVE-1a: the 14 native augments' hand-written definitions and caps, in `CardId::NATIVE` order (index 80 + i).
//!
//! Not generated: `tools/card-catalog-fixtures/emit_cards.py` writes only `catalog_data.rs`. Every card is an augment of
//! tier 1 (legacy's default augment tier, `packages/shared/src/cards.ts:248`, and its tier for an id it does not know,
//! `:585-587`), unique and ready, with no rows yet: each batch packet adds its card's rows and, where it uses a counter,
//! meter or mark slot that 1a leaves at cap 0, registers the cap and sets it here. Text is display only (the workbook's
//! Augment_Tuning "Suggested change"). A cap is a registered constant by name or 0 (unused: the value must be 0).
use super::NativeRule;
use crate::cards::{CardDef, CardId, CardKind};
use crate::constants::{
    REWORK_BASTION_METER_CAP, REWORK_CALLUSES_CAP, REWORK_CORPSE_HOARDER_CAP,
    REWORK_EIGHTH_STRIKE_EVERY, REWORK_EXECUTIONERS_LEDGER_CAP, REWORK_GLACIER_CAP,
    REWORK_HAZARD_WALKER_CAP, REWORK_HAZARD_WALKER_IMMUNE_MS, REWORK_MARKED_MAN_CARRY_CAP,
    REWORK_MARKSMANS_TALLY_CAP, REWORK_PATHFINDER_CAP, REWORK_STOKED_CAP, REWORK_TROPHY_HUNTER_CAP,
    REWORK_WISH_ENGINE_CAP,
};

/// One native definition: an augment of tier 1, unique, ready, no base, no rows (its batch packet adds them).
const fn native(id: CardId, title: &'static str, text: &'static str) -> CardDef {
    CardDef {
        id,
        kind: CardKind::Augment,
        tier: 1,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title,
        text,
        tags: &[],
        rows: &[],
        selections: &[],
    }
}

/// The native definitions in `CardId::NATIVE` order.
pub(super) static NATIVE_DEFINITIONS: [CardDef; 14] = [
    native(
        CardId::MarksmansTally,
        "Marksman's Tally",
        "+0.3% damage per hit beyond 80% of max range (cap 30%)",
    ),
    native(
        CardId::Bastion,
        "Bastion",
        "Your next attack deals 35% of your stored blocks",
    ),
    native(
        CardId::Calluses,
        "Calluses",
        "+0.07 armor per fist hit (cap 30)",
    ),
    native(
        CardId::ExecutionersLedger,
        "Executioner's Ledger",
        "+3 AD per player or elite kill (cap 30)",
    ),
    native(
        CardId::EighthStrike,
        "Eighth Strike",
        "Every 8th hit doubles",
    ),
    native(
        CardId::Pathfinder,
        "Pathfinder",
        "+1.2% move speed per new mob type (cap 24%)",
    ),
    native(
        CardId::HazardWalker,
        "Hazard Walker",
        "Hazard seconds grow resistance and HP (cap 15); immunity after 20 s on each hazard",
    ),
    native(
        CardId::WishEngine,
        "Wish Engine",
        "Using your Wish shortens its cooldown, up to -25% (never below the 50% floor)",
    ),
    native(
        CardId::Overflow,
        "Overflow",
        "Overheal becomes a shield that fades over 8 s",
    ),
    native(
        CardId::CorpseHoarder,
        "Corpse Hoarder",
        "+3% max HP per corpse (cap 24%)",
    ),
    native(CardId::Stoked, "Stoked", "+2 AP per landed burst (cap 30)"),
    native(
        CardId::Glacier,
        "Glacier",
        "+0.15 armor per chill second (cap 30)",
    ),
    native(
        CardId::TrophyHunter,
        "Trophy Hunter",
        "+2% damage per hunt stack (cap 15%)",
    ),
    native(
        CardId::MarkedMan,
        "Marked Man",
        "+50% stacks from kills; you are always shown on the minimap",
    ),
];

/// A rule with only a counter cap (every meter and mark unused).
const fn counter(cap: f64) -> NativeRule {
    NativeRule {
        counter_cap: cap,
        meter_caps: [0.; super::NATIVE_METERS],
        marks: 0,
    }
}

/// The bit of every normal (non-elite) mob type, at its position in `MobTypeId::ALL` (Pathfinder's collection).
const fn normal_mob_marks() -> u32 {
    let types = &crate::mob_catalog::DEFINITION.types;
    let all = crate::mob_catalog::MobTypeId::ALL;
    let mut marks = 0u32;
    let mut i = 0;
    while i < types.len() {
        if !types[i].elite {
            let mut j = 0;
            while j < all.len() {
                if all[j] as usize == types[i].id as usize {
                    marks |= 1 << j;
                }
                j += 1;
            }
        }
        i += 1;
    }
    marks
}

/// The native caps in `CardId::NATIVE` order (brief section 1.4). A 0 cap is a slot 1a does not use.
pub(super) static NATIVE_RULES: [NativeRule; 14] = [
    // Marksman's Tally: the damage share earned.
    counter(REWORK_MARKSMANS_TALLY_CAP),
    // Bastion: meters[0] is the stored blocked damage (P-AUG-NATIVE-1b; the workbook says only "Meter cap").
    NativeRule {
        counter_cap: 0.,
        meter_caps: [REWORK_BASTION_METER_CAP, 0., 0.],
        marks: 0,
    },
    // Calluses: armor.
    counter(REWORK_CALLUSES_CAP),
    // Executioner's Ledger: AD.
    counter(REWORK_EXECUTIONERS_LEDGER_CAP),
    // Eighth Strike: hits since the last doubled hit (decision 3).
    counter((REWORK_EIGHTH_STRIKE_EVERY - 1) as f64),
    // Pathfinder: move speed share; one mark per normal mob type met.
    NativeRule {
        counter_cap: REWORK_PATHFINDER_CAP,
        meter_caps: [0.; super::NATIVE_METERS],
        marks: normal_mob_marks(),
    },
    // Hazard Walker: stacks; seconds on ember, bog, ice; one mark per hazard it is immune to.
    NativeRule {
        counter_cap: REWORK_HAZARD_WALKER_CAP,
        meter_caps: [REWORK_HAZARD_WALKER_IMMUNE_MS; super::NATIVE_METERS],
        marks: 0b111,
    },
    // Wish Engine: the cooldown share earned; its three meters are P-AUG-NATIVE-3's per-cast record.
    counter(REWORK_WISH_ENGINE_CAP),
    // Overflow: the shield cap is P-AUG-NATIVE-3's (the workbook says only "Shield cap").
    counter(0.),
    // Corpse Hoarder: max HP share.
    counter(REWORK_CORPSE_HOARDER_CAP),
    // Stoked: AP.
    counter(REWORK_STOKED_CAP),
    // Glacier: armor.
    counter(REWORK_GLACIER_CAP),
    // Trophy Hunter: damage share.
    counter(REWORK_TROPHY_HUNTER_CAP),
    // Marked Man: the half stack a kill carries to the next (P-AUG-NATIVE-5 decision 3; exactly 0 or the cap).
    counter(REWORK_MARKED_MAN_CARRY_CAP),
];
