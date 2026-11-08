//! The practice world: the deterministic setup, dummies that never die, the training settle and the arena control.

use super::*;
use crate::systems::ledger::Hit;
use crate::{Outcome, PlayerId, Secrets, Sim, SimConfig};

fn training_sim(dummies: bool) -> Sim {
    let config = SimConfig {
        min_players: 1,
        lobby_seconds: 0.,
        fill_seconds: 0.,
        training: true,
        dummies,
        ..Default::default()
    };
    let mut sim = Sim::new(
        config,
        crate::arenas::practice_arena(),
        Secrets::from_seed(7),
    );
    sim.add_player("p0", Some(crate::FactionId::Holy), false)
        .unwrap();
    sim.step();
    sim
}

fn arena_sim() -> Sim {
    let config = SimConfig {
        min_players: 1,
        lobby_seconds: 0.,
        fill_seconds: 0.,
        ..Default::default()
    };
    let mut sim = Sim::new(
        config,
        crate::arenas::practice_arena(),
        Secrets::from_seed(7),
    );
    sim.add_player("p0", Some(crate::FactionId::Holy), false)
        .unwrap();
    sim.step();
    sim
}

fn dummy_ids(sim: &Sim) -> Vec<PlayerId> {
    sim.w
        .mobs
        .iter()
        .filter(|m| m.kind == MobKind::Dummy)
        .map(|m| m.core.id)
        .collect()
}

fn hit(sim: &mut Sim, victim: PlayerId, amount: f64) -> f64 {
    let ix = sim.w.fighter_idx(victim).expect("actor slot");
    let by = sim.w.players.first().map(|p| p.id);
    let mut ev = Vec::new();
    crate::systems::mob_life::hurt(
        &sim.k,
        &mut sim.w,
        &mut ev,
        ix,
        &[Hit {
            terrain: false,
            amount,
            by,
            name: None,
        }],
    )
}

/// The source's `spawnTraining`: one plain dummy, one shield dummy facing the spawn and a rack of the five loop weapons,
/// 3-6 tiles from the spawn, deterministic for the map and player order.
#[test]
fn a_training_world_is_active_from_the_first_tick_with_the_practice_setup() {
    let sim = training_sim(true);
    assert_eq!(sim.phase(), crate::Phase::Active);
    assert!(sim.w.rt.patience_ends_at.is_none(), "no coliseum timer");
    let p = sim.w.players.first().unwrap();
    let at = p.core.pos();
    let mut dummies = dummy_ids(&sim);
    assert_eq!(dummies.len(), 2, "a plain and a shield dummy per player");
    dummies.sort();
    let mut seen_shield = 0;
    for id in &dummies {
        let m = sim.w.mobs.iter().find(|m| m.core.id == *id).unwrap();
        assert_eq!(m.core.vitals.max_hp, DUMMY_HP);
        assert!(m.mob_type.is_none());
        assert_eq!(m.camp, 0);
        assert_eq!(m.core.vitals.faction.code(), crate::FactionId::Fire.code());
        if m.core.weapon.weapon0 == Some(WeaponId::Shield) {
            seen_shield += 1;
            // The shield dummy faces the spawn (a reflected arrow flies back at the shooter).
            let want = crate::math::atan2(at.y - m.core.pos().y, at.x - m.core.pos().x);
            assert!((m.core.body.facing - want).abs() < 1e-9);
        } else {
            assert_eq!(m.core.weapon.weapon0, None);
        }
        let d = hypot(m.core.pos().x - at.x, m.core.pos().y - at.y) / TILE;
        assert!(
            (TRAINING_MIN_TILES..=TRAINING_MAX_TILES).contains(&d),
            "dummy distance {d}"
        );
    }
    assert_eq!(seen_shield, 1);
    // One loose weapon of every loop id, all in ground containers.
    let mut rack: Vec<WeaponId> = sim
        .w
        .containers
        .iter()
        .filter(|c| c.kind == ContainerKind::Ground)
        .map(|c| WeaponId::parse(c.items[0].def.as_str()).unwrap())
        .collect();
    rack.sort();
    let mut want = vec![
        WeaponId::Sword,
        WeaponId::Bow,
        WeaponId::Wand,
        WeaponId::Shield,
        WeaponId::Axe,
    ];
    want.sort();
    assert_eq!(rack, want);
    // The dummies are observable with the dummy actor kind (2) and no catalog type.
    let obs = crate::observe(&sim, p.id, &[]);
    let visible: Vec<_> = obs.visible.iter().filter(|a| a.kind == 2).collect();
    assert_eq!(visible.len(), 2);
    assert!(visible.iter().all(|a| a.mob_type.is_none()));
}

/// An arena world never places the practice setup (the control for the test above).
#[test]
fn an_arena_world_has_no_dummies_or_rack() {
    let sim = arena_sim();
    assert!(dummy_ids(&sim).is_empty());
    assert!(sim
        .w
        .containers
        .iter()
        .all(|c| c.kind != ContainerKind::Ground));
}

/// A dummy never dies: a hit worth far more than its hp refills it; nothing is paid or announced, and its last-hit clock
/// starts the three-second reset only after a surviving hit.
#[test]
fn a_dummy_never_dies_and_heals_after_the_reset_clock() {
    let mut sim = training_sim(true);
    let id = dummy_ids(&sim)[0];
    let removed = hit(&mut sim, id, 1e6);
    assert_eq!(removed, 1e6);
    let m = sim.w.mobs.iter().find(|m| m.core.id == id).unwrap();
    assert_eq!(m.status, Status::Alive);
    assert_eq!(m.core.vitals.hp, m.core.vitals.max_hp);
    // A surviving hit stays until 3 s have passed without another one.
    let removed = hit(&mut sim, id, 100.);
    assert_eq!(removed, 100.);
    let m = sim.w.mobs.iter().find(|m| m.core.id == id).unwrap();
    assert_eq!(m.core.vitals.hp, m.core.vitals.max_hp - 100.);
    for _ in 0..(DUMMY_RESET_SECONDS as u32 * 20 - 1) {
        sim.step();
    }
    let m = sim.w.mobs.iter().find(|m| m.core.id == id).unwrap();
    assert_eq!(m.core.vitals.hp, m.core.vitals.max_hp - 100., "not yet");
    sim.step();
    let m = sim.w.mobs.iter().find(|m| m.core.id == id).unwrap();
    assert_eq!(m.core.vitals.hp, m.core.vitals.max_hp, "reset at 3 s");
}

/// A downed player is revived where they fell, at full health, with their weapons — inside a tick and between ticks.
#[test]
fn a_down_player_is_revived_where_they_fell_with_their_weapons() {
    let mut sim = training_sim(true);
    let pid = sim.w.players.first().unwrap().id;
    sim.w.players[0].weapon.weapon0 = Some(WeaponId::Axe);
    let at = sim.w.players[0].core.pos();
    let (x, y) = (at.x, at.y);
    let idx = sim.w.idx(pid).unwrap();
    let mut ev = Vec::new();
    let mut downed = Vec::new();
    crate::systems::settle::down_player(
        &sim.k,
        &mut sim.w,
        &mut ev,
        Some(&mut downed),
        idx,
        Outcome::Died,
    );
    sim.s.downed_this_tick.extend(downed);
    sim.step();
    let p = sim.w.players.first().unwrap();
    assert_eq!(p.status, Status::Alive);
    assert!(p.down.is_none());
    assert!(!p.resolved);
    assert_eq!(p.core.vitals.hp, p.core.vitals.max_hp);
    assert_eq!((p.core.pos().x, p.core.pos().y), (x, y));
    assert_eq!(p.weapon.weapon0, Some(WeaponId::Axe));
    // Between ticks the down resolves at once (a result event the room ignores); the next step revives.
    let mut ev = Vec::new();
    let idx = sim.w.idx(pid).unwrap();
    crate::systems::settle::down_player(&sim.k, &mut sim.w, &mut ev, None, idx, Outcome::Died);
    assert_eq!(sim.w.players[0].status, Status::Dead);
    sim.step();
    assert_eq!(sim.w.players[0].status, Status::Alive);
    assert_eq!(
        sim.w.players[0].core.vitals.hp,
        sim.w.players[0].core.vitals.max_hp
    );
}

/// A training run never ends however long it runs, and nothing is banked.
#[test]
fn a_training_run_never_ends_or_banks_a_result() {
    let mut sim = training_sim(true);
    for _ in 0..400 {
        let events = sim.step();
        assert!(events
            .iter()
            .all(|e| !matches!(e, crate::Event::Resolved { .. })));
    }
    assert_eq!(sim.phase(), crate::Phase::Active);
}
