//! P-SIM-BENCH-SEAM-1 oracle: the trusted build setup (`rh_sim::trusted_build`, feature `trusted-build-setup`) gives
//! a camp-bench fighter a minute-5 build whose effects reach the fold, observation, the state hash and a checkpoint,
//! and refuses a request outside legacy `grantCard`'s rules without changing anything. Loose proof: directions and
//! rough sizes (owner direction 2026-11-10).
#![cfg(feature = "trusted-build-setup")]

use rh_sim::archetype::{HitboxMode, MobSpacing};
use rh_sim::build_summary::build_summary;
use rh_sim::cards::CardId;
use rh_sim::events::Event;
use rh_sim::mob_catalog::{elites_of, MobTypeId};
use rh_sim::mob_runtime::MobMode;
use rh_sim::reward_chests::BoostId;
use rh_sim::trusted_build::{apply, BuildRefusal, TrustedBuild};
use rh_sim::{
    abilities, terrain, validate, Arena, ArenaMode, FactionId, FactionMode, Placement, PlayerId,
    RawCommand, Secrets, Sim, SimConfig, Vec2, WeaponId,
};

const SEED: u64 = 1;

fn arena() -> Arena {
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    export.validate().unwrap().into_arena().unwrap()
}

/// The camp bench's PvE config (`crates/rh-headless/src/bin/camp_bench.rs:164-183`), legacy hitboxes.
fn config() -> SimConfig {
    SimConfig {
        mob_spacing: MobSpacing::Auto,
        walk_hints: Some(true),
        regen: false,
        quests: false,
        hazards: terrain::Mode::All,
        abilities: abilities::Mode::Full,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        lifecycle: ArenaMode::Off,
        mob_mode: MobMode::Pve,
        initial_loot: true,
        consumables: false,
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        hitboxes: HitboxMode::LegacyCircle,
        ..SimConfig::default()
    }
}

fn world(arena: &Arena, at: Vec2) -> Sim {
    let placement = [Placement {
        profile: "fighter".into(),
        faction: FactionId::Holy,
        bot: false,
        at,
        hp: None,
        weapon0: Some(WeaponId::Sword),
        weapon1: None,
    }];
    Sim::reset_active(
        config(),
        arena.clone(),
        Secrets::from_seed(SEED),
        &placement,
    )
}

/// A floor point 96 to 160 units from the first camp's centre with a floor line to it (the bench's rule).
fn scene(arena: &Arena) -> Vec2 {
    let probe = world(arena, arena.spawns[0]);
    let members: Vec<Vec2> = probe
        .mobs()
        .iter()
        .filter(|m| m.camp == 0 && m.zombie.is_none())
        .map(|m| m.core.pos())
        .collect();
    assert!(!members.is_empty(), "seed {SEED} rolls camp 0 with mobs");
    let n = members.len() as f64;
    let centre = Vec2::new(
        members.iter().map(|p| p.x).sum::<f64>() / n,
        members.iter().map(|p| p.y).sum::<f64>() / n,
    );
    let floor_line = |a: Vec2, b: Vec2| {
        (0..=40).all(|i| {
            let t = f64::from(i) / 40.;
            arena.map.is_floor(
                rh_sim::map::world_to_tile(a.x + (b.x - a.x) * t),
                rh_sim::map::world_to_tile(a.y + (b.y - a.y) * t),
            )
        })
    };
    for dist in [160., 128., 96.] {
        for k in 0..16 {
            let a = f64::from(k) * std::f64::consts::TAU / 16.;
            let p = Vec2::new(
                centre.x + rh_sim::math::cos(a) * dist,
                centre.y + rh_sim::math::sin(a) * dist,
            );
            if floor_line(p, centre) {
                return p;
            }
        }
    }
    panic!("no floor start point near camp 0");
}

/// A minute-5 build: three augments (one outside today's chest pool), two stat-stack rows and two chest boosts.
fn minute_five() -> TrustedBuild {
    TrustedBuild {
        cards: vec![
            (CardId::TankEngine, 1),
            (CardId::Hemorrhage, 1),
            (CardId::Committed, 1),
        ],
        stacks: vec![(MobTypeId::EmberImp, 12), (MobTypeId::MagmaBrute, 12)],
        boosts: vec![(BoostId::Ad, 2)],
    }
}

fn checkpoint_round_trip(sim: &Sim, when: &str) -> Sim {
    let value = serde_json::to_value(sim).unwrap_or_else(|e| panic!("{when}: checkpoint: {e}"));
    let restored = Sim::restore(value)
        .unwrap_or_else(|e| panic!("{when}: check_world refused the restore: {e}"));
    assert_eq!(
        restored.state_hash(),
        sim.state_hash(),
        "{when}: the restored world hashes as the original"
    );
    restored
}

#[test]
fn a_minute_five_build_reaches_the_fold_and_survives_a_checkpoint() {
    let arena = arena();
    let start = scene(&arena);
    let mut sim = world(&arena, start);
    let me: PlayerId = sim.players()[0].id;
    // One step first: the build-mark cache is then current, so a write that leaves it stale shows at the observe below.
    sim.step();
    let base = sim.clone();
    let bp = base.player(me).unwrap();
    assert_eq!(bp.vitals.hp, bp.vitals.max_hp, "precondition: full health");

    assert_eq!(apply(&mut sim, me, &minute_five()), Ok(()));
    let p = sim.player(me).unwrap();
    for card in [CardId::TankEngine, CardId::Hemorrhage, CardId::Committed] {
        assert_eq!(p.build.count(card), 1, "{card:?} held once");
    }
    assert_eq!(p.farm.count(MobTypeId::EmberImp), 12);
    assert_eq!(p.farm.count(MobTypeId::MagmaBrute), 12);
    assert_eq!(p.build.boosts()[BoostId::Ad.index()], 2);

    // Effective stats: 12 Magma Brute stacks are +12% max hp; 12 Ember Imp stacks and Committed are +32% damage;
    // Committed is +15% attack speed; two Ad boosts add Offense. Tank Engine adds nothing until blocks earn it.
    let ratio = p.vitals.max_hp / bp.vitals.max_hp;
    assert!(
        (1.11..=1.13).contains(&ratio),
        "max hp {} vs {} without the build: ratio {ratio}, expected about 1.12",
        p.vitals.max_hp,
        bp.vitals.max_hp
    );
    assert_eq!(
        p.vitals.hp, p.vitals.max_hp,
        "current hp follows max hp (sync_max_hp): a full fighter stays full"
    );
    assert_eq!(
        p.card_tank_hp, 0.,
        "Tank Engine's bonus is earned by blocks, not granted"
    );
    let (s, b) = (
        build_summary(&sim, me).unwrap(),
        build_summary(&base, me).unwrap(),
    );
    let damage = s.damage - b.damage;
    assert!(
        (0.30..=0.34).contains(&damage),
        "damage +{damage}, expected about +0.32"
    );
    let attack_speed = s.attack_speed - b.attack_speed;
    assert!(
        (0.12..=0.18).contains(&attack_speed),
        "attack speed +{attack_speed}, expected about +0.15"
    );
    assert!(
        s.offense > b.offense,
        "two Ad boosts add Offense: {} vs {}",
        s.offense,
        b.offense
    );

    // Observable at once (a stale build-mark cache debug-asserts here), and no event, no draw: a twin given the same
    // request hashes the same.
    let _ = rh_sim::observe(&sim, me, &[]);
    assert!(sim.take_events().is_empty(), "the setup emits no event");
    let mut twin = base.clone();
    assert_eq!(apply(&mut twin, me, &minute_five()), Ok(()));
    assert_eq!(
        twin.state_hash(),
        sim.state_hash(),
        "same request, same world"
    );
    assert_ne!(
        base.state_hash(),
        sim.state_hash(),
        "the build is part of the state"
    );
    let mut restored = checkpoint_round_trip(&sim, "after the setup");

    // It fights the camp the way the bench's Brawler does (`crates/rh-policy/src/scripted.rs:187-214`): walk to the
    // nearest live mob of camp 0, attack it within 80 units. A hit involving the fighter lands, and the restored copy
    // stays in step with the original.
    let mut fought = false;
    for tick in 0..400 {
        let Some(p) = sim.player(me).filter(|p| p.standing()) else {
            break;
        };
        let at = p.core.pos();
        let target = sim
            .mobs()
            .iter()
            .filter(|m| m.camp == 0 && m.zombie.is_none() && m.core.vitals.hp > 0.)
            .map(|m| m.core.pos())
            .min_by(|a, b| {
                let d2 = |p: &Vec2| (p.x - at.x) * (p.x - at.x) + (p.y - at.y) * (p.y - at.y);
                d2(a).total_cmp(&d2(b))
            });
        // One order every 5 ticks (the submit budget refuses one every tick).
        if let Some(t) = target.filter(|_| tick % 5 == 0) {
            let (dx, dy) = (t.x - at.x, t.y - at.y);
            let raw = if rh_sim::math::sqrt(dx * dx + dy * dy) < 80. {
                RawCommand::Attack {
                    a: rh_sim::math::atan2(dy, dx),
                    t: Some(sim.server_time() - 100.),
                }
            } else {
                RawCommand::Move {
                    x: t.x,
                    y: t.y,
                    seq: None,
                }
            };
            let cmd = validate(raw).unwrap();
            sim.submit(me, cmd).unwrap();
            restored.submit(me, cmd).unwrap();
        }
        let events = sim.step();
        restored.step();
        fought |= events.iter().any(|e| match e {
            Event::Hit { victim, by, .. } | Event::AbilityHit { victim, by, .. } => {
                *victim == me || *by == Some(me)
            }
            _ => false,
        });
    }
    assert!(fought, "the fighter traded a hit with camp 0 in 400 ticks");
    assert_eq!(
        restored.state_hash(),
        sim.state_hash(),
        "the restored world stays in step through the fight"
    );
    checkpoint_round_trip(&sim, "after the fight");
}

#[test]
fn invalid_requests_are_refused_and_change_nothing() {
    let arena = arena();
    let mut sim = world(&arena, arena.spawns[0]);
    let me: PlayerId = sim.players()[0].id;
    let cap = rh_sim::stat_fold::default_definition().chest_boost_max_picks as u8;
    let elite = elites_of(FactionId::Fire).next().unwrap().id;
    let cards = |cards: &[(CardId, u8)]| TrustedBuild {
        cards: cards.to_vec(),
        ..TrustedBuild::default()
    };
    let refused: Vec<(&str, PlayerId, TrustedBuild, BuildRefusal)> = vec![
        (
            "a conditional without its base card",
            me,
            cards(&[(CardId::Juggernaut, 1)]),
            BuildRefusal::NeedsBase(CardId::Juggernaut),
        ),
        (
            "a unique card twice in one request",
            me,
            cards(&[(CardId::Hemorrhage, 1), (CardId::Hemorrhage, 1)]),
            BuildRefusal::UniqueHeld(CardId::Hemorrhage),
        ),
        (
            "a unique card with two copies",
            me,
            cards(&[(CardId::Committed, 2)]),
            BuildRefusal::UniqueHeld(CardId::Committed),
        ),
        (
            "a base card past 255 copies",
            me,
            cards(&[(CardId::Ad1, 200), (CardId::Ad1, 100)]),
            BuildRefusal::CardCount(CardId::Ad1),
        ),
        (
            "a valid augment then a conditional without its base (all or nothing)",
            me,
            cards(&[(CardId::Hemorrhage, 1), (CardId::Juggernaut, 1)]),
            BuildRefusal::NeedsBase(CardId::Juggernaut),
        ),
        (
            "an elite's stat stacks",
            me,
            TrustedBuild {
                stacks: vec![(elite, 3)],
                ..TrustedBuild::default()
            },
            BuildRefusal::NotNormalMob(elite),
        ),
        (
            "stat stacks past the farm maximum",
            me,
            TrustedBuild {
                stacks: vec![(MobTypeId::EmberImp, u64::MAX)],
                ..TrustedBuild::default()
            },
            BuildRefusal::StacksOverMax(MobTypeId::EmberImp),
        ),
        (
            "a boost past the chest's pick cap",
            me,
            TrustedBuild {
                boosts: vec![(BoostId::Ad, cap + 1)],
                ..TrustedBuild::default()
            },
            BuildRefusal::BoostOverCap(BoostId::Ad),
        ),
        (
            "an unknown player",
            PlayerId(9_999),
            minute_five(),
            BuildRefusal::NoSuchPlayer(PlayerId(9_999)),
        ),
    ];
    let before = sim.state_hash();
    for (what, id, request, why) in &refused {
        assert_eq!(apply(&mut sim, *id, request), Err(*why), "{what}");
        assert_eq!(sim.state_hash(), before, "{what}: the world is unchanged");
        let p = sim.player(me).unwrap();
        assert_eq!(p.build.cards().count(), 0, "{what}: no card granted");
        assert_eq!(p.farm.count(MobTypeId::EmberImp), 0, "{what}: no stacks");
        assert_eq!(p.build.boosts(), [0; 8], "{what}: no boost");
    }

    // A card already held is refused on a second request, and that refusal changes nothing either.
    assert_eq!(
        apply(&mut sim, me, &cards(&[(CardId::Hemorrhage, 1)])),
        Ok(())
    );
    let held = sim.state_hash();
    assert_ne!(held, before, "the accepted grant is part of the state");
    assert_eq!(
        apply(&mut sim, me, &cards(&[(CardId::Hemorrhage, 1)])),
        Err(BuildRefusal::UniqueHeld(CardId::Hemorrhage)),
        "a unique card already held"
    );
    assert_eq!(
        sim.state_hash(),
        held,
        "a unique card already held: unchanged"
    );

    // Legacy grantCard's rules, not a blanket refusal: a conditional after its base card in the same request is held.
    assert_eq!(
        apply(
            &mut sim,
            me,
            &cards(&[(CardId::Ad1, 1), (CardId::Juggernaut, 1)])
        ),
        Ok(())
    );
    let p = sim.player(me).unwrap();
    assert!(p.build.owns(CardId::Ad1) && p.build.owns(CardId::Juggernaut));
    checkpoint_round_trip(&sim, "after the accepted grants");
}

#[test]
fn an_unknown_card_name_is_a_parse_error() {
    let ok: TrustedBuild = serde_json::from_str(
        r#"{"cards":[["tankEngine",1]],"stacks":[["emberImp",12]],"boosts":[["ad",2]]}"#,
    )
    .expect("the documented JSON form parses");
    assert_eq!(ok.cards, vec![(CardId::TankEngine, 1)]);
    assert_eq!(ok.stacks, vec![(MobTypeId::EmberImp, 12)]);
    assert_eq!(ok.boosts, vec![(BoostId::Ad, 2)]);
    for bad in [
        r#"{"cards":[["notACard",1]]}"#,
        r#"{"stacks":[["notAMob",1]]}"#,
        r#"{"boosts":[["notABoost",1]]}"#,
        r#"{"spells":[]}"#,
    ] {
        assert!(
            serde_json::from_str::<TrustedBuild>(bad).is_err(),
            "{bad} is refused"
        );
    }
}
