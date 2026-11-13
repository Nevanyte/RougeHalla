//! P-BOT-BRAIN-RECONCILE-1 review notes: the map facts a Brain seat holds but never reads (a map twin through `BrainBot`
//! over the same frames), and a faulted seat reports no choices.
use super::*;
use crate::{drive_seats, scripted, Fault, InputPreview, PolicyInput, Seat};
use rh_sim::{FactionId, Secrets, Sim, SimConfig};

/// seed1 with every server-side map fact the Brain path never reads changed, still a valid map: the layer `seed`, the
/// ground-weapon spots and the crate spots (with the region chest spots they must equal, in reverse order), and the
/// arena's own spawn points. The layer `spawns` cannot change alone: validation ties them to the spawn pool the Brain
/// reads at the plan's dealt indexes.
fn seed1_twin() -> rh_sim::Arena {
    let mut doc: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .expect("seed1 map");
    let map = &mut doc["map"];
    map["seed"] = serde_json::json!(424_242);
    let ground = map["groundSpots"].as_array_mut().expect("groundSpots");
    ground.reverse();
    ground.truncate(ground.len() / 2);
    let mut crates = Vec::new();
    for region in map["regions"].as_array_mut().expect("regions") {
        let spots = region["chestSpots"].as_array_mut().expect("chestSpots");
        spots.reverse();
        crates.extend(spots.iter().cloned());
    }
    map["crateSpots"] = serde_json::Value::Array(crates);
    let file: rh_sim::mapdata::MapExport = serde_json::from_value(doc).expect("export");
    let mut arena = file
        .validate()
        .expect("the twin is a valid map")
        .into_arena()
        .expect("arena");
    arena.spawns.reverse();
    arena
}

/// Two Brains on one seat over the same accepted frames: `a` with the match's arena (its commands are the seat's),
/// `b` with the twin arena; both tap every composition and the commands decided from it.
struct Twin {
    a: BrainBot,
    b: BrainBot,
    b_arena: Arc<rh_sim::Arena>,
    diverged: Arc<Mutex<Vec<usize>>>,
    decisions: usize,
}

impl Policy for Twin {
    fn spec(&self) -> PolicySpec {
        self.a.spec()
    }
    fn input_kind(&self) -> InputKind {
        InputKind::Delivered14
    }
    fn reset(&mut self, m: &MatchStart) {
        self.a.reset(m);
        self.b.reset(&MatchStart {
            arena: Arc::clone(&self.b_arena),
            ..m.clone()
        });
    }
    fn check_input(&self, input: InputPreview<'_>) -> Result<(), InputRefusal> {
        let (a, b) = (self.a.check_input(input), self.b.check_input(input));
        assert_eq!(a, b, "the twins refuse alike");
        a
    }
    fn decide_input_into(
        &mut self,
        input: PolicyInput<'_>,
        out: &mut Vec<PublicCommand>,
    ) -> Result<(), InputRefusal> {
        let mut other = Vec::new();
        let a = self.a.decide_input_into(input, out);
        let b = self.b.decide_input_into(input, &mut other);
        if a != b || *out != other {
            self.diverged.lock().expect("diverged").push(self.decisions);
        }
        self.decisions += 1;
        a
    }
    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        Vec::new()
    }
}

fn source_config() -> SimConfig {
    SimConfig {
        abilities: rh_sim::abilities::Mode::Full,
        lifecycle: rh_sim::ArenaMode::Source(Default::default()),
        mob_mode: rh_sim::mob_runtime::MobMode::Pve,
        initial_loot: true,
        min_players: 1,
        lobby_seconds: 2.,
        fill_seconds: 1.,
        ..SimConfig::default()
    }
}

#[test]
fn map_twins_differing_only_in_unread_server_facts_compose_and_command_alike() {
    let arena = crate::bots::temporal_percept::brain::compose14::test_support::seed1_arena();
    let twin = seed1_twin();
    let (a, b) = (arena.map.layers().unwrap(), twin.map.layers().unwrap());
    assert_ne!(a.data().seed, b.data().seed, "premise: seed differs");
    assert_ne!(a.data().ground_spots, b.data().ground_spots);
    assert_ne!(a.data().crate_spots, b.data().crate_spots);
    assert_ne!(arena.spawns, twin.spawns, "premise: arena spawns differ");
    assert_eq!(
        arena.map.tiles, twin.map.tiles,
        "the collision grid is shared"
    );
    let config = source_config();
    let features = brain_features(&config, &arena);
    assert_eq!(features, brain_features(&config, &twin));
    let mut sim = Sim::new(config, arena, Secrets::from_seed(6));
    let ids: Vec<_> = (0..3)
        .map(|i| {
            sim.add_player(&format!("bot{i}"), Some(FactionId::ALL[i]), true)
                .expect("seat")
        })
        .collect();
    let (tap_a, tap_b): (Tap, Tap) = Default::default();
    let diverged = Arc::new(Mutex::new(Vec::new()));
    let mut seats: Vec<Seat> = ids
        .iter()
        .enumerate()
        .map(|(i, &id)| {
            let policy: Box<dyn Policy> = if i == 0 {
                Box::new(Twin {
                    a: BrainBot::new(TierId::Hard, PersonaId::Hunter, features.clone())
                        .with_tap(tap_a.clone()),
                    b: BrainBot::new(TierId::Hard, PersonaId::Hunter, features.clone())
                        .with_tap(tap_b.clone()),
                    b_arena: Arc::new(twin.clone()),
                    diverged: diverged.clone(),
                    decisions: 0,
                })
            } else {
                Box::new(BrainBot::new(
                    TierId::Normal,
                    PersonaId::ALL[i],
                    features.clone(),
                ))
            };
            Seat::new(
                &MatchStart::of(&sim, id, 70 + i as u64),
                policy,
                Box::new(scripted::Idle),
            )
        })
        .collect();
    for seat in &mut seats {
        seat.bind_fx(&sim).expect("unbound");
    }
    let mut events = Vec::new();
    for _ in 0..600 {
        drive_seats(&mut sim, &mut seats, &events);
        events.clear();
        sim.step_into(&mut events);
    }
    assert_eq!(seats[0].fault, None);
    assert_eq!(*diverged.lock().unwrap(), Vec::<usize>::new());
    let (a, b) = (tap_a.lock().unwrap(), tap_b.lock().unwrap());
    assert!(a.len() > 400, "the twins composed {} decisions", a.len());
    assert!(
        a.iter().any(|(_, cmds)| !cmds.is_empty()),
        "the seat acted, so equal commands are evidence"
    );
    let phases: Vec<&str> = a
        .iter()
        .filter_map(|(raw, _)| raw.get("hud")?.get("phase")?.as_str())
        .collect();
    assert!(
        phases.contains(&"planning") && phases.contains(&"active"),
        "the run dealt a plan and played"
    );
    assert_eq!(a.len(), b.len());
    for (i, (x, y)) in a.iter().zip(b.iter()).enumerate() {
        assert_eq!(x.0, y.0, "decision {i}: the composed records differ");
        assert_eq!(x.1, y.1, "decision {i}: the commands differ");
    }
}

#[test]
fn a_faulted_brain_seat_reports_no_choices() {
    let arena = rh_sim::arenas::practice_arena();
    let placement = rh_sim::Placement {
        profile: "p0".into(),
        faction: FactionId::Holy,
        bot: true,
        at: rh_sim::Vec2::new(400., 320.),
        hp: None,
        weapon0: None,
        weapon1: None,
    };
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        arena.clone(),
        Secrets::from_seed(3),
        &[placement],
    );
    let me = sim.players()[0].id;
    let mut seats = vec![Seat::new(
        &MatchStart::of(&sim, me, 9),
        Box::new(BrainBot::new(
            TierId::Easy,
            PersonaId::Farmer,
            brain_features(&SimConfig::default(), &arena),
        )),
        Box::new(crate::bots::HumanBot::new(TierId::Easy, PersonaId::Farmer)),
    )];
    seats[0].bind_fx(&sim).unwrap();
    let mut events = Vec::new();
    for _ in 0..20 {
        drive_seats(&mut sim, &mut seats, &events);
        events.clear();
        sim.step_into(&mut events);
    }
    assert_eq!(
        seats[0].fault,
        Some(Fault::Input(InputRefusal::ArenaUnavailable)),
        "premise: the Brain faulted and HumanBot played"
    );
    assert_eq!(
        seats[0].finish(None),
        None,
        "the result HumanBot played is not the Brain's to report"
    );
}
