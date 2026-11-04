//! Numeric policy (docs/CONTRACTS.md C-NUM): IEEE-754 binary64 everywhere in the simulation, operations in the legacy order,
//! no fused multiply-add (Rust never fuses implicitly), and every transcendental function from the pure-Rust `libm` crate, so
//! a build on any declared target produces bit-identical results. V8 (the legacy server) may differ from `libm` in the last
//! ulp of `atan2`, `hypot`, `exp` and `asin`; the parity harness tolerates exactly that (parity/README.md).

#[inline]
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}
#[inline]
pub fn hypot(x: f64, y: f64) -> f64 {
    libm::hypot(x, y)
}
#[inline]
pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}
#[inline]
pub fn asin(x: f64) -> f64 {
    libm::asin(x)
}
#[inline]
pub fn pow(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}
#[inline]
pub fn sqrt(x: f64) -> f64 {
    // IEEE sqrt is correctly rounded on every target.
    x.sqrt()
}

pub const PI: f64 = core::f64::consts::PI;

/// A finite angle wrapped to (-PI, PI] (legacy `wrapAngle`: `%` is exact for any finite input).
pub fn wrap_angle(a: f64) -> f64 {
    let mut w = a % (2.0 * PI);
    if w > PI {
        w -= 2.0 * PI;
    } else if w <= -PI {
        w += 2.0 * PI;
    }
    w
}

/// Absolute difference between two angles, in [0, PI].
pub fn angle_between(a: f64, b: f64) -> f64 {
    wrap_angle(a - b).abs()
}

/// JavaScript `Math.round`, exactly (ECMA-262 21.3.2.28): the integer closest to `x`, a tie going toward +infinity; NaN and
/// the infinities unchanged; a zero result keeps the sign of `x` (`-0.4` and `-0.5` give `-0`). Used where the legacy code
/// rounds a reward or a duration.
///
/// `x - f` is exact for every finite `x` (Sterbenz for `|x| >= 1`, a multiple of the ulp of `x` below that), so the tie
/// test is exact. The former `(x + 0.5).floor()` was not: `0.49999999999999994 + 0.5` rounds to `1.0`, and an odd integer
/// `>= 2^52` plus `0.5` rounds up to the next even one.
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    let r = if x - f >= 0.5 { f + 1.0 } else { f };
    if r == 0.0 {
        // Math.round(-0.3) and Math.round(-0) are -0; Math.round(0.3) is +0.
        0.0f64.copysign(x)
    } else {
        r
    }
}

/// `v.floor() as i64` for every `f64` (NaN gives 0, out-of-range values and the infinities saturate, like `as`), without
/// calling a floor routine: the default x86_64 target has no SSE4.1 `roundsd`, so `f64::floor` is a software call there.
///
/// Exact: `v as i64` truncates toward zero (saturating), and it is above `v` only for a negative non-integer `v` in range,
/// where the floor is one less. Where `|v| >= 2^53` every `f64` is an integer, so `t as f64` equals `v` and no step is
/// taken; `t as f64` cannot round across `v`.
#[inline]
pub fn floor_i64(v: f64) -> i64 {
    let t = v as i64;
    if (t as f64) > v {
        t.saturating_sub(1)
    } else {
        t
    }
}

/// `v.ceil() as i64` for every `f64` (same saturation and NaN rule as [`floor_i64`]), without a ceil routine.
#[inline]
pub fn ceil_i64(v: f64) -> i64 {
    let t = v as i64;
    if (t as f64) < v {
        t.saturating_add(1)
    } else {
        t
    }
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}
