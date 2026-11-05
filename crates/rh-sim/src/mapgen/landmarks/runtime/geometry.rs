use super::*;
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FloatTilePoint {
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ZoneInfo {
    pub index: u8,
    pub faction: Zone,
    pub painted: usize,
    pub floor: usize,
    pub bbox: TileRect,
    pub pole: TilePt,
    pub centroid: FloatTilePoint,
    pub axis: FloatTilePoint,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CampInfo {
    pub x: i32,
    pub y: i32,
    pub r: f64,
    pub territory: u8,
    pub elite: bool,
    pub index: usize,
}
#[derive(Clone, Debug)]
pub struct ZoneGeometry {
    pub(super) w: usize,
    pub(super) h: usize,
    pub info: ZoneInfo,
    pub mask: Vec<u8>,
    pub edge_dist: Vec<i32>,
    pub camps: Vec<CampInfo>,
}
impl ZoneGeometry {
    pub fn new(
        index: u8,
        faction: Zone,
        zone: &[u8],
        tiles: &[u8],
        w: usize,
        h: usize,
        camps: &[StyleCamp],
    ) -> Self {
        assert!(
            index > 0
                && w > 0
                && h > 0
                && w.checked_mul(h) == Some(zone.len())
                && tiles.len() == zone.len()
        );
        assert!(
            zone.len() <= i32::MAX as usize
                && camps.iter().all(|c| c.site < zone.len() && c.r.is_finite())
        );
        let mask: Vec<u8> = zone.iter().map(|&z| u8::from(z == index)).collect();
        let edge_dist = chamfer(&mask, w, h);
        let info = zone_info(index, faction, &mask, tiles, &edge_dist, w, h);
        let camps = camps
            .iter()
            .enumerate()
            .filter(|(_, c)| mask[c.site] == 1)
            .map(|(index, c)| CampInfo {
                x: (c.site % w) as i32,
                y: (c.site / w) as i32,
                r: c.r,
                territory: c.territory,
                elite: c.elite,
                index,
            })
            .collect();
        Self {
            w,
            h,
            info,
            mask,
            edge_dist,
            camps,
        }
    }
}
/// Actual size-free kit.ts 3/4 transform. These weights encode thirds of a tile; M2's 5/7 transform is different.
pub fn chamfer(mask: &[u8], w: usize, h: usize) -> Vec<i32> {
    assert!(w > 0 && h > 0 && w.checked_mul(h) == Some(mask.len()));
    let mut d: Vec<i32> = mask
        .iter()
        .map(|&v| if v != 0 { 1 << 20 } else { 0 })
        .collect();
    for x in 0..w {
        if d[x] != 0 {
            d[x] = 3;
        }
        let i = (h - 1) * w + x;
        if d[i] != 0 {
            d[i] = 3;
        }
    }
    for y in 0..h {
        let i = y * w;
        if d[i] != 0 {
            d[i] = 3;
        }
        let i = y * w + w - 1;
        if d[i] != 0 {
            d[i] = 3;
        }
    }
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if d[i] == 0 {
                continue;
            }
            let mut v = d[i];
            if x > 0 {
                v = v.min(d[i - 1] + 3);
            }
            if y > 0 {
                v = v.min(d[i - w] + 3);
            }
            if x > 0 && y > 0 {
                v = v.min(d[i - w - 1] + 4);
            }
            if x + 1 < w && y > 0 {
                v = v.min(d[i - w + 1] + 4);
            }
            d[i] = v;
        }
    }
    for y in (0..h).rev() {
        for x in (0..w).rev() {
            let i = y * w + x;
            if d[i] == 0 {
                continue;
            }
            let mut v = d[i];
            if x + 1 < w {
                v = v.min(d[i + 1] + 3);
            }
            if y + 1 < h {
                v = v.min(d[i + w] + 3);
            }
            if x + 1 < w && y + 1 < h {
                v = v.min(d[i + w + 1] + 4);
            }
            if x > 0 && y + 1 < h {
                v = v.min(d[i + w - 1] + 4);
            }
            d[i] = v;
        }
    }
    d
}
fn zone_info(
    index: u8,
    faction: Zone,
    mask: &[u8],
    tiles: &[u8],
    edge: &[i32],
    w: usize,
    h: usize,
) -> ZoneInfo {
    let (mut painted, mut floor, mut x0, mut y0, mut x1, mut y1) = (0, 0, w, h, 0, 0);
    let (mut sx, mut sy, mut deepest, mut deepest_d) = (0.0, 0.0, 0, -1);
    for i in 0..mask.len() {
        if mask[i] == 0 {
            continue;
        }
        let (x, y) = (i % w, i / w);
        painted += 1;
        if tiles[i] == TILE_FLOOR {
            floor += 1;
        }
        x0 = x0.min(x);
        y0 = y0.min(y);
        x1 = x1.max(x);
        y1 = y1.max(y);
        sx += x as f64 + 0.5;
        sy += y as f64 + 0.5;
        if edge[i] > deepest_d {
            deepest_d = edge[i];
            deepest = i;
        }
    }
    if painted == 0 {
        return ZoneInfo {
            index,
            faction,
            painted: 0,
            floor: 0,
            bbox: TileRect {
                x: 0,
                y: 0,
                w: 0,
                h: 0,
            },
            pole: TilePt { x: 0, y: 0 },
            centroid: FloatTilePoint { x: 0.0, y: 0.0 },
            axis: FloatTilePoint { x: 1.0, y: 0.0 },
        };
    }
    let cx = sx / painted as f64;
    let cy = sy / painted as f64;
    let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
    for (i, &v) in mask.iter().enumerate() {
        if v == 0 {
            continue;
        }
        let dx = (i % w) as f64 + 0.5 - cx;
        let dy = (i / w) as f64 + 0.5 - cy;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    let half = (sxx - syy) / 2.0;
    let lambda = (sxx + syy) / 2.0 + (half * half + sxy * sxy).sqrt();
    let (mut ax, mut ay) = (sxy, lambda - sxx);
    if ax == 0.0 && ay == 0.0 {
        ax = if sxx >= syy { 1.0 } else { 0.0 };
        ay = if sxx >= syy { 0.0 } else { 1.0 };
    }
    let len = (ax * ax + ay * ay).sqrt();
    ax /= len;
    ay /= len;
    if ax < 0.0 || (ax == 0.0 && ay < 0.0) {
        ax = -ax;
        ay = -ay;
    }
    ZoneInfo {
        index,
        faction,
        painted,
        floor,
        bbox: TileRect {
            x: x0 as i32,
            y: y0 as i32,
            w: (x1 - x0 + 1) as u32,
            h: (y1 - y0 + 1) as u32,
        },
        pole: TilePt {
            x: (deepest % w) as i32,
            y: (deepest / w) as i32,
        },
        centroid: FloatTilePoint { x: cx, y: cy },
        axis: FloatTilePoint { x: ax, y: ay },
    }
}
