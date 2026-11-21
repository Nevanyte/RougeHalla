//! P-AUG-NATIVE-2 oracle: Calluses, Executioner's Ledger and Eighth Strike through the real hooks, their exact `check`
//! rules, their readout rows and a checkpoint taken mid-count.
//!
//! Loose proof (owner direction 2026-11-10; brief `docs/backlog/packets/P-AUG-NATIVE-2.md` section 1):
//! - Calluses (workbook Augment_Tuning "0.07, cap 30"): +0.07 armor per landed fist hit, capped at 30; the armor reaches
//!   the fold (`mirrors().armor_bonus`) and cuts the damage the holder takes by the armor law;
//! - Executioner's Ledger ("+3 AD per player or elite kill only (cap 30)"): +3 per player or elite kill, none for a normal
//!   mob, capped at 30; the AD reaches `mirrors().ad_bonus`;
//! - Eighth Strike (plan decision 3, "every 8th hit doubles"): the 8th, 16th, ... landed weapon hit deals twice what the
//!   same hit deals without the card, the others are unchanged, and the counter cycles 0..=7.
//!
//! Comparisons are between runs that differ only in the state under test (same seed, same commands); both arms hold a
//! native card because `power()` counts native tiers and feeds the PvP factor.
use super::exemplars_tests::{
    attack, give, hits, registered, seat, send, slot, slot_mut, wait_ready, world,
};
use super::hooks::{fire, NativeEvent};
use crate::cards::native::{readouts, rule, Readout, ReadoutKind};
use crate::cards::CardId;
use crate::fighter::FighterIx;
use crate::reward_chests::Offer;
use crate::{AugmentRule, Event, PlayerId, RawCommand, Sim, Vec2, WeaponId};

use std::f64::consts::PI;

fn refold(sim: &mut Sim, id: PlayerId) {
    let i = sim.w.idx(id).unwrap();
    crate::modifiers::recompute(&sim.k, &mut sim.w, FighterIx::of_slot(i));
}

fn mirrors(sim: &Sim, id: PlayerId) -> crate::stat_fold::StatMirrors {
    sim.w.player(id).unwrap().modifiers.mirrors()
}

fn idle(sim: &mut Sim, ticks: u32) {
    for _ in 0..ticks {
        sim.step();
    }
}

fn counter(sim: &Sim, id: PlayerId, card: CardId) -> f64 {
    slot(sim, id, card).counter
}

// ---------------------------------------------------------------------------------------------------------------------
// Calluses.
// ---------------------------------------------------------------------------------------------------------------------

fn calluses_world(holder_weapon: WeaponId) -> Sim {
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("holder", Vec2::new(300., 272.), Some(holder_weapon), None),
            seat("target", Vec2::new(340., 272.), Some(WeaponId::Sword), None),
        ],
    );
    give(&mut sim, PlayerId(1), CardId::Calluses);
    sim
}

/// +0.07 armor per landed fist hit and nothing for a sword hit; the armor is in the holder's fold (mirror rounded to 0.1).
#[test]
fn calluses_earn_their_workbook_armor_per_fist_hit_only() {
    assert_eq!(registered("REWORK_CALLUSES_PER"), Some(0.07));
    assert_eq!(registered("REWORK_CALLUSES_CAP"), Some(30.));
    let mut sim = calluses_world(WeaponId::Fists);
    let mut landed = 0;
    for _ in 0..3 {
        wait_ready(&mut sim, PlayerId(1));
        let ev = attack(&mut sim, PlayerId(1), 0., 20);
        landed += hits(&ev, PlayerId(1), PlayerId(2)).len();
    }
    assert!(landed >= 3, "the punches land: {landed}");
    let got = counter(&sim, PlayerId(1), CardId::Calluses);
    let want = landed as f64 * 0.07;
    assert!(
        (got - want).abs() < 1e-9,
        "counter {got}, want {landed} x 0.07 = {want}"
    );
    idle(&mut sim, 3);
    let armor = mirrors(&sim, PlayerId(1)).armor_bonus;
    assert!(
        (armor - got).abs() <= 0.05 + 1e-9,
        "armor_bonus {armor} follows the counter {got} (0.1 wire resolution)"
    );

    let mut sword = calluses_world(WeaponId::Sword);
    for _ in 0..3 {
        wait_ready(&mut sword, PlayerId(1));
        let ev = attack(&mut sword, PlayerId(1), 0., 20);
        assert_eq!(hits(&ev, PlayerId(1), PlayerId(2)).len(), 1);
    }
    assert_eq!(counter(&sword, PlayerId(1), CardId::Calluses), 0.);
    assert_eq!(mirrors(&sword, PlayerId(1)).armor_bonus, 0.);
}

/// The counter stops at 30, and 30 armor cuts a Holy physical hit by (1 + 0.78) / (1 + 1.08) (within 2%).
#[test]
fn calluses_stop_at_their_cap_and_the_armor_cuts_the_damage_taken() {
    let cap = rule(CardId::Calluses).unwrap().counter_cap;
    assert_eq!(cap, 30.);
    let mut sim = calluses_world(WeaponId::Fists);
    slot_mut(&mut sim, PlayerId(1), CardId::Calluses).counter = cap - 0.035;
    wait_ready(&mut sim, PlayerId(1));
    let ev = attack(&mut sim, PlayerId(1), 0., 20);
    assert!(!hits(&ev, PlayerId(1), PlayerId(2)).is_empty());
    assert_eq!(counter(&sim, PlayerId(1), CardId::Calluses), cap);
    wait_ready(&mut sim, PlayerId(1));
    attack(&mut sim, PlayerId(1), 0., 20);
    assert_eq!(counter(&sim, PlayerId(1), CardId::Calluses), cap);

    let taken = |armor: f64| {
        let mut sim = calluses_world(WeaponId::Fists);
        slot_mut(&mut sim, PlayerId(1), CardId::Calluses).counter = armor;
        refold(&mut sim, PlayerId(1));
        wait_ready(&mut sim, PlayerId(2));
        let ev = attack(&mut sim, PlayerId(2), PI, 20);
        let h = hits(&ev, PlayerId(2), PlayerId(1));
        assert_eq!(h.len(), 1, "armor {armor}: the sword hit lands once");
        h[0]
    };
    let full = taken(cap);
    let none = taken(0.);
    let r = full / none;
    let want = (1. + 78. / 100.) / (1. + (78. + cap) / 100.);
    assert!(
        (r - want).abs() <= 0.02 * want,
        "damage at 30 armor {full} / at 0 {none} = {r}, want {want}"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Executioner's Ledger.
// ---------------------------------------------------------------------------------------------------------------------

fn ledger_world() -> Sim {
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("holder", Vec2::new(300., 272.), Some(WeaponId::Sword), None),
            seat(
                "victim",
                Vec2::new(340., 272.),
                Some(WeaponId::Sword),
                Some(1.),
            ),
        ],
    );
    give(&mut sim, PlayerId(1), CardId::ExecutionersLedger);
    sim
}

fn credited(sim: &mut Sim, player: bool, elite: bool) {
    fire(
        &sim.k,
        &mut sim.w,
        PlayerId(1),
        NativeEvent::CreditedKill { player, elite },
    );
}

/// A real player kill earns +3 AD (the AD is in the fold); through the hook, an elite earns +3, a normal mob nothing, and
/// the counter stops at 30.
#[test]
fn executioners_ledger_earns_three_ad_per_player_or_elite_kill_only() {
    assert_eq!(registered("REWORK_EXECUTIONERS_LEDGER_PER"), Some(3.));
    assert_eq!(registered("REWORK_EXECUTIONERS_LEDGER_CAP"), Some(30.));
    let mut sim = ledger_world();
    wait_ready(&mut sim, PlayerId(1));
    let ev = attack(&mut sim, PlayerId(1), 0., 20);
    assert!(
        ev.iter().any(|e| matches!(
            e,
            Event::Death { id, by: Some(b), .. } if *id == PlayerId(2) && *b == PlayerId(1)
        )),
        "the holder kills the 1 hp victim"
    );
    idle(&mut sim, 3);
    assert_eq!(counter(&sim, PlayerId(1), CardId::ExecutionersLedger), 3.);
    let ad = mirrors(&sim, PlayerId(1)).ad_bonus;
    assert!(
        (ad - 3.).abs() <= 0.05 + 1e-9,
        "ad_bonus {ad} is the counter 3"
    );

    let mut sim = ledger_world();
    let c = |sim: &Sim| counter(sim, PlayerId(1), CardId::ExecutionersLedger);
    credited(&mut sim, false, false);
    assert_eq!(c(&sim), 0., "a normal mob kill earns nothing");
    credited(&mut sim, false, true);
    assert_eq!(c(&sim), 3., "an elite kill earns 3");
    credited(&mut sim, true, false);
    assert_eq!(c(&sim), 6., "a player kill earns 3");
    slot_mut(&mut sim, PlayerId(1), CardId::ExecutionersLedger).counter = 27.;
    credited(&mut sim, true, false);
    assert_eq!(c(&sim), 30.);
    credited(&mut sim, false, true);
    assert_eq!(c(&sim), 30., "min(cap, counter + per)");
    idle(&mut sim, 3);
    let ad = mirrors(&sim, PlayerId(1)).ad_bonus;
    assert!(
        (ad - 30.).abs() <= 0.05 + 1e-9,
        "ad_bonus {ad} at the cap 30"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Eighth Strike.
// ---------------------------------------------------------------------------------------------------------------------

/// A sword holder (holding `card`) hits a full-hp sword victim `n` times; returns each attack's hit amount and the
/// holder's Eighth Strike counter after it (0 when it does not hold the card).
fn swings(card: CardId, n: usize) -> Vec<(f64, f64)> {
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("holder", Vec2::new(300., 272.), Some(WeaponId::Sword), None),
            seat("victim", Vec2::new(340., 272.), Some(WeaponId::Sword), None),
        ],
    );
    give(&mut sim, PlayerId(1), card);
    let mut out = Vec::new();
    for k in 0..n {
        let max = sim.w.players[1].core.vitals.max_hp;
        sim.w.players[1].core.vitals.hp = max;
        wait_ready(&mut sim, PlayerId(1));
        let ev = attack(&mut sim, PlayerId(1), 0., 20);
        let h = hits(&ev, PlayerId(1), PlayerId(2));
        assert_eq!(h.len(), 1, "{card:?} swing {k}: one landed hit");
        let c = if card == CardId::EighthStrike {
            counter(&sim, PlayerId(1), card)
        } else {
            0.
        };
        out.push((h[0], c));
    }
    out
}

/// Every 8th landed hit deals twice what it would without the card; the counter counts 1..7 then 0.
#[test]
fn eighth_strike_doubles_every_eighth_hit_and_no_other() {
    assert_eq!(registered("REWORK_EIGHTH_STRIKE_EVERY"), Some(8.));
    assert_eq!(registered("REWORK_EIGHTH_STRIKE_MULT"), Some(2.));
    let with = swings(CardId::EighthStrike, 17);
    let without = swings(CardId::Pathfinder, 17);
    for (k, ((a, c), (b, _))) in with.iter().zip(&without).enumerate() {
        let n = k + 1;
        let want = if n % 8 == 0 { 2. } else { 1. };
        assert!(
            (a / b - want).abs() <= 1e-9,
            "hit {n}: {a} / {b} = {}, want {want}",
            a / b
        );
        assert_eq!(*c, (n % 8) as f64, "hit {n}: the counter after it");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Check rules, readouts, pool, restore.
// ---------------------------------------------------------------------------------------------------------------------

/// The exact rules: Eighth Strike's counter is an integer, the Ledger's a multiple of 3, Calluses' the cap or a multiple
/// of 0.07 (accumulated by real addition, so within 1e-9). Controls restore; the off-grid values are refused.
#[test]
fn check_world_holds_each_card_to_its_exact_counter_rule() {
    let accumulated: f64 = (0..100).fold(0., |a, _| a + 0.07);
    let cases: [(CardId, Vec<f64>, Vec<f64>); 3] = [
        (CardId::EighthStrike, vec![0., 3., 7.], vec![3.5, 0.5]),
        (
            CardId::ExecutionersLedger,
            vec![0., 3., 30.],
            vec![1.5, 4., 29.9],
        ),
        (
            CardId::Calluses,
            vec![0., 0.07, accumulated, 30.],
            vec![0.035, 0.1, 29.9],
        ),
    ];
    for (card, good, bad) in cases {
        let restores = |v: f64| {
            let mut sim = world(
                AugmentRule::Rework,
                &[seat(
                    "a",
                    Vec2::new(300., 272.),
                    Some(WeaponId::Sword),
                    None,
                )],
            );
            give(&mut sim, PlayerId(1), card);
            slot_mut(&mut sim, PlayerId(1), card).counter = v;
            refold(&mut sim, PlayerId(1));
            let cp = serde_json::to_value(&sim).unwrap();
            Sim::restore(&cp).is_ok()
        };
        for v in good {
            assert!(restores(v), "{card:?}: counter {v} restores");
        }
        for v in bad {
            assert!(!restores(v), "{card:?}: counter {v} is refused");
        }
    }
}

/// Each owner sees its own weapon-batch rows (counter against the rule's cap), in native order.
#[test]
fn readouts_show_the_three_cards_counters() {
    let mut sim = world(
        AugmentRule::Rework,
        &[seat(
            "a",
            Vec2::new(300., 272.),
            Some(WeaponId::Sword),
            None,
        )],
    );
    for card in [
        CardId::Calluses,
        CardId::ExecutionersLedger,
        CardId::EighthStrike,
    ] {
        give(&mut sim, PlayerId(1), card);
    }
    slot_mut(&mut sim, PlayerId(1), CardId::Calluses).counter = 0.14;
    slot_mut(&mut sim, PlayerId(1), CardId::ExecutionersLedger).counter = 9.;
    slot_mut(&mut sim, PlayerId(1), CardId::EighthStrike).counter = 5.;
    let row = |card, value| Readout {
        card,
        kind: ReadoutKind::Counter,
        value,
        max: rule(card).unwrap().counter_cap,
    };
    assert_eq!(
        readouts(&sim, PlayerId(1)).rows(),
        &[
            row(CardId::Calluses, 0.14),
            row(CardId::ExecutionersLedger, 9.),
            row(CardId::EighthStrike, 5.),
        ]
    );
    assert_eq!(rule(CardId::EighthStrike).unwrap().counter_cap, 7.);
}

/// The weapon table lists the three as offered to every picker (membership only).
#[test]
fn the_weapon_table_lists_the_three_cards_for_every_picker() {
    for card in [
        CardId::Calluses,
        CardId::ExecutionersLedger,
        CardId::EighthStrike,
    ] {
        assert!(
            super::weapon::POOL.contains(&(card, Offer::Any)),
            "{card:?}"
        );
    }
}

/// A checkpoint taken at every tick of a running count (punches, a kill, a sword streak past an 8th hit) restores
/// hash-exact and plays on identically; the counts moved during the run.
#[test]
fn a_checkpoint_mid_count_restores_hash_exact_and_plays_on() {
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat(
                "calluses",
                Vec2::new(300., 272.),
                Some(WeaponId::Fists),
                None,
            ),
            seat("t1", Vec2::new(340., 272.), Some(WeaponId::Sword), None),
            seat("ledger", Vec2::new(300., 400.), Some(WeaponId::Sword), None),
            seat("t2", Vec2::new(340., 400.), Some(WeaponId::Sword), Some(1.)),
            seat("eighth", Vec2::new(500., 272.), Some(WeaponId::Sword), None),
            seat("t3", Vec2::new(540., 272.), Some(WeaponId::Sword), None),
        ],
    );
    give(&mut sim, PlayerId(1), CardId::Calluses);
    give(&mut sim, PlayerId(3), CardId::ExecutionersLedger);
    give(&mut sim, PlayerId(5), CardId::EighthStrike);
    let (mut max_cal, mut max_eighth) = (0f64, 0f64);
    for t in 0..200u32 {
        let cp = serde_json::to_value(&sim).unwrap();
        let mut copy = Sim::restore(&cp).unwrap_or_else(|e| panic!("tick {t}: {e:?}"));
        assert_eq!(copy.state_hash(), sim.state_hash(), "tick {t}: restore");
        let cmds = [
            (PlayerId(1), t % 20 == 0, t % 20 == 1),
            (PlayerId(3), t % 30 == 0, t % 30 == 1),
            (PlayerId(5), t % 20 == 0, t % 20 == 1),
        ];
        for s in [&mut sim, &mut copy] {
            for (id, press, release) in cmds {
                if press {
                    send(s, id, RawCommand::Attack { a: 0., t: None });
                }
                if release {
                    send(s, id, RawCommand::Release { a: 0., t: None });
                }
            }
        }
        let a = sim.step();
        let b = copy.step();
        assert_eq!(a, b, "tick {t}: events after restore");
        assert_eq!(copy.state_hash(), sim.state_hash(), "tick {t}: one step on");
        max_cal = max_cal.max(counter(&sim, PlayerId(1), CardId::Calluses));
        max_eighth = max_eighth.max(counter(&sim, PlayerId(5), CardId::EighthStrike));
    }
    assert!(max_cal > 0.07, "Calluses counted: {max_cal}");
    assert!(max_eighth >= 3., "Eighth Strike counted: {max_eighth}");
    assert_eq!(
        counter(&sim, PlayerId(3), CardId::ExecutionersLedger),
        3.,
        "the Ledger holder killed its 1 hp victim"
    );
}
