//! P-BOTS-1 native seat proof: eight human-like bots on the deterministic policy seats, playing through the ported
//! human-likeness core, with no client-side rules and no input path but validate + submit.
//!
//! The hand itself is compared against the frozen source corpus in rh-policy (parity/policy/bot-core.json); this file
//! proves the seat integration: a deterministic replay, no policy faults, real proposed/accepted commands, and that a
//! pair of identically reset bots proposes the same commands for the same accepted delivered-frame history.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::bots::{assign_seats, HumanBot};
use rh_policy::{
    drive_seats_queued, InputKind, InputPreview, InputRefusal, InputRequirements, MatchStart,
    Policy, PolicyInput, PolicySpec, Seat, SeatStats,
};
use rh_sim::arenas::practice_arena;
use rh_sim::{
    observe, FactionId, Observation, Phase, Placement, PublicCommand, Secrets, Sim, SimConfig, Vec2,
};

/// Both bots independently consume the same receipt produced by the ordinary seat's DeliverySession.
/// This adapter neither constructs an AcceptedFrame14 nor substitutes commands for either bot.
struct CompareDeliveredHistory {
    a: HumanBot,
    b: HumanBot,
}

impl Policy for CompareDeliveredHistory {
    fn spec(&self) -> PolicySpec {
        self.a.spec()
    }
    fn input_kind(&self) -> InputKind {
        self.a.input_kind()
    }
    fn input_requirements(&self) -> InputRequirements {
        self.a.input_requirements()
    }
    fn reset(&mut self, start: &MatchStart) {
        self.a.reset(start);
        self.b.reset(start);
    }
    fn check_input(&self, input: InputPreview<'_>) -> Result<(), InputRefusal> {
        self.a.check_input(input)?;
        self.b.check_input(input)
    }
    fn decide_input_into(
        &mut self,
        input: PolicyInput<'_>,
        out: &mut Vec<PublicCommand>,
    ) -> Result<(), InputRefusal> {
        assert!(matches!(input, PolicyInput::Delivered14(_)));
        let base = out.len();
        self.a.decide_input_into(input, out)?;
        let mut other = Vec::new();
        self.b.decide_input_into(input, &mut other)?;
        assert_eq!(
            &out[base..],
            other.as_slice(),
            "identical accepted delivered-frame histories decide identically"
        );
        Ok(())
    }
    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        panic!("the accepted-history control must use the typed delivery path")
    }
}

fn seats(seed: u64, max_ticks: u32, record: bool) -> Env {
    let arena = practice_arena();
    let assigned = assign_seats(seed, 8);
    let agents = assigned
        .iter()
        .enumerate()
        .map(|(i, (tier, persona))| AgentSpec {
            profile: format!("bot{i}"),
            faction: FactionId::ALL[(i + seed as usize) % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(HumanBot::new(*tier, *persona)),
            },
        })
        .collect();
    Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks,
            record,
        },
        agents,
        seed,
    )
}

struct Run {
    hashes: Vec<u64>,
    seeds: Vec<u64>,
    stats: Vec<(rh_sim::PlayerId, SeatStats, Option<rh_policy::Fault>)>,
    hits: u64,
    replay: Option<serde_json::Value>,
}

fn run(seed: u64, max_ticks: u32) -> Run {
    let mut env = seats(seed, max_ticks, true);
    let mut hashes = Vec::new();
    let mut seeds = Vec::new();
    let mut hits = 0u64;
    for _ in 0..max_ticks {
        env.advance(&[]);
        hashes.push(env.sim.state_hash());
        seeds.push(env.sim.tick() as u64);
        for e in env.last_events() {
            if matches!(e, rh_sim::Event::Hit { .. }) {
                hits += 1;
            }
        }
        if env.sim.phase() == Phase::Ended {
            break;
        }
    }
    let stats = env.seat_stats();
    let replay = env
        .into_replay()
        .map(|r| serde_json::to_value(r).expect("replay json"));
    Run {
        hashes,
        seeds,
        stats,
        hits,
        replay,
    }
}

#[test]
fn human_bots_play_deterministically_on_the_policy_seats() {
    let a = run(7, 400);
    let b = run(7, 400);
    assert_eq!(a.seeds, b.seeds, "same seed plays the same ticks");
    assert_eq!(a.hashes, b.hashes, "same seed replays exactly");
    assert_eq!(a.replay, b.replay, "the recorded replay is byte-identical");
    assert!(
        a.hits > 0,
        "the human-like bots actually fight: {} hits",
        a.hits
    );
    let mut proposed = 0;
    let mut accepted = 0;
    for (_, s, fault) in &a.stats {
        assert!(fault.is_none(), "no policy fault: {fault:?}");
        proposed += s.proposed;
        accepted += s.accepted;
    }
    assert!(proposed > 0, "the seats propose commands");
    assert!(accepted > 0, "the commands pass validate + submit");
    let c = run(8, 400);
    assert_ne!(
        a.hashes, c.hashes,
        "a different seat seed plays differently"
    );
}

#[test]
fn identical_accepted_delivered_histories_produce_identical_commands() {
    let arena = practice_arena();
    let placements: Vec<Placement> = (0..2)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: true,
            at: Vec2::new(400. + 64. * i as f64, 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        arena,
        Secrets::from_seed(3),
        &placements,
    );
    let me = sim.players()[0].id;
    let start = MatchStart::of(&sim, me, 11);
    let new_bot = || {
        HumanBot::new(
            rh_policy::bots::TierId::Normal,
            rh_policy::bots::PersonaId::Hunter,
        )
    };
    // Raw Vec callbacks intentionally do nothing; typed raw input must refuse rather than restoring the old leak.
    // This negative probe never supplies the accepted history or its expected commands.
    let raw = observe(&sim, me, &[]);
    let mut raw_probe = new_bot();
    raw_probe.reset(&start);
    assert_eq!(raw_probe.input_kind(), InputKind::Delivered14);
    assert!(raw_probe.decide(&raw).is_empty());
    let mut refused = Vec::new();
    raw_probe.decide_into(&raw, &mut refused);
    assert!(refused.is_empty());
    assert_eq!(
        raw_probe.check_input(InputPreview::NativeCompatibility(&raw)),
        Err(InputRefusal::RequiresDelivered14)
    );
    assert_eq!(
        raw_probe.decide_input_into(PolicyInput::NativeCompatibility(&raw), &mut refused),
        Err(InputRefusal::RequiresDelivered14)
    );
    assert!(refused.is_empty(), "raw refusal cannot append a proposal");

    let mut seats = [Seat::new(
        &start,
        Box::new(CompareDeliveredHistory {
            a: new_bot(),
            b: new_bot(),
        }),
        Box::new(rh_policy::scripted::Idle),
    )];
    seats[0].bind_fx(&sim).expect("bind before the first step");
    let mut sight = rh_sim::SightCache::new();
    let mut any = 0usize;
    for _ in 0..200 {
        drive_seats_queued(&mut sim, &mut seats, &[], &mut sight, |id, _| {
            assert_eq!(id, me);
            any += 1;
        });
        assert!(
            seats[0].fault.is_none(),
            "delivery/decision fault: {:?}",
            seats[0].fault
        );
        sim.step();
    }
    assert!(
        seats[0].stats.decisions > 1,
        "compare an accepted history, not one frame"
    );
    assert!(
        any > 0,
        "the bot proposed commands from accepted delivered frames"
    );
    assert_eq!(seats[0].stats.proposed, any as u64);
    assert_eq!(seats[0].stats.fallback_decisions, 0);
}

#[test]
fn seat_assignment_is_deterministic_and_mixed() {
    let a = assign_seats(42, 8);
    let b = assign_seats(42, 8);
    assert_eq!(a, b, "the same manager seed seats the same bots");
    let c = assign_seats(43, 8);
    assert_ne!(a, c, "a different manager seed mixes the seats differently");
    // 8 seats at 30/45/25 should include at least two tiers in practice (the exact draw is pinned by the same seed).
    let mut tiers = std::collections::BTreeSet::new();
    for (tier, _) in &a {
        tiers.insert(*tier);
    }
    assert!(tiers.len() >= 2, "the tier mix is not degenerate: {a:?}");
}
