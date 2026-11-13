//! P-TRAINING-CAMPS-1: what a practice camp kill and a practice camp clear count toward, and the console's clear of the
//! camp progress (legacy `packages/server/src/sim/training.ts`, `camps.ts`, `campHeal.ts`, `mobLife.ts`).
//!
//! Every training test here uses console-spawned camps (`train` camp, legacy `trainCamp`): a training world has no map
//! camps of its own (legacy `mobLife.ts:84-85` `spawnRegionalMobs` returns in training; Rust `validate_actors` refuses a
//! map camp in training), and console camps never respawn (`mobLife.ts:112` `respawnCamps` returns in training). The
//! world is the live practice room's profile (`rh-server` `runtime.rs` `Profile::Training`: the full faction mode, so the
//! Bruiser installer and its camp-clear mirror run, `Gates::TRAINING`), with a Holy player.
//!
//! The arena guard at the end pins that a map camp's clear in a PvE arena world pays and counts as it does today.

use super::console::practice_contributors;
use super::*;
use crate::build_summary::{champion_panel, PanelCode};
use crate::input::TrainRaw;
use crate::mob_runtime::MobMode;
use crate::systems::ledger::Hit;
use crate::{Event, FactionId, FactionMode, PlayerId, RawCommand, Secrets, Sim, SimConfig};

fn train_raw(command: u8, id: u32) -> TrainRaw {
    TrainRaw {
        command,
        id,
        count: 0,
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

/// The console's `camp` command (legacy `handleTrain` case "camp").
fn spawn_camp(sim: &mut Sim, ty: crate::mob_catalog::MobTypeId) -> Vec<Event> {
    submit_train(sim, train_raw(3, ty as u32));
    sim.step()
}

/// The console's `clear` command (legacy `handleTrain` case "clear").
fn console_clear(sim: &mut Sim) -> Vec<Event> {
    submit_train(sim, train_raw(5, 0));
    sim.step()
}

/// The live practice room's profile (`runtime.rs` `sim()` for `Profile::Training`) with one Holy player, first tick run.
fn practice_room() -> Sim {
    let config = SimConfig {
        min_players: 1,
        lobby_seconds: 0.,
        fill_seconds: 0.,
        training: true,
        dummies: true,
        consumables: true,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        ..Default::default()
    };
    let mut sim = Sim::new(
        config,
        crate::arenas::practice_arena(),
        Secrets::from_seed(7),
    );
    sim.add_player("p0", Some(FactionId::Holy), false).unwrap();
    sim.step();
    assert!(
        crate::schedule::Gates::of(&sim.k).bruiser,
        "the practice room installs the Bruiser camp-clear mirror"
    );
    sim
}

fn me(sim: &Sim) -> PlayerId {
    sim.w.players.first().unwrap().id
}

/// The living practice mobs of camp ref `camp`.
fn camp_mobs(sim: &Sim, camp: u32) -> Vec<PlayerId> {
    sim.w
        .mobs
        .iter()
        .filter(|m| m.kind == MobKind::Practice && m.camp == camp && m.status == Status::Alive)
        .map(|m| m.core.id)
        .collect()
}

/// The camp ref of the newest practice camp (the highest ref in use).
fn newest_camp(sim: &Sim) -> u32 {
    sim.w
        .mobs
        .iter()
        .filter(|m| m.kind == MobKind::Practice)
        .map(|m| m.camp)
        .max()
        .expect("a practice camp stands")
}

/// One hit of `amount` by the player on `victim` through the mob ledger's way down (`mob_life::hurt`, legacy `hurtMob`).
/// Outside a ledger pass a payout queued with `pay_later` is paid at once, as legacy's `payLater` outside a pass.
fn hit(sim: &mut Sim, victim: PlayerId, amount: f64) -> Vec<Event> {
    let ix = sim.w.fighter_idx(victim).expect("actor slot");
    let by = Some(me(sim));
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
    );
    ev
}

/// Kills every living mob of practice camp `camp` with one lethal hit each, then runs one tick (the mirror and the stat
/// fold follow). Returns the events of the kills and of the tick.
fn kill_camp(sim: &mut Sim, camp: u32) -> Vec<Event> {
    let mut ev = Vec::new();
    for id in camp_mobs(sim, camp) {
        ev.extend(hit(sim, id, 1.0e6));
    }
    ev.extend(sim.step());
    ev
}

/// The Holy player's camp figures on the owner panel: (camp clears, camp leech), both read through the public mirror
/// (`bruiser::camp_clears`, legacy `PlayerState.campClears`).
fn holy_camp_panel(sim: &Sim) -> (f64, f64) {
    let p = champion_panel(sim, me(sim)).expect("seated");
    (
        p.get(PanelCode::HolyCampClears)
            .expect("Holy camp clears row"),
        p.get(PanelCode::HolyCampLeech)
            .expect("Holy camp leech row"),
    )
}

fn the_spawn_gap(sim: &mut Sim) {
    for _ in 0..6 {
        sim.step();
    }
}

/// Rule 2 (red today). A practice camp's clear pays the camp-clear reward to its contributor: legacy `hurtMob` notes the
/// contributor of any camp ref >= 1 with no training gate (`mobLife.ts:141-142`, `campHeal.ts:13-27`), and the last
/// practice mob's death, which `state.camps` does not know, pays `payCampHeal(ref - 1)` after the pass
/// (`camps.ts:70-75`, `:99-102`). `payCampHeal` counts the clear for a contributor near the camp (centre = the middle of
/// the camp's mobs' homes, `campHeal.ts:39-58`; the console places a camp 5-9 tiles away, inside `CAMP_HEAL_RANGE` of 12
/// tiles), stores one large potion (`campHeal.ts:84-96`; `grantConsumable` has no training gate, `consumables.ts:28-37`),
/// and forgets the camp's contributors (`:97`). There is no `campCleared` fx or hook for a practice camp
/// (`camps.ts:95-96`). The Holy mirror follows on the next sync (`bruiserPassives.ts:64-70`): 1 x 0.005 = 0.005 lifesteal
/// (`championPassives.ts:6-9`, `factions.ts:896`). Pack Leader reads the same canonical count (`mods.ts:336`).
#[test]
fn a_practice_camp_clear_counts_for_its_contributor_and_stores_a_camp_potion() {
    let mut sim = practice_room();
    spawn_camp(&mut sim, crate::mob_catalog::MobTypeId::EmberImp);
    let camp = newest_camp(&sim);
    assert_eq!(camp_mobs(&sim, camp).len(), 3, "a three-mob practice camp");
    let potions_before = sim.w.players[0].potion_large;

    // One non-lethal hit makes the player the camp's contributor (legacy noteCampContributors).
    let first = camp_mobs(&sim, camp)[0];
    hit(&mut sim, first, 1.);
    assert_eq!(
        practice_contributors(&sim.w),
        vec![(camp, me(&sim))],
        "the hit noted the player as the practice camp's contributor"
    );

    let ev = kill_camp(&mut sim, camp);
    assert!(camp_mobs(&sim, camp).is_empty(), "the camp is down");
    let p = &sim.w.players[0];
    assert_eq!(p.camps_cleared, 1, "the practice clear is counted");
    assert_eq!(
        p.potion_large,
        potions_before + 1,
        "the practice clear stores one camp potion"
    );
    assert_eq!(
        practice_contributors(&sim.w),
        Vec::<(u32, PlayerId)>::new(),
        "the clear forgets its contributors"
    );
    let (clears, leech) = holy_camp_panel(&sim);
    assert_eq!(clears, 1., "the mirror shows one camp clear");
    assert!(
        (leech - crate::constants::HOLY_CAMP_LIFESTEAL_PER_CLEAR).abs() < 1e-12,
        "one clear earns 0.005 Holy camp lifesteal, got {leech}"
    );
    assert!(
        !ev.iter().any(|e| matches!(e, Event::CampCleared { .. })),
        "a practice camp sends no campCleared fx"
    );
}

/// Rule 3 (red today). The console's clear forgets the camp progress: legacy `trainClear` zeroes `rt.campsCleared` and
/// clears every camp's contributors (`training.ts:344-345`); the next mirror sync (`bruiserPassives.ts:64-70`) takes the
/// Holy camp lifesteal with it. Here: camp A cleared (1 clear, 0.005 lifesteal), camp B hit once (1 contributor pair),
/// then the console's clear: 0 clears, no contributors, 0 camp lifesteal.
#[test]
fn the_console_clear_forgets_the_camp_count_contributors_and_camp_lifesteal() {
    let mut sim = practice_room();
    spawn_camp(&mut sim, crate::mob_catalog::MobTypeId::EmberImp);
    let a = newest_camp(&sim);
    kill_camp(&mut sim, a);
    the_spawn_gap(&mut sim);
    spawn_camp(&mut sim, crate::mob_catalog::MobTypeId::EmberImp);
    let b = newest_camp(&sim);
    assert_ne!(a, b, "a second camp ref");
    let first = camp_mobs(&sim, b)[0];
    hit(&mut sim, first, 1.);
    sim.step();

    assert_eq!(
        sim.w.players[0].camps_cleared, 1,
        "before the console's clear: camp A counted"
    );
    assert_eq!(
        practice_contributors(&sim.w),
        vec![(b, me(&sim))],
        "before the console's clear: camp B's contributor"
    );
    let (_, leech) = holy_camp_panel(&sim);
    assert!(
        leech > 0.,
        "before the console's clear: camp lifesteal earned"
    );

    console_clear(&mut sim);
    assert_eq!(
        sim.w.players[0].camps_cleared, 0,
        "the console's clear zeroes the camp count (training.ts:344)"
    );
    assert_eq!(
        practice_contributors(&sim.w),
        Vec::<(u32, PlayerId)>::new(),
        "the console's clear forgets every contributor (training.ts:345)"
    );
    assert_eq!(
        holy_camp_panel(&sim),
        (0., 0.),
        "the earned Holy camp lifesteal is gone"
    );
}

/// Rule 1 (guard, green today). A practice kill pays nothing: legacy `payMobKill` returns in a training world before
/// `creditMobKill` (mob kill count and GV, `arena.ts:267-273`) and `grantMobStat` (the 3 kill stacks and their
/// "+3 kill stacks" toast, `mobStats.ts:18`) (`mobLife.ts:250-252`), and no weapon is queued (`:233`). So 0 mob kills,
/// 0 GV, no stat stacks, no GV event and no kill-stack toast after a whole camp dies.
#[test]
fn guard_a_practice_kill_pays_no_kill_stacks_gv_or_feed() {
    let mut sim = practice_room();
    spawn_camp(&mut sim, crate::mob_catalog::MobTypeId::EmberImp);
    let camp = newest_camp(&sim);
    let ev = kill_camp(&mut sim, camp);
    let p = &sim.w.players[0];
    assert_eq!(p.credit.mob_kills, 0, "no mob kill counted");
    assert_eq!(p.credit.kills, 0, "no player kill counted");
    assert_eq!(p.credit.gv, 0, "no GV");
    assert_eq!(p.farm, crate::modifiers::Farm::default(), "no kill stacks");
    assert!(
        !ev.iter().any(|e| matches!(e, Event::Gv { .. })),
        "no GV event"
    );
    assert!(
        !ev.iter().any(|e| matches!(
            e,
            Event::Toast { text, .. } if text.contains("kill stack")
        )),
        "no kill-stack toast"
    );
}

/// The PvE arena of `systems/camp_heal_tests.rs` (`parity/initial-loot/input-map.json`), active, one Fire player standing
/// at camp 0's centre.
fn pve_arena() -> Sim {
    let data: crate::mapdata::GameMapData = serde_json::from_str(include_str!(
        "../../../../../parity/initial-loot/input-map.json"
    ))
    .unwrap();
    let hash = u32::from_str_radix(&crate::mapgen::map_hash::map_hash(&data), 16).unwrap();
    let v = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map: data,
    }
    .validate()
    .unwrap();
    let (w, h, t, l) = v.into_parts();
    let spawns = l
        .data()
        .spawns
        .iter()
        .map(|p| crate::Vec2::new(p.x, p.y))
        .collect();
    let arena = crate::Arena {
        map: crate::TileMap::new(w, h, t)
            .unwrap()
            .with_layers(std::sync::Arc::new(l))
            .unwrap(),
        spawns,
    };
    let camp0 = &arena.map.layers().expect("layered arena").data().camps[0];
    let at = crate::Vec2::new(camp0.x, camp0.y);
    let placements = [crate::Placement {
        profile: "fire".into(),
        faction: FactionId::Fire,
        bot: false,
        at,
        hp: None,
        weapon0: None,
        weapon1: None,
    }];
    let sim = Sim::reset_active(
        SimConfig {
            consumables: true,
            initial_loot: true,
            mob_mode: MobMode::Pve,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(3),
        &placements,
    );
    assert!(sim.w.mob_runtime.is_some(), "the PvE world publishes camps");
    sim
}

/// Arena guard (green today): a map camp's clear in a non-training world is unchanged by this packet. The player stands
/// at camp 0's centre and kills its mobs: the kills are paid (mob kills, GV), the clear is counted once, one camp potion is
/// stored, the camp's contributors are forgotten, the camp is cleared and the `campCleared` fx is sent
/// (`camps.ts:76-90`, `campHeal.ts:84-97`, `mobLife.ts:253-267`).
#[test]
fn guard_an_arena_camp_clear_pays_and_counts_as_today() {
    let mut sim = pve_arena();
    let potions_before = sim.w.players[0].potion_large;
    let ids: Vec<PlayerId> = sim
        .w
        .mobs
        .iter()
        // A regional mob's `camp` is the map camp's index in Rust (legacy MobState.camp is index + 1).
        .filter(|m| m.kind == MobKind::Regional && m.camp == 0 && m.status == Status::Alive)
        .map(|m| m.core.id)
        .collect();
    assert!(!ids.is_empty(), "camp 0 has mobs");
    let mut ev = Vec::new();
    for id in &ids {
        ev.extend(hit(&mut sim, *id, 1.0e6));
    }
    let p = &sim.w.players[0];
    assert_eq!(
        p.credit.mob_kills,
        ids.len() as u32,
        "every arena kill counted"
    );
    assert!(p.credit.gv > 0, "arena kills pay GV");
    assert_eq!(p.camps_cleared, 1, "the arena clear is counted once");
    assert_eq!(p.potion_large, potions_before + 1, "one camp potion stored");
    let rt = sim.w.mob_runtime.as_ref().unwrap();
    assert!(
        rt.life[0].contributors.is_empty(),
        "the clear forgot camp 0's contributors"
    );
    assert_eq!(rt.camps[0].alive, 0, "camp 0 is cleared");
    assert!(
        ev.iter()
            .any(|e| matches!(e, Event::CampCleared { camp, .. } if *camp == 0)),
        "the campCleared fx"
    );
    assert!(
        practice_contributors(&sim.w).is_empty(),
        "an arena world has no practice contributors"
    );
}
