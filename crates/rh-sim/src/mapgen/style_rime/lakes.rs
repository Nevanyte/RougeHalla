use super::*;
use crate::mapgen::style_features::{argmax_in, fbm_q, flood_above, majority_smooth, tau_for_area};
#[derive(Clone)]
pub(super) struct Lake {
    pub seed: usize,
    pub set: Vec<u8>,
    pub area: usize,
    pub x0: usize,
    pub y0: usize,
    pub x1: usize,
    pub y1: usize,
    pub sum_x: usize,
    pub sum_y: usize,
    pub val: Vec<i32>,
}
pub(super) fn value_field(
    b: &BaseContext<'_>,
    noise: &crate::mapgen::style_features::Noise,
    clr: &[i32],
    allow: &[u8],
    salt: f64,
    d: &Definition,
) -> Vec<i32> {
    let mut val = vec![0; b.w * b.h];
    let bb = b.zone.bbox;
    for y in bb.y..bb.y + bb.h as i32 {
        for x in bb.x..bb.x + bb.w as i32 {
            let i = y as usize * b.w + x as usize;
            if allow[i] == 1 {
                val[i] = d.value_clearance * clr[i]
                    + d.value_noise
                        * (fbm_q(
                            noise,
                            x as f64,
                            y as f64,
                            d.noise_cell,
                            d.noise_octaves,
                            salt,
                        ) as i32
                            - d.value_centre);
            }
        }
    }
    val
}
pub(super) fn grow(
    b: &BaseContext<'_>,
    val: Vec<i32>,
    allow: &[u8],
    seed: usize,
    target: usize,
    d: &Definition,
) -> Option<Lake> {
    let (w, h) = (b.w, b.h);
    let tau = tau_for_area(&val, seed as isize, allow, w, h, target);
    let mut flood = flood_above(&val, tau, seed as isize, allow, w, h);
    if flood.size == 0 {
        return None;
    }
    if flood.size > target {
        let lower = flood_above(&val, tau + 1, seed as isize, allow, w, h);
        if lower.size > 0
            && (target as i64 - lower.size as i64) < (flood.size as i64 - target as i64)
        {
            flood = lower;
        }
    }
    let mut x0 = w;
    let mut x1 = 0;
    let mut y0 = h;
    let mut y1 = 0;
    for (i, &v) in flood.set.iter().enumerate() {
        if v == 1 {
            x0 = x0.min(i % w);
            x1 = x1.max(i % w);
            y0 = y0.min(i / w);
            y1 = y1.max(i / w);
        }
    }
    let mut window = allow.to_vec();
    let margin = d.smooth_window as usize;
    for (i, v) in window.iter_mut().enumerate() {
        if i % w < x0.saturating_sub(margin)
            || i % w > x1.saturating_add(margin)
            || i / w < y0.saturating_sub(margin)
            || i / w > y1.saturating_add(margin)
        {
            *v = 0;
        }
    }
    let smooth = majority_smooth(
        &flood.set,
        &window,
        w,
        h,
        d.smooth_passes,
        Some(d.smooth_threshold),
        &crate::mapgen::style_features::default_definition(),
    );
    if smooth[seed] != 1 {
        return None;
    }
    let values: Vec<_> = smooth.iter().map(|&v| i32::from(v)).collect();
    let region = flood_above(&values, 1, seed as isize, &smooth, w, h);
    if region.size < d.lake_min {
        return None;
    }
    let (mut x0, mut y0, mut x1, mut y1, mut sum_x, mut sum_y) = (w, h, 0, 0, 0, 0);
    for (i, &v) in region.set.iter().enumerate() {
        if v == 1 {
            let (x, y) = (i % w, i / w);
            sum_x += x;
            sum_y += y;
            x0 = x0.min(x);
            x1 = x1.max(x);
            y0 = y0.min(y);
            y1 = y1.max(y);
        }
    }
    Some(Lake {
        seed,
        set: region.set,
        area: region.size,
        x0,
        y0,
        x1,
        y1,
        sum_x,
        sum_y,
        val,
    })
}
pub(super) fn off_limits(w: usize, h: usize, allow: &[u8], lake: &Lake, gap: i32) -> Vec<u8> {
    let mut open = allow.to_vec();
    let gap = gap as usize;
    for y in lake.y0..=lake.y1 {
        for x in lake.x0..=lake.x1 {
            if lake.set[y * w + x] != 1 {
                continue;
            }
            for ny in y.saturating_sub(gap)..=(y + gap).min(h - 1) {
                for nx in x.saturating_sub(gap)..=(x + gap).min(w - 1) {
                    open[ny * w + nx] = 0;
                }
            }
        }
    }
    open
}
pub(super) fn grow_lakes(
    b: &BaseContext<'_>,
    noise: &crate::mapgen::style_features::Noise,
    clr: &[i32],
    allow: &[u8],
    d: &Definition,
    shared: &rime::Definition<'_>,
) -> Vec<Lake> {
    let mut out = Vec::new();
    let Some(first) = argmax_in(clr, allow, 0, clr.len() as isize) else {
        return out;
    };
    if clr[first] < shared.lake_min_clearance {
        return out;
    }
    let Some(one) = grow(
        b,
        value_field(b, noise, clr, allow, d.salt_one, d),
        allow,
        first,
        d.lake_grow,
        d,
    ) else {
        return out;
    };
    if b.zone.painted >= shared.two_lakes_painted {
        let open = off_limits(b.w, b.h, allow, &one, d.lake_gap);
        if let Some(second) = rime::second_seed(b.w, clr, &open, first, shared) {
            let two = grow(
                b,
                value_field(b, noise, clr, &open, d.salt_two, d),
                &open,
                second,
                d.lake_grow,
                d,
            );
            out.push(one);
            if let Some(two) = two {
                out.push(two);
            }
            return out;
        }
    }
    out.push(one);
    out
}
pub(super) fn fill(
    b: &BaseContext<'_>,
    allow: &[u8],
    lakes: &mut [Lake],
    book: &mut routes::RouteBook,
    d: &Definition,
    fixed: &FixedLayout,
) {
    if lakes.len() < 2 {
        return;
    }
    let have = book.iceable(&lakes[0]) + book.iceable(&lakes[1]);
    if have >= d.ice_want {
        return;
    }
    let area = lakes[0].area + lakes[1].area;
    let share = d.fill_share_min.max(have * 1000 / area);
    let target = (d.lake_grow * d.grow_max_percent / 100)
        .min(lakes[0].area + (d.ice_want - have) * 1000 / share);
    if let Some(bigger) = grow(
        b,
        lakes[0].val.clone(),
        &off_limits(b.w, b.h, allow, &lakes[1], d.lake_gap),
        lakes[0].seed,
        target,
        d,
    ) {
        if bigger.area > lakes[0].area {
            lakes[0] = bigger;
            book.ensure(b, lakes, d, fixed);
        }
    }
}
