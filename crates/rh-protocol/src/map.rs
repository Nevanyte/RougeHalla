//! The canonical public map on the wire (docs/adr/0003-canonical-map.md): the server sends the collision layer it simulates
//! on, run-length encoded, with its FNV-1a identity. Clients never run a generator, so a client can never disagree with the
//! server about walls (the legacy design rebuilt the map from a seed in every client and checked a hash).

use crate::codec::{DecodeError, Reader, Writer};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapBlob {
    pub w: u16,
    pub h: u16,
    /// Tile classes, row-major: 0 floor, 1 wall, 2 low.
    pub tiles: Vec<u8>,
    /// FNV-1a 32 over (w u32 LE, h u32 LE, tiles): `rh_sim::TileMap::layer_hash`.
    pub layer_hash: u32,
}

/// Same hash as `rh_sim::map::TileMap::layer_hash` (kept here so the protocol crate stands alone; a test pins both).
pub fn layer_hash(w: u32, h: u32, tiles: &[u8]) -> u32 {
    let mut hsh: u32 = 0x811c_9dc5;
    for b in w.to_le_bytes().iter().chain(h.to_le_bytes().iter()).chain(tiles.iter()) {
        hsh ^= *b as u32;
        hsh = hsh.wrapping_mul(0x0100_0193);
    }
    hsh
}

impl MapBlob {
    pub fn new(w: u16, h: u16, tiles: Vec<u8>) -> Self {
        let layer_hash = layer_hash(w as u32, h as u32, &tiles);
        Self { w, h, tiles, layer_hash }
    }

    /// `w u16, h u16, hash u32, runs u32, then runs x (tile u8, length u16)`.
    pub fn write(&self, w: &mut Writer) {
        w.u16(self.w);
        w.u16(self.h);
        w.u32(self.layer_hash);
        let mut runs: Vec<(u8, u16)> = Vec::new();
        for &t in &self.tiles {
            match runs.last_mut() {
                Some((v, n)) if *v == t && *n < u16::MAX => *n += 1,
                _ => runs.push((t, 1)),
            }
        }
        w.u32(runs.len() as u32);
        for (t, n) in runs {
            w.u8(t);
            w.u16(n);
        }
    }

    pub fn read(r: &mut Reader) -> Result<Self, DecodeError> {
        let w = r.u16()?;
        let h = r.u16()?;
        let hash = r.u32()?;
        let runs = r.u32()? as usize;
        let total = w as usize * h as usize;
        if w == 0 || h == 0 || total > 1024 * 1024 {
            return Err(DecodeError::BadMap("size"));
        }
        let mut tiles = Vec::with_capacity(total);
        for _ in 0..runs {
            let t = r.u8()?;
            let n = r.u16()? as usize;
            if t > 2 || n == 0 || tiles.len() + n > total {
                return Err(DecodeError::BadMap("run"));
            }
            tiles.resize(tiles.len() + n, t);
        }
        if tiles.len() != total {
            return Err(DecodeError::BadMap("length"));
        }
        if layer_hash(w as u32, h as u32, &tiles) != hash {
            return Err(DecodeError::BadMap("hash"));
        }
        Ok(Self { w, h, tiles, layer_hash: hash })
    }
}
