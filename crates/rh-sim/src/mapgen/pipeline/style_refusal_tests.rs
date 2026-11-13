//! P-MAPGEN-STYLE-REFUSE-1, the pipeline half: a styler pass that returns `style_runtime::Error::Landmark` (it cannot
//! build round its zone's signature landmark) refuses the attempt with `Refusal::StyleLandmark` and the next attempt
//! is tried; every other styler error still fails the call with `Error::Style` and the same value. The styler half
//! (the Sentenced church door) and the seed sweeps are `tests/mapgen_style_refusal.rs`.
//!
//! The styler result is replaced through the crate-private seam `Pipeline::with_style_fault` (the styler pass of one
//! attempt number returns the given error after it has run): no real landmark today makes a styler refuse.
use super::{Error, Options, Pipeline, Refusal};
use crate::mapdata::GameMapData;
use crate::mapgen::{coliseum, style_runtime};

fn on() -> Options {
    Options {
        signature: true,
        ..Options::default()
    }
}

fn seed() -> i64 {
    1
}

/// The first `count` attempts of `seed()` that make a map with `o` and no fault, in order, among the first 16.
fn landing(generator: &Pipeline<'_>, o: Options, count: usize) -> Vec<(u64, GameMapData)> {
    let mut out = Vec::new();
    for n in 0..16 {
        if out.len() == count {
            break;
        }
        if let Some(m) = generator
            .styled_attempt(seed(), n, o)
            .expect("an attempt without a fault answers")
        {
            out.push((n, m));
        }
    }
    out
}

fn json(m: &GameMapData) -> Vec<u8> {
    serde_json::to_vec(m).expect("map JSON")
}

/// A short form of an attempt's answer: the map's absence or presence, the refusal, or the error.
fn answer(r: &Result<super::AttemptReport, Error>) -> String {
    match r {
        Ok(report) => format!(
            "Ok(map: {}, refusal: {:?})",
            report.map.is_some(),
            report.refusal
        ),
        Err(e) => format!("Err({e:?})"),
    }
}

/// Red today: the call fails with `Error::Style(Landmark)`. With the option on, seed 1: the attempt that makes the
/// first map, its styler made to answer `Landmark`, is refused with `StyleLandmark` (and reported so by the numbered
/// call); the generation call goes on and returns the map of the next attempt that makes one, byte for byte as that
/// attempt makes it without the fault, so a refused attempt changes no draw of a later one.
#[test]
fn a_landmark_refusal_from_a_styler_refuses_the_attempt_and_the_next_is_tried() {
    let fixed = coliseum::fixed_layout();
    for decor in [false, true] {
        let o = Options { decor, ..on() };
        let plain = Pipeline::new(&fixed);
        let maps = landing(&plain, o, 2);
        assert!(
            maps.len() >= 2,
            "decor {decor}: seed {} makes fewer than two maps in 16 attempts",
            seed()
        );
        let (first, _) = &maps[0];
        let (next, next_map) = &maps[1];
        let faulted =
            Pipeline::new(&fixed).with_style_fault(*first, style_runtime::Error::Landmark);
        let report = faulted
            .styled_attempt_with_trace(seed(), *first, o)
            .map(|(r, _)| r);
        assert_eq!(
            answer(&report),
            answer(&Ok(super::AttemptReport::refused(Refusal::StyleLandmark))),
            "decor {decor}: attempt {first} whose styler answers Landmark"
        );
        let numbered = faulted.generate_styled(seed(), Some(*first), o);
        assert!(
            matches!(numbered, Err(Error::AttemptRefused(Refusal::StyleLandmark))),
            "decor {decor}: the numbered call for attempt {first}: {:?}",
            numbered.map(|_| "a map")
        );
        let generated = faulted.generate_styled(seed(), None, o);
        match generated {
            Ok(m) => assert!(
                json(&m) == json(next_map),
                "decor {decor}: the call went on but did not return attempt {next}'s map"
            ),
            Err(e) => panic!(
                "decor {decor}: the generation call failed instead of trying attempt {next}: {e:?}"
            ),
        }
        let certified = faulted.certified_styled(seed(), o);
        match certified {
            Ok(Some(m)) => assert!(
                json(&m) == json(next_map),
                "decor {decor}: the certified call went on but did not return attempt {next}'s map"
            ),
            other => panic!(
                "decor {decor}: the certified call did not return attempt {next}'s map: {:?}",
                other.map(|m| m.is_some())
            ),
        }
    }
}

/// Every styler error other than `Landmark`, today's eight.
fn faults() -> [style_runtime::Error; 8] {
    use style_runtime::Error as E;
    [
        E::Dimensions,
        E::Layer,
        E::Ownership,
        E::Definition,
        E::Metadata,
        E::Feature,
        E::Capacity,
        E::Route,
    ]
}

/// Guard (green today, must stay green): a real styler fault still fails the call with the same error value, with
/// the option on and off: the attempt, the numbered call and the generation call all return `Error::Style(e)`; the
/// next attempt is not tried.
#[test]
fn a_real_styler_fault_still_fails_the_call_with_the_same_error() {
    let fixed = coliseum::fixed_layout();
    for signature in [false, true] {
        let o = Options {
            signature,
            ..Options::default()
        };
        let first = landing(&Pipeline::new(&fixed), o, 1)
            .first()
            .map(|(n, _)| *n)
            .expect("seed 1 makes a map in 16 attempts");
        for fault in faults() {
            let faulted = Pipeline::new(&fixed).with_style_fault(first, fault);
            let report = faulted
                .styled_attempt_with_trace(seed(), first, o)
                .map(|(r, _)| r);
            assert!(
                matches!(report, Err(Error::Style(e)) if e == fault),
                "option {signature}, {fault:?}: attempt {first}: {}",
                answer(&report)
            );
            let numbered = faulted.generate_styled(seed(), Some(first), o);
            assert!(
                matches!(numbered, Err(Error::Style(e)) if e == fault),
                "option {signature}, {fault:?}: the numbered call: {:?}",
                numbered.map(|_| "a map")
            );
            let generated = faulted.generate_styled(seed(), None, o);
            assert!(
                matches!(generated, Err(Error::Style(e)) if e == fault),
                "option {signature}, {fault:?}: the generation call: {:?}",
                generated.map(|_| "a map")
            );
        }
    }
}
