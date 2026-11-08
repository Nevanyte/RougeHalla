#![cfg(test)]
use super::*;
use serde_json::{json, Value};
fn keys(v: &Value, expected: &[&str]) {
    let mut a = v
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    a.sort();
    let mut b = expected.to_vec();
    b.sort();
    assert_eq!(a, b);
}
fn numbers(v: &mut Value) {
    match v {
        Value::Number(n) => *v = json!(n.as_f64().unwrap()),
        Value::Array(a) => a.iter_mut().for_each(numbers),
        Value::Object(o) => o.values_mut().for_each(numbers),
        _ => {}
    }
}
#[test]
fn trusted_actual_installed_mark_matrix() {
    let mut fixture: Value = serde_json::from_str(include_str!(
        "../../../../../parity/sentenced/runtime-matrix.json"
    ))
    .unwrap();
    keys(&fixture, &["format", "provenance", "cases"]);
    assert_eq!(fixture["format"], "rh-sentenced-runtime-matrix/1");
    let p = &fixture["provenance"];
    keys(
        p,
        &[
            "node",
            "platform",
            "arch",
            "kind",
            "modules",
            "exports",
            "sourceFiles",
        ],
    );
    assert_eq!(
        (&p["node"], &p["platform"], &p["arch"]),
        (&json!("v22.23.4"), &json!("linux"), &json!("x64"))
    );
    assert_eq!(
        p["kind"],
        "trusted private setup and actual installed beforeDamage; not ordinary gameplay intake"
    );
    assert_eq!(
        p["modules"],
        json!([
            "loot",
            "weapons",
            "targeting",
            "projectiles",
            "factions",
            "mobs",
            "buffs",
            "feed",
            "camps",
            "chests",
            "killAugments",
            "mobLife",
            "mobAI",
            "terrainEffects",
            "regen",
            "abilities",
            "quests",
            "vision",
            "campHeal",
            "traders",
            "cardHooks",
            "mods"
        ])
    );
    assert_eq!(
        p["exports"],
        json!([
            "packages/server/src/sim/factions.ts::installFactions",
            "packages/server/src/sim/ledger.ts::recordHit"
        ])
    );
    assert_eq!(
        p["sourceFiles"],
        json!([
            "packages/server/src/sim/factions.ts",
            "packages/shared/src/mark.ts",
            "packages/shared/src/factions.ts",
            "packages/shared/src/signatureShares.ts"
        ])
    );
    let mut expected = Vec::new();
    for weapon in ["fists", "sword", "axe", "shield", "bow", "wand"] {
        for hits in [1, 3, 6, 9, 12] {
            expected.push(format!("{weapon}-{hits}"));
        }
    }
    expected.extend(
        [
            "distance-299.999999",
            "distance-300",
            "distance-300.000001",
            "distance-640",
            "distance-640.000001",
            "stacks-1",
            "stacks-5",
            "chill-1",
            "chill-2",
            "chill-3",
            "chill-6",
            "filter-passive",
            "filter-derived",
            "filter-sig",
            "filter-noWeapon",
            "filter-zeroScale",
            "filter-immune",
            "swaps-0",
            "swaps-1",
            "swaps-2",
            "swaps-3",
            "swaps-9",
            "far-age-1499.999999",
            "far-age-1500",
            "far-age-1500.000001",
            "stagger-not-paused",
        ]
        .map(str::to_owned),
    );
    assert_eq!(
        fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["setup"]["name"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>(),
        expected
    );
    numbers(&mut fixture);
    for case in fixture["cases"].as_array().unwrap() {
        keys(case, &["setup", "result", "pulses", "events"]);
        let c = &case["setup"];
        assert!(c.as_object().unwrap().keys().all(|k| [
            "name",
            "weapon",
            "hits",
            "distance",
            "stacks",
            "chill",
            "flag",
            "priorHits",
            "priorProgress",
            "priorTier",
            "swaps",
            "farAge",
            "pause"
        ]
        .contains(&k.as_str())));
        let mut s = crate::Sim::reset_active(
            crate::SimConfig {
                quests: false,
                consumables: true,
                faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
                pvp_rules: false,
                ..Default::default()
            },
            crate::arenas::practice_arena(),
            crate::Secrets::from_seed(12),
            &(0..3)
                .map(|i| crate::Placement {
                    profile: format!("p{i}"),
                    faction: if i == 0 {
                        FactionId::Sentenced
                    } else {
                        FactionId::Holy
                    },
                    bot: false,
                    at: crate::Vec2::new(
                        400. + if i == 1 {
                            c["distance"].as_f64().unwrap_or(60.)
                        } else {
                            i as f64 * 60.
                        },
                        320.,
                    ),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                })
                .collect::<Vec<_>>(),
        );
        s.w.server_time = 10000.;
        s.w.tick = 200;
        let flag = c["flag"].as_str().unwrap_or("");
        if flag == "immune" {
            s.w.players[1].vitals.immune_until = 11000.;
        }
        let owner = &mut s.w.players[0];
        owner.credit.sentence = c["stacks"].as_f64().unwrap_or(0.) as u8;
        owner.signature.set_target(PlayerId(2), 10000.);
        owner.signature.chill = c["chill"].as_f64().unwrap_or(1.);
        owner.signature.dot_paused_until = c["pause"].as_f64().unwrap_or(0.);
        owner.signature.mark = crate::fighter::Mark {
            group: Some(crate::fighter::MarkGroup::Fighter(PlayerId(2))),
            tier: c["priorTier"].as_f64().unwrap_or(0.) as u8,
            hits: c["priorHits"].as_f64().unwrap_or(0.) as u64,
            progress: c["priorProgress"].as_f64().unwrap_or(0.),
            swaps: c["swaps"].as_f64().unwrap_or(0.) as u64,
            far_since: c["farAge"].as_f64().map(|t| 10000. - t),
            ..Default::default()
        };
        let mut ledger = vec![];
        for _ in 0..c["hits"].as_f64().unwrap() as usize {
            ledger.push(Entry {
                terrain: false,
                dot: false,
                ability: None,
                arena: false,
                source: None,
                critical: false,
                critical_mult: None,
                victim: PlayerId(2),
                by: Some(PlayerId(1)),
                packet: Packet {
                    raw: 1.,
                    phys: 1.,
                    magic: 0.,
                    true_: 0.,
                },
                weapon: if flag == "noWeapon" {
                    None
                } else {
                    Some(crate::WeaponId::parse(c["weapon"].as_str().unwrap()).unwrap())
                },
                stagger: false,
                projectile: None,
                scale: if flag == "zeroScale" { 0. } else { 1. },
                derived: flag == "derived",
                passive: flag == "passive",
                sig: if flag == "sig" {
                    Some(SignatureKind::Burn)
                } else {
                    None
                },
                execute: false,
            });
        }
        let mut events = vec![];
        before_damage(&s.k, &mut s.w, &mut ledger, &mut events);
        let p = &s.w.players[0];
        let m = &p.signature.mark;
        let result = json!({"target":p.signature.target.map(|id|format!("p{}",id.0-1)),"tier":m.tier,"hits":m.hits,"progress":m.progress,"swaps":m.swaps,"denied":m.denied,"farSince":m.far_since,"ampUntil":m.amp_until,"sentence":p.credit.sentence});
        let pulses=ledger.iter().filter(|e|e.sig==Some(SignatureKind::Mark)).map(|e|json!({"raw":e.packet.raw,"weapon":e.weapon.unwrap().as_str(),"phys":e.packet.phys,"magic":e.packet.magic,"true_":e.packet.true_,"scale":e.scale})).collect::<Vec<_>>();
        let notices = events
            .iter()
            .filter_map(|e| match e {
                crate::Event::MarkNotice { recipient, notice } => {
                    Some(json!({"to":format!("p{}",recipient.0-1),"text":notice.message()}))
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        let mut actual = json!({"setup":c,"result":result,"pulses":pulses,"events":notices});
        numbers(&mut actual);
        assert_eq!(&actual, case, "{}", c["name"]);
    }
}
#[test]
fn helper_only_actual_execute_denial_matrix() {
    let mut fixture: Value = serde_json::from_str(include_str!(
        "../../../../../parity/sentenced/denial-matrix.json"
    ))
    .unwrap();
    keys(
        &fixture,
        &["format", "provenance", "cases", "referenceOnly"],
    );
    assert_eq!(fixture["format"], "rh-sentenced-denial-matrix/1");
    assert_eq!(fixture["referenceOnly"]["reason"],"source explicit arena flag has no current Rust producer or typed representation; excluded from accepted helper parity");
    assert_eq!(
        fixture["referenceOnly"]["cases"].as_array().unwrap().len(),
        1
    );
    let p = &fixture["provenance"];
    keys(
        p,
        &["node", "platform", "arch", "kind", "modules", "exports"],
    );
    assert_eq!(
        (&p["node"], &p["platform"], &p["arch"]),
        (&json!("v22.23.4"), &json!("linux"), &json!("x64"))
    );
    assert_eq!(p["kind"],"helper-only arbitrary direct ledger executes; actual installed index, ledger, payouts and afterDamage; not gameplay intake");
    assert_eq!(
        p["modules"],
        json!([
            "loot",
            "weapons",
            "targeting",
            "projectiles",
            "factions",
            "mobs",
            "buffs",
            "feed",
            "camps",
            "chests",
            "killAugments",
            "mobLife",
            "mobAI",
            "terrainEffects",
            "regen",
            "abilities",
            "quests",
            "vision",
            "campHeal",
            "traders",
            "cardHooks",
            "mods"
        ])
    );
    assert_eq!(
        p["exports"],
        json!([
            "packages/server/src/sim/ledger.ts::recordHit",
            "packages/server/src/sim/ledger.ts::applyLedger",
            "packages/server/src/sim/factions.ts::installFactions"
        ])
    );
    assert_eq!(
        fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["setup"]["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "no-execute",
            "deny",
            "barrier",
            "multiple-execute",
            "ordinary-disease-lethal",
            "other-foe-execute-lethal",
            "pvp",
            "already-denied",
            "stack-cap",
            "no-top-tier",
            "nonlethal",
            "fully-barrier",
            "zero"
        ]
    );
    numbers(&mut fixture);
    for case in fixture["cases"].as_array().unwrap() {
        keys(case, &["setup", "denies", "result", "landed", "notices"]);
        let c = &case["setup"];
        assert!(c.as_object().unwrap().keys().all(|k| [
            "name", "hp", "rows", "barrier", "pvp", "denied", "stacks", "tier"
        ]
        .contains(&k.as_str())));
        assert!(!c["rows"].as_array().unwrap().is_empty());
        let mut s = crate::Sim::reset_active(
            crate::SimConfig {
                quests: false,
                consumables: true,
                faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
                pvp_rules: c["pvp"].as_bool().unwrap_or(false),
                ..Default::default()
            },
            crate::arenas::practice_arena(),
            crate::Secrets::from_seed(12),
            &(0..3)
                .map(|i| crate::Placement {
                    profile: format!("p{i}"),
                    faction: if i == 0 {
                        FactionId::Sentenced
                    } else {
                        FactionId::Holy
                    },
                    bot: false,
                    at: crate::Vec2::new(400. + i as f64 * 60., 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                })
                .collect::<Vec<_>>(),
        );
        s.w.server_time = 10000.;
        s.w.tick = 200;
        let p = &mut s.w.players[0];
        p.vitals.hp = c["hp"].as_f64().unwrap();
        p.vitals.barrier = c["barrier"].as_f64().unwrap_or(0.);
        p.credit.sentence = c["stacks"].as_f64().unwrap_or(0.) as u8;
        p.signature.set_target(PlayerId(2), 10000.);
        let tier = c["tier"].as_f64().unwrap_or(4.) as u8;
        let hits = if tier == 3 { 6 } else { 9 };
        p.signature.mark = crate::fighter::Mark {
            group: Some(crate::fighter::MarkGroup::Fighter(PlayerId(2))),
            tier,
            hits,
            progress: hits as f64,
            denied: c["denied"].as_bool().unwrap_or(false),
            ..Default::default()
        };
        for row in c["rows"].as_array().unwrap() {
            let by = row[0].as_f64().map(|n| PlayerId(n as u32 + 1));
            s.s.ledger.push(Entry {
                terrain: false,
                dot: false,
                ability: None,
                arena: false,
                source: None,
                critical: false,
                critical_mult: None,
                victim: PlayerId(1),
                by,
                packet: Packet {
                    raw: row[1].as_f64().unwrap(),
                    phys: 0.,
                    magic: 0.,
                    true_: 1.,
                },
                weapon: by.map(|_| crate::WeaponId::Fists),
                stagger: false,
                projectile: None,
                scale: 1.,
                derived: false,
                passive: false,
                sig: by.map(|_| SignatureKind::Disease),
                execute: row[2].as_bool().unwrap(),
            });
        }
        let mut events = vec![];
        let mut cx = crate::systems::Cx {
            stats: crate::status_runtime::stats::Inputs::default(),
            #[cfg(feature = "trusted-status-probes")]
            probe: None,
            k: &s.k,
            w: &mut s.w,
            s: &mut s.s,
            ev: &mut events,
            pf: &mut s.pf,
        };
        crate::systems::signatures::before_damage(&mut cx);
        let denies=cx.s.mark_denials.iter().map(|(owner,foe)|json!({"owner":format!("p{}",owner.0-1),"foes":[format!("p{}",foe.0-1)]})).collect::<Vec<_>>();
        crate::systems::ledger::apply(&mut cx);
        crate::systems::signatures::after_damage(&mut cx);
        let p = &s.w.players[0];
        let m = &p.signature.mark;
        let result = json!({"hp":p.vitals.hp,"barrier":p.vitals.barrier,"sentence":p.credit.sentence,"status":if p.standing(){"alive"}else {"dead"},"target":p.signature.target.map(|id|format!("p{}",id.0-1)),"tier":m.tier,"hits":m.hits,"progress":m.progress,"swaps":m.swaps,"denied":m.denied,"ampUntil":m.amp_until});
        let landed=s.landed_hits().iter().map(|h|json!({"victim":format!("p{}",h.victim.0-1),"by":h.by.map(|id|format!("p{}",id.0-1)).unwrap_or_else(||"sudden death".into()),"amount":h.amount,"sig":h.sig.map(|sig|sig.as_str()),"weapon":h.weapon.map(|w|w.as_str())})).collect::<Vec<_>>();
        let notices = events
            .iter()
            .filter_map(|e| match e {
                crate::Event::MarkNotice { recipient, notice } => {
                    Some(json!({"to":format!("p{}",recipient.0-1),"text":notice.message()}))
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        let mut actual =
            json!({"setup":c,"denies":denies,"result":result,"landed":landed,"notices":notices});
        numbers(&mut actual);
        assert_eq!(&actual, case, "{}", c["name"]);
    }
}
