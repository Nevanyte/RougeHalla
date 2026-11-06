//! Exact source projection of Wish-owned movement and weapon state.
use super::*;
fn minus_infinity(value: Option<f64>) -> V {
    value.map_or_else(|| json!({"$float":"-Infinity"}), |v| json!(v))
}
pub(super) fn compare_motion(
    p: &crate::fighter::FighterCore,
    private: &V,
    public: &V,
    context: &str,
) {
    compare_value(
        &json!(p.motion.path.as_slice()),
        &private["path"],
        &format!("{context}/path"),
    );
    compare_value(
        &json!(p.body.history.as_slice()),
        &private["history"],
        &format!("{context}/history"),
    );
    let slip = p.motion.slip.as_ref().map_or(V::Null, |slip| {
        // All admitted frozen helper slides are newly constructed, before any terrain path bind.
        // A new reference-bearing source witness needs an explicit identity projection.
        assert!(slip.path.is_none(), "unmapped source slide path reference");
        let mut value = json!({"vx":slip.vx,"vy":slip.vy,"ax":slip.ax,"ay":slip.ay,"path":null,"replanAt":minus_infinity(slip.replan_at)});
        for (key, v) in [("stuckX",slip.stuck_x),("stuckY",slip.stuck_y),("stuckN",slip.stuck_n),("stuckBest",slip.stuck_best),("stuckAt",slip.stuck_at),("gripUntil",slip.grip_until)] {
            if let Some(v)=v {value[key]=json!(v);}
        }
        value
    });
    compare_value(&slip, &private["slip"], &format!("{context}/slip"));
    let w = &p.weapon;
    let action=w.action.map(|a|json!({"kind":format!("{:?}",a.kind).to_lowercase(),"weapon":a.weapon.as_str(),"startedAt":a.started_at,"landsAt":a.lands_at,"a":a.a,"packet":{"raw":a.packet.raw,"phys":a.packet.phys,"magic":a.packet.magic,"true":a.packet.true_},"target":a.target.map_or_else(|| json!({"$undefined":true}), |id|json!(label(id)))}));
    let value = json!({"action":action,"rootUntil":w.root_until,"staggerImmuneUntil":w.stagger_immune_until,"held":w.held,"pressedAt":w.pressed_at,"bufferedUntil":w.buffered_until,"aim":w.aim,"aimAt":w.aim_at,"lagMs":w.lag_ms,"lock":w.targeting.target.map(label),"lockSeen":w.targeting.seen,"lockLosLostAt":w.targeting.lost_at.unwrap_or(0.),"lockPlanAt":minus_infinity(w.targeting.plan_at),"lockGoal":w.targeting.goal,"lockSearchAt":minus_infinity(w.targeting.search_at),"attackMoveGoal":w.targeting.attack_move,"lastShotAt":minus_infinity(w.last_shot_at)});
    let mut expected_weapon = private["weapon"].clone();
    if let Some(action) = expected_weapon["action"].as_object_mut() {
        // Arena JSON omits undefined properties; Wish's plain() explicitly tags them.
        action
            .entry("target")
            .or_insert_with(|| json!({"$undefined":true}));
    }
    compare_value(&value, &expected_weapon, &format!("{context}/weapon"));
    if !public["drawStartedAt"].is_null() {
        compare_value(
            &json!(w.draw_started_at),
            &public["drawStartedAt"],
            &format!("{context}/drawStartedAt"),
        );
    }
}
