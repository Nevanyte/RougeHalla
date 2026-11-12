//! P-BOT-BRAIN-LIVE-1 seat-level checks of BrainBot: it declares the typed delivered input, refuses a raw observation,
//! plays a source arena through the ordinary seat path, and reports its choices once (`Seat::finish`).
use super::*;
use crate::bots::learning::valid_key;
use crate::{drive_seats, scripted, Fault, Seat};
use rh_sim::{
    abilities, ArenaMode, ArenaRules, FactionId, Placement, Secrets, Sim, SimConfig, Vec2,
};

fn seed1_arena() -> rh_sim::Arena {
    let file: rh_sim::mapdata::MapExport = serde_json::from_str(include_str!(
        "../../../../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .expect("seed1 map");
    file.validate().unwrap().into_arena().unwrap()
}

fn config() -> SimConfig {
    SimConfig {
        abilities: abilities::Mode::Full,
        lifecycle: ArenaMode::Source(ArenaRules {
            plan_seconds: 0.,
            ..Default::default()
        }),
        ..SimConfig::default()
    }
}

#[test]
fn a_brain_seat_declares_the_delivered_input_and_refuses_raw_observations() {
    let arena = seed1_arena();
    let features = brain_features(&config(), &arena);
    let bot = BrainBot::new(TierId::Normal, PersonaId::Hunter, features.clone());
    let spec = bot.spec();
    assert_eq!(spec.name, "brain-normal-hunter");
    assert_eq!(spec.decision_interval_ticks, 1);
    assert_eq!(spec.contract, POLICY_CONTRACT_VERSION);
    assert_eq!(bot.input_kind(), InputKind::Delivered14);
    let raw = Observation::default();
    assert_eq!(
        bot.check_input(InputPreview::NativeCompatibility(&raw)),
        Err(InputRefusal::RequiresDelivered14)
    );
    assert!(features.wishes && features.chests && features.status_effects && features.planning);
    assert!(features.message_types.iter().any(|m| m == "move"));
}

#[test]
fn a_brain_seat_plays_and_reports_its_choices_once() {
    let arena = seed1_arena();
    let placements: Vec<Placement> = (0..3)
        .map(|i| Placement {
            profile: format!("bot{i}"),
            faction: FactionId::ALL[i],
            bot: true,
            at: arena.spawns[i * 3],
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(config(), arena.clone(), Secrets::from_seed(2), &placements);
    let features = brain_features(&config(), &arena);
    let ids: Vec<_> = sim.players().iter().map(|p| p.id).collect();
    let mut seats: Vec<Seat> = ids
        .into_iter()
        .enumerate()
        .map(|(i, id)| {
            Seat::new(
                &MatchStart::of(&sim, id, 40 + i as u64),
                Box::new(BrainBot::new(
                    TierId::Hard,
                    PersonaId::ALL[i],
                    features.clone(),
                )),
                Box::new(scripted::Idle),
            )
        })
        .collect();
    for seat in &mut seats {
        seat.bind_fx(&sim).unwrap();
    }
    let mut events = Vec::new();
    for _ in 0..600 {
        drive_seats(&mut sim, &mut seats, &events);
        events.clear();
        sim.step_into(&mut events);
    }
    for seat in &mut seats {
        assert_eq!(seat.fault, None);
        assert!(
            seat.stats.accepted > 0,
            "the Brain's commands pass validate + submit"
        );
        let finish = seat.finish(None).expect("a seated Brain reports");
        for key in &finish.choices {
            assert!(valid_key(key), "a learning key: {key}");
        }
        assert_eq!(seat.finish(None), None, "asked once");
    }
}

#[test]
fn a_brain_without_a_source_arena_refuses_and_its_fallback_plays() {
    let arena = rh_sim::arenas::practice_arena();
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
        arena.clone(),
        Secrets::from_seed(3),
        &placements,
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
    for _ in 0..40 {
        drive_seats(&mut sim, &mut seats, &events);
        events.clear();
        sim.step_into(&mut events);
    }
    assert_eq!(
        seats[0].fault,
        Some(Fault::Input(InputRefusal::ArenaUnavailable))
    );
    assert!(seats[0].stats.fallback_decisions > 0);
}
