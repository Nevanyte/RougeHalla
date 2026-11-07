//! cardHooks.onOverkilled: Overkill's splash — the pass killed a victim with damage to spare, and a share of each
//! contributing hit goes to the nearest hostile within the card's radius of the victim, queued for the next tick's ledger.
//!
//! Source: `packages/server/src/sim/cardHooks.ts` (`onOverkilled`/`splashOverkill`). The request is recorded during the pass
//! and resolved after it (who still stands is settled) by the after-damage system.
use crate::cards::{CardRow, SplashReq, TriggerAction, TriggerOn};
use crate::hooks::{HookArgs, Hx};

pub(crate) fn on_overkilled(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::Overkilled {
        victim,
        hits,
        overkill,
        total,
    } = args
    else {
        return;
    };
    if !(*total > 0.) || !(*overkill > 0.) {
        return;
    }
    let Some(at) = hx.w.actor(*victim).map(|p| p.pos()) else {
        return;
    };
    for h in hits {
        let e = &h.entry;
        if e.derived {
            continue;
        }
        let Some(by) = e.by else { continue };
        let Some(p) = hx.w.player(by) else { continue };
        let mut rows = [0.; 4];
        let mut n = 0;
        for card in p.build.cards() {
            for row in card.definition().rows {
                if let CardRow::Trigger(t) = row {
                    if t.on == TriggerOn::Kill {
                        if let TriggerAction::Splash { radius } = t.action {
                            if n < rows.len() {
                                rows[n] = radius;
                                n += 1;
                            }
                        }
                    }
                }
            }
        }
        for &radius in &rows[..n] {
            let raw = h.raw * (*overkill / *total);
            if !(raw > 0.) {
                continue;
            }
            hx.w.card_splashes.push(SplashReq {
                holder: by,
                victim: *victim,
                at,
                radius,
                entry: e.clone(),
                raw,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Packet;
    use crate::systems::ledger::{Entry, OverkillHit};
    use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    #[test]
    fn overkill_splashes_a_share_onto_the_nearest_enemy() {
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
            Placement {
                profile: "c".into(),
                faction: FactionId::Frost,
                bot: false,
                at: Vec2::new(500., 400.),
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
            crate::cards::CardId::Overkill
        ));
        let entry = Entry {
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
            weapon: Some(crate::content::WeaponId::Sword),
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        };
        let mut ev = Vec::new();
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        on_overkilled(
            &mut hx,
            &crate::hooks::HookArgs::Overkilled {
                victim: PlayerId(2),
                hits: vec![OverkillHit { entry, raw: 100. }],
                overkill: 100.,
                total: 100.,
            },
        );
        assert_eq!(hx.w.card_splashes.len(), 1);
        assert!((hx.w.card_splashes[0].raw - 100.).abs() < 1e-9);
        super::super::after_damage::resolve_splashes(hx.w);
        let deferred = hx.w.deferred.hits.pop().expect("a splash hit");
        assert_eq!(deferred.victim, PlayerId(3));
        assert_eq!(deferred.by, Some(PlayerId(1)));
        assert!(deferred.derived && deferred.passive);
        assert!((deferred.packet.raw - 100.).abs() < 1e-9);
    }
}
