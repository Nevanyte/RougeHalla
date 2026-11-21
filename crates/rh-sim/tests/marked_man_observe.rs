//! P-AUG-NATIVE-5 oracle (observation): every observation carries one public `MarkedView { id, x, y }` per `Alive`
//! Marked Man holder, by ascending id, the same for every viewer (the holder, every other player, an unseated viewer)
//! and whatever the viewer's vision: the minimap marker of decision 9, deliberately public under C-OBS. Nothing else of
//! the holder reaches a viewer that cannot see it: with `marked` cleared, every observation equals the one of the same
//! world without the card, tick by tick, and so do the events. A Legacy world and a Rework world without a holder carry no
//! row and serialize no `marked` key (their observations are byte-identical to before the field, the version aside).
//! Brief `docs/backlog/packets/P-AUG-NATIVE-5.md`.
use rh_sim::cards::CardId;
use rh_sim::observe::MarkedView;
use rh_sim::{
    observe, Arena, AugmentRule, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, WeaponId,
};
use serde_json::{json, Value};

fn seed1_arena() -> Arena {
    let import: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    import.validate().unwrap().into_arena().unwrap()
}

/// Three seated players on three seed1 spawns (far apart), stepped twice.
fn world(augments: AugmentRule) -> Sim {
    let arena = seed1_arena();
    let places: Vec<Placement> = (0..3)
        .map(|i| Placement {
            profile: format!("marked-{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: arena.spawns[i % arena.spawns.len()],
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig {
            augments,
            ..SimConfig::default()
        },
        arena,
        Secrets::from_seed(41),
        &places,
    );
    sim.step();
    sim.step();
    sim
}

/// The checkpoint of `base` with Marked Man held (carry 0) by the given player slots.
fn holding(base: &Sim, slots: &[usize]) -> Sim {
    let mut cp: Value = serde_json::to_value(base).unwrap();
    for &i in slots {
        cp["world"]["players"][i]["build"]["native"] = json!([{
            "card": CardId::MarkedMan.as_str(), "count": 1, "counter": 0., "meters": [0., 0., 0.], "marks": 0
        }]);
    }
    let restored = Sim::restore(cp);
    assert!(
        restored.is_ok(),
        "premise: a Rework world holding Marked Man restores: {:?}",
        restored.as_ref().err()
    );
    restored.unwrap()
}

fn viewers(sim: &Sim) -> Vec<PlayerId> {
    let mut v: Vec<PlayerId> = sim.players().iter().map(|p| p.id).collect();
    v.push(PlayerId(99)); // no seat
    v
}

fn row(sim: &Sim, id: PlayerId) -> MarkedView {
    let p = sim.player(id).unwrap();
    MarkedView {
        id,
        x: p.body.x,
        y: p.body.y,
    }
}

#[test]
fn every_viewer_sees_the_holder_on_the_minimap_outside_its_vision() {
    let base = world(AugmentRule::Rework);
    let mut sim = holding(&base, &[0]);
    let holder = sim.players()[0].id;
    // Premise: some other player cannot see the holder (the spawns are far apart).
    let blind: Vec<PlayerId> = viewers(&sim)
        .into_iter()
        .filter(|&v| v != holder && v != PlayerId(99))
        .filter(|&v| !observe(&sim, v, &[]).visible.iter().any(|a| a.id == holder))
        .collect();
    assert!(
        !blind.is_empty(),
        "premise: the holder is outside some viewer's vision"
    );
    for t in 0..10 {
        for v in viewers(&sim) {
            let obs = observe(&sim, v, &[]);
            assert_eq!(
                obs.marked,
                vec![row(&sim, holder)],
                "tick {t}: viewer {v:?} has the holder's marker"
            );
            if blind.contains(&v) {
                assert!(
                    !obs.visible.iter().any(|a| a.id == holder),
                    "tick {t}: {v:?} still cannot see the holder; the marker is not an actor row"
                );
            }
            let json = serde_json::to_value(&obs).unwrap();
            assert_eq!(
                json["marked"],
                json!([{"id": holder.0, "x": row(&sim, holder).x, "y": row(&sim, holder).y}]),
                "tick {t}: viewer {v:?}: the serialized marker"
            );
        }
        sim.step();
    }
}

#[test]
fn two_holders_are_listed_by_ascending_id_for_everyone() {
    let base = world(AugmentRule::Rework);
    let sim = holding(&base, &[2, 0]);
    let ids: Vec<PlayerId> = sim.players().iter().map(|p| p.id).collect();
    for v in viewers(&sim) {
        assert_eq!(
            observe(&sim, v, &[]).marked,
            vec![row(&sim, ids[0]), row(&sim, ids[2])],
            "viewer {v:?}"
        );
    }
}

#[test]
fn nothing_else_of_the_holder_reaches_any_viewer() {
    let base = world(AugmentRule::Rework);
    let mut marked = holding(&base, &[0]);
    let mut plain = Sim::restore(serde_json::to_value(&base).unwrap()).unwrap();
    let holder = marked.players()[0].id;
    for t in 0..20 {
        // The holder's own view lists its own card (its build); every other viewer is the subject here.
        for v in viewers(&marked).into_iter().filter(|&v| v != holder) {
            let mut seen = observe(&marked, v, &[]);
            seen.marked.clear();
            assert_eq!(
                seen,
                observe(&plain, v, &[]),
                "tick {t}: viewer {v:?} learns nothing but the marker (C-OBS)"
            );
        }
        assert_eq!(
            marked.step(),
            plain.step(),
            "tick {t}: no event tells the card apart"
        );
    }
}

#[test]
fn legacy_and_holder_free_worlds_carry_no_marked_rows() {
    for rule in [AugmentRule::Legacy, AugmentRule::Rework] {
        let mut sim = world(rule);
        for t in 0..10 {
            for v in viewers(&sim) {
                let obs = observe(&sim, v, &[]);
                assert!(obs.marked.is_empty(), "{rule:?} tick {t} viewer {v:?}");
                let json = serde_json::to_value(&obs).unwrap();
                assert!(
                    json.get("marked").is_none(),
                    "{rule:?} tick {t}: no `marked` key, so the observation serializes as before"
                );
            }
            sim.step();
        }
    }
}
