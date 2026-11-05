use super::*;
use crate::mapgen::style_features::viterbi_path;
use std::collections::BTreeSet;
pub(super) struct RowPlan {
    pub index: usize,
    pub phase: i32,
    pub t0: i32,
    pub blocks: Vec<i32>,
    pub posts: BTreeSet<i32>,
    pub gates: Vec<i32>,
}
pub(super) struct Grid {
    pub w: usize,
    pub horizontal: bool,
    pub s_lo: i32,
    pub t_lo: i32,
    pub n_s: usize,
    pub n_t: usize,
    pub open: Vec<u8>,
}
impl Grid {
    pub fn idx(&self, s: i32, t: i32) -> i32 {
        if self.horizontal {
            t * self.w as i32 + s
        } else {
            s * self.w as i32 + t
        }
    }
    pub fn ok_at(&self, s: i32, t: i32) -> bool {
        let (ss, tt) = (s - self.s_lo, t - self.t_lo);
        ss >= 0
            && tt >= 0
            && (ss as usize) < self.n_s
            && (tt as usize) < self.n_t
            && self.open[tt as usize * self.n_s + ss as usize] == 1
    }
}
fn close_segment(
    seg: &mut Vec<i32>,
    rp: &mut RowPlan,
    start_flank: bool,
    end_flank: bool,
    cut_start: &mut bool,
    cut_end: bool,
    min_piece: usize,
) {
    if *cut_start && !seg.is_empty() {
        seg.remove(0);
    }
    if cut_end {
        seg.pop();
    }
    if seg.len() >= min_piece {
        rp.blocks.extend_from_slice(seg);
        if start_flank {
            rp.posts.insert(seg[0]);
        }
        if end_flank {
            rp.posts.insert(seg[seg.len() - 1]);
        }
    }
    seg.clear();
    *cut_start = false;
}
#[allow(clippy::too_many_arguments)]
fn flush(
    c: &ShapeContext<'_, '_>,
    grid: &Grid,
    entry_s: &mut Vec<i32>,
    entry_i: &mut Vec<i32>,
    rp: &mut RowPlan,
    start_closed: bool,
    end_tile: i32,
    win: &Option<Square>,
    d: &Dials,
    rules: &Definition<'_>,
) {
    let len = entry_s.len();
    let base = c.base();
    let closed =
        |i: i32| i < 0 || base.mask[i as usize] == 0 || base.tiles[i as usize] != TILE_FLOOR;
    if len > 0 && entry_s[len - 1] - entry_s[0] + 1 >= d.min_run {
        let mut seg = Vec::new();
        let (mut start_flank, mut prev_gate, mut cut_start) = (false, false, start_closed);
        for e in 0..len {
            let (s, i) = (entry_s[e], entry_i[e]);
            let gate = gate_open(s - grid.s_lo, rp.phase, d.period, d.width);
            let skip = win.as_ref().is_some_and(|win| {
                (rp.index == win.k || rp.index == win.k + 1)
                    && s >= grid.s_lo + win.s
                    && s < grid.s_lo + win.s + rules.square_window
            });
            if gate {
                rp.gates.push(i);
                close_segment(
                    &mut seg,
                    rp,
                    start_flank,
                    true,
                    &mut cut_start,
                    false,
                    rules.min_piece,
                );
            } else if skip {
                close_segment(
                    &mut seg,
                    rp,
                    start_flank,
                    false,
                    &mut cut_start,
                    false,
                    rules.min_piece,
                );
            } else {
                if seg.is_empty() {
                    start_flank = prev_gate
                }
                seg.push(i);
            }
            prev_gate = gate;
        }
        close_segment(
            &mut seg,
            rp,
            start_flank,
            false,
            &mut cut_start,
            closed(end_tile),
            rules.min_piece,
        );
    }
    entry_s.clear();
    entry_i.clear();
}
impl Callbacks<'_> {
    pub(super) fn row_plans(
        &self,
        c: &ShapeContext<'_, '_>,
        grid: &Grid,
        base: &[i32],
        win: &Option<Square>,
        corridor: Option<&[u8]>,
    ) -> (Vec<RowPlan>, usize) {
        let d = &self.dials;
        let rules = &self.definition;
        let mut row_plans = Vec::new();
        let mut corridor_opened = 0;
        for (r, &t0) in base.iter().enumerate() {
            let phase = row_phase(r as i32, &d.phases).expect("admitted phases");
            let path = viterbi_path(
                grid.n_s,
                rules.wiggle,
                |k, dt| {
                    (if grid.ok_at(grid.s_lo + k as i32, t0 + i32::from(dt)) {
                        0
                    } else {
                        rules.blocked_cost
                    }) + rules.deviation_cost * i32::from(dt).abs()
                },
                rules.jog_cost,
            );
            let mut rp = RowPlan {
                index: r,
                phase,
                t0,
                blocks: vec![],
                posts: BTreeSet::new(),
                gates: vec![],
            };
            let (mut entry_s, mut entry_i) = (Vec::new(), Vec::new());
            let (mut prev_t, mut stop_tile, mut start_closed) = (-1, -1, true);
            let b = c.base();
            let closed =
                |i: i32| i < 0 || b.mask[i as usize] == 0 || b.tiles[i as usize] != TILE_FLOOR;
            for (k, &offset) in path.iter().enumerate() {
                let (s, t) = (grid.s_lo + k as i32, t0 + i32::from(offset));
                if grid.ok_at(s, t) {
                    if entry_s.is_empty() {
                        start_closed = closed(stop_tile)
                    }
                    if !entry_s.is_empty() && t != prev_t && grid.ok_at(s - 1, t) {
                        entry_s.push(s - 1);
                        entry_i.push(grid.idx(s - 1, t));
                    }
                    entry_s.push(s);
                    entry_i.push(grid.idx(s, t));
                    prev_t = t;
                } else {
                    let here = if t >= grid.t_lo && t < grid.t_lo + grid.n_t as i32 {
                        grid.idx(s, t)
                    } else {
                        -1
                    };
                    if corridor.is_some_and(|corridor| {
                        here >= 0 && corridor[here as usize] == 1 && c.open(here)
                    }) {
                        corridor_opened += 1
                    }
                    flush(
                        c,
                        grid,
                        &mut entry_s,
                        &mut entry_i,
                        &mut rp,
                        start_closed,
                        here,
                        win,
                        d,
                        rules,
                    );
                    prev_t = -1;
                    stop_tile = here;
                }
            }
            flush(
                c,
                grid,
                &mut entry_s,
                &mut entry_i,
                &mut rp,
                start_closed,
                -1,
                win,
                d,
                rules,
            );
            row_plans.push(rp);
        }
        (row_plans, corridor_opened)
    }
}
