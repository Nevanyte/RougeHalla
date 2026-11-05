//! Strict diagnostics of the bounded player-engagement/Holy module set.
use crate::{fid, FixTick, Fixture, Report};
use serde_json::{json, Value};
pub(super) fn enabled(fx: &Fixture) -> bool {
    fx.packet.as_deref() == Some("P-FACTION-1")
        && fx.parity == "slice"
        && fx.legacy_config.rust_slice.as_deref() != Some("player-engagement-holy-plague/1")
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
        "mods",
    ];
    let full = [
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
        "consumables",
        "traders",
        "cardHooks",
        "plagueCorpses",
        "fireRoam",
        "bruiserPassives",
        "sentencedHunt",
        "mods",
        "plagueZombies",
    ];
    let expected: &[&str] = if fx.scenario == "signature_holy" {
        &full
    } else {
        &expected
    };
    fx.players.iter().all(|p| p.faction == "holy")
        && fx
            .legacy_config
            .modules
            .as_ref()
            .is_some_and(|m| m.iter().map(String::as_str).eq(expected.iter().copied()))
}
pub(super) fn compare(rep: &mut Report, sim: &rh_sim::Sim, fx: &Fixture, t: &FixTick) {
    if !enabled(fx) && t.signatures.is_none() && t.landed.is_none() {
        return;
    }
    if fx.scenario == "signature_holy" {
        // Full installers are safe for precisely this captured Holy-only, death-free window.
        // Their actual live state is recorded, not inferred from faction labels alone.
        let players=sim.players().iter().map(|p|json!({"id":fid(p.id),"faction":"holy","status":"alive","roamCharge":0,"roamReady":false,"frostEliteGuard":false,"campClears":0,"corpseStacks":0,"plagueZombieId":"","huntTarget":"","huntStacks":0})).collect::<Vec<_>>();
        let expected = json!({"corpses":0,"mobs":0,"containers":0,"players":players});
        if fx.ticks.len() != 160
            || sim.players().iter().any(|p| !p.standing())
            || t.holy_inactive.as_ref() != Some(&expected)
        {
            rep.fail(format!(
                "tick {}: full Holy installer inactivity proof failed",
                t.tick
            ));
        }
    } else if t.holy_inactive.is_some() {
        rep.fail("unexpected full Holy inactivity proof".into());
    }
    let sig=sim.players().iter().map(|p| {let f=&p.signature;json!({"id":fid(p.id),"target":f.target.map(fid),"inReach":f.in_reach,"engaged":f.engaged,"reachAt":f.reach_at,"contactAt":f.contact_at,"combatAt":f.combat_at,"hpFrac":f.hp_frac})}).collect::<Vec<_>>();
    let landed = sim
        .landed_hits()
        .iter()
        .map(|h| json!({"victim":fid(h.victim),"by":h.by.map(fid),"amount":h.amount}))
        .collect::<Vec<_>>();
    for (name, actual, expected) in [
        ("signatures", sig, &t.signatures),
        ("landed", landed, &t.landed),
    ] {
        let Some(expected) = expected else {
            rep.fail(format!(
                "tick {}: missing required {name} diagnostics",
                t.tick
            ));
            continue;
        };
        if let Some(diff) = crate::canon::first_difference(
            name,
            &crate::canon::rounded(Value::Array(actual)),
            &Value::Array(expected.clone()),
        ) {
            rep.fail(format!("tick {}: {diff}", t.tick));
        }
    }
}
