//! The practice world: the deterministic setup, dummies that never die, the training settle and the arena control.

use super::*;
use crate::input::TrainRaw;
use crate::systems::ledger::Hit;
use crate::{Outcome, PlayerId, RawCommand, Secrets, Sim, SimConfig};

fn train_raw(command: u8, id: u32, count: u64) -> TrainRaw {
    TrainRaw {
        command,
        id,
        count,
        options: [0; 3],
        option_count: 0,
    }
}

fn submit_train(sim: &mut Sim, raw: TrainRaw) {
    let cmd = crate::input::validate(RawCommand::Train(raw)).expect("valid train command");
    let pid = sim.w.players.first().unwrap().id;
    sim.submit(pid, cmd)
        .expect("training world accepts the console");
}

fn toasts(events: &[crate::Event]) -> Vec<&str> {
    events
        .iter()
        .filter_map(|e| match e {
            crate::Event::Toast { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn practice_mobs(sim: &Sim) -> Vec<&crate::mob_runtime::Mob> {
    sim.w
        .mobs
        .iter()
        .filter(|m| m.kind == MobKind::Practice)
        .collect()
}

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

// ================================================================================================= the practice console

/// A practice-console command is refused by an arena world at the submit door (the source has no train action there).
#[test]
fn the_console_command_is_refused_outside_a_training_world() {
    let mut sim = arena_sim();
    let cmd = crate::input::validate(RawCommand::Train(train_raw(5, 0, 0))).expect("valid");
    let pid = sim.w.players.first().unwrap().id;
    assert_eq!(
        sim.submit(pid, cmd),
        Err(crate::input::Reject::InvalidTrain)
    );
}

/// The public observation carries the source's training fact (and the version moved with it).
#[test]
fn a_training_observation_says_so() {
    let sim = training_sim(true);
    let pid = sim.w.players.first().unwrap().id;
    let obs = crate::observe(&sim, pid, &[]);
    assert!(obs.training);
    assert_eq!(obs.version, crate::OBSERVATION_VERSION);
    assert_eq!(crate::OBSERVATION_VERSION, 16);
    let arena = arena_sim();
    let pid = arena.w.players.first().unwrap().id;
    assert!(!crate::observe(&arena, pid, &[]).training);
}

/// card: sets copies, re-folds the rows and syncs max hp; 0 removes it; toasts are the source's.
#[test]
fn the_console_sets_and_removes_a_card() {
    let mut sim = training_sim(true);
    let id = crate::cards::CardId::TankEngine;
    let def = id.definition();
    assert!(def.unique);
    submit_train(&mut sim, train_raw(1, id.index() as u32, 3));
    let events = sim.step();
    let toast = toasts(&events);
    assert_eq!(toast.len(), 1);
    assert_eq!(toast[0], format!("{}: {}", def.title, def.text));
    let p = sim.w.players.first().unwrap();
    assert_eq!(p.build.count(id), 1, "a unique card is held once");
    submit_train(&mut sim, train_raw(1, id.index() as u32, 0));
    let events = sim.step();
    assert_eq!(toasts(&events), [format!("{} removed", def.title)]);
    assert_eq!(sim.w.players.first().unwrap().build.count(id), 0);
}

/// A card that is not a live interactive augment is ignored silently (source cardLive/isInteractive).
#[test]
fn the_console_ignores_unsupported_cards() {
    let mut sim = training_sim(true);
    let id = crate::cards::CardId::Ad1;
    assert!(id.definition().kind != crate::cards::CardKind::Augment);
    submit_train(&mut sim, train_raw(1, id.index() as u32, 2));
    let events = sim.step();
    assert!(toasts(&events).is_empty());
    assert_eq!(sim.w.players.first().unwrap().build.count(id), 0);
}

/// stat: sets a normal type's stacks and reports the cumulative bonus in the source's text.
#[test]
fn the_console_sets_a_mob_stat() {
    let mut sim = training_sim(true);
    let ty = crate::mob_catalog::MobTypeId::EmberImp;
    submit_train(&mut sim, train_raw(2, ty as u32, 3));
    let events = sim.step();
    let toast = toasts(&events);
    assert_eq!(toast.len(), 1);
    assert!(
        toast[0].contains("+3% damage total"),
        "unexpected stat toast {:?}",
        toast[0]
    );
    assert_eq!(sim.w.players.first().unwrap().farm.count(ty), 3);
    submit_train(&mut sim, train_raw(2, ty as u32, 0));
    let events = sim.step();
    assert!(toasts(&events)[0].contains("+0% damage total"));
    assert_eq!(sim.w.players.first().unwrap().farm.count(ty), 0);
}

/// camp: three practice mobs on a new camp ref, the 300 ms gap, and the alive cap of 12.
#[test]
fn the_console_drops_a_practice_camp_with_gaps_and_caps() {
    let mut sim = training_sim(true);
    let ty = crate::mob_catalog::MobTypeId::EmberImp;
    submit_train(&mut sim, train_raw(3, ty as u32, 0));
    let events = sim.step();
    let toast = toasts(&events);
    assert_eq!(toast.len(), 1);
    assert!(
        toast[0].starts_with("Practice camp: 3 x "),
        "unexpected camp toast {:?}",
        toast[0]
    );
    let mut mobs = practice_mobs(&sim);
    assert_eq!(mobs.len(), 3);
    let camp = mobs[0].camp;
    assert!(((PRACTICE_CAMP_FIRST - 1)..=(PRACTICE_CAMP_LAST - 1)).contains(&camp));
    assert!(mobs.iter().all(|m| m.camp == camp));
    assert_eq!(sim.w.practice.unwrap().spawned, 3);
    submit_train(&mut sim, train_raw(3, ty as u32, 0));
    let events = sim.step();
    assert_eq!(toasts(&events), ["Slow down"]);
    assert_eq!(practice_mobs(&sim).len(), 3);
    for _ in 0..6 {
        sim.step();
    }
    submit_train(&mut sim, train_raw(3, ty as u32, 0));
    let events = sim.step();
    assert!(toasts(&events)[0].starts_with("Practice camp: 3 x "));
    mobs = practice_mobs(&sim);
    assert_eq!(mobs.len(), 6);
    assert!(mobs.iter().any(|m| m.camp != camp), "a new camp ref");
    for _ in 0..2 {
        for _ in 0..6 {
            sim.step();
        }
        submit_train(&mut sim, train_raw(3, ty as u32, 0));
        sim.step();
    }
    assert_eq!(practice_mobs(&sim).len(), 12);
    for _ in 0..6 {
        sim.step();
    }
    submit_train(&mut sim, train_raw(3, ty as u32, 0));
    let events = sim.step();
    assert_eq!(
        toasts(&events),
        [format!(
            "At most {TRAIN_MAX_MOBS} practice mobs at once: clear some first"
        )]
    );
    assert_eq!(practice_mobs(&sim).len(), 12);
    for _ in 0..40 {
        sim.step();
    }
    assert_eq!(practice_mobs(&sim).len(), 12);
}

/// chest: chosen live interactive augments become the chest's options; the 300 ms gap and the six-chest cap hold.
#[test]
fn the_console_drops_reward_chests_with_chosen_options_and_caps() {
    let mut sim = training_sim(true);
    let id = crate::cards::CardId::TankEngine;
    let mut raw = train_raw(4, 0, 0);
    raw.options[0] = id.index() as u8;
    raw.option_count = 1;
    submit_train(&mut sim, raw);
    let events = sim.step();
    let def = id.definition();
    assert_eq!(toasts(&events), [format!("Chest: {}", def.title)]);
    assert_eq!(sim.w.reward_chests.len(), 1);
    assert_eq!(
        sim.w.reward_chests[0].options[0],
        Some(crate::reward_chests::OptionId::Card(id))
    );
    submit_train(&mut sim, raw);
    let events = sim.step();
    assert_eq!(toasts(&events), ["Slow down"]);
    for _ in 0..6 {
        for _ in 0..6 {
            sim.step();
        }
        if sim.w.reward_chests.len() < TRAIN_MAX_CHESTS as usize {
            submit_train(&mut sim, raw);
            sim.step();
        }
    }
    assert_eq!(sim.w.reward_chests.len(), TRAIN_MAX_CHESTS as usize);
    submit_train(&mut sim, raw);
    let events = sim.step();
    assert_eq!(
        toasts(&events),
        [format!(
            "At most {TRAIN_MAX_CHESTS} chests at once: wait for them to expire or clear them"
        )]
    );
}

/// clear: every card, mob stat, practice mob and chest goes, with the source's toast; the counters stay.
#[test]
fn the_console_clears_cards_stats_mobs_and_chests() {
    let mut sim = training_sim(true);
    let ty = crate::mob_catalog::MobTypeId::EmberImp;
    let card = crate::cards::CardId::TankEngine;
    submit_train(&mut sim, train_raw(1, card.index() as u32, 1));
    sim.step();
    submit_train(&mut sim, train_raw(2, ty as u32, 2));
    sim.step();
    submit_train(&mut sim, train_raw(3, ty as u32, 0));
    sim.step();
    for _ in 0..6 {
        sim.step();
    }
    let mut raw = train_raw(4, 0, 0);
    raw.options[0] = card.index() as u8;
    raw.option_count = 1;
    submit_train(&mut sim, raw);
    sim.step();
    assert_eq!(practice_mobs(&sim).len(), 3);
    assert_eq!(sim.w.reward_chests.len(), 1);
    submit_train(&mut sim, train_raw(5, 0, 0));
    let events = sim.step();
    assert_eq!(
        toasts(&events),
        ["Cleared: cards, practice mobs and chests"]
    );
    let p = sim.w.players.first().unwrap();
    assert_eq!(p.build, crate::cards::Build::default());
    assert_eq!(p.farm, crate::modifiers::Farm::default());
    assert_eq!(practice_mobs(&sim).len(), 0);
    assert!(sim.w.reward_chests.is_empty());
    assert_eq!(dummy_ids(&sim).len(), 2);
    assert_eq!(sim.w.practice.unwrap().spawned, 3);
}
