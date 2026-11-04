//! The canonical public map on the wire (docs/adr/0003-canonical-map.md): the server sends the collision layer it simulates
//! on, run-length encoded, with its FNV-1a identity. Clients never run a generator, so a client can never disagree with the
//! server about walls (the legacy design rebuilt the map from a seed in every client and checked a hash).
//!
//! The map never changes during a match, so the server can RLE-encode it once ([`MapBlob::pre_encode`]) and copy the
//! [`EncodedMap`] into every Welcome ([`crate::encode_welcome`]); the bytes are the ones [`MapBlob::write`] produces.

use crate::codec::{DecodeError, EncodeError, Reader, Writer};

/// Most tiles a decoder accepts (`w * h`).
pub const MAX_MAP_TILES: usize = 1024 * 1024;
/// `w u16, h u16, hash u32, runs u32`.
const MAP_HEAD_LEN: usize = 12;
/// `tile u8, length u16`.
const RUN_LEN: usize = 3;

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
    for b in w
        .to_le_bytes()
        .iter()
        .chain(h.to_le_bytes().iter())
        .chain(tiles.iter())
    {
        hsh ^= *b as u32;
        hsh = hsh.wrapping_mul(0x0100_0193);
    }
    hsh
}

/// The runs of `tiles`: maximal stretches of one tile class, split at `u16::MAX` (no allocation).
struct Runs<'a> {
    tiles: &'a [u8],
}

impl Iterator for Runs<'_> {
    type Item = (u8, u16);
    fn next(&mut self) -> Option<(u8, u16)> {
        let (&t, rest) = self.tiles.split_first()?;
        let max = rest.len().min(u16::MAX as usize - 1);
        let same = rest[..max].iter().take_while(|&&x| x == t).count();
        self.tiles = &rest[same..];
        Some((t, same as u16 + 1))
    }
}

impl MapBlob {
    pub fn new(w: u16, h: u16, tiles: Vec<u8>) -> Self {
        let layer_hash = layer_hash(w as u32, h as u32, &tiles);
        Self {
            w,
            h,
            tiles,
            layer_hash,
        }
    }

    fn runs(&self) -> Runs<'_> {
        Runs { tiles: &self.tiles }
    }

    /// Exact size of [`MapBlob::write`]'s output (one pass over the tiles, no allocation).
    pub fn encoded_len(&self) -> usize {
        MAP_HEAD_LEN + RUN_LEN * self.runs().count()
    }

    /// Whether [`MapBlob::read`] accepts what [`MapBlob::write`] produces for this map: the same checks, in the same
    /// order, with the same reasons.
    pub fn check(&self) -> Result<(), EncodeError> {
        let total = self.w as usize * self.h as usize;
        if self.w == 0 || self.h == 0 || total > MAX_MAP_TILES {
            return Err(EncodeError::BadMap("size"));
        }
        if self.tiles.iter().any(|&t| t > 2) {
            return Err(EncodeError::BadMap("run"));
        }
        if self.tiles.len() != total {
            return Err(EncodeError::BadMap("length"));
        }
        if layer_hash(self.w as u32, self.h as u32, &self.tiles) != self.layer_hash {
            return Err(EncodeError::BadMap("hash"));
        }
        Ok(())
    }

    /// `w u16, h u16, hash u32, runs u32, then runs x (tile u8, length u16)`.
    pub fn write(&self, w: &mut Writer) {
        w.u16(self.w);
        w.u16(self.h);
        w.u32(self.layer_hash);
        w.u32(self.runs().count() as u32);
        for (t, n) in self.runs() {
            w.u8(t);
            w.u16(n);
        }
    }

    /// RLE-encodes the map once (for a server that sends it in many Welcomes). Fails for a map decoders would reject.
    pub fn pre_encode(&self) -> Result<EncodedMap, EncodeError> {
        self.check()?;
        let mut w = Writer::with_capacity(self.encoded_len());
        self.write(&mut w);
        Ok(EncodedMap {
            w: self.w,
            h: self.h,
            layer_hash: self.layer_hash,
            body: w.finish().into_boxed_slice(),
        })
    }

    pub fn read(r: &mut Reader) -> Result<Self, DecodeError> {
        let w = r.u16()?;
        let h = r.u16()?;
        let hash = r.u32()?;
        let runs = r.u32()? as usize;
        let total = w as usize * h as usize;
        if w == 0 || h == 0 || total > MAX_MAP_TILES {
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
        Ok(Self {
            w,
            h,
            tiles,
            layer_hash: hash,
        })
    }
}

/// A [`MapBlob`] already in its wire form (made by [`MapBlob::pre_encode`], so it is known to decode). A Welcome copies
/// these bytes instead of run-length encoding the map again for every joining player.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncodedMap {
    w: u16,
    h: u16,
    layer_hash: u32,
    body: Box<[u8]>,
}

impl EncodedMap {
    /// The bytes [`MapBlob::write`] produces for the map.
    pub fn as_bytes(&self) -> &[u8] {
        &self.body
    }
    pub fn len(&self) -> usize {
        self.body.len()
    }
    pub fn is_empty(&self) -> bool {
        self.body.is_empty()
    }
    pub fn w(&self) -> u16 {
        self.w
    }
    pub fn h(&self) -> u16 {
        self.h
    }
    pub fn layer_hash(&self) -> u32 {
        self.layer_hash
    }
}
