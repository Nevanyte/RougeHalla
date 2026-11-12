use super::*;
use crate::mapgen::landmarks::signature;
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
/// Signature mode (P-MAPGEN-SIG-FROST-1): the first lake (the mere) is seeded at the cave's mouth instead of the
/// zone's clearest tile. Seed candidates are the allowed tiles at most `lake_reach` floor steps from a mouth tile, most
/// clearance first (then fewest steps, then row order); the first that grows a lake is kept. Its value field falls
/// with chamfer distance from the seed (the clearance field's units) plus the same noise, so the lake spreads round
/// the seed rather than flowing to the zone's open middle. The second lake is today's, grown to at most `second_share`
/// percent of the mere's area so the mere stays the zone's largest lake. `None` when no candidate grows a lake: the
/// caller runs today's `grow_lakes`.
#[allow(clippy::too_many_arguments)]
pub(super) fn grow_lakes_at(
    b: &BaseContext<'_>,
    noise: &crate::mapgen::style_features::Noise,
    clr: &[i32],
    allow: &[u8],
    d: &Definition,
    shared: &rime::Definition<'_>,
    mouth: &[usize],
    sd: &signature::Definition,
) -> Option<Vec<Lake>> {
    let (reach, tries) = (sd.lake_reach, sd.lake_tries);
    let (w, h) = (b.w, b.h);
    let mut steps = vec![usize::MAX; w * h];
    let mut queue: Vec<usize> = mouth.to_vec();
    for &i in mouth {
        steps[i] = 0;
    }
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        if steps[i] >= reach {
            continue;
        }
        let (x, y) = (i % w, i / w);
        for (ok, j) in [
            (x > 0, i.wrapping_sub(1)),
            (x + 1 < w, i + 1),
            (y > 0, i.wrapping_sub(w)),
            (y + 1 < h, i + w),
        ] {
            if ok && steps[j] == usize::MAX && b.tiles[j] == TILE_FLOOR {
                steps[j] = steps[i] + 1;
                queue.push(j);
            }
        }
    }
    let mut seeds: Vec<usize> = queue.into_iter().filter(|&i| allow[i] == 1).collect();
    seeds.sort_by(|&p, &q| {
        clr[q]
            .cmp(&clr[p])
            .then(steps[p].cmp(&steps[q]))
            .then(p.cmp(&q))
    });
    let one = seeds.iter().take(tries).find_map(|&first| {
        let (fx, fy) = ((first % w) as i32, (first / w) as i32);
        let mut val = value_field(b, noise, clr, allow, d.salt_one, d);
        for (i, v) in val.iter_mut().enumerate() {
            if allow[i] == 1 {
                let (dx, dy) = (((i % w) as i32 - fx).abs(), ((i / w) as i32 - fy).abs());
                *v -= d.value_clearance * (clr[i] + 3 * dx.max(dy) + dx.min(dy));
            }
        }
        grow(b, val, allow, first, d.lake_grow, d)
    })?;
    let first = one.seed;
    let mut out = vec![one];
    if b.zone.painted >= shared.two_lakes_painted {
        let open = off_limits(w, h, allow, &out[0], d.lake_gap);
        if let Some(second) = rime::second_seed(w, clr, &open, first, shared) {
            if let Some(two) = grow(
                b,
                value_field(b, noise, clr, &open, d.salt_two, d),
                &open,
                second,
                d.lake_grow.min(out[0].area * sd.second_share / 100),
                d,
            ) {
                out.push(two);
            }
        }
    }
    Some(out)
}
/// Signature mode: while the first lake (the mere at the mouth) has a tile on a route band (where it would be plain
/// causeway, cutting its ice in pieces), regrow it to the same area on the allowed tiles off every band and off the
/// second lake's surroundings, from its seed (or, if a band took the seed, from its highest-valued tile still free),
/// then draw the routes the new shape needs; at most `rounds` times.
pub(super) fn keep_off_routes(
    b: &BaseContext<'_>,
    allow: &[u8],
    lakes: &mut [Lake],
    book: &mut routes::RouteBook,
    d: &Definition,
    fixed: &FixedLayout,
    rounds: usize,
) {
    for _ in 0..rounds {
        if !lakes[0]
            .set
            .iter()
            .zip(&book.band)
            .any(|(&v, &r)| v == 1 && r == 1)
        {
            return;
        }
        let mut open = match lakes.get(1) {
            Some(two) => off_limits(b.w, b.h, allow, two, d.lake_gap),
            None => allow.to_vec(),
        };
        for (v, &r) in open.iter_mut().zip(&book.band) {
            if r == 1 {
                *v = 0;
            }
        }
        let one = &lakes[0];
        let seed = if open[one.seed] == 1 {
            Some(one.seed)
        } else {
            (0..one.set.len())
                .filter(|&i| one.set[i] == 1 && open[i] == 1)
                .max_by_key(|&i| (one.val[i], core::cmp::Reverse(i)))
        };
        let Some(bigger) = seed.and_then(|s| grow(b, one.val.clone(), &open, s, one.area, d))
        else {
            return;
        };
        lakes[0] = bigger;
        book.ensure(b, lakes, d, fixed);
    }
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
