//! Legacy projectiles.ts. Release requests are realized after movement and the sweep. Ended projectiles
//! stay addressable through melee in this tick, so an intercepted ball can still scale its ledger hits.
use super::{
    ledger::Entry,
    melee::{in_arc, MeleeReq},
    Cx,
};
use crate::constants::*;
use crate::content::{weapon, Shape};
use crate::geometry::{ray_blocked, raycast};
use crate::math::{angle_between, atan2, cos, hypot, sin, sqrt, Vec2};
use crate::state::{
    Packet, Phase, Projectile, ProjectileEnd, ProjectileKind, ProjectileLaunch, World,
};
use crate::{Event, PlayerId, TileMap, WeaponId};

#[derive(Clone, Copy, Debug)]
pub(crate) struct Spawn {
    pub target: Option<PlayerId>,
    pub owner: PlayerId,
    pub weapon: WeaponId,
    pub aim: f64,
    pub packet: Packet,
}
#[derive(Clone, Copy, Debug)]
struct Swept {
    from: Vec2,
    ended: bool,
}
#[derive(Clone, Copy, Debug)]
struct Stretch {
    index: usize,
    a: Vec2,
    b: Vec2,
    len: f64,
    stop: Option<ProjectileEnd>,
}
#[derive(Debug, Default)]
pub(crate) struct FlightScratch {
    pub(crate) spawns: Vec<Spawn>,
    swept: Vec<Swept>,
    stretches: Vec<Stretch>,
}

fn launch(
    w: &mut World,
    swept: &mut Vec<Swept>,
    ev: &mut Vec<Event>,
    mut start: ProjectileLaunch,
    packet: Packet,
    reflections: u8,
) {
    start.id = w.next_entity_id();
    w.projectiles.push(Projectile {
        launch: start,
        pos: start.origin,
        velocity: start.velocity,
        time: start.time,
        traveled: 0.,
        packet,
        halved: false,
        reflections,
    });
    swept.push(Swept {
        from: start.origin,
        ended: false,
    });
    ev.push(Event::ProjectileLaunched(start));
}

pub(crate) fn spawn(cx: &mut Cx) {
    for req in cx.s.flight.spawns.drain(..) {
        let Some(owner) = cx.w.actor(req.owner) else {
            continue;
        };
        let Shape::Projectile { speed, range } = weapon(req.weapon).shape else {
            continue;
        };
        let start = ProjectileLaunch {
            id: 0,
            kind: if req.weapon == WeaponId::Bow {
                ProjectileKind::Arrow
            } else {
                ProjectileKind::Ball
            },
            owner: req.owner,
            reflected: false,
            origin: owner.pos(),
            velocity: Vec2::new(cos(req.aim) * speed, sin(req.aim) * speed),
            time: cx.w.server_time,
            range,
            target: req.target,
        };
        launch(cx.w, &mut cx.s.flight.swept, cx.ev, start, req.packet, 0);
    }
}

fn end(
    pr: &mut Projectile,
    swept: &mut Swept,
    ev: &mut Vec<Event>,
    at: Vec2,
    reason: ProjectileEnd,
) {
    if swept.ended {
        return;
    }
    swept.ended = true;
    pr.pos = at;
    ev.push(Event::ProjectileEnded {
        launch: pr.launch,
        at,
        reason,
    });
}
fn distance(a: Vec2, b: Vec2) -> f64 {
    hypot(a.x - b.x, a.y - b.y)
}
fn between(a: Vec2, b: Vec2, u: f64) -> Vec2 {
    Vec2::new(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u)
}

fn stretch(
    w: &World,
    index: usize,
    t: f64,
    map: &TileMap,
) -> Result<(Stretch, Vec2), ProjectileEnd> {
    let pr = &w.projectiles[index];
    let mut v = pr.velocity;
    if let Some(id) = pr.launch.target {
        let Some(target) = w
            .fighter_idx(id)
            .filter(|&ix| w.standing(ix))
            .map(|ix| w.core(ix))
        else {
            return Err(ProjectileEnd::Destroyed);
        };
        let at = target.position_at(t);
        let dx = at.x - pr.pos.x;
        let dy = at.y - pr.pos.y;
        let d = hypot(dx, dy);
        if d > 1e-6 {
            let speed = hypot(pr.launch.velocity.x, pr.launch.velocity.y);
            v = Vec2::new(dx / d * speed, dy / d * speed);
        }
    }
    let dt = (t - pr.time) / 1000.;
    let mut b = Vec2::new(pr.pos.x + v.x * dt, pr.pos.y + v.y * dt);
    let mut len = distance(pr.pos, b);
    let left = pr.launch.range - pr.traveled;
    let mut stop = None;
    if pr.launch.target.is_some() && t - pr.launch.time >= HOMING_LIFETIME_MS {
        let f = if len > 0. {
            (left / len).clamp(0., 1.)
        } else {
            0.
        };
        b = between(pr.pos, b, f);
        len *= f;
        stop = Some(ProjectileEnd::Range);
    } else if len >= left {
        b = between(pr.pos, b, if len > 0. { left / len } else { 0. });
        len = left;
        stop = Some(ProjectileEnd::Range);
    }
    let wall = raycast(map, pr.pos.x, pr.pos.y, b.x, b.y, MASK_SIGHT);
    if wall.hit {
        b = Vec2::new(wall.x, wall.y);
        len = wall.dist;
        stop = Some(ProjectileEnd::Wall);
    }
    Ok((
        Stretch {
            index,
            a: pr.pos,
            b,
            len,
            stop,
        },
        v,
    ))
}

fn closest(ball: Stretch, arrow: Stretch) -> (Vec2, Vec2) {
    let rx = ball.a.x - arrow.a.x;
    let ry = ball.a.y - arrow.a.y;
    let vx = (ball.b.x - ball.a.x) - (arrow.b.x - arrow.a.x);
    let vy = (ball.b.y - ball.a.y) - (arrow.b.y - arrow.a.y);
    let vv = vx * vx + vy * vy;
    let u = if vv > 0. {
        (-(rx * vx + ry * vy) / vv).clamp(0., 1.)
    } else {
        1.
    };
    (between(ball.a, ball.b, u), between(arrow.a, arrow.b, u))
}
fn delete_arrows(cx: &mut Cx) {
    let f = &mut cx.s.flight;
    for ball in &f.stretches {
        let bi = ball.index;
        let owner = cx.w.projectiles[bi].launch.owner;
        if cx.w.projectiles[bi].launch.kind != ProjectileKind::Ball || f.swept[bi].ended {
            continue;
        }
        for arrow in &f.stretches {
            let ai = arrow.index;
            let pr = &cx.w.projectiles[ai];
            if pr.launch.kind != ProjectileKind::Arrow
                || pr.launch.owner == owner
                || f.swept[ai].ended
            {
                continue;
            }
            let (a, b) = closest(*ball, *arrow);
            if distance(a, b) <= BALL_ARROW_RADIUS
                && !ray_blocked(&cx.k.arena.map, a.x, a.y, b.x, b.y, MASK_SIGHT)
            {
                end(
                    &mut cx.w.projectiles[ai],
                    &mut f.swept[ai],
                    cx.ev,
                    b,
                    ProjectileEnd::Deleted,
                );
                cx.w.projectiles[bi].packet.raw *= BALL_AFTER_ARROW;
            }
        }
    }
}

fn contact(s: Stretch, at: Vec2, reach: f64) -> Option<f64> {
    let dx = s.b.x - s.a.x;
    let dy = s.b.y - s.a.y;
    let fx = s.a.x - at.x;
    let fy = s.a.y - at.y;
    let c = fx * fx + fy * fy - reach * reach;
    if c <= 0. {
        return (fx * dx + fy * dy <= 0.).then_some(0.);
    }
    let a = dx * dx + dy * dy;
    if a == 0. {
        return None;
    }
    let b = 2. * (fx * dx + fy * dy);
    let disc = b * b - 4. * a * c;
    if disc < 0. {
        return None;
    }
    let u = (-b - sqrt(disc)) / (2. * a);
    (0. ..=1.).contains(&u).then_some(u)
}

fn first_body(cx: &Cx, s: Stretch, t: f64) -> Option<(usize, Vec2)> {
    let pr = &cx.w.projectiles[s.index];
    let reach = PLAYER_RADIUS
        + if pr.launch.kind == ProjectileKind::Arrow {
            ARROW_RADIUS
        } else {
            RANGED_SLACK
        };
    let mut best = None::<(f64, f64, u32, usize)>;
    for i in 0..cx.w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(i);
        let p = cx.w.core(ix);
        if !cx.w.standing(ix)
            || p.id == pr.launch.owner
            || (cx.w.mobs.contains(pr.launch.owner) && !cx.w.is_player(ix))
        {
            continue;
        }
        let at = p.position_at(t);
        if let Some(u) = contact(s, at, reach) {
            let candidate = (
                u,
                distance(s.a, at),
                cx.s.rank.get(i).copied().unwrap_or(u32::MAX),
                i,
            );
            if best.is_none_or(|b| candidate < b) {
                best = Some(candidate);
            }
        }
    }
    best.map(|(u, _, _, i)| (i, between(s.a, s.b, u)))
}

fn entry(pr: Projectile, victim: PlayerId, scale: f64, derived: bool) -> Entry {
    Entry {
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim,
        by: Some(pr.launch.owner),
        packet: pr.packet,
        weapon: Some(pr.weapon()),
        stagger: false,
        projectile: Some(pr.launch.id),
        scale,
        derived,
        passive: pr.launch.reflected,
    }
}
fn splash(cx: &mut Cx, pr: Projectile, primary: usize, t: f64) {
    if pr.weapon() != WeaponId::Wand || !cx.k.config.weapon_specials {
        return;
    }
    let centre =
        cx.w.core(crate::fighter::FighterIx::of_slot(primary))
            .position_at(t);
    for i in 0..cx.w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(i);
        let p = cx.w.core(ix);
        if i == primary
            || !cx.w.standing(ix)
            || p.id == pr.launch.owner
            || (cx.w.mobs.contains(pr.launch.owner) && !cx.w.is_player(ix))
        {
            continue;
        }
        let at = p.position_at(t);
        if distance(centre, at) <= WAND_SPLASH_RADIUS
            && !ray_blocked(&cx.k.arena.map, centre.x, centre.y, at.x, at.y, MASK_SIGHT)
        {
            let hit = entry(pr, p.id, WAND_SPLASH_SHARE, true);
            super::ledger::record_hit(cx.w, &mut cx.s.ledger, hit);
        }
    }
}
fn reflect(cx: &mut Cx, s: Stretch, t: f64, victim: usize, at: Vec2) {
    let pr = cx.w.projectiles[s.index];
    let holder = cx.w.core(crate::fighter::FighterIx::of_slot(victim));
    let id = holder.id;
    let facing = holder.body.facing;
    if cx.k.config.faction_mode.engagement() {
        cx.s.blocks.push(crate::systems::signatures::BlockContact {
            attacker: pr.launch.owner,
            holder: id,
            passive: pr.launch.reflected,
        });
    }
    cx.ev.push(Event::Block {
        id,
        by: pr.launch.owner,
        weapon: pr.weapon(),
        passive: pr.launch.reflected,
    });
    let blocked = pr.reflections >= MAX_ARROW_REFLECTIONS;
    end(
        &mut cx.w.projectiles[s.index],
        &mut cx.s.flight.swept[s.index],
        cx.ev,
        at,
        if blocked {
            ProjectileEnd::Blocked
        } else {
            ProjectileEnd::Reflected
        },
    );
    if cx.w.fighter_idx(pr.launch.owner).is_some() {
        crate::hooks::fire(
            &mut crate::hooks::Hx {
                k: cx.k,
                w: cx.w,
                ev: cx.ev,
                stats: cx.stats,
                fx: None,
            },
            crate::hooks::HookArgs::Blocked {
                holder: id,
                attacker: pr.launch.owner,
                prevented: crate::state::Packet {
                    raw: pr.packet.raw * if blocked { 1. } else { ARROW_REFLECT_SHARE },
                    ..pr.packet
                },
                melee: false,
            },
        );
    }
    if blocked {
        return;
    }
    let mut hit = entry(pr, id, 1., false);
    hit.packet.raw *= 1. - ARROW_REFLECT_SHARE;
    super::ledger::record_hit(cx.w, &mut cx.s.ledger, hit);
    let (nx, ny) = (cos(facing), sin(facing));
    let d = pr.velocity.x * nx + pr.velocity.y * ny;
    let velocity = Vec2::new(pr.velocity.x - 2. * d * nx, pr.velocity.y - 2. * d * ny);
    let range = if pr.launch.reflected {
        (pr.launch.range - pr.traveled - distance(at, s.a)).max(0.)
    } else {
        match weapon(WeaponId::Bow).shape {
            Shape::Projectile { range, .. } => range,
            _ => pr.launch.range,
        }
    };
    let start = ProjectileLaunch {
        id: 0,
        kind: ProjectileKind::Arrow,
        owner: id,
        reflected: true,
        origin: at,
        velocity,
        time: t,
        range,
        target: None,
    };
    let mut packet = pr.packet;
    packet.raw *= ARROW_REFLECT_SHARE;
    launch(
        cx.w,
        &mut cx.s.flight.swept,
        cx.ev,
        start,
        packet,
        pr.reflections + 1,
    );
}

fn advance(cx: &mut Cx, s: Stretch, t: f64) {
    if cx.s.flight.swept[s.index].ended {
        return;
    }
    let pr = cx.w.projectiles[s.index];
    if let Some((i, at)) = first_body(cx, s, t) {
        let holder = cx.w.core(crate::fighter::FighterIx::of_slot(i));
        if pr.launch.kind == ProjectileKind::Arrow
            && holder.active_weapon() == WeaponId::Shield
            && (pr.velocity.x != 0. || pr.velocity.y != 0.)
            && angle_between(atan2(-pr.velocity.y, -pr.velocity.x), holder.body.facing)
                <= SHIELD_HALF_ARC + ARC_EPS
        {
            reflect(cx, s, t, i, at);
        } else {
            let hit = entry(pr, holder.id, 1., false);
            super::ledger::record_hit(cx.w, &mut cx.s.ledger, hit);
            splash(cx, pr, i, t);
            end(
                &mut cx.w.projectiles[s.index],
                &mut cx.s.flight.swept[s.index],
                cx.ev,
                at,
                ProjectileEnd::Hit,
            );
        }
    } else {
        let p = &mut cx.w.projectiles[s.index];
        p.pos = s.b;
        p.traveled += s.len;
        p.time = t;
        if let Some(reason) = s.stop {
            end(p, &mut cx.s.flight.swept[s.index], cx.ev, s.b, reason);
        }
    }
}
pub(crate) fn sweep(cx: &mut Cx) {
    cx.s.flight.swept.clear();
    cx.s.flight
        .swept
        .extend(cx.w.projectiles.iter().map(|p| Swept {
            from: p.pos,
            ended: false,
        }));
    if cx.w.projectiles.is_empty() {
        return;
    }
    let steps = (TICK_MS / PROJECTILE_SUBSTEP_MS).round().max(1.) as u32;
    for k in 1..=steps {
        let t = cx.w.server_time - TICK_MS + TICK_MS * f64::from(k) / f64::from(steps);
        cx.s.flight.stretches.clear();
        for i in 0..cx.w.projectiles.len() {
            if cx.s.flight.swept[i].ended || cx.w.projectiles[i].time >= t {
                continue;
            }
            match stretch(cx.w, i, t, &cx.k.arena.map) {
                Ok((s, v)) => {
                    cx.w.projectiles[i].velocity = v;
                    cx.s.flight.stretches.push(s);
                }
                Err(reason) => {
                    let p = &mut cx.w.projectiles[i];
                    end(p, &mut cx.s.flight.swept[i], cx.ev, p.pos, reason);
                }
            }
        }
        delete_arrows(cx);
        for i in 0..cx.s.flight.stretches.len() {
            advance(cx, cx.s.flight.stretches[i], t);
        }
    }
}

pub(crate) fn meet_balls(
    w: &mut World,
    flight: &mut FlightScratch,
    ledger: &mut [Entry],
    ev: &mut Vec<Event>,
    map: &TileMap,
    req: &MeleeReq,
    (reach, half_arc): (f64, f64),
) {
    if !matches!(req.weapon, WeaponId::Sword | WeaponId::Axe) {
        return;
    }
    let origin = w.actor(req.attacker).expect("standing attacker").pos();
    for (pr, swept) in w.projectiles.iter_mut().zip(&mut flight.swept) {
        if pr.launch.kind != ProjectileKind::Ball || pr.launch.owner == req.attacker {
            continue;
        }
        let dx = pr.pos.x - swept.from.x;
        let dy = pr.pos.y - swept.from.y;
        let n = (hypot(dx, dy) / BALL_SAMPLE_STEP).ceil().max(1.) as u32;
        let crosses = (0..=n).any(|i| {
            let p = Vec2::new(
                swept.from.x + dx * f64::from(i) / f64::from(n),
                swept.from.y + dy * f64::from(i) / f64::from(n),
            );
            in_arc(origin, req.a, reach, half_arc, p, RANGED_SLACK)
                && !ray_blocked(map, origin.x, origin.y, p.x, p.y, MASK_MELEE)
        });
        if !crosses {
            continue;
        }
        let scale = if req.weapon == WeaponId::Axe {
            end(pr, swept, ev, pr.pos, ProjectileEnd::Destroyed);
            0.
        } else if pr.halved {
            continue;
        } else {
            pr.halved = true;
            pr.packet.raw *= SWORD_BALL_SCALE;
            SWORD_BALL_SCALE
        };
        for e in ledger
            .iter_mut()
            .filter(|e| e.projectile == Some(pr.launch.id))
        {
            e.scale *= scale;
        }
    }
}

pub(crate) fn finish(cx: &mut Cx) {
    if cx.w.phase == Phase::Ended {
        for (p, s) in cx.w.projectiles.iter_mut().zip(&mut cx.s.flight.swept) {
            end(p, s, cx.ev, p.pos, ProjectileEnd::Cleared);
        }
    }
    let mut swept = cx.s.flight.swept.iter();
    cx.w.projectiles.retain(|_| {
        !swept
            .next()
            .expect("one stretch origin per projectile")
            .ended
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{arenas::practice_arena, FactionId, Placement, Secrets, Sim, SimConfig};
    fn world(xs: &[f64], specials: bool) -> Sim {
        let ps: Vec<_> = xs
            .iter()
            .enumerate()
            .map(|(i, x)| Placement {
                profile: format!("p{i}"),
                faction: FactionId::Holy,
                at: Vec2::new(*x, 272.),
                hp: None,
                weapon0: None,
                weapon1: None,
                bot: false,
            })
            .collect();
        Sim::reset_active(
            SimConfig {
                weapon_specials: specials,
                ..Default::default()
            },
            practice_arena(),
            Secrets::from_seed(1),
            &ps,
        )
    }
    fn seed(
        sim: &mut Sim,
        kind: ProjectileKind,
        owner: PlayerId,
        at: Vec2,
        v: Vec2,
        target: Option<PlayerId>,
    ) {
        let range = match weapon(if kind == ProjectileKind::Arrow {
            WeaponId::Bow
        } else {
            WeaponId::Wand
        })
        .shape
        {
            Shape::Projectile { range, .. } => range,
            _ => unreachable!(),
        };
        let start = ProjectileLaunch {
            id: 0,
            owner,
            kind,
            origin: at,
            velocity: v,
            time: sim.server_time(),
            target,
            range,
            reflected: false,
        };
        launch(
            &mut sim.w,
            &mut vec![],
            &mut vec![],
            start,
            Packet {
                raw: 100.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            0,
        );
    }
    fn ended(events: &[Event], reason: ProjectileEnd) -> bool {
        events
            .iter()
            .any(|e| matches!(e,Event::ProjectileEnded{reason:r,..} if *r==reason))
    }
    #[test]
    fn a_ball_deletes_the_arrow_before_its_same_substep_body_contact() {
        let mut sim = world(&[100., 320.], true);
        seed(
            &mut sim,
            ProjectileKind::Arrow,
            PlayerId(1),
            Vec2::new(296., 272.),
            Vec2::new(900., 0.),
            None,
        );
        seed(
            &mut sim,
            ProjectileKind::Ball,
            PlayerId(2),
            Vec2::new(322., 272.),
            Vec2::new(-380., 0.),
            None,
        );
        let ev = sim.step();
        assert!(ended(&ev, ProjectileEnd::Deleted));
        assert!(!ev.iter().any(|e| matches!(e, Event::Hit { .. })));
        assert_eq!(sim.w.projectiles[0].packet.raw, 60.);
        let s = |ax, bx| Stretch {
            index: 0,
            a: Vec2::new(ax, 272.),
            b: Vec2::new(bx, 272.),
            len: (bx - ax).abs(),
            stop: None,
        };
        let (a, b) = closest(s(300., 304.), s(311., 302.));
        assert!((a.x - b.x).abs() < 1e-10);
        assert_eq!(contact(s(318., 327.), Vec2::new(320., 272.), 19.), Some(0.));
        assert_eq!(contact(s(318., 309.), Vec2::new(320., 272.), 19.), None);
    }
    #[test]
    fn two_shields_reflect_twice_then_block_even_with_specials_disabled() {
        let mut sim = world(&[320., 440.], false);
        for p in &mut sim.w.players {
            p.weapon.weapon0 = Some(WeaponId::Shield);
        }
        sim.w.players[1].body.facing = crate::math::PI;
        seed(
            &mut sim,
            ProjectileKind::Arrow,
            PlayerId(1),
            Vec2::new(320., 272.),
            Vec2::new(900., 0.),
            None,
        );
        let mut reflections = Vec::new();
        let mut ends = Vec::new();
        let mut passive_blocks = Vec::new();
        for _ in 0..16 {
            for e in sim.step() {
                match e {
                    Event::ProjectileLaunched(p) => reflections.push(p),
                    Event::ProjectileEnded { reason, .. } => ends.push(reason),
                    Event::Block { passive, .. } => passive_blocks.push(passive),
                    _ => (),
                }
            }
        }
        assert_eq!(
            ends,
            [
                ProjectileEnd::Reflected,
                ProjectileEnd::Reflected,
                ProjectileEnd::Blocked
            ]
        );
        assert_eq!(passive_blocks, [false, true, true]);
        assert_eq!(reflections.len(), 2);
        assert_eq!(reflections[0].owner, PlayerId(2));
        assert_eq!(reflections[0].range, 520.);
        assert_eq!(reflections[1].owner, PlayerId(1));
        assert!((reflections[1].range - 438.).abs() < 1e-9);
        assert!(sim.w.projectiles.is_empty());
    }

    #[test]
    fn splash_is_limited_by_distance_sight_and_specials() {
        for specials in [true, false] {
            let mut sim = world(&[80., 181., 175., 228.], specials);
            // One wall tile at x=192..224 y=176. The other adjacent body stands beside the primary.
            for p in &mut sim.w.players {
                p.body.y = 176.;
            }
            sim.w.players[2].body.y = 210.;
            for p in &mut sim.w.players {
                let at = p.pos();
                p.body.history.reset(crate::state::Sample {
                    t: TICK_MS,
                    x: at.x,
                    y: at.y,
                });
            }
            seed(
                &mut sim,
                ProjectileKind::Ball,
                PlayerId(1),
                Vec2::new(168., 176.),
                Vec2::new(380., 0.),
                None,
            );
            let ev = sim.step();
            let hits: Vec<_> = ev
                .iter()
                .filter_map(|e| match e {
                    Event::Hit { victim, .. } => Some(*victim),
                    _ => None,
                })
                .collect();
            if specials {
                assert_eq!(hits, [PlayerId(2), PlayerId(3)]);
            } else {
                assert_eq!(hits, [PlayerId(2)]);
            }
        }
    }

    #[test]
    fn interception_after_contact_scales_both_primary_and_splash_without_a_second_end() {
        let mut base = world(&[100., 320., 335.], true);
        seed(
            &mut base,
            ProjectileKind::Ball,
            PlayerId(1),
            Vec2::new(304., 272.),
            Vec2::new(380., 0.),
            None,
        );
        let hits = |ev: &[Event]| {
            ev.iter()
                .filter_map(|e| match e {
                    Event::Hit {
                        by: Some(PlayerId(1)),
                        victim,
                        amount,
                        ..
                    } => Some((*victim, *amount)),
                    _ => None,
                })
                .collect::<Vec<_>>()
        };
        let original = hits(&base.clone().step());
        assert_eq!(original.len(), 2);
        for weapon in [WeaponId::Sword, WeaponId::Axe, WeaponId::Shield] {
            let mut s = base.clone();
            let now = s.server_time();
            let p = &mut s.w.players[1];
            p.weapon.weapon0 = Some(weapon);
            p.weapon.action = Some(crate::state::PendingAction {
                target: None,
                kind: crate::state::ActionKind::Swing,
                weapon,
                started_at: now,
                lands_at: now + TICK_MS,
                a: crate::math::PI,
                packet: Packet {
                    raw: 0.,
                    phys: 1.,
                    magic: 0.,
                    true_: 0.,
                },
            });
            let ev = s.step();
            assert_eq!(
                ev.iter()
                    .filter(|e| matches!(e, Event::ProjectileEnded { .. }))
                    .count(),
                1
            );
            assert!(ended(&ev, ProjectileEnd::Hit));
            let after = hits(&ev);
            match weapon {
                WeaponId::Axe => assert!(after.is_empty()),
                WeaponId::Sword => assert_eq!(
                    after,
                    original
                        .iter()
                        .map(|(id, a)| (*id, a * 0.5))
                        .collect::<Vec<_>>()
                ),
                WeaponId::Shield => assert_eq!(after, original),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn homing_uses_substep_history_and_ends_on_target_loss_or_the_time_cap() {
        let mut sim = world(&[100., 760.], true);
        for _ in 0..105 {
            sim.step();
        }
        seed(
            &mut sim,
            ProjectileKind::Ball,
            PlayerId(1),
            Vec2::new(120., 272.),
            Vec2::new(0., 380.),
            Some(PlayerId(2)),
        );
        let mut expired = sim.clone();
        expired.w.projectiles[0].launch.time -= HOMING_LIFETIME_MS;
        assert!(ended(&expired.step(), ProjectileEnd::Range));
        sim.step();
        assert!(
            sim.w.projectiles[0].velocity.x > 379. && sim.w.projectiles[0].velocity.y.abs() < 0.01
        );
        sim.w.players[1].status = crate::Status::Mia;
        assert!(ended(&sim.step(), ProjectileEnd::Destroyed));
    }

    #[test]
    fn corrupted_checkpoint_cannot_exhaust_ids_at_reflection_or_emit_nonfinite_damage() {
        let mut sim = world(&[100., 320., 700.], true);
        sim.w.players[1].weapon.weapon0 = Some(WeaponId::Shield);
        sim.w.players[1].body.facing = crate::math::PI;
        sim.w.tick = 300_000_000;
        sim.w.server_time = f64::from(sim.w.tick) * TICK_MS;
        for _ in 0..97 {
            seed(
                &mut sim,
                ProjectileKind::Arrow,
                PlayerId(1),
                Vec2::new(301., 272.),
                Vec2::new(900., 0.),
                None,
            );
        }
        let mut cp = serde_json::to_value(&sim).unwrap();
        // Test packets intentionally use synthetic damage; give these flights a normal packet.
        for p in cp["world"]["projectiles"].as_array_mut().unwrap() {
            p["packet"]["raw"] = 1.0.into();
        }
        Sim::restore(&cp).expect("the volley itself can continue");
        let malformed = |v: &serde_json::Value| {
            Sim::restore(v)
                .expect_err("malformed checkpoint")
                .to_string()
        };
        let mut no_ids = cp.clone();
        no_ids["world"]["entity_counter"] = (u32::MAX - 96).into();
        assert!(malformed(&no_ids).contains("identity headroom"));
        no_ids["world"]["tick"] = 1.into();
        assert!(malformed(&no_ids).contains("identity counters"));
        for bad in [
            serde_json::json!({"raw":1e308,"phys":1e308,"magic":0.,"true_":0.}),
            serde_json::json!({"raw":1e308,"phys":1.,"magic":0.,"true_":0.}),
            serde_json::json!({"raw":5.,"phys":0.7,"magic":0.7,"true_":0.}),
        ] {
            let mut flight = cp.clone();
            flight["world"]["projectiles"][0]["packet"] = bad.clone();
            assert!(malformed(&flight).contains("invalid projectile"));
            let mut pending = cp.clone();
            let hand = &mut pending["world"]["players"][0]["core"]["weapon"];
            hand["weapon0"] = "Bow".into();
            hand["action"] = serde_json::json!({"kind":"Draw","weapon":"Bow","a":0.0,"started_at":0.0,"lands_at":1.0,"packet":bad});
            assert!(malformed(&pending).contains("pending"));
        }
    }

    #[test]
    fn settlement_clears_only_the_surviving_flights_after_the_raid_ends() {
        let mut s = world(&[100., 320.], true);
        s.w.players[1].vitals.hp = 1.;
        seed(
            &mut s,
            ProjectileKind::Arrow,
            PlayerId(1),
            Vec2::new(303., 272.),
            Vec2::new(900., 0.),
            None,
        );
        seed(
            &mut s,
            ProjectileKind::Ball,
            PlayerId(1),
            Vec2::new(150., 400.),
            Vec2::new(380., 0.),
            None,
        );
        let ev = s.step();
        let endings: Vec<_> = ev
            .iter()
            .filter_map(|e| match e {
                Event::ProjectileEnded { launch, reason, .. } => Some((launch.id, *reason)),
                _ => None,
            })
            .collect();
        assert_eq!(
            endings,
            [(1, ProjectileEnd::Hit), (2, ProjectileEnd::Cleared)]
        );
        assert!(matches!(
            ev.last(),
            Some(Event::ProjectileEnded {
                reason: ProjectileEnd::Cleared,
                ..
            })
        ));
        assert!(s.w.projectiles.is_empty());
        assert!(s.step().is_empty());
    }

    #[test]
    fn shot_over_low_fence_stops_at_wall_or_range() {
        for (from, to, y, reason) in [
            (740., 1., 400., ProjectileEnd::Range),
            (175., 1., 176., ProjectileEnd::Wall),
        ] {
            let mut sim = world(&[100., 1450.], true);
            // LOW fence is in x=768..800 at y=400; the next wall pillar on this row is beyond range.
            seed(
                &mut sim,
                ProjectileKind::Arrow,
                PlayerId(1),
                Vec2::new(from, y),
                Vec2::new(900. * to, 0.),
                None,
            );
            let mut all = Vec::new();
            for _ in 0..15 {
                sim.step_into(&mut all);
            }
            assert!(ended(&all, reason), "{all:?}");
        }
    }
}
