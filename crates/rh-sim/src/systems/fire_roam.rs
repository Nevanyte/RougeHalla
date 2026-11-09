//! Fire's out-of-combat roaming ramp and the charged burst (source `sim/fireRoam.ts`, `shared/fireRoam.ts`).
//!
//! The module owns one private per-player clock/flag (the source runtime's `lastCombatAt` map and the synced
//! `roamReady` flag): charge fills from 1x to 1.5x movement over 20 s out of combat, positive damage dealt or taken
//! restarts the ramp, and the armed burst is an independent flag that a landed direct weapon auto consumes once for
//! `50 + 0.4 x bonus Offense` physical damage. The synced charge mirror is presentation-only and this slice adds no
//! wire field (see the evidence README); the authoritative movement speed reaches clients through the positions the
//! server walks, and the burst as the next tick's derived ledger hit.
use super::{ledger::Entry, Cx};
use crate::{
    constants::*,
    fighter::FighterCore,
    hooks::{HookArgs, Hx},
    state::{Packet, Status, World},
};

/// Trusted private Fire roam state for one player (source runtime `lastCombatAt` + `PlayerState.roamReady`).
/// The charge value itself is derived from the clock (the source syncs the derived mirror; this slice does not).
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Roam {
    /// Server ms of the last positive damage dealt or taken; None while the source would drop the runtime entry.
    pub(crate) last_combat_at: Option<f64>,
    /// The armed burst flag; independent of the charge clock (source docs: it survives combat resets).
    pub(crate) ready: bool,
}

/// Charge in 0..=CHARGE_MAX after this much time out of combat (source `fireRoamCharge`).
pub(crate) fn charge(elapsed_ms: f64) -> f64 {
    let fraction = (elapsed_ms / FIRE_ROAM_RAMP_MS).clamp(0., 1.);
    (fraction * FIRE_ROAM_CHARGE_MAX).floor()
}

/// Movement multiplier for a charge value in 0..=CHARGE_MAX (source `fireRoamSpeedMult`).
pub(crate) fn speed_mult(charge_value: f64) -> f64 {
    let fraction = (charge_value / FIRE_ROAM_CHARGE_MAX).clamp(0., 1.);
    1. + (FIRE_ROAM_MAX_SPEED_MULT - 1.) * fraction
}

/// The charged burst's raw physical damage (source `fireRoamBurstDamage`: the current legacy behaviour scales with
/// bonus Offense, not the stale AP wording in docs/FIRE_ROAM.md; the owner question is flagged in the evidence).
pub(crate) fn burst_damage(offense: f64) -> f64 {
    FIRE_ROAM_BURST_BASE + FIRE_ROAM_BURST_AD_SHARE * offense.max(0.)
}

/// Source system `update` (`world.systems.unshift`): run first, so the mirrors folded at the end of the tick carry this
/// tick's charge. A non-Fire, non-alive or non-active-run player keeps the default state.
pub(crate) fn update(cx: &mut Cx) {
    let now = cx.w.server_time;
    let active = cx.w.phase == crate::Phase::Active;
    for i in 0..cx.w.players.len() {
        let p = &mut cx.w.players[i];
        if p.vitals.faction != crate::FactionId::Fire || p.status != Status::Alive || !active {
            p.roam = Roam::default();
            continue;
        }
        let last = p.roam.last_combat_at.unwrap_or(now);
        p.roam.last_combat_at = Some(last);
        let elapsed = (now - last).max(0.);
        if elapsed >= FIRE_ROAM_RAMP_MS {
            p.roam.ready = true;
        }
    }
}

/// Source mod source `roamingSpeed`: the movement speed multiplier a Fire player's charge currently gives. It reads the
/// same clock the update system maintains, so the fold after the update carries the tick's charge.
pub(crate) fn roaming_speed(
    w: &World,
    core: &FighterCore,
    _stats: crate::schedule::ModSourceInputs,
) -> Option<crate::schedule::ModContribution> {
    if w.phase != crate::Phase::Active {
        return None;
    }
    let p = w.player(core.id)?;
    if p.vitals.faction != crate::FactionId::Fire || p.status != Status::Alive {
        return None;
    }
    let elapsed = (w.server_time - p.roam.last_combat_at?).max(0.);
    Some(crate::schedule::ModContribution {
        speed_mult: Some(speed_mult(charge(elapsed))),
        ..Default::default()
    })
}

/// Source `attackStarted` link: while a Fire player is armed, the packet of every attack it starts is remembered so a
/// later landed direct auto can consume the burst. The action carries the mark to the melee request or projectile.
pub(crate) fn attack_started(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::AttackStarted(id) = *args else {
        return;
    };
    if hx.w.phase != crate::Phase::Active {
        return;
    }
    let Some(i) = hx.w.idx(id) else {
        return;
    };
    let p = &mut hx.w.players[i];
    if p.vitals.faction != crate::FactionId::Fire || p.status != Status::Alive || !p.roam.ready {
        return;
    }
    if let Some(a) = &mut p.weapon.action {
        a.roam_armed = true;
    }
}

/// Source `hurt` link: damage actually taken restarts the ramp (never the armed flag).
pub(crate) fn hurt(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::Hurt { id, .. } = *args else {
        return;
    };
    let Some(i) = hx.w.idx(id) else {
        return;
    };
    let now = hx.w.server_time;
    let p = &mut hx.w.players[i];
    if p.vitals.faction == crate::FactionId::Fire {
        p.roam.last_combat_at = Some(now);
    }
}

/// Does the source count this ledger entry as a direct weapon auto for the charged burst? (`eligibleAuto`.)
fn eligible_auto(e: &Entry) -> bool {
    e.weapon.is_some()
        && e.ability.is_none()
        && e.sig.is_none()
        && !e.dot
        && !e.passive
        && !e.derived
        && !e.arena
}

/// Source `hitLanded` link: a hit a Fire player deals restarts the ramp; a landed direct weapon auto consumes the armed
/// burst once, queued for the next tick's ledger as a derived physical hit of `50 + 0.4 x` bonus Offense.
pub(crate) fn hit_landed(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::HitLanded { entry, .. } = args else {
        return;
    };
    let Some(by) = entry.by else {
        return;
    };
    let Some(i) = hx.w.idx(by) else {
        return;
    };
    let now = hx.w.server_time;
    let p = &mut hx.w.players[i];
    if p.vitals.faction != crate::FactionId::Fire {
        return;
    }
    p.roam.last_combat_at = Some(now);
    if !eligible_auto(entry) {
        return;
    }
    // The source remembers the exact attack packet armed at its start. A projectile carries that mark across the ticks
    // it flies; a melee auto starts and lands in the same weapons phase, so its owner's current armed flag is the start
    // state (nothing can change it between the two).
    let armed = match entry.projectile {
        Some(projectile) => {
            hx.w.projectiles
                .iter()
                .find(|pr| pr.launch.id == projectile)
                .is_some_and(|pr| pr.roam_armed)
        }
        None => true,
    };
    if !armed || !p.roam.ready {
        return;
    }
    let p = &mut hx.w.players[i];
    p.roam.ready = false;
    if hx.w.fighter_idx(entry.victim).is_none() {
        return;
    }
    let raw = burst_damage(hx.w.players[i].modifiers.mirrors().ad_bonus);
    if !(raw > 0.) {
        return;
    }
    hx.w.deferred.defer_hit(Entry {
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim: entry.victim,
        by: Some(by),
        packet: Packet {
            raw,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        },
        weapon: None,
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: true,
        passive: false,
    });
}

/// Source `raidStarted` link: every seat starts its ramp now and disarms; the source replaces its armed-packet map.
pub(crate) fn raid_started(hx: &mut Hx, args: &HookArgs) {
    if *args != HookArgs::RaidStarted {
        return;
    }
    let now = hx.w.server_time;
    for p in hx.w.players.iter_mut() {
        p.roam = Roam {
            last_combat_at: Some(now),
            ready: false,
        };
        if let Some(a) = &mut p.weapon.action {
            a.roam_armed = false;
        }
    }
    for pr in hx.w.projectiles.iter_mut() {
        pr.roam_armed = false;
    }
}

/// Source `fighterOut` link: a departed fighter's runtime entry is forgotten.
pub(crate) fn fighter_out(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::FighterOut { id, .. } = *args else {
        return;
    };
    if let Some(i) = hx.w.idx(id) {
        hx.w.players[i].roam = Roam::default();
    }
}

/// Source `runEnded` link: no charge or armed burst survives the run.
pub(crate) fn run_ended(hx: &mut Hx, args: &HookArgs) {
    if *args != HookArgs::RunEnded {
        return;
    }
    for p in hx.w.players.iter_mut() {
        p.roam = Roam::default();
    }
}

impl crate::Sim {
    /// Trusted diagnostics of every player's Fire roaming state, in join order (never an observation; the wire mirror is
    /// not part of this slice).
    pub fn fire_roam(&self) -> Vec<crate::FireRoamState> {
        let now = self.w.server_time;
        self.w
            .players
            .iter()
            .map(|p| crate::FireRoamState {
                id: p.id,
                // The source's synced mirror is zeroed by the update system for a non-Fire seat (the private clock can
                // still be seeded by the raid-start hook until the next update, which is never observed here).
                charge: if p.vitals.faction == crate::FactionId::Fire {
                    p.roam
                        .last_combat_at
                        .map_or(0., |last| charge((now - last).max(0.)))
                } else {
                    0.
                },
                ready: p.roam.ready,
            })
            .collect()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn helpers() -> Value {
        serde_json::from_str(include_str!("../../../../parity/fire-roam/helpers.json"))
            .expect("the actual-export helper fixture parses")
    }

    #[test]
    fn actual_exported_helpers_and_constants_match() {
        let v = helpers();
        assert_eq!(v["format"], "rh-fire-roam-actual-export-probes/1");
        assert_eq!(v["provenance"]["node"], "v22.23.4");
        assert_eq!(v["provenance"]["platform"], "linux");
        assert_eq!(v["provenance"]["arch"], "x64");
        let c = &v["constants"];
        assert_eq!(c["rampMs"].as_f64(), Some(FIRE_ROAM_RAMP_MS));
        assert_eq!(c["chargeMax"].as_f64(), Some(FIRE_ROAM_CHARGE_MAX));
        assert_eq!(c["maxSpeedMult"].as_f64(), Some(FIRE_ROAM_MAX_SPEED_MULT));
        assert_eq!(c["burstBase"].as_f64(), Some(FIRE_ROAM_BURST_BASE));
        assert_eq!(c["burstAdShare"].as_f64(), Some(FIRE_ROAM_BURST_AD_SHARE));
        for row in v["charge"].as_array().expect("charge cases") {
            let elapsed = row["elapsedMs"].as_f64().expect("elapsed");
            assert_eq!(
                charge(elapsed),
                row["value"].as_f64().expect("charge value"),
                "charge({elapsed})"
            );
        }
        for row in v["speed"].as_array().expect("speed cases") {
            let value = row["charge"].as_f64().expect("charge");
            assert_eq!(
                speed_mult(value),
                row["value"].as_f64().expect("speed value"),
                "speed_mult({value})"
            );
        }
        for row in v["burst"].as_array().expect("burst cases") {
            let offense = row["offense"].as_f64().expect("offense");
            assert_eq!(
                burst_damage(offense),
                row["value"].as_f64().expect("burst value"),
                "burst_damage({offense})"
            );
        }
    }

    #[test]
    fn the_ramp_and_charge_boundaries_are_the_source_ones() {
        assert_eq!(charge(-50.), 0.);
        assert_eq!(charge(0.), 0.);
        assert_eq!(charge(19.999), 0.);
        assert_eq!(charge(20.), 1.);
        assert_eq!(charge(10_000.), 500.);
        assert_eq!(charge(20_000.), 1000.);
        assert_eq!(charge(1_000_000.), 1000.);
        assert_eq!(speed_mult(0.), 1.);
        assert_eq!(speed_mult(500.), 1.25);
        assert_eq!(speed_mult(1000.), 1.5);
        assert_eq!(speed_mult(5000.), 1.5);
        assert_eq!(burst_damage(-10.), 50.);
        assert_eq!(burst_damage(0.), 50.);
        assert_eq!(burst_damage(100.), 90.);
    }
}
