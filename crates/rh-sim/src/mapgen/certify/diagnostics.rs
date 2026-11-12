#![allow(clippy::needless_range_loop)]
//! Diagnostic text is derived from independently recomputed finished-map facts.
// Row-major geometric scans deliberately index several independent layers.
use super::*;
fn ns(n: f64) -> String {
    crate::mapgen::map_hash::number_string(n)
}
fn where_(i: usize) -> String {
    format!("{},{}", i % R.size, i / R.size)
}
fn join<T: ToString>(values: impl IntoIterator<Item = T>, sep: &str) -> String {
    values
        .into_iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join(sep)
}
fn kind(k: FeatureKind) -> &'static str {
    match k {
        FeatureKind::Landmark => "landmark",
        FeatureKind::Crater => "crater",
        FeatureKind::LavaRiver => "lavaRiver",
        FeatureKind::FenceRow => "fenceRow",
        FeatureKind::Gallows => "gallows",
        FeatureKind::Barrow => "barrow",
        FeatureKind::Mere => "mere",
        FeatureKind::Headland => "headland",
        FeatureKind::Spire => "spire",
        FeatureKind::Causeway => "causeway",
        FeatureKind::Hall => "hall",
        FeatureKind::Infill => "infill",
        FeatureKind::Bush => "bush",
        FeatureKind::BogTree => "bogTree",
        FeatureKind::Church => "church",
        FeatureKind::Graveyard => "graveyard",
        FeatureKind::Volcano => "volcano",
        FeatureKind::LavaStream => "lavaStream",
        FeatureKind::LavaPool => "lavaPool",
        FeatureKind::Cave => "cave",
    }
}
fn job(j: FeatureJob) -> &'static str {
    match j {
        FeatureJob::Landmark => "landmark",
        FeatureJob::Pen => "pen",
        FeatureJob::Crossing => "crossing",
        FeatureJob::Lane => "lane",
        FeatureJob::Fork => "fork",
        FeatureJob::Lee => "lee",
        FeatureJob::Choke => "choke",
        FeatureJob::Cover => "cover",
        FeatureJob::Rest => "rest",
        FeatureJob::Seal => "seal",
    }
}
pub(super) fn message(m: &GameMapData, o: &Options, f: &Failure, strict: &[u8]) -> String {
    if !f.message.is_empty() {
        return f.message.clone();
    }
    let label = super::labels::LABELS
        .iter()
        .find(|(id, _)| *id == f.rule)
        .expect("closed rule inventory")
        .1
        .replace("{subject}", &f.subject);
    let detail = if f.rule.starts_with("feature-") {
        feature_detail(m, f, strict)
    } else {
        detail(m, o, f)
    };
    match detail {
        Some(s) => format!("{label}: {s}"),
        None => label,
    }
}
fn feature_detail(m: &GameMapData, failure: &Failure, strict: &[u8]) -> Option<String> {
    let key = &failure.subject;
    let suffix = key
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .collect::<String>();
    let number = suffix.parse::<usize>().unwrap_or(0);
    let fs = &m.features;
    let n = R.size * R.size;
    let rule = failure.rule;
    if rule == "feature-grid" {
        return Some(if key == "count" {
            format!("{} features", fs.len())
        } else {
            let i = m
                .feature_grid
                .iter()
                .position(|v| *v as usize == number)
                .unwrap();
            format!(
                "featureGrid names feature {} at {} of {}",
                number - 1,
                where_(i),
                fs.len()
            )
        });
    }
    if rule == "feature-unowned" || rule == "feature-hazards" {
        let tiles: Vec<_> = (0..n)
            .filter(|&i| {
                strict.contains(&m.region_grid[i])
                    && m.feature_grid[i] == 0
                    && if rule == "feature-unowned" {
                        m.tiles[i] == 1 || m.tiles[i] == 2
                    } else {
                        m.tiles[i] == 0 && m.terrain[i] != 0
                    }
            })
            .collect();
        return Some(format!(
            "{} tiles, first at {}",
            tiles.len(),
            where_(tiles[0])
        ));
    }
    if rule == "feature-buildings" && key == "n" {
        return Some(format!(
            "{} buildings for {} landmarks",
            m.buildings.len(),
            fs.iter()
                .filter(|f| f.kind == FeatureKind::Landmark)
                .count()
        ));
    }
    let v = if matches!(
        rule,
        "feature-zone" | "feature-kind-tiles" | "feature-overlap"
    ) || (rule == "feature-tiles" && key.starts_with("box"))
    {
        number
    } else {
        number + 1
    };
    let k = v - 1;
    let f = &fs[k];
    let name = kind(f.kind);
    let id = format!("feature {k} ({name})");
    let owned: Vec<_> = (0..n)
        .filter(|&i| m.feature_grid[i] as usize == v)
        .collect();
    let owned_strict: Vec<_> = owned
        .iter()
        .copied()
        .filter(|i| strict.contains(&m.region_grid[*i]))
        .collect();
    Some(match rule {
        "feature-table" => {
            if key.starts_with("jobs") {
                format!("{id} needs one or two distinct jobs from the table")
            } else if key.starts_with("variant") {
                format!("{id} has variant \"{}\"", f.variant)
            } else if key.starts_with("anchor") {
                format!("{id} has an anchor off the map")
            } else if key.starts_with("box") {
                format!("{id} has a box off the map")
            } else {
                format!("{id} has params that are not integers")
            }
        }
        "feature-tiles" => {
            if key.starts_with("box") {
                let i = *owned
                    .iter()
                    .find(|&&i| !inside(&f.bbox, (i % R.size) as i32, (i / R.size) as i32))
                    .unwrap();
                format!("feature {k} owns {} outside its box", where_(i))
            } else {
                format!("{id} counts {} tiles, owns {}", f.tiles, owned.len())
            }
        }
        "feature-zone" => {
            let i = *owned
                .iter()
                .find(|&&i| m.region_grid[i] != f.zone.code())
                .unwrap();
            format!(
                "feature {k} ({name}, {}) owns {} of region {}",
                f.zone.as_str(),
                where_(i),
                m.region_grid[i]
            )
        }
        "feature-order" => {
            if key.starts_with('z') {
                format!("feature {k} ({}) comes after a later zone", f.zone.as_str())
            } else if key.starts_with('r') {
                format!("{id} breaks the landmarks, shapes, infill order of its zone")
            } else {
                format!("zone {} has more than one infill", f.zone.as_str())
            }
        }
        "feature-buildings" => format!("landmark {k} has no building box around it"),
        "feature-landmark" => {
            let id = format!("landmark {k} ({})", f.variant);
            if key.starts_with('d') {
                format!(
                    "{id} is a {} design in the {} zone",
                    super::features::landmark_zone(&f.variant).unwrap().as_str(),
                    f.zone.as_str()
                )
            } else if key.starts_with('m') {
                let b = &f.bbox;
                if b.x < 1
                    || b.y < 1
                    || b.x + b.w as i32 > R.size as i32 - 1
                    || b.y + b.h as i32 > R.size as i32 - 1
                {
                    format!("{id} has no room for its margin")
                } else {
                    format!("{id}: its box + 1 leaves the zone")
                }
            } else if key.starts_with('h') {
                format!(
                    "{id} is closer than {} tiles to a camp halo",
                    R.landmark_gap
                )
            } else if key.starts_with('f') {
                let b = &f.bbox;
                let mut count = 0;
                let mut fl = 0;
                for y in b.y + 1..b.y + b.h as i32 - 1 {
                    for x in b.x + 1..b.x + b.w as i32 - 1 {
                        count += 1;
                        if m.tiles[at(x, y).unwrap()] == 0 {
                            fl += 1;
                        }
                    }
                }
                format!("{id}: only {fl} of {count} interior tiles are floor")
            } else {
                let doors = f.p.get(2..).unwrap_or(&[]);
                if doors.is_empty() {
                    format!("{id} has no door")
                } else if doors.iter().any(|&d| {
                    d < 0
                        || d as usize >= n
                        || m.tiles[d as usize] != 0
                        || m.feature_grid[d as usize] as usize != v
                }) {
                    format!("{id} has a door that is not an owned floor tile")
                } else {
                    let d = *doors
                        .iter()
                        .find(|&&d| {
                            ![d + 1, d - 1, d + R.size as i32, d - R.size as i32]
                                .iter()
                                .any(|j| doors.contains(j))
                        })
                        .unwrap();
                    format!("{id} has a door {} one tile wide", where_(d as usize))
                }
            }
        }
        "feature-kind-tiles" => {
            let def = rules::kind(f.kind);
            if key.starts_with('t') {
                let i = *owned_strict
                    .iter()
                    .find(|&&i| m.tiles[i] == 2 && m.terrain[i] != def.terrain)
                    .unwrap();
                format!(
                    "{id} has a LOW tile of terrain {} at {}",
                    m.terrain[i],
                    where_(i)
                )
            } else {
                let i = *owned_strict
                    .iter()
                    .find(|&&i| (m.tiles[i] == 1 && !def.wall) || (m.tiles[i] == 2 && !def.low))
                    .unwrap();
                format!(
                    "{id} owns a {} tile at {}",
                    if m.tiles[i] == 1 { "WALL" } else { "LOW" },
                    where_(i)
                )
            }
        }
        "feature-overlap" => {
            let (h, p) = protected(m);
            let i = *owned_strict
                .iter()
                .find(|&&i| (m.tiles[i] == 1 || m.tiles[i] == 2) && (h[i] || p[i]))
                .unwrap();
            format!(
                "{id} puts a {} on a camp halo or spawn pad at {}",
                if m.tiles[i] == 1 { "wall" } else { "LOW tile" },
                where_(i)
            )
        }
        "feature-size" => format!(
            "{id} owns {} wall or LOW tiles",
            owned.iter().filter(|&&i| m.tiles[i] != 0).count()
        ),
        "feature-jobs" => {
            if key.starts_with('l') {
                format!("landmark {k} does not name the job \"landmark\"")
            } else {
                format!(
                    "{id} carries jobs {}",
                    join(f.jobs.iter().map(|j| job(*j)), "+")
                )
            }
        }
        "feature-whole" => {
            let sizes = components(
                |i| {
                    m.feature_grid[i] as usize == v
                        && m.tiles[i] == 1
                        && strict.contains(&m.region_grid[i])
                },
                true,
            )
            .0;
            if f.kind == FeatureKind::Gallows {
                format!(
                    "gallows {k} is {} pieces of {} wall tiles",
                    sizes.len(),
                    join(&sizes, "+")
                )
            } else {
                format!(
                    "hall {k} has pieces of {} wall tiles, not all 3x3 piers",
                    join(&sizes, ",")
                )
            }
        }
        "feature-params" => {
            let p = &f.p;
            let get = |i: usize| p.get(i).map_or("undefined".to_owned(), ToString::to_string);
            let reason = match f.kind {
                FeatureKind::Landmark => {
                    if p.len() < 3 || !(0..=3).contains(&p[0]) || ![0, 1].contains(&p[1]) {
                        format!(
                            "params {} are not [rot 0-3, mirror 0/1, doors...]",
                            join(p.iter().take(2), ",")
                        )
                    } else {
                        "door tiles are not ascending".into()
                    }
                }
                FeatureKind::Crater => {
                    if p.len() < 3
                        || p[2] != p.len() as i32 - 3
                        || p[0] < 0
                        || m.camps.get(p[0] as usize).is_none_or(|c| c.zone != f.zone)
                    {
                        format!("[camp {}, radius4 {}, breaches {}, ...] needs a camp of its own zone and one direction per breach",get(0),get(1),get(2))
                    } else {
                        "a breach direction outside 0..15".into()
                    }
                }
                FeatureKind::LavaRiver => format!(
                    "[width2 {}, fords {}, ...] needs one tile per ford",
                    get(0),
                    get(1)
                ),
                FeatureKind::FenceRow => "not [axis 0/1, rowIndex, phase]".into(),
                FeatureKind::Barrow => {
                    if p.len() != 4
                        || ![0, 1].contains(&p[1])
                        || !(0..=15).contains(&p[2])
                        || ![-1, 1].contains(&p[3])
                    {
                        "not [radius4, tunnel 0/1, dir16, wetSide -1/+1]".into()
                    } else {
                        "a tunnel barrow carries the job choke, and only a tunnel barrow does"
                            .into()
                    }
                }
                FeatureKind::Mere => format!(
                    "[lake {}, ice {}] but the lake owns {} ICE tiles",
                    get(0),
                    get(1),
                    owned_strict
                        .iter()
                        .filter(|&&i| m.terrain[i] == R.ice)
                        .count()
                ),
                FeatureKind::Headland => "not [dir16]".into(),
                FeatureKind::Hall => "not [axis 0/1, pitch 6, radius, piers, lightBays]".into(),
                FeatureKind::Bush => "not [eliteCampIndex of its zone, clump]".into(),
                _ => "takes no params".into(),
            };
            format!("{name} {k}: {reason}")
        }
        _ => unreachable!("feature rule inventory"),
    })
}

fn ring(m: &GameMapData) -> Vec<u8> {
    let mut d = vec![255; R.size * R.size];
    for i in 0..d.len() {
        if m.region_grid[i] == 6 {
            for dy in -R.ring..=R.ring {
                for dx in -R.ring..=R.ring {
                    if let Some(j) = offset(i, dx, dy) {
                        d[j] = d[j].min(dx.abs().max(dy.abs()) as u8);
                    }
                }
            }
        }
    }
    d
}
use super::numeric::hypot;

fn distance(a: WorldPt, b: WorldPt) -> f64 {
    hypot(a.x - b.x, a.y - b.y)
}
pub(super) fn fixed(x: f64, d: usize) -> String {
    ryu_js::Buffer::new().format_to_fixed(x, d as u8).to_owned()
}

fn path_stats(m: &GameMapData) -> (Vec<f64>, Vec<usize>) {
    let tm = TileMap::new(m.w, m.h, m.tiles.clone()).unwrap();
    let mut pf = Pathfinder::default();
    let mut lengths = Vec::new();
    let mut hazards = Vec::new();
    for p in &m.spawn_pool {
        let mut a = Vec2::new(p.x, p.y);
        let path = pf.find_path(
            &tm,
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
                    if (4..=6).contains(&m.terrain[t]) {
                        seen[t] = true;
                    }
                }
            }
            a = q;
        }
        lengths.push(length);
        hazards.push(seen.iter().filter(|v| **v).count());
    }
    (lengths, hazards)
}
fn detail(m: &GameMapData, o: &Options, f: &Failure) -> Option<String> {
    let n = R.size * R.size;
    let mut gates = vec![false; n];
    for g in &m.coliseum.gates {
        for t in &g.tiles {
            gates[at(t.x, t.y).unwrap()] = true;
        }
    }
    let centre = tile(m.coliseum.centre);
    let walk = |i: usize| m.tiles[i] == 0;
    Some(match f.rule {
        "grid" => {
            let mut bad = String::new();
            for i in 0..n {
                let x = i % R.size;
                let y = i / R.size;
                let border = x == 0 || y == 0 || x == R.size - 1 || y == R.size - 1;
                if m.tiles[i] > 2 {
                    bad = format!("tile value {} at {x},{y}", m.tiles[i]);
                } else if border && (m.tiles[i] != 1 || m.region_grid[i] != 0) {
                    bad = format!("border {x},{y}");
                } else if !border && m.region_grid[i] == 0 {
                    bad = format!("no region at {x},{y}");
                } else if m.region_grid[i] > 6 {
                    bad = format!("region code {}", m.region_grid[i]);
                }
            }
            bad
        }
        "open-connectivity" => format!("{} components", components(walk, false).0.len()),
        "closed-connectivity" => {
            let (s, l) = components(|i| walk(i) && !gates[i], false);
            let escaped = (0..n).any(|i| l[i] == l[centre] && m.region_grid[i] != 6);
            let stranded =
                (0..n).any(|i| walk(i) && !gates[i] && m.region_grid[i] == 6 && l[i] != l[centre]);
            format!(
                "escaped {escaped}, stranded {stranded}, {} components",
                s.len()
            )
        }
        "arena-links" => {
            let mut bad = String::new();
            for i in 0..n {
                if walk(i)
                    && m.region_grid[i] == 6
                    && !gates[i]
                    && [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().any(|&(dx, dy)| {
                        offset(i, dx, dy).is_some_and(|j| walk(j) && m.region_grid[j] != 6)
                    })
                {
                    bad = where_(i);
                }
            }
            format!("arena tile {bad} touches outside floor")
        }
        "gate-lanes" => {
            let mut bad = String::new();
            for g in &m.coliseum.gates {
                let (ox, oy, name) = match g.side {
                    GateSide::North => (0, -1, "n"),
                    GateSide::East => (1, 0, "e"),
                    GateSide::South => (0, 1, "s"),
                    GateSide::West => (-1, 0, "w"),
                };
                for t in &g.tiles {
                    for k in -3..=3 {
                        if k != 0 && !floor(m, at(t.x + ox * k, t.y + oy * k)) {
                            bad = format!("{name} {k}");
                        }
                    }
                }
                if let (Some(first), Some(last)) = (g.tiles.first(), g.tiles.get(3)) {
                    let ux = (last.x - first.x).signum();
                    let uy = (last.y - first.y).signum();
                    for (e, d) in [(first, -1), (last, 1)] {
                        for k in 1..=3 {
                            if !floor(m, at(e.x + ox * k + ux * d, e.y + oy * k + uy * d)) {
                                bad = format!("{name} outer {k}");
                            }
                        }
                    }
                }
            }
            bad
        }
        "coliseum-footprint" => {
            let b = &m.coliseum.rect;
            let mut rect = 2 * i64::from(b.x) + i64::from(b.w) == R.size as i64
                && 2 * i64::from(b.y) + i64::from(b.h) == R.size as i64;
            let mut sym = true;
            let mut leak = false;
            let coli = |i: Option<usize>| i.is_some_and(|i| m.region_grid[i] == 6);
            for i in 0..n {
                let x = i % R.size;
                let y = i / R.size;
                let c = coli(Some(i));
                if c && !inside(b, x as i32, y as i32) {
                    rect = false;
                }
                if c != coli(Some(y * R.size + R.size - 1 - x))
                    || c != coli(Some((R.size - 1 - y) * R.size + x))
                    || c != coli(Some(x * R.size + y))
                {
                    sym = false;
                }
                if c && square(i, 1).any(|j| !coli(j)) && m.tiles[i] != 1 && !gates[i] {
                    leak = true;
                }
            }
            format!("rect {rect} sym {sym} leak {leak}")
        }
        "coliseum-interior" => {
            let (_, l) = components(|i| walk(i) && !gates[i], false);
            let (cx, cy) = xy(m.coliseum.centre);
            let mut inner = centered(m.coliseum.centre)
                && [R.size as i32 / 2 - 1, R.size as i32 / 2].contains(&cx)
                && [R.size as i32 / 2 - 1, R.size as i32 / 2].contains(&cy)
                && m.coliseum.inner_spawns.len() >= R.players;
            let mut keep = vec![false; n];
            keep[centre] = true;
            for &p in &m.coliseum.inner_spawns {
                let t = tile(p);
                inner &= centered(p) && m.region_grid[t] == 6 && l[t] == l[centre];
                for j in square(t, 1) {
                    if let Some(j) = j {
                        keep[j] = true;
                        inner &= walk(j) && !gates[j];
                    } else {
                        inner = false
                    }
                }
            }
            for g in &m.coliseum.gates {
                let (ox, oy) = match g.side {
                    GateSide::North => (0, -1),
                    GateSide::East => (1, 0),
                    GateSide::South => (0, 1),
                    GateSide::West => (-1, 0),
                };
                for t in &g.tiles {
                    for k in 1..=3 {
                        if let Some(j) = at(t.x - ox * k, t.y - oy * k) {
                            keep[j] = true;
                        }
                    }
                }
            }
            let mut pillars = 0;
            let mut bad = false;
            for i in 0..n {
                if m.tiles[i] == 1 && square(i, 1).all(|j| j.is_some_and(|j| m.region_grid[j] == 6))
                {
                    pillars += 1;
                    bad |= keep[i];
                }
            }
            format!("inner {inner} pillars {pillars} misplaced {bad}")
        }
        "zone-area" => join(
            (1..=5).map(|z| m.region_grid.iter().filter(|v| **v == z).count()),
            "/",
        ),
        "zone-floor-share" => join(
            (1..=5).map(|z| (0..n).filter(|&i| m.region_grid[i] == z && walk(i)).count()),
            "/",
        ),
        "ring-contact" => {
            let d = ring(m);
            join(
                (1..=5).map(|z| {
                    (0..n)
                        .filter(|&i| m.region_grid[i] == z && (1..=3).contains(&d[i]))
                        .count()
                }),
                "/",
            )
        }
        "zone-slivers" => join((1..=5).map(|z| slivers(m, z)), "/"),
        "ring-floor" => {
            let d = ring(m);
            let count = components(|i| (1..=3).contains(&d[i]) && walk(i), false)
                .0
                .len();
            if count != 1 {
                format!("{count} pieces")
            } else {
                "a zone has no ring-road floor".into()
            }
        }
        "camp-count" => join(
            ZONES.iter().map(|z| {
                format!(
                    "{}:{}",
                    m.camps.iter().filter(|c| c.zone == *z).count(),
                    m.camps
                        .iter()
                        .filter(|c| c.zone == *z && c.elite_spot >= 0)
                        .count()
                )
            }),
            "/",
        ),
        "camp-spacing" => {
            let mut spacing = f64::INFINITY;
            for (i, a) in m.camps.iter().enumerate() {
                for b in &m.camps[i + 1..] {
                    spacing = spacing.min(distance(cp(a), cp(b)));
                }
            }
            format!("{} tiles", fixed(spacing / R.tile, 2))
        }
        "territory-partition" => {
            let mut bad = String::new();
            for i in 0..n {
                let z = m.region_grid[i];
                let t = m.territory_grid[i] as usize;
                if (1..=5).contains(&z) {
                    if t == 0 || m.camps.get(t - 1).is_none_or(|c| c.zone.code() != z) {
                        bad = where_(i);
                    }
                } else if t > 0 {
                    bad = format!("{} outside the zones", where_(i));
                }
            }
            bad
        }
        "territory-connectivity" => {
            let ci = f
                .record_index
                .unwrap_or_else(|| m.camps.iter().position(|c| c.id == f.subject).unwrap())
                + 1;
            format!(
                "{} pieces",
                components(|i| walk(i) && m.territory_grid[i] as usize == ci, false)
                    .0
                    .len()
            )
        }
        "camp-area-radius" | "territory-radius" => {
            let ci = f
                .record_index
                .unwrap_or_else(|| m.camps.iter().position(|c| c.id == f.subject).unwrap());
            let c = &m.camps[ci];
            let (cx, cy) = xy(cp(c));
            let mut area = 0;
            let mut far: f64 = 0.0;
            for i in 0..n {
                if walk(i) && m.territory_grid[i] as usize == ci + 1 {
                    area += 1;
                    far = far.max(hypot(
                        (i % R.size) as f64 - f64::from(cx),
                        (i / R.size) as f64 - f64::from(cy),
                    ));
                }
            }
            if f.rule == "territory-radius" {
                format!("{} tiles", fixed(far, 2))
            } else {
                format!(
                    "{area} vs {}, {} vs {}",
                    c.area,
                    ns(far * R.tile),
                    ns(c.radius)
                )
            }
        }
        "elite-selection" => join(
            m.camps
                .iter()
                .filter(|c| c.zone.as_str() == f.subject && c.elite_spot >= 0)
                .map(|c| &c.id),
            ",",
        ),
        "spawn-count" => {
            let mut zones = [false; 5];
            for s in &m.spawn_pool {
                zones[s.zone.code() as usize - 1] = true;
            }
            format!(
                "{} in {}",
                m.spawn_pool.len(),
                zones.iter().filter(|z| **z).count()
            )
        }
        "spawn-placement" => {
            let mut bad = String::new();
            for s in &m.spawn_pool {
                let p = sp(s);
                let (x, y) = xy(p);
                if !centered(p) {
                    bad = "not a tile centre".into();
                }
                for j in square(tile(p), 1) {
                    if !floor(m, j) {
                        bad = format!("3x3 at {x},{y}");
                    }
                }
                if m.region_grid[tile(p)] != s.zone.code() {
                    bad = format!("zone tag at {x},{y}");
                }
                if m.buildings.iter().any(|b| inside(b, x, y)) {
                    bad = format!("in a landmark at {x},{y}");
                }
            }
            bad
        }
        "spawn-spacing" | "spawn-camp-spacing" => {
            let mut sep = f64::INFINITY;
            for (i, a) in m.spawn_pool.iter().enumerate() {
                if f.rule == "spawn-spacing" {
                    for b in &m.spawn_pool[i + 1..] {
                        sep = sep.min(distance(sp(a), sp(b)));
                    }
                } else {
                    for c in &m.camps {
                        sep = sep.min(distance(sp(a), cp(c)));
                    }
                }
            }
            fixed(sep / R.tile, 2)
        }
        "spawn-sight" => {
            let tm = TileMap::new(m.w, m.h, m.tiles.clone()).unwrap();
            let mut bad = String::new();
            for (i, a) in m.spawn_pool.iter().enumerate() {
                for b in &m.spawn_pool[i + 1..] {
                    if distance(sp(a), sp(b)) < R.spawn_safe * R.tile - R.eps
                        && !crate::geometry::raycast(&tm, a.x, a.y, b.x, b.y, 1).hit
                    {
                        bad = format!("{},{} and {},{}", ns(a.x), ns(a.y), ns(b.x), ns(b.y));
                    }
                }
            }
            bad
        }
        "spawn-walk-ratio" => {
            let (l, _) = path_stats(m);
            fixed(
                l.iter().copied().fold(f64::NEG_INFINITY, f64::max)
                    / l.iter().copied().fold(f64::INFINITY, f64::min),
                4,
            )
        }
        "spawn-walk-hazards" => path_stats(m)
            .1
            .iter()
            .max()
            .map_or("-Infinity".into(), ToString::to_string),
        "views" => views(m),
        "crates" => crates(m),
        "ground" => ground(m),
        "building-margin" => {
            let mut bad = String::new();
            for (k, b) in m.buildings.iter().enumerate() {
                let z = at(b.x, b.y).map_or(0, |i| m.region_grid[i]);
                if !(1..=5).contains(&z) {
                    bad = format!("landmark {k} not in a zone");
                }
                for y in b.y - 1..=b.y + b.h as i32 {
                    for x in b.x - 1..=b.x + b.w as i32 {
                        if at(x, y).is_none_or(|i| m.region_grid[i] != z) {
                            bad = format!("landmark {k} margin");
                        }
                    }
                }
            }
            bad
        }
        "terrain-validator" => super::terrain::errors(m, o)
            .into_iter()
            .take(2)
            .collect::<Vec<_>>()
            .join("; "),
        "terrain-protected" => protected_bad(m),
        "ice-neighbours" => {
            let mut bad = String::new();
            for i in 0..n {
                if m.terrain[i] == 6 && square(i, 1).any(|j| j.is_none_or(|j| m.tiles[j] != 0)) {
                    bad = where_(i);
                }
            }
            bad
        }
        "reachability" => {
            let (_, l) = components(walk, false);
            let mut points = Vec::new();
            points.extend(
                m.coliseum
                    .inner_spawns
                    .iter()
                    .map(|p| ("inner spawn".to_owned(), *p)),
            );
            points.extend(
                m.regions
                    .iter()
                    .map(|r| (format!("{} pole", r.id.as_str()), r.pole)),
            );
            points.extend(m.spawn_pool.iter().map(|p| ("spawn".to_owned(), sp(p))));
            points.extend(m.crate_spots.iter().map(|p| ("crate".to_owned(), *p)));
            points.extend(
                m.ground_spots
                    .iter()
                    .map(|p| ("ground spot".to_owned(), *p)),
            );
            for c in &m.camps {
                points.extend(
                    [cp(c), c.chest]
                        .into_iter()
                        .chain(c.spots.iter().copied())
                        .map(|p| (c.id.clone(), p)),
                );
            }
            join(
                points
                    .iter()
                    .filter(|(_, p)| l[tile(*p)] != l[centre])
                    .take(3)
                    .map(|(w, p)| format!("{w} {},{}", ns(p.x), ns(p.y))),
                "; ",
            )
        }
        "zone-terrain-home" => {
            let mut bad = String::new();
            for i in 0..n {
                let k = m.terrain[i] as usize;
                if k > 0
                    && rules::TERRAIN
                        .get(k)
                        .is_none_or(|t| t.1 != m.region_grid[i])
                {
                    bad = format!(
                        "{} at {}",
                        super::terrain::KEYS.get(k).unwrap_or(&"unknown"),
                        where_(i)
                    );
                }
            }
            bad
        }
        "zone-floor-connectivity" => join(
            (1..=5).map(|z| {
                components(|i| m.region_grid[i] == z && walk(i), false)
                    .0
                    .len()
            }),
            "/",
        ),
        "pieces" => {
            let z = ZONES
                .iter()
                .find(|z| z.as_str() == f.subject)
                .unwrap()
                .code();
            let mut s = components(|i| m.region_grid[i] == z && m.tiles[i] == 1, true).0;
            s.sort_unstable();
            format!(
                "{} has {} ({} single tiles; sizes {})",
                f.subject,
                s.iter().filter(|v| **v < R.piece_min).count(),
                s.iter().filter(|v| **v == 1).count(),
                join(s.iter().filter(|v| **v < R.piece_min), ",")
            )
        }
        _ => return None,
    })
}
fn views(m: &GameMapData) -> String {
    let mut bad = String::new();
    let weapons = rules::WEAPONS;
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
        let name = r.id.as_str();
        if r.mob_camps != camps {
            bad = format!("{name} mobCamps");
        }
        if r.spawns != spawns {
            bad = format!("{name} spawns");
        }
        let painted = m
            .region_grid
            .iter()
            .filter(|v| **v as usize == z + 1)
            .count();
        if z >= ZONES.len() || r.area as usize != painted {
            let painted = if z < ZONES.len() {
                painted.to_string()
            } else {
                "undefined".into()
            };
            bad = format!("{name} area {} vs {painted}", r.area);
        }
        let t = tile(r.pole);
        let (x, y) = xy(r.pole);
        if !centered(r.pole)
            || m.tiles[t] != 0
            || m.region_grid[t] as usize != z + 1
            || m.buildings.iter().any(|b| inside(b, x, y))
        {
            bad = format!("{name} pole");
        }
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
    if m.spawns != interleaved {
        bad = "spawns not interleaved by zone".into();
    }
    let crates: Vec<_> = m
        .regions
        .iter()
        .flat_map(|r| r.chest_spots.iter().copied())
        .collect();
    if m.crate_spots != crates {
        bad = "crateSpots".into();
    }
    bad
}
fn crates(m: &GameMapData) -> String {
    let d = ring(m);
    let mut bad = String::new();
    let mut seen = vec![false; R.size * R.size];
    for r in &m.regions {
        let name = r.id.as_str();
        if r.chest_spots.len() < R.crates_min || r.chest_spots.len() > R.crates_max {
            bad = format!("{name}: {}", r.chest_spots.len());
        }
        for (i, &p) in r.chest_spots.iter().enumerate() {
            let t = tile(p);
            let (x, y) = xy(p);
            if !centered(p)
                || m.tiles[t] != 0
                || m.region_grid[t] != r.id.code()
                || d[t] <= 3
                || x < 2
                || y < 2
                || x > R.size as i32 - 3
                || y > R.size as i32 - 3
            {
                bad = format!("{name} crate {x},{y} placement");
            }
            let wall = [(1, 0), (-1, 0), (0, 1), (0, -1)]
                .iter()
                .any(|&(dx, dy)| offset(t, dx, dy).is_some_and(|j| m.tiles[j] & 1 != 0));
            if !wall && !square(t, 1).all(|i| floor(m, i)) {
                bad = format!("{name} crate {x},{y} neither against a wall nor in the open");
            }
            if m.spawn_pool.iter().any(|s| cheb(tile(sp(s)), t) < 3)
                || m.camps
                    .iter()
                    .flat_map(|c| &c.spots)
                    .any(|s| cheb(tile(*s), t) < 2)
                || m.camps.iter().any(|c| cheb(tile(cp(c)), t) < 3)
            {
                bad = format!("{name} crate {x},{y} too near a spawn, spot or camp");
            }
            if seen[t] {
                bad = "duplicate".into();
            }
            seen[t] = true;
            if r.chest_spots[..i].iter().any(|s| cheb(tile(*s), t) < 2) {
                bad = format!("{name} crates touch");
            }
        }
    }
    bad
}
fn ground(m: &GameMapData) -> String {
    let mut bad = if (R.ground_min..=R.ground_max).contains(&m.ground_spots.len()) {
        String::new()
    } else {
        format!("{} spots", m.ground_spots.len())
    };
    let mut seen = vec![false; R.size * R.size];
    for &p in &m.ground_spots {
        let t = tile(p);
        if seen[t] {
            bad = "duplicates".into();
        }
        seen[t] = true;
    }
    let mut clear = vec![false; R.size * R.size];
    for c in &m.camps {
        let t = tile(cp(c));
        for dy in -2..=2 {
            for dx in -2..=2 {
                if f64::from(dx * dx + dy * dy) <= R.clearing * R.clearing {
                    if let Some(j) = offset(t, dx, dy) {
                        clear[j] = true;
                    }
                }
            }
        }
    }
    for &p in &m.ground_spots {
        let t = tile(p);
        let (x, y) = xy(p);
        if !centered(p)
            || m.tiles[t] != 0
            || m.region_grid[t] == 6
            || m.buildings.iter().any(|b| inside(b, x, y))
            || clear[t]
        {
            bad = format!("{x},{y} placement");
        }
        if m.spawn_pool
            .iter()
            .any(|s| distance(sp(s), p) < 3.0 * R.tile)
            || m.crate_spots.iter().any(|c| cheb(tile(*c), t) < 2)
        {
            bad = format!("{x},{y} near a spawn or crate");
        }
    }
    bad
}
fn protected_bad(m: &GameMapData) -> String {
    let mut bad = String::new();
    let mut plain = |p: WorldPt, r: i32, what: &str, any: bool, halo: bool| {
        let (cx, cy) = xy(p);
        for dy in -r..=r {
            for dx in -r..=r {
                if halo && dx.abs() == 3 && dy.abs() == 3 {
                    continue;
                }
                let k = at(cx + dx, cy + dy).map(|i| m.terrain[i]);
                if if any {
                    k != Some(0)
                } else {
                    k.is_some_and(|k| {
                        k > 0 && rules::TERRAIN.get(k as usize).is_some_and(|t| t.0 == 0)
                    })
                } {
                    bad = format!("{what} at {cx},{cy}");
                }
            }
        }
    };
    for s in &m.spawn_pool {
        plain(sp(s), 1, "spawn 3x3", true, false);
        plain(sp(s), 2, "spawn 5x5", false, false);
    }
    for &p in &m.crate_spots {
        plain(p, 1, "crate 3x3", true, false);
    }
    for c in &m.camps {
        plain(cp(c), 3, "camp clearing and halo", true, true);
    }
    for &p in &m.ground_spots {
        plain(p, 0, "ground spot", true, false);
        plain(p, 1, "ground spot 3x3", false, false);
    }
    bad
}
