//! P-BOTS-6: the tournament runner and its actual-source schedule/report witness.
//!
//! The first tests replay parity/policy/bot-tournament.json, captured from tournament/report.ts and
//! tournament/{worker,runTournament}.ts in the pinned Linux amd64 Node 22.23.4 container: every report primitive and every
//! deterministic scheduling decision is compared exactly (numbers by bit pattern). The runner tests then play small
//! tournaments through the ordinary rh-headless policy seats and pin determinism, the report invariants and the honest
//! capped/teleport summary behavior. Game outcomes are not compared to the legacy tournament: that needs the full bot
//! brain and gameplay producer remainder, documented in docs/evidence/stage2-bots-6/README.md.
use rh_headless::tournament::{
    aggregate, deal_evenly, default_sim_config, default_workers, format_report, mean_interval, mix,
    parse_lineup, percentile, plan_game, run, split, table_reaction_mean, wilson, BotBehaviour,
    BotSummary, DiedTo, FactionChoice, GameOutcome, GameSummary, ManagerCounts, MeanInterval,
    PersonaChoice, Proportion, SeatSpec, TournamentPlan, MAX_GAME_MS, PERSONA_IDS, TIER_IDS,
};
use rh_policy::bots::{PersonaId, TierId};
use rh_sim::arenas::practice_arena;
use rh_sim::content::FactionId;
use rh_sim::{ArenaMode, ArenaRules, SimConfig};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../parity/policy/bot-tournament.json");

fn fixture() -> Value {
    let f: Value = serde_json::from_str(FIXTURE).expect("the captured tournament corpus parses");
    assert_eq!(f["format"], "rh-bot-tournament-source/1");
    assert_eq!(f["profile"]["node"], "v22.23.4");
    assert_eq!(f["profile"]["platform"], "linux");
    assert_eq!(f["profile"]["arch"], "x64");
    assert_eq!(f["profile"]["sourceTree"].as_str().unwrap().len(), 64);
    assert_eq!(f["profile"]["captureSha256"].as_str().unwrap().len(), 64);
    f
}

fn num(v: &Value) -> f64 {
    v.as_f64().expect("a number")
}
/// JSON null encodes the source's NaN (a figure with no data; the source prints "-").
fn num_or_nan(v: &Value) -> f64 {
    v.as_f64().unwrap_or(f64::NAN)
}
fn eq_bits(got: f64, want: f64, ctx: &str) {
    if want.is_nan() {
        assert!(got.is_nan(), "{ctx}: {got} != NaN");
    } else {
        assert_eq!(got.to_bits(), want.to_bits(), "{ctx}: {got} != {want}");
    }
}
fn tier(name: &str) -> TierId {
    TierId::parse(name).expect("a source tier")
}
fn persona(name: &str) -> PersonaId {
    PersonaId::parse(name).expect("a source persona")
}
fn faction(name: &str) -> FactionId {
    FactionId::parse(name).expect("a source faction")
}
fn outcome(name: &str) -> GameOutcome {
    match name {
        "won" => GameOutcome::Won,
        "draw" => GameOutcome::Draw,
        "died" => GameOutcome::Died,
        "mia" => GameOutcome::Mia,
        "capped" => GameOutcome::Capped,
        other => panic!("unconsumed outcome {other}"),
    }
}
fn bot_summary(row: &Value, index: u32) -> BotSummary {
    BotSummary {
        seat: SeatSpec {
            tier: tier(row["tier"].as_str().unwrap()),
            persona: persona(row["persona"].as_str().unwrap()),
            faction: faction(row["faction"].as_str().unwrap()),
        },
        index,
        place: num(&row["place"]),
        outcome: outcome(row["outcome"].as_str().unwrap()),
        kills: num(&row["kills"]),
        mob_kills: row.get("mobKills").map_or(0., num),
        damage: row.get("damage").map_or(0., num),
        mob_damage: row.get("mobDamage").map_or(0., num),
        first_mob_kill_ms: row.get("firstMobKillMs").and_then(Value::as_f64),
        tp_hp: row.get("tpHp").and_then(Value::as_f64),
        deaths: num(&row["deaths"]),
        gv: num(&row["gv"]),
        died_at_ms: row["diedAtMs"].as_f64(),
        died_to: match row["diedTo"].as_str() {
            Some("bot") => Some(DiedTo::Bot),
            Some("mob") => Some(DiedTo::Mob),
            Some("arena") => Some(DiedTo::Arena),
            None => None,
            Some(other) => panic!("unconsumed diedTo {other}"),
        },
        behaviour: behaviour_of(&row["behaviour"]),
    }
}

/// The source BotBehaviour JSON (analyse rows), or the default block when the case does not carry one.
fn behaviour_of(v: &Value) -> BotBehaviour {
    if v.is_null() {
        return BotBehaviour::default();
    }
    let mut commands: Vec<(String, u64)> = v["commands"]
        .as_object()
        .map(|o| {
            o.iter()
                .map(|(k, n)| (k.clone(), n.as_u64().unwrap_or(0)))
                .collect()
        })
        .unwrap_or_default();
    commands.sort_by(|a, b| a.0.cmp(&b.0));
    let mut reactions: Vec<(String, Vec<u64>)> = v["reactions"]
        .as_object()
        .map(|o| {
            o.iter()
                .map(|(kind, list)| {
                    (
                        kind.clone(),
                        list.as_array()
                            .unwrap()
                            .iter()
                            .map(|x| x.as_f64().unwrap() as u64)
                            .collect(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    reactions.sort_by(|a, b| a.0.cmp(&b.0));
    let field = |name: &str| -> Option<u64> { v.get(name).and_then(Value::as_u64) };
    BotBehaviour {
        commands,
        commands_total: v.get("commandsTotal").and_then(Value::as_u64).unwrap_or(0),
        reactions,
        target_clicks: v.get("targetClicks").and_then(Value::as_u64).unwrap_or(0),
        click_missed: v.get("clickMissed").and_then(Value::as_u64).unwrap_or(0),
        click_wrong: v.get("clickWrong").and_then(Value::as_u64).unwrap_or(0),
        hesitations: v.get("hesitations").and_then(Value::as_u64).unwrap_or(0),
        lapses: v.get("lapses").and_then(Value::as_u64).unwrap_or(0),
        throttled: v.get("throttled").and_then(Value::as_u64).unwrap_or(0),
        superseded: v.get("superseded").and_then(Value::as_u64).unwrap_or(0),
        apm_peak: v.get("apmPeak").and_then(Value::as_u64).unwrap_or(0),
        mob_targets: field("mobTargets"),
        mob_drops: field("mobDrops"),
        retreats: field("retreats"),
        mob_focus_ms: field("mobFocusMs"),
        grabs: field("grabs"),
        max_stall_ms: field("maxStallMs"),
        dodges: field("dodges"),
        jukes: field("jukes"),
        kite_cycles: field("kiteCycles"),
        goals: v.get("goals").and_then(Value::as_object).map(|o| {
            o.iter()
                .map(|(k, n)| (k.clone(), n.as_u64().unwrap_or(0)))
                .collect()
        }),
    }
}
fn plan_from(v: &Value) -> TournamentPlan {
    TournamentPlan {
        games: v["games"].as_u64().unwrap() as u32,
        seed: v["seed"].as_u64().unwrap() as u32,
        tiers: v["tiers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| tier(t.as_str().unwrap()))
            .collect(),
        persona: match v["persona"].as_str().unwrap() {
            "mix" => PersonaChoice::Mix,
            name => PersonaChoice::One(persona(name)),
        },
        faction: match v["faction"].as_str().unwrap() {
            "mix" => FactionChoice::Mix,
            name => FactionChoice::One(faction(name)),
        },
        max_sim_ms: MAX_GAME_MS,
        ..TournamentPlan::default()
    }
}

#[test]
fn report_statistics_match_the_actual_source() {
    let f = fixture();
    for case in f["wilson"].as_array().unwrap() {
        let got = wilson(num(&case["k"]), num(&case["n"]), num(&case["z"]));
        let want = &case["expected"];
        eq_bits(got.k, num(&want["k"]), "wilson/k");
        eq_bits(got.n, num(&want["n"]), "wilson/n");
        eq_bits(got.p, num(&want["p"]), "wilson/p");
        eq_bits(got.lo, num(&want["lo"]), "wilson/lo");
        eq_bits(got.hi, num(&want["hi"]), "wilson/hi");
    }
    for case in f["percentile"].as_array().unwrap() {
        let sorted: Vec<f64> = case["sorted"].as_array().unwrap().iter().map(num).collect();
        eq_bits(
            percentile(&sorted, num(&case["q"])),
            num(&case["expected"]),
            "percentile",
        );
    }
    for case in f["meanInterval"].as_array().unwrap() {
        let xs: Vec<f64> = case["xs"].as_array().unwrap().iter().map(num).collect();
        let got = mean_interval(&xs, num(&case["z"]));
        let want = &case["expected"];
        eq_bits(got.n, num(&want["n"]), "mean/n");
        eq_bits(got.mean, num(&want["mean"]), "mean/mean");
        eq_bits(got.lo, num(&want["lo"]), "mean/lo");
        eq_bits(got.hi, num(&want["hi"]), "mean/hi");
    }
    for case in f["tableReactionMean"].as_array().unwrap() {
        eq_bits(
            table_reaction_mean(
                tier(case["tier"].as_str().unwrap()),
                case["kind"].as_str().unwrap(),
            ),
            num(&case["expected"]),
            "tableReactionMean",
        );
    }
}

fn game_summary(case: &Value) -> GameSummary {
    let rows = case["bots"].as_array().unwrap();
    let bots: Vec<BotSummary> = rows
        .iter()
        .enumerate()
        .map(|(i, row)| bot_summary(row, i as u32))
        .collect();
    GameSummary {
        seed: case["seed"].as_u64().unwrap() as u32,
        lineup: bots.iter().map(|b| b.seat).collect(),
        ended: case["ended"].as_bool().unwrap(),
        winner: case["winner"].as_u64().map(|i| i as usize),
        draw: case["draw"].as_bool().unwrap(),
        duration_ms: num(&case["durationMs"]),
        ticks: case["ticks"].as_u64().unwrap() as u32,
        first_death_ms: case["firstDeathMs"].as_f64(),
        first_kill_ms: case.get("firstKillMs").and_then(Value::as_f64),
        death_log: Vec::new(),
        first_hits: Vec::new(),
        teleport_ms: case["teleportMs"].as_f64(),
        sudden_death_ms: case["suddenDeathMs"].as_f64(),
        bots,
        manager: ManagerCounts {
            sent: case["manager"]["sent"].as_u64().unwrap(),
            applied: case["manager"]["applied"].as_u64().unwrap(),
            refused: case["manager"]["refused"].as_u64().unwrap(),
            lost: case["manager"]["lost"].as_u64().unwrap(),
            frames: case["manager"]["frames"].as_u64().unwrap(),
            errors: case["manager"]["errors"].as_u64().unwrap(),
        },
    }
}

fn compare_proportion(got: &Proportion, want: &Value, ctx: &str) {
    eq_bits(got.k, num_or_nan(&want["k"]), &format!("{ctx}/k"));
    eq_bits(got.n, num_or_nan(&want["n"]), &format!("{ctx}/n"));
    eq_bits(got.p, num_or_nan(&want["p"]), &format!("{ctx}/p"));
    eq_bits(got.lo, num_or_nan(&want["lo"]), &format!("{ctx}/lo"));
    eq_bits(got.hi, num_or_nan(&want["hi"]), &format!("{ctx}/hi"));
}

fn compare_mean(got: &MeanInterval, want: &Value, ctx: &str) {
    eq_bits(got.n, num_or_nan(&want["n"]), &format!("{ctx}/n"));
    eq_bits(got.mean, num_or_nan(&want["mean"]), &format!("{ctx}/mean"));
    eq_bits(got.lo, num_or_nan(&want["lo"]), &format!("{ctx}/lo"));
    eq_bits(got.hi, num_or_nan(&want["hi"]), &format!("{ctx}/hi"));
}

#[test]
fn report_aggregate_matches_the_actual_source() {
    let f = fixture();
    for case in f["aggregate"].as_array().unwrap() {
        let ctx = case["name"].as_str().unwrap();
        let games: Vec<GameSummary> = case["games"]
            .as_array()
            .unwrap()
            .iter()
            .map(game_summary)
            .collect();
        let got = aggregate(&games);
        let want = &case["expected"];
        eq_bits(
            got.games,
            num_or_nan(&want["games"]),
            &format!("{ctx}/games"),
        );
        eq_bits(
            got.decided,
            num_or_nan(&want["decided"]),
            &format!("{ctx}/decided"),
        );
        eq_bits(
            got.draws,
            num_or_nan(&want["draws"]),
            &format!("{ctx}/draws"),
        );
        eq_bits(
            got.capped,
            num_or_nan(&want["capped"]),
            &format!("{ctx}/capped"),
        );
        eq_bits(
            got.duration.mean_s,
            num_or_nan(&want["duration"]["meanS"]),
            &format!("{ctx}/duration/meanS"),
        );
        eq_bits(
            got.duration.p50_s,
            num_or_nan(&want["duration"]["p50S"]),
            &format!("{ctx}/duration/p50S"),
        );
        eq_bits(
            got.duration.min_s,
            num_or_nan(&want["duration"]["minS"]),
            &format!("{ctx}/duration/minS"),
        );
        eq_bits(
            got.duration.max_s,
            num_or_nan(&want["duration"]["maxS"]),
            &format!("{ctx}/duration/maxS"),
        );
        eq_bits(
            got.first_death_median_s,
            num_or_nan(&want["firstDeathMedianS"]),
            &format!("{ctx}/firstDeathMedianS"),
        );
        eq_bits(
            got.teleport_share,
            num_or_nan(&want["teleportShare"]),
            &format!("{ctx}/teleportShare"),
        );
        eq_bits(
            got.sudden_death_share,
            num_or_nan(&want["suddenDeathShare"]),
            &format!("{ctx}/suddenDeathShare"),
        );
        eq_bits(
            got.refused,
            num_or_nan(&want["refused"]),
            &format!("{ctx}/refused"),
        );
        eq_bits(got.lost, num_or_nan(&want["lost"]), &format!("{ctx}/lost"));
        eq_bits(
            got.errors,
            num_or_nan(&want["errors"]),
            &format!("{ctx}/errors"),
        );
        let want_tiers = want["tiers"].as_array().unwrap();
        assert_eq!(got.tiers.len(), want_tiers.len(), "{ctx}/tiers length");
        for (tier, want) in got.tiers.iter().zip(want_tiers) {
            let ctx = format!("{ctx}/tier-{}", tier.tier.as_str());
            assert_eq!(tier.tier.as_str(), want["tier"].as_str().unwrap(), "{ctx}");
            eq_bits(
                tier.bot_games,
                num_or_nan(&want["botGames"]),
                &format!("{ctx}/botGames"),
            );
            eq_bits(tier.wins, num_or_nan(&want["wins"]), &format!("{ctx}/wins"));
            eq_bits(
                tier.draws,
                num_or_nan(&want["draws"]),
                &format!("{ctx}/draws"),
            );
            eq_bits(
                tier.capped,
                num_or_nan(&want["capped"]),
                &format!("{ctx}/capped"),
            );
            compare_proportion(&tier.win_rate, &want["winRate"], &format!("{ctx}/winRate"));
            eq_bits(
                tier.share_of_wins,
                num_or_nan(&want["shareOfWins"]),
                &format!("{ctx}/shareOfWins"),
            );
            compare_mean(&tier.place, &want["place"], &format!("{ctx}/place"));
            eq_bits(
                tier.kills_per_bot,
                num_or_nan(&want["killsPerBot"]),
                &format!("{ctx}/killsPerBot"),
            );
            eq_bits(
                tier.deaths_per_bot,
                num_or_nan(&want["deathsPerBot"]),
                &format!("{ctx}/deathsPerBot"),
            );
            eq_bits(
                tier.gv_per_bot,
                num_or_nan(&want["gvPerBot"]),
                &format!("{ctx}/gvPerBot"),
            );
            eq_bits(
                tier.alive_seconds,
                num_or_nan(&want["aliveSeconds"]),
                &format!("{ctx}/aliveSeconds"),
            );
            for kind in ["bot", "mob", "arena"] {
                let got = match kind {
                    "bot" => tier.died_to.bot,
                    "mob" => tier.died_to.mob,
                    _ => tier.died_to.arena,
                };
                eq_bits(
                    got,
                    num_or_nan(&want["diedTo"][kind]),
                    &format!("{ctx}/diedTo/{kind}"),
                );
            }
        }
        for (section, got) in [("personas", &got.personas), ("factions", &got.factions)] {
            let want_groups = want[section].as_array().unwrap();
            assert_eq!(got.len(), want_groups.len(), "{ctx}/{section} length");
            for (group, want) in got.iter().zip(want_groups) {
                let ctx = format!("{ctx}/{section}-{}", group.key);
                assert_eq!(group.key, want["key"].as_str().unwrap(), "{ctx}");
                eq_bits(
                    group.bot_games,
                    num_or_nan(&want["botGames"]),
                    &format!("{ctx}/botGames"),
                );
                compare_proportion(&group.win_rate, &want["winRate"], &format!("{ctx}/winRate"));
                eq_bits(
                    group.mean_place,
                    num_or_nan(&want["meanPlace"]),
                    &format!("{ctx}/meanPlace"),
                );
                eq_bits(
                    group.kills_per_bot,
                    num_or_nan(&want["killsPerBot"]),
                    &format!("{ctx}/killsPerBot"),
                );
            }
        }
    }
}

#[test]
fn the_source_constants_and_id_orders_are_the_ported_ones() {
    let f = fixture();
    assert_eq!(num(&f["constants"]["MAX_GAME_MS"]), MAX_GAME_MS);
    assert_eq!(
        f["constants"]["MAX_PLAYERS"].as_u64().unwrap() as usize,
        rh_sim::constants::MAX_PLAYERS
    );
    let personas: Vec<PersonaId> = f["constants"]["PERSONA_IDS"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| persona(p.as_str().unwrap()))
        .collect();
    assert_eq!(personas, PERSONA_IDS);
    let tiers: Vec<TierId> = f["constants"]["TIER_IDS"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| tier(t.as_str().unwrap()))
        .collect();
    assert_eq!(tiers, TIER_IDS);
    let factions: Vec<FactionId> = f["constants"]["FACTION_IDS"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| faction(f.as_str().unwrap()))
        .collect();
    assert_eq!(factions, FactionId::ALL);
    // The source headless timers, mapped onto the port's arena rules. Two documented differences: a fixed lineup starts
    // the raid at once (fill 0 rather than the source lobby fill 5) and the default arena carries no mob/loot layers, so
    // mobs stay Off (enable them with a layered arena and initial_loot through the sim config).
    let source = &f["constants"]["HEADLESS_CONFIG"];
    let sim = default_sim_config();
    assert_eq!(
        sim.min_players,
        source["minPlayers"].as_u64().unwrap() as usize
    );
    assert_eq!(sim.lobby_seconds, num(&source["lobbySeconds"]));
    assert_eq!(sim.fill_seconds, 0.);
    let ArenaMode::Source(rules) = sim.lifecycle else {
        panic!("the default tournament config runs the source lifecycle");
    };
    assert_eq!(rules.plan_seconds, 0.);
    assert_eq!(rules.patience_seconds, num(&source["patienceSeconds"]));
    assert_eq!(
        rules.patience_min_seconds,
        num(&source["patienceMinSeconds"])
    );
    assert_eq!(
        rules.sudden_death_seconds,
        num(&source["suddenDeathSeconds"])
    );
    assert!(matches!(sim.mob_mode, rh_sim::mob_runtime::MobMode::Off));
}

#[test]
fn the_deterministic_schedule_matches_the_actual_source() {
    let f = fixture();
    for case in f["mix"].as_array().unwrap() {
        assert_eq!(
            mix(
                case["seed"].as_u64().unwrap() as u32,
                case["tag"].as_u64().unwrap() as u32
            ),
            case["expected"].as_u64().unwrap() as u32,
            "mix {case:?}"
        );
    }
    for case in f["dealEvenly"].as_array().unwrap() {
        let seats = case["seats"].as_u64().unwrap() as usize;
        let seed = case["seed"].as_u64().unwrap() as u32;
        let tag = case["tag"].as_u64().unwrap() as u32;
        let index = case["index"].as_u64().unwrap() as u32;
        let expected: Vec<String> = case["expected"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect();
        let got: Vec<String> = match case["kind"].as_str().unwrap() {
            "persona" => deal_evenly(&PERSONA_IDS, seats, seed, tag, index)
                .into_iter()
                .map(|p| p.as_str().to_owned())
                .collect(),
            "faction" => deal_evenly(&FactionId::ALL, seats, seed, tag, index)
                .into_iter()
                .map(|f| f.as_str().to_owned())
                .collect(),
            "generic" => deal_evenly(
                &["a".to_owned(), "b".to_owned(), "c".to_owned()],
                seats,
                seed,
                tag,
                index,
            ),
            other => panic!("unconsumed deal kind {other}"),
        };
        assert_eq!(got, expected, "dealEvenly {case:?}");
    }
    for case in f["planGame"].as_array().unwrap() {
        let plan = plan_from(&case["plan"]);
        let index = case["index"].as_u64().unwrap() as u32;
        let got = plan_game(&plan, index);
        let want = &case["expected"];
        assert_eq!(
            got.seed,
            want["seed"].as_u64().unwrap() as u32,
            "planGame/seed"
        );
        assert_eq!(
            got.bot_seed,
            want["botSeed"].as_u64().unwrap() as u32,
            "planGame/botSeed"
        );
        let want_lineup: Vec<(String, String, String)> = want["lineup"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| {
                (
                    s["tier"].as_str().unwrap().to_owned(),
                    s["persona"].as_str().unwrap().to_owned(),
                    s["faction"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        let got_lineup: Vec<(String, String, String)> = got
            .lineup
            .iter()
            .map(|s| {
                (
                    s.tier.as_str().to_owned(),
                    s.persona.as_str().to_owned(),
                    s.faction.as_str().to_owned(),
                )
            })
            .collect();
        assert_eq!(got_lineup, want_lineup, "planGame/lineup {case:?}");
    }
    for case in f["split"].as_array().unwrap() {
        let got = split(
            case["games"].as_u64().unwrap() as u32,
            case["workers"].as_u64().unwrap() as u32,
        );
        let want: Vec<Vec<u32>> = case["expected"]
            .as_array()
            .unwrap()
            .iter()
            .map(|batch| {
                batch
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|g| g.as_u64().unwrap() as u32)
                    .collect()
            })
            .collect();
        assert_eq!(got, want, "split {case:?}");
    }
    for case in f["defaultWorkers"].as_array().unwrap() {
        assert_eq!(
            default_workers(case["cores"].as_u64().unwrap() as usize),
            case["expected"].as_u64().unwrap() as usize,
            "defaultWorkers {case:?}"
        );
    }
    for case in f["parseLineup"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let got = parse_lineup(text);
        match (case["error"].as_str(), &got) {
            (Some(error), Err(got)) => assert_eq!(got, error, "parseLineup error {text:?}"),
            (None, Ok(tiers)) => {
                let want: Vec<TierId> = case["expected"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|t| tier(t.as_str().unwrap()))
                    .collect();
                assert_eq!(tiers, &want, "parseLineup {text:?}");
            }
            (error, got) => panic!("parseLineup {text:?}: expected error {error:?}, got {got:?}"),
        }
    }
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

fn small_plan(games: u32, max_sim_ms: f64) -> TournamentPlan {
    TournamentPlan::with_tiers(
        games,
        7,
        vec![TierId::Easy, TierId::Normal, TierId::Hard],
        max_sim_ms,
    )
}

#[test]
fn a_small_tournament_runs_deterministically_and_reports_invariants() {
    let arena = practice_arena();
    let sim = fast_config();
    let plan = small_plan(2, 60_000.);
    let a = run(&plan, &arena, &sim);
    let b = run(&plan, &arena, &sim);
    // The report carries the absent-telemetry figures as NaN; NaN is not reflexive, so determinism is byte identity of
    // the rendered report rather than PartialEq of the values.
    assert_eq!(
        format!("{a:?}"),
        format!("{b:?}"),
        "the same plan replays byte-identically"
    );
    assert_eq!(a.games.len(), 2);
    assert_eq!(a.meta.games, 2);
    assert_eq!(a.meta.lineup, plan.tiers);
    for (index, game) in a.games.iter().enumerate() {
        assert_eq!(game.lineup, plan_game(&plan, index as u32).lineup);
        assert_eq!(
            game.seed,
            plan_game(&plan, index as u32).seed,
            "the game seed is the scheduled one"
        );
        assert_eq!(game.bots.len(), plan.tiers.len());
        assert_eq!(game.manager.lost, 0, "no command is lost");
        assert_eq!(game.manager.errors, 0, "no policy faults");
        assert!(
            game.manager.applied > 0,
            "the seats act through validate + submit"
        );
        assert!(game.duration_ms >= 0.);
        for bot in &game.bots {
            assert_eq!(bot.outcome, game.bots[bot.index as usize].outcome);
        }
    }
    let report = &a.report;
    assert_eq!(report.games, 2.);
    assert_eq!(report.decided + report.draws + report.capped, 2.);
    assert_eq!(
        report.tiers.iter().map(|t| t.bot_games).sum::<f64>(),
        6.,
        "every tier's seats are counted"
    );
    for tier_agg in &report.tiers {
        assert!(tier_agg.win_rate.lo <= tier_agg.win_rate.p + f64::EPSILON);
        assert!(tier_agg.win_rate.p <= tier_agg.win_rate.hi + f64::EPSILON);
        assert_eq!(tier_agg.win_rate.n, tier_agg.bot_games);
        assert!(tier_agg.win_rate.p.is_finite());
    }
    assert!(report.duration.min_s <= report.duration.p50_s);
    assert!(report.duration.p50_s <= report.duration.max_s);
    let text = format_report(&a);
    assert!(
        text.contains("TOURNAMENT  2 games"),
        "the source header layout"
    );
    assert!(
        text.contains("PER TIER") && text.contains("\neasy "),
        "the source per-tier table"
    );
    assert_eq!(
        report.refused as u64,
        a.games.iter().map(|g| g.manager.refused).sum::<u64>()
    );
}

#[test]
fn a_cut_off_game_reports_capped_survivors() {
    let arena = practice_arena();
    let sim = default_sim_config();
    let plan = small_plan(1, 100.);
    let out = run(&plan, &arena, &sim);
    let game = &out.games[0];
    assert!(!game.ended, "the cap stops the game");
    assert_eq!(out.report.capped, 1.);
    assert_eq!(out.report.decided, 0.);
    assert_eq!(game.bots.len(), 3);
    for bot in &game.bots {
        if bot.died_at_ms.is_none() {
            assert_eq!(bot.outcome, GameOutcome::Capped);
            assert_eq!(bot.place, 1.);
        }
    }
}

#[test]
fn a_real_teleport_is_in_the_summary() {
    let arena = practice_arena();
    let sim = fast_config();
    let plan = TournamentPlan::with_tiers(
        1,
        11,
        vec![TierId::Normal, TierId::Normal, TierId::Normal],
        120_000.,
    );
    let out = run(&plan, &arena, &sim);
    let game = &out.games[0];
    assert!(
        game.teleport_ms.is_some(),
        "the source coliseum schedule teleports after the patience timer"
    );
    assert!(out.report.teleport_share > 0.);
    // Timer semantics belong to the lead's timer-repair slice: this runner keeps sudden_death_ms null (the public Env
    // exposes no burn-start event here), so the share stays 0 as at the base; the source field is still rendered from
    // declared source games in the pinned report corpus. An empty report is NaN, as in the source.
    assert_eq!(out.report.sudden_death_share, 0.);
    assert!(game.sudden_death_ms.is_none());
}

#[test]
fn an_empty_report_is_nan_not_a_panic() {
    let report = aggregate(&[]);
    assert_eq!(report.games, 0.);
    assert!(report.first_death_median_s.is_nan());
    assert!(report.duration.mean_s.is_nan());
    assert!(report.teleport_share.is_nan());
    assert!(report.sudden_death_share.is_nan());
    assert!(report.tiers.is_empty());
    assert!(report.personas.is_empty());
    assert!(report.factions.is_empty());
    // The ported report helpers keep the source's NaN semantics.
    assert!(wilson(0., 0., 1.96).p.is_nan());
    assert!(percentile(&[], 0.5).is_nan());
    assert!(mean_interval(&[], 1.645).mean.is_nan());
    assert_eq!(table_reaction_mean(TierId::Easy, "teleport"), 1000.);
}

/// The same JSON with object keys order-insensitive and numbers compared by value (source integers and floats are one
/// number type; the capture serializes them the way JSON.stringify does).
fn same_json(a: &Value, b: &Value, ctx: &str) {
    match (a, b) {
        (Value::Null, Value::Null) => {}
        (Value::Bool(x), Value::Bool(y)) => assert_eq!(x, y, "{ctx}"),
        (Value::String(x), Value::String(y)) => assert_eq!(x, y, "{ctx}"),
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            if x.is_nan() {
                assert!(y.is_nan(), "{ctx}: {x} != {y}");
            } else {
                assert_eq!(x.to_bits(), y.to_bits(), "{ctx}: {x} != {y}");
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            assert_eq!(x.len(), y.len(), "{ctx}: lengths");
            for (i, (xi, yi)) in x.iter().zip(y).enumerate() {
                same_json(xi, yi, &format!("{ctx}[{i}]"));
            }
        }
        (Value::Object(x), Value::Object(y)) => {
            for (k, xv) in x {
                let yv = y.get(k).unwrap_or_else(|| panic!("{ctx}: missing key {k}"));
                same_json(xv, yv, &format!("{ctx}.{k}"));
            }
            for k in y.keys() {
                assert!(x.contains_key(k), "{ctx}: extra key {k}");
            }
        }
        _ => panic!("{ctx}: shape differs: {a} vs {b}"),
    }
}

fn argv_of(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap().to_owned())
        .collect()
}

/// The CLI surface is the actual source parseArgs/planOf: every pinned argv parses to the source arguments (or the source
/// plain error message), and the plan payload keeps the source field names and values.
#[test]
fn the_cli_surface_matches_the_actual_source() {
    use rh_headless::tournament_cli::{args_json, parse_args, plan_json, plan_of};
    let f = fixture();
    let cases = f["parseArgs"].as_array().expect("parseArgs cases");
    assert!(!cases.is_empty());
    for case in cases {
        let argv = argv_of(&case["argv"]);
        let got = parse_args(&argv, 8);
        match (&case["error"], got) {
            (Value::String(message), Err(error)) => assert_eq!(&error, message, "argv {argv:?}"),
            (Value::String(message), Ok(args)) => {
                panic!("argv {argv:?}: expected error {message}, got {args:?}")
            }
            (Value::Null, Err(error)) => panic!("argv {argv:?}: unexpected error {error}"),
            (Value::Null, Ok(args)) => same_json(
                &args_json(&args),
                &case["expected"],
                &format!("argv {argv:?}"),
            ),
            other => panic!("bad case {other:?}"),
        }
    }
    let plans = f["planOf"].as_array().expect("planOf cases");
    assert!(!plans.is_empty());
    for case in plans {
        let argv = argv_of(&case["argv"]);
        let args = parse_args(&argv, 8).expect("a plan case parses");
        let plan = plan_of(&args);
        same_json(
            &plan_json(&plan),
            &case["expected"],
            &format!("plan {argv:?}"),
        );
    }
}

/// The --json export keeps the source names and encodes a figure with no data as JSON null (source JSON.stringify of NaN).
#[test]
fn the_json_export_keeps_the_source_names_and_null_for_absent_figures() {
    use rh_headless::tournament_cli::{json_payload, parse_args, plan_of};
    let argv = ["--games", "1", "--json", "out.json"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect::<Vec<String>>();
    let args = parse_args(&argv, 8).expect("the export case parses");
    let plan = plan_of(&args);
    let report = aggregate(&[]);
    let games: Vec<GameSummary> = Vec::new();
    let payload = json_payload(&plan, &report, &games, Some(10.), None);
    assert_eq!(payload["meta"]["lineup"], "E,E,N,N,H,H");
    assert_eq!(payload["meta"]["seed"], 1);
    assert_eq!(payload["meta"]["wallMs"], 10);
    assert_eq!(payload["meta"]["gameMs"], Value::Null);
    assert_eq!(payload["plan"]["maxSimMs"], 720000);
    assert_eq!(payload["report"]["games"], 0);
    assert_eq!(payload["report"]["duration"]["meanS"], Value::Null);
    assert_eq!(payload["report"]["firstDeathMedianS"], Value::Null);
    assert!(payload["games"].as_array().unwrap().is_empty());
    // The source payload carries evaluate()'s criteria and the full report shape.
    let criteria = payload["criteria"].as_array().unwrap();
    assert_eq!(
        criteria.len(),
        rh_headless::tournament::evaluate(&report).len()
    );
    assert_eq!(
        criteria[0]["ok"],
        Value::Null,
        "no tier can be judged on no games"
    );
    assert!(criteria[0]["text"]
        .as_str()
        .unwrap()
        .contains("needs two tiers"));
    assert_eq!(payload["report"]["tiers"], serde_json::json!([]));
}

/// The report views are the actual source pipeline: source GameSummary rows (with the full behaviour block) through
/// aggregate, then formatReport with the source meta and evaluate. The Rust aggregate must reproduce the source report
/// JSON exactly, the printed layout exactly (including the columns fed by the humanizer telemetry), and the criteria
/// exactly; the empty and stored-games views pin the no-data rendering and the null wall meta.
#[test]
fn the_report_views_match_the_actual_source() {
    use rh_headless::tournament::{evaluate, format_report_with, ReportMeta};
    use rh_headless::tournament_cli::report_json;
    let f = fixture();
    let views = f["reportViews"].as_array().expect("report views");
    assert_eq!(views.len(), 3);
    for view in views {
        let name = view["name"].as_str().unwrap();
        let games: Vec<GameSummary> = view["games"]
            .as_array()
            .unwrap()
            .iter()
            .map(game_summary)
            .collect();
        let report = aggregate(&games);
        let meta = &view["meta"];
        let meta = ReportMeta {
            lineup: meta["lineup"].as_str().unwrap().to_owned(),
            seed: meta["seed"].as_u64().unwrap() as u32,
            learn: meta["learn"].as_bool().unwrap(),
            persona: meta["persona"].as_str().unwrap().to_owned(),
            faction: meta["faction"].as_str().unwrap().to_owned(),
            workers: meta["workers"].as_u64().unwrap() as u32,
            wall_ms: meta["wallMs"].as_f64(),
            game_ms: meta["gameMs"].as_f64(),
        };
        same_json(
            &report_json(&report),
            &view["report"],
            &format!("{name}: report"),
        );
        assert_eq!(
            format_report_with(&report, &meta),
            view["format"].as_str().unwrap(),
            "{name}: printed layout"
        );
        let criteria = evaluate(&report);
        let expected = view["criteria"].as_array().unwrap();
        assert_eq!(criteria.len(), expected.len(), "{name}: criteria count");
        for (i, (got, want)) in criteria.iter().zip(expected).enumerate() {
            assert_eq!(
                want["text"].as_str().unwrap(),
                got.text,
                "{name}: criterion {i} text"
            );
            let want_ok = match &want["ok"] {
                Value::Null => None,
                Value::Bool(ok) => Some(*ok),
                other => panic!("{name}: bad criterion ok {other}"),
            };
            assert_eq!(want_ok, got.ok, "{name}: criterion {i} verdict");
        }
    }
}
