#![allow(clippy::needless_range_loop)]
//! Independent T1–T11 checks. In particular this module never calls terrain_gate.
// Row-major geometric scans deliberately index several independent layers.
use super::*;
fn plain(m: &GameMapData, i: Option<usize>) -> bool {
    i.is_some_and(|i| m.tiles[i] == 0 && m.terrain[i] == 0)
}
fn hazard(m: &GameMapData, i: Option<usize>) -> bool {
    i.is_some_and(|i| {
        m.terrain[i] != 0
            && rules::TERRAIN
                .get(m.terrain[i] as usize)
                .is_some_and(|k| k.0 == 0)
    })
}
pub(super) fn check(m: &GameMapData, o: &Options, out: &mut Certificate) {
    let n = R.size * R.size;
    let valid = errors(m, o).is_empty();
    out.check("terrain-validator", "", valid);
    out.check(
        "unstyled-terrain",
        "",
        o.styled
            || o.zone
            || (m.terrain.iter().all(|k| *k == 0)
                && m.tiles.iter().all(|k| *k != 2)
                && m.props.is_empty()),
    );
    let mut safe = true;
    for s in &m.spawn_pool {
        safe &= square(tile(sp(s)), R.spawn_pad).all(|j| j.is_some_and(|j| m.terrain[j] == 0))
            && square(tile(sp(s)), R.spawn_hazard).all(|j| !hazard(m, j));
    }
    for p in &m.crate_spots {
        safe &= square(tile(*p), R.crate_pad).all(|j| j.is_some_and(|j| m.terrain[j] == 0));
    }
    for c in &m.camps {
        let t = tile(cp(c));
        for dy in -R.camp_span..=R.camp_span {
            for dx in -R.camp_span..=R.camp_span {
                if dx.abs() == R.camp_span && dy.abs() == R.camp_span {
                    continue;
                }
                safe &= offset(t, dx, dy).is_some_and(|i| m.terrain[i] == 0);
            }
        }
    }
    for &p in &m.ground_spots {
        safe &= m.terrain[tile(p)] == 0 && square(tile(p), R.ground_hazard).all(|j| !hazard(m, j));
    }
    out.check("terrain-protected", "", safe);
    out.check(
        "ice-neighbours",
        "",
        (0..n).all(|i| {
            m.terrain[i] != R.ice || square(i, 1).all(|j| j.is_some_and(|j| m.tiles[j] == 0))
        }),
    );
}
pub(super) const KEYS: [&str; 8] = [
    "none", "lava", "fence", "crevasse", "ember", "bog", "ice", "light",
];
fn coord(i: usize) -> String {
    format!("({}, {})", i % R.size, i / R.size)
}
fn number(n: f64) -> String {
    crate::mapgen::map_hash::number_string(n)
}
fn group(
    m: &GameMapData,
    rule: u8,
    check: impl Fn(usize) -> bool,
    describe: impl Fn(usize, usize) -> String,
    out: &mut Vec<String>,
) {
    let mut first = 0;
    let mut count = 0;
    for i in 0..m.tiles.len() {
        if check(i) {
            if count == 0 {
                first = i;
            }
            count += 1;
        }
    }
    if count > 0 {
        out.push(format!("T{rule} {}", describe(count, first)));
    }
}
/// Ordered T2–T11 evidence; bounded T1 shape admission happens before any indexing.
pub(super) fn errors(m: &GameMapData, o: &Options) -> Vec<String> {
    let n = R.size * R.size;
    let mut out = Vec::new();
    group(
        m,
        2,
        |i| m.tiles[i] > 2,
        |c, i| {
            format!(
                "{c} tile(s) with a code outside {{floor, wall, low}}, first {} = {}",
                coord(i),
                m.tiles[i]
            )
        },
        &mut out,
    );
    group(
        m,
        2,
        |i| m.terrain[i] as usize >= rules::TERRAIN.len(),
        |c, i| {
            format!(
                "{c} tile(s) with a terrain kind >= {}, first {} = {}",
                rules::TERRAIN.len(),
                coord(i),
                m.terrain[i]
            )
        },
        &mut out,
    );
    group(
        m,
        3,
        |i| {
            let k = m.terrain[i] as usize;
            k > 0
                && m.tiles[i] <= 2
                && rules::TERRAIN
                    .get(k)
                    .is_some_and(|s| m.tiles[i] != s.0 && !(s.0 == 2 && m.tiles[i] == 1))
        },
        |c, i| {
            format!("{c} tile(s) whose terrain disagrees with the tile class, first {}: {} on tile code {}",coord(i),KEYS[m.terrain[i]as usize],m.tiles[i])
        },
        &mut out,
    );
    let mut border = None;
    for x in 0..R.size {
        if m.tiles[x] != 1 {
            border = Some(x);
            break;
        } else if m.tiles[(R.size - 1) * R.size + x] != 1 {
            border = Some((R.size - 1) * R.size + x);
            break;
        }
    }
    if border.is_none() {
        for y in 0..R.size {
            if m.tiles[y * R.size] != 1 {
                border = Some(y * R.size);
                break;
            } else if m.tiles[y * R.size + R.size - 1] != 1 {
                border = Some(y * R.size + R.size - 1);
                break;
            }
        }
    }
    if let Some(i) = border {
        out.push(format!("T4 border tile {} is not a wall", coord(i)));
    }
    let mut d = vec![usize::MAX; n];
    let mut queue = Vec::with_capacity(n);
    for i in 0..n {
        if m.tiles[i] == 0 {
            d[i] = 0;
            queue.push(i);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        if d[i] >= R.snap {
            continue;
        }
        for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
            if let Some(j) = offset(i, dx, dy) {
                if d[j] == usize::MAX {
                    d[j] = d[i] + 1;
                    queue.push(j);
                }
            }
        }
    }
    group(
        m,
        5,
        |i| m.tiles[i] == 2 && d[i] == usize::MAX,
        |c, i| {
            format!(
                "{c} LOW tile(s) more than {} tiles from any floor, first {}",
                R.snap,
                coord(i)
            )
        },
        &mut out,
    );
    group(
        m,
        11,
        |i| {
            m.terrain[i] == R.ice
                && square(i, 1)
                    .enumerate()
                    .any(|(k, j)| k != 4 && !floor(m, j))
        },
        |c, i| {
            format!("{c} ICE tile(s) with a wall, LOW tile or the map edge in their 8-neighbourhood, first {}",coord(i))
        },
        &mut out,
    );
    if m.regions.is_empty() {
        return out;
    }
    let region = |i: usize| match m.region_grid[i] {
        0 => "none",
        1 => "fire",
        2 => "sentenced",
        3 => "plague",
        4 => "frost",
        5 => "holy",
        6 => "coliseum",
        _ => "?",
    };
    group(
        m,
        6,
        |i| (m.tiles[i] == 2 || m.terrain[i] != 0) && !(1..=5).contains(&m.region_grid[i]),
        |c, i| {
            format!(
                "{c} LOW or kinded tile(s) outside every faction region, first {} in {}",
                coord(i),
                region(i)
            )
        },
        &mut out,
    );
    group(
        m,
        6,
        |i| {
            m.terrain[i] != 0
                && (1..=5).contains(&m.region_grid[i])
                && rules::TERRAIN
                    .get(m.terrain[i] as usize)
                    .is_some_and(|s| s.1 != 0 && s.1 != m.region_grid[i])
        },
        |c, i| {
            format!(
                "{c} kinded tile(s) outside their home zone, first {}: {} in {}",
                coord(i),
                KEYS[m.terrain[i] as usize],
                region(i)
            )
        },
        &mut out,
    );
    let open = components(|i| m.tiles[i] == 0, false).0.len();
    if open != 1 {
        out.push(format!(
            "T7 floor has {open} components with the gates open, expected 1"
        ));
    }
    let mut gates = vec![false; n];
    for g in &m.coliseum.gates {
        for p in &g.tiles {
            gates[at(p.x, p.y).unwrap()] = true;
        }
    }
    let closed = components(|i| m.tiles[i] == 0 && !gates[i], false).0.len();
    if closed != 2 {
        out.push(format!(
            "T7 floor has {closed} components with the gates closed, expected 2"
        ));
    }
    let protect = |name: &str, cells: &[(i32, i32)], out: &mut Vec<String>| {
        if let Some(&(x, y)) = cells.iter().find(|&&(x, y)| !plain(m, at(x, y))) {
            out.push(format!("T8 {name} tile ({x}, {y}) is not plain floor"));
        }
    };
    let around = |name: &str, points: &[WorldPt], out: &mut Vec<String>| {
        for &p in points {
            let (cx, cy) = xy(p);
            if square(tile(p), R.spawn_pad).any(|i| !plain(m, i)) {
                out.push(format!("T8 {name} 3x3 at ({cx}, {cy}) is not plain floor"));
                break;
            }
        }
    };
    let hazard_free = |name: &str, cells: &[(i32, i32)], half: i32, out: &mut Vec<String>| {
        for &(cx, cy) in cells {
            for dy in -half..=half {
                for dx in -half..=half {
                    let x = cx + dx;
                    let y = cy + dy;
                    if hazard(m, at(x, y)) {
                        out.push(format!(
                            "T8 {name} at ({cx}, {cy}) holds a floor hazard at ({x}, {y})"
                        ));
                        return;
                    }
                }
            }
        }
    };
    let gate_tiles: Vec<_> = m
        .coliseum
        .gates
        .iter()
        .flat_map(|g| g.tiles.iter().map(|t| (t.x, t.y)))
        .collect();
    protect("gate", &gate_tiles, &mut out);
    if let Some(i) =
        (0..n).find(|&i| m.region_grid[i] == 6 && (m.tiles[i] == 2 || m.terrain[i] != 0))
    {
        out.push(format!("T8 coliseum tile {} has LOW or terrain", coord(i)));
    }
    let spawns: Vec<_> = m
        .spawns
        .iter()
        .copied()
        .chain(m.spawn_pool.iter().map(sp))
        .chain(m.regions.iter().flat_map(|r| r.spawns.iter().copied()))
        .collect();
    around("spawn", &spawns, &mut out);
    around("inner spawn", &m.coliseum.inner_spawns, &mut out);
    let chests: Vec<_> = m
        .crate_spots
        .iter()
        .copied()
        .chain(m.regions.iter().flat_map(|r| r.chest_spots.iter().copied()))
        .chain(m.camps.iter().map(|c| c.chest))
        .map(xy)
        .collect();
    protect("chest", &chests, &mut out);
    hazard_free(
        "spawn 5x5",
        &spawns.iter().copied().map(xy).collect::<Vec<_>>(),
        R.spawn_hazard,
        &mut out,
    );
    hazard_free("chest or crate 3x3", &chests, R.crate_pad, &mut out);
    hazard_free(
        "ground-loot spot 3x3",
        &m.ground_spots.iter().copied().map(xy).collect::<Vec<_>>(),
        R.ground_hazard,
        &mut out,
    );
    let mut clearing = Vec::new();
    for (p, r) in m.camps.iter().map(|c| (cp(c), c.r)).chain(
        m.regions
            .iter()
            .flat_map(|r| r.mob_camps.iter().map(|c| (point(c.x, c.y), c.r))),
    ) {
        let (cx, cy) = xy(p);
        let span = (r / R.tile).ceil() as i32;
        for dy in -span..=span {
            for dx in -span..=span {
                let px = (f64::from(cx + dx) + 0.5) * R.tile - p.x;
                let py = (f64::from(cy + dy) + 0.5) * R.tile - p.y;
                if px * px + py * py <= r * r {
                    clearing.push((cx + dx, cy + dy));
                }
            }
        }
    }
    protect("camp clearing", &clearing, &mut out);
    hazard_free("camp clearing (+1 tile)", &clearing, R.halo, &mut out);
    for (k, p) in m.props.iter().enumerate() {
        let (x, y) = xy(point(p.x, p.y));
        let i = at(x, y);
        let bad = match i.filter(|_| (p.x + p.y).is_finite()) {
            None => Some(format!(
                "prop {k} at ({}, {}) is out of bounds",
                number(p.x),
                number(p.y)
            )),
            Some(_) if p.kind as usize >= rules::PROP_CLASSES.len() => {
                Some(format!("prop {k} has unknown kind {}", p.kind))
            }
            Some(i) if m.tiles[i] != rules::PROP_CLASSES[p.kind as usize] => Some(format!(
                "prop {k} ({}) stands on tile code {}, needs {}",
                PROP_KEYS[p.kind as usize],
                m.tiles[i],
                rules::PROP_CLASSES[p.kind as usize]
            )),
            Some(_) => None,
        };
        if let Some(bad) = bad {
            out.push(format!("T9 {bad}"));
            break;
        }
    }
    if o.styled || o.zone {
        group(
            m,
            10,
            |i| m.tiles[i] == 2 && m.terrain[i] == 0,
            |c, i| format!("{c} LOW tile(s) with no terrain kind, first {}", coord(i)),
            &mut out,
        );
    }
    out
}
const PROP_KEYS: [&str; 34] = [
    "ember_vent",
    "glow_crack",
    "basalt_shard",
    "ash_drift",
    "banner",
    "chain",
    "gallows",
    "cell_bars",
    "lantern",
    "fungus_cap",
    "bubble",
    "drip",
    "pipe",
    "ice_spire",
    "snow_drift",
    "frost_sparkle",
    "icicle",
    "column_cap",
    "banner_red",
    "candelabra",
    "rubble",
    "stained_glass",
    "crater_lip",
    "anvil",
    "slag_heap",
    "gate_post",
    "stocks",
    "tunnel_beam",
    "burrow_rubble",
    "reed",
    "tower_frost",
    "ice_crack",
    "altar",
    "brazier",
];
