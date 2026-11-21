//! Legacy terrainEffects passes and hook links, in their original schedule positions.
pub(crate) mod walk;
use crate::{
    constants::*,
    fighter::FighterIx,
    hooks::{HookArgs, Hx},
    state::{Packet, World},
    statics::MatchStatic,
    systems::{heal, ledger, Cx},
    terrain::{self, Mode},
    Event, WeaponId,
};
fn effect(k: &MatchStatic, w: &World, ix: FighterIx) -> terrain::Effect {
    let p = w.core(ix);
    terrain::at(
        &k.arena.map,
        p.body.x,
        p.body.y,
        (k.config.hazards != Mode::All)
            .then(|| p.faction_id())
            .flatten(),
    )
}
pub(crate) fn bog(
    k: &MatchStatic,
    w: &mut World,
    ix: FighterIx,
    dt: f64,
    stats: crate::status_runtime::StatView,
) -> f64 {
    let (multiplier, counts) = bog_read(k, w, ix, stats);
    if counts {
        w.terrain.seconds[1] += dt / 1000.;
    }
    native_hazards(k, w, ix, dt, counts);
    multiplier
}
/// P-AUG-NATIVE-1b: the native hazard hook for a holder's tick on bog (this move-modifier read, once per standing
/// fighter and tick) and on ice (the slip surface the walk will meet from here: `terrain::at(..).accel`, read at the same
/// position on the arena map). Ember is `burn_dt`'s.
fn native_hazards(k: &MatchStatic, w: &mut World, ix: FighterIx, dt: f64, bog: bool) {
    if !w.is_player(ix) {
        return;
    }
    let id = w.core(ix).id;
    if !crate::cards::native::hooks::holds_native(k, w, id) {
        return;
    }
    use crate::cards::native::hooks::{fire, NativeEvent};
    if bog {
        fire(k, w, id, NativeEvent::HazardTick { hazard: 1, ms: dt });
    }
    if k.hazards.slip && effect(k, w, ix).accel > 0. {
        fire(k, w, id, NativeEvent::HazardTick { hazard: 2, ms: dt });
    }
}
fn bog_read(
    k: &MatchStatic,
    w: &World,
    ix: FighterIx,
    stats: crate::status_runtime::StatView,
) -> (f64, bool) {
    if !k.hazards.slow {
        return (1., false);
    }
    let e = effect(k, w, ix);
    let m = crate::status_runtime::resist_slow(e.speed, stats.slow_resist);
    // P-AUG-NATIVE-3: Hazard Walker resists the bog slow, and is immune after 20 s on it.
    if w.is_player(ix) {
        let (resist, immune) = crate::cards::native::hazard_guard(&w.players[ix.slot()].build, 1);
        if immune {
            return (1., false);
        }
        if resist > 0. {
            return (1. - (1. - m) * (1. - resist), e.speed != 1.);
        }
    }
    (m, e.speed != 1.)
}
/// The same dt0 query without even writing +0 to the authoritative exposure counter.
pub(crate) fn bog_value(
    k: &MatchStatic,
    w: &World,
    ix: FighterIx,
    stats: crate::status_runtime::StatView,
) -> f64 {
    bog_read(k, w, ix, stats).0
}
pub(crate) fn burn(cx: &mut Cx) {
    let tick_ms = cx.k.tick_ms();
    burn_dt(cx, tick_ms);
}
fn burn_dt(cx: &mut Cx, dt_ms: f64) {
    let Cx { k, w, s, .. } = cx;
    if !k.hazards.burn || w.rt.gates_locked {
        return;
    }
    for i in 0..w.fighter_count() {
        let ix = FighterIx::of_slot(i);
        let e = effect(k, w, ix);
        // Neutral quest givers participate in exposure/ledger bookkeeping; source dummies do not burn.
        let share = terrain::burn_share(
            e,
            w.standing(ix),
            w.mobs
                .get(w.core(ix).id)
                .is_some_and(|m| m.kind == crate::mob_runtime::MobKind::Dummy),
            w.mobs.get(w.core(ix).id).is_some_and(|m| m.returning()),
            w.rt.gates_locked,
        );
        if !(share > 0.) {
            continue;
        }
        // P-AUG-NATIVE-3: Hazard Walker's ember resistance, and immunity (the tick is skipped before the ledger hit).
        let mut share = share;
        if w.is_player(ix) {
            let (resist, immune) =
                crate::cards::native::hazard_guard(&w.players[ix.slot()].build, 0);
            if immune {
                continue;
            }
            share *= 1. - resist;
        }
        let p = w.core(ix);
        let hit = ledger::Entry {
            terrain: true,
            dot: false,
            ability: None,
            arena: true,
            source: Some(k.terrain_source.clone()),
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: p.id,
            by: None,
            packet: Packet {
                raw: share * p.vitals.max_hp * (dt_ms / 1000.),
                phys: 0.,
                magic: 0.,
                true_: 1.,
            },
            weapon: Some(WeaponId::Sword),
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        };
        ledger::record_hit(w, &mut s.ledger, hit);
        w.terrain.seconds[0] += dt_ms / 1000.;
        // P-AUG-NATIVE-1b: the native hazard hook for a holder's tick on ember.
        if w.is_player(ix) {
            let id = w.core(ix).id;
            crate::cards::native::hooks::fire(
                k,
                w,
                id,
                crate::cards::native::hooks::NativeEvent::HazardTick {
                    hazard: 0,
                    ms: dt_ms,
                },
            );
        }
    }
}
pub(crate) fn light(cx: &mut Cx) {
    let tick_ms = cx.k.tick_ms();
    light_dt(cx, tick_ms);
}
fn light_dt(cx: &mut Cx, dt_ms: f64) {
    let Cx {
        k, w, s, ev, stats, ..
    } = cx;
    if !k.hazards.heal {
        return;
    }
    let now = w.server_time;
    for h in &s.landed {
        terrain::stamp(&mut w.terrain.combat_at, h.victim, now);
        if let Some(by) = h.by {
            terrain::stamp(&mut w.terrain.combat_at, by, now);
        }
    }
    for i in 0..w.players.len() {
        let ix = FighterIx::of_slot(i);
        if !w.standing(ix) {
            continue;
        }
        let e = effect(k, w, ix);
        let share = terrain::light_share(e, true);
        if !(share > 0.) {
            continue;
        }
        w.terrain.seconds[3] += dt_ms / 1000.;
        let p = w.core(ix);
        let id = p.id;
        if w.terrain
            .combat_at
            .iter()
            .any(|(key, last)| *key == id && now - *last < HEAL_LOCKOUT_MS)
        {
            continue;
        }
        let amount = share * p.vitals.max_hp * (dt_ms / 1000.);
        let view = stats.view(p);
        let gained = heal::apply_with(w, ev, i, amount, heal::Kind::QuietOrdinary, view);
        if gained > 0. {
            terrain::add(&mut w.terrain.heal, id, gained);
            terrain::add(&mut w.terrain.light_acc, id, gained);
        }
    }
    if now - w.terrain.light_since < LIGHT_FX_MS {
        return;
    }
    for &(id, sum) in &w.terrain.light_acc {
        if sum >= terrain::LIGHT_FX_MIN && w.fighter_idx(id).is_some_and(|ix| w.standing(ix)) {
            ev.push(Event::Heal { id, amount: sum });
        }
    }
    w.terrain.light_acc.clear();
    w.terrain.light_since = now;
}
pub(crate) fn hurt(hx: &mut Hx, args: &HookArgs) {
    if let HookArgs::ArenaHurt {
        terrain: true,
        victim,
        amount,
        ..
    } = args
    {
        terrain::add(&mut hx.w.terrain.damage, *victim, *amount);
    }
}
pub(crate) fn clear_slips(hx: &mut Hx, _: &HookArgs) {
    for i in 0..hx.w.fighter_count() {
        terrain::clear_slip(&mut hx.w.core_mut(FighterIx::of_slot(i)).motion.slip);
    }
}
pub(crate) fn raid_started(hx: &mut Hx, args: &HookArgs) {
    clear_slips(hx, args);
    terrain::reset_light(&mut hx.w.terrain, hx.w.server_time);
}
use terrain::LIGHT_FX_MS;

/// Admitted actors are regional mobs and players; dummies need the training packet.
pub(crate) fn slip_allowed(_: &World, _: FighterIx) -> bool {
    true
}

#[cfg(test)]
mod source_tests;

#[cfg(test)]
mod native_tests;

#[cfg(test)]
mod arena_tests;

#[cfg(all(test, feature = "trusted-status-probes"))]
mod born_tests;
