//! Bounded Plague player signatures, source-ordered private chunks and settled public bits.
use super::{ledger::Entry, signatures::LandedHit};
use crate::{
    constants::*,
    content,
    factions::{DotBucket, SignatureKind},
    fx_report::{Op, TickFx},
    hooks::{HookArgs, Hx},
    state::{Packet, World},
    statics::MatchStatic,
    Event, FactionId, WeaponId,
};
pub(crate) fn damage(
    k: &MatchStatic,
    w: &World,
    performed: &[crate::factions::PerformedAttack],
    ledger: &mut Vec<Entry>,
) {
    let now = w.server_time;
    for p in w
        .players
        .iter()
        .filter(|p| p.standing() && p.signature.engaged)
    {
        let Some(t) = p
            .signature
            .target
            .and_then(|id| w.player(id))
            .filter(|t| t.standing())
        else {
            continue;
        };
        if p.vitals.faction == FactionId::Fire && k.config.faction_mode.fire() {
            super::fire::damage(p, t, now, performed, ledger);
        }
        if p.vitals.faction != FactionId::Plague {
            continue;
        }
        let weapon = p.active_weapon();
        let paused = TICK_MS.min((p.signature.dot_paused_until - (now - TICK_MS)).max(0.0));
        let dot =
            content::weapon(weapon).dps_mult * ((TICK_MS - paused) / 1000.0) * p.signature.chill;
        for (raw, execute) in [
            (PLAGUE_DPS * DUEL_PACE * dot, false),
            (
                PLAGUE_EXECUTE_DPS
                    * DUEL_PACE
                    * (PLAGUE_EXECUTE_BAND - t.signature.hp_frac).max(0.0)
                    * dot,
                true,
            ),
        ] {
            if raw > 0.0 {
                ledger.push(Entry {
                    victim: t.id,
                    by: Some(p.id),
                    packet: Packet {
                        raw,
                        phys: 0.,
                        magic: 1.,
                        true_: 0.,
                    },
                    weapon: Some(weapon),
                    stagger: false,
                    projectile: None,
                    scale: 1.,
                    derived: false,
                    passive: false,
                    sig: Some(SignatureKind::Disease),
                    execute,
                });
            }
        }
    }
}
pub(crate) fn accumulate(w: &mut World, h: &LandedHit) {
    let (Some(by), Some(sig)) = (h.by, h.sig) else {
        return;
    };
    if let Some(b) = w
        .factions
        .dot
        .iter_mut()
        .find(|b| (b.victim, b.by, b.sig) == (h.victim, by, sig))
    {
        b.amount += h.amount;
    } else {
        w.factions.dot.push(DotBucket {
            victim: h.victim,
            by,
            sig,
            weapon: h.weapon,
            amount: h.amount,
        });
    }
}
fn flush(w: &mut World, ev: &mut Vec<Event>, fx: Option<&mut TickFx>) {
    if let Some(fx) = fx {
        fx.ops.push(Op::Flush(ev.len()));
    }
    for b in &w.factions.dot {
        ev.push(Event::SignatureHit {
            victim: b.victim,
            by: b.by,
            sig: b.sig,
            weapon: b.weapon,
            amount: b.amount,
        });
    }
    w.factions.dot.clear();
    w.factions.dot_since = w.server_time;
}
pub(crate) fn run_ended(h: &mut Hx, args: &HookArgs) {
    if *args == HookArgs::RunEnded && h.k.config.faction_mode.engagement() {
        flush(h.w, h.ev, h.fx.as_deref_mut());
    }
}
pub(crate) fn after_damage(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, fx: &mut TickFx) {
    let now = w.server_time;
    for p in &mut w.players {
        p.signature.bits = 0;
        if !p.standing() {
            continue;
        }
        let weapon = p.active_weapon();
        if weapon != WeaponId::Bow
            && p.weapon.stagger_immune_until == now + STAGGER_IMMUNITY_SECONDS * 1000.
        {
            let tm = content::player_timings(
                weapon,
                content::attack_interval(&content::paced(p.vitals.faction), weapon, 1.),
            );
            if tm.windup > 0. {
                p.signature.dot_paused_until =
                    p.signature.dot_paused_until.max(now + tm.windup * 1000.);
            }
        }
    }
    if k.config.faction_mode.frost() {
        super::frost::after_damage(w);
    }
    if k.config.faction_mode.sentenced() {
        super::sentenced::after_damage(w);
    }
    for i in 0..w.players.len() {
        let p = &w.players[i];
        if !k.config.faction_mode.plague()
            || !p.standing()
            || !(p.vitals.faction == FactionId::Plague
                || (p.vitals.faction == FactionId::Fire && k.config.faction_mode.fire()))
            || !p.signature.engaged
        {
            continue;
        }
        let Some(t) = p
            .signature
            .target
            .and_then(|id| w.idx(id))
            .filter(|&i| w.players[i].standing())
        else {
            continue;
        };
        let fire = p.vitals.faction == FactionId::Fire;
        let t = &mut w.players[t];
        if fire {
            t.signature.bits |= SIG_BURNING;
            continue;
        }
        t.signature.bits |= SIG_DISEASED;
        if t.vitals.max_hp > 0. && t.vitals.hp / t.vitals.max_hp < PLAGUE_EXECUTE_BAND {
            t.signature.bits |= SIG_EXECUTE;
        }
    }
    if now - w.factions.dot_since >= DOT_FX_MS {
        flush(w, ev, Some(fx));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{arenas::practice_arena, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};
    use serde_json::{json, Value};
    mod proof_schema {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/support/plague_proofs.rs"
        ));
    }
    #[test]
    fn actual_source_direct_ledger_matrix() {
        let mut fixture: Value =
            serde_json::from_str(include_str!("../../../../parity/plague/ledger-matrix.json"))
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
                        FactionId::Plague
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
                    faction_mode: crate::FactionMode::EngagementHolyPlague,
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
                        victim: id(&e["victim"]),
                        by: Some(id(&e["by"])),
                        packet: Packet {
                            raw: e["raw"].as_f64().unwrap(),
                            phys: 0.,
                            magic: 1.,
                            true_: 0.,
                        },
                        scale: e["scale"].as_f64().unwrap(),
                        sig: e["sig"].as_str().map(|_| SignatureKind::Disease),
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
            let landed=sim.s.landed.iter().map(|h|json!({"victim":fid(h.victim),"by":h.by.map(fid),"amount":h.amount,"weapon":h.weapon.map(WeaponId::as_str),"sig":h.sig.map(|_|"disease")})).collect::<Vec<_>>();
            let players=sim.w.players.iter().map(|p|json!({"id":fid(p.id),"hp":p.vitals.hp,"barrier":p.vitals.barrier,"status":if p.standing(){"alive"}else{"dead"}})).collect::<Vec<_>>();
            let buckets=sim.w.factions.dot.iter().map(|b|json!({"victim":fid(b.victim),"by":fid(b.by),"sig":"disease","weapon":b.weapon.map(WeaponId::as_str),"amount":b.amount})).collect::<Vec<_>>();
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
