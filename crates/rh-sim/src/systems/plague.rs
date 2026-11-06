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
    w: &mut World,
    performed: &[crate::factions::PerformedAttack],
    ledger: &mut Vec<Entry>,
) {
    let now = w.server_time;
    for slot in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        let p = w.core(ix);
        if !w.standing(ix) || !p.signature.engaged {
            continue;
        }
        let Some(ti) = p
            .signature
            .target
            .and_then(|id| w.fighter_idx(id))
            .filter(|&ti| w.standing(ti))
        else {
            continue;
        };
        if p.vitals.faction == FactionId::Fire && k.config.faction_mode.fire() {
            super::fire::damage(w, ix, ti, now, performed, ledger);
        }
        let p = w.core(ix);
        if p.vitals.faction != FactionId::Plague {
            continue;
        }
        let t = w.core(ti);
        let weapon = p.active_weapon();
        let id = p.id;
        let victim = t.id;
        let paused = TICK_MS.min((p.signature.dot_paused_until - (now - TICK_MS)).max(0.));
        let secs = (TICK_MS - paused) / 1000.;
        let dot = content::weapon(weapon).dps_mult * secs * p.signature.chill;
        let basic = w.signature_damage(ix, PLAGUE_DPS, false) * dot;
        let ap = if w.is_player(ix) {
            crate::modifiers::DEFINITION.plague_ap_per_hit
                * p.modifiers.mirrors().ap_bonus
                * p.signature.ap_hits.rate()
                * secs
        } else {
            crate::modifiers::DEFINITION.ap_dot_ratio * p.modifiers.mirrors().ap_bonus * secs
        } * p.signature.chill;
        let execute = w.signature_damage(ix, PLAGUE_EXECUTE_DPS, true)
            * (PLAGUE_EXECUTE_BAND - t.signature.hp_frac).max(0.)
            * dot;
        let dm = p.modifiers.dot_mult();
        for (raw, execute) in [
            (basic, false),
            (if basic > 0. { ap } else { 0. }, false),
            (execute, true),
        ] {
            if raw > 0. {
                super::ledger::record_hit(
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
                            raw: raw * dm,
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
                    },
                );
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
    for slot in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        w.core_mut(ix).signature.bits = 0;
        if !w.standing(ix) {
            continue;
        }
        let p = w.core(ix);
        let weapon = p.active_weapon();
        if weapon != WeaponId::Bow
            && p.weapon.stagger_immune_until == now + STAGGER_IMMUNITY_SECONDS * 1000.
        {
            let interval = content::attack_interval(&w.paced_sheet(ix), weapon, 1.);
            let tm = if w.is_player(ix) {
                content::player_timings(weapon, interval)
            } else {
                content::npc_timings(weapon, interval)
            };
            if tm.windup > 0. {
                let p = w.core_mut(ix);
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
    for slot in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        let p = w.core(ix);
        if !k.config.faction_mode.plague()
            || !w.standing(ix)
            || !(p.vitals.faction == FactionId::Plague
                || (p.vitals.faction == FactionId::Fire && k.config.faction_mode.fire()))
            || !p.signature.engaged
        {
            continue;
        }
        let Some(ti) = p
            .signature
            .target
            .and_then(|id| w.fighter_idx(id))
            .filter(|&i| w.standing(i))
        else {
            continue;
        };
        let fire = p.vitals.faction == FactionId::Fire;
        let t = w.core_mut(ti);
        if fire {
            t.signature.bits |= SIG_BURNING;
        } else {
            t.signature.bits |= SIG_DISEASED;
            if t.vitals.max_hp > 0. && t.vitals.hp / t.vitals.max_hp < PLAGUE_EXECUTE_BAND {
                t.signature.bits |= SIG_EXECUTE;
            }
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
