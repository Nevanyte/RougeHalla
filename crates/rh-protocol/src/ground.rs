//! Public map extension wire primitives: ground planes (protocol 14) and the public sections (protocol 17).

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

/// Map extension layout version. Protocol 17 is version 2 (public sections); version 1 is refused.
pub(crate) const SECTION_VERSION: u8 = 2;
/// P-WIRE17-MAP-2: version 3 is version 2 plus a second presence byte after the first. A map carries version 3 exactly
/// when a second-presence section is present (one encoding per map: no such section means version 2).
pub(crate) const SECTION_VERSION_PRESENCE2: u8 = 3;
/// Second presence byte (version 3): the camp patience plane.
pub(crate) const PRESENCE2_PATIENCE: u8 = 0x01;
/// Second presence byte (version 3): the landmark anchors (P-WIRE17-MAP-3). STUB: not accepted by `PRESENCE2_KNOWN` yet.
#[allow(dead_code)]
pub(crate) const PRESENCE2_ANCHORS: u8 = 0x02;
/// Every second-presence bit a decoder accepts.
pub(crate) const PRESENCE2_KNOWN: u8 = 0x01;
pub(crate) const PRESENCE_TERRAIN: u8 = 0x01;
pub(crate) const PRESENCE_REGIONS: u8 = 0x02;
pub(crate) const PRESENCE_CAMPS: u8 = 0x04;
pub(crate) const PRESENCE_COLISEUM: u8 = 0x08;
pub(crate) const PRESENCE_BUSHES: u8 = 0x10;
pub(crate) const PRESENCE_PROPS: u8 = 0x20;
pub(crate) const PRESENCE_GROUND_VARIANTS: u8 = 0x40;
/// Every presence bit a decoder accepts.
pub(crate) const PRESENCE_KNOWN: u8 = 0x7f;
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
    semantic_hash_parts(w, h, presence, [terrain, regions].into_iter().flatten())
}

/// FNV-1a 32 over the domain, `w u32`, `h u32`, `[section version, presence]`, then each part in wire order: a plane's
/// decoded cells, a list section's wire bytes (count included).
pub(crate) fn semantic_hash_parts<'a>(
    w: u16,
    h: u16,
    presence: u8,
    parts: impl IntoIterator<Item = &'a [u8]>,
) -> u32 {
    semantic_hash_parts2(w, h, presence, 0, parts)
}

/// The extension header the semantic hash covers (and the wire carries before the semantic hash): `[2, presence]`, or
/// `[3, presence, presence2]` when `presence2` is non-zero. Returns the bytes and how many of them are used.
pub(crate) fn section_header(presence: u8, presence2: u8) -> ([u8; 3], usize) {
    if presence2 == 0 {
        ([SECTION_VERSION, presence, 0], 2)
    } else {
        ([SECTION_VERSION_PRESENCE2, presence, presence2], 3)
    }
}

/// [`semantic_hash_parts`] with a second presence byte: the header is [`section_header`]'s.
pub(crate) fn semantic_hash_parts2<'a>(
    w: u16,
    h: u16,
    presence: u8,
    presence2: u8,
    parts: impl IntoIterator<Item = &'a [u8]>,
) -> u32 {
    let (header, len) = section_header(presence, presence2);
    fnv1a(
        SEMANTIC_DOMAIN
            .iter()
            .copied()
            .chain((w as u32).to_le_bytes())
            .chain((h as u32).to_le_bytes())
            .chain(header[..len].iter().copied())
            .chain(parts.into_iter().flatten().copied()),
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
