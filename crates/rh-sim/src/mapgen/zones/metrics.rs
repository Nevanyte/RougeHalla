use super::{ZoneContext, H, N, W, ZONES};
/// Rational angular ordering in [0,4), with the source's NaN at (0,0).
pub fn pseudo_angle(dx: f64, dy: f64) -> f64 {
    if dy >= 0.0 {
        if dx >= 0.0 {
            dy / (dx + dy)
        } else {
            1.0 - dx / (-dx + dy)
        }
    } else if dx < 0.0 {
        2.0 - dy / (-dx - dy)
    } else {
        3.0 + dx / (dx - dy)
    }
}
/// Fixed-size 5/7 transform; off-grid is outside, and any nonzero mask byte is inside.
pub fn chamfer(mask: &[u8], out: &mut [i32]) {
    transform(mask, out, false);
}
/// Fixed-size 5/7 transform against other labels; zero is outside.
pub fn chamfer_labels(labels: &[u8], out: &mut [i32]) {
    transform(labels, out, true);
}
fn transform(label: &[u8], out: &mut [i32], labelled: bool) {
    for i in 0..N {
        out[i] = if label[i] != 0 { 1 << 28 } else { 0 };
    }
    for y in 0..H {
        for x in 0..W {
            let i = y * W + x;
            let l = label[i];
            if l == 0 {
                continue;
            }
            let same = |j: usize| !labelled || label[j] == l;
            let mut v = out[i];
            v = v.min(if x > 0 && same(i - 1) {
                out[i - 1] + 5
            } else {
                5
            });
            v = v.min(if y > 0 && same(i - W) {
                out[i - W] + 5
            } else {
                5
            });
            v = v.min(if x > 0 && y > 0 && same(i - W - 1) {
                out[i - W - 1] + 7
            } else {
                7
            });
            v = v.min(if x < W - 1 && y > 0 && same(i - W + 1) {
                out[i - W + 1] + 7
            } else {
                7
            });
            out[i] = v;
        }
    }
    for y in (0..H).rev() {
        for x in (0..W).rev() {
            let i = y * W + x;
            let l = label[i];
            if l == 0 {
                continue;
            }
            let same = |j: usize| !labelled || label[j] == l;
            let mut v = out[i];
            v = v.min(if x < W - 1 && same(i + 1) {
                out[i + 1] + 5
            } else {
                5
            });
            v = v.min(if y < H - 1 && same(i + W) {
                out[i + W] + 5
            } else {
                5
            });
            v = v.min(if x < W - 1 && y < H - 1 && same(i + W + 1) {
                out[i + W + 1] + 7
            } else {
                7
            });
            v = v.min(if x > 0 && y < H - 1 && same(i + W - 1) {
                out[i + W - 1] + 7
            } else {
                7
            });
            out[i] = v;
        }
    }
}
pub fn ring_contact(context: &ZoneContext<'_>, zone: &[u8]) -> [i32; ZONES + 1] {
    let mut out = [0; ZONES + 1];
    for &t in &context.fixed.ring_tiles {
        out[zone[t] as usize] += 1;
    }
    out
}
pub fn sliver_counts(context: &ZoneContext<'_>, zone: &[u8], dt: &mut [i32]) -> [i32; ZONES + 1] {
    chamfer_labels(zone, dt);
    let mut covered = vec![false; N];
    for &t in &context.fixed.painted {
        if dt[t] < context.rules.core_dt {
            continue;
        }
        let z = zone[t];
        for &off in &context.clear_offsets {
            let j = (t as i32 + off) as usize;
            // The reference's out-of-array typed-array read is undefined and cannot equal z.
            // Keep its in-array linear-offset behavior, including offsets that cross a row.
            if zone.get(j) == Some(&z) {
                covered[j] = true;
            }
        }
    }
    let mut out = [0; ZONES + 1];
    for &t in &context.fixed.painted {
        if !covered[t] {
            out[zone[t] as usize] += 1;
        }
    }
    out
}
