//! Shared heal funnel for supported player sources and supplied status modifiers.
//! Card acquisition and heal-barrier production remain pending. No public healing command.
use crate::{constants::HEAL_LOCKOUT_MS, events::Event, state::World};
#[derive(Clone, Copy)]
pub(crate) enum Kind {
    #[cfg_attr(not(test), allow(dead_code))] // first ordinary source is a later packet
    Ordinary,
    Lifesteal,
    #[cfg_attr(not(feature = "trusted-status-probes"), allow(dead_code))]
    // P-CARDS source; DeathFloor uses its separate attribution.
    IgnoreLockout,
    DeathFloor,
    QuietRegen,
}
pub(crate) fn apply(w: &mut World, ev: &mut Vec<Event>, i: usize, amount: f64, kind: Kind) -> f64 {
    let stats = crate::status_runtime::stats::view(w.core(crate::fighter::FighterIx::of_slot(i)));
    apply_with(w, ev, i, amount, kind, stats)
}
pub(crate) fn apply_with(
    w: &mut World,
    ev: &mut Vec<Event>,
    i: usize,
    amount: f64,
    kind: Kind,
    stats: crate::status_runtime::StatView,
) -> f64 {
    let now = w.server_time;
    let ix = crate::fighter::FighterIx::of_slot(i);
    if !(amount > 0.0) || !w.standing(ix) {
        return 0.0;
    }
    let p = w.core_mut(ix);
    if matches!(kind, Kind::Ordinary)
        && p.signature
            .combat_at
            .is_some_and(|at| now - at < HEAL_LOCKOUT_MS)
    {
        return 0.0;
    }
    let mut amount = amount * crate::status_runtime::heal_factor(&p.statuses.instances, now);
    if !matches!(kind, Kind::Lifesteal) {
        amount *= stats.heal_taken_mult;
    }
    if !(amount > 0.) {
        return 0.;
    }
    let before = p.vitals.hp;
    p.vitals.hp = p.vitals.max_hp.min(before + amount);
    let gained = p.vitals.hp - before;
    if gained > 0.0 && !matches!(kind, Kind::QuietRegen) {
        ev.push(Event::Heal {
            id: p.id,
            amount: gained,
        });
    }
    #[cfg(feature = "trusted-status-probes")]
    if gained > 0. && w.is_player(ix) {
        crate::status_runtime::probe::record_heal(w, i, gained, kind);
    }
    gained
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{arenas::practice_arena, FactionId, Placement, Secrets, Sim, SimConfig, Vec2};
    #[test]
    fn actual_gain_and_damage_lockout_boundary_match_source_helper() {
        // Actual TS helper probe: parity/legacy-capture/holy-probes.ts.
        let ps: Vec<_> = (0..2)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(400.0 + 56.0 * i as f64, 320.0),
                hp: Some(500.0),
                weapon0: None,
                weapon1: None,
            })
            .collect();
        let mut sim = Sim::reset_active(
            SimConfig {
                faction_mode: crate::FactionMode::EngagementHoly,
                ..Default::default()
            },
            practice_arena(),
            Secrets::from_seed(1),
            &ps,
        );
        sim.w.players[0].signature.combat_at = Some(150.0);
        let mut ev = Vec::new();
        sim.w.server_time = 3149.0;
        assert_eq!(apply(&mut sim.w, &mut ev, 0, 10.0, Kind::Ordinary), 0.0);
        sim.w.server_time = 3150.0;
        assert_eq!(apply(&mut sim.w, &mut ev, 0, 10.0, Kind::Ordinary), 10.0);
        sim.w.server_time = 150.0;
        sim.w.players[0].vitals.hp = 1143.0;
        assert_eq!(apply(&mut sim.w, &mut ev, 0, 5.0, Kind::Lifesteal), 2.0);
        assert_eq!(apply(&mut sim.w, &mut ev, 0, 5.0, Kind::Lifesteal), 0.0);
        sim.w.players[0].status = crate::Status::Dead;
        sim.w.players[0].vitals.hp = 0.0;
        assert_eq!(apply(&mut sim.w, &mut ev, 0, 5.0, Kind::Lifesteal), 0.0);
        assert_eq!(
            ev,
            vec![
                Event::Heal {
                    id: crate::PlayerId(1),
                    amount: 10.0
                },
                Event::Heal {
                    id: crate::PlayerId(1),
                    amount: 2.0
                }
            ]
        );
    }
}
