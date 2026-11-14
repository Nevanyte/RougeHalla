//! P-MAPGEN-STYLE-REFUSE-1: a styler that cannot build round its zone's signature landmark refuses the attempt
//! (`pipeline::Refusal::StyleLandmark`, the next attempt is tried) instead of failing the whole generation call.
//!
//! Here: the styler half (a made-up Sentenced church whose door is not three open tiles in one run makes the styler
//! pass return `style_runtime::Error::Landmark`, not today's `Error::Feature`), and the sweep guards (seeds 1-32, every
//! attempt up to each seed's map: never a generation error; option off never the new refusal). The pipeline half (the
//! new error becomes a refused attempt and the next attempt is tried; every other styler error still fails the call)
//! is `src/mapgen/pipeline/style_refusal_tests.rs`, which needs the crate-private styler fault seam.
//!
//! Option-off maps byte for byte are pinned elsewhere and not repeated here: `mapgen_signature_core.rs`
//! `g8_signature_off_is_todays_generator`, `mapgen_signature_scale.rs` `option_off_is_todays_generator`,
//! `mapgen_land_sentenced.rs` `option_off_maps_are_todays`.

use rh_sim::map::{TILE_FLOOR, TILE_WALL};
use rh_sim::mapdata::{FeatureJob, FeatureKind, MapFeature, TileRect, Zone};
use rh_sim::mapgen::{coliseum, pipeline, style_runtime, style_zones};
use std::sync::OnceLock;

// ---------------------------------------------------------------------------------------------------------------------
// The styler half: a made-up church.
// ---------------------------------------------------------------------------------------------------------------------

/// The made-up map: 160 x 160 (the real map size, so the church's front reads as in a real map), floor inside a
/// one-tile wall border, every tile in the Sentenced zone (zone index 1).
fn side() -> usize {
    coliseum::W
}

/// The church: a 13 x 13 wall ring, x 34..=46, y 74..=86, round its camp tile (40, 80). The coliseum centre is due
/// east of the camp, so the front is +x (`signature::front`), the door-side wall line is x = 46 and the door is
/// y 79..=81 on it, as the church's ring leaves it (`landmarks/signature/church.rs`).
fn church_box() -> (i32, i32, i32, i32) {
    (34, 74, 46, 86)
}

fn camp() -> (i32, i32) {
    (40, 80)
}

/// The tiles of the door-side wall line (x = 46) left open, `door` (y values).
fn made_up_church(door: &[i32]) -> style_runtime::State {
    let n = side() * side();
    let at = |x: i32, y: i32| y as usize * side() + x as usize;
    let mut tiles = vec![TILE_FLOOR; n];
    for i in 0..side() as i32 {
        let last = side() as i32 - 1;
        for (x, y) in [(i, 0), (i, last), (0, i), (last, i)] {
            tiles[at(x, y)] = TILE_WALL;
        }
    }
    let (x0, y0, x1, y1) = church_box();
    let mut owner = vec![0_u16; n];
    let mut ring = 0_u32;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let edge = x == x0 || x == x1 || y == y0 || y == y1;
            if !edge || (x == x1 && door.contains(&y)) {
                continue;
            }
            tiles[at(x, y)] = TILE_WALL;
            owner[at(x, y)] = 1;
            ring += 1;
        }
    }
    let church = MapFeature {
        kind: FeatureKind::Church,
        variant: String::new(),
        zone: Zone::Sentenced,
        jobs: vec![FeatureJob::Landmark],
        ax: camp().0,
        ay: camp().1,
        p: vec![],
        bbox: TileRect {
            x: x0,
            y: y0,
            w: (x1 - x0 + 1) as u32,
            h: (y1 - y0 + 1) as u32,
        },
        tiles: ring,
    };
    style_runtime::State::new(
        side(),
        side(),
        tiles,
        vec![0; n],
        vec![],
        vec![church],
        owner,
    )
    .expect("the made-up church is a valid styler state")
}

/// Runs the five-styler registry (only the Sentenced zone is painted) on the made-up church.
fn style(door: &[i32], decor: bool) -> (Result<(), style_runtime::Error>, style_runtime::State) {
    let fixed = coliseum::fixed_layout();
    let registry = style_zones::Registry::new(&fixed).expect("registry");
    let n = side() * side();
    let zone = vec![1_u8; n];
    let protect = vec![0_u8; n];
    let mut state = made_up_church(door);
    let result = registry
        .apply(
            &style_zones::Input {
                w: side(),
                h: side(),
                seed: 1,
                attempt: 0,
                order: &[Zone::Sentenced],
                zone: &zone,
                territory: None,
                camps: &[],
                protect: &protect,
                spawns: &[],
                centre_walk: None,
                decor,
                no_block: None,
                no_prop: None,
                caps: None,
            },
            &mut state,
        )
        .map(|_| ());
    (result, state)
}

/// Control (green today, must stay green): the made-up church with today's three-tile door is built round. The pass
/// succeeds and lays lane rows (`FeatureJob::Lane`), so the church is read as a signature church and its door as a
/// door; the refusal cases below differ from it only in the door.
#[test]
fn the_made_up_church_with_a_three_tile_door_is_built_round() {
    for decor in [false, true] {
        let (result, state) = style(&[79, 80, 81], decor);
        assert_eq!(
            result,
            Ok(()),
            "decor {decor}: the Sentenced styler on a church with a three-tile door"
        );
        assert!(
            state
                .features()
                .iter()
                .any(|f| f.kind == FeatureKind::FenceRow && f.jobs.contains(&FeatureJob::Lane)),
            "decor {decor}: no lane row was laid, so the church was not read as a signature church"
        );
    }
}

/// Red today: the styler pass returns `Error::Feature` (a styler fault, which fails the generation call). A church
/// whose door-side wall line does not hold exactly three open tiles in one run is a landmark the Sentenced styler
/// cannot build round: `Error::Landmark`, which the pipeline turns into a refused attempt.
#[test]
fn a_church_door_that_is_not_three_open_tiles_in_one_run_is_a_landmark_refusal() {
    let doors: [(&str, &[i32]); 4] = [
        ("two tiles", &[79, 80]),
        ("four tiles", &[79, 80, 81, 82]),
        ("three tiles with a gap", &[78, 79, 81]),
        ("no door", &[]),
    ];
    for decor in [false, true] {
        for (label, door) in doors {
            let (result, _) = style(door, decor);
            assert_eq!(
                result,
                Err(style_runtime::Error::Landmark),
                "decor {decor}, door {label} {door:?}: the Sentenced styler's answer"
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Sweep guards: seeds 1-32, every attempt until the seed's map.
// ---------------------------------------------------------------------------------------------------------------------

/// The attempts tried per seed before the sweep calls the seed unmade; the signature tests bound the worst accepted
/// attempt index well below it.
fn attempt_limit() -> u64 {
    16
}

fn options(signature: bool, decor: bool) -> pipeline::Options {
    pipeline::Options {
        signature,
        decor,
        ..pipeline::Options::default()
    }
}

/// One configuration: per seed, attempts 0.. until a map. Returns the generation errors, the refusals (attempt and
/// reason) and the seeds without a map.
struct Sweep {
    errors: Vec<String>,
    refusals: Vec<(i64, u64, pipeline::Refusal)>,
    unmade: Vec<i64>,
}

fn sweep(generator: &pipeline::Pipeline<'_>, o: pipeline::Options) -> Sweep {
    let mut out = Sweep {
        errors: vec![],
        refusals: vec![],
        unmade: vec![],
    };
    for seed in 1..=32_i64 {
        let mut made = false;
        for n in 0..attempt_limit() {
            match generator.styled_attempt_with_trace(seed, n, o) {
                Err(e) => out.errors.push(format!("seed {seed} attempt {n}: {e:?}")),
                Ok((report, _)) => match (report.map, report.refusal) {
                    (Some(_), _) => {
                        made = true;
                        break;
                    }
                    (None, Some(r)) => out.refusals.push((seed, n, r)),
                    (None, None) => out.errors.push(format!(
                        "seed {seed} attempt {n}: neither a map nor a refusal"
                    )),
                },
            }
        }
        if !made {
            out.unmade.push(seed);
        }
    }
    out
}

/// Seeds 1-32 with the option on, decor off then decor on, swept once per test binary.
fn option_on() -> &'static [(bool, Sweep); 2] {
    static SWEEPS: OnceLock<[(bool, Sweep); 2]> = OnceLock::new();
    SWEEPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        [false, true].map(|decor| (decor, sweep(&generator, options(true, decor))))
    })
}

/// Guard (green today): with the option on, decor off (the server's pool) and decor on, every attempt of seeds 1-32
/// up to the seed's map answers with a map or a refusal, never a generation error, and every seed makes a map.
#[test]
fn with_the_option_on_every_attempt_of_seeds_1_to_32_is_a_map_or_a_refusal() {
    for (decor, s) in option_on() {
        let landmark = s
            .refusals
            .iter()
            .filter(|r| r.2 == pipeline::Refusal::StyleLandmark)
            .count();
        println!(
            "option on, decor {decor}: {} refusals ({landmark} StyleLandmark), {} errors, unmade {:?}",
            s.refusals.len(),
            s.errors.len(),
            s.unmade
        );
        assert!(
            s.errors.is_empty(),
            "option on, decor {decor}: {} attempts failed the call:\n{}",
            s.errors.len(),
            s.errors.join("\n")
        );
        assert!(
            s.unmade.is_empty(),
            "option on, decor {decor}: seeds without a map in {} attempts: {:?}",
            attempt_limit(),
            s.unmade
        );
    }
}

/// Guard (green today): with the option off there is no signature landmark, so no attempt of seeds 1-32 (decor on and
/// off) is refused round one, and none fails the call.
#[test]
fn with_the_option_off_no_attempt_of_seeds_1_to_32_is_refused_round_a_landmark() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for decor in [false, true] {
        let s = sweep(&generator, options(false, decor));
        let landmark: Vec<_> = s
            .refusals
            .iter()
            .filter(|r| r.2 == pipeline::Refusal::StyleLandmark)
            .collect();
        assert!(
            landmark.is_empty(),
            "option off, decor {decor}: refused round a landmark: {landmark:?}"
        );
        assert!(
            s.errors.is_empty(),
            "option off, decor {decor}: {} attempts failed the call:\n{}",
            s.errors.len(),
            s.errors.join("\n")
        );
        assert!(
            s.unmade.is_empty(),
            "option off, decor {decor}: seeds without a map: {:?}",
            s.unmade
        );
    }
}

/// Guard (green today), for today's church only: with the option on no attempt of seeds 1-32 is refused round a
/// landmark, so the change moves no seed's map to a later attempt (the door always reads; reviewer-opus's trace on
/// P-LAND-SENTENCED-1). A packet that changes a landmark's blueprint may change this expectation, with the owner's
/// approval, and says so in its brief.
#[test]
fn todays_landmarks_are_never_refused_round_on_seeds_1_to_32() {
    for (decor, s) in option_on() {
        let landmark: Vec<_> = s
            .refusals
            .iter()
            .filter(|r| r.2 == pipeline::Refusal::StyleLandmark)
            .collect();
        assert!(
            landmark.is_empty(),
            "option on, decor {decor}: refused round a landmark: {landmark:?}"
        );
    }
}
