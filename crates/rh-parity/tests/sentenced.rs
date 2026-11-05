//! Actual-source Mark scenarios, strict diagnostics, and every-tick trusted continuation.
use rh_parity::{build, compare, fixtures_dir, load, raw_command_pub};
use rh_sim::{validate, PlayerId, Sim};
const NAMES: [&str; 22] = [
    "sentenced_weapon_fists",
    "sentenced_weapon_sword",
    "sentenced_weapon_axe",
    "sentenced_weapon_shield",
    "sentenced_weapon_bow",
    "sentenced_weapon_wand",
    "sentenced_swaps_pickup",
    "sentenced_leash_forget",
    "sentenced_multisource",
    "sentenced_frost_pause",
    "sentenced_execute_denial",
    "sentenced_kills",
    "sentenced_block_reflection",
    "sentenced_splash_contacts",
    "sentenced_terminal_mia",
    "sentenced_crowded_eight",
    "sentenced_execute_barrier_no_pvp",
    "sentenced_kill_stack_cap",
    "sentenced_old_flights_multihit",
    "sentenced_privacy_one_owner",
    "sentenced_privacy_two_owners",
    "sentenced_privacy_two_reversed",
];
#[test]
fn actual_source_traces_and_every_tick_restore() {
    let mut ticks = 0;
    let mut max_tier = 0;
    let mut denied = 0;
    let mut killed = 0;
    let (
        mut max_raw,
        mut max_mark_rows,
        mut max_instant_keys,
        mut max_output,
        mut max_ledger,
        mut max_performed,
        mut max_owner_hits,
        mut max_sentence,
    ) = (0, 0, 0, 0, 0, 0, 0, 0);
    for name in NAMES {
        let fx = load(&fixtures_dir().join(format!("{name}.json")));
        let report = compare(&fx);
        assert!(
            report.mismatches.is_empty(),
            "{name}: {:?}",
            report.mismatches
        );
        let mut sim = build(&fx);
        let mut projectors = sim
            .players()
            .iter()
            .map(|p| rh_sim::FxProjector::attach(&sim, p.id))
            .collect::<Vec<_>>();
        let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
        for t in &fx.ticks {
            for input in fx.inputs.iter().filter(|i| i.tick == t.tick) {
                let id = PlayerId(input.player[1..].parse::<u32>().unwrap() + 1);
                let cmd = validate(raw_command_pub(input).unwrap()).unwrap();
                sim.submit_unbudgeted(id, cmd).unwrap();
                restored.submit_unbudgeted(id, cmd).unwrap();
            }
            let events = sim.step();
            assert_eq!(events, restored.step(), "{name} {}", t.tick);
            max_raw = max_raw.max(events.len());
            max_mark_rows = max_mark_rows.max(
                events
                    .iter()
                    .filter(|e| {
                        matches!(
                            e,
                            rh_sim::Event::SignatureHit {
                                sig: rh_sim::factions::SignatureKind::Mark,
                                ..
                            }
                        )
                    })
                    .count(),
            );
            max_ledger = max_ledger.max(sim.damage_entries().len());
            max_performed = max_performed.max(sim.performed_attacks().len());
            for p in sim.players() {
                max_owner_hits = max_owner_hits.max(
                    sim.damage_entries()
                        .iter()
                        .filter(|e| {
                            e.by == Some(p.id)
                                && e.sig == Some(rh_sim::factions::SignatureKind::Mark)
                        })
                        .count(),
                );
                max_sentence = max_sentence.max(p.credit.sentence);
            }
            for projector in &mut projectors {
                projector.feed(sim.fx_report()).unwrap();
                max_output = max_output.max(projector.events().len());
                max_instant_keys=max_instant_keys.max(projector.events().iter().filter(|e|matches!(e,rh_sim::SeenEvent::SignatureHit{sig,..} if !sig.is_dot())).count());
            }

            for action in fx.actions.iter().filter(|a| a.tick == t.tick) {
                assert_eq!(action.kind, "remove");
                let id = PlayerId(action.player[1..].parse::<u32>().unwrap() + 1);
                sim.remove_player(id);
                restored.remove_player(id);
            }
            assert_eq!(sim.state_hash(), restored.state_hash(), "{name} {}", t.tick);
            for p in sim.players() {
                max_tier = max_tier.max(p.signature.mark.tier);
                denied += usize::from(p.signature.mark.denied);
                killed += usize::from(p.credit.sentence > 0);
            }
            restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
            ticks += 1;
        }
    }
    assert_eq!(ticks, 5042);
    assert_eq!(max_tier, 4);
    assert!(killed > 0 && denied > 0);
    assert_eq!(max_sentence, 5);
    assert!(max_owner_hits >= 2);
    assert!(max_raw <= 512 && max_instant_keys <= 8 && max_output <= 784 && max_performed <= 16);
    println!(
        "Sentenced actual-source maxima: {}",
        serde_json::json!({"scenarios":NAMES.len(),"ticks":ticks,"rawEvents":max_raw,"rawMarkFxRows":max_mark_rows,"instantKeys":max_instant_keys,"outputEvents":max_output,"ledgerRows":max_ledger,"performedRequests":max_performed,"markHitsPerOwner":max_owner_hits,"sentence":max_sentence})
    );
}
#[test]
fn missing_extra_empty_or_mutated_mark_diagnostics_fail() {
    for field in [
        "tier",
        "hits",
        "progress",
        "swaps",
        "denied",
        "farSince",
        "ampUntil",
        "sentence",
        "legacyMarkBy",
        "markTier",
        "brand",
        "markTax",
    ] {
        let mut fx = load(&fixtures_dir().join("sentenced_weapon_bow.json"));
        fx.ticks[0].sentenced.as_mut().unwrap()["fighters"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(!compare(&fx).mismatches.is_empty(), "{field}");
    }
    for field in ["flags", "notices", "fighters", "denials"] {
        let mut fx = load(&fixtures_dir().join("sentenced_weapon_bow.json"));
        fx.ticks[0]
            .sentenced
            .as_mut()
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(!compare(&fx).mismatches.is_empty(), "{field}");
    }
    for value in [
        None,
        Some(serde_json::json!({})),
        Some(serde_json::json!([])),
    ] {
        let mut fx = load(&fixtures_dir().join("sentenced_weapon_bow.json"));
        fx.ticks[0].sentenced = value;
        assert!(!compare(&fx).mismatches.is_empty());
    }
    let mut fx = load(&fixtures_dir().join("sentenced_weapon_bow.json"));
    fx.ticks[0].sentenced.as_mut().unwrap()["unexpected"] = true.into();
    assert!(!compare(&fx).mismatches.is_empty());
    for wrong in [
        "player-engagement-holy-plague-fire-frost/1",
        "player-engagement-holy-plague-fire/1",
    ] {
        let mut fx = load(&fixtures_dir().join("sentenced_weapon_bow.json"));
        fx.legacy_config.rust_slice = Some(wrong.into());
        assert!(!compare(&fx).mismatches.is_empty());
    }
    let mut fx = load(&fixtures_dir().join("sentenced_weapon_bow.json"));
    fx.legacy_config.modules.as_mut().unwrap().swap(0, 1);
    assert!(!compare(&fx).mismatches.is_empty());
}

#[test]
fn inventory_rejects_empty_inputs_ticks_or_requirements() {
    for which in 0..3 {
        let mut fx = load(&fixtures_dir().join("sentenced_weapon_bow.json"));
        match which {
            0 => fx.ticks.clear(),
            1 => fx.inputs.clear(),
            _ => fx.requires.clear(),
        };
        assert!(!compare(&fx).mismatches.is_empty());
    }
}
#[test]
fn genuine_source_hidden_tie_pair_and_controls_are_nonempty_and_equal() {
    let p: serde_json::Value =
        serde_json::from_str(include_str!("../../../parity/sentenced/public-pairs.json")).unwrap();
    assert_eq!(p["runtime"]["version"], "v22.23.4");
    assert_eq!(p["runtime"]["arch"], "x64");
    assert_eq!(p["runtime"]["platform"], "linux");
    let a = p["a"]["rows"].as_array().unwrap();
    let b = p["b"]["rows"].as_array().unwrap();
    assert_eq!(a.len(), 64);
    assert_eq!(b.len(), 64);
    let mut changed = 0;
    for (x, y) in a.iter().zip(b) {
        for key in ["visible", "publicEvents", "expectedAnonymous"] {
            assert_eq!(x[key], y[key], "{key}");
        }
        changed += usize::from(x["legacyMarker"] != y["legacyMarker"]);
    }
    assert!(changed > 0);
    for mode in ["visibleStronger", "hiddenStronger"] {
        assert_eq!(p[mode]["rows"].as_array().unwrap().len(), 64);
    }
}
#[test]
fn genuine_hidden_source_count_history_and_order_have_identical_delivered_projection() {
    fn run(name: &str) -> Vec<(rh_sim::Observation, f64)> {
        let fx = load(&fixtures_dir().join(format!("{name}.json")));
        assert!(compare(&fx).mismatches.is_empty());
        let mut sim = build(&fx);
        let mut projector = rh_sim::FxProjector::attach(&sim, PlayerId(1));
        let mut observer = rh_sim::ItemObserver::new(PlayerId(1));
        let mut obs = rh_sim::observe(&sim, PlayerId(1), &[]);
        let mut rows = Vec::new();
        for t in &fx.ticks {
            for i in fx.inputs.iter().filter(|i| i.tick == t.tick) {
                sim.submit_unbudgeted(
                    PlayerId(i.player[1..].parse::<u32>().unwrap() + 1),
                    validate(raw_command_pub(i).unwrap()).unwrap(),
                )
                .unwrap();
            }
            sim.step();
            projector.feed(sim.fx_report()).unwrap();
            let offer = observer.prepare_into(&sim, &[], &mut obs, None).unwrap();
            offer.commit();
            obs.events.clear();
            projector
                .append_into(&sim, PlayerId(1), &mut obs.events)
                .unwrap();
            assert_eq!(
                obs.visible.iter().map(|p| p.id).collect::<Vec<_>>(),
                vec![PlayerId(2)]
            );
            assert_eq!(obs.visible[0].mark_by, None);
            for actor in [PlayerId(3), PlayerId(4)] {
                assert_eq!(
                    observer
                        .resolve(&sim, rh_sim::PublicCommand::Target { actor })
                        .unwrap(),
                    validate(rh_sim::RawCommand::MissingTarget).unwrap()
                );
            }
            rows.push((obs.clone(), sim.player(PlayerId(2)).unwrap().vitals.hp));
        }
        rows
    }
    let a = run("sentenced_privacy_one_owner");
    let b = run("sentenced_privacy_two_owners");
    let c = run("sentenced_privacy_two_reversed");
    assert_eq!(a.len(), 41);
    assert_eq!(a, b);
    assert_eq!(a, c);
    let row = &a.iter().find(|(o, _)| o.tick == 36).unwrap().0;
    let marks = row
        .events
        .iter()
        .filter(|e| {
            matches!(
                e,
                rh_sim::SeenEvent::SignatureHit {
                    sig: rh_sim::factions::SignatureKind::Mark,
                    ..
                }
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(marks.len(), 1);
    assert!(
        matches!(marks[0],rh_sim::SeenEvent::SignatureHit{victim:PlayerId(2),by:None,weapon:None,amount,..} if *amount==10.806741573033708+9.144165946413139)
    );
}

#[test]
fn explicit_source_public_bootstrap_is_required_and_mutations_fail() {
    for case in 0..3 {
        let mut fx = load(&fixtures_dir().join("sentenced_privacy_one_owner.json"));
        match case {
            0 => {
                fx.legacy_config.setup.remove("bootstrapSpawns");
            }
            1 => fx.legacy_config.setup["bootstrapSpawns"] = serde_json::json!([]),
            _ => fx.legacy_config.setup["bootstrapSpawns"][0]["x"] = 321.into(),
        };
        assert!(!compare(&fx).mismatches.is_empty());
    }
}
