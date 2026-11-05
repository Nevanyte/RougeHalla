//! Exact pre-styler zone partition foundation from legacy zones.ts.
//! No camps, territories, post-styler repair, complete generator or certifier.
//! Fixed-size slices have W*H cells. The injected RNG yields finite values in [0,1).
pub mod camps;
mod growth;
mod metrics;
mod rules;
use crate::mapgen::coliseum::{FixedLayout, CX, CY, H, W};
pub use metrics::{chamfer, chamfer_labels, pseudo_angle, ring_contact, sliver_counts};
pub use rules::{default_definition, visit_content, ZoneDefinition, DEFAULT_DEFINITION};
// Derived geometry/encoding, not additional tunables.
pub const ZONES: usize = crate::content::FactionId::ALL.len();
const N: usize = W * H;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ZonePartition {
    pub zone: Vec<u8>,
    pub cost: Vec<i32>,
}
/// Caller-owned derived tables. Construction reads the unmodified fixed layout;
/// there is no mutable process cache or cross-call RNG/scratch state.
pub struct ZoneContext<'a> {
    fixed: &'a FixedLayout,
    rules: ZoneDefinition,
    annulus: Vec<usize>,
    ring_sorted: Vec<usize>,
    ring_ang: Vec<f64>,
    clear_offsets: Vec<i32>,
}
impl<'a> ZoneContext<'a> {
    /// Shared clearing geometry for later attempt stages; the definition remains the sole owner.
    pub fn camp_radius(&self) -> f64 {
        self.rules.camp_radius
    }

    pub fn clearing_offsets(&self) -> &[i32] {
        &self.clear_offsets
    }

    pub fn new(fixed: &'a FixedLayout) -> Self {
        Self::from_definition(fixed, &default_definition())
    }
    /// Rebuild every derived table from the same rule definition used by partitioning.
    /// Definitions must have valid positive scales and leave nonempty ring arcs/annulus.
    pub fn from_definition(fixed: &'a FixedLayout, definition: &ZoneDefinition) -> Self {
        let rules = *definition;
        let r0 = W.min(H) as f64 / 2.0;
        let lo = rules.annulus_lo * r0;
        let hi = rules.annulus_hi * r0;
        let (lo2, hi2) = (lo * lo, hi * hi);
        let mut annulus = Vec::new();
        for y in rules.annulus_edge..H - rules.annulus_edge {
            for x in rules.annulus_edge..W - rules.annulus_edge {
                let dx = x as f64 + 0.5 - f64::from(CX);
                let dy = y as f64 + 0.5 - f64::from(CY);
                let r2 = dx * dx + dy * dy;
                if fixed.painted_mask[y * W + x] != 0 && r2 >= lo2 && r2 <= hi2 {
                    annulus.push(y * W + x);
                }
            }
        }
        let mut ring_sorted = fixed.ring_tiles.clone();
        ring_sorted.sort_by(|&a, &b| {
            angle_of(a)
                .partial_cmp(&angle_of(b))
                .expect("finite ring angle")
                .then(a.cmp(&b))
        });
        let ring_ang = ring_sorted.iter().map(|&t| angle_of(t)).collect();
        let mut clear_offsets = Vec::new();
        let extent = rules.camp_radius.ceil() as i32 + 1;
        for y in -extent..=extent {
            for x in -extent..=extent {
                if f64::from(x * x + y * y) <= rules.camp_radius * rules.camp_radius {
                    clear_offsets.push(y * W as i32 + x);
                }
            }
        }
        Self {
            fixed,
            rules,
            annulus,
            ring_sorted,
            ring_ang,
            clear_offsets,
        }
    }
}
fn angle_of(i: usize) -> f64 {
    pseudo_angle(
        (i % W) as f64 + 0.5 - f64::from(CX),
        (i / W) as f64 + 0.5 - f64::from(CY),
    )
}
fn d2i(a: usize, b: usize) -> i32 {
    let dx = (a % W) as i32 - (b % W) as i32;
    let dy = (a / W) as i32 - (b / W) as i32;
    dx * dx + dy * dy
}
fn value_noise(rng: &mut impl FnMut() -> f64, out: &mut [i32], d: &ZoneDefinition) {
    out.fill(0);
    let coarse =
        crate::math::js_round((d.noise_coarse_scale * W as f64) / d.noise_reference_width) as usize;
    let fine =
        crate::math::js_round((d.noise_fine_scale * W as f64) / d.noise_reference_width) as usize;
    for (cell, weight) in [(coarse, d.noise_coarse_weight), (fine, d.noise_fine_weight)] {
        let gw = W / cell + 2;
        let lat: Vec<i32> = (0..gw * gw)
            .map(|_| (rng() * 256.0).floor() as i32)
            .collect();
        let c2 = (cell * cell) as i32;
        for y in 0..H {
            let gy = y / cell;
            let fy = (y - gy * cell) as i32;
            for x in 0..W {
                let gx = x / cell;
                let fx = (x - gx * cell) as i32;
                let (a, b, c, e) = (
                    lat[gy * gw + gx],
                    lat[gy * gw + gx + 1],
                    lat[(gy + 1) * gw + gx],
                    lat[(gy + 1) * gw + gx + 1],
                );
                let cell = cell as i32;
                out[y * W + x] += ((a * (cell - fx) * (cell - fy)
                    + b * fx * (cell - fy)
                    + c * (cell - fx) * fy
                    + e * fx * fy)
                    / c2)
                    * weight;
            }
        }
    }
    for v in out {
        *v /= d.noise_divisor;
    }
}
fn best_candidates(
    rng: &mut impl FnMut() -> f64,
    cands: &[usize],
    k: usize,
    m: usize,
) -> Vec<usize> {
    let mut out = Vec::new();
    if cands.is_empty() {
        return out;
    }
    for _ in 0..k {
        let (mut best, mut best_d) = (None, -1);
        for _ in 0..m {
            let c = cands[(rng() * cands.len() as f64).floor() as usize];
            let md = out.iter().map(|&o| d2i(o, c)).min().unwrap_or(1 << 30);
            if md > best_d || (md == best_d && best.is_some_and(|b| c < b)) {
                best_d = md;
                best = Some(c);
            }
        }
        if best.is_none() {
            for &c in cands {
                let md = out.iter().map(|&o| d2i(o, c)).min().unwrap_or(1 << 30);
                if md > best_d {
                    best_d = md;
                    best = Some(c);
                }
            }
        }
        let Some(best) = best else {
            return out;
        };
        out.push(best);
    }
    out
}
fn quotas(total: usize) -> [i32; ZONES + 1] {
    core::array::from_fn(|z| {
        if z == 0 {
            0
        } else {
            (total / ZONES + usize::from(z <= total % ZONES)) as i32
        }
    })
}
pub fn partition_zones(
    context: &ZoneContext<'_>,
    rng: &mut impl FnMut() -> f64,
) -> Option<ZonePartition> {
    let f = context.fixed;
    let d = &context.rules;
    let mut zone = vec![0u8; N];
    let mut noise = vec![0; N];
    let mut cost = vec![0; N];
    let mut dt = vec![0; N];
    let quota = quotas(f.painted.len());
    for _ in 0..d.zone_tries {
        value_noise(rng, &mut noise, d);
        for i in 0..N {
            cost[i] = d.cost_base + ((noise[i] * d.cost_amp) >> 8);
        }
        zone.fill(0);
        let r = context.ring_sorted.len();
        let mut len = [0; ZONES];
        let extra = r - ZONES * d.arc_min;
        let mut u = [0.0; ZONES];
        let mut su = 0.0;
        for value in &mut u {
            *value = d.arc_weight_bias + rng();
            su += *value;
        }
        let mut given = 0;
        for k in 0..ZONES {
            len[k] = d.arc_min + ((extra as f64 * u[k]) / su).floor() as usize;
            given += len[k];
        }
        len[0] += r - given;
        let mut protect = vec![0; N];
        let mut arc_mid = [0.0; ZONES];
        let mut at = (rng() * r as f64).floor() as usize;
        for k in 0..ZONES {
            for j in d.arc_trim..len[k] - d.arc_trim {
                let t = context.ring_sorted[(at + j) % r];
                zone[t] = (k + 1) as u8;
                protect[t] = 1;
            }
            arc_mid[k] = context.ring_ang[(at + (len[k] >> 1)) % r];
            at += len[k];
        }
        let seeds = best_candidates(rng, &context.annulus, ZONES, d.seed_candidates);
        let seed_ang: Vec<f64> = seeds.iter().map(|&s| angle_of(s)).collect();
        let mut by_angle: Vec<usize> = (0..ZONES).collect();
        by_angle.sort_by(|&a, &b| {
            seed_ang[a]
                .partial_cmp(&seed_ang[b])
                .expect("finite seed angle")
                .then(a.cmp(&b))
        });
        let (mut shift, mut best_turn) = (0, f64::INFINITY);
        for sh in 0..ZONES {
            let mut turn = 0.0;
            for k in 0..ZONES {
                let diff = (seed_ang[by_angle[(k + sh) % ZONES]] - arc_mid[k]).abs();
                turn += diff.min(4.0 - diff);
            }
            if turn < best_turn {
                best_turn = turn;
                shift = sh;
            }
        }
        let mut spines_ok = true;
        for k in 0..ZONES {
            if !spines_ok {
                break;
            }
            let target = seeds[by_angle[(k + shift) % ZONES]];
            if zone[target] != 0 && zone[target] as usize != k + 1 {
                spines_ok = false;
                break;
            }
            spines_ok = growth::spine(&mut zone, &f.painted_mask, &cost, (k + 1) as u8, target);
            protect[target] = 1;
        }
        if !spines_ok {
            continue;
        }
        if !growth::grow_quota(
            &f.painted_mask,
            &f.painted,
            &mut zone,
            &cost,
            &quota,
            &protect,
            d,
        ) {
            continue;
        }
        for _ in 0..d.smooth_passes {
            growth::smooth(&f.painted_mask, &f.painted, &mut zone, &protect, d);
        }
        if !growth::balance(&f.painted_mask, &f.painted, &mut zone, &quota, &protect, d) {
            continue;
        }
        let mut size = [0; ZONES + 1];
        for &t in &f.painted {
            size[zone[t] as usize] += 1;
        }
        let (mut smin, mut smax) = (1 << 30, 0);
        for &size in &size[1..] {
            smin = smin.min(size);
            smax = smax.max(size);
        }
        if smax - smin > d.area_tolerance {
            continue;
        }
        if ring_contact(context, &zone)[1..]
            .iter()
            .any(|&c| c < d.ring_contact_min)
        {
            continue;
        }
        if sliver_counts(context, &zone, &mut dt)[1..]
            .iter()
            .any(|&s| s > d.sliver_max)
        {
            continue;
        }
        return Some(ZonePartition { zone, cost });
    }
    None
}
#[cfg(test)]
mod tests;
