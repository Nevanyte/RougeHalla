//! Deployed barriers (P-FROST-WALL-1; unreleased legacy 78dd8bd4 `packages/shared/src/barriers.ts`): a barrier is a set
//! of map tiles that, while it stands, is LOW ground (`TILE_LOW`: it stops bodies and melee swings, not sight or shots).
//! The tiles are decided once, when the cast lands, and kept beside the wall's field (`AbilityRuntime::barriers`,
//! serialized and hashed); the collision map the body, swing and path queries read is the arena's with those tiles LOW
//! ([`Overlay`], derived, rebuilt by [`sync`] whenever a wall rises or falls and after a restore).
//!
//! Pure geometry first ([`wall_segment_for`], [`wall_cells`]), then the runtime rows and the overlay. Only a world whose
//! `SimConfig::frost_wish` is `Wall` ever holds a barrier (`check`).
use crate::{
    constants::TILE,
    map::{TileMap, TILE_FLOOR},
    state::World,
    statics::MatchStatic,
    Vec2,
};
use std::sync::Arc;

/// A tile is under a wall when its centre is this close to the wall's line (legacy `WALL_CELL_REACH`): one tile thick
/// along an axis, a closed staircase on a diagonal.
pub const WALL_CELL_REACH: f64 = TILE * 0.75;
/// A tile past a wall's end is under it only within this much (legacy `WALL_END_SLACK`).
pub const WALL_END_SLACK: f64 = TILE / 4.;

/// A wall's line (legacy `WallSegment`): its centre (the clamped aim point) and its two ends, square to the line from
/// the caster.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WallSegment {
    pub cx: f64,
    pub cy: f64,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

/// Where a wall aimed from `from` at `cursor` stands (legacy `wallSegmentFor`): centred on the cursor clamped to
/// `range` (no closer than `min_range`), across the line from the caster, `length` long. A cursor on the caster aims
/// along `facing`.
pub fn wall_segment_for(
    from: Vec2,
    cursor: Vec2,
    range: f64,
    min_range: f64,
    length: f64,
    facing: f64,
) -> WallSegment {
    let _ = (from, cursor, range, min_range, length, facing);
    WallSegment {
        cx: 0.,
        cy: 0.,
        x1: 0.,
        y1: 0.,
        x2: 0.,
        y2: 0.,
    }
}

/// The FLOOR tiles of `map` under the wall (legacy `wallCells`), as row-major indices in ascending order, written to
/// `out` (cleared first): a tile centre within [`WALL_CELL_REACH`] of the wall's line and no further than
/// [`WALL_END_SLACK`] past either end along it.
pub fn wall_cells(map: &TileMap, seg: &WallSegment, out: &mut Vec<u32>) {
    let _ = (map, seg);
    out.clear();
}

/// One standing barrier: the wall field it belongs to and its tiles (ascending row-major indices, FLOOR on the open map).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Barrier {
    pub(crate) field: u32,
    pub(crate) cells: Vec<u32>,
}

/// The standing barriers, in field order. An empty row (every `FrostWish::Freeze` world, and a `Wall` world with no wall
/// up) serializes as a unit: JSON `null`, and no word for the state hasher, so every world without a wall hashes and
/// checkpoints as it did before the field existed. It is safe for the reason `MobRuntime::buffs` is (`hash.rs`): the
/// row is non-empty exactly when the field list written before it holds a `Wall` field (`check`), so the untagged empty
/// form cannot be confused with a written one.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Barriers(pub(crate) Vec<Barrier>);

impl serde::Serialize for Barriers {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        if self.0.is_empty() {
            s.serialize_unit()
        } else {
            self.0.serialize(s)
        }
    }
}

impl<'de> serde::Deserialize<'de> for Barriers {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match Option::<Vec<Barrier>>::deserialize(d)? {
            None => Ok(Self::default()),
            // The one written form of an empty row is the unit: refuse a second spelling of the same state.
            Some(v) if v.is_empty() => Err(serde::de::Error::custom(
                "an empty barrier row is written as null",
            )),
            Some(v) => Ok(Self(v)),
        }
    }
}

/// The collision map with the standing barriers' tiles LOW (legacy `collisionMap`'s `withBarriers` overlay), keyed by
/// the gate state and the wall fields it was built from. Derived: never serialized, rebuilt by [`sync`]; equality
/// ignores it (it is a function of serialized state and the statics).
#[derive(Clone, Debug, Default)]
pub struct Overlay(pub(crate) Option<Arc<OverlayMap>>);

impl PartialEq for Overlay {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}

#[derive(Debug)]
pub struct OverlayMap {
    pub(crate) locked: bool,
    pub(crate) fields: Vec<u32>,
    pub(crate) map: TileMap,
}

/// Rebuilds the overlay when the standing walls or the gate state changed since it was built; drops it when no wall
/// stands. Allocation-free when nothing changed.
pub(crate) fn sync(k: &MatchStatic, w: &mut World) {
    let _ = (k, w);
}

/// The overlay to read this step, held by an `Arc` clone so the caller may mutate the world while it reads the map.
pub(crate) fn held(w: &World) -> Option<Arc<OverlayMap>> {
    w.abilities.as_ref().and_then(|a| a.overlay.0.clone())
}

/// The map bodies, swings and paths read: the overlay while a wall stands, else the arena's (gates as they are).
pub(crate) fn body_map<'a>(
    k: &'a MatchStatic,
    held: &'a Option<Arc<OverlayMap>>,
    locked: bool,
) -> &'a TileMap {
    match held {
        Some(o) => &o.map,
        None => k.collision_map(locked),
    }
}

/// `check_world`'s barrier rules.
pub(crate) fn check(k: &MatchStatic, w: &World) -> Result<(), String> {
    let _ = (k, w);
    Ok(())
}

/// Removes a fallen wall's barrier row.
pub(crate) fn forget(a: &mut crate::status_runtime::AbilityRuntime, field: u32) {
    a.barriers.0.retain(|b| b.field != field);
}

#[cfg(test)]
#[path = "barriers_tests.rs"]
mod tests;
