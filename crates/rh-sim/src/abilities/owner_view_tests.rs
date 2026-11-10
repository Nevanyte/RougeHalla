use super::{cooldown, next_charge_at, OwnerView};
use crate::{content::FactionId, math::Vec2, state::Player, PlayerId};

fn player(faction: FactionId) -> Player {
    Player::joining(
        PlayerId(1),
        "owner-view",
        false,
        faction,
        Vec2::new(0., 0.),
        100.,
        crate::archetype::HitboxMode::LegacyCircle,
    )
}

#[test]
fn absent_full_clock_uses_the_legacy_zero_fallback() {
    let mut p = player(FactionId::Fire);
    p.stocks.wish_ready_at = 45_000.;
    p.stocks.wish_full_at = None;

    let view = OwnerView::of(&p, 0., false);
    assert_eq!(view.full_at, None);
    assert_eq!(view.ready_at, 45_000.);
    assert_eq!(view.max_charges, 2);
    assert_eq!(view.charges, 2);
    assert_eq!(view.next_charge_at, None);
}

#[test]
fn blaze_partial_and_empty_stocks_use_canonical_deadlines() {
    let mut p = player(FactionId::Fire);
    p.stocks.wish_ready_at = 100_000.;
    p.stocks.wish_full_at = Some(130_000.);
    let partial = OwnerView::of(&p, 100_000., false);
    assert_eq!(partial.max_charges, 2);
    assert_eq!(partial.recharge_ms, 30_000.);
    assert_eq!(partial.charges, 1);
    assert_eq!(partial.next_charge_at, Some(130_000.));

    p.stocks.wish_ready_at = 130_000.;
    p.stocks.wish_full_at = Some(160_000.);
    let empty = OwnerView::of(&p, 110_000., false);
    assert_eq!(empty.charges, 0);
    assert_eq!(
        empty.next_charge_at,
        Some(next_charge_at(160_000., 110_000., 30_000.))
    );
    assert_eq!(empty.ready_at, 130_000.);
}

#[test]
fn training_uses_canonical_five_second_wish_cooldown() {
    let mut p = player(FactionId::Frost);
    p.stocks.wish_ready_at = 5_000.;
    p.stocks.wish_full_at = Some(5_000.);
    let view = OwnerView::of(&p, 0., true);

    assert_eq!(view.recharge_ms, cooldown(view.ability, true, Some(1.)));
    assert_eq!(view.recharge_ms, 5_000.);
    assert_eq!(view.max_charges, 1);
    assert_eq!(view.charges, 0);
    assert_eq!(view.next_charge_at, Some(5_000.));
}

#[test]
fn opening_lock_deadlines_remain_in_the_owner_view() {
    let mut p = player(FactionId::Fire);
    p.stocks.wish_ready_at = 45_000.;
    p.stocks.wish_full_at = Some(45_000.);
    let view = OwnerView::of(&p, 0., false);

    assert_eq!(view.ready_at, 45_000.);
    assert_eq!(view.charges, 0);
    assert_eq!(view.next_charge_at, Some(15_000.));
}

#[test]
fn matches_additive_legacy_stock_helpers_and_slot_display_capture() {
    let corpus: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../parity/abilities/wish-display.json"
    ))
    .unwrap();

    for row in corpus["stock"].as_array().unwrap() {
        let input = &row["input"];
        let full = input["fullAt"].as_f64().unwrap();
        let now = input["now"].as_f64().unwrap();
        let max = input["max"].as_u64().unwrap() as u8;
        let recharge = input["rechargeMs"].as_f64().unwrap();
        assert_eq!(
            super::charges_at(full, now, max, recharge),
            row["charges"].as_u64().unwrap() as u8,
            "{} charges",
            input["name"]
        );
        assert_eq!(
            super::next_charge_at(full, now, recharge),
            row["next"].as_f64().unwrap(),
            "{} next charge",
            input["name"]
        );
    }

    for row in corpus["cooldown"].as_array().unwrap() {
        let ability: crate::status_runtime::AbilityId =
            serde_json::from_value(row["input"]["ability"].clone()).unwrap();
        let context = &row["input"]["context"];
        assert_eq!(
            cooldown(
                ability,
                context["training"].as_bool().unwrap(),
                context["wishCooldownMult"].as_f64(),
            ),
            row["output"].as_f64().unwrap(),
            "{} cooldown",
            ability.as_str()
        );
    }

    for row in corpus["display"].as_array().unwrap() {
        let input = &row["input"];
        let ability: crate::status_runtime::AbilityId =
            serde_json::from_value(input["ability"].clone()).unwrap();
        let faction = match ability {
            crate::status_runtime::AbilityId::Freeze => FactionId::Frost,
            crate::status_runtime::AbilityId::Swarm => FactionId::Plague,
            crate::status_runtime::AbilityId::Trial => FactionId::Sentenced,
            crate::status_runtime::AbilityId::Blaze => FactionId::Fire,
            crate::status_runtime::AbilityId::LastStand => FactionId::Holy,
        };
        let mut p = player(faction);
        p.stocks.wish_ready_at = input["readyAt"].as_f64().unwrap_or(0.);
        p.stocks.wish_full_at = input["fullAt"].as_f64();
        let view = OwnerView::of(
            &p,
            input["now"].as_f64().unwrap(),
            input["training"].as_bool().unwrap_or(false),
        );
        assert_eq!(
            view.charges,
            row["output"]["charges"].as_u64().unwrap() as u8,
            "{} display charges",
            row["name"]
        );
        assert_eq!(
            view.max_charges,
            row["output"]["maxCharges"].as_u64().unwrap() as u8,
            "{} display maximum",
            row["name"]
        );
        assert_eq!(view.ability, ability, "{} display ability", row["name"]);
    }
}
