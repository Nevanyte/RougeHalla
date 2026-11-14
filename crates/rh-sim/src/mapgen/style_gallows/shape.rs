use super::lanes;
use super::rows::Grid;
use super::*;
use crate::mapgen::landmarks::recipe_support::js_round;
use crate::mapgen::style_features::{isqrt, viterbi_rows};
struct Candidate {
    score: f64,
    k: usize,
    s: i32,
}
/// Today's row orientation: along x when the zone's centroid lies at least as far from the map centre in x as in y.
pub(super) fn legacy_horizontal(b: &crate::mapgen::style_runtime::BaseContext<'_>) -> bool {
    let (vx, vy) = (
        b.zone.centroid.x - b.w as f64 / 2.0,
        b.zone.centroid.y - b.h as f64 / 2.0,
    );
    vx.abs() >= vy.abs()
}
impl Callbacks<'_> {
    fn square(
        &self,
        c: &mut ShapeContext<'_, '_>,
        grid: &mut Grid,
        base: &[i32],
        plan: &mut Plan,
    ) -> Result<(), Error> {
        let d = &self.definition;
        if self.dials.squares == 0 || base.len() < 2 || grid.n_s < d.square_window as usize {
            return Ok(());
        }
        let stride = grid.n_s + 1;
        let mut sum = vec![0_i32; (grid.n_t + 1) * stride];
        for tt in 0..grid.n_t {
            for ss in 0..grid.n_s {
                sum[(tt + 1) * stride + ss + 1] =
                    sum[tt * stride + ss + 1] + sum[(tt + 1) * stride + ss] - sum[tt * stride + ss]
                        + i32::from(grid.open[tt * grid.n_s + ss] != 1);
            }
        }
        let b = c.base();
        let cxi = js_round(2.0 * b.zone.centroid.x);
        let cyi = js_round(2.0 * b.zone.centroid.y);
        let (cs2, ct2) = if grid.horizontal {
            (cxi, cyi)
        } else {
            (cyi, cxi)
        };
        let mut cands: Vec<Candidate> = Vec::new();
        for k in 0..base.len() - 1 {
            let t0 = (base[k] - 1 - grid.t_lo).max(0) as usize;
            let t1 = (base[k + 1] + 1 - grid.t_lo).min(grid.n_t as i32 - 1) as usize;
            let dt = (base[k] + base[k + 1] + 1) as f64 - ct2;
            for ss in 0..=grid.n_s - d.square_window as usize {
                let end = ss + d.square_window as usize;
                let blocked = sum[(t1 + 1) * stride + end]
                    - sum[t0 * stride + end]
                    - sum[(t1 + 1) * stride + ss]
                    + sum[t0 * stride + ss];
                let ds = (2 * (grid.s_lo + ss as i32) + d.square_window) as f64 - cs2;
                let score = isqrt(ds * ds + dt * dt) + d.square_blocked_cost * blocked as f64;
                if cands.len() == d.square_tries && score >= cands[d.square_tries - 1].score {
                    continue;
                }
                let mut at = cands.len();
                while at > 0 && cands[at - 1].score > score {
                    at -= 1
                }
                cands.insert(
                    at,
                    Candidate {
                        score,
                        k,
                        s: ss as i32,
                    },
                );
                if cands.len() > d.square_tries {
                    cands.pop();
                }
            }
        }
        'windows: for cand in cands.into_iter().take(d.square_tries) {
            let mid = js_round((base[cand.k] + base[cand.k + 1]) as f64 / 2.0) as i32;
            for &off_s in d.offsets_s {
                for &off_t in d.offsets_t {
                    let (s0, t0) = (grid.s_lo + cand.s + off_s, mid + off_t - 1);
                    let mut free = true;
                    for a in 0..3 {
                        if !free {
                            break;
                        }
                        for b in 0..3 {
                            if !grid.ok_at(s0 + a, t0 + b) {
                                free = false;
                                break;
                            }
                        }
                    }
                    if !free {
                        continue;
                    }
                    let mut blocks = Vec::new();
                    for b in 0..3 {
                        for a in 0..3 {
                            blocks.push((grid.idx(s0 + a, t0 + b), BlockKind::Wall))
                        }
                    }
                    blocks.sort_by_key(|p| p.0);
                    let Some(placed) = c.place_feature(&FeatureSpec {
                        kind: FeatureKind::Gallows,
                        variant: None,
                        jobs: vec![FeatureJob::Landmark],
                        anchor: if grid.horizontal { [s0, t0] } else { [t0, s0] },
                        params: Some(vec![]),
                        blocks,
                        groups: None,
                        floor: None,
                        mode: Mode::Whole,
                        min_piece: None,
                        min_share_permille: None,
                        min_groups: None,
                    })?
                    else {
                        continue;
                    };
                    plan.gallows = placed.written;
                    for &i in &plan.gallows {
                        let (x, y) = (i % grid.w as i32, i / grid.w as i32);
                        let (s, t) = if grid.horizontal { (x, y) } else { (y, x) };
                        grid.open[(t - grid.t_lo) as usize * grid.n_s + (s - grid.s_lo) as usize] =
                            0;
                    }
                    plan.square = Some(Square {
                        k: cand.k,
                        s: cand.s,
                    });
                    break 'windows;
                }
            }
        }
        Ok(())
    }
    pub fn shape(&self, c: &mut ShapeContext<'_, '_>) -> Result<Plan, Error> {
        let mut plan = Plan::default();
        let b = c.base();
        let w = b.w;
        let bb = b.zone.bbox;
        // Signature mode (P-LAND-SENTENCED-1): `Some` only when the zone holds a signature `Church`; option off this is
        // `None` and every line below runs as today. `Err` when a `Church` is there but its door does not read as three
        // open tiles in one run: `Error::Landmark`, and the pipeline refuses the attempt.
        let lanes = lanes::frame(&b)?;
        let horizontal = legacy_horizontal(&b);
        let (t_lo, n_t, s_lo, n_s) = if horizontal {
            (bb.y, bb.h as usize, bb.x, bb.w as usize)
        } else {
            (bb.x, bb.w as usize, bb.y, bb.h as usize)
        };
        plan.axis = u8::from(!horizontal);
        plan.s_lo = s_lo;
        plan.t_lo = t_lo;
        if (n_s as i32) < self.dials.min_run || (n_t as i32) < self.dials.gap_min + 1 {
            return Ok(plan);
        }
        let corridor = if self.dials.route == Route::Open {
            Some(c.route_guard().corridor().to_vec())
        } else {
            c.route_guard();
            None
        };
        let mut grid = Grid {
            w,
            horizontal,
            s_lo,
            t_lo,
            n_s,
            n_t,
            open: vec![0; n_s * n_t],
        };
        for tt in 0..n_t {
            for ss in 0..n_s {
                let i = grid.idx(s_lo + ss as i32, t_lo + tt as i32);
                grid.open[tt * n_s + ss] =
                    u8::from(c.open(i) && corridor.as_ref().is_none_or(|a| a[i as usize] == 0));
            }
        }
        let mut value = vec![0; n_t];
        for (tt, value) in value.iter_mut().enumerate() {
            let (mut run, mut sum) = (0, 0);
            for ss in 0..=n_s {
                if ss < n_s && grid.open[tt * n_s + ss] == 1 {
                    run += 1
                } else {
                    if run >= self.definition.open_run_min {
                        sum += run
                    }
                    run = 0
                }
            }
            *value = sum - self.definition.value_bias;
        }
        let base = viterbi_rows(
            &value,
            t_lo,
            self.dials.gap_min,
            self.dials.gap_max,
            self.dials.gap_target,
            self.dials.gap_penalty,
        );
        plan.base_rows = base.clone();
        if base.is_empty() && lanes.is_none() {
            return Ok(plan);
        }
        self.square(c, &mut grid, &base, &mut plan)?;
        // The square keeps today's rows and orientation; the lanes are laid on a second grid in the door orientation,
        // built after it so that its tiles are closed there too.
        let (mut row_plans, corridor_opened) = if let Some(f) = &lanes {
            let lane_grid = self.lane_grid(c, f, corridor.as_deref());
            plan.axis = f.axis();
            plan.s_lo = lane_grid.s_lo;
            plan.t_lo = lane_grid.t_lo;
            self.lane_plans(c, &lane_grid, f, corridor.as_deref())
        } else {
            self.row_plans(c, &grid, &base, &plan.square, corridor.as_deref())
        };
        plan.corridor_opened = corridor_opened;
        plan.planned = self.plan_detours(
            c,
            &mut row_plans,
            c.caps().fence_detour as usize,
            &mut plan.dropped,
        );
        for rp in &row_plans {
            if rp.blocks.len() >= self.definition.min_piece {
                for &i in &rp.gates {
                    c.reserve(i)
                }
            }
        }
        let mut holes = Vec::new();
        for rp in row_plans {
            if rp.blocks.len() < self.definition.min_piece {
                continue;
            }
            let first = rp.blocks[0];
            let placed = c.place_feature(&FeatureSpec {
                kind: FeatureKind::FenceRow,
                variant: None,
                jobs: vec![FeatureJob::Lane],
                anchor: [first % w as i32, first / w as i32],
                params: Some(vec![i32::from(plan.axis), rp.index as i32, rp.phase]),
                blocks: rp.blocks.iter().map(|&i| (i, BlockKind::Fence)).collect(),
                groups: None,
                floor: None,
                mode: Mode::Trim,
                min_piece: Some(self.definition.min_piece as u32),
                min_share_permille: None,
                min_groups: None,
            })?;
            let Some(placed) = placed else {
                holes.extend(rp.blocks);
                continue;
            };
            if placed.refused > 0 {
                for &i in &rp.blocks {
                    if c.base().tiles[i as usize] != TILE_LOW {
                        holes.push(i)
                    }
                }
            }
            plan.rows.push(Row {
                axis: plan.axis,
                index: rp.index,
                phase: rp.phase,
                t0: rp.t0,
                tiles: placed.written,
                posts: rp
                    .posts
                    .into_iter()
                    .filter(|&i| c.base().tiles[i as usize] == TILE_LOW)
                    .collect(),
                gates: rp.gates,
            });
        }
        plan.relaxed = self.relax_rows(c, &mut plan, &holes);
        if !c.route_guard().members().is_empty() {
            let mut st = c.worst_stretch(&[]);
            plan.checks = 1;
            if self.dials.route == Route::Repair {
                let (mut calls, mut radius) = (1, 0);
                while st > i64::from(c.caps().route_stretch_max)
                    && calls < self.definition.route_checks
                {
                    let guard = c.route_guard();
                    let band = guard.corridor_of(guard.worst_member()).to_vec();
                    let opened = self.open_around(c, &mut plan, &band, radius);
                    if opened == 0 {
                        radius += 1;
                        if radius > self.definition.repair_radius_max {
                            break;
                        }
                        continue;
                    }
                    plan.repaired += opened;
                    radius = 0;
                    st = c.worst_stretch(&[]);
                    calls += 1;
                    plan.checks = calls;
                }
            }
            plan.stretch = st;
        }
        plan.empty_rows = plan.rows.iter().filter(|r| r.tiles.is_empty()).count();
        plan.houses = c
            .base()
            .zone_features()
            .filter(|f| f.kind == FeatureKind::Landmark && f.variant == self.house.template.key)
            .count();
        Ok(plan)
    }
}
