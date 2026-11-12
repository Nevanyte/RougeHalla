//! cardHooks.onHitLanded and Best Offense's block hit: the victim's hitTaken triggers, then `runOnHit` (the weapon
//! special, the axe's shred, then the owned cards' on-hit rows such as Hemorrhage's bleed).
//!
//! Source: `packages/server/src/sim/cardHooks.ts` (`onHitLanded`, `onBlocked`), `packages/server/src/sim/onHit.ts`
//! (`runOnHit`). Every status is applied quiet, with the source's tag and payload.
use crate::cards::CardRow;
use crate::content::DamageShares;
use crate::hooks::{HookArgs, Hx};
use crate::status_runtime::{AddValue, Payload, StatusApply, StatusKind, StatusSource, StatusTag};
use std::sync::Arc;

/// Fixed capacity for the owned cards' on-hit rows; a hit takes no allocation.
pub(crate) const MAX_ON_HIT_ROWS: usize = 8;

/// Is the weapon a melee one (source `swings`: an arc weapon)?
fn swings(weapon: crate::content::WeaponId) -> bool {
    matches!(
        weapon,
        crate::content::WeaponId::Sword
            | crate::content::WeaponId::Axe
            | crate::content::WeaponId::Fists
    )
}

/// Source `hitTaken`: a player's hitTaken rows. Spiked Shell returns a share of the applied damage to the attacker as a
/// deferred physical hit carrying the victim's returned multiplier; the row's threshold is the share of max hp it needs.
fn hit_taken_rows(hx: &mut Hx, entry: &crate::systems::ledger::Entry, applied: f64) {
    let Some(victim) = hx.w.player(entry.victim) else {
        return;
    };
    let Some(max_hp) = Some(victim.vitals.max_hp).filter(|m| *m > 0.) else {
        return;
    };
    let Some(by) = entry.by else { return };
    let weapon = victim.core.active_weapon();
    let returned = victim.modifiers.returned_mult();
    let mut rows = [(0., crate::cards::TriggerAction::Cooldown { ms: 0. }); 4];
    let mut n = 0;
    for card in victim.build.cards() {
        for row in card.definition().rows {
            if let CardRow::Trigger(t) = row {
                if t.on == crate::cards::TriggerOn::HitTaken && n < rows.len() {
                    rows[n] = (t.arg, t.action);
                    n += 1;
                }
            }
        }
    }
    for &(arg, action) in &rows[..n] {
        if arg > 0. && !(applied >= arg * max_hp - 1e-9) {
            continue;
        }
        let (melee, share) = match action {
            crate::cards::TriggerAction::Return { melee, share } => (melee, share),
            crate::cards::TriggerAction::Boost { as_, move_, ms } => {
                let vix = hx.w.idx(entry.victim).unwrap();
                crate::cards::start_boost(&mut hx.w.players[vix], hx.w.server_time, as_, move_, ms);
                crate::modifiers::recompute(hx.k, hx.w, crate::fighter::FighterIx::of_slot(vix));
                continue;
            }
            crate::cards::TriggerAction::Status {
                to,
                status,
                ms,
                value,
            } => {
                let target = match to {
                    crate::cards::Side::Self_ => entry.victim,
                    crate::cards::Side::Target => by,
                };
                let Some(name) = hx.w.roster.label(entry.victim).cloned() else {
                    continue;
                };
                crate::systems::status::operations::apply_with(
                    hx.k,
                    hx.w,
                    hx.ev,
                    target,
                    crate::status_runtime::StatusApply {
                        kind: status,
                        source: crate::status_runtime::StatusSource {
                            id: Some(entry.victim),
                            name,
                            owner_id: None,
                        },
                        ms,
                        ability: None,
                        tag: Some(crate::status_runtime::StatusTag::Text(
                            std::sync::Arc::from("hitTaken"),
                        )),
                        value,
                        add: None,
                        data: None,
                    },
                    true,
                    hx.stats,
                );
                continue;
            }
            _ => continue,
        };
        if melee && !entry.weapon.is_some_and(swings) {
            continue;
        }
        let raw = share * applied * returned;
        if !(raw > 0.) {
            continue;
        }
        hx.w.deferred.defer_hit(crate::systems::ledger::Entry {
            terrain: false,
            dot: false,
            ability: None,
            arena: false,
            source: None,
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: by,
            by: Some(entry.victim),
            packet: crate::state::Packet {
                raw,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            weapon: Some(weapon),
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: true,
        });
    }
}

/// Source `cardHooks.onHitLanded` (in the pass). The entry's kind is the source `outgoingKindOf`: a damage-over-time tick
/// (a DoT signature or `dot`), then returned damage (Fire's backlash, or any `passive` entry: a riposte, Spiked Shell, a
/// reflected arrow), then a weapon hit (a weapon, no signature, no ability); anything else is no hit. A follow-on
/// (`derived`) and the arena's damage set off nothing. On a weapon hit the victim's hitTaken triggers run, then `runOnHit`
/// with `streak = true`; returned damage runs `runOnHit` with `streak = false`, and only for an Eye for an Eye holder.
pub(crate) fn apply(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::HitLanded { ref entry, amount } = *args else {
        return;
    };
    let Some(by) = entry.by else { return };
    if entry.arena || entry.derived {
        return;
    }
    let dot = entry.dot
        || entry
            .sig
            .is_some_and(crate::factions::SignatureKind::is_dot);
    let returned =
        !dot && (entry.passive || entry.sig == Some(crate::factions::SignatureKind::Backlash));
    let weapon_hit = !dot
        && !returned
        && entry.sig.is_none()
        && entry.ability.is_none()
        && entry.weapon.is_some();
    if !weapon_hit && !returned {
        return;
    }
    if hx.w.fighter_idx(by).is_none() {
        return;
    }
    if weapon_hit {
        hit_taken_rows(hx, entry, amount);
    } else if !hx
        .w
        .player(by)
        .is_some_and(|p| p.build.has_flag(crate::stat_fold::EffectFlag::EyeForAnEye))
    {
        // Returned damage applies the on-hit effects only for an Eye for an Eye holder.
        return;
    }
    run_on_hit(
        hx,
        by,
        entry.victim,
        entry.weapon,
        (entry.packet.raw, entry.packet.phys, entry.scale),
        weapon_hit,
    );
}

/// Source `cardHooks.onBlocked` under Best Offense (`blockHits`): the block is the holder's own blow with the weapon in
/// hand, `runOnHit(world, holder, attacker, {weapon, packet: packetFor(holder, weapon), scale: 1}, true)`, applied at once
/// (outside the ledger pass).
pub(crate) fn block_hit(
    hx: &mut Hx,
    holder: crate::PlayerId,
    victim: crate::PlayerId,
    weapon: crate::content::WeaponId,
) {
    let Some(p) = hx.w.player(holder) else { return };
    // Source packetFor: a fighter without a faction sheet has `{raw: 0, phys: 1}` (no panic on this hook path); otherwise
    // the hit multiplier is folded into raw (`hit === 1 ? base : base * hit`, `total * hit`).
    let (raw, phys) = if p.core.faction_id().is_some() {
        let hit = p.modifiers.hit_mult();
        let packet = crate::modifiers::packet(&p.core, weapon);
        let raw = if hit == 1. {
            packet.raw
        } else {
            packet.raw * hit
        };
        (raw, packet.phys)
    } else {
        (0., 1.)
    };
    run_on_hit(hx, holder, victim, Some(weapon), (raw, phys, 1.), true);
}

/// Source `onHit.ts runOnHit(world, attacker, victim, e, streak)`: `k = onHitPower(weapon) * onHitApplications(...,
/// streak)` (a player's Fists of Fury on an empty hand, Third Time's the Charm on every third hit in a row only when the
/// streak counts; 1 for an NPC), then the weapon special (the axe's shred, `armor * k`), then the player's card rows with
/// the hit multiplier stripped from a bleed only when the streak counts (`hit = streak ? hitMultOf : 1`). `packet` is the
/// entry's (raw, physical share, scale). An entry without a weapon has power 1 and no special (`spec?.onHitPower ?? 1`).
fn run_on_hit(
    hx: &mut Hx,
    by: crate::PlayerId,
    victim: crate::PlayerId,
    weapon: Option<crate::content::WeaponId>,
    packet: (f64, f64, f64),
    streak: bool,
) {
    if !hx.w.fighter_idx(victim).is_some_and(|i| hx.w.standing(i)) {
        return;
    }
    let player = hx.w.player(by);
    let applications = player.map_or(1., |p| {
        let w = &p.core.weapon;
        let hand_empty = (if w.slot == 0 { w.weapon0 } else { w.weapon1 }).is_none();
        let unarmed = p.build.has_flag(crate::stat_fold::EffectFlag::TwiceUnarmed) && hand_empty;
        // Read at the pass start, so this tick's streak write cannot see itself.
        let third = streak
            && p.build.has_flag(crate::stat_fold::EffectFlag::ThirdCharm)
            && (crate::cards::streak_before(
                p.card_streak.as_ref(),
                hx.w.server_time,
                victim,
                crate::constants::STREAK_GAP_MS,
            ) + 1)
                % 3
                == 0;
        1. + f64::from(u8::from(unarmed)) + f64::from(u8::from(third))
    });
    let k = weapon.map_or(
        crate::constants::PLAIN_ON_HIT_POWER,
        crate::content::on_hit_power,
    ) * applications;
    let Some(name) = hx.w.actor_label(by) else {
        return;
    };
    if hx.k.config.weapon_specials && weapon == Some(crate::content::WeaponId::Axe) {
        crate::systems::status::operations::apply_with(
            hx.k,
            hx.w,
            hx.ev,
            victim,
            StatusApply {
                kind: StatusKind::Shred,
                source: StatusSource {
                    id: Some(by),
                    name: name.clone(),
                    owner_id: None,
                },
                ms: crate::constants::AXE_SHRED_MS,
                ability: None,
                tag: Some(StatusTag::Axe),
                value: None,
                add: Some(AddValue {
                    per: crate::constants::AXE_SHRED_ARMOR * k,
                    cap: crate::constants::AXE_SHRED_CAP,
                }),
                data: None,
            },
            true,
            hx.stats,
        );
    }
    let Some(p) = hx.w.player(by) else { return };
    let mut rows = [(StatusKind::Dot, 0., None, 0.); MAX_ON_HIT_ROWS];
    let mut n = 0;
    for id in p.build.cards() {
        for row in id.definition().rows {
            if let CardRow::OnHit(o) = row {
                if n < rows.len() {
                    rows[n] = (o.status, o.per, o.cap, o.ms);
                    n += 1;
                }
            }
        }
    }
    let hit = if streak { p.modifiers.hit_mult() } else { 1. };
    let (raw, phys, scale) = packet;
    // The hit as recorded, before the multipliers (the bleed is mitigated, and scaled by the attacker's rows and the PvP
    // factor, when it ticks); its physical share.
    let base = (raw / if hit > 0. { hit } else { 1. }) * scale * phys;
    apply_rows(hx, by, victim, name, &rows[..n], k, base);
}

/// Source `runOnHit`'s card rows: each owned on-hit row applied quietly to `victim` with the source's tag and payload.
/// `base` is the source's `(packet.raw / hit) * scale * packet.phys` (a bleed's raw is `base * per * k`).
fn apply_rows(
    hx: &mut Hx,
    by: crate::PlayerId,
    victim: crate::PlayerId,
    name: Arc<str>,
    rows: &[(StatusKind, f64, Option<f64>, f64)],
    k: f64,
    base: f64,
) {
    let tick = hx.w.tick;
    let source = StatusSource {
        id: Some(by),
        name,
        owner_id: None,
    };
    for &(status, per, cap, ms) in rows {
        if !(ms > 0.) {
            continue;
        }
        if status == StatusKind::Dot {
            // The hit as recorded, before the multipliers: the bleed is mitigated, and scaled by the attacker's rows and
            // the PvP factor, when it ticks. Its shares are physical.
            let raw = base * per * k;
            if !(raw > 0.) {
                continue;
            }
            let apply = StatusApply {
                kind: status,
                source: source.clone(),
                ms,
                ability: None,
                tag: Some(StatusTag::Text(Arc::from(format!("bleed:{tick}")))),
                value: None,
                add: Some(AddValue {
                    per: raw / (ms / 1000.),
                    cap: f64::MAX,
                }),
                data: Some(Payload {
                    shares: Some(DamageShares {
                        phys: 1.,
                        magic: 0.,
                        true_: 0.,
                    }),
                    ..Default::default()
                }),
            };
            crate::systems::status::operations::apply_with(
                hx.k,
                hx.w,
                hx.ev,
                victim,
                apply,
                true,
                Default::default(),
            );
        } else {
            let apply = StatusApply {
                kind: status,
                source: source.clone(),
                ms,
                ability: None,
                tag: Some(StatusTag::Text(Arc::from(format!(
                    "onHit:{}",
                    status_name(status)
                )))),
                value: None,
                add: Some(AddValue {
                    per: per * k,
                    cap: cap.unwrap_or(f64::MAX),
                }),
                data: None,
            };
            crate::systems::status::operations::apply_with(
                hx.k,
                hx.w,
                hx.ev,
                victim,
                apply,
                true,
                Default::default(),
            );
        }
    }
}

fn status_name(kind: StatusKind) -> &'static str {
    match kind {
        StatusKind::Stun => "stun",
        StatusKind::Root => "root",
        StatusKind::Silence => "silence",
        StatusKind::SlowMove => "slowMove",
        StatusKind::SlowAttack => "slowAttack",
        StatusKind::AntiHeal => "antiHeal",
        StatusKind::Dot => "dot",
        StatusKind::Invulnerable => "invulnerable",
        StatusKind::Untargetable => "untargetable",
        StatusKind::Hidden => "hidden",
        StatusKind::Zoned => "zoned",
        StatusKind::DeathFloor => "deathFloor",
        StatusKind::Haste => "haste",
        StatusKind::Shred => "shred",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::WeaponId;
    use crate::state::Packet;
    use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    #[test]
    fn a_returned_hit_procs_on_hit_only_with_eye_for_an_eye() {
        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        );
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::Hemorrhage
        ));
        let mut ev = Vec::new();
        let entry = crate::systems::ledger::Entry {
            terrain: false,
            dot: false,
            ability: None,
            arena: false,
            source: None,
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            packet: Packet {
                raw: 100.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            weapon: Some(WeaponId::Sword),
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: true,
        };
        {
            let mut hx = crate::hooks::Hx {
                stats: Default::default(),
                fx: None,
                k: &sim.k,
                w: &mut sim.w,
                ev: &mut ev,
            };
            apply(
                &mut hx,
                &crate::hooks::HookArgs::HitLanded {
                    entry: entry.clone(),
                    amount: 100.,
                },
            );
        }
        let bleed = |w: &crate::state::World| {
            w.player(PlayerId(2))
                .unwrap()
                .statuses
                .instances
                .iter()
                .any(|s| {
                    matches!(
                        &s.tag,
                        Some(crate::status_runtime::StatusTag::Text(t)) if t.starts_with("bleed")
                    )
                })
        };
        assert!(!bleed(&sim.w), "no Eye for an Eye holds no returned on-hit");
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::EyeForAnEye
        ));
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        apply(
            &mut hx,
            &crate::hooks::HookArgs::HitLanded {
                entry,
                amount: 100.,
            },
        );
        assert!(bleed(hx.w), "the returned hit procs the bleed");
    }

    #[test]
    fn hemorrhage_applies_a_physical_bleed_from_a_landed_hit() {
        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        );
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::Hemorrhage
        ));
        let mut ev = Vec::new();
        let entry = crate::systems::ledger::Entry {
            terrain: false,
            dot: false,
            ability: None,
            arena: false,
            source: None,
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            packet: Packet {
                raw: 100.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            weapon: Some(WeaponId::Sword),
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        };
        let now = sim.w.server_time;
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        apply(
            &mut hx,
            &crate::hooks::HookArgs::HitLanded {
                entry,
                amount: 100.,
            },
        );
        let victim = hx.w.player(PlayerId(2)).unwrap();
        let dot = victim
            .core
            .statuses
            .instances
            .iter()
            .find(|s| s.kind == StatusKind::Dot && s.source.id == Some(PlayerId(1)))
            .expect("hemorrhage bleed");
        // raw 100, hit mult 1, scale 1, phys 1, per 0.1, sword on-hit power 1.5 => 15 over 2 s, i.e. 7.5 per second.
        assert!((dot.value - 7.5).abs() < 1e-9, "value {}", dot.value);
        // Server time is milliseconds; the bleed lasts the row's 2000 ms.
        assert!((dot.until - (now + 2000.)).abs() < 1e-9);
        assert_eq!(dot.data.shares.unwrap().phys, 1.);
        assert!(dot.tag.as_ref().unwrap().as_str().starts_with("bleed:"));
    }

    #[test]
    fn fists_of_fury_doubles_the_on_hit_rows_while_unarmed() {
        use crate::content::WeaponId;
        use crate::state::Packet;
        use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        );
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::Hemorrhage
        ));
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::FistsOfFury
        ));
        let mut ev = Vec::new();
        let entry = crate::systems::ledger::Entry {
            terrain: false,
            dot: false,
            ability: None,
            arena: false,
            source: None,
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            packet: Packet {
                raw: 100.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            weapon: Some(WeaponId::Fists),
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        };
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        apply(
            &mut hx,
            &crate::hooks::HookArgs::HitLanded {
                entry,
                amount: 100.,
            },
        );
        let victim = hx.w.player(PlayerId(2)).unwrap();
        let dot = victim
            .core
            .statuses
            .instances
            .iter()
            .find(|s| s.kind == StatusKind::Dot && s.source.id == Some(PlayerId(1)))
            .expect("hemorrhage bleed");
        // fists 1.2 x two applications, per 0.1: 100 * 0.1 * 2.4 = 24 over 2 s = 12 per second.
        assert!((dot.value - 12.).abs() < 1e-9, "value {}", dot.value);
    }

    #[test]
    fn third_times_the_charm_doubles_every_third_streak_hit() {
        use crate::content::WeaponId;
        use crate::state::Packet;
        use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        );
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::Hemorrhage
        ));
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::ThirdTimesTheCharm
        ));
        let now = sim.w.server_time;
        let by_ix = sim.w.idx(PlayerId(1)).unwrap();
        sim.w.players[by_ix].card_streak = Some(crate::cards::Streak {
            target: PlayerId(2),
            count: 2,
            last: now,
        });
        let mut ev = Vec::new();
        let entry = crate::systems::ledger::Entry {
            terrain: false,
            dot: false,
            ability: None,
            arena: false,
            source: None,
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            packet: Packet {
                raw: 100.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            weapon: Some(WeaponId::Sword),
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        };
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        apply(
            &mut hx,
            &crate::hooks::HookArgs::HitLanded {
                entry,
                amount: 100.,
            },
        );
        let victim = hx.w.player(PlayerId(2)).unwrap();
        let dot = victim
            .core
            .statuses
            .instances
            .iter()
            .find(|s| s.kind == StatusKind::Dot && s.source.id == Some(PlayerId(1)))
            .expect("hemorrhage bleed");
        // Third hit in the row: sword 1.5 x 2 applications, per 0.1 => 100 * 0.1 * 3 = 30 over 2 s = 15 per second.
        assert!((dot.value - 15.).abs() < 1e-9, "value {}", dot.value);
    }

    #[test]
    fn spiked_shell_returns_a_share_of_the_applied_damage() {
        use crate::content::WeaponId;
        use crate::state::Packet;
        use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        );
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(2),
            crate::cards::CardId::SpikedShell
        ));
        let mut ev = Vec::new();
        let entry = crate::systems::ledger::Entry {
            terrain: false,
            dot: false,
            ability: None,
            arena: false,
            source: None,
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            packet: Packet {
                raw: 100.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            weapon: Some(WeaponId::Sword),
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        };
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        apply(
            &mut hx,
            &crate::hooks::HookArgs::HitLanded {
                entry,
                amount: 100.,
            },
        );
        let deferred = hx.w.deferred.hits.pop().expect("a returned hit");
        assert_eq!(deferred.victim, PlayerId(1));
        assert_eq!(deferred.by, Some(PlayerId(2)));
        assert_eq!(deferred.weapon, Some(WeaponId::Fists));
        assert!(deferred.passive);
        // share 0.15 of the 100 applied, times the (default 1) returned multiplier.
        assert!(
            (deferred.packet.raw - 15.).abs() < 1e-9,
            "raw {}",
            deferred.packet.raw
        );
        assert_eq!(deferred.packet.phys, 1.);
    }

    #[test]
    fn adrenaline_boosts_attack_and_move_speed_on_a_hit_taken() {
        use crate::content::WeaponId;
        use crate::state::Packet;
        use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        );
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(2),
            crate::cards::CardId::Adrenaline
        ));
        let i = sim.w.idx(PlayerId(2)).unwrap();
        let before_as = sim.w.players[i].modifiers.mirrors().as_mult;
        let now = sim.w.server_time;
        let mut ev = Vec::new();
        let entry = crate::systems::ledger::Entry {
            terrain: false,
            dot: false,
            ability: None,
            arena: false,
            source: None,
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            packet: Packet {
                raw: 200.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            weapon: Some(WeaponId::Sword),
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        };
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        apply(
            &mut hx,
            &crate::hooks::HookArgs::HitLanded {
                entry,
                amount: 200.,
            },
        );
        let p = hx.w.player(PlayerId(2)).unwrap();
        assert!((p.card_boost.as_mult - 1.4).abs() < 1e-9);
        assert!((p.card_boost.move_mult - 1.4).abs() < 1e-9);
        assert!((p.card_boost.until - (now + 2000.)).abs() < 1e-9);
        assert!(
            p.modifiers.mirrors().as_mult > before_as,
            "the fold includes the boost"
        );
    }
}
