//! P-AUG-POOL-1 oracle: the Rework chest pool and its offer rules (live world only).
//!
//! Plan of record `docs/backlog/AUGMENT_ELITE_REWORK.md` (P-AUG-POOL-1 row and details, decision 5, Appendix A "Eye for
//! an Eye"); brief `docs/backlog/packets/P-AUG-POOL-1.md`. Loose proof (owner direction 2026-11-10): one rough test per
//! claim, except the Legacy world, whose offers and reward draws are pinned exactly to the integration head.
//!
//! 1. The pool: `REWORK_POOL` is `INTERACTIVE` plus five built augments; `INTERACTIVE` and the Legacy table unchanged.
//! 2. Decision 5: a `Faction(f)` entry is offered only when every eligible picker is faction `f` (a test-only table).
//! 3. Eye for an Eye is offered more often when a picker owns a returned-damage source (Spiked Shell); direction only.
//! 4. The training console grants and rolls the world's pool.
//! 5. Restore: a Rework camp chest with new pool cards restores; a camp chest outside the rule's pool is refused.
use super::*;
use crate::cards::{CardId, CardKind, Tuning};
use crate::{AugmentRule, FactionId, Placement, Secrets, Sim, SimConfig};

/// The five built augments the Rework pool adds (a fn, not a const: `tests/content.rs` scans every const).
fn new_in_rework() -> [CardId; 5] {
    [
        CardId::Committed,
        CardId::FistsOfFury,
        CardId::MachineGun,
        CardId::HereComesTheBoom,
        CardId::RaceToZero,
    ]
}

fn config(rule: AugmentRule) -> SimConfig {
    SimConfig {
        quests: false,
        consumables: true,
        pvp_rules: false,
        augments: rule,
        ..Default::default()
    }
}

/// A walled 32x24 room with one player per faction given, standing side by side (ids 1, 2, ...).
fn room(rule: AugmentRule, factions: &[FactionId], seed: u64) -> Sim {
    let rows = (0..24)
        .map(|y| {
            (0..32)
                .map(|x| {
                    if x == 0 || y == 0 || x == 31 || y == 23 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>();
    let arena = crate::Arena {
        map: crate::map::TileMap::from_rows(&rows).unwrap(),
        spawns: (0..8)
            .map(|i| Vec2::new(200. + f64::from(i) * 60., 320.))
            .collect(),
    };
    let ps: Vec<Placement> = factions
        .iter()
        .enumerate()
        .map(|(i, f)| Placement {
            profile: format!("POOL{i}"),
            faction: *f,
            bot: false,
            at: Vec2::new(200. + i as f64 * 40., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        config(rule),
        arena,
        Secrets {
            reward_salt: [9, 8, 7, u32::try_from(seed).unwrap()],
            ..Secrets::from_seed(seed)
        },
        &ps,
    )
}

fn card_options(c: &Chest) -> Vec<CardId> {
    c.options
        .iter()
        .flatten()
        .map(|o| match o {
            OptionId::Card(id) => *id,
            other => panic!("an augment chest offered {other:?}"),
        })
        .collect()
}

/// Drops one augment chest for `eligible` with `tuning` and returns its card options (the chest is then removed, so
/// the world never fills up; the reward RNG keeps running).
fn drop_once(
    tuning: &Tuning,
    s: &mut Sim,
    camp: Option<u16>,
    zone: FactionId,
    elite: bool,
    eligible: &[PlayerId],
) -> Vec<CardId> {
    drop_augment_in(
        tuning,
        &mut s.w,
        Vec2::new(300., 320.),
        camp,
        zone,
        elite,
        eligible,
    );
    let c = s.w.reward_chests.pop().expect("a chest dropped");
    card_options(&c)
}

fn picker(build: &[CardId], faction: FactionId) -> Picker {
    Picker {
        build: crate::cards::Build::from_counts(build.iter().map(|c| (*c, 1))),
        faction,
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. The pool.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn the_rework_pool_is_interactive_plus_five_built_augments_and_legacy_is_unchanged() {
    // INTERACTIVE, byte for byte (legacy `cards.ts:646-649`, augment source order).
    assert_eq!(
        INTERACTIVE,
        [
            CardId::SlowBurn,
            CardId::Overkill,
            CardId::TankEngine,
            CardId::PocketSand,
            CardId::Gambler,
            CardId::ThirdTimesTheCharm,
            CardId::EyeForAnEye,
            CardId::BestOffense,
            CardId::PlantYourFeet,
            CardId::WishfulThinking,
            CardId::Hemorrhage,
            CardId::SpikedShell,
            CardId::Siphon,
            CardId::SecondWind,
        ]
    );
    let legacy = Tuning::of(&config(AugmentRule::Legacy));
    assert_eq!(legacy.pool(), &INTERACTIVE[..], "the Legacy table's pool");

    // REWORK_POOL: the 14 plus the five, each once.
    let mut want: Vec<CardId> = INTERACTIVE.to_vec();
    want.extend(new_in_rework());
    want.sort_by_key(|c| c.index());
    let mut got: Vec<CardId> = REWORK_POOL.to_vec();
    got.sort_by_key(|c| c.index());
    assert_eq!(
        got, want,
        "REWORK_POOL = INTERACTIVE + Committed, Fists of Fury, Machine Gun, Here Comes the Boom, A Race to 0"
    );
    for live in [config(AugmentRule::Rework), SimConfig::live_content()] {
        assert_eq!(
            Tuning::of(&live).pool(),
            REWORK_POOL,
            "the Rework table's pool"
        );
    }

    // No new id: every pool card is a live augment of the 80-card catalog, below 80 on the wire.
    assert_eq!(CardId::ALL.len(), 80);
    for id in REWORK_POOL {
        assert!(id.index() < 80, "{id:?}");
        assert_eq!(id.definition().kind, CardKind::Augment, "{id:?}");
        assert!(id.definition().ready, "{id:?}");
    }

    // The pool a chest draws from: the five are offered under Rework (a picker who holds none of them), never under
    // Legacy; both real tables hold only `Any` entries.
    let rework = Tuning::of(&config(AugmentRule::Rework));
    let nobody = [picker(&[], FactionId::Fire)];
    let offered = rework.offer_pool(&nobody);
    for id in new_in_rework() {
        assert!(
            offered.contains(&id),
            "{id:?} is offered under Rework: {offered:?}"
        );
        assert_eq!(rework.offer(id), Some(Offer::Any), "{id:?}");
        assert_eq!(legacy.offer(id), None, "{id:?} is not in the Legacy pool");
        assert!(!legacy.offer_pool(&nobody).contains(&id), "{id:?}");
    }
    assert_eq!(
        legacy.offer_pool(&nobody),
        augment_pool(&[nobody[0].build]),
        "the Legacy offer pool is the legacy rewardAugmentPool"
    );
    for id in REWORK_POOL {
        assert_eq!(rework.offer(*id), Some(Offer::Any), "{id:?}");
    }
    assert_eq!(
        rework.offer(CardId::GlassCannon),
        None,
        "Glass Cannon stays out of the pool"
    );
}

/// The Legacy world's chest offers and the reward RNG after them, over 240 drops (normal and elite, every zone, one or
/// two or no pickers, a Spiked Shell holder among them), are the integration head's (ec6d2c2a9): an FNV-1a fold of
/// every option id, a separator per chest, and the final four RNG words. Captured before this packet; must stay green.
#[test]
fn legacy_offers_and_draws_are_the_integration_heads() {
    let mut s = room(
        AugmentRule::Legacy,
        &[FactionId::Holy, FactionId::Fire, FactionId::Frost],
        31,
    );
    let k = s.k.clone();
    for (pid, cards) in [
        (PlayerId(1), &[CardId::SpikedShell, CardId::Ad1][..]),
        (PlayerId(2), &[CardId::Gambler, CardId::Siphon][..]),
        (PlayerId(3), &[CardId::SlowBurn, CardId::Overkill][..]),
    ] {
        for c in cards {
            assert!(crate::cards::grant(&k, &mut s.w, pid, *c));
        }
    }
    let groups: [&[PlayerId]; 5] = [
        &[PlayerId(1)],
        &[PlayerId(2)],
        &[PlayerId(1), PlayerId(2)],
        &[],
        &[PlayerId(1), PlayerId(2), PlayerId(3)],
    ];
    let zones = [
        FactionId::Fire,
        FactionId::Sentenced,
        FactionId::Plague,
        FactionId::Frost,
        FactionId::Holy,
    ];
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |b: u8| {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100_0000_01b3);
    };
    for i in 0..240usize {
        let options = drop_once(
            k.cards,
            &mut s,
            Some(0),
            zones[i % 5],
            i % 3 == 0,
            groups[(i / 5) % 5],
        );
        for o in options {
            eat(o.index() as u8);
        }
        eat(0xff);
    }
    for w in s.w.reward_rng.words() {
        for b in w.to_le_bytes() {
            eat(b);
        }
    }
    assert_eq!(
        h, 7_584_048_234_977_959_617,
        "the Legacy chest offers or reward draws moved"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Decision 5: per-card offer rule.
// ---------------------------------------------------------------------------------------------------------------------

/// A test-only table: INTERACTIVE plus Glass Cannon as a Frost-only card (no real faction card exists until
/// P-AUG-NATIVE-4).
fn doctored_pool() -> &'static [CardId] {
    Box::leak(Box::new([
        CardId::SlowBurn,
        CardId::Overkill,
        CardId::TankEngine,
        CardId::PocketSand,
        CardId::Gambler,
        CardId::ThirdTimesTheCharm,
        CardId::EyeForAnEye,
        CardId::BestOffense,
        CardId::PlantYourFeet,
        CardId::WishfulThinking,
        CardId::Hemorrhage,
        CardId::SpikedShell,
        CardId::Siphon,
        CardId::SecondWind,
        CardId::GlassCannon,
    ]))
}
fn doctored_faction() -> &'static [(CardId, FactionId)] {
    Box::leak(Box::new([(CardId::GlassCannon, FactionId::Frost)]))
}

#[test]
fn a_faction_card_is_offered_only_when_every_eligible_picker_is_that_faction() {
    let t = Tuning::for_test_pool(AugmentRule::Rework, doctored_pool(), doctored_faction());
    assert_eq!(
        t.offer(CardId::GlassCannon),
        Some(Offer::Faction(FactionId::Frost))
    );
    assert_eq!(t.offer(CardId::SlowBurn), Some(Offer::Any));
    let frost = picker(&[], FactionId::Frost);
    let fire = picker(&[], FactionId::Fire);
    let cases: [(&[Picker], bool, &str); 6] = [
        (&[frost], true, "one Frost picker"),
        (&[frost, frost], true, "two Frost pickers"),
        (&[frost, fire], false, "a Frost and a Fire picker"),
        (&[fire, frost], false, "a Fire and a Frost picker"),
        (&[fire], false, "one Fire picker"),
        (&[], false, "no eligible picker (decided: no faction card)"),
    ];
    for (pickers, offered, what) in cases {
        let pool = t.offer_pool(pickers);
        assert_eq!(
            pool.contains(&CardId::GlassCannon),
            offered,
            "{what}: {pool:?}"
        );
        assert!(
            pool.contains(&CardId::SlowBurn),
            "{what}: an Any card is offered to everyone"
        );
    }

    // Through the real drop: a Fire picker's chests never offer the Frost card; a Frost picker's do.
    let mut s = room(AugmentRule::Rework, &[FactionId::Fire, FactionId::Frost], 5);
    let (mut fire_saw, mut frost_saw) = (0, 0);
    for i in 0..400 {
        let zone = [FactionId::Fire, FactionId::Plague][i % 2];
        fire_saw += usize::from(
            drop_once(&t, &mut s, Some(0), zone, true, &[PlayerId(1)])
                .contains(&CardId::GlassCannon),
        );
        frost_saw += usize::from(
            drop_once(&t, &mut s, Some(0), zone, true, &[PlayerId(2)])
                .contains(&CardId::GlassCannon),
        );
        let both = drop_once(&t, &mut s, Some(0), zone, true, &[PlayerId(2), PlayerId(1)]);
        assert!(
            !both.contains(&CardId::GlassCannon),
            "a mixed chest offered the Frost card"
        );
    }
    assert_eq!(fire_saw, 0, "a Fire picker was offered the Frost-only card");
    assert!(
        frost_saw >= 20,
        "a Frost picker was offered the Frost-only card {frost_saw} times in 400 chests"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Eye for an Eye weighting.
// ---------------------------------------------------------------------------------------------------------------------

/// How many of `n` Fire-zone elite chests for player 1 (holding `held`) offer Eye for an Eye.
fn eye_offers(rule: AugmentRule, held: CardId, n: usize, seed: u64) -> usize {
    let mut s = room(rule, &[FactionId::Fire], seed);
    let k = s.k.clone();
    assert!(crate::cards::grant(&k, &mut s.w, PlayerId(1), held));
    (0..n)
        .filter(|i| {
            drop_once(
                k.cards,
                &mut s,
                Some(0),
                FactionId::Fire,
                i % 2 == 0,
                &[PlayerId(1)],
            )
            .contains(&CardId::EyeForAnEye)
        })
        .count()
}

/// Spiked Shell (a `Return` row: a returned-damage source) against Siphon (same tier, in the pool, no source): the same
/// pool sizes per tier, so without weighting the two shares match. Under Rework the Spiked Shell holder sees Eye for an
/// Eye clearly more often (proposed weight 2: about 1.5-1.8x per chest); under Legacy no weighting.
#[test]
fn eye_for_an_eye_is_offered_more_often_to_a_returned_damage_source_owner_under_rework_only() {
    assert_eq!(CardId::SpikedShell.tier(), CardId::Siphon.tier());
    let n = 3000;
    let (mut with, mut without, mut legacy_with, mut legacy_without) = (0, 0, 0, 0);
    for seed in [41u64, 42] {
        with += eye_offers(AugmentRule::Rework, CardId::SpikedShell, n, seed);
        without += eye_offers(AugmentRule::Rework, CardId::Siphon, n, seed);
        legacy_with += eye_offers(AugmentRule::Legacy, CardId::SpikedShell, n, seed);
        legacy_without += eye_offers(AugmentRule::Legacy, CardId::Siphon, n, seed);
    }
    assert!(
        without > 300,
        "the baseline share is too small to read: {without}"
    );
    let ratio = with as f64 / without as f64;
    assert!(
        (1.2..=3.0).contains(&ratio),
        "Rework: Eye for an Eye offered {with} times to a Spiked Shell holder vs {without} to a Siphon holder \
         (ratio {ratio:.2}; want a modest boost, 1.2..=3.0)"
    );
    let legacy_ratio = legacy_with as f64 / legacy_without as f64;
    assert!(
        (0.85..=1.15).contains(&legacy_ratio),
        "Legacy has no weighting: {legacy_with} vs {legacy_without} (ratio {legacy_ratio:.2})"
    );
}

/// A Rework chest whose pickers own no returned-damage source is the plain tiered roll over the offer pool: the same
/// options and the same reward draws as `roll_with` (weighting adds no draw and changes nothing without a source).
#[test]
fn a_rework_chest_without_a_source_is_the_plain_roll_over_the_offer_pool() {
    let mut s = room(
        AugmentRule::Rework,
        &[FactionId::Holy, FactionId::Plague],
        17,
    );
    let k = s.k.clone();
    assert!(crate::cards::grant(
        &k,
        &mut s.w,
        PlayerId(1),
        CardId::Gambler
    ));
    assert!(crate::cards::grant(
        &k,
        &mut s.w,
        PlayerId(2),
        CardId::Committed
    ));
    let pickers: Vec<Picker> = [PlayerId(1), PlayerId(2)]
        .iter()
        .map(|id| {
            let p = s.w.player(*id).unwrap();
            Picker {
                build: p.build,
                faction: p.faction(),
            }
        })
        .collect();
    for i in 0..200usize {
        let zone = [FactionId::Holy, FactionId::Frost, FactionId::Fire][i % 3];
        let elite = i % 2 == 0;
        let mut rng = s.w.reward_rng.clone();
        let pool = k.cards.offer_pool(&pickers);
        let mut draw = || rng.next_f64();
        let want = roll_with(&mut draw, &pool, elite, Some(zone));
        let got = drop_once(
            k.cards,
            &mut s,
            Some(0),
            zone,
            elite,
            &[PlayerId(1), PlayerId(2)],
        );
        assert_eq!(got, want, "chest {i}");
        assert_eq!(s.w.reward_rng, rng, "chest {i}: the reward draws");
    }
    // The five new cards do reach Rework chests (tier 3 included: Committed is held by one picker only).
    let mut seen = Vec::new();
    for i in 0..300usize {
        for id in drop_once(
            k.cards,
            &mut s,
            Some(0),
            FactionId::Plague,
            i % 2 == 0,
            &[PlayerId(1)],
        ) {
            if !seen.contains(&id) {
                seen.push(id);
            }
        }
    }
    for id in new_in_rework() {
        assert!(
            seen.contains(&id),
            "{id:?} never offered in 300 Rework chests"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. The training console.
// ---------------------------------------------------------------------------------------------------------------------

fn training(rule: AugmentRule) -> Sim {
    let config = SimConfig {
        min_players: 1,
        lobby_seconds: 0.,
        fill_seconds: 0.,
        training: true,
        dummies: false,
        augments: rule,
        ..Default::default()
    };
    let mut sim = Sim::new(
        config,
        crate::arenas::practice_arena(),
        Secrets::from_seed(7),
    );
    sim.add_player("p0", Some(FactionId::Holy), false).unwrap();
    sim.step();
    sim
}

fn train(sim: &mut Sim, command: u8, id: u32, count: u64) {
    let raw = crate::input::TrainRaw {
        command,
        id,
        count,
        options: [0; 3],
        option_count: 0,
    };
    let cmd = crate::input::validate(crate::RawCommand::Train(raw)).expect("valid train command");
    let pid = sim.w.players[0].id;
    sim.submit(pid, cmd)
        .expect("a training world takes the console");
}

#[test]
fn the_training_console_grants_and_rolls_the_worlds_pool() {
    for rule in [AugmentRule::Legacy, AugmentRule::Rework] {
        let mut sim = training(rule);
        train(&mut sim, 1, CardId::Committed.index() as u32, 1);
        sim.step();
        assert_eq!(
            sim.w.players[0].build.owns(CardId::Committed),
            rule == AugmentRule::Rework,
            "{rule:?}: the console grants Committed only from the Rework pool"
        );
        train(&mut sim, 1, CardId::GlassCannon.index() as u32, 1);
        sim.step();
        assert!(
            !sim.w.players[0].build.owns(CardId::GlassCannon),
            "{rule:?}: Glass Cannon is in neither pool"
        );
    }
    // Rolled console chests (no chosen option) offer only Rework pool cards, the new ones among them.
    let mut sim = training(AugmentRule::Rework);
    let mut seen = Vec::new();
    for _ in 0..60 {
        train(&mut sim, 4, 0, 0);
        sim.step();
        let c = sim
            .w
            .reward_chests
            .pop()
            .expect("the console dropped a chest");
        for id in card_options(&c) {
            // P-AUG-NATIVE-4: the world's offer pool also holds the native batch cards.
            assert!(sim.k.cards.in_pool(id), "{id:?} is not a Rework pool card");
            if !seen.contains(&id) {
                seen.push(id);
            }
        }
        for _ in 0..8 {
            sim.step();
        }
    }
    assert!(
        new_in_rework().iter().any(|id| seen.contains(id)),
        "60 Rework console chests never offered a new pool card: {seen:?}"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Restore.
// ---------------------------------------------------------------------------------------------------------------------

/// The room with one declared, already-available chest at player 1's feet.
fn with_chest(rule: AugmentRule, camp: Option<u16>, options: [CardId; 3]) -> Sim {
    let mut s = room(rule, &[FactionId::Fire, FactionId::Holy], 3);
    let id = s.w.next_entity_id();
    let at = s.w.players[0].pos();
    s.w.reward_chests.push(Chest {
        id,
        at,
        expires_at: s.w.server_time + DEFINITION.lifetime_ms,
        held_until_tick: s.w.tick,
        options: options.map(|c| Some(OptionId::Card(c))),
        taken: [None; 3],
        pickers: Vec::new(),
        camp,
        owner: None,
        first_pick: None,
    });
    s
}

fn restore(s: &Sim) -> Result<Sim, String> {
    serde_json::from_value::<Sim>(serde_json::to_value(s).unwrap()).map_err(|e| e.to_string())
}

#[test]
fn a_rework_camp_chest_with_new_pool_cards_restores_and_plays_on() {
    let new = [CardId::Committed, CardId::MachineGun, CardId::RaceToZero];
    let mut s = with_chest(AugmentRule::Rework, Some(0), new);
    let mut restored =
        restore(&s).expect("a Rework camp chest offering Rework pool cards restores");
    assert_eq!(s.state_hash(), restored.state_hash());
    let chest = s.w.reward_chests[0].id;
    for sim in [&mut s, &mut restored] {
        sim.step();
        let cmd = crate::validate(crate::RawCommand::Choose {
            chest_id: Some(chest),
            pick: 0,
        })
        .unwrap();
        sim.submit(PlayerId(1), cmd).unwrap();
    }
    for _ in 0..3 {
        assert_eq!(s.step(), restored.step());
        assert_eq!(s.state_hash(), restored.state_hash());
    }
    assert!(
        restored.w.players[0].build.owns(CardId::Committed),
        "the restored chest's pick grants Committed"
    );
}

#[test]
fn check_world_refuses_a_camp_chest_card_outside_the_rules_pool() {
    // Legacy: a Rework-only card in a camp chest is refused.
    let legacy = with_chest(
        AugmentRule::Legacy,
        Some(0),
        [CardId::Committed, CardId::SlowBurn, CardId::Siphon],
    );
    assert!(
        restore(&legacy).is_err(),
        "Legacy restored a camp chest offering Committed"
    );
    // Legacy: its own pool restores.
    let fine = with_chest(
        AugmentRule::Legacy,
        Some(0),
        [CardId::Gambler, CardId::SlowBurn, CardId::Siphon],
    );
    restore(&fine).expect("a Legacy camp chest of INTERACTIVE cards restores");
    // Rework: a card in neither pool is refused.
    let rework = with_chest(
        AugmentRule::Rework,
        Some(0),
        [CardId::Committed, CardId::GlassCannon, CardId::Siphon],
    );
    assert!(
        restore(&rework).is_err(),
        "Rework restored a camp chest offering Glass Cannon"
    );
    // The rule is about camp chests: a declared chest with no camp is not pool-checked (tests grant cards that way).
    let declared = with_chest(
        AugmentRule::Legacy,
        None,
        [CardId::Committed, CardId::GlassCannon, CardId::Ad1],
    );
    restore(&declared).expect("a camp-less declared chest is not pool-checked");
}
