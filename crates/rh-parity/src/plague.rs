//! Strict provenance and complete trusted diagnostics for the bounded Plague installation.
use crate::{fid, FixTick, Fixture, Report};
use serde_json::{json, Value};
pub(super) fn enabled(fx: &Fixture) -> bool {
    super::fire_roam::enabled(fx)
        || (fx.packet.as_deref() == Some("P-FACTION-1")
            && fx.parity == "slice"
            && matches!(
                fx.legacy_config.rust_slice.as_deref(),
                Some(
                    "player-engagement-holy-plague/1"
                        | "player-engagement-holy-plague-fire/1"
                        | "player-engagement-holy-plague-fire-frost/1"
                        | "player-engagement-holy-plague-fire-frost-sentenced/1"
                )
            ))
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
    fx.players.iter().all(|p| {
        matches!(p.faction.as_str(), "holy" | "plague" | "fire")
            || (frost(fx) && p.faction == "frost")
            || (super::sentenced::enabled(fx) && p.faction == "sentenced")
    }) && fx
        .legacy_config
        .modules
        .as_ref()
        .is_some_and(|m| m.iter().map(String::as_str).eq(expected))
}
pub(super) fn compare(rep: &mut Report, sim: &rh_sim::Sim, fx: &Fixture, t: &FixTick) {
    if !enabled(fx) {
        if t.plague.is_some() {
            rep.fail("unexpected Plague diagnostics".into());
        }
        return;
    }
    let Some(expected) = &t.plague else {
        rep.fail(format!("tick {} missing Plague diagnostics", t.tick));
        return;
    };
    let raw=sim.damage_entries().iter().map(|e|json!({"victim":fid(e.victim),"by":e.by.map(fid),"raw":e.raw,"scale":e.scale,"weapon":e.weapon.map(|w|w.as_str()),"sig":e.sig.map(|s|s.as_str()),"execute":e.execute,"phys":e.phys,"magic":e.magic,"true_":e.true_})).collect::<Vec<_>>();
    let landed=sim.landed_hits().iter().map(|h|json!({"victim":fid(h.victim),"by":h.by.map(fid),"amount":h.amount,"sig":h.sig.map(|s|s.as_str()),"weapon":h.weapon.map(|w|w.as_str())})).collect::<Vec<_>>();
    let rt = sim.faction_runtime();
    let buckets=rt.dot.iter().map(|b|json!({"victim":fid(b.victim),"by":fid(b.by),"sig":b.sig.as_str(),"weapon":b.weapon.map(|w|w.as_str()),"amount":b.amount})).collect::<Vec<_>>();
    let fighters=sim.players().iter().map(|p|{let f=&p.signature;json!({"id":fid(p.id),"target":f.target.map(fid),"inReach":f.in_reach,"engaged":f.engaged,"reachAt":f.reach_at,"contactAt":f.contact_at,"combatAt":f.combat_at,"hpFrac":f.hp_frac,"pause":f.dot_paused_until,"bits":f.bits})}).collect::<Vec<_>>();
    let mut actual = crate::canon::rounded(
        json!({"raw":raw,"landed":landed,"dotSince":rt.dot_since,"buckets":buckets,"fighters":fighters}),
    );
    if fire(fx) {
        actual["performed"] = json!(sim
            .performed_attacks()
            .iter()
            .map(|a| json!({"by":fid(a.by),"weapon":a.weapon.as_str()}))
            .collect::<Vec<_>>());
    }
    if let Some(d) = crate::canon::first_difference("plague", &actual, expected) {
        rep.fail(format!("tick {}: {d}", t.tick));
    }
    let _ = Value::Null;
}

pub(super) fn fire(fx: &Fixture) -> bool {
    enabled(fx)
        && matches!(
            fx.legacy_config.rust_slice.as_deref(),
            Some(
                "player-engagement-holy-plague-fire/1"
                    | "player-engagement-holy-plague-fire-frost/1"
                    | "player-engagement-holy-plague-fire-frost-sentenced/1"
                    | super::fire_roam::SLICE
            )
        )
}

pub(super) fn frost(fx: &Fixture) -> bool {
    enabled(fx)
        && fx.legacy_config.rust_slice.as_deref().is_some_and(|s| {
            matches!(
                s,
                "player-engagement-holy-plague-fire-frost/1"
                    | "player-engagement-holy-plague-fire-frost-sentenced/1"
            )
        })
}
