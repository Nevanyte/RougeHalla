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
const LEGACY_FOLD: u64 = 0xc55c_39b6_e2f4_f9aa;

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
