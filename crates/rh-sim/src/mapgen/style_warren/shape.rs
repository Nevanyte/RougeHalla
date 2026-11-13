use super::planning::{in_slot, site_of, Ground, Site};
use super::*;
use crate::mapgen::landmarks::recipe_support::js_round;
use crate::mapgen::style_features::{dir_index16, seg_dist2};
fn tunnel_order(sites: &[Site], r4_tunnel: i32) -> Vec<usize> {
    let mut out: Vec<_> = (0..sites.len())
        .filter(|&i| sites[i].r4 >= r4_tunnel)
        .collect();
    out.sort_by(|&p, &q| {
        sites[q]
            .r4
            .cmp(&sites[p].r4)
            .then_with(|| sites[p].off2.total_cmp(&sites[q].off2))
            .then_with(|| sites[q].road.d2.total_cmp(&sites[p].road.d2))
            .then_with(|| p.cmp(&q))
    });
    out
}
impl Callbacks<'_> {
    fn place_barrow(
        &self,
        c: &mut ShapeContext<'_, '_>,
        site: &Site,
        tunnel: bool,
    ) -> Result<Option<(crate::mapgen::style_runtime::PlacedFeature, Vec<i32>)>, Error> {
        let w = c.base().w;
        let mut slot = Vec::new();
        let mut blocks = Vec::new();
        for &i in &site.rock {
            if tunnel && in_slot(site, i, w, &self.definition) {
                // Signature mode: a pool's ring is reserved and stays unowned floor; the tunnel does not claim it.
                if !c.is_reserved(i) {
                    slot.push(i)
                }
            } else {
                blocks.push((i, BlockKind::Wall))
            }
        }
        let mut floor = slot.clone();
        floor.extend_from_slice(&site.crescent);
        let spec = FeatureSpec {
            kind: FeatureKind::Barrow,
            variant: None,
            jobs: if tunnel {
                vec![FeatureJob::Fork, FeatureJob::Choke]
            } else {
                vec![FeatureJob::Fork]
            },
            anchor: [site.cx, site.cy],
            params: Some(vec![
                site.r4,
                i32::from(tunnel),
                dir_index16(site.road.dx, site.road.dy) as i32,
                site.wet,
            ]),
            blocks,
            groups: None,
            floor: Some(floor),
            mode: Mode::Trim,
            min_piece: None,
            min_share_permille: None,
            min_groups: None,
        };
        Ok(c.place_feature(&spec)?.map(|p| (p, slot)))
    }
    fn prune_route(&self, c: &mut ShapeContext<'_, '_>, sites: &mut Vec<Site>, tunnels_max: usize) {
        let (w, h) = (c.base().w, c.base().h);
        for _ in 0..self.definition.route_tries {
            let bored = tunnel_order(sites, self.definition.r4_tunnel);
            let bored = &bored[..tunnels_max.min(bored.len())];
            let mut rock = Vec::new();
            for (k, site) in sites.iter().enumerate() {
                for &i in &site.rock {
                    if !(bored.contains(&k) && in_slot(site, i, w, &self.definition)) {
                        rock.push(i)
                    }
                }
            }
            if c.worst_stretch(&rock) <= i64::from(c.caps().route_stretch_max) {
                return;
            }
            let mut near = vec![false; w * h];
            let guard = c.route_guard();
            for &t in guard.corridor_of(guard.worst_member()) {
                let (x, y) = (t % w as i32, t / w as i32);
                for oy in -1..=1 {
                    for ox in -1..=1 {
                        if x + ox >= 0 && y + oy >= 0 && x + ox < w as i32 && y + oy < h as i32 {
                            near[(y + oy) as usize * w + (x + ox) as usize] = true
                        }
                    }
                }
            }
            let (mut worst, mut score) = (None, 0);
            for (k, site) in sites.iter().enumerate() {
                let s = site.rock.iter().filter(|&&i| near[i as usize]).count();
                if s > score {
                    score = s;
                    worst = Some(k)
                }
            }
            let Some(worst) = worst else { return };
            sites.remove(worst);
        }
    }
    /// Today's siting: one barrow per road, in road order, up to `most`; `crescents` off in signature mode.
    // Preserve the source helper argument roles for parity auditing.
    #[allow(clippy::too_many_arguments)]
    fn site_all(
        &self,
        c: &ShapeContext<'_, '_>,
        corridor: Vec<u8>,
        has_members: bool,
        roads: &[warren::Road],
        nodes: &[crate::mapgen::landmarks::recipe_support::Node],
        most: usize,
        crescents: bool,
    ) -> Vec<Site> {
        let mut ground = Ground::new(c, corridor, has_members, &self.definition);
        let mut sites = Vec::new();
        for road in roads {
            if sites.len() >= most {
                break;
            }
            if let Some(site) = site_of(
                &mut ground,
                c,
                road,
                nodes,
                sites.len(),
                crescents,
                &self.definition,
            ) {
                ground.take(&site);
                sites.push(site)
            }
        }
        sites
    }
    pub fn shape(&self, c: &mut ShapeContext<'_, '_>) -> Result<Plan, Error> {
        let mut plan = Plan::default();
        let guard = c.route_guard();
        let corridor = guard.corridor().to_vec();
        let has_members = !guard.members().is_empty();
        // Signature mode (P-LAND-PLAGUE-1): `pools::tree` is `Some` only when the Landmarks phase placed the bog tree in
        // this zone. The bog is then laid first, as free pools by band round the tree, keeping off where today's rule
        // would site the barrows where it can; the barrows are then sited by today's rule, without a crescent, on what
        // the pools leave. Option off this is `None`: no pool, no draw, today's barrows and crescents (G8).
        let tree = super::pools::tree(c.base());
        let pools = tree.is_some();
        let pool_corridor = if pools { corridor.clone() } else { Vec::new() };
        let lay = |c: &mut ShapeContext<'_, '_>, plan: &mut Plan, sites: &[Vec<i32>]| match &tree {
            Some(tree) => {
                plan.pools =
                    super::pools::lay(c, tree, &pool_corridor, sites, &super::pools::POOLS)?;
                Ok(())
            }
            None => Ok(()),
        };
        let b = c.base();
        let nodes = camp_nodes_from(
            CampNodeInputs {
                w: b.w,
                h: b.h,
                mask: b.mask,
                tiles: b.tiles,
                info: b.zone,
                camps: b.camps,
            },
            Some(&self.fixed.dist_fp),
            self.fixed_rules.ring_road,
            &self.scale,
        );
        if nodes.len() < 2 {
            lay(c, &mut plan, &[])?;
            return Ok(plan);
        }
        let scale = self.scale.area_scale(b.zone.painted);
        let barrows_max = js_round(self.definition.barrows_per_ref * scale) as usize;
        let tunnels_max = js_round(self.definition.tunnels_per_ref * scale) as usize;
        let burrows: Vec<_> = b
            .zone_features()
            .filter(|f| f.kind == FeatureKind::Landmark && f.variant == self.burrow.template.key)
            .map(|f| {
                (
                    f.bbox.x as f64 + (f.bbox.w as f64 - 1.0) / 2.0,
                    f.bbox.y as f64 + (f.bbox.h as f64 - 1.0) / 2.0,
                )
            })
            .collect();
        let all: Vec<_> = warren::roads(&nodes, self.definition.road_min2)
            .into_iter()
            .filter(|r| {
                !burrows.iter().any(|&(bx, by)| {
                    seg_dist2(
                        bx,
                        by,
                        nodes[r.a].x,
                        nodes[r.a].y,
                        nodes[r.b].x,
                        nodes[r.b].y,
                    ) < self.definition.burrow_road_near2
                })
            })
            .collect();
        plan.roads = all.len();
        if barrows_max == 0 || all.is_empty() {
            lay(c, &mut plan, &[])?;
            return Ok(plan);
        }
        let w = b.w;
        if pools {
            let ahead = self.site_all(
                c,
                corridor.clone(),
                has_members,
                &all,
                &nodes,
                barrows_max,
                false,
            );
            let rock: Vec<Vec<i32>> = ahead.into_iter().map(|s| s.rock).collect();
            lay(c, &mut plan, &rock)?;
        }
        let mut sites = self.site_all(c, corridor, has_members, &all, &nodes, barrows_max, !pools);
        if has_members {
            self.prune_route(c, &mut sites, tunnels_max)
        }
        let big_first = tunnel_order(&sites, self.definition.r4_tunnel);
        let mut tunnels_left = tunnels_max;
        let mut done = vec![false; sites.len()];
        let mut road_of = Vec::new();
        let mut put = |idx: usize, tunnel: bool| -> Result<bool, Error> {
            let site = &sites[idx];
            let mut result = self.place_barrow(c, site, tunnel)?;
            let mut bored = tunnel;
            if result.is_none() && tunnel {
                result = self.place_barrow(c, site, false)?;
                bored = false
            }
            let Some((placed, slot)) = result else {
                return Ok(false);
            };
            plan.barrows.push(Barrow {
                id: placed.id,
                cx: site.cx,
                cy: site.cy,
                r4: site.r4,
                tunnel: bored,
                dir16: dir_index16(site.road.dx, site.road.dy),
                wet: site.wet,
                walls: placed.written,
                slot,
                crescent: site.crescent.clone(),
            });
            road_of.push(site.road.clone());
            Ok(bored)
        };
        for idx in big_first {
            if tunnels_left == 0 {
                break;
            }
            done[idx] = true;
            if put(idx, true)? {
                tunnels_left -= 1
            }
        }
        for (idx, &done) in done.iter().enumerate() {
            if !done {
                put(idx, false)?;
            }
        }
        let b = c.base();
        for (bar, road) in plan.barrows.iter().zip(&road_of) {
            plan.crescent.extend_from_slice(&bar.crescent);
            if !bar.tunnel || bar.slot.is_empty() {
                continue;
            }
            let along = |i: i32| {
                (i % w as i32 - bar.cx) as f64 * road.dx + (i / w as i32 - bar.cy) as f64 * road.dy
            };
            let mut slot = bar.slot.clone();
            slot.sort_by(|&p, &q| along(p).total_cmp(&along(q)).then_with(|| p.cmp(&q)));
            plan.tunnels.push(slot.clone());
            for &s in &slot {
                if ![s - 1, s + 1, s - w as i32, s + w as i32]
                    .into_iter()
                    .any(|j| {
                        j >= 0
                            && (j as usize) < b.tiles.len()
                            && b.tiles[j as usize] == TILE_FLOOR
                            && !slot.contains(&j)
                    })
                {
                    continue;
                }
                let (x, y) = (s % w as i32, s / w as i32);
                for oy in -1..=1 {
                    for ox in -1..=1 {
                        let j = b.at(x + ox, y + oy);
                        if j >= 0
                            && bar.walls.contains(&j)
                            && b.tiles[j as usize] == TILE_WALL
                            && !plan.mouths.contains(&j)
                        {
                            plan.mouths.push(j)
                        }
                    }
                }
            }
        }
        plan.placed = plan.barrows.len();
        Ok(plan)
    }
}
