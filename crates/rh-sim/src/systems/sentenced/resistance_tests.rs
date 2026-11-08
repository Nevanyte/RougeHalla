//! Actual player-only input/card producers for the Frost/Mark restore integration boundary.
use super::*;
use crate::{
    cards::CardId, validate as command, Placement, RawCommand, Secrets, Sim, SimConfig, Vec2,
    WeaponId,
};
use serde_json::json;

pub(super) fn duel(cards: &[CardId], frost_cards: &[CardId]) -> Sim {
    duel_with_training(cards, frost_cards, false)
}

pub(super) fn duel_with_training(cards: &[CardId], frost_cards: &[CardId], training: bool) -> Sim {
    let mut s = Sim::reset_active(
        SimConfig {
            training,
            quests: false,
            consumables: false,
            pvp_rules: false,
            faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(12),
        &[FactionId::Sentenced, FactionId::Frost]
            .into_iter()
            .enumerate()
            .map(|(i, faction)| Placement {
                profile: format!("p{i}"),
                faction,
                bot: false,
                at: Vec2::new(400. + i as f64 * 30., 320.),
                hp: None,
                weapon0: Some(WeaponId::Sword),
                weapon1: Some(WeaponId::Wand),
            })
            .collect::<Vec<_>>(),
    );
    assert_eq!(s.k.config.mob_mode, crate::mob_runtime::MobMode::Off);
    assert_eq!(s.k.config.training, training);
    for (id, cards) in [(PlayerId(1), cards), (PlayerId(2), frost_cards)] {
        for &card in cards {
            assert!(crate::cards::grant(&s.k, &mut s.w, id, card));
        }
    }
    for (by, target) in [(1, 2), (2, 1)] {
        submit(
            &mut s,
            by,
            RawCommand::Target {
                id: PlayerId(target),
            },
        );
        submit(
            &mut s,
            by,
            RawCommand::Attack {
                a: if by == 1 { 0. } else { crate::math::PI },
                t: None,
            },
        );
    }
    s
}

pub(super) fn submit(s: &mut Sim, by: u32, raw: RawCommand) {
    s.submit(PlayerId(by), command(raw).unwrap()).unwrap();
}

pub(super) fn chilled_hit(s: &mut Sim) -> f64 {
    for _ in 0..120 {
        let before = s.w.players[0].signature.clone();
        s.step();
        let after = &s.w.players[0].signature;
        if after.mark.hits > before.mark.hits && before.chill < 1. {
            assert_eq!(after.mark.hits, before.mark.hits + 1);
            assert!((after.mark.progress - before.mark.progress - 1. / before.chill).abs() < 1e-12);
            return before.chill;
        }
    }
    panic!("validated attacks must produce a chilled Mark hit");
}

pub(super) fn restore_continue(s: &mut Sim) {
    let mut restored = Sim::restore(serde_json::to_value(&s).unwrap())
        .expect("a real accumulated Mark must restore");
    assert_eq!(restored.state_hash(), s.state_hash());
    for _ in 0..12 {
        assert_eq!(restored.step(), s.step());
        assert_eq!(restored.state_hash(), s.state_hash());
        restored = Sim::restore(serde_json::to_value(restored).unwrap()).unwrap();
    }
}

#[test]
fn real_iron_will_mark_restores() {
    let mut s = duel(&[CardId::IronWill], &[]);
    assert!((chilled_hit(&mut s) - 0.808).abs() < 1e-12);
    let m = &s.w.players[0].signature.mark;
    eprintln!(
        "real producer tick={} hits={} progress={} tier={}",
        s.tick(),
        m.hits,
        m.progress,
        m.tier
    );
    assert_eq!(m.hits, 2);
    assert!((m.progress - (1. + 1. / 0.808)).abs() < 1e-12);
    restore_continue(&mut s);
}

#[test]
fn real_resistance_grant_keeps_prior_chill_and_mixed_history() {
    let mut s = duel(&[], &[]);
    let unresisted = chilled_hit(&mut s);
    assert_eq!(unresisted, 1. - FROST_SLOW);
    let previous = s.w.players[0].signature.mark;
    assert!(crate::cards::grant(
        &s.k,
        &mut s.w,
        PlayerId(1),
        CardId::IronWill
    ));
    assert_eq!(crate::modifiers::view(&s.w.players[0]).slow_resist, 0.4);
    assert_eq!(
        s.w.players[0].signature.chill, unresisted,
        "grant/refold cannot rewrite prior chill"
    );
    assert_eq!(s.w.players[0].signature.mark, previous);
    Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
    s.step();
    assert!((s.w.players[0].signature.chill - 0.808).abs() < 1e-12);
    assert!((chilled_hit(&mut s) - 0.808).abs() < 1e-12);
    assert!(s.w.players[0].signature.mark.progress > previous.progress);
    restore_continue(&mut s);
}

#[test]
fn real_deepened_frost_uses_admitted_cap_not_base_only_maximum() {
    let mut s = duel(&[], &[CardId::Haste2; 4]);
    let prior = chilled_hit(&mut s);
    assert_eq!(
        prior,
        1. - FROST_SLOW - crate::modifiers::DEFINITION.frost_cap
    );
    let m = s.w.players[0].signature.mark;
    assert!(m.progress > m.hits as f64 / (1. - FROST_SLOW));
    restore_continue(&mut s);
}

#[test]
fn accumulated_history_does_not_follow_current_source_stats() {
    let mut s = duel(&[CardId::IronWill], &[]);
    chilled_hit(&mut s);
    let previous = s.w.players[0].signature.mark;
    for _ in 0..4 {
        assert!(crate::cards::grant(
            &s.k,
            &mut s.w,
            PlayerId(2),
            CardId::Haste2
        ));
    }
    assert_eq!(s.w.players[0].signature.mark, previous);
    assert!((s.w.players[0].signature.chill - 0.808).abs() < 1e-12);
    Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
    s.step();
    assert!((s.w.players[0].signature.chill - 0.688).abs() < 1e-12);
    restore_continue(&mut s);
}

#[test]
fn malformed_mark_progress_and_other_invariants_still_refuse() {
    let mut s = duel(&[CardId::IronWill], &[]);
    chilled_hit(&mut s);
    let base = serde_json::to_value(&s).unwrap();
    let max = s.w.players[0].signature.mark.hits as f64
        / (1. - FROST_SLOW - crate::modifiers::DEFINITION.frost_cap).max(MARK_CHILL_FLOOR);
    for (name, field, value) in [
        ("negative", "progress", json!(-1.)),
        ("below hit count", "progress", json!(1.999)),
        ("above admitted chill cap", "progress", json!(max + 0.001)),
        ("zero hits with progress", "hits", json!(0)),
        (
            "unsafe hit integer",
            "hits",
            json!(9_007_199_254_740_992u64),
        ),
        ("wrong tier", "tier", json!(4)),
        ("future far clock", "far_since", json!(s.server_time() + 1.)),
        ("denied before top tier", "denied", json!(true)),
    ] {
        let mut bad = base.clone();
        bad["world"]["players"][0]["core"]["signature"]["mark"][field] = value;
        assert!(Sim::restore(bad).is_err(), "must refuse {name}");
    }
    // JSON cannot carry NaN/Infinity: exercise the same typed validator directly, never sanitize the value.
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut p = s.w.players[0].clone();
        p.signature.mark.progress = invalid;
        assert!(validate(&s.k, &s.w, &p).is_err());
    }
    let mut bad = base;
    bad["world"]["players"][0]["core"]["signature"]["target"] = serde_json::Value::Null;
    assert!(
        Sim::restore(bad).is_err(),
        "active mark cannot lose its target"
    );
}
