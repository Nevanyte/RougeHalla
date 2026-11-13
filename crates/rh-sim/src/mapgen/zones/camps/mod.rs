//! Exact initial camp/territory foundation. No camp spots, repair or canonical faction renumbering.
mod rules;
use super::{chamfer, chamfer_labels, d2i, ZoneContext, ZonePartition, CX, CY, H, N, W, ZONES};
pub use rules::{default_definition, visit_content, CampDefinition, DEFAULT_DEFINITION};
use std::cmp::Reverse;
use std::collections::BinaryHeap;
// Same total integer encoding as the parent source heap. Equal keys are indistinguishable tile indices.
const KEY: i32 = 32768;
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CampSite {
    pub zone: u8,
    pub site: usize,
    pub elite: bool,
    pub spots: Vec<usize>,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampLayout {
    pub camps: Vec<CampSite>,
    pub territory_grid: Vec<u8>,
}
pub struct CampContext<'z, 'f> {
    zones: &'z ZoneContext<'f>,
    rules: CampDefinition,
    halo_offsets: Vec<i32>,
    halo_ok: Vec<bool>,
}
impl<'z, 'f> CampContext<'z, 'f> {
    pub fn new(zones: &'z ZoneContext<'f>) -> Self {
        Self::from_definition(zones, &default_definition())
    }
    /// Definition-derived camp protection geometry, shared with later map stages.
    pub fn halo_offsets(&self) -> &[i32] {
        &self.halo_offsets
    }
    /// Positive, bounded geometry is required; elite selection supports the source's at-most-two elite slots.
    pub fn from_definition(zones: &'z ZoneContext<'f>, definition: &CampDefinition) -> Self {
        assert!(
            definition.camps_per_zone >= 2
                && definition
                    .camps_per_zone
                    .checked_mul(ZONES)
                    .is_some_and(|n| n <= u8::MAX as usize)
        );
        assert!(definition.elites_per_zone <= 2 && definition.halo_window >= 0);
        assert!(definition.edge_clear < W.min(H));
        assert!((definition.halo_window as usize) < W.min(H) / 2);
        assert!([
            definition.camp_gap,
            definition.territory_radius_max,
            definition.elite_min_sep
        ]
        .iter()
        .all(|v| v.is_finite() && *v >= 0.0));
        let rules = *definition;
        let window = rules.halo_window;
        let radius = zones.rules.camp_radius;
        assert!(radius.is_finite() && radius >= 0.0 && radius.ceil() + 1.0 < W.min(H) as f64 / 2.0);
        let extent = radius.ceil() as i32 + 1;
        // Decode the existing parent's shared clearing geometry once; floor is essential for negative offsets.
        let clear_points: Vec<(i32, i32)> = zones
            .clear_offsets
            .iter()
            .map(|&offset| {
                let oy = (f64::from(offset + extent) / W as f64).floor() as i32;
                (offset - oy * W as i32, oy)
            })
            .collect();
        let mut halo_offsets = Vec::new();
        for y in -window..=window {
            for x in -window..=window {
                if clear_points
                    .iter()
                    .any(|&(ox, oy)| (ox - x).abs() <= 1 && (oy - y).abs() <= 1)
                {
                    halo_offsets.push(y * W as i32 + x);
                }
            }
        }
        let f = zones.fixed;
        // The supplied fixed geometry already embodies the single coliseum ring-road definition.
        let road = f
            .ring
            .iter()
            .zip(&f.dist_fp)
            .filter_map(|(&ring, &dist)| if ring != 0 { Some(dist) } else { None })
            .max()
            .unwrap_or(0);
        let mut camp_ok = vec![false; N];
        for y in rules.edge_clear..=H - 1 - rules.edge_clear {
            for x in rules.edge_clear..=W - 1 - rules.edge_clear {
                let i = y * W + x;
                if f.painted_mask[i] != 0
                    && u16::from(f.dist_fp[i]) > u16::from(road) + u16::from(rules.halo_ring_margin)
                {
                    camp_ok[i] = true;
                }
            }
        }
        let mut halo_ok = vec![false; N];
        let margin = window as usize;
        for y in margin..H - margin {
            for x in margin..W - margin {
                let i = y * W + x;
                halo_ok[i] = halo_offsets
                    .iter()
                    .all(|&off| camp_ok.get((i as i32 + off) as usize) == Some(&true));
            }
        }
        Self {
            zones,
            rules,
            halo_offsets,
            halo_ok,
        }
    }
}
fn hull(list: &[usize]) -> Vec<usize> {
    fn cross(o: usize, a: usize, b: usize) -> i32 {
        let (ox, oy) = ((o % W) as i32, (o / W) as i32);
        let (ax, ay) = ((a % W) as i32, (a / W) as i32);
        let (bx, by) = ((b % W) as i32, (b / W) as i32);
        (ay - oy) * (bx - ox) - (ax - ox) * (by - oy)
    }
    let mut out = Vec::with_capacity(list.len() * 2);
    for &point in list {
        while out.len() >= 2 && cross(out[out.len() - 2], out[out.len() - 1], point) <= 0 {
            out.pop();
        }
        out.push(point);
    }
    let lo = out.len() + 1;
    for &point in list.iter().rev().skip(1) {
        while out.len() >= lo && cross(out[out.len() - 2], out[out.len() - 1], point) <= 0 {
            out.pop();
        }
        out.push(point);
    }
    if list.len() > 1 {
        out.pop();
    }
    out
}
fn voronoi(mask: &[u8], tiles: &[usize], owner: &mut [u8], cost: &[i32]) {
    let mut heap = BinaryHeap::new();
    let mut best = vec![1 << 30; N];
    let mut label = vec![0; N];
    for &t in tiles {
        if owner[t] > 0 {
            best[t] = 0;
            label[t] = owner[t];
            heap.push(Reverse(t as i32));
        }
    }
    while let Some(Reverse(key)) = heap.pop() {
        let t = (key % KEY) as usize;
        let c = (key - t as i32) / KEY;
        if c > best[t] {
            continue;
        }
        owner[t] = label[t];
        for off in crate::mapgen::grid_ops::NB4 {
            let j = (t as i32 + off) as usize;
            if mask.get(j).copied().unwrap_or(0) == 0 {
                continue;
            }
            let nc = c + cost[j];
            if nc < best[j] {
                best[j] = nc;
                label[j] = label[t];
                heap.push(Reverse(nc * KEY + j as i32));
            }
        }
    }
}
fn first_candidate(
    rng: &mut impl FnMut() -> f64,
    candidates: &[usize],
    m: usize,
    avoid: &[usize],
    gap2: f64,
) -> Vec<usize> {
    if candidates.is_empty() {
        return Vec::new();
    }
    let nearest = |c: usize| avoid.iter().map(|&o| d2i(o, c)).min().unwrap_or(1 << 30);
    let (mut best, mut best_d) = (None, -1);
    for _ in 0..m {
        let c = candidates[(rng() * candidates.len() as f64).floor() as usize];
        let md = nearest(c);
        if f64::from(md) < gap2 {
            continue;
        }
        if md > best_d || (md == best_d && best.is_some_and(|b| c < b)) {
            best = Some(c);
            best_d = md;
        }
    }
    if best.is_none() {
        for &c in candidates {
            let md = nearest(c);
            if f64::from(md) >= gap2 && md > best_d {
                best = Some(c);
                best_d = md;
            }
        }
    }
    best.into_iter().collect()
}
struct PoleSearch<'a> {
    context: &'a CampContext<'a, 'a>,
    /// The tiles a camp may stand on: `CampContext::halo_ok`, less every tile whose halo meets a reserved site
    /// (`place_camps_reserving`).
    halo_ok: &'a [bool],
    zone: &'a [u8],
    terr: &'a [u8],
    dt: &'a [i32],
    members: &'a [Vec<usize>],
    hulls: &'a [Vec<usize>],
    z: u8,
    gap2: f64,
    radius2: f64,
}
impl PoleSearch<'_> {
    fn pole(&self, n: usize, cur: &[usize], fixed: &[usize], reach: bool) -> Option<usize> {
        let within = |t: usize| {
            self.hulls[n]
                .iter()
                .all(|&v| f64::from(d2i(v, t)) <= self.radius2)
        };
        let mut best = if reach && !within(cur[n - 1]) {
            None
        } else {
            Some(cur[n - 1])
        };
        let mut best_v = -1;
        for &t in &self.members[n] {
            if !self.halo_ok[t]
                || self.dt[t] < best_v
                || (self.dt[t] == best_v && best.is_some_and(|b| t > b))
            {
                continue;
            }
            let inside = self.context.halo_offsets.iter().all(|&off| {
                let j = (t as i32 + off) as usize;
                self.terr.get(j) == Some(&(n as u8)) && self.zone.get(j) == Some(&self.z)
            });
            if !inside {
                continue;
            }
            if fixed
                .iter()
                .chain(&cur[n..])
                .any(|&o| f64::from(d2i(o, t)) < self.gap2)
                || (reach && !within(t))
            {
                continue;
            }
            best = Some(t);
            best_v = self.dt[t];
        }
        best
    }
}
/// All slices use the parent's fixed dimensions and valid internal zone labels/costs.
pub fn place_camps(
    context: &CampContext<'_, '_>,
    rng: &mut impl FnMut() -> f64,
    part: &ZonePartition,
) -> Option<CampLayout> {
    let d = &context.rules;
    let f = context.zones.fixed;
    let zone = &part.zone;
    let cost = &part.cost;
    let zone_tiles: Vec<Vec<usize>> = (1..=ZONES)
        .map(|z| {
            f.painted
                .iter()
                .copied()
                .filter(|&t| zone[t] as usize == z)
                .collect()
        })
        .collect();
    let gap2 = d.camp_gap * d.camp_gap;
    let radius2 = d.territory_radius_max * d.territory_radius_max;
    let mut terr = vec![0u8; N];
    let mut tm = vec![0; N];
    let mut zmask = vec![0; N];
    let mut dt = vec![0; N];
    let mut zdt = vec![0; N];
    let mut territory_grid = vec![0; N];
    for _ in 0..d.tries {
        let mut camps = Vec::new();
        territory_grid.fill(0);
        let mut placed = Vec::new();
        let mut ok = true;
        for z in 1..=ZONES {
            if !ok {
                break;
            }
            let zt = &zone_tiles[z - 1];
            zmask.fill(0);
            for &t in zt {
                zmask[t] = 1;
            }
            chamfer(&zmask, &mut zdt);
            let sites: Vec<usize> = zt
                .iter()
                .copied()
                .filter(|&t| context.halo_ok[t] && zdt[t] >= d.halo_dt)
                .collect();
            let clear: Vec<bool> = sites
                .iter()
                .map(|&site| placed.iter().all(|&o| f64::from(d2i(o, site)) >= gap2))
                .collect();
            let k = d.camps_per_zone;
            let mut at = first_candidate(rng, &sites, d.candidates, &placed, gap2);
            let mut min_d = vec![1 << 30; zt.len()];
            let mut spaced = clear;
            let mut seen = 0;
            while !at.is_empty() && at.len() < k {
                while seen < at.len() {
                    let o = at[seen];
                    seen += 1;
                    for (q, &t) in zt.iter().enumerate() {
                        min_d[q] = min_d[q].min(d2i(o, t));
                    }
                    for (q, &t) in sites.iter().enumerate() {
                        if spaced[q] && f64::from(d2i(o, t)) < gap2 {
                            spaced[q] = false;
                        }
                    }
                }
                let mut far = None;
                let mut far_d = -1;
                for (q, &t) in zt.iter().enumerate() {
                    if min_d[q] > far_d {
                        far_d = min_d[q];
                        far = Some(t);
                    }
                }
                let far = far.expect("seeded zone has tiles");
                let mut next = None;
                let mut next_d = 1 << 30;
                for (q, &c) in sites.iter().enumerate() {
                    if !spaced[q] {
                        continue;
                    }
                    let dist = d2i(c, far);
                    if dist < next_d {
                        next_d = dist;
                        next = Some(c);
                    }
                }
                let Some(next) = next else {
                    break;
                };
                at.push(next);
            }
            if at.len() < k {
                ok = false;
                break;
            }
            let mut final_sites = None;
            for step in 0..d.lloyd_steps {
                for &t in zt {
                    terr[t] = 0;
                }
                for (n, &site) in at.iter().enumerate() {
                    for &off in &context.halo_offsets {
                        if let Some(v) = terr.get_mut((site as i32 + off) as usize) {
                            *v = (n + 1) as u8;
                        }
                    }
                }
                voronoi(&zmask, zt, &mut terr, cost);
                tm.fill(0);
                for &t in zt {
                    tm[t] = terr[t];
                }
                chamfer_labels(&tm, &mut dt);
                let mut members = vec![Vec::new(); k + 1];
                for &t in zt {
                    members[terr[t] as usize].push(t);
                }
                let hulls: Vec<Vec<usize>> = members.iter().map(|m| hull(m)).collect();
                let poles = PoleSearch {
                    context,
                    halo_ok: &context.halo_ok,
                    zone,
                    terr: &terr,
                    dt: &dt,
                    members: &members,
                    hulls: &hulls,
                    z: z as u8,
                    gap2,
                    radius2,
                };
                if step >= d.final_from_step {
                    let mut sites = at.clone();
                    let mut fixed = placed.clone();
                    let mut all = true;
                    for n in 1..=k {
                        let Some(site) = poles.pole(n, &sites, &fixed, true) else {
                            all = false;
                            break;
                        };
                        fixed.push(site);
                        sites[n - 1] = site;
                    }
                    if all {
                        final_sites = Some(sites);
                        break;
                    }
                }
                let mut moved = Vec::new();
                for n in 1..=k {
                    let fixed: Vec<usize> = placed.iter().chain(&moved).copied().collect();
                    let near = poles
                        .pole(n, &at, &fixed, true)
                        .or_else(|| poles.pole(n, &at, &fixed, false));
                    moved.push(near.expect("unrestricted pole retains its old-site fallback"));
                }
                at = moved;
            }
            let Some(final_sites) = final_sites else {
                ok = false;
                break;
            };
            let base = camps.len();
            for site in final_sites {
                placed.push(site);
                camps.push(CampSite {
                    zone: z as u8,
                    site,
                    elite: false,
                    spots: Vec::new(),
                });
            }
            let mut by_far: Vec<usize> = (base..camps.len()).collect();
            let centre = CY as usize * W + CX as usize;
            by_far.sort_by(|&a, &b| {
                d2i(camps[b].site, centre)
                    .cmp(&d2i(camps[a].site, centre))
                    .then(a.cmp(&b))
            });
            let first = by_far[0];
            let second = by_far[1..]
                .iter()
                .copied()
                .find(|&c| {
                    f64::from(d2i(camps[c].site, camps[first].site))
                        >= d.elite_min_sep * d.elite_min_sep
                })
                .unwrap_or(by_far[1]);
            for &elite in [first, second].iter().take(d.elites_per_zone) {
                camps[elite].elite = true;
            }
            for &t in zt {
                territory_grid[t] = base as u8 + terr[t];
            }
        }
        if ok {
            return Some(CampLayout {
                camps,
                territory_grid,
            });
        }
    }
    None
}
/// A reserved landmark site as camp placement reads it (P-MAPGEN-SIG-RESERVE-1): the zone label, the site's tiles
/// (inclusive x0, y0, x1, y1) and the tile of the camp placed inside it (the church's and the cave's), if any.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reserve {
    pub zone: u8,
    pub x0: usize,
    pub y0: usize,
    pub x1: usize,
    pub y1: usize,
    pub camp: Option<usize>,
}
/// `place_camps` round reserved landmark sites (P-MAPGEN-SIG-RESERVE-1; the signature option only: with the option off
/// the Prefix calls `place_camps`, whose draws stay today's). Every candidate and every Lloyd pole whose halo meets a
/// site is refused. A zone whose site carries a camp places it first: it counts in the spacing of every later camp,
/// seeds its own territory label in every Lloyd step, never moves, and is the zone's first elite (the second follows
/// today's rule against it); the zone's other `camps_per_zone - 1` camps follow today's process. `None` (the round
/// fails and the partition is redrawn) as `place_camps`, or when a site's camp is not a legal camp tile.
pub fn place_camps_reserving(
    context: &CampContext<'_, '_>,
    rng: &mut impl FnMut() -> f64,
    part: &ZonePartition,
    reserved: &[Reserve],
) -> Option<CampLayout> {
    let d = &context.rules;
    let f = context.zones.fixed;
    let zone = &part.zone;
    let cost = &part.cost;
    let mut site_tile = vec![false; N];
    for r in reserved {
        for y in r.y0..=r.y1.min(H - 1) {
            for x in r.x0..=r.x1.min(W - 1) {
                site_tile[y * W + x] = true;
            }
        }
    }
    // The generator's halo (`halo_offsets`: the clearing grown by one tile) is the certifier's camp halo.
    let halo_ok: Vec<bool> = (0..N)
        .map(|t| {
            context.halo_ok[t]
                && context.halo_offsets.iter().all(|&off| {
                    !site_tile
                        .get((t as i32 + off) as usize)
                        .copied()
                        .unwrap_or(false)
                })
        })
        .collect();
    let inside_of = |z: usize| {
        reserved
            .iter()
            .find(|r| usize::from(r.zone) == z)
            .and_then(|r| r.camp)
    };
    if (1..=ZONES)
        .any(|z| inside_of(z).is_some_and(|c| !context.halo_ok.get(c).copied().unwrap_or(false)))
    {
        return None;
    }
    let zone_tiles: Vec<Vec<usize>> = (1..=ZONES)
        .map(|z| {
            f.painted
                .iter()
                .copied()
                .filter(|&t| zone[t] as usize == z)
                .collect()
        })
        .collect();
    let gap2 = d.camp_gap * d.camp_gap;
    let radius2 = d.territory_radius_max * d.territory_radius_max;
    let mut terr = vec![0u8; N];
    let mut tm = vec![0; N];
    let mut zmask = vec![0; N];
    let mut dt = vec![0; N];
    let mut zdt = vec![0; N];
    let mut territory_grid = vec![0; N];
    for _ in 0..d.tries {
        let mut camps = Vec::new();
        territory_grid.fill(0);
        let mut placed: Vec<usize> = Vec::new();
        let mut ok = true;
        for z in 1..=ZONES {
            if !ok {
                break;
            }
            let pinned = inside_of(z);
            if pinned.is_some_and(|c| placed.iter().any(|&o| f64::from(d2i(o, c)) < gap2)) {
                ok = false;
                break;
            }
            let zt = &zone_tiles[z - 1];
            zmask.fill(0);
            for &t in zt {
                zmask[t] = 1;
            }
            chamfer(&zmask, &mut zdt);
            let sites: Vec<usize> = zt
                .iter()
                .copied()
                .filter(|&t| halo_ok[t] && zdt[t] >= d.halo_dt)
                .collect();
            let clear: Vec<bool> = sites
                .iter()
                .map(|&site| placed.iter().all(|&o| f64::from(d2i(o, site)) >= gap2))
                .collect();
            let k = d.camps_per_zone;
            let avoid: Vec<usize> = placed.iter().copied().chain(pinned).collect();
            let first = first_candidate(rng, &sites, d.candidates, &avoid, gap2);
            if first.is_empty() {
                ok = false;
                break;
            }
            // The pinned camp is label 1 (index 0) and is processed as a placed site for coverage and spacing.
            let mut at: Vec<usize> = pinned.into_iter().chain(first).collect();
            let mut min_d = vec![1 << 30; zt.len()];
            let mut spaced = clear;
            let mut seen = 0;
            while at.len() < k {
                while seen < at.len() {
                    let o = at[seen];
                    seen += 1;
                    for (q, &t) in zt.iter().enumerate() {
                        min_d[q] = min_d[q].min(d2i(o, t));
                    }
                    for (q, &t) in sites.iter().enumerate() {
                        if spaced[q] && f64::from(d2i(o, t)) < gap2 {
                            spaced[q] = false;
                        }
                    }
                }
                let mut far = None;
                let mut far_d = -1;
                for (q, &t) in zt.iter().enumerate() {
                    if min_d[q] > far_d {
                        far_d = min_d[q];
                        far = Some(t);
                    }
                }
                let far = far.expect("seeded zone has tiles");
                let mut next = None;
                let mut next_d = 1 << 30;
                for (q, &c) in sites.iter().enumerate() {
                    if !spaced[q] {
                        continue;
                    }
                    let dist = d2i(c, far);
                    if dist < next_d {
                        next_d = dist;
                        next = Some(c);
                    }
                }
                let Some(next) = next else {
                    break;
                };
                at.push(next);
            }
            if at.len() < k {
                ok = false;
                break;
            }
            let fixed_label = |n: usize| pinned.is_some() && n == 1;
            let mut final_sites = None;
            for step in 0..d.lloyd_steps {
                for &t in zt {
                    terr[t] = 0;
                }
                for (n, &site) in at.iter().enumerate() {
                    for &off in &context.halo_offsets {
                        if let Some(v) = terr.get_mut((site as i32 + off) as usize) {
                            *v = (n + 1) as u8;
                        }
                    }
                }
                voronoi(&zmask, zt, &mut terr, cost);
                tm.fill(0);
                for &t in zt {
                    tm[t] = terr[t];
                }
                chamfer_labels(&tm, &mut dt);
                let mut members = vec![Vec::new(); k + 1];
                for &t in zt {
                    members[terr[t] as usize].push(t);
                }
                let hulls: Vec<Vec<usize>> = members.iter().map(|m| hull(m)).collect();
                let poles = PoleSearch {
                    context,
                    halo_ok: &halo_ok,
                    zone,
                    terr: &terr,
                    dt: &dt,
                    members: &members,
                    hulls: &hulls,
                    z: z as u8,
                    gap2,
                    radius2,
                };
                if step >= d.final_from_step {
                    let mut sites = at.clone();
                    let mut fixed = placed.clone();
                    let mut all = true;
                    for n in 1..=k {
                        let site = if fixed_label(n) {
                            Some(at[0])
                        } else {
                            poles.pole(n, &sites, &fixed, true)
                        };
                        let Some(site) = site else {
                            all = false;
                            break;
                        };
                        fixed.push(site);
                        sites[n - 1] = site;
                    }
                    if all {
                        final_sites = Some(sites);
                        break;
                    }
                }
                let mut moved = Vec::new();
                for n in 1..=k {
                    if fixed_label(n) {
                        moved.push(at[0]);
                        continue;
                    }
                    let fixed: Vec<usize> = placed.iter().chain(&moved).copied().collect();
                    let near = poles
                        .pole(n, &at, &fixed, true)
                        .or_else(|| poles.pole(n, &at, &fixed, false));
                    moved.push(near.expect("unrestricted pole retains its old-site fallback"));
                }
                at = moved;
            }
            let Some(final_sites) = final_sites else {
                ok = false;
                break;
            };
            let base = camps.len();
            for site in final_sites {
                placed.push(site);
                camps.push(CampSite {
                    zone: z as u8,
                    site,
                    elite: false,
                    spots: Vec::new(),
                });
            }
            let mut by_far: Vec<usize> = (base..camps.len()).collect();
            let centre = CY as usize * W + CX as usize;
            by_far.sort_by(|&a, &b| {
                d2i(camps[b].site, centre)
                    .cmp(&d2i(camps[a].site, centre))
                    .then(a.cmp(&b))
            });
            // The pinned camp is the first elite; otherwise today's (the camp farthest from the centre).
            let first = if pinned.is_some() { base } else { by_far[0] };
            let rest: Vec<usize> = by_far.iter().copied().filter(|&c| c != first).collect();
            let second = rest
                .iter()
                .copied()
                .find(|&c| {
                    f64::from(d2i(camps[c].site, camps[first].site))
                        >= d.elite_min_sep * d.elite_min_sep
                })
                .unwrap_or(rest[0]);
            for &elite in [first, second].iter().take(d.elites_per_zone) {
                camps[elite].elite = true;
            }
            for &t in zt {
                territory_grid[t] = base as u8 + terr[t];
            }
        }
        if ok {
            return Some(CampLayout {
                camps,
                territory_grid,
            });
        }
    }
    None
}
pub fn territory_reach2(
    context: &ZoneContext<'_>,
    camps: &[CampSite],
    territory_grid: &[u8],
    tiles: Option<&[u8]>,
) -> Vec<i32> {
    let mut far = vec![0; camps.len() + 1];
    for &t in &context.fixed.painted {
        let id = territory_grid.get(t).copied().unwrap_or(0) as usize;
        if id == 0
            || tiles.is_some_and(|tiles| {
                tiles.get(t).copied().unwrap_or(0) & crate::map::MASK_MOVE != 0
            })
        {
            continue;
        }
        far[id] = far[id].max(d2i(t, camps[id - 1].site));
    }
    far
}
#[cfg(test)]
mod tests;
