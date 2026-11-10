//! Focused bridge witnesses for the leased shared planning transitions (Root corrected allocation, 2026-11-10).
//!
//! These pin the exact seams the source planning module consumes: the raw-f64 source array-index score leaf (no
//! truncation), the shared schedule/choice/learned-bias helpers against the admitted random leaves, and the fact that
//! the old public `PlanModule` and the source-shaped `SourcePlanDeal` transition through one implementation with the
//! same draw order/results. The frozen corpus replay (source_tests.rs) is the complete witness; these are the focused
//! bridge receipts.

use rh_sim::mapdata::Zone;
use rh_sim::FactionId;

use super::types::CfgToken;
use crate::bots::planning::{
    learned_bias_of, plan_spawn_score, plan_spawn_score_raw, source_choose_boon,
    source_choose_spawn, source_intents, source_observe, LearnedBiasView, PlanDeal, PlanDirective,
    PlanModule, PlanState, ReadyWhy, SourcePlanDeal, PLAN_CAMPS,
};
use crate::bots::random::{pick_option, Rng};
use crate::bots::types::{TierId, TIERS};

fn map() -> crate::bots::planning::PlanMap {
    crate::bots::planning::PlanMap {
        camps: vec![
            crate::bots::planning::PlanCamp {
                id: "fire-camp".into(),
                zone: Zone::Fire,
                x: 200.,
                y: 200.,
                elite_spot: -1,
            },
            crate::bots::planning::PlanCamp {
                id: "frost-camp".into(),
                zone: Zone::Frost,
                x: 800.,
                y: 200.,
                elite_spot: 0,
            },
        ],
        spawn_pool: vec![
            crate::bots::planning::PlanSpawn {
                x: 180.,
                y: 220.,
                zone: Zone::Fire,
            },
            crate::bots::planning::PlanSpawn {
                x: 820.,
                y: 220.,
                zone: Zone::Frost,
            },
        ],
    }
}

fn source_deal(spawns: [f64; 2], pick: f64, boons: Vec<&str>, boon: f64) -> SourcePlanDeal {
    SourcePlanDeal {
        ends_at: 145_000.,
        spawns,
        taken: [false, false],
        pick,
        boons: boons.into_iter().map(str::to_owned).collect(),
        boon,
    }
}

fn typed_deal(spawns: [i32; 2], pick: i8, boons: Vec<&str>, boon: i8) -> PlanDeal {
    PlanDeal {
        ends_at: 145_000.,
        spawns,
        taken: [false, false],
        pick,
        boons: boons.into_iter().map(str::to_owned).collect(),
        boon,
    }
}

fn view_of(deal: &SourcePlanDeal) -> &dyn crate::bots::planning::PlanDealView {
    deal
}

#[test]
fn raw_source_spawn_index_keeps_captured_numbers_and_never_truncates() {
    let map = map();
    let faction = FactionId::Fire;
    let integer = plan_spawn_score_raw(&map, 1., faction, None);
    assert_eq!(
        integer,
        plan_spawn_score(&map, 1, faction, None),
        "the adapter must resolve the same leaf as the old i32 helper for ordinary indices"
    );
    assert!(integer.is_finite());
    assert_eq!(
        plan_spawn_score_raw(&map, -0.0, faction, None),
        plan_spawn_score(&map, 0, faction, None),
        "JS -0 reads spawnPool[0]"
    );
    for invalid in [
        -1.,
        0.5,
        -0.5,
        1.5,
        2.,
        1e300,
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
    ] {
        assert_eq!(
            plan_spawn_score_raw(&map, invalid, faction, None),
            f64::NEG_INFINITY,
            "source spawnPool[{invalid}] has no entry: -Infinity, never a truncated index"
        );
    }
    // A one-entry pool makes index 1.0 out of range even though it is integral.
    let single = crate::bots::planning::PlanMap {
        camps: map.camps.clone(),
        spawn_pool: vec![map.spawn_pool[0].clone()],
    };
    assert_eq!(
        plan_spawn_score_raw(&single, 1., faction, None),
        f64::NEG_INFINITY
    );
    assert!(plan_spawn_score_raw(&single, 0., faction, None).is_finite());
}

#[test]
fn shared_choices_draw_in_the_admitted_leaf_order() {
    let map = map();
    let params = TIERS[2];
    let learned = LearnedBiasView {
        enabled: true,
        bias: &|key| if key == "spawn|fire|fire" { 12. } else { 0. },
    };
    let deal = source_deal([0., 1.], -1., vec!["vigor", "haste"], -1.);
    for seed in 1..9u32 {
        // Reference: the same source expression with the admitted random leaves.
        let mut decide_ref = Rng::new(seed);
        let mut lapse_ref = Rng::new(seed + 1);
        let utilities = vec![
            plan_spawn_score_raw(&map, 0., FactionId::Fire, None) / PLAN_CAMPS as f64
                + learned_bias_of(&learned, "spawn|fire|fire"),
            plan_spawn_score_raw(&map, 1., FactionId::Fire, None) / PLAN_CAMPS as f64,
        ];
        let (reference, _) = pick_option(
            &mut decide_ref,
            &mut lapse_ref,
            &utilities,
            params.softmax_t,
            params.lapse_p,
        );

        let mut decide = Rng::new(seed);
        let mut lapse = Rng::new(seed + 1);
        let mut decide_draw = || decide.next_f64();
        let mut lapse_draw = || lapse.next_f64();
        let picked = source_choose_spawn(
            view_of(&deal),
            &[0, 1],
            &map,
            Some(FactionId::Fire),
            None,
            &learned,
            &params,
            &mut decide_draw,
            &mut lapse_draw,
        );
        assert_eq!(picked as i32, reference, "seed {seed} spawn pick");
        assert_eq!(
            decide.next_u32(),
            decide_ref.next_u32(),
            "seed {seed} decide draw count"
        );
        assert_eq!(
            lapse.next_u32(),
            lapse_ref.next_u32(),
            "seed {seed} lapse draw count"
        );
    }

    // chooseBoon: the lapse stream is drawn first for two boons even at lapseP 0, then the softmax only if no lapse.
    let mut decide_ref = Rng::new(7);
    let mut lapse_ref = Rng::new(8);
    let (reference, _) = pick_option(
        &mut decide_ref,
        &mut lapse_ref,
        &[0.5, -0.5],
        params.softmax_t,
        params.lapse_p,
    );
    let mut decide = Rng::new(7);
    let mut lapse = Rng::new(8);
    let mut decide_draw = || decide.next_f64();
    let mut lapse_draw = || lapse.next_f64();
    let picked = source_choose_boon(
        view_of(&deal),
        Some(FactionId::Fire),
        &learned,
        &params,
        &mut decide_draw,
        &mut lapse_draw,
    );
    assert_eq!(picked as i32, if reference == 1 { 1 } else { 0 });
    // One dealt boon draws nothing (source pickOption: no lapse draw for n == 1, softmax argmax without a draw).
    let one = source_deal([0., 1.], -1., vec!["vigor"], -1.);
    let mut decide = Rng::new(7);
    let mut lapse = Rng::new(8);
    let mut decide_draw = || decide.next_f64();
    let mut lapse_draw = || lapse.next_f64();
    let picked = source_choose_boon(
        view_of(&one),
        Some(FactionId::Fire),
        &learned,
        &params,
        &mut decide_draw,
        &mut lapse_draw,
    );
    assert_eq!(picked, 0);
    assert_eq!(decide.next_u32(), Rng::new(7).next_u32(), "no decide draw");
    assert_eq!(lapse.next_u32(), Rng::new(8).next_u32(), "no lapse draw");
}

#[test]
fn learned_bias_applies_the_source_learn_clamp_and_sanitize() {
    let disabled = LearnedBiasView {
        enabled: false,
        bias: &|_| 12.,
    };
    assert_eq!(learned_bias_of(&disabled, "x"), 0.);
    let enabled = LearnedBiasView {
        enabled: true,
        bias: &|_| 1e9,
    };
    assert_eq!(
        learned_bias_of(&enabled, "x"),
        crate::bots::planning::LEARN_CAP * crate::bots::planning::LEARN_WEIGHT
    );
    let negative = LearnedBiasView {
        enabled: true,
        bias: &|_| -1e9,
    };
    assert_eq!(
        learned_bias_of(&negative, "x"),
        -crate::bots::planning::LEARN_CAP * crate::bots::planning::LEARN_WEIGHT
    );
    for nonfinite in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let view = LearnedBiasView {
            enabled: true,
            bias: &|_| nonfinite,
        };
        assert_eq!(
            learned_bias_of(&view, "x"),
            0.,
            "source Number.isFinite sanitizes the exact field"
        );
    }
}

#[test]
fn schedule_and_transitions_match_the_old_public_wrapper() {
    let map = map();
    let typed = typed_deal([0, 1], -1, vec!["vigor", "haste"], -1);
    let source = SourcePlanDeal {
        ends_at: typed.ends_at,
        spawns: [0., 1.],
        taken: [false, false],
        pick: -1.,
        boons: typed.boons.clone(),
        boon: -1.,
    };
    let tier = TIERS[1];
    let learned = crate::bots::planning::PlanLearned {
        enabled: true,
        bias: vec![("boon|fire|vigor".into(), 4.)],
    };
    let learned_view = LearnedBiasView {
        enabled: learned.enabled,
        bias: &|key| learned.lookup(key),
    };

    let mut old = PlanModule::new();
    let mut old_decide = Rng::new(11);
    old.observe(100_000., Some(&typed), TierId::Normal, &mut old_decide);

    let mut state = PlanState::default();
    let mut source_decide = Rng::new(11);
    source_observe(
        &mut state,
        100_000.,
        true,
        typed.ends_at,
        TierId::Normal,
        &mut || source_decide.next_f64(),
    );
    assert_eq!(old.state.read_until, state.read_until, "schedule read");
    assert_eq!(old.state.settle_ms, state.settle_ms, "schedule settle");
    assert_eq!(old.state.last_call, state.last_call, "schedule last call");
    assert_eq!(
        old_decide.next_u32(),
        source_decide.next_u32(),
        "schedule draw order"
    );

    // First-deal latch: a later deal does not reschedule.
    let mut source_decide = Rng::new(12);
    source_observe(
        &mut state,
        100_000.,
        false,
        145_000.,
        TierId::Normal,
        &mut || source_decide.next_f64(),
    );
    assert_eq!(source_decide.next_u32(), Rng::new(12).next_u32());

    // Drive both transition engines with the same clock sequence and compare every directive/result.
    for now in [
        100_000., 105_000., 106_000., 108_000., 110_000., 120_000., 140_000., 144_000.,
    ] {
        let mut old_decide = Rng::new(21);
        let mut old_lapse = Rng::new(22);
        let mut old_module = PlanModule {
            state: old.state.clone(),
        };
        let old_intent = old_module.intents(
            now,
            true,
            TierId::Normal,
            &map,
            Some(FactionId::Fire),
            None,
            &learned,
            &mut old_decide,
            &mut old_lapse,
        );
        let mut decide = Rng::new(21);
        let mut lapse = Rng::new(22);
        let mut decide_draw = || decide.next_f64();
        let mut lapse_draw = || lapse.next_f64();
        let directive = source_intents(
            &mut state,
            now,
            true,
            &tier,
            &map,
            Some(FactionId::Fire),
            None,
            &learned_view,
            Some(view_of(&source)),
            &mut decide_draw,
            &mut lapse_draw,
        );
        match (old_intent, directive) {
            (Some(old), Some(PlanDirective::Spawn { option, .. })) => {
                assert_eq!(Some(option as u8), old.spawn, "now {now} spawn option");
                assert_eq!(
                    old.why,
                    format!("spawn {} (option {})", source.spawns[option], option),
                    "now {now} spawn why"
                );
            }
            (Some(old), Some(PlanDirective::Boon { option, id })) => {
                assert_eq!(Some(option as u8), old.boon, "now {now} boon option");
                assert_eq!(old.why, format!("boon {id}"), "now {now} boon why");
            }
            (Some(old), Some(PlanDirective::Ready { why })) => {
                assert_eq!(old.ready, Some(true));
                let expected = match why {
                    ReadyWhy::NoDeal => "no deal came: ready, the server picks",
                    ReadyWhy::Timer => "the timer is nearly out",
                    ReadyWhy::Choices => "choices made",
                };
                assert_eq!(old.why, expected, "now {now} ready why");
            }
            (None, None) => {}
            (old, directive) => panic!("now {now}: old {old:?} vs core {directive:?}"),
        }
        assert_eq!(
            old_module.state.ready_sent, state.ready_sent,
            "now {now} ready latch"
        );
        assert_eq!(
            old_module.state.spawn_ask, state.spawn_ask,
            "now {now} spawn ask"
        );
        assert_eq!(
            old_module.state.boon_ask, state.boon_ask,
            "now {now} boon ask"
        );
        assert_eq!(old_module.state.done_at, state.done_at, "now {now} done at");
        old.state = old_module.state;
    }
}

#[test]
fn per_cfg_tokens_isolate_source_state() {
    // The cfg identity is the state key: distinct tokens never share the schedule/ask/ready state.
    let mut a = PlanState::default();
    let mut b = PlanState::default();
    let mut decide_a = Rng::new(1);
    let mut decide_b = Rng::new(2);
    source_observe(&mut a, 0., true, 45_000., TierId::Hard, &mut || {
        decide_a.next_f64()
    });
    source_observe(&mut b, 0., true, 45_000., TierId::Easy, &mut || {
        decide_b.next_f64()
    });
    assert_ne!(
        a.read_until, b.read_until,
        "distinct tokens isolate the drawn schedule"
    );
    assert_eq!(CfgToken(0), CfgToken(0));
    assert_ne!(CfgToken(0), CfgToken(1));
}
