//! P-FROST-WALL-BOTS-1 oracle (the Brain): a Brain seat in a room whose Frost Wish is Frost Wall is told so, and its
//! decision path drops the wall as legacy's does.
//!
//! The Brain decides its Wish from `extras.wish.def` of its composed percept (`compose14.rs` `wish_record`, rebuilt
//! from the public catalog), read back by the module adapter (`adapters::module_percept`) and admitted into the shared
//! cast core (`modules/wishes.rs` `read_declared_ranks` -> `wish::source_decide_cast`). Legacy (`78dd8bd4`
//! shared/abilities.ts:260-271): the Frost Wish's def is `frostWall`, tags `["peel", "escape"]`, a point target 450 / 64,
//! one effect `{ do: "wall", ms: 4000, length: 224 }`; abilityPolicy.ts:97-101, :164-174: a chaser at 56..=260 gets the
//! wall 70% of the way to it. The composer learns the room's Frost Wish from the seat's `MatchStart::frost_wish`
//! (`Composer14::with_frost_wish`): the public room fact every human reads from the Welcome.
//!
//! Real pipeline: a source-arena sim, the seat's own observer, delivery session and composer, then the module adapter.
use super::adapters;
use super::compose14::{test_support::seed1_arena, Composer14, Setup14};
use crate::bots::temporal_percept::modules::types::{AbilityDef, WishTargeting};
use crate::bots::wish::{
    admit_ranks, source_decide_cast, AiIntent, DeclaredRank, DeclaredTargeting, HypotMode, MeView,
    SourceAbility, SourceCastSituation, ThreatView,
};
use crate::delivery::DeliverySession;
use rh_sim::abilities::blink;
use rh_sim::{
    ArenaMode, ArenaRules, FactionId, FrostWish, ItemObserver, Observation, Placement, Secrets,
    Sim, SimConfig,
};

/// The Frost seat's declared Wish def as its Brain receives it, in a world whose Frost Wish is `world`, composed by a
/// composer told `told` (`None`: a composer never told, today's default).
fn composed_def(world: FrostWish, told: Option<FrostWish>) -> AbilityDef {
    let arena = seed1_arena();
    let config = SimConfig {
        abilities: rh_sim::abilities::Mode::Full,
        lifecycle: ArenaMode::Source(ArenaRules {
            plan_seconds: 0.,
            ..Default::default()
        }),
        wish_lock_ms: 0.,
        frost_wish: world,
        ..SimConfig::default()
    };
    let placements = [Placement {
        profile: "seat".into(),
        faction: FactionId::Frost,
        bot: true,
        at: arena.spawns[0],
        hp: None,
        weapon0: None,
        weapon1: None,
    }];
    let mut sim = Sim::reset_active(
        config.clone(),
        arena.clone(),
        Secrets::from_seed(3),
        &placements,
    );
    let me = sim.players()[0].id;
    let features = crate::bots::brain_features(&config, &arena);
    let composer = Composer14::new(Setup14::public(&arena, features, 0.6));
    let mut composer = match told {
        Some(wish) => composer.with_frost_wish(wish),
        None => composer,
    };
    let mut session = DeliverySession::new(me);
    let mut observer = ItemObserver::new(me);
    let mut last = None;
    for _ in 0..6 {
        let mut obs = Observation::default();
        observer
            .prepare_into(&sim, &[], &mut obs, None)
            .expect("seat scene")
            .commit();
        let prepared = session
            .prepare(&obs, false, false, &[])
            .expect("representable scene");
        let frame = session.commit(prepared);
        last = Some(composer.compose(frame.frame()).expect("frame composes"));
        sim.step();
    }
    let composed = last.expect("composed");
    let percept = adapters::module_percept(&composed.percept).expect("module percept");
    let wish = percept
        .wish
        .expect("the Frost seat's Wish slot is delivered");
    wish.def_of().cloned().expect("a declared def")
}

/// `modules/wishes.rs` `declared_rank` + `admit_ranks`: the def's ranks as the shared core takes them.
fn admitted(def: &AbilityDef) -> Vec<crate::bots::wish::SourceRank> {
    let ranks: Vec<DeclaredRank> = def
        .ranks
        .iter()
        .map(|r| DeclaredRank {
            cast_ms: r.cast_ms,
            targeting: r.targeting.map(|t| match t {
                WishTargeting::Self_ => DeclaredTargeting::Self_,
                WishTargeting::Unit {
                    range,
                    los,
                    snap_radius,
                } => DeclaredTargeting::Unit {
                    range,
                    los,
                    snap_radius,
                },
                WishTargeting::Point { range, min_range } => {
                    DeclaredTargeting::Point { range, min_range }
                }
                WishTargeting::Dir => DeclaredTargeting::Unsupported,
            }),
            hides_caster: r.hides_caster,
            blink: r.blink,
            wall: r.wall,
        })
        .collect();
    admit_ranks(&ranks).expect("the finite profile admits the def")
}

const ME: (f64, f64) = (640., 320.);

/// The shared core on the Brain's own admitted def: full hp, the nearest enemy player `d` u east, `chasing` as given.
fn brain_decides(def: &AbilityDef, d: f64, chasing: bool) -> Option<crate::bots::wish::CastChoice> {
    let ranks = admitted(def);
    let map = rh_sim::TileMap::new(
        48,
        32,
        (0..48 * 32)
            .map(|i| {
                let (x, y) = (i % 48, i / 48);
                if x == 0 || y == 0 || x == 47 || y == 31 {
                    rh_sim::map::TILE_WALL
                } else {
                    rh_sim::map::TILE_FLOOR
                }
            })
            .collect(),
    )
    .expect("open map");
    let ring = blink::Ring::new(&map);
    let ability = SourceAbility {
        name: &def.name,
        ai: &def.ai,
        blocked_by: &def.blocked_by,
        ranks: &ranks,
    };
    let s = SourceCastSituation {
        me: MeView {
            x: ME.0,
            y: ME.1,
            hp_frac: 1.,
            effects: 0,
            recently_hit: false,
        },
        foe: None,
        threat: Some(ThreatView {
            x: ME.0 + d,
            y: ME.1,
            d,
            chasing,
            id: Some("p2".into()),
            los: Some(true),
            targetable: Some(true),
        }),
        map: &map,
        collision: &map,
        ring: &ring,
        gates_locked: false,
        hypot: HypotMode::Js,
    };
    source_decide_cast(&ability, f64::NAN, &s)
}

#[test]
fn frost_wall_a_brain_seat_in_a_wall_room_is_handed_legacys_frost_wall_def() {
    let def = composed_def(FrostWish::Wall, Some(FrostWish::Wall));
    assert_eq!(def.name, "Frost Wall");
    assert_eq!(
        def.ai,
        vec![AiIntent::Peel, AiIntent::Escape],
        "legacy's tags, in order"
    );
    assert_eq!(def.ranks.len(), 1);
    let rank = &def.ranks[0];
    assert_eq!(
        rank.targeting,
        Some(WishTargeting::Point {
            range: 450.,
            min_range: 64.
        })
    );
    assert_eq!(rank.cast_ms, Some(250.));
    assert!(rank.wall, "the declared rank carries the wall effect");
    assert!(!rank.hides_caster);
    assert_eq!(rank.blink, None);
    assert!(admitted(&def)[0].wall, "the shared core sees the wall");
}

#[test]
fn frost_wall_the_brains_def_walls_a_chaser_seventy_percent_of_the_way_and_nobody_standing_off() {
    let def = composed_def(FrostWish::Wall, Some(FrostWish::Wall));
    let c = brain_decides(&def, 200., true).expect("a chaser at 200 gets the wall");
    assert_eq!(c.id, None, "a wall is a point cast");
    assert!(
        (c.x - (ME.0 + 140.)).abs() < 1e-6 && (c.y - ME.1).abs() < 1e-6,
        "70% of the way: ({}, {})",
        c.x,
        c.y
    );
    assert_eq!(brain_decides(&def, 200., false), None, "standing off");
    assert_eq!(brain_decides(&def, 55., true), None, "on top of the bot");
    assert_eq!(brain_decides(&def, 261., true), None, "too far");
}

#[test]
fn guard_frost_wall_a_brain_composer_not_told_the_wall_hands_todays_freeze_def() {
    // A composer never told (today's seats and every corpus) and one told Freeze: today's Freeze def, which peels a chaser
    // at 120 with a unit cast.
    for (world, told) in [
        (FrostWish::Freeze, None),
        (FrostWish::Freeze, Some(FrostWish::Freeze)),
        (FrostWish::Wall, None),
    ] {
        let def = composed_def(world, told);
        assert_eq!(def.name, "Freeze", "{world:?}/{told:?}");
        assert_eq!(
            def.ai,
            vec![AiIntent::Control, AiIntent::Peel, AiIntent::Engage]
        );
        assert!(!def.ranks[0].wall);
        assert!(matches!(
            def.ranks[0].targeting,
            Some(WishTargeting::Unit { range, .. }) if range == 450.
        ));
        let c = brain_decides(&def, 120., true).expect("Freeze peels a chaser at 120");
        assert_eq!(c.id.as_deref(), Some("p2"));
    }
}
