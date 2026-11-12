use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapDataError {
    pub path: String,
    pub reason: &'static str,
}
impl MapDataError {
    pub(super) fn new(path: impl Into<String>, reason: &'static str) -> Self {
        Self {
            path: path.into(),
            reason,
        }
    }
    fn indexed(mut self, group: &str, index: usize) -> Self {
        self.path = self.path.replacen(group, &format!("{group}[{index}]"), 1);
        self
    }
}
impl core::fmt::Display for MapDataError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}: {}", self.path, self.reason)
    }
}
impl std::error::Error for MapDataError {}
fn require(ok: bool, path: impl Into<String>, why: &'static str) -> Result<(), MapDataError> {
    if ok {
        Ok(())
    } else {
        Err(MapDataError::new(path, why))
    }
}
// Indexed diagnostic strings are built only on refusal, never per tile on success.
fn require_lazy(
    ok: bool,
    path: impl FnOnce() -> String,
    why: &'static str,
) -> Result<(), MapDataError> {
    if ok {
        Ok(())
    } else {
        Err(MapDataError::new(path(), why))
    }
}
fn cells(d: &LayerData) -> Result<usize, MapDataError> {
    let n = u64::from(d.w) * u64::from(d.h);
    require(
        d.w > 0 && d.h > 0 && n <= i32::MAX as u64,
        "dimensions",
        "positive grid must fit signed tile indices",
    )?;
    Ok(n as usize)
}
pub(super) fn world_index(d: &LayerData, p: WorldPt) -> Option<usize> {
    if !p.x.is_finite() || !p.y.is_finite() {
        return None;
    }
    let x = (p.x / crate::constants::TILE).floor();
    let y = (p.y / crate::constants::TILE).floor();
    if x < 0.0 || y < 0.0 || x >= f64::from(d.w) || y >= f64::from(d.h) {
        None
    } else {
        Some(y as usize * d.w as usize + x as usize)
    }
}
fn point(d: &LayerData, p: WorldPt, path: &str) -> Result<usize, MapDataError> {
    let i = world_index(d, p)
        .ok_or_else(|| MapDataError::new(path, "finite world point must lie inside grid"))?;
    let x = (i % d.w as usize) as f64 * crate::constants::TILE + crate::constants::TILE / 2.0;
    let y = (i / d.w as usize) as f64 * crate::constants::TILE + crate::constants::TILE / 2.0;
    require(
        p.x == x && p.y == y,
        path,
        "gameplay position must be a tile centre",
    )?;
    Ok(i)
}
fn tile(d: &LayerData, p: TilePt, path: &str) -> Result<usize, MapDataError> {
    require(
        p.x >= 0 && p.y >= 0 && (p.x as u32) < d.w && (p.y as u32) < d.h,
        path,
        "tile must lie inside grid",
    )?;
    Ok(p.y as usize * d.w as usize + p.x as usize)
}
fn rect(d: &LayerData, r: TileRect, path: &str) -> Result<(), MapDataError> {
    require(
        r.x >= 0
            && r.y >= 0
            && r.w > 0
            && r.h > 0
            && r.x as u64 + u64::from(r.w) <= u64::from(d.w)
            && r.y as u64 + u64::from(r.h) <= u64::from(d.h),
        path,
        "nonempty rectangle must fit grid",
    )
}
fn contains(r: TileRect, x: i32, y: i32) -> bool {
    x >= r.x
        && y >= r.y
        && i64::from(x) < i64::from(r.x) + i64::from(r.w)
        && i64::from(y) < i64::from(r.y) + i64::from(r.h)
}
fn zone_point(d: &LayerData, p: WorldPt, zone: Zone, path: &str) -> Result<usize, MapDataError> {
    let i = point(d, p, path)?;
    require(
        d.region_grid[i] == zone.code(),
        path,
        "position's region does not match declared zone",
    )?;
    Ok(i)
}
fn finite_nonnegative(v: f64, path: &str) -> Result<(), MapDataError> {
    require(
        v.is_finite() && v >= 0.0,
        path,
        "expected finite nonnegative value",
    )
}
fn unique_points(points: &[WorldPt], path: &str) -> Result<(), MapDataError> {
    for (i, p) in points.iter().enumerate() {
        require(!points[..i].contains(p), path, "duplicate position")?;
    }
    Ok(())
}
fn default_weapon(zone: Zone) -> RegionWeapon {
    match zone {
        Zone::Fire => RegionWeapon::Axe,
        Zone::Sentenced => RegionWeapon::Sword,
        Zone::Plague => RegionWeapon::Bow,
        Zone::Frost => RegionWeapon::Shield,
        Zone::Holy => RegionWeapon::Wand,
    }
}

pub(super) fn metadata(d: &LayerData) -> Result<(), MapDataError> {
    require(
        (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&d.seed),
        "seed",
        "seed must be a JavaScript safe integer",
    )?;
    require(
        d.attempt <= 9_007_199_254_740_991,
        "attempt",
        "attempt must be a nonnegative JavaScript safe integer",
    )?;
    let n = cells(d)?;
    for (name, len) in [
        ("terrain", d.terrain.len()),
        ("regionGrid", d.region_grid.len()),
        ("territoryGrid", d.territory_grid.len()),
        ("featureGrid", d.feature_grid.len()),
    ] {
        require(len == n, name, "layer length must equal w*h")?;
    }
    require(
        d.camps.len() <= u8::MAX as usize,
        "camps",
        "too many camps for territoryGrid encoding",
    )?;
    require(
        d.features.len() <= u8::MAX as usize,
        "features",
        "too many features for featureGrid encoding",
    )?;
    for i in 0..n {
        require_lazy(
            d.terrain[i] <= 7,
            || format!("terrain[{i}]"),
            "unknown terrain code",
        )?;
        require_lazy(
            d.region_grid[i] <= 6,
            || format!("regionGrid[{i}]"),
            "unknown region code",
        )?;
        require_lazy(
            d.territory_grid[i] as usize <= d.camps.len(),
            || format!("territoryGrid[{i}]"),
            "missing camp reference",
        )?;
        require_lazy(
            d.feature_grid[i] as usize <= d.features.len(),
            || format!("featureGrid[{i}]"),
            "missing feature reference",
        )?;
        if d.territory_grid[i] > 0 {
            require_lazy(
                d.region_grid[i] == d.camps[d.territory_grid[i] as usize - 1].zone.code(),
                || format!("territoryGrid[{i}]"),
                "camp territory crosses its zone",
            )?;
        }
    }
    rect(d, d.coliseum.rect, "coliseum.rect")?;
    let centre = point(d, d.coliseum.centre, "coliseum.centre")?;
    require(
        d.region_grid[centre] == 6,
        "coliseum.centre",
        "centre must be in coliseum region",
    )?;
    require(
        d.coliseum.gates.len() == 4,
        "coliseum.gates",
        "expected n/e/s/w gates",
    )?;
    let mut gate_tiles = Vec::new();
    for (g, side) in d.coliseum.gates.iter().zip([
        GateSide::North,
        GateSide::East,
        GateSide::South,
        GateSide::West,
    ]) {
        require(
            g.side == side,
            "coliseum.gates",
            "gate sides must be ordered n/e/s/w",
        )?;
        require(
            !g.tiles.is_empty(),
            "coliseum.gates.tiles",
            "gate must have tiles",
        )?;
        let (mut sx, mut sy) = (0.0, 0.0);
        for (gate_index, &p) in g.tiles.iter().enumerate() {
            let i = tile(d, p, "coliseum.gates.tiles")?;
            require(
                d.region_grid[i] == 6 && contains(d.coliseum.rect, p.x, p.y),
                "coliseum.gates.tiles",
                "gate tile must belong to coliseum footprint",
            )?;
            require(
                !gate_tiles.contains(&i),
                "coliseum.gates.tiles",
                "duplicate gate tile",
            )?;
            let rect = d.coliseum.rect;
            let on_side = match g.side {
                GateSide::North => p.y == rect.y,
                GateSide::East => i64::from(p.x) == i64::from(rect.x) + i64::from(rect.w) - 1,
                GateSide::South => i64::from(p.y) == i64::from(rect.y) + i64::from(rect.h) - 1,
                GateSide::West => p.x == rect.x,
            };
            require(
                on_side,
                "coliseum.gates.tiles",
                "gate tile must lie on its declared rectangle side",
            )?;
            if let Some(previous) = gate_index.checked_sub(1).map(|j| g.tiles[j]) {
                let contiguous = match g.side {
                    GateSide::North | GateSide::South => p.y == previous.y && p.x == previous.x + 1,
                    GateSide::East | GateSide::West => p.x == previous.x && p.y == previous.y + 1,
                };
                require(
                    contiguous,
                    "coliseum.gates.tiles",
                    "gate tiles must be an ordered contiguous opening",
                )?;
            }
            gate_tiles.push(i);
            sx += f64::from(p.x) * crate::constants::TILE + crate::constants::TILE / 2.0;
            sy += f64::from(p.y) * crate::constants::TILE + crate::constants::TILE / 2.0;
        }
        require(
            g.x.is_finite()
                && g.y.is_finite()
                && g.x == sx / g.tiles.len() as f64
                && g.y == sy / g.tiles.len() as f64,
            "coliseum.gates",
            "gate world centre does not match tiles",
        )?;
    }
    require(
        d.coliseum.inner_spawns.len() >= crate::constants::MAX_PLAYERS,
        "coliseum.innerSpawns",
        "insufficient inner spawns",
    )?;
    unique_points(&d.coliseum.inner_spawns, "coliseum.innerSpawns")?;
    for &p in &d.coliseum.inner_spawns {
        let i = point(d, p, "coliseum.innerSpawns")?;
        require(
            d.region_grid[i] == 6,
            "coliseum.innerSpawns",
            "spawn must lie in coliseum region",
        )?;
    }
    for i in 0..n {
        if d.region_grid[i] == 6 {
            require(
                contains(
                    d.coliseum.rect,
                    (i % d.w as usize) as i32,
                    (i / d.w as usize) as i32,
                ),
                "regionGrid",
                "coliseum region outside its rectangle",
            )?;
        }
    }
    for (ci, c) in d.camps.iter().enumerate() {
        camp_record(d, ci, c, n).map_err(|e| e.indexed("camps", ci))?;
    }
    require(
        d.regions.len() == 5,
        "regions",
        "expected one region per faction",
    )?;
    for (ri, r) in d.regions.iter().enumerate() {
        region_record(d, ri, r).map_err(|e| e.indexed("regions", ri))?;
    }
    let mut pool = Vec::new();
    for s in &d.spawn_pool {
        let p = WorldPt { x: s.x, y: s.y };
        zone_point(d, p, s.zone, "spawnPool")?;
        pool.push(p);
    }
    unique_points(&pool, "spawnPool")?;
    let mut interleaved = Vec::with_capacity(pool.len());
    for offset in 0..d.regions.iter().map(|r| r.spawns.len()).max().unwrap_or(0) {
        for region in &d.regions {
            if let Some(&p) = region.spawns.get(offset) {
                interleaved.push(p);
            }
        }
    }
    require(
        d.spawns == interleaved,
        "spawns",
        "spawns must be the ordered interleaved region spawn view",
    )?;
    unique_points(&d.spawns, "spawns")?;
    let crates: Vec<WorldPt> = d
        .regions
        .iter()
        .flat_map(|r| r.chest_spots.iter().copied())
        .collect();
    require(
        crates == d.crate_spots,
        "crateSpots",
        "crate spots must be flattened region chestSpots",
    )?;
    for &p in &d.ground_spots {
        point(d, p, "groundSpots")?;
    }
    unique_points(&d.ground_spots, "groundSpots")?;
    for &r in &d.buildings {
        rect(d, r, "buildings")?;
    }
    for (fi, f) in d.features.iter().enumerate() {
        feature_record(d, f, n).map_err(|e| e.indexed("features", fi))?;
    }
    let landmarks: Vec<TileRect> = d
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Landmark)
        .map(|f| f.bbox)
        .collect();
    require(
        d.buildings.len() == landmarks.len() && d.buildings.iter().all(|b| landmarks.contains(b)),
        "buildings",
        "buildings must name landmark rectangles",
    )?;
    for (i, b) in d.buildings.iter().enumerate() {
        require(
            !d.buildings[..i].contains(b),
            "buildings",
            "duplicate landmark rectangle",
        )?;
    }
    let mut feature_counts = vec![0usize; d.features.len()];
    for i in 0..n {
        let id = d.feature_grid[i] as usize;
        if id == 0 {
            continue;
        }
        let f = &d.features[id - 1];
        if f.kind == FeatureKind::Bush {
            require_lazy(
                d.territory_grid[i] as i32 == f.p[0] + 1 && d.terrain[i] == 0,
                || format!("featureGrid[{i}]"),
                "bush must own plain ground in its referenced camp territory",
            )?;
        }

        feature_counts[id - 1] += 1;
        require_lazy(
            d.region_grid[i] == f.zone.code()
                && contains(f.bbox, (i % d.w as usize) as i32, (i / d.w as usize) as i32),
            || format!("featureGrid[{i}]"),
            "feature ownership outside its region or bbox",
        )?;
    }
    for (fi, &count) in feature_counts.iter().enumerate() {
        require_lazy(
            count == d.features[fi].tiles as usize,
            || format!("features[{fi}].tiles"),
            "feature tile count differs from featureGrid",
        )?;
    }
    for p in &d.props {
        require(p.kind < 34, "props.kind", "unknown cosmetic prop kind")?;
        require(
            world_index(d, WorldPt { x: p.x, y: p.y }).is_some(),
            "props",
            "finite cosmetic world point must be in grid",
        )?;
    }
    Ok(())
}

fn feature_params(d: &LayerData, f: &MapFeature, path: &str) -> Result<(), MapDataError> {
    let p = &f.p;
    let n = u64::from(d.w) * u64::from(d.h);
    let tile_ref = |v: i32| v >= 0 && (v as u64) < n;
    let ok = match f.kind {
        FeatureKind::Landmark => {
            let variant = match f.zone {
                Zone::Fire => "forge",
                Zone::Sentenced => "guardHouse",
                Zone::Plague => "burrow",
                Zone::Frost => "watchtower",
                Zone::Holy => "shrine",
            };
            f.variant == variant
                && p.len() >= 2
                && (0..4).contains(&p[0])
                && (0..2).contains(&p[1])
                && p[2..].iter().all(|&v| tile_ref(v))
        }
        FeatureKind::Bush => {
            p.len() == 2
                && p[0] >= 0
                && (p[0] as usize) < d.camps.len()
                && d.camps[p[0] as usize].elite_spot >= 0
                && d.camps[p[0] as usize].zone == f.zone
                && p[1] >= 0
        }
        FeatureKind::Crater => {
            p.len() >= 3
                && p[0] >= 0
                && (p[0] as usize) < d.camps.len()
                && d.camps[p[0] as usize].zone == f.zone
                && p[1] > 0
                && p[2] >= 0
                && p[2] as usize == p.len() - 3
                && p[3..].iter().all(|v| (0..16).contains(v))
        }
        FeatureKind::LavaRiver => {
            p.len() >= 2
                && p[0] > 0
                && p[1] >= 0
                && p[1] as usize == p.len() - 2
                && p[2..].iter().all(|&v| tile_ref(v))
        }
        FeatureKind::FenceRow => p.len() == 3 && (0..2).contains(&p[0]) && p[1] >= 0 && p[2] >= 0,
        FeatureKind::Barrow => {
            p.len() == 4
                && p[0] > 0
                && (0..2).contains(&p[1])
                && (0..16).contains(&p[2])
                && [-1, 1].contains(&p[3])
        }
        FeatureKind::Mere => p.len() == 2 && p[0] >= 0 && p[1] >= 0,
        FeatureKind::Headland => p.len() == 1 && (0..16).contains(&p[0]),
        FeatureKind::Hall => {
            p.len() == 5 && (0..2).contains(&p[0]) && p[1] > 0 && p[2] > 0 && p[3] >= 0 && p[4] >= 0
        }
        FeatureKind::Gallows | FeatureKind::Spire | FeatureKind::Causeway | FeatureKind::Infill => {
            p.is_empty()
        }
        FeatureKind::BogTree
        | FeatureKind::Church
        | FeatureKind::Graveyard
        | FeatureKind::Volcano
        | FeatureKind::LavaStream
        | FeatureKind::LavaPool => p.is_empty(),
    };
    require(
        ok,
        path,
        "invalid kind-specific feature payload or reference",
    )?;
    if f.kind == FeatureKind::Crater {
        let camp = &d.camps[p[0] as usize];
        require(
            f64::from(f.ax) * crate::constants::TILE + crate::constants::TILE / 2.0 == camp.x
                && f64::from(f.ay) * crate::constants::TILE + crate::constants::TILE / 2.0
                    == camp.y,
            path,
            "crater anchor must match its referenced camp centre",
        )?;
    }
    require(
        f.kind == FeatureKind::Landmark || f.variant.is_empty(),
        path,
        "only landmark features have variants",
    )
}

pub(super) fn collision(d: &LayerData, tiles: &[u8]) -> Result<(), MapDataError> {
    let n = cells(d)?;
    require(tiles.len() == n, "tiles", "collision length must equal w*h")?;
    let mut camp_areas = vec![0u32; d.camps.len()];
    for i in 0..n {
        require_lazy(
            tiles[i] <= 2,
            || format!("tiles[{i}]"),
            "unknown collision class",
        )?;
        let x = i % d.w as usize;
        let y = i / d.w as usize;
        if x == 0 || y == 0 || x + 1 == d.w as usize || y + 1 == d.h as usize {
            require_lazy(
                tiles[i] == 1
                    && d.terrain[i] == 0
                    && d.region_grid[i] == 0
                    && d.territory_grid[i] == 0
                    && d.feature_grid[i] == 0,
                || format!("tiles[{i}]"),
                "border must be unowned plain wall outside all regions",
            )?;
        }
        let feature_id = d.feature_grid[i] as usize;
        if feature_id > 0 && d.features[feature_id - 1].kind == FeatureKind::Bush {
            require_lazy(
                tiles[i] == 0,
                || format!("tiles[{i}]"),
                "bush-owned tile must be floor",
            )?;
        }
        let terrain = d.terrain[i];
        let compatible = match terrain {
            0 => true,
            1..=3 => tiles[i] == 1 || tiles[i] == 2,
            4..=7 => tiles[i] == 0,
            _ => false,
        };
        require_lazy(
            compatible,
            || format!("terrain[{i}]"),
            "terrain incompatible with collision class",
        )?;
        if tiles[i] == 0 && d.territory_grid[i] > 0 {
            camp_areas[d.territory_grid[i] as usize - 1] += 1;
        }
    }
    let floor = |p: WorldPt, path: &str| -> Result<(), MapDataError> {
        let i = point(d, p, path)?;
        require(tiles[i] == 0, path, "gameplay destination must be floor")
    };
    floor(d.coliseum.centre, "coliseum.centre")?;
    for g in &d.coliseum.gates {
        for &p in &g.tiles {
            let i = tile(d, p, "coliseum.gates.tiles")?;
            require(
                tiles[i] == 0,
                "coliseum.gates.tiles",
                "canonical gate tile must be open floor",
            )?;
        }
    }
    for &p in &d.coliseum.inner_spawns {
        floor(p, "coliseum.innerSpawns")?;
    }
    for (ci, c) in d.camps.iter().enumerate() {
        require_lazy(
            c.area == camp_areas[ci],
            || format!("camps[{ci}].area"),
            "territory floor count differs from area",
        )?;
        floor(c.chest, "camps.chest")?;
        for &p in &c.spots {
            floor(p, "camps.spots")?;
        }
    }
    for f in &d.features {
        if matches!(f.kind, FeatureKind::Landmark | FeatureKind::LavaRiver) {
            for &tile_index in &f.p[2..] {
                let i = tile_index as usize;
                require(
                    tiles[i] == 0 && d.region_grid[i] == f.zone.code(),
                    "features.p",
                    "door/ford tile reference must name floor in the feature's zone",
                )?;
            }
        }
    }
    for r in &d.regions {
        floor(r.pole, "regions.pole")?;
    }
    for &p in d.spawns.iter().chain(&d.crate_spots).chain(&d.ground_spots) {
        floor(p, "spawn/crate/ground spots")?;
    }
    Ok(())
}

fn camp_record(d: &LayerData, ci: usize, c: &CampDef, n: usize) -> Result<(), MapDataError> {
    let path = "camps";
    require(
        !c.id.is_empty() && !d.camps[..ci].iter().any(|old| old.id == c.id),
        path,
        "camp id must be nonempty and unique",
    )?;
    let center = zone_point(d, WorldPt { x: c.x, y: c.y }, c.zone, path)?;
    require(
        d.territory_grid[center] as usize == ci + 1,
        path,
        "camp centre must be in its own territory",
    )?;
    require(
        c.chest == WorldPt { x: c.x, y: c.y },
        path,
        "chest must match camp centre",
    )?;
    finite_nonnegative(c.r, path)?;
    finite_nonnegative(c.radius, path)?;
    require(
        c.area > 0 && c.area as usize <= n,
        path,
        "invalid territory floor area",
    )?;
    require(
        c.elite_spot >= -1 && (c.elite_spot < 0 || (c.elite_spot as usize) < c.spots.len()),
        path,
        "invalid elite spot reference",
    )?;
    require(!c.spots.is_empty(), path, "camp requires mob spots")?;
    unique_points(&c.spots, path)?;
    for &p in &c.spots {
        let i = zone_point(d, p, c.zone, path)?;
        require(
            d.territory_grid[i] as usize == ci + 1 && p != c.chest,
            path,
            "mob spot must be in own territory, distinct from chest",
        )?;
    }

    Ok(())
}

fn region_record(d: &LayerData, ri: usize, r: &FactionRegionDef) -> Result<(), MapDataError> {
    let path = "regions";
    require(
        r.id.code() as usize == ri + 1,
        path,
        "regions must be ordered by faction",
    )?;
    zone_point(d, r.pole, r.id, path)?;
    require(
        r.area as usize
            == d.region_grid
                .iter()
                .filter(|&&code| code == r.id.code())
                .count(),
        path,
        "region area does not match regionGrid",
    )?;
    let spawns: Vec<WorldPt> = d
        .spawn_pool
        .iter()
        .filter(|s| s.zone == r.id)
        .map(|s| WorldPt { x: s.x, y: s.y })
        .collect();
    require(
        r.spawns == spawns,
        path,
        "region spawns must be the ordered spawnPool view",
    )?;
    for &p in &r.chest_spots {
        zone_point(d, p, r.id, path)?;
    }
    let camps: Vec<&CampDef> = d.camps.iter().filter(|c| c.zone == r.id).collect();
    require(
        camps.len() == r.mob_camps.len(),
        path,
        "mobCamps must be the camp view",
    )?;
    for (c, m) in camps.iter().zip(&r.mob_camps) {
        require(
            c.id == m.id
                && c.zone == m.region
                && c.x == m.x
                && c.y == m.y
                && c.r == m.r
                && c.spots == m.spots
                && (c.elite_spot >= 0) == m.elite
                && m.weapon == default_weapon(r.id),
            path,
            "mobCamps does not match authoritative camp/default weapon",
        )?;
    }

    Ok(())
}

fn feature_record(d: &LayerData, f: &MapFeature, n: usize) -> Result<(), MapDataError> {
    let path = "features";
    tile(d, TilePt { x: f.ax, y: f.ay }, path)?;
    rect(d, f.bbox, path)?;
    require(
        !f.jobs.is_empty() && f.jobs.len() <= 2,
        path,
        "feature requires one or two jobs",
    )?;
    require(
        f.jobs.len() < 2 || f.jobs[0] != f.jobs[1],
        path,
        "duplicate feature job",
    )?;
    require(
        f.tiles > 0 && f.tiles as usize <= n,
        path,
        "invalid owned tile count",
    )?;
    feature_params(d, f, path)?;

    Ok(())
}
