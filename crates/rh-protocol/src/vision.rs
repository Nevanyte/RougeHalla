//! The vision rule's parameters a Welcome carries (protocol 16). The client's fog of war mirrors the Rust sight rule
//! (`rh_sim::vision`); it reads these values from the server instead of keeping a hand-mirrored copy that can drift. All
//! of them are public facts (build constants and public map metadata), so they raise no C-OBS concern.
//!
//! Wire layout, right after the archetype table and before the map: `version u8` (the vision-rules version, 1 today; 0 is
//! refused), `tile f64` (sim units per tile), `radius f64` (sim units), `trail_ms f64`, `update_ms f64`, `sight_mask u8`
//! (the tile-class bits that block sight), `coliseum u8` (0 absent, 1 present) and, when present, the coliseum rectangle
//! the rule reveals in tiles: `x u16, y u16, w u16, h u16`. A decoder refuses a non-finite or out-of-range number, a zero
//! mask, a flag other than 0 or 1, an empty rectangle, or one that does not lie inside the Welcome's map.

use crate::codec::{Reader, Writer};
use crate::DecodeError;

/// The vision-rules version this build sends. Bump it when the rule the parameters feed changes meaning.
pub const VISION_RULES_VERSION: u8 = 1;
/// Encoded size without and with the coliseum rectangle.
pub const VISION_BLOCK_LEN: usize = 1 + 8 * 4 + 1 + 1;
pub const VISION_BLOCK_MAX_LEN: usize = VISION_BLOCK_LEN + 8;

/// A rectangle of whole tiles (`x`, `y` its north-west tile, `w` by `h` tiles).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WireRect {
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireVision {
    pub version: u8,
    /// Sim units per tile.
    pub tile: f64,
    /// Sight radius, sim units.
    pub radius: f64,
    /// How long a seen tile stays remembered, ms.
    pub trail_ms: f64,
    /// How often the sight memory is refreshed, ms.
    pub update_ms: f64,
    /// The tile-class bits that block sight (a tile blocks when `class & sight_mask != 0`).
    pub sight_mask: u8,
    /// The rectangle standing in the coliseum reveals, when the map has one.
    pub coliseum: Option<WireRect>,
}

impl Default for WireVision {
    /// A valid block (the values of the rule version 1, no coliseum), for messages built in tests.
    fn default() -> Self {
        WireVision {
            version: VISION_RULES_VERSION,
            tile: 32.0,
            radius: 900.0,
            trail_ms: 30_000.0,
            update_ms: 100.0,
            sight_mask: 0b01,
            coliseum: None,
        }
    }
}

impl WireVision {
    /// The first reason a decoder would refuse this block on its own (the rectangle against the map is checked by
    /// [`WireVision::fits`]).
    pub fn fault(&self) -> Option<&'static str> {
        let within = |v: f64, lo: f64, hi: f64, open_lo: bool| {
            v.is_finite() && v <= hi && if open_lo { v > lo } else { v >= lo }
        };
        let ok = self.version != 0
            && within(self.tile, 0.0, 1024.0, true)
            && within(self.radius, 0.0, 1.0e6, true)
            && within(self.trail_ms, 0.0, 1.0e9, false)
            && within(self.update_ms, 0.0, 1.0e6, true)
            && self.sight_mask != 0
            && self.coliseum.is_none_or(|r| r.w > 0 && r.h > 0);
        (!ok).then_some("vision")
    }

    /// Does the coliseum rectangle lie inside a map of `w` x `h` tiles?
    pub fn fits(&self, w: u16, h: u16) -> bool {
        self.coliseum.is_none_or(|r| {
            u32::from(r.x) + u32::from(r.w) <= u32::from(w)
                && u32::from(r.y) + u32::from(r.h) <= u32::from(h)
        })
    }

    pub fn encoded_len(&self) -> usize {
        if self.coliseum.is_some() {
            VISION_BLOCK_MAX_LEN
        } else {
            VISION_BLOCK_LEN
        }
    }

    pub(crate) fn write(&self, w: &mut Writer) {
        w.u8(self.version);
        w.f64(self.tile);
        w.f64(self.radius);
        w.f64(self.trail_ms);
        w.f64(self.update_ms);
        w.u8(self.sight_mask);
        match self.coliseum {
            None => w.u8(0),
            Some(r) => {
                w.u8(1);
                w.u16(r.x);
                w.u16(r.y);
                w.u16(r.w);
                w.u16(r.h);
            }
        }
    }

    pub(crate) fn read(r: &mut Reader) -> Result<Self, DecodeError> {
        let version = r.u8()?;
        let tile = r.f64()?;
        let radius = r.f64()?;
        let trail_ms = r.f64()?;
        let update_ms = r.f64()?;
        let sight_mask = r.u8()?;
        let coliseum = match r.u8()? {
            0 => None,
            1 => Some(WireRect {
                x: r.u16()?,
                y: r.u16()?,
                w: r.u16()?,
                h: r.u16()?,
            }),
            _ => return Err(DecodeError::BadField("vision")),
        };
        let v = WireVision {
            version,
            tile,
            radius,
            trail_ms,
            update_ms,
            sight_mask,
            coliseum,
        };
        match v.fault() {
            Some(why) => Err(DecodeError::BadField(why)),
            None => Ok(v),
        }
    }
}

/// Writes a vision block without checking it (for decoder refusal tests).
pub fn write_vision_for_tests(w: &mut Writer, v: &WireVision) {
    v.write(w);
}
