//! The Wish cooldown levers the restore envelope (`abilities/checkpoint.rs`, `wish_cooldowns`) is built on; moved out of
//! `checkpoint.rs` by P-AUG-NATIVE-3b's stub so the envelope's file stays the implementer's.
use crate::cards::{CardId, CardRow, Tuning};
use crate::stat_fold::{EffectKind, MultKey};

/// `wish_cooldowns` (the restore's envelope of a spend's cooldown) holds while exactly one card, unique, carries a
/// `WishCooldown` row and that row only lengthens, in both tables: a build that only grows then had either no
/// multiplier or today's at every cast. A second lever, or one that shortens, needs a new envelope here.
#[test]
fn one_unique_card_only_lengthens_the_wish_cooldown_in_both_tables() {
    for augments in [crate::AugmentRule::Legacy, crate::AugmentRule::Rework] {
        let t = Tuning::of(&crate::SimConfig {
            augments,
            ..crate::SimConfig::default()
        });
        let mut levers = Vec::new();
        for id in CardId::ALL {
            let def = t.def(id);
            for row in def
                .rows
                .iter()
                .chain(def.selections.iter().flat_map(|s| s.rows.iter()))
            {
                if let CardRow::Fold(EffectKind::Mult {
                    key: MultKey::WishCooldown,
                    v,
                }) = row
                {
                    assert!(
                        *v >= 1.,
                        "{augments:?} {id:?}: a Wish cooldown factor below 1"
                    );
                    levers.push(id);
                }
            }
        }
        assert_eq!(levers, [CardId::ArcaneOverload], "{augments:?}");
        assert!(t.def(CardId::ArcaneOverload).unique);
    }
}

/// P-AUG-NATIVE-3b (oracle-amend): the second lever. Wish Engine, a native card with no fold row, shortens the Wish
/// cooldown by its share (`cards::native::wish_engine_share`), at most `REWORK_WISH_ENGINE_CAP`, which keeps the
/// combined multiplier above the G13 floor (`WISH_MULT_MIN`); no other native card moves it; and every (lever, share)
/// pair a Rework world can spend gives a distinct cooldown, for every faction and both Frost rows, so the restore reads
/// the pair off the stored spend (`abilities/checkpoint.rs`): no per-cast field, no format bump.
#[test]
fn wish_engine_is_the_one_native_lever_and_a_spend_names_its_lever_and_share() {
    use crate::cards::native::{rule, wish_engine_share};
    use crate::constants::{
        REWORK_ARCANE_OVERLOAD_WISH_COOLDOWN, REWORK_WISH_ENGINE_CAP, REWORK_WISH_ENGINE_CAP_MS,
    };
    let cap = REWORK_WISH_ENGINE_CAP;
    assert_eq!(wish_engine_share(&crate::cards::Build::default()), 0.);
    for id in CardId::NATIVE {
        let mut b = crate::cards::Build::default();
        b.set(id, 1);
        let r = rule(id).unwrap();
        let s = b.native.slot_mut(id).unwrap();
        s.counter = r.counter_cap;
        s.meters = r.meter_caps;
        s.marks = r.marks;
        let want = if id == CardId::WishEngine { cap } else { 0. };
        assert_eq!(wish_engine_share(&b), want, "{id:?} at its caps");
    }
    let mut b = crate::cards::Build::default();
    b.set(CardId::WishEngine, 1);
    b.native.slot_mut(CardId::WishEngine).unwrap().counter = 0.1;
    assert_eq!(wish_engine_share(&b), 0.1, "the share is the counter");
    assert!(
        cap > 0. && 1. - cap > super::WISH_MULT_MIN,
        "inside the G13 floor"
    );
    let overload = REWORK_ARCANE_OVERLOAD_WISH_COOLDOWN;
    assert!(
        overload * (1. - cap) > 1.,
        "Arcane Overload's range never meets Wish Engine's"
    );
    for frost_wish in [crate::FrostWish::Freeze, crate::FrostWish::Wall] {
        let config = crate::SimConfig {
            augments: crate::AugmentRule::Rework,
            frost_wish,
            ..crate::SimConfig::default()
        };
        for faction in [
            crate::FactionId::Fire,
            crate::FactionId::Frost,
            crate::FactionId::Plague,
            crate::FactionId::Holy,
            crate::FactionId::Sentenced,
        ] {
            let id = super::wish(faction);
            let row = super::definition_for(&config, id).cooldown_ms;
            let step = cap * row / REWORK_WISH_ENGINE_CAP_MS;
            let mut seen: Vec<(f64, f64, f64)> = Vec::new();
            for lever in [1., overload] {
                for n in 0..100u32 {
                    let share = cap.min(f64::from(n) * step);
                    let cd = super::cooldown_for(&config, id, Some(lever * (1. - share)));
                    assert!(
                        !seen.iter().any(|(_, _, c)| *c == cd),
                        "{frost_wish:?} {faction:?}: lever {lever} share {share} spends {cd} like {seen:?}"
                    );
                    seen.push((lever, share, cd));
                    if share == cap {
                        break;
                    }
                }
            }
        }
    }
}
