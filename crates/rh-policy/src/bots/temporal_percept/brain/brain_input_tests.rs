//! Oracle for P-BOT-BRAIN-LIVE-2a: the Brain's input side accepts everything the accepted-frame composer can emit.
//!
//! Loose-proof standard (owner direction 2026-11-10): shapes and flags are exact, numbers are only checked to be sane.
//! Scenes go through the real observer, delivery session and composer; nothing here builds a `Percept` by hand except
//! the one `is_engaged` unit check. The five items are the 2026-11-12 review notes of piece 1.

use super::adapters;
use super::compose14::{
    Composed14, Composer14, Setup14, BRAIN_SELF_DELAY_MS, BRAIN_WORLD_DELAY_MS,
};
use super::percept::Percept;
use super::source_input::validate_percept;
use super::trace::BVal;
use crate::bots::temporal_percept::modules::source_reader::SVal;
use crate::bots::view::Features;
use crate::delivery::DeliverySession;
use rh_sim::observe::{ActorKind, RosterRow};
use rh_sim::status_runtime::AbilityId;
use rh_sim::{
    FactionId, ItemObserver, Observation, OwnerCombatView, OwnerLockView, Placement, PlayerId,
    Secrets, Sim, SimConfig, Vec2, WeaponId,
};
use std::sync::Arc;

const OWNER: PlayerId = PlayerId(1);
const ENEMY: PlayerId = PlayerId(2);
const HIDDEN: PlayerId = PlayerId(3);

fn sim() -> Sim {
    let at = |profile: &str, faction, x: f64, y: f64, weapon| Placement {
        profile: profile.into(),
        faction,
        bot: false,
        at: Vec2::new(x, y),
        hp: None,
        weapon0: Some(weapon),
        weapon1: None,
    };
    Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[
            at("owner", FactionId::Fire, 300., 272., WeaponId::Wand),
            at("other", FactionId::Holy, 440., 272., WeaponId::Bow),
            at("hidden", FactionId::Frost, 1400., 900., WeaponId::Sword),
        ],
    )
}

fn features(wishes: bool) -> Features {
    Features {
        message_types: [
            "move", "stop", "target", "attack", "pickup", "cast", "choose",
        ]
        .map(String::from)
        .to_vec(),
        wishes,
        status_effects: true,
        fields: true,
        planning: true,
        chests: true,
        skills: false,
        relics: false,
        camps: true,
        hazards: false,
    }
}

fn setup(sim: &Sim, wishes: bool, world_delay_ms: f64) -> Setup14 {
    Setup14 {
        arena: Arc::clone(sim.shared_arena()),
        features: features(wishes),
        world_delay_ms,
        attention_central: 0.6,
    }
}

fn base(sim: &Sim, time: f64, tick: u32) -> Observation {
    let mut obs = Observation::default();
    ItemObserver::new(OWNER)
        .prepare_into(sim, &[], &mut obs, None)
        .expect("owner scene")
        .commit();
    obs.tick = tick;
    obs.server_time = time;
    obs.arena = Some(rh_sim::ArenaView {
        lobby_ends_at: 0.,
        plan_ends_at: 0.,
        raid_started_at: 500.,
        patience_ends_at: Some(60_000.),
        in_coliseum: false,
        gates_locked: false,
        sudden_death_at: 0.,
        started_with: 3,
        min_players: 0,
    });
    obs.roster = [(OWNER, "Ada"), (ENEMY, "Bran"), (HIDDEN, "Cy")]
        .map(|(id, name)| RosterRow {
            id,
            name: name.into(),
            bot: false,
        })
        .to_vec();
    obs
}

/// The base scene plus a zombie and a dummy (a quest giver needs a quest view the scene lacks) next to the owner.
fn with_npcs(obs: &mut Observation) {
    for (i, (kind, x)) in [(ActorKind::Zombie, 360.), (ActorKind::Dummy, 380.)]
        .into_iter()
        .enumerate()
    {
        let mut a = obs
            .visible
            .iter()
            .find(|a| a.id == ENEMY)
            .expect("enemy is visible")
            .clone();
        a.id = PlayerId(0x8000_0010 + i as u32);
        a.kind = kind;
        a.mob_type = None;
        a.x = x;
        obs.visible.push(a);
    }
}

fn compose_with(composer: &mut Composer14, obs: &Observation) -> Composed14 {
    let mut session = DeliverySession::new(OWNER);
    let prepared = session
        .prepare(obs, true, true, &[])
        .expect("representable scene");
    let frame = session.commit(prepared);
    composer.compose(frame.frame()).expect("a complete frame")
}

fn compose(sim: &Sim, obs: &Observation, wishes: bool) -> Composed14 {
    compose_with(&mut Composer14::new(setup(sim, wishes, 0.)), obs)
}

fn at<'a>(v: &'a BVal, key: &str) -> &'a BVal {
    v.get(key).unwrap_or_else(|| panic!("missing {key}"))
}

fn rows<'a>(v: &'a BVal, key: &str) -> &'a [BVal] {
    at(v, key).as_arr().expect("an array")
}

/// Every adapter the Brain tick runs on a percept, by name, with its verdict.
fn projections(p: &Percept) -> Vec<(&'static str, Result<(), String>)> {
    let e = |r: Result<(), super::config::BrainError>| r.map_err(|e| e.to_string());
    vec![
        ("memory", e(adapters::memory_percept(p).map(drop))),
        ("module", e(adapters::module_percept(p).map(drop))),
        ("hand", e(adapters::hand_percept(p).map(drop))),
        ("strategy", e(adapters::strategy_percept(p).map(drop))),
        ("tactic", e(adapters::tactic_percept(p).map(drop))),
    ]
}

fn assert_all_accept(p: &Percept, what: &str) {
    let failed: Vec<_> = projections(p)
        .into_iter()
        .filter_map(|(n, r)| r.err().map(|e| format!("{n}: {e}")))
        .collect();
    assert!(
        failed.is_empty(),
        "{what}: the Brain's readers refuse a percept the composer emits: {failed:?}"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Review item 1: the reader and the validator accept what the composer emits.

#[test]
fn every_reader_accepts_a_plain_composed_percept() {
    // The composer always leaves some leaves `undefined` (mobKills, immuneUntil, hud.alive, drawStartedAt, ...): the
    // readers take the source grammar's `undefined`, they do not invent a number for it.
    let sim = sim();
    let obs = base(&sim, 1000., 20);
    assert_all_accept(&compose(&sim, &obs, false).percept, "plain scene");
}

#[test]
fn every_reader_accepts_unknown_names_and_the_zombie_kind() {
    let sim = sim();
    let mut obs = base(&sim, 1000., 20);
    with_npcs(&mut obs);
    // No roster row for the owner or the visible enemy: their names are not on the wire.
    obs.roster.retain(|r| r.id == HIDDEN);
    let p = compose(&sim, &obs, false).percept;
    let mobs = rows(&p.raw, "mobs");
    assert!(
        mobs.iter()
            .any(|m| at(m, "kind").as_str() == Some("zombie")),
        "the scene draws a zombie"
    );
    assert_eq!(at(at(&p.raw, "self"), "name"), &BVal::Undefined);
    assert!(rows(&p.raw, "fighters")
        .iter()
        .any(|f| at(f, "name") == &BVal::Undefined));
    assert_all_accept(&p, "no roster rows, zombie, dummy");
    // The record is what the composer built: reading it back did not fill an unknown name with a default.
    assert_eq!(at(at(&p.raw, "self"), "name"), &BVal::Undefined);
}

#[test]
fn the_source_validator_accepts_the_zombie_kind() {
    fn fill(v: &BVal, path: &str) -> SVal {
        match v {
            BVal::Undefined => SVal::Num(0.),
            BVal::Null => SVal::Null,
            BVal::Bool(b) => SVal::Bool(*b),
            BVal::Num(n) => SVal::Num(*n),
            BVal::Str(s) => SVal::Str(s.clone()),
            BVal::Arr(a) => SVal::Arr(a.iter().map(|r| fill(r, &format!("{path}[]"))).collect()),
            BVal::Obj(o) => SVal::Obj(
                o.iter()
                    .map(|(k, m)| {
                        let p = format!("{path}.{k}");
                        let sv = match (m, p.as_str()) {
                            // The named string leaves a zombie row leaves unknown; every other undefined is a number.
                            (BVal::Undefined, ".mobs[].name" | ".mobs[].type" | ".self.name") => {
                                SVal::Str(String::new())
                            }
                            (BVal::Undefined, ".hud.winner") => SVal::Str(String::new()),
                            _ => fill(m, &p),
                        };
                        (k.clone(), sv)
                    })
                    .collect(),
            ),
            other => panic!("a declared percept holds no {other:?}"),
        }
    }
    let sim = sim();
    let mut obs = base(&sim, 1000., 20);
    with_npcs(&mut obs);
    let p = compose(&sim, &obs, false).percept;
    assert!(rows(&p.raw, "mobs")
        .iter()
        .any(|m| at(m, "kind").as_str() == Some("zombie")));
    validate_percept(&fill(&p.raw, ""), "percept")
        .unwrap_or_else(|e| panic!("the source grammar refuses the zombie kind: {e}"));
}

// ---------------------------------------------------------------------------------------------------------------------
// Review item 3: the held lock.

fn held_scene(sim: &Sim, lock: OwnerLockView) -> Percept {
    let mut obs = base(sim, 1000., 20);
    obs.owner_combat = Some(OwnerCombatView {
        lock,
        draw_started_at: 0,
        ready_at: 0,
        as_milli: 1000.,
        windup_milli: 1000.,
        speed_milli: 1000.,
    });
    compose(sim, &obs, false).percept
}

#[test]
fn a_held_lock_is_held_whether_or_not_its_target_is_known() {
    let sim = sim();
    let clear = held_scene(&sim, OwnerLockView::Clear);
    assert!(!clear.me_attack_held, "Clear: attackTarget === null");
    assert_eq!(clear.me_attack_target, None);
    let redacted = held_scene(&sim, OwnerLockView::Held { target: None });
    assert!(
        redacted.me_attack_held,
        "brain.ts:218 `attackTarget !== null`: an undefined target is still a held lock"
    );
    assert_eq!(
        redacted.me_attack_target, None,
        "the target is not invented"
    );
    let visible = held_scene(
        &sim,
        OwnerLockView::Held {
            target: Some(ENEMY),
        },
    );
    assert!(visible.me_attack_held);
    assert!(visible.me_attack_target.is_some());
}

#[test]
fn engagement_counts_a_held_lock_with_an_unknown_target() {
    use super::super::brain::{is_engaged, LastTactics};
    let last = LastTactics {
        attacking: true,
        ..LastTactics::default()
    };
    let engaged = |held: bool, target: Option<&str>| {
        let p = Percept {
            me_attack_held: held,
            me_attack_target: target.map(str::to_owned),
            ..Percept::default()
        };
        // Far from any hit or deal: only the held lock and the attacking flag can engage.
        is_engaged(&p, &last, 1_000_000., None, None)
    };
    assert!(engaged(true, None), "held + attacking, target undefined");
    assert!(engaged(true, Some("p2")));
    assert!(!engaged(false, None), "no held lock: not engaged");
}

// ---------------------------------------------------------------------------------------------------------------------
// Review item 2: extras.wish from the public catalog.

fn set_wish(obs: &mut Observation, wish: Option<rh_sim::abilities::OwnerView>) {
    obs.me.as_mut().expect("owner view").wish = wish;
}

fn wish_view(ability: AbilityId) -> rh_sim::abilities::OwnerView {
    rh_sim::abilities::OwnerView {
        ability,
        ready_at: 0.,
        full_at: None,
        max_charges: 1,
        recharge_ms: 20_000.,
        charges: 1,
        next_charge_at: None,
        cast: None,
    }
}

#[test]
fn a_delivered_wish_reaches_the_wishes_module_with_its_public_definition() {
    let sim = sim();
    let mut obs = base(&sim, 1000., 20);
    set_wish(&mut obs, Some(wish_view(AbilityId::Freeze)));
    let p = compose(&sim, &obs, true).percept;
    let extras = at(&p.raw, "extras");
    let wish = extras
        .get("wish")
        .unwrap_or_else(|| panic!("extras.wish is absent: a Brain bot would never cast its Wish"));
    assert_eq!(at(wish, "ability").as_str(), Some("freeze"));
    assert_eq!(at(wish, "casting").as_bool(), Some(false));
    assert!(
        matches!(at(wish, "def"), BVal::Obj(_)),
        "the definition comes from the public catalog, not a default"
    );
    // The rank is not on the wire: it is undefined (never a guessed 1) and the module still reads one rank.
    assert_eq!(at(wish, "rank"), &BVal::Undefined);
    let view = adapters::module_percept(&p)
        .unwrap_or_else(|e| panic!("module reader refuses the wish: {e}"))
        .wish
        .expect("the module sees a wish");
    assert_eq!(view.ability, "freeze");
    let def = view.def_of().expect("a valid definition");
    assert_eq!(def.ranks.len(), 1, "Wishes have one rank");
    assert_eq!(def.name, "Freeze");
    // Every Wish the sim can deliver has a definition.
    for id in [
        AbilityId::Freeze,
        AbilityId::Swarm,
        AbilityId::Trial,
        AbilityId::Blaze,
        AbilityId::LastStand,
    ] {
        let mut obs = base(&sim, 1000., 20);
        set_wish(&mut obs, Some(wish_view(id)));
        let p = compose(&sim, &obs, true).percept;
        let w = adapters::module_percept(&p)
            .unwrap_or_else(|e| panic!("{id:?}: {e}"))
            .wish
            .unwrap_or_else(|| panic!("{id:?}: no wish"));
        assert!(w.def_of().is_some(), "{id:?}: no definition");
    }
}

#[test]
fn a_room_without_wishes_or_a_wishless_frame_has_no_extras_wish() {
    let sim = sim();
    let mut obs = base(&sim, 1000., 20);
    set_wish(&mut obs, Some(wish_view(AbilityId::Freeze)));
    let off = compose(&sim, &obs, false).percept;
    assert!(at(&off.raw, "extras").get("wish").is_none(), "feature off");
    let mut none = base(&sim, 1000., 20);
    set_wish(&mut none, None);
    let on = compose(&sim, &none, true).percept;
    assert!(
        at(&on.raw, "extras").get("wish").is_none(),
        "nothing delivered"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Review item 4: world delay.

#[test]
fn a_composition_the_ring_does_not_cover_yet_says_so() {
    let sim = sim();
    let mut composer = Composer14::new(setup(&sim, false, 100.));
    let mut session = DeliverySession::new(OWNER);
    let mut covered = Vec::new();
    for (i, t) in [1000., 1050., 1100., 1150.].into_iter().enumerate() {
        let obs = base(&sim, t, 20 + i as u32);
        let prepared = session.prepare(&obs, true, true, &[]).expect("scene");
        let frame = session.commit(prepared);
        covered.push(composer.compose(frame.frame()).expect("composes").covered);
    }
    // frames.ts:131 returns no percept while the oldest sample is later than viewT = now - 100.
    assert_eq!(
        covered,
        [false, false, true, true],
        "viewT = 900, 950 (before the first sample), 1000, 1050"
    );
}

#[test]
fn with_no_world_delay_every_composition_is_covered() {
    let sim = sim();
    let c = compose(&sim, &base(&sim, 1000., 20), false);
    assert!(c.covered);
}

// ---------------------------------------------------------------------------------------------------------------------
// Review item 5: the setup a seat builds knows only what a client knows, with the pinned delays.

#[test]
fn the_brain_setup_pins_the_delays_and_holds_no_server_spawns() {
    assert_eq!(BRAIN_WORLD_DELAY_MS, 100., "INTERP_DELAY_MS");
    assert_eq!(BRAIN_SELF_DELAY_MS, 0.);
    let doc: serde_json::Value =
        serde_json::from_slice(include_bytes!("../../../../../../parity/arena/source.json"))
            .expect("the source arena fixture");
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_value(doc["map"]["export"].clone()).expect("map export");
    let arena = export
        .validate()
        .expect("valid")
        .into_arena()
        .expect("arena");
    assert!(!arena.spawns.is_empty(), "the full arena carries spawns");
    let s = Setup14::public(&arena, features(true), 0.6);
    assert_eq!(s.world_delay_ms, BRAIN_WORLD_DELAY_MS);
    assert_eq!(s.attention_central, 0.6);
    assert_eq!(s.features, features(true));
    assert!(
        s.arena.spawns.is_empty(),
        "spawn points are the server's, not a client's"
    );
    assert_eq!(s.arena.map.w, arena.map.w);
    assert_eq!(
        s.arena.map.tiles, arena.map.tiles,
        "the collision grid is public"
    );
}

#[test]
fn a_public_setup_composes_the_same_percept_as_the_full_arena() {
    let sim = sim();
    let obs = base(&sim, 1000., 20);
    let full = Setup14 {
        world_delay_ms: BRAIN_WORLD_DELAY_MS,
        ..setup(&sim, false, 0.)
    };
    let public = Setup14::public(sim.shared_arena(), features(false), 0.6);
    let a = compose_with(&mut Composer14::new(full), &obs);
    let b = compose_with(&mut Composer14::new(public), &obs);
    assert_eq!(a.percept.raw, b.percept.raw);
}
