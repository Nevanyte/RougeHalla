//! The weapon table a Welcome carries (protocol 16). Clients draw a weapon's true hit zone (a melee sector, a projectile's
//! reach) from this table: it reaches Unity from the server's Rust content (`rh_sim::content::weapon`), never as a
//! hand-kept copy. Every value is a public content constant, so the table raises no C-OBS concern.
//!
//! Wire layout, right after the vision block and before the map: `count u8`, then per row a fixed 34 bytes `id u8, kind u8,
//! reach f64, half_arc f64, speed f64, radius f64`. Ids strictly ascend. A decoder refuses more than [`MAX_WEAPONS`] rows
//! (before allocating), an unknown kind, a value that is not finite or lies outside `0..=1e6`, and a row whose values do not
//! fit its kind:
//!
//! * [`WEAPON_KIND_NONE`]: a weapon with no hit shape; all four values zero.
//! * [`WEAPON_KIND_ARC`]: a melee arc; `reach` > 0 (sim units), `0 < half_arc <= PI` (radians), `speed` and `radius` zero.
//! * [`WEAPON_KIND_PROJECTILE`]: `reach` > 0 is the maximum range (sim units), `speed` > 0 (sim units per second), `half_arc`
//!   zero, `radius` the projectile's body-contact radius (sim units, may be zero).

use crate::codec::{Reader, Writer};
use crate::DecodeError;

/// Most rows a table may carry.
pub const MAX_WEAPONS: usize = 32;
/// Encoded size of one row.
pub const WEAPON_ROW_LEN: usize = 1 + 1 + 8 * 4;
/// Largest encoded table.
pub const MAX_WEAPON_TABLE_LEN: usize = 1 + MAX_WEAPONS * WEAPON_ROW_LEN;
/// Largest value any field may hold.
pub const MAX_WEAPON_VALUE: f64 = 1.0e6;

/// Reserved: a weapon with no hit shape.
pub const WEAPON_KIND_NONE: u8 = 0;
/// A melee arc (`reach`, `half_arc`).
pub const WEAPON_KIND_ARC: u8 = 1;
/// A projectile (`reach` the range, `speed`, `radius` the body-contact radius).
pub const WEAPON_KIND_PROJECTILE: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireWeapon {
    /// The weapon's wire code (`rh_sim::WeaponId::code`).
    pub id: u8,
    /// [`WEAPON_KIND_NONE`], [`WEAPON_KIND_ARC`] or [`WEAPON_KIND_PROJECTILE`].
    pub kind: u8,
    /// Arc reach, or projectile range, in sim units.
    pub reach: f64,
    /// Half the arc's opening, radians (arcs only).
    pub half_arc: f64,
    /// Projectile speed, sim units per second (projectiles only).
    pub speed: f64,
    /// Projectile body-contact radius, sim units (projectiles only).
    pub radius: f64,
}

impl WireWeapon {
    fn values_ok(&self) -> bool {
        [self.reach, self.half_arc, self.speed, self.radius]
            .into_iter()
            .all(|v| v.is_finite() && (0.0..=MAX_WEAPON_VALUE).contains(&v))
    }

    fn valid(&self) -> bool {
        self.values_ok()
            && match self.kind {
                WEAPON_KIND_NONE => {
                    self.reach == 0.0
                        && self.half_arc == 0.0
                        && self.speed == 0.0
                        && self.radius == 0.0
                }
                WEAPON_KIND_ARC => {
                    self.reach > 0.0
                        && self.half_arc > 0.0
                        && self.half_arc <= std::f64::consts::PI
                        && self.speed == 0.0
                        && self.radius == 0.0
                }
                WEAPON_KIND_PROJECTILE => {
                    self.reach > 0.0 && self.speed > 0.0 && self.half_arc == 0.0
                }
                _ => false,
            }
    }
}

/// The first reason a decoder would refuse this table.
pub fn table_fault(rows: &[WireWeapon]) -> Option<&'static str> {
    if rows.len() > MAX_WEAPONS {
        return Some("weapon count");
    }
    if rows.iter().any(|w| w.kind > WEAPON_KIND_PROJECTILE) {
        return Some("weapon kind");
    }
    if !rows.iter().all(WireWeapon::valid) {
        return Some("weapon");
    }
    if rows.windows(2).any(|w| w[1].id <= w[0].id) {
        return Some("weapon order");
    }
    None
}

/// Encoded size of the table.
pub fn table_len(rows: &[WireWeapon]) -> usize {
    1 + rows.len() * WEAPON_ROW_LEN
}

pub(crate) fn write_table(w: &mut Writer, rows: &[WireWeapon]) {
    w.u8(rows.len() as u8);
    for row in rows {
        w.u8(row.id);
        w.u8(row.kind);
        w.f64(row.reach);
        w.f64(row.half_arc);
        w.f64(row.speed);
        w.f64(row.radius);
    }
}

pub(crate) fn read_table(r: &mut Reader) -> Result<Vec<WireWeapon>, DecodeError> {
    let n = r.u8()? as usize;
    if n > MAX_WEAPONS {
        return Err(DecodeError::BadField("weapon count"));
    }
    let mut rows = Vec::with_capacity(n);
    for _ in 0..n {
        let id = r.u8()?;
        let kind = r.u8()?;
        if kind > WEAPON_KIND_PROJECTILE {
            return Err(DecodeError::BadField("weapon kind"));
        }
        rows.push(WireWeapon {
            id,
            kind,
            reach: r.f64()?,
            half_arc: r.f64()?,
            speed: r.f64()?,
            radius: r.f64()?,
        });
    }
    match table_fault(&rows) {
        Some(why) => Err(DecodeError::BadField(why)),
        None => Ok(rows),
    }
}

/// Writes a weapon table without checking it (for decoder refusal tests).
pub fn write_weapon_table_for_tests(w: &mut Writer, rows: &[WireWeapon]) {
    write_table(w, rows);
}
