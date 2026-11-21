//! P-WIRE19-B oracle (observation, C-OBS): `Observation::readouts` is the viewer's own native readout rows
//! (`cards::native::readouts(sim, viewer)`), filled beside the owner's card counts on every observation; another player's
//! native state never changes one byte of a viewer's observation; a non-player, a non-holder and every Legacy world
//! observe none, and an observation without rows serializes without the field. Brief
//! `docs/backlog/packets/P-WIRE19-B.md`.
//!
//! No `const` here: the content registry counts every `const` under `src`.
use crate::cards::native::{readouts, rule, Readout, ReadoutKind};
use crate::cards::CardId;
use crate::{
    arenas, observe, AugmentRule, FactionId, Observation, Placement, PlayerId, Secrets, Sim,
    SimConfig, Vec2, WeaponId,
};

fn seat(profile: &str, at: Vec2, weapon: WeaponId) -> Placement {
    Placement {
        profile: profile.into(),
        faction: FactionId::Holy,
        bot: false,
        at,
        hp: None,
        weapon0: Some(weapon),
        weapon1: None,
    }
}

/// Three seats in sight of each other on the practice arena: a bow, a shield and a sword.
fn world(rule: AugmentRule) -> Sim {
    Sim::reset_active(
        SimConfig {
            augments: rule,
            ..SimConfig::default()
        },
        arenas::practice_arena(),
        Secrets::from_seed(5),
        &[
            seat("a", Vec2::new(300., 272.), WeaponId::Bow),
            seat("b", Vec2::new(360., 272.), WeaponId::Shield),
            seat("c", Vec2::new(300., 400.), WeaponId::Sword),
        ],
    )
}

fn give(sim: &mut Sim, id: PlayerId, card: CardId) {
    assert!(
        crate::cards::grant(&sim.k, &mut sim.w, id, card),
        "{id:?} takes {card:?}"
    );
}

fn set(sim: &mut Sim, id: PlayerId, card: CardId, counter: f64, meter: f64) {
    let i = sim.w.idx(id).unwrap();
    let s = sim.w.players[i].build.native.slot_mut(card).unwrap();
    s.counter = counter;
    s.meters[0] = meter;
}

/// A Rework world where player 1 holds Marksman's Tally and Bastion and player 2 holds Bastion; player 1's numbers are
/// `tally` and `meter`, player 2's meter is 7.
fn holders(tally: f64, meter: f64) -> Sim {
    let mut sim = world(AugmentRule::Rework);
    give(&mut sim, PlayerId(1), CardId::MarksmansTally);
    give(&mut sim, PlayerId(1), CardId::Bastion);
    give(&mut sim, PlayerId(2), CardId::Bastion);
    set(&mut sim, PlayerId(1), CardId::MarksmansTally, tally, 0.);
    set(&mut sim, PlayerId(1), CardId::Bastion, 0., meter);
    set(&mut sim, PlayerId(2), CardId::Bastion, 0., 7.);
    sim
}

fn without_readouts(o: Observation) -> Observation {
    Observation {
        readouts: Vec::new(),
        ..o
    }
}

#[test]
fn each_viewer_observes_its_own_readouts_beside_its_card_counts() {
    let sim = holders(0.12, 40.);
    let tally_cap = rule(CardId::MarksmansTally).unwrap().counter_cap;
    let meter_cap = rule(CardId::Bastion).unwrap().meter_caps[0];
    let one = observe(&sim, PlayerId(1), &[]);
    assert!(one.build.is_some(), "premise: the owner's card counts");
    assert_eq!(
        one.readouts,
        [
            Readout {
                card: CardId::MarksmansTally,
                kind: ReadoutKind::Counter,
                value: 0.12,
                max: tally_cap,
            },
            Readout {
                card: CardId::Bastion,
                kind: ReadoutKind::Meter,
                value: 40.,
                max: meter_cap,
            },
        ],
        "player 1's own rows, in native order"
    );
    assert_eq!(
        observe(&sim, PlayerId(2), &[]).readouts,
        [Readout {
            card: CardId::Bastion,
            kind: ReadoutKind::Meter,
            value: 7.,
            max: meter_cap,
        }],
        "player 2 observes its own Bastion, never player 1's"
    );
    assert!(
        observe(&sim, PlayerId(3), &[]).readouts.is_empty(),
        "a non-holder observes none"
    );
    assert!(
        observe(&sim, PlayerId(99), &[]).readouts.is_empty(),
        "a non-player observes none"
    );
    for v in [PlayerId(1), PlayerId(2), PlayerId(3), PlayerId(99)] {
        assert_eq!(
            observe(&sim, v, &[]).readouts,
            readouts(&sim, v).rows(),
            "{v:?}: the observation carries exactly the producer's rows"
        );
    }
}

#[test]
fn another_players_native_state_changes_nothing_a_viewer_observes() {
    let low = holders(0.12, 40.);
    let high = holders(0.27, 180.);
    for v in [PlayerId(2), PlayerId(3), PlayerId(99)] {
        assert_eq!(
            observe(&low, v, &[]),
            observe(&high, v, &[]),
            "{v:?}: player 1's numbers never reach another viewer"
        );
    }
    let (a, b) = (
        observe(&low, PlayerId(1), &[]),
        observe(&high, PlayerId(1), &[]),
    );
    assert_ne!(a.readouts, b.readouts, "the owner sees its own numbers");
    assert_eq!(
        without_readouts(a),
        without_readouts(b),
        "and nothing else differs"
    );
}

#[test]
fn the_rows_follow_the_slots_from_one_observation_to_the_next() {
    let mut sim = holders(0.12, 40.);
    let mut out = Observation::default();
    crate::observe_into(&sim, PlayerId(1), &[], &mut out);
    assert_eq!(out.readouts.len(), 2, "two rows");
    set(&mut sim, PlayerId(1), CardId::MarksmansTally, 0.15, 0.);
    set(&mut sim, PlayerId(1), CardId::Bastion, 0., 0.);
    sim.step();
    crate::observe_into(&sim, PlayerId(1), &[], &mut out);
    assert_eq!(
        out.readouts,
        readouts(&sim, PlayerId(1)).rows(),
        "the reused buffer holds this tick's rows, not last tick's"
    );
    assert_eq!(out.readouts[0].value, 0.15);
    assert_eq!(out.readouts.len(), 2, "rows are replaced, never appended");
    crate::observe_into(&sim, PlayerId(3), &[], &mut out);
    assert!(
        out.readouts.is_empty(),
        "another viewer's buffer is cleared"
    );
}

#[test]
fn legacy_and_native_free_observations_carry_no_rows_and_serialize_without_the_field() {
    let legacy = world(AugmentRule::Legacy);
    let plain = world(AugmentRule::Rework);
    for sim in [&legacy, &plain] {
        for v in [PlayerId(1), PlayerId(2), PlayerId(3)] {
            let o = observe(sim, v, &[]);
            assert!(o.readouts.is_empty(), "{v:?}");
            let json = serde_json::to_value(&o).unwrap();
            assert!(
                json.get("readouts").is_none(),
                "{v:?}: no rows, no field (the observation hashes as before it existed)"
            );
        }
    }
    // A holder's observation names the field and round-trips through serde.
    let sim = holders(0.12, 40.);
    let o = observe(&sim, PlayerId(1), &[]);
    let json = serde_json::to_value(&o).unwrap();
    assert_eq!(
        json.get("readouts")
            .and_then(|r| r.as_array())
            .map(Vec::len),
        Some(2),
        "the holder's rows are serialized"
    );
    let back: Observation = serde_json::from_value(json).unwrap();
    assert_eq!(back, o);
}

#[test]
fn observation_version_is_33() {
    assert_eq!(
        crate::OBSERVATION_VERSION,
        35,
        "Observation gains readouts (P-WIRE19-B): CONTRACTS C-OBS, a new observation field bumps the version; 33: P-SYNC-ORIGIN-1; 34: P-AUG-NATIVE-5; 35: P-SYNC-ORIGIN-2"
    );
}
