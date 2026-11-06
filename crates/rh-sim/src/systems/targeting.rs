//! Authoritative wand lock and point orders. Scene discovery admits a target, but attacking
//! still requires a clear physical ray. Only the actor's own input and gameplay phases update vision.
use super::{weapons, Cx};
use crate::constants::*;
use crate::content::{attack_interval, paced, player_timings, weapon, Shape, WeaponId};
use crate::fighter::{FighterCore, FighterIx};
use crate::geometry::has_line_of_sight;
use crate::input::ActionCmd;
use crate::math::{atan2, hypot, sqrt, wrap_angle, Vec2};
use crate::pathfind::plan_path_into;
use crate::{PlayerId, TileMap};

fn distance(a: Vec2, b: Vec2) -> f64 {
    hypot(a.x - b.x, a.y - b.y)
}
fn wand_shape() -> (f64, f64) {
    let Shape::Projectile { range, speed } = weapon(WeaponId::Wand).shape else {
        unreachable!("wand catalog shape")
    };
    (range, speed)
}

pub(super) fn drop_lock(p: &mut FighterCore) {
    let lock = &mut p.weapon.targeting;
    if lock.target.take().is_some() {
        lock.seen = false;
        lock.lost_at = None;
        lock.goal = None;
        p.weapon.held = false;
        p.weapon.buffered_until = 0.;
        p.motion.path.clear();
    }
}
fn set_lock(p: &mut FighterCore, id: PlayerId) {
    let lock = &mut p.weapon.targeting;
    lock.target = Some(id);
    lock.seen = false;
    lock.lost_at = None;
    lock.goal = None;
}

fn lockable(cx: &mut Cx, i: usize, j: usize) -> bool {
    let viewer = &cx.w.players[i];
    let other = &cx.w.players[j];
    if i == j
        || !other.standing()
        || crate::status_runtime::untargetable(&other.statuses.instances, cx.w.server_time)
        || !crate::vision::gameplay_actor_visible(&cx.k.arena.map, viewer, other, cx.w.tick)
    {
        return false;
    }
    let within = distance(viewer.pos(), other.pos()) <= TARGET_RANGE;
    crate::vision::refresh_player(&mut cx.w.players[i], cx.w.tick);
    within
}
fn plan(cx: &mut Cx, i: usize, goal: Vec2) -> bool {
    plan_path_into(
        cx.pf,
        &cx.k.arena.map,
        cx.w.players[i].pos(),
        goal,
        &mut cx.s.path,
    );
    !cx.s.path.is_empty()
}
fn fresh(at: Option<f64>, now: f64) -> bool {
    at.is_none_or(|last| now - last >= TARGET_REPATH_MS)
}

pub(crate) fn target(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    let ActionCmd::Target { id } = *cmd else {
        return;
    };
    let Some(j) = cx.w.idx(id) else {
        return;
    };
    let i = ix.slot();
    if !lockable(cx, i, j) || cx.w.players[i].active_weapon() != WeaponId::Wand {
        return;
    }
    let now = cx.w.server_time;
    let goal = cx.w.players[j].pos();
    let p = &mut cx.w.players[i];
    if p.weapon.targeting.target == Some(id) {
        p.weapon.targeting.attack_move = None;
        return;
    }
    let due = fresh(p.weapon.targeting.search_at, now);
    let behind = !has_line_of_sight(&cx.k.arena.map, p.pos(), goal, MASK_SIGHT);
    if behind {
        if !due {
            return;
        }
        p.weapon.targeting.search_at = Some(now);
        if !plan(cx, i, goal) {
            return;
        }
    }
    let p = &mut cx.w.players[i];
    if p.weapon.action.and_then(|a| a.target) != Some(id) {
        weapons::cancel_locked(p, now, cx.ev);
    }
    p.weapon.targeting.attack_move = None;
    set_lock(p, id);
    if behind {
        p.motion.path.set_from(&cx.s.path);
        p.weapon.targeting.plan_at = Some(now);
        p.weapon.targeting.goal = Some(goal);
    } else {
        p.motion.path.clear();
        if due {
            p.weapon.targeting.search_at = Some(now);
            p.weapon.targeting.plan_at = None;
        }
    }
    p.weapon.held = false;
    p.weapon.buffered_until = 0.;
}

fn acquire(cx: &mut Cx, i: usize, goal: Vec2) {
    let p = &cx.w.players[i];
    if !p.standing() || p.active_weapon() != WeaponId::Wand {
        return;
    }
    let from = p.pos();
    let range = wand_shape().0 * LOCK_ATTACK_SHARE;
    let mut best: Option<(f64, f64, PlayerId)> = None;
    for j in 0..cx.w.players.len() {
        let other = &cx.w.players[j];
        let at = other.pos();
        let id = other.id;
        let d = distance(from, at);
        if d > range
            || !lockable(cx, i, j)
            || !has_line_of_sight(&cx.k.arena.map, from, at, MASK_SIGHT)
        {
            continue;
        }
        let rank = (d, distance(goal, at), id);
        if best.is_none_or(|b| rank < b) {
            best = Some(rank);
        }
    }
    if let Some((_, _, id)) = best {
        let p = &mut cx.w.players[i];
        weapons::cancel_locked(p, cx.w.server_time, cx.ev);
        set_lock(p, id);
        p.weapon.targeting.plan_at = None;
        p.weapon.held = false;
        p.weapon.buffered_until = 0.;
    }
}
fn point_route(cx: &mut Cx, i: usize, goal: Vec2) {
    if plan(cx, i, goal) || distance(cx.w.players[i].pos(), goal) <= ATTACK_MOVE_ARRIVAL {
        cx.w.players[i].motion.path.set_from(&cx.s.path);
    } else {
        cx.w.players[i].weapon.targeting.attack_move = None;
    }
}
fn resume(cx: &mut Cx, i: usize) {
    let p = &mut cx.w.players[i];
    drop_lock(p);
    if let Some(goal) = p.weapon.targeting.attack_move {
        point_route(cx, i, goal);
    }
}
fn sealed(map: &TileMap, from: Vec2, to: Vec2) -> bool {
    let comp = |p: Vec2| {
        let x = (p.x / TILE).floor() as i64;
        let y = (p.y / TILE).floor() as i64;
        if x < 0 || y < 0 || x >= i64::from(map.w) || y >= i64::from(map.h) {
            return None;
        }
        let n = map.comp(y as usize * map.w as usize + x as usize);
        (n >= 0).then_some(n)
    };
    comp(from).zip(comp(to)).is_some_and(|(a, b)| a != b)
}
fn chase(cx: &mut Cx, i: usize, goal: Vec2, seen: bool) -> bool {
    let p = &mut cx.w.players[i];
    let has_path = !p.motion.path.is_empty();
    let moved = p
        .weapon
        .targeting
        .goal
        .is_none_or(|old| distance(old, goal) > TARGET_GOAL_MOVED);
    if (!moved && has_path) || !fresh(p.weapon.targeting.plan_at, cx.w.server_time) {
        return true;
    }
    let lock = &mut p.weapon.targeting;
    lock.plan_at = Some(cx.w.server_time);
    lock.goal = Some(goal);
    if plan(cx, i, goal) {
        cx.w.players[i].motion.path.set_from(&cx.s.path);
    } else if !seen || sealed(&cx.k.arena.map, cx.w.players[i].pos(), goal) {
        resume(cx, i);
        return false;
    }
    true
}

fn velocity(p: &FighterCore, now: f64) -> Vec2 {
    let history = p.body.history.as_slice();
    let end = history.last().map_or(now, |s| s.t);
    let start = (end - VELOCITY_WINDOW_MS).max(history.first().map_or(end, |s| s.t));
    if end <= start {
        return Vec2::new(0., 0.);
    }
    let before = p.position_at(start);
    let dt = (end - start) / 1000.;
    Vec2::new((p.body.x - before.x) / dt, (p.body.y - before.y) / dt)
}
// Shared policies.ts project() with a stationary shooter and no client lag; a chaser stops at contact.
fn projected(from: Vec2, to: Vec2, v: Vec2, windup: f64) -> Vec2 {
    let (x, y) = (to.x - from.x, to.y - from.y);
    let a = v.x * v.x + v.y * v.y;
    let b = x * v.x + y * v.y;
    let c = x * x + y * y - LOCK_CONTACT * LOCK_CONTACT;
    let mut t = windup;
    if b < 0. && a > 0. {
        let disc = b * b - a * c;
        if c <= 0. {
            t = 0.;
        } else if disc >= 0. {
            t = t.min(((-b - sqrt(disc)) / a).max(0.));
        }
    }
    Vec2::new(to.x + v.x * t, to.y + v.y * t)
}
fn intercept(x: f64, y: f64, v: Vec2, speed: f64) -> f64 {
    let a = v.x * v.x + v.y * v.y - speed * speed;
    let b = 2. * (x * v.x + y * v.y);
    let c = x * x + y * y;
    if a.abs() < LOCK_INTERCEPT_EPS {
        return if b < 0. { -c / b } else { -1. };
    }
    let disc = b * b - 4. * a * c;
    if disc < 0. {
        return -1.;
    }
    let r = sqrt(disc);
    let (a, b) = ((-b - r) / (2. * a), (-b + r) / (2. * a));
    if a.min(b) > 0. {
        a.min(b)
    } else {
        a.max(b)
    }
}
fn follow(cx: &mut Cx, i: usize, id: PlayerId) {
    let Some(j) = cx.w.idx(id) else {
        resume(cx, i);
        return;
    };
    let p = &cx.w.players[i];
    if !p.standing() || p.active_weapon() != WeaponId::Wand || !lockable(cx, i, j) {
        resume(cx, i);
        return;
    }
    let now = cx.w.server_time;
    let to = cx.w.players[j].pos();
    let from = cx.w.players[i].pos();
    let seen = has_line_of_sight(&cx.k.arena.map, from, to, MASK_SIGHT);
    let p = &mut cx.w.players[i];
    let lock = &mut p.weapon.targeting;
    if seen {
        lock.seen = true;
        lock.lost_at = None;
    } else if lock.seen && now - *lock.lost_at.get_or_insert(now) >= TARGET_LOS_GRACE_MS {
        resume(cx, i);
        return;
    }
    let faction = paced(p.vitals.faction);
    let tm = player_timings(
        WeaponId::Wand,
        attack_interval(&faction, WeaponId::Wand, 1.0),
    );
    let vel = velocity(&cx.w.players[j], now);
    let hit = projected(from, to, vel, tm.windup);
    let (range, speed) = wand_shape();
    let (dx, dy) = (hit.x - from.x, hit.y - from.y);
    let t = intercept(dx, dy, vel, speed);
    let (aim, reach) = if t > 0. {
        (atan2(dy + vel.y * t, dx + vel.x * t), t * speed)
    } else {
        (atan2(dy, dx), hypot(dx, dy))
    };
    if !seen || distance(from, to) > range * LOCK_FAR_SHARE {
        if !chase(cx, i, to, seen) {
            return;
        }
    } else {
        cx.w.players[i].motion.path.clear();
    }
    let p = &mut cx.w.players[i];
    let hold = seen && reach <= range * LOCK_ATTACK_SHARE;
    if hold && !p.weapon.held {
        p.weapon.pressed_at = now;
    }
    p.weapon.held = hold;
    p.weapon.lag_ms = TICK_MS;
    p.weapon.aim = aim;
    p.weapon.aim_at = now;
    if wrap_angle(aim - p.body.facing).abs() >= MOB_AIM_DEADBAND {
        p.body.facing = aim;
    }
}

pub(crate) fn update(cx: &mut Cx) {
    for i in 0..cx.w.players.len() {
        let lock = cx.w.players[i].weapon.targeting;
        if let Some(goal) = lock.attack_move.filter(|_| lock.target.is_none()) {
            acquire(cx, i, goal);
        }
        let p = &cx.w.players[i];
        if let Some(target) = p.weapon.targeting.target {
            follow(cx, i, target);
        } else if let Some(goal) = p
            .weapon
            .targeting
            .attack_move
            .filter(|_| p.motion.path.is_empty())
        {
            if distance(p.pos(), goal) <= ATTACK_MOVE_ARRIVAL {
                cx.w.players[i].weapon.targeting.attack_move = None;
            } else {
                point_route(cx, i, goal);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Arena, FactionId, ItemObserver, Observation, Placement, PublicCommand, RawCommand, Reject,
        Secrets, Sim, SimConfig,
    };
    fn place(x: f64, y: f64) -> Placement {
        Placement {
            profile: "test".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(x, y),
            hp: None,
            weapon0: Some(WeaponId::Wand),
            weapon1: None,
        }
    }
    fn open() -> Arena {
        Arena {
            map: TileMap::new(118, 52, vec![0; 118 * 52]).unwrap(),
            spawns: vec![],
        }
    }
    fn issue(s: &mut Sim, id: PlayerId, raw: RawCommand) {
        s.submit(id, crate::validate(raw).unwrap()).unwrap();
    }

    #[test]
    fn probing_a_hidden_or_absent_id_cannot_shift_an_odd_phase_movers_discovery() {
        let viewer = PlayerId(2);
        let roster = [
            place(3640., 768.),
            place(1200., 768.),
            place(3320., 768.),
            place(3320., 768.),
        ];
        let mut a = Sim::reset_active(SimConfig::default(), open(), Secrets::from_seed(9), &roster);
        let mut b = a.clone();
        a.remove_player(PlayerId(4));
        b.remove_player(PlayerId(3));
        for tick in 2..=605 {
            for s in [&mut a, &mut b] {
                if tick == 2 {
                    issue(
                        s,
                        viewer,
                        RawCommand::Move {
                            x: 160.,
                            y: 768.,
                            seq: None,
                        },
                    );
                }
                if tick == 5 {
                    issue(s, viewer, RawCommand::Target { id: PlayerId(3) });
                }
                s.step();
            }
            assert_eq!(
                a.player(viewer).unwrap().vision,
                b.player(viewer).unwrap().vision,
                "tick {tick}"
            );
            assert_eq!(
                crate::observe(&a, viewer, &[]),
                crate::observe(&b, viewer, &[])
            );
            if tick == 604 {
                assert!(!a.can_see_point(viewer, Vec2::new(1712., 48.)));
                for y in 0..52 {
                    for x in 0..118 {
                        let at = Vec2::new((x as f64 + 0.5) * TILE, (y as f64 + 0.5) * TILE);
                        assert_eq!(a.can_see_point(viewer, at), b.can_see_point(viewer, at));
                    }
                }
            }
        }
    }

    #[test]
    fn visible_refusals_still_take_the_due_pre_movement_sample() {
        for (weapon, target_x) in [(WeaponId::Wand, 1841.), (WeaponId::Sword, 1500.)] {
            let mut viewer = place(1200., 768.);
            viewer.weapon0 = Some(weapon);
            let mut s = Sim::reset_active(
                SimConfig::default(),
                open(),
                Secrets::from_seed(3),
                &[place(3640., 768.), viewer, place(target_x, 768.)],
            );
            let id = PlayerId(2);
            // Phase 1 samples at tick 3. Tick 5 is due; input precedes the viewer's movement.
            issue(
                &mut s,
                id,
                RawCommand::Move {
                    x: 160.,
                    y: 768.,
                    seq: None,
                },
            );
            while s.tick() < 4 {
                s.step();
            }
            let before = s.player(id).unwrap().pos();
            issue(&mut s, id, RawCommand::Target { id: PlayerId(3) });
            s.step();
            let p = s.player(id).unwrap();
            assert!(p.weapon.targeting.target.is_none());
            let tape = serde_json::to_value(&p.vision).unwrap();
            let last = tape["reveals"].as_array().unwrap().last().unwrap();
            assert_eq!(last["tick"], 5);
            assert_eq!(last["origin"], serde_json::to_value(before).unwrap());
            assert_ne!(before, p.pos());
        }
    }

    #[test]
    fn public_actor_admission_requires_a_delivered_view_and_current_sight() {
        let mut s = Sim::reset_active(
            SimConfig::default(),
            open(),
            Secrets::from_seed(1),
            &[place(400., 320.), place(600., 320.), place(3600., 320.)],
        );
        let id = PlayerId(1);
        let foe = PlayerId(2);
        let target = PublicCommand::Target { actor: foe };
        let mut seat = ItemObserver::new(id);
        let mut out = Observation::default();
        let missing = crate::validate(RawCommand::MissingTarget).unwrap();
        assert_eq!(
            seat.resolve(&s, PublicCommand::Target { actor: PlayerId(0) }),
            Err(Reject::InvalidTarget)
        );
        let staged = seat.prepare_into(&s, &[], &mut out, None).unwrap();
        drop(staged);
        assert_eq!(seat.resolve(&s, target), Ok(missing));
        seat.observe_into(&s, &[], &mut out, None).unwrap();
        assert_eq!(
            seat.resolve(&s, target),
            crate::validate(RawCommand::Target { id: foe })
        );
        for probe in [PlayerId(3), PlayerId(5)] {
            assert_eq!(
                seat.resolve(&s, PublicCommand::Target { actor: probe }),
                Ok(missing)
            );
        }
        seat.reconnect();
        assert_eq!(seat.resolve(&s, target), Ok(missing));
        seat.observe_into(&s, &[], &mut out, None).unwrap();
        s.remove_player(foe);
        assert_eq!(seat.resolve(&s, target), Ok(missing));
    }
    #[test]
    fn an_autonomous_scan_cannot_renew_vision_from_a_concealed_bush_occupant() {
        let file: crate::mapdata::MapExport =
            serde_json::from_str(include_str!("../mapdata/fixtures/seed1.map.json")).unwrap();
        let arena = file.validate().unwrap().into_arena().unwrap();
        let make = |hidden| {
            let x = if hidden { 48. } else { 3400. };
            Sim::reset_active(
                SimConfig::default(),
                arena.clone(),
                Secrets::from_seed(27),
                &[
                    place(3640., 768.),
                    place(48., 112.),
                    place(x, if hidden { 208. } else { 768. }),
                ],
            )
        };
        let (mut hidden, mut remote) = (make(true), make(false));
        let viewer = PlayerId(2);
        for tick in 2..=605 {
            for s in [&mut hidden, &mut remote] {
                if tick == 2 {
                    issue(
                        s,
                        viewer,
                        RawCommand::AttackMove {
                            x: 400.,
                            y: 112.,
                            seq: Some(3),
                        },
                    );
                }
                s.step();
            }
            let a = hidden.player(viewer).unwrap();
            let b = remote.player(viewer).unwrap();
            assert_eq!(a.vision, b.vision, "tick {tick}");
            assert_eq!(
                crate::observe(&hidden, viewer, &[]),
                crate::observe(&remote, viewer, &[])
            );
            assert_eq!(a.weapon.targeting.target, None);
            if tick == 5 {
                assert_ne!(a.pos(), Vec2::new(48., 112.));
            }
        }
    }

    #[test]
    fn failed_delivery_and_unchanged_items_do_not_publish_new_actor_ids() {
        let id = PlayerId(1);
        let other = PlayerId(3);
        let mut arena = open();
        arena.spawns.push(Vec2::new(400., 320.));
        let mut s = Sim::reset_active(
            SimConfig::default(),
            arena,
            Secrets::from_seed(1),
            &[place(400., 320.), place(600., 320.), place(1450., 320.)],
        );
        let target = PublicCommand::Target { actor: other };
        let mut seat = ItemObserver::new(id);
        let mut out = Observation::default();
        seat.observe_into(&s, &[], &mut out, None).unwrap();
        assert!(!out.visible.iter().any(|a| a.id == other));
        issue(
            &mut s,
            other,
            RawCommand::Move {
                x: 900.,
                y: 320.,
                seq: None,
            },
        );
        for _ in 0..32 {
            if s.can_see_point(id, s.player(other).unwrap().pos()) {
                break;
            }
            s.step();
        }
        assert!(s.can_see_point(id, s.player(other).unwrap().pos()));
        let offer = seat.prepare_into(&s, &[], &mut out, None).unwrap();
        assert!(!offer.props_changed());
        drop(offer);
        assert_eq!(
            seat.resolve(&s, target),
            crate::validate(RawCommand::MissingTarget)
        );
        seat.prepare_into(&s, &[], &mut out, None).unwrap().commit();
        assert_eq!(
            seat.resolve(&s, target),
            crate::validate(RawCommand::Target { id: other })
        );
    }

    #[test]
    fn a_visible_wand_target_across_a_sealed_low_barrier_cannot_be_chased() {
        let mut tiles = vec![0; 40 * 10];
        for y in 0..10 {
            tiles[y * 40 + 12] = crate::map::TILE_LOW;
        }
        let map = TileMap::new(40, 10, tiles).unwrap();
        let p = place(100., 112.);
        let t = place(710., 112.);
        assert!(has_line_of_sight(&map, p.at, t.at, MASK_SIGHT));
        assert!(sealed(&map, p.at, t.at));
        let mut s = Sim::reset_active(
            SimConfig::default(),
            Arena {
                map,
                spawns: vec![],
            },
            Secrets::from_seed(3),
            &[p, t],
        );
        issue(&mut s, PlayerId(1), RawCommand::Target { id: PlayerId(2) });
        s.step();
        let p = s.player(PlayerId(1)).unwrap();
        assert_eq!(p.weapon.targeting.target, None);
        assert!(p.motion.path.is_empty());
    }
}
