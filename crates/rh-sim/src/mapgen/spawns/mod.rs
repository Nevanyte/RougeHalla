//! Exact stage-5 spawn preparation/picking and pure final walk-gate decisions.
//! Real landmark state is an input, not generated or replaced here. Grids have W*H cells.
mod rules;
use crate::mapgen::coliseum::{FixedDefinition, FixedLayout, TileRect, CX, CY, H, W};
use crate::mapgen::grid_topology::{segment_blocked, walk_field16};
use crate::mapgen::zones::camps::{CampContext, CampDefinition, CampSite};
use crate::mapgen::zones::{ZoneContext, ZoneDefinition};
pub use rules::{default_definition, visit_content, SpawnDefinition, DEFAULT_DEFINITION};

pub struct SpawnContext<'f> {
    fixed: &'f FixedLayout,
    rules: SpawnDefinition,
    ring_road: u8,
    clearing: Vec<i32>,
    halo: Vec<i32>,
}
impl<'f> SpawnContext<'f> {
    pub fn new(fixed: &'f FixedLayout) -> Self {
        Self::from_definitions(
            fixed,
            &default_definition(),
            &crate::mapgen::coliseum::default_definition(),
            &crate::mapgen::zones::default_definition(),
            &crate::mapgen::zones::camps::default_definition(),
        )
    }
    /// Definitions and fixed geometry must correspond; all are trusted bounded rule data.
    pub fn from_definitions(
        fixed: &'f FixedLayout,
        rules: &SpawnDefinition,
        coliseum: &FixedDefinition<'_>,
        zones: &ZoneDefinition,
        camps: &CampDefinition,
    ) -> Self {
        assert!(rules.scan_margin < W.min(H) / 2 && rules.corner_open < W.min(H));
        assert!(rules.camp_pick >= 0 && rules.camp_pick < W.min(H) as i32);
        assert!(
            rules.quantile_denominator > 0
                && rules.quantile_first <= rules.quantile_last
                && rules.quantile_last <= rules.quantile_denominator
        );
        assert!(rules.pool_min >= 2);
        assert!([
            rules.separation,
            rules.safe_separation,
            rules.ring_lo,
            rules.ring_hi,
            rules.pick_band,
            rules.walk_ratio_max
        ]
        .iter()
        .all(|v| v.is_finite() && *v >= 0.0));
        let z = ZoneContext::from_definition(fixed, zones);
        let c = CampContext::from_definition(&z, camps);
        Self {
            fixed,
            rules: *rules,
            ring_road: coliseum.ring_road,
            clearing: z.clearing_offsets().to_vec(),
            halo: c.halo_offsets().to_vec(),
        }
    }
    pub fn landmark_masks(&self, buildings: &[TileRect]) -> LandmarkMasks {
        let mut out = LandmarkMasks {
            boxes: vec![0; W * H],
            near1: vec![0; W * H],
        };
        for &building in buildings {
            mark_rect(&mut out.boxes, building, 0);
            mark_rect(&mut out.near1, building, self.rules.landmark_box_margin);
        }
        out
    }
    pub fn pool_masks(&self, pool: &[usize]) -> PoolProtection {
        let mut out = PoolProtection {
            halo: vec![0; W * H],
            pool5: vec![0; W * H],
        };
        for &tile in pool {
            mark_rect(&mut out.halo, cell(tile), self.rules.pool_halo_margin);
            mark_rect(&mut out.pool5, cell(tile), self.rules.pool5_margin);
        }
        out
    }
    pub fn landmark_protect(&self, camps: &[CampSite]) -> Vec<u8> {
        let mut protect = vec![0; W * H];
        for (i, p) in protect.iter_mut().enumerate() {
            if self.fixed.border[i] != 0
                || self.fixed.fp[i] != 0
                || u16::from(self.fixed.dist_fp[i])
                    <= u16::from(self.ring_road) + u16::from(self.rules.landmark_road_margin)
            {
                *p = 1;
            }
        }
        for t in &self.fixed.lane_out {
            mark_rect(
                &mut protect,
                TileRect {
                    x: t.x,
                    y: t.y,
                    w: 1,
                    h: 1,
                },
                self.rules.landmark_lane_margin,
            );
        }
        for c in camps {
            for &off in &self.clearing {
                mark_rect(
                    &mut protect,
                    cell((c.site as i32 + off) as usize),
                    self.rules.landmark_clearing_margin,
                );
            }
        }
        self.mark_corners(&mut protect);
        protect
    }
    pub fn style_protect(
        &self,
        camps: &[CampSite],
        landmark_near1: &[u8],
        feature_owner: &[u16],
        pool_halo: &[u8],
    ) -> Vec<u8> {
        let mut protect = vec![0; W * H];
        for (i, p) in protect.iter_mut().enumerate() {
            if self.fixed.border[i] != 0
                || self.fixed.fp[i] != 0
                || u16::from(self.fixed.dist_fp[i])
                    <= u16::from(self.ring_road) + u16::from(self.rules.style_road_margin)
                || (landmark_near1[i] != 0 && feature_owner[i] == 0)
                || pool_halo[i] != 0
            {
                *p = 1;
            }
        }
        for t in &self.fixed.lane_out {
            mark_rect(
                &mut protect,
                TileRect {
                    x: t.x,
                    y: t.y,
                    w: 1,
                    h: 1,
                },
                self.rules.style_lane_margin,
            );
        }
        for c in camps {
            for &off in &self.halo {
                if let Some(p) = protect.get_mut((c.site as i32 + off) as usize) {
                    *p = 1;
                }
            }
        }
        self.mark_corners(&mut protect);
        protect
    }
    fn mark_corners(&self, grid: &mut [u8]) {
        for y in 1..=self.rules.corner_open {
            for x in 1..=self.rules.corner_open {
                for (cx, cy) in [
                    (x, y),
                    (W - 1 - x, y),
                    (x, H - 1 - y),
                    (W - 1 - x, H - 1 - y),
                ] {
                    grid[cy * W + cx] = 1;
                }
            }
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LandmarkMasks {
    pub boxes: Vec<u8>,
    pub near1: Vec<u8>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolProtection {
    pub halo: Vec<u8>,
    pub pool5: Vec<u8>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnPreparation {
    pub centre_walk: Vec<i32>,
    pub open3: Vec<u8>,
}
pub struct PoolInput<'a> {
    pub tiles: &'a [u8],
    pub zone: &'a [u8],
    pub landmark_near1: &'a [u8],
    pub camps: &'a [CampSite],
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PickedPool {
    pub pool: Vec<usize>,
    pub preparation: SpawnPreparation,
    pub protection: PoolProtection,
}
fn cell(tile: usize) -> TileRect {
    TileRect {
        x: (tile % W) as i32,
        y: (tile / W) as i32,
        w: 1,
        h: 1,
    }
}
/// The original clipped rect primitive; negative/empty rectangles follow the same inclusive bounds.
pub fn mark_rect(grid: &mut [u8], rect: TileRect, margin: i32) {
    let x0 = 0i64.max(i64::from(rect.x) - i64::from(margin));
    let x1 = (W as i64 - 1).min(i64::from(rect.x) + i64::from(rect.w) - 1 + i64::from(margin));
    let y0 = 0i64.max(i64::from(rect.y) - i64::from(margin));
    let y1 = (H as i64 - 1).min(i64::from(rect.y) + i64::from(rect.h) - 1 + i64::from(margin));
    for y in y0..=y1 {
        for x in x0..=x1 {
            grid[y as usize * W + x as usize] = 1;
        }
    }
}
pub fn prepare(tiles: &[u8]) -> SpawnPreparation {
    let centre_walk = walk_field16(tiles, W, H, &[CY * W as i32 + CX], None, None);
    let mut row3 = vec![0u8; W * H];
    let mut open3 = vec![0; W * H];
    for y in 0..H {
        for x in 1..W - 1 {
            let i = y * W + x;
            if tiles[i - 1] == 0 && tiles[i] == 0 && tiles[i + 1] == 0 {
                row3[i] = 1;
            }
        }
    }
    for i in W..W * H - W {
        if row3[i - W] != 0 && row3[i] != 0 && row3[i + W] != 0 {
            open3[i] = 1;
        }
    }
    SpawnPreparation { centre_walk, open3 }
}
fn d2(a: usize, b: usize) -> i32 {
    let dx = (a % W) as i32 - (b % W) as i32;
    let dy = (a / W) as i32 - (b / W) as i32;
    dx * dx + dy * dy
}
fn zone_count(pool: &[usize], zone: &[u8]) -> usize {
    let mut seen = [false; 256];
    for &t in pool {
        seen[zone[t] as usize] = true;
    }
    seen.iter().filter(|&&v| v).count()
}
pub fn pick_spawn_pool(
    context: &SpawnContext<'_>,
    input: &PoolInput<'_>,
    preparation: &SpawnPreparation,
    rng: &mut impl FnMut() -> f64,
) -> Option<Vec<usize>> {
    let d = &context.rules;
    let r0 = W.min(H) as f64 / 2.0;
    let lo = d.ring_lo * r0;
    let hi = d.ring_hi * r0;
    let (lo2, hi2) = (lo * lo, hi * hi);
    let mut near_camp = vec![0u8; W * H];
    for camp in input.camps {
        let cx = (camp.site % W) as i32;
        let cy = (camp.site / W) as i32;
        for dy in -d.camp_pick + 1..d.camp_pick {
            for dx in -d.camp_pick + 1..d.camp_pick {
                let (x, y) = (cx + dx, cy + dy);
                if dx * dx + dy * dy < d.camp_pick * d.camp_pick
                    && x >= 0
                    && y >= 0
                    && x < W as i32
                    && y < H as i32
                {
                    near_camp[y as usize * W + x as usize] = 1;
                }
            }
        }
    }
    let mut candidates = Vec::new();
    for y in d.scan_margin..H - d.scan_margin {
        for x in d.scan_margin..W - d.scan_margin {
            let i = y * W + x;
            if input.zone[i] == 0
                || preparation.open3[i] == 0
                || input.landmark_near1[i] != 0
                || preparation.centre_walk[i] < 0
                || near_camp[i] != 0
            {
                continue;
            }
            let dx = x as f64 + 0.5 - f64::from(CX);
            let dy = y as f64 + 0.5 - f64::from(CY);
            let r2 = dx * dx + dy * dy;
            if r2 >= lo2 && r2 <= hi2 {
                candidates.push(i);
            }
        }
    }
    if candidates.is_empty() {
        return None;
    }
    let mut walks: Vec<i32> = candidates
        .iter()
        .map(|&t| preparation.centre_walk[t])
        .collect();
    walks.sort();
    let safe2 = d.safe_separation * d.safe_separation;
    let sep2 = d.separation * d.separation;
    let admissible = |a: usize, b: usize| {
        let distance = f64::from(d2(a, b));
        if distance >= safe2 {
            true
        } else if distance < sep2 {
            false
        } else {
            segment_blocked(
                input.tiles,
                W,
                H,
                (a % W) as i32,
                (a / W) as i32,
                (b % W) as i32,
                (b / W) as i32,
                crate::map::MASK_SIGHT,
            )
        }
    };
    let mut bands = Vec::new();
    for quantile in d.quantile_first..=d.quantile_last {
        let level = f64::from(walks[((walks.len() - 1) * quantile) / d.quantile_denominator]);
        let low = level * (1.0 - d.pick_band);
        let high = level * (1.0 + d.pick_band);
        bands.push(
            candidates
                .iter()
                .copied()
                .filter(|&i| {
                    f64::from(preparation.centre_walk[i]) >= low
                        && f64::from(preparation.centre_walk[i]) <= high
                })
                .collect::<Vec<_>>(),
        );
    }
    let mut pool = Vec::new();
    let mut best_score = None;
    for _ in 0..d.tries {
        for band in &bands {
            if band.is_empty() {
                continue;
            }
            let mut chosen = vec![band[(rng() * band.len() as f64).floor() as usize]];
            let mut min_distance: Vec<i32> = band.iter().map(|&t| d2(t, chosen[0])).collect();
            let mut ok: Vec<bool> = band.iter().map(|&t| admissible(t, chosen[0])).collect();
            while chosen.len() < d.pick_target {
                let mut best = None;
                let mut distance = -1;
                for q in 0..band.len() {
                    if ok[q] && min_distance[q] > distance {
                        distance = min_distance[q];
                        best = Some(q);
                    }
                }
                let Some(best) = best else {
                    break;
                };
                let member = band[best];
                chosen.push(member);
                for q in 0..band.len() {
                    let distance = d2(band[q], member);
                    min_distance[q] = min_distance[q].min(distance);
                    if ok[q] && f64::from(distance) < safe2 && !admissible(band[q], member) {
                        ok[q] = false;
                    }
                }
            }
            let score = chosen.len() * d.score_weight + zone_count(&chosen, input.zone);
            if best_score.is_none_or(|old| score > old) {
                best_score = Some(score);
                pool = chosen;
            }
        }
        if pool.len() >= d.pool_min + d.early_extra && zone_count(&pool, input.zone) >= d.pool_zones
        {
            break;
        }
    }
    if pool.len() < d.pool_min || zone_count(&pool, input.zone) < d.pool_zones {
        None
    } else {
        Some(pool)
    }
}
pub fn prepare_and_pick(
    context: &SpawnContext<'_>,
    input: &PoolInput<'_>,
    rng: &mut impl FnMut() -> f64,
) -> Option<PickedPool> {
    let preparation = prepare(input.tiles);
    let pool = pick_spawn_pool(context, input, &preparation, rng)?;
    let protection = context.pool_masks(&pool);
    Some(PickedPool {
        pool,
        preparation,
        protection,
    })
}
/// Keeps INPUT indices in pick order. It does not mutate the original pool or any protection mask.
/// Walks are finite nonnegative measured lengths; input arrays have matching lengths.
pub fn gate_spawn_walks(
    definition: &SpawnDefinition,
    pool: &[usize],
    walks: &[f64],
    hazards: &[u32],
    zone_of: impl Fn(usize) -> u8,
) -> Option<Vec<usize>> {
    let mut keep: Vec<usize> = (0..pool.len())
        .filter(|&k| hazards[k] <= definition.hazard_walk_max)
        .collect();
    loop {
        if keep.is_empty() {
            return None;
        }
        let mut sorted = keep.clone();
        sorted.sort_by(|&a, &b| {
            walks[a]
                .partial_cmp(&walks[b])
                .expect("finite measured walks")
                .then(pool[a].cmp(&pool[b]))
        });
        let min = walks[sorted[0]];
        let max = walks[sorted[sorted.len() - 1]];
        if max <= definition.walk_ratio_max * min {
            break;
        }
        if keep.len() <= definition.pool_min {
            return None;
        }
        let longest = sorted[sorted.len() - 1];
        let mut shortest = sorted[0];
        for &k in sorted.iter().skip(1) {
            if walks[k] != min {
                break;
            }
            shortest = k;
        }
        let without_longest = walks[sorted[sorted.len() - 2]] / min;
        let second_shortest = walks[if sorted[0] == shortest {
            sorted[1]
        } else {
            sorted[0]
        }];
        let without_shortest = max / second_shortest;
        let drop = if without_longest <= without_shortest {
            longest
        } else {
            shortest
        };
        keep.retain(|&k| k != drop);
    }
    let mut zones = [false; 256];
    for &k in &keep {
        zones[zone_of(pool[k]) as usize] = true;
    }
    if keep.len() < definition.pool_min
        || zones.iter().filter(|&&v| v).count() < definition.pool_zones
    {
        None
    } else {
        Some(keep)
    }
}
/// Integer supercover in the real gate's visit order; callback true stops immediately.
pub fn walk_segment(
    ax: i32,
    ay: i32,
    bx: i32,
    by: i32,
    mut visit: impl FnMut(i32, i32) -> bool,
) -> bool {
    let nx = (i64::from(bx) - i64::from(ax)).abs();
    let ny = (i64::from(by) - i64::from(ay)).abs();
    let sx = if bx > ax { 1 } else { -1 };
    let sy = if by > ay { 1 } else { -1 };
    let (mut x, mut y) = (ax, ay);
    if visit(x, y) {
        return true;
    }
    let (mut ix, mut iy) = (0, 0);
    while ix < nx || iy < ny {
        let d = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
        if d == 0 {
            if visit(x + sx, y) || visit(x, y + sy) {
                return true;
            }
            x += sx;
            y += sy;
            ix += 1;
            iy += 1;
        } else if d < 0 {
            x += sx;
            ix += 1;
        } else {
            y += sy;
            iy += 1;
        }
        if visit(x, y) {
            return true;
        }
    }
    false
}
#[cfg(test)]
mod tests;
