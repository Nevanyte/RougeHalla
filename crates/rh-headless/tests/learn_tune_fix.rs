//! P-BOT-LEARN-TUNE-fix: review notes 2 and 3 of P-BOT-LEARN-ON-1 / P-BOT-TUNER-1.
use rh_headless::tournament::{aggregate, default_sim_config, play, SeatSpec, TournamentPlan};
use rh_headless::tournament_cli::{json_payload, json_payload_with_policy};
use rh_headless::tournament_learning::{play_learning, resolved_record, LearnStore, SeatPolicy};
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::bots::{PersonaId, TierId};
use rh_sim::arenas::practice_arena;
use rh_sim::content::FactionId;
use rh_sim::{ArenaMode, ArenaRules, Event, SimConfig};

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

#[test]
fn payload_names_the_policy_only_when_it_is_not_human() {
    let plan = small_plan(1);
    let games: Vec<_> = play(&plan, &practice_arena(), &fast_config())
        .into_iter()
        .map(|r| r.summary)
        .collect();
    let report = aggregate(&games);
    let default = json_payload(&plan, &report, &games, None, None);
    let human = json_payload_with_policy(&plan, &report, &games, None, None, SeatPolicy::Human);
    assert_eq!(default, human, "the default payload does not move");
    assert!(default["meta"].get("policy").is_none());
    let brain = json_payload_with_policy(&plan, &report, &games, None, None, SeatPolicy::Brain);
    assert_eq!(brain["meta"]["policy"], "brain");
}

#[test]
fn a_learning_run_reports_one_worker() {
    let mut plan = small_plan(1);
    plan.learn = true;
    plan.workers = 4;
    let mut store = LearnStore::new();
    let games: Vec<_> = play_learning(
        &plan,
        &practice_arena(),
        &fast_config(),
        SeatPolicy::Brain,
        &mut store,
    )
    .into_iter()
    .map(|g| g.summary)
    .collect();
    let payload = json_payload_with_policy(
        &plan,
        &aggregate(&games),
        &games,
        None,
        None,
        SeatPolicy::Brain,
    );
    assert_eq!(payload["meta"]["workers"], 1);
    assert_eq!(payload["meta"]["policy"], "brain");
    plan.learn = false;
    let off = json_payload(&plan, &aggregate(&games), &games, None, None);
    assert_eq!(off["meta"]["workers"], 4, "learning off echoes the request");
}

fn two_brain_env() -> Env {
    let arena = practice_arena();
    let sim = fast_config();
    let agents = [TierId::Normal, TierId::Hard]
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
    Env::new(
        EnvConfig {
            arena,
            sim,
            max_ticks: 2000,
            record: false,
        },
        agents,
        11,
    )
}

fn first_resolved(env: &mut Env) -> (rh_sim::PlayerId, rh_sim::RunResult) {
    loop {
        let progress = env.advance(&[]);
        let hit = env.last_events().iter().find_map(|e| match e {
            Event::Resolved { id, result, .. } => Some((*id, result.clone())),
            _ => None,
        });
        if let Some(hit) = hit {
            return hit;
        }
        assert!(!(progress.terminated || progress.truncated), "no result");
    }
}

#[test]
fn a_resolved_record_is_attributed_by_the_id_passed_not_by_position() {
    let spec = SeatSpec {
        tier: TierId::Normal,
        persona: PersonaId::Hunter,
        faction: FactionId::ALL[0],
    };
    // Run to the first resolved seat, then ask for its record with a position that points at the other seat: the id
    // decides whose end-of-run summary is read, so the record carries the choices a direct finish of that id gives.
    let mut env = two_brain_env();
    let (id, result) = first_resolved(&mut env);
    let mut direct = two_brain_env();
    first_resolved(&mut direct);
    let mut want = direct
        .finish_seat(id, Some(&result))
        .expect("a seated Brain finishes")
        .choices;
    want.push(format!("faction|hunter|{}", spec.faction.as_str()));
    let other = env.sim.players().iter().position(|p| p.id != id).unwrap();
    let record = resolved_record(&mut env, other, id, &spec, &result);
    assert_eq!(record.choices, want);
    assert_eq!(record.index, other);
}
