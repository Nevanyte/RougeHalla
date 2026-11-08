//! Real flag grants, victim swaps and training Clear; no installed Mark outcomes.
use super::{resistance_tests::*, *};
use crate::{cards::CardId, RawCommand, Sim};
use serde_json::json;

#[test]
fn real_swift_judgment_tier_restores() {
    let mut s = duel(&[CardId::Haste1, CardId::SwiftJudgment], &[]);
    chilled_hit(&mut s);
    let m = s.w.players[0].signature.mark;
    assert_eq!((m.hits, m.swaps, m.tier), (2, 0, 2));
    eprintln!(
        "SwiftJudgment tick={} progress={} tier={}",
        s.tick(),
        m.progress,
        m.tier
    );
    restore_continue(&mut s);
}

#[test]
fn real_no_commutation_victim_swap_tier_restores() {
    let mut s = duel(&[CardId::NoCommutation], &[]);
    chilled_hit(&mut s);
    submit(&mut s, 2, RawCommand::Swap { slot: Some(1) });
    s.step();
    let m = s.w.players[0].signature.mark;
    assert_eq!((m.hits, m.swaps, m.tier), (2, 1, 3));
    eprintln!(
        "NoCommutation tick={} progress={} tier={}",
        s.tick(),
        m.progress,
        m.tier
    );
    restore_continue(&mut s);
}

#[test]
fn real_new_flags_do_not_retroactively_promote_cached_tier() {
    for card in [CardId::SwiftJudgment, CardId::NoCommutation] {
        let mut s = duel(&[CardId::Haste1], &[]);
        chilled_hit(&mut s);
        if card == CardId::NoCommutation {
            submit(&mut s, 2, RawCommand::Swap { slot: Some(1) });
            s.step();
        }
        let prior = s.w.players[0].signature.mark;
        assert!(crate::cards::grant(&s.k, &mut s.w, PlayerId(1), card));
        assert_eq!(
            s.w.players[0].signature.mark, prior,
            "grant/refold leaves a cached tier alone"
        );
        Sim::restore(serde_json::to_value(&s).unwrap())
            .expect("cached pre-grant tier is legitimate");
        s.step();
        assert!(s.w.players[0].signature.mark.tier > prior.tier);
        restore_continue(&mut s);
    }
}

#[test]
fn real_training_clear_retains_monotonic_tier_after_flags_disappear() {
    let mut s = duel_with_training(
        &[
            CardId::Haste1,
            CardId::SwiftJudgment,
            CardId::NoCommutation,
            CardId::SlowBurn,
        ],
        &[],
        true,
    );
    chilled_hit(&mut s);
    submit(&mut s, 2, RawCommand::Swap { slot: Some(1) });
    s.step();
    assert_eq!(s.w.players[0].signature.mark.tier, 4);
    // The current console admits INTERACTIVE augments only: neither tier flag is in that set (Swift is also
    // Conditional). A valid count0 message therefore leaves these flags alone; never install a successful removal.
    for card in [CardId::NoCommutation, CardId::SwiftJudgment] {
        submit(
            &mut s,
            1,
            RawCommand::Train(crate::input::TrainRaw {
                command: 1,
                id: card.index() as u32,
                count: 0,
                options: [0; 3],
                option_count: 0,
            }),
        );
        s.step();
        assert!(s.w.players[0].build.owns(card));
        Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
    }
    assert!(s.w.players[0].build.owns(CardId::SlowBurn));
    submit(
        &mut s,
        1,
        RawCommand::Train(crate::input::TrainRaw {
            command: 1,
            id: CardId::SlowBurn.index() as u32,
            count: 0,
            options: [0; 3],
            option_count: 0,
        }),
    );
    s.step();
    assert!(
        !s.w.players[0].build.owns(CardId::SlowBurn),
        "real admitted count0 removes the card"
    );
    assert_eq!(s.w.players[0].signature.mark.tier, 4);
    Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
    submit(
        &mut s,
        1,
        RawCommand::Train(crate::input::TrainRaw {
            command: 5,
            id: 0,
            count: 0,
            options: [0; 3],
            option_count: 0,
        }),
    );
    s.step();
    assert!(!s.w.players[0].build.owns(CardId::SwiftJudgment));
    assert!(!s.w.players[0].build.owns(CardId::NoCommutation));
    assert_eq!(
        s.w.players[0].signature.mark.tier, 4,
        "promotion never demotes after Clear"
    );
    restore_continue(&mut s);
}

#[test]
fn tier_history_bounds_reject_unearned_or_demoted_tiers() {
    for (cards, highest) in [
        (vec![], 1),
        (vec![CardId::Haste1, CardId::SwiftJudgment], 2),
    ] {
        let mut s = duel(&cards, &[]);
        chilled_hit(&mut s);
        let base = serde_json::to_value(&s).unwrap();
        for tier in 0..=5 {
            let mut v = base.clone();
            v["world"]["players"][0]["core"]["signature"]["mark"]["tier"] = json!(tier);
            let result = Sim::restore(v);
            assert_eq!(
                result.is_ok(),
                (1..=highest).contains(&tier),
                "cards={cards:?}, tier={tier}"
            );
        }
    }
    let mut s = duel(&[CardId::NoCommutation], &[]);
    chilled_hit(&mut s);
    submit(&mut s, 2, RawCommand::Swap { slot: Some(1) });
    s.step();
    let base = serde_json::to_value(&s).unwrap();
    for tier in 0..=5 {
        let mut v = base.clone();
        v["world"]["players"][0]["core"]["signature"]["mark"]["tier"] = json!(tier);
        assert_eq!(
            Sim::restore(v).is_ok(),
            (2..=3).contains(&tier),
            "swapped tier={tier}"
        );
    }
    for field in ["hits", "swaps"] {
        let mut v = base.clone();
        v["world"]["players"][0]["core"]["signature"]["mark"][field] =
            json!(9_007_199_254_740_992u64);
        assert!(Sim::restore(v).is_err(), "unsafe {field}");
    }
    let empty = duel(
        &[CardId::NoCommutation, CardId::Haste1, CardId::SwiftJudgment],
        &[],
    );
    let base = serde_json::to_value(&empty).unwrap();
    for tier in 1..=4 {
        let mut v = base.clone();
        v["world"]["players"][0]["core"]["signature"]["mark"]["tier"] = json!(tier);
        assert!(
            Sim::restore(v).is_err(),
            "flags cannot create tier{tier} without a hit or counted swap"
        );
    }
}
