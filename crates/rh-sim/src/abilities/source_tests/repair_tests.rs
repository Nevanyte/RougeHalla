//! Independent-review regressions use actual accepted casts and frozen source assertions.
use super::*;
#[test]
fn completed_stocks_require_real_spend_or_refund_provenance() {
    let corpus = corpus();
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "all-five-normal-cooldowns-and-blaze-stocks")
        .unwrap();
    let mut sim = construct(&case["input"]);
    for input in case["input"]["actions"][0]["inputs"].as_array().unwrap() {
        enqueue(&mut sim, input);
    }
    sim.step();
    let base = serde_json::to_value(&sim).unwrap();
    Sim::restore(base.clone()).unwrap();
    assert!(sim.w.players[4].statuses.cast.is_none());
    for (ready, full) in [(1_000_000., 1_000_000.), (50., 50.), (150099., 150099.)] {
        let mut bad = base.clone();
        bad["world"]["players"][4]["stocks"]["wish_ready_at"] = json!(ready);
        bad["world"]["players"][4]["stocks"]["wish_full_at"] = json!(full);
        assert!(
            Sim::restore(bad).is_err(),
            "completed LastStand stock {ready}/{full}"
        );
    }
    for (key, value) in [
        ("at", json!(0.)),
        ("at", json!(50.)),
        ("at", json!(100.5)),
        ("cooldown_ms", json!(150001.)),
    ] {
        let mut bad = base.clone();
        bad["world"]["players"][4]["card_runtime"]["wish_cast"][key] = value;
        assert!(Sim::restore(bad).is_err(), "completed WishSpend {key}");
    }
    for full in [1_000_000., 30099., 60101., 30100.5, 30101., 30150., 60100.] {
        let mut bad = base.clone();
        bad["world"]["players"][3]["stocks"]["wish_full_at"] = json!(full);
        bad["world"]["players"][3]["stocks"]["wish_ready_at"] = json!(full - 30000.);
        assert!(
            Sim::restore(bad).is_err(),
            "completed Blaze full clock {full}"
        );
    }
    let mut bad_rollback = base.clone();
    bad_rollback["world"]["players"][0]["core"]["statuses"]["cast"]["producer"]
        ["previous_ready_at"] = json!(60.);
    bad_rollback["world"]["players"][0]["core"]["statuses"]["cast"]["producer"]
        ["previous_full_at"] = json!(60.);
    assert!(
        Sim::restore(bad_rollback).is_err(),
        "first Freeze cannot roll back to an unproduced60 clock"
    );
    for _ in 0..7 {
        sim.step();
    }
    let mut forged_refund = serde_json::to_value(&sim).unwrap();
    assert!(sim.w.players[0].statuses.cast.is_none());
    forged_refund["world"]["players"][0]["stocks"]["wish_ready_at"] = json!(50.);
    forged_refund["world"]["players"][0]["stocks"]["wish_full_at"] = json!(50.);
    assert!(
        Sim::restore(forged_refund).is_err(),
        "completed Freeze cannot refund without the teleport producer"
    );
}
#[test]
pub(super) fn overlapping_real_blaze_charges_restore_player_and_born_npc() {
    let corpus: V = serde_json::from_str(include_str!(
        "../../../../../parity/ability-overlap/source.json"
    ))
    .unwrap();
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 2);
    for case in corpus["cases"].as_array().unwrap() {
        let mut sim = run_case(case);
        assert_eq!(sim.server_time(), 2650.);
        let ix = if case["input"]["profile"] == "roster" {
            crate::fighter::FighterIx::of_slot(sim.w.players.len() + 1)
        } else {
            crate::fighter::FighterIx::of_slot(1)
        };
        let p = sim.w.core(ix);
        assert!(p.vitals.hp > 0.);
        let st = p
            .statuses
            .instances
            .iter()
            .find(|st| st.ability == Some(AbilityId::Blaze))
            .unwrap();
        assert_eq!((st.started_at, st.until), (100., 4650.));
        assert!(st.until - st.started_at > 4500.);
        let actor = if sim.w.is_player(ix) {
            "players/1"
        } else {
            "mobs/1"
        };
        let base = serde_json::to_value(&sim).unwrap();
        Sim::restore(base.clone()).unwrap();
        let prefix = format!("/world/{actor}/core/statuses/instances/0");
        for (key, value) in [
            ("until", json!(4651.)),
            ("started_at", json!(2651.)),
            ("value", json!(31.)),
            ("source/name", json!("forged")),
            ("data/shares/true_", json!(0.9)),
        ] {
            let mut bad = base.clone();
            *bad.pointer_mut(&format!("{prefix}/{key}")).unwrap() = value;
            assert!(
                Sim::restore(bad).is_err(),
                "overlapping burn malformed {key}"
            );
        }
        // Ordinary future expiry/death continues through restoration without any status seeding.
        for _ in 0..45 {
            sim.step();
            let cp = serde_json::to_value(&sim).unwrap();
            sim = Sim::restore(cp).unwrap();
        }
    }
}
#[test]
fn captured_blaze_path_history_and_weapon_fields_are_assertions() {
    let corpus = corpus();
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "blaze-zero-time-order-swap-second-cast")
        .unwrap();
    let mut sim = construct(&case["input"]);
    for input in case["input"]["actions"][0]["inputs"].as_array().unwrap() {
        enqueue(&mut sim, input);
    }
    sim.step();
    let frame = &case["timeline"][0];
    let private = &frame["private"]["players"][0];
    let public = &frame["public"]["players"][0]["state"];
    super::motion::compare_motion(
        &sim.w.players[0],
        private,
        public,
        "frozen displacement witness",
    );
    assert_eq!(private["path"], json!([{"x":1000,"y":320}]));
    assert_eq!(
        private["history"],
        json!([{"t":100,"x":600,"y":320},{"t":100,"x":608.5,"y":320}])
    );
    for path in [
        "/path/0/x",
        "/history/1/x",
        "/weapon/aimAt",
        "/weapon/rootUntil",
    ] {
        let mut bad = private.clone();
        let value = bad.pointer_mut(path).unwrap();
        *value = json!(value.as_f64().unwrap() + 1.);
        assert!(
            std::panic::catch_unwind(|| super::motion::compare_motion(
                &sim.w.players[0],
                &bad,
                public,
                path
            ))
            .is_err(),
            "uncompared source field {path}"
        );
    }
}
#[test]
fn real_freeze_keeps_stunned_aim_clock_for_press_cursor_and_release() {
    let corpus = corpus();
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "atomic-reciprocal-freezes-12")
        .unwrap();
    let mut sim = construct(&case["input"]);
    for input in case["input"]["actions"][0]["inputs"].as_array().unwrap() {
        enqueue(&mut sim, input);
    }
    for _ in 0..6 {
        sim.step();
    }
    let actor = sim.w.players[0].id;
    for raw in [
        RawCommand::Attack { a: 1., t: None },
        RawCommand::Aim { a: 2. },
        RawCommand::Release {
            a: 3.,
            t: Some(sim.server_time()),
        },
    ] {
        let p = sim.w.player(actor).unwrap();
        assert!(crate::status_runtime::has(
            &p.statuses.instances,
            crate::status_runtime::StatusKind::Stun,
            sim.server_time()
        ));
        let before = (p.body.facing, p.weapon.aim, p.weapon.aim_at);
        sim.submit(actor, crate::validate(raw).unwrap()).unwrap();
        sim.step();
        let p = sim.w.player(actor).unwrap();
        assert_eq!((p.body.facing, p.weapon.aim, p.weapon.aim_at), before);
        let cp = serde_json::to_value(&sim).unwrap();
        sim = Sim::restore(cp).unwrap();
    }
    assert!(!sim.w.player(actor).unwrap().weapon.held);
}

#[test]
pub(super) fn real_refunded_wish_survives_a_later_source_teleport() {
    let corpus: V = serde_json::from_str(include_str!(
        "../../../../../parity/ability-refund/source.json"
    ))
    .unwrap();
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 1);
    let sim = run_case(&corpus["cases"][0]);
    assert_eq!(sim.server_time(), 650.);
    let p = &sim.w.players[0];
    assert_eq!(p.stocks.wish_ready_at, 50.);
    assert_eq!(p.stocks.wish_full_at, Some(50.));
    assert!(p.statuses.cast.is_none());
    assert_eq!(p.card_runtime.unwrap().wish_cast.unwrap().at, 100.);
    assert!(sim.w.abilities.as_ref().unwrap().teleported_at.unwrap() > 350.);
    let state = serde_json::to_value(&sim).unwrap();
    Sim::restore(state.clone()).unwrap();
    let mut forged = state.clone();
    forged["world"]["players"][0]["stocks"]["wish_ready_at"] = json!(60.);
    forged["world"]["players"][0]["stocks"]["wish_full_at"] = json!(60.);
    assert!(Sim::restore(forged).is_err());
    let mut forged = state;
    forged["world"]["abilities"]["teleported_at"] = json!(50.);
    assert!(Sim::restore(forged).is_err());
}
