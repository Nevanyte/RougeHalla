//! Gathering Storm / MarkRate production tests: real card grants, ordinary validated attacks and 50 ms steps, real
//! Training Clear, restore/continuation and replay with the new progress. Expected values are the source's formulas and
//! the shipped catalog, never installed Mark outcomes.
use super::resistance_tests::{duel, duel_with_training, restore_continue};
use super::*;
use crate::cards::{CardId, CardRow};
use crate::input::{validate as validate_command, RawCommand, TrainRaw};
use crate::stat_fold::{EffectKind, EffectStat};
use crate::{FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, WeaponId};

fn next_mark_hit(s: &mut Sim) -> (f64, crate::fighter::Mark, crate::fighter::Mark) {
    for _ in 0..180 {
        let before = s.w.players[0].signature.clone();
        s.step();
        let after = s.w.players[0].signature.clone();
        if after.mark.hits > before.mark.hits {
            assert_eq!(after.mark.hits, before.mark.hits + 1);
            return (before.chill, before.mark, after.mark);
        }
    }
    panic!("a validated Sentenced attack must land a qualifying mark hit");
}

fn rate(s: &Sim) -> f64 {
    s.w.players[0].modifiers.mark_rate()
}

#[test]
fn the_helpers_derive_the_rate_from_the_shipped_catalog_and_keep_the_source_arithmetic() {
    assert!((crate::modifiers::maximum_mark_rate() - 1.5).abs() < 1e-12);
    let mut producers = Vec::new();
    for id in CardId::ALL {
        for row in id.definition().rows {
            if let CardRow::Fold(EffectKind::Stat {
                stat: EffectStat::MarkRate,
                v,
            }) = row
            {
                producers.push((id, *v));
            }
        }
    }
    assert_eq!(producers, vec![(CardId::GatheringStorm, 0.5)]);
    assert_eq!(
        crate::modifiers::mark_rate_of(&crate::stat_fold::StatSums::default()),
        1.
    );
    let chill = 0.808;
    assert_eq!(
        crate::modifiers::mark_progress_increment(1.5, chill),
        1.5 / chill
    );
    assert_eq!(
        crate::modifiers::mark_progress_increment(1.5, 0.001),
        1.5 / MARK_CHILL_FLOOR
    );
    let runtime = crate::modifiers::Runtime::default();
    assert_eq!(runtime.mark_rate(), 1.);
}

#[test]
fn gathering_storm_multiplies_real_progress_without_touching_counters_or_promotion() {
    let mut neutral = duel(&[], &[]);
    let (neutral_chill, neutral_before, neutral_after) = next_mark_hit(&mut neutral);
    assert_eq!(rate(&neutral), 1.);
    assert_eq!(neutral_after.hits, neutral_before.hits + 1);
    assert_eq!(
        neutral_after.progress,
        neutral_before.progress + crate::modifiers::mark_progress_increment(1., neutral_chill)
    );

    let mut storm = duel(&[CardId::GatheringStorm], &[]);
    let (chill, before, after) = next_mark_hit(&mut storm);
    assert_eq!(rate(&storm), 1.5);
    assert_eq!(after.hits, before.hits + 1);
    assert_eq!(after.swaps, before.swaps);
    assert_eq!(
        after.progress,
        before.progress + crate::modifiers::mark_progress_increment(1.5, chill)
    );
    assert!(after.progress > neutral_after.progress);

    // The existing promotion formula still reads only the counters and progress; the rate rides the progress it feeds.
    let mut flagged = duel(
        &[
            CardId::GatheringStorm,
            CardId::SwiftJudgment,
            CardId::NoCommutation,
        ],
        &[],
    );
    for _ in 0..120 {
        flagged.step();
    }
    let m = flagged.w.players[0].signature.mark;
    let swaps = (m.swaps as f64) * 2. + (m.hits / 2) as f64;
    let expected = (1.
        + (m.progress.max(0.) / MARK_TIER_HITS + MARK_TIER_EPS)
            .floor()
            .max(swaps))
    .min(MARK_TOP_TIER as f64) as u8;
    assert_eq!(m.tier, expected);
    assert!(m.progress > m.hits as f64);
}

#[test]
fn a_mid_mark_grant_keeps_the_past_and_uses_the_new_rate() {
    let mut s = duel(&[], &[]);
    let (chill, before, after) = next_mark_hit(&mut s);
    assert_eq!(rate(&s), 1.);
    assert_eq!(
        after.progress,
        before.progress + crate::modifiers::mark_progress_increment(1., chill)
    );
    let held = s.w.players[0].signature.mark;
    assert!(crate::cards::grant(
        &s.k,
        &mut s.w,
        PlayerId(1),
        CardId::GatheringStorm
    ));
    assert_eq!(
        s.w.players[0].signature.mark, held,
        "past increments are not recomputed"
    );
    assert_eq!(rate(&s), 1.5);
    let (chill2, before2, after2) = next_mark_hit(&mut s);
    assert_eq!(
        after2.progress,
        before2.progress + crate::modifiers::mark_progress_increment(1.5, chill2)
    );
    restore_continue(&mut s);
}

#[test]
fn real_training_clear_removes_gathering_storm_without_resetting_the_mark() {
    let mut s = duel_with_training(&[CardId::GatheringStorm], &[], true);
    assert_eq!(rate(&s), 1.5);
    let (chill, before, after) = next_mark_hit(&mut s);
    assert_eq!(
        after.progress,
        before.progress + crate::modifiers::mark_progress_increment(1.5, chill)
    );
    let held = s.w.players[0].signature.mark;
    let raw = RawCommand::Train(TrainRaw {
        command: 5,
        id: 0,
        count: 0,
        options: [0; 3],
        option_count: 0,
    });
    s.submit(
        PlayerId(1),
        validate_command(raw).expect("valid training clear"),
    )
    .unwrap();
    s.step();
    assert!(!s.w.players[0].build.owns(CardId::GatheringStorm));
    assert_eq!(
        s.w.players[0].signature.mark, held,
        "Clear does not reset the Mark"
    );
    assert_eq!(rate(&s), 1., "today's rate follows the removed card");
    restore_continue(&mut s);
    let (chill2, before2, after2) = next_mark_hit(&mut s);
    assert_eq!(
        after2.progress,
        before2.progress + crate::modifiers::mark_progress_increment(1., chill2)
    );
}

#[test]
fn restore_bounds_admit_the_catalog_maximum_history_and_refuse_beyond_it() {
    let mut s = duel(&[CardId::GatheringStorm], &[]);
    next_mark_hit(&mut s);
    let min_chill =
        (1. - FROST_SLOW - crate::modifiers::DEFINITION.frost_cap).max(MARK_CHILL_FLOOR);
    let max_increment =
        crate::modifiers::mark_progress_increment(crate::modifiers::maximum_mark_rate(), min_chill);
    let hits = s.w.players[0].signature.mark.hits;
    assert_eq!(hits, 1);
    // A progress only reachable with the unique producer's 1.5 rate is valid (the old 1.0-rate bound is not a ceiling).
    let mut ok = s.w.players[0].clone();
    ok.signature.mark.progress = 0.5 * (1. / min_chill + max_increment);
    ok.signature.mark.tier = 1;
    assert!(validate(&s.k, &s.w, &ok).is_ok());
    // At the derived maximum it is still valid; beyond it is refused.
    let mut at_max = ok.clone();
    at_max.signature.mark.progress = max_increment;
    at_max.signature.mark.tier = 2;
    assert!(validate(&s.k, &s.w, &at_max).is_ok());
    let mut too_high = ok.clone();
    too_high.signature.mark.progress = max_increment + 0.01;
    too_high.signature.mark.tier = 2;
    assert!(validate(&s.k, &s.w, &too_high).is_err());
    // The existing malformed/zero-hit/non-finite/counter refusals stay in force.
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.] {
        let mut p = s.w.players[0].clone();
        p.signature.mark.progress = bad;
        assert!(validate(&s.k, &s.w, &p).is_err());
    }
    let mut zero = s.w.players[0].clone();
    zero.signature.mark.hits = 0;
    assert!(validate(&s.k, &s.w, &zero).is_err());
    let mut big = s.w.players[0].clone();
    big.signature.mark.hits = 9_007_199_254_740_992;
    assert!(validate(&s.k, &s.w, &big).is_err());
    restore_continue(&mut s);
}

#[test]
fn real_checkpoint_restore_and_replay_continue_the_gathering_storm_mark() {
    use crate::replay::{run_replay, Recorder, ReplayInput, ReplayStart};
    let config = SimConfig {
        training: false,
        quests: false,
        consumables: false,
        pvp_rules: false,
        faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
        ..Default::default()
    };
    let placements: Vec<Placement> = [FactionId::Sentenced, FactionId::Frost]
        .into_iter()
        .enumerate()
        .map(|(i, faction)| Placement {
            profile: format!("p{i}"),
            faction,
            bot: false,
            at: crate::Vec2::new(400. + i as f64 * 30., 320.),
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: Some(WeaponId::Wand),
        })
        .collect();
    let mut sim = Sim::reset_active(
        config.clone(),
        crate::arenas::practice_arena(),
        Secrets::from_seed(12),
        &placements,
    );
    let mut rec = Recorder::new(
        &sim,
        config,
        ReplayStart::Active {
            placements: placements.clone(),
        },
    );
    for (by, target, a) in [(1, 2, 0.), (2, 1, crate::math::PI)] {
        let cmd = validate_command(RawCommand::Target {
            id: PlayerId(target),
        })
        .unwrap();
        sim.submit(PlayerId(by), cmd).unwrap();
        rec.record(ReplayInput::Command {
            player: PlayerId(by),
            cmd,
        });
        let cmd = validate_command(RawCommand::Attack { a, t: None }).unwrap();
        sim.submit(PlayerId(by), cmd).unwrap();
        rec.record(ReplayInput::Command {
            player: PlayerId(by),
            cmd,
        });
    }
    for _ in 0..120 {
        sim.step();
        rec.stepped(&sim);
        if sim.w.players[0].signature.mark.hits > 0 {
            break;
        }
    }
    assert!(sim.w.players[0].signature.mark.hits > 0);
    assert!(sim.w.players[0].signature.mark.progress > 0.);
    assert_eq!(rate(&sim), 1.);
    // A direct card grant is not a ReplayInput; card-specific continuation is covered by restore/continuation and the
    // mid-Mark grant test. This replay proves the recorded active run keeps the new accumulated Mark progress bit-exactly.
    let (replayed, _) = run_replay(&rec.replay).expect("the recorded active replay runs");
    assert_eq!(replayed.state_hash(), sim.state_hash());
    assert_eq!(
        replayed.w.players[0].signature.mark,
        sim.w.players[0].signature.mark
    );
    restore_continue(&mut sim);
}
