//! P-BOT-BRAIN-CONTINUITY-1 oracle: the tracker's rules (module docs of `mob_tracks.rs`).
use super::{MobClass, MobRow, MobTracks, Tracked, MAX_GAP_MS, STEP_SLACK, STEP_SPEED};
use rh_sim::Vec2;

const TICK: f64 = 50.;

fn class(kind: u8, type_code: u8) -> MobClass {
    MobClass {
        kind,
        type_code,
        faction: 1,
    }
}

fn row(x: f64, y: f64, class: MobClass) -> MobRow {
    MobRow {
        at: Vec2::new(x, y),
        class,
        dying: false,
    }
}

fn keys(out: &[Tracked]) -> Vec<String> {
    out.iter().map(|t| t.key.clone()).collect()
}

/// The furthest a mob may move in one 50 ms sample and keep its track.
fn step() -> f64 {
    STEP_SPEED * TICK / 1000. + STEP_SLACK
}

#[test]
fn a_mob_that_moves_within_its_step_bound_keeps_its_key() {
    let mut t = MobTracks::default();
    let grunt = class(1, 3);
    let first = t.update(0., &[row(100., 100., grunt)]);
    let mut x = 100.;
    for i in 1..=40 {
        x += step() * 0.9;
        let out = t.update(f64::from(i) * TICK, &[row(x, 100., grunt)]);
        assert_eq!(keys(&out), keys(&first), "sample {i}: same mob, same key");
    }
    let jump = t.update(41. * TICK, &[row(x + step() * 1.5, 100., grunt)]);
    assert_ne!(
        keys(&jump),
        keys(&first),
        "a move past the step bound is not the same mob"
    );
}

#[test]
fn two_mob_types_never_share_a_track() {
    let mut t = MobTracks::default();
    let a = t.update(0., &[row(100., 100., class(1, 3))]);
    let b = t.update(TICK, &[row(101., 100., class(1, 4))]);
    assert_ne!(
        keys(&a),
        keys(&b),
        "another type in the same spot is another mob"
    );
    let c = t.update(2. * TICK, &[row(101., 100., class(2, 0))]);
    assert_ne!(keys(&b), keys(&c), "another wire kind is another mob");
}

/// Two same-type mobs walking past each other on lanes 10 u apart: the nearest-assignment rule keeps them apart (each
/// stays nearer its own track than the other's), so each keeps its own key the whole way.
#[test]
fn two_same_type_mobs_that_cross_are_kept_apart_by_nearest_assignment() {
    let mut t = MobTracks::default();
    let g = class(1, 3);
    let start = t.update(0., &[row(0., 100., g), row(200., 110., g)]);
    let (left, right) = (start[0].key.clone(), start[1].key.clone());
    for i in 1..=40 {
        let d = f64::from(i) * 5.;
        let out = t.update(
            f64::from(i) * TICK,
            &[row(200. - d, 110., g), row(d, 100., g)],
        );
        assert_eq!(
            out[1].key, left,
            "sample {i}: the left walker keeps its key"
        );
        assert_eq!(
            out[0].key, right,
            "sample {i}: the right walker keeps its key"
        );
    }
}

/// A camp: several same-type mobs close together. The assignment is global (nearest first over all pairs), so a camp
/// that shuffles a little keeps every key even when a greedy per-row pass would steal a neighbour's track.
#[test]
fn a_tight_camp_keeps_every_key_under_global_assignment() {
    let mut t = MobTracks::default();
    let g = class(1, 3);
    let first = t.update(0., &[row(100., 100., g), row(112., 100., g)]);
    // Row order puts the right mob first; it moved left 7 u (now 5 u from the left track, 7 from its own), the left mob
    // moved 1 u: greedy-first-row would give the right mob the left key; global nearest gives each its own.
    let out = t.update(TICK, &[row(105., 100., g), row(101., 100., g)]);
    assert_eq!(out[1].key, first[0].key, "the left mob keeps its key");
    assert_eq!(out[0].key, first[1].key, "the right mob keeps its key");
}

#[test]
fn no_identity_is_claimed_across_a_gap_in_sight() {
    let mut t = MobTracks::default();
    let g = class(1, 3);
    let seen = t.update(0., &[row(100., 100., g)]);
    // Out of view for one sample, back in the very same spot.
    assert!(t.update(TICK, &[]).is_empty());
    let back = t.update(2. * TICK, &[row(100., 100., g)]);
    assert_ne!(keys(&back), keys(&seen), "gone and back is a new key");
    // A frame gap (refused or missing frames) longer than MAX_GAP_MS ends the track too.
    let later = t.update(2. * TICK + MAX_GAP_MS + 1., &[row(100., 100., g)]);
    assert_ne!(
        keys(&later),
        keys(&back),
        "a gap in frames is a gap in sight"
    );
    // And a self teleport.
    t.cut();
    let after_cut = t.update(3. * TICK + MAX_GAP_MS, &[row(100., 100., g)]);
    assert_ne!(keys(&after_cut), keys(&later), "a cut ends every track");
}

#[test]
fn a_death_ends_its_track() {
    let mut t = MobTracks::default();
    let g = class(1, 3);
    let alive = t.update(0., &[row(100., 100., g)]);
    let mut dying = row(101., 100., g);
    dying.dying = true;
    let death = t.update(TICK, &[dying]);
    assert_eq!(
        keys(&death),
        keys(&alive),
        "the death sample still names the mob"
    );
    assert_eq!(t.len(), 0, "the track ends with the death");
    let next = t.update(2. * TICK, &[row(101., 100., g)]);
    assert_ne!(
        keys(&next),
        keys(&alive),
        "a mob in the dead one's spot is another mob"
    );
}

#[test]
fn the_assignment_does_not_depend_on_row_order() {
    let g = class(1, 3);
    let b = class(1, 5);
    let frames: Vec<Vec<MobRow>> = (0..12)
        .map(|i| {
            let s = f64::from(i) * 3.;
            vec![
                row(100. + s, 100., g),
                row(130. - s, 104., g),
                row(115., 140. + s, b),
                row(400., 400., g),
            ]
        })
        .collect();
    let run = |order: &dyn Fn(usize) -> Vec<usize>| {
        let mut t = MobTracks::default();
        frames
            .iter()
            .enumerate()
            .map(|(i, rows)| {
                let perm = order(i);
                let shuffled: Vec<MobRow> = perm.iter().map(|&j| rows[j]).collect();
                let out = t.update(i as f64 * TICK, &shuffled);
                // Back to the canonical order, as (key, x, y).
                let mut by_row: Vec<(String, f64, f64)> = vec![(String::new(), 0., 0.); rows.len()];
                for (k, &j) in perm.iter().enumerate() {
                    by_row[j] = (out[k].key.clone(), rows[j].at.x, rows[j].at.y);
                }
                by_row
            })
            .collect::<Vec<_>>()
    };
    let straight = run(&|_| vec![0, 1, 2, 3]);
    let shuffled = run(&|i| match i % 4 {
        0 => vec![3, 2, 1, 0],
        1 => vec![1, 3, 0, 2],
        2 => vec![2, 0, 3, 1],
        _ => vec![0, 2, 1, 3],
    });
    assert_eq!(straight, shuffled, "row order is not identity");
}

#[test]
fn velocity_is_displacement_over_the_sample_interval_and_zero_on_a_new_track() {
    let mut t = MobTracks::default();
    let g = class(1, 3);
    let first = t.update(0., &[row(100., 100., g)]);
    assert_eq!(
        first[0].vel,
        Vec2::new(0., 0.),
        "new track: no earlier sample"
    );
    let second = t.update(TICK, &[row(104., 97., g)]);
    assert_eq!(second[0].vel, Vec2::new(80., -60.), "4 u and -3 u in 50 ms");
    let third = t.update(TICK + 100., &[row(110., 97., g)]);
    assert_eq!(third[0].vel, Vec2::new(60., 0.), "over the actual interval");
}
