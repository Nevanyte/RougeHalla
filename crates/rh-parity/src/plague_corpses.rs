//! Exact Plague corpse/zombie source diagnostics: markers, harvested stacks, owned companions.
use crate::{fid, FixTick, Fixture, Report};
use serde_json::json;

pub(super) fn enabled(fx: &Fixture) -> bool {
    fx.packet.as_deref() == Some("P-FACTION-3")
        && fx.parity == "slice"
        && fx.legacy_config.rust_slice.as_deref() == Some("plague-corpses/1")
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
        "plagueCorpses",
        "plagueZombies",
        "mods",
    ];
    fx.legacy_config
        .modules
        .as_ref()
        .is_some_and(|m| m.iter().map(String::as_str).eq(expected))
}

fn status_name(s: rh_sim::Status) -> &'static str {
    match s {
        rh_sim::Status::Lobby => "lobby",
        rh_sim::Status::Alive => "alive",
        rh_sim::Status::Dead => "dead",
        rh_sim::Status::Mia => "mia",
    }
}

pub(super) fn compare(rep: &mut Report, sim: &rh_sim::Sim, fx: &Fixture, t: &FixTick) {
    if !enabled(fx) {
        if t.corpses.is_some() {
            rep.fail("unexpected Plague-corpse diagnostics".into());
        }
        return;
    }
    let Some(expected) = &t.corpses else {
        rep.fail(format!("tick {} missing Plague-corpse diagnostics", t.tick));
        return;
    };
    let corpses = sim
        .plague_corpses()
        .iter()
        .map(|c| json!({ "player": fid(c.player), "x": c.x, "y": c.y }))
        .collect::<Vec<_>>();
    let by_player = sim
        .players()
        .iter()
        .map(|p| {
            json!({
                "id": fid(p.id),
                "corpseStacks": p.farm.corpse_stacks(),
            })
        })
        .collect::<Vec<_>>();
    let zombies = sim
        .mobs()
        .iter()
        .filter(|m| m.zombie.is_some())
        .map(|m| {
            let rt = m.zombie.as_ref().unwrap();
            let owner = m.owner.map(fid).unwrap_or_default();
            json!({
                "id": format!("pz:{owner}"),
                "owner": owner,
                "x": m.core.body.x,
                "y": m.core.body.y,
                "hp": m.core.vitals.hp,
                "maxHp": m.core.vitals.max_hp,
                "status": status_name(m.status),
                "target": rt.target.map(fid).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    let actual = crate::canon::rounded(json!({
        "corpses": corpses,
        "corpsesByPlayer": by_player,
        "zombies": zombies,
    }));
    if let Some(d) = crate::canon::first_difference("corpses", &actual, expected) {
        rep.fail(format!("tick {}: {d}", t.tick));
    }
}

pub(super) fn preflight(fx: &Fixture) -> Vec<String> {
    if !enabled(fx) {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if !fx.scenario.starts_with("corpse_") {
        errors.push("Plague-corpse provenance requires the explicit corpse_ prefix".into());
    }
    if fx.ticks.is_empty() || fx.inputs.is_empty() || fx.requires.is_empty() {
        errors.push(
            "Plague-corpse inventory requires nonempty ticks, inputs and requirements".into(),
        );
    }
    errors
}
