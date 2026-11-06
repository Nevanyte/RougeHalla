//! Trail contacts precede generic DoT rows. Signature producers remain their own tickers.
use crate::{
    events::Event,
    state::Packet,
    status_runtime::{self as rt, FieldKind, Payload, StatusApply, StatusKind},
    systems::{ledger::Entry, Cx},
};
pub(crate) fn damage(cx: &mut Cx) {
    let stats = cx.stats;
    damage_with(cx, crate::constants::TICK_MS, |p| stats.view(p));
}
pub(crate) fn damage_with(
    cx: &mut Cx,
    dt_ms: f64,
    view: impl Fn(&crate::fighter::FighterCore) -> rt::StatView,
) {
    let Cx {
        k, w, s, ev, stats, ..
    } = cx;
    let now = w.server_time;
    for i in 0..w.players.len() {
        if !w.players[i].standing() || now < w.players[i].vitals.immune_until {
            continue;
        }
        let count = w.abilities.as_ref().map_or(0, |a| a.fields.len());
        for j in 0..count {
            let f = &w.abilities.as_ref().unwrap().fields[j];
            if f.kind != FieldKind::Trail
                || f.owner.id == Some(w.players[i].id)
                || !rt::on_trail(f, w.players[i].pos())
            {
                continue;
            }
            let Some((dps, ms)) = rt::rank_one_field_policy(f.ability).burn else {
                continue;
            };
            let quiet = w.players[i].statuses.instances.iter().any(|st| {
                st.kind == StatusKind::Dot
                    && st.source.id == f.owner.id
                    && st.ability == Some(f.ability)
                    && st.until > now
            });
            let apply = StatusApply {
                kind: StatusKind::Dot,
                source: f.owner.clone(),
                ms,
                ability: Some(f.ability),
                tag: None,
                value: Some(dps),
                add: None,
                data: Some(Payload {
                    shares: Some(crate::content::DamageShares {
                        phys: 0.,
                        magic: 0.,
                        true_: 1.,
                    }),
                    ..Default::default()
                }),
            };
            super::operations::apply_with(k, w, ev, w.players[i].id, apply, quiet, *stats);
        }
    }
    for i in 0..w.players.len() {
        if !w.players[i].standing() {
            continue;
        }
        for j in 0..w.players[i].statuses.instances.len() {
            let st = &w.players[i].statuses.instances[j];
            if st.kind != StatusKind::Dot || st.until <= now {
                continue;
            }
            let st = st.clone();
            let victim = w.players[i].id;
            let raw = st.value * dt_ms / 1000.;
            let owner = if st.ability.is_none() && st.source.id != Some(victim) {
                st.source.id.and_then(|id| w.idx(id))
            } else {
                None
            };
            let stats = owner.map(|i| view(&w.players[i])).unwrap_or_default();
            let base = if owner.is_some() {
                raw * stats.dot_mult
            } else {
                raw
            };
            let critical = owner.is_some_and(|i| {
                rt::roll_dot_crit(&mut w.players[i].card_dot_crit, w.tick, true, stats)
            });
            let shares = st.data.shares.unwrap_or(crate::content::DamageShares {
                phys: 0.,
                magic: 0.,
                true_: 1.,
            });
            s.ledger.push(Entry {
                dot: true,
                ability: st.ability,
                arena: false,
                source: Some(st.source.clone()),
                critical,
                critical_mult: critical.then_some(rt::stats::CRIT_MULT),
                sig: None,
                execute: false,
                victim,
                by: st.source.id,
                packet: Packet {
                    raw: if critical {
                        base * rt::stats::CRIT_MULT
                    } else {
                        base
                    },
                    phys: shares.phys,
                    magic: shares.magic,
                    true_: shares.true_,
                },
                weapon: None,
                stagger: false,
                projectile: None,
                scale: 1.,
                derived: false,
                passive: false,
            });
        }
    }
}
pub(crate) fn report(cx: &mut Cx) {
    let Cx { w, s, ev, .. } = cx;
    let now = w.server_time;
    for h in &s.landed {
        let Some(ability) = h.ability.filter(|_| h.dot) else {
            continue;
        };
        let a = w
            .abilities
            .get_or_insert_with(|| rt::AbilityRuntime::new(now));
        if let Some(b) = a
            .dot
            .iter_mut()
            .find(|b| b.victim == h.victim && b.by == h.by && b.ability == ability)
        {
            b.amount += h.amount
        } else {
            a.dot.push(rt::AbilityDotBucket {
                victim: h.victim,
                by: h.by,
                ability,
                amount: h.amount,
            });
        }
        s.fx.ops.push(crate::fx_report::Op::Contribution(*h));
    }
    if w.abilities
        .as_ref()
        .is_some_and(|a| now - a.dot_since >= crate::constants::DOT_FX_MS)
    {
        flush(w, ev, Some(&mut s.fx));
    }
}
pub(crate) fn flush(
    w: &mut crate::state::World,
    ev: &mut Vec<Event>,
    fx: Option<&mut crate::fx_report::TickFx>,
) {
    let Some(a) = w.abilities.as_mut() else {
        return;
    };
    if let Some(fx) = fx {
        fx.ops.push(crate::fx_report::Op::AbilityFlush(ev.len()));
    }
    for b in &a.dot {
        ev.push(Event::AbilityHit {
            victim: b.victim,
            by: b.by,
            ability: b.ability,
            amount: b.amount,
        });
    }
    a.dot.clear();
    a.dot_since = w.server_time;
}
