//! P-AUG-NATIVE-5 oracle (stacks): Marked Man's holder is paid 1.5 x the legacy 3 stat stacks for every credited normal
//! mob kill (`REWORK_MARKED_MAN_STACK_MULT`, decision 9: "+50% stacks from kills (not double)"); whole stacks are paid at
//! once and the half is carried in the card's native counter, so kills pay 4, 5, 4, 5, ... Nothing else is multiplied
//! (the Rework elite helper share included). The carry survives a checkpoint, `check_world` admits only 0 and the cap,
//! and the card is offered to every picker by Rework chests only. Brief `docs/backlog/packets/P-AUG-NATIVE-5.md`.
//!
//! Loose proof (owner direction 2026-11-10): the numbers through the real `pay` path (awards built from real camp mobs, as
//! `share_tests`), and once through real deaths (`hurt`, the payout queue).
use super::*;
use crate::cards::CardId;
use crate::constants::{ContentVal, REGISTRY};
use crate::mob_catalog::MobTypeId;
use crate::reward_chests::{Offer, Picker};
use crate::{
    Arena, AugmentRule, CampBuffRule, EliteRule, FactionId, Placement, Secrets, Sim, SimConfig,
    TileMap,
};

fn registered(name: &str) -> Option<f64> {
    REGISTRY
        .iter()
        .find(|e| e.name == name)
        .map(|e| match e.val {
            ContentVal::F64(v) => v,
            ContentVal::U64(v) => v as f64,
            ContentVal::I64(v) => v as f64,
        })
}
fn kill_stacks() -> u64 {
    crate::modifiers::farm::DEFINITION.kill_stacks
}
fn share() -> u64 {
    u64::from(crate::constants::REWORK_ELITE_SHARE_STACKS)
}

fn seed1_arena() -> Arena {
    let import: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("../../mapdata/fixtures/seed1.map.json")).unwrap();
    let actual = import.validate().unwrap();
    let spawns = actual
        .layers()
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    let (w, h, tiles, layers) = actual.into_parts();
    Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}

fn config(augments: AugmentRule) -> SimConfig {
    SimConfig {
        mob_mode: crate::mob_runtime::MobMode::Pve,
        initial_loot: true,
        consumables: true,
        camp_buffs: CampBuffRule::Legacy,
        elites: EliteRule::Rework,
        augments,
        ..Default::default()
    }
}

/// A seed1 world with two seated players (slot 0 and slot 1), mobs in their camps.
fn world(augments: AugmentRule) -> Sim {
    let arena = seed1_arena();
    let places: Vec<Placement> = (0..2)
        .map(|i| Placement {
            profile: format!("marked-{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: arena.spawns[i % arena.spawns.len()],
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(config(augments), arena, Secrets::from_seed(41), &places)
}

fn ids(s: &Sim) -> Vec<PlayerId> {
    s.players().iter().map(|p| p.id).collect()
}

/// Gives player slot `i` Marked Man (a Rework world only; its carry starts at 0).
fn give(s: &mut Sim, i: usize) {
    s.w.players[i].build.set(CardId::MarkedMan, 1);
}

/// The holder's carried stacks (Marked Man's native counter).
fn carry(s: &Sim, i: usize) -> f64 {
    s.w.players[i]
        .build
        .native
        .slot(CardId::MarkedMan)
        .map_or(f64::NAN, |slot| slot.counter)
}

/// Every farm stack player slot `i` holds, over all stat types.
fn stacks(s: &Sim, i: usize) -> u64 {
    MobTypeId::ALL
        .iter()
        .map(|&t| s.w.players[i].farm.count(t))
        .sum()
}

/// The first camp that has a normal (non-elite) mob, and one with an elite.
fn camp_with(s: &Sim, elite: bool) -> usize {
    s.mobs()
        .iter()
        .find(|m| m.elite == elite)
        .map(|m| m.camp as usize)
        .unwrap_or_else(|| panic!("premise: a camp with a mob (elite {elite})"))
}

/// The award of the camp's real mob (its elite or one of its normal mobs), as `hurt` builds it.
fn award_at(
    s: &Sim,
    camp: usize,
    elite: bool,
    killer: PlayerId,
    contributors: &[PlayerId],
) -> Award {
    let m = s
        .mobs()
        .iter()
        .find(|m| m.camp as usize == camp && m.elite == elite)
        .unwrap_or_else(|| panic!("camp {camp} has a mob (elite {elite})"));
    Award {
        mob: m.core.id,
        serial: 1,
        killer: Some(killer),
        camp: camp as u32,
        weapon: m.core.active_weapon(),
        at: m.core.pos(),
        elite,
        mob_type: m.mob_type.unwrap(),
        zone: m.core.faction_id().unwrap(),
        mult: 1.,
        contributors: contributors.to_vec(),
    }
}

fn pay_award(s: &mut Sim, a: Award) -> Vec<Event> {
    let mut events = vec![];
    pay(&s.k, &mut s.w, &mut events, a);
    // The end of a tick forgets the per-tick settled set; a checkpoint refuses an unsettled queue.
    s.w.pay.mob_settled.clear();
    events
}

/// One credited normal kill for player slot `i`; returns the stacks it paid.
fn normal_kill(s: &mut Sim, i: usize) -> u64 {
    let ps = ids(s);
    let camp = camp_with(s, false);
    let before = stacks(s, i);
    let a = award_at(s, camp, false, ps[i], &[ps[i]]);
    pay_award(s, a);
    stacks(s, i) - before
}

#[test]
fn marked_man_numbers_are_registered_and_its_carry_cap_is_the_half_stack() {
    assert_eq!(kill_stacks(), 3, "legacy MOB_KILL_STACKS (mobLife.ts:265)");
    assert_eq!(
        registered("REWORK_MARKED_MAN_STACK_MULT"),
        Some(1.5),
        "decision 9: +50%, not double"
    );
    assert_eq!(
        registered("REWORK_MARKED_MAN_CARRY_CAP"),
        Some(0.5),
        "brief decision 3: the carry's cap is a registered content row"
    );
    let rule = crate::cards::native::rule(CardId::MarkedMan).expect("Marked Man's rule");
    assert_eq!(rule.counter_cap, 0.5, "the rule reads the cap");
    assert_eq!(
        (kill_stacks() as f64 * (1.5 - 1.)).fract(),
        rule.counter_cap,
        "the cap is the half stack one kill leaves over"
    );
}

#[test]
fn a_holders_normal_kills_pay_half_again_and_carry_the_half() {
    let mut s = world(AugmentRule::Rework);
    give(&mut s, 0);
    let mut paid = Vec::new();
    let mut carried = Vec::new();
    for _ in 0..6 {
        paid.push(normal_kill(&mut s, 0));
        carried.push(carry(&s, 0));
    }
    assert_eq!(
        paid,
        [4, 5, 4, 5, 4, 5],
        "1.5 x 3 = 4.5 a kill: the whole stacks at once, the half with the next kill"
    );
    assert_eq!(carried, [0.5, 0., 0.5, 0., 0.5, 0.], "the carry, exactly");
    assert_eq!(paid.iter().sum::<u64>(), 27, "six kills pay 6 x 4.5");
    // The other player, without the card, is paid the legacy 3, and its slot stays empty.
    let other: Vec<u64> = (0..4).map(|_| normal_kill(&mut s, 1)).collect();
    assert_eq!(other, [3; 4], "a non-holder is paid as before");
    assert_eq!(carry(&s, 1), 0., "a non-holder's slot is never written");
    assert_eq!(
        s.w.players[1]
            .build
            .native
            .slot(CardId::MarkedMan)
            .unwrap()
            .count,
        0
    );
    // Decision 4: no readout row (a half stack is not a HUD number).
    assert!(
        crate::cards::native::readouts(&s, ids(&s)[0])
            .rows()
            .is_empty(),
        "Marked Man shows no readout"
    );
}

#[test]
fn legacy_and_card_free_worlds_pay_three_a_kill() {
    for rule in [AugmentRule::Legacy, AugmentRule::Rework] {
        let mut s = world(rule);
        let paid: Vec<u64> = (0..4).map(|_| normal_kill(&mut s, 0)).collect();
        assert_eq!(paid, [3; 4], "{rule:?}");
        assert_eq!(carry(&s, 0), 0., "{rule:?}");
    }
}

#[test]
fn real_normal_deaths_through_hurt_pay_the_holder_four_then_five() {
    let mut s = world(AugmentRule::Rework);
    give(&mut s, 0);
    let ps = ids(&s);
    let victims: Vec<_> = s
        .mobs()
        .iter()
        .filter(|m| !m.elite)
        .take(2)
        .map(|m| m.core.id)
        .collect();
    assert_eq!(victims.len(), 2, "premise: two normal mobs");
    let mut paid = Vec::new();
    for id in victims {
        let slot = s.w.mobs.iter().position(|m| m.core.id == id).unwrap();
        let ix = FighterIx::of_slot(s.w.players.len() + slot);
        let hp = s.w.mobs.get(id).unwrap().core.vitals.hp;
        let before = stacks(&s, 0);
        let mut ev = vec![];
        s.w.pay.collecting = true;
        hurt(
            &s.k,
            &mut s.w,
            &mut ev,
            ix,
            &[Hit {
                terrain: false,
                amount: hp + 1000.,
                by: Some(ps[0]),
                name: None,
            }],
        );
        assert_eq!(s.w.mobs.get(id).unwrap().status, Status::Dead, "premise");
        super::super::ledger::pay_all(&s.k, &mut s.w, &mut ev, &mut s.pf);
        s.w.pay.mob_settled.clear();
        paid.push(stacks(&s, 0) - before);
    }
    assert_eq!(paid, [4, 5], "two real kills pay 9 = 2 x 4.5");
    assert_eq!(carry(&s, 0), 0.);
}

#[test]
fn elite_kills_and_the_helper_share_are_not_multiplied() {
    let mut s = world(AugmentRule::Rework);
    give(&mut s, 0);
    let ps = ids(&s);
    assert_eq!(
        normal_kill(&mut s, 0),
        4,
        "premise: a carry of a half stack"
    );
    assert_eq!(carry(&s, 0), 0.5);
    let camp = camp_with(&s, true);
    let before = [stacks(&s, 0), stacks(&s, 1)];
    let a = award_at(&s, camp, true, ps[0], &ps);
    pay_award(&mut s, a);
    assert_eq!(
        [stacks(&s, 0) - before[0], stacks(&s, 1) - before[1]],
        [share(), share()],
        "the elite share is one camp's worth for the holder and the helper alike"
    );
    assert_eq!(
        carry(&s, 0),
        0.5,
        "an elite kill neither pays nor spends the carry"
    );
}

#[test]
fn a_holder_that_is_not_standing_keeps_its_carry() {
    let mut s = world(AugmentRule::Rework);
    give(&mut s, 0);
    assert_eq!(normal_kill(&mut s, 0), 4, "premise");
    s.w.players[0].status = Status::Dead;
    assert_eq!(normal_kill(&mut s, 0), 0, "a dead killer is paid nothing");
    assert_eq!(carry(&s, 0), 0.5, "and its carry does not move");
}

#[test]
fn a_checkpoint_mid_count_restores_hash_exact_and_pays_on() {
    let mut s = world(AugmentRule::Rework);
    give(&mut s, 0);
    assert_eq!(normal_kill(&mut s, 0), 4, "one kill: a half stack carried");
    assert_eq!(carry(&s, 0), 0.5);
    let back = Sim::restore(serde_json::to_value(&s).unwrap());
    assert!(
        back.is_ok(),
        "a Rework checkpoint with a carried half stack restores: {:?}",
        back.as_ref().err()
    );
    let mut back = back.unwrap();
    assert_eq!(back.state_hash(), s.state_hash(), "hash-exact");
    assert_eq!(carry(&back, 0), 0.5, "the carry round-trips");
    assert_eq!(normal_kill(&mut s, 0), 5);
    assert_eq!(normal_kill(&mut back, 0), 5, "the restored holder pays on");
    assert_eq!(back.state_hash(), s.state_hash());
}

#[test]
fn check_world_admits_only_no_carry_or_the_half_stack() {
    let base = world(AugmentRule::Rework);
    let cp = serde_json::to_value(&base).unwrap();
    let with = |counter: f64| {
        let mut cp = cp.clone();
        cp["world"]["players"][0]["build"]["native"] = serde_json::json!([{
            "card": "markedMan", "count": 1, "counter": counter, "meters": [0., 0., 0.], "marks": 0
        }]);
        Sim::restore(cp)
    };
    for ok in [0., 0.5] {
        let r = with(ok);
        assert!(r.is_ok(), "carry {ok} restores: {:?}", r.err());
    }
    for bad in [
        0.25,
        0.75,
        1.,
        1.5,
        -0.5,
        f64::from_bits(0.5f64.to_bits() + 1),
    ] {
        assert!(with(bad).is_err(), "carry {bad} is refused");
    }
}

#[test]
fn marked_man_is_offered_to_every_picker_by_rework_chests_only() {
    let rework = crate::cards::Tuning::of(&config(AugmentRule::Rework));
    let legacy = crate::cards::Tuning::of(&config(AugmentRule::Legacy));
    assert!(rework.in_pool(CardId::MarkedMan), "Rework chests offer it");
    assert_eq!(rework.offer(CardId::MarkedMan), Some(Offer::Any));
    assert!(!legacy.in_pool(CardId::MarkedMan));
    assert_eq!(legacy.offer(CardId::MarkedMan), None);
    for faction in FactionId::ALL {
        let picker = [Picker {
            build: crate::cards::Build::default(),
            faction,
        }];
        assert!(
            rework.offer_pool(&picker).contains(&CardId::MarkedMan),
            "{faction:?}: offered to every faction"
        );
        assert!(!legacy.offer_pool(&picker).contains(&CardId::MarkedMan));
        let holder = [Picker {
            build: crate::cards::Build::from_counts([(CardId::MarkedMan, 1)]),
            faction,
        }];
        assert!(
            !rework.offer_pool(&holder).contains(&CardId::MarkedMan),
            "{faction:?}: not offered to its holder (unique)"
        );
    }
}
