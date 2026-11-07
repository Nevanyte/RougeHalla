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
    QuietOrdinary,
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
    if matches!(kind, Kind::Ordinary | Kind::QuietOrdinary)
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
    if gained > 0.0 && !matches!(kind, Kind::QuietRegen | Kind::QuietOrdinary) {
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
/// Source \`startHealOverTime\`: spread \`amount\` over \`ms\` in equal steps, the first now, the rest every
/// HEAL_OVER_TIME_STEP_MS. Each step heals through the ordinary funnel (lockout unless the caller ignores it).
#[allow(dead_code)] // Second Wind and other trigger rows are the remaining caller
pub(crate) fn start_over_time(
    w: &mut crate::state::World,
    ev: &mut Vec<crate::events::Event>,
    i: usize,
    amount: f64,
    ms: f64,
    ignore_lockout: bool,
) {
    if !(amount > 0.) || !w.standing(crate::fighter::FighterIx::of_slot(i)) {
        return;
    }
    let steps = crate::cards::heal_over_time_steps(ms);
    let each = amount / f64::from(steps);
    apply(
        w,
        ev,
        i,
        each,
        if ignore_lockout {
            Kind::IgnoreLockout
        } else {
            Kind::Ordinary
        },
    );
    if steps > 1 {
        let next = w.server_time + crate::constants::HEAL_OVER_TIME_STEP_MS;
        w.players[i].card_hots.push(crate::cards::Hot {
            next,
            left: steps - 1,
            amount: each,
            ignore_lockout,
        });
    }
}

/// System (\`factions.healOverTime\`): the due steps of every pending run. A fighter who went down loses the rest.
pub(crate) fn over_time(cx: &mut crate::systems::Cx) {
    let crate::systems::Cx { w, ev, .. } = cx;
    tick(w, ev);
}

/// The due steps of every pending run (testable without a full context).
pub(crate) fn tick(w: &mut crate::state::World, ev: &mut Vec<crate::events::Event>) {
    let now = w.server_time;
    for i in 0..w.players.len() {
        if w.players[i].card_hots.is_empty() {
            continue;
        }
        if !w.standing(crate::fighter::FighterIx::of_slot(i)) {
            w.players[i].card_hots.clear();
            continue;
        }
        let mut hots = std::mem::take(&mut w.players[i].card_hots);
        for h in &mut hots {
            while h.left > 0 && now >= h.next {
                let kind = if h.ignore_lockout {
                    Kind::IgnoreLockout
                } else {
                    Kind::Ordinary
                };
                apply(w, ev, i, h.amount, kind);
                h.left -= 1;
                h.next += crate::constants::HEAL_OVER_TIME_STEP_MS;
            }
        }
        hots.retain(|h| h.left > 0);
        w.players[i].card_hots = hots;
    }
}

#[cfg(test)]
mod hot_tests {
    use super::{start_over_time, tick};
    use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    #[test]
    fn heal_over_time_spreads_the_amount_in_round_steps() {
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
        let i = sim.w.idx(PlayerId(1)).unwrap();
        sim.w.players[i].vitals.hp = 100.;
        let mut ev = Vec::new();
        start_over_time(&mut sim.w, &mut ev, i, 100., 2000., true);
        assert_eq!(sim.w.players[i].vitals.hp, 125., "first step now");
        assert_eq!(sim.w.players[i].card_hots.len(), 1);
        for step in 1..=3 {
            sim.w.server_time += 500.;
            tick(&mut sim.w, &mut ev);
            assert_eq!(sim.w.players[i].vitals.hp, 125. + 25. * step as f64);
        }
        assert!(sim.w.players[i].card_hots.is_empty());
    }
}
