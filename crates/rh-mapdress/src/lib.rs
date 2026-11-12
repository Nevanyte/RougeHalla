//! Map dressing: a pure function from a generated map and a rule file to props and a ground-variant plane, in the
//! shapes the protocol 17 map blob reserves. Cosmetic only: nothing here is read by the sim, a bot or the certifier.
//!
//! Position unit: WORLD UNITS as `u16` (1 tile = 32 u, the same unit as `MapCamp`), clamped to `u16::MAX`. A prop belongs
//! to the tile `floor(x / 32), floor(y / 32)`; every rule is judged on that tile.
//!
//! Stages, in output order: (1) keep-clear mask, (2) legacy props, (3) signature rings, (4) clusters with clearings,
//! (5) edge dressing, (6) filler. The output lists legacy props first (in `GameMapData.props` order, converted), then
//! ring, cluster, edge and filler props. When the total would pass [`MAX_PROPS`] the list is cut to that length, so later
//! stages lose first.
//!
//! The rule file is in `rules/zones.json`; see [`rules`] for the schema types. Each stage is seeded from `map_hash` and
//! the stage name by hash noise (no RNG state), so a run is byte-identical everywhere. At most one rule-placed prop
//! stands on a tile (legacy props also occupy their tile).
mod hash;
mod mask;
pub mod rules;

use rh_sim::mapdata::{FeatureKind, GameMapData, Zone};
pub use rules::{Against, Rules, TileClass};
use rules::{ClusterRule, ZoneRules};

/// The wire cap on props (`rh_protocol::map::MAX_MAP_PROPS`).
pub const MAX_PROPS: usize = 8192;
/// The prop is drawn tall (fades when a unit stands behind it).
pub const FLAG_TALL: u8 = 1;
/// The prop is a generator `GameMapData.props` entry kept as is: `kind` is the legacy kind index clamped to 255 and not
/// a rule-file code.
pub const FLAG_LEGACY: u8 = 2;

/// Mirrors `rh_protocol::map::MapProp`. `x` and `y` are world units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DressProp {
    pub kind: u8,
    pub x: u16,
    pub y: u16,
    pub variant: u8,
    pub flags: u8,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Dressing {
    pub props: Vec<DressProp>,
    /// Exactly `w * h` bytes, row-major; 0 where no rule set a variant.
    pub ground_variants: Vec<u8>,
}

/// One cluster site chosen by [`cluster_sites`]; `x`, `y` in world units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClusterSite {
    pub zone: Zone,
    /// Index into that zone's `clusters`.
    pub rule: usize,
    pub x: u16,
    pub y: u16,
}

const TILE: f64 = 32.0;
const ZONES: [Zone; 5] = [
    Zone::Fire,
    Zone::Sentenced,
    Zone::Plague,
    Zone::Frost,
    Zone::Holy,
];

/// Stage 1, the general mask: one flag per tile (`w * h`, row-major), true where NO prop may stand. Covers camps
/// (`r` + `campMargin` tiles around the centre), spawns, crate spots, ground spots (the tile holding each point), the
/// coliseum rectangle and each gate tile (+ `coliseumMargin`), and every tile `feature_grid` names a bush feature.
pub fn keep_clear(map: &GameMapData, rules: &Rules) -> Vec<bool> {
    mask::keep_clear(map, rules)
}

/// Stage 1, the extra mask for TALL props only: for each camp, the straight line from its centre to the centre of the
/// nearest coliseum gate (squared world distance on `GateDef.x/y`, first gate on a tie), `corridorWidth` tiles wide
/// (every tile whose centre is within half the width of the line segment, in world units).
pub fn tall_corridor(map: &GameMapData, rules: &Rules) -> Vec<bool> {
    mask::tall_corridor(map, rules)
}

fn class_of(map: &GameMapData, i: usize) -> TileClass {
    match map.tiles[i] {
        1 => TileClass::Wall,
        2 => TileClass::Low,
        _ => match map.terrain.get(i).copied().unwrap_or(0) {
            4 => TileClass::Ember,
            5 => TileClass::Bog,
            6 => TileClass::Ice,
            7 => TileClass::Light,
            _ => TileClass::Floor,
        },
    }
}

/// The anchor of a zone's rings in world units.
fn anchor(map: &GameMapData, zone: Zone, feature: FeatureKind) -> (i64, i64) {
    let mut best: Option<&rh_sim::mapdata::MapFeature> = None;
    for f in &map.features {
        if f.kind == feature && f.zone == zone && best.is_none_or(|b| f.tiles > b.tiles) {
            best = Some(f);
        }
    }
    if let Some(f) = best {
        let b = f.bbox;
        return (
            (i64::from(b.x) * 2 + i64::from(b.w)) * 16,
            (i64::from(b.y) * 2 + i64::from(b.h)) * 16,
        );
    }
    let (mut sx, mut sy, mut n) = (0i64, 0i64, 0i64);
    let w = map.w as usize;
    for (i, r) in map.region_grid.iter().enumerate() {
        if *r == zone.code() {
            sx += (i % w) as i64 * 32 + 16;
            sy += (i / w) as i64 * 32 + 16;
            n += 1;
        }
    }
    if n == 0 {
        (0, 0)
    } else {
        (sx / n, sy / n)
    }
}

/// Shared per-map state of one `dress` run.
struct Grid<'a> {
    map: &'a GameMapData,
    w: usize,
    h: usize,
    clear: Vec<bool>,
    corridor: Vec<bool>,
    occupied: Vec<bool>,
}

impl Grid<'_> {
    fn zone_of(&self, i: usize) -> u8 {
        self.map.region_grid.get(i).copied().unwrap_or(0)
    }
    /// Whether a rule of `zone` may put a prop on tile `i`: right zone, tile class in `on`, outside the keep-clear mask
    /// (and the corridor, for tall kinds), not yet taken.
    fn open(&self, i: usize, zone: Zone, on: &[TileClass], tall: bool) -> bool {
        self.zone_of(i) == zone.code()
            && !self.clear[i]
            && !self.occupied[i]
            && !(tall && self.corridor[i])
            && on.contains(&class_of(self.map, i))
    }
}

fn push(out: &mut Vec<DressProp>, g: &mut Grid, rules: &Rules, kind: u8, pos: (u16, u16), h: u64) {
    let tile = (pos.1 as usize / 32) * g.w + pos.0 as usize / 32;
    g.occupied[tile] = true;
    out.push(DressProp {
        kind,
        x: pos.0,
        y: pos.1,
        variant: ((h >> 40) % 4) as u8,
        flags: if rules.is_tall(kind) { FLAG_TALL } else { 0 },
    });
}

/// World position inside tile `(tx, ty)`: the centre plus a hashed jitter of at most 8 units, still inside the tile.
fn jitter(tx: usize, ty: usize, h: u64) -> (u16, u16) {
    let jx = (h % 17) as i64 - 8;
    let jy = ((h >> 8) % 17) as i64 - 8;
    (
        (tx as i64 * 32 + 16 + jx).clamp(0, 65535) as u16,
        (ty as i64 * 32 + 16 + jy).clamp(0, 65535) as u16,
    )
}

fn sq(v: f64) -> f64 {
    v * v
}

/// The sites of one cluster rule in one zone: lowest noise first, honouring spacing and the clearing share.
fn sites_for(
    g: &Grid,
    zone: Zone,
    ri: usize,
    rule: &ClusterRule,
    map_hash: u64,
    out: &mut Vec<ClusterSite>,
) {
    let map = g.map;
    let seed = hash::stage_seed(map_hash, &rule.name);
    let noise_seed = hash::stage_seed(seed, "site-noise");
    let reach2 = sq(rule.radius * TILE);
    let space2 = sq(rule.min_spacing * TILE);
    // Free floor of the zone, as the clearing share counts it.
    let free: Vec<usize> = (0..g.w * g.h)
        .filter(|&i| g.zone_of(i) == zone.code() && map.tiles[i] == 0 && !g.clear[i])
        .collect();
    if free.is_empty() {
        return;
    }
    let mut covered = vec![false; g.w * g.h];
    let mut uncovered = free.len();
    let mut cand: Vec<(u32, usize)> = free
        .iter()
        .copied()
        .filter(|&i| rule.on.contains(&class_of(map, i)))
        .map(|i| {
            (
                hash::value_noise(noise_seed, (i % g.w) as u32, (i / g.w) as u32),
                i,
            )
        })
        .collect();
    cand.sort_unstable();
    let mut mine: Vec<(f64, f64)> = Vec::new();
    let reach_t = rule.radius.ceil() as i64 + 1;
    for (_, i) in cand {
        if mine.len() >= rule.sites as usize {
            break;
        }
        let (tx, ty) = ((i % g.w) as i64, (i / g.w) as i64);
        let (sx, sy) = (tx as f64 * TILE + 16.0, ty as f64 * TILE + 16.0);
        if mine
            .iter()
            .any(|(ox, oy)| sq(ox - sx) + sq(oy - sy) < space2)
        {
            continue;
        }
        // Tiles this site would newly cover.
        let mut newly: Vec<usize> = Vec::new();
        for y in (ty - reach_t).max(0)..=(ty + reach_t).min(g.h as i64 - 1) {
            for x in (tx - reach_t).max(0)..=(tx + reach_t).min(g.w as i64 - 1) {
                let j = y as usize * g.w + x as usize;
                if covered[j] || g.zone_of(j) != zone.code() || map.tiles[j] != 0 || g.clear[j] {
                    continue;
                }
                let (cx, cy) = (x as f64 * TILE + 16.0, y as f64 * TILE + 16.0);
                if sq(cx - sx) + sq(cy - sy) <= reach2 {
                    newly.push(j);
                }
            }
        }
        let left = uncovered - newly.len();
        if (left as f64) / (free.len() as f64) < rule.clearing {
            continue;
        }
        uncovered = left;
        for j in newly {
            covered[j] = true;
        }
        mine.push((sx, sy));
        out.push(ClusterSite {
            zone,
            rule: ri,
            x: (sx as i64).clamp(0, 65535) as u16,
            y: (sy as i64).clamp(0, 65535) as u16,
        });
    }
}

fn all_sites(g: &Grid, map_hash: u64, rules: &Rules) -> Vec<ClusterSite> {
    let mut out = Vec::new();
    for zone in ZONES {
        let Some(z) = rules.zone(zone) else { continue };
        for (ri, rule) in z.clusters.iter().enumerate() {
            sites_for(g, zone, ri, rule, map_hash, &mut out);
        }
    }
    out
}

fn new_grid<'a>(map: &'a GameMapData, rules: &Rules) -> Grid<'a> {
    let (w, h) = (map.w as usize, map.h as usize);
    Grid {
        map,
        w,
        h,
        clear: keep_clear(map, rules),
        corridor: tall_corridor(map, rules),
        occupied: vec![false; w * h],
    }
}

/// The sites stage 4 uses, in the order it creates them (zones fire..holy, rules in file order, lowest noise first).
/// `dress` places cluster members around exactly these.
pub fn cluster_sites(map: &GameMapData, map_hash: u64, rules: &Rules) -> Vec<ClusterSite> {
    all_sites(&new_grid(map, rules), map_hash, rules)
}

fn is_against(map: &GameMapData, tx: i64, ty: i64, against: &[Against]) -> bool {
    let (w, h) = (i64::from(map.w), i64::from(map.h));
    if tx < 0 || ty < 0 || tx >= w || ty >= h {
        return false;
    }
    let i = (ty * w + tx) as usize;
    against.iter().any(|a| match a {
        Against::Wall => map.tiles.get(i) == Some(&1),
        Against::Low => map.tiles.get(i) == Some(&2),
        Against::Border => [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().any(|(dx, dy)| {
            let (nx, ny) = (tx + dx, ty + dy);
            nx >= 0
                && ny >= 0
                && nx < w
                && ny < h
                && map.region_grid.get((ny * w + nx) as usize) != map.region_grid.get(i)
        }),
    })
}

fn legacy(map: &GameMapData) -> Vec<DressProp> {
    let q = |v: f64| v.round().clamp(0.0, 65535.0) as u16;
    map.props
        .iter()
        .map(|p| DressProp {
            kind: p.kind.min(255) as u8,
            x: q(p.x),
            y: q(p.y),
            variant: p.v,
            flags: FLAG_LEGACY,
        })
        .collect()
}

/// Stage 3 for one zone: ground variants and ring props.
fn rings(
    g: &mut Grid,
    z: &ZoneRules,
    rules: &Rules,
    map_hash: u64,
    ground: &mut [u8],
    out: &mut Vec<DressProp>,
) {
    let zone = z.zone;
    let (ax, ay) = anchor(g.map, zone, z.signature_feature);
    let (ax, ay) = (ax as f64, ay as f64);
    let w = g.w;
    let d2_of = move |i: usize| {
        let (cx, cy) = ((i % w) as f64 * TILE + 16.0, (i / w) as f64 * TILE + 16.0);
        sq(cx - ax) + sq(cy - ay)
    };
    let in_band = |d2: f64, inner: f64, outer: f64| d2 >= sq(inner * TILE) && d2 < sq(outer * TILE);
    for (i, slot) in ground.iter_mut().enumerate() {
        if g.zone_of(i) != zone.code() || g.map.tiles[i] != 0 {
            continue;
        }
        let d2 = d2_of(i);
        if let Some(r) = z.rings.iter().find(|r| in_band(d2, r.inner, r.outer)) {
            *slot = r.ground_variant;
        }
    }
    for ring in &z.rings {
        let seed = hash::stage_seed(map_hash, &ring.name);
        for (pi, p) in ring.props.iter().enumerate() {
            let thr = hash::threshold(p.density);
            let tall = rules.is_tall(p.kind);
            for i in 0..g.w * g.h {
                if !g.open(i, zone, &ring.on, tall) || !in_band(d2_of(i), ring.inner, ring.outer) {
                    continue;
                }
                let h = hash::at(seed, i as u64, pi as u64, 1);
                if h % 10_000 < thr {
                    let pos = jitter(i % g.w, i / g.w, h >> 16);
                    push(out, g, rules, p.kind, pos, h);
                }
            }
        }
    }
}

/// Stage 4: members around the sites.
fn clusters(
    g: &mut Grid,
    rules: &Rules,
    map_hash: u64,
    sites: &[ClusterSite],
    out: &mut Vec<DressProp>,
) {
    for s in sites {
        let Some(z) = rules.zone(s.zone) else {
            continue;
        };
        let rule = &z.clusters[s.rule];
        let seed = hash::stage_seed(map_hash, &rule.name);
        let reach2 = sq(rule.radius * TILE);
        let (stx, sty) = (i64::from(s.x) / 32, i64::from(s.y) / 32);
        let reach_t = rule.radius.ceil() as i64;
        let key = (u64::from(s.x) << 16) | u64::from(s.y);
        let members = u64::from(rule.members);
        // Between half and all of the member budget, so sites differ in size.
        let target = members / 2 + hash::at(seed, key, 0, 2) % (members - members / 2 + 1);
        let side = (2 * reach_t + 1) as u64;
        let mut placed = 0u64;
        for a in 0..target * 4 {
            if placed >= target {
                break;
            }
            let h = hash::at(seed, key, a + 1, 3);
            let tx = stx - reach_t + (h % side) as i64;
            let ty = sty - reach_t + ((h >> 20) % side) as i64;
            if tx < 0 || ty < 0 || tx >= g.w as i64 || ty >= g.h as i64 {
                continue;
            }
            let i = ty as usize * g.w + tx as usize;
            let kind = rule.kinds[((h >> 40) % rule.kinds.len() as u64) as usize];
            if !g.open(i, s.zone, &rule.on, rules.is_tall(kind)) {
                continue;
            }
            let pos = jitter(tx as usize, ty as usize, h >> 8);
            if sq(f64::from(pos.0) - f64::from(s.x)) + sq(f64::from(pos.1) - f64::from(s.y))
                > reach2
            {
                continue;
            }
            push(out, g, rules, kind, pos, h);
            placed += 1;
        }
    }
}

/// Stage 5 for one zone: props within the rule's distance of walls, low tiles or zone borders.
fn edges(g: &mut Grid, z: &ZoneRules, rules: &Rules, map_hash: u64, out: &mut Vec<DressProp>) {
    for rule in &z.edges {
        let seed = hash::stage_seed(map_hash, &rule.name);
        let thr = hash::threshold(rule.density);
        let d = i64::from(rule.distance);
        for i in 0..g.w * g.h {
            let pick = hash::at(seed, i as u64, 0, 4) % rule.kinds.len() as u64;
            let kind = rule.kinds[pick as usize];
            if !g.open(i, z.zone, &rule.on, rules.is_tall(kind)) {
                continue;
            }
            let (tx, ty) = ((i % g.w) as i64, (i / g.w) as i64);
            let hugs = (-d..=d)
                .any(|dy| (-d..=d).any(|dx| is_against(g.map, tx + dx, ty + dy, &rule.against)));
            if !hugs {
                continue;
            }
            let h = hash::at(seed, i as u64, 0, 5);
            if h % 10_000 < thr {
                let pos = jitter(tx as usize, ty as usize, h >> 16);
                push(out, g, rules, kind, pos, h);
            }
        }
    }
}

/// Stage 6 for one zone: sparse clutter on what is left.
fn fillers(g: &mut Grid, z: &ZoneRules, rules: &Rules, map_hash: u64, out: &mut Vec<DressProp>) {
    for rule in &z.fillers {
        let seed = hash::stage_seed(map_hash, &rule.name);
        let thr = hash::threshold(rule.density);
        for i in 0..g.w * g.h {
            let pick = hash::at(seed, i as u64, 0, 6) % rule.kinds.len() as u64;
            let kind = rule.kinds[pick as usize];
            if !g.open(i, z.zone, &rule.on, rules.is_tall(kind)) {
                continue;
            }
            let h = hash::at(seed, i as u64, 0, 7);
            if h % 10_000 < thr {
                let pos = jitter(i % g.w, i / g.w, h >> 16);
                push(out, g, rules, kind, pos, h);
            }
        }
    }
}

/// The dressing of `map`: legacy props first, then rings, clusters, edges and filler, cut to [`MAX_PROPS`].
pub fn dress(map: &GameMapData, map_hash: u64, rules: &Rules) -> Dressing {
    let mut g = new_grid(map, rules);
    let mut ground = vec![0u8; g.w * g.h];
    let mut props = legacy(map);
    props.truncate(MAX_PROPS);
    for p in &props {
        let (tx, ty) = (p.x as usize / 32, p.y as usize / 32);
        if tx < g.w && ty < g.h {
            g.occupied[ty * g.w + tx] = true;
        }
    }
    for z in &rules.zones {
        rings(&mut g, z, rules, map_hash, &mut ground, &mut props);
    }
    let sites = all_sites(&g, map_hash, rules);
    clusters(&mut g, rules, map_hash, &sites, &mut props);
    for z in &rules.zones {
        edges(&mut g, z, rules, map_hash, &mut props);
    }
    for z in &rules.zones {
        fillers(&mut g, z, rules, map_hash, &mut props);
    }
    props.truncate(MAX_PROPS);
    Dressing {
        props,
        ground_variants: ground,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rh_sim::mapgen::{coliseum, pipeline};

    #[test]
    fn a_short_region_grid_cannot_panic_the_border_test() {
        let fixed = coliseum::fixed_layout();
        let mut map = pipeline::Pipeline::new(&fixed)
            .certified_styled(1, pipeline::Options::default())
            .expect("generator runs")
            .expect("seed 1 certifies");
        map.region_grid.truncate(3);
        map.tiles.truncate(3);
        let all = [Against::Wall, Against::Low, Against::Border];
        for ty in 0..i64::from(map.h) {
            for tx in 0..i64::from(map.w) {
                let _ = is_against(&map, tx, ty, &all);
            }
        }
    }
}
