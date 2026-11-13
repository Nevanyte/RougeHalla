//! P-BOT-LEARN-ON-1 oracle: the headless tournament seats Brain bots and runs the ported legacy learner
//! (`rh_policy::bots::learning`) the way the source tournament and `BotManager.onResult` do: every resolved seat is
//! recorded in arrival order as the Brain's own choices followed by `faction|<persona>|<faction>`, and the next game's
//! seats are built with the frozen snapshot of the store after the previous game.
//!
//! The learner's arithmetic is pinned by rh-policy's own tests and the `parity/policy` fixtures; these tests pin the
//! plumbing: the order, the snapshot hand-over, the refusal, the file and the learning-off output.
use rh_headless::tournament::{aggregate, default_sim_config, play, SeatSpec, TournamentPlan};
use rh_headless::tournament_cli::json_payload;
use rh_headless::tournament_learning::{
    check_learning, learn_tier, learning_file, play_learning, seat_record, split_learning_args,
    LearnStore, LearningArgs, SeatPolicy, SeatRecord,
};
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::bots::learning::{Cell, LearnedBias, RunOutcome, RunSummary, Stats, Tier};
use rh_policy::bots::{PersonaId, TierId};
use rh_policy::PolicyFinish;
use rh_sim::arenas::practice_arena;
use rh_sim::content::FactionId;
use rh_sim::{ArenaMode, ArenaRules, Event, Outcome, RunResult, SimConfig};

/// A short source lifecycle: patience 3 s, sudden death 2 s (a Brain game on the practice arena resolves in ~950 ticks).
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

fn small_plan(games: u32) -> TournamentPlan {
    TournamentPlan::with_tiers(
        games,
        7,
        vec![TierId::Easy, TierId::Normal, TierId::Hard],
        60_000.,
    )
}

fn summary(record: &SeatRecord) -> RunSummary<'_> {
    RunSummary {
        tier: record.tier,
        outcome: record.outcome,
        place: record.place,
        players: record.players,
        choices: &record.choices,
    }
}

fn faction_key(seat: &SeatSpec) -> String {
    format!(
        "faction|{}|{}",
        seat.persona.as_str(),
        seat.faction.as_str()
    )
}

#[test]
fn a_two_game_brain_series_records_every_resolved_seat_and_hands_the_snapshot_on() {
    let arena = practice_arena();
    let sim = fast_config();
    let plan = small_plan(2);
    let mut store = LearnStore::new();
    let games = play_learning(&plan, &arena, &sim, SeatPolicy::Brain, &mut store);
    assert_eq!(games.len(), 2, "one learned game per planned game");

    // The first game's seats read an empty but enabled store (source: learning on, nothing learned yet).
    let empty = Stats::default().snapshot();
    assert!(empty.enabled());
    assert_eq!(games[0].bias_in, empty);

    let mut folded = Stats::default();
    for (g, game) in games.iter().enumerate() {
        assert_eq!(game.index, g as u32);
        // The seats of game g were built with the store as it stood after games 0..g (the frozen snapshot).
        assert_eq!(
            game.bias_in,
            folded.snapshot(),
            "game {g}'s seats are built with the snapshot after the previous games"
        );
        let lineup = &game.summary.lineup;
        assert!(
            !game.records.is_empty(),
            "game {g}: the resolved seats are recorded"
        );
        let mut seen = std::collections::BTreeSet::new();
        for record in &game.records {
            assert!(seen.insert(record.index), "a seat is recorded at most once");
            let seat = &lineup[record.index];
            let bot = &game.summary.bots[record.index];
            assert_eq!(record.tier, learn_tier(seat.tier));
            assert_eq!(record.players, lineup.len() as f64);
            assert_eq!(record.place, bot.place, "the seat's own placement");
            assert_eq!(
                record.choices.last(),
                Some(&faction_key(seat)),
                "the manager's faction key comes after the Brain's choices"
            );
        }
        // Every seat that resolved is recorded (a capped seat never resolved and records nothing, as in the source).
        let resolved = game
            .summary
            .bots
            .iter()
            .filter(|b| b.outcome != rh_headless::tournament::GameOutcome::Capped)
            .count();
        assert_eq!(game.records.len(), resolved);

        // The legacy rule, applied in arrival order, record by record.
        for record in &game.records {
            let before = folded.clone();
            assert!(folded.apply(&summary(record)), "a resolved run is learned");
            // A choice key the store had not seen is a new cell with one run in it.
            for key in &record.choices {
                let cell = folded.entries()[key];
                match before.entries().get(key) {
                    None => assert_eq!(cell.n(), 1.),
                    Some(old) => assert!((cell.n() - (0.99 * old.n() + 1.)).abs() < 1e-12),
                }
            }
        }
    }
    assert_eq!(
        store.stats(),
        &folded,
        "the series store is every record folded in arrival order"
    );
    assert_eq!(store.snapshot(), folded.snapshot());
}

#[test]
fn the_first_run_of_a_tier_says_nothing_and_later_runs_move_the_cells() {
    // The legacy rule on a hand-made record pair (independent of play): the first run of a tier sets the baseline and
    // leaves its choice cells at the neutral residual; a second, better-placed run of the same tier scores above it.
    let seat = SeatSpec {
        tier: TierId::Hard,
        persona: PersonaId::Hunter,
        faction: FactionId::Fire,
    };
    let result = |place: u32| RunResult {
        outcome: if place == 1 {
            Outcome::Won
        } else {
            Outcome::Died
        },
        profile: "bot0".into(),
        faction: None,
        weapon: None,
        duration_sec: 60,
        kills: 0,
        killed_by: None,
        killed_by_bot: false,
        place,
        players: 4,
        gv: Default::default(),
        win_bonus_withheld: false,
        win_bonus_why: None,
    };
    let finish = || {
        Some(PolicyFinish {
            choices: vec!["opener|fire|plague".into()],
        })
    };
    let mut store = LearnStore::new();
    assert!(store.record(&seat_record(0, &seat, &result(4), finish())));
    let first = store.stats().entries()["opener|fire|plague"];
    assert_eq!(first, Cell::try_new(1., 0.5).unwrap());
    assert_eq!(store.stats().entries()["faction|hunter|fire"], first);
    assert!(store.record(&seat_record(0, &seat, &result(1), finish())));
    let second = store.stats().entries()["opener|fire|plague"];
    assert!(second.n() > 1.9 && second.bias() > first.bias());
    assert!(store.snapshot().bias("opener|fire|plague") > 0.);
}

#[test]
fn a_faulted_or_silent_seat_records_only_the_managers_faction_key() {
    let seat = SeatSpec {
        tier: TierId::Easy,
        persona: PersonaId::Farmer,
        faction: FactionId::Plague,
    };
    let result = RunResult {
        outcome: Outcome::Died,
        profile: "bot2".into(),
        faction: None,
        weapon: None,
        duration_sec: 30,
        kills: 0,
        killed_by: None,
        killed_by_bot: false,
        place: 3,
        players: 3,
        gv: Default::default(),
        win_bonus_withheld: false,
        win_bonus_why: None,
    };
    let silent = seat_record(2, &seat, &result, None);
    assert_eq!(
        silent,
        SeatRecord {
            index: 2,
            tier: Tier::Easy,
            outcome: RunOutcome::Died,
            place: 3.,
            players: 3.,
            choices: vec!["faction|farmer|plague".into()],
        }
    );
    let spoke = seat_record(
        2,
        &seat,
        &result,
        Some(PolicyFinish {
            choices: vec!["spawn|a|b".into(), "boon|c|d".into()],
        }),
    );
    assert_eq!(
        spoke.choices,
        vec!["spawn|a|b", "boon|c|d", "faction|farmer|plague"],
        "the Brain's choices in its order, then the faction key"
    );
}

#[test]
fn a_brain_seat_reports_its_finish_once_through_the_env() {
    let arena = practice_arena();
    let sim = fast_config();
    let seats = [TierId::Normal, TierId::Hard];
    let agents = seats
        .iter()
        .enumerate()
        .map(|(i, tier)| AgentSpec {
            profile: format!("bot{i}"),
            faction: FactionId::ALL[i],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(rh_policy::bots::BrainBot::new(
                    *tier,
                    PersonaId::Hunter,
                    rh_policy::bots::brain_features(&sim, &arena),
                )),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim,
            max_ticks: 2000,
            record: false,
        },
        agents,
        11,
    );
    let mut finished = 0;
    loop {
        let progress = env.advance(&[]);
        let resolved: Vec<_> = env
            .last_events()
            .iter()
            .filter_map(|e| match e {
                Event::Resolved { id, result, .. } => Some((*id, result.clone())),
                _ => None,
            })
            .collect();
        for (id, result) in resolved {
            assert!(
                env.finish_seat(id, Some(&result)).is_some(),
                "a seated Brain answers its end-of-run summary"
            );
            assert!(
                env.finish_seat(id, Some(&result)).is_none(),
                "and only once"
            );
            finished += 1;
        }
        if progress.terminated || progress.truncated {
            break;
        }
    }
    assert_eq!(finished, 2, "both seats resolved and reported");
}

#[test]
fn the_same_seed_gives_the_same_file_and_the_file_round_trips() {
    let arena = practice_arena();
    let sim = fast_config();
    let plan = small_plan(2);
    let file = || {
        let mut store = LearnStore::new();
        play_learning(&plan, &arena, &sim, SeatPolicy::Brain, &mut store);
        (
            store.clone(),
            learning_file(&plan, SeatPolicy::Brain, &store),
        )
    };
    let (store_a, a) = file();
    let (_, b) = file();
    let text = serde_json::to_string_pretty(&a).unwrap();
    assert_eq!(text, serde_json::to_string_pretty(&b).unwrap());
    assert_eq!(a["plan"]["seed"], 7);
    assert_eq!(a["plan"]["games"], 2);
    assert_eq!(a["plan"]["policy"], "brain");
    assert_eq!(a["plan"]["lineup"], "E,N,H");
    let back = LearnStore::from_json(&a["store"]).expect("the store reads back");
    assert_eq!(back.stats(), store_a.stats());
    assert_eq!(back.to_json(), a["store"]);
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        LearnStore::from_json(&parsed["store"]).unwrap().stats(),
        store_a.stats()
    );
    // A damaged file is refused, not half-read.
    assert!(LearnStore::from_json(&serde_json::json!({"format": "nope"})).is_err());
    // A different seed is a different series.
    let mut other = LearnStore::new();
    let mut plan_b = plan.clone();
    plan_b.seed = 8;
    play_learning(&plan_b, &arena, &sim, SeatPolicy::Brain, &mut other);
    assert_ne!(
        learning_file(&plan_b, SeatPolicy::Brain, &other)["store"],
        a["store"]
    );
}

#[test]
fn learning_needs_seats_that_report_choices() {
    let refused = check_learning(SeatPolicy::Human, true).expect_err("HumanBot reports no choices");
    assert!(refused.contains("--policy brain"), "{refused}");
    assert!(check_learning(SeatPolicy::Brain, true).is_ok());
    assert!(check_learning(SeatPolicy::Human, false).is_ok());
    assert!(check_learning(SeatPolicy::Brain, false).is_ok());
}

#[test]
fn the_learning_flags_are_split_from_the_source_argv() {
    let argv = |s: &str| s.split_whitespace().map(String::from).collect::<Vec<_>>();
    let (rest, args) = split_learning_args(&argv(
        "--games 2 --policy brain --learn on --learn-out out.json --quiet",
    ))
    .unwrap();
    assert_eq!(rest, argv("--games 2 --learn on --quiet"));
    assert_eq!(
        args,
        LearningArgs {
            policy: SeatPolicy::Brain,
            learn_out: Some("out.json".into()),
        }
    );
    let (rest, args) = split_learning_args(&argv("--policy=human --learn-out=x.json")).unwrap();
    assert!(rest.is_empty());
    assert_eq!(args.policy, SeatPolicy::Human);
    assert_eq!(args.learn_out.as_deref(), Some("x.json"));
    let (rest, args) = split_learning_args(&argv("--games 3")).unwrap();
    assert_eq!(rest, argv("--games 3"));
    assert_eq!(args, LearningArgs::default());
    assert!(split_learning_args(&argv("--policy robot")).is_err());
    assert!(split_learning_args(&argv("--policy")).is_err());
    assert!(split_learning_args(&argv("--learn-out")).is_err());
}

#[test]
fn learning_off_is_byte_identical_to_today() {
    // Golden of today's (pre-packet) runner on a short plan: the default policy with learning off must not move.
    let arena = practice_arena();
    let sim = fast_config();
    let plan = small_plan(2);
    let games: Vec<_> = play(&plan, &arena, &sim)
        .into_iter()
        .map(|r| r.summary)
        .collect();
    let payload = json_payload(&plan, &aggregate(&games), &games, None, None);
    let golden = include_str!("fixtures/tournament_learn_off.json");
    assert_eq!(serde_json::to_string(&payload).unwrap(), golden.trim_end());
    // The no-bias snapshot a learning-off Brain reads is the learner's switched-off view.
    assert!(!LearnedBias::NO_BIAS.enabled());
}
