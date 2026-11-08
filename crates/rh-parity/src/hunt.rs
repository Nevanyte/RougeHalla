//! Exact Sentenced-hunt source diagnostics: selection, completed stacks and the actor vision exception.
use crate::{fid, FixTick, Fixture, Report};
use serde_json::json;

pub(super) fn enabled(fx: &Fixture) -> bool {
    fx.packet.as_deref() == Some("P-FACTION-4")
        && fx.parity == "slice"
        && fx.legacy_config.rust_slice.as_deref()
            == Some("player-engagement-holy-plague-fire-frost-sentenced-hunt/1")
}

pub(super) fn modules_match(fx: &Fixture) -> bool {
    let expected = [
        "loot",
        "weapons",
        "targeting",
        "projectiles",
        "factions",
        "mobs",
        "buffs",
        "feed",
        "camps",
        "chests",
        "killAugments",
        "mobLife",
        "mobAI",
        "terrainEffects",
        "regen",
        "abilities",
        "quests",
        "vision",
        "campHeal",
        "traders",
        "cardHooks",
        "sentencedHunt",
        "mods",
    ];
    fx.legacy_config
        .modules
        .as_ref()
        .is_some_and(|m| m.iter().map(String::as_str).eq(expected))
}

pub(super) fn compare(
    rep: &mut Report,
    sim: &rh_sim::Sim,
    fx: &Fixture,
    t: &FixTick,
    actual_events: &[serde_json::Value],
) {
    if !enabled(fx) {
        if t.hunt.is_some() {
            rep.fail("unexpected Sentenced-hunt diagnostics".into());
        }
        return;
    }
    let Some(expected) = &t.hunt else {
        rep.fail(format!(
            "tick {} missing Sentenced-hunt diagnostics",
            t.tick
        ));
        return;
    };
    let players = sim
        .players()
        .iter()
        .map(|p| {
            json!({
                "id": fid(p.id),
                "huntTarget": p.hunt_target().map(fid).unwrap_or_default(),
                "huntStacks": p.hunt_stacks,
            })
        })
        .collect::<Vec<_>>();
    let actual = crate::canon::rounded(json!(players));
    if let Some(d) = crate::canon::first_difference("hunt", &actual, expected) {
        rep.fail(format!("tick {}: {d}", t.tick));
    }
    let _ = actual_events;
    let _ = crate::vision::compare(rep, sim, fx, t);
}

pub(super) fn preflight(fx: &Fixture) -> Vec<String> {
    if !enabled(fx) {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if !fx.scenario.starts_with("sentenced_hunt_") {
        errors.push("hunt provenance requires the explicit sentenced_hunt_ prefix".into());
    }
    if fx.ticks.is_empty() || fx.inputs.is_empty() || fx.requires.is_empty() {
        errors.push("hunt inventory requires nonempty ticks, inputs and requirements".into());
    }
    errors
}
