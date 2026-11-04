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

/// JavaScript `Math.round` (round half up toward +infinity), used where the legacy code rounds a reward.
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
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
