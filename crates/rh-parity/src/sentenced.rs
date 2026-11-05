//! Exact source Mark diagnostics. Source identity strings remain harness-only.
use crate::{fid, FixTick, Fixture, Report};
use serde_json::json;
pub(super) fn enabled(fx: &Fixture) -> bool {
    fx.packet.as_deref() == Some("P-FACTION-1")
        && fx.parity == "slice"
        && fx.legacy_config.rust_slice.as_deref()
            == Some("player-engagement-holy-plague-fire-frost-sentenced/1")
}
pub(super) fn compare(
    rep: &mut Report,
    sim: &rh_sim::Sim,
    fx: &Fixture,
    t: &FixTick,
    actual_events: &[serde_json::Value],
    visuals: &[(rh_sim::PlayerId, u8, String)],
) {
    if !enabled(fx) {
        if t.sentenced.is_some() {
            rep.fail("unexpected Sentenced diagnostics".into());
        }
        return;
    }
    let Some(expected) = &t.sentenced else {
        rep.fail(format!("tick {} missing Sentenced diagnostics", t.tick));
        return;
    };
    let fighters=sim.players().iter().map(|p|{let m=&p.signature.mark;let (_,tier,by)=visuals.iter().find(|(id,_,_)|*id==p.id).expect("pre-action source visual");json!({"id":fid(p.id),"tier":m.tier,"hits":m.hits,"progress":m.progress,"swaps":m.swaps,"denied":m.denied,"farSince":m.far_since,"ampUntil":m.amp_until,"sentence":p.credit.sentence,"legacyMarkBy":by,"markTier":tier,"brand":tier*25,"markTax":0})}).collect::<Vec<_>>();
    let denials = sim
        .mark_denials()
        .iter()
        .flatten()
        .map(|(owner, foe)| json!({"owner":fid(*owner),"foe":fid(*foe)}))
        .collect::<Vec<_>>();
    let flags=sim.damage_entries().iter().map(|e|json!({"passive":e.passive,"derived":e.derived,"projectile":e.projectile.map(|n|super::combat::id36(n).replacen('c',"p",1)),"stagger":e.stagger})).collect::<Vec<_>>();
    // Canonical trusted event stream compares notice recipients/order; diagnostics separately require the full notice list.
    let notices = actual_events
        .iter()
        .filter(|e| e["kind"] == "toast")
        .cloned()
        .collect::<Vec<_>>();
    let actual = crate::canon::rounded(
        json!({"fighters":fighters,"denials":denials,"flags":flags,"notices":notices}),
    );
    if let Some(d) = crate::canon::first_difference("sentenced", &actual, expected) {
        rep.fail(format!("tick {}: {d}", t.tick));
    }
}

pub(super) fn preflight(fx: &Fixture) -> Vec<String> {
    if !enabled(fx) {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if fx.scenario.starts_with("sentenced_privacy_")
        && !fx.legacy_config.setup.contains_key("bootstrapSpawns")
    {
        errors.push(
            "Sentenced public producer triple requires explicit source bootstrap provenance".into(),
        );
    }
    if fx.ticks.is_empty() || fx.inputs.is_empty() || fx.requires.is_empty() {
        errors.push("Sentenced inventory requires nonempty ticks, inputs and requirements".into());
    }
    if !fx.scenario.starts_with("sentenced_") {
        errors.push("Sentenced provenance requires explicit scenario prefix".into());
    }
    errors
}

/// Legacy stores effects at afterDamage; between-step departure does not rerun syncVisuals.
/// Snapshot at the actual source seam before applying the fixture's out-of-band actions.
pub(super) fn visuals(sim: &rh_sim::Sim) -> Vec<(rh_sim::PlayerId, u8, String)> {
    sim.players()
        .iter()
        .map(|p| {
            let tier = sim
                .players()
                .iter()
                .filter(|o| p.standing() && o.standing() && o.signature.target == Some(p.id))
                .map(|o| o.signature.mark.tier)
                .max()
                .unwrap_or(0);
            let by = sim
                .players()
                .iter()
                .filter(|o| {
                    p.standing()
                        && o.standing()
                        && o.signature.target == Some(p.id)
                        && o.signature.mark.tier == tier
                        && tier > 0
                })
                .map(|o| fid(o.id))
                .min()
                .unwrap_or_default();
            (p.id, tier, by)
        })
        .collect()
}
