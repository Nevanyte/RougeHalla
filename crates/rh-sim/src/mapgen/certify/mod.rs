#![allow(clippy::needless_range_loop)]
//! Independent hard-map certification. Reads only the finished DTO; no generator
//! validation, placement bookkeeping or repair routines are used. Report-only
//! ray/engagement/graph windows deliberately do not participate in acceptance.
// Row-major geometric scans deliberately index several independent layers.
use crate::mapdata::*;
use crate::{map::TileMap, math::Vec2, pathfind::Pathfinder};
mod diagnostics;
mod features;
#[cfg(test)]
mod inventory;
mod labels;
mod numeric;

/// Source-order two-argument `Math.hypot` for finite coordinate pairs.
///
/// Reuses certification's existing scaled compensated sum. Source-sensitive policy predicates may
/// need its final bit rather than the platform-independent libm approximation; global sim math and
/// certification callers keep their existing behavior. This is not a nonfinite-input JS shim.
#[inline]
pub fn source_hypot(a: f64, b: f64) -> f64 {
    numeric::hypot(a, b)
}
#[cfg(test)]
mod review_expected;
pub mod rules;
mod terrain;
#[cfg(test)]
mod tests;
use rules::R;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Strict {
    #[default]
    Auto,
    None,
    All,
    Zones(Vec<Zone>),
}
#[derive(Clone, Debug, Default)]
pub struct Options {
    pub styled: bool,
    pub zone: bool,
    pub strict: Strict,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    Dimensions,
    Layers,
    Budget,
    Coordinates,
    Rectangle,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub rule: &'static str,
    pub subject: String,
    pub message: String,
    pub record_index: Option<usize>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Certificate {
    pub failures: Vec<Failure>,
    pub strict_zones: Vec<u8>,
}
impl Certificate {
    fn check(&mut self, rule: &'static str, subject: impl Into<String>, ok: bool) {
        if !ok {
            self.failures.push(Failure {
                rule,
                subject: subject.into(),
                message: String::new(),
                record_index: None,
            });
        }
    }
}
use rules::ZONES;
fn point(x: f64, y: f64) -> WorldPt {
    WorldPt { x, y }
}
fn cp(c: &CampDef) -> WorldPt {
    point(c.x, c.y)
}
fn sp(s: &ZoneSpawn) -> WorldPt {
    point(s.x, s.y)
}
fn xy(p: WorldPt) -> (i32, i32) {
    ((p.x / R.tile).floor() as i32, (p.y / R.tile).floor() as i32)
}
fn tile(p: WorldPt) -> usize {
    let (x, y) = xy(p);
    y as usize * R.size + x as usize
}
fn centered(p: WorldPt) -> bool {
    let (x, y) = xy(p);
    p.x == (f64::from(x) + 0.5) * R.tile && p.y == (f64::from(y) + 0.5) * R.tile
}
fn dist(a: WorldPt, b: WorldPt) -> f64 {
    numeric::hypot(a.x - b.x, a.y - b.y)
}

fn inside(b: &TileRect, x: i32, y: i32) -> bool {
    x >= b.x
        && y >= b.y
        && i64::from(x) < i64::from(b.x) + i64::from(b.w)
        && i64::from(y) < i64::from(b.y) + i64::from(b.h)
}
fn at(x: i32, y: i32) -> Option<usize> {
    (x >= 0 && y >= 0 && x < R.size as i32 && y < R.size as i32)
        .then(|| y as usize * R.size + x as usize)
}
fn offset(i: usize, dx: i32, dy: i32) -> Option<usize> {
    at((i % R.size) as i32 + dx, (i / R.size) as i32 + dy)
}
fn floor(m: &GameMapData, i: Option<usize>) -> bool {
    i.is_some_and(|i| m.tiles[i] == 0)
}
fn square(i: usize, r: i32) -> impl Iterator<Item = Option<usize>> {
    (-r..=r).flat_map(move |dy| (-r..=r).map(move |dx| offset(i, dx, dy)))
}
fn cheb(a: usize, b: usize) -> usize {
    (a % R.size)
        .abs_diff(b % R.size)
        .max((a / R.size).abs_diff(b / R.size))
}
fn components(ok: impl Fn(usize) -> bool, eight: bool) -> (Vec<usize>, Vec<i32>) {
    let n = R.size * R.size;
    let mut labels = vec![-1; n];
    let mut sizes = Vec::new();
    let mut stack = Vec::with_capacity(n);
    for s in 0..n {
        if labels[s] >= 0 || !ok(s) {
            continue;
        }
        let label = sizes.len() as i32;
        let mut size = 0;
        labels[s] = label;
        stack.push(s);
        while let Some(i) = stack.pop() {
            size += 1;
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    if (dx == 0 && dy == 0) || (!eight && dx != 0 && dy != 0) {
                        continue;
                    }
                    if let Some(j) = offset(i, dx, dy) {
                        if labels[j] < 0 && ok(j) {
                            labels[j] = label;
                            stack.push(j);
                        }
                    }
                }
            }
        }
        sizes.push(size);
    }
    (sizes, labels)
}
fn protected(m: &GameMapData) -> (Vec<bool>, Vec<bool>) {
    let n = R.size * R.size;
    let mut halo = vec![false; n];
    let mut pad = vec![false; n];
    for c in &m.camps {
        let t = tile(cp(c));
        for dy in -R.protection_span..=R.protection_span {
            for dx in -R.protection_span..=R.protection_span {
                let near = (-R.halo..=R.halo).any(|oy| {
                    (-R.halo..=R.halo).any(|ox| {
                        f64::from((dx + ox) * (dx + ox) + (dy + oy) * (dy + oy))
                            <= R.clearing * R.clearing
                    })
                });
                if near {
                    if let Some(j) = offset(t, dx, dy) {
                        halo[j] = true;
                    }
                }
            }
        }
    }
    for s in &m.spawn_pool {
        for j in square(tile(sp(s)), R.spawn_pad).flatten() {
            pad[j] = true;
        }
    }
    (halo, pad)
}
fn admit(m: &GameMapData) -> Result<(), Refusal> {
    if m.w != R.size as u32 || m.h != R.size as u32 {
        return Err(Refusal::Dimensions);
    }
    let n = R.size * R.size;
    if [
        &m.tiles,
        &m.terrain,
        &m.region_grid,
        &m.territory_grid,
        &m.feature_grid,
    ]
    .iter()
    .any(|a| a.len() != n)
    {
        return Err(Refusal::Layers);
    }
    if m.camps.len() > 255
        || m.features.len() > 255
        || m.regions.len() > 16
        || m.buildings.len() > 255
        || m.spawn_pool.len() > 256
        || m.spawns.len() > 256
        || m.crate_spots.len() > 256
        || m.ground_spots.len() > 256
        || m.coliseum.gates.len() > 16
        || m.coliseum.inner_spawns.len() > 256
        || m.props.len() > n
    {
        return Err(Refusal::Budget);
    }
    if m.camps.len() + m.regions.iter().map(|r| r.mob_camps.len()).sum::<usize>() > R.max_metadata {
        return Err(Refusal::Budget);
    }
    let good = |p: WorldPt| {
        p.x.is_finite()
            && p.y.is_finite()
            && p.x >= 0.0
            && p.y >= 0.0
            && p.x < R.size as f64 * R.tile
            && p.y < R.size as f64 * R.tile
    };
    let rect = |b: &TileRect| {
        b.x >= 0
            && b.y >= 0
            && u64::from(b.w) <= R.size as u64
            && u64::from(b.h) <= R.size as u64
            && i64::from(b.x) + i64::from(b.w) <= R.size as i64
            && i64::from(b.y) + i64::from(b.h) <= R.size as i64
    };
    if !good(m.coliseum.centre) || !rect(&m.coliseum.rect) {
        return Err(Refusal::Coordinates);
    }
    if m.coliseum.gates.iter().any(|g| {
        g.tiles.len() > 256
            || !g.x.is_finite()
            || !g.y.is_finite()
            || g.tiles.iter().any(|p| at(p.x, p.y).is_none())
    }) {
        return Err(Refusal::Coordinates);
    }
    for c in &m.camps {
        if c.spots.len() > 256 || c.id.len() > 256 {
            return Err(Refusal::Budget);
        }
        if !good(cp(c))
            || !good(c.chest)
            || !c.r.is_finite()
            || c.r < 0.0
            || c.r > R.tile * R.max_camp_radius_tiles
            || !c.radius.is_finite()
            || c.spots.iter().any(|p| !good(*p))
        {
            return Err(Refusal::Coordinates);
        }
    }
    for r in &m.regions {
        if r.spawns.len() > 256 || r.chest_spots.len() > 256 || r.mob_camps.len() > 255 {
            return Err(Refusal::Budget);
        }
        if !good(r.pole) || r.spawns.iter().chain(&r.chest_spots).any(|p| !good(*p)) {
            return Err(Refusal::Coordinates);
        }
        for c in &r.mob_camps {
            if c.spots.len() > 256 || c.id.len() > 256 {
                return Err(Refusal::Budget);
            }
            if !good(point(c.x, c.y))
                || !c.r.is_finite()
                || c.r < 0.0
                || c.r > R.tile * R.max_camp_radius_tiles
                || c.spots.iter().any(|p| !good(*p))
            {
                return Err(Refusal::Coordinates);
            }
        }
    }
    if m.spawn_pool.iter().any(|s| !good(sp(s)))
        || m.spawns
            .iter()
            .chain(&m.crate_spots)
            .chain(&m.ground_spots)
            .chain(&m.coliseum.inner_spawns)
            .any(|p| !good(*p))
    {
        return Err(Refusal::Coordinates);
    }
    if m.buildings.iter().any(|b| !rect(b)) || m.features.iter().any(|f| !rect(&f.bbox)) {
        return Err(Refusal::Rectangle);
    }
    if m.features
        .iter()
        .fold(0usize, |total, f| total.saturating_add(f.p.len()))
        > n
    {
        return Err(Refusal::Budget);
    }
    if m.features
        .iter()
        .any(|f| f.p.len() > n || f.jobs.len() > 256 || f.variant.len() > 256)
    {
        return Err(Refusal::Budget);
    }
    Ok(())
}
/// Certify a bounded finished map. Admission refusals describe malformed or
/// oversized inputs, never a certificate. All accepted inputs are read-only.
pub fn certify(m: &GameMapData, o: &Options) -> Result<Certificate, Refusal> {
    admit(m)?;
    if matches!(&o.strict,Strict::Zones(z) if z.len()>R.max_strict_codes) {
        return Err(Refusal::Budget);
    }
    let strict = match &o.strict {
        Strict::None => vec![],
        Strict::All => vec![1, 2, 3, 4, 5],
        Strict::Auto => {
            if o.zone && R.auto_strict != 0 {
                vec![1, 2, 3, 4, 5]
            } else {
                vec![]
            }
        }
        Strict::Zones(z) => z.iter().map(|z| z.code()).collect(),
    };
    let mut out = Certificate {
        failures: vec![],
        strict_zones: strict,
    };
    let n = R.size * R.size;
    let centre = tile(m.coliseum.centre);
    let zone = |c: u8| (1..=5).contains(&c);
    let walk = |i: usize| m.tiles[i] == 0;
    out.check(
        "grid",
        "",
        (0..n).all(|i| {
            let border = i % R.size == 0
                || i % R.size == R.size - 1
                || i / R.size == 0
                || i / R.size == R.size - 1;
            m.tiles[i] <= 2
                && if border {
                    m.tiles[i] == 1 && m.region_grid[i] == 0
                } else {
                    (1..=6).contains(&m.region_grid[i])
                }
        }),
    );
    let (open, labels) = components(walk, false);
    out.check("open-connectivity", "", open.len() == 1);
    let mut gates = vec![false; n];
    for g in &m.coliseum.gates {
        for t in &g.tiles {
            gates[at(t.x, t.y).unwrap()] = true;
        }
    }
    let (closed, cl) = components(|i| walk(i) && !gates[i], false);
    out.check(
        "closed-connectivity",
        "",
        walk(centre)
            && !gates[centre]
            && closed.len() == 2
            && (0..n).all(|i| {
                !(cl[i] == cl[centre] && m.region_grid[i] != 6)
                    && !(walk(i) && !gates[i] && m.region_grid[i] == 6 && cl[i] != cl[centre])
            }),
    );
    let sides = [
        GateSide::North,
        GateSide::East,
        GateSide::South,
        GateSide::West,
    ];
    let mut gates_ok = m.coliseum.gates.iter().map(|g| g.side).eq(sides)
        && gates.iter().filter(|v| **v).count() == R.gates * R.gate_width;
    let mut lanes = true;
    let mut keep = vec![false; n];
    keep[centre] = true;
    for g in &m.coliseum.gates {
        let horizontal = matches!(g.side, GateSide::North | GateSide::South);
        let (ox, oy) = match g.side {
            GateSide::North => (0, -1),
            GateSide::East => (1, 0),
            GateSide::South => (0, 1),
            GateSide::West => (-1, 0),
        };
        gates_ok &= g.tiles.len() == R.gate_width;
        if let Some(first) = g.tiles.first() {
            for (k, t) in g.tiles.iter().enumerate() {
                gates_ok &= if horizontal {
                    t.y == first.y && t.x == first.x + k as i32
                } else {
                    t.x == first.x && t.y == first.y + k as i32
                };
                let i = at(t.x, t.y).unwrap();
                gates_ok &= m.tiles[i] == 0 && m.region_grid[i] == 6;
                for depth in -R.gate_lane..=R.gate_lane {
                    if depth != 0 {
                        lanes &= floor(m, at(t.x + ox * depth, t.y + oy * depth));
                    }
                    if depth > 0 {
                        if let Some(j) = at(t.x - ox * depth, t.y - oy * depth) {
                            keep[j] = true;
                        }
                    }
                }
            }
            let sx = g
                .tiles
                .iter()
                .map(|t| (f64::from(t.x) + 0.5) * R.tile)
                .sum::<f64>()
                / R.gate_width as f64;
            let sy = g
                .tiles
                .iter()
                .map(|t| (f64::from(t.y) + 0.5) * R.tile)
                .sum::<f64>()
                / R.gate_width as f64;
            gates_ok &= (sx - g.x).abs() <= R.eps && (sy - g.y).abs() <= R.eps;
            let last = g.tiles.get(R.gate_width - 1).unwrap_or(first);
            let ux = (last.x - first.x).signum();
            let uy = (last.y - first.y).signum();
            for (e, d) in [(first, -1), (last, 1)] {
                for k in 1..=R.gate_lane {
                    lanes &= floor(m, at(e.x + ox * k + ux * d, e.y + oy * k + uy * d));
                }
            }
        }
    }
    out.check("gates", "", gates_ok);
    out.check(
        "arena-links",
        "",
        (0..n).all(|i| {
            !walk(i)
                || m.region_grid[i] != 6
                || gates[i]
                || [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().all(|&(dx, dy)| {
                    offset(i, dx, dy).is_none_or(|j| !walk(j) || m.region_grid[j] == 6)
                })
        }),
    );
    out.check("gate-lanes", "", lanes);
    let rc = &m.coliseum.rect;
    let mut shape = 2 * i64::from(rc.x) + i64::from(rc.w) == R.size as i64
        && 2 * i64::from(rc.y) + i64::from(rc.h) == R.size as i64;
    let coli = |i: Option<usize>| i.is_some_and(|i| m.region_grid[i] == 6);
    for i in 0..n {
        let x = i % R.size;
        let y = i / R.size;
        let c = m.region_grid[i] == 6;
        shape &= c == coli(Some(y * R.size + R.size - 1 - x))
            && c == coli(Some((R.size - 1 - y) * R.size + x))
            && c == coli(Some(x * R.size + y));
        if c {
            shape &= inside(rc, x as i32, y as i32);
            if square(i, 1).any(|j| !coli(j)) {
                shape &= m.tiles[i] == 1 || gates[i];
            }
        }
    }
    out.check("coliseum-footprint", "", shape);
    let (cx, cy) = xy(m.coliseum.centre);
    let mut inner = centered(m.coliseum.centre)
        && [R.size as i32 / 2 - 1, R.size as i32 / 2].contains(&cx)
        && [R.size as i32 / 2 - 1, R.size as i32 / 2].contains(&cy)
        && m.coliseum.inner_spawns.len() >= R.players;
    for &p in &m.coliseum.inner_spawns {
        let t = tile(p);
        inner &= centered(p) && m.region_grid[t] == 6 && cl[t] == cl[centre];
        for j in square(t, 1) {
            if let Some(j) = j {
                keep[j] = true;
                inner &= walk(j) && !gates[j];
            } else {
                inner = false
            }
        }
    }
    let mut pillars = 0;
    for i in 0..n {
        if m.tiles[i] == 1 && square(i, 1).all(coli) {
            pillars += 1;
            inner &= !keep[i];
        }
    }
    out.check("coliseum-interior", "", inner && pillars > 0);
    let mut painted = [0usize; 5];
    let mut floors = [0usize; 5];
    for i in 0..n {
        if zone(m.region_grid[i]) {
            let z = m.region_grid[i] as usize - 1;
            painted[z] += 1;
            if walk(i) {
                floors[z] += 1;
            }
        }
    }
    out.check(
        "zone-connectivity",
        "",
        (1..=5).all(|z| components(|i| m.region_grid[i] == z, false).0.len() == 1),
    );
    out.check(
        "zone-area",
        "",
        painted.iter().max().unwrap() - painted.iter().min().unwrap() <= R.area_spread,
    );
    out.check(
        "zone-floor-share",
        "",
        *floors.iter().max().unwrap() as f64
            <= R.floor_share * *floors.iter().min().unwrap() as f64,
    );
    let mut ring = vec![255u8; n];
    for i in 0..n {
        if m.region_grid[i] == 6 {
            for dy in -R.ring..=R.ring {
                for dx in -R.ring..=R.ring {
                    if let Some(j) = offset(i, dx, dy) {
                        ring[j] = ring[j].min(dx.abs().max(dy.abs()) as u8);
                    }
                }
            }
        }
    }
    out.check(
        "ring-contact",
        "",
        (1..=5).all(|z| {
            (0..n)
                .filter(|&i| m.region_grid[i] == z && (1..=R.ring as u8).contains(&ring[i]))
                .count()
                >= R.ring_contact
        }),
    );
    out.check(
        "zone-slivers",
        "",
        (1..=5).all(|z| slivers(m, z) <= R.slivers),
    );
    out.check(
        "ring-floor",
        "",
        components(|i| (1..=R.ring as u8).contains(&ring[i]) && walk(i), false)
            .0
            .len()
            == 1
            && (1..=5).all(|z| {
                (0..n).any(|i| {
                    m.region_grid[i] == z && (1..=R.ring as u8).contains(&ring[i]) && walk(i)
                })
            }),
    );
    camps(m, &ring, &mut out);
    let tm = TileMap::new(m.w, m.h, m.tiles.clone()).map_err(|_| Refusal::Layers)?;
    spawns(m, &tm, &mut out);
    views(m, &painted, &mut out);
    features::check(m, &mut out);
    loot(m, &ring, &mut out);
    terrain::check(m, o, &mut out);
    let mut points = Vec::new();
    points.extend(m.coliseum.inner_spawns.iter().copied());
    points.extend(m.regions.iter().map(|r| r.pole));
    points.extend(m.spawn_pool.iter().map(sp));
    points.extend(m.crate_spots.iter().chain(&m.ground_spots).copied());
    for c in &m.camps {
        points.extend([cp(c), c.chest]);
        points.extend(c.spots.iter().copied());
    }
    out.check(
        "reachability",
        "",
        points.iter().all(|p| labels[tile(*p)] == labels[centre]),
    );
    if o.zone {
        out.check(
            "zone-terrain-home",
            "",
            (0..n).all(|i| {
                m.terrain[i] == 0
                    || rules::TERRAIN
                        .get(m.terrain[i] as usize)
                        .is_some_and(|t| t.1 == m.region_grid[i])
            }),
        );
        out.check(
            "zone-floor-connectivity",
            "",
            (1..=5).all(|z| {
                components(|i| m.region_grid[i] == z && walk(i), false)
                    .0
                    .len()
                    == 1
            }),
        );
    }
    for i in 0..out.failures.len() {
        out.failures[i].message = diagnostics::message(m, o, &out.failures[i], &out.strict_zones);
    }
    Ok(out)
}
fn slivers(m: &GameMapData, z: u8) -> usize {
    let n = R.size * R.size;
    let mut covered = vec![false; n];
    for i in 0..n {
        if m.region_grid[i] != z {
            continue;
        }
        let mut fits = true;
        for dy in -3i32..=3 {
            for dx in -3i32..=3 {
                let qx = (f64::from(dx.abs()) - 0.5).max(0.0);
                let qy = (f64::from(dy.abs()) - 0.5).max(0.0);
                if qx * qx + qy * qy < R.clearing * R.clearing
                    && offset(i, dx, dy).is_none_or(|j| m.region_grid[j] != z)
                {
                    fits = false;
                }
            }
        }
        if fits {
            for dy in -R.clearing_cover_span..=R.clearing_cover_span {
                for dx in -R.clearing_cover_span..=R.clearing_cover_span {
                    if f64::from(dx * dx + dy * dy) <= R.clearing * R.clearing {
                        if let Some(j) = offset(i, dx, dy) {
                            covered[j] = true;
                        }
                    }
                }
            }
        }
    }
    (0..n)
        .filter(|&i| m.region_grid[i] == z && !covered[i])
        .count()
}
fn camps(m: &GameMapData, ring: &[u8], out: &mut Certificate) {
    let n = R.size * R.size;
    let cs = &m.camps;
    out.check(
        "camp-count",
        "",
        ZONES.iter().all(|z| {
            cs.iter().filter(|c| c.zone == *z).count() == R.camps
                && cs
                    .iter()
                    .filter(|c| c.zone == *z && c.elite_spot >= 0)
                    .count()
                    == R.elites
        }),
    );
    let mut seen = [0; 5];
    let mut last = 0;
    let mut order = true;
    for c in cs {
        let z = c.zone.code();
        seen[z as usize - 1] += 1;
        order &= z >= last && c.id == format!("{}-{}", c.zone.as_str(), seen[z as usize - 1]);
        last = z;
    }
    out.check("camp-order", "", order);
    out.check(
        "camp-spacing",
        "",
        cs.iter().enumerate().all(|(i, a)| {
            cs[i + 1..]
                .iter()
                .all(|b| dist(cp(a), cp(b)) >= R.camp_gap * R.tile - R.eps)
        }),
    );
    out.check(
        "territory-partition",
        "",
        (0..n).all(|i| {
            let z = m.region_grid[i];
            let t = m.territory_grid[i] as usize;
            if (1..=5).contains(&z) {
                t > 0 && cs.get(t - 1).is_some_and(|c| c.zone.code() == z)
            } else {
                t == 0
            }
        }),
    );
    for (ci, c) in cs.iter().enumerate() {
        let failure_start = out.failures.len();
        let t = tile(cp(c));
        let clear: Vec<usize> = (-R.camp_span..=R.camp_span)
            .flat_map(|dy| {
                (-R.camp_span..=R.camp_span).filter_map(move |dx| {
                    if numeric::hypot(f64::from(dx) * R.tile, f64::from(dy) * R.tile) <= c.r + R.eps
                    {
                        offset(t, dx, dy)
                    } else {
                        None
                    }
                })
            })
            .collect();
        let mut halo = Vec::new();
        for &j in &clear {
            halo.extend(square(j, R.halo));
        }
        out.check(
            "camp-centre",
            c.id.clone(),
            centered(cp(c))
                && c.r == R.clearing * R.tile
                && tile(c.chest) == t
                && centered(c.chest),
        );
        out.check(
            "camp-halo",
            c.id.clone(),
            halo.iter().all(|j| {
                j.is_some_and(|j| {
                    m.tiles[j] == 0
                        && m.territory_grid[j] as usize == ci + 1
                        && ring[j] > R.ring as u8
                })
            }),
        );
        let st: Vec<usize> = c.spots.iter().map(|p| tile(*p)).collect();
        out.check(
            "camp-spots",
            c.id.clone(),
            (R.spots_min..=R.spots_max).contains(&st.len())
                && st
                    .iter()
                    .enumerate()
                    .all(|(i, j)| clear.contains(j) && *j != tile(c.chest) && !st[..i].contains(j))
                && c.spots.iter().all(|p| centered(*p)),
        );
        out.check(
            "camp-elite-spot",
            c.id.clone(),
            c.elite_spot == -1
                || (c.elite_spot == 0
                    && c.spots.first().is_some_and(|p| {
                        c.spots
                            .iter()
                            .all(|q| dist(*p, cp(c)) <= dist(*q, cp(c)) + R.eps)
                    })),
        );
        out.check(
            "territory-connectivity",
            c.id.clone(),
            components(
                |i| m.tiles[i] == 0 && m.territory_grid[i] as usize == ci + 1,
                false,
            )
            .0
            .len()
                == 1,
        );
        let mut area = 0;
        let mut far: f64 = 0.0;
        let (cx, cy) = xy(cp(c));
        for i in 0..n {
            if m.territory_grid[i] as usize == ci + 1 && m.tiles[i] == 0 {
                area += 1;
                let dx = i as i32 % R.size as i32 - cx;
                let dy = i as i32 / R.size as i32 - cy;
                far = far.max(numeric::hypot(f64::from(dx), f64::from(dy)));
            }
        }
        out.check(
            "camp-area-radius",
            c.id.clone(),
            area == c.area && (far * R.tile - c.radius).abs() < R.radius_eps,
        );
        out.check(
            "territory-radius",
            c.id.clone(),
            far <= R.territory_radius + R.eps,
        );
        for f in &mut out.failures[failure_start..] {
            f.record_index = Some(ci);
        }
    }
    for z in ZONES {
        let cs: Vec<_> = cs.iter().filter(|c| c.zone == z).collect();
        if cs.len() < 2 {
            continue;
        }
        let d2 = |a: &CampDef, b: WorldPt| {
            let (ax, ay) = xy(cp(a));
            let (bx, by) = xy(b);
            (ax - bx) * (ax - bx) + (ay - by) * (ay - by)
        };
        let ds: Vec<_> = cs.iter().map(|c| d2(c, m.coliseum.centre)).collect();
        let top = *ds.iter().max().unwrap();
        let elites: Vec<_> = cs
            .iter()
            .enumerate()
            .filter(|(_, c)| c.elite_spot >= 0)
            .map(|(i, _)| i)
            .collect();
        let valid = elites.len() == 2
            && elites.iter().any(|&first| {
                if ds[first] != top {
                    return false;
                }
                let far: Vec<_> = (0..cs.len())
                    .filter(|&i| {
                        i != first
                            && f64::from(d2(cs[i], cp(cs[first]))) >= R.elite_sep * R.elite_sep
                    })
                    .collect();
                let pool: Vec<_> = if far.is_empty() {
                    (0..cs.len()).filter(|i| *i != first).collect()
                } else {
                    far
                };
                let best = pool.iter().map(|i| ds[*i]).max().unwrap();
                pool.iter().any(|i| elites.contains(i) && ds[*i] == best)
            });
        out.check("elite-selection", z.as_str(), valid);
    }
}
fn spawns(m: &GameMapData, tm: &TileMap, out: &mut Certificate) {
    let pool = &m.spawn_pool;
    let mut zones = [false; 5];
    for s in pool {
        zones[s.zone.code() as usize - 1] = true;
    }
    out.check(
        "spawn-count",
        "",
        (R.pool_min..=R.pool_max).contains(&pool.len())
            && zones.iter().filter(|v| **v).count() >= R.pool_zones,
    );
    out.check(
        "spawn-placement",
        "",
        pool.iter().all(|s| {
            let p = sp(s);
            let (x, y) = xy(p);
            centered(p)
                && square(tile(p), R.spawn_pad).all(|i| floor(m, i))
                && m.region_grid[tile(p)] == s.zone.code()
                && !m.buildings.iter().any(|b| inside(b, x, y))
        }),
    );
    out.check(
        "spawn-spacing",
        "",
        pool.iter().enumerate().all(|(i, a)| {
            pool[i + 1..]
                .iter()
                .all(|b| dist(sp(a), sp(b)) >= R.spawn_sep * R.tile - R.eps)
        }),
    );
    out.check(
        "spawn-camp-spacing",
        "",
        pool.iter().all(|s| {
            m.camps
                .iter()
                .all(|c| dist(sp(s), cp(c)) >= R.spawn_camp * R.tile - R.eps)
        }),
    );
    out.check(
        "spawn-sight",
        "",
        pool.iter().enumerate().all(|(i, a)| {
            pool[i + 1..].iter().all(|b| {
                dist(sp(a), sp(b)) >= R.spawn_safe * R.tile - R.eps
                    || crate::geometry::raycast(tm, a.x, a.y, b.x, b.y, 1).hit
            })
        }),
    );
    let mut pf = Pathfinder::default();
    let mut lengths = Vec::new();
    let mut hazards = Vec::new();
    for s in pool {
        let mut a = Vec2::new(s.x, s.y);
        let path = pf.find_path(
            tm,
            a,
            Vec2::new(m.coliseum.centre.x, m.coliseum.centre.y),
            crate::constants::PLAYER_RADIUS,
        );
        let mut length = 0.0;
        let mut seen = vec![false; R.size * R.size];
        for q in path {
            let dx = q.x - a.x;
            let dy = q.y - a.y;
            let d = (dx * dx + dy * dy).sqrt();
            length += d;
            let steps = d.ceil() as usize;
            for k in 0..=steps {
                let p = point(
                    a.x + dx * k as f64 / steps.max(1) as f64,
                    a.y + dy * k as f64 / steps.max(1) as f64,
                );
                let (x, y) = xy(p);
                if let Some(t) = at(x, y) {
                    if rules::PATH_HAZARDS.contains(&m.terrain[t]) {
                        seen[t] = true;
                    }
                }
            }
            a = q;
        }
        lengths.push(length);
        hazards.push(seen.iter().filter(|v| **v).count());
    }
    let lo = lengths.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = lengths.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    out.check(
        "spawn-walk-ratio",
        "",
        lo > 0.0 && hi / lo <= R.walk_ratio + R.eps,
    );
    out.check(
        "spawn-walk-hazards",
        "",
        hazards.iter().all(|h| *h <= R.walk_hazards),
    );
}
fn views(m: &GameMapData, painted: &[usize; 5], out: &mut Certificate) {
    out.check("region-order", "", m.regions.iter().map(|r| r.id).eq(ZONES));
    let weapons = rules::WEAPONS;
    let mut good = true;
    for (z, r) in m.regions.iter().enumerate() {
        let camps: Vec<_> = m
            .camps
            .iter()
            .filter(|c| c.zone == r.id)
            .map(|c| MobCampDef {
                id: c.id.clone(),
                region: r.id,
                x: c.x,
                y: c.y,
                r: c.r,
                spots: c.spots.clone(),
                elite: c.elite_spot >= 0,
                weapon: weapons[r.id.code() as usize - 1],
            })
            .collect();
        let spawns: Vec<_> = m
            .spawn_pool
            .iter()
            .filter(|s| s.zone == r.id)
            .map(sp)
            .collect();
        let t = tile(r.pole);
        let (x, y) = xy(r.pole);
        good &= r.mob_camps == camps
            && r.spawns == spawns
            && painted.get(z).is_some_and(|a| *a == r.area as usize)
            && centered(r.pole)
            && m.tiles[t] == 0
            && m.region_grid[t] as usize == z + 1
            && !m.buildings.iter().any(|b| inside(b, x, y));
    }
    let mut interleaved = Vec::new();
    for i in 0..m.spawn_pool.len() {
        if interleaved.len() >= m.spawn_pool.len() {
            break;
        }
        for r in &m.regions {
            if let Some(p) = r.spawns.get(i) {
                interleaved.push(*p);
            }
        }
    }
    let crates: Vec<_> = m
        .regions
        .iter()
        .flat_map(|r| r.chest_spots.iter().copied())
        .collect();
    good &= m.spawns == interleaved && m.crate_spots == crates;
    out.check("views", "", good);
}
fn loot(m: &GameMapData, ring: &[u8], out: &mut Certificate) {
    let allspots: Vec<_> = m
        .camps
        .iter()
        .flat_map(|c| c.spots.iter().map(|p| tile(*p)))
        .collect();
    let mut seen = vec![false; R.size * R.size];
    let mut good = true;
    for r in &m.regions {
        good &= (R.crates_min..=R.crates_max).contains(&r.chest_spots.len());
        for (i, &p) in r.chest_spots.iter().enumerate() {
            let t = tile(p);
            let (x, y) = xy(p);
            let wall = [(1, 0), (-1, 0), (0, 1), (0, -1)]
                .iter()
                .any(|&(dx, dy)| offset(t, dx, dy).is_some_and(|j| m.tiles[j] & 1 != 0));
            let clear = square(t, R.crate_pad).all(|j| floor(m, j));
            good &= centered(p)
                && m.tiles[t] == 0
                && m.region_grid[t] == r.id.code()
                && ring[t] > R.ring as u8
                && x >= R.border_margin
                && y >= R.border_margin
                && x <= R.size as i32 - 1 - R.border_margin
                && y <= R.size as i32 - 1 - R.border_margin
                && (wall || clear)
                && m.spawn_pool
                    .iter()
                    .all(|s| cheb(tile(sp(s)), t) >= R.crate_spawn_gap)
                && allspots.iter().all(|s| cheb(*s, t) >= R.crate_spot_gap)
                && m.camps
                    .iter()
                    .all(|c| cheb(tile(cp(c)), t) >= R.crate_camp_gap)
                && !seen[t]
                && r.chest_spots[..i]
                    .iter()
                    .all(|s| cheb(tile(*s), t) >= R.crate_pair_gap);
            seen[t] = true;
        }
    }
    out.check("crates", "", good);
    let mut clear = vec![false; R.size * R.size];
    for c in &m.camps {
        for dy in -R.clearing_cover_span..=R.clearing_cover_span {
            for dx in -R.clearing_cover_span..=R.clearing_cover_span {
                if f64::from(dx * dx + dy * dy) <= R.clearing * R.clearing {
                    if let Some(t) = offset(tile(cp(c)), dx, dy) {
                        clear[t] = true;
                    }
                }
            }
        }
    }
    seen.fill(false);
    good = (R.ground_min..=R.ground_max).contains(&m.ground_spots.len());
    for &p in &m.ground_spots {
        let t = tile(p);
        let (x, y) = xy(p);
        good &= !seen[t]
            && centered(p)
            && m.tiles[t] == 0
            && m.region_grid[t] != 6
            && !m.buildings.iter().any(|b| inside(b, x, y))
            && !clear[t]
            && m.spawn_pool
                .iter()
                .all(|s| dist(sp(s), p) >= R.ground_spawn_gap * R.tile)
            && m.crate_spots
                .iter()
                .all(|c| cheb(tile(*c), t) >= R.ground_crate_gap);
        seen[t] = true;
    }
    out.check("ground", "", good);
    out.check(
        "building-margin",
        "",
        m.buildings.iter().all(|b| {
            let Some(t) = at(b.x, b.y) else { return false };
            let code = m.region_grid[t];
            (1..=5).contains(&code)
                && (b.y - 1..=b.y + b.h as i32).all(|y| {
                    (b.x - 1..=b.x + b.w as i32)
                        .all(|x| at(x, y).is_some_and(|i| m.region_grid[i] == code))
                })
        }),
    );
}
