//! Source shared/policies.ts subset used by regional NPCs and authoritative locks.
//! Optional bot experiments (strafe/weave/custom spacing) are outside the shipped profile.
use crate::{
    constants::*,
    content::{weapon, Shape, WeaponId},
    math::{atan2, cos, hypot, sin, sqrt, Vec2},
};
#[derive(Clone, Copy, Debug)]
pub(crate) struct Spacing {
    pub far: f64,
    pub attack: f64,
    pub retreat: f64,
    pub lead: f64,
}
pub(crate) fn spacing(w: WeaponId, lock: bool) -> Spacing {
    let mut p = match weapon(w).shape {
        Shape::Arc { reach, .. } => Spacing {
            far: reach * NPC_MELEE_FAR_SHARE,
            attack: reach + PLAYER_RADIUS - NPC_MELEE_EDGE,
            retreat: 0.,
            lead: 0.,
        },
        Shape::Projectile { range, speed, .. } => {
            if w == WeaponId::Bow {
                Spacing {
                    far: range * NPC_BOW_FAR_SHARE,
                    attack: range * NPC_BOW_ATTACK_SHARE,
                    retreat: range * NPC_BOW_RETREAT_SHARE,
                    lead: speed,
                }
            } else {
                Spacing {
                    far: range * NPC_WAND_FAR_SHARE,
                    attack: range * NPC_WAND_ATTACK_SHARE,
                    retreat: range * NPC_WAND_RETREAT_SHARE,
                    lead: speed,
                }
            }
        }
    };
    if lock {
        p.retreat = 0.;
        if let (WeaponId::Wand, Shape::Projectile { range, .. }) = (w, weapon(w).shape) {
            p.far = range * LOCK_FAR_SHARE;
            p.attack = range * LOCK_ATTACK_SHARE;
        }
    }
    p
}
#[derive(Clone, Copy, Debug)]
pub(crate) enum Move {
    Point(Vec2),
    Stop,
}
#[derive(Clone, Copy, Debug)]
pub(crate) struct Decision {
    pub movement: Move,
    pub aim: f64,
    pub hold: bool,
}
fn ahead(p: Vec2, v: Vec2, t: f64) -> Vec2 {
    if t == 0. {
        p
    } else {
        Vec2::new(p.x + v.x * t, p.y + v.y * t)
    }
}
fn project(from: Vec2, to: Vec2, v: Vec2, seconds: f64) -> (Vec2, Vec2) {
    if seconds <= 0. {
        return (from, to);
    }
    let rx = to.x - from.x;
    let ry = to.y - from.y;
    let a = v.x * v.x + v.y * v.y;
    let b = rx * v.x + ry * v.y;
    let c = rx * rx + ry * ry - NPC_POLICY_CONTACT * NPC_POLICY_CONTACT;
    let mut t = seconds;
    if b < 0. && a > 0. {
        let disc = b * b - a * c;
        if c <= 0. {
            t = 0.
        } else if disc >= 0. {
            t = t.min(((-b - sqrt(disc)) / a).max(0.));
        }
    }
    (from, ahead(to, v, t))
}
pub(crate) fn intercept(from: Vec2, to: Vec2, v: Vec2, speed: f64) -> f64 {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let a = v.x * v.x + v.y * v.y - speed * speed;
    let b = 2. * (dx * v.x + dy * v.y);
    let c = dx * dx + dy * dy;
    if a.abs() < NPC_INTERCEPT_EPS {
        return if b < 0. { -c / b } else { -1. };
    }
    let disc = b * b - 4. * a * c;
    if disc < 0. {
        return -1.;
    }
    let r = sqrt(disc);
    let t1 = (-b - r) / (2. * a);
    let t2 = (-b + r) / (2. * a);
    if t1.min(t2) > 0. {
        t1.min(t2)
    } else {
        t1.max(t2)
    }
}
pub(crate) struct Input {
    pub from: Vec2,
    pub to: Vec2,
    pub vel: Vec2,
    pub los: bool,
    pub weapon: WeaponId,
    pub windup: f64,
    pub lock: bool,
    pub delay: f64,
}
pub(crate) fn decide(input: Input, walkable: impl Fn(Vec2, Vec2) -> bool) -> Decision {
    let Input {
        from,
        to,
        vel,
        los,
        weapon: w,
        windup,
        lock,
        delay,
    } = input;
    let p = spacing(w, lock);
    let lag = delay + if w == WeaponId::Bow { 0. } else { windup };
    let (from, to_move) = project(from, to, vel, delay);
    let (origin, to_hit) = project(from, to, vel, lag);
    let flight = intercept(origin, to_hit, vel, p.lead);
    let aim = if p.lead > 0. && flight > 0. {
        atan2(
            to_hit.y + vel.y * flight - origin.y,
            to_hit.x + vel.x * flight - origin.x,
        )
    } else {
        atan2(to_hit.y - origin.y, to_hit.x - origin.x)
    };
    let d = hypot(to_move.x - from.x, to_move.y - from.y);
    let movement = if !los || d > p.far {
        Move::Point(to_move)
    } else if d < p.retreat {
        let away = atan2(from.y - to_move.y, from.x - to_move.x);
        let mut found = None;
        'search: for step in [NPC_POLICY_STEP, NPC_POLICY_STEP / 2.] {
            for turn in [
                0.,
                NPC_RETREAT_TURN1,
                -NPC_RETREAT_TURN1,
                NPC_RETREAT_TURN2,
                -NPC_RETREAT_TURN2,
                NPC_RETREAT_TURN3,
                -NPC_RETREAT_TURN3,
            ] {
                let at = Vec2::new(
                    from.x + cos(away + turn) * step,
                    from.y + sin(away + turn) * step,
                );
                if walkable(from, at) {
                    found = Some(at);
                    break 'search;
                }
            }
        }
        found.map_or(Move::Stop, Move::Point)
    } else {
        Move::Stop
    };
    let reach = if p.lead > 0. && flight > 0. {
        flight * p.lead
    } else {
        hypot(to_hit.x - origin.x, to_hit.y - origin.y)
    };
    Decision {
        movement,
        aim,
        hold: los && reach <= p.attack,
    }
}
