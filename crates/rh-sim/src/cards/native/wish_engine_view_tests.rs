//! P-AUG-NATIVE-3b-fix oracle: the Wish owner view counts charges and the next charge from the cooldown its stock
//! clocks were built with (the last spend's), not from the next cast's cooldown (brief
//! `docs/backlog/packets/P-AUG-NATIVE-3b-fix.md`; reviewer-opus note 1 on P-AUG-NATIVE-3b).
//!
//! The truth the view must show is the stock clocks themselves: a charge is up exactly when the server accepts a cast
//! (`wish_ready_at <= now`), both are up when `wish_full_at <= now`, and the next charge returns at `wish_ready_at`
//! (none up) or `wish_full_at` (one of two up). `recharge_ms` stays the next cast's cooldown.
use super::wish_engine_tests::{
    give, in_flight, row_cooldown, share, spend, step_of, wish_raw, world, world_of,
};
use crate::abilities::{charges_at, next_charge_at, OwnerView};
use crate::cards::CardId;
use crate::input::validate;
use crate::{AugmentRule, FactionId, Sim};

fn view(s: &Sim, i: usize) -> OwnerView {
    OwnerView::of(&s.w.players[i], s.w.server_time, s.k.config.training)
}

/// `(charges, next_charge_at)` read off player `i`'s stock clocks (every Wish row has one or two charges).
fn truth(s: &Sim, i: usize) -> (u8, Option<f64>) {
    let p = &s.w.players[i];
    let max = view(s, i).max_charges;
    assert!((1..=2).contains(&max), "a Wish row has one or two charges");
    let now = s.w.server_time;
    let full = p.stocks.wish_full_at.unwrap_or(0.);
    let ready = p.stocks.wish_ready_at;
    if full <= now {
        (max, None)
    } else if max == 2 && ready <= now {
        (1, Some(full))
    } else {
        (0, Some(if max == 2 { ready } else { full }))
    }
}

/// Submits player `i`'s Wish if it is ready, then steps; true when a new spend was recorded.
fn try_cast(s: &mut Sim, i: usize) -> bool {
    let before = spend(s, i);
    if let Some(raw) = wish_raw(s, i) {
        let id = s.w.players[i].id;
        let _ = s.submit(id, validate(raw).expect("valid"));
    }
    s.step();
    spend(s, i) != before
}

/// Steps until player `i`'s Wish is ready, casts it, and steps to the tick it lands, calling `each` after every step.
fn cast_and_land(s: &mut Sim, i: usize, at: &str, mut each: impl FnMut(&Sim)) {
    let mut guard = 0;
    while wish_raw(s, i).is_none() {
        s.step();
        each(s);
        guard += 1;
        assert!(guard < 20_000, "{at}: the Wish never got ready");
    }
    assert!(try_cast(s, i), "{at}: the cast was accepted");
    each(s);
    let mut flight = 0;
    while in_flight(s, i) {
        s.step();
        each(s);
        flight += 1;
        assert!(flight < 40, "{at}: the cast never landed");
    }
}

fn assert_truth(s: &Sim, i: usize, at: &str) {
    let v = view(s, i);
    let p = &s.w.players[i];
    assert_eq!(
        (v.charges, v.next_charge_at),
        truth(s, i),
        "{at}: t={} ready_at={} full_at={:?} last spend {:?} recharge_ms={}",
        s.w.server_time,
        p.stocks.wish_ready_at,
        p.stocks.wish_full_at,
        spend(s, i),
        v.recharge_ms
    );
}

/// A Fire holder casts its first charge; one tick after it lands (the share has stepped, the next cast costs 29 250 ms)
/// the view shows one charge of two up, the next one at the real full clock, and the server does accept that charge.
#[test]
fn a_fire_holder_shows_its_second_charge_one_tick_after_the_first_cast_lands() {
    let mut s = world(FactionId::Fire, &[CardId::WishEngine]);
    let row = row_cooldown(&s, 0);
    cast_and_land(&mut s, 0, "Fire", |_| {});
    s.step();
    let sp = spend(&s, 0).expect("a spend");
    assert_eq!(sp.cooldown_ms, row, "the first cast spends the full row");
    assert_eq!(share(&s, 0), step_of(row), "the landing stepped the share");
    let full = s.w.players[0].stocks.wish_full_at.expect("full clock");
    assert_eq!(full, sp.at + row);
    let v = view(&s, 0);
    assert!(
        (v.recharge_ms - row * (1. - step_of(row))).abs() <= 1.,
        "recharge_ms stays the next cast's cooldown, got {}",
        v.recharge_ms
    );
    assert!(
        v.ready_at <= s.w.server_time,
        "the Wish is ready on the clock"
    );
    assert_eq!(
        v.charges,
        1,
        "one of two charges is up {} ms after the cast (view {v:?})",
        s.w.server_time - sp.at
    );
    assert_eq!(
        v.next_charge_at,
        Some(full),
        "the next charge is the full clock"
    );
    assert!(
        try_cast(&mut s, 0),
        "the server accepts the charge the view shows"
    );
}

/// Every single-charge holder: one tick after its first cast lands, the view shows no charge and the next one at the
/// real full clock (spend time + the cooldown that cast spent), not `full - next cooldown`.
#[test]
fn single_charge_holders_show_their_real_full_clock_after_landing() {
    for faction in [
        FactionId::Frost,
        FactionId::Plague,
        FactionId::Holy,
        FactionId::Sentenced,
    ] {
        let at = format!("{faction:?}");
        let mut s = world(faction, &[CardId::WishEngine]);
        let row = row_cooldown(&s, 0);
        cast_and_land(&mut s, 0, &at, |_| {});
        s.step();
        let sp = spend(&s, 0).expect("a spend");
        assert_eq!(
            sp.cooldown_ms, row,
            "{at}: the first cast spends the full row"
        );
        assert!(share(&s, 0) > 0., "{at}: the landing stepped the share");
        let full = s.w.players[0].stocks.wish_full_at.expect("full clock");
        assert_eq!(full, sp.at + row, "{at}: full clock");
        assert_eq!(
            s.w.players[0].stocks.wish_ready_at, full,
            "{at}: ready clock"
        );
        let v = view(&s, 0);
        assert!(
            (v.recharge_ms - row * (1. - share(&s, 0))).abs() <= 1.,
            "{at}: recharge_ms stays the next cast's cooldown, got {}",
            v.recharge_ms
        );
        assert_eq!(v.charges, 0, "{at}: no charge is up");
        assert_eq!(
            v.next_charge_at,
            Some(full),
            "{at}: the next charge is the real full clock, {} ms after the cast",
            s.w.server_time - sp.at
        );
    }
}

/// Fire casts both charges, then takes Arcane Overload while both recharge (the next cast's cooldown jumps by its
/// factor): on every tick from the first cast until both charges are back, the view shows the stock clocks' count and
/// next charge. Run for a non-holder (the latent pre-Wish-Engine case) and a Wish Engine holder.
#[test]
fn fire_with_arcane_overload_granted_mid_recharge_shows_the_true_charge_count() {
    for cards in [&[][..], &[CardId::WishEngine][..]] {
        let at = format!("Fire {cards:?}");
        let mut s = world(FactionId::Fire, cards);
        let check = |s: &Sim| assert_truth(s, 0, &at);
        cast_and_land(&mut s, 0, &at, check);
        cast_and_land(&mut s, 0, &at, check);
        assert!(
            s.w.players[0].stocks.wish_ready_at > s.w.server_time,
            "{at}: both charges are recharging"
        );
        give(&mut s, 0, CardId::ArcaneOverload);
        assert!(
            view(&s, 0).recharge_ms > spend(&s, 0).unwrap().cooldown_ms,
            "{at}: the grant lengthened the next cast's cooldown"
        );
        let full = s.w.players[0].stocks.wish_full_at.unwrap();
        let mut ticks = 0;
        while s.w.server_time <= full + 100. {
            assert_truth(&s, 0, &at);
            s.step();
            ticks += 1;
        }
        assert!(ticks > 1000, "{at}: the walk covered the recharge");
    }
}

/// Without a lever change mid-recharge, a player who does not hold Wish Engine sees exactly the base view (charges and
/// next charge from `recharge_ms`), byte for byte, on every tick of three casts: Legacy, and Rework holding another
/// native card while the other player holds Wish Engine.
#[test]
fn a_non_holder_s_owner_view_is_byte_equal_to_the_base() {
    for faction in [
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Plague,
        FactionId::Holy,
        FactionId::Sentenced,
    ] {
        for (rule, cards) in [
            (AugmentRule::Legacy, &[][..]),
            (AugmentRule::Rework, &[CardId::Pathfinder][..]),
        ] {
            let at = format!("{faction:?} {rule:?}");
            let other: &[CardId] = if rule == AugmentRule::Rework {
                &[CardId::WishEngine]
            } else {
                &[]
            };
            let mut s = world_of(rule, faction, cards, FactionId::Holy, other);
            let row = row_cooldown(&s, 0);
            let check = |s: &Sim| {
                let v = view(s, 0);
                assert_eq!(v.recharge_ms, row, "{at}: a non-holder's cooldown");
                let now = s.w.server_time;
                let full = s.w.players[0].stocks.wish_full_at.unwrap_or(0.);
                let charges = charges_at(full, now, v.max_charges, row);
                let base = OwnerView {
                    charges,
                    next_charge_at: (charges < v.max_charges)
                        .then(|| next_charge_at(full, now, row)),
                    ..v
                };
                assert_eq!(
                    serde_json::to_vec(&v).unwrap(),
                    serde_json::to_vec(&base).unwrap(),
                    "{at}: t={now}"
                );
            };
            for _ in 0..3 {
                cast_and_land(&mut s, 0, &at, check);
            }
        }
    }
}
