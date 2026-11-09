//! Pure arithmetic and explicitly synthetic cache/selection controls; not earned-source parity.
use super::*;
use crate::{FactionId, FactionMode, Placement, Secrets, Sim, SimConfig, Vec2};

fn scene() -> Sim {
    let mut s = Sim::reset_active(
        SimConfig { faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
            consumables: false, ..Default::default() },
        crate::arenas::practice_arena(), Secrets::from_seed(12),
        &[FactionId::Sentenced, FactionId::Sentenced, FactionId::Holy].map(|faction| Placement {
            profile: format!("diagnostic-{faction:?}"), faction, bot: false,
            at: Vec2::new(400., 320.), hp: None, weapon0: None, weapon1: None,
        }),
    );
    for slot in 0..2 {
        let f = &mut s.w.players[slot].signature;
        f.target = Some(PlayerId(3));
        f.mark.group = Some(crate::fighter::MarkGroup::Fighter(PlayerId(3)));
        f.mark.tier = 2;
        f.mark.hits = 3;
        f.mark.progress = 3.;
    }
    prepare(&mut s.w, &mut s.s.mark_tax_next).unwrap();
    s
}

#[test]
fn tax_factor_and_public_cut_keep_farm_outside_regular_cap() {
    let rows = OwnAsRows { regular: 0., farm: 200. };
    assert_eq!(rows.uncapped(1.), 201.);
    let rate = 0.95 * rows.uncapped(1.);
    assert_eq!(rate, 190.95);
    let factor = taxed_rate(rate) / rate;
    assert_eq!(factor.to_bits(), 0.5184603299293009f64.to_bits());
    assert_eq!(crate::math::js_round(cut(rows, 1., factor) * 100.), 48.);
    // Same uncapped rate, but the ordinary card rows had already lost their excess to the cap; the public cut is0.
    assert_eq!(cut(OwnAsRows { regular: 200., farm: 0. }, 1., factor), 0.);
    assert_eq!(taxed_rate(MARK_TAX_THRESHOLD), MARK_TAX_THRESHOLD);
    assert_eq!(taxed_rate(MARK_TAX_RATE_CAP), MARK_TAX_RATE_CAP);
    assert_eq!(cut(rows, 1., 1.), 0.);
}

#[test]
fn efficiency_applies_only_to_positive_rows_and_never_includes_as_post() {
    let rows = OwnAsRows { regular: -2., farm: 200. };
    assert_eq!(rows.uncapped(0.5), 99.);
    assert_eq!(OwnAsRows { regular: -2., farm: -1. }.uncapped(0.5), 0.);
    assert_eq!(cut(OwnAsRows { regular: -2., farm: 0. }, 1., 0.5), 0.);
}

#[test]
fn selected_owner_is_eligible_before_tier_and_lexical_tie() {
    let mut s = scene();
    build_next(&s.w, &mut s.s.mark_tax_next);
    assert_eq!(s.s.mark_tax_next, [TaxBinding { victim: PlayerId(3), by: PlayerId(1) }]);
    s.s.mark_tax_next.clear();
    s.w.players[1].signature.mark.tier = 3;
    build_next(&s.w, &mut s.s.mark_tax_next);
    assert_eq!(s.s.mark_tax_next[0].by, PlayerId(2));
    s.s.mark_tax_next.clear();
    s.w.players[1].body.x += MARK_NEAR_RANGE + 1.;
    build_next(&s.w, &mut s.s.mark_tax_next);
    assert_eq!(s.s.mark_tax_next[0].by, PlayerId(1), "ineligible stronger owner cannot shadow eligible weaker owner");
    s.s.mark_tax_next.clear();
}

#[test]
fn membership_replacement_does_not_refold_but_removal_does() {
    let mut s = scene();
    rebuild(&s.k, &mut s.w, &mut s.s.mark_tax_next, Default::default());
    s.w.players[2].modifiers.test_set_attack_wire(777.);
    s.w.players[1].signature.mark.tier = 3;
    rebuild(&s.k, &mut s.w, &mut s.s.mark_tax_next, Default::default());
    assert_eq!(s.w.factions.taxed[0].by, PlayerId(2));
    assert_eq!(s.w.players[2].modifiers.attack_rate_wire(), 777., "owner replacement must not call recompute");
    s.w.players[0].signature.clear_target();
    s.w.players[1].signature.clear_target();
    rebuild(&s.k, &mut s.w, &mut s.s.mark_tax_next, Default::default());
    assert!(s.w.factions.taxed.is_empty());
    assert_eq!(s.w.players[2].modifiers.attack_rate_wire(), 1000., "membership removal recomputes now");
    assert!(s.s.mark_tax_next.is_empty());
}

#[test]
fn neutral_cut_membership_is_real_and_historical_validation_does_not_reconstruct_nearness() {
    let mut s = scene();
    rebuild(&s.k, &mut s.w, &mut s.s.mark_tax_next, Default::default());
    sync_public(&mut s.w, |_| OwnAsRows::default());
    assert_eq!(s.w.factions.taxed.len(), 1);
    assert_eq!(public_percent(&s.w, PlayerId(3)), 0);
    assert_eq!(s.w.players[2].signature.bits & SIG_TAXED, 0);
    // A later phase can change graph eligibility without rewriting this pass cache.
    s.w.players[0].body.x += MARK_NEAR_RANGE + 1.;
    s.w.players[1].body.x += MARK_NEAR_RANGE + 1.;
    validate(&s.k, &s.w).unwrap();
    let old = s.w.factions.taxed.clone();
    s.w.factions.taxed.push(old[0]);
    assert!(validate(&s.k, &s.w).is_err());
    s.w.factions.taxed = old;
    s.w.factions.taxed[0].by = PlayerId(u32::MAX);
    assert!(validate(&s.k, &s.w).is_err());
}

#[test]
fn sparse_public_cache_and_sig_bit_are_strict() {
    let mut s = scene();
    rebuild(&s.k, &mut s.w, &mut s.s.mark_tax_next, Default::default());
    s.w.factions.public_tax.push(TaxPercent { victim: PlayerId(3), percent: 48 });
    assert!(validate(&s.k, &s.w).is_err(), "positive public cache requires matching current bit");
    s.w.players[2].signature.bits |= SIG_TAXED;
    validate(&s.k, &s.w).unwrap();
    for bad in [0, 101, 255] {
        s.w.factions.public_tax[0].percent = bad;
        assert!(validate(&s.k, &s.w).is_err());
    }
    s.w.factions.public_tax[0].percent = 48;
    s.w.factions.public_tax.push(s.w.factions.public_tax[0]);
    assert!(validate(&s.k, &s.w).is_err(), "duplicate public key is malformed");
}
