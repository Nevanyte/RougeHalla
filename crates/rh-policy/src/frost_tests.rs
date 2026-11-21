use super::*;
use rh_sim::{FactionId, FactionMode, Placement, RawCommand, Secrets, SimConfig, Vec2};
struct ChilledWalk {
    seen: Arc<std::sync::Mutex<Vec<Observation>>>,
}
impl Policy for ChilledWalk {
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            name: "frost-public-probe".into(),
            version: "1".into(),
            contract: POLICY_CONTRACT_VERSION,
            observation_version: OBSERVATION_VERSION,
            decision_interval_ticks: 1,
        }
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        self.seen.lock().unwrap().push(obs.clone());
        if obs.me.as_ref().is_some_and(|p| p.sig & 1 != 0) {
            vec![PublicCommand::Move {
                x: 550.,
                y: 320.,
                seq: None,
            }]
        } else {
            Vec::new()
        }
    }
}
#[test]
fn frost_policy_receives_public_chill_and_moves_through_normal_intake() {
    let mut s = Sim::reset_active(
        SimConfig {
            quests: false,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrost,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(12),
        &(0..2)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: if i == 0 {
                    FactionId::Frost
                } else {
                    FactionId::Holy
                },
                bot: false,
                at: Vec2::new(400. + 56. * i as f64, 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    );
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let start = MatchStart::of(&s, PlayerId(2), 13);
    let mut seats = [Seat::new(
        &start,
        Box::new(ChilledWalk {
            seen: Arc::clone(&seen),
        }),
        Box::new(scripted::Idle),
    )];
    seats[0].bind_fx(&s).unwrap();
    s.submit(
        PlayerId(1),
        rh_sim::validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    for _ in 0..15 {
        let events = s.step();
        drive_seats(&mut s, &mut seats, &events);
    }
    assert!(seats[0].fault.is_none());
    assert!(s.player(PlayerId(2)).unwrap().body.x > 456.);
    let seen = seen.lock().unwrap();
    assert!(seen
        .iter()
        .any(|o| o.me.as_ref().is_some_and(|p| p.sig & 1 != 0)));
    assert!(seen
        .iter()
        .all(|o| o.version == rh_sim::OBSERVATION_VERSION));
    assert_eq!(POLICY_CONTRACT_VERSION, 31); // 26: P-NET-DRAWAHEAD-1a; 27: P-WIRE19-B; 28: P-SYNC-ORIGIN-1; 29: P-AUG-BOTS-1 (MatchStart::elites); 30: P-AUG-NATIVE-5; 31: P-SYNC-ORIGIN-2
}
