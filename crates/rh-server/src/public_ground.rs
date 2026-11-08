//! Cold public map projection. Only canonical collision, terrain and region cells cross this seam.
//! Match effect mode is deliberately separate from the arena-only encoded asset cache.

use rh_protocol::codec::EncodeError;
use rh_protocol::map::EncodedMap;
use rh_protocol::GroundMode;
use rh_sim::{terrain::Mode, TileMap};

fn dimensions(map: &TileMap) -> Result<(u16, u16), EncodeError> {
    if map
        .layers()
        .is_some_and(|layers| layers.dimensions() != (map.w, map.h))
    {
        return Err(EncodeError::BadMap("ground dimensions"));
    }
    Ok((
        u16::try_from(map.w).map_err(|_| EncodeError::BadMap("size"))?,
        u16::try_from(map.h).map_err(|_| EncodeError::BadMap("size"))?,
    ))
}

fn planes(map: &TileMap) -> (Option<&[u8]>, Option<&[u8]>) {
    match map.layers() {
        Some(layers) => (
            Some(layers.data().terrain.as_slice()),
            Some(layers.data().region_grid.as_slice()),
        ),
        None => (None, None),
    }
}

/// Validate borrowed canonical data before allocating the once-encoded static bytes.
pub fn encode_static_map(map: &TileMap) -> Result<EncodedMap, EncodeError> {
    let (w, h) = dimensions(map)?;
    let (terrain, regions) = planes(map);
    EncodedMap::from_slices(w, h, &map.tiles, terrain, regions)
}

/// A cache key is only a lookup aid. Reuse requires the complete canonical public content to match.
pub fn matches_static_map(encoded: &EncodedMap, map: &TileMap) -> bool {
    let Ok((w, h)) = dimensions(map) else {
        return false;
    };
    let (terrain, regions) = planes(map);
    encoded.matches_slices(w, h, &map.tiles, terrain, regions)
}

/// Publish the actual simulation configuration, without changing or interpreting terrain rules.
pub fn mode(mode: Mode) -> GroundMode {
    match mode {
        Mode::Off => GroundMode::Off,
        Mode::Map => GroundMode::Map,
        Mode::All => GroundMode::All,
    }
}
