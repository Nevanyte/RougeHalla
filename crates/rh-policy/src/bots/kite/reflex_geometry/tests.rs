//! Direct consumer of the actual-source reflex geometry fixture. Expected values come only from the
//! immutable captured TS output; nothing here recomputes an oracle from the implementation.
use super::*;
use serde_json::Value;

/// C-PARITY continuous tolerance: the fixture rounds to 1e-6 and libm/V8 may differ by ulps.
/// Only continuous outputs use it; Some/None/error and discrete facts compare exactly.
const PARITY_TOL: f64 = 2e-6;

fn corpus() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/policy/reflex-geometry/source.json"
    )))
    .unwrap()
}

fn num(v: &Value) -> f64 {
    v.as_f64().expect("finite source number")
}

fn vec2(v: &Value) -> Vec2 {
    Vec2::new(num(&v[0]), num(&v[1]))
}

fn finite_input(input: &Value) -> (CourseFacts, Vec2, f64) {
    (
        CourseFacts {
            from_self: input["from_self"].as_bool().unwrap(),
            origin: vec2(&input["origin"]),
            at: vec2(&input["at"]),
            velocity: vec2(&input["velocity"]),
            range: num(&input["range"]),
        },
        vec2(&input["self_at"]),
        num(&input["lag_ms"]),
    )
}

fn close(actual: f64, expected: &Value, at: &str, max_diff: &mut f64) {
    let expected = num(expected);
    let d = (actual - expected).abs();
    if d > *max_diff {
        *max_diff = d;
    }
    assert!(
        d <= PARITY_TOL,
        "{at}: native {actual:?}, source {expected:?}, abs diff {d:?} > C-PARITY {PARITY_TOL:?}"
    );
}

#[test]
fn actual_source_90_plus_6_geometry_rows_match() {
    let corpus = corpus();
    assert_eq!(
        corpus["profile"]["base"],
        "a0c4818ce9df8ad0f4124db31e65ba1244bddc3b"
    );
    assert_eq!(
        corpus["profile"]["source"]["sha256"],
        "b7ceff483d51fe1d58d79ef34562e28a079027623527f11264c21439c2b6e2be"
    );
    let mut max_diff = 0.0f64;
    let angle = corpus["angle"]["cases"].as_array().unwrap();
    assert_eq!(angle.len(), 10, "angle fixture row count");
    for (i, row) in angle.iter().enumerate() {
        let input = &row["input"];
        let got = angle_gap(num(&input["a"]), num(&input["b"])).expect("finite angle probe");
        close(got, &row["result"], &format!("angle[{i}]"), &mut max_diff);
    }
    let courses = corpus["course"]["cases"].as_array().unwrap();
    assert_eq!(courses.len(), 25, "course fixture row count");
    let mut some = 0usize;
    let mut none = 0usize;
    for (i, row) in courses.iter().enumerate() {
        let (facts, self_at, lag) = finite_input(&row["input"]);
        let got = projectile_course(facts, self_at, lag).expect("finite course probe");
        match (&row["result"], got) {
            (Value::Null, None) => none += 1,
            (Value::Object(expected), Some(course)) => {
                some += 1;
                close(
                    course.tti_ms,
                    &expected["tti_ms"],
                    &format!("course[{i}].tti_ms"),
                    &mut max_diff,
                );
                close(
                    course.offset,
                    &expected["offset"],
                    &format!("course[{i}].offset"),
                    &mut max_diff,
                );
                close(
                    course.nx,
                    &expected["nx"],
                    &format!("course[{i}].nx"),
                    &mut max_diff,
                );
                close(
                    course.ny,
                    &expected["ny"],
                    &format!("course[{i}].ny"),
                    &mut max_diff,
                );
            }
            (expected, got) => {
                panic!("course[{i}] outcome mismatch: source {expected:?} native {got:?}")
            }
        }
    }
    assert!(some > 0 && none > 0, "both Some and None outcomes covered");
    eprintln!("reflex geometry: 10 angle + 25 course rows; max C-PARITY abs diff {max_diff:?}");
}

#[test]
fn nonfinite_facts_are_refused_before_computation() {
    let base = CourseFacts {
        from_self: false,
        origin: Vec2::new(0.0, 0.0),
        at: Vec2::new(20.0, 0.0),
        velocity: Vec2::new(1.0, 0.0),
        range: 100.0,
    };
    let self_at = Vec2::new(21.0, 0.0);
    assert!(projectile_course(base, self_at, 0.0).unwrap().is_some());
    let nan = f64::NAN;
    let inf = f64::INFINITY;
    let bad: Vec<CourseFacts> = vec![
        CourseFacts {
            origin: Vec2::new(nan, 0.0),
            ..base
        },
        CourseFacts {
            origin: Vec2::new(0.0, inf),
            ..base
        },
        CourseFacts {
            at: Vec2::new(nan, 0.0),
            ..base
        },
        CourseFacts {
            at: Vec2::new(0.0, inf),
            ..base
        },
        CourseFacts {
            velocity: Vec2::new(nan, 0.0),
            ..base
        },
        CourseFacts {
            velocity: Vec2::new(0.0, inf),
            ..base
        },
        CourseFacts { range: nan, ..base },
        CourseFacts { range: inf, ..base },
    ];
    for facts in bad {
        assert_eq!(
            projectile_course(facts, self_at, 0.0),
            Err(GeometryError::InvalidFacts)
        );
    }
    assert_eq!(
        projectile_course(base, Vec2::new(nan, 0.0), 0.0),
        Err(GeometryError::InvalidFacts)
    );
    assert_eq!(
        projectile_course(base, Vec2::new(0.0, inf), 0.0),
        Err(GeometryError::InvalidFacts)
    );
    assert_eq!(
        projectile_course(base, self_at, nan),
        Err(GeometryError::InvalidFacts)
    );
    assert_eq!(
        projectile_course(base, self_at, inf),
        Err(GeometryError::InvalidFacts)
    );
    for (a, b) in [(nan, 0.0), (0.0, nan), (inf, 0.0), (0.0, -inf)] {
        assert_eq!(angle_gap(a, b), Err(GeometryError::InvalidFacts));
    }
}

#[test]
fn from_self_exclusion_is_an_explicit_declared_fact() {
    let facts = CourseFacts {
        from_self: true,
        origin: Vec2::new(0.0, 0.0),
        at: Vec2::new(10.0, 0.0),
        velocity: Vec2::new(1.0, 0.0),
        range: 100.0,
    };
    assert_eq!(
        projectile_course(facts, Vec2::new(20.0, 0.0), 0.0),
        Ok(None)
    );
}
