//! Two-argument ECMAScript hypot evaluation (scaled compensated sum).
//! Inputs to certification are bounded finite coordinates; no platform libm is used.
pub(super) fn hypot(a: f64, b: f64) -> f64 {
    let max = a.abs().max(b.abs());
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut correction = 0.0;
    for v in [a, b] {
        let x = v / max;
        let summand = x * x - correction;
        let next = sum + summand;
        correction = (next - sum) - summand;
        sum = next;
    }
    sum.sqrt() * max
}
