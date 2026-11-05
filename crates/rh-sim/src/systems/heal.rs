//! Shared heal funnel for supported player sources. Cards, anti-heal and heal barriers
//! will join here when their actual producers are ported. No public healing command.
use crate::{constants::HEAL_LOCKOUT_MS, events::Event, state::World};
#[derive(Clone, Copy)]
pub(crate) enum Kind {
    #[cfg_attr(not(test), allow(dead_code))] // first ordinary source is a later packet
    Ordinary,
    Lifesteal,
}
pub(crate) fn apply(w: &mut World, ev: &mut Vec<Event>, i: usize, amount: f64, kind: Kind) -> f64 {
    let now = w.server_time;
    let p = &mut w.players[i];
    if !(amount > 0.0) || !p.standing() {
        return 0.0;
    }
    if matches!(kind, Kind::Ordinary)
        && p.signature
            .combat_at
            .is_some_and(|at| now - at < HEAL_LOCKOUT_MS)
    {
        return 0.0;
    }
    let before = p.vitals.hp;
    p.vitals.hp = p.vitals.max_hp.min(before + amount);
    let gained = p.vitals.hp - before;
    if gained > 0.0 {
        ev.push(Event::Heal {
            id: p.id,
            amount: gained,
        });
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
