//! Private native equivalent of source `packages/server/src/bots/brain/vision.ts`
//! `BotVision` (`update`, `canSee`, `filter`). Inactive: no live dispatch, public
//! transport, observation, identity or World/Sim lookup. Sight derives only from the
//! seat's own declared position, its own reconnect trail message, its own camp wards
//! and the immutable public map, exactly as the source does. This is a declared-method
//! component; it never attests that an unpublished fact was delivered to a seat.
use super::data::{MethodValue, Object};
use super::input::Percept;
use super::Error;
use declared::{restored_cell, snapshot_cells, truthy, UpdateInput};
use grid::{Geometry, Grid, Sight};
use rh_sim::constants::{BUSH_REVEAL_RADIUS, VISION_RADIUS};
use rh_sim::map::TILE_WALL;
use rh_sim::mapdata::MapLayers;
use rh_sim::{TileMap, Vec2};

#[cfg(test)]
mod adapter;
pub(crate) mod declared;
pub(crate) mod grid;
#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod tests;

/// One owned camp ward: a separate grid scanned once from the camp site with
/// `ttl = end - now` at creation, plus the exact source `end` and map identity.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Ward {
    pub(crate) memory: Grid,
    pub(crate) end: f64,
    pub(crate) map: Sight,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct BotVision {
    open: TileMap,
    /// Source `withGates(map)`: every gate tile turned to wall.
    locked: TileMap,
    memory: Grid,
    /// Map insertion order by original camp index (source `Map<number, Ward>`).
    wards: Vec<(usize, Ward)>,
    enabled: bool,
    now: f64,
    /// Map insertion order (source `Map<string, number>`).
    bush_reveal: Vec<(String, f64)>,
}

impl BotVision {
    /// Source `new BotVision(map)`: `map` is the room's open-gate map with its public layers.
    pub(crate) fn new(map: TileMap) -> Result<Self, Error> {
        let layers = map.layers().ok_or(Error::Missing("map layers"))?;
        let mut tiles = map.tiles.clone();
        for gate in &layers.coliseum().gates {
            for at in &gate.tiles {
                // Layer admission already checked every gate tile against the grid.
                let index = usize::try_from(at.y)
                    .ok()
                    .zip(usize::try_from(at.x).ok())
                    .map(|(y, x)| y * map.w as usize + x)
                    .filter(|&i| i < tiles.len())
                    .ok_or(Error::Shape("gate tile"))?;
                tiles[index] = TILE_WALL;
            }
        }
        let locked = TileMap::new(map.w, map.h, tiles).map_err(|_| Error::Shape("locked map"))?;
        let memory = Grid::new(map.w as usize, map.h as usize);
        Ok(Self {
            open: map,
            locked,
            memory,
            wards: Vec::new(),
            enabled: false,
            now: 0.,
            bush_reveal: Vec::new(),
        })
    }

    fn layers(&self) -> &MapLayers {
        self.open.layers().expect("constructor requires layers")
    }
    /// Source `update(input, selfId)`. An active update first plans every leaf it reads;
    /// a refusal leaves this component unchanged (the source would throw mid-update).
    pub(crate) fn update(&mut self, input: &UpdateInput, self_id: &str) -> Result<(), Error> {
        let now = input.server_time;
        if !(input.phase_active && !input.training) {
            self.now = now;
            self.enabled = false;
            self.memory.clear();
            self.wards.clear();
            return Ok(());
        }
        let layers = self.open.layers().ok_or(Error::Missing("map layers"))?;
        let plan = input.plan(self_id, layers.data().camps.len())?;
        self.now = now;
        self.enabled = true;
        let (seed, w, h) = (
            layers.data().seed as f64,
            f64::from(self.open.w),
            f64::from(self.open.h),
        );
        // A reconnect may restore only this seat's own private trail. Each accepted
        // snapshot clears first, so the last accepted one wins entirely.
        let len = self.memory.len();
        let mut restored = None;
        for msg in &plan.snapshots {
            if let Some(cells) = snapshot_cells(msg, seed, w, h) {
                restored = Some(
                    cells
                        .iter()
                        .filter_map(|cell| restored_cell(cell, len, now))
                        .collect::<Vec<_>>(),
                );
            }
        }
        if let Some(cells) = restored {
            self.memory.clear();
            for (index, expiry) in cells {
                self.memory.expires_at[index] = expiry;
            }
        }
        self.bush_reveal.clear();
        for (id, until) in &plan.reveals {
            if *until > now {
                match self.bush_reveal.iter_mut().find(|(key, _)| key == id) {
                    Some((_, value)) => *value = *until,
                    None => self.bush_reveal.push(((*id).to_owned(), *until)),
                }
            }
        }
        let sight = if plan.gates_locked {
            Sight::Locked
        } else {
            Sight::Open
        };
        let geometry = |id| Geometry {
            id,
            tiles: match id {
                Sight::Open => &self.open,
                Sight::Locked => &self.locked,
            },
            layers,
        };
        if let Some((x, y)) = plan.origin {
            // Math.fround of the synced coordinates.
            let origin = Vec2::new(f64::from(x as f32), f64::from(y as f32));
            self.memory.update_trail(geometry(sight), origin, now);
        }
        let mut seen = Vec::new();
        for &(index, end) in &plan.wards {
            // `!(camp.wardExpiresAt > this.now)`, NaN included.
            if end.partial_cmp(&now) != Some(std::cmp::Ordering::Greater) {
                continue;
            }
            let site = &layers.data().camps[index];
            seen.push(index);
            let current = self.wards.iter().position(|(i, _)| *i == index);
            let stale = current.is_none_or(|at| {
                let ward = &self.wards[at].1;
                ward.end != end || ward.map != sight
            });
            if stale {
                let mut memory = Grid::new(self.open.w as usize, self.open.h as usize);
                memory.update(
                    geometry(sight),
                    Vec2::new(site.x, site.y),
                    now,
                    end - now,
                    VISION_RADIUS,
                );
                let ward = Ward {
                    memory,
                    end,
                    map: sight,
                };
                match current {
                    Some(at) => self.wards[at].1 = ward,
                    None => self.wards.push((index, ward)),
                }
            }
        }
        self.wards.retain(|(index, _)| seen.contains(index));
        Ok(())
    }

    /// Source `canSee(point)`.
    pub(crate) fn can_see(&self, point: Vec2) -> bool {
        if !self.enabled || self.memory.can_see(point, self.now) {
            return true;
        }
        self.wards
            .iter()
            .any(|(_, ward)| self.now < ward.end && ward.memory.can_see(point, self.now))
    }

    /// Source `bushConceals(this.map, percept.self, actor, revealUntil, now)` on the open map.
    /// The viewer is read only after the actor's bush and reveal checks, as in the source.
    fn bush_conceals(
        &self,
        viewer: &Object,
        actor: Vec2,
        reveal_until: f64,
    ) -> Result<bool, Error> {
        let layers = self.layers();
        let bush = layers.bush_at_world(actor.x, actor.y);
        if bush == 0 || reveal_until > self.now {
            return Ok(false);
        }
        let viewer = point(viewer)?;
        if layers.bush_at_world(viewer.x, viewer.y) == bush {
            return Ok(false);
        }
        let dx = actor.x - viewer.x;
        let dy = actor.y - viewer.y;
        Ok(dx * dx + dy * dy > BUSH_REVEAL_RADIUS * BUSH_REVEAL_RADIUS)
    }

    fn sees(&self, row: &Object) -> Result<bool, Error> {
        Ok(self.can_see(point(row)?))
    }
    fn keep(&self, rows: &[Object]) -> Result<Vec<Object>, Error> {
        let mut out = Vec::new();
        for row in rows {
            if self.sees(row)? {
                out.push(row.clone());
            }
        }
        Ok(out)
    }
    fn keep_values(
        &self,
        rows: &[MethodValue],
        key: &'static str,
    ) -> Result<Vec<MethodValue>, Error> {
        let mut out = Vec::new();
        for row in rows {
            let MethodValue::Obj(fields) = row else {
                return Err(Error::Shape(key));
            };
            if self.sees(&Object(fields.clone()))? {
                out.push(row.clone());
            }
        }
        Ok(out)
    }

    /// Source `filter(percept)`. The delay ring may retain a projectile after it leaves
    /// sight or interpolate across unseen terrain; only the listed families filter here.
    pub(crate) fn filter(&self, percept: &Percept) -> Result<Percept, Error> {
        if !self.enabled {
            return Ok(percept.clone());
        }
        let mut fighters = Vec::new();
        for row in &percept.fighters {
            let at = point(row)?;
            if !self.can_see(at) {
                continue;
            }
            let reveal = match row.optional("id") {
                Some(MethodValue::Str(id)) => self
                    .bush_reveal
                    .iter()
                    .find(|(key, _)| key == id)
                    .map_or(0., |(_, until)| *until),
                _ => 0.,
            };
            if !self.bush_conceals(&percept.owner, at, reveal)? {
                fighters.push(row.clone());
            }
        }
        let mobs = self.keep(&percept.mobs)?;
        let effects = percept.extras.optional("effects").filter(|v| truthy(v));
        let ids: Option<Vec<&str>> = effects.map(|_| {
            [&percept.owner]
                .into_iter()
                .chain(&fighters)
                .chain(&mobs)
                .filter_map(|row| match row.optional("id") {
                    Some(MethodValue::Str(id)) => Some(id.as_str()),
                    _ => None,
                })
                .collect()
        });
        let MethodValue::Obj(minimap) = &percept.minimap else {
            return Err(Error::Shape("minimap"));
        };
        let mut minimap = Object(minimap.clone());
        let minimap_mobs = self.keep_values(minimap.array("mobs")?, "minimap mob")?;
        minimap.put("mobs", MethodValue::Arr(minimap_mobs));
        let mut events = Vec::new();
        for event in &percept.events {
            match event.get("at")? {
                MethodValue::Null => events.push(event.clone()),
                MethodValue::Obj(at) => {
                    if self.sees(&Object(at.clone()))? {
                        events.push(event.clone());
                    } else if matches!(event.optional("kind"), Some(MethodValue::Str(k)) if k == "death")
                    {
                        let mut row = event.clone();
                        row.put("at", MethodValue::Null);
                        row.put("by", MethodValue::Null);
                        events.push(row);
                    }
                }
                _ => return Err(Error::Shape("event at")),
            }
        }
        let mut extras = percept.extras.clone();
        if let Some(fields) = percept.extras.optional("fields").filter(|v| truthy(v)) {
            let MethodValue::Arr(fields) = fields else {
                return Err(Error::Shape("fields"));
            };
            let mut kept = Vec::new();
            for field in fields {
                let MethodValue::Obj(row) = field else {
                    return Err(Error::Shape("field"));
                };
                let row = Object(row.clone());
                if !self.sees(&row)? {
                    continue;
                }
                let trail =
                    matches!(row.optional("kind"), Some(MethodValue::Str(k)) if k == "trail");
                // BOTH trail ends must be in sight.
                if !trail || self.can_see(Vec2::new(row.number("x2")?, row.number("y2")?)) {
                    kept.push(field.clone());
                }
            }
            extras.put("fields", MethodValue::Arr(kept));
        }
        if let Some(chests) = percept.extras.optional("chests").filter(|v| truthy(v)) {
            let MethodValue::Arr(chests) = chests else {
                return Err(Error::Shape("chests"));
            };
            extras.put(
                "chests",
                MethodValue::Arr(self.keep_values(chests, "chest")?),
            );
        }
        if let (Some(effects), Some(ids)) = (effects, ids) {
            let MethodValue::Obj(entries) = effects else {
                return Err(Error::Shape("effects"));
            };
            let kept = entries
                .iter()
                .filter(|(id, _)| ids.contains(&id.as_str()))
                .cloned()
                .collect();
            extras.put("effects", MethodValue::Obj(js_key_order(kept)));
        }
        let containers = self.keep(&percept.containers)?;
        let projectiles = self.keep_values(&percept.projectiles, "projectile")?;
        Ok(Percept {
            fighters,
            mobs,
            containers,
            projectiles,
            minimap: minimap.data(),
            events,
            extras,
            ..percept.clone()
        })
    }

    /// Test-only private state read in the capture's diagnostic shape. It is compared
    /// with an actual private source read and is never an input to anything.
    #[cfg(test)]
    pub(crate) fn diagnostic(&self) -> MethodValue {
        use super::data::{num, object, text};
        let wards = self
            .wards
            .iter()
            .map(|(index, ward)| {
                object([
                    ("index", num(*index as f64)),
                    ("end", num(ward.end)),
                    ("map", grid::sight_name(Some(ward.map))),
                    ("memory", ward.memory.diagnostic()),
                ])
            })
            .collect();
        let reveal = self
            .bush_reveal
            .iter()
            .map(|(id, until)| MethodValue::Arr(vec![text(id), num(*until)]))
            .collect();
        object([
            ("enabled", MethodValue::Bool(self.enabled)),
            ("now", num(self.now)),
            ("memory", self.memory.diagnostic()),
            ("wards", MethodValue::Arr(wards)),
            ("bushReveal", MethodValue::Arr(reveal)),
        ])
    }
}

/// A filtered point requires numeric `x`/`y`; the composer always supplies them.
fn point(row: &Object) -> Result<Vec2, Error> {
    row.at()
}

/// `Object.fromEntries(Object.entries(o).filter(...))` key order: canonical array-index
/// keys ascending first, then every other key in insertion order.
fn js_key_order(mut entries: Vec<(String, MethodValue)>) -> Vec<(String, MethodValue)> {
    entries.sort_by_key(|(key, _)| array_index(key).map_or((1, 0), |i| (0, i)));
    entries
}
fn array_index(key: &str) -> Option<u32> {
    if key != "0" && (key.starts_with('0') || key.is_empty()) {
        return None;
    }
    if !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    key.parse::<u32>().ok().filter(|i| *i != u32::MAX)
}
