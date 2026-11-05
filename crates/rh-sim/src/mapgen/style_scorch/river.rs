use super::*;
#[derive(Clone, Copy)]
struct Band {
    depth: f64,
    a: f64,
    b: f64,
    score: f64,
}
#[derive(Clone, Copy)]
struct Candidate {
    score: f64,
    start: usize,
    end: usize,
    cap: Option<usize>,
}
#[derive(Clone)]
struct Fords {
    ranges: Vec<[usize; 2]>,
    runs: usize,
    routes: usize,
}
struct River<'a> {
    rules: &'a RiverRules,
    path: Vec<i32>,
    width: Vec<i32>,
    squares: Vec<Vec<i32>>,
    corridor: Vec<u8>,
    edge_at: Vec<(usize, f64)>,
}
impl River<'_> {
    fn normalize(&self, start: usize, end: usize, list: Vec<[i32; 2]>) -> Vec<[usize; 2]> {
        let mut sorted: Vec<_> = list
            .into_iter()
            .map(|[a, b]| [a.max(start as i32 + 1), b.min(end as i32 - 1)])
            .filter(|f| f[1] > f[0])
            .map(|[a, b]| [a as usize, b as usize])
            .collect();
        sorted.sort();
        let mut out: Vec<[usize; 2]> = vec![];
        for f in sorted {
            if let Some(last) = out.last_mut() {
                if (f[0] as i64 - last[1] as i64) < self.rules.ford_merge as i64
                    && last[1].max(f[1]) - last[0] <= self.rules.ford_max_len
                {
                    last[1] = last[1].max(f[1]);
                    continue;
                }
            }
            out.push(f);
        }
        out
    }
    fn fords(&self, start: usize, end: usize, cap: Option<usize>) -> Fords {
        let r = self.rules;
        let mut ranges: Vec<[usize; 2]> = vec![];
        let mut runs: Vec<[usize; 2]> = vec![];
        let mut last_hit = None;
        for s in start..end {
            if self.corridor[s] == 0 {
                continue;
            }
            if last_hit.is_some_and(|last| s - last <= r.corridor_run_gap) {
                runs.last_mut().expect("prior run")[1] = s + 1;
            } else {
                runs.push([s, s + 1]);
            }
            last_hit = Some(s);
        }
        let mut raw = vec![];
        for &[a, b] in runs.iter().take(cap.unwrap_or(usize::MAX)) {
            let need = r.ford_steps as i32 - (b - a) as i32;
            raw.push(if need > 0 {
                [a as i32 - (need >> 1), b as i32 + need - (need >> 1)]
            } else {
                [a as i32, b as i32]
            });
        }
        ranges = self.normalize(start, end, raw);
        let around = |k: usize| {
            [
                k as i32 - (r.ford_steps >> 1) as i32,
                k as i32 - (r.ford_steps >> 1) as i32 + r.ford_steps as i32,
            ]
        };
        let want_edge = r
            .edge_min
            .max(js_round((end - start) as f64 / r.ford_per_steps) as usize);
        let (mut routes, mut edge_ks) = (0, vec![]);
        for &(k, _) in &self.edge_at {
            if routes >= want_edge {
                break;
            }
            if k < start + r.edge_start_margin || k as i64 > end as i64 - r.edge_end_margin as i64 {
                continue;
            }
            if ranges.iter().any(|&[a, b]| {
                k as i64 >= a as i64 - r.edge_ford_margin as i64 && k < b + r.edge_ford_margin
            }) {
                routes += 1;
                continue;
            }
            if edge_ks
                .iter()
                .any(|&old: &usize| old.abs_diff(k) < r.ford_spacing)
            {
                continue;
            }
            edge_ks.push(k);
            let mut raw: Vec<_> = ranges.iter().map(|&[a, b]| [a as i32, b as i32]).collect();
            raw.push(around(k));
            ranges = self.normalize(start, end, raw);
            routes += 1;
        }
        for q in r.fallback_shares {
            if ranges.len() >= r.ford_min {
                break;
            }
            let k = start + ((end - start) as f64 * q).floor() as usize;
            if ranges.iter().any(|&[a, b]| {
                k as i64 >= a as i64 - r.fallback_gap as i64 && k < b + r.fallback_gap
            }) {
                continue;
            }
            let mut raw: Vec<_> = ranges.iter().map(|&[a, b]| [a as i32, b as i32]).collect();
            raw.push(around(k));
            ranges = self.normalize(start, end, raw);
        }
        Fords {
            ranges,
            runs: runs.len(),
            routes,
        }
    }
    fn blocks(
        &self,
        c: &ShapeContext<'_, '_>,
        start: usize,
        end: usize,
        fords: &[[usize; 2]],
    ) -> (Vec<i32>, Vec<i32>) {
        let mut mark = vec![0; c.base().w * c.base().h];
        let mut out = vec![false; self.path.len()];
        let mut keep = vec![];
        for &[a, b] in fords {
            for (s, slot) in out.iter_mut().enumerate().take(b).skip(a) {
                *slot = true;
                for &t in &self.squares[s] {
                    if mark[t as usize] == 0 {
                        mark[t as usize] = 2;
                        keep.push(t);
                    }
                }
            }
        }
        let mut tiles = vec![];
        for (s, &skip) in out.iter().enumerate().take(end).skip(start) {
            if skip {
                continue;
            }
            for &t in &self.squares[s] {
                if mark[t as usize] == 0 {
                    mark[t as usize] = 1;
                    if c.open(t) {
                        tiles.push(t);
                    }
                }
            }
        }
        (tiles, keep)
    }
}
impl Callbacks<'_> {
    pub(super) fn place_river(
        &self,
        c: &mut ShapeContext<'_, '_>,
        mine: &[CampInfo],
        r4s: &[i32],
        nodes: &[kit::Node],
        edges: &[kit::Edge],
        plan: &mut Plan,
    ) -> Result<(), Error> {
        let r = &self.definition.river;
        let (w, h) = (c.base().w, c.base().h);
        let n = w * h;
        let frame = forge::Frame::new(w, h, c.base().zone);
        let bb = c.base().zone.bbox;
        let mut usable = vec![];
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for y in bb.y..bb.y + bb.h as i32 {
            for x in bb.x..bb.x + bb.w as i32 {
                let i = y * w as i32 + x;
                if !c.open(i) {
                    continue;
                }
                usable.push(i);
                let d = frame.depth(x as f64 + 0.5, y as f64 + 0.5);
                lo = lo.min(d);
                hi = hi.max(d);
            }
        }
        if usable.len() < r.usable_min {
            return Ok(());
        }
        let target = (r.min_steps + r.target_extra)
            .max(js_round(r.steps_per_len * self.scale.len_scale(c.base().zone.painted)) as usize);
        let members = c.route_guard().members().to_vec();
        let corridor = c.route_guard().corridor().to_vec();
        let member_depth: Vec<_> = members
            .iter()
            .map(|&m| frame.depth((m % w as i32) as f64 + 0.5, (m / w as i32) as f64 + 0.5))
            .collect();
        let jitter = c.streams.rng.next_f64();
        let mut band: Option<Band> = None;
        for share in r.depths {
            let depth = lo + (hi - lo) * (share + r.depth_jitter * jitter);
            let (mut band_lo, mut band_hi) = (f64::INFINITY, f64::NEG_INFINITY);
            for &i in &usable {
                let (x, y) = ((i % w as i32) as f64, (i / w as i32) as f64);
                if (frame.depth(x + 0.5, y + 0.5) - depth).abs() > r.slack {
                    continue;
                }
                let l = frame.lateral(x + 0.5, y + 0.5);
                band_lo = band_lo.min(l);
                band_hi = band_hi.max(l);
            }
            if band_lo > band_hi {
                continue;
            }
            let bins = ((band_hi - band_lo) / r.bin_width).floor() as usize + 1;
            let mut cover = vec![false; bins];
            for &i in &usable {
                let (x, y) = ((i % w as i32) as f64, (i / w as i32) as f64);
                if (frame.depth(x + 0.5, y + 0.5) - depth).abs() > r.slack {
                    continue;
                }
                cover[((frame.lateral(x + 0.5, y + 0.5) - band_lo) / r.bin_width).floor()
                    as usize] = true;
            }
            let mut route_lats = vec![];
            for &[a, b] in edges {
                let (a, b) = (&nodes[a], &nodes[b]);
                let (da, db) = (
                    frame.depth(a.x + 0.5, a.y + 0.5) - depth,
                    frame.depth(b.x + 0.5, b.y + 0.5) - depth,
                );
                if da == db || (da < 0.0) == (db < 0.0) {
                    continue;
                }
                let t = da / (da - db);
                let (la, lb) = (
                    frame.lateral(a.x + 0.5, a.y + 0.5),
                    frame.lateral(b.x + 0.5, b.y + 0.5),
                );
                route_lats.push(la + t * (lb - la));
            }
            let (mut run_lo, mut run_hi, mut run_score) = (0, bins - 1, f64::NEG_INFINITY);
            let mut b0 = 0;
            while b0 < bins {
                if !cover[b0] {
                    b0 += 1;
                    continue;
                }
                let mut b1 = b0;
                while b1 + 1 < bins
                    && (1..=r.bridge_bins).any(|delta| b1 + delta < bins && cover[b1 + delta])
                {
                    b1 += 1;
                }
                let (low, high) = (
                    band_lo + r.bin_width * b0 as f64,
                    band_lo + r.bin_width * b1 as f64 + r.bin_width,
                );
                let routes = route_lats
                    .iter()
                    .filter(|&&l| l >= low && l <= high)
                    .count();
                let score = (high - low).min(r.run_target_multiple * target as f64)
                    + r.run_route_weight * routes as f64;
                if score > run_score {
                    run_score = score;
                    run_lo = b0;
                    run_hi = b1;
                }
                b0 = b1 + 1;
            }
            let (mut a, mut b) = (
                band_lo + r.bin_width * run_lo as f64 + r.bin_width,
                band_lo + r.bin_width * run_hi as f64,
            );
            let reach = r.reach * target as f64;
            if b - a > reach {
                let mut in_run: Vec<_> = route_lats
                    .iter()
                    .copied()
                    .filter(|&l| l >= a && l <= b)
                    .collect();
                in_run.sort_by(f64::total_cmp);
                let mid = if in_run.is_empty() {
                    (a + b) / 2.0
                } else {
                    in_run[in_run.len() >> 1]
                };
                let low = (mid - reach / 2.0).max(a).min(b - reach);
                a = low;
                b = low + reach;
            }
            let crossed = member_depth
                .iter()
                .filter(|&&d| d > depth + r.member_depth_offset)
                .count();
            let score = (b - a).min(target as f64) - r.crossed_penalty * crossed as f64
                + r.route_bonus * route_lats.len().min(r.route_bonus_cap) as f64;
            if band.is_none_or(|prior| score > prior.score) {
                band = Some(Band { depth, a, b, score });
            }
        }
        let Some(band) = band else {
            return Ok(());
        };
        let nearest = |d: f64, l: f64| {
            let (px, py) = (
                frame.cx + d * frame.ux + l * frame.vx,
                frame.cy + d * frame.uy + l * frame.vy,
            );
            let (mut best, mut distance) = (-1, f64::INFINITY);
            for &i in &usable {
                let (x, y) = ((i % w as i32) as f64, (i / w as i32) as f64);
                let e = (x + 0.5 - px) * (x + 0.5 - px) + (y + 0.5 - py) * (y + 0.5 - py);
                if e < distance {
                    distance = e;
                    best = i;
                }
            }
            best
        };
        let a = nearest(band.depth, band.a);
        let b = nearest(
            band.depth + (c.streams.rng.next_f64() - 0.5) * r.endpoint_jitter,
            band.b,
        );
        if a < 0 || b < 0 || a == b {
            return Ok(());
        }
        let mut near_crater = vec![false; n];
        for (q, camp) in mine.iter().enumerate() {
            let radius = r4s[q] as f64 / 4.0 + r.crater_margin;
            let reach = radius.ceil() as i32;
            for dy in -reach..=reach {
                for dx in -reach..=reach {
                    let i = c.base().at(camp.x + dx, camp.y + dy);
                    if i >= 0 && f64::from(dx * dx + dy * dy) < radius * radius {
                        near_crater[i as usize] = true;
                    }
                }
            }
        }
        let bctx = c.base();
        let noise = c.streams.noise;
        let source = kit::PathSource {
            w,
            h,
            mask: bctx.mask,
            hard: bctx.hard,
            tiles: bctx.tiles,
            noise: &noise,
        };
        let mut cost = |j: usize| {
            let (x, y) = ((j % w) as f64, (j / w) as f64);
            let dd = frame.depth(x + 0.5, y + 0.5) - band.depth;
            (if near_crater[j] { r.crater_cost } else { 0 })
                + (dd.abs() * r.depth_cost).floor() as i32
                + if c.open(j as i32) { 0 } else { r.closed_cost }
                + if corridor[j] == 1 { r.corridor_cost } else { 0 }
        };
        let path: Vec<_> = kit::noisy_path(
            &source,
            a as usize,
            b as usize,
            r.path_salt,
            kit::PathCost::Callback(&mut cost),
            &self.kit,
        )
        .into_iter()
        .map(|i| i as i32)
        .collect();
        let len = path.len();
        if len < r.min_steps {
            return Ok(());
        }
        let mut river = River {
            rules: r,
            path,
            width: vec![],
            squares: vec![],
            corridor: vec![0; len],
            edge_at: vec![],
        };
        for s in 0..len {
            let width = if kit::noise_q(
                &c.streams.noise,
                s as f64 / r.width_period,
                r.width_y,
                r.width_cell,
                r.width_salt,
            ) > r.width_threshold
            {
                r.width_wide
            } else {
                r.width_narrow
            };
            river.width.push(width);
            let (x, y) = (river.path[s] % w as i32, river.path[s] / w as i32);
            let mut list = vec![];
            for oy in 0..width {
                for ox in 0..width {
                    let t = c.base().at(x + ox - (width >> 1), y + oy - (width >> 1));
                    if t >= 0 {
                        list.push(t);
                        if corridor[t as usize] == 1 {
                            river.corridor[s] = 1;
                        }
                    }
                }
            }
            river.squares.push(list);
        }
        for &[a, b] in edges {
            let (a, b) = (&nodes[a], &nodes[b]);
            let (ax, ay, bx, by) = (
                a.x + r.route_start * (b.x - a.x),
                a.y + r.route_start * (b.y - a.y),
                a.x + r.route_end * (b.x - a.x),
                a.y + r.route_end * (b.y - a.y),
            );
            let (mut best_s, mut best_d) = (None, f64::INFINITY);
            for (s, &i) in river.path.iter().enumerate() {
                let d =
                    kit::seg_dist2((i % w as i32) as f64, (i / w as i32) as f64, ax, ay, bx, by);
                if d < best_d {
                    best_d = d;
                    best_s = Some(s);
                }
            }
            if let Some(s) = best_s {
                if best_d <= r.route_distance2 {
                    river.edge_at.push((s, best_d));
                }
            }
        }
        river
            .edge_at
            .sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        let mut lengths = vec![];
        for offset in r.length_offsets {
            let l = target as i64 + i64::from(offset);
            if l >= r.length_min as i64 && l <= len as i64 && !lengths.contains(&(l as usize)) {
                lengths.push(l as usize);
            }
        }
        if lengths.is_empty() {
            lengths.push(len);
        }
        let mut candidates = vec![];
        for length in lengths {
            for start in (0..=len - length).step_by(r.window_step) {
                for cap in r.corridor_caps {
                    let cap = (cap >= 0).then_some(cap as usize);
                    let f = river.fords(start, start + length, cap);
                    let lava = river.blocks(c, start, start + length, &f.ranges).0.len();
                    let penalty = if lava < r.lava_want_lo {
                        (r.lava_want_lo - lava) as f64 * r.lava_low_penalty
                    } else if lava > r.lava_want_hi {
                        (lava - r.lava_want_hi) as f64 * r.lava_high_penalty
                    } else {
                        0.0
                    };
                    let covered = cap.unwrap_or(f.runs).min(f.runs);
                    let uncovered = f.runs - covered;
                    let score = -penalty
                        - r.covered_penalty * covered as f64
                        - r.uncovered_penalty * uncovered as f64
                        + r.route_bonus * f.routes.min(r.route_bonus_cap) as f64
                        - r.ford_count_penalty
                            * f.ranges.len().saturating_sub(r.ford_count_free) as f64;
                    candidates.push(Candidate {
                        score,
                        start,
                        end: start + length,
                        cap,
                    });
                    if cap.is_none_or(|cap| f.runs <= cap) {
                        break;
                    }
                }
            }
        }
        if candidates.is_empty() {
            candidates.push(Candidate {
                score: 0.0,
                start: 0,
                end: len,
                cap: None,
            });
        }
        candidates.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then(a.start.cmp(&b.start))
                .then(a.end.cmp(&b.end))
                .then(
                    b.cap
                        .unwrap_or(usize::MAX)
                        .cmp(&a.cap.unwrap_or(usize::MAX)),
                )
        });
        let mut tried: Vec<Candidate> = vec![];
        for candidate in candidates {
            if tried.len() >= r.placement_tries {
                break;
            }
            if tried.iter().any(|t| {
                t.start.abs_diff(candidate.start) < r.window_distinct
                    && t.end.abs_diff(candidate.end) < r.window_distinct
            }) {
                continue;
            }
            tried.push(candidate);
            let mut caps = vec![];
            for cap in [
                candidate.cap,
                Some(candidate.cap.unwrap_or(r.fallback_cap).min(r.fallback_cap)),
                Some(0),
            ] {
                if !caps.contains(&cap) {
                    caps.push(cap);
                }
            }
            for cap in caps {
                let f = river.fords(candidate.start, candidate.end, cap);
                let (tiles, keep) = river.blocks(c, candidate.start, candidate.end, &f.ranges);
                if tiles.len() < r.blocks_min {
                    continue;
                }
                let (mut width_sum, mut width_n) = (0, 0);
                for s in candidate.start..candidate.end {
                    if !f.ranges.iter().any(|&[a, b]| s >= a && s < b) {
                        width_sum += river.width[s];
                        width_n += 1;
                    }
                }
                let width2 = if width_n > 0 {
                    js_round((2 * width_sum) as f64 / width_n as f64) as i32
                } else {
                    r.default_width2
                };
                let fords: Vec<_> = f
                    .ranges
                    .iter()
                    .map(|&[a, b]| river.path[(a + b) >> 1])
                    .collect();
                let mut ford = vec![false; n];
                for &i in &keep {
                    ford[i as usize] = true;
                }
                let mut bank = vec![false; n];
                for &t in &tiles {
                    let (x, y) = (t % w as i32, t / w as i32);
                    for [dx, dy] in kit::DIR8 {
                        let j = c.base().at(x + dx, y + dy);
                        if j >= 0
                            && c.base().tiles[j as usize] == TILE_FLOOR
                            && !ford[j as usize]
                            && (members.is_empty() || corridor[j as usize] != 1)
                        {
                            bank[j as usize] = true;
                        }
                    }
                }
                let mut floor = keep;
                floor.extend(
                    bank.iter()
                        .enumerate()
                        .filter_map(|(i, &yes)| yes.then_some(i as i32)),
                );
                let mut params = vec![width2, fords.len() as i32];
                params.extend(&fords);
                let anchor = river.path[candidate.start];
                let spec = feature(
                    FeatureKind::LavaRiver,
                    FeatureJob::Crossing,
                    [anchor % w as i32, anchor / w as i32],
                    params,
                    tiles.into_iter().map(|i| (i, BlockKind::Lava)).collect(),
                    floor,
                );
                let Some(placed) = c.place_feature(&spec)? else {
                    continue;
                };
                plan.river_path = river.path[candidate.start..candidate.end].to_vec();
                plan.fords = fords;
                plan.lava = placed.written;
                if !members.is_empty() {
                    let mut seen = vec![false; n];
                    for &t in &plan.lava {
                        let (x, y) = (t % w as i32, t / w as i32);
                        for [dx, dy] in kit::DIR8 {
                            let j = c.base().at(x + dx, y + dy);
                            if j >= 0
                                && corridor[j as usize] == 1
                                && !ford[j as usize]
                                && !seen[j as usize]
                            {
                                seen[j as usize] = true;
                                plan.no_ember.push(j);
                            }
                        }
                    }
                }
                return Ok(());
            }
        }
        Ok(())
    }
}
