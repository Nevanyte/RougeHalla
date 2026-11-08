//! Actual base-player faction reset/continuation source consumers. No snapshot seeds.
use super::*;
#[test]
pub(super) fn all_five_player_lifecycle_source_witnesses() {
    let corpus: V = serde_json::from_str(include_str!(
        "../../../../../parity/player-faction-reset/source.json"
    ))
    .unwrap();
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 5);
    for case in corpus["cases"].as_array().unwrap() {
        println!("case {}", case["name"]);
        run_case(case);
    }
}

fn clock(t: Option<f64>) -> V {
    t.map_or_else(|| json!({"$float":"-Infinity"}), |t| json!(t))
}
pub(super) fn compare_factions(s: &Sim, frame: &V, name: &str) {
    let rt = &frame["private"]["factions"];
    let fighters = rt["fighters"].as_array().unwrap();
    for p in s.w.players.iter() {
        let key = label(p.id);
        let source = fighters.iter().find(|row| row[0] == key).map(|row| &row[1]);
        let f = &p.signature;
        if let Some(e) = source {
            let actual = json!({
                "target":f.target.map(label),"inReach":f.in_reach,"engaged":f.engaged,
                "reachAt":clock(f.reach_at),"contactAt":clock(f.contact_at),"combatAt":clock(f.combat_at),"hpFrac":f.hp_frac,
                "tier":f.mark.tier,"markHits":f.mark.hits,"markProgress":f.mark.progress,"markSwaps":f.mark.swaps,"markDenied":f.mark.denied,"farSince":clock(f.mark.far_since),"ampUntil":f.mark.amp_until,
                "chill":f.chill,"chillers":f.chillers.iter().map(|id|label(*id)).collect::<Vec<_>>(),
                "chillExposureStartedAt":clock(f.exposure_started_at),"chillLastNearAt":clock(f.last_near_at),"rangedChillUntil":clock(f.ranged_chill_until),"frostMoveMult":f.frost_move_mult,"dotPausedUntil":f.dot_paused_until
            });
            let expected: serde_json::Map<_, _> = actual
                .as_object()
                .unwrap()
                .keys()
                .map(|k| (k.clone(), e[k].clone()))
                .collect();
            compare_value(
                &actual,
                &V::Object(expected),
                &format!("{name}/tick{}/{key}/signature", s.tick()),
            );
            let hits = serde_json::to_value(&f.ap_hits).unwrap();
            compare_value(
                &json!({"apHitsOn":f.ap_hits.target.map(label),"apHits":hits["hits"]}),
                &json!({"apHitsOn":e.get("apHitsOn").unwrap_or(&V::Null),"apHits":e.get("apHits").unwrap_or(&json!([]))}),
                &format!("{name}/tick{}/{key}/AP window", s.tick()),
            );
            assert_eq!(
                e["markGroup"],
                if f.mark.tier > 0 {
                    json!(format!("fighter:{}", label(f.target.unwrap())))
                } else {
                    V::Null
                },
                "only source singleton player Mark groups are admitted"
            );
            assert_eq!(e["markGroupSize"], 1);
        } else {
            assert_eq!(
                *f,
                crate::fighter::Signature::default(),
                "absent source signature {key}"
            );
        }
        let public = &frame["public"]["players"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == key)
            .unwrap()["state"];
        let tier = crate::systems::sentenced::public_mark_tier(&s.w, p.id);
        let owner = crate::systems::sentenced::public_mark_by(&s.w, p.id, tier, |_| true)
            .map(label)
            .unwrap_or_default();
        let actual = json!({"markTier":tier,"brand":tier*25,"markBy":owner,"markTax":0,"sentence":p.credit.sentence,"frostMoveMult":(f.frost_move_mult*1000.).round(),"sig":f.bits,"asMult":p.modifiers.attack_rate_wire(),"armorBonus":crate::stat_fold::encode_flat(p.modifiers.mirrors().armor_bonus)});
        let expected: serde_json::Map<_, _> = actual
            .as_object()
            .unwrap()
            .keys()
            .map(|k| (k.clone(), public[k].clone()))
            .collect();
        compare_value(
            &actual,
            &V::Object(expected),
            &format!("{name}/tick{}/{key}/public signature", s.tick()),
        );
    }
    let actual: Vec<_> = s.w.factions.dot.iter().map(|d| json!([format!("{}|{}|{}",label(d.victim),label(d.by),d.sig.as_str()),{"victim":label(d.victim),"by":label(d.by),"sig":d.sig.as_str(),"weapon":d.weapon.map(|w|w.as_str()),"amount":d.amount}])).collect();
    compare_value(
        &json!(actual),
        &rt["dot"],
        &format!("{name}/tick{}/dot window", s.tick()),
    );
    compare_value(
        &json!(s.w.factions.dot_since),
        &rt["dotSince"],
        &format!("{name}/tick{}/dot clock", s.tick()),
    );
}

fn at_teleport(case: &V) -> Sim {
    let mut s = construct(&case["input"]);
    for i in case["input"]["actions"][0]["inputs"].as_array().unwrap() {
        enqueue(&mut s, i);
    }
    for _ in 0..201 {
        let capacities: Vec<_> =
            s.w.players
                .iter()
                .map(|p| p.signature.ap_hits.storage_capacity())
                .collect();
        s.step();
        if s.w.rt.gates_locked {
            assert!(
                capacities.iter().any(|n| *n > 0),
                "real landed hits warmed an AP history before teleport"
            );
            for (p, before) in s.w.players.iter().zip(capacities) {
                assert_eq!(
                    p.signature.ap_hits.len(),
                    0,
                    "real teleport clears AP history"
                );
                assert_eq!(
                    p.signature.ap_hits.storage_capacity(),
                    before,
                    "real teleport retains warmed AP storage"
                );
            }
            return s;
        }
    }
    panic!("declared source timer did not teleport");
}
#[test]
fn player_reset_boundaries_restore_continue_hash_and_keep_private_state() {
    let corpus: V = serde_json::from_str(include_str!(
        "../../../../../parity/player-faction-reset/source.json"
    ))
    .unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let mut s = at_teleport(case);
        let state = serde_json::to_value(&s).unwrap();
        let mut restored = Sim::restore(state.clone()).unwrap();
        assert_eq!(s.state_hash(), restored.state_hash());
        for _ in 0..65 {
            assert_eq!(s.step(), restored.step());
            assert_eq!(s.state_hash(), restored.state_hash());
        }
        // The recovered work used a base-player-only reset validator. Its synthetic stale-reset
        // rejections do not describe the current broader Source admission; retain the real
        // reset/continuation comparison and ordinary canonical restore checks here.
        let world = state["world"].clone();
        let before = crate::hash::hash_of(0, &s.w);
        let mut changed = s.w.clone();
        changed.players[0].signature.combat_at = None;
        assert_ne!(
            before,
            crate::hash::hash_of(0, &changed),
            "retained lockout is hashed"
        );
        let _: crate::state::World = serde_json::from_value(world).unwrap();
        let observer = crate::observe(&restored, PlayerId(1), &[]);
        let own = observer.me.unwrap();
        assert_eq!(own.mark_tier, 0);
        assert_eq!(own.brand, 0);
        assert_eq!(own.mark_by, None);
        let public = serde_json::to_value(crate::observe(&restored, PlayerId(1), &[])).unwrap();
        let bytes = public.to_string();
        for key in [
            "combat_at",
            "ap_hits",
            "chillers",
            "dot_since",
            "markProgress",
        ] {
            assert!(!bytes.contains(key), "private faction field leaked: {key}");
        }
    }
}

// Delayed chunks remain server-only; compare their actual source flush envelopes, including run end.
pub(super) fn compare_signature_events(s: &Sim, events: &[Event], case: &V) {
    let actual: Vec<_>=events.iter().filter_map(|e| match *e {
        Event::SignatureHit{victim,by,sig,weapon,amount}=>Some(json!({"kind":"hit","id":label(victim),"by":label(by),"sig":sig.as_str(),"weapon":weapon.map(|w|w.as_str()),"amount":amount})),_=>None
    }).collect();
    let expected: Vec<_> = case["completeNonemptyEventTape"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["tick"] == s.tick() && t["betweenSteps"] != true)
        .flat_map(|t| t["events"].as_array().unwrap())
        .filter(|e| e["fx"]["kind"] == "hit" && e["fx"].get("sig").is_some())
        .map(|e| e["fx"].clone())
        .collect();
    compare_value(
        &json!(actual),
        &json!(expected),
        &format!("{}/tick{}/signature flush", case["name"], s.tick()),
    );
}

#[test]
pub(super) fn genuine_axe_shred_reset_and_continuation() {
    let corpus: V = serde_json::from_str(include_str!(
        "../../../../../parity/player-axe-reset/source.json"
    ))
    .unwrap();
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 1);
    let case = &corpus["cases"][0];
    run_case(case);
    let sim = at_teleport(case);
    let value = serde_json::to_value(&sim).unwrap();
    assert!(
        value["world"]["players"][1]["core"]["modifiers"]["wire"][3]
            .as_f64()
            .unwrap()
            < 0.
    );
    assert!(sim.w.players[1].statuses.instances.is_empty());
    Sim::restore(value.clone()).unwrap();
    for (path, bad) in [
        ("/world/players/1/core/modifiers/wire/3", json!(-10001.)),
        ("/world/players/1/core/modifiers/wire/3", json!(-60.5)),
        ("/world/players/1/core/modifiers/sums/0", json!(1.)),
    ] {
        let mut bad_state = value.clone();
        *bad_state.pointer_mut(path).unwrap() = bad;
        assert!(
            Sim::restore(bad_state).is_err(),
            "invalid modifier owner {path}"
        );
    }
}
