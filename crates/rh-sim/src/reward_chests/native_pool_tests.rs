//! P-AUG-NATIVE-4 oracle: the native cards reach Rework chests through the batch tables' `POOL` rows (coordinator
//! decision 2026-11-20: this packet wires `cards::native::pool_members()` for all three tables), under the offer rule of
//! decision 5, with the Legacy pools untouched. Brief `docs/backlog/packets/P-AUG-NATIVE-4.md`.
//!
//! 1. Membership: under Rework every `pool_members()` row is in the chest pool with its `Offer`; the faction table's four
//!    are `Offer::Faction(own faction)`; Legacy has none of them and keeps its pool.
//! 2. The offer rule through real drops: a faction card shows only to a chest whose eligible pickers are all that
//!    faction; an `Any` native (Marksman's Tally, Bastion) shows to everyone; Legacy drops never carry a native.
//! 3. A Rework camp chest with native options restores; a Legacy one is refused.
//! 4. End to end: a Plague player picks Corpse Hoarder from a real chest, and the pick feeds its hook.
use super::*;
use crate::cards::native::pool_members;
use crate::cards::{CardId, Tuning};
use crate::{AugmentRule, FactionId, FactionMode, Placement, Secrets, Sim, SimConfig};

fn config(rule: AugmentRule) -> SimConfig {
    SimConfig {
        quests: false,
        consumables: true,
        pvp_rules: false,
        augments: rule,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
        ..Default::default()
    }
}

/// One player per faction given, side by side on the practice arena (ids 1, 2, ...).
fn room(rule: AugmentRule, factions: &[FactionId], seed: u64) -> Sim {
    let ps: Vec<Placement> = factions
        .iter()
        .enumerate()
        .map(|(i, f)| Placement {
            profile: format!("NP{i}"),
            faction: *f,
            bot: false,
            at: Vec2::new(300. + i as f64 * 40., 272.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        config(rule),
        crate::arenas::practice_arena(),
        Secrets {
            reward_salt: [9, 8, 7, u32::try_from(seed).unwrap()],
            ..Secrets::from_seed(seed)
        },
        &ps,
    )
}

fn options(c: &Chest) -> Vec<CardId> {
    c.options
        .iter()
        .flatten()
        .filter_map(|o| match o {
            OptionId::Card(id) => Some(*id),
            _ => None,
        })
        .collect()
}

fn drop_once(tuning: &Tuning, s: &mut Sim, elite: bool, eligible: &[PlayerId]) -> Vec<CardId> {
    drop_augment_in(
        tuning,
        &mut s.w,
        Vec2::new(300., 272.),
        Some(0),
        FactionId::Plague,
        elite,
        eligible,
    );
    options(&s.w.reward_chests.pop().expect("a chest dropped"))
}

fn faction_cards() -> [(CardId, FactionId); 4] {
    [
        (CardId::CorpseHoarder, FactionId::Plague),
        (CardId::Stoked, FactionId::Fire),
        (CardId::Glacier, FactionId::Frost),
        (CardId::TrophyHunter, FactionId::Sentenced),
    ]
}

/// Under Rework every table row is in the chest pool with its own offer rule; the faction rows are one-faction.
#[test]
fn the_rework_chest_pool_holds_every_batch_table_row_with_its_offer_rule() {
    let rework = Tuning::of(&config(AugmentRule::Rework));
    let legacy = Tuning::of(&config(AugmentRule::Legacy));
    let members: Vec<_> = pool_members().collect();
    for (card, offer) in &members {
        assert!(rework.in_pool(*card), "{card:?} in the Rework chest pool");
        assert_eq!(rework.offer(*card), Some(*offer), "{card:?}");
        assert!(!legacy.in_pool(*card), "{card:?} is not in the Legacy pool");
        assert_eq!(legacy.offer(*card), None, "{card:?}");
    }
    for card in [CardId::MarksmansTally, CardId::Bastion] {
        assert!(members.contains(&(card, Offer::Any)), "{card:?} is Any");
    }
    for (card, faction) in faction_cards() {
        assert!(
            members.contains(&(card, Offer::Faction(faction))),
            "{card:?} is offered to {faction:?} chests only"
        );
    }
    // The catalog's pool is unchanged (P-AUG-POOL-1's tests pin it): no native id in either `pool()`.
    assert_eq!(legacy.pool(), &INTERACTIVE[..]);
    assert_eq!(rework.pool(), REWORK_POOL);
    // A native that every picker holds is not offered; the Legacy offer pool is the legacy `rewardAugmentPool`.
    let nobody = [Picker {
        build: crate::cards::Build::default(),
        faction: FactionId::Plague,
    }];
    assert_eq!(
        legacy.offer_pool(&nobody),
        augment_pool(&[nobody[0].build]),
        "the Legacy offer pool"
    );
    assert!(rework.offer_pool(&nobody).contains(&CardId::CorpseHoarder));
    let holder = [Picker {
        build: crate::cards::Build::from_counts([(CardId::MarksmansTally, 1)]),
        faction: FactionId::Plague,
    }];
    assert!(
        !rework.offer_pool(&holder).contains(&CardId::MarksmansTally),
        "a card every picker holds is not offered"
    );
}

/// Over 400 chests per case and room seed: a faction card shows only to a chest whose pickers are all its faction; Any natives show to
/// everyone; a mixed chest carries no faction card; Legacy chests carry no native.
#[test]
fn a_faction_native_is_offered_only_to_an_all_that_faction_chest_and_legacy_offers_none() {
    let factions = [
        FactionId::Plague,
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Sentenced,
    ];
    // P-AUG-NATIVE-5 (oracle-amend, coordinator decision 2026-11-20): the positive controls are summed over four room
    // seeds (1600 chests per faction), so one seed's draws cannot sink a faction below its floor when the pool grows.
    // The room seeds of the sweep: four rooms, 1600 chests per faction.
    let seeds: [u64; 4] = [5, 6, 7, 8];
    // Own-faction card offered alone, summed over the seeds: measured Plague 67, Fire 61, Frost 66, Sentenced 64 without
    // Marked Man in the pool and 70, 53, 60, 54 with it; the floor is about 60% of the lowest (53).
    let own_floor = 32;
    // An Any native (Marksman's Tally or Bastion) in the same chests: measured 125, 128, 113, 132 without Marked Man and
    // 109, 108, 115, 127 with it; about 60% of the lowest (108).
    let any_floor = 65;
    let t = Tuning::of(&config(AugmentRule::Rework));
    let mut own = [0usize; 4];
    let mut any_seen = [0usize; 4];
    for seed in seeds {
        let mut s = room(AugmentRule::Rework, &factions, seed);
        for i in 0..400usize {
            let elite = i % 2 == 0;
            for (f, (card, faction)) in faction_cards().into_iter().enumerate() {
                let pid = PlayerId(f as u32 + 1);
                assert_eq!(factions[f], faction);
                let alone = drop_once(t, &mut s, elite, &[pid]);
                own[f] += usize::from(alone.contains(&card));
                for (other, of) in faction_cards() {
                    assert!(
                        other == card || !alone.contains(&other),
                        "seed {seed}: a {faction:?} chest offered {other:?} ({of:?}'s card)"
                    );
                }
                any_seen[f] += usize::from(
                    alone.contains(&CardId::MarksmansTally) || alone.contains(&CardId::Bastion),
                );
                let mixed = drop_once(t, &mut s, elite, &[pid, PlayerId((f as u32 + 1) % 4 + 1)]);
                for (other, _) in faction_cards() {
                    assert!(
                        !mixed.contains(&other),
                        "seed {seed}: a mixed chest offered {other:?}"
                    );
                }
            }
        }
    }
    for f in 0..4 {
        assert!(
            own[f] >= own_floor,
            "faction {f}: own card in {} of 1600 chests",
            own[f]
        );
        assert!(
            any_seen[f] >= any_floor,
            "faction {f}: an Any native in {} of 1600",
            any_seen[f]
        );
    }
    let legacy = Tuning::of(&config(AugmentRule::Legacy));
    let mut s = room(AugmentRule::Legacy, &factions, 5);
    for i in 0..200usize {
        for id in drop_once(legacy, &mut s, i % 2 == 0, &[PlayerId(1 + (i % 4) as u32)]) {
            assert!(id.index() < 80, "a Legacy chest offered {id:?}");
        }
    }
}

fn with_chest(rule: AugmentRule, options: [CardId; 3]) -> Sim {
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
        camp: Some(0),
        owner: None,
        first_pick: None,
    });
    s
}

/// A Rework camp chest offering natives of the table (Any rows and a faction row) restores and plays on identically; the
/// same chest in a Legacy world is refused.
#[test]
fn a_rework_camp_chest_with_native_cards_restores_and_a_legacy_one_is_refused() {
    let opts = [
        CardId::MarksmansTally,
        CardId::Bastion,
        CardId::CorpseHoarder,
    ];
    let s = with_chest(AugmentRule::Rework, opts);
    let cp = serde_json::to_value(&s).unwrap();
    let mut restored = Sim::restore(&cp).expect("a Rework chest offering pool natives restores");
    let mut s = s;
    assert_eq!(s.state_hash(), restored.state_hash());
    for _ in 0..3 {
        assert_eq!(s.step(), restored.step());
        assert_eq!(s.state_hash(), restored.state_hash());
    }
    let legacy = with_chest(AugmentRule::Legacy, opts);
    assert!(
        Sim::restore(serde_json::to_value(&legacy).unwrap()).is_err(),
        "a Legacy chest offering natives is refused"
    );
}

/// End to end: over a sweep of seeds a Plague player's real chest drop offers Corpse Hoarder; the player picks it with
/// the real `Choose` command, holds it, harvests a corpse, and the hook moves the counter.
#[test]
fn a_native_card_picked_from_a_rework_chest_feeds_its_hook() {
    let mut found = 0;
    for seed in 1..=40u64 {
        let mut s = room(AugmentRule::Rework, &[FactionId::Plague], seed);
        let k = s.k.clone();
        let at = s.w.players[0].pos();
        drop_augment_in(
            k.cards,
            &mut s.w,
            at,
            None,
            FactionId::Plague,
            false,
            &[PlayerId(1)],
        );
        let chest = s.w.reward_chests.last().unwrap().clone();
        let Some(pick) = options(&chest)
            .iter()
            .position(|c| *c == CardId::CorpseHoarder)
        else {
            continue;
        };
        found += 1;
        for _ in 0..(DEFINITION.birth_hold_ticks + 2) {
            s.step();
        }
        let cmd = crate::validate(crate::RawCommand::Choose {
            chest_id: Some(chest.id),
            pick: pick as i8,
        })
        .unwrap();
        s.submit(PlayerId(1), cmd).unwrap();
        s.step();
        let p = s.w.player(PlayerId(1)).unwrap();
        assert!(
            p.build.native().slot(CardId::CorpseHoarder).unwrap().count == 1,
            "seed {seed}: the pick granted Corpse Hoarder"
        );
        s.w.plague_corpses.push(crate::state::PlagueCorpse {
            player: PlayerId(9),
            x: p.body.x,
            y: p.body.y,
        });
        s.step();
        let got =
            s.w.player(PlayerId(1))
                .unwrap()
                .build
                .native()
                .slot(CardId::CorpseHoarder)
                .unwrap()
                .counter;
        assert!(
            (got - crate::constants::REWORK_CORPSE_HOARDER_PER).abs() < 1e-12,
            "seed {seed}: the harvest fed the hook ({got})"
        );
        if found == 3 {
            break;
        }
    }
    assert!(
        found >= 3,
        "Corpse Hoarder was offered on {found} of 40 seeds"
    );
}
