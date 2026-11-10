#![cfg(test)]
//! Fighters joining or leaving inside one step (a Plague zombie raised by a consumed corpse, removed when its owner is
//! downed) must not leave a stale slot or an undersized per-slot scratch behind. Both used to panic a live room.
use crate::events::Event;
use crate::state::{Packet, Status};
use crate::systems::ledger::Entry;
use crate::systems::{plague_zombies, Cx};
use crate::{FactionId, FactionMode, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2, WeaponId};

fn scene(factions: &[FactionId]) -> Sim {
    let seats: Vec<Placement> = factions
        .iter()
        .enumerate()
        .map(|(i, &faction)| Placement {
            profile: format!("p{i}"),
            faction,
            bot: false,
            at: Vec2::new(300. + 40. * i as f64, 320.),
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig {
            consumables: true,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(12),
        &seats,
    )
}

fn cx<'a>(s: &'a mut Sim, ev: &'a mut Vec<Event>) -> Cx<'a> {
    Cx {
        stats: Default::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &s.k,
        w: &mut s.w,
        s: &mut s.s,
        ev,
        pf: &mut s.pf,
    }
}

fn hit(victim: PlayerId, by: PlayerId, raw: f64) -> Entry {
    Entry {
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim,
        by: Some(by),
        packet: Packet {
            raw,
            phys: 0.,
            magic: 0.,
            true_: 1.,
        },
        weapon: None,
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: false,
        passive: false,
    }
}

fn zombie_of(s: &Sim, owner: u32) -> PlayerId {
    plague_zombies::zombie_of(&s.w, PlayerId(owner)).expect("raised")
}

fn hp(s: &Sim, id: PlayerId) -> f64 {
    s.w.mobs.get(id).expect("present").core.vitals.hp
}

/// (b) A Plague owner downed in the ledger pass takes its zombie out of the mob store mid-pass, shifting every later
/// mob down a slot. The pass grouped victims by slot before it began: the victims after the removed zombie were hit
/// on the wrong mob, and the last one indexed one past the end of the store (World::core: "len is N but the index is N").
#[test]
fn a_zombie_removed_mid_ledger_pass_does_not_shift_later_victims() {
    use FactionId::*;
    let mut s = scene(&[Plague, Holy, Plague, Plague]);
    for owner in [1, 3, 4] {
        plague_zombies::raise_or_grow(&s.k, &mut s.w, PlayerId(owner));
    }
    let (z1, z3, z4) = (zombie_of(&s, 1), zombie_of(&s, 3), zombie_of(&s, 4));
    assert_eq!(
        s.w.mobs
            .as_slice()
            .iter()
            .map(|m| m.core.id)
            .collect::<Vec<_>>(),
        vec![z1, z3, z4],
        "zombies are appended in raise order"
    );
    s.w.server_time += 10_000.;
    let (z3_before, z4_before) = (hp(&s, z3), hp(&s, z4));
    // The owner's lethal hit comes first, so its zombie leaves before the later zombie victims are applied (the arena's
    // own damage: no PvP hit cap).
    s.s.ledger.push(Entry {
        arena: true,
        ..hit(PlayerId(1), PlayerId(2), 1_000_000.)
    });
    s.s.ledger.push(hit(z3, PlayerId(2), 10.));
    s.s.ledger.push(hit(z4, PlayerId(2), 25.));
    let mut ev = Vec::new();
    crate::systems::ledger::apply(&mut cx(&mut s, &mut ev));
    s.s.downed_this_tick.clear();
    assert!(
        !s.w.players[0].standing(),
        "the owner was downed in the pass"
    );
    assert!(s.w.mobs.get(z1).is_none(), "its zombie left with it");
    let (z3_lost, z4_lost) = (z3_before - hp(&s, z3), z4_before - hp(&s, z4));
    assert!(
        z3_lost > 0. && z4_lost > 0.,
        "each zombie took its own hit: {z3_lost} {z4_lost}"
    );
    assert!(
        (z4_lost / z3_lost - 2.5).abs() < 1e-9,
        "the hits landed on their own victims, not the next mob: {z3_lost} {z4_lost}"
    );
}

/// (a) A zombie raised by an auto-harvested corpse joins after the last reserve point; with every per-slot flag in use
/// (eight seats), the next tick's weapons/frost pass read attack_started one past its end.
#[test]
fn a_zombie_raised_mid_tick_with_a_full_lobby_steps_cleanly() {
    use FactionId::*;
    let mut s = scene(&[Plague, Holy, Frost, Fire, Sentenced, Holy, Frost, Fire]);
    assert_eq!(s.w.fighter_count(), crate::constants::MAX_PLAYERS);
    assert_eq!(s.s.attack_started.len(), s.w.fighter_count());
    let mut ev = Vec::new();
    crate::systems::settle::down_player(&s.k, &mut s.w, &mut ev, None, 1, crate::Outcome::Died);
    let owner = s.w.players[0].pos();
    s.w.plague_corpses[0].x = owner.x;
    s.w.plague_corpses[0].y = owner.y;
    let mut raised = None;
    for _ in 0..40 {
        s.step();
        raised = raised.or(plague_zombies::zombie_of(&s.w, PlayerId(1)));
    }
    let z = raised.expect("the corpse at the owner's feet is auto-harvested and raises a zombie");
    assert!(s.w.mobs.get(z).is_some_and(|m| m.status == Status::Alive));
    assert!(s.s.attack_started.len() >= s.w.fighter_count());
}
