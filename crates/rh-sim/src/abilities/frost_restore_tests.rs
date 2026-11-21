//! P-FROST-RESTORE-1 oracle: a checkpoint taken while Frost's Wish is in flight restores in the world that cast it.
//!
//! Under `SimConfig::frost_wish = Wall` (every live world: `SimConfig::live_content()`) Frost's Wish is the Frost Wall row
//! (`definition_for`): a placed cast with no unit target. The Wish restore validator (`checkpoint::validate`) must judge
//! the in-flight producer by that row, the one the cast was accepted under, and not by the catalog's Freeze row, which
//! asks for a unit target. Each world still refuses the other world's target kind.
use crate::abilities::Slot;
use crate::input::{validate, RawCommand};
use crate::map::TileMap;
use crate::status_runtime::FieldKind;
use crate::{Arena, FactionId, FrostWish, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

fn room() -> Arena {
    let (w, h) = (40usize, 24usize);
    let rows: Vec<String> = (0..h)
        .map(|y| {
            (0..w)
                .map(|x| {
                    if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    let map = TileMap::from_rows(&rows).expect("room");
    let spawns = [(112., 112.), (400., 112.), (800., 112.), (112., 624.)]
        .iter()
        .map(|&(x, y)| Vec2::new(x, y))
        .collect();
    Arena { map, spawns }
}

/// The bare switch: abilities on, no Wish lock, the given Frost Wish.
fn bare(frost_wish: FrostWish) -> SimConfig {
    SimConfig {
        quests: false,
        pvp_rules: false,
        abilities: crate::abilities::Mode::Full,
        wish_lock_ms: 0.,
        frost_wish,
        ..Default::default()
    }
}

/// The live world's Wish-relevant rules: `live_content()`'s abilities, Frost Wish, augment and elite rules (the Wishful
/// numbers the validator reads), hitboxes and walk fields, on the default world with the Wish lock lifted. The source
/// arena cannot start as a test room (`reset_active` refuses source planning and the PvE faction content needs the source
/// map; `tests/frost_wall_held_key.rs` does the same).
fn live() -> SimConfig {
    let live = SimConfig::live_content();
    assert_eq!(
        live.frost_wish,
        FrostWish::Wall,
        "live worlds play Frost Wall"
    );
    SimConfig {
        abilities: live.abilities,
        frost_wish: live.frost_wish,
        augments: live.augments,
        elites: live.elites,
        hitboxes: live.hitboxes,
        hazards: live.hazards,
        walk_hints: live.walk_hints,
        training: live.training,
        ..bare(live.frost_wish)
    }
}

/// A Frost caster and a Fire bystander in range of it.
fn world(config: SimConfig) -> Sim {
    let placements: Vec<Placement> = [(FactionId::Frost, 300.), (FactionId::Fire, 632.)]
        .iter()
        .map(|&(faction, x)| Placement {
            profile: faction.as_str().into(),
            faction,
            bot: false,
            at: Vec2::new(x, 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let secrets = Secrets {
        order_salt: 7,
        spawn_seed: 0,
        reward_salt: [1, 2, 3, 4],
    };
    Sim::reset_active(config, room(), secrets, &placements)
}

fn frost(s: &Sim) -> PlayerId {
    s.players()[0].id
}
fn fire(s: &Sim) -> PlayerId {
    s.players()[1].id
}

/// Frost's Wish cast at the Fire player's feet (with the unit target in a Freeze world, at the ground in a Wall world),
/// stepped once: the state of the cast's first tick in flight.
fn in_flight(config: SimConfig) -> Sim {
    let mut s = world(config);
    let unit = (s.k.config.frost_wish == FrostWish::Freeze).then(|| fire(&s));
    let raw = RawCommand::Cast {
        slot: Slot::Wish,
        x: 632.,
        y: 320.,
        id: unit,
        t: None,
        seq: None,
    };
    let who = frost(&s);
    s.submit(who, validate(raw).expect("valid"))
        .expect("accepted");
    s.step();
    let cast = s.w.players[0]
        .core
        .statuses
        .cast
        .expect("the Wish was accepted");
    assert!(cast.lands_at > s.w.server_time, "in flight");
    let target = cast.producer.expect("a player Wish producer").target;
    assert_eq!(
        target, unit,
        "the producer records the target the world's row asks for"
    );
    s
}

fn wall_stands(s: &Sim) -> bool {
    s.w.abilities
        .as_ref()
        .is_some_and(|a| a.fields.iter().any(|f| f.kind == FieldKind::Wall))
}

/// The live defect: every tick of a Frost Wall cast's flight checkpoints, restores to the same hash and plays on equal
/// through the landing (the wall stands in both).
#[test]
fn a_frost_wall_checkpointed_in_flight_restores_and_plays_on() {
    for (at, config) in [
        ("frost_wish = Wall", bare(FrostWish::Wall)),
        ("live_content", live()),
    ] {
        let mut s = in_flight(config);
        let mut flight = s.clone();
        let mut tick = 0;
        while flight.w.players[0].core.statuses.cast.is_some() {
            let r = Sim::restore(serde_json::to_value(&flight).unwrap()).unwrap_or_else(|e| {
                panic!("{at}: a Frost Wall checkpoint {tick} tick(s) into its flight refused: {e}")
            });
            assert_eq!(
                r.state_hash(),
                flight.state_hash(),
                "{at}: flight tick {tick}"
            );
            flight.step();
            tick += 1;
        }
        assert!(wall_stands(&flight), "{at}: the wall landed");
        // The first tick's checkpoint plays on equal through the landing.
        let mut r = Sim::restore(serde_json::to_value(&s).unwrap()).expect("restored above");
        for t in 0..12 {
            s.step();
            r.step();
            assert_eq!(
                r.state_hash(),
                s.state_hash(),
                "{at}: tick {t} after the restore"
            );
        }
        assert!(
            wall_stands(&r),
            "{at}: the restored world raised the wall too"
        );
    }
}

/// Freeze worlds keep restoring their in-flight unit-targeted Wish (the catalog row was always right for them).
#[test]
fn a_freeze_checkpointed_in_flight_still_restores_and_plays_on() {
    let mut s = in_flight(bare(FrostWish::Freeze));
    let mut r = Sim::restore(serde_json::to_value(&s).unwrap())
        .unwrap_or_else(|e| panic!("a Freeze checkpoint in flight refused: {e}"));
    assert_eq!(r.state_hash(), s.state_hash());
    for t in 0..12 {
        s.step();
        r.step();
        assert_eq!(r.state_hash(), s.state_hash(), "tick {t}");
    }
    assert!(!wall_stands(&r), "Freeze raises no wall");
}

/// Forged target provenance stays refused in both worlds: a unit target on a Frost Wall cast, none on a Freeze cast.
/// The played state passes the same validator first, so the refusal is the forged field's.
#[test]
fn each_frost_world_refuses_the_other_world_s_target_kind() {
    for (at, config, forged) in [
        ("Wall world, unit target", bare(FrostWish::Wall), true),
        ("live world, unit target", live(), true),
        ("Freeze world, no target", bare(FrostWish::Freeze), false),
    ] {
        let s = in_flight(config);
        super::checkpoint::validate(&s.k, &s.w)
            .unwrap_or_else(|e| panic!("{at}: the played state refused: {e}"));
        let mut f = s.clone();
        let unit = fire(&f);
        f.w.players[0]
            .core
            .statuses
            .cast
            .as_mut()
            .and_then(|c| c.producer.as_mut())
            .expect("producer")
            .target = forged.then_some(unit);
        assert_eq!(
            super::checkpoint::validate(&f.k, &f.w),
            Err("invalid Wish target provenance".to_string()),
            "{at}"
        );
        assert!(
            Sim::restore(serde_json::to_value(&f).unwrap()).is_err(),
            "{at}: the forged checkpoint restores"
        );
    }
}
