//! Read-only common inputs and actual stage-4 planning helpers. No recipes or guard access.
use super::runtime::LandmarkRuntime;
use crate::map::TILE_FLOOR;
use crate::mapgen::attempt::{to_uint32, validate_input, AttemptInputError};
use crate::mapgen::coliseum::{FixedDefinition, FixedLayout};
use crate::rng::{hash_seed, Mulberry32};

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecipeSupportDefinition {
    pub ref_zone_tiles: f64,
    pub landmarks_per_zone: u32,
    pub landmark_stream: u32,
    pub noise_stream_offset: u32,
    pub door_min_offset: u8,
    pub door_max_offset: u8,
}
pub const DEFAULT_DEFINITION: RecipeSupportDefinition = RecipeSupportDefinition {
    ref_zone_tiles: 1710.0,
    landmarks_per_zone: 2,
    landmark_stream: 3,
    noise_stream_offset: 100,
    door_min_offset: 1,
    door_max_offset: 4,
};
pub fn default_definition() -> RecipeSupportDefinition {
    DEFAULT_DEFINITION
}
/// Stable declaration order, allocation-free; every field drives a helper below.
pub fn visit_content(d: &RecipeSupportDefinition, mut word: impl FnMut(u64)) {
    word(d.ref_zone_tiles.to_bits());
    word(d.landmarks_per_zone.into());
    word(d.landmark_stream.into());
    word(d.noise_stream_offset.into());
    word(d.door_min_offset.into());
    word(d.door_max_offset.into());
}
/// Immutable borrowed inputs. Territory is only available from the runtime that owns its transaction.
pub struct RecipeInputs<'a> {
    seed: i64,
    attempt: u64,
    pub fixed: &'a FixedLayout,
    pub fixed_rules: &'a FixedDefinition<'a>,
    pub rules: &'a RecipeSupportDefinition,
}
impl<'a> RecipeInputs<'a> {
    pub fn new(
        seed: i64,
        attempt: u64,
        fixed: &'a FixedLayout,
        fixed_rules: &'a FixedDefinition<'a>,
        rules: &'a RecipeSupportDefinition,
    ) -> Result<Self, AttemptInputError> {
        validate_input(seed, attempt)?;
        Ok(Self {
            seed,
            attempt,
            fixed,
            fixed_rules,
            rules,
        })
    }
    pub fn streams(&self, zone: u8) -> RecipeStreams {
        RecipeStreams::from_admitted(self.seed, self.attempt, zone, self.rules)
    }
    pub fn camp_nodes(&self, runtime: &LandmarkRuntime<'_>) -> Vec<Node> {
        camp_nodes(
            runtime,
            Some(&self.fixed.dist_fp),
            self.fixed_rules.ring_road,
            self.rules,
        )
    }
}
impl RecipeSupportDefinition {
    pub fn area_scale(&self, painted: usize) -> f64 {
        painted as f64 / self.ref_zone_tiles
    }
    pub fn len_scale(&self, painted: usize) -> f64 {
        crate::math::sqrt(self.area_scale(painted))
    }
    /// The common upper limit; individual callbacks choose whether to require at least one.
    pub fn landmark_limit(&self, painted: usize) -> f64 {
        (self.landmarks_per_zone as f64).min(js_round(self.area_scale(painted)))
    }
}
/// Records independent context seeds without accepting, drawing, or mutating the main stream.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RecipeStreams {
    pub landmark_seed: u32,
    pub noise_seed: u32,
}
impl RecipeStreams {
    pub fn new(
        seed: i64,
        attempt: u64,
        zone: u8,
        d: &RecipeSupportDefinition,
    ) -> Result<Self, AttemptInputError> {
        validate_input(seed, attempt)?;
        Ok(Self::from_admitted(seed, attempt, zone, d))
    }
    fn from_admitted(seed: i64, attempt: u64, zone: u8, d: &RecipeSupportDefinition) -> Self {
        let (seed, attempt) = (to_uint32(seed as f64), to_uint32(attempt as f64));
        Self {
            landmark_seed: hash_seed(seed, attempt, zone.into(), d.landmark_stream),
            noise_seed: hash_seed(
                seed,
                attempt,
                zone.into(),
                d.landmark_stream.wrapping_add(d.noise_stream_offset),
            ),
        }
    }
    /// Fresh independent continuation. Actual landmark callbacks consume zero words.
    pub fn rng(&self) -> Mulberry32 {
        Mulberry32::new(self.landmark_seed)
    }
    pub fn noise(&self) -> Noise {
        Noise {
            stream_seed: self.noise_seed,
        }
    }
}
pub use crate::math::js_round;
/// Hash multipliers and binary powers here encode the source's fixed 32-bit hash, not policy.
pub fn hash2(x: f64, y: f64, salt: f64) -> f64 {
    let mut h = to_uint32(x).wrapping_mul(0x27d4eb2d)
        ^ to_uint32(y).wrapping_mul(0x165667b1)
        ^ to_uint32(salt).wrapping_mul(0x9e3779b1);
    h = (h ^ (h >> 15)).wrapping_mul(0x85ebca6b);
    h = (h ^ (h >> 13)).wrapping_mul(0xc2b2ae35);
    h ^= h >> 16;
    h as f64 / 4294967296.0
}
pub fn vnoise(x: f64, y: f64, cell: f64, salt: f64) -> f64 {
    let (fx, fy) = (x / cell, y / cell);
    let (x0, y0) = (fx.floor(), fy.floor());
    let (tx, ty) = (fx - x0, fy - y0);
    let (sx, sy) = (tx * tx * (3.0 - 2.0 * tx), ty * ty * (3.0 - 2.0 * ty));
    let (a, b, c, d) = (
        hash2(x0, y0, salt),
        hash2(x0 + 1.0, y0, salt),
        hash2(x0, y0 + 1.0, salt),
        hash2(x0 + 1.0, y0 + 1.0, salt),
    );
    let top = a + (b - a) * sx;
    let bot = c + (d - c) * sx;
    top + (bot - top) * sy
}
#[derive(Clone, Copy, Debug)]
pub struct Noise {
    pub stream_seed: u32,
}
impl Noise {
    pub fn value(&self, x: f64, y: f64, cell: f64, salt: f64) -> f64 {
        // Addition precedes JS ToInt32. Interpreting the resulting u32 as i32 preserves its value.
        vnoise(
            x,
            y,
            cell,
            (to_uint32(salt + self.stream_seed as f64) as i32) as f64,
        )
    }
    pub fn noise_q(&self, x: f64, y: f64, cell: f64, salt: f64) -> f64 {
        let v = (self.value(x, y, cell, salt) * 1024.0).floor();
        if v.is_nan() {
            v
        } else {
            v.min(1023.0)
        }
    }
}
/// Fixed DIR16 vector encoding, length approximately 1024; declaration order is bearing order.
pub const DIR16: [[i32; 2]; 16] = [
    [1024, 0],
    [946, 392],
    [724, 724],
    [392, 946],
    [0, 1024],
    [-392, 946],
    [-724, 724],
    [-946, 392],
    [-1024, 0],
    [-946, -392],
    [-724, -724],
    [-392, -946],
    [0, -1024],
    [392, -946],
    [724, -724],
    [946, -392],
];
pub fn dir_sep16(a: i32, b: i32) -> i32 {
    let d = (i64::from(a) - i64::from(b)).rem_euclid(16) as i32;
    if d > 8 {
        16 - d
    } else {
        d
    }
}
pub fn dist2(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let dx = ax - bx;
    let dy = ay - by;
    dx * dx + dy * dy
}
/// Source integer-domain helper: finite integer inputs in [0, Number.MAX_SAFE_INTEGER].
pub fn isqrt(n: f64) -> f64 {
    assert!(n.is_nan() || n <= 9007199254740991.0);
    if !(n > 0.0) {
        return 0.0;
    }
    let mut r = crate::math::sqrt(n).floor();
    while r * r > n {
        r -= 1.0;
    }
    while (r + 1.0) * (r + 1.0) <= n {
        r += 1.0;
    }
    r
}
pub fn argmax_in(field: &[i32], mask: &[u8], from: isize, to: isize) -> Option<usize> {
    assert!(mask.len() >= field.len());
    let mut best = None;
    for i in from.max(0) as usize..(to.max(0) as usize).min(field.len()) {
        if mask[i] != 0 && best.is_none_or(|b| field[i] > field[b]) {
            best = Some(i);
        }
    }
    best
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Camp,
    Door,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Node {
    pub x: f64,
    pub y: f64,
    pub kind: NodeKind,
    pub camp: i64,
    pub elite: bool,
}
/// Reads collision on every call; fixed distances are optional on non-generator grids.
pub fn camp_nodes(
    rt: &LandmarkRuntime<'_>,
    dist_fp: Option<&[u8]>,
    ring_road: u8,
    d: &RecipeSupportDefinition,
) -> Vec<Node> {
    let s = rt.state();
    let g = rt.geometry();
    let mut out = Vec::new();
    for c in &g.camps {
        if c.x < 0
            || c.y < 0
            || c.x as usize >= s.w
            || c.y as usize >= s.h
            || g.mask[c.y as usize * s.w + c.x as usize] != 1
        {
            continue;
        }
        out.push(Node {
            x: c.x as f64,
            y: c.y as f64,
            kind: NodeKind::Camp,
            camp: c.index as i64,
            elite: c.elite,
        });
    }
    let Some(fp) = dist_fp.filter(|fp| fp.len() == s.w * s.h) else {
        return out;
    };
    let bb = g.info.bbox;
    let mut best = None;
    let mut bd = f64::INFINITY;
    for y in bb.y..bb.y + bb.h as i32 {
        for x in bb.x..bb.x + bb.w as i32 {
            let i = y as usize * s.w + x as usize;
            if g.mask[i] == 0 || s.tiles[i] != TILE_FLOOR {
                continue;
            }
            let range = fp[i] as u16;
            if range <= u16::from(ring_road) + u16::from(d.door_min_offset)
                || range > u16::from(ring_road) + u16::from(d.door_max_offset)
            {
                continue;
            }
            let ex = x as f64 + 0.5 - g.info.centroid.x;
            let ey = y as f64 + 0.5 - g.info.centroid.y;
            let e = ex * ex + ey * ey;
            if e < bd {
                bd = e;
                best = Some(i);
            }
        }
    }
    if let Some(i) = best {
        out.push(Node {
            x: (i % s.w) as f64,
            y: (i / s.w) as f64,
            kind: NodeKind::Door,
            camp: -1,
            elite: false,
        });
    }
    out
}
pub fn gabriel_edges(nodes: &[Node]) -> Vec<[usize; 2]> {
    let mut out = Vec::new();
    for a in 0..nodes.len() {
        for b in a + 1..nodes.len() {
            let len = dist2(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y);
            let mut ok = true;
            for k in 0..nodes.len() {
                if k == a || k == b {
                    continue;
                }
                let ex = 2.0 * nodes[k].x - nodes[a].x - nodes[b].x;
                let ey = 2.0 * nodes[k].y - nodes[a].y - nodes[b].y;
                if ex * ex + ey * ey < len {
                    ok = false;
                    break;
                }
            }
            if ok {
                out.push([a, b]);
            }
        }
    }
    out
}
#[cfg(test)]
mod tests;
