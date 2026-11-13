//! Review notes on P-BOT-BRAIN-LIVE-1 piece 1 (reviewer-opus, 2026-11-12): windup events, zombie rows and deaths,
//! line-of-sight verdicts for bodies and chest panels, and the unknown weapon of a hit. Scenes go through the real
//! observer and delivery session, as in the oracle (`compose14_tests.rs`).

use super::compose14::{Composer14, Setup14};
use super::trace::BVal;
use crate::bots::view::Features;
use crate::delivery::DeliverySession;
use rh_sim::observe::{ActorKind, RosterRow, SeenEvent};
use rh_sim::{
    FactionId, ItemObserver, Observation, Placement, PlayerId, Secrets, Sim, SimConfig, TileMap,
    Vec2, WeaponId,
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

fn scene(sim: &Sim) -> Observation {
    let mut obs = Observation::default();
    ItemObserver::new(OWNER)
        .prepare_into(sim, &[], &mut obs, None)
        .expect("owner scene")
        .commit();
    obs.tick = 20;
    obs.server_time = 1000.;
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

fn setup(arena: Arc<rh_sim::Arena>) -> Setup14 {
    Setup14 {
        arena,
        features: Features {
            message_types: ["move", "stop", "target", "attack", "pickup", "choose"]
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

/// Compose one accepted frame (props and reward chests published) against `arena`.
fn compose(obs: &Observation, arena: Arc<rh_sim::Arena>) -> BVal {
    let mut session = DeliverySession::new(OWNER);
    let prepared = session
        .prepare(obs, true, true, &[])
        .expect("representable scene");
    let frame = session.commit(prepared);
    Composer14::new(setup(arena))
        .compose(frame.frame())
        .expect("a complete frame composes")
        .percept
        .raw
}

fn at<'a>(v: &'a BVal, key: &str) -> &'a BVal {
    v.get(key)
        .unwrap_or_else(|| panic!("missing key {key} in {v:?}"))
}

fn rows<'a>(v: &'a BVal, key: &str) -> &'a [BVal] {
    at(v, key).as_arr().expect("an array")
}

fn events_of<'a>(raw: &'a BVal, kind: &str) -> Vec<&'a BVal> {
    rows(raw, "events")
        .iter()
        .filter(|e| at(e, "kind").as_str() == Some(kind))
        .collect()
}

fn actor_copy(
    obs: &Observation,
    id: PlayerId,
    kind: ActorKind,
    x: f64,
) -> rh_sim::observe::ActorView {
    let mut actor = obs
        .visible
        .iter()
        .find(|a| a.id == ENEMY)
        .expect("enemy is visible")
        .clone();
    actor.id = id;
    actor.kind = kind;
    actor.mob_type = None;
    actor.x = x;
    actor
}

/// A map where every tile is a wall: no line of sight or reach between any two tiles.
fn walled() -> Arc<rh_sim::Arena> {
    let rows = vec!["#".repeat(48); 40];
    Arc::new(rh_sim::Arena {
        map: TileMap::from_rows(&rows).expect("a valid map"),
        spawns: Vec::new(),
    })
}

#[test]
fn a_windup_of_a_drawn_attacker_is_composed_and_an_undrawn_one_is_absent() {
    let sim = sim();
    let mut obs = scene(&sim);
    obs.events.push(SeenEvent::Windup {
        by: ENEMY,
        weapon: WeaponId::Bow,
        a: 0.5,
        ms: 400.,
    });
    obs.events.push(SeenEvent::Windup {
        by: HIDDEN,
        weapon: WeaponId::Sword,
        a: 0.,
        ms: 300.,
    });
    let raw = compose(&obs, Arc::clone(sim.shared_arena()));
    let windups = events_of(&raw, "windup");
    assert_eq!(
        windups.len(),
        1,
        "only the drawn attacker's windup: {windups:?}"
    );
    let w = windups[0];
    let keys: Vec<&str> = w
        .as_obj()
        .unwrap()
        .iter()
        .map(|(k, _)| k.as_str())
        .collect();
    assert_eq!(keys, ["kind", "t", "at", "by", "weapon", "a", "ms"]);
    assert_eq!(at(w, "by").as_str(), Some("p2"));
    assert_eq!(at(w, "weapon").as_str(), Some("bow"));
    assert_eq!(at(w, "ms").as_num(), Some(400.));
    assert!((at(w, "a").as_num().unwrap() - 0.5).abs() < 1e-3);
    assert_eq!(at(w, "t").as_num(), Some(1000.));
    assert!((at(at(w, "at"), "x").as_num().unwrap() - 440.).abs() < 0.5);
}

#[test]
fn a_zombie_is_its_own_kind_with_an_unknown_name_and_its_death_is_announced_not_a_camp_kill() {
    let sim = sim();
    let mut obs = scene(&sim);
    let near = PlayerId(0x8000_0002);
    let far_zombie = PlayerId(0x8000_0003);
    let far_mob = PlayerId(0x8000_0004);
    obs.visible
        .push(actor_copy(&obs, near, ActorKind::Zombie, 360.));
    obs.visible
        .push(actor_copy(&obs, far_zombie, ActorKind::Zombie, 1500.));
    obs.visible
        .push(actor_copy(&obs, far_mob, ActorKind::Regional, 1500.));
    for id in [far_zombie, far_mob] {
        obs.events.push(SeenEvent::Death {
            id,
            by: Some(ENEMY),
        });
    }
    let raw = compose(&obs, Arc::clone(sim.shared_arena()));
    let mobs = rows(&raw, "mobs");
    assert_eq!(mobs.len(), 1, "only the zombie in the window is drawn");
    let z = &mobs[0];
    assert_eq!(at(z, "kind").as_str(), Some("zombie"));
    assert_eq!(
        at(z, "name"),
        &BVal::Undefined,
        "its owner is not on the wire"
    );
    assert_eq!(at(z, "type"), &BVal::Undefined);
    let deaths = events_of(&raw, "death");
    assert_eq!(
        deaths.len(),
        1,
        "the far zombie's death is announced, the far regional mob's is not: {deaths:?}"
    );
    let d = deaths[0];
    assert_eq!(at(d, "id").as_str(), Some("n2147483651"));
    assert_eq!(at(d, "at"), &BVal::Null, "off screen: no place");
    assert_eq!(at(d, "by"), &BVal::Null, "off screen: no killer");
    assert_eq!(at(d, "mob").as_bool(), Some(true));
    assert_eq!(at(d, "name"), &BVal::Undefined);
}

#[test]
fn a_body_or_a_chest_behind_a_wall_is_not_read_through_it() {
    let sim = sim();
    let mut obs = scene(&sim);
    obs.props.push(rh_sim::VisibleProp {
        handle: rh_sim::PickupHandle::new(900).unwrap(),
        cue: rh_sim::PropCue {
            x: 8 * 340,
            y: 8 * 272,
            kind: rh_sim::PropKind::Body {
                label: "Bran".into(),
            },
            focused: false,
            body_hint: None,
        },
    });
    obs.reward_chests
        .push(rh_sim::reward_chests::RewardChestView {
            handle: rh_sim::reward_chests::RewardChestHandle::from_wire(900).unwrap(),
            at: Vec2::new(340., 272.),
            expires_at: 20_000.,
            options: vec![rh_sim::reward_chests::RewardOptionView {
                id: rh_sim::reward_chests::OptionId::Card(rh_sim::cards::CardId::ALL[0]),
                taken: false,
                taken_by: None,
            }],
            picked: false,
            can_choose: true,
        });
    let read = |arena| {
        let raw = compose(&obs, arena);
        let body = rows(&raw, "containers")
            .iter()
            .find(|c| at(c, "kind").as_str() == Some("body"))
            .expect("the body is drawn")
            .clone();
        let chest = rows(at(&raw, "extras"), "chests")[0].clone();
        (at(&body, "weapon").clone(), at(&chest, "options").clone())
    };
    // Positive control: in reach and in sight, an unlit body reads empty and the chest panel shows its cards.
    let (body, options) = read(Arc::clone(sim.shared_arena()));
    assert_eq!(body, BVal::Null, "in reach with nothing lit: empty");
    assert!(
        options.as_arr().is_some_and(|o| o.len() == 1),
        "{options:?}"
    );
    // Behind walls: the body's contents are unknown (not empty) and the cards are not readable.
    let (body, options) = read(walled());
    assert_eq!(
        body,
        BVal::Undefined,
        "no hand through a wall: unknown, not empty"
    );
    assert_eq!(options, BVal::Null, "no panel through a wall");
}

#[test]
fn a_hit_names_no_weapon_it_cannot_see() {
    let sim = sim();
    let mut obs = scene(&sim);
    obs.events.push(SeenEvent::Hit {
        victim: OWNER,
        by: Some(ENEMY),
        amount: 12.4,
        passive: false,
        critical: false,
    });
    let raw = compose(&obs, Arc::clone(sim.shared_arena()));
    let hits = events_of(&raw, "hit");
    assert_eq!(hits.len(), 1);
    let h = hits[0];
    assert_eq!(at(h, "id").as_str(), Some("p1"));
    assert_eq!(
        at(h, "by").as_str(),
        Some("p2"),
        "the drawn attacker is named"
    );
    assert_eq!(at(h, "amount").as_num(), Some(12.));
    assert_eq!(
        at(h, "weapon"),
        &BVal::Undefined,
        "the dealing weapon is not on the wire; the attacker's bow in hand is not evidence"
    );
}
