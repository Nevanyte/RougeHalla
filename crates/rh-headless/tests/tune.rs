//! P-BOT-TUNER-1 oracle: the port of legacy `tune.ts` (`applyTune`) and the offline seeded search over the Brain's
//! existing tier and persona numbers (R-ML narrow exception, clause 2).
//!
//! Pinned here: a patch changes exactly the numbers it names and refuses anything else; legacy's two ablation shapes
//! are expressible; the tier order and the persona spread are guarded; a tournament really plays the patched copy (and
//! only on the thread that installed it); the search is deterministic, stays in its bounds and writes what it ran on;
//! the checked-in table equals the compiled tables, so merging this changes no bot.
use rh_headless::tournament::{default_sim_config, play, TournamentPlan};
use rh_headless::tournament_learning::{play_policy, SeatPolicy};
use rh_headless::tune::{
    apply_tune, leaf, leaf_paths, persona_spread, plan_tables, play_tuned, read_table_file, search,
    search_bounds, search_file, spread_floor, table_file, tables_from_json, tables_json,
    tier_order_violations, SearchConfig, SEARCH_FORMAT, TABLE_FORMAT,
};
use rh_policy::bots::types::{with_tables, BrainTables};
use rh_policy::bots::{PersonaId, PersonaParams, TierId, TierParams};
use rh_sim::arenas::practice_arena;
use rh_sim::{ArenaMode, ArenaRules, SimConfig};
use serde_json::{json, Value};

fn compiled() -> BrainTables {
    BrainTables::COMPILED
}

fn fast_config() -> SimConfig {
    SimConfig {
        lifecycle: ArenaMode::Source(ArenaRules {
            plan_seconds: 0.,
            first_patience_seconds: None,
            coliseum_schedule: None,
            patience_seconds: 3.,
            patience_min_seconds: 2.,
            sudden_death_seconds: 2.,
        }),
        ..default_sim_config()
    }
}

fn tiny_plan(games: u32) -> TournamentPlan {
    TournamentPlan::with_tiers(
        games,
        7,
        vec![TierId::Easy, TierId::Normal, TierId::Hard],
        60_000.,
    )
}

/// The leaves that differ between two tables.
fn changed(a: &BrainTables, b: &BrainTables) -> Vec<String> {
    leaf_paths()
        .into_iter()
        .filter(|p| leaf(a, p) != leaf(b, p))
        .collect()
}

#[test]
fn the_tables_have_every_legacy_leaf_and_round_trip() {
    let paths = leaf_paths();
    // 3 tiers x 62 leaves + 4 personas x 16 leaves, legacy camelCase names.
    assert_eq!(paths.len(), 3 * 62 + 4 * 16, "{paths:?}");
    for p in [
        "tiers.easy.reaction.mu",
        "tiers.normal.targetScatter.lagS",
        "tiers.hard.route.walkPaths",
        "tiers.hard.route.horizon",
        "tiers.easy.caution.startHp",
        "personas.hunter.engageEdge",
        "personas.cautious.chaseGiveUpMs",
    ] {
        assert!(paths.iter().any(|q| q == p), "missing {p}");
    }
    assert_eq!(leaf(&compiled(), "tiers.easy.knowledge"), Some(0.4));
    assert_eq!(leaf(&compiled(), "tiers.hard.route.walkPaths"), Some(1.));
    assert_eq!(leaf(&compiled(), "personas.hunter.engageEdge"), Some(0.6));
    assert_eq!(leaf(&compiled(), "tiers.easy.id"), None);
    let json = tables_json(&compiled());
    assert_eq!(json["tiers"]["normal"]["reaction"]["mu"], 210.);
    assert_eq!(json["personas"]["farmer"]["mobKillGoal"], 999.);
    assert_eq!(tables_from_json(&json).unwrap(), compiled());
    assert!(tables_from_json(&json!({"tiers": {}, "personas": {}})).is_err());
}

#[test]
fn a_patch_changes_exactly_what_it_names() {
    let one = apply_tune(
        &compiled(),
        &json!({"tiers": {"normal": {"knowledge": 0.75}}}),
    )
    .unwrap();
    assert_eq!(changed(&compiled(), &one), vec!["tiers.normal.knowledge"]);
    assert_eq!(one.tiers[1].knowledge, 0.75);
    let nested = apply_tune(
        &compiled(),
        &json!({"tiers": {"hard": {"reaction": {"mu": 150}}}, "personas": {"farmer": {"loot": 0.65}}}),
    )
    .unwrap();
    assert_eq!(
        changed(&compiled(), &nested),
        vec!["tiers.hard.reaction.mu", "personas.farmer.loot"]
    );
    // An empty spec is the compiled tables.
    assert_eq!(apply_tune(&compiled(), &json!({})).unwrap(), compiled());
}

#[test]
fn a_bad_patch_is_refused() {
    let refused = |spec: Value| apply_tune(&compiled(), &spec).expect_err(&spec.to_string());
    assert!(refused(json!({"tiers": {"expert": {"knowledge": 0.5}}})).contains("unknown tier"));
    assert!(refused(json!({"personas": {"pirate": {"pve": 1}}})).contains("unknown persona"));
    assert!(refused(json!({"tiers": {"easy": {"knowlege": 0.5}}})).contains("unknown key"));
    assert!(refused(json!({"tiers": {"easy": {"reaction": 300}}})).contains("group"));
    assert!(refused(json!({"tiers": {"easy": {"knowledge": {"x": 1}}}})).contains("not a group"));
    assert!(refused(json!({"tiers": {"easy": {"knowledge": true}}})).contains("must be a number"));
    assert!(
        refused(json!({"tiers": {"easy": {"route": {"walkPaths": 1}}}}))
            .contains("must be a boolean")
    );
    assert!(refused(json!({"tiers": {"easy": {"id": "hard"}}})).contains("unknown key"));
    assert!(refused(json!({"bots": {}})).contains("unknown"));
    // Outside a leaf's validity range.
    assert!(refused(json!({"tiers": {"easy": {"knowledge": 1.5}}})).contains("out of bounds"));
    assert!(refused(json!({"tiers": {"easy": {"apm": -1}}})).contains("out of bounds"));
    assert!(
        refused(json!({"tiers": {"easy": {"route": {"horizon": 2.5}}}})).contains("out of bounds")
    );
    // The tiers stay ordered: easy may not out-know hard...
    assert!(refused(json!({"tiers": {"easy": {"knowledge": 0.99}}})).contains("tier order"));
    // ...and the personas stay distinct: a hunter with every farmer number is refused.
    let farmer = tables_json(&compiled())["personas"]["farmer"].clone();
    assert!(refused(json!({"personas": {"hunter": farmer}})).contains("spread"));
}

#[test]
fn legacys_two_ablation_shapes_are_expressible() {
    // tune.ts:1 "one tier with another's knowledge": a diagnostic that breaks the tier order says so.
    let swapped = apply_tune(
        &compiled(),
        &json!({"ablation": true, "tiers": {"easy": {"knowledge": 0.95}}}),
    )
    .unwrap();
    assert_eq!(swapped.tiers[0].knowledge, 0.95);
    assert_eq!(
        tier_order_violations(&swapped),
        vec!["tiers.*.knowledge".to_owned()]
    );
    // "one persona changed at a time".
    let hunter = apply_tune(
        &compiled(),
        &json!({"personas": {"hunter": {"engageEdge": 0}}}),
    )
    .unwrap();
    assert_eq!(hunter.personas[1].engage_edge, 0.);
    assert!(tier_order_violations(&hunter).is_empty());
    // An ablation still keeps the personas distinct.
    let farmer = tables_json(&compiled())["personas"]["farmer"].clone();
    assert!(apply_tune(
        &compiled(),
        &json!({"ablation": true, "personas": {"hunter": farmer}})
    )
    .is_err());
}

#[test]
fn the_compiled_tables_are_ordered_and_spread() {
    assert!(tier_order_violations(&compiled()).is_empty());
    let spread = persona_spread(&compiled());
    assert!(spread > 0.2, "the four personas are far apart: {spread}");
    assert_eq!(spread_floor(), spread / 2.);
}

#[test]
fn installed_tables_reach_by_id_on_this_thread_only_and_are_restored() {
    let patched: &'static BrainTables = Box::leak(Box::new(
        apply_tune(
            &compiled(),
            &json!({"tiers": {"easy": {"knowledge": 0.5}}, "personas": {"cautious": {"risk": 0.1}}}),
        )
        .unwrap(),
    ));
    let (inside, other_thread) = with_tables(patched, || {
        (
            (
                TierParams::by_id(TierId::Easy).knowledge,
                PersonaParams::by_id(PersonaId::Cautious).risk,
            ),
            std::thread::spawn(|| TierParams::by_id(TierId::Easy).knowledge)
                .join()
                .unwrap(),
        )
    });
    assert_eq!(inside, (0.5, 0.1));
    assert_eq!(
        other_thread, 0.4,
        "another thread reads the compiled tables"
    );
    assert_eq!(TierParams::by_id(TierId::Easy).knowledge, 0.4, "restored");
    // Restored after a panic too.
    let _ = std::panic::catch_unwind(|| with_tables(patched, || panic!("inside")));
    assert_eq!(TierParams::by_id(TierId::Easy).knowledge, 0.4);
}

#[test]
fn a_tournament_plays_the_patched_copy() {
    let arena = practice_arena();
    let sim = fast_config();
    let plan = tiny_plan(2);
    let slow = json!({"tiers": {
        "easy": {"apm": 12, "reaction": {"mu": 900, "floor": 800, "cap": 3000}},
        "normal": {"apm": 12, "reaction": {"mu": 900, "floor": 800, "cap": 3000}},
        "hard": {"apm": 12, "reaction": {"mu": 900, "floor": 800, "cap": 3000}}
    }});
    let tables: &'static BrainTables = Box::leak(Box::new(apply_tune(&compiled(), &slow).unwrap()));
    let base = play_policy(&plan, &arena, &sim, SeatPolicy::Human);
    let tuned = play_tuned(&plan, &arena, &sim, SeatPolicy::Human, tables);
    let applied = |games: &[rh_headless::tournament::GameSummary]| {
        games.iter().map(|g| g.manager.applied).sum::<u64>()
    };
    assert!(
        applied(&tuned) < applied(&base),
        "slower hands send fewer commands: {} vs {}",
        applied(&tuned),
        applied(&base)
    );
    // The plan's own `tune` (the tournament CLI's --tune) plays the same copy, on any worker count.
    let mut with_tune = plan.clone();
    with_tune.tune = Some(slow);
    with_tune.workers = 2;
    assert_eq!(plan_tables(&with_tune).unwrap().copied(), Some(*tables));
    let via_plan: Vec<_> = play(&with_tune, &arena, &sim)
        .into_iter()
        .map(|r| r.summary)
        .collect();
    assert_eq!(format!("{via_plan:?}"), format!("{tuned:?}"));
    // A bad plan patch is an error, not a silently ignored diagnostic.
    let mut bad = plan.clone();
    bad.tune = Some(json!({"tiers": {"easy": {"nope": 1}}}));
    assert!(plan_tables(&bad).is_err());
    assert_eq!(plan_tables(&plan).unwrap(), None);
}

fn search_config(seed: u32) -> SearchConfig {
    SearchConfig {
        seed,
        generations: 3,
        population: 2,
        changes: 3,
        step: 0.25,
        plan: tiny_plan(1),
        policy: SeatPolicy::Human,
        commit: "0123abcd".into(),
    }
}

#[test]
fn a_three_generation_search_is_deterministic_bounded_and_self_describing() {
    let arena = practice_arena();
    let sim = fast_config();
    let config = search_config(5);
    let a = search(&config, &arena, &sim);
    let b = search(&config, &arena, &sim);
    let file_a = serde_json::to_string_pretty(&search_file(&config, &a)).unwrap();
    let file_b = serde_json::to_string_pretty(&search_file(&config, &b)).unwrap();
    assert_eq!(file_a, file_b, "same seed, same file");

    // Every proposal of every generation was scored, and stays inside its bounds.
    assert_eq!(a.candidates.len(), 3 * 2);
    for c in &a.candidates {
        assert!(c.generation >= 1 && c.generation <= 3);
        assert!(!c.changed.is_empty() && c.changed.len() <= 3);
        for (path, value) in &c.changed {
            let (lo, hi) = search_bounds(path).expect("only searchable leaves move");
            assert!(
                *value >= lo && *value <= hi,
                "{path} = {value} outside [{lo}, {hi}]"
            );
        }
        assert!(c.spread >= spread_floor());
    }
    // The returned table: in bounds, ordered, spread at least the floor, and never worse than the compiled tables.
    for path in changed(&compiled(), &a.best) {
        let (lo, hi) = search_bounds(&path).expect("searchable");
        let v = leaf(&a.best, &path).unwrap();
        assert!(v >= lo && v <= hi, "{path}");
    }
    assert!(tier_order_violations(&a.best).is_empty());
    assert!(persona_spread(&a.best) >= spread_floor());
    assert!(a.best_score >= a.baseline_score);

    let file: Value = serde_json::from_str(&file_a).unwrap();
    assert_eq!(file["format"], SEARCH_FORMAT);
    assert_eq!(file["seed"], 5);
    assert_eq!(file["commit"], "0123abcd");
    assert_eq!(file["plan"]["games"], 1);
    assert_eq!(file["plan"]["lineup"], "E,N,H");
    assert_eq!(file["plan"]["policy"], "human");
    assert!(file["objective"]["text"]
        .as_str()
        .unwrap()
        .contains("win band"));
    assert_eq!(file["objective"]["spreadFloor"], spread_floor());
    assert_eq!(
        file["bounds"]["tiers.easy.reaction.mu"],
        json!([165., 495.]),
        "the bounds are written: half to one and a half of the compiled value"
    );
    assert_eq!(file["candidates"].as_array().unwrap().len(), 6);
    assert_eq!(read_table_file(&file["table"]).unwrap(), a.best);
    // Another seed proposes other patches.
    let c = search(&search_config(6), &arena, &sim);
    assert_ne!(
        a.candidates
            .iter()
            .map(|c| c.changed.clone())
            .collect::<Vec<_>>(),
        c.candidates
            .iter()
            .map(|c| c.changed.clone())
            .collect::<Vec<_>>()
    );
}

#[test]
fn search_bounds_are_half_to_one_and_a_half_and_skip_zero_and_boolean_leaves() {
    assert_eq!(search_bounds("tiers.easy.reaction.mu"), Some((165., 495.)));
    assert_eq!(
        search_bounds("tiers.hard.appraisal.bias"),
        Some((-0.44999999999999996, -0.15))
    );
    assert_eq!(
        search_bounds("tiers.easy.knowledge"),
        Some((0.2, 0.6000000000000001))
    );
    // A probability never leaves [0, 1].
    assert_eq!(search_bounds("tiers.hard.knowledge"), Some((0.475, 1.)));
    assert_eq!(
        search_bounds("tiers.easy.jukeP"),
        None,
        "a zero leaf stays zero"
    );
    assert_eq!(search_bounds("tiers.hard.route.walkPaths"), None);
    assert_eq!(search_bounds("tiers.easy.nope"), None);
}

#[test]
fn the_checked_in_table_is_the_compiled_tables() {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rh-policy/data/brain_tuning.json"
    ))
    .expect("the checked-in table");
    let value: Value = serde_json::from_str(&text).expect("json");
    assert_eq!(value["format"], TABLE_FORMAT);
    assert_eq!(
        read_table_file(&value).unwrap(),
        compiled(),
        "merging this changes no bot"
    );
    assert_eq!(
        text,
        serde_json::to_string_pretty(&table_file(&compiled())).unwrap() + "\n",
        "written by the tool's own writer"
    );
}
