//! Mob spacing (ADR0024 addendum "Mob spacing", owner direction 2026-11-10; a docs/DEVIATIONS.md row): under
//! [`crate::archetype::HitboxMode::Archetypes`] a regional mob that is already where its combat policy wants it (in its attack band, with
//! line of sight: the policy said `Stop`) and finds another mob inside its personal space queues one short, validated
//! `Move` that steps it out, sliding round its target instead of stacking on its pack-mates. Legacy has no such rule;
//! under [`crate::archetype::HitboxMode::LegacyCircle`] nothing here runs (`mob_ai::think` never builds the index, `fight` never asks).
//!
//! Not a system and no schedule row: `mob_ai::think` builds the index once per call (positions do not change while mobs
//! think: they only queue inputs), and `mob_ai::fight` asks for a step in its own `Stop` branch. Nothing here changes who
//! a mob targets, when it attacks or what it holds; the step goes through `validate` + `Cx::submit` like every other
//! mob order (C-INPUT).
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
fn room(m: &Mob) -> f64 {
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

/// Rebuilds the index of spaced mobs into `out` (cleared first; its capacity is reused, so a step allocates nothing
/// once it has seen its largest pack). Sorted by (cell key, id): a fixed order, independent of the store's layout.
pub(crate) fn index(w: &World, out: &mut Vec<Entry>) {
    out.clear();
    for m in &w.mobs {
        if spaced(m) {
            let at = m.core.pos();
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

/// The band of distances to its target a mob may stand at without its policy wanting to move (`lo` 0 for melee).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Band {
    pub lo: f64,
    pub hi: f64,
}

/// The step mob `id` (at `from`, fighting a target at `target`) takes out of its pack-mates' room, or `None` when no
/// mob is inside its room, when the step would be shorter than [`MOB_SPACING_STEP_MIN`] (settled: no jitter), or when
/// neither the step nor its half passes `ok` (a wall, the leash, lost line of sight: the mob stays and overlaps rather
/// than deadlock). The step is the sum over the neighbours inside the room of half the overlap along the line between
/// the two (each of a pair moves half), capped at [`MOB_SPACING_STEP_MAX`] and pulled back into `band` round the target,
/// which turns an outward push into a slide round the target, then capped again (the whole step is never longer than
/// [`MOB_SPACING_STEP_MAX`]). A mob inside `band.lo` (its policy wanted a retreat it could not find) gets `None`.
pub(crate) fn step(
    index: &[Entry],
    id: PlayerId,
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
    let me = index.iter().find(|e| e.id == id)?;
    let (cx, cy) = (cell(from.x), cell(from.y));
    let (mut px, mut py) = (0., 0.);
    let mut crowded = false;
    for row in cy.saturating_sub(1)..=cy + 1 {
        let lo = row * STRIDE + cx.saturating_sub(1);
        let hi = row * STRIDE + cx + 1;
        let start = index.partition_point(|e| e.key < lo);
        for e in index[start..].iter().take_while(|e| e.key <= hi) {
            if e.id == id {
                continue;
            }
            let (dx, dy) = (from.x - e.at.x, from.y - e.at.y);
            let d = hypot(dx, dy);
            let need = me.room + e.room;
            if d >= need {
                continue;
            }
            crowded = true;
            let share = (need - d) / 2.;
            let (ux, uy) = if d > 1e-9 {
                (dx / d, dy / d)
            } else {
                apart(id, e.id, from, target)
            };
            px += ux * share;
            py += uy * share;
        }
    }
    if !crowded {
        return None;
    }
    let len = hypot(px, py);
    if len > MOB_SPACING_STEP_MAX {
        px *= MOB_SPACING_STEP_MAX / len;
        py *= MOB_SPACING_STEP_MAX / len;
    }
    let mut to = Vec2::new(from.x + px, from.y + py);
    let (rx, ry) = (to.x - target.x, to.y - target.y);
    let r = hypot(rx, ry);
    if r > band.hi {
        to = Vec2::new(target.x + rx * band.hi / r, target.y + ry * band.hi / r);
    } else if r < band.lo && r > 1e-9 {
        to = Vec2::new(target.x + rx * band.lo / r, target.y + ry * band.lo / r);
    }
    // The clamp can lengthen the step (a mob between the band edge and its far line is pulled inward too): cap again.
    let (sx, sy) = (to.x - from.x, to.y - from.y);
    let len = hypot(sx, sy);
    if len > MOB_SPACING_STEP_MAX {
        to = Vec2::new(
            from.x + sx * MOB_SPACING_STEP_MAX / len,
            from.y + sy * MOB_SPACING_STEP_MAX / len,
        );
        // On the segment from `from` (r_from <= its far line) to a point inside the band: never farther out than either
        // end. Only the retreat side can dip, by a hair, inside `lo`; then the mob stays.
        if hypot(to.x - target.x, to.y - target.y) < band.lo {
            return None;
        }
    }
    for c in [to, Vec2::new((from.x + to.x) / 2., (from.y + to.y) / 2.)] {
        if hypot(c.x - from.x, c.y - from.y) < MOB_SPACING_STEP_MIN {
            return None;
        }
        if ok(c) {
            return Some(c);
        }
    }
    None
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
        // Every neighbour that can be inside a room is in the 3 x 3 cells round the mob.
        for row in &crate::archetype::ARCHETYPES {
            let f = row.foot();
            let room = f.half_x().max(f.half_y()) + MOB_SPACING_MARGIN;
            assert!(2. * room <= MOB_SPACING_CELL, "{}", row.key);
        }
    }

    #[test]
    fn a_lone_mob_and_a_spaced_pair_do_not_move() {
        let ix = sorted(vec![entry(1, 500., 500.), entry(2, 541., 500.)]);
        let t = Vec2::new(500., 600.);
        assert_eq!(step(&ix, PlayerId(1), ix[0].at, t, wide(), |_| true), None);
        let lone = sorted(vec![entry(1, 500., 500.)]);
        assert_eq!(
            step(&lone, PlayerId(1), lone[0].at, t, wide(), |_| true),
            None
        );
    }

    #[test]
    fn a_pair_steps_apart_by_half_the_overlap_each() {
        let ix = sorted(vec![entry(1, 500., 500.), entry(2, 520., 500.)]);
        let t = Vec2::new(510., 700.);
        let a = step(&ix, PlayerId(1), Vec2::new(500., 500.), t, wide(), |_| true).unwrap();
        let b = step(&ix, PlayerId(2), Vec2::new(520., 500.), t, wide(), |_| true).unwrap();
        assert_eq!(a, Vec2::new(490., 500.));
        assert_eq!(b, Vec2::new(530., 500.));
    }

    #[test]
    fn coincident_mobs_split_across_the_line_to_the_target() {
        let ix = sorted(vec![entry(7, 500., 500.), entry(3, 500., 500.)]);
        let t = Vec2::new(500., 400.); // north
        let lo = step(&ix, PlayerId(3), Vec2::new(500., 500.), t, wide(), |_| true).unwrap();
        let hi = step(&ix, PlayerId(7), Vec2::new(500., 500.), t, wide(), |_| true).unwrap();
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
        let a = step(&ix, PlayerId(1), ix[0].at, t, band, |_| true).unwrap();
        assert!(hypot(a.x - t.x, a.y - t.y) <= 90. + 1e-9);
        assert!(a.x < 1000.);
    }

    #[test]
    fn a_step_never_exceeds_the_cap_after_the_band_clamp() {
        // A melee mob between its band edge (90) and its far line, pushed sideways by a near-coincident neighbour: the
        // clamp pulls the step inward, and the step is still at most MOB_SPACING_STEP_MAX long.
        let t = Vec2::new(1000., 1000.);
        let from = Vec2::new(1000., 901.);
        let ix = sorted(vec![entry(1, 1001., 901.), entry(2, 1000., 901.)]);
        let band = Band { lo: 0., hi: 90. };
        let to = step(&ix, PlayerId(2), from, t, band, |_| true).expect("a step");
        let len = hypot(to.x - from.x, to.y - from.y);
        assert!(len <= MOB_SPACING_STEP_MAX + 1e-9, "step {len}");
    }

    #[test]
    fn spacing_never_carries_out_a_retreat_the_policy_refused() {
        // A bow mob 100 u from its target (inside its retreat line: the policy said Stop because its retreat search
        // failed) with an overlapping neighbour: no step at all, never the 128 u walk out to the band.
        let t = Vec2::new(1000., 1000.);
        let from = Vec2::new(1000., 900.);
        let ix = sorted(vec![entry(1, 1000., 900.), entry(2, 1010., 900.)]);
        let band = Band { lo: 228., hi: 392. };
        assert_eq!(step(&ix, PlayerId(1), from, t, band, |_| true), None);
        assert_eq!(step(&ix, PlayerId(2), Vec2::new(1010., 900.), t, band, |_| true), None);
    }

    #[test]
    fn a_blocked_step_tries_its_half_then_gives_up() {
        let ix = sorted(vec![entry(1, 500., 500.), entry(2, 510., 500.)]);
        let t = Vec2::new(505., 700.);
        let from = Vec2::new(500., 500.);
        // Full step (to 485) refused, half (to 492.5) allowed.
        let got = step(&ix, PlayerId(1), from, t, wide(), |c| c.x > 490.).unwrap();
        assert_eq!(got, Vec2::new(492.5, 500.));
        assert_eq!(step(&ix, PlayerId(1), from, t, wide(), |_| false), None);
    }

    #[test]
    fn a_tiny_overlap_is_settled() {
        let ix = sorted(vec![entry(1, 500., 500.), entry(2, 539., 500.)]);
        // Overlap 1, half 0.5 < MOB_SPACING_STEP_MIN: no order.
        const { assert!(0.5 < MOB_SPACING_STEP_MIN) };
        assert_eq!(
            step(
                &ix,
                PlayerId(1),
                ix[0].at,
                Vec2::new(0., 0.),
                wide(),
                |_| true
            ),
            None
        );
    }

    #[test]
    fn neighbours_across_a_cell_edge_count() {
        let edge = MOB_SPACING_CELL * 8.;
        let ix = sorted(vec![entry(1, edge - 5., 300.), entry(2, edge + 5., 300.)]);
        assert_ne!(ix[0].key, ix[1].key);
        assert!(step(
            &ix,
            PlayerId(1),
            Vec2::new(edge - 5., 300.),
            Vec2::new(0., 0.),
            wide(),
            |_| true
        )
        .is_some());
    }
}
