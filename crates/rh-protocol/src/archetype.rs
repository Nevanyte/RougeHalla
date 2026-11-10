//! The hitbox archetype table a Welcome carries (protocol 16, ADR0024). Clients size and draw actors, and predict their own
//! foot box, from this table: it reaches Unity from the server's Rust source, never as a hand-kept copy.
//!
//! Wire layout, between the Welcome header and the map: `count u8`, then per row `id u8, key str, hull u8` followed by
//! `r u8` (hull 0, the legacy circle) or `fx u8, fy u8, bx u8, by u8, ox i8, oy i8` (hull 1, foot and body boxes), then
//! `chest u8`. Ids strictly ascend; a decoder refuses anything else.

use crate::codec::{str_len, Reader, Writer};
use crate::DecodeError;

/// Most rows a table may carry.
pub const MAX_ARCHETYPES: usize = 32;
/// Longest key (an appearance key of the client catalog).
pub const MAX_ARCHETYPE_KEY: usize = 24;
/// Largest encoded table.
pub const MAX_ARCHETYPE_TABLE_LEN: usize = 1 + MAX_ARCHETYPES * (1 + 1 + MAX_ARCHETYPE_KEY + 1 + 6 + 1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WireHull {
    /// The legacy disc of radius `r` (walls and hits).
    Circle { r: u8 },
    /// Foot box half-extents (`fx`, `fy`) centred on the feet; body box half-extents (`bx`, `by`) centred at the feet plus
    /// (`ox`, `oy`) (north is -y).
    Boxes {
        fx: u8,
        fy: u8,
        bx: u8,
        by: u8,
        ox: i8,
        oy: i8,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WireArchetype {
    pub id: u8,
    pub key: String,
    pub hull: WireHull,
    /// Height above the feet that projectiles fly at and melee is measured from.
    pub chest: u8,
}

impl WireArchetype {
    fn len(&self) -> usize {
        1 + str_len(&self.key)
            + 1
            + match self.hull {
                WireHull::Circle { .. } => 1,
                WireHull::Boxes { .. } => 6,
            }
            + 1
    }
    fn valid(&self) -> bool {
        !self.key.is_empty()
            && self.key.len() <= MAX_ARCHETYPE_KEY
            && self.key.bytes().all(|b| b.is_ascii_graphic())
            && match self.hull {
                WireHull::Circle { r } => r > 0,
                WireHull::Boxes { fx, fy, bx, by, .. } => fx > 0 && fy > 0 && bx > 0 && by > 0,
            }
    }
}

/// The first reason a decoder would refuse this table.
pub fn table_fault(rows: &[WireArchetype]) -> Option<&'static str> {
    if rows.len() > MAX_ARCHETYPES {
        return Some("archetype count");
    }
    if !rows.iter().all(WireArchetype::valid) {
        return Some("archetype");
    }
    if rows.windows(2).any(|w| w[1].id <= w[0].id) {
        return Some("archetype order");
    }
    None
}

/// Encoded size of the table.
pub fn table_len(rows: &[WireArchetype]) -> usize {
    1 + rows.iter().map(WireArchetype::len).sum::<usize>()
}

pub(crate) fn write_table(w: &mut Writer, rows: &[WireArchetype]) {
    w.u8(rows.len() as u8);
    for a in rows {
        w.u8(a.id);
        w.str(&a.key);
        match a.hull {
            WireHull::Circle { r } => {
                w.u8(0);
                w.u8(r);
            }
            WireHull::Boxes {
                fx,
                fy,
                bx,
                by,
                ox,
                oy,
            } => {
                w.u8(1);
                for v in [fx, fy, bx, by, ox as u8, oy as u8] {
                    w.u8(v);
                }
            }
        }
        w.u8(a.chest);
    }
}

pub(crate) fn read_table(r: &mut Reader) -> Result<Vec<WireArchetype>, DecodeError> {
    let n = r.u8()? as usize;
    if n > MAX_ARCHETYPES {
        return Err(DecodeError::BadField("archetype count"));
    }
    let mut rows = Vec::with_capacity(n);
    for _ in 0..n {
        let id = r.u8()?;
        let key = r.str()?;
        let hull = match r.u8()? {
            0 => WireHull::Circle { r: r.u8()? },
            1 => WireHull::Boxes {
                fx: r.u8()?,
                fy: r.u8()?,
                bx: r.u8()?,
                by: r.u8()?,
                ox: r.u8()? as i8,
                oy: r.u8()? as i8,
            },
            _ => return Err(DecodeError::BadField("archetype hull")),
        };
        let chest = r.u8()?;
        rows.push(WireArchetype {
            id,
            key,
            hull,
            chest,
        });
    }
    match table_fault(&rows) {
        Some(why) => Err(DecodeError::BadField(why)),
        None => Ok(rows),
    }
}
