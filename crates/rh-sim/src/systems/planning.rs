//! Source planning phase: private deals, reservations, ready latch and exact assignment order.
pub(crate) mod deal;
#[cfg(test)]
mod native_tests;
#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod tests;
mod validation;
pub(crate) mod view;
use crate::{
    events::Event,
    hooks::{self, HookArgs, Hx},
    input::ActionCmd,
    state::{Phase, PlayerId, World},
    statics::MatchStatic,
    systems::Cx,
    Vec2,
};
pub(crate) use validation::validate;
pub use view::{ArenaView, PlanningView, SpawnOptionView};
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanView {
    pub ends_at: f64,
    pub spawns: [i32; 2],
    pub taken: [bool; 2],
    pub pick: i8,
    pub boons: Vec<String>,
    pub boon: i8,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DealState {
    pub(crate) spawns: [i32; 2],
    pub(crate) pick: i8,
    pub(crate) boons: Vec<String>,
    pub(crate) boon: i8,
    pub(crate) sent: Option<PlanView>,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Runtime {
    pub(crate) deals: Vec<(PlayerId, DealState)>,
    pub(crate) holders: Vec<(i32, PlayerId)>,
    pub(crate) report: deal::Report,
    pub(crate) starters: usize,
    pub(crate) started_humans: usize,
}
impl Runtime {
    fn holder(&self, index: i32) -> Option<PlayerId> {
        self.holders
            .iter()
            .find(|(i, _)| *i == index)
            .map(|(_, id)| *id)
    }
    fn deal(&self, id: PlayerId) -> Option<&DealState> {
        self.deals
            .iter()
            .find(|(actor, _)| *actor == id)
            .map(|(_, d)| d)
    }
}
pub(crate) fn enabled(k: &MatchStatic) -> bool {
    k.config
        .lifecycle
        .rules()
        .is_some_and(|r| r.plan_seconds > 0.)
}
pub(crate) fn plan_for(w: &World, id: PlayerId) -> Option<PlanView> {
    if w.phase != Phase::Planning {
        return None;
    }
    let plan = w.planning.as_ref()?;
    let d = plan.deal(id)?;
    Some(PlanView {
        ends_at: w.plan_ends_at,
        spawns: d.spawns,
        taken: std::array::from_fn(|i| plan.holder(d.spawns[i]).is_some_and(|owner| owner != id)),
        pick: d.pick,
        boons: d.boons.clone(),
        boon: d.boon,
    })
}
fn send_changed(w: &mut World, ev: &mut Vec<Event>) {
    let count = w.planning.as_ref().map_or(0, |p| p.deals.len());
    for i in 0..count {
        let id = w.planning.as_ref().unwrap().deals[i].0;
        let Some(view) = plan_for(w, id) else {
            continue;
        };
        let sent = &mut w.planning.as_mut().unwrap().deals[i].1.sent;
        if sent.as_ref() == Some(&view) {
            continue;
        }
        *sent = Some(view.clone());
        ev.push(Event::Plan { to: id, plan: view });
    }
}
pub(crate) fn start(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>) {
    w.phase = Phase::Planning;
    w.plan_ends_at = w.server_time + k.config.lifecycle.rules().unwrap().plan_seconds * 1000.;
    for p in &mut w.players {
        p.plan_ready = false;
        p.inputs.clear();
    }
    let walks = &k.planning_walks;
    let pool = k
        .arena
        .map
        .layers()
        .map_or(&[][..], |l| l.data().spawn_pool.as_slice());
    let result = deal::deal(pool, walks, w.players.len(), &mut || {
        w.reward_rng.next_f64()
    });
    let deals = w
        .players
        .iter()
        .zip(result.pairs)
        .map(|(p, spawns)| {
            (
                p.id,
                DealState {
                    spawns,
                    pick: -1,
                    boons: vec![],
                    boon: -1,
                    sent: None,
                },
            )
        })
        .collect();
    w.planning = Some(Runtime {
        deals,
        holders: vec![],
        report: result.report,
        starters: w.players.len(),
        started_humans: w.players.iter().filter(|p| !p.seat.bot).count(),
    });
    w.rt.started_with = w.players.len() as u32;
    hooks::fire(
        &mut Hx {
            stats: Default::default(),
            fx: None,
            k,
            w,
            ev,
        },
        HookArgs::PlanningStarted,
    );
    ev.push(Event::PlanningStarted);
    send_changed(w, ev);
}
fn apply(w: &mut World, id: PlayerId, spawn: Option<u8>, boon: Option<u8>, ready: Option<bool>) {
    let Some(i) = w.idx(id) else {
        return;
    };
    if w.players[i].plan_ready {
        return;
    }
    let Some(plan) = w.planning.as_mut() else {
        return;
    };
    let Some(di) = plan.deals.iter().position(|(actor, _)| *actor == id) else {
        return;
    };
    if let Some(pick) = spawn.filter(|v| plan.deals[di].1.pick != *v as i8) {
        let want = plan.deals[di].1.spawns[pick as usize];
        if want >= 0 && plan.holder(want).is_none_or(|owner| owner == id) {
            let d = &plan.deals[di].1;
            let had = if d.pick < 0 {
                -1
            } else {
                d.spawns[d.pick as usize]
            };
            if had >= 0 && plan.holder(had) == Some(id) {
                plan.holders.retain(|(i, _)| *i != had);
            }
            if let Some((_, owner)) = plan.holders.iter_mut().find(|(i, _)| *i == want) {
                *owner = id;
            } else {
                plan.holders.push((want, id));
            }
            plan.deals[di].1.pick = pick as i8;
        }
    }
    if let Some(pick) = boon.filter(|v| usize::from(*v) < plan.deals[di].1.boons.len()) {
        plan.deals[di].1.boon = pick as i8;
    }
    if ready == Some(true) {
        w.players[i].plan_ready = true;
    }
}
pub(crate) fn leave(w: &mut World, ev: &mut Vec<Event>, id: PlayerId) {
    if w.phase != Phase::Planning {
        return;
    }
    if let Some(plan) = &mut w.planning {
        plan.deals.retain(|(actor, _)| *actor != id);
        plan.holders.retain(|(_, owner)| *owner != id);
    }
    send_changed(w, ev);
}
pub(crate) fn assign(k: &MatchStatic, w: &World, order: &[PlayerId]) -> Vec<(PlayerId, Vec2)> {
    let Some(plan) = &w.planning else {
        return vec![];
    };
    let Some(layers) = k.arena.map.layers() else {
        return vec![];
    };
    let pool = &layers.data().spawn_pool;
    if pool.is_empty() {
        return vec![];
    }
    let mut out = Vec::with_capacity(order.len());
    let mut used = vec![false; pool.len()];
    let give = |out: &mut Vec<(PlayerId, Vec2)>, used: &mut [bool], id: PlayerId, index: usize| {
        used[index] = true;
        out.push((id, Vec2::new(pool[index].x, pool[index].y)));
    };
    for &id in order {
        if let Some(d) = plan.deal(id) {
            let had = if d.pick < 0 {
                -1
            } else {
                d.spawns[d.pick as usize]
            };
            if had >= 0 && plan.holder(had) == Some(id) {
                give(&mut out, &mut used, id, had as usize);
            }
        }
    }
    let walks = &k.planning_walks;
    let finite = |index: i32| {
        if index < 0 {
            0.
        } else {
            walks.get(index as usize).copied().flatten().unwrap_or(0.)
        }
    };
    for &id in order {
        let Some(d) = plan.deal(id) else {
            continue;
        };
        if out.iter().any(|(actor, _)| *actor == id) {
            continue;
        }
        let [a, b] = d.spawns;
        let free = |index: i32| index >= 0 && !used[index as usize] && plan.holder(index).is_none();
        let selected = if free(a) {
            Some(a)
        } else if free(b) {
            Some(b)
        } else {
            let want = (finite(a) + finite(b)) / 2.;
            let mut best = None;
            for i in 0..pool.len() as i32 {
                if free(i)
                    && best.is_none_or(|old| (finite(i) - want).abs() < (finite(old) - want).abs())
                {
                    best = Some(i);
                }
            }
            best.or(if a >= 0 { Some(a) } else { None })
        };
        if let Some(index) = selected {
            give(&mut out, &mut used, id, index as usize);
        }
    }
    out
}
pub(crate) fn update(cx: &mut Cx) {
    if cx.w.rt.voided {
        return;
    }
    cx.s.action_order.clear();
    cx.s.action_order.extend(0..cx.w.players.len() as u32);
    crate::rng::action_order_in_place(cx.k.secrets.order_salt, cx.w.tick, &mut cx.s.action_order);
    for rank in 0..cx.s.action_order.len() {
        let i = cx.s.action_order[rank] as usize;
        let id = cx.w.players[i].id;
        cx.w.players[i].inputs.drain_into(&mut cx.s.drained);
        for index in 0..cx.s.drained.actions.len() {
            if let Some(ActionCmd::Plan { spawn, boon, ready }) =
                cx.s.drained.actions.get(index).copied()
            {
                apply(cx.w, id, spawn, boon, ready);
            }
        }
    }
    send_changed(cx.w, cx.ev);
    let mut connected = 0;
    let mut ready = true;
    for p in &cx.w.players {
        if p.seat.dropped_at.is_none() {
            connected += 1;
            if !p.plan_ready {
                ready = false;
            }
        }
    }
    let last = cx.w.planning.as_ref().is_some_and(|p| p.starters >= 2) && cx.w.players.len() == 1;
    if cx.w.server_time >= cx.w.plan_ends_at || (ready && connected > 0) || last {
        let order: Vec<_> =
            cx.s.action_order
                .iter()
                .map(|slot| cx.w.players[*slot as usize].id)
                .collect();
        let placed = assign(cx.k, cx.w, &order);
        super::lobby::start_raid(cx.k, cx.w, cx.s, cx.ev, &placed);
    }
}
