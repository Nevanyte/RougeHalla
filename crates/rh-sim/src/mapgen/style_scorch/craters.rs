use super::raster::{self, Beam};
use super::*;
fn breaches(i: usize, nodes: &[kit::Node], edges: &[kit::Edge], d: &CraterRules) -> Vec<Beam> {
    let me = &nodes[i];
    let mut others: Vec<_> = edges
        .iter()
        .filter_map(|&[a, b]| {
            if a == i {
                Some(b)
            } else if b == i {
                Some(a)
            } else {
                None
            }
        })
        .map(|j| (j, kit::dist2(me.x, me.y, nodes[j].x, nodes[j].y)))
        .collect();
    others.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
    let take = |v: Beam, out: &mut Vec<Beam>| {
        let k = kit::dir_index16(v[0], v[1]);
        if out.iter().any(|p| {
            kit::dir_sep16(k as i32, kit::dir_index16(p[0], p[1]) as i32) < d.breach_separation
        }) {
            return;
        }
        out.push(v);
    };
    let mut out = vec![];
    for (j, _) in others {
        if out.len() >= d.breaches_max {
            break;
        }
        take([nodes[j].x - me.x, nodes[j].y - me.y], &mut out);
    }
    if out.len() < d.breaches_min {
        let mut rest: Vec<_> = (0..nodes.len())
            .filter(|&j| j != i)
            .map(|j| (j, kit::dist2(me.x, me.y, nodes[j].x, nodes[j].y)))
            .collect();
        rest.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        for (j, _) in rest {
            if out.len() >= d.breaches_min {
                break;
            }
            take([nodes[j].x - me.x, nodes[j].y - me.y], &mut out);
        }
        if out.is_empty() {
            take([1.0, 0.0], &mut out);
        }
        if out.len() < d.breaches_min {
            take([-out[0][0], -out[0][1]], &mut out);
        }
    }
    out
}
fn crossing_beam(rim: &[i32], band: &[i32], camp: &CampInfo, w: usize, near: i32) -> Option<Beam> {
    let first = band.iter().find(|i| rim.contains(i)).copied()?;
    let (hx, hy) = (first % w as i32, first / w as i32);
    let (mut sx, mut sy, mut count) = (0, 0, 0);
    for &t in band {
        if !rim.contains(&t) {
            continue;
        }
        let (x, y) = (t % w as i32, t / w as i32);
        if (x - hx).abs() <= near && (y - hy).abs() <= near {
            sx += x - camp.x;
            sy += y - camp.y;
            count += 1;
        }
    }
    if count == 0 {
        return None;
    }
    let b = [
        js_round(sx as f64 / count as f64),
        js_round(sy as f64 / count as f64),
    ];
    (b[0] != 0.0 || b[1] != 0.0).then_some(b)
}
impl Callbacks<'_> {
    /// One crater per camp, centred on it (a pen). With a Fire anchor (signature mode, P-MAPGEN-SIG-FIRE-1) a crater
    /// that would reach the anchor's core band is shrunk a quarter tile at a time, or dropped when even the smallest
    /// does; without one every crater is drawn and placed as before (G8).
    #[allow(clippy::too_many_arguments)]
    pub(super) fn place_craters(
        &self,
        c: &mut ShapeContext<'_, '_>,
        mine: &[CampInfo],
        r4s: &mut [i32],
        nodes: &[kit::Node],
        edges: &[kit::Edge],
        anchor: Option<&ZoneAnchor>,
        plan: &mut Plan,
    ) -> Result<(), Error> {
        let d = &self.definition.crater;
        let has_members = !c.route_guard().members().is_empty();
        let bands: Vec<_> = (0..c.route_guard().members().len())
            .map(|k| c.route_guard().corridor_of(k as i32).to_vec())
            .collect();
        let mut stretch = if has_members {
            c.worst_stretch(&[])
        } else {
            1000
        };
        let lava_apron = if anchor.is_some() {
            self.lava_apron(c.base())
        } else {
            Vec::new()
        };
        for (k, camp) in mine.iter().enumerate() {
            let mut r4 = r4s[k];
            let mut candidates = vec![r4];
            for shrink in d.radius_shrink4 {
                if f64::from(r4 - shrink) >= self.forge.radius_min4 {
                    candidates.push(r4 - shrink);
                }
            }
            if candidates.len() > 1 {
                let base = raster::blocked(self, c, camp, candidates[0]);
                let mut best_share = base;
                for &candidate in &candidates[1..] {
                    let share = raster::blocked(self, c, camp, candidate);
                    if share + d.freer_permille <= base && share < best_share {
                        best_share = share;
                        r4 = candidate;
                    }
                }
            }
            r4s[k] = r4;
            let Some(anchor) = anchor else {
                if let Some((spec, dirs)) = self.crater(
                    c,
                    camp,
                    k,
                    r4,
                    nodes,
                    edges,
                    &bands,
                    has_members,
                    &mut stretch,
                ) {
                    self.commit(c, camp, r4, dirs, &spec, plan)?;
                }
                continue;
            };
            let w = c.base().w as i32;
            let mut size = r4;
            while f64::from(size) >= self.forge.radius_min4 {
                let mut trial = stretch;
                let Some((mut spec, dirs)) = self.crater(
                    c,
                    camp,
                    k,
                    size,
                    nodes,
                    edges,
                    &bands,
                    has_members,
                    &mut trial,
                ) else {
                    break;
                };
                // The bowl claims no floor in a stream's or pool's apron (its rim already keeps out: `no_block`).
                if let Some(floor) = spec.floor.as_mut() {
                    floor.retain(|&i| !lava_apron[i as usize]);
                }
                let core = spec
                    .blocks
                    .iter()
                    .map(|b| b.0)
                    .chain(spec.floor.iter().flatten().copied())
                    .any(|i| signature::band(anchor, i % w, i / w) == Band::Core);
                if !core {
                    stretch = trial;
                    r4s[k] = size;
                    self.commit(c, camp, size, dirs, &spec, plan)?;
                    break;
                }
                size -= 1;
            }
        }
        Ok(())
    }
    /// Signature mode: the aprons of the zone's lava streams and pools (their owned lava and ember tiles grown by the
    /// core band), where no styler feature may own a tile.
    fn lava_apron(&self, b: BaseContext<'_>) -> Vec<bool> {
        let mut out = vec![false; b.w * b.h];
        let g = signature::DEFAULT_DEFINITION.bands[0];
        for f in b
            .zone_features()
            .filter(|f| matches!(f.kind, FeatureKind::LavaStream | FeatureKind::LavaPool))
        {
            for y in f.bbox.y..f.bbox.y + f.bbox.h as i32 {
                for x in f.bbox.x..f.bbox.x + f.bbox.w as i32 {
                    let i = b.at(x, y);
                    if i < 0
                        || !b.is_owned(i)
                        || (b.tiles[i as usize] != TILE_LOW && b.terrain[i as usize] != self.ember)
                    {
                        continue;
                    }
                    for ny in y - g..=y + g {
                        for nx in x - g..=x + g {
                            let j = b.at(nx, ny);
                            if j >= 0 {
                                out[j as usize] = true;
                            }
                        }
                    }
                }
            }
        }
        out
    }
    fn commit(
        &self,
        c: &mut ShapeContext<'_, '_>,
        camp: &CampInfo,
        r4: i32,
        dirs: Vec<usize>,
        spec: &FeatureSpec,
        plan: &mut Plan,
    ) -> Result<(), Error> {
        if let Some(placed) = c.place_feature(spec)? {
            plan.craters.push(Crater {
                camp: camp.index,
                x: camp.x,
                y: camp.y,
                r4,
                dirs,
                rim: placed.written,
            });
        }
        Ok(())
    }
    /// The crater of radius `r4` (quarter tiles) round `camp`, breached for its routes, or `None` when its rim is too
    /// short or it stretches a route too far. `stretch` is the worst route stretch accepted so far.
    #[allow(clippy::too_many_arguments)]
    fn crater(
        &self,
        c: &mut ShapeContext<'_, '_>,
        camp: &CampInfo,
        k: usize,
        r4: i32,
        nodes: &[kit::Node],
        edges: &[kit::Edge],
        bands: &[Vec<i32>],
        has_members: bool,
        stretch: &mut i64,
    ) -> Option<(FeatureSpec, Vec<usize>)> {
        let d = &self.definition.crater;
        let w = c.base().w;
        let mut beams = breaches(k, nodes, edges, d);
        let (count, sx, sy) = raster::frontier(self, c, camp, r4);
        let mut frontier_dir = None;
        if count >= d.frontier_min && (sx != 0 || sy != 0) {
            let dir = kit::dir_index16(sx as f64, sy as f64);
            frontier_dir = Some(dir);
            beams = beams
                .into_iter()
                .filter(|b| {
                    kit::dir_sep16(kit::dir_index16(b[0], b[1]) as i32, dir as i32)
                        >= d.breach_separation
                })
                .take(d.frontier_breaches)
                .collect();
            if beams.is_empty() {
                beams = breaches(k, nodes, edges, d)
                    .into_iter()
                    .take(d.frontier_breaches)
                    .collect();
            }
        }
        let min = c.caps().min_piece as usize;
        let mut rim = raster::keep_arcs(raster::rim(self, c, camp, k, r4, &beams), w, min);
        let floor_tiles = d
            .rim_floor_min
            .max((rim.len() as f64 * d.rim_keep_permille as f64 / 1000.0).floor() as usize);
        if has_members {
            for _ in 0..d.guard_iterations {
                if rim.is_empty() {
                    break;
                }
                let cut = bands.iter().find(|band| {
                    band.iter().any(|t| rim.contains(t))
                        && raster::band_connected(c, band, &[], d)
                        && !raster::band_connected(c, band, &rim, d)
                });
                let Some(beam) =
                    cut.and_then(|band| crossing_beam(&rim, band, camp, w, d.breach_near))
                else {
                    break;
                };
                let mut next = beams.clone();
                next.push(beam);
                let more = raster::keep_arcs(raster::rim(self, c, camp, k, r4, &next), w, min);
                if more.len() < floor_tiles {
                    break;
                }
                beams.push(beam);
                rim = more;
            }
        }
        let mut over = false;
        if has_members && rim.len() >= d.rim_min {
            let mut tries = 0;
            loop {
                if !c.route_guard().touches(&rim) {
                    break;
                }
                let s = c.worst_stretch(&rim);
                if s <= i64::from(c.caps().route_stretch_max).max(*stretch) {
                    *stretch = (*stretch).max(s);
                    break;
                }
                let worst = c.route_guard().worst_member();
                let band = c.route_guard().corridor_of(worst).to_vec();
                let mut more = None;
                if tries < d.stretch_breach_tries {
                    if let Some(beam) = crossing_beam(&rim, &band, camp, w, d.breach_near) {
                        let mut next = beams.clone();
                        next.push(beam);
                        let wider =
                            raster::keep_arcs(raster::rim(self, c, camp, k, r4, &next), w, min);
                        if wider.len() >= floor_tiles {
                            more = Some((beam, wider));
                        }
                    }
                }
                let Some((beam, wider)) = more else {
                    if s > i64::from(d.stretch_max) {
                        over = true;
                    } else {
                        *stretch = (*stretch).max(s);
                    }
                    break;
                };
                beams.push(beam);
                rim = wider;
                tries += 1;
            }
        }
        if over || rim.len() < d.rim_min {
            return None;
        }
        let mut dirs: Vec<_> = beams.iter().map(|b| kit::dir_index16(b[0], b[1])).collect();
        if let Some(dir) = frontier_dir {
            if dirs
                .iter()
                .all(|&other| kit::dir_sep16(other as i32, dir as i32) >= d.breach_separation)
            {
                dirs.push(dir);
            }
        }
        let mut params = vec![camp.index as i32, r4, dirs.len() as i32];
        params.extend(dirs.iter().map(|&dir| dir as i32));
        let mut spec = feature(
            FeatureKind::Crater,
            FeatureJob::Pen,
            [camp.x, camp.y],
            params,
            rim.into_iter().map(|i| (i, BlockKind::Wall)).collect(),
            raster::bowl(self, c, camp, r4),
        );
        spec.min_share_permille = Some(d.rim_keep_permille as u32);
        Some((spec, dirs))
    }
}
