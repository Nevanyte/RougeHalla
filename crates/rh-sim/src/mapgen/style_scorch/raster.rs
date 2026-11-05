use super::*;
pub(super) type Beam = [f64; 2];
fn ring(cb: &Callbacks<'_>, r4: i32) -> Vec<(i32, i32, f64, f64)> {
    let reach =
        (cb.forge.radius_elite_max4 / 4.0 + cb.definition.crater.raster_padding).ceil() as i32 + 1;
    let r = r4 as f64 / 4.0;
    let (lo, hi) = ((r - 0.5) * (r - 0.5), (r + 0.5) * (r + 0.5));
    let mut out = vec![];
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            let d2 = f64::from(dx * dx + dy * dy);
            if d2 >= lo && d2 < hi {
                out.push((
                    dx,
                    dy,
                    crate::math::sqrt(d2),
                    kit::pseudo_angle(dx as f64, dy as f64),
                ));
            }
        }
    }
    out
}
pub(super) fn blocked(
    cb: &Callbacks<'_>,
    c: &ShapeContext<'_, '_>,
    camp: &CampInfo,
    r4: i32,
) -> i32 {
    let ring = ring(cb, r4);
    let b = c.base();
    let bad = ring
        .iter()
        .filter(|&&(dx, dy, _, _)| {
            let i = b.at(camp.x + dx, camp.y + dy);
            i < 0 || b.mask[i as usize] == 0 || !c.open(i)
        })
        .count();
    if ring.is_empty() {
        1000
    } else {
        ((bad * 1000) as f64 / ring.len() as f64).floor() as i32
    }
}
pub(super) fn frontier(
    cb: &Callbacks<'_>,
    c: &ShapeContext<'_, '_>,
    camp: &CampInfo,
    r4: i32,
) -> (usize, i32, i32) {
    let b = c.base();
    let (mut count, mut sx, mut sy) = (0, 0, 0);
    for (dx, dy, _, _) in ring(cb, r4) {
        let i = b.at(camp.x + dx, camp.y + dy);
        if i < 0
            || b.mask[i as usize] == 0
            || b.edge_dist[i as usize] < cb.definition.crater.frontier_edge
        {
            count += 1;
            sx += dx;
            sy += dy;
        }
    }
    (count, sx, sy)
}
pub(super) fn bowl(
    cb: &Callbacks<'_>,
    c: &ShapeContext<'_, '_>,
    camp: &CampInfo,
    r4: i32,
) -> Vec<i32> {
    let b = c.base();
    let reach =
        (cb.forge.radius_elite_max4 / 4.0 + cb.definition.crater.raster_padding).ceil() as i32 + 1;
    let radius = r4 as f64 / 4.0 - 0.5;
    let lim = radius * radius;
    let mut out = vec![];
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            if f64::from(dx * dx + dy * dy) >= lim {
                continue;
            }
            let i = b.at(camp.x + dx, camp.y + dy);
            if i >= 0 && b.mask[i as usize] != 0 {
                out.push(i);
            }
        }
    }
    out
}
pub(super) fn rim(
    cb: &Callbacks<'_>,
    c: &ShapeContext<'_, '_>,
    camp: &CampInfo,
    k: usize,
    r4: i32,
    beams: &[Beam],
) -> Vec<i32> {
    let d = &cb.definition.crater;
    let b = c.base();
    let r = r4 as f64 / 4.0;
    let pa0 = beams.first().map_or(0.0, |v| kit::pseudo_angle(v[0], v[1]));
    let mut ring = ring(cb, r4);
    ring.sort_by(|a, b| {
        ((a.3 - pa0 + 4.0) % 4.0)
            .total_cmp(&((b.3 - pa0 + 4.0) % 4.0))
            .then(a.1.cmp(&b.1))
            .then(a.0.cmp(&b.0))
    });
    let mut out = vec![];
    let mut seen = vec![false; b.w * b.h];
    let mut put = |x, y| {
        let i = b.at(x, y);
        if i >= 0 && !seen[i as usize] {
            seen[i as usize] = true;
            out.push(i);
        }
    };
    let (mut px, mut py, mut prev) = (0, 0, -2_i32);
    for (q, &(dx, dy, dist, _)) in ring.iter().enumerate() {
        if beams
            .iter()
            .any(|v| kit::in_beam(dx as f64, dy as f64, v[0], v[1], d.breach_half4))
        {
            prev = -2;
            continue;
        }
        let jitter = ((kit::noise_q(
            &c.streams.noise,
            q as f64,
            0.0,
            d.jitter_cell,
            d.jitter_salt + k as f64,
        ) - 512.0)
            * d.jitter_strength)
            / 512.0;
        let f = (r + jitter) / dist;
        let (rx, ry) = (
            camp.x + (dx as f64 * f + 0.5).floor() as i32,
            camp.y + (dy as f64 * f + 0.5).floor() as i32,
        );
        if prev == q as i32 - 1 && ((rx - px).abs() > 1 || (ry - py).abs() > 1) {
            let n = (rx - px).abs().max((ry - py).abs());
            for s in 1..n {
                put(
                    px + ((2 * (rx - px) * s + n) as f64 / (2 * n) as f64).floor() as i32,
                    py + ((2 * (ry - py) * s + n) as f64 / (2 * n) as f64).floor() as i32,
                );
            }
        }
        put(rx, ry);
        if kit::noise_q(
            &c.streams.noise,
            rx as f64,
            ry as f64,
            d.second_cell,
            d.second_salt + k as f64,
        ) > d.second_tile_q
        {
            put(
                camp.x + (dx as f64 * ((r + jitter + 1.0) / dist) + 0.5).floor() as i32,
                camp.y + (dy as f64 * ((r + jitter + 1.0) / dist) + 0.5).floor() as i32,
            );
        }
        px = rx;
        py = ry;
        prev = q as i32;
    }
    out.into_iter()
        .filter(|&i| {
            b.mask[i as usize] != 0
                && c.open(i)
                && !beams.iter().any(|v| {
                    kit::in_beam(
                        (i % b.w as i32 - camp.x) as f64,
                        (i / b.w as i32 - camp.y) as f64,
                        v[0],
                        v[1],
                        d.breach_half4,
                    )
                })
        })
        .collect()
}
/// Membership-only result from the accepted component helper; original rim order is preserved.
pub(super) fn keep_arcs(tiles: Vec<i32>, w: usize, min: usize) -> Vec<i32> {
    if tiles.len() < min {
        return vec![];
    }
    let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, 0, 0);
    for &t in &tiles {
        let (x, y) = (t % w as i32, t / w as i32);
        x0 = x0.min(x);
        y0 = y0.min(y);
        x1 = x1.max(x);
        y1 = y1.max(y);
    }
    let (bw, bh) = ((x1 - x0 + 1) as usize, (y1 - y0 + 1) as usize);
    let local = |t: i32| (t / w as i32 - y0) as usize * bw + (t % w as i32 - x0) as usize;
    let mut mask = vec![0; bw * bh];
    for &t in &tiles {
        mask[local(t)] = 1;
    }
    kit::prune_small(&mut mask, bw, bh, min, true);
    tiles.into_iter().filter(|&t| mask[local(t)] == 1).collect()
}
pub(super) fn band_connected(
    c: &ShapeContext<'_, '_>,
    band: &[i32],
    walls: &[i32],
    d: &CraterRules,
) -> bool {
    if band.len() < d.band_min {
        return true;
    }
    let b = c.base();
    let mut mask = vec![0; b.w * b.h];
    for &i in band {
        if b.tiles[i as usize] == TILE_FLOOR {
            mask[i as usize] = 1;
        }
    }
    for &i in walls {
        mask[i as usize] = 0;
    }
    if mask[band[0] as usize] == 0 {
        return false;
    }
    let components = kit::components_of(&mask, b.w, b.h, false);
    let target = components.label[band[0] as usize];
    band[band.len() - d.band_end_samples..]
        .iter()
        .any(|&i| components.label[i as usize] == target)
}
