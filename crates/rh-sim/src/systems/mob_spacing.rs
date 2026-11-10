//! Mob spacing (ADR0024 addendum "Mob spacing", owner direction 2026-11-10; docs/DEVIATIONS.md DEV-011): under
//! [`crate::archetype::HitboxMode::Archetypes`] (and `SimConfig::mob_spacing = Auto`) a regional mob that its combat
//! policy keeps in place (in its attack band, with line of sight: `Stop`) and finds another mob inside its personal space
//! queues one short, validated `Move` that steps it out ([`step`]), and a chasing mob's goal is shifted sideways away from
//! its pack-mates ([`lateral`]), so a pack neither stacks round its target nor runs in one file. Legacy has no such rule;
//! under [`crate::archetype::HitboxMode::LegacyCircle`] nothing here runs (`mob_ai::think` never builds the index).
//!
//! Not a system and no schedule row: `mob_ai::think` builds the index once per call, `mob_ai::fight` asks for a step in
//! its own `Stop` branch and moves the mob's entry to the step's end when it orders one (so the mobs that think after it
//! see where it is going), and offsets a chase goal in its `Move::Point` branch ([`lateral`]). Nothing here changes who a
//! mob targets, when it attacks or what it holds; the step goes through `validate` + `Cx::submit` like every other mob
//! order (C-INPUT).
//!
//! Who keeps room: alive regional and practice mobs with a brain, from each other only. Players, Plague zombies
//! (companions), training dummies and quest givers neither move for it nor count as neighbours (no body blocking between
//! characters, owner decision 2026-11-09).
//!
//! Room: each mob claims a disc of its foot box's larger half-extent plus [`MOB_SPACING_MARGIN`]; two mobs want their
//! discs apart. With today's shared 10 x 6 foot box that is 20 u each, so 40 u centre to centre: one foot-box width of
//! clear ground between the two foot boxes. A look with a bigger foot box gets more room automatically.

use crate::constants::{
    MOB_SPACING_CELL, MOB_SPACING_MARGIN, MOB_SPACING_STEP_MAX, MOB_SPACING_STEP_MIN,
};
use crate::math::{hypot, Vec2};
use crate::mob_runtime::{Mob, MobKind};
use crate::state::{Status, World};
use crate::PlayerId;

/// One mob in the per-call index, sorted by (`key`, `id`).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Entry {
    key: u64,
    id: PlayerId,
    at: Vec2,
    room: f64,
}

/// Cells per row of the key (`key = cy * STRIDE + cx`). Every cell index of a real map (at most a few hundred) is far
/// below it, and the clamp below keeps any position inside.
const STRIDE: u64 = 1 << 20;

/// Is spacing on for this match? One live switch: the archetype hitboxes ([`crate::archetype::mob_spacing`]).
pub(crate) fn on(k: &crate::statics::MatchStatic) -> bool {
    crate::archetype::mob_spacing(&k.config)
}

/// Does `m` keep room (and count as a neighbour)?
fn spaced(m: &Mob) -> bool {
    m.status == Status::Alive
        && m.zombie.is_none()
        && m.brain.is_some()
        && matches!(m.kind, MobKind::Regional | MobKind::Practice)
}

/// The personal-space radius of a mob: its foot box's larger half-extent plus the margin.
pub(crate) fn room(m: &Mob) -> f64 {
    let foot = m.core.foot();
    foot.half_x().max(foot.half_y()) + MOB_SPACING_MARGIN
}

fn cell(v: f64) -> u64 {
    let c = (v / MOB_SPACING_CELL).floor();
    // Positions are finite and inside the world; the clamp only keeps the key well-formed whatever happens.
    if c > 0. {
        (c as u64).min(STRIDE - 2)
    } else {
        0
    }
}

fn key(at: Vec2) -> u64 {
    cell(at.y) * STRIDE + cell(at.x)
}

/// The end of the spacing step `m` is walking, if it is walking one: a path that ends within one step of the mob and is
/// not the chase's (`mob_ai::send` records the chase goal in the brain).
pub(crate) fn walking(m: &Mob, goal: Option<Vec2>) -> Option<Vec2> {
    let end = *m.core.motion.path.as_slice().last()?;
    let from = m.core.pos();
    (hypot(end.x - from.x, end.y - from.y) <= MOB_SPACING_STEP_MAX + MOB_SPACING_STEP_MIN
        && goal.is_none_or(|g| hypot(g.x - end.x, g.y - end.y) > MOB_SPACING_STEP_MIN))
    .then_some(end)
}

/// Rebuilds the index of spaced mobs into `out` (cleared first; its capacity is reused, so a step allocates nothing
/// once it has seen its largest pack). Sorted by (cell key, id): a fixed order, independent of the store's layout. A
/// mob walking a spacing step is entered where the step ends (where it is going), every other mob where it stands.
pub(crate) fn index(w: &World, out: &mut Vec<Entry>) {
    out.clear();
    for m in &w.mobs {
        if spaced(m) {
            let goal = m.brain.as_ref().and_then(|b| b.goal);
            let at = walking(m, goal).unwrap_or_else(|| m.core.pos());
            out.push(Entry {
                key: key(at),
                id: m.core.id,
                at,
                room: room(m),
            });
        }
    }
    out.sort_unstable_by(|a, b| a.key.cmp(&b.key).then(a.id.cmp(&b.id)));
}

/// Moves mob `id`'s entry from `from` to `to` (the end of the step it was just given), keeping the index sorted. A
/// mob that is not in the index is left out.
pub(crate) fn relocate(index: &mut Vec<Entry>, id: PlayerId, from: Vec2, to: Vec2) {
    let k = key(from);
    let Ok(i) = index.binary_search_by(|e| e.key.cmp(&k).then(e.id.cmp(&id))) else {
        return;
    };
    let mut e = index.remove(i);
    e.at = to;
    e.key = key(to);
    let j = index.partition_point(|x| (x.key, x.id) < (e.key, e.id));
    index.insert(j, e);
}

/// The band of distances to its target a mob may stand at without its policy wanting to move (`lo` 0 for melee).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Band {
    pub lo: f64,
    pub hi: f64,
}

/// Calls `f(entry, d, need)` for every entry other than `id` whose room overlaps a disc of `room` at `p` (`d < need`, `need`
/// the two rooms), in index order: the 3 x 3 cells round `p`, which hold every such entry
/// (`the_cell_holds_the_widest_room_pair`).
fn near(index: &[Entry], id: PlayerId, room: f64, p: Vec2, mut f: impl FnMut(&Entry, f64, f64)) {
    let (cx, cy) = (cell(p.x), cell(p.y));
    for row in cy.saturating_sub(1)..=cy + 1 {
        let lo = row * STRIDE + cx.saturating_sub(1);
        let hi = row * STRIDE + cx + 1;
        let start = index.partition_point(|e| e.key < lo);
        for e in index[start..].iter().take_while(|e| e.key <= hi) {
            if e.id == id {
                continue;
            }
            let (dx, dy) = (p.x - e.at.x, p.y - e.at.y);
            let need = room + e.room;
            // Most of the 3 x 3 cells is out of reach: a squared test first, the square root only for a real overlap.
            if dx * dx + dy * dy >= need * need {
                continue;
            }
            let d = hypot(dx, dy);
            if d < need {
                f(e, d, need);
            }
        }
    }
}

/// The step mob `id` (personal-space radius `room`, at `from`, fighting a target at `target`) takes out of its
/// pack-mates' room, or `None`.
///
/// Mobs think one after another and each sees where the mobs before it are going ([`relocate`]), so this is a
/// coordinate descent on the pack's energy: the sum over pairs of the squared depth to which two rooms overlap (a spring
/// system's energy; squared so that evening out the gaps along a chain of mobs pays, which spreads a crowd round its
/// target instead of leaving it piled on the side it came from). A step is ordered only when it lowers the mob's own
/// share, and so the pack's energy, by at least [`GAIN_MIN`]. The energy cannot fall below zero, so after the last
/// outside change (a chase, an arrival, a death, a step that ends somewhere else than ordered) a pack of any size orders
/// at most (its energy / [`GAIN_MIN`]) more steps and comes to rest. A mob with no room left keeps its overlap quietly.
///
/// The candidates: the push (the sum over the neighbours inside the room of the overlap along the line between the two,
/// capped at [`MOB_SPACING_STEP_MAX`]), its half, and the push turned by 90, 45 and 135 degrees either way (a mob
/// squeezed between two others on a line is pushed along the line and gains nothing there; a sidestep frees it). Each is
/// pulled back into `band` round the target (an outward push becomes a slide round the target) and capped again (no step
/// is longer than [`MOB_SPACING_STEP_MAX`]). Of those that are at least [`MOB_SPACING_STEP_MIN`] long and lower the
/// energy enough, the lowest-energy one that passes `ok` (walls, the leash, line of sight) is ordered. `None` too when
/// no mob is inside the room, and when the mob stands inside `band.lo` (its policy wanted a retreat it could not find:
/// spacing never carries it out).
pub(crate) fn step(
    index: &[Entry],
    id: PlayerId,
    room: f64,
    from: Vec2,
    target: Vec2,
    band: Band,
    ok: impl Fn(Vec2) -> bool,
) -> Option<Vec2> {
    if band.hi <= band.lo {
        return None;
    }
    let r_from = hypot(from.x - target.x, from.y - target.y);
    // Inside the retreat line the policy wanted out and could not find a way (its search failed, so it said Stop):
    // spacing never carries out the retreat it refused.
    if r_from < band.lo {
        return None;
    }
    let (mut px, mut py) = (0., 0.);
    let mut deep = 0.;
    near(index, id, room, from, |e, d, need| {
        deep += (need - d) * (need - d);
        let (ux, uy) = if d > 1e-9 {
            ((from.x - e.at.x) / d, (from.y - e.at.y) / d)
        } else {
            apart(id, e.id, from, target)
        };
        px += ux * (need - d);
        py += uy * (need - d);
    });
    if deep < GAIN_MIN {
        return None;
    }
    // The base direction and length: the push, or (pushes that cancel out) the tangent round the target at full length.
    let len = hypot(px, py);
    let (ux, uy, l) = if len >= MOB_SPACING_STEP_MIN {
        (px / len, py / len, len.min(MOB_SPACING_STEP_MAX))
    } else {
        let (ux, uy) = apart(id, PlayerId(0), from, target);
        (ux, uy, MOB_SPACING_STEP_MAX)
    };
    let (c45, s45) = (
        std::f64::consts::FRAC_1_SQRT_2,
        std::f64::consts::FRAC_1_SQRT_2,
    );
    // (cos, sin, length share) of each candidate, in tie-break order.
    let turns: [(f64, f64, f64); CANDIDATES] = [
        (1., 0., 1.),
        (1., 0., 0.5),
        (0., 1., 1.),
        (0., -1., 1.),
        (c45, s45, 1.),
        (c45, -s45, 1.),
        (-c45, s45, 1.),
        (-c45, -s45, 1.),
    ];
    let mut cand = [from; CANDIDATES];
    let mut live = [false; CANDIDATES];
    for (i, &(c, s, share)) in turns.iter().enumerate() {
        let (dx, dy) = ((ux * c - uy * s) * l * share, (ux * s + uy * c) * l * share);
        if let Some(to) = fit(from, Vec2::new(from.x + dx, from.y + dy), target, band) {
            cand[i] = to;
            live[i] = true;
        }
    }
    // Every candidate's overlap in one pass over the 3 x 3 cells round `from`: a candidate is at most
    // MOB_SPACING_STEP_MAX from `from`, so its neighbours are within MOB_SPACING_STEP_MAX + 2 x room < 2 x
    // MOB_SPACING_CELL of `from` (`the_cell_holds_the_widest_room_pair`).
    let mut cost = [0f64; CANDIDATES];
    let (cx, cy) = (cell(from.x), cell(from.y));
    for row in cy.saturating_sub(1)..=cy + 1 {
        let lo = row * STRIDE + cx.saturating_sub(1);
        let hi = row * STRIDE + cx + 1;
        let start = index.partition_point(|e| e.key < lo);
        for e in index[start..].iter().take_while(|e| e.key <= hi) {
            if e.id == id {
                continue;
            }
            let need = room + e.room;
            let reach = need + MOB_SPACING_STEP_MAX;
            let (dx, dy) = (from.x - e.at.x, from.y - e.at.y);
            if dx * dx + dy * dy >= reach * reach {
                continue;
            }
            for i in 0..CANDIDATES {
                if !live[i] {
                    continue;
                }
                let (dx, dy) = (cand[i].x - e.at.x, cand[i].y - e.at.y);
                if dx * dx + dy * dy < need * need {
                    let o = need - hypot(dx, dy);
                    cost[i] += o * o;
                }
            }
        }
    }
    let mut order = [0usize, 1, 2, 3, 4, 5, 6, 7];
    // Stable: equal overlaps keep the tie-break order above.
    order.sort_by(|&a, &b| cost[a].total_cmp(&cost[b]));
    order
        .into_iter()
        .filter(|&i| live[i] && cost[i] <= deep - GAIN_MIN)
        .map(|i| cand[i])
        .find(|&c| ok(c))
}

/// The least a step must lower a mob's squared overlap (u^2) to be ordered: one [`MOB_SPACING_STEP_MIN`] of overlap
/// given up.
const GAIN_MIN: f64 = MOB_SPACING_STEP_MIN * MOB_SPACING_STEP_MIN;

/// How many steps [`step`] weighs.
const CANDIDATES: usize = 8;

/// A candidate step from `from` to `to`, pulled back into `band` round `target` and capped at [`MOB_SPACING_STEP_MAX`]
/// again (the pull can lengthen it); `None` when it ends up shorter than [`MOB_SPACING_STEP_MIN`] or inside `band.lo`.
fn fit(from: Vec2, to: Vec2, target: Vec2, band: Band) -> Option<Vec2> {
    let mut to = to;
    let (rx, ry) = (to.x - target.x, to.y - target.y);
    let r = hypot(rx, ry);
    if r > band.hi {
        to = Vec2::new(target.x + rx * band.hi / r, target.y + ry * band.hi / r);
    } else if r < band.lo && r > 1e-9 {
        to = Vec2::new(target.x + rx * band.lo / r, target.y + ry * band.lo / r);
    }
    let (sx, sy) = (to.x - from.x, to.y - from.y);
    let len = hypot(sx, sy);
    if len > MOB_SPACING_STEP_MAX {
        to = Vec2::new(
            from.x + sx * MOB_SPACING_STEP_MAX / len,
            from.y + sy * MOB_SPACING_STEP_MAX / len,
        );
        // On the segment from `from` (r_from <= its far line) to a point inside the band: never farther out than either
        // end. Only the retreat side can dip, by a hair, inside `lo`; then the candidate is dropped.
        if hypot(to.x - target.x, to.y - target.y) < band.lo {
            return None;
        }
    }
    (hypot(to.x - from.x, to.y - from.y) >= MOB_SPACING_STEP_MIN).then_some(to)
}

/// The sideways shift of a chasing mob's goal (`mob_ai::chase_goal`): across the line from `from` to `goal`, away from
/// every pack-mate inside the mob's room by the whole overlap (a mob directly ahead or behind, or on the very same
/// point, sends the lower id left and the higher id right), summed and capped at [`MOB_SPACING_STEP_MAX`], then scaled
/// by the distance to the goal over the wanted spacing (two rooms): the heading turns by at most
/// atan([`MOB_SPACING_STEP_MAX`] / 2 x room), 22 degrees with today's rooms, and the shift shrinks as the mob closes in
/// (no circling: a melee mob entering its band at about 95 u is shifted at most 38 u). Pack-mates on both sides cancel
/// out (the middle of a pack runs straight). `None` when the sum is under [`MOB_SPACING_STEP_MIN`] or the goal is where
/// the mob stands. Read from the same index as the steps; it moves no entry (a chase order changes
/// where a mob heads, not where it stands).
pub(crate) fn lateral(
    index: &[Entry],
    id: PlayerId,
    room: f64,
    from: Vec2,
    goal: Vec2,
) -> Option<Vec2> {
    let (gx, gy) = (goal.x - from.x, goal.y - from.y);
    let g = hypot(gx, gy);
    if g < 1e-9 {
        return None;
    }
    // Left of the heading.
    let (lx, ly) = (-gy / g, gx / g);
    let mut side = 0.;
    near(index, id, room, from, |e, d, need| {
        let across = (from.x - e.at.x) * lx + (from.y - e.at.y) * ly;
        let sign = if across.abs() > 1e-9 {
            across.signum()
        } else if id < e.id {
            1.
        } else {
            -1.
        };
        side += sign * (need - d);
    });
    if side.abs() < MOB_SPACING_STEP_MIN {
        return None;
    }
    // The push measured against the wanted spacing (two rooms) turns the heading: by at most atan(STEP_MAX / 2 x room)
    // (22 degrees with today's rooms), so the shift shrinks with the distance left and vanishes on arrival.
    let s = side.clamp(-MOB_SPACING_STEP_MAX, MOB_SPACING_STEP_MAX) * g / (2. * room);
    Some(Vec2::new(lx * s, ly * s))
}

/// Two mobs on the very same point: the lower id steps to the left of the line to the target, the higher to the right
/// (east and west when the target is on the same point too). A fixed rule, no randomness.
fn apart(me: PlayerId, other: PlayerId, from: Vec2, target: Vec2) -> (f64, f64) {
    let sign = if me < other { 1. } else { -1. };
    let (tx, ty) = (target.x - from.x, target.y - from.y);
    let t = hypot(tx, ty);
    if t > 1e-9 {
        (-ty / t * sign, tx / t * sign)
    } else {
        (sign, 0.)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: u32, x: f64, y: f64) -> Entry {
        let at = Vec2::new(x, y);
        Entry {
            key: key(at),
            id: PlayerId(id),
            at,
            room: 20.,
        }
    }

    fn sorted(mut v: Vec<Entry>) -> Vec<Entry> {
        v.sort_unstable_by(|a, b| a.key.cmp(&b.key).then(a.id.cmp(&b.id)));
        v
    }

    /// A band that never binds.
    const fn wide() -> Band {
        Band { lo: 0., hi: 1e9 }
    }

    #[test]
    fn the_cell_holds_the_widest_room_pair() {
        // Every neighbour that can be inside a room is in the 3 x 3 cells round the mob, and so is every neighbour of a
        // candidate step (at most MOB_SPACING_STEP_MAX away).
        for row in &crate::archetype::ARCHETYPES {
            let f = row.foot();
            let room = f.half_x().max(f.half_y()) + MOB_SPACING_MARGIN;
            assert!(
                2. * room + MOB_SPACING_STEP_MAX <= MOB_SPACING_CELL,
                "{}",
                row.key
            );
        }
    }

    fn at(ix: &[Entry], id: u32, from: Vec2, t: Vec2, band: Band) -> Option<Vec2> {
        step(ix, PlayerId(id), 20., from, t, band, |_| true)
    }

    #[test]
    fn a_lone_mob_and_a_spaced_pair_do_not_move() {
        let ix = sorted(vec![entry(1, 500., 500.), entry(2, 541., 500.)]);
        let t = Vec2::new(500., 600.);
        assert_eq!(at(&ix, 1, ix[0].at, t, wide()), None);
        assert_eq!(at(&ix, 2, Vec2::new(541., 500.), t, wide()), None);
        let lone = sorted(vec![entry(1, 500., 500.)]);
        assert_eq!(at(&lone, 1, lone[0].at, t, wide()), None);
    }

    #[test]
    fn of_a_pair_each_steps_out_by_the_whole_overlap() {
        // Against one index both would step (each sees the other where it stands); in a think the second sees where the
        // first is going (`relocate`) and stays.
        let mut ix = sorted(vec![entry(1, 500., 500.), entry(2, 528., 500.)]);
        let t = Vec2::new(510., 700.);
        let a = at(&ix, 1, Vec2::new(500., 500.), t, wide()).unwrap();
        assert_eq!(a, Vec2::new(488., 500.));
        assert_eq!(
            at(&ix, 2, Vec2::new(528., 500.), t, wide()),
            Some(Vec2::new(540., 500.))
        );
        relocate(&mut ix, PlayerId(1), Vec2::new(500., 500.), a);
        assert_eq!(at(&ix, 2, Vec2::new(528., 500.), t, wide()), None);
        // A deeper overlap is capped at the 16 u step.
        let ix = sorted(vec![entry(1, 500., 500.), entry(2, 520., 500.)]);
        assert_eq!(
            at(&ix, 2, Vec2::new(520., 500.), t, wide()),
            Some(Vec2::new(536., 500.))
        );
    }

    #[test]
    fn relocate_keeps_the_index_sorted_across_cells() {
        let mut ix = sorted(vec![
            entry(1, 10., 10.),
            entry(2, 100., 10.),
            entry(3, 200., 200.),
        ]);
        relocate(
            &mut ix,
            PlayerId(1),
            Vec2::new(10., 10.),
            Vec2::new(250., 210.),
        );
        assert!(ix
            .windows(2)
            .all(|w| (w[0].key, w[0].id) < (w[1].key, w[1].id)));
        assert_eq!(
            ix.iter().find(|e| e.id == PlayerId(1)).unwrap().at,
            Vec2::new(250., 210.)
        );
        // An id not in the index (or not at `from`) changes nothing.
        let before: Vec<_> = ix.iter().map(|e| (e.key, e.id)).collect();
        relocate(&mut ix, PlayerId(9), Vec2::new(10., 10.), Vec2::new(0., 0.));
        assert_eq!(before, ix.iter().map(|e| (e.key, e.id)).collect::<Vec<_>>());
    }

    #[test]
    fn coincident_mobs_split_across_the_line_to_the_target() {
        let ix = sorted(vec![entry(7, 500., 500.), entry(3, 500., 500.)]);
        let t = Vec2::new(500., 400.); // north
        let p = Vec2::new(500., 500.);
        let lo = at(&ix, 3, p, t, wide()).unwrap();
        let hi = at(&ix, 7, p, t, wide()).unwrap();
        assert!(lo.x > 500. && hi.x < 500., "{lo:?} {hi:?}");
        assert_eq!(lo.y, 500.);
        assert_eq!(hi.y, 500.);
    }

    #[test]
    fn the_band_turns_an_outward_push_into_a_slide() {
        // Two mobs on a ring of radius 90 round the target, 10 u apart: the push is mostly tangential, and the result
        // stays inside the band.
        let t = Vec2::new(1000., 1000.);
        let ix = sorted(vec![entry(1, 1000., 910.), entry(2, 1010., 910.5)]);
        let band = Band { lo: 0., hi: 90. };
        let a = at(&ix, 2, Vec2::new(1010., 910.5), t, band).unwrap();
        assert!(hypot(a.x - t.x, a.y - t.y) <= 90. + 1e-9);
        assert!(a.x > 1010.);
    }

    #[test]
    fn a_mob_squeezed_on_a_line_sidesteps() {
        // Mob 3 between mobs 1 and 2 on one line: the push is along the line and gains nothing there; a sidestep does.
        let ix = sorted(vec![
            entry(1, 500., 500.),
            entry(2, 540., 500.),
            entry(3, 515., 500.),
        ]);
        let t = Vec2::new(520., 900.);
        let got = at(&ix, 3, Vec2::new(515., 500.), t, wide()).unwrap();
        assert!((got.y - 500.).abs() > 5., "{got:?}");
    }

    #[test]
    fn a_step_that_does_not_lower_the_overlap_is_not_ordered() {
        // Mob 3 midway between mobs 1 and 2 on a line (25 u into each room), allowed by `ok` to move only along the
        // line: every step along it deepens one overlap more than it eases the other.
        let ix = sorted(vec![
            entry(1, 500., 500.),
            entry(2, 530., 500.),
            entry(3, 515., 500.),
        ]);
        let t = Vec2::new(515., 900.);
        let along = |c: Vec2| (c.y - 500.).abs() < 1e-9;
        assert_eq!(
            step(
                &ix,
                PlayerId(3),
                20.,
                Vec2::new(515., 500.),
                t,
                wide(),
                along
            ),
            None
        );
        // Off-centre (30 and 20 u deep) it evens the two out.
        let ix = sorted(vec![
            entry(1, 500., 500.),
            entry(2, 530., 500.),
            entry(3, 510., 500.),
        ]);
        let got = step(
            &ix,
            PlayerId(3),
            20.,
            Vec2::new(510., 500.),
            t,
            wide(),
            along,
        )
        .unwrap();
        assert_eq!(got, Vec2::new(515., 500.));
    }

    #[test]
    fn the_step_reads_no_entry_of_its_own() {
        // The caller passes the mob's room: no scan of the index for the mob's own entry (that scan made a think pass
        // O(n^2)). A mob absent from the index still steps away from its neighbour.
        let ix = sorted(vec![entry(1, 500., 500.)]);
        let t = Vec2::new(510., 700.);
        assert_eq!(
            at(&ix, 2, Vec2::new(530., 500.), t, wide()),
            Some(Vec2::new(540., 500.))
        );
    }

    #[test]
    fn a_step_never_exceeds_the_cap_after_the_band_clamp() {
        // A melee mob between its band edge (90) and its far line, pushed sideways by a near-coincident neighbour: the
        // clamp pulls the step inward, and the step is still at most MOB_SPACING_STEP_MAX long.
        let t = Vec2::new(1000., 1000.);
        let from = Vec2::new(1000., 901.);
        let ix = sorted(vec![entry(1, 1001., 901.), entry(2, 1000., 901.)]);
        let band = Band { lo: 0., hi: 90. };
        let to = at(&ix, 2, from, t, band).expect("a step");
        let len = hypot(to.x - from.x, to.y - from.y);
        assert!(len <= MOB_SPACING_STEP_MAX + 1e-9, "step {len}");
    }

    #[test]
    fn spacing_never_carries_out_a_retreat_the_policy_refused() {
        // A bow mob 100 u from its target (inside its retreat line: the policy said Stop because its retreat search
        // failed) with an overlapping neighbour: no step at all, never the 128 u walk out to the band.
        let t = Vec2::new(1000., 1000.);
        let ix = sorted(vec![entry(1, 1000., 900.), entry(2, 1010., 900.)]);
        let band = Band { lo: 228., hi: 392. };
        assert_eq!(at(&ix, 1, Vec2::new(1000., 900.), t, band), None);
        assert_eq!(at(&ix, 2, Vec2::new(1010., 900.), t, band), None);
    }

    #[test]
    fn a_blocked_step_tries_the_next_candidate_then_gives_up() {
        let ix = sorted(vec![entry(1, 500., 500.), entry(2, 510., 500.)]);
        let t = Vec2::new(505., 700.);
        let from = Vec2::new(510., 500.);
        // Only the line is open (a corridor): the full step (to 526) refused, its half (to 518) allowed.
        let open = |c: Vec2| c.x < 520. && (c.y - 500.).abs() < 1e-9;
        let got = step(&ix, PlayerId(2), 20., from, t, wide(), open).unwrap();
        assert_eq!(got, Vec2::new(518., 500.));
        assert_eq!(
            step(&ix, PlayerId(2), 20., from, t, wide(), |_| false),
            None
        );
    }

    #[test]
    fn a_tiny_overlap_is_settled() {
        let ix = sorted(vec![entry(1, 500., 500.), entry(2, 539.5, 500.)]);
        // Overlap 0.5 < MOB_SPACING_STEP_MIN: no order.
        const { assert!(0.5 < MOB_SPACING_STEP_MIN) };
        assert_eq!(
            at(&ix, 2, Vec2::new(539.5, 500.), Vec2::new(0., 0.), wide()),
            None
        );
    }

    #[test]
    fn neighbours_across_a_cell_edge_count() {
        let edge = MOB_SPACING_CELL * 8.;
        let ix = sorted(vec![entry(1, edge - 5., 300.), entry(2, edge + 5., 300.)]);
        assert_ne!(ix[0].key, ix[1].key);
        assert!(at(
            &ix,
            2,
            Vec2::new(edge + 5., 300.),
            Vec2::new(0., 0.),
            wide()
        )
        .is_some());
    }
}
