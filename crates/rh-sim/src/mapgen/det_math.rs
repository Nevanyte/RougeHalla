//! Arithmetic-only legacy generator trigonometry. Preserve expression evaluation order.
pub const TWO_PI: f64 = core::f64::consts::TAU;
pub fn det_sin(x: f64) -> f64 {
    let mut y = x - (x / TWO_PI + 0.5).floor() * TWO_PI;
    if y > core::f64::consts::FRAC_PI_2 {
        y = core::f64::consts::PI - y;
    } else if y < -core::f64::consts::FRAC_PI_2 {
        y = -core::f64::consts::PI - y;
    }
    let y2 = y * y;
    y * (1.0
        + y2 * (-1.0 / 6.0
            + y2 * (1.0 / 120.0
                + y2 * (-1.0 / 5040.0
                    + y2 * (1.0 / 362880.0
                        + y2 * (-1.0 / 39916800.0 + y2 * (1.0 / 6227020800.0)))))))
}
pub fn det_cos(x: f64) -> f64 {
    det_sin(x + core::f64::consts::FRAC_PI_2)
}
