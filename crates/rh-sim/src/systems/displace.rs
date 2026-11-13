//! Forced movement with a reusable pathfinder. Only this module constructs queued displacement requests.
use crate::{
    pathfind::Pathfinder,
    state::{PlayerId, Sample, World},
    statics::MatchStatic,
    Vec2,
};
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Request {
    id: PlayerId,
    to: Vec2,
}
impl Request {
    pub(crate) fn execute(self, k: &MatchStatic, w: &mut World, pf: &mut Pathfinder) {
        execute(k, w, pf, self.id, self.to)
    }
}
/// Caller validates the destination collision disc. Removal/death never cancels a queued displacement.
// Production callers arrive with P-ABIL; the real body is exercised by the explicit source harness.
#[cfg_attr(not(any(test, feature = "trusted-status-probes")), allow(dead_code))]
pub(crate) fn apply(k: &MatchStatic, w: &mut World, pf: &mut Pathfinder, id: PlayerId, to: Vec2) {
    if w.pay.collecting {
        w.pay
            .items
            .push(super::ledger::Payout::Displace(Request { id, to }));
    } else {
        execute(k, w, pf, id, to)
    }
}
fn execute(k: &MatchStatic, w: &mut World, pf: &mut Pathfinder, id: PlayerId, to: Vec2) {
    let now = w.server_time;
    let held = crate::barriers::held(w);
    let gates_locked = w.rt.gates_locked;
    if let Some(i) = w.idx(id) {
        let p = &mut w.players[i];
        let goal = p.motion.path.as_slice().last().copied();
        p.body.x = to.x;
        p.body.y = to.y;
        p.body.history.reset(Sample {
            t: now,
            x: to.x,
            y: to.y,
        });
        p.motion.slip = None;
        if let Some(goal) = goal {
            let foot = p.foot();
            p.motion.path.replan(
                pf,
                crate::barriers::body_map(k, &held, gates_locked),
                to,
                goal,
                foot,
            );
        }
        p.motion.displace_seq = p.motion.displace_seq.wrapping_add(1);
    }
    for p in &mut w.players {
        if p.weapon.targeting.target == Some(id) {
            let lock = &mut p.weapon.targeting;
            lock.seen = false;
            lock.lost_at = None;
            lock.plan_at = None;
            lock.goal = None;
        }
    }
}

#[cfg(feature = "trusted-status-probes")]
pub(crate) fn queue_probe(w: &mut World, id: PlayerId, to: Vec2) -> Result<(), &'static str> {
    if !w.pay.collecting {
        return Err("probe displacement callback must run in ledger collection");
    }
    w.pay
        .items
        .push(super::ledger::Payout::Displace(Request { id, to }));
    Ok(())
}
