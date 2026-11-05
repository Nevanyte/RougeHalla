use super::{dist2, DIR16};
pub fn dir_index16(dx: f64, dy: f64) -> usize {
    let (mut best, mut bd) = (0, dx * f64::from(DIR16[0][0]) + dy * f64::from(DIR16[0][1]));
    for (k, v) in DIR16.iter().enumerate().skip(1) {
        let d = dx * f64::from(v[0]) + dy * f64::from(v[1]);
        if d > bd {
            bd = d;
            best = k
        }
    }
    best
}
pub fn seg_dist2(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let (abx, aby) = (bx - ax, by - ay);
    let len2 = abx * abx + aby * aby;
    if len2 == 0.0 {
        return dist2(px, py, ax, ay);
    }
    let dot = (px - ax) * abx + (py - ay) * aby;
    if dot <= 0.0 {
        return dist2(px, py, ax, ay);
    }
    if dot >= len2 {
        return dist2(px, py, bx, by);
    }
    let cross = (px - ax) * aby - (py - ay) * abx;
    cross * cross / len2
}
/// Fresh owned offsets in (dy,dx) order; no mutable global cache.
pub fn disc_offsets(r4: i32) -> Vec<[i32; 2]> {
    let mut out = Vec::new();
    if r4 >= 0 {
        let reach = r4 / 4 + 1;
        let lim = f64::from(r4) * f64::from(r4);
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                let (x, y) = (f64::from(dx), f64::from(dy));
                if 16.0 * (x * x + y * y) <= lim {
                    out.push([dx, dy])
                }
            }
        }
    }
    out
}
pub fn in_beam(dx: f64, dy: f64, ux: f64, uy: f64, half4: f64) -> bool {
    if dx * ux + dy * uy <= 0.0 {
        return false;
    }
    let cross = dx * uy - dy * ux;
    16.0 * cross * cross <= half4 * half4 * (ux * ux + uy * uy)
}
pub use crate::mapgen::zones::pseudo_angle;
