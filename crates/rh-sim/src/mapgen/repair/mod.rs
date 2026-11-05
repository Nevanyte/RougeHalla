//! Exact stage-seven safety nets and stage-nine territory repair/checks.
//! Normal source refusal preserves every write already performed. No RNG is accepted.
mod rules;
use crate::map::{MASK_MOVE, TILE_FLOOR, TILE_LOW, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, MapFeature, TileRect as FeatureRect, Zone};
use crate::mapgen::coliseum::{FixedLayout, TilePt, TileRect, CX, CY, H, W};
use crate::mapgen::grid_ops::{enforce_connectivity, NB4, RING_OFF};
use crate::mapgen::spawns::SpawnDefinition;
use crate::mapgen::zones::{
    self,
    camps::{territory_reach2, CampDefinition, CampSite},
    ZoneContext, ZoneDefinition, ZONES,
};
pub use rules::{default_definition, visit_content, Definition};
const N: usize = W * H;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Definition,
    Layers,
    Reference,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Refusal {
    CampCut,
    PoolCut,
    TerrStray,
    ZoneSplit,
    TerrWalls,
    RezoneLow,
    RezoneCrate,
    RezoneLandmark,
    RezonePool,
    FloorShare,
    AreaPost,
    RingPost,
    SliverPost,
    ZoneFloorSplit,
    RadiusPost,
}
impl Refusal {
    pub fn source_reason(self) -> &'static str {
        match self {
            Self::CampCut => "A:campCut",
            Self::PoolCut => "A:poolCut",
            Self::TerrStray => "A:terrStray",
            Self::ZoneSplit => "A:zoneSplit",
            Self::TerrWalls => "A:terrWalls",
            Self::RezoneLow => "A:rezoneLow",
            Self::RezoneCrate => "A:rezoneCrate",
            Self::RezoneLandmark => "A:rezoneLandmark",
            Self::RezonePool => "A:rezonePool",
            Self::FloorShare => "A:floorShare",
            Self::AreaPost => "A:areaPost",
            Self::RingPost => "A:ringPost",
            Self::SliverPost => "A:sliverPost",
            Self::ZoneFloorSplit => "A:zoneFloorSplit",
            Self::RadiusPost => "A:radiusPost",
        }
    }
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub tiles: Vec<u8>,
    pub terrain: Vec<u8>,
    pub zone: Vec<u8>,
    pub territory_grid: Vec<u8>,
    pub region_grid: Vec<u8>,
    pub feature_owner: Vec<u16>,
    pub features: Vec<MapFeature>,
}
/// Borrow the same accepted geometry/protection definitions used by earlier stages.
pub struct SharedDefinitions<'a> {
    pub zones: &'a ZoneDefinition,
    pub camps: &'a CampDefinition,
    pub spawns: &'a SpawnDefinition,
}
pub struct Input<'a> {
    pub styled: bool,
    pub order: &'a [Zone],
    pub camps: &'a [CampSite],
    pub clearing: &'a [usize],
    pub pool: &'a [usize],
    pub protect: &'a [u8],
    pub landmark_box: &'a [u8],
    pub crates_by_zone: &'a [Vec<usize>],
    pub buildings: &'a [TileRect],
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Nets {
    pub before_nets: Vec<u8>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Post {
    pub rezoned: usize,
    pub infill_tiles: usize,
    pub reach2: Vec<i32>,
}
fn at(i: usize, off: i32) -> usize {
    (i as i32 + off) as usize
}
fn floor(s: &State, i: usize) -> bool {
    s.tiles.get(i).is_some_and(|&v| v & MASK_MOVE == 0)
}
fn d2(a: usize, b: usize) -> f64 {
    let x = (a % W) as i32 - (b % W) as i32;
    let y = (a / W) as i32 - (b / W) as i32;
    f64::from(x * x + y * y)
}
fn validate(
    d: &Definition<'_>,
    f: &FixedLayout,
    s: &State,
    i: &Input<'_>,
    require_camp_floor: bool,
) -> Result<(), Error> {
    if !d.floor_share_max.is_finite()
        || d.floor_share_max < 0.0
        || d.territory_rounds == 0
        || d.territory_rounds > 1000
        || d.zone_rounds > 1000
        || d.wall_sweeps > 1000
        || d.terrain_on.is_empty()
        || d.terrain_on.len() > 256
        || d.terrain_on
            .iter()
            .any(|&t| ![TILE_FLOOR, TILE_LOW].contains(&t))
    {
        return Err(Error::Definition);
    }
    if [
        &s.tiles,
        &s.terrain,
        &s.zone,
        &s.territory_grid,
        &s.region_grid,
    ]
    .iter()
    .any(|a| a.len() != N)
        || s.feature_owner.len() != N
        || [
            i.protect,
            i.landmark_box,
            &f.fp,
            &f.border,
            &f.lane_in,
            &f.ring,
            &f.painted_mask,
        ]
        .iter()
        .any(|a| a.len() != N)
    {
        return Err(Error::Layers);
    }
    if i.order.len() != ZONES
        || i.order
            .iter()
            .enumerate()
            .any(|(k, z)| i.order[..k].contains(z))
        || i.camps.is_empty()
        || i.camps.len() > 255
        || i.crates_by_zone.len() != ZONES
        || s.features.len() + ZONES > u16::MAX as usize
        || s.tiles
            .iter()
            .any(|&t| ![TILE_FLOOR, TILE_WALL, TILE_LOW].contains(&t))
        || s.region_grid.iter().any(|&r| r > 6)
        || s.zone.iter().any(|&z| z as usize > ZONES)
        || s.terrain.iter().any(|&t| t as usize >= d.terrain_on.len())
        || s.territory_grid.iter().any(|&t| t as usize > i.camps.len())
        || s.feature_owner
            .iter()
            .any(|&o| o as usize > s.features.len())
    {
        return Err(Error::Reference);
    }
    let interior = |t: usize| t < N && t % W > 0 && t % W < W - 1 && t / W > 0 && t / W < H - 1;
    if i.clearing.iter().chain(i.pool).any(|&t| !interior(t))
        || i.crates_by_zone.iter().flatten().any(|&t| !interior(t))
        || f.painted.iter().any(|&t| !interior(t) || s.zone[t] == 0)
        || f.ring_tiles.iter().any(|&t| t >= N)
        || f.lane_out
            .iter()
            .any(|t| t.x < 0 || t.x >= W as i32 || t.y < 0 || t.y >= H as i32)
    {
        return Err(Error::Reference);
    }
    let mut painted_seen = vec![false; N];
    for &t in &f.painted {
        if painted_seen[t] {
            return Err(Error::Reference);
        }
        painted_seen[t] = true;
    }
    if (0..N).any(|t| {
        painted_seen[t] != (f.painted_mask[t] != 0)
            || painted_seen[t] != (f.fp[t] == 0 && f.border[t] == 0)
    }) {
        return Err(Error::Reference);
    }
    if i.camps.iter().enumerate().any(|(k, c)| {
        !interior(c.site)
            || c.zone == 0
            || c.zone as usize > ZONES
            || s.zone[c.site] != c.zone
            || s.territory_grid[c.site] as usize != k + 1
            || (require_camp_floor && !floor(s, c.site))
    }) || (1..=ZONES).any(|z| !i.camps.iter().any(|c| c.zone as usize == z))
    {
        return Err(Error::Reference);
    }
    // Source neighbour offsets rely on a nonwalkable outer border, and zero zone outside painted cells.
    if (0..N).any(|t| (!interior(t) && floor(s, t)) || (f.painted_mask[t] == 0 && s.zone[t] != 0)) {
        return Err(Error::Reference);
    }
    if i.buildings.iter().any(|b| {
        b.x < 1
            || b.y < 1
            || b.w <= 0
            || b.h <= 0
            || i64::from(b.x) + i64::from(b.w) >= W as i64
            || i64::from(b.y) + i64::from(b.h) >= H as i64
    }) {
        return Err(Error::Reference);
    }
    Ok(())
}
fn clear_buried(d: &Definition<'_>, s: &mut State, styled: bool) {
    if styled {
        for t in 0..N {
            if s.terrain[t] != 0
                && s.tiles[t] == TILE_WALL
                && d.terrain_on[s.terrain[t] as usize] == TILE_FLOOR
            {
                s.terrain[t] = 0;
            }
        }
    }
}
/// The source's beforeNets snapshot is taken before restoring lanes and clearings.
pub fn safety_nets(
    d: &Definition<'_>,
    f: &FixedLayout,
    s: &mut State,
    i: &Input<'_>,
) -> Result<Result<Nets, Refusal>, Error> {
    validate(d, f, s, i, false)?;
    let before_nets = s.tiles.clone();
    for t in &f.lane_out {
        s.tiles[t.y as usize * W + t.x as usize] = TILE_FLOOR;
    }
    for t in 0..N {
        if f.lane_in[t] != 0 {
            s.tiles[t] = TILE_FLOOR;
        }
    }
    for &t in i.clearing {
        s.tiles[t] = TILE_FLOOR;
    }
    enforce_connectivity(&mut s.tiles, TilePt { x: CX, y: CY }, None);
    clear_buried(d, s, i.styled);
    if i.clearing.iter().any(|&t| s.tiles[t] != TILE_FLOOR) {
        return Ok(Err(Refusal::CampCut));
    }
    for t in 0..N {
        s.region_grid[t] = if f.fp[t] != 0 {
            6
        } else if f.border[t] != 0 {
            0
        } else {
            i.order[s.zone[t] as usize - 1].code()
        };
    }
    for &t in i.pool {
        if RING_OFF
            .iter()
            .any(|&off| s.tiles[at(t, off)] != TILE_FLOOR)
            || s.tiles[t] != TILE_FLOOR
        {
            return Ok(Err(Refusal::PoolCut));
        }
    }
    Ok(Ok(Nets { before_nets }))
}
fn wallable(s: &State, queue: &[usize], keep: &[u8], floor_total: usize) -> bool {
    if queue.iter().any(|&t| keep[t] != 0) {
        return false;
    }
    let mut seen = vec![false; N];
    for &t in queue {
        seen[t] = true;
    }
    let start = CY as usize * W + CX as usize;
    let mut flood = vec![start];
    seen[start] = true;
    let mut head = 0;
    while head < flood.len() {
        let t = flood[head];
        head += 1;
        for off in NB4 {
            let j = at(t, off);
            if !seen[j] && floor(s, j) {
                seen[j] = true;
                flood.push(j);
            }
        }
    }
    flood.len() == floor_total - queue.len()
}
/// Optional operation observations. Production calls allocate no trace snapshots.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Trace {
    pub phase: String,
    pub round: usize,
    pub target: usize,
    pub rezoned: usize,
    pub cells: Vec<usize>,
    pub tiles: Vec<u8>,
    pub zone: Vec<u8>,
    pub territory_grid: Vec<u8>,
}
fn record(
    out: &mut Option<&mut Vec<Trace>>,
    phase: &str,
    round: usize,
    target: usize,
    rezoned: usize,
    cells: &[usize],
    s: &State,
) {
    if let Some(out) = out {
        out.push(Trace {
            phase: phase.to_owned(),
            round,
            target,
            rezoned,
            cells: cells.to_vec(),
            tiles: s.tiles.clone(),
            zone: s.zone.clone(),
            territory_grid: s.territory_grid.clone(),
        });
    }
}
fn repair(
    definitions: (&Definition<'_>, &CampDefinition),
    zc: &ZoneContext<'_>,
    f: &FixedLayout,
    s: &mut State,
    i: &Input<'_>,
    keep: &[u8],
    trace: &mut Option<&mut Vec<Trace>>,
) -> Result<usize, Refusal> {
    let (d, cd) = definitions;
    let mut comp = vec![-1i32; N];
    let mut rezoned = 0;
    let mut stray = 0;
    let mut floor_total = s.tiles.iter().filter(|&&t| t & MASK_MOVE == 0).count();
    let max2 = cd.territory_radius_max * cd.territory_radius_max;
    for round in 0..d.territory_rounds {
        comp.fill(-1);
        let mut moved = false;
        stray = 0;
        for (ci, c) in i.camps.iter().enumerate() {
            let owner = ci + 1;
            let mut queue = vec![c.site];
            comp[c.site] = owner as i32;
            let mut head = 0;
            while head < queue.len() {
                let t = queue[head];
                head += 1;
                for off in NB4 {
                    let j = at(t, off);
                    if comp[j] < 0 && floor(s, j) && s.territory_grid[j] as usize == owner {
                        comp[j] = owner as i32;
                        queue.push(j);
                    }
                }
            }
        }
        for &start in &f.painted {
            if !floor(s, start) || comp[start] >= 0 {
                continue;
            }
            let owner = s.territory_grid[start];
            let mut queue = vec![start];
            comp[start] = 0;
            let mut touch = vec![0; i.camps.len() + 1];
            let mut head = 0;
            while head < queue.len() {
                let t = queue[head];
                head += 1;
                for off in NB4 {
                    let j = at(t, off);
                    if !floor(s, j) || s.zone[j] == 0 {
                        continue;
                    }
                    if s.territory_grid[j] == owner {
                        if comp[j] < 0 {
                            comp[j] = 0;
                            queue.push(j);
                        }
                    } else if s.zone[j] == s.zone[start] && comp[j] > 0 {
                        touch[s.territory_grid[j] as usize] += 1;
                    }
                }
            }
            let mut best = 0;
            let mut best_fits = false;
            for u in 1..=i.camps.len() {
                if touch[u] == 0 {
                    continue;
                }
                let fits = queue.iter().all(|&t| d2(i.camps[u - 1].site, t) <= max2);
                if best == 0
                    || (fits && !best_fits)
                    || (fits == best_fits && touch[u] > touch[best])
                {
                    best = u;
                    best_fits = fits;
                }
            }
            let far = best > 0 && queue.iter().any(|&t| d2(i.camps[best - 1].site, t) > max2);
            if queue.len() <= d.wall_up_max
                && ((best > 0 && far) || (best == 0 && round > 0))
                && wallable(s, &queue, keep, floor_total)
            {
                for &t in &queue {
                    s.tiles[t] = TILE_WALL;
                }
                floor_total -= queue.len();
                moved = true;
                record(
                    trace,
                    if best > 0 { "wall-far" } else { "wall-stray" },
                    round,
                    best,
                    rezoned,
                    &queue,
                    s,
                );
                continue;
            }
            if best == 0 && queue.len() <= d.stray_max && round > 0 {
                let mut other = vec![0; i.camps.len() + 1];
                for &t in &queue {
                    for off in NB4 {
                        let j = at(t, off);
                        if floor(s, j)
                            && s.zone[j] != 0
                            && s.zone[j] != s.zone[start]
                            && comp[j] > 0
                        {
                            other[s.territory_grid[j] as usize] += 1;
                        }
                    }
                }
                for u in 1..=i.camps.len() {
                    if other[u] > 0 && (best == 0 || other[u] > other[best]) {
                        best = u;
                    }
                }
                if best > 0 {
                    for &t in &queue {
                        s.zone[t] = i.camps[best - 1].zone;
                    }
                    rezoned += queue.len();
                    record(trace, "rezone", round, best, rezoned, &queue, s);
                }
            }
            if best == 0 {
                stray += 1;
                record(trace, "stray", round, 0, rezoned, &queue, s);
                continue;
            }
            for &t in &queue {
                s.territory_grid[t] = best as u8;
            }
            moved = true;
            record(trace, "assign", round, best, rezoned, &queue, s);
        }
        if !moved {
            break;
        }
    }
    if stray > 0 {
        return Err(Refusal::TerrStray);
    }
    if rezoned == 0 {
        return Ok(0);
    }
    let keep: Vec<u8> = (0..N)
        .map(|t| u8::from(floor(s, t) || f.ring[t] != 0))
        .collect();
    let mut lab = vec![0; N];
    for round in 0..d.zone_rounds {
        lab.fill(0);
        let mut changed = false;
        for z in 1..=ZONES {
            let start = i
                .camps
                .iter()
                .find(|c| c.zone as usize == z)
                .expect("validated zone")
                .site;
            let mut queue = vec![start];
            lab[start] = 1;
            let mut head = 0;
            while head < queue.len() {
                let t = queue[head];
                head += 1;
                for off in NB4 {
                    let j = at(t, off);
                    if lab[j] == 0 && s.zone[j] as usize == z {
                        lab[j] = 1;
                        queue.push(j);
                    }
                }
            }
        }
        for &start in &f.painted {
            if lab[start] != 0 {
                continue;
            }
            let z = s.zone[start];
            let mut queue = vec![start];
            lab[start] = 2;
            let mut near = [0; ZONES + 1];
            let mut head = 0;
            while head < queue.len() {
                let t = queue[head];
                head += 1;
                for off in NB4 {
                    let j = at(t, off);
                    if s.zone[j] == 0 {
                        continue;
                    }
                    if s.zone[j] == z {
                        if lab[j] == 0 {
                            lab[j] = 2;
                            queue.push(j);
                        }
                    } else {
                        near[s.zone[j] as usize] += 1;
                    }
                }
            }
            let mut nz = 0;
            for u in 1..=ZONES {
                if near[u] > 0 && (nz == 0 || near[u] > near[nz]) {
                    nz = u;
                }
            }
            if nz == 0 {
                return Err(Refusal::ZoneSplit);
            }
            for &t in &queue {
                s.zone[t] = nz as u8;
            }
            record(trace, "zone-transfer", round, nz, rezoned, &queue, s);
            changed = true;
        }
        zones::balance_repair(zc, &mut s.zone, &keep);
        record(trace, "zone-balance", round, 0, rezoned, &[], s);
        if !changed {
            break;
        }
    }
    for sweep in 0.. {
        let mut left = 0;
        for &t in &f.painted {
            let owner = s.territory_grid[t] as usize;
            if owner > 0 && i.camps[owner - 1].zone == s.zone[t] {
                continue;
            }
            let mut nt = 0;
            for off in NB4 {
                let j = at(t, off);
                let u = s.territory_grid[j] as usize;
                if u > 0 && s.zone[j] == s.zone[t] && i.camps[u - 1].zone == s.zone[t] {
                    nt = u;
                    break;
                }
            }
            if nt > 0 {
                s.territory_grid[t] = nt as u8;
            } else {
                left += 1;
            }
        }
        record(trace, "wall-sweep", sweep, left, rezoned, &[], s);
        if left == 0 {
            break;
        }
        if sweep > d.wall_sweeps {
            return Err(Refusal::TerrWalls);
        }
    }
    Ok(rezoned)
}
// Admit only definitions whose score arithmetic and existing heap encoding remain valid.
// The established heap uses the next power-of-two tile suffix (32768 for this fixed grid).
fn safe_balance_definition(d: &ZoneDefinition) -> bool {
    let suffix = N.next_power_of_two() as i64;
    for n_to in 1..=3 {
        for n_from in 1..=4 - n_to {
            let weighted = i64::from(d.peel_to_weight) * i64::from(n_to);
            let partial = weighted - i64::from(n_from);
            let score = partial + i64::from(d.peel_bias);
            if [weighted, partial, score]
                .iter()
                .any(|&v| v < i64::from(i32::MIN) || v > i64::from(i32::MAX))
            {
                return false;
            }
            if score > 0 {
                let prefix = i64::from(d.peel_ceiling) - score;
                if prefix < 0 || prefix * suffix + (N - 1) as i64 > i64::from(i32::MAX) {
                    return false;
                }
            }
        }
    }
    true
}
/// Genuine post-crate state plus the earlier nets snapshot. Partial source writes survive refusal.
pub fn post_repair(
    d: &Definition<'_>,
    shared: &SharedDefinitions<'_>,
    f: &FixedLayout,
    s: &mut State,
    i: &Input<'_>,
    nets: &Nets,
) -> Result<Result<Post, Refusal>, Error> {
    post_repair_impl(d, shared, f, s, i, nets, None)
}
/// As `post_repair`, retaining source operation order and partial progress for differential observers.
pub fn post_repair_with_trace(
    d: &Definition<'_>,
    shared: &SharedDefinitions<'_>,
    f: &FixedLayout,
    s: &mut State,
    i: &Input<'_>,
    nets: &Nets,
    trace: &mut Vec<Trace>,
) -> Result<Result<Post, Refusal>, Error> {
    post_repair_impl(d, shared, f, s, i, nets, Some(trace))
}
fn post_repair_impl(
    d: &Definition<'_>,
    shared: &SharedDefinitions<'_>,
    f: &FixedLayout,
    s: &mut State,
    i: &Input<'_>,
    nets: &Nets,
    mut trace: Option<&mut Vec<Trace>>,
) -> Result<Result<Post, Refusal>, Error> {
    let (zd, cd, sd) = (shared.zones, shared.camps, shared.spawns);
    let margin = sd.landmark_box_margin;
    if !(0..=16).contains(&margin)
        || i.buildings.iter().any(|b| {
            b.x < margin
                || b.y < margin
                || i64::from(b.x) + i64::from(b.w) + i64::from(margin) >= W as i64
                || i64::from(b.y) + i64::from(b.h) + i64::from(margin) >= H as i64
        })
    {
        return Err(Error::Definition);
    }

    validate(d, f, s, i, true)?;
    if nets.before_nets.len() != N {
        return Err(Error::Layers);
    }
    if nets
        .before_nets
        .iter()
        .any(|&t| ![TILE_FLOOR, TILE_WALL, TILE_LOW].contains(&t))
    {
        return Err(Error::Reference);
    }
    if !cd.territory_radius_max.is_finite() || cd.territory_radius_max < 0.0 {
        return Err(Error::Definition);
    }
    if zd.annulus_edge >= W.min(H) / 2
        || !zd.camp_radius.is_finite()
        || zd.camp_radius < 0.0
        || zd.camp_radius.ceil() + 1.0 >= W.min(H) as f64 / 2.0
        || [zd.annulus_lo, zd.annulus_hi]
            .iter()
            .any(|v| !v.is_finite() || *v < 0.0)
        || zd.balance_rounds > 1000
        || !safe_balance_definition(zd)
    {
        return Err(Error::Definition);
    }
    let zc = ZoneContext::from_definition(f, zd);
    let mut keep = vec![0; N];
    for (t, k) in keep.iter_mut().enumerate() {
        if i.protect[t] != 0 || i.landmark_box[t] != 0 {
            *k = 1;
        }
    }
    for &t in i.crates_by_zone.iter().flatten() {
        keep[t] = 1;
    }
    let before = if i.styled { Some(s.zone.clone()) } else { None };
    let rezoned = match repair((d, cd), &zc, f, s, i, &keep, &mut trace) {
        Ok(v) => v,
        Err(e) => return Ok(Err(e)),
    };
    if rezoned > 0 {
        record(&mut trace, "note-rezone", 0, 0, rezoned, &[], s);
        if let Some(before) = before {
            for (t, &old) in before.iter().enumerate() {
                if s.zone[t] == old || s.terrain[t] == 0 {
                    continue;
                }
                if d.terrain_on[s.terrain[t] as usize] != TILE_FLOOR {
                    return Ok(Err(Refusal::RezoneLow));
                }
                s.terrain[t] = 0;
            }
        }
        for (z, crates) in i.crates_by_zone.iter().enumerate() {
            if crates.iter().any(|&t| s.zone[t] as usize != z + 1) {
                return Ok(Err(Refusal::RezoneCrate));
            }
        }
        for b in i.buildings {
            let z = s.zone[b.y as usize * W + b.x as usize];
            for y in b.y - margin..=b.y + b.h - 1 + margin {
                for x in b.x - margin..=b.x + b.w - 1 + margin {
                    if s.zone[y as usize * W + x as usize] != z {
                        return Ok(Err(Refusal::RezoneLandmark));
                    }
                }
            }
        }
        let mut pool_z = [false; ZONES + 1];
        for &t in i.pool {
            pool_z[s.zone[t] as usize] = true;
        }
        if pool_z.iter().filter(|&&v| v).count() < sd.pool_zones {
            return Ok(Err(Refusal::RezonePool));
        }
        for t in 0..N {
            if s.zone[t] != 0 {
                s.region_grid[t] = i.order[s.zone[t] as usize - 1].code();
            }
        }
    }
    let mut infill_tiles = 0;
    for z in 1..=ZONES {
        let list: Vec<_> = f
            .painted
            .iter()
            .copied()
            .filter(|&t| {
                s.tiles[t] == TILE_WALL
                    && nets.before_nets[t] == TILE_FLOOR
                    && s.feature_owner[t] == 0
                    && s.zone[t] as usize == z
            })
            .collect();
        if list.is_empty() {
            continue;
        }
        let id = (s.features.len() + 1) as u16;
        let (mut x0, mut y0, mut x1, mut y1) = (W, H, 0, 0);
        for &t in &list {
            s.feature_owner[t] = id;
            x0 = x0.min(t % W);
            x1 = x1.max(t % W);
            y0 = y0.min(t / W);
            y1 = y1.max(t / W);
        }
        s.features.push(MapFeature {
            kind: FeatureKind::Infill,
            variant: String::new(),
            zone: i.order[z - 1],
            jobs: vec![FeatureJob::Seal],
            ax: (list[0] % W) as i32,
            ay: (list[0] / W) as i32,
            p: Vec::new(),
            bbox: FeatureRect {
                x: x0 as i32,
                y: y0 as i32,
                w: (x1 - x0 + 1) as u32,
                h: (y1 - y0 + 1) as u32,
            },
            tiles: list.len() as u32,
        });
        infill_tiles += list.len();
        record(&mut trace, "note-infill", 0, z, rezoned, &list, s);
    }
    let mut floors = [0; ZONES + 1];
    let mut painted = [0; ZONES + 1];
    for &t in &f.painted {
        painted[s.zone[t] as usize] += 1;
        if s.tiles[t] == TILE_FLOOR {
            floors[s.zone[t] as usize] += 1;
        }
    }
    if f64::from(*floors[1..].iter().max().unwrap())
        > f64::from(*floors[1..].iter().min().unwrap()) * d.floor_share_max
    {
        return Ok(Err(Refusal::FloorShare));
    }
    if painted[1..].iter().max().unwrap() - painted[1..].iter().min().unwrap() > zd.area_tolerance {
        return Ok(Err(Refusal::AreaPost));
    }
    if rezoned > 0 {
        let contact = zones::ring_contact(&zc, &s.zone);
        let slivers = zones::sliver_counts(&zc, &s.zone, &mut vec![0; N]);
        for z in 1..=ZONES {
            if contact[z] < zd.ring_contact_min {
                return Ok(Err(Refusal::RingPost));
            }
            if slivers[z] > zd.sliver_max {
                return Ok(Err(Refusal::SliverPost));
            }
        }
    }
    let mut seen = vec![false; N];
    let mut started = [false; ZONES + 1];
    for &start in &f.painted {
        let z = s.zone[start];
        if s.tiles[start] != TILE_FLOOR || seen[start] {
            continue;
        }
        if started[z as usize] {
            return Ok(Err(Refusal::ZoneFloorSplit));
        }
        started[z as usize] = true;
        let mut queue = vec![start];
        seen[start] = true;
        let mut head = 0;
        while head < queue.len() {
            let t = queue[head];
            head += 1;
            for off in NB4 {
                let j = at(t, off);
                if !seen[j] && s.zone[j] == z && s.tiles[j] == TILE_FLOOR {
                    seen[j] = true;
                    queue.push(j);
                }
            }
        }
    }
    let reach2 = territory_reach2(&zc, i.camps, &s.territory_grid, Some(&s.tiles));
    if reach2
        .iter()
        .skip(1)
        .any(|&r| f64::from(r) > cd.territory_radius_max * cd.territory_radius_max)
    {
        return Ok(Err(Refusal::RadiusPost));
    }
    Ok(Ok(Post {
        rezoned,
        infill_tiles,
        reach2,
    }))
}
#[cfg(test)]
mod tests;
