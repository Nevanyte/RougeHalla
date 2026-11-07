//! cardHooks.onHitLanded, the rows half: the owned cards' on-hit effects (Hemorrhage's bleed) after a landed hit.
//!
//! Source: `packages/server/src/sim/onHit.ts` (`runOnHit`). The weapon special (axe shred) stays in `systems::items`;
//! this module applies the card rows, quiet, with the source's tag and payload.
use crate::cards::CardRow;
use crate::content::DamageShares;
use crate::hooks::{HookArgs, Hx};
use crate::status_runtime::{AddValue, Payload, StatusApply, StatusKind, StatusSource, StatusTag};
use std::sync::Arc;

/// Fixed capacity for the owned cards' on-hit rows; a hit takes no allocation.
pub(crate) const MAX_ON_HIT_ROWS: usize = 8;

pub(crate) fn apply(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::HitLanded { ref entry, .. } = *args else {
        return;
    };
    let Some(by) = entry.by else { return };
    if entry.passive || entry.derived || entry.sig.is_some() || entry.weapon.is_none() || entry.dot
    {
        return;
    }
    let Some(victim_ix) = hx.w.fighter_idx(entry.victim) else {
        return;
    };
    if !hx.w.standing(victim_ix) {
        return;
    }
    let Some(by_ix) = hx.w.fighter_idx(by) else {
        return;
    };
    if !hx.w.is_player(by_ix) {
        return;
    }
    let weapon = entry.weapon.unwrap();
    let Some(name) = hx.w.roster.label(by).cloned() else {
        return;
    };
    let (k, hit, rows, n) = {
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
        // Fists of Fury: one more application while the active hand is empty. Third Time's the Charm: one more on every
        // third hit in a row on the same target (read at the pass start, so this tick's write cannot see itself).
        let w = &p.core.weapon;
        let hand_empty = (if w.slot == 0 { w.weapon0 } else { w.weapon1 }).is_none();
        let streak = crate::cards::streak_before(
            p.card_streak.as_ref(),
            hx.w.server_time,
            entry.victim,
            crate::constants::STREAK_GAP_MS,
        );
        let third =
            p.build.has_flag(crate::stat_fold::EffectFlag::ThirdCharm) && (streak + 1) % 3 == 0;
        let applications =
            1. + f64::from(u8::from(
                p.build.has_flag(crate::stat_fold::EffectFlag::TwiceUnarmed) && hand_empty,
            )) + f64::from(u8::from(third));
        (
            crate::content::on_hit_power(weapon) * applications,
            p.modifiers.hit_mult(),
            rows,
            n,
        )
    };
    let tick = hx.w.tick;
    let source = StatusSource {
        id: Some(by),
        name,
        owner_id: None,
    };
    for &(status, per, cap, ms) in &rows[..n] {
        if !(ms > 0.) {
            continue;
        }
        if status == StatusKind::Dot {
            // The hit as recorded, before the multipliers: the bleed is mitigated, and scaled by the attacker's rows and
            // the PvP factor, when it ticks. Its shares are physical.
            let raw = (entry.packet.raw / if hit > 0. { hit } else { 1. })
                * entry.scale
                * entry.packet.phys
                * per
                * k;
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
                entry.victim,
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
                entry.victim,
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
}
