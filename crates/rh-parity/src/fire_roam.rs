//! Strict provenance, module order and complete trusted diagnostics for the explicit Fire roam installation.
use crate::{fid, FixTick, Fixture, Report};
use serde_json::json;

/// The captured provenance id: the five-faction foundation plus the auxiliary `fireRoam` installer.
pub const SLICE: &str = "player-engagement-holy-plague-fire-frost-sentenced-fireroam/1";

pub(super) fn enabled(fx: &Fixture) -> bool {
    fx.packet.as_deref() == Some("P-FACTION-2")
        && fx.parity == "slice"
        && fx.legacy_config.rust_slice.as_deref() == Some(SLICE)
}

/// The explicit installer list, in `createGameWorld` order: the faction foundation plus `fireRoam` at its source
/// position (after `cardHooks`, before `mods`).
pub(super) fn modules(fx: &Fixture) -> bool {
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
        "fireRoam",
        "mods",
    ];
    fx.legacy_config
        .modules
        .as_ref()
        .is_some_and(|m| m.iter().map(String::as_str).eq(expected))
}

pub(super) fn compare(rep: &mut Report, sim: &rh_sim::Sim, fx: &Fixture, t: &FixTick) {
    if !enabled(fx) {
        if t.roam.is_some() {
            rep.fail("unexpected Fire roam diagnostics".into());
        }
        return;
    }
    let Some(expected) = &t.roam else {
        rep.fail(format!("tick {} missing Fire roam diagnostics", t.tick));
        return;
    };
    let expected = serde_json::Value::Array(expected.clone());
    let actual = crate::canon::rounded(json!(sim
        .fire_roam()
        .iter()
        .map(|r| json!({"id": fid(r.id), "charge": r.charge, "ready": r.ready}))
        .collect::<Vec<_>>()));
    if let Some(d) = crate::canon::first_difference("fire roam", &actual, &expected) {
        rep.fail(format!("tick {}: {d}", t.tick));
    }
}
