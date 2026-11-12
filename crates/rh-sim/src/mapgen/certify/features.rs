#![allow(clippy::needless_range_loop)]
use super::*;
// Row-major geometric scans deliberately index several independent layers.
use FeatureJob as J;
use FeatureKind as K;
fn push(out: &mut Certificate, rule: &'static str, key: String) {
    if !out
        .failures
        .iter()
        .any(|f| f.rule == rule && f.subject == key)
    {
        out.failures.push(Failure {
            rule,
            subject: key,
            message: String::new(),
            record_index: None,
        });
    }
}
pub(super) fn check(m: &GameMapData, out: &mut Certificate) {
    let n = R.size * R.size;
    let fs = &m.features;
    let mut owned = vec![0; fs.len() + 1];
    let mut solids = vec![0; fs.len() + 1];
    out.check("feature-grid", "count", fs.len() <= R.features);
    for (k, f) in fs.iter().enumerate() {
        let variant = if f.kind == K::Landmark {
            landmark_zone(&f.variant).is_some()
        } else {
            f.variant.is_empty()
        };
        let jobs = !f.jobs.is_empty()
            && f.jobs.len() <= R.jobs_max
            && f.jobs
                .iter()
                .enumerate()
                .all(|(i, j)| !f.jobs[..i].contains(j));
        out.check("feature-table", format!("jobs{k}"), jobs);
        out.check("feature-table", format!("variant{k}"), variant);
        out.check(
            "feature-table",
            format!("anchor{k}"),
            at(f.ax, f.ay).is_some(),
        );
        out.check(
            "feature-table",
            format!("box{k}"),
            f.bbox.w > 0 && f.bbox.h > 0,
        );
    }
    for i in 0..n {
        let v = m.feature_grid[i] as usize;
        if v == 0 {
            continue;
        }
        if v > fs.len() {
            push(out, "feature-grid", format!("v{v}"));
            continue;
        }
        owned[v] += 1;
        if m.tiles[i] != 0 {
            solids[v] += 1;
        }
        let f = &fs[v - 1];
        if !inside(&f.bbox, (i % R.size) as i32, (i / R.size) as i32) {
            push(out, "feature-tiles", format!("box{v}"));
        }
        if m.region_grid[i] != f.zone.code() {
            push(out, "feature-zone", format!("z{v}"));
        }
    }
    for (k, f) in fs.iter().enumerate() {
        out.check(
            "feature-tiles",
            format!("n{k}"),
            f.tiles as usize == owned[k + 1] && owned[k + 1] > 0,
        );
    }
    let mut last = 0;
    let mut stage = 0;
    let mut infills = 0;
    for (k, f) in fs.iter().enumerate() {
        let z = f.zone.code();
        out.check("feature-order", format!("z{k}"), z >= last);
        if z != last {
            last = z;
            stage = 0;
            infills = 0;
        }
        let rank = if f.kind == K::Landmark {
            0
        } else if f.kind == K::Infill {
            2
        } else {
            1
        };
        out.check("feature-order", format!("r{k}"), rank >= stage);
        stage = stage.max(rank);
        if f.kind == K::Infill {
            infills += 1;
            out.check("feature-order", format!("i{k}"), infills <= 1);
        }
    }
    let (halo, pad) = protected(m);
    let mut near = vec![false; n];
    for i in 0..n {
        if halo[i] {
            for j in square(i, R.landmark_gap - 1).flatten() {
                near[j] = true;
            }
        }
    }
    let landmarks: Vec<_> = fs
        .iter()
        .enumerate()
        .filter(|(_, f)| f.kind == K::Landmark)
        .collect();
    for &(k, f) in &landmarks {
        let b = &f.bbox;
        out.check(
            "feature-landmark",
            format!("d{k}"),
            landmark_zone(&f.variant).is_none_or(|z| z == f.zone),
        );
        let margin_room = b.x >= R.landmark_margin
            && b.y >= R.landmark_margin
            && i64::from(b.x) + i64::from(b.w) <= R.size as i64 - i64::from(R.landmark_margin)
            && i64::from(b.y) + i64::from(b.h) <= R.size as i64 - i64::from(R.landmark_margin);
        if !margin_room {
            push(out, "feature-landmark", format!("m{k}"));
            continue;
        }
        out.check(
            "feature-landmark",
            format!("m{k}"),
            (b.y - R.landmark_margin..b.y + b.h as i32 + R.landmark_margin).all(|y| {
                (b.x - R.landmark_margin..b.x + b.w as i32 + R.landmark_margin)
                    .all(|x| at(x, y).is_some_and(|i| m.region_grid[i] == f.zone.code()))
            }),
        );
        out.check(
            "feature-landmark",
            format!("h{k}"),
            (0..n).all(|i| {
                m.feature_grid[i] as usize != k + 1
                    || !inside(b, (i % R.size) as i32, (i / R.size) as i32)
                    || !near[i]
            }),
        );
        let doors = f.p.get(2..).unwrap_or(&[]);
        let valid = !doors.is_empty()
            && doors.iter().all(|&d| {
                d >= 0
                    && (d as usize) < n
                    && m.tiles[d as usize] == 0
                    && m.feature_grid[d as usize] as usize == k + 1
            });
        let mut door_set = vec![false; n];
        if valid {
            for &d in doors {
                door_set[d as usize] = true;
            }
        }
        let wide = valid
            && doors.iter().all(|&d| {
                [d + 1, d - 1, d + R.size as i32, d - R.size as i32]
                    .iter()
                    .any(|&j| j >= 0 && (j as usize) < n && door_set[j as usize])
            });
        out.check("feature-landmark", format!("o{k}"), valid && wide);
        let mut cells = 0;
        let mut floor = 0;
        for y in b.y + R.landmark_margin..b.y + b.h as i32 - R.landmark_margin {
            for x in b.x + R.landmark_margin..b.x + b.w as i32 - R.landmark_margin {
                cells += 1;
                if m.tiles[at(x, y).unwrap()] == 0 {
                    floor += 1;
                }
            }
        }
        out.check(
            "feature-landmark",
            format!("f{k}"),
            cells == 0 || floor as f64 >= R.landmark_floor * cells as f64,
        );
    }
    out.check(
        "feature-buildings",
        "n",
        m.buildings.len() == landmarks.len(),
    );
    if m.buildings.len() == landmarks.len() {
        for &(k, f) in &landmarks {
            let b = &f.bbox;
            out.check(
                "feature-buildings",
                format!("b{k}"),
                m.buildings.iter().any(|q| {
                    b.x >= q.x
                        && b.y >= q.y
                        && i64::from(b.x) + i64::from(b.w) <= i64::from(q.x) + i64::from(q.w)
                        && i64::from(b.y) + i64::from(b.h) <= i64::from(q.y) + i64::from(q.h)
                }),
            );
        }
    }
    if out.strict_zones.is_empty() {
        return;
    }
    let mut unowned = false;
    let mut hazard = false;
    let mut ice = vec![0; fs.len() + 1];
    let mut walls = vec![Vec::new(); fs.len() + 1];
    for i in 0..n {
        if !out.strict_zones.contains(&m.region_grid[i]) {
            continue;
        }
        let v = m.feature_grid[i] as usize;
        let t = m.tiles[i];
        if v == 0 {
            unowned |= t == 1 || t == 2;
            hazard |= t == 0 && m.terrain[i] != 0;
            continue;
        }
        if v > fs.len() {
            continue;
        }
        let f = &fs[v - 1];
        let kind = rules::kind(f.kind);
        if t == 1 && matches!(f.kind, K::Gallows | K::Hall) {
            walls[v].push(i);
        }
        if m.terrain[i] == R.ice {
            ice[v] += 1;
        }
        if (t == 1 && !kind.wall) || (t == 2 && !kind.low) {
            push(out, "feature-kind-tiles", format!("c{v}"));
        }
        if t == 2 && kind.terrain != 0 && m.terrain[i] != kind.terrain {
            push(out, "feature-kind-tiles", format!("t{v}"));
        }
        if (t == 1 || t == 2) && (halo[i] || pad[i]) {
            push(out, "feature-overlap", format!("w{v}"));
        }
    }
    out.check("feature-unowned", "n", !unowned);
    out.check("feature-hazards", "n", !hazard);
    for (k, f) in fs.iter().enumerate() {
        if !out.strict_zones.contains(&f.zone.code()) {
            continue;
        }
        let kind = rules::kind(f.kind);
        out.check(
            "feature-size",
            format!("s{k}"),
            !(kind.wall || kind.low) || f.kind == K::Infill || solids[k + 1] >= R.piece_min,
        );
        out.check(
            "feature-jobs",
            format!("l{k}"),
            f.kind != K::Landmark || f.jobs.contains(&J::Landmark),
        );
        out.check(
            "feature-jobs",
            format!("j{k}"),
            f.jobs.iter().all(|j| kind.jobs.contains(j)),
        );
        if matches!(f.kind, K::Gallows | K::Hall) {
            let mut mask = vec![false; n];
            for &i in &walls[k + 1] {
                mask[i] = true;
            }
            let (sizes, labels) = components(|i| mask[i], true);
            let mut bounds = vec![(R.size, R.size, 0, 0); sizes.len()];
            for &i in &walls[k + 1] {
                let b = &mut bounds[labels[i] as usize];
                b.0 = b.0.min(i % R.size);
                b.1 = b.1.min(i / R.size);
                b.2 = b.2.max(i % R.size);
                b.3 = b.3.max(i / R.size);
            }
            let squares = sizes.iter().zip(&bounds).all(|(&s, b)| {
                s == R.square_side * R.square_side
                    && b.2 - b.0 == R.square_side - 1
                    && b.3 - b.1 == R.square_side - 1
            });
            let good = if f.kind == K::Gallows {
                sizes.len() == 1 && squares
            } else {
                !sizes.is_empty() && squares
            };
            out.check(
                "feature-whole",
                format!("{}{k}", if f.kind == K::Gallows { "g" } else { "h" }),
                good,
            );
        }
        let p = &f.p;
        let get = |i: usize| p.get(i).copied().unwrap_or(i32::MIN);
        let binary = |x| x == 0 || x == 1;
        let valid = match f.kind {
            K::Landmark => {
                p.len() >= kind.params_min
                    && (0..R.rotation_count).contains(&p[0])
                    && binary(p[1])
                    && p[2..].windows(2).all(|w| w[1] > w[0])
            }
            K::Crater => {
                p.len() >= kind.params_min
                    && get(2) == p.len() as i32 - kind.params_min as i32
                    && get(0) >= 0
                    && m.camps
                        .get(get(0) as usize)
                        .is_some_and(|c| c.zone == f.zone)
                    && p[kind.params_min..]
                        .iter()
                        .all(|d| (0..R.direction_count).contains(d))
            }
            K::LavaRiver => {
                p.len() >= kind.params_min
                    && get(1) == p.len() as i32 - kind.params_min as i32
                    && get(0) >= 1
            }
            K::FenceRow => p.len() == kind.params_min && binary(get(0)),
            K::Barrow => {
                p.len() == kind.params_min
                    && binary(get(1))
                    && (0..R.direction_count).contains(&get(2))
                    && [-1, 1].contains(&get(3))
                    && ((get(1) == 1) == f.jobs.contains(&J::Choke))
            }
            K::Mere => p.len() == kind.params_min && get(1) == ice[k + 1],
            K::Headland => p.len() == kind.params_min && (0..R.direction_count).contains(&get(0)),
            K::Hall => p.len() == kind.params_min && binary(get(0)) && get(1) == R.hall_pitch,
            K::Bush => {
                p.len() == kind.params_min
                    && get(0) >= 0
                    && m.camps
                        .get(get(0) as usize)
                        .is_some_and(|c| c.zone == f.zone && c.elite_spot >= 0)
            }
            K::Gallows | K::Spire | K::Causeway | K::Infill => p.len() == kind.params_min,
            K::BogTree | K::Church | K::Graveyard | K::Volcano | K::LavaStream | K::LavaPool => {
                p.len() == kind.params_min
            }
        };
        out.check("feature-params", format!("p{k}"), valid);
    }
    for z in out.strict_zones.clone() {
        let sizes = components(|i| m.region_grid[i] == z && m.tiles[i] == 1, true).0;
        out.check(
            "pieces",
            ZONES[z as usize - 1].as_str(),
            sizes.iter().all(|s| *s >= R.piece_min),
        );
    }
    for z in out.strict_zones.clone() {
        fence(m, z, out);
    }
}
pub(super) fn landmark_zone(s: &str) -> Option<Zone> {
    rules::LANDMARKS
        .iter()
        .find(|(name, _)| *name == s)
        .map(|(_, zone)| *zone)
}
fn fence(m: &GameMapData, z: u8, out: &mut Certificate) {
    let n = R.size * R.size;
    let is_fence =
        |i: usize| m.region_grid[i] == z && m.tiles[i] == 2 && m.terrain[i] == R.fence_kind;
    let floor = |i: usize| m.region_grid[i] == z && m.tiles[i] == 0;
    let mut seen = vec![0u32; n];
    let mut stamp = 0u32;
    let mut queue = Vec::with_capacity(n);
    let mut notes = 0;
    for i in 0..n {
        if !is_fence(i) {
            continue;
        }
        for (dx, dy, axis) in [(1, 0, "x"), (0, 1, "y")] {
            for k in 1..=R.fence_reach {
                let (Some(a), Some(b)) = (offset(i, -dx * k, -dy * k), offset(i, dx * k, dy * k))
                else {
                    break;
                };
                if !floor(a) || !floor(b) {
                    break;
                }
                stamp += 1;
                queue.clear();
                queue.push((a, 0usize));
                seen[a] = stamp;
                let mut h = 0;
                let mut reached = None;
                let limit = 2 * k as usize + R.fence_search;
                while h < queue.len() {
                    let (t, d) = queue[h];
                    h += 1;
                    if t == b {
                        reached = Some(d);
                        break;
                    }
                    if d == limit {
                        continue;
                    }
                    for (x, y) in [(0, -1), (1, 0), (0, 1), (-1, 0)] {
                        if let Some(j) = offset(t, x, y) {
                            if seen[j] != stamp && floor(j) {
                                seen[j] = stamp;
                                queue.push((j, d + 1));
                            }
                        }
                    }
                }
                if reached.is_none_or(|d| d > 2 * k as usize + R.fence_detour) && notes < 4 {
                    notes += 1;
                    let detail=format!("{} fence {},{}: the pair {k} steps either side along {axis} walks {} steps, over {}",ZONES[z as usize-1].as_str(),i%R.size,i/R.size,reached.map_or_else(||format!("more than {limit}"),|d|d.to_string()),2*k as usize+R.fence_detour);
                    out.failures.push(Failure {
                        rule: "fence-detour",
                        record_index: Some(i),
                        subject: format!("{z}:{i}:{axis}:{k}"),
                        message: format!(
                            "{}: {detail}",
                            super::labels::LABELS
                                .iter()
                                .find(|(id, _)| *id == "fence-detour")
                                .unwrap()
                                .1
                        ),
                    });
                }
            }
        }
        for (dx, dy, axis) in [(1, 0, "x"), (0, 1, "y")] {
            if offset(i, -dx, -dy).is_some_and(is_fence) {
                continue;
            }
            let mut len = 0;
            while offset(i, dx * len, dy * len).is_some_and(is_fence) {
                len += 1;
            }
            if len as usize > R.fence_run && notes < 4 {
                notes += 1;
                let detail = format!(
                    "{} fence run of {len} along {axis} from {},{}, over {}",
                    ZONES[z as usize - 1].as_str(),
                    i % R.size,
                    i / R.size,
                    R.fence_run
                );
                out.failures.push(Failure {
                    rule: "fence-run",
                    record_index: Some(i),
                    subject: format!("{z}:{i}:{axis}"),
                    message: format!(
                        "{}: {detail}",
                        super::labels::LABELS
                            .iter()
                            .find(|(id, _)| *id == "fence-run")
                            .unwrap()
                            .1
                    ),
                });
            }
        }
    }
}
