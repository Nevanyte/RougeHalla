use super::*;

fn cell(n: f64, s: f64) -> Cell {
    Cell::try_new(n, s).expect("valid cell")
}

#[test]
fn the_reference_constants_are_the_source_learn_object() {
    assert_eq!(LEARN_VERSION, 1);
    assert_eq!(LEARN_PRIOR, 0.5);
    assert_eq!(LEARN_STRENGTH, 8.);
    assert_eq!(LEARN_DECAY, 0.99);
    assert_eq!(LEARN_CAP, 0.25);
    assert_eq!(LEARN_WEIGHT, 0.3);
    assert_eq!(LEARN_EXPLORE, 0.05);
    assert_eq!(LEARN_MAX_ENTRIES, 2000);
    assert_eq!(LEARN_WRITE_EVERY_MS, 10_000);
    assert_eq!(NEUTRAL, 0.5);
    assert_eq!(MAX_KEY_LENGTH, 96);
    assert_eq!(DOMAINS.len(), 8);
}

#[test]
fn the_smoothed_mean_is_the_legacy_bias() {
    // (7 + 0.5*8) / (10 + 8) = 11/18 = 0.6111..; minus 0.5.
    assert!((cell(10., 7.).bias() - (11. / 18. - 0.5)).abs() < 1e-12);
    // Empty cell: the prior pulls the mean to the neutral score, so no bias.
    assert_eq!(Cell::ZERO.bias(), 0.);
    // A cell over the cap is clamped to +-LEARN_CAP.
    assert_eq!(cell(100., 100.).bias(), LEARN_CAP);
    assert_eq!(cell(100., 0.).bias(), -LEARN_CAP);
}

#[test]
fn the_first_run_of_a_tier_says_nothing_and_the_second_does() {
    let mut stats = Stats::default();
    let choices = vec!["faction|farmer|fire".to_string()];
    let first = RunSummary {
        tier: Tier::Normal,
        outcome: RunOutcome::Won,
        place: 1.,
        players: 4.,
        choices: &choices,
    };
    assert!(stats.apply(&first));
    // s = 1 for first of four: the baseline is this very run, so the residual is exactly neutral.
    assert!((stats.snapshot().bias("faction|farmer|fire")).abs() < 1e-12);
    let second = RunSummary {
        tier: Tier::Normal,
        outcome: RunOutcome::Died,
        place: 4.,
        players: 4.,
        choices: &choices,
    };
    assert!(stats.apply(&second));
    // The reference is the same model applied to a second, independent store: the decayed baseline makes run 2's
    // residual (0.5 + 0 - 0.99/1.99) slightly positive, so the decayed cell still dips below neutral.
    let mut expected = Stats::default();
    assert!(expected.apply(&first));
    assert!(expected.apply(&second));
    let want = expected.snapshot().bias("faction|farmer|fire");
    assert!((stats.snapshot().bias("faction|farmer|fire") - want).abs() < 1e-12);
    // Baseline after the two runs: n = 0.99*1 + 1 = 1.99 and s = 0.99*1 + 0 = 0.99.
    assert!((stats.baseline(Tier::Normal).n() - 1.99).abs() < 1e-12);
    assert!((stats.baseline(Tier::Normal).s() - 0.99).abs() < 1e-12);
    assert!(want < 0., "a last place pulls the bias down");
}

#[test]
fn void_draw_and_short_runs_follow_the_source_guards() {
    let mut stats = Stats::default();
    let choices = Vec::new();
    let void = RunSummary {
        tier: Tier::Easy,
        outcome: RunOutcome::Void,
        place: 1.,
        players: 4.,
        choices: &choices,
    };
    assert!(!stats.apply(&void));
    let solo = RunSummary {
        tier: Tier::Easy,
        outcome: RunOutcome::Won,
        place: 1.,
        players: 1.9,
        choices: &choices,
    };
    assert!(
        !stats.apply(&solo),
        "players floors to 1, which learns nothing"
    );
    let nan = RunSummary {
        tier: Tier::Easy,
        outcome: RunOutcome::Won,
        place: f64::NAN,
        players: 4.,
        choices: &choices,
    };
    assert!(!stats.apply(&nan));
    // A draw is first place whatever it says.
    let draw = RunSummary {
        tier: Tier::Easy,
        outcome: RunOutcome::Draw,
        place: 4.,
        players: 4.,
        choices: &choices,
    };
    assert!(stats.apply(&draw));
    assert_eq!(stats.baseline(Tier::Easy).n(), 1.);
    // A place outside the table is clamped into it.
    let mut stats = Stats::default();
    let high = RunSummary {
        tier: Tier::Hard,
        outcome: RunOutcome::Died,
        place: 9.,
        players: 4.,
        choices: &choices,
    };
    assert!(stats.apply(&high));
    assert_eq!(stats.baseline(Tier::Hard).s(), 0.);
}

#[test]
fn damaged_cells_and_keys_are_refused_or_dropped() {
    assert!(Cell::try_new(-1., 0.).is_none());
    assert!(Cell::try_new(1., 2.).is_none());
    assert!(Cell::try_new(f64::NAN, 0.).is_none());
    assert!(
        Cell::try_new(2., 1.5).is_some(),
        "a cell may carry more sum than count up to the slack"
    );
    assert!(valid_key("faction|farmer|fire"));
    assert!(valid_key("camp|north|elite"));
    assert!(!valid_key("faction|farmer"));
    assert!(!valid_key("unknown|a|b"));
    assert!(!valid_key("faction||fire"));
    assert!(!valid_key(&format!(
        "faction|{}|fire",
        "x".repeat(MAX_KEY_LENGTH)
    )));
    let mut stats = Stats::default();
    assert!(!stats.insert_entry("bad".into(), cell(1., 0.5)));
    assert!(stats.insert_entry("faction|farmer|fire".into(), cell(1., 0.5)));
}

#[test]
fn a_duplicate_choice_key_counts_once_and_the_table_keeps_its_smallest_n() {
    let mut stats = Stats::default();
    let choices = vec![
        "faction|farmer|fire".to_string(),
        "faction|farmer|fire".to_string(),
    ];
    let summary = RunSummary {
        tier: Tier::Normal,
        outcome: RunOutcome::Won,
        place: 1.,
        players: 4.,
        choices: &choices,
    };
    assert!(stats.apply(&summary));
    assert_eq!(stats.entries()["faction|farmer|fire"].n(), 1.);
    // A full table evicts the smallest n first, but never a key this run touched.
    let mut stats = Stats::default();
    for i in 0..LEARN_MAX_ENTRIES {
        assert!(stats.insert_entry(format!("opener|{i}|flank"), Cell { n: 5., s: 2. }));
    }
    let touched = vec!["opener|new|flank".to_string()];
    let summary = RunSummary {
        tier: Tier::Easy,
        outcome: RunOutcome::Won,
        place: 1.,
        players: 2.,
        choices: &touched,
    };
    assert!(stats.apply(&summary));
    assert_eq!(
        stats.entries().len(),
        LEARN_MAX_ENTRIES,
        "a touched newcomer replaces an untouched victim"
    );
    assert!(stats.entries().contains_key("opener|new|flank"));
}

#[test]
fn a_snapshot_is_enabled_and_zero_for_unknown_keys() {
    let mut stats = Stats::default();
    assert!(stats.insert_entry("faction|farmer|fire".into(), cell(10., 7.)));
    let snapshot = stats.snapshot();
    assert!(snapshot.enabled());
    assert!((snapshot.bias("faction|farmer|fire") - (11. / 18. - 0.5)).abs() < 1e-12);
    assert_eq!(snapshot.bias("faction|hunter|fire"), 0.);
    assert!(!LearnedBias::NO_BIAS.enabled());
    assert_eq!(LearnedBias::NO_BIAS.bias("faction|farmer|fire"), 0.);
}
