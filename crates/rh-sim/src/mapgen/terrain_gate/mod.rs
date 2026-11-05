//! Pure ordered generator-owned terrain acceptance gate (`terrain.ts::validateTerrain`).
//! No gameplay effects, cached topology, complete-map certification or finished generator.
mod rules;
use crate::constants::{SNAP_RADIUS, TILE};
use crate::map::{tile_to_world_center, world_to_tile, MASK_MOVE, TILE_FLOOR, TILE_LOW, TILE_WALL};
use crate::mapdata::{GameMapData, WorldPt};
pub use rules::{
    default_definition, visit_content, PropKind, TerrainGateDefinition, TerrainKind,
    DEFAULT_DEFINITION,
};

#[derive(Default)]
pub struct Options<'a> {
    pub styled: bool,
    pub prop_kinds: Option<&'a [PropKind<'a>]>,
}
#[derive(Debug, PartialEq, Eq)]
pub enum InputError {
    Dimensions,
    Coordinates,
    Definition,
}
/// Byte-valued layers can contain unknown codes/kinds, and wrong lengths return ordered T1
/// problems before metadata is inspected. Nonfinite/unrepresentable geometry is a typed error.
pub fn validate(map: &GameMapData, opts: &Options<'_>) -> Result<Vec<String>, InputError> {
    validate_with_definition(map, opts, &default_definition())
}
pub fn validate_with_definition(
    map: &GameMapData,
    opts: &Options<'_>,
    d: &TerrainGateDefinition<'_>,
) -> Result<Vec<String>, InputError> {
    let (w, h) = (map.w as usize, map.h as usize);
    let n = w
        .checked_mul(h)
        .filter(|_| w > 0 && h > 0 && w <= i32::MAX as usize && h <= i32::MAX as usize)
        .ok_or(InputError::Dimensions)?;
    let mut out = Vec::new();
    for (name, len) in [
        ("tiles", map.tiles.len()),
        ("terrain", map.terrain.len()),
        ("regionGrid", map.region_grid.len()),
    ] {
        if len != n {
            out.push(format!(
                "T1 {name} has {len} entries, expected {n} ({w}x{h})"
            ));
        }
    }
    if !out.is_empty() {
        return Ok(out);
    }
    if d.kinds.is_empty()
        || d.kinds.len() > 256
        || usize::from(d.ice) >= d.kinds.len()
        || [d.spawn_hazard_half, d.loot_hazard_half, d.camp_hazard_half]
            .iter()
            .any(|&v| !(0..=16).contains(&v))
    {
        return Err(InputError::Definition);
    }
    let tiles = &map.tiles;
    let terrain = &map.terrain;
    let at = |i: usize| format!("({}, {})", i % w, i / w);
    let mut code = Vec::new();
    let mut kind = Vec::new();
    let mut class = Vec::new();
    for i in 0..n {
        let t = tiles[i];
        let k = usize::from(terrain[i]);
        let code_ok = [TILE_FLOOR, TILE_WALL, TILE_LOW].contains(&t);
        let spec = d.kinds.get(k);
        if !code_ok {
            code.push(i);
        }
        if spec.is_none() {
            kind.push(i);
        }
        if code_ok && k != 0 {
            if let Some(spec) = spec {
                if spec.tile != Some(t) && !(spec.tile == Some(TILE_LOW) && t == TILE_WALL) {
                    class.push(i);
                }
            }
        }
    }
    if let Some(&i) = code.first() {
        out.push(format!(
            "T2 {} tile(s) with a code outside {{floor, wall, low}}, first {} = {}",
            code.len(),
            at(i),
            tiles[i]
        ));
    }
    if let Some(&i) = kind.first() {
        out.push(format!(
            "T2 {} tile(s) with a terrain kind >= {}, first {} = {}",
            kind.len(),
            d.kinds.len(),
            at(i),
            terrain[i]
        ));
    }
    if let Some(&i) = class.first() {
        out.push(format!("T3 {} tile(s) whose terrain disagrees with the tile class, first {}: {} on tile code {}",class.len(),at(i),d.kinds[usize::from(terrain[i])].key,tiles[i]));
    }
    let border = (0..w)
        .find_map(|x| {
            if tiles[x] != TILE_WALL {
                Some(x)
            } else if tiles[(h - 1) * w + x] != TILE_WALL {
                Some((h - 1) * w + x)
            } else {
                None
            }
        })
        .or_else(|| {
            (0..h).find_map(|y| {
                if tiles[y * w] != TILE_WALL {
                    Some(y * w)
                } else if tiles[y * w + w - 1] != TILE_WALL {
                    Some(y * w + w - 1)
                } else {
                    None
                }
            })
        });
    if let Some(i) = border {
        out.push(format!("T4 border tile {} is not a wall", at(i)));
    }
    let mut dist = vec![-1i64; n];
    let mut queue = Vec::with_capacity(n);
    for i in 0..n {
        if tiles[i] == TILE_FLOOR {
            dist[i] = 0;
            queue.push(i);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        if dist[i] >= SNAP_RADIUS {
            continue;
        }
        for j in neighbors(i, w, h).into_iter().flatten() {
            if dist[j] < 0 {
                dist[j] = dist[i] + 1;
                queue.push(j);
            }
        }
    }
    let far: Vec<_> = (0..n)
        .filter(|&i| tiles[i] == TILE_LOW && dist[i] < 0)
        .collect();
    if let Some(&i) = far.first() {
        out.push(format!(
            "T5 {} LOW tile(s) more than {} tiles from any floor, first {}",
            far.len(),
            SNAP_RADIUS,
            at(i)
        ));
    }
    let near: Vec<_> = (0..n)
        .filter(|&i| {
            if terrain[i] != d.ice {
                return false;
            }
            let (x, y) = ((i % w) as i64, (i / w) as i64);
            (-1..=1).any(|dy| {
                (-1..=1).any(|dx| {
                    if dx == 0 && dy == 0 {
                        return false;
                    }
                    index(x + dx, y + dy, w, h).is_none_or(|j| tiles[j] & MASK_MOVE != 0)
                })
            })
        })
        .collect();
    if let Some(&i) = near.first() {
        out.push(format!("T11 {} ICE tile(s) with a wall, LOW tile or the map edge in their 8-neighbourhood, first {}",near.len(),at(i)));
    }
    if map.regions.is_empty() {
        return Ok(out);
    }
    let mut region = Vec::new();
    let mut home = Vec::new();
    for i in 0..n {
        if tiles[i] != TILE_LOW && terrain[i] == 0 {
            continue;
        }
        let faction = map.region_grid[i];
        if !(1..=5).contains(&faction) {
            region.push(i);
            continue;
        }
        if terrain[i] != 0 {
            if let Some(spec) = d.kinds.get(usize::from(terrain[i])) {
                if spec.home.is_some_and(|v| v != faction) {
                    home.push(i);
                }
            }
        }
    }
    if let Some(&i) = region.first() {
        out.push(format!(
            "T6 {} LOW or kinded tile(s) outside every faction region, first {} in {}",
            region.len(),
            at(i),
            region_name(map.region_grid[i])
        ));
    }
    if let Some(&i) = home.first() {
        out.push(format!(
            "T6 {} kinded tile(s) outside their home zone, first {}: {} in {}",
            home.len(),
            at(i),
            d.kinds[usize::from(terrain[i])].key,
            region_name(map.region_grid[i])
        ));
    }
    let open = components(tiles, w, h);
    if open != 1 {
        out.push(format!(
            "T7 floor has {open} components with the gates open, expected 1"
        ));
    }
    let mut closed_tiles = tiles.clone();
    let gate: Vec<_> = map
        .coliseum
        .gates
        .iter()
        .flat_map(|g| &g.tiles)
        .map(|p| (i64::from(p.x), i64::from(p.y)))
        .collect();
    for &(x, y) in &gate {
        if let Some(i) = index(x, y, w, h) {
            closed_tiles[i] = TILE_WALL;
        }
    }
    let closed = components(&closed_tiles, w, h);
    if closed != 2 {
        out.push(format!(
            "T7 floor has {closed} components with the gates closed, expected 2"
        ));
    }
    let bad = |x, y| index(x, y, w, h).is_none_or(|i| tiles[i] != TILE_FLOOR || terrain[i] != 0);
    protect(&mut out, "gate", &gate, &bad);
    if let Some(i) =
        (0..n).find(|&i| map.region_grid[i] == 6 && (tiles[i] == TILE_LOW || terrain[i] != 0))
    {
        out.push(format!("T8 coliseum tile {} has LOW or terrain", at(i)));
    }
    let spawns: Vec<_> = map
        .spawns
        .iter()
        .copied()
        .chain(map.spawn_pool.iter().map(|p| WorldPt { x: p.x, y: p.y }))
        .chain(map.regions.iter().flat_map(|r| r.spawns.iter().copied()))
        .map(point)
        .collect::<Result<_, _>>()?;
    let inner = map
        .coliseum
        .inner_spawns
        .iter()
        .copied()
        .map(point)
        .collect::<Result<Vec<_>, _>>()?;
    around(&mut out, "spawn", &spawns, &bad);
    around(&mut out, "inner spawn", &inner, &bad);
    let chests = map
        .crate_spots
        .iter()
        .copied()
        .chain(
            map.regions
                .iter()
                .flat_map(|r| r.chest_spots.iter().copied()),
        )
        .chain(map.camps.iter().map(|c| c.chest))
        .map(point)
        .collect::<Result<Vec<_>, _>>()?;
    protect(&mut out, "chest", &chests, &bad);
    let hazard = |x, y| {
        index(x, y, w, h).is_some_and(|i| {
            terrain[i] != 0
                && d.kinds
                    .get(usize::from(terrain[i]))
                    .is_some_and(|s| s.tile == Some(TILE_FLOOR))
        })
    };
    hazard_free(&mut out, "spawn 5x5", &spawns, d.spawn_hazard_half, &hazard);
    hazard_free(
        &mut out,
        "chest or crate 3x3",
        &chests,
        d.loot_hazard_half,
        &hazard,
    );
    let ground = map
        .ground_spots
        .iter()
        .copied()
        .map(point)
        .collect::<Result<Vec<_>, _>>()?;
    hazard_free(
        &mut out,
        "ground-loot spot 3x3",
        &ground,
        d.loot_hazard_half,
        &hazard,
    );
    let mut clearing = Vec::new();
    for (x, y, r) in map.camps.iter().map(|c| (c.x, c.y, c.r)).chain(
        map.regions
            .iter()
            .flat_map(|r| r.mob_camps.iter().map(|c| (c.x, c.y, c.r))),
    ) {
        let (ctx, cty) = point(WorldPt { x, y })?;
        // Refuse unbounded/malformed radii before constructing source's signed loop bounds.
        if !r.is_finite() || r < 0.0 || r / TILE > i32::MAX as f64 {
            return Err(InputError::Coordinates);
        }
        let span = crate::math::ceil_i64(r / TILE);
        // Valid generated clearings are small. Larger spans are admitted only when their work is
        // bounded by the supplied map; this prevents an invalid metadata record from hanging.
        if span > w.max(h) as i64 + 1 {
            return Err(InputError::Coordinates);
        }
        for dy in -span..=span {
            for dx in -span..=span {
                let px = tile_to_world_center(ctx + dx) - x;
                let py = tile_to_world_center(cty + dy) - y;
                if px * px + py * py <= r * r {
                    clearing.push((ctx + dx, cty + dy));
                }
            }
        }
    }
    protect(&mut out, "camp clearing", &clearing, &bad);
    hazard_free(
        &mut out,
        "camp clearing (+1 tile)",
        &clearing,
        d.camp_hazard_half,
        &hazard,
    );
    let props = opts.prop_kinds.unwrap_or(d.props);
    for (p, pr) in map.props.iter().enumerate() {
        let tx = world_to_tile(pr.x);
        let ty = world_to_tile(pr.y);
        let spec = props.get(usize::from(pr.kind));
        let problem = if !(pr.x + pr.y).is_finite() || index(tx, ty, w, h).is_none() {
            Some(format!(
                "prop {p} at ({}, {}) is out of bounds",
                number(pr.x),
                number(pr.y)
            ))
        } else if let Some(spec) = spec {
            let tile = tiles[index(tx, ty, w, h).unwrap()];
            if tile != spec.on {
                Some(format!(
                    "prop {p} ({}) stands on tile code {tile}, needs {}",
                    spec.key, spec.on
                ))
            } else {
                None
            }
        } else {
            Some(format!("prop {p} has unknown kind {}", pr.kind))
        };
        if let Some(problem) = problem {
            out.push(format!("T9 {problem}"));
            break;
        }
    }
    if opts.styled {
        let none: Vec<_> = (0..n)
            .filter(|&i| tiles[i] == TILE_LOW && terrain[i] == 0)
            .collect();
        if let Some(&i) = none.first() {
            out.push(format!(
                "T10 {} LOW tile(s) with no terrain kind, first {}",
                none.len(),
                at(i)
            ));
        }
    }
    Ok(out)
}
fn number(x: f64) -> String {
    crate::mapgen::map_hash::number_string(x)
}

fn point(p: WorldPt) -> Result<(i64, i64), InputError> {
    if !p.x.is_finite()
        || !p.y.is_finite()
        || p.x.abs() / TILE > i32::MAX as f64
        || p.y.abs() / TILE > i32::MAX as f64
    {
        Err(InputError::Coordinates)
    } else {
        Ok((world_to_tile(p.x), world_to_tile(p.y)))
    }
}
fn index(x: i64, y: i64, w: usize, h: usize) -> Option<usize> {
    if x >= 0 && y >= 0 && x < w as i64 && y < h as i64 {
        Some(y as usize * w + x as usize)
    } else {
        None
    }
}
fn neighbors(i: usize, w: usize, h: usize) -> [Option<usize>; 4] {
    let x = i % w;
    [
        if x > 0 { Some(i - 1) } else { None },
        if x + 1 < w { Some(i + 1) } else { None },
        if i >= w { Some(i - w) } else { None },
        if i / w + 1 < h { Some(i + w) } else { None },
    ]
}
fn components(tiles: &[u8], w: usize, h: usize) -> usize {
    let mut seen = vec![false; tiles.len()];
    let mut queue = Vec::new();
    let mut count = 0;
    for s in 0..tiles.len() {
        if tiles[s] != TILE_FLOOR || seen[s] {
            continue;
        }
        count += 1;
        seen[s] = true;
        queue.clear();
        queue.push(s);
        let mut head = 0;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            for j in neighbors(i, w, h).into_iter().flatten() {
                if tiles[j] == TILE_FLOOR && !seen[j] {
                    seen[j] = true;
                    queue.push(j);
                }
            }
        }
    }
    count
}
fn protect(
    out: &mut Vec<String>,
    what: &str,
    cells: &[(i64, i64)],
    bad: &impl Fn(i64, i64) -> bool,
) {
    if let Some(&(x, y)) = cells.iter().find(|&&(x, y)| bad(x, y)) {
        out.push(format!("T8 {what} tile ({x}, {y}) is not plain floor"));
    }
}
fn around(
    out: &mut Vec<String>,
    what: &str,
    centres: &[(i64, i64)],
    bad: &impl Fn(i64, i64) -> bool,
) {
    for &(x, y) in centres {
        for dy in -1..=1 {
            for dx in -1..=1 {
                if bad(x + dx, y + dy) {
                    out.push(format!("T8 {what} 3x3 at ({x}, {y}) is not plain floor"));
                    return;
                }
            }
        }
    }
}
fn hazard_free(
    out: &mut Vec<String>,
    what: &str,
    centres: &[(i64, i64)],
    half: i64,
    hazard: &impl Fn(i64, i64) -> bool,
) {
    for &(x, y) in centres {
        for dy in -half..=half {
            for dx in -half..=half {
                if hazard(x + dx, y + dy) {
                    out.push(format!(
                        "T8 {what} at ({x}, {y}) holds a floor hazard at ({}, {})",
                        x + dx,
                        y + dy
                    ));
                    return;
                }
            }
        }
    }
}
#[cfg(test)]
mod tests;

fn region_name(code: u8) -> &'static str {
    match code {
        0 => "none",
        1 => "fire",
        2 => "sentenced",
        3 => "plague",
        4 => "frost",
        5 => "holy",
        6 => "coliseum",
        _ => "?",
    }
}
