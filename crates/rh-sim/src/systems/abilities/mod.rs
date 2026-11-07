//! Actual Cast intake and atomic, current-combat-rank landing.
use super::Cx;
use crate::{
    abilities::{self as a, Target},
    events::Event,
    fighter::FighterIx,
    input::ActionCmd,
    status_runtime::{self as rt, AbilityId, CastFact},
    PlayerId, Vec2,
};
#[derive(Clone, Copy, Debug)]
pub(crate) struct Landing {
    pub id: PlayerId,
    pub cast: CastFact,
    pub origin: Vec2,
    pub to: Option<Vec2>,
}
fn unit_valid(cx: &Cx, ix: FighterIx, target: PlayerId, range: f64) -> bool {
    let Some(j) = cx.w.fighter_idx(target) else {
        return false;
    };
    let c = cx.w.core(ix);
    let t = cx.w.core(j);
    let now = cx.w.server_time;
    if c.id == target
        || !cx.w.standing(j)
        || rt::untargetable(&t.statuses.instances, now)
        || (cx.w.is_player(j) && now < t.vitals.immune_until)
    {
        return false;
    }
    let viewer = &cx.w.players[ix.slot()];
    let map = cx.k.collision_view(cx.w.rt.gates_locked);
    let visible = if cx.w.is_player(j) {
        crate::vision::gameplay_actor_visible(map, viewer, &cx.w.players[j.slot()], cx.w.tick)
    } else {
        crate::vision::point_visible(map, viewer, t.pos(), cx.w.tick)
    };
    visible
        && crate::math::hypot(t.body.x - c.body.x, t.body.y - c.body.y) <= range + a::RANGE_SLACK
        && crate::geometry::has_line_of_sight(
            map.current(),
            c.pos(),
            t.pos(),
            crate::map::MASK_SIGHT,
        )
}
fn blink(cx: &Cx, from: Vec2, point: Vec2) -> Option<Vec2> {
    a::blink::landing(
        &cx.k.arena.map,
        cx.k.collision_map(cx.w.rt.gates_locked),
        &cx.k.blink_ring,
        cx.w.rt.gates_locked,
        from,
        point,
    )
}
pub(crate) fn handle(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    let ActionCmd::Cast {
        slot,
        x,
        y,
        id,
        t,
        seq,
    } = *cmd
    else {
        return;
    };
    if !cx.w.is_player(ix) {
        return;
    }
    if let Some(seq) = seq {
        cx.w.players[ix.slot()].motion.move_seq = seq;
    }
    if cx.k.config.abilities != a::Mode::Full
        || cx.w.phase != crate::Phase::Active
        || !cx.w.standing(ix)
    {
        return;
    }
    let now = cx.w.server_time;
    let p = &cx.w.players[ix.slot()];
    // One generic slot path: the table says what each slot casts (Q/E have no rows yet). No branch on an ability id.
    let Some(ability) = a::ability_in_slot(slot, p.vitals.faction) else {
        return;
    };
    let def = a::definition(ability);
    if cx
        .w
        .abilities
        .as_ref()
        .and_then(|a| a.teleported_at)
        .is_some_and(|at| now - at < a::TELEPORT_GRACE_MS)
        || rt::cast_blocked(&p.statuses, now, a::CANCELLED_BY)
        || p.statuses.cast.is_some()
        || now < p.stocks.ready_at(slot)
    {
        return;
    }
    let point = Vec2::new(x, y);
    let target = match def.target {
        Target::Unit(range) => {
            let Some(id) = id.filter(|id| unit_valid(cx, ix, *id, range)) else {
                return;
            };
            Some(id)
        }
        Target::Point => {
            if blink(cx, p.pos(), point).is_none() {
                return;
            }
            None
        }
        Target::Self_ => None,
    };
    // Commit remembered vision only after a legitimate target passes the prospective view.
    if target.is_some() {
        crate::vision::refresh_player(
            &mut cx.w.players[ix.slot()],
            cx.w.tick,
            cx.w.rt.gates_locked,
        );
    }
    let face = target
        .and_then(|id| cx.w.fighter_idx(id))
        .map(|j| cx.w.core(j).pos())
        .or_else(|| matches!(def.target, Target::Point).then_some(point));
    let p = &mut cx.w.players[ix.slot()];
    let previous_ready_at = p.stocks.ready_at(slot);
    let previous_full_at = p.stocks.wish_full_at;
    let cooldown = a::cooldown(ability, false, Some(p.modifiers.wish_cooldown_mult()));
    let (full, ready) = a::spend_charge(
        if def.charges > 1 {
            previous_full_at.unwrap_or(0.)
        } else {
            0.
        },
        now,
        def.charges,
        cooldown,
    );
    p.stocks.wish_full_at = Some(full);
    p.stocks.wish_ready_at = ready;
    p.card_runtime
        .get_or_insert_with(Default::default)
        .wish_cast = Some(crate::cards::runtime::WishSpend {
        at: now,
        cooldown_ms: cooldown,
    });
    let cast = CastFact {
        ability,
        started_at: now,
        lands_at: now + def.cast_ms,
        cancelled_by: a::CANCELLED_BY,
        producer: Some(a::CastDetail {
            rank: 1,
            slot,
            target,
            point,
            previous_ready_at,
            previous_full_at,
            lag_ms: (now - t.unwrap_or(now))
                .clamp(crate::constants::TICK_MS, crate::constants::MAX_REWIND_MS),
        }),
    };
    p.statuses.cast = Some(cast);
    crate::hooks::cast_accepted(cx.k, cx.w, cx.ev, cx.w.core(ix).id, ability);
    let p = &mut cx.w.players[ix.slot()];
    if let Some(face) = face {
        if crate::math::hypot(face.x - p.body.x, face.y - p.body.y) >= 1. {
            p.body.facing = crate::math::atan2(face.y - p.body.y, face.x - p.body.x);
        }
    }
    if def.cast_ms > 0. || def.own_order || def.drops_lock {
        super::weapons::cancel_locked(p, now, cx.ev);
        if p.weapon.action.is_some() {
            super::weapons::cancel_action(p, now);
            cx.ev.push(Event::AttackCancelled { id: p.id });
        }
        if def.own_order || def.drops_lock {
            super::targeting::drop_lock(p);
        }
        if def.own_order {
            p.motion.path.clear();
        }
    }
    if def.cast_ms > 0. {
        let at = face.unwrap_or(p.pos());
        cx.ev.push(Event::CastStarted {
            id: p.id,
            ability,
            ms: def.cast_ms,
            target,
            x: at.x,
            y: at.y,
        });
    }
    rt::reveal(&mut p.statuses, now, cast.lands_at + rt::HIDDEN_REVEAL_MS);
    crate::vision::cast_exposure(cx.k, p, now, cast.lands_at);
    p.statuses.refresh_effects(now);
}
pub(crate) fn land(cx: &mut Cx) {
    cx.s.cast_landings.clear();
    if cx.k.config.abilities != a::Mode::Full {
        return;
    }
    let now = cx.w.server_time;
    // action_order is this landing tick's combat priority, never the stored ability rank.
    for n in 0..cx.s.action_order.len() {
        let ix = FighterIx::of_slot(cx.s.action_order[n] as usize);
        let Some(cast) =
            cx.w.core(ix)
                .statuses
                .cast
                .filter(|c| c.producer.is_some() && c.lands_at <= now)
        else {
            continue;
        };
        let detail = cast.producer.unwrap();
        let def = a::definition(cast.ability);
        let id = cx.w.core(ix).id;
        let mut ok =
            cx.w.standing(ix) && !rt::cast_blocked(&cx.w.core(ix).statuses, now, a::CANCELLED_BY);
        if let Target::Unit(range) = def.target {
            ok = ok && detail.target.is_some_and(|t| unit_valid(cx, ix, t, range));
        }
        let origin = cx.w.core(ix).pos();
        let to = if ok && def.target == Target::Point {
            blink(cx, origin, detail.point)
        } else {
            None
        };
        if def.target == Target::Point && to.is_none() {
            ok = false;
        }
        if !ok {
            super::status::cancel_cast(cx.k, cx.w, cx.ev, id, rt::CastEndReason::Fizzle, false);
            continue;
        }
        cx.s.cast_landings.push(Landing {
            id,
            cast,
            origin,
            to,
        });
    }
    for l in &cx.s.cast_landings {
        if let Some(ix) = cx.w.fighter_idx(l.id) {
            cx.w.core_mut(ix).statuses.cast = None;
            cx.w.core_mut(ix).statuses.refresh_effects(now);
        }
    }
    for i in 0..cx.s.cast_landings.len() {
        let l = cx.s.cast_landings[i];
        effects::self_effects(cx, l);
    }
    for i in 0..cx.s.cast_landings.len() {
        let l = cx.s.cast_landings[i];
        effects::target_effects(cx, l);
    }
    for i in 0..cx.s.cast_landings.len() {
        let l = cx.s.cast_landings[i];
        let target = l.cast.producer.unwrap().target;
        let at = if l.to.is_some() {
            l.origin
        } else {
            target
                .and_then(|id| cx.w.fighter_idx(id))
                .or_else(|| cx.w.fighter_idx(l.id))
                .map(|ix| cx.w.core(ix).pos())
                .unwrap_or(l.origin)
        };
        cx.ev.push(Event::CastLanded {
            id: l.id,
            ability: l.cast.ability,
            target: if l.to.is_some() { None } else { target },
            x: at.x,
            y: at.y,
            to: l.to,
        });
        crate::hooks::cast_ended(
            cx.k,
            cx.w,
            cx.ev,
            l.id,
            l.cast.ability,
            crate::hooks::CastOutcome::Landed,
        );
    }
    cx.s.cast_landings.clear();
}
mod effects;
