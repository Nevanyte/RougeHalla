//! Frozen source consumption: only declared constructor/setup/actions produce native state.
//! Full snapshots are assertion inputs exclusively; coupled profiles remain explicitly inventoried.
use super::*;
use crate::{Arena, Event, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2};
use serde_json::{json, Value as V};
mod arena_refund;
mod compare;
mod hash_tape;
mod motion;
mod repair_tests;
mod runner;
mod setup;
use compare::*;
use runner::*;
use setup::*;

pub(super) fn assert_genuine_arena_refund() {
    arena_refund::arena_genuine_freeze_laststand_and_teleport_refund();
}

#[test]
fn frozen_core_source_casts() {
    let c = corpus();
    let mut n = 0;
    let mut failures = Vec::new();
    for case in c["cases"].as_array().unwrap() {
        let i = &case["input"];
        if !matches!(i["profile"].as_str(), Some("core" | "roster"))
            || !matches!(i["map"].as_str(), Some("room" | "born" | "seed1"))
        {
            continue;
        }
        println!("case {}", case["name"]);
        if std::panic::catch_unwind(|| run_case(case)).is_err() {
            failures.push(case["name"].as_str().unwrap());
        }
        n += 1;
    }
    assert_eq!(n, 53);
    assert!(failures.is_empty(), "source failures: {failures:?}");
}
/// Always executes every admitted source case and pins the exact outstanding inventory.
/// RH_ABIL_REQUIRE_FULL additionally makes the explicitly unattempted prerequisites fatal.
/// P-ABIL-1 admitted the two cards cases and the two signatures cases (real grantCard / own-Mark producers); the
/// remaining six are the training world and the full five-faction source-born NPC signatures, both owned elsewhere.
#[test]
fn frozen_full_source_all_63_cases() {
    let corpus = corpus();
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 63);
    let expected_pending = [
        (
            "training-swarm-real-five-second-recast-replacement",
            "training",
            "actual training lifecycle and dummy constructor",
        ),
        (
            "full-signature-source-born-holy-wish-recipients",
            "rosterSignatures",
            "full five-faction source-born NPC signatures",
        ),
        (
            "full-signature-source-born-fire-wish-recipients",
            "rosterSignatures",
            "full five-faction source-born NPC signatures",
        ),
        (
            "full-signature-source-born-plague-wish-recipients",
            "rosterSignatures",
            "full five-faction source-born NPC signatures",
        ),
        (
            "full-signature-source-born-frost-wish-recipients",
            "rosterSignatures",
            "full five-faction source-born NPC signatures",
        ),
        (
            "full-signature-source-born-sentenced-wish-recipients",
            "rosterSignatures",
            "full five-faction source-born NPC signatures",
        ),
    ];
    let mut pending = vec![];
    let mut failures = vec![];
    for case in cases {
        let name = case["name"].as_str().unwrap();
        if let Some(&(expected, profile, reason)) = expected_pending
            .iter()
            .find(|(expected, _, _)| *expected == name)
        {
            assert_eq!(
                case["input"]["profile"], profile,
                "pending profile changed: {name}"
            );
            pending.push((expected, profile, reason));
        } else if std::panic::catch_unwind(|| run_case(case)).is_err() {
            failures.push(format!("{name}: runtime/source divergence"));
        }
    }
    assert_eq!(
        pending, expected_pending,
        "exact outstanding source names/profiles/reasons changed"
    );
    assert!(
        failures.is_empty(),
        "admitted source failures:\n{}",
        failures.join("\n")
    );
    // The bounded gate also executes its accepted source companions; they are not
    // inferred from the 63-case count or from separate test-runner selection.
    genuine_voided_casts_keep_clocks_and_restore_after_due_time();
    arena_refund::arena_genuine_freeze_laststand_and_teleport_refund();
    repair_tests::overlapping_real_blaze_charges_restore_player_and_born_npc();
    repair_tests::real_refunded_wish_survives_a_later_source_teleport();
    let diagnostic = format!(
        "P-ABIL-1 FULL INCOMPLETE: {} named prerequisite cases were not attempted:\n{}",
        pending.len(),
        pending
            .iter()
            .map(|(name, _, why)| format!("{name}: {why}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
    println!("{diagnostic}");
    if std::env::var_os("RH_ABIL_REQUIRE_FULL").is_some() {
        assert!(pending.is_empty(), "{diagnostic}");
    }
}
#[test]
fn frozen_stock_and_cooldown_helpers() {
    let c = corpus();
    for row in c["helpers"]["stock"].as_array().unwrap() {
        let i = &row["input"];
        let full = num(&i["fullAt"]);
        let now = num(&i["now"]);
        let max = i["max"].as_u64().unwrap() as u8;
        let recharge = num(&i["rechargeMs"]);
        assert_eq!(
            charges_at(full, now, max, recharge),
            row["charges"].as_u64().unwrap() as u8
        );
        assert_eq!(next_charge_at(full, now, recharge), num(&row["next"]));
        let (full, ready) = spend_charge(full, now, max, recharge);
        assert_eq!(full, num(&row["spend"]["fullAt"]));
        assert_eq!(ready, num(&row["spend"]["readyAt"]));
    }
    for row in c["helpers"]["cooldown"].as_array().unwrap() {
        let i = &row["input"];
        let ctx = &i["context"];
        assert_eq!(
            cooldown(
                serde_json::from_value(i["ability"].clone()).unwrap(),
                ctx["training"].as_bool().unwrap_or(false),
                ctx["wishCooldownMult"].as_f64()
            ),
            num(&row["output"])
        );
    }
}
#[test]
fn frozen_blink_helpers() {
    let c = corpus();
    let export: crate::mapdata::MapExport = serde_json::from_str(include_str!(
        "../../../../../tools/ability-fixtures/seed1-input.json"
    ))
    .unwrap();
    let (w, h, tiles, layers) = export.validate().unwrap().into_parts();
    let seed = crate::TileMap::new(w, h, tiles)
        .unwrap()
        .with_layers(layers)
        .unwrap();
    for row in c["helpers"]["blink"].as_array().unwrap() {
        let i = &row["input"];
        let map = if i["map"] == "seed1" {
            seed.clone()
        } else {
            room(i)
        };
        let locked = i["locked"].as_bool().unwrap();
        let closed = map.closed_gates();
        let cmap = if locked {
            closed.as_ref().unwrap_or(&map)
        } else {
            &map
        };
        let ring = blink::Ring::new(&map);
        let actual = blink::landing(
            &map,
            cmap,
            &ring,
            locked,
            pt(&i["origin"]),
            pt(&i["target"]),
        );
        compare_value(&json!(actual), &row["output"], "blink");
    }
}

#[test]
fn real_pending_cast_restore_rejects_incoherent_producers() {
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
    let queued = serde_json::to_value(&sim).unwrap();
    let mut queued_restore = Sim::restore(queued.clone()).unwrap();
    assert_eq!(sim.step(), queued_restore.step());
    assert_eq!(sim.state_hash(), queued_restore.state_hash());
    let json = serde_json::to_value(&sim).unwrap();
    let mut restored = Sim::restore(json.clone()).unwrap();
    for _ in 0..10 {
        assert_eq!(sim.step(), restored.step());
        assert_eq!(sim.state_hash(), restored.state_hash());
    }
    let root = "/world/players/0/core/statuses/cast";
    for (suffix, bad) in [
        ("/producer/rank", json!(2)),
        ("/producer/slot", json!("q")),
        ("/producer/target", json!(0)),
        ("/producer/target", json!(999999)),
        ("/producer/lag_ms", json!(49.)),
        ("/producer/point/x", json!(-1.)),
        ("/producer/previous_ready_at", json!(101.)),
        ("/producer/previous_full_at", json!(-1.)),
        ("/producer/previous_full_at", V::Null),
        ("/producer/previous_full_at", json!(51.)),
        ("/cancelled_by/root", json!(true)),
        ("/lands_at", json!(351.)),
        ("/producer", V::Null),
    ] {
        let mut bad_state = json.clone();
        *bad_state.pointer_mut(&format!("{root}{suffix}")).unwrap() = bad;
        assert!(
            Sim::restore(bad_state).is_err(),
            "admitted malformed {suffix}"
        );
    }
    for (path, bad) in [
        ("/world/players/0/stocks/wish_ready_at", json!(1.)),
        ("/world/players/0/card_runtime/wish_cast/at", json!(99.)),
        ("/world/players/0/card_runtime", V::Null),
        ("/world/players/0/card_runtime/wish_cast", V::Null),
        ("/statics/config/abilities", json!("Off")),
    ] {
        let mut b = json.clone();
        *b.pointer_mut(path).unwrap() = bad;
        assert!(Sim::restore(b).is_err(), "admitted {path}");
    }
}
#[test]
fn genuine_cast_state_hash_covers_each_new_leaf() {
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
    sim.step();
    // Hash leaves are checked structurally, separately from the semantic restore gate above.
    let value = serde_json::to_value(&sim.w).unwrap();
    let before = crate::hash::hash_of(0, &sim.w);
    for path in [
        "/players/0/stocks/wish_ready_at",
        "/players/0/stocks/q_ready_at",
        "/players/0/stocks/e_ready_at",
        "/players/0/stocks/wish_full_at",
        "/players/0/card_runtime/wish_cast/at",
        "/players/0/card_runtime/wish_cast/cooldown_ms",
        "/players/0/core/statuses/cast/producer/rank",
        "/players/0/core/statuses/cast/producer/target",
        "/players/0/core/statuses/cast/producer/point/x",
        "/players/0/core/statuses/cast/producer/point/y",
        "/players/0/core/statuses/cast/producer/previous_ready_at",
        "/players/0/core/statuses/cast/producer/previous_full_at",
        "/players/0/core/statuses/cast/producer/lag_ms",
    ] {
        let mut changed = value.clone();
        let leaf = changed.pointer_mut(path).unwrap();
        *leaf = if let Some(v) = leaf.as_u64() {
            json!(v + 1)
        } else {
            json!(leaf.as_f64().unwrap() + 1.)
        };
        let w: crate::state::World = serde_json::from_value(changed).unwrap();
        assert_ne!(crate::hash::hash_of(0, &w), before, "unhashed {path}");
    }
    for (path, v) in [
        ("/players/0/core/statuses/cast/producer/slot", json!("q")),
        ("/players/0/core/statuses/cast/producer", V::Null),
        ("/players/0/stocks/wish_full_at", V::Null),
        ("/players/0/card_runtime", V::Null),
    ] {
        let mut changed = value.clone();
        *changed.pointer_mut(path).unwrap() = v;
        let w: crate::state::World = serde_json::from_value(changed).unwrap();
        assert_ne!(crate::hash::hash_of(0, &w), before, "unhashed {path}");
    }
}

#[test]
fn atomic_real_source_due_order_and_hook_snapshots() {
    let corpus = corpus();
    for name in [
        "atomic-reciprocal-freezes-12",
        "atomic-reciprocal-freezes-77",
        "atomic-landing-rank-reverses-join-and-intake",
        "atomic-freeze-and-swarm-same-due",
        "atomic-due-batch-fizzle-with-surviving-swarm",
        "trial-centre-after-same-batch-self-blink",
        "blaze-zero-time-order-swap-second-cast",
    ] {
        run_case(
            corpus["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["name"] == name)
                .unwrap(),
        );
    }
}
#[test]
fn hidden_and_absent_public_cast_targets_are_indistinguishable() {
    let corpus = corpus();
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "atomic-freeze-and-swarm-same-due")
        .unwrap();
    let mut sim = construct(&case["input"]);
    // A genuine Swarm, followed by ordinary landing, makes the player untargetable.
    let plague = sim
        .w
        .players
        .iter()
        .find(|p| p.vitals.faction == crate::FactionId::Plague)
        .unwrap()
        .id;
    let frost = sim
        .w
        .players
        .iter()
        .find(|p| p.vitals.faction == crate::FactionId::Frost)
        .unwrap()
        .id;
    let cast = crate::validate(RawCommand::Cast {
        slot: Slot::Wish,
        x: 0.,
        y: 0.,
        id: None,
        t: None,
        seq: None,
    })
    .unwrap();
    sim.submit(plague, cast).unwrap();
    for _ in 0..6 {
        sim.step();
    }
    let mut observer = crate::ItemObserver::new(frost);
    let mut observation = crate::Observation::default();
    observer
        .observe_into(&sim, &[], &mut observation, None)
        .unwrap();
    assert!(!observation.visible.iter().any(|p| p.id == plague));
    let proposal = |id| crate::PublicCommand::Cast {
        slot: Slot::Wish,
        x: 450.,
        y: 320.,
        id: Some(id),
        t: None,
        seq: Some(17),
    };
    let hidden = observer.resolve(&sim, proposal(plague)).unwrap();
    let absent = observer.resolve(&sim, proposal(PlayerId(999999))).unwrap();
    assert_eq!(
        serde_json::to_value(hidden).unwrap(),
        serde_json::to_value(absent).unwrap()
    );
    let before = sim.w.player(frost).unwrap().stocks;
    sim.submit(frost, hidden).unwrap();
    let events = sim.step();
    assert!(!events
        .iter()
        .any(|e| matches!(e, Event::CastStarted { .. } | Event::CastLanded { .. })));
    let owner = sim.w.player(frost).unwrap();
    assert_eq!(owner.motion.move_seq, 17);
    assert_eq!(owner.stocks, before);
    let view = serde_json::to_value(crate::observe(&sim, frost, &events)).unwrap();
    let own = &view["me"]["wish"];
    assert_eq!(own["ability"], "freeze");
    assert!(own.get("producer").is_none());
    assert!(own.get("target").is_none());
    assert!(own.get("previous_full_at").is_none());
}

#[test]
fn genuine_fields_and_blaze_history_have_strict_restore_shapes() {
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
    let state = serde_json::to_value(&sim).unwrap();
    Sim::restore(state.clone()).unwrap();
    let field = state["world"]["abilities"]["fields"]
        .as_array()
        .unwrap()
        .iter()
        .position(|f| f["ability"] == "blaze")
        .unwrap();
    for (leaf, value) in [
        ("r", json!(21.)),
        ("ability", json!("freeze")),
        ("ends_at", json!(2601.)),
        ("vx", json!(1.)),
        ("subject", json!(2)),
        ("owner/name", json!("invented owner")),
    ] {
        let mut b = state.clone();
        *b.pointer_mut(&format!("/world/abilities/fields/{field}/{leaf}"))
            .unwrap() = value;
        assert!(Sim::restore(b).is_err(), "bad genuine field {leaf}");
    }
    let fire = sim
        .w
        .players
        .iter()
        .position(|p| p.vitals.faction == crate::FactionId::Fire)
        .unwrap();
    for (leaf, value) in [
        (
            format!("/world/players/{fire}/core/body/history/1/t"),
            json!(101.),
        ),
        (
            format!("/world/players/{fire}/card_runtime/wish_cast/at"),
            json!(99.),
        ),
    ] {
        let mut b = state.clone();
        *b.pointer_mut(&leaf).unwrap() = value;
        assert!(
            Sim::restore(b).is_err(),
            "unproduced duplicate history {leaf}"
        );
    }
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "blaze-source-born-npc-return-and-credit")
        .unwrap();
    let sim = run_case(case);
    let state = serde_json::to_value(sim).unwrap();
    let mob = state["world"]["mobs"]
        .as_array()
        .unwrap()
        .iter()
        .position(|m| {
            m["core"]["statuses"]["instances"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["kind"] == "dot")
        })
        .unwrap();
    let index = state["world"]["mobs"][mob]["core"]["statuses"]["instances"]
        .as_array()
        .unwrap()
        .iter()
        .position(|s| s["kind"] == "dot")
        .unwrap();
    for (leaf, value) in [
        ("value", json!(31.)),
        ("ability", json!("freeze")),
        ("source/name", json!("unproduced")),
    ] {
        let mut b = state.clone();
        *b.pointer_mut(&format!(
            "/world/mobs/{mob}/core/statuses/instances/{index}/{leaf}"
        ))
        .unwrap() = value;
        assert!(Sim::restore(b).is_err(), "unproduced NPC burn {leaf}");
    }
}

#[test]
fn genuine_voided_casts_keep_clocks_and_restore_after_due_time() {
    let corpus: V = serde_json::from_str(include_str!(
        "../../../../../parity/ability-void/source.json"
    ))
    .unwrap();
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 2);
    for case in corpus["cases"].as_array().unwrap() {
        let s = run_case(case);
        let c = s.w.players[0].statuses.cast.unwrap();
        assert_eq!(s.server_time(), 600.);
        assert_eq!((c.started_at, c.lands_at), (100., 350.));
        assert!(s.w.rt.voided);
        let mut bad = serde_json::to_value(s).unwrap();
        bad["world"]["rt"]["voided"] = json!(false);
        assert!(
            Sim::restore(bad).is_err(),
            "overdue producer requires genuine voided lifecycle"
        );
    }
}

/// The P-ABIL-1 coupled cases now admitted (previously named pending): the card producers and the signatures
/// own-Mark producers are real game paths, never a seeded poststate. Each reproduces every compared frame and every
/// ordinary checkpoint restore of the frozen source corpus.
#[test]
fn admitted_coupled_source_cases_reproduce_their_real_producers() {
    let corpus = corpus();
    let find = |name: &str| -> &V {
        corpus["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .unwrap()
    };
    // grantCard: the declared cards are really granted before the first compared frame.
    let gallows = find("trial-gallows-card-exit");
    let s = construct(&gallows["input"]);
    assert!(s.w.players[0]
        .build
        .owns(crate::cards::CardId::GallowsPatience));
    run_case(gallows);
    let arcane = find("arcane-overload-wishful-stock-trim");
    let s = construct(&arcane["input"]);
    assert!(s.w.players[0]
        .build
        .owns(crate::cards::CardId::ArcaneOverload));
    assert!(s.w.players[0]
        .build
        .owns(crate::cards::CardId::WishfulThinking));
    run_case(arcane);
    // Ordinary sword hits earned the tier-3 mark (bounded by the source frame tape), then Trial read it.
    let own = find("trial-own-convicted-mark-from-real-weapon-hits");
    let s = run_case(own);
    assert!(s.w.players[0].signature.mark.tier >= 3);
    let zone =
        s.w.abilities
            .as_ref()
            .unwrap()
            .fields
            .iter()
            .find(|f| f.kind == crate::status_runtime::FieldKind::Zone)
            .expect("the caster's own convicted mark tightens the Trial ring");
    assert_eq!(zone.r, crate::abilities::TRIAL_CONVICTED_RADIUS);
    let other = find("trial-other-owner-convicted-is-not-own-mark");
    let s = run_case(other);
    assert!(s.w.players[2].signature.mark.tier >= 3);
    assert_eq!(s.w.players[0].signature.mark.tier, 0);
    let zone =
        s.w.abilities
            .as_ref()
            .unwrap()
            .fields
            .iter()
            .find(|f| f.kind == crate::status_runtime::FieldKind::Zone)
            .expect("another owner's mark does not tighten this Trial");
    assert_eq!(zone.r, crate::abilities::TRIAL_RADIUS);
}

/// The new card producer states are restore-valid, and the trusted validators bind the producer to the card that
/// can emit it: a Gallows Trial tuple without the card or a trim trace outside the source budget is rejected.
#[test]
fn card_producer_checkpoint_states_restore_and_reject_malformed_producers() {
    let corpus = corpus();
    let find = |name: &str| -> &V {
        corpus["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .unwrap()
    };
    let gallows = find("trial-gallows-card-exit");
    // Stop after the landing: the shorter Trial window is gone from the final state (the subject exited it).
    let mut s = construct(&gallows["input"]);
    #[cfg(feature = "trusted-status-probes")]
    {
        s.w.trace.1.enabled = true;
    }
    for input in gallows["input"]["actions"][0]["inputs"].as_array().unwrap() {
        enqueue(&mut s, input);
    }
    for _ in 0..8 {
        source_step(&mut s, gallows);
    }
    let good = serde_json::to_value(&s).unwrap();
    assert!(Sim::restore(good.clone()).is_ok());
    let mut bad = good.clone();
    let counts = bad
        .pointer("/world/players/0/build/counts")
        .unwrap()
        .as_array()
        .unwrap()
        .len();
    *bad.pointer_mut("/world/players/0/build/counts").unwrap() = json!(vec![0u8; counts]);
    assert!(
        Sim::restore(bad).is_err(),
        "a Gallows ring without the card"
    );
    let mut bad = good.clone();
    let ends = bad
        .pointer("/world/abilities/fields/0/ends_at")
        .unwrap()
        .as_f64()
        .unwrap();
    *bad.pointer_mut("/world/abilities/fields/0/ends_at")
        .unwrap() = json!(ends + 1.);
    assert!(Sim::restore(bad).is_err(), "a tampered Trial ring lifetime");
    let arcane = find("arcane-overload-wishful-stock-trim");
    let s = run_case(arcane);
    let good = serde_json::to_value(&s).unwrap();
    assert!(Sim::restore(good.clone()).is_ok());
    let trims = good
        .pointer("/world/players/0/card_trims")
        .unwrap()
        .as_array()
        .unwrap()
        .len();
    assert!(trims > 0, "the Wishful Thinking producer trimmed the clock");
    let mut bad = good.clone();
    *bad.pointer_mut("/world/players/0/card_trims/0/ms").unwrap() =
        json!(crate::constants::WISHFUL_BUDGET_MS + 1.);
    assert!(Sim::restore(bad).is_err(), "an out-of-budget trim");
}
