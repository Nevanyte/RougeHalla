//! Sentenced lanes (P-LAND-SENTENCED-1, signature mode only). When the zone holds a signature `Church` (placed by the
//! Landmarks phase only with `pipeline::Options::signature`), the fence rows run parallel to the church's door axis on
//! the lines `|d| mod spacing == offset` from it, every row is cut by one gate grid counted from the door line, and no
//! row comes within `apron` of the yard box (the church and its graveyards). Option off there is no `Church` feature,
//! `frame` is `Ok(None)` and nothing here is read. Nothing here draws from any stream.
use super::rows::{flush, Grid, RowPlan};
use super::*;
use crate::mapgen::landmarks::{recipe_support::DIR16, signature::front};
use crate::mapgen::style_runtime::BaseContext;
use std::collections::BTreeSet;

/// The lane rules. Not part of `Definition` or `Dials` (both feed the content hash); read only in signature mode.
#[derive(Clone, Copy, Debug)]
pub struct Lanes {
    /// Distance between neighbouring lane lines.
    pub spacing: i32,
    /// `|d| mod spacing` of a lane line, `d` the signed distance from the door axis.
    pub offset: i32,
    /// One gate every `period` tiles along every row, `width` wide, at `(along - phase) mod period < width`, `along`
    /// counted from the door line (positive out through the door).
    pub period: i32,
    pub width: i32,
    pub phase: i32,
    /// No row tile within this Chebyshev distance of the yard box.
    pub apron: i32,
}
pub const LANES: Lanes = Lanes {
    spacing: 8,
    offset: 4,
    period: 12,
    width: 3,
    phase: 8,
    apron: 2,
};
/// The door frame of the zone's church: rows run along `s` (x when `horizontal`), lines are values of `t`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Frame {
    pub horizontal: bool,
    /// +1 when the door faces increasing `s`, -1 otherwise.
    pub sign: i32,
    /// The door line (an `s` value) and the spine (a `t` value: the middle entrance tile).
    pub line: i32,
    pub spine: i32,
    /// The yard box `[x0, x1] x [y0, y1]` in map tiles.
    pub yard: (i32, i32, i32, i32),
}
impl Frame {
    pub fn axis(&self) -> u8 {
        u8::from(!self.horizontal)
    }
    pub fn on_line(&self, t: i32) -> bool {
        (t - self.spine).abs() % LANES.spacing == LANES.offset.rem_euclid(LANES.spacing)
    }
    pub fn gate(&self, s: i32) -> bool {
        ((s - self.line) * self.sign - LANES.phase).rem_euclid(LANES.period) < LANES.width
    }
    pub fn in_apron(&self, x: i32, y: i32) -> bool {
        let (x0, y0, x1, y1) = self.yard;
        (x0 - x).max(x - x1).max(y0 - y).max(y - y1) <= LANES.apron
    }
}
/// The door as the church's ring leaves it (`church.rs`): exactly three open tiles in one run on the door-side wall
/// line, the middle entrance tile and one either side. Anything else is not a door the lanes can centre on.
fn door_span(open: &[i32]) -> Option<(i32, i32)> {
    match open {
        [a, b, c] if *b == *a + 1 && *c == *b + 1 => Some((*a, *c)),
        _ => None,
    }
}
/// The zone's church as the lanes read it. `Ok(None)` when the zone holds no signature `Church` (option off).
/// `Err(Error::Landmark)` when it holds one whose door cannot be read (the pipeline refuses the attempt): a signature
/// zone is never given today's rows instead of lanes, and the spine is never centred on something that is not the door.
pub(super) fn frame(b: &BaseContext<'_>) -> Result<Option<Frame>, Error> {
    let Some(f) = b.zone_features().find(|f| f.kind == FeatureKind::Church) else {
        return Ok(None);
    };
    let r = f.bbox;
    let (x0, y0, x1, y1) = (r.x, r.y, r.x + r.w as i32 - 1, r.y + r.h as i32 - 1);
    let v = DIR16[usize::from(front(f.ax, f.ay))];
    let horizontal = v[0].abs() >= v[1].abs();
    let sign = if horizontal {
        v[0].signum()
    } else {
        v[1].signum()
    };
    if sign == 0 {
        return Err(Error::Landmark);
    }
    let (line, lo, hi) = match (horizontal, sign > 0) {
        (true, true) => (x1, y0, y1),
        (true, false) => (x0, y0, y1),
        (false, true) => (y1, x0, x1),
        (false, false) => (y0, x0, x1),
    };
    // The entrance: the tiles of the door-side wall line the church's ring leaves open (`church.rs`: 3 of them).
    let door: Vec<i32> = (lo..=hi)
        .filter(|&t| {
            let i = if horizontal {
                b.at(line, t)
            } else {
                b.at(t, line)
            };
            i >= 0 && !b.is_owned(i) && b.tiles[i as usize] == TILE_FLOOR
        })
        .collect();
    let (first, last) = door_span(&door).ok_or(Error::Landmark)?;
    let mut yard = (x0, y0, x1, y1);
    for g in b
        .zone_features()
        .filter(|g| g.kind == FeatureKind::Graveyard)
    {
        let r = g.bbox;
        yard.0 = yard.0.min(r.x);
        yard.1 = yard.1.min(r.y);
        yard.2 = yard.2.max(r.x + r.w as i32 - 1);
        yard.3 = yard.3.max(r.y + r.h as i32 - 1);
    }
    Ok(Some(Frame {
        horizontal,
        sign,
        line,
        spine: (first + last).div_euclid(2),
        yard,
    }))
}
impl Callbacks<'_> {
    /// The lanes grid: the zone's box in the door orientation, open where the runtime would take a block, off the
    /// corridor (`Route::Open`) and off the apron.
    pub(super) fn lane_grid(
        &self,
        c: &ShapeContext<'_, '_>,
        f: &Frame,
        corridor: Option<&[u8]>,
    ) -> Grid {
        let b = c.base();
        let bb = b.zone.bbox;
        let (t_lo, n_t, s_lo, n_s) = if f.horizontal {
            (bb.y, bb.h as usize, bb.x, bb.w as usize)
        } else {
            (bb.x, bb.w as usize, bb.y, bb.h as usize)
        };
        let mut grid = Grid {
            w: b.w,
            horizontal: f.horizontal,
            s_lo,
            t_lo,
            n_s,
            n_t,
            open: vec![0; n_s * n_t],
        };
        for tt in 0..n_t {
            for ss in 0..n_s {
                let (s, t) = (s_lo + ss as i32, t_lo + tt as i32);
                let i = grid.idx(s, t);
                let (x, y) = if f.horizontal { (s, t) } else { (t, s) };
                grid.open[tt * n_s + ss] = u8::from(
                    c.open(i) && !f.in_apron(x, y) && corridor.is_none_or(|a| a[i as usize] == 0),
                );
            }
        }
        grid
    }
    /// One straight row per lane line inside the grid, in line order; the gates are the frame's single grid. Runs,
    /// segments, posts and wall cuts are today's `flush`, without the square's window (the square stands on today's
    /// rows) and without `Dials::min_run` (a segment still needs `min_piece`).
    pub(super) fn lane_plans(
        &self,
        c: &ShapeContext<'_, '_>,
        grid: &Grid,
        f: &Frame,
        corridor: Option<&[u8]>,
    ) -> (Vec<RowPlan>, usize) {
        let mut row_plans = Vec::new();
        let mut corridor_opened = 0;
        let b = c.base();
        let closed = |i: i32| i < 0 || b.mask[i as usize] == 0 || b.tiles[i as usize] != TILE_FLOOR;
        let gate = |s: i32| f.gate(s);
        let skip = |_: i32| false;
        for t0 in (grid.t_lo..grid.t_lo + grid.n_t as i32).filter(|&t| f.on_line(t)) {
            let mut rp = RowPlan {
                index: row_plans.len(),
                phase: LANES.phase,
                t0,
                blocks: vec![],
                posts: BTreeSet::new(),
                gates: vec![],
            };
            let (mut entry_s, mut entry_i) = (Vec::new(), Vec::new());
            let (mut stop_tile, mut start_closed) = (-1, true);
            for s in grid.s_lo..grid.s_lo + grid.n_s as i32 {
                if grid.ok_at(s, t0) {
                    if entry_s.is_empty() {
                        start_closed = closed(stop_tile)
                    }
                    entry_s.push(s);
                    entry_i.push(grid.idx(s, t0));
                } else {
                    let here = grid.idx(s, t0);
                    if corridor.is_some_and(|corridor| corridor[here as usize] == 1 && c.open(here))
                    {
                        corridor_opened += 1
                    }
                    flush(
                        c,
                        &mut entry_s,
                        &mut entry_i,
                        &mut rp,
                        start_closed,
                        here,
                        &gate,
                        &skip,
                        1,
                        self.definition.min_piece,
                    );
                    stop_tile = here;
                }
            }
            flush(
                c,
                &mut entry_s,
                &mut entry_i,
                &mut rp,
                start_closed,
                -1,
                &gate,
                &skip,
                1,
                self.definition.min_piece,
            );
            row_plans.push(rp);
        }
        (row_plans, corridor_opened)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn door(horizontal: bool, sign: i32) -> Frame {
        Frame {
            horizontal,
            sign,
            line: 40,
            spine: 20,
            yard: (30, 10, 40, 30),
        }
    }
    #[test]
    fn lines_are_symmetric_about_the_spine_and_gates_count_from_the_door() {
        let f = door(true, 1);
        let lines: Vec<i32> = (0..=40).filter(|&t| f.on_line(t)).collect();
        assert_eq!(lines, vec![0, 8, 16, 24, 32, 40]);
        // along 8, 9, 10 (and every 12 on, either side of the door line) are gates.
        let gates: Vec<i32> = (20..=70).filter(|&s| f.gate(s)).collect();
        assert_eq!(gates, vec![24, 25, 26, 36, 37, 38, 48, 49, 50, 60, 61, 62]);
        let back = door(true, -1);
        let gates: Vec<i32> = (10..=40).filter(|&s| back.gate(s)).collect();
        assert_eq!(gates, vec![18, 19, 20, 30, 31, 32]);
        assert!(f.in_apron(42, 32) && !f.in_apron(43, 20) && !f.in_apron(35, 7));
    }
    #[test]
    fn the_door_is_exactly_three_open_tiles_in_one_run() {
        assert_eq!(door_span(&[13, 14, 15]), Some((13, 15)));
        // An extra open tile on the door-side edge, beside the door or apart from it, is not a door.
        assert_eq!(door_span(&[13, 14, 15, 16]), None);
        assert_eq!(door_span(&[13, 14, 15, 20]), None);
        // Nor is a door with a tile missing, a gap in it, or no open tile at all.
        assert_eq!(door_span(&[13, 14]), None);
        assert_eq!(door_span(&[13, 14, 16]), None);
        assert_eq!(door_span(&[]), None);
    }
}
