//! P-AUG-NATIVE-4 oracle: the four faction-only native augments through the real hooks, a checkpoint mid-count, and the
//! readout rows. Brief `docs/backlog/packets/P-AUG-NATIVE-4.md`.
//!
//! Loose proof (owner direction 2026-11-10), numbers from the workbook's Augment_Tuning sheet via the registered
//! `REWORK_*` rows (read by name, so a retune moves the test with the row):
//! - Corpse Hoarder (Plague): +3% max HP per corpse harvested, cap 24%;
//! - Stoked (Fire): +2 AP per charged roaming burst, cap 30 (read: counted when the burst is QUEUED, see the brief);
//! - Glacier (Frost): +0.15 armor per chill second, cap 30 (read: 1.2 s per ranged chill, one tick per attack-chill
//!   source per tick while the victim's chill is below 1);
//! - Trophy Hunter (Sentenced): +2% damage per hunt stack, cap 15%.
//!
//! Worlds are `AugmentRule::Rework`; effects are measured against a control that differs only in the card.
use super::exemplars_tests::{attack, give, hits, registered, send, slot, slot_mut, wait_ready};
use super::hooks::{trace, NativeHook};
use super::{readouts, rule, Readout, ReadoutKind};
use crate::cards::CardId;
use crate::{
    arenas, AugmentRule, Event, FactionId, FactionMode, Placement, PlayerId, RawCommand, Secrets,
    Sim, SimConfig, Vec2, WeaponId,
};

fn reg(name: &str) -> f64 {
    registered(name).unwrap_or_else(|| panic!("{name} is a registered row"))
}

fn fseat(
    profile: &str,
    faction: FactionId,
    at: (f64, f64),
    weapon: Option<WeaponId>,
    hp: Option<f64>,
) -> Placement {
    Placement {
        profile: profile.into(),
        faction,
        bot: false,
        at: Vec2::new(at.0, at.1),
        hp,
        weapon0: weapon,
        weapon1: None,
    }
}

fn fworld(seats: &[Placement]) -> Sim {
    Sim::reset_active(
        SimConfig {
            augments: AugmentRule::Rework,
            consumables: true,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
            ..SimConfig::default()
        },
        arenas::practice_arena(),
        Secrets::from_seed(5),
        seats,
    )
}

fn mirrors(sim: &Sim, id: PlayerId) -> crate::stat_fold::StatMirrors {
    sim.w.player(id).unwrap().modifiers.mirrors()
}

fn max_hp(sim: &Sim, id: PlayerId) -> f64 {
    sim.w.player(id).unwrap().vitals.max_hp
}

fn fired(trace: &[(PlayerId, NativeHook)], who: PlayerId, hook: NativeHook) -> usize {
    trace
        .iter()
        .filter(|(p, h)| *p == who && *h == hook)
        .count()
}

// ---------------------------------------------------------------------------------------------------------------------
// Corpse Hoarder.
// ---------------------------------------------------------------------------------------------------------------------

/// Players 1 (holder) and 2 (control) are Plague, each with a corpse of a Holy bystander on its feet; players 3 and 4 are
/// the (living) bystanders far away.
fn corpse_world(counter: f64) -> Sim {
    let mut sim = fworld(&[
        fseat("holder", FactionId::Plague, (300., 272.), None, None),
        fseat("control", FactionId::Plague, (300., 400.), None, None),
        fseat("a", FactionId::Holy, (900., 272.), None, None),
        fseat("b", FactionId::Holy, (900., 400.), None, None),
    ]);
    give(&mut sim, PlayerId(1), CardId::CorpseHoarder);
    slot_mut(&mut sim, PlayerId(1), CardId::CorpseHoarder).counter = counter;
    for (corpse, at) in [(3, (300., 272.)), (4, (300., 400.))] {
        sim.w.plague_corpses.push(crate::state::PlagueCorpse {
            player: PlayerId(corpse),
            x: at.0,
            y: at.1,
        });
    }
    sim
}

/// Each harvested corpse adds `REWORK_CORPSE_HOARDER_PER` of max HP (of the faction's base) beyond what the control's
/// own corpse gave, in the tick of the harvest; the counter stops at the cap exactly.
#[test]
fn corpse_hoarder_adds_three_percent_max_hp_per_corpse_up_to_its_cap() {
    let (per, cap) = (
        reg("REWORK_CORPSE_HOARDER_PER"),
        reg("REWORK_CORPSE_HOARDER_CAP"),
    );
    assert_eq!((per, cap), (0.03, 0.24));
    assert_eq!(rule(CardId::CorpseHoarder).unwrap().counter_cap, cap);
    let base = crate::content::faction(FactionId::Plague).hp;
    let mut sim = corpse_world(0.);
    let _ = trace::take();
    let before = max_hp(&sim, PlayerId(1)) - max_hp(&sim, PlayerId(2));
    assert!(before.abs() < 1e-9, "same faction, no corpse yet: {before}");
    sim.step();
    let t = trace::take();
    assert_eq!(fired(&t, PlayerId(1), NativeHook::CorpseHarvest), 1);
    assert_eq!(
        sim.w.player(PlayerId(1)).unwrap().farm.corpse_stacks(),
        1,
        "the harvest happened"
    );
    assert!(
        (slot(&sim, PlayerId(1), CardId::CorpseHoarder).counter - per).abs() < 1e-12,
        "one corpse is one step"
    );
    let gain = max_hp(&sim, PlayerId(1)) - max_hp(&sim, PlayerId(2));
    assert!(
        (gain - per * base).abs() <= 0.02 * per * base,
        "holder {} control {} (gain {gain}, want {})",
        max_hp(&sim, PlayerId(1)),
        max_hp(&sim, PlayerId(2)),
        per * base
    );
    // The cap: half a step short of it, a corpse reaches it exactly.
    let mut sim = corpse_world(cap - per / 2.);
    sim.step();
    assert_eq!(slot(&sim, PlayerId(1), CardId::CorpseHoarder).counter, cap);
    let gain = max_hp(&sim, PlayerId(1)) - max_hp(&sim, PlayerId(2));
    assert!(
        (gain - cap * base).abs() <= 0.02 * cap * base,
        "at the cap: gain {gain}, want {}",
        cap * base
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Stoked.
// ---------------------------------------------------------------------------------------------------------------------

/// Players 1 (holder) and 2 (control) are Fire with a sword and a charged roaming burst, each beside a Holy victim
/// (players 3 and 4). Runs 30 ticks of one swing each; returns the sim, the tick the hook fired for the holder (the
/// burst was queued), the tick the burst's own hit (no weapon) reached the holder's victim and how many such hits.
fn stoked_run(counter: f64) -> (Sim, Option<u32>, Option<u32>, usize) {
    let mut sim = fworld(&[
        fseat(
            "holder",
            FactionId::Fire,
            (300., 272.),
            Some(WeaponId::Sword),
            None,
        ),
        fseat(
            "control",
            FactionId::Fire,
            (300., 400.),
            Some(WeaponId::Sword),
            None,
        ),
        fseat("a", FactionId::Holy, (336., 272.), None, None),
        fseat("b", FactionId::Holy, (336., 400.), None, None),
    ]);
    give(&mut sim, PlayerId(1), CardId::Stoked);
    slot_mut(&mut sim, PlayerId(1), CardId::Stoked).counter = counter;
    for i in 0..2 {
        sim.w.players[i].roam.ready = true;
    }
    wait_ready(&mut sim, PlayerId(1));
    let _ = trace::take();
    let (mut queued, mut landed, mut burst_hits) = (None, None, 0);
    send(&mut sim, PlayerId(1), RawCommand::Attack { a: 0., t: None });
    send(&mut sim, PlayerId(2), RawCommand::Attack { a: 0., t: None });
    for t in 0..30u32 {
        if t == 1 {
            send(
                &mut sim,
                PlayerId(1),
                RawCommand::Release { a: 0., t: None },
            );
            send(
                &mut sim,
                PlayerId(2),
                RawCommand::Release { a: 0., t: None },
            );
        }
        let ev = sim.step();
        if queued.is_none() && fired(&trace::take(), PlayerId(1), NativeHook::BurstLanded) > 0 {
            queued = Some(t);
        }
        for e in &ev {
            if let Event::Hit {
                victim,
                by: Some(by),
                weapon: None,
                ..
            } = e
            {
                if *by == PlayerId(1) && *victim == PlayerId(3) {
                    burst_hits += 1;
                    landed.get_or_insert(t);
                }
            }
        }
    }
    (sim, queued, landed, burst_hits)
}

/// A charged burst earns +2 AP once, the AP is on the holder's stat mirror (the control's is not), and the count reads
/// the hook where `fire_roam` queues the burst: strictly before the burst's own hit lands (brief section 1.3).
#[test]
fn stoked_adds_two_ap_per_burst_counted_when_the_burst_is_queued() {
    let (per, cap) = (reg("REWORK_STOKED_PER"), reg("REWORK_STOKED_CAP"));
    assert_eq!((per, cap), (2., 30.));
    assert_eq!(rule(CardId::Stoked).unwrap().counter_cap, cap);
    let (sim, queued, landed, burst_hits) = stoked_run(0.);
    assert_eq!(burst_hits, 1, "the holder's burst lands once on its victim");
    let (q, l) = (queued.expect("hook fired"), landed.expect("burst landed"));
    assert!(
        q < l,
        "the hook fires when the burst is queued (tick {q}), before it lands (tick {l})"
    );
    assert_eq!(slot(&sim, PlayerId(1), CardId::Stoked).counter, per);
    let gain = mirrors(&sim, PlayerId(1)).ap_bonus - mirrors(&sim, PlayerId(2)).ap_bonus;
    assert!((gain - per).abs() < 1e-9, "AP gain {gain}, want {per}");
    // The cap: from one point short a burst reaches it exactly.
    let (sim, _, _, _) = stoked_run(cap - 1.);
    assert_eq!(slot(&sim, PlayerId(1), CardId::Stoked).counter, cap);
    let gain = mirrors(&sim, PlayerId(1)).ap_bonus - mirrors(&sim, PlayerId(2)).ap_bonus;
    assert!((gain - cap).abs() < 1e-9, "AP gain at the cap {gain}");
}

// ---------------------------------------------------------------------------------------------------------------------
// Glacier.
// ---------------------------------------------------------------------------------------------------------------------

/// Ranged chill: every bow hit of a Frost holder on a victim chills it for `FROST_RANGED_CHILL_MS` (1.2 s) and earns
/// `REWORK_GLACIER_PER` per chill second, once per hit. The armor is on the holder's mirror, not the control's.
#[test]
fn glacier_earns_armor_per_ranged_chill_second_and_the_armor_shows() {
    let (per, cap) = (reg("REWORK_GLACIER_PER"), reg("REWORK_GLACIER_CAP"));
    assert_eq!((per, cap), (0.15, 30.));
    assert_eq!(rule(CardId::Glacier).unwrap().counter_cap, cap);
    let chill_s = reg("FROST_RANGED_CHILL_MS") / 1000.;
    let mut sim = fworld(&[
        fseat(
            "holder",
            FactionId::Frost,
            (100., 272.),
            Some(WeaponId::Bow),
            None,
        ),
        fseat(
            "control",
            FactionId::Frost,
            (100., 400.),
            Some(WeaponId::Bow),
            None,
        ),
        fseat("a", FactionId::Holy, (300., 272.), None, None),
        fseat("b", FactionId::Holy, (300., 400.), None, None),
    ]);
    give(&mut sim, PlayerId(1), CardId::Glacier);
    let _ = trace::take();
    let mut landed = 0;
    for _ in 0..3 {
        wait_ready(&mut sim, PlayerId(1));
        wait_ready(&mut sim, PlayerId(2));
        send(&mut sim, PlayerId(2), RawCommand::Attack { a: 0., t: None });
        let ev = attack(&mut sim, PlayerId(1), 0., 60);
        landed += hits(&ev, PlayerId(1), PlayerId(3)).len();
    }
    assert_eq!(landed, 3, "three arrows land");
    // Both readings at once: each of the 3 ranged hits is one hook of 1.2 s, and every other hook is one attack-chill
    // tick of `TICK_MS` (the holder's aura chills while its victim's chill is below 1).
    let n = fired(&trace::take(), PlayerId(1), NativeHook::ChillInflicted);
    assert!(n >= 3, "at least one chill hook per ranged hit ({n})");
    let ticks = (n - 3) as f64;
    let want = per * (3. * chill_s + ticks * crate::constants::TICK_MS / 1000.);
    let got = slot(&sim, PlayerId(1), CardId::Glacier).counter;
    assert!((got - want).abs() < 1e-9, "counter {got}, want {want}");
    let gain = mirrors(&sim, PlayerId(1)).armor_bonus - mirrors(&sim, PlayerId(2)).armor_bonus;
    // The armor mirror is wire-rounded to 0.1 (as for Calluses in `weapon_batch_tests`).
    assert!(
        (gain - want).abs() <= 0.05 + 1e-9,
        "armor gain {gain}, want {want}"
    );
}

/// Attack chill: a Frost holder beside a victim inflicts one tick (`TICK_MS`) of chill per tick while the victim's chill
/// is below 1 (every source counts); the counter is exactly `per * hooks * tick seconds` and stops at the cap.
#[test]
fn glacier_earns_one_tick_of_chill_per_tick_while_the_victims_chill_is_below_one() {
    let (per, cap) = (reg("REWORK_GLACIER_PER"), reg("REWORK_GLACIER_CAP"));
    let mut sim = fworld(&[
        fseat(
            "holder",
            FactionId::Frost,
            (300., 272.),
            Some(WeaponId::Sword),
            None,
        ),
        fseat("a", FactionId::Holy, (336., 272.), None, None),
    ]);
    give(&mut sim, PlayerId(1), CardId::Glacier);
    let _ = trace::take();
    let mut n = 0;
    for _ in 0..4 {
        wait_ready(&mut sim, PlayerId(1));
        attack(&mut sim, PlayerId(1), 0., 40);
        n += fired(&trace::take(), PlayerId(1), NativeHook::ChillInflicted);
    }
    assert!(n >= 10, "the sword's attack chill fired {n} times");
    let want = per * (n as f64) * crate::constants::TICK_MS / 1000.;
    let got = slot(&sim, PlayerId(1), CardId::Glacier).counter;
    assert!(
        (got - want).abs() < 1e-9,
        "counter {got}, want {want} from {n} tick hooks"
    );
    // The cap holds.
    slot_mut(&mut sim, PlayerId(1), CardId::Glacier).counter = cap - 0.001;
    wait_ready(&mut sim, PlayerId(1));
    attack(&mut sim, PlayerId(1), 0., 40);
    assert_eq!(slot(&sim, PlayerId(1), CardId::Glacier).counter, cap);
}

// ---------------------------------------------------------------------------------------------------------------------
// Trophy Hunter.
// ---------------------------------------------------------------------------------------------------------------------

/// A Sentenced holder (player 1, sword) beside a one-hp Fire rival (player 2) and a Holy bystander (3).
fn hunt_world(card: bool, counter: f64, rival_hp: f64) -> Sim {
    let mut sim = fworld(&[
        fseat(
            "hunter",
            FactionId::Sentenced,
            (300., 272.),
            Some(WeaponId::Sword),
            None,
        ),
        fseat("rival", FactionId::Fire, (336., 272.), None, Some(rival_hp)),
        fseat("bystander", FactionId::Holy, (300., 400.), None, None),
    ]);
    if card {
        give(&mut sim, PlayerId(1), CardId::TrophyHunter);
        slot_mut(&mut sim, PlayerId(1), CardId::TrophyHunter).counter = counter;
    }
    sim
}

/// A completed hunt pays one stack: +2% damage per stack, cap 15%, through the real hunt hook.
#[test]
fn trophy_hunter_earns_two_percent_per_hunt_stack_up_to_its_cap() {
    let (per, cap) = (
        reg("REWORK_TROPHY_HUNTER_PER"),
        reg("REWORK_TROPHY_HUNTER_CAP"),
    );
    assert_eq!((per, cap), (0.02, 0.15));
    assert_eq!(rule(CardId::TrophyHunter).unwrap().counter_cap, cap);
    for (start, want) in [(0., per), (cap - per / 2., cap)] {
        let mut sim = hunt_world(true, start, 1.);
        send(
            &mut sim,
            PlayerId(1),
            RawCommand::HuntTarget { id: PlayerId(2) },
        );
        sim.step();
        let _ = trace::take();
        wait_ready(&mut sim, PlayerId(1));
        attack(&mut sim, PlayerId(1), 0., 40);
        assert_eq!(
            sim.w.player(PlayerId(1)).unwrap().hunt_stacks,
            1,
            "the hunt completed"
        );
        assert_eq!(
            fired(&trace::take(), PlayerId(1), NativeHook::HuntStack),
            1,
            "one hunt hook"
        );
        let got = slot(&sim, PlayerId(1), CardId::TrophyHunter).counter;
        assert!(
            (got - want).abs() < 1e-12,
            "from {start}: counter {got}, want {want}"
        );
    }
}

/// The counter is a damage share: a holder at the cap hits (1 + 0.15) times as hard as the same fighter without it.
#[test]
fn trophy_hunter_share_multiplies_the_holders_hits() {
    let cap = reg("REWORK_TROPHY_HUNTER_CAP");
    let hit = |counter: f64| {
        let mut sim = hunt_world(true, counter, 500.);
        wait_ready(&mut sim, PlayerId(1));
        let ev = attack(&mut sim, PlayerId(1), 0., 40);
        let h = hits(&ev, PlayerId(1), PlayerId(2));
        assert_eq!(h.len(), 1, "counter {counter}: the swing lands once");
        h[0]
    };
    let (with, without) = (hit(cap), hit(0.));
    let r = with / without;
    let want = 1. + cap;
    assert!(
        (r - want).abs() <= 0.02 * want,
        "with {with} / without {without} = {r}, want {want}"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Readouts and checkpoint.
// ---------------------------------------------------------------------------------------------------------------------

/// Each owner sees its own faction card as a counter row with the rule's cap, and nobody else's.
#[test]
fn readouts_show_each_faction_card_as_a_counter_to_its_owner_only() {
    let mut sim = fworld(&[
        fseat("p", FactionId::Plague, (300., 272.), None, None),
        fseat("f", FactionId::Fire, (300., 400.), None, None),
        fseat("z", FactionId::Frost, (500., 272.), None, None),
        fseat("s", FactionId::Sentenced, (500., 400.), None, None),
    ]);
    let cards = [
        CardId::CorpseHoarder,
        CardId::Stoked,
        CardId::Glacier,
        CardId::TrophyHunter,
    ];
    for (i, card) in cards.into_iter().enumerate() {
        let id = PlayerId(i as u32 + 1);
        give(&mut sim, id, card);
        let v = 0.5 * rule(card).unwrap().counter_cap;
        slot_mut(&mut sim, id, card).counter = v;
        assert_eq!(
            readouts(&sim, id).rows(),
            &[Readout {
                card,
                kind: ReadoutKind::Counter,
                value: v,
                max: rule(card).unwrap().counter_cap,
            }],
            "{card:?}: the owner's row"
        );
    }
}

/// A checkpoint taken at every tick of a run with a Corpse Hoarder and a Glacier holder mid-count (a corpse harvest, a
/// ranged chill) restores hash-exact and plays on identically.
#[test]
fn a_checkpoint_mid_count_restores_hash_exact_and_plays_on() {
    let mut sim = fworld(&[
        fseat("hoard", FactionId::Plague, (300., 272.), None, None),
        fseat(
            "ice",
            FactionId::Frost,
            (100., 400.),
            Some(WeaponId::Bow),
            None,
        ),
        fseat("a", FactionId::Holy, (900., 272.), None, None),
        fseat("b", FactionId::Holy, (300., 400.), None, None),
    ]);
    give(&mut sim, PlayerId(1), CardId::CorpseHoarder);
    give(&mut sim, PlayerId(2), CardId::Glacier);
    slot_mut(&mut sim, PlayerId(1), CardId::CorpseHoarder).counter = 0.06;
    slot_mut(&mut sim, PlayerId(2), CardId::Glacier).counter = 1.5;
    // Glacier's counter feeds the validated armor fold: refold after the hand set, as a hook would.
    crate::modifiers::recompute(&sim.k, &mut sim.w, crate::fighter::FighterIx::of_slot(1));
    // A real death leaves the corpse (a checkpoint refuses a corpse of a living player), moved to the holder's feet.
    sim.w.players[2].body.x = 300.;
    let mut ev = Vec::new();
    crate::systems::settle::down_player(&sim.k, &mut sim.w, &mut ev, None, 2, crate::Outcome::Died);
    assert_eq!(sim.w.plague_corpses.len(), 1);
    for t in 0..120u32 {
        let cp = serde_json::to_value(&sim).unwrap();
        let mut copy = Sim::restore(&cp).unwrap_or_else(|e| panic!("tick {t}: {e:?}"));
        assert_eq!(copy.state_hash(), sim.state_hash(), "tick {t}: restore");
        for s in [&mut sim, &mut copy] {
            if t % 30 == 0 {
                send(s, PlayerId(2), RawCommand::Attack { a: 0., t: None });
            }
            if t % 30 == 1 {
                send(s, PlayerId(2), RawCommand::Release { a: 0., t: None });
            }
        }
        let (a, b) = (sim.step(), copy.step());
        assert_eq!(a, b, "tick {t}: events after restore");
        assert_eq!(copy.state_hash(), sim.state_hash(), "tick {t}: one step on");
    }
    assert!(
        slot(&sim, PlayerId(1), CardId::CorpseHoarder).counter > 0.06,
        "the harvest happened mid-run"
    );
    assert!(
        slot(&sim, PlayerId(2), CardId::Glacier).counter > 1.5,
        "a ranged chill happened mid-run"
    );
}
