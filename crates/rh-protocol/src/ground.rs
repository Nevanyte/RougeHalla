//! Version 14 public ground metadata wire primitives.

use crate::{DecodeError, EncodeError};

/// The room's actual terrain-effect mode, published as data. It is per-room and must not be cached by arena.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum GroundMode {
    #[default]
    Off = 0,
    Map = 1,
    All = 2,
}

impl GroundMode {
    pub fn from_code(value: u8) -> Result<Self, DecodeError> {
        match value {
            0 => Ok(Self::Off),
            1 => Ok(Self::Map),
            2 => Ok(Self::All),
            _ => Err(DecodeError::BadField("terrain mode")),
        }
    }
}

pub(crate) const SECTION_VERSION: u8 = 1;
pub(crate) const PRESENCE_TERRAIN: u8 = 1;
pub(crate) const PRESENCE_REGIONS: u8 = 2;
pub(crate) const SEMANTIC_DOMAIN: &[u8] = b"rh-ground/1\0";
pub(crate) const CONTEXT_DOMAIN: &[u8] = b"rh-map-context/1\0";

pub(crate) fn fnv1a(bytes: impl IntoIterator<Item = u8>) -> u32 {
    let mut hash = 0x811c_9dc5u32;
    for byte in bytes {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

pub(crate) fn semantic_hash(
    w: u16,
    h: u16,
    presence: u8,
    terrain: Option<&[u8]>,
    regions: Option<&[u8]>,
) -> u32 {
    fnv1a(
        SEMANTIC_DOMAIN
            .iter()
            .copied()
            .chain((w as u32).to_le_bytes())
            .chain((h as u32).to_le_bytes())
            .chain([SECTION_VERSION, presence])
            .chain(terrain.into_iter().flatten().copied())
            .chain(regions.into_iter().flatten().copied()),
    )
}

pub(crate) fn context_hash(collision_hash: u32, semantic_hash: u32, mode: GroundMode) -> u32 {
    fnv1a(
        CONTEXT_DOMAIN
            .iter()
            .copied()
            .chain(collision_hash.to_le_bytes())
            .chain(semantic_hash.to_le_bytes())
            .chain([mode as u8]),
    )
}

pub(crate) fn validate_plane_values(
    terrain: Option<&[u8]>,
    regions: Option<&[u8]>,
) -> Result<(), EncodeError> {
    if terrain.is_some_and(|values| values.iter().any(|&v| v > 7)) {
        return Err(EncodeError::BadMap("terrain value"));
    }
    if regions.is_some_and(|values| values.iter().any(|&v| v > 6)) {
        return Err(EncodeError::BadMap("region value"));
    }
    Ok(())
}
