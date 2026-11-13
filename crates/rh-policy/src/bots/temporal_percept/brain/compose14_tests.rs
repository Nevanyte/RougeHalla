//! Oracle for P-BOT-BRAIN-LIVE-1 piece 1: the accepted-frame composer `Frame14` -> source `Percept`.
//!
//! Loose-proof standard (owner direction 2026-11-10): the shapes are exact (they are the source's declared key sets and
//! validators, which exist already); the numbers are only checked to be not drastically off. Every scene goes through
//! the real `ItemObserver` + `DeliverySession` path, so the composer sees only what a human client's frame carries.
//! The degraded fair profile (owner-approved 2026-11-11): a fact the seat cannot see is the source's `undefined`.

use super::compose14::{Composed14, Composer14, Refusal14, Setup14, WardSight14};
use super::source_input::{
    validate_percept, CONTAINER_KEYS, EXTRAS_KEYS, FEATURE_KEYS, FIGHTER_KEYS, HUD_KEYS,
    MINIMAP_KEYS, MOB_KEYS, PERCEPT_KEYS, PROJECTILE_KEYS, SELF_KEYS,
};
use super::trace::BVal;
use crate::bots::temporal_percept::modules::source_reader::SVal;
use crate::bots::view::Features;
use crate::delivery::{AcceptedFrame14, DeliverySession};
use rh_sim::mob_catalog::MobTypeId;
use rh_sim::observe::{ActorKind, CampHudView, RosterRow, WardVerdict};
use rh_sim::{
    FactionId, ItemObserver, Observation, OwnerCombatView, OwnerLockView, Placement, PlayerId,
    ProjectileKind, ProjectileView, Secrets, Sim, SimConfig, Vec2, WeaponId,
};
use std::sync::Arc;

const OWNER: PlayerId = PlayerId(1);
const ENEMY: PlayerId = PlayerId(2);
const MOB_ID: PlayerId = PlayerId(0x8000_0001);

// ---------------------------------------------------------------------------------------------------------------------
// Scenes: the real sim, the real observer, the real delivery session. Nothing here builds a Percept.

fn placement(profile: &str, faction: FactionId, at: (f64, f64), weapon: WeaponId) -> Placement {
    Placement {
        profile: profile.into(),
        faction,
        bot: false,
        at: Vec2::new(at.0, at.1),
        hp: None,
        weapon0: Some(weapon),
        weapon1: None,
    }
}

/// Owner (id 1, Fire/Wand) at (300, 272), the visible enemy (id 2, Holy/Bow) at (enemy_x, 272), and a third player that
/// is far outside the owner's view and differs between twins only in facts the owner cannot see.
fn sim(enemy_x: f64, hidden: ((f64, f64), FactionId, WeaponId)) -> Sim {
    Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[
            placement("owner", FactionId::Fire, (300., 272.), WeaponId::Wand),
            placement("other", FactionId::Holy, (enemy_x, 272.), WeaponId::Bow),
            placement("hidden", hidden.1, hidden.0, hidden.2),
        ],
    )
}

fn default_sim(enemy_x: f64) -> Sim {
    sim(enemy_x, ((1400., 900.), FactionId::Frost, WeaponId::Sword))
}

fn observation(sim: &Sim) -> Observation {
    let mut observer = ItemObserver::new(OWNER);
    let mut obs = Observation::default();
    observer
        .prepare_into(sim, &[], &mut obs, None)
        .expect("owner scene")
        .commit();
    obs
}

fn accepted(session: &mut DeliverySession, obs: &Observation) -> AcceptedFrame14 {
    let prepared = session
        .prepare(obs, false, false, &[])
        .expect("protocol 14/17 representable scene");
    session.commit(prepared)
}

fn setup(sim: &Sim) -> Setup14 {
    Setup14 {
        arena: Arc::clone(sim.shared_arena()),
        features: Features {
            message_types: ["move", "stop", "target", "attack", "pickup", "cast"]
                .map(String::from)
                .to_vec(),
            wishes: false,
            status_effects: true,
            fields: true,
            planning: true,
            chests: true,
            skills: false,
            relics: false,
            camps: true,
            hazards: false,
        },
        world_delay_ms: 0.,
        attention_central: 0.6,
    }
}

/// The base observation plus a visible regional mob (id in the NPC namespace, half health) and one camp row.
fn scene_obs(sim: &Sim, time: f64, tick: u32) -> Observation {
    let mut obs = observation(sim);
    obs.tick = tick;
    obs.server_time = time;
    let mut mob = obs
        .visible
        .iter()
        .find(|a| a.id == ENEMY)
        .expect("enemy is visible")
        .clone();
    mob.kind = ActorKind::Regional;
    mob.mob_type = Some(MobTypeId::ALL[0]);
    mob.id = MOB_ID;
    mob.x = 380.;
    mob.y = 272.;
    mob.hp_frac = 0.5;
    obs.visible.push(mob);
    obs.camps.push(rh_sim::mob_runtime::CampRoster {
        mob_type: MobTypeId::ALL[0],
        elite: None,
        alive: 3,
        state: 0,
        cleared_at: 0.,
        respawn_at: 0.,
    });
    obs.camp_hud.push(CampHudView::default());
    obs.arena = Some(rh_sim::ArenaView {
        lobby_ends_at: 0.,
        plan_ends_at: 0.,
        raid_started_at: 500.,
        patience_ends_at: Some(60_000.),
        in_coliseum: false,
        gates_locked: false,
        sudden_death_at: 0.,
        started_with: 3,
    });
    obs.roster = vec![
        RosterRow {
            id: OWNER,
            name: "Ada".into(),
            bot: true,
        },
        RosterRow {
            id: ENEMY,
            name: "Bran".into(),
            bot: false,
        },
        RosterRow {
            id: PlayerId(3),
            name: "Cy".into(),
            bot: false,
        },
    ];
    obs
}

fn enemy_mut(obs: &mut Observation) -> &mut rh_sim::observe::ActorView {
    obs.visible
        .iter_mut()
        .find(|a| a.id == ENEMY)
        .expect("enemy")
}

fn compose_one(sim: &Sim, obs: &Observation) -> Result<Composed14, Refusal14> {
    let mut session = DeliverySession::new(OWNER);
    let frame = accepted(&mut session, obs);
    Composer14::new(setup(sim)).compose(frame.frame())
}

fn ok(sim: &Sim, obs: &Observation) -> Composed14 {
    let composed = compose_one(sim, obs).expect("a complete frame composes");
    assert!(
        composed.percept.raw.as_obj().is_some(),
        "a composed percept carries its declared record"
    );
    composed
}

// ---------------------------------------------------------------------------------------------------------------------
// Record access (BVal) and the validator bridge (SVal).

fn at<'a>(v: &'a BVal, key: &str) -> &'a BVal {
    v.get(key)
        .unwrap_or_else(|| panic!("missing key {key} in {v:?}"))
}

fn keys(v: &BVal) -> Vec<&str> {
    v.as_obj()
        .unwrap_or_else(|| panic!("not an object: {v:?}"))
        .iter()
        .map(|(k, _)| k.as_str())
        .collect()
}

fn rows<'a>(v: &'a BVal, key: &str) -> &'a [BVal] {
    at(v, key)
        .as_arr()
        .unwrap_or_else(|| panic!("{key} is not an array"))
}

fn fighter<'a>(raw: &'a BVal, name: &str) -> &'a BVal {
    rows(raw, "fighters")
        .iter()
        .find(|f| at(f, "name").as_str() == Some(name))
        .unwrap_or_else(|| panic!("no fighter named {name}"))
}

fn num(v: &BVal, key: &str) -> f64 {
    at(v, key)
        .as_num()
        .unwrap_or_else(|| panic!("{key} is not a number: {:?}", at(v, key)))
}

fn bval_to_sval(v: &BVal) -> SVal {
    match v {
        BVal::Undefined => SVal::Undefined,
        BVal::Null => SVal::Null,
        BVal::Bool(b) => SVal::Bool(*b),
        BVal::Num(n) => SVal::Num(*n),
        BVal::Str(s) => SVal::Str(s.clone()),
        BVal::Arr(a) => SVal::Arr(a.iter().map(bval_to_sval).collect()),
        BVal::Obj(o) => SVal::Obj(
            o.iter()
                .map(|(k, v)| (k.clone(), bval_to_sval(v)))
                .collect(),
        ),
        other => panic!("a declared percept holds no {other:?}"),
    }
}

#[derive(Clone, Copy)]
enum Fill {
    N,
    S,
    B,
    Null,
}

/// Every `undefined` leaf of an object, as (path with `[]` for indices, which kind of leaf the validator expects there
/// if the profile tolerates it).
fn undefined_paths(v: &BVal) -> Vec<String> {
    fn walk(v: &BVal, path: &str, out: &mut Vec<String>) {
        match v {
            BVal::Obj(entries) => {
                for (k, m) in entries {
                    let p = if path.is_empty() {
                        k.clone()
                    } else {
                        format!("{path}.{k}")
                    };
                    if matches!(m, BVal::Undefined) {
                        out.push(p);
                    } else {
                        walk(m, &p, out);
                    }
                }
            }
            BVal::Arr(rows) => rows.iter().for_each(|r| walk(r, &format!("{path}[]"), out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(v, "", &mut out);
    out.sort();
    out.dedup();
    out
}

/// The leaves the degraded fair profile may leave `undefined` in the plain test scene (frame cannot carry them).
const DEGRADED_BASE: [(&str, Fill); 8] = [
    ("self.mobKills", Fill::N),
    ("self.immuneUntil", Fill::N),
    ("hud.alive", Fill::N),
    ("hud.minPlayers", Fill::N),
    ("hud.winner", Fill::S),
    ("minimap.t", Fill::N),
    ("fighters[].drawStartedAt", Fill::N),
    ("mobs[].drawStartedAt", Fill::N),
];

/// Leaves that are `undefined` only when their own condition holds (redacted lock, no roster row, projectile course).
const DEGRADED_CONDITIONAL: [(&str, Fill); 12] = [
    ("self.attackTarget", Fill::Null),
    ("self.name", Fill::S),
    ("fighters[].name", Fill::S),
    ("fighters[].bot", Fill::B),
    ("projectiles[].id", Fill::S),
    ("projectiles[].vx", Fill::N),
    ("projectiles[].vy", Fill::N),
    ("projectiles[].x0", Fill::N),
    ("projectiles[].y0", Fill::N),
    ("projectiles[].t0", Fill::N),
    ("projectiles[].range", Fill::N),
    ("mobs[].type", Fill::S),
];

fn fill_degraded(v: &BVal, table: &[(&str, Fill)]) -> SVal {
    fn walk(v: &BVal, path: &str, table: &[(&str, Fill)]) -> SVal {
        match v {
            BVal::Obj(entries) => SVal::Obj(
                entries
                    .iter()
                    .map(|(k, m)| {
                        let p = if path.is_empty() {
                            k.clone()
                        } else {
                            format!("{path}.{k}")
                        };
                        let sv = match (m, table.iter().find(|(t, _)| *t == p)) {
                            (BVal::Undefined, Some((_, fill))) => match fill {
                                Fill::N => SVal::Num(0.),
                                Fill::S => SVal::Str(String::new()),
                                Fill::B => SVal::Bool(false),
                                Fill::Null => SVal::Null,
                            },
                            _ => walk(m, &p, table),
                        };
                        (k.clone(), sv)
                    })
                    .collect(),
            ),
            BVal::Arr(rows) => SVal::Arr(
                rows.iter()
                    .map(|r| walk(r, &format!("{path}[]"), table))
                    .collect(),
            ),
            other => bval_to_sval(other),
        }
    }
    walk(v, "", table)
}

fn all_degraded() -> Vec<(&'static str, Fill)> {
    DEGRADED_BASE
        .iter()
        .chain(DEGRADED_CONDITIONAL.iter())
        .copied()
        .collect()
}

// ---------------------------------------------------------------------------------------------------------------------
// Shape: the declared key sets, in the declared order, and the source validators.

#[test]
fn composed_record_has_exactly_the_declared_key_sets() {
    let sim = default_sim(440.);
    let obs = scene_obs(&sim, 1000., 20);
    let raw = ok(&sim, &obs).percept.raw;
    assert_eq!(keys(&raw), PERCEPT_KEYS.to_vec(), "top level");
    assert_eq!(keys(at(&raw, "self")), SELF_KEYS.to_vec(), "self");
    assert_eq!(keys(at(&raw, "hud")), HUD_KEYS.to_vec(), "hud");
    assert_eq!(keys(at(&raw, "minimap")), MINIMAP_KEYS.to_vec(), "minimap");
    assert_eq!(
        keys(at(&raw, "features")),
        FEATURE_KEYS.to_vec(),
        "features"
    );
    assert_eq!(rows(&raw, "fighters").len(), 1, "one visible player");
    for f in rows(&raw, "fighters") {
        assert_eq!(keys(f), FIGHTER_KEYS.to_vec(), "fighter");
    }
    assert_eq!(rows(&raw, "mobs").len(), 1, "one visible mob");
    for m in rows(&raw, "mobs") {
        assert_eq!(keys(m), MOB_KEYS.to_vec(), "mob");
    }
    for c in rows(&raw, "containers") {
        assert_eq!(keys(c), CONTAINER_KEYS.to_vec(), "container");
    }
    // extras: only keys of the declared set, in declared order, gated by the room's features (camps/chests/fields on,
    // wishes off), and the one camp row is there.
    let extras = keys(at(&raw, "extras"));
    let mut order = EXTRAS_KEYS.iter();
    assert!(
        extras.iter().all(|k| order.any(|d| d == k)),
        "extras keys {extras:?} must follow {EXTRAS_KEYS:?}"
    );
    assert!(
        extras.contains(&"camps") && !extras.contains(&"wish"),
        "{extras:?}"
    );
    assert_eq!(rows(at(&raw, "extras"), "camps").len(), 1);
    for p in rows(&raw, "projectiles") {
        assert_eq!(keys(p), PROJECTILE_KEYS.to_vec(), "projectile");
    }
}

#[test]
fn the_typed_header_agrees_with_the_record_and_the_frame() {
    let sim = default_sim(440.);
    let obs = scene_obs(&sim, 1000., 20);
    let p = ok(&sim, &obs).percept;
    assert_eq!(p.now, 1000., "now is the accepted frame's source time");
    assert_eq!(p.view_time, 1000., "viewT = now with a zero world delay");
    assert_eq!(num(at(&p.raw, "self"), "x"), p.me_x);
    assert_eq!(num(at(&p.raw, "self"), "y"), p.me_y);
    assert!(p.alive(), "the owner is alive");
    assert!(p.active(), "the scene is in the active phase");
    assert_eq!(p.me_faction, Some(FactionId::Fire));
    assert_eq!(p.me_weapons[0], Some(WeaponId::Wand));
    assert_eq!(p.features, setup(&sim).features);
}

#[test]
fn the_composed_percept_passes_the_source_validator_with_only_named_leaves_degraded() {
    let sim = default_sim(440.);
    let obs = scene_obs(&sim, 1000., 20);
    let raw = ok(&sim, &obs).percept.raw;
    // Substitute a finite placeholder ONLY at the named degraded paths; anything else that is undefined (or any other
    // shape error) is still rejected by the unchanged source grammar.
    let sval = fill_degraded(&raw, &all_degraded());
    validate_percept(&sval, "percept").unwrap_or_else(|e| panic!("source grammar rejects it: {e}"));
}

#[test]
fn undefined_appears_only_at_the_named_degraded_paths_of_a_plain_scene() {
    let sim = default_sim(440.);
    let obs = scene_obs(&sim, 1000., 20);
    let raw = ok(&sim, &obs).percept.raw;
    assert!(
        raw.get("self").is_some(),
        "a composed record, not a placeholder"
    );
    let allowed: Vec<&str> = DEGRADED_BASE.iter().map(|(p, _)| *p).collect();
    let got = undefined_paths(&raw);
    let stray: Vec<&String> = got
        .iter()
        .filter(|p| !allowed.contains(&p.as_str()))
        .collect();
    assert!(
        stray.is_empty(),
        "undefined where the frame carries the fact: {stray:?}"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Degraded fields: unknown, never a plausible default.

#[test]
fn each_degraded_leaf_is_undefined_and_none_is_a_default() {
    let sim = default_sim(440.);
    let obs = scene_obs(&sim, 1000., 20);
    let raw = ok(&sim, &obs).percept.raw;
    let s = at(&raw, "self");
    // not on the wire: the owner's total mob kills (build-summary stacks exclude elites and are capped), the deadline of
    // its immunity, the whole-room alive count, min players, winner.
    assert_eq!(at(s, "mobKills"), &BVal::num(0.), "self.mobKills: derived, no credited death seen (DEV-026)");
    assert_eq!(at(s, "immuneUntil"), &BVal::Undefined, "self.immuneUntil");
    let hud = at(&raw, "hud");
    assert_eq!(at(hud, "alive"), &BVal::Undefined, "hud.alive");
    assert_eq!(at(hud, "minPlayers"), &BVal::Undefined, "hud.minPlayers");
    assert_eq!(at(hud, "winner"), &BVal::Undefined, "hud.winner");
    // a remote fighter's and a mob's bow-draw timestamp is not published (the ENGAGED flag is a verdict, not a time).
    let other = fighter(&raw, "Bran");
    assert_eq!(at(other, "drawStartedAt"), &BVal::Undefined, "remote draw");
    let mob = &rows(&raw, "mobs")[0];
    assert_eq!(at(mob, "drawStartedAt"), &BVal::Undefined, "mob draw");
    // no minimap dot snapshot: the clock is undefined and the dots are an empty list, not "none seen".
    let mini = at(&raw, "minimap");
    assert_eq!(at(mini, "t"), &BVal::Undefined, "minimap.t");
    assert_eq!(at(mini, "mobs"), &BVal::arr([]), "minimap dots");
}

#[test]
fn projectile_courses_are_unknown_and_only_the_current_point_is_kept() {
    let sim = default_sim(440.);
    let mut obs = scene_obs(&sim, 1000., 20);
    obs.projectiles.push(ProjectileView {
        kind: ProjectileKind::Arrow,
        x: 8 * 350,
        y: 8 * 272,
        facing: 0,
        owner: Some(ENEMY),
        height: 0,
    });
    let raw = ok(&sim, &obs).percept.raw;
    let ps = rows(&raw, "projectiles");
    assert_eq!(ps.len(), 1);
    let p = &ps[0];
    assert_eq!(keys(p), PROJECTILE_KEYS.to_vec());
    assert_eq!(at(p, "kind").as_str(), Some("arrow"));
    assert!((num(p, "x") - 350.).abs() < 0.5 && (num(p, "y") - 272.).abs() < 0.5);
    for k in ["id", "vx", "vy", "x0", "y0", "t0", "range"] {
        assert_eq!(
            at(p, k),
            &BVal::Undefined,
            "projectile.{k} is not published"
        );
    }
    let sval = fill_degraded(&raw, &all_degraded());
    validate_percept(&sval, "percept").unwrap_or_else(|e| panic!("{e}"));
}

#[test]
fn a_redacted_lock_is_undefined_clear_is_null_and_a_visible_target_is_its_key() {
    let sim = default_sim(440.);
    let combat = |lock| OwnerCombatView {
        lock,
        draw_started_at: 0,
        ready_at: 0,
        as_milli: 1000.,
        windup_milli: 1000.,
        speed_milli: 1000.,
    };
    let target = |lock| {
        let mut obs = scene_obs(&sim, 1000., 20);
        obs.owner_combat = Some(combat(lock));
        let raw = ok(&sim, &obs).percept.raw;
        (
            at(at(&raw, "self"), "attackTarget").clone(),
            at(fighter(&raw, "Bran"), "id").clone(),
        )
    };
    assert_eq!(target(OwnerLockView::Clear).0, BVal::Null, "Clear -> null");
    assert_eq!(
        target(OwnerLockView::Held { target: None }).0,
        BVal::Undefined,
        "Held(None) is held-but-unknown: undefined, never null (a null would read as a lost lock)"
    );
    let (held, enemy_key) = target(OwnerLockView::Held {
        target: Some(ENEMY),
    });
    assert_eq!(held, enemy_key, "a visible target is the fighter's key");
    assert!(matches!(held, BVal::Str(ref s) if !s.is_empty()));
}

#[test]
fn owner_combat_leaves_use_the_exact_milli_conversions() {
    let sim = default_sim(440.);
    let mut obs = scene_obs(&sim, 1000., 20);
    obs.owner_combat = Some(OwnerCombatView {
        lock: OwnerLockView::Clear,
        draw_started_at: 640,
        ready_at: 1234,
        as_milli: 1250.,
        windup_milli: 800.,
        speed_milli: 1100.,
    });
    let raw = ok(&sim, &obs).percept.raw;
    let s = at(&raw, "self");
    assert_eq!(num(s, "drawStartedAt"), 640.);
    assert_eq!(num(s, "readyAt"), 1234.);
    assert!((num(s, "asMult") - 1.25).abs() < 1e-9);
    assert!((num(s, "windupMult") - 0.8).abs() < 1e-9);
    assert!((num(s, "speedMult") - 1.1).abs() < 1e-9);
}

// ---------------------------------------------------------------------------------------------------------------------
// Facts protocol 16/17 now delivers (the brief listed them as degraded): they must come from the frame.

#[test]
fn remote_immunity_names_and_bot_flags_come_from_the_frame() {
    let sim = default_sim(440.);
    let mut obs = scene_obs(&sim, 1000., 20);
    let raw = ok(&sim, &obs).percept.raw;
    let other = fighter(&raw, "Bran");
    assert_eq!(at(other, "bot").as_bool(), Some(false), "roster bot flag");
    assert_eq!(at(other, "immune").as_bool(), Some(false));
    assert_eq!(at(at(&raw, "self"), "name").as_str(), Some("Ada"));
    // The teleport-immunity ring flag is exactly the source predicate `0 < left <= TELEPORT_IMMUNITY_MS`.
    enemy_mut(&mut obs).facts.teleport_immune = true;
    let raw = ok(&sim, &obs).percept.raw;
    assert_eq!(
        at(fighter(&raw, "Bran"), "immune").as_bool(),
        Some(true),
        "ACTOR_FLAG_TELEPORT_IMMUNE -> immune"
    );
    // A fighter with no roster row has an unknown name and bot flag: undefined, not "" and not false.
    obs.roster.retain(|r| r.id != ENEMY);
    let raw = ok(&sim, &obs).percept.raw;
    let other = &rows(&raw, "fighters")[0];
    assert_eq!(at(other, "name"), &BVal::Undefined);
    assert_eq!(at(other, "bot"), &BVal::Undefined);
    let sval = fill_degraded(&raw, &all_degraded());
    validate_percept(&sval, "percept").unwrap_or_else(|e| panic!("{e}"));
}

#[test]
fn only_the_viewers_own_camp_wards_become_vision_sources() {
    let sim = default_sim(440.);
    let mut obs = scene_obs(&sim, 1000., 20);
    assert!(ok(&sim, &obs).wards.is_empty(), "no ward, no vision source");
    obs.camp_hud[0] = CampHudView {
        reward: None,
        ward: WardVerdict::Yours,
        ward_expires_at: 31_000.,
    };
    assert_eq!(
        ok(&sim, &obs).wards,
        vec![WardSight14 {
            camp: 0,
            expires_at: 31_000.
        }]
    );
    obs.camp_hud[0].ward = WardVerdict::Other;
    assert!(
        ok(&sim, &obs).wards.is_empty(),
        "another player's ward gives this seat no sight"
    );
    // wardOwner/wardExpiresAt are not keys of the declared camp view: the percept stays exactly in its grammar.
    let raw = ok(&sim, &obs).percept.raw;
    let camp = &rows(at(&raw, "extras"), "camps")[0];
    assert!(!keys(camp).contains(&"wardOwner") && !keys(camp).contains(&"wardExpiresAt"));
}

// ---------------------------------------------------------------------------------------------------------------------
// Refusal: a required group that is missing is a refusal, never a default.

#[test]
fn a_frame_missing_a_required_group_is_refused() {
    let sim = default_sim(440.);
    let base = scene_obs(&sim, 1000., 20);
    assert!(compose_one(&sim, &base).is_ok());

    let mut no_inventory = base.clone();
    no_inventory.inventory = None;
    assert_eq!(
        compose_one(&sim, &no_inventory).err(),
        Some(Refusal14::InventoryMissing)
    );

    let mut no_combat = base.clone();
    no_combat.owner_combat = None;
    assert_eq!(
        compose_one(&sim, &no_combat).err(),
        Some(Refusal14::OwnerCombatMissing)
    );

    let mut no_build = base.clone();
    no_build.build = None;
    assert_eq!(
        compose_one(&sim, &no_build).err(),
        Some(Refusal14::BuildMissing),
        "a missing Build is a refusal, not power 0"
    );

    let mut no_arena = base;
    no_arena.arena = None;
    assert_eq!(
        compose_one(&sim, &no_arena).err(),
        Some(Refusal14::ArenaMissing),
        "the arena clocks are consumed (raid start, patience, gates): no group, no percept"
    );
}

#[test]
fn a_refusal_and_a_stale_sample_leave_the_ring_untouched() {
    let sim = default_sim(440.);
    let mut session = DeliverySession::new(OWNER);
    let mut composer = Composer14::new(setup(&sim));
    let good = scene_obs(&sim, 1000., 20);
    let f1 = accepted(&mut session, &good);
    let first = composer.compose(f1.frame()).expect("first sample");

    let mut broken = scene_obs(&sim, 1050., 21);
    broken.build = None;
    let f2 = accepted(&mut session, &broken);
    assert_eq!(
        composer.compose(f2.frame()).err(),
        Some(Refusal14::BuildMissing)
    );

    // The same sample again is not later than the last composed one.
    assert_eq!(composer.compose(f1.frame()).err(), Some(Refusal14::Clock));

    // The refusals did not advance anything: the next good sample composes as if they never happened.
    let f3 = accepted(&mut session, &scene_obs(&sim, 1100., 22));
    let third = composer.compose(f3.frame()).expect("third sample");
    assert_eq!(third.percept.now, 1100.);
    assert_ne!(first.percept.now, third.percept.now);
}

// ---------------------------------------------------------------------------------------------------------------------
// Hidden state: the percept is a function of the accepted frame (and its history) only.

#[test]
fn worlds_that_differ_only_in_hidden_facts_compose_identical_percepts() {
    let a = sim(440., ((1400., 900.), FactionId::Frost, WeaponId::Sword));
    let b = sim(440., ((1460., 980.), FactionId::Plague, WeaponId::Axe));
    let (oa, ob) = (scene_obs(&a, 1000., 20), scene_obs(&b, 1000., 20));
    let (mut sa, mut sb) = (DeliverySession::new(OWNER), DeliverySession::new(OWNER));
    let (fa, fb) = (accepted(&mut sa, &oa), accepted(&mut sb, &ob));
    assert!(
        fa.frame() == fb.frame(),
        "premise: the owner's accepted frames are identical in both worlds"
    );
    let (mut ca, mut cb) = (Composer14::new(setup(&a)), Composer14::new(setup(&b)));
    let (pa, pb) = (
        ca.compose(fa.frame()).unwrap(),
        cb.compose(fb.frame()).unwrap(),
    );
    assert_eq!(
        pa.percept.now, 1000.,
        "a real composition, not a placeholder"
    );
    assert!(pa.percept.raw.as_obj().is_some());
    assert_eq!(pa, pb);
    // and over history: a second sample from each stays identical
    let (fa2, fb2) = (
        accepted(&mut sa, &scene_obs(&a, 1050., 21)),
        accepted(&mut sb, &scene_obs(&b, 1050., 21)),
    );
    assert_eq!(
        ca.compose(fa2.frame()).unwrap(),
        cb.compose(fb2.frame()).unwrap()
    );
}

#[test]
fn a_visible_difference_changes_the_percept_positive_control() {
    let sim = default_sim(440.);
    let near = ok(&sim, &scene_obs(&sim, 1000., 20)).percept;
    let mut moved = scene_obs(&sim, 1000., 20);
    enemy_mut(&mut moved).x = 500.;
    let far = ok(&sim, &moved).percept;
    assert_ne!(near, far);
    assert_ne!(
        num(fighter(&near.raw, "Bran"), "dist"),
        num(fighter(&far.raw, "Bran"), "dist")
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Loose numeric proof: a simple scene yields the distances and health the frame states.

#[test]
fn a_simple_scene_yields_the_distances_and_health_the_frame_states() {
    let sim = default_sim(440.);
    let mut obs = scene_obs(&sim, 1000., 20);
    enemy_mut(&mut obs).hp_frac = 0.75;
    let p = ok(&sim, &obs).percept;
    let raw = &p.raw;

    let s = at(raw, "self");
    assert_eq!(at(s, "status").as_str(), Some("alive"));
    assert_eq!(at(s, "faction").as_str(), Some("fire"));
    assert!((num(s, "x") - 300.).abs() < 0.5 && (num(s, "y") - 272.).abs() < 0.5);
    assert!(num(s, "maxHp") > 0. && num(s, "hp") <= num(s, "maxHp"));
    assert_eq!(at(s, "weapons").as_arr().unwrap()[0].as_str(), Some("wand"));
    assert_eq!(
        at(raw, "hud").get("phase").and_then(BVal::as_str),
        Some("active")
    );
    let hud = at(raw, "hud");
    assert_eq!(num(hud, "playerCount"), 3., "the roster's three seats");
    assert_eq!(num(hud, "raidStartedAt"), 500.);
    assert_eq!(num(hud, "patienceEndsAt"), 60_000.);
    assert_eq!(at(hud, "gatesLocked").as_bool(), Some(false));
    assert_eq!(at(hud, "inColiseum").as_bool(), Some(false));

    let e = fighter(raw, "Bran");
    assert!(
        (num(e, "dist") - 140.).abs() < 0.5,
        "dist {}",
        num(e, "dist")
    );
    assert!((num(e, "hpFrac") - 0.75).abs() < 0.06, "hpFrac");
    assert_eq!(at(e, "status").as_str(), Some("alive"));
    assert_eq!(at(e, "faction").as_str(), Some("holy"));
    assert_eq!(at(e, "inHand").as_str(), Some("bow"));
    assert_eq!(
        at(e, "los").as_bool(),
        Some(true),
        "open floor between them"
    );
    assert_eq!(
        at(e, "central").as_bool(),
        Some(true),
        "140 px is inside the attention box"
    );
    assert_eq!(num(e, "vx"), 0., "one sample has no velocity yet");

    let m = &rows(raw, "mobs")[0];
    assert!(
        (num(m, "dist") - 80.).abs() < 0.5,
        "mob dist {}",
        num(m, "dist")
    );
    assert!((num(m, "hpFrac") - 0.5).abs() < 0.06, "mob hpFrac");
    assert_eq!(at(m, "kind").as_str(), Some("mob"));
    assert_eq!(at(m, "los").as_bool(), Some(true));

    let camp = &rows(at(raw, "extras"), "camps")[0];
    assert_eq!(num(camp, "index"), 0.);
    assert_eq!(num(camp, "alive"), 3.);
    assert_eq!(num(camp, "state"), 0.);
}

#[test]
fn velocity_comes_from_the_sample_a_tenth_of_a_second_earlier() {
    let sim = default_sim(440.);
    let mut session = DeliverySession::new(OWNER);
    let mut composer = Composer14::new(setup(&sim));
    let mut vx = Vec::new();
    for (i, (time, x)) in [(1000., 440.), (1050., 445.), (1100., 450.)]
        .into_iter()
        .enumerate()
    {
        let mut obs = scene_obs(&sim, time, 20 + i as u32);
        enemy_mut(&mut obs).x = x;
        let frame = accepted(&mut session, &obs);
        let p = composer.compose(frame.frame()).expect("sample").percept;
        assert!(
            p.raw.as_obj().is_some(),
            "a composed percept carries its declared record"
        );
        vx.push(num(fighter(&p.raw, "Bran"), "vx"));
    }
    assert_eq!(vx[0], 0., "no earlier sample");
    // 10 px in 100 ms is 100 px/s (source velocity() = delta * 1000 / VELOCITY_MS).
    assert!((vx[2] - 100.).abs() < 5., "vx {vx:?}");
}
