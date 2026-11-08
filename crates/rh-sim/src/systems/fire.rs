//! Shared basic Fire producer; build riders remain player-only as in the source.
use super::ledger::{record_hit, Entry};
use crate::{
    constants::*,
    content,
    factions::{PerformedAttack, SignatureKind},
    fighter::FighterIx,
    state::{Packet, World},
};
pub(crate) fn damage(
    w: &mut World,
    ix: FighterIx,
    ti: FighterIx,
    now: f64,
    performed: &[PerformedAttack],
    ledger: &mut Vec<Entry>,
) {
    let p = w.core(ix);
    let t = w.core(ti);
    let weapon = p.active_weapon();
    let id = p.id;
    let victim = t.id;
    let mult = content::weapon(weapon).dps_mult;
    let paused = TICK_MS.min((p.signature.dot_paused_until - (now - TICK_MS)).max(0.));
    let secs = (TICK_MS - paused) / 1000.;
    let chill = p.signature.chill;
    let dot_mult = p.modifiers.dot_mult();
    let burn = w.signature_damage(ix, FIRE_BURN_DPS, false) * (mult * secs * chill);
    let m = p.modifiers.mirrors();
    let rider = (crate::modifiers::DEFINITION.ap_dot_ratio * m.ap_bonus
        + if w.is_player(ix) {
            crate::modifiers::DEFINITION.fire_ad_ratio * m.ad_bonus
        } else {
            0.
        })
        * secs
        * chill;
    let backlash = w.signature_damage(ix, FIRE_BACKLASH, false);
    let defense = if w.is_player(ix) {
        crate::modifiers::bonus_defense(p)
    } else {
        0.
    };
    let tank = 1. + crate::modifiers::DEFINITION.fire_defense_ratio * defense;
    let foe = w.paced_sheet(ti);
    let mut push = |sig, raw, phys, magic| {
        if raw > 0. {
            record_hit(
                w,
                ledger,
                Entry {
                    terrain: false,
                    dot: false,
                    ability: None,
                    arena: false,
                    source: None,
                    critical: false,
                    critical_mult: None,
                    victim,
                    by: Some(id),
                    packet: Packet {
                        raw,
                        phys,
                        magic,
                        true_: 0.,
                    },
                    weapon: Some(weapon),
                    stagger: false,
                    projectile: None,
                    scale: 1.,
                    derived: false,
                    passive: false,
                    sig: Some(sig),
                    execute: false,
                },
            );
        }
    };
    push(SignatureKind::Burn, burn * dot_mult, 0., 1.);
    if burn > 0. {
        push(SignatureKind::Burn, rider * dot_mult, 0., 1.);
    }
    for a in performed.iter().filter(|a| a.by == victim) {
        let raw = backlash * content::attack_interval(&foe, a.weapon, 1.) * mult * tank * chill;
        push(SignatureKind::Backlash, raw, 1., 0.);
    }
}

#[cfg(test)]
mod tests {
    use super::super::ledger::Entry;
    use super::*;
    use crate::{arenas::practice_arena, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};
    use crate::{Event, FactionId, WeaponId};
    use serde_json::{json, Value};
    mod proof_schema {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/support/fire_proofs.rs"
        ));
    }
    #[test]
    fn actual_source_direct_ledger_matrix() {
        let mut fixture: Value =
            serde_json::from_str(include_str!("../../../../parity/fire/ledger-matrix.json"))
                .unwrap();
        fn numbers(v: &mut Value) {
            match v {
                Value::Number(n) => *v = json!(n.as_f64().unwrap()),
                Value::Array(a) => a.iter_mut().for_each(numbers),
                Value::Object(o) => o.values_mut().for_each(numbers),
                _ => {}
            }
        }
        proof_schema::matrix(&fixture).unwrap();
        numbers(&mut fixture);
        for case in fixture["cases"].as_array().unwrap() {
            let c = &case["setup"];
            let ps = (0..4)
                .map(|i| Placement {
                    profile: format!("p{i}"),
                    faction: if i < 2 {
                        FactionId::Fire
                    } else {
                        FactionId::Holy
                    },
                    bot: false,
                    at: Vec2::new(400. + 300. * f64::from(i), 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                })
                .collect::<Vec<_>>();
            let mut sim = Sim::reset_active(
                SimConfig {
                    quests: false,
                    faction_mode: crate::FactionMode::EngagementHolyPlagueFire,
                    pvp_rules: c["pvp"].as_bool().unwrap_or(true),
                    ..Default::default()
                },
                practice_arena(),
                Secrets::from_seed(12),
                &ps,
            );
            let id = |v: &Value| PlayerId(v.as_str().unwrap()[1..].parse::<u32>().unwrap() + 1);
            sim.w.players[2].vitals.hp = c["hp"].as_f64().unwrap_or(1000.);
            sim.w.players[2].vitals.barrier = c["barrier"].as_f64().unwrap_or(0.);
            sim.w.players[2].vitals.immune_until = c["immune"].as_f64().unwrap_or(0.);
            if c["depart"].is_string() {
                sim.remove_player(id(&c["depart"]));
            }
            sim.w.server_time = 100.;
            sim.w.tick = 2;
            let mut events = Vec::new();
            {
                let mut cx = super::super::Cx {
                    stats: crate::status_runtime::stats::Inputs::default(),
                    #[cfg(feature = "trusted-status-probes")]
                    probe: None,
                    k: &sim.k,
                    w: &mut sim.w,
                    s: &mut sim.s,
                    ev: &mut events,
                    pf: &mut sim.pf,
                };
                super::super::settle::mark_tick_start(&mut cx);
                super::super::ledger::open(&mut cx);
                cx.s.rank.resize(cx.w.players.len(), 0);
                for e in c["entries"].as_array().unwrap() {
                    cx.s.ledger.push(Entry {
                        terrain: false,
                        dot: false,
                        ability: None,
                        arena: false,
                        source: None,
                        critical: false,
                        critical_mult: None,
                        victim: id(&e["victim"]),
                        by: Some(id(&e["by"])),
                        packet: Packet {
                            raw: e["raw"].as_f64().unwrap(),
                            phys: if e["sig"] == "backlash" { 1. } else { 0. },
                            magic: if e["sig"] == "backlash" { 0. } else { 1. },
                            true_: 0.,
                        },
                        scale: e["scale"].as_f64().unwrap(),
                        sig: e["sig"].as_str().map(|s| match s {
                            "burn" => SignatureKind::Burn,
                            "backlash" => SignatureKind::Backlash,
                            "disease" => SignatureKind::Disease,
                            _ => panic!("unknown signature"),
                        }),
                        execute: e["execute"].as_bool().unwrap(),
                        weapon: e["weapon"].as_str().and_then(WeaponId::parse),
                        stagger: false,
                        projectile: None,
                        derived: false,
                        passive: false,
                    });
                }
                super::super::ledger::apply(&mut cx);
                super::super::signatures::after_damage(&mut cx);
            }
            let fid = |id: PlayerId| format!("p{}", id.0 - 1);
            let emitted=events.iter().filter_map(|e| match e { Event::SignatureHit {victim,by,sig:SignatureKind::Backlash,amount,..}=>Some(json!({"victim":fid(*victim),"by":fid(*by),"amount":amount,"sig":"backlash"})),_=>None }).collect::<Vec<_>>();
            let expected = case["hooks"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|h| h["sig"] == "backlash")
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(emitted, expected, "{} pre-barrier instant FX", c["name"]);
            let landed=sim.s.landed.iter().map(|h|json!({"victim":fid(h.victim),"by":h.by.map(fid),"amount":h.amount,"weapon":h.weapon.map(WeaponId::as_str),"sig":h.sig.map(|s|s.as_str())})).collect::<Vec<_>>();
            let players=sim.w.players.iter().map(|p|json!({"id":fid(p.id),"hp":p.vitals.hp,"barrier":p.vitals.barrier,"status":if p.standing(){"alive"}else{"dead"}})).collect::<Vec<_>>();
            let buckets=sim.w.factions.dot.iter().map(|b|json!({"victim":fid(b.victim),"by":fid(b.by),"sig":b.sig.as_str(),"weapon":b.weapon.map(WeaponId::as_str),"amount":b.amount})).collect::<Vec<_>>();
            assert_eq!(json!(landed), case["landed"], "{} landed", c["name"]);
            assert_eq!(json!(players), case["players"], "{} players", c["name"]);
            assert_eq!(json!(buckets), case["buckets"], "{} chunks", c["name"]);
            // The source hook tap retains pre-barrier amounts, while landed feeds the post-barrier share.
            if c["name"] == "partial-barrier" {
                let pre: f64 = case["hooks"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|h| h["amount"].as_f64().unwrap())
                    .sum();
                let post: f64 = sim.s.landed.iter().map(|h| h.amount).sum();
                assert!((pre - post - 5.).abs() < 1e-12);
            }
        }
    }
}

#[cfg(test)]
mod privacy {
    use crate::{
        Arena, FactionId, FactionMode, FxProjector, Placement, PlayerId, RawCommand, Secrets,
        SeenEvent, Sim, SimConfig, TileMap, Vec2, WeaponId,
    };
    fn scene(n: usize) -> Sim {
        let mut s = Sim::reset_active(
            SimConfig {
                quests: false,
                faction_mode: FactionMode::EngagementHolyPlagueFire,
                ..Default::default()
            },
            Arena {
                map: TileMap::from_rows(
                    &vec![".".repeat(118); 52]
                        .iter()
                        .map(String::as_str)
                        .collect::<Vec<_>>(),
                )
                .unwrap(),
                spawns: vec![Vec2::new(320., 320.); 8],
            },
            Secrets::from_seed(12),
            &(0..8)
                .map(|i| Placement {
                    profile: format!("p{i}"),
                    faction: if (2..2 + n).contains(&i) {
                        FactionId::Fire
                    } else {
                        FactionId::Holy
                    },
                    bot: false,
                    at: Vec2::new(320., 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                })
                .collect::<Vec<_>>(),
        );
        for (i, p) in s.w.players.iter_mut().enumerate() {
            p.body.x = if i == 0 {
                1040.
            } else if i == 1 {
                2000.
            } else {
                3000.
            };
            p.body.y = 768.;
            p.body.history.clear();
            p.core.body.history.push(crate::state::Sample {
                t: s.w.server_time,
                x: p.body.x,
                y: p.body.y,
            });
        }
        s.w.players[1].vitals.barrier = 10000.;
        s
    }
    fn send(s: &mut Sim, id: usize, raw: RawCommand) {
        s.submit(PlayerId(id as u32 + 1), crate::validate(raw).unwrap())
            .unwrap();
    }
    fn drive(s: &mut Sim, n: usize, t: usize) {
        let now = s.w.server_time;
        for i in 2..2 + n {
            if t == i {
                let p = &mut s.w.players[i];
                p.body.x = 2070.;
                p.body.y = 768.;
                p.body.history.clear();
                p.core.body.history.push(crate::state::Sample {
                    t: now,
                    x: p.body.x,
                    y: p.body.y,
                });
                send(
                    s,
                    i,
                    RawCommand::Attack {
                        a: std::f64::consts::PI,
                        t: None,
                    },
                );
            }
            if t == i + 1 {
                send(
                    s,
                    i,
                    RawCommand::Release {
                        a: std::f64::consts::PI,
                        t: None,
                    },
                );
                let p = &mut s.w.players[i];
                p.body.x = 3000.;
                p.body.history.clear();
                p.core.body.history.push(crate::state::Sample {
                    t: now,
                    x: p.body.x,
                    y: p.body.y,
                });
            }
        }
        if t == 6 {
            send(
                s,
                0,
                RawCommand::Move {
                    x: 1125.,
                    y: 768.,
                    seq: None,
                },
            );
            for i in 2..2 + n {
                let p = &mut s.w.players[i];
                p.body.x = 2070.;
                p.body.y = 738. + (i - 2) as f64 * 20.;
                p.weapon.weapon0 = if n == 3 { Some(WeaponId::Bow) } else { None };
                p.body.history.clear();
                p.core.body.history.push(crate::state::Sample {
                    t: now,
                    x: p.body.x,
                    y: p.body.y,
                });
            }
            s.w.players[1].vitals.barrier = 0.;
        }
        if t == 13 {
            send(
                s,
                1,
                RawCommand::Attack {
                    a: std::f64::consts::PI,
                    t: None,
                },
            );
        }
        if t == 14 {
            send(
                s,
                1,
                RawCommand::Release {
                    a: std::f64::consts::PI,
                    t: None,
                },
            );
        }
    }
    #[test]
    fn genuine_request_snapshot_preserves_duplicates_order_and_distinct_bounds() {
        use crate::systems::{melee::MeleeReq, projectiles::Spawn, Cx};
        let mut s = scene(3);
        let mut ev = Vec::new();
        let packet = crate::state::Packet {
            raw: 1.,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        };
        s.s.melee.push(MeleeReq {
            attacker: PlayerId(2),
            weapon: WeaponId::Sword,
            a: 0.,
            rewind_t: 50.,
            packet,
        });
        s.s.flight.spawns.push(Spawn {
            owner: PlayerId(2),
            weapon: WeaponId::Bow,
            target: None,
            aim: 0.,
            packet,
        });
        crate::systems::signatures::after_weapons(&mut Cx {
            stats: crate::status_runtime::stats::Inputs::default(),
            #[cfg(feature = "trusted-status-probes")]
            probe: None,
            k: &s.k,
            w: &mut s.w,
            s: &mut s.s,
            ev: &mut ev,
            pf: &mut s.pf,
        });
        assert_eq!(
            s.performed_attacks()
                .iter()
                .map(|a| a.weapon)
                .collect::<Vec<_>>(),
            vec![WeaponId::Sword, WeaponId::Bow]
        );
        assert!(s.s.performed_bounded);
        assert_eq!(s.s.melee.len(), 1);
        assert_eq!(s.s.flight.spawns.len(), 1);
        s.s.melee.push(s.s.melee[0]);
        crate::systems::signatures::after_weapons(&mut Cx {
            stats: crate::status_runtime::stats::Inputs::default(),
            #[cfg(feature = "trusted-status-probes")]
            probe: None,
            k: &s.k,
            w: &mut s.w,
            s: &mut s.s,
            ev: &mut ev,
            pf: &mut s.pf,
        });
        assert!(!s.s.performed_bounded);
        assert_eq!(s.performed_attacks().len(), 3);
        s.finish_fx_report(&[], 0);
        let mut p = FxProjector::attach(&s, PlayerId(1));
        s.projection.report.tick += 1;
        assert_eq!(
            p.feed(s.fx_report()),
            Err(crate::FxError::UnsupportedBounds)
        );
        s.s.melee.clear();
        s.s.flight.spawns.clear();
        for i in 0..17 {
            s.s.melee.push(MeleeReq {
                attacker: PlayerId(i / 2 + 1),
                weapon: WeaponId::Fists,
                a: 0.,
                rewind_t: 50.,
                packet,
            });
        }
        crate::systems::signatures::after_weapons(&mut Cx {
            stats: crate::status_runtime::stats::Inputs::default(),
            #[cfg(feature = "trusted-status-probes")]
            probe: None,
            k: &s.k,
            w: &mut s.w,
            s: &mut s.s,
            ev: &mut ev,
            pf: &mut s.pf,
        });
        assert!(!s.s.performed_bounded);
        assert_eq!(s.performed_attacks().len(), 17);
    }
    #[test]
    fn actual_fire_three_bows_four_fists_hide_source_count() {
        let evidence: serde_json::Value =
            serde_json::from_str(include_str!("../../../../parity/fire/hidden-instant.json"))
                .unwrap();
        let mut a = scene(3);
        let mut b = scene(4);
        let mut pa = FxProjector::attach(&a, PlayerId(1));
        let mut pb = FxProjector::attach(&b, PlayerId(1));
        for t in 2..=17 {
            drive(&mut a, 3, t);
            drive(&mut b, 4, t);
            let ea = a.step();
            let eb = b.step();
            pa.feed(a.fx_report()).unwrap();
            pb.feed(b.fx_report()).unwrap();
            let oa = crate::observe(&a, PlayerId(1), &[]);
            let ob = crate::observe(&b, PlayerId(1), &[]);
            assert_eq!(oa, ob, "tick {t} actors");
            assert_eq!(pa.events(), pb.events(), "tick {t} public FX");
            if t > 13 {
                assert!(!pa.events().iter().any(|e| matches!(
                    e,
                    SeenEvent::SignatureHit {
                        sig: crate::factions::SignatureKind::Backlash,
                        ..
                    }
                )));
            }
            if t == 13 {
                for (s, ev, key, count) in [(&a, &ea, "a", 3), (&b, &eb, "b", 4)] {
                    let rows = ev
                        .iter()
                        .filter_map(|e| {
                            if let crate::Event::SignatureHit {
                                sig: crate::factions::SignatureKind::Backlash,
                                amount,
                                ..
                            } = e
                            {
                                Some(*amount)
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>();
                    assert_eq!(rows.len(), count);
                    let expected = &evidence[key][t - 2]["backlash"];
                    for (i, v) in rows.iter().enumerate() {
                        assert_eq!(*v, expected[i]["amount"].as_f64().unwrap());
                    }
                    assert_eq!(s.performed_attacks().len(), 1);
                }
                let hits = pa
                    .events()
                    .iter()
                    .filter(|e| {
                        matches!(
                            e,
                            SeenEvent::SignatureHit {
                                sig: crate::factions::SignatureKind::Backlash,
                                ..
                            }
                        )
                    })
                    .collect::<Vec<_>>();
                assert!(
                    matches!(hits.as_slice(),[SeenEvent::SignatureHit{by:None,weapon:None,amount,..}] if *amount==111.90727380248373),
                    "{hits:?}"
                );
            }
        }
    }
}
