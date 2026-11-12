//! Stage 1: keep-clear mask and tall-prop corridors.
use crate::Rules;
use rh_sim::mapdata::{FeatureKind, GameMapData};

const TILE: f64 = 32.0;

pub fn keep_clear(map: &GameMapData, rules: &Rules) -> Vec<bool> {
    let (mw, mh) = (i64::from(map.w), i64::from(map.h));
    let mut out = vec![false; map.w as usize * map.h as usize];
    let k = &rules.keep_clear;
    for camp in &map.camps {
        // A hair over the exact reach so a boundary tile is never lost to rounding.
        let reach = camp.r + f64::from(k.camp_margin) * TILE + 1e-6;
        let reach2 = reach * reach;
        for ty in 0..mh {
            for tx in 0..mw {
                let dx = tx as f64 * TILE + 16.0 - camp.x;
                let dy = ty as f64 * TILE + 16.0 - camp.y;
                if dx * dx + dy * dy <= reach2 {
                    out[(ty * mw + tx) as usize] = true;
                }
            }
        }
    }
    for p in map
        .spawns
        .iter()
        .chain(&map.crate_spots)
        .chain(&map.ground_spots)
    {
        let (tx, ty) = ((p.x / TILE).floor() as i64, (p.y / TILE).floor() as i64);
        if (0..mw).contains(&tx) && (0..mh).contains(&ty) {
            out[(ty * mw + tx) as usize] = true;
        }
    }
    let m = i64::from(k.coliseum_margin);
    let mut mark_box = |x0: i64, y0: i64, x1: i64, y1: i64| {
        for y in y0.max(0)..=y1.min(mh - 1) {
            for x in x0.max(0)..=x1.min(mw - 1) {
                out[(y * mw + x) as usize] = true;
            }
        }
    };
    let r = map.coliseum.rect;
    mark_box(
        i64::from(r.x) - m,
        i64::from(r.y) - m,
        i64::from(r.x) + i64::from(r.w) - 1 + m,
        i64::from(r.y) + i64::from(r.h) - 1 + m,
    );
    for g in &map.coliseum.gates {
        for t in &g.tiles {
            mark_box(
                i64::from(t.x) - m,
                i64::from(t.y) - m,
                i64::from(t.x) + m,
                i64::from(t.y) + m,
            );
        }
    }
    for (i, slot) in out.iter_mut().enumerate() {
        let f = map.feature_grid.get(i).copied().unwrap_or(0) as usize;
        if f > 0
            && map
                .features
                .get(f - 1)
                .is_some_and(|f| f.kind == FeatureKind::Bush)
        {
            *slot = true;
        }
    }
    out
}

pub fn tall_corridor(map: &GameMapData, rules: &Rules) -> Vec<bool> {
    let (mw, mh) = (i64::from(map.w), i64::from(map.h));
    let mut out = vec![false; map.w as usize * map.h as usize];
    let half = f64::from(rules.keep_clear.corridor_width) * TILE / 2.0 + 1e-6;
    let half2 = half * half;
    for camp in &map.camps {
        let mut best: Option<(f64, f64, f64)> = None;
        for g in &map.coliseum.gates {
            let d = (g.x - camp.x) * (g.x - camp.x) + (g.y - camp.y) * (g.y - camp.y);
            if best.is_none_or(|(b, _, _)| d < b) {
                best = Some((d, g.x, g.y));
            }
        }
        let Some((len2, gx, gy)) = best else { continue };
        let (ex, ey) = (gx - camp.x, gy - camp.y);
        // Only tiles in the segment's bounding box grown by the half width can qualify.
        let pad = half + TILE;
        let x0 = (((camp.x.min(gx) - pad) / TILE).floor() as i64).max(0);
        let x1 = (((camp.x.max(gx) + pad) / TILE).floor() as i64).min(mw - 1);
        let y0 = (((camp.y.min(gy) - pad) / TILE).floor() as i64).max(0);
        let y1 = (((camp.y.max(gy) + pad) / TILE).floor() as i64).min(mh - 1);
        for ty in y0..=y1 {
            for tx in x0..=x1 {
                let (px, py) = (
                    tx as f64 * TILE + 16.0 - camp.x,
                    ty as f64 * TILE + 16.0 - camp.y,
                );
                let t = if len2 > 0.0 {
                    ((px * ex + py * ey) / len2).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let (qx, qy) = (px - ex * t, py - ey * t);
                if qx * qx + qy * qy <= half2 {
                    out[(ty * mw + tx) as usize] = true;
                }
            }
        }
    }
    out
}
