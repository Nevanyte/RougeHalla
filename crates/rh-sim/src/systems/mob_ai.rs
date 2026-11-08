//! Source mobAI: post-damage decisions queue ordinary validated inputs for the next tick.
use super::Cx;
use crate::{
    constants::*,
    input::RawCommand,
    math::{hypot, wrap_angle},
    mob_runtime::{Brain, BrainMode},
    state::{Status, World},
    statics::MatchStatic,
    PlayerId, Vec2,
};
fn distance(a: Vec2, b: Vec2) -> f64 {
    hypot(a.x - b.x, a.y - b.y)
}
pub(crate) fn enabled(w: &World) -> bool {
    w.mob_runtime.as_ref().is_some_and(|r| r.combat)
}
pub(crate) fn territory(k: &MatchStatic, p: Vec2) -> u32 {
    let x = (p.x / TILE).floor() as i64;
    let y = (p.y / TILE).floor() as i64;
    let m = &k.arena.map;
    if x < 0 || y < 0 || x >= i64::from(m.w) || y >= i64::from(m.h) {
        return 0;
    }
    m.layers()
        .and_then(|l| {
            l.data()
                .territory_grid
                .get((y * i64::from(m.w) + x) as usize)
        })
        .map_or(0, |v| u32::from(*v))
}
fn leash(k: &MatchStatic, camp: u32, home: Vec2, p: Vec2, margin: f64) -> bool {
    let def = k
        .arena
        .map
        .layers()
        .and_then(|l| l.data().camps.get(camp as usize));
    let reach = def
        .filter(|d| d.area > 0 && territory(k, home) == camp + 1)
        .map_or(0., |d| d.radius.min(MOB_LEASH_CAP));
    if reach == 0. {
        return distance(p, home) <= MOB_LEASH_RADIUS - margin;
    }
    if distance(p, home) > reach - margin || territory(k, p) != camp + 1 {
        return false;
    }
    margin <= 0.
        || [
            Vec2::new(p.x + margin, p.y),
            Vec2::new(p.x - margin, p.y),
            Vec2::new(p.x, p.y + margin),
            Vec2::new(p.x, p.y - margin),
        ]
        .into_iter()
        .all(|p| territory(k, p) == camp + 1)
}
pub(crate) fn targetable(w: &World, id: PlayerId) -> bool {
    w.player(id).is_some_and(|p| {
        p.standing() && !crate::status_runtime::untargetable(&p.statuses.instances, w.server_time)
    })
}
fn pick(w: &World, b: &mut Brain) -> Option<PlayerId> {
    b.threat
        .retain(|(id, _)| w.player(*id).is_some_and(|p| p.standing()));
    let mut most = 0.;
    let mut best = None;
    for &(id, threat) in &b.threat {
        if threat > most && targetable(w, id) {
            most = threat;
            best = Some(id);
        }
    }
    best
}
pub(crate) fn wake(b: &mut Brain, target: PlayerId, now: f64) {
    b.mode = BrainMode::Fight;
    b.target = Some(target);
    b.last_combat_at = now;
    b.goal = None;
    b.moving = false;
    b.holding = false;
}
pub(crate) fn add_threat(b: &mut Brain, id: PlayerId, amount: f64) {
    if let Some((_, v)) = b.threat.iter_mut().find(|(p, _)| *p == id) {
        *v += amount
    } else {
        b.threat.push((id, amount));
    }
}
/// Returns a camp-wide wake request. A ledger caller settles these after the complete pass.
pub(crate) fn aggro(
    w: &mut World,
    id: PlayerId,
    by: PlayerId,
    amount: f64,
) -> Option<(u32, PlayerId)> {
    if amount <= 0. || w.player(by).is_none() {
        return None;
    }
    let m = w.mobs.get_mut(id)?;
    if m.status != Status::Alive || m.kind == crate::mob_runtime::MobKind::Dummy {
        // A dummy has no runtime brain in the source (mobs.addMob stores none), so it never aggros or fights.
        return None;
    }
    let camp = m.camp;
    let mut b = std::mem::take(&mut m.brain);
    add_threat(&mut b, by, amount);
    if b.mode == BrainMode::Idle {
        if let Some(target) = pick(w, &mut b) {
            wake(&mut b, target, w.server_time);
        }
    }
    let out = (b.mode == BrainMode::Fight)
        .then_some(b.target)
        .flatten()
        .filter(|t| targetable(w, *t))
        .map(|t| (camp, t));
    w.mobs.get_mut(id).expect("no structural mutation").brain = b;
    out
}
pub(crate) fn wake_mates(w: &mut World, camp: u32, target: PlayerId) {
    if !targetable(w, target) {
        return;
    }
    let now = w.server_time;
    for m in &mut w.mobs {
        if m.camp == camp
            && m.status == Status::Alive
            && m.kind != crate::mob_runtime::MobKind::Dummy
            && m.brain.mode == BrainMode::Idle
        {
            if !m.brain.threat.iter().any(|(id, _)| *id == target) {
                m.brain.threat.push((target, 0.));
            }
            wake(&mut m.brain, target, now);
        }
    }
}
fn due(b: &Brain, phase: u32, now: f64) -> bool {
    b.goal.is_none()
        || (now - b.last_move_at >= MOB_REPATH_PHASE_PERIOD as f64
            && ((now + f64::from(phase)) / f64::from(MOB_REPATH_PHASE_PERIOD)).floor()
                != ((now - TICK_MS + f64::from(phase)) / f64::from(MOB_REPATH_PHASE_PERIOD))
                    .floor())
}
fn send(cx: &mut Cx, id: PlayerId, b: &mut Brain, to: Vec2) {
    cx.propose(
        id,
        RawCommand::Move {
            x: to.x,
            y: to.y,
            seq: None,
        },
    )
    .expect("finite source mob move");
    b.goal = Some(to);
    b.last_move_at = cx.w.server_time;
    b.moving = true;
}
fn disarm(cx: &mut Cx, id: PlayerId, b: &mut Brain) {
    let now = cx.w.server_time;
    let m = cx.w.mobs.get_mut(id).unwrap();
    super::weapons::cancel_action(&mut m.core, now);
    m.core.weapon.held = false;
    m.core.weapon.buffered_until = 0.;
    m.core.weapon.aim_at = 0.;
    b.holding = false;
}
fn home(cx: &mut Cx, id: PlayerId, b: &mut Brain) {
    let m = cx.w.mobs.get(id).unwrap();
    let at = m.core.pos();
    let home = m.home;
    let phase = m.repath_phase;
    let facing = m.home_facing;
    if distance(at, home) > MOB_HOME_RADIUS {
        if due(b, phase, cx.w.server_time) {
            send(cx, id, b, home)
        }
        return;
    }
    let end = m.core.motion.path.as_slice().last().copied();
    disarm(cx, id, b);
    if end.is_none_or(|p| distance(p, home) > MOB_HEADING_HOME) {
        if distance(at, home) > MOB_ON_SPOT {
            cx.propose(
                id,
                RawCommand::Move {
                    x: home.x,
                    y: home.y,
                    seq: None,
                },
            )
            .unwrap();
        } else if end.is_some() {
            cx.propose(id, RawCommand::Stop { seq: None }).unwrap();
        }
    }
    cx.propose(id, RawCommand::Aim { a: facing }).unwrap();
    b.last_aim = Some(facing);
    let m = cx.w.mobs.get_mut(id).unwrap();
    m.core.vitals.hp = m.core.vitals.max_hp;
    b.mode = BrainMode::Idle;
    b.target = None;
    b.threat.clear();
    b.goal = None;
    b.moving = false;
}
fn give_up(cx: &mut Cx, id: PlayerId, b: &mut Brain) {
    disarm(cx, id, b);
    b.mode = BrainMode::Return;
    b.target = None;
    b.threat.clear();
    b.goal = None;
    home(cx, id, b);
}
pub(crate) fn think(cx: &mut Cx) {
    if !enabled(cx.w) {
        return;
    }
    // Event reads do not submit actions; the shared Block event wakes an idle shield holder.
    for i in 0..cx.ev.len() {
        if let crate::events::Event::Block { id, by, .. } = cx.ev[i] {
            if cx.w.mobs.get(id).is_some_and(|m| {
                m.kind != crate::mob_runtime::MobKind::Dummy && m.brain.mode == BrainMode::Idle
            }) {
                if let Some((camp, target)) = aggro(cx.w, id, by, 1.) {
                    wake_mates(cx.w, camp, target);
                }
            }
        }
    }
    for i in 0..cx.w.mobs.len() {
        let m = &cx.w.mobs[i];
        if m.status != Status::Alive
            || m.kind == crate::mob_runtime::MobKind::Dummy
            || m.brain.mode == BrainMode::Idle
            || crate::status_runtime::has(
                &m.core.statuses.instances,
                crate::status_runtime::StatusKind::Stun,
                cx.w.server_time,
            )
        {
            continue;
        }
        let id = m.core.id;
        let mut b = std::mem::take(&mut cx.w.mobs[i].brain);
        if cx.w.mobs[i].core.motion.path.is_empty() {
            b.moving = false;
        }
        if b.mode == BrainMode::Return {
            home(cx, id, &mut b)
        } else {
            fight(cx, id, &mut b)
        }
        cx.w.mobs.get_mut(id).unwrap().brain = b;
    }
}
fn fight(cx: &mut Cx, id: PlayerId, b: &mut Brain) {
    let now = cx.w.server_time;
    let m = cx.w.mobs.get(id).unwrap();
    let camp = m.camp;
    let home = m.home;
    let phase = m.repath_phase;
    let from = m.core.pos();
    let weapon = m.core.active_weapon();
    b.holding = m.core.weapon.held;
    if !leash(cx.k, camp, home, from, 0.) || now - b.last_combat_at >= MOB_GIVE_UP_SECONDS * 1000. {
        give_up(cx, id, b);
        return;
    }
    if b.target.is_none_or(|t| !targetable(cx.w, t)) {
        b.target = pick(cx.w, b);
        b.goal = None;
    }
    let Some(target) = b.target.and_then(|t| cx.w.player(t)) else {
        give_up(cx, id, b);
        return;
    };
    let at = target.pos();
    let vel = super::targeting::velocity(target, now);
    let ix = cx.w.fighter_idx(id).unwrap();
    let sheet = cx.w.paced_sheet(ix);
    let tm = crate::content::npc_timings(
        weapon,
        crate::content::attack_interval(&sheet, weapon, cx.w.core(ix).modifiers.mirrors().as_mult),
    );
    let mask = if matches!(
        crate::content::weapon(weapon).shape,
        crate::content::Shape::Arc { .. }
    ) {
        MASK_MELEE
    } else {
        MASK_SIGHT
    };
    let out = crate::combat_policy::decide(
        crate::combat_policy::Input {
            from,
            to: at,
            vel,
            los: crate::geometry::has_line_of_sight(
                cx.k.collision_map(cx.w.rt.gates_locked),
                from,
                at,
                mask,
            ),
            weapon,
            windup: tm.windup,
            lock: false,
            delay: TICK_MS / 1000.,
        },
        |a, to| {
            leash(cx.k, camp, home, to, MOB_LEASH_MARGIN)
                && distance(to, at) > distance(a, at)
                && crate::geometry::segment_clear(
                    cx.k.collision_map(cx.w.rt.gates_locked),
                    a,
                    to,
                    PLAYER_RADIUS,
                    MASK_MOVE,
                )
        },
    );
    if b.last_aim
        .is_none_or(|a| wrap_angle(out.aim - a).abs() >= MOB_AIM_DEADBAND)
    {
        cx.propose(id, RawCommand::Aim { a: out.aim }).unwrap();
        b.last_aim = Some(out.aim);
    }
    if out.hold && !b.holding {
        cx.propose(
            id,
            RawCommand::Attack {
                a: out.aim,
                t: None,
            },
        )
        .unwrap();
        b.last_aim = Some(out.aim);
        b.holding = true;
    } else if !out.hold && b.holding {
        cx.propose(
            id,
            RawCommand::Release {
                a: out.aim,
                t: None,
            },
        )
        .unwrap();
        b.last_aim = Some(out.aim);
        b.holding = false;
    }
    match out.movement {
        crate::combat_policy::Move::Stop => {
            if b.moving {
                cx.propose(id, RawCommand::Stop { seq: None }).unwrap();
                b.moving = false;
            }
        }
        crate::combat_policy::Move::Point(to) => {
            if due(b, phase, now) {
                send(cx, id, b, to)
            }
        }
    }
}
