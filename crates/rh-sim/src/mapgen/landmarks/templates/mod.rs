//! Exact parsing, orientation, stamping, fit checks, and transaction handoff for landmark templates.
//! Template selection and faction recipes live outside this leaf.
use super::runtime::{LandmarkRuntime, LandmarkSpec, PlacedFeature};
use crate::map::TILE_FLOOR;
use crate::mapdata::{FeatureJob, FeatureKind, TileRect};

const WALL: u8 = 0;
const FLOOR: u8 = 1;
const DOOR: u8 = 2;
const NOOK: u8 = 3;
const LIGHT: u8 = 4;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LandmarkTemplate {
    pub key: String,
    pub rows: Vec<String>,
    pub jobs: Vec<FeatureJob>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stamp {
    pub walls: Vec<i32>,
    pub floor: Vec<i32>,
    pub doors: Vec<i32>,
    pub nooks: Vec<i32>,
    pub lights: Vec<i32>,
    pub bbox: TileRect,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Oriented {
    pub bw: usize,
    pub bh: usize,
    pub dx: Vec<i16>,
    pub dy: Vec<i16>,
    pub code: Vec<u8>,
    pub count: [usize; 5],
    pub full: bool,
    pub rects: Vec<i16>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedTemplate {
    pub template: LandmarkTemplate,
    pub orientations: [Oriented; 8],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TemplateError {
    Ragged { row: usize },
    UnknownCell { x: usize, y: usize, cell: u16 },
    TooLarge,
}

fn greedy_rectangles(req: &[i8], bw: usize, bh: usize) -> Result<Vec<i16>, TemplateError> {
    let mut taken = vec![false; bw.checked_mul(bh).ok_or(TemplateError::TooLarge)?];
    let mut walls = Vec::<i16>::new();
    let mut floors = Vec::<i16>::new();
    for y in 0..bh {
        for x in 0..bw {
            let at = y * bw + x;
            let r = req[at];
            if r < 0 || taken[at] {
                continue;
            }
            let mut rw = 1;
            while x + rw < bw && req[at + rw] == r && !taken[at + rw] {
                rw += 1;
            }
            let mut rh = 1;
            'height: loop {
                if y + rh >= bh {
                    break;
                }
                for k in 0..rw {
                    let i = (y + rh) * bw + x + k;
                    if req[i] != r || taken[i] {
                        break 'height;
                    }
                }
                rh += 1;
            }
            for yy in y..y + rh {
                for xx in x..x + rw {
                    taken[yy * bw + xx] = true;
                }
            }
            let dst = if r == 1 { &mut walls } else { &mut floors };
            for v in [x, y, rw, rh, if r == 1 { 1 } else { 0 }] {
                dst.push(v as i16);
            }
        }
    }
    walls.extend(floors);
    Ok(walls)
}

fn code(c: u16, x: usize, y: usize) -> Result<Option<u8>, TemplateError> {
    Ok(match c {
        95 => None,
        35 => Some(WALL),
        46 => Some(FLOOR),
        100 => Some(DOOR),
        99 => Some(NOOK),
        108 => Some(LIGHT),
        _ => return Err(TemplateError::UnknownCell { x, y, cell: c }),
    })
}

pub fn parse_template(template: LandmarkTemplate) -> Result<ParsedTemplate, TemplateError> {
    let th = template.rows.len();
    let rows: Vec<Vec<u16>> = template
        .rows
        .iter()
        .map(|row| row.encode_utf16().collect())
        .collect();
    let tw = rows.first().map_or(0, Vec::len);
    let mut cells = Vec::<(usize, usize, u8)>::new();
    for (y, row) in rows.iter().enumerate() {
        if row.len() != tw {
            return Err(TemplateError::Ragged { row: y });
        }
        for (x, &ch) in row.iter().enumerate() {
            if let Some(c) = code(ch, x, y)? {
                cells.push((x, y, c));
            }
        }
    }
    let mut orientations = Vec::with_capacity(8);
    for o in 0..8 {
        let rot = o & 3;
        let mirror = o >= 4;
        let turn = rot & 1 == 1;
        let (bw, bh) = if turn { (th, tw) } else { (tw, th) };
        let mut dx = Vec::with_capacity(cells.len());
        let mut dy = Vec::with_capacity(cells.len());
        let mut codes = Vec::with_capacity(cells.len());
        let mut count = [0usize; 5];
        for &(ox, oy, c) in &cells {
            let x = if mirror { tw - 1 - ox } else { ox };
            let (tx, ty) = match rot {
                0 => (x, oy),
                1 => (th - 1 - oy, x),
                2 => (tw - 1 - x, th - 1 - oy),
                _ => (oy, tw - 1 - x),
            };
            dx.push(tx as i16);
            dy.push(ty as i16);
            codes.push(c);
            count[c as usize] += 1;
        }
        let mut req = vec![-1; bw.checked_mul(bh).ok_or(TemplateError::TooLarge)?];
        for k in 0..codes.len() {
            let at = i64::from(dy[k]) * bw as i64 + i64::from(dx[k]);
            if at >= 0 && at < req.len() as i64 {
                req[at as usize] = if codes[k] == WALL { 1 } else { 0 };
            }
        }
        let full = cells.len() == bw * bh;
        let rects = greedy_rectangles(&req, bw, bh)?;
        let rects = if full {
            rects
                .chunks_exact(5)
                .filter(|r| r[4] == 1)
                .flatten()
                .copied()
                .collect()
        } else {
            rects
        };
        orientations.push(Oriented {
            bw,
            bh,
            dx,
            dy,
            code: codes,
            count,
            full,
            rects,
        });
    }
    let orientations: [Oriented; 8] = orientations
        .try_into()
        .expect("eight orientations are constructed");
    Ok(ParsedTemplate {
        template,
        orientations,
    })
}

pub fn stamp_template(
    t: &ParsedTemplate,
    x0: i32,
    y0: i32,
    rot: u8,
    mirror: bool,
    w: usize,
    h: usize,
) -> Option<Stamp> {
    let area = w.checked_mul(h)?;
    if w == 0 || h == 0 || area > i32::MAX as usize {
        return None;
    }
    let width = i64::try_from(w).ok()?;
    let o = &t.orientations[(rot & 3) as usize + usize::from(mirror) * 4];
    let mut out = Stamp {
        walls: Vec::with_capacity(o.count[0]),
        floor: Vec::with_capacity(o.count[1]),
        doors: Vec::with_capacity(o.count[2]),
        nooks: Vec::with_capacity(o.count[3]),
        lights: Vec::with_capacity(o.count[4]),
        bbox: TileRect {
            x: x0,
            y: y0,
            w: o.bw as u32,
            h: o.bh as u32,
        },
    };
    for k in 0..o.code.len() {
        let x = i64::from(x0) + i64::from(o.dx[k]);
        let y = i64::from(y0) + i64::from(o.dy[k]);
        if x < 0 || y < 0 || x >= width || y >= h as i64 {
            return None;
        }
        // The source caches offsets in an Int32Array before adding the box origin. Preserve
        // that wrapping step, then refuse overflow artifacts outside the runtime's i32 grid.
        let offset = (i64::from(o.dy[k]) * width + i64::from(o.dx[k])) as i32;
        let base = i64::from(y0) * width + i64::from(x0);
        let index = base + i64::from(offset);
        if index < 0 || index >= area as i64 || index > i64::from(i32::MAX) {
            return None;
        }
        let i = index as i32;
        match o.code[k] {
            WALL => out.walls.push(i),
            FLOOR => out.floor.push(i),
            DOOR => out.doors.push(i),
            NOOK => out.nooks.push(i),
            LIGHT => out.lights.push(i),
            _ => unreachable!(),
        }
    }
    Some(out)
}

pub fn stamp_fits(rt: &LandmarkRuntime<'_>, s: &Stamp) -> bool {
    stamp_fits_with(rt, s, rt.original_hard(), |i| rt.open(i))
}

/// Checks against a callback's planning view. Scorch changes both `hard` and `open`; the transaction
/// closure still uses the runtime's original hard mask when `place_landmark` commits.
pub fn stamp_fits_with(
    rt: &LandmarkRuntime<'_>,
    s: &Stamp,
    hard: &[u8],
    open: impl Fn(i32) -> bool,
) -> bool {
    let state = rt.state();
    let geometry = rt.geometry();
    if hard.len() != state.tiles.len() {
        return false;
    }
    for &i in &s.walls {
        if !open(i) {
            return false;
        }
    }
    for list in [&s.floor, &s.doors, &s.nooks, &s.lights] {
        for &i in list {
            let Some(index) = usize::try_from(i).ok().filter(|&i| i < state.tiles.len()) else {
                return false;
            };
            if geometry.mask[index] == 0
                || state.tiles[index] != TILE_FLOOR
                || hard[index] != 0
                || rt.is_owned(i)
            {
                return false;
            }
        }
    }
    let r = s.bbox;
    let gap = crate::constants::LANDMARK_GAP;
    for f in rt.zone_features() {
        if f.kind != FeatureKind::Landmark {
            continue;
        }
        let q = f.bbox;
        if f64::from(r.x) - gap < f64::from(q.x) + f64::from(q.w)
            && f64::from(r.x) + f64::from(r.w) + gap > f64::from(q.x)
            && f64::from(r.y) - gap < f64::from(q.y) + f64::from(q.h)
            && f64::from(r.y) + f64::from(r.h) + gap > f64::from(q.y)
        {
            return false;
        }
    }
    true
}

pub fn place_landmark(
    rt: &mut LandmarkRuntime<'_>,
    t: &ParsedTemplate,
    s: &Stamp,
    rot: u8,
    mirror: bool,
) -> Option<PlacedFeature> {
    let mut doors = s.doors.clone();
    doors.sort_unstable();
    let mut params = vec![i32::from(rot), i32::from(mirror)];
    params.extend(doors);
    let mut floor =
        Vec::with_capacity(s.floor.len() + s.doors.len() + s.nooks.len() + s.lights.len());
    floor.extend_from_slice(&s.floor);
    floor.extend_from_slice(&s.doors);
    floor.extend_from_slice(&s.nooks);
    floor.extend_from_slice(&s.lights);
    let placed = rt.place_whole(&LandmarkSpec {
        variant: t.template.key.clone(),
        jobs: t.template.jobs.clone(),
        anchor: [s.bbox.x, s.bbox.y],
        params: Some(params),
        blocks: s.walls.clone(),
        floor: Some(floor),
    });
    if placed.is_some() {
        for &d in &s.doors {
            rt.reserve(d);
        }
    }
    placed
}

#[cfg(test)]
mod tests;
