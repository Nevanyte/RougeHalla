//! Fixed legacy 160x160 layout. Owned output, with no mutable process-global cache.
use super::det_math::{det_cos, det_sin, TWO_PI};
pub const W: usize = crate::constants::MAP_TILES_W as usize;
pub const H: usize = crate::constants::MAP_TILES_H as usize;
pub const CX: i32 = (W / 2) as i32;
pub const CY: i32 = (H / 2) as i32;
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TilePt {
    pub x: i32,
    pub y: i32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TileRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum GateSide {
    #[serde(rename = "n")]
    North,
    #[serde(rename = "e")]
    East,
    #[serde(rename = "s")]
    South,
    #[serde(rename = "w")]
    West,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GateDef {
    pub side: GateSide,
    pub tiles: Vec<TilePt>,
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedLayout {
    pub border: Vec<u8>,
    pub fp: Vec<u8>,
    pub dist_fp: Vec<u8>,
    pub ring: Vec<u8>,
    pub wall_ring: Vec<u8>,
    pub co_floor: Vec<u8>,
    pub co_rect: TileRect,
    pub gates: Vec<GateDef>,
    pub lane_in: Vec<u8>,
    pub lane_out: Vec<TilePt>,
    pub inner_tiles: Vec<TilePt>,
    pub pillars: Vec<Vec<u8>>,
    pub painted: Vec<usize>,
    pub painted_mask: Vec<u8>,
    pub ring_tiles: Vec<usize>,
}
/// Fixed coliseum rules and the offline-selected pillar orbits. This same data is
/// read by layout generation and by the content identity fold; no map allocation
/// is required to enumerate it.
#[derive(Clone, Copy, Debug)]
pub struct FixedDefinition<'a> {
    pub half: f64,
    pub chamfer: f64,
    pub gate_width: i32,
    pub lane_depth: i32,
    pub lane_margin: i32,
    pub ring_road: u8,
    pub distance_cap: u8,
    pub inner_spawn_radius: f64,
    pub inner_spawn_phase: f64,
    pub pillar_source_center: i32,
    pub pillars: &'a [PillarOrbit<'a>],
}
#[derive(Clone, Copy, Debug)]
pub struct PillarOrbit<'a> {
    pub turns: usize,
    pub generators: &'a [(i32, i32)],
}
/// The sole definition of the legacy geometry. Array order is part of identity.
pub const DEFAULT_DEFINITION: FixedDefinition<'static> = FixedDefinition {
    half: 9.0,
    chamfer: 13.0,
    gate_width: 4,
    lane_depth: 3,
    lane_margin: 1,
    ring_road: 3,
    distance_cap: 6,
    inner_spawn_radius: 5.5,
    inner_spawn_phase: 0.5,
    pillar_source_center: 32,
    pillars: &[
        PillarOrbit {
            turns: 4,
            generators: &[(27, 27), (28, 28), (29, 29), (31, 29), (32, 30)],
        },
        PillarOrbit {
            turns: 2,
            generators: &[
                (33, 30),
                (34, 30),
                (28, 28),
                (35, 28),
                (32, 31),
                (29, 29),
                (35, 29),
                (36, 27),
                (27, 27),
                (30, 30),
            ],
        },
        PillarOrbit {
            turns: 2,
            generators: &[
                (28, 28),
                (27, 27),
                (35, 28),
                (32, 31),
                (34, 29),
                (31, 30),
                (29, 28),
                (33, 30),
                (30, 29),
                (36, 27),
            ],
        },
        PillarOrbit {
            turns: 2,
            generators: &[
                (29, 29),
                (35, 28),
                (33, 30),
                (28, 28),
                (34, 29),
                (29, 30),
                (36, 27),
                (32, 31),
                (30, 31),
                (27, 27),
            ],
        },
    ],
};
pub fn default_definition() -> FixedDefinition<'static> {
    DEFAULT_DEFINITION
}
/// Fixed-order numeric words: scalar fields in declaration order, then orbit
/// count, and each orbit's turns, generator count and ordered x/y coordinates.
/// Signed integers use sign-extended two's-complement words; floats use IEEE bits.
/// Dimensions, world scale and player count are already in the scalar registry.
pub fn visit_content(data: &FixedDefinition<'_>, mut word: impl FnMut(u64)) {
    word(data.half.to_bits());
    word(data.chamfer.to_bits());
    word(data.gate_width as i64 as u64);
    word(data.lane_depth as i64 as u64);
    word(data.lane_margin as i64 as u64);
    word(u64::from(data.ring_road));
    word(u64::from(data.distance_cap));
    word(data.inner_spawn_radius.to_bits());
    word(data.inner_spawn_phase.to_bits());
    word(data.pillar_source_center as i64 as u64);
    word(data.pillars.len() as u64);
    for orbit in data.pillars {
        word(orbit.turns as u64);
        word(orbit.generators.len() as u64);
        for &(x, y) in orbit.generators {
            word(x as i64 as u64);
            word(y as i64 as u64);
        }
    }
}
fn ix(x: i32, y: i32) -> usize {
    y as usize * W + x as usize
}
pub fn fixed_layout() -> FixedLayout {
    fixed_layout_from(&default_definition())
}
/// Internal definition-driven build; callers provide valid geometry within the
/// fixed map bounds and nonempty pillar orbits with turns dividing four.
pub fn fixed_layout_from(data: &FixedDefinition<'_>) -> FixedLayout {
    let n = W * H;
    let mut border = vec![0; n];
    for x in 0..W {
        border[x] = 1;
        border[(H - 1) * W + x] = 1;
    }
    for y in 0..H {
        border[y * W] = 1;
        border[y * W + W - 1] = 1;
    }
    let mut fp = vec![0; n];
    let (mut fx0, mut fy0, mut fx1, mut fy1) = (W as i32, H as i32, -1, -1);
    for y in 0..H as i32 {
        for x in 0..W as i32 {
            let ax = (f64::from(x) + 0.5 - f64::from(CX)).abs();
            let ay = (f64::from(y) + 0.5 - f64::from(CY)).abs();
            if ax <= data.half - 0.5 && ay <= data.half - 0.5 && ax + ay <= data.chamfer {
                fp[ix(x, y)] = 1;
                fx0 = fx0.min(x);
                fy0 = fy0.min(y);
                fx1 = fx1.max(x);
                fy1 = fy1.max(y);
            }
        }
    }
    let co_rect = TileRect {
        x: fx0,
        y: fy0,
        w: fx1 - fx0 + 1,
        h: fy1 - fy0 + 1,
    };
    let mut dist_fp = vec![255; n];
    let mut queue = Vec::with_capacity(n);
    for i in 0..n {
        if fp[i] != 0 {
            dist_fp[i] = 0;
            queue.push(i);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        let d = dist_fp[i];
        if d >= data.distance_cap {
            continue;
        }
        let (x, y) = ((i % W) as i32, (i / W) as i32);
        for oy in -1..=1 {
            for ox in -1..=1 {
                let (nx, ny) = (x + ox, y + oy);
                if nx < 0 || ny < 0 || nx >= W as i32 || ny >= H as i32 {
                    continue;
                }
                let j = ix(nx, ny);
                if dist_fp[j] == 255 {
                    dist_fp[j] = d + 1;
                    queue.push(j);
                }
            }
        }
    }
    let ring: Vec<u8> = (0..n)
        .map(|i| u8::from(fp[i] == 0 && dist_fp[i] <= data.ring_road))
        .collect();
    let mut wall_ring = vec![0; n];
    let mut co_floor = vec![0; n];
    for y in 0..H as i32 {
        for x in 0..W as i32 {
            let i = ix(x, y);
            if fp[i] == 0 {
                continue;
            }
            let mut edge = false;
            for oy in -1..=1 {
                for ox in -1..=1 {
                    let (nx, ny) = (x + ox, y + oy);
                    if nx < 0 || ny < 0 || nx >= W as i32 || ny >= H as i32 || fp[ix(nx, ny)] == 0 {
                        edge = true;
                    }
                }
            }
            if edge {
                wall_ring[i] = 1;
            } else {
                co_floor[i] = 1;
            }
        }
    }
    let mut gates = Vec::new();
    for side in [
        GateSide::North,
        GateSide::East,
        GateSide::South,
        GateSide::West,
    ] {
        let mut tiles = Vec::new();
        for j in 0..data.gate_width {
            let (x, y) = match side {
                GateSide::North => (CX - data.gate_width / 2 + j, co_rect.y),
                GateSide::South => (CX - data.gate_width / 2 + j, co_rect.y + co_rect.h - 1),
                GateSide::West => (co_rect.x, CY - data.gate_width / 2 + j),
                GateSide::East => (co_rect.x + co_rect.w - 1, CY - data.gate_width / 2 + j),
            };
            tiles.push(TilePt { x, y });
        }
        let (mut sx, mut sy) = (0.0, 0.0);
        for t in &tiles {
            sx += f64::from(t.x) * crate::constants::TILE + crate::constants::TILE / 2.0;
            sy += f64::from(t.y) * crate::constants::TILE + crate::constants::TILE / 2.0;
        }
        gates.push(GateDef {
            side,
            tiles,
            x: sx / f64::from(data.gate_width),
            y: sy / f64::from(data.gate_width),
        });
    }
    let mut lane_in = vec![0; n];
    let mut lane_out = Vec::new();
    for g in &gates {
        let (ox, oy) = match g.side {
            GateSide::North => (0, -1),
            GateSide::East => (1, 0),
            GateSide::South => (0, 1),
            GateSide::West => (-1, 0),
        };
        let along_x = matches!(g.side, GateSide::North | GateSide::South);
        let t0 = g.tiles[0];
        for d in 1..=data.lane_depth {
            for j in -data.lane_margin..data.gate_width + data.lane_margin {
                let (ax, ay) = if along_x { (j, 0) } else { (0, j) };
                lane_out.push(TilePt {
                    x: t0.x + ax + ox * d,
                    y: t0.y + ay + oy * d,
                });
                if (0..data.gate_width).contains(&j) {
                    lane_in[ix(t0.x + ax - ox * d, t0.y + ay - oy * d)] = 1;
                }
            }
        }
    }
    let mut inner_tiles = Vec::new();
    for j in 0..crate::constants::MAX_PLAYERS {
        let a =
            ((j as f64 + data.inner_spawn_phase) * TWO_PI) / crate::constants::MAX_PLAYERS as f64;
        inner_tiles.push(TilePt {
            x: (f64::from(CX) + data.inner_spawn_radius * det_cos(a)).floor() as i32,
            y: (f64::from(CY) + data.inner_spawn_radius * det_sin(a)).floor() as i32,
        });
    }
    let mut pillars = Vec::new();
    let shift = CX - data.pillar_source_center;
    for variant in 0..data.pillars.len() * 2 {
        let mut mask = vec![0; n];
        let PillarOrbit {
            turns,
            generators: gens,
        } = data.pillars[variant >> 1];
        for &(gx, gy) in gens {
            let mut p = if variant & 1 == 1 {
                TilePt {
                    x: gy + shift,
                    y: gx + shift,
                }
            } else {
                TilePt {
                    x: gx + shift,
                    y: gy + shift,
                }
            };
            for _ in 0..turns {
                if co_floor[ix(p.x, p.y)] != 0 {
                    mask[ix(p.x, p.y)] = 1;
                }
                for _ in 0..4 / turns {
                    p = TilePt {
                        x: CX + CY - 1 - p.y,
                        y: p.x - CX + CY,
                    };
                }
            }
        }
        pillars.push(mask);
    }
    let mut painted_mask = vec![0; n];
    let mut painted = Vec::new();
    let mut ring_tiles = Vec::new();
    for i in 0..n {
        if border[i] == 0 && fp[i] == 0 {
            painted_mask[i] = 1;
            painted.push(i);
        }
        if ring[i] != 0 {
            ring_tiles.push(i);
        }
    }
    FixedLayout {
        border,
        fp,
        dist_fp,
        ring,
        wall_ring,
        co_floor,
        co_rect,
        gates,
        lane_in,
        lane_out,
        inner_tiles,
        pillars,
        painted,
        painted_mask,
        ring_tiles,
    }
}
