//! Exact Frost diagnostics, required only by the explicit complete base-player installation.
use crate::{fid, FixTick, Fixture, Report};
use serde_json::json;
pub(super) fn compare(rep: &mut Report, sim: &rh_sim::Sim, fx: &Fixture, t: &FixTick) {
    if !super::plague::frost(fx) {
        if t.frost.is_some() {
            rep.fail("unexpected Frost diagnostics".into());
        }
        return;
    }
    let Some(expected) = &t.frost else {
        rep.fail(format!("tick {} missing Frost diagnostics", t.tick));
        return;
    };
    let actual = crate::canon::rounded(json!(sim.players().iter().map(|p| {
        let f=&p.signature; let w=&p.weapon;
        json!({"id":fid(p.id),"chill":f.chill,"chillers":f.chillers[..usize::from(f.chiller_count)].iter().flatten().copied().map(fid).collect::<Vec<_>>(),"exposureStartedAt":f.exposure_started_at,"lastNearAt":f.last_near_at,"rangedUntil":f.ranged_chill_until,"move":f.frost_move_mult,"readyAt":w.ready_at,"bufferedUntil":w.buffered_until,"pressedAt":w.pressed_at,"drawStartedAt":w.draw_started_at,"action":w.action.map(|a|json!({"kind":match a.kind {rh_sim::state::ActionKind::Swing=>"swing",rh_sim::state::ActionKind::Cast=>"cast",rh_sim::state::ActionKind::Draw=>"draw"},"startedAt":a.started_at,"landsAt":a.lands_at}))})
    }).collect::<Vec<_>>()));
    if let Some(d) = crate::canon::first_difference("frost", &actual, expected) {
        rep.fail(format!("tick {}: {d}", t.tick));
    }
}
