use super::*;
use crate::mapgen::landmarks::recipe_support::{js_round, Node};
use crate::mapgen::landmarks::recipes::direct_family::warren::Road;
use crate::mapgen::style_features::{disc_offsets, noise_q};
#[derive(Clone, Debug)]
pub(super) struct Site {
    pub road: Road,
    pub r4: i32,
    pub cx: i32,
    pub cy: i32,
    pub wet: i32,
    pub off2: f64,
    pub rock: Vec<i32>,
    pub crescent: Vec<i32>,
}
pub(super) struct Ground {
    seen: Vec<u8>,
    pub core: Vec<u8>,
    corridor: Vec<u8>,
    camps: Vec<(f64, f64, f64)>,
    members: Vec<(i32, i32)>,
    mark: Vec<u8>,
}
impl Ground {
    pub fn new(
        c: &ShapeContext<'_, '_>,
        corridor: Vec<u8>,
        has_members: bool,
        d: &Definition<'_>,
    ) -> Self {
        let b = c.base();
        let bb = b.zone.bbox;
        let core = if has_members {
            core_of(&corridor, bb, b.w, b.h)
        } else {
            vec![0; b.w * b.h]
        };
        let camps = b
            .camps
            .iter()
            .filter(|k| {
                k.x >= bb.x - d.camp_window
                    && k.x <= bb.x + bb.w as i32 + d.camp_window
                    && k.y >= bb.y - d.camp_window
                    && k.y <= bb.y + bb.h as i32 + d.camp_window
            })
            .map(|k| {
                (
                    k.x as f64,
                    k.y as f64,
                    (k.r + d.bog_camp_gap) * (k.r + d.bog_camp_gap),
                )
            })
            .collect();
        let members = b
            .spawns
            .iter()
            .map(|&i| (i % b.w as i32, i / b.w as i32))
            .collect();
        Self {
            seen: vec![0; b.w * b.h],
            core,
            corridor,
            camps,
            members,
            mark: vec![0; b.w * b.h],
        }
    }
    fn free_at(&mut self, c: &ShapeContext<'_, '_>, i: usize) -> bool {
        if self.seen[i] == 0 {
            self.seen[i] = if c.open(i as i32) { 1 } else { 2 }
        }
        self.seen[i] == 1
    }
    fn bog_at(&mut self, c: &ShapeContext<'_, '_>, i: usize) -> bool {
        if self.corridor[i] == 1 || !self.free_at(c, i) {
            return false;
        }
        let w = c.base().w;
        let (x, y) = ((i % w) as f64, (i / w) as f64);
        !self.camps.iter().any(|&(kx, ky, r2)| {
            let (ex, ey) = (kx - x, ky - y);
            ex * ex + ey * ey <= r2
        })
    }
    pub fn take(&mut self, site: &Site) {
        for &i in site.rock.iter().chain(&site.crescent) {
            self.seen[i as usize] = 2
        }
    }
}
pub(super) fn core_of(
    corridor: &[u8],
    bb: crate::mapdata::TileRect,
    w: usize,
    h: usize,
) -> Vec<u8> {
    let mut core = vec![0; corridor.len()];
    for y in 1.max(bb.y)..(h as i32 - 1).min(bb.y + bb.h as i32) {
        for x in 1.max(bb.x)..(w as i32 - 1).min(bb.x + bb.w as i32) {
            let i = y as usize * w + x as usize;
            if corridor[i] == 1
                && [
                    i - 1,
                    i + 1,
                    i - w,
                    i + w,
                    i - w - 1,
                    i - w + 1,
                    i + w - 1,
                    i + w + 1,
                ]
                .into_iter()
                .map(|j| u32::from(corridor[j]))
                .sum::<u32>()
                    == 8
            {
                core[i] = 1
            }
        }
    }
    core
}
// Preserve the source helper argument roles for parity auditing.
#[allow(clippy::too_many_arguments)]
fn rock_scan(
    c: &ShapeContext<'_, '_>,
    jit: &mut [i8],
    cx: i32,
    cy: i32,
    r4: i32,
    k: usize,
    mut keys: Option<&mut Vec<f64>>,
    core: Option<&[u8]>,
    limit: usize,
    d: &Definition<'_>,
) -> usize {
    let b = c.base();
    let reach = ((r4 + 3) as f64 / 4.0).ceil() as i32;
    let mut hits = 0;
    for y in cy - reach..=cy + reach {
        if y < 0 || y >= b.h as i32 {
            continue;
        }
        for x in cx - reach..=cx + reach {
            if x < 0 || x >= b.w as i32 {
                continue;
            }
            let i = y as usize * b.w + x as usize;
            let (ex, ey) = ((x - cx) as f64, (y - cy) as f64);
            let mut jv = jit[i];
            if jv == i8::MIN {
                jv = (js_round(
                    ((noise_q(
                        &c.streams.noise,
                        x as f64,
                        y as f64,
                        d.jitter_cell,
                        d.jitter_salt + k as f64,
                    ) - 512.0)
                        * d.jitter_scale)
                        / d.jitter_divisor,
                ) as i32) as i8;
                jit[i] = jv
            }
            let rr = r4 + i32::from(jv);
            if rr <= 0 || 16.0 * (ex * ex + ey * ey) > (rr * rr) as f64 {
                continue;
            }
            if core.is_some_and(|core| core[i] == 1) {
                hits += 1;
                if hits > limit {
                    return hits;
                }
            }
            if let Some(keys) = keys.as_mut() {
                keys.push((ex * ex + ey * ey) * 1048576.0 + i as f64)
            }
        }
    }
    hits
}
// Preserve the source helper argument roles for parity auditing.
#[allow(clippy::too_many_arguments)]
fn clips_within(
    c: &ShapeContext<'_, '_>,
    jit: &mut [i8],
    core: &[u8],
    cx: i32,
    cy: i32,
    r4: i32,
    k: usize,
    limit: usize,
    d: &Definition<'_>,
) -> bool {
    let b = c.base();
    let count = |r| {
        disc_offsets(r)
            .iter()
            .filter(|&&[dx, dy]| {
                let (x, y) = (cx + dx, cy + dy);
                x >= 0
                    && y >= 0
                    && x < b.w as i32
                    && y < b.h as i32
                    && core[y as usize * b.w + x as usize] == 1
            })
            .count()
    };
    if count(r4 - 3) > limit {
        return false;
    }
    count(r4 + 3) <= limit || rock_scan(c, jit, cx, cy, r4, k, None, Some(core), limit, d) <= limit
}
fn rock_of(
    c: &ShapeContext<'_, '_>,
    jit: &mut [i8],
    cx: i32,
    cy: i32,
    r4: i32,
    k: usize,
    d: &Definition<'_>,
) -> Vec<i32> {
    let mut keys = Vec::new();
    rock_scan(c, jit, cx, cy, r4, k, Some(&mut keys), None, 0, d);
    keys.sort_by(f64::total_cmp);
    keys.into_iter().map(|v| (v % 1048576.0) as i32).collect()
}
// Preserve the source helper argument roles for parity auditing.
#[allow(clippy::too_many_arguments)]
fn crescent_of(
    g: &mut Ground,
    c: &ShapeContext<'_, '_>,
    cx: i32,
    cy: i32,
    r4: i32,
    ux: f64,
    uy: f64,
    wet: i32,
    d: &Definition<'_>,
) -> Vec<i32> {
    let b = c.base();
    let u2 = ux * ux + uy * uy;
    let (lo, hi) = (
        (5 * r4 + d.crescent_inner20) as f64,
        (5 * r4 + d.crescent_outer20) as f64,
    );
    let along_max = (r4 + d.crescent_along4) as f64;
    let reach = ((r4 as f64 + d.crescent_outer20 as f64 / 5.0) / 4.0).ceil() as i32;
    let mut raw = Vec::new();
    for y in cy - reach..=cy + reach {
        for x in cx - reach..=cx + reach {
            let i = b.at(x, y);
            if i < 0 {
                continue;
            }
            let (ex, ey) = ((x - cx) as f64, (y - cy) as f64);
            let d400 = 400.0 * (ex * ex + ey * ey);
            if d400 < lo * lo || d400 > hi * hi {
                continue;
            }
            let side = wet as f64 * (ey * ux - ex * uy);
            if side < 0.0 || side * side < u2 {
                continue;
            }
            let along = ex * ux + ey * uy;
            if 16.0 * along * along > along_max * along_max * u2 {
                continue;
            }
            if g.bog_at(c, i as usize) {
                raw.push(i)
            }
        }
    }
    for &i in &raw {
        g.mark[i as usize] = 1
    }
    let mut out = Vec::new();
    for &s in &raw {
        if g.mark[s as usize] != 1 {
            continue;
        }
        let mut piece = vec![s];
        g.mark[s as usize] = 2;
        let mut q = 0;
        while q < piece.len() {
            let i = piece[q];
            q += 1;
            for j in [i - 1, i + 1, i - b.w as i32, i + b.w as i32] {
                if j >= 0 && (j as usize) < g.mark.len() && g.mark[j as usize] == 1 {
                    g.mark[j as usize] = 2;
                    piece.push(j)
                }
            }
        }
        if piece.len() >= d.bog_min_piece {
            out.extend(piece)
        }
    }
    for &i in &raw {
        g.mark[i as usize] = 0
    }
    out
}
#[derive(Clone)]
struct Candidate {
    score: i32,
    order: usize,
    cx: i32,
    cy: i32,
}
// Preserve the source helper argument roles for parity auditing.
#[allow(clippy::too_many_arguments)]
fn candidates_for(
    g: &mut Ground,
    c: &ShapeContext<'_, '_>,
    road: &Road,
    nodes: &[Node],
    r4: i32,
    pad_a: f64,
    pad_b: f64,
    d: &Definition<'_>,
) -> Vec<Candidate> {
    let b = c.base();
    let a = &nodes[road.a];
    let disc = disc_offsets(r4);
    let count = disc.len() as f64;
    let mut out = Vec::new();
    let mut order = 0;
    for &tp in d.t_permille {
        let fits = road.len * tp as f64 / 100.0 >= pad_a + 2.5 * r4 as f64
            && road.len * (1000 - tp) as f64 / 100.0 >= pad_b + 2.5 * r4 as f64;
        for &off in d.across {
            order += 1;
            if !fits {
                continue;
            }
            let cx = js_round(a.x + road.dx * tp as f64 / 1000.0 - road.dy * off as f64 / road.len)
                as i32;
            let cy = js_round(a.y + road.dy * tp as f64 / 1000.0 + road.dx * off as f64 / road.len)
                as i32;
            if g.members.iter().any(|&(x, y)| {
                16.0 * ((x - cx) as f64 * (x - cx) as f64 + (y - cy) as f64 * (y - cy) as f64)
                    <= ((r4 + d.member_gap4) * (r4 + d.member_gap4)) as f64
            }) {
                continue;
            }
            let penalty = d.score_across * off.abs() + ((tp - 500).abs() / d.score_along_divisor);
            let need = (((d.accept_permille + penalty) as f64 * count) / 1000.0).ceil() as i32;
            let (mut spare, mut ok) = (disc.len() as i32 - need, 0);
            for &[dx, dy] in &disc {
                let (x, y) = (cx + dx, cy + dy);
                if x >= 0
                    && y >= 0
                    && x < b.w as i32
                    && y < b.h as i32
                    && g.free_at(c, y as usize * b.w + x as usize)
                {
                    ok += 1
                } else {
                    spare -= 1;
                    if spare < 0 {
                        break;
                    }
                }
            }
            if spare < 0 {
                continue;
            }
            let score = (1000.0 * ok as f64 / count).floor() as i32 - penalty;
            if score >= d.accept_permille {
                out.push(Candidate {
                    score,
                    order,
                    cx,
                    cy,
                })
            }
        }
    }
    out.sort_by(|p, q| q.score.cmp(&p.score).then_with(|| p.order.cmp(&q.order)));
    out
}
pub(super) fn site_of(
    g: &mut Ground,
    c: &ShapeContext<'_, '_>,
    road: &Road,
    nodes: &[Node],
    k: usize,
    crescents: bool,
    d: &Definition<'_>,
) -> Option<Site> {
    use crate::mapgen::landmarks::recipe_support::NodeKind;
    let pad = |n: &Node| {
        if n.kind == NodeKind::Door {
            d.pad_door10
        } else {
            d.pad_camp10
        }
    };
    let (pad_a, pad_b) = (pad(&nodes[road.a]), pad(&nodes[road.b]));
    let mut radii = Vec::new();
    let mut r4 = d
        .r4_min
        .max(d.r4_max.min((d.radius_length * road.len).floor() as i32));
    while r4 >= d.r4_min {
        let need = pad_a + pad_b + 5.0 * r4 as f64;
        if need * need <= 100.0 * road.d2 {
            radii.push(r4)
        }
        r4 -= d.radius_shrink
    }
    if radii.is_empty() {
        return None;
    }
    let mut lists = vec![None; radii.len()];
    let mut jit = vec![i8::MIN; c.base().w * c.base().h];
    let passes = if d.clip_max > 0 {
        vec![0, d.clip_max]
    } else {
        vec![0]
    };
    for clip_max in passes {
        for (q, &r4) in radii.iter().enumerate() {
            if lists[q].is_none() {
                lists[q] = Some(candidates_for(g, c, road, nodes, r4, pad_a, pad_b, d))
            }
            for cand in lists[q].as_ref().unwrap() {
                if !clips_within(c, &mut jit, &g.core, cand.cx, cand.cy, r4, k, clip_max, d) {
                    continue;
                }
                let mut wet = if noise_q(
                    &c.streams.noise,
                    cand.cx as f64,
                    cand.cy as f64,
                    d.wet_cell,
                    d.wet_salt,
                ) < d.wet_threshold
                {
                    1
                } else {
                    -1
                };
                // Signature mode (P-LAND-PLAGUE-1) lays no crescent: the bog is the free pools, and the wet side stays
                // the noise coin.
                let mut crescent = Vec::new();
                if crescents {
                    crescent = crescent_of(g, c, cand.cx, cand.cy, r4, road.dx, road.dy, wet, d);
                    let other = crescent_of(g, c, cand.cx, cand.cy, r4, road.dx, road.dy, -wet, d);
                    if other.len() > crescent.len() {
                        crescent = other;
                        wet = -wet
                    }
                }
                let cross = (cand.cx as f64 - nodes[road.a].x) * road.dy
                    - (cand.cy as f64 - nodes[road.a].y) * road.dx;
                return Some(Site {
                    road: road.clone(),
                    r4,
                    cx: cand.cx,
                    cy: cand.cy,
                    wet,
                    off2: cross * cross / road.d2,
                    rock: rock_of(c, &mut jit, cand.cx, cand.cy, r4, k, d),
                    crescent,
                });
            }
        }
    }
    None
}
pub(super) fn in_slot(site: &Site, i: i32, w: usize, d: &Definition<'_>) -> bool {
    let (ex, ey) = (
        (i % w as i32 - site.cx) as f64,
        (i / w as i32 - site.cy) as f64,
    );
    let cross = ex * site.road.dy - ey * site.road.dx;
    16.0 * cross * cross < d.slot_width_squared * site.road.d2
}
