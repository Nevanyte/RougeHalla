//! P-ELITE-TUNE-1 oracle (docs/backlog/packets/P-ELITE-TUNE-1.md): under `EliteRule::Rework` an elite has 1.5x the HP of
//! a normal mob of its type (legacy 2.0x) and deals 1.0x its damage (legacy 1.5x); `k` stays 0.65. Owner decision
//! 2026-11-19 ("dmg 1.0, hp 1.5", docs/OWNER_DECISIONS.md), measured by the P-ELITE-BENCH-2 Duelist bench. `Legacy` is
//! untouched.
//!
//! A loose proof (owner direction 2026-11-10): the numbers are read through the sim's own spawn path (`max_hp` of a real
//! elite mob) and hit path (the `Event::Hit` an elite deals to a player), on elites of at least two zones, against the
//! same world under `Legacy`. Both worlds build the same map, camps and mobs (the elite rule draws nothing), so a mob and a
//! first hit compare one to one.
use rh_sim::mob_catalog::mob_type_by_id;
use rh_sim::mob_runtime::{spawn_hp, EliteTuning, MobMode};
use rh_sim::{
    validate, Arena, Command, EliteRule, Event, FactionId, Placement, PlayerId, RawCommand,
    Secrets, Sim, SimConfig, Vec2, WeaponId,
};
use serde_json::{json, Value};

fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}

fn seed1_arena() -> Arena {
    let import: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    import.validate().unwrap().into_arena().unwrap()
}

fn config(elites: EliteRule) -> SimConfig {
    SimConfig {
        quests: false,
        initial_loot: true,
        consumables: true,
        mob_mode: MobMode::Pve,
        elites,
        ..Default::default()
    }
}

fn place(i: usize, at: Vec2) -> Placement {
    Placement {
        profile: format!("elite-tune-{i}"),
        faction: FactionId::Holy,
        bot: false,
        at,
        hp: None,
        weapon0: Some(WeaponId::Sword),
        weapon1: None,
    }
}

/// A seed1 world with the elite rule, one player at each of `at`.
fn world(elites: EliteRule, at: &[Vec2]) -> Sim {
    let places: Vec<Placement> = at.iter().enumerate().map(|(i, &a)| place(i, a)).collect();
    Sim::reset_active(
        config(elites),
        seed1_arena(),
        Secrets::from_seed(41),
        &places,
    )
}

/// The first spawn point of the map: a player standing where it will not meet a camp at once.
fn spawn_point() -> Vec2 {
    seed1_arena().spawns[0]
}

fn elite_zone(m: &rh_sim::mob_runtime::Mob) -> FactionId {
    mob_type_by_id(m.mob_type.unwrap().as_str()).unwrap().zone
}

/// One elite per zone present on the map: (mob id, its position).
fn first_elite_per_zone(sim: &Sim) -> Vec<(PlayerId, Vec2, FactionId)> {
    let mut out: Vec<(PlayerId, Vec2, FactionId)> = vec![];
    for m in sim.mobs().iter().filter(|m| m.elite) {
        let z = elite_zone(m);
        if !out.iter().any(|(_, _, oz)| *oz == z) {
            out.push((m.core.id, m.core.pos(), z));
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn the_rework_elite_table_is_hp_1_5_dmg_1_0_and_k_stays() {
    let e = EliteTuning::of(EliteRule::Rework);
    assert_eq!(e.k, 0.65, "k is unchanged");
    assert_eq!(e.hp_mult, 1.5, "hp x1.5 (legacy x2.0)");
    assert_eq!(e.dmg_mult, 1.0, "damage x1.0 (legacy x1.5)");
}

#[test]
fn the_legacy_elite_table_is_unchanged() {
    let e = EliteTuning::of(EliteRule::Legacy);
    assert_eq!((e.k, e.hp_mult, e.dmg_mult), (0.65, 2.0, 1.5));
    assert_eq!(e.hp_mult, rh_sim::constants::ELITE_HP_MULT);
    assert_eq!(e.dmg_mult, rh_sim::constants::ELITE_DMG_MULT);
    assert_eq!(e.k, rh_sim::constants::ELITE_K);
}

/// The rework numbers are registered constants (`constants.rs`, appended after the last `REWORK_*` row), and
/// `REWORK_ELITES` reads them by name; the legacy constants stay as they are.
#[test]
fn the_rework_elite_numbers_are_registry_rows_that_the_table_reads() {
    let constants = include_str!("../src/constants.rs");
    assert!(
        constants.contains("REWORK_ELITE_DMG_MULT: f64 = 1.0")
            || constants.contains("REWORK_ELITE_DMG_MULT: f64 = 1.,"),
        "constants.rs registers REWORK_ELITE_DMG_MULT = 1.0"
    );
    assert!(
        constants.contains("REWORK_ELITE_HP_MULT: f64 = 1.5"),
        "constants.rs registers REWORK_ELITE_HP_MULT = 1.5"
    );
    assert!(
        constants.contains("ELITE_HP_MULT: f64 = 2.,"),
        "legacy hp stays"
    );
    assert!(
        constants.contains("ELITE_DMG_MULT: f64 = 1.5,"),
        "legacy dmg stays"
    );
    let table = include_str!("../src/mob_runtime.rs");
    let at = table.find("static REWORK_ELITES").expect("the table");
    let body = &table[at..at + table[at..].find("};").unwrap()];
    assert!(
        body.contains("crate::constants::REWORK_ELITE_DMG_MULT"),
        "{body}"
    );
    assert!(
        body.contains("crate::constants::REWORK_ELITE_HP_MULT"),
        "{body}"
    );
    assert!(
        body.contains("crate::constants::ELITE_K"),
        "k stays ELITE_K: {body}"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Spawn HP, through a real world's elite mobs.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn a_rework_elite_spawns_with_legacy_hp_times_1_5_over_2_and_normals_do_not_move() {
    let legacy = world(EliteRule::Legacy, &[spawn_point()]);
    let rework = world(EliteRule::Rework, &[spawn_point()]);
    assert_eq!(
        legacy.mobs().len(),
        rework.mobs().len(),
        "same camps, same mobs"
    );
    let mut zones: Vec<FactionId> = vec![];
    let mut types: Vec<&str> = vec![];
    let mut elites = 0;
    for (l, r) in legacy.mobs().iter().zip(rework.mobs()) {
        assert_eq!(
            (l.core.id, l.mob_type, l.elite),
            (r.core.id, r.mob_type, r.elite)
        );
        if !l.elite {
            assert_eq!(
                (l.core.vitals.hp, l.core.vitals.max_hp),
                (r.core.vitals.hp, r.core.vitals.max_hp),
                "a normal mob has the same HP under both rules"
            );
            continue;
        }
        elites += 1;
        let ty = l.mob_type.unwrap();
        let zone = elite_zone(l);
        let want_legacy = spawn_hp(EliteTuning::of(EliteRule::Legacy), zone, true, ty);
        let want_rework = spawn_hp(EliteTuning::of(EliteRule::Rework), zone, true, ty);
        assert_eq!(
            l.core.vitals.max_hp, want_legacy,
            "{ty:?}: Legacy HP is the legacy formula"
        );
        assert_eq!(
            r.core.vitals.max_hp, want_rework,
            "{ty:?}: Rework HP is the Rework formula"
        );
        assert_eq!(
            r.core.vitals.hp, r.core.vitals.max_hp,
            "{ty:?}: spawns at full HP"
        );
        let ratio = r.core.vitals.max_hp / l.core.vitals.max_hp;
        assert!(
            (ratio - 1.5 / 2.0).abs() < 1e-9,
            "{ty:?}: Rework / Legacy elite HP is {ratio}, not 0.75"
        );
        if !zones.contains(&zone) {
            zones.push(zone);
        }
        if !types.contains(&ty.as_str()) {
            types.push(ty.as_str());
        }
    }
    assert!(elites >= 2, "the seed1 map has elite camps");
    assert!(
        zones.len() >= 2,
        "elites of at least two zones were measured: {zones:?}"
    );
    assert!(
        types.len() >= 2,
        "at least two elite types were measured: {types:?}"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Outgoing damage, through the first Hit an elite deals to a standing player.
// ---------------------------------------------------------------------------------------------------------------------

/// The first elite -> player hit within `ticks` of a world with one fighting player at `at`: (tick, amount).
fn first_elite_hit(elites: EliteRule, at: Vec2, ticks: u32) -> Option<(u32, f64)> {
    let mut sim = world(elites, &[at]);
    let elite_ids: Vec<PlayerId> = sim
        .mobs()
        .iter()
        .filter(|m| m.elite)
        .map(|m| m.core.id)
        .collect();
    for t in 0..ticks {
        // Mobs are neutral until hurt: the player fights, as `drive_tick` scripts it, and the elite answers.
        for e in drive_tick(&mut sim, t) {
            if let Event::Hit {
                victim,
                by: Some(by),
                amount,
                ..
            } = e
            {
                if victim == PlayerId(1) && elite_ids.contains(&by) && amount > 0. {
                    return Some((t, amount));
                }
            }
        }
    }
    None
}

#[test]
fn a_rework_elite_hits_for_legacy_damage_times_1_0_over_1_5() {
    let probe = world(EliteRule::Legacy, &[spawn_point()]);
    let mut measured: Vec<FactionId> = vec![];
    for (_, at, zone) in first_elite_per_zone(&probe) {
        // The player fights beside the elite: the first elite hit lands in both worlds on the same tick (the elite's hp
        // differs, its behaviour does not).
        let near = Vec2::new(at.x + 48., at.y);
        let Some((lt, legacy)) = first_elite_hit(EliteRule::Legacy, near, 200) else {
            continue;
        };
        let (rt, rework) = first_elite_hit(EliteRule::Rework, near, 200).unwrap_or_else(|| {
            panic!("{zone:?}: the Rework elite never hit where the Legacy one did")
        });
        assert_eq!(
            lt, rt,
            "{zone:?}: the first elite hit lands on the same tick"
        );
        let ratio = rework / legacy;
        assert!(
            (ratio - 1.0 / 1.5).abs() < 0.02,
            "{zone:?}: Rework hit {rework} / Legacy hit {legacy} = {ratio}, not 2/3"
        );
        measured.push(zone);
    }
    assert!(
        measured.len() >= 2,
        "elite hits of at least two zones were measured: {measured:?}"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// A Rework checkpoint with a live, hurt elite.
// ---------------------------------------------------------------------------------------------------------------------

fn aim(sim: &Sim, pid: PlayerId) -> Option<f64> {
    let me = sim.player(pid)?.pos();
    sim.mobs()
        .iter()
        .filter(|m| m.core.vitals.hp > 0.)
        .map(|m| {
            let at = m.core.pos();
            let (dx, dy) = (at.x - me.x, at.y - me.y);
            (dx * dx + dy * dy, rh_sim::math::atan2(dy, dx))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, a)| a)
}

fn drive_tick(sim: &mut Sim, t: u32) -> Vec<Event> {
    let pid = PlayerId(1);
    if let Some(a) = aim(sim, pid) {
        let _ = sim.submit(pid, cmd(RawCommand::Aim { a }));
        if t % 7 == 0 {
            let _ = sim.submit(pid, cmd(RawCommand::Attack { a, t: None }));
        }
        if t % 7 == 3 {
            let _ = sim.submit(pid, cmd(RawCommand::Release { a, t: None }));
        }
    }
    sim.step()
}

/// A Rework world stepped until a live elite is hurt (a player fights beside it), or None.
fn world_with_a_hurt_elite(elites: EliteRule) -> Option<Sim> {
    let probe = world(EliteRule::Legacy, &[spawn_point()]);
    for (_, at, _) in first_elite_per_zone(&probe) {
        let mut sim = world(elites, &[Vec2::new(at.x + 48., at.y)]);
        for t in 0..300 {
            drive_tick(&mut sim, t);
            if sim.player(PlayerId(1)).is_some_and(|p| !p.standing()) {
                break;
            }
            if sim.mobs().iter().any(|m| {
                m.elite && m.core.vitals.hp > 0. && m.core.vitals.hp < m.core.vitals.max_hp
            }) {
                return Some(sim);
            }
        }
    }
    None
}

#[test]
fn a_rework_checkpoint_with_a_hurt_elite_stores_the_rule_restores_and_hashes_equal() {
    let mut sim = world_with_a_hurt_elite(EliteRule::Rework)
        .expect("a live elite was hurt in the sweep of elite camps");
    let cp = serde_json::to_value(&sim).unwrap();
    assert_eq!(
        cp["world"]["mob_runtime"]["elites"],
        json!("rework"),
        "a Rework world whose elite numbers differ from legacy stores the rule (it is no longer a Legacy unit)"
    );
    assert_eq!(cp["statics"]["config"]["elites"], json!("rework"));
    let mut restored = Sim::restore(cp.clone()).expect("the Rework checkpoint restores");
    assert_eq!(
        restored.state_hash(),
        sim.state_hash(),
        "hash after restore"
    );
    for m in restored.mobs().iter().filter(|m| m.elite) {
        let zone = elite_zone(m);
        let want = spawn_hp(
            EliteTuning::of(EliteRule::Rework),
            zone,
            true,
            m.mob_type.unwrap(),
        );
        assert_eq!(
            m.core.vitals.max_hp, want,
            "the restored elite keeps its Rework max HP"
        );
    }
    for t in 0..60 {
        let a = drive_tick(&mut sim, 1000 + t);
        let b = drive_tick(&mut restored, 1000 + t);
        assert_eq!(a, b, "tick {t} after the restore: events");
        assert_eq!(
            sim.state_hash(),
            restored.state_hash(),
            "tick {t} after the restore"
        );
    }
}

#[test]
fn the_stored_elite_rule_is_checked_against_the_config_and_the_hash_folds_it() {
    let sim = world_with_a_hurt_elite(EliteRule::Rework).expect("a hurt elite");
    let cp = serde_json::to_value(&sim).unwrap();
    // A runtime that claims Legacy under a Rework config is refused (check_world, `check_elite_rule`).
    let mut bad = cp.clone();
    bad["world"]["mob_runtime"]["elites"] = Value::Null;
    let err = Sim::restore(bad).expect_err("a runtime rule the config does not store");
    assert!(format!("{err:?}").contains("elite rule"), "{err:?}");
    // And the Legacy world stores nothing and is not the Rework world.
    let legacy = world_with_a_hurt_elite(EliteRule::Legacy).expect("a hurt Legacy elite");
    let lcp = serde_json::to_value(&legacy).unwrap();
    assert_eq!(
        lcp["world"]["mob_runtime"]["elites"],
        Value::Null,
        "Legacy writes nothing"
    );
    let mut claims = lcp.clone();
    claims["world"]["mob_runtime"]["elites"] = json!("rework");
    assert!(
        Sim::restore(claims).is_err(),
        "a Legacy config with a Rework runtime is refused"
    );
    assert_ne!(sim.state_hash(), legacy.state_hash());
}
