//! Mob spacing (ADR0024 addendum "Mob spacing") in whole matches: a practice pack woken on one stationary player.
//!
//! * open floor: the pack ends spread round the target with pairwise room (or the settled minimum), every melee mob
//!   within its stop band, every mob attacking; the same pack under the legacy circle stacks;
//! * a corridor dead end and a doorway: no deadlock (the target is hit), no jitter (the pack comes to rest), every foot
//!   box clear of walls at every tick;
//! * ranged mobs stay inside their [retreat, far] band;
//! * determinism: the same run twice, and a checkpoint restored mid-run, give the same hashes;
//! * the legacy circle: the index is never built and the run is the pinned pre-spacing trajectory.
use crate::archetype::HitboxMode;
use crate::constants::*;
use crate::content::{weapon, Shape, WeaponId};
use crate::map::{TileMap, MASK_MOVE};
use crate::math::{hypot, Vec2};
use crate::mob_catalog::mob_type_by_id;
use crate::mob_runtime::MobRuntime;
use crate::state::Status;
use crate::{Arena, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig};

fn arena(rows: &[&str]) -> Arena {
    let rows: Vec<String> = rows.iter().map(|r| r.to_string()).collect();
    let map = TileMap::from_rows(&rows).expect("test map");
    Arena {
        map,
        spawns: vec![Vec2::new(48., 48.)],
    }
}

fn centre(tx: i64, ty: i64) -> Vec2 {
    Vec2::new(tx as f64 * TILE + TILE / 2., ty as f64 * TILE + TILE / 2.)
}

/// A walled 40 x 24 open room.
fn open_room() -> Arena {
    let mut rows = Vec::new();
    for y in 0..24 {
        let mut r = String::new();
        for x in 0..40 {
            r.push(if x == 0 || y == 0 || x == 39 || y == 23 {
                '#'
            } else {
                '.'
            });
        }
        rows.push(r);
    }
    arena(&rows.iter().map(String::as_str).collect::<Vec<_>>())
}

/// A room (x 1..=14) whose east wall has a one-tile corridor (row 10) running east to a dead end at x 24.
fn corridor() -> Arena {
    let mut rows = Vec::new();
    for y in 0..20 {
        let mut r = String::new();
        for x in 0..32 {
            let room = (1..=14).contains(&x) && (1..=18).contains(&y);
            let hall = y == 10 && (15..=24).contains(&x);
            r.push(if room || hall { '.' } else { '#' });
        }
        rows.push(r);
    }
    arena(&rows.iter().map(String::as_str).collect::<Vec<_>>())
}

/// Two rooms (x 1..=14 and x 16..=30) joined by a one-tile doorway in the wall at x 15, row 10.
fn doorway() -> Arena {
    let mut rows = Vec::new();
    for y in 0..20 {
        let mut r = String::new();
        for x in 0..32 {
            let inside = (1..=30).contains(&x) && (1..=18).contains(&y);
            let wall = x == 15 && y != 10;
            r.push(if inside && !wall { '.' } else { '#' });
        }
        rows.push(r);
    }
    arena(&rows.iter().map(String::as_str).collect::<Vec<_>>())
}

/// One stationary player at `target` and `n` practice mobs of `kind` woken on it, born in a tight clump round `from`.
fn pack(mode: HitboxMode, arena: Arena, target: Vec2, from: Vec2, n: usize, kind: &str) -> Sim {
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: false,
            // Practice mobs belong to a training world (a checkpoint of any other world refuses them).
            training: true,
            hitboxes: mode,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(31),
        &[Placement {
            profile: "target".into(),
            faction: FactionId::Fire,
            bot: false,
            at: target,
            hp: Some(1e9),
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        }],
    );
    assert!(sim
        .w
        .mob_runtime
        .as_ref()
        .is_some_and(|r: &MobRuntime| r.combat));
    let ty = mob_type_by_id(kind).unwrap().id;
    let now = sim.w.server_time;
    for i in 0..n {
        // A 3-wide clump, 4 u apart: every mob overlaps its neighbours at birth.
        let at = Vec2::new(from.x + (i % 3) as f64 * 4., from.y + (i / 3) as f64 * 4.);
        let id = super::mobs::place_practice_mob(&mut sim.w, ty, false, 101, at, 0., mode);
        let b = sim.w.mobs.get_mut(id).unwrap().brain.as_mut().unwrap();
        super::mob_ai::add_threat(b, PlayerId(1), 1.);
        super::mob_ai::wake(b, PlayerId(1), now);
    }
    sim
}

fn mobs(sim: &Sim) -> Vec<(PlayerId, Vec2)> {
    sim.w
        .mobs
        .iter()
        .filter(|m| m.status == Status::Alive && m.kind == crate::mob_runtime::MobKind::Practice)
        .map(|m| (m.core.id, m.core.pos()))
        .collect()
}

fn min_pair(ps: &[(PlayerId, Vec2)]) -> f64 {
    let mut best = f64::INFINITY;
    for (i, a) in ps.iter().enumerate() {
        for b in &ps[i + 1..] {
            best = best.min(hypot(a.1.x - b.1.x, a.1.y - b.1.y));
        }
    }
    best
}

/// Steps `ticks`, asserting at every tick that every mob's foot box is clear of walls; returns the hits on the target
/// by mob.
fn run(sim: &mut Sim, ticks: u32) -> std::collections::BTreeSet<PlayerId> {
    let mut hitters = std::collections::BTreeSet::new();
    for _ in 0..ticks {
        for e in sim.step() {
            if let crate::events::Event::Hit {
                victim: PlayerId(1),
                by: Some(by),
                ..
            } = e
            {
                hitters.insert(by);
            }
        }
        let map = sim.k.collision_map(sim.w.rt.gates_locked);
        for m in sim.w.mobs.iter() {
            assert!(
                m.core.foot().clear(map, m.core.pos(), MASK_MOVE),
                "mob {:?} stands in a wall at {:?}",
                m.core.id,
                m.core.pos()
            );
        }
    }
    hitters
}

fn far(w: WeaponId) -> f64 {
    crate::combat_policy::spacing(w, false).far
}

/// Twice the room of a boxed archetype: the target centre-to-centre distance of two mobs.
fn want_apart() -> f64 {
    2. * (crate::archetype::FOOT.x.max(crate::archetype::FOOT.y) + MOB_SPACING_MARGIN)
}

/// The settled floor the tests hold a pack to: 85% of the wanted distance (34 u, so 14 u of ground between two foot
/// boxes). A lone pair settles within 2 x MOB_SPACING_STEP_MIN of the wanted 40 u; inside a pack a mob stops once the
/// SUM of its neighbours' pushes is below the minimum step, so opposite pushes can leave a few units of overlap.
fn settled_floor() -> f64 {
    0.85 * want_apart()
}

#[test]
fn a_pack_on_open_floor_surrounds_its_target_with_room() {
    let target = centre(20, 12);
    let n = 8;
    let mut sim = pack(
        HitboxMode::Archetypes,
        open_room(),
        target,
        centre(6, 12),
        n,
        "emberImp",
    );
    let hitters = run(&mut sim, 240);
    let ps = mobs(&sim);
    assert_eq!(ps.len(), n);
    let band = far(WeaponId::Axe);
    for &(id, p) in &ps {
        let d = hypot(p.x - target.x, p.y - target.y);
        assert!(d <= band, "{id:?} at {d} is outside the stop band {band}");
    }
    let min = min_pair(&ps);
    assert!(
        min >= settled_floor() - 1e-9,
        "pairwise minimum {min} below the settled floor {}",
        settled_floor()
    );
    // Every mob gets its swings in.
    assert_eq!(hitters.len(), n, "{hitters:?}");
    // They spread round the target, not along one line: the bearings span more than a quarter circle (eight mobs at
    // 40 u do not fit on the arc they arrive on, so the pack also stands two deep).
    let mut bearings: Vec<f64> = ps
        .iter()
        .map(|(_, p)| crate::math::atan2(p.y - target.y, p.x - target.x))
        .collect();
    bearings.sort_by(f64::total_cmp);
    let widest_gap = bearings
        .windows(2)
        .map(|w| w[1] - w[0])
        .chain([bearings[0] + std::f64::consts::TAU - bearings[bearings.len() - 1]])
        .fold(0., f64::max);
    assert!(
        std::f64::consts::TAU - widest_gap > std::f64::consts::FRAC_PI_2,
        "bearings {bearings:?}"
    );
}

/// The control: the same pack under the legacy circle has no spacing and ends stacked (this is what the owner saw).
#[test]
fn the_same_pack_under_the_legacy_circle_stacks() {
    let target = centre(20, 12);
    let mut sim = pack(
        HitboxMode::LegacyCircle,
        open_room(),
        target,
        centre(6, 12),
        8,
        "emberImp",
    );
    run(&mut sim, 240);
    let min = min_pair(&mobs(&sim));
    assert!(min < 8., "legacy pack minimum {min}");
    assert!(sim.s.mob_spacing.is_empty(), "the index is never built");
}

#[test]
fn a_ranged_pack_keeps_its_range_band() {
    let target = centre(24, 12);
    let n = 6;
    let mut sim = pack(
        HitboxMode::Archetypes,
        open_room(),
        target,
        centre(5, 12),
        n,
        "flameCaller",
    );
    let hitters = run(&mut sim, 300);
    let p = crate::combat_policy::spacing(WeaponId::Wand, false);
    let ps = mobs(&sim);
    for &(id, at) in &ps {
        let d = hypot(at.x - target.x, at.y - target.y);
        assert!(
            d >= p.retreat && d <= p.far,
            "{id:?} at {d} outside [{}, {}]",
            p.retreat,
            p.far
        );
    }
    assert!(min_pair(&ps) >= settled_floor() - 1e-9, "{}", min_pair(&ps));
    assert_eq!(hitters.len(), n, "{hitters:?}");
}

/// Total distance the mobs walk over the last `ticks` of a further run: a pack at rest walks nothing.
fn walked(sim: &mut Sim, ticks: u32) -> f64 {
    let mut total = 0.;
    let mut last = mobs(sim);
    for _ in 0..ticks {
        sim.step();
        let now = mobs(sim);
        for (a, b) in last.iter().zip(&now) {
            assert_eq!(a.0, b.0);
            total += hypot(a.1.x - b.1.x, a.1.y - b.1.y);
        }
        last = now;
    }
    total
}

#[test]
fn a_corridor_dead_end_neither_deadlocks_nor_jitters() {
    // The target stands at the dead end; the pack queues up the one-tile corridor.
    let target = centre(24, 10);
    let mut sim = pack(
        HitboxMode::Archetypes,
        corridor(),
        target,
        centre(5, 10),
        6,
        "emberImp",
    );
    let hitters = run(&mut sim, 300);
    assert!(
        !hitters.is_empty(),
        "the front of the queue reaches and attacks"
    );
    let reach = far(WeaponId::Axe);
    let in_reach = mobs(&sim)
        .iter()
        .filter(|(_, p)| hypot(p.x - target.x, p.y - target.y) <= reach)
        .count();
    assert!(in_reach >= 2, "{in_reach} mobs in reach");
    assert!(walked(&mut sim, 60) < 1e-9, "the queue comes to rest");
}

#[test]
fn a_pack_through_a_doorway_spreads_round_the_target() {
    let target = centre(19, 10);
    let n = 8;
    let mut sim = pack(
        HitboxMode::Archetypes,
        doorway(),
        target,
        centre(5, 10),
        n,
        "emberImp",
    );
    let hitters = run(&mut sim, 300);
    assert_eq!(hitters.len(), n, "{hitters:?}");
    let ps = mobs(&sim);
    assert!(min_pair(&ps) >= settled_floor() - 1e-9, "{}", min_pair(&ps));
    assert!(walked(&mut sim, 60) < 1e-9, "the pack comes to rest");
}

#[test]
fn spacing_runs_are_deterministic_and_restore_mid_run() {
    let go = || {
        let mut sim = pack(
            HitboxMode::Archetypes,
            open_room(),
            centre(20, 12),
            centre(6, 12),
            8,
            "emberImp",
        );
        run(&mut sim, 60);
        sim
    };
    let (mut a, mut b) = (go(), go());
    assert_eq!(a.state_hash(), b.state_hash());
    let mut c = Sim::restore(serde_json::to_value(&a).unwrap()).unwrap();
    for _ in 0..120 {
        a.step();
        b.step();
        c.step();
        assert_eq!(a.state_hash(), b.state_hash());
        assert_eq!(a.state_hash(), c.state_hash());
    }
}

/// The legacy circle runs the pre-spacing code path bit for bit: the fold of every tick's state hash of the pack scenario
/// is the value the code had before spacing existed (pinned by running this test with the spacing calls removed from
/// `mob_ai`). Spacing on would move it.
#[test]
fn the_legacy_circle_trajectory_is_the_pre_spacing_one() {
    let mut sim = pack(
        HitboxMode::LegacyCircle,
        open_room(),
        centre(20, 12),
        centre(6, 12),
        8,
        "emberImp",
    );
    let mut fold = 0xcbf2_9ce4_8422_2325u64;
    for _ in 0..240 {
        sim.step();
        fold = (fold ^ sim.state_hash()).wrapping_mul(0x0000_0100_0000_01b3);
    }
    assert_eq!(fold, LEGACY_FOLD, "legacy fold {fold:#018x}");
}
// Checkpoint 32 added the practice contributors' length word to this training world's layout; the trajectory is unchanged.
const LEGACY_FOLD: u64 = 0xc0bf_771d_5055_1495;

#[test]
fn the_axe_band_fits_a_ring_of_the_pack() {
    // The scenario sizes above rely on the ring at the band edge holding the pack with room.
    let Shape::Arc { reach, .. } = weapon(WeaponId::Axe).shape else {
        unreachable!()
    };
    let ring = 2. * std::f64::consts::PI * (reach * NPC_MELEE_FAR_SHARE - MOB_SPACING_BAND_SLACK);
    assert!(ring / want_apart() >= 8., "{ring}");
}

// ---- review 2026-11-10: big packs come to rest (finding 1) ----

/// A walled 80 x 60 open room: room for a pack of 200.
fn big_room() -> Arena {
    let mut rows = Vec::new();
    for y in 0..60 {
        let mut r = String::new();
        for x in 0..80 {
            r.push(if x == 0 || y == 0 || x == 79 || y == 59 {
                '#'
            } else {
                '.'
            });
        }
        rows.push(r);
    }
    arena(&rows.iter().map(String::as_str).collect::<Vec<_>>())
}

/// Mobs with a Move queued for the next tick (with a stationary target, every one is a spacing step: the policy has no
/// chase to order).
fn queued_moves(sim: &Sim) -> usize {
    sim.w
        .mobs
        .iter()
        .filter(|m| matches!(m.core.inputs.mv, Some(crate::input::MoveCmd::Move { .. })))
        .count()
}

struct Rest {
    /// Moves queued on each tick of the whole run (settling and the measured window): chase orders and spacing steps.
    moves: Vec<usize>,
    /// Spacing steps ordered on each tick.
    steps: Vec<u32>,
    /// Distance walked by all mobs over the whole run, and over the measured window.
    walked: f64,
    walked_window: f64,
    /// Path searches over the measured window.
    searches: u64,
    /// Mobs that hit the target.
    hitters: usize,
}

/// `n` mobs of `kind` woken on a stationary player on open floor; `settle` ticks, then `window` measured ticks.
fn rest(n: usize, kind: &str, settle: u32, window: u32) -> Rest {
    let target = centre(40, 30);
    let mut sim = pack(
        HitboxMode::Archetypes,
        big_room(),
        target,
        centre(25, 30),
        n,
        kind,
    );
    let mut hitters = std::collections::BTreeSet::new();
    let (mut moves, mut steps) = (Vec::new(), Vec::new());
    let (mut walked, mut walked_window) = (0., 0.);
    let mut searches = 0;
    let mut last = mobs(&sim);
    for t in 0..settle + window {
        if t == settle {
            searches = sim.pf.searches;
        }
        hitters.extend(run(&mut sim, 1));
        moves.push(queued_moves(&sim));
        steps.push(sim.mob_spacing_diagnostics().steps);
        let now = mobs(&sim);
        for (a, b) in last.iter().zip(&now) {
            let d = hypot(a.1.x - b.1.x, a.1.y - b.1.y);
            walked += d;
            if t >= settle {
                walked_window += d;
            }
        }
        last = now;
    }
    Rest {
        moves,
        steps,
        walked,
        walked_window,
        searches: sim.pf.searches - searches,
        hitters: hitters.len(),
    }
}

/// A settled pack: no Move at all over the 200-tick window after 800 ticks, nothing walked, no path search; every mob
/// got its hits in (spacing never holds a mob out of reach).
fn assert_rest(n: usize) {
    let r = rest(n, "emberImp", 800, 200);
    let window = &r.moves[800..];
    let total: usize = r.moves.iter().sum();
    let steps: u32 = r.steps.iter().sum();
    eprintln!(
        "rest {n}: Moves queued over 1000 ticks {total} (max {} in one tick), spacing steps {steps} (max {} in one \
         tick, last on tick {:?}), last tick with a Move {:?}, walked {:.0} u ({:.1} u per mob), window: Moves {}, \
         walked {:.3} u, path searches {}, hitters {}",
        r.moves.iter().max().unwrap(),
        r.steps.iter().max().unwrap(),
        r.steps.iter().rposition(|&m| m > 0),
        r.moves.iter().rposition(|&m| m > 0),
        r.walked,
        r.walked / n as f64,
        window.iter().sum::<usize>(),
        r.walked_window,
        r.searches,
        r.hitters
    );
    assert_eq!(
        window.iter().sum::<usize>(),
        0,
        "{n} mobs: Moves per tick {window:?}"
    );
    assert!(
        r.walked_window < 1e-9,
        "{n} mobs walked {} u",
        r.walked_window
    );
    assert_eq!(r.searches, 0, "{n} mobs: path searches");
    assert_eq!(r.hitters, n, "{n} mobs: every one attacks");
}
#[test]
fn a_pack_of_20_comes_to_rest() {
    assert_rest(20);
}

#[test]
fn a_pack_of_30_comes_to_rest() {
    assert_rest(30);
}

#[test]
fn a_pack_of_40_comes_to_rest() {
    assert_rest(40);
}

#[test]
fn a_pack_of_200_comes_to_rest() {
    assert_rest(200);
}

// ---- review 2026-11-10: rooted and frozen crowds, elites, ice and bog (finding 4) ----

/// Roots (or stuns: Frost's Freeze) every mob for `ms`.
fn hold_all(sim: &mut Sim, kind: crate::status_runtime::StatusKind, ms: f64) {
    use crate::status_runtime as status;
    let now = sim.w.server_time;
    for m in sim.w.mobs.iter_mut() {
        status::apply(
            &mut m.core.statuses,
            now,
            status::StatusApply {
                kind,
                ms,
                source: status::StatusSource {
                    id: Some(PlayerId(9000)),
                    name: "test".into(),
                    owner_id: None,
                },
                ability: None,
                tag: None,
                value: None,
                add: None,
                data: None,
            },
        );
    }
}

/// A crowd born overlapping inside the stop band (no chase to order), then held in place: while held it orders no
/// spacing step and runs no path search; once free it spreads and comes to rest.
fn held_crowd(kind: crate::status_runtime::StatusKind) {
    let target = centre(20, 12);
    let n = 12;
    let mut sim = pack(
        HitboxMode::Archetypes,
        open_room(),
        target,
        Vec2::new(target.x - 40., target.y - 8.),
        n,
        "emberImp",
    );
    hold_all(&mut sim, kind, 3000.);
    let searches = sim.pf.searches;
    let mut steps = 0;
    for _ in 0..55 {
        run(&mut sim, 1);
        steps += sim.mob_spacing_diagnostics().steps;
    }
    assert_eq!(steps, 0, "{kind:?}: spacing steps while held");
    assert_eq!(
        sim.pf.searches, searches,
        "{kind:?}: path searches while held"
    );
    assert!(min_pair(&mobs(&sim)) < 8., "still a crowd");
    run(&mut sim, 400);
    let ps = mobs(&sim);
    assert!(
        min_pair(&ps) >= settled_floor() - 1e-9,
        "{kind:?}: {}",
        min_pair(&ps)
    );
    assert!(
        walked(&mut sim, 60) < 1e-9,
        "{kind:?}: the crowd comes to rest"
    );
}

#[test]
fn a_rooted_crowd_orders_nothing_until_it_can_move() {
    held_crowd(crate::status_runtime::StatusKind::Root);
}

#[test]
fn a_frozen_crowd_orders_nothing_until_it_can_move() {
    // Frost's Freeze is a stun.
    held_crowd(crate::status_runtime::StatusKind::Stun);
}

#[test]
fn a_pack_with_elites_spreads_and_rests() {
    let target = centre(20, 12);
    let n = 12;
    let mut sim = pack(
        HitboxMode::Archetypes,
        open_room(),
        target,
        centre(6, 12),
        n,
        "emberImp",
    );
    // Every third mob an elite (same look and foot box, so the same room).
    let ty = mob_type_by_id("emberImp").unwrap().id;
    let now = sim.w.server_time;
    for i in 0..4 {
        let at = Vec2::new(
            centre(6, 14).x + i as f64 * 4.,
            centre(6, 14).y + (i % 2) as f64 * 4.,
        );
        let id = super::mobs::place_practice_mob(
            &mut sim.w,
            ty,
            true,
            101,
            at,
            0.,
            HitboxMode::Archetypes,
        );
        let b = sim.w.mobs.get_mut(id).unwrap().brain.as_mut().unwrap();
        super::mob_ai::add_threat(b, PlayerId(1), 1.);
        super::mob_ai::wake(b, PlayerId(1), now);
    }
    assert_eq!(sim.w.mobs.iter().filter(|m| m.elite).count(), 4);
    let hitters = run(&mut sim, 400);
    let ps = mobs(&sim);
    assert_eq!(ps.len(), n + 4);
    assert_eq!(hitters.len(), n + 4, "{hitters:?}");
    assert!(min_pair(&ps) >= settled_floor() - 1e-9, "{}", min_pair(&ps));
    assert!(walked(&mut sim, 60) < 1e-9, "the pack comes to rest");
}

/// The seed1 map with a 20 x 20 tile patch of `terrain` (5 bog, 6 ice) in its largest open square (tiles 54..=93,
/// 116..=155), and the patch's centre.
fn patched_seed1(terrain: u8) -> (Arena, Vec2) {
    let mut v: serde_json::Value =
        serde_json::from_str(include_str!("../mapdata/fixtures/seed1.map.json")).unwrap();
    let w = v["map"]["w"].as_u64().unwrap() as usize;
    for y in 126..146 {
        for x in 64..84 {
            assert_eq!(v["map"]["tiles"][y * w + x], 0, "open floor");
            v["map"]["terrain"][y * w + x] = terrain.into();
        }
    }
    let mut export: crate::mapdata::MapExport = serde_json::from_value(v).unwrap();
    export.legacy_map_hash_u32 =
        u32::from_str_radix(&crate::mapgen::map_hash::map_hash(&export.map), 16).unwrap();
    let arena = export.validate().unwrap().into_arena().unwrap();
    (arena, centre(74, 136))
}

/// A pack of 12 on a terrain patch: every mob reaches and hits, at every tick every foot box is clear of walls, the
/// pack spreads, and it comes to rest (no spacing step over the last 100 ticks).
fn terrain_pack(terrain: u8) {
    let (arena, target) = patched_seed1(terrain);
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: false,
            training: true,
            hitboxes: HitboxMode::Archetypes,
            hazards: crate::terrain::Mode::Map,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(31),
        &[Placement {
            profile: "target".into(),
            faction: FactionId::Fire,
            bot: false,
            at: target,
            hp: Some(1e9),
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        }],
    );
    match terrain {
        5 => assert!(sim.k.hazards.slow),
        _ => assert!(sim.k.hazards.slip),
    }
    let ty = mob_type_by_id("emberImp").unwrap().id;
    let now = sim.w.server_time;
    let n = 12;
    for i in 0..n {
        let at = Vec2::new(
            target.x - 200. + (i % 3) as f64 * 4.,
            target.y + (i / 3) as f64 * 4.,
        );
        let id = super::mobs::place_practice_mob(
            &mut sim.w,
            ty,
            false,
            101,
            at,
            0.,
            HitboxMode::Archetypes,
        );
        let b = sim.w.mobs.get_mut(id).unwrap().brain.as_mut().unwrap();
        super::mob_ai::add_threat(b, PlayerId(1), 1.);
        super::mob_ai::wake(b, PlayerId(1), now);
    }
    let hitters = run(&mut sim, 700);
    let ps = mobs(&sim);
    assert_eq!(hitters.len(), n, "{terrain}: {hitters:?}");
    assert!(
        min_pair(&ps) >= settled_floor() - 1e-9,
        "{terrain}: {}",
        min_pair(&ps)
    );
    let mut steps = 0;
    for _ in 0..100 {
        run(&mut sim, 1);
        steps += sim.mob_spacing_diagnostics().steps;
    }
    assert_eq!(steps, 0, "{terrain}: spacing steps once settled");
    assert!(
        walked(&mut sim, 60) < 1e-6,
        "{terrain}: the pack comes to rest"
    );
}

#[test]
fn a_pack_on_ice_spreads_and_rests() {
    terrain_pack(6);
}

#[test]
fn a_pack_in_a_bog_spreads_and_rests() {
    terrain_pack(5);
}

// ---- review 2026-11-10: the A/B switch (finding 5) ----

/// `MobSpacing::Off` (the measurement-only A/B) runs an archetype match without spacing, and a checkpoint keeps it off.
#[test]
fn spacing_off_runs_without_spacing_and_survives_a_checkpoint() {
    let target = centre(20, 12);
    let mut sim = pack(
        HitboxMode::Archetypes,
        open_room(),
        target,
        centre(6, 12),
        8,
        "emberImp",
    );
    // Same pack, spacing off: rebuild the statics with the switch (the world is untouched).
    let mut cfg = sim.k.config.clone();
    cfg.mob_spacing = crate::archetype::MobSpacing::Off;
    let on_hash = sim.state_hash();
    sim.k = crate::statics::MatchStatic::new(cfg, sim.k.arena.clone(), sim.k.secrets);
    assert_ne!(sim.state_hash(), on_hash, "the switch is in the state hash");
    let mut steps = 0;
    for _ in 0..240 {
        run(&mut sim, 1);
        steps += sim.mob_spacing_diagnostics().steps;
    }
    assert_eq!(steps, 0);
    assert!(sim.s.mob_spacing.is_empty(), "the index is never built");
    assert!(min_pair(&mobs(&sim)) < 8., "{}", min_pair(&mobs(&sim)));
    let back = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
    assert_eq!(back.k.config.mob_spacing, crate::archetype::MobSpacing::Off);
    assert_eq!(back.state_hash(), sim.state_hash());
}

// ---- review 2026-11-10: spacing while chasing (finding 2) ----

struct Kite {
    /// Ticks (after the first 200) with two mobs under 8 u apart, and ticks counted.
    stacked: u32,
    ticks: u32,
    /// The same, counting only pairs of chasing mobs (walking a chase path), over ticks with two or more chasing.
    stacked_chasing: u32,
    ticks_chasing: u32,
    /// Each mob's first hit on the player (tick), if any.
    first_hit: Vec<Option<u32>>,
    /// Mobs that hit the player in the last third of the run.
    late_hitters: usize,
    /// Path searches per tick (mean).
    searches: f64,
    /// Chase goals offset.
    offsets: u32,
    /// Spacing steps per tick (mean): each is one Move, so at most one path search.
    steps: f64,
}

/// Is `m` walking a chase path (its path ends at its brain's chase goal)?
fn chasing(m: &crate::mob_runtime::Mob) -> bool {
    let (Some(end), Some(goal)) = (
        m.core.motion.path.as_slice().last(),
        m.brain.as_ref().and_then(|b| b.goal),
    ) else {
        return false;
    };
    hypot(end.x - goal.x, end.y - goal.y) <= MOB_SPACING_STEP_MIN
}

/// `n` mobs of `kind` woken on a player who walks a loop of waypoints round a big room, a new one every 60 ticks.
fn kite(
    spacing: crate::archetype::MobSpacing,
    arena: Arena,
    waypoints: &[Vec2],
    from: Vec2,
    n: usize,
    ticks: u32,
) -> Kite {
    let mut sim = pack(
        HitboxMode::Archetypes,
        arena,
        waypoints[0],
        from,
        n,
        "emberImp",
    );
    let mut cfg = sim.k.config.clone();
    cfg.mob_spacing = spacing;
    sim.k = crate::statics::MatchStatic::new(cfg, sim.k.arena.clone(), sim.k.secrets);
    let ids: Vec<PlayerId> = mobs(&sim).iter().map(|m| m.0).collect();
    let mut first_hit = vec![None; ids.len()];
    let mut late = std::collections::BTreeSet::new();
    let (mut stacked, mut counted, mut stacked_chasing, mut ticks_chasing, mut offsets) =
        (0, 0, 0, 0, 0);
    let mut steps = 0u32;
    let searches = sim.pf.searches;
    for t in 0..ticks {
        if t % 60 == 0 {
            let p = waypoints[(t / 60) as usize % waypoints.len()];
            sim.submit(
                PlayerId(1),
                crate::input::validate(crate::input::RawCommand::Move {
                    x: p.x,
                    y: p.y,
                    seq: None,
                })
                .unwrap(),
            )
            .unwrap();
        }
        for e in sim.step() {
            if let crate::events::Event::Hit {
                victim: PlayerId(1),
                by: Some(by),
                ..
            } = e
            {
                if let Some(i) = ids.iter().position(|&id| id == by) {
                    first_hit[i].get_or_insert(t);
                    if t >= ticks * 2 / 3 {
                        late.insert(i);
                    }
                }
            }
        }
        offsets += sim.mob_spacing_diagnostics().chase_offsets;
        steps += sim.mob_spacing_diagnostics().steps;
        if t >= 200 {
            counted += 1;
            if min_pair(&mobs(&sim)) < 8. {
                stacked += 1;
            }
            let ch: Vec<(PlayerId, Vec2)> = sim
                .w
                .mobs
                .iter()
                .filter(|m| {
                    m.status == Status::Alive
                        && m.kind == crate::mob_runtime::MobKind::Practice
                        && chasing(m)
                })
                .map(|m| (m.core.id, m.core.pos()))
                .collect();
            if ch.len() >= 2 {
                ticks_chasing += 1;
                if min_pair(&ch) < 8. {
                    stacked_chasing += 1;
                }
            }
        }
    }
    Kite {
        stacked,
        ticks: counted,
        stacked_chasing,
        ticks_chasing,
        first_hit,
        late_hitters: late.len(),
        searches: (sim.pf.searches - searches) as f64 / f64::from(ticks),
        offsets,
        steps: f64::from(steps) / f64::from(ticks),
    }
}

fn open_kite(spacing: crate::archetype::MobSpacing) -> Kite {
    // A square loop round the pack's home (12 tiles out: inside its 24-tile leash), a new waypoint every 3 s: the player
    // keeps walking, the pack keeps chasing, catching up and hitting.
    let pts = [
        centre(46, 30),
        centre(52, 30),
        centre(52, 42),
        centre(28, 42),
        centre(28, 18),
        centre(52, 18),
    ];
    kite(spacing, big_room(), &pts, centre(30, 30), 10, 1200)
}

fn report(label: &str, k: &Kite) {
    let mut hits: Vec<u32> = k.first_hit.iter().flatten().copied().collect();
    hits.sort_unstable();
    eprintln!(
        "{label}: stacked {}/{} ({:.3}), stacked while chasing {}/{} ({:.3}), first hits {hits:?} (missing {}), late hitters {}, path searches/tick {:.3}, chase offsets {}",
        k.stacked,
        k.ticks,
        f64::from(k.stacked) / f64::from(k.ticks.max(1)),
        k.stacked_chasing,
        k.ticks_chasing,
        f64::from(k.stacked_chasing) / f64::from(k.ticks_chasing.max(1)),
        k.first_hit.iter().filter(|h| h.is_none()).count(),
        k.late_hitters,
        k.searches,
        k.offsets
    );
}

#[test]
fn a_chasing_pack_fans_out() {
    use crate::archetype::MobSpacing;
    let off = open_kite(MobSpacing::Off);
    let on = open_kite(MobSpacing::Auto);
    report("kite off", &off);
    report("kite on ", &on);
    // Stacking (two mobs under 8 u) drops: among chasing mobs to at most half, overall to at most 60 % (measured
    // 2026-11-10: 0.97 -> 0.41 and 1.00 -> 0.55; the rest is a pack hugging a moving player, crossing round it).
    assert!(
        on.stacked * 5 <= off.stacked * 3,
        "{} vs {}",
        on.stacked,
        off.stacked
    );
    assert!(
        f64::from(on.stacked_chasing) / f64::from(on.ticks_chasing)
            <= 0.5 * f64::from(off.stacked_chasing) / f64::from(off.ticks_chasing),
        "{} / {} vs {} / {}",
        on.stacked_chasing,
        on.ticks_chasing,
        off.stacked_chasing,
        off.ticks_chasing
    );
    // Every mob still reaches and hits, about as soon as without spacing.
    assert!(
        on.first_hit.iter().all(Option::is_some),
        "{:?}",
        on.first_hit
    );
    let mean = |k: &Kite| {
        k.first_hit
            .iter()
            .flatten()
            .map(|&t| f64::from(t))
            .sum::<f64>()
            / k.first_hit.len() as f64
    };
    let last = |k: &Kite| k.first_hit.iter().flatten().copied().max().unwrap();
    assert!(
        mean(&on) <= mean(&off) * 1.25 + 20.,
        "{} vs {}",
        mean(&on),
        mean(&off)
    );
    assert!(
        last(&on) <= last(&off) + 60,
        "{} vs {}",
        last(&on),
        last(&off)
    );
    // No extra path searches for the chase: beyond the plain run's, at most one per spacing step.
    assert!(
        on.searches <= off.searches + on.steps + 1e-9,
        "{} vs {} + {}",
        on.searches,
        off.searches,
        on.steps
    );
}

/// A pack chasing through a one-tile doorway into the next room, and up a one-tile corridor to its dead end: every mob
/// gets through and hits (the shifted goal falls back to the plain one where the walls leave no room), about as soon as
/// without spacing, with no more path searches.
fn funnel(arena: fn() -> Arena, pts: &[Vec2], from: Vec2, n: usize) {
    use crate::archetype::MobSpacing;
    let off = kite(MobSpacing::Off, arena(), pts, from, n, 600);
    let on = kite(MobSpacing::Auto, arena(), pts, from, n, 600);
    report("funnel off", &off);
    report("funnel on ", &on);
    let hit = |k: &Kite| k.first_hit.iter().filter(|h| h.is_some()).count();
    assert_eq!(
        hit(&on),
        hit(&off),
        "{:?} vs {:?}",
        on.first_hit,
        off.first_hit
    );
    // The whole pack followed the player to the end of the walk and fights there.
    assert_eq!(
        on.late_hitters, n,
        "{} vs {}",
        on.late_hitters, off.late_hitters
    );
    let last = |k: &Kite| k.first_hit.iter().flatten().copied().max().unwrap_or(0);
    assert!(
        last(&on) <= last(&off) + 40,
        "{} vs {}",
        last(&on),
        last(&off)
    );
    // No extra path searches for the chase: beyond the plain run's, at most one per spacing step.
    assert!(
        on.searches <= off.searches + on.steps + 1e-9,
        "{} vs {} + {}",
        on.searches,
        off.searches,
        on.steps
    );
}

#[test]
fn a_chasing_pack_funnels_through_a_doorway() {
    // The player walks from the west room through the doorway into the east room and on; the pack follows.
    funnel(
        doorway,
        &[
            centre(10, 10),
            centre(20, 10),
            centre(26, 6),
            centre(26, 14),
            centre(20, 10),
        ],
        centre(4, 10),
        8,
    );
}

#[test]
fn a_chasing_pack_follows_up_a_corridor() {
    // The player walks from the room up the one-tile corridor to its dead end; the pack queues behind.
    funnel(
        corridor,
        &[centre(10, 10), centre(18, 10), centre(24, 10)],
        centre(4, 10),
        6,
    );
}

/// Cost of a whole tick with 200 axe mobs on one player, spacing off versus on, standing (after 300 ticks to settle) and
/// chasing (a player walking a loop). Measurement only: `cargo test --release -p rh-sim --lib spacing_tick_cost --
/// --ignored --nocapture`.
#[test]
#[ignore]
// A wall clock for a measurement-only test; the sim itself never reads one.
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
fn spacing_tick_cost() {
    use crate::archetype::MobSpacing;
    fn time(spacing: MobSpacing, walk: bool) -> (f64, f64, f64) {
        let pts = [
            centre(46, 30),
            centre(52, 30),
            centre(52, 42),
            centre(28, 42),
            centre(28, 18),
            centre(52, 18),
        ];
        let mut sim = pack(
            HitboxMode::Archetypes,
            big_room(),
            pts[0],
            centre(36, 30),
            200,
            "emberImp",
        );
        let mut cfg = sim.k.config.clone();
        cfg.mob_spacing = spacing;
        sim.k = crate::statics::MatchStatic::new(cfg, sim.k.arena.clone(), sim.k.secrets);
        let mut spent = std::time::Duration::ZERO;
        let (mut steps, mut searches) = (0u64, 0u64);
        for t in 0..500u32 {
            if walk && t % 60 == 0 {
                let p = pts[(t / 60) as usize % pts.len()];
                sim.submit(
                    PlayerId(1),
                    crate::input::validate(crate::input::RawCommand::Move {
                        x: p.x,
                        y: p.y,
                        seq: None,
                    })
                    .unwrap(),
                )
                .unwrap();
            }
            let s0 = sim.pf.searches;
            let t0 = std::time::Instant::now();
            sim.step();
            if t >= 300 {
                spent += t0.elapsed();
                steps += u64::from(sim.mob_spacing_diagnostics().steps);
                searches += sim.pf.searches - s0;
            }
        }
        (
            spent.as_secs_f64() * 1000. / 200.,
            steps as f64 / 200.,
            searches as f64 / 200.,
        )
    }
    for walk in [false, true] {
        for spacing in [MobSpacing::Off, MobSpacing::Auto] {
            // Best of three against the machine's noise.
            let runs: Vec<(f64, f64, f64)> = (0..3).map(|_| time(spacing, walk)).collect();
            let best = runs.iter().map(|r| r.0).fold(f64::INFINITY, f64::min);
            eprintln!(
                "cost {} {spacing:?}: {best:.3} ms/tick, spacing steps/tick {:.2}, path searches/tick {:.2}",
                if walk { "chasing " } else { "standing" },
                runs[0].1,
                runs[0].2
            );
        }
    }
}
