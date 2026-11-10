//! ADR0024 Rust-native goldens: the archetype hitboxes (`SimConfig::hitboxes = Archetypes`) against the legacy circle.
//! These are a declared deviation (docs/DEVIATIONS.md), not legacy parity: every legacy fixture runs `LegacyCircle`.
//!
//! * walls: the foot box lets a character stand with its feet 6 u from a north wall (the disc stops at 12 u);
//! * melee: measured from the attacker's feet raised by the TARGET's chest against the target's body box, so reach is even
//!   north and south, also between unequal archetypes;
//! * projectiles: fly at the shooter's chest; bodies are tested at that height, walls at the ground position;
//! * an arrow stops at the first enemy body it meets;
//! * legacy-circle equivalence: under the default mode every fighter is row 0, every flight has height 0, and the
//!   `Footprint::Disc` path is the radius path bit for bit.

use rh_sim::archetype::{assign, ArchetypeId, HitboxMode, Identity};
use rh_sim::arenas::practice_arena;
use rh_sim::constants::{PLAYER_RADIUS, TILE};
use rh_sim::content::{weapon, Shape};
use rh_sim::events::Event;
use rh_sim::geometry::{circle_clear, Footprint};
use rh_sim::map::{MASK_MOVE, MASK_SIGHT};
use rh_sim::math::Vec2;
use rh_sim::pathfind::Pathfinder;
use rh_sim::{
    validate, FactionId, Placement, PlayerId, ProjectileEnd, RawCommand, Secrets, Sim, SimConfig,
    TileMap, WeaponId,
};

const N: f64 = -std::f64::consts::FRAC_PI_2; // north is -y
const S: f64 = std::f64::consts::FRAC_PI_2;
const E: f64 = 0.0;

fn placement(n: u32, faction: FactionId, at: Vec2, w: Option<WeaponId>) -> Placement {
    Placement {
        profile: format!("p{n}"),
        faction,
        bot: false,
        at,
        hp: Some(10_000.0),
        weapon0: w,
        weapon1: None,
    }
}

fn world(mode: HitboxMode, ps: &[Placement]) -> Sim {
    Sim::reset_active(
        SimConfig {
            quests: false,
            weapon_specials: false,
            hitboxes: mode,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(24),
        ps,
    )
}

fn order(s: &mut Sim, id: u32, raw: RawCommand) {
    s.submit(PlayerId(id), validate(raw).unwrap()).unwrap();
}

/// Player 1 attacks along `a` (a swing, or a full draw and release); every event of the next two seconds.
fn attack(s: &mut Sim, a: f64) -> Vec<Event> {
    let mut out = Vec::new();
    order(s, 1, RawCommand::Attack { a, t: None });
    for i in 0..40 {
        if i == 20 {
            order(s, 1, RawCommand::Release { a, t: None });
        }
        out.extend(s.step());
    }
    out
}

fn hit(events: &[Event], victim: u32) -> bool {
    events
        .iter()
        .any(|e| matches!(e, Event::Hit { victim: v, by: Some(PlayerId(1)), .. } if *v == PlayerId(victim)))
}

/// A point of the practice arena with nothing blocking sight or movement within `r`.
fn open_spot(map: &TileMap, r: f64) -> Vec2 {
    let (w, h) = (map.w as i64, map.h as i64);
    (0..h)
        .flat_map(|ty| (0..w).map(move |tx| (tx, ty)))
        .map(|(tx, ty)| Vec2::new(tx as f64 * TILE + TILE / 2.0, ty as f64 * TILE + TILE / 2.0))
        .find(|&p| circle_clear(map, p, r, MASK_SIGHT) && circle_clear(map, p, r, MASK_MOVE))
        .expect("an open area")
}

/// A point with an open lane 260 u to the east: open discs of 70 u along it (sight and movement).
fn east_lane(map: &TileMap) -> Vec2 {
    let (w, h) = (map.w as i64, map.h as i64);
    (0..h)
        .flat_map(|ty| (0..w).map(move |tx| (tx, ty)))
        .map(|(tx, ty)| Vec2::new(tx as f64 * TILE + TILE / 2.0, ty as f64 * TILE + TILE / 2.0))
        .find(|&p| {
            (0..=13).all(|k| {
                let q = Vec2::new(p.x + 20.0 * k as f64, p.y);
                circle_clear(map, q, 70.0, MASK_SIGHT) && circle_clear(map, q, 70.0, MASK_MOVE)
            })
        })
        .expect("an open east lane")
}

fn sword_reach() -> f64 {
    match weapon(WeaponId::Sword).shape {
        Shape::Arc { reach, .. } => reach,
        _ => unreachable!(),
    }
}

#[test]
fn every_fighter_gets_the_archetype_its_identity_assigns() {
    let at = open_spot(&practice_arena().map, 120.0);
    let factions = [
        FactionId::Fire,
        FactionId::Plague,
        FactionId::Frost,
        FactionId::Holy,
        FactionId::Sentenced,
    ];
    let ps: Vec<_> = factions
        .iter()
        .enumerate()
        .map(|(i, &f)| {
            placement(
                i as u32 + 1,
                f,
                Vec2::new(at.x + 20.0 * i as f64, at.y),
                None,
            )
        })
        .collect();
    for mode in [HitboxMode::LegacyCircle, HitboxMode::Archetypes] {
        let mut s = world(mode, &ps);
        for _ in 0..5 {
            s.step();
            for p in s.players() {
                let want = assign(mode, Identity::Player(p.vitals.faction));
                assert_eq!(p.archetype, want);
            }
        }
        let ids: Vec<_> = s.players().iter().map(|p| p.archetype).collect();
        if mode == HitboxMode::LegacyCircle {
            assert!(ids.iter().all(|&a| a == ArchetypeId::LEGACY_CIRCLE));
        } else {
            assert_eq!(
                ids,
                [
                    ArchetypeId::HERO,
                    ArchetypeId::MAGE,
                    ArchetypeId::HERO_FEMALE,
                    ArchetypeId::MAGE_FEMALE,
                    ArchetypeId::HERO
                ]
            );
        }
        // A checkpoint keeps the ids; a forged id is refused.
        let mut json = serde_json::to_value(&s).unwrap();
        assert_eq!(
            Sim::restore(json.clone()).unwrap().state_hash(),
            s.state_hash()
        );
        let core = json["world"]["players"]
            .as_array_mut()
            .and_then(|ps| ps.first_mut())
            .expect("a player in the checkpoint");
        let slot = find_key(core, "archetype").expect("archetype is checkpointed");
        *slot = serde_json::json!(if mode == HitboxMode::Archetypes { 0 } else { 1 });
        assert!(
            Sim::restore(json.clone()).is_err(),
            "a mismatched archetype is refused"
        );
        let slot = find_key(
            json["world"]["players"]
                .as_array_mut()
                .unwrap()
                .first_mut()
                .unwrap(),
            "archetype",
        )
        .unwrap();
        *slot = serde_json::json!(200);
        assert!(
            Sim::restore(json).is_err(),
            "an unknown archetype is refused"
        );
    }
}

fn find_key<'a>(v: &'a mut serde_json::Value, key: &str) -> Option<&'a mut serde_json::Value> {
    match v {
        serde_json::Value::Object(m) => {
            if m.contains_key(key) {
                return m.get_mut(key);
            }
            m.values_mut().find_map(|x| find_key(x, key))
        }
        serde_json::Value::Array(a) => a.iter_mut().find_map(|x| find_key(x, key)),
        _ => None,
    }
}

/// A floor tile whose north neighbour is a wall, with floor on the other three sides and two more floor rows south.
fn under_a_north_wall(map: &TileMap) -> (i64, i64) {
    let (w, h) = (map.w as i64, map.h as i64);
    (1..h - 3)
        .flat_map(|ty| (1..w - 1).map(move |tx| (tx, ty)))
        .find(|&(tx, ty)| {
            map.is_solid(tx, ty - 1)
                && map.is_solid(tx - 1, ty - 1)
                && map.is_solid(tx + 1, ty - 1)
                && (0..3).all(|dy| (-1..=1).all(|dx| map.is_floor(tx + dx, ty + dy)))
        })
        .expect("a floor tile under a straight north wall")
}

#[test]
fn walking_north_into_a_wall_the_foot_box_stands_with_its_feet_against_it() {
    let map = practice_arena().map;
    let (tx, ty) = under_a_north_wall(&map);
    let face = ty as f64 * TILE;
    let x = tx as f64 * TILE + TILE / 2.0;
    let start = Vec2::new(x, face + 2.5 * TILE);
    for (mode, gap) in [
        (HitboxMode::LegacyCircle, PLAYER_RADIUS),
        (HitboxMode::Archetypes, 6.0),
    ] {
        let mut s = world(mode, &[placement(1, FactionId::Fire, start, None)]);
        // Walk at the wall face itself: the goal is clamped to where the footprint fits.
        order(
            &mut s,
            1,
            RawCommand::Move {
                x,
                y: face + 1.0,
                seq: Some(1),
            },
        );
        for _ in 0..40 {
            s.step();
        }
        let p = &s.players()[0];
        assert_eq!(p.body.x, x, "{mode:?}");
        assert_eq!(
            p.body.y,
            face + gap,
            "{mode:?}: feet stop {gap} u from the north wall"
        );
        assert!(p.foot().clear(&map, p.pos(), MASK_MOVE));
    }
}

#[test]
fn melee_reach_is_even_north_and_south_between_unequal_archetypes() {
    let map = practice_arena().map;
    let reach = sword_reach();
    // Hero (Fire, chest 30) swings at a mage (Plague, body half-height 28): the reach to the mage's feet is reach + 28
    // both ways under the target-chest rule (the literal attacker-chest rule would give reach + 28 +/- 5).
    let at = open_spot(&map, reach + 90.0);
    let mage_by = 28.0;
    for (aim, sign) in [(N, -1.0), (S, 1.0)] {
        for (d, want) in [
            (reach + mage_by - 0.5, true),
            (reach + mage_by + 0.5, false),
        ] {
            let target = Vec2::new(at.x, at.y + sign * d);
            let ps = [
                placement(1, FactionId::Fire, at, Some(WeaponId::Sword)),
                placement(2, FactionId::Plague, target, None),
            ];
            let mut s = world(HitboxMode::Archetypes, &ps);
            assert_eq!(hit(&attack(&mut s, aim), 2), want, "aim {aim} d {d}");
        }
    }
    // East-west the box half-width (16, the mage) adds instead; the legacy disc adds 12 in every direction.
    for (mode, extra) in [
        (HitboxMode::Archetypes, 16.0),
        (HitboxMode::LegacyCircle, PLAYER_RADIUS),
    ] {
        for (d, want) in [(reach + extra - 0.5, true), (reach + extra + 0.5, false)] {
            let ps = [
                placement(1, FactionId::Fire, at, Some(WeaponId::Sword)),
                placement(2, FactionId::Plague, Vec2::new(at.x + d, at.y), None),
            ];
            let mut s = world(mode, &ps);
            assert_eq!(hit(&attack(&mut s, E), 2), want, "{mode:?} east d {d}");
        }
    }
}

#[test]
fn a_shot_hits_at_chest_height() {
    let map = practice_arena().map;
    let at = east_lane(&map);
    // The target stands 40 u north of the shot's ground line: the legacy disc (12 + 7) misses it, the hero's raised
    // arrow (30 u up) meets the target hero's body box (feet - 65 .. feet + 5, grown by 7).
    let target = Vec2::new(at.x + 200.0, at.y - 40.0);
    for (mode, want) in [
        (HitboxMode::LegacyCircle, false),
        (HitboxMode::Archetypes, true),
    ] {
        let ps = [
            placement(1, FactionId::Fire, at, Some(WeaponId::Bow)),
            placement(2, FactionId::Sentenced, target, None),
        ];
        let mut s = world(mode, &ps);
        let events = attack(&mut s, E);
        let launched = events.iter().find_map(|e| match e {
            Event::ProjectileLaunched(l) => Some(*l),
            _ => None,
        });
        let launch = launched.expect("the bow fired");
        assert_eq!(launch.height, if want { 30.0 } else { 0.0 }, "{mode:?}");
        assert_eq!(hit(&events, 2), want, "{mode:?}");
    }
}

#[test]
fn walls_are_tested_at_the_ground_position() {
    let map = practice_arena().map;
    let (tx, ty) = under_a_north_wall(&map);
    let face = ty as f64 * TILE;
    let x = tx as f64 * TILE + TILE / 2.0;
    // Feet 6 u under the wall: a shot north hits the wall at once, and nothing beyond it.
    let feet = Vec2::new(x, face + 6.0);
    let mut s = world(
        HitboxMode::Archetypes,
        &[
            placement(1, FactionId::Fire, feet, Some(WeaponId::Bow)),
            placement(2, FactionId::Frost, Vec2::new(x, face - 3.0 * TILE), None),
        ],
    );
    let events = attack(&mut s, N);
    let end = events.iter().find_map(|e| match e {
        Event::ProjectileEnded { reason, at, .. } => Some((*reason, *at)),
        _ => None,
    });
    let (reason, at) = end.expect("the arrow ended");
    assert_eq!(reason, ProjectileEnd::Wall);
    assert_eq!(at.y, face, "the ground ray stops at the wall face");
    assert!(!hit(&events, 2));
    // Feet 6 u under the same wall, shooting along it: the raised path (30 u up, inside the wall on screen) does not stop
    // the shot; the ground path is clear, so it flies on and ends at range or at a wall, never on the wall above it.
    let mut s = world(
        HitboxMode::Archetypes,
        &[placement(1, FactionId::Fire, feet, Some(WeaponId::Bow))],
    );
    let events = attack(&mut s, E);
    let (_, at) = events
        .iter()
        .find_map(|e| match e {
            Event::ProjectileEnded { reason, at, .. } => Some((*reason, *at)),
            _ => None,
        })
        .expect("the arrow ended");
    assert!(
        at.x > x + TILE,
        "the arrow travelled along the wall: {at:?}"
    );
}

#[test]
fn an_arrow_stops_at_the_first_enemy_body() {
    let map = practice_arena().map;
    let at = east_lane(&map);
    let ps = [
        placement(1, FactionId::Fire, at, Some(WeaponId::Bow)),
        placement(2, FactionId::Frost, Vec2::new(at.x + 120.0, at.y), None),
        placement(3, FactionId::Holy, Vec2::new(at.x + 200.0, at.y), None),
    ];
    for mode in [HitboxMode::LegacyCircle, HitboxMode::Archetypes] {
        let mut s = world(mode, &ps);
        let events = attack(&mut s, E);
        assert!(hit(&events, 2), "{mode:?}: the front body is hit");
        assert!(!hit(&events, 3), "{mode:?}: the rear body is shielded");
    }
}

#[test]
fn the_disc_footprint_path_is_the_radius_path_bit_for_bit() {
    let map = practice_arena().map;
    let (ww, wh) = map.world_size();
    let mut rng = rh_sim::rng::Mulberry32::new(0x4842_0010);
    let mut a = Pathfinder::default();
    let mut b = Pathfinder::default();
    let bits = |p: &[Vec2]| {
        p.iter()
            .map(|v| (v.x.to_bits(), v.y.to_bits()))
            .collect::<Vec<_>>()
    };
    let mut boxed_differs = 0;
    for _ in 0..400 {
        let from = Vec2::new(rng.next_f64() * ww, rng.next_f64() * wh);
        let to = Vec2::new(rng.next_f64() * ww, rng.next_f64() * wh);
        let want = a.find_path(&map, from, to, PLAYER_RADIUS);
        assert_eq!(
            bits(&b.find_path(&map, from, to, Footprint::Disc(PLAYER_RADIUS))),
            bits(&want)
        );
        let boxed = b.find_path(&map, from, to, Footprint::Box { hx: 10.0, hy: 6.0 });
        boxed_differs += (bits(&boxed) != bits(&want)) as u32;
        // Every boxed waypoint leaves the foot box clear.
        for p in &boxed {
            assert!(
                Footprint::Box { hx: 10.0, hy: 6.0 }.clear(&map, *p, MASK_MOVE)
                    || !map.is_floor((p.x / TILE).floor() as i64, (p.y / TILE).floor() as i64)
            );
        }
    }
    assert!(boxed_differs > 0, "the foot box changes some paths");
}

/// Review finding 2: an attacker standing inside the target's body box (the raised origin is inside it) is resolved with
/// the legacy arc test against the target's feet, so the facing-independent zone is legacy's 12 u disc and a swing aimed
/// south does not hit a target 20, 30 or 34 u north of the attacker (directly behind). In front, at the same distances,
/// it hits.
#[test]
fn melee_misses_a_target_behind_the_attacker_inside_its_box() {
    let map = practice_arena().map;
    let at = open_spot(&map, sword_reach() + 90.0);
    let swing = |aim: f64, target: Vec2| {
        let ps = [
            placement(1, FactionId::Fire, at, Some(WeaponId::Sword)),
            placement(2, FactionId::Sentenced, target, None),
        ];
        let mut s = world(HitboxMode::Archetypes, &ps);
        hit(&attack(&mut s, aim), 2)
    };
    for d in [20.0, 30.0, 34.0] {
        let north = Vec2::new(at.x, at.y - d);
        let south = Vec2::new(at.x, at.y + d);
        assert!(!swing(S, north), "aim south, target {d} u north (behind)");
        assert!(!swing(N, south), "aim north, target {d} u south (behind)");
        assert!(swing(N, north), "aim north, target {d} u north (in front)");
        assert!(swing(S, south), "aim south, target {d} u south (in front)");
    }
}

/// Review finding 2: sweeping a hero target straight out in front of a hero attacker, north and south, the hit set is one
/// interval [0, reach + 35] with no flip at the box boundary (35 u, where the legacy test hands over to the box test),
/// and the same both ways; straight behind, only legacy's 12 u disc hits, in both modes.
#[test]
fn melee_boundary_sweep_has_no_flip_and_is_even_north_and_south() {
    let map = practice_arena().map;
    let reach = sword_reach();
    let at = open_spot(&map, reach + 90.0);
    let hero_by = 35.0;
    for (aim, back, sign) in [(N, S, -1.0), (S, N, 1.0)] {
        let mut d = 0.0;
        while d <= reach + hero_by + 4.0 {
            let target = Vec2::new(at.x, at.y + sign * d);
            let ps = [
                placement(1, FactionId::Fire, at, Some(WeaponId::Sword)),
                placement(2, FactionId::Sentenced, target, None),
            ];
            let mut s = world(HitboxMode::Archetypes, &ps);
            assert_eq!(
                hit(&attack(&mut s, aim), 2),
                d <= reach + hero_by,
                "in front, aim {aim}, d {d}"
            );
            if d <= 60.0 {
                for mode in [HitboxMode::Archetypes, HitboxMode::LegacyCircle] {
                    let mut s = world(mode, &ps);
                    assert_eq!(
                        hit(&attack(&mut s, back), 2),
                        d <= PLAYER_RADIUS,
                        "{mode:?} behind, aim {back}, d {d}"
                    );
                }
            }
            d += if (hero_by - 3.0..=hero_by + 3.0).contains(&d) {
                0.5
            } else {
                3.0
            };
        }
    }
}

/// Fire one bow shot from `at` along `aim` at a hero target with feet at `target`; is the target hit?
fn bow_hits(mode: HitboxMode, at: Vec2, aim: f64, target: Vec2) -> bool {
    let ps = [
        placement(1, FactionId::Fire, at, Some(WeaponId::Bow)),
        placement(2, FactionId::Sentenced, target, None),
    ];
    let mut s = world(mode, &ps);
    hit(&attack(&mut s, aim), 2)
}

/// Review finding 3: a shot whose raised start is already inside a target's (grown) body box resolves that target with
/// the legacy ground contact (the swept ground segment against the feet, reach 12 + 7), not the box. Fired east, a target
/// whose feet are 30 u south and 1 u east or west of the shooter is missed on both sides (the box rule hit one and missed
/// the other); fired south, toward the target that overlaps the shooter, both are hit.
#[test]
fn a_point_blank_shot_does_not_flip_on_a_one_unit_offset() {
    let at = east_lane(&practice_arena().map);
    for dx in [1.0, -1.0] {
        let target = Vec2::new(at.x + dx, at.y + 30.0);
        assert!(
            !bow_hits(HitboxMode::Archetypes, at, E, target),
            "fired east, target at ({dx}, +30)"
        );
        assert!(
            bow_hits(HitboxMode::Archetypes, at, S, target),
            "fired south, target at ({dx}, +30)"
        );
    }
}

/// Review finding 3: sweeping the target across the shooter (every whole unit from 22 u west to 22 u east, the whole
/// start-inside zone of a hero box grown by the arrow radius, half-width 23), at several distances south, the verdict
/// never changes: fired east it always misses (the legacy ground track passes 20 u or more from the feet); fired south it
/// hits exactly while the feet are within the legacy reach (|dx| <= 19) in both modes.
#[test]
fn a_lateral_sweep_through_the_start_inside_zone_has_no_single_unit_flip() {
    let at = east_lane(&practice_arena().map);
    let reach = PLAYER_RADIUS + 7.0;
    for dy in [20.0, 30.0, 40.0] {
        for k in -22..=22 {
            let target = Vec2::new(at.x + k as f64, at.y + dy);
            assert!(
                !bow_hits(HitboxMode::Archetypes, at, E, target),
                "fired east, target at ({k}, +{dy})"
            );
        }
    }
    for k in -22..=22 {
        let target = Vec2::new(at.x + k as f64, at.y + 30.0);
        for mode in [HitboxMode::Archetypes, HitboxMode::LegacyCircle] {
            assert_eq!(
                bow_hits(mode, at, S, target),
                (k as f64).abs() <= reach,
                "{mode:?} fired south, target at ({k}, +30)"
            );
        }
    }
}

/// Review finding 4: a checkpoint's projectile height must be one this match's mode can launch: exactly 0 under the
/// legacy circle, one of the table's chest values under archetypes. Anything else is refused at restore (a legacy flight
/// at 30 would home and meet balls differently; 300 or 30.5 would fail every observation's projection).
#[test]
fn restore_refuses_a_projectile_height_the_mode_cannot_launch() {
    let at = east_lane(&practice_arena().map);
    for (mode, own, good, bad) in [
        (
            HitboxMode::LegacyCircle,
            0.0,
            &[][..],
            &[30.0, -0.0, 0.5, 300.0][..],
        ),
        (
            HitboxMode::Archetypes,
            30.0,
            &[21.0, 11.0][..],
            &[0.0, 25.0, 30.5, 300.0, -30.0][..],
        ),
    ] {
        let ps = [placement(1, FactionId::Fire, at, Some(WeaponId::Bow))];
        let mut s = world(mode, &ps);
        order(&mut s, 1, RawCommand::Attack { a: E, t: None });
        let mut launched = false;
        for i in 0..40 {
            if i == 20 {
                order(&mut s, 1, RawCommand::Release { a: E, t: None });
            }
            launched |= s
                .step()
                .iter()
                .any(|e| matches!(e, Event::ProjectileLaunched(_)));
            if launched {
                break;
            }
        }
        assert!(launched, "{mode:?}: the bow fired");
        let json = serde_json::to_value(&s).unwrap();
        let with_height = |h: f64| {
            let mut j = json.clone();
            let flight = j["world"]["projectiles"]
                .as_array_mut()
                .and_then(|p| p.first_mut())
                .expect("a projectile in flight");
            let slot = find_key(flight, "height").expect("height is checkpointed");
            assert_eq!(slot.as_f64(), Some(own), "{mode:?}");
            *slot = serde_json::json!(h);
            j
        };
        assert_eq!(
            Sim::restore(with_height(own)).unwrap().state_hash(),
            s.state_hash(),
            "{mode:?}: the launched height restores"
        );
        for &h in good {
            assert!(Sim::restore(with_height(h)).is_ok(), "{mode:?} height {h}");
        }
        for &h in bad {
            assert!(
                Sim::restore(with_height(h)).is_err(),
                "{mode:?} height {h} is refused"
            );
        }
    }
}
