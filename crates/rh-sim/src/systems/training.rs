//! Training rooms: the practice world lifecycle and the dummy/practice setup (legacy `sim/training.ts` and the training
//! half of `sim/mobs.ts`).
//!
//! A training world is an active run with none of the run's consequences: no patience timer, teleport, sudden death,
//! result or GV, and a fighter who goes down — in a tick or between ticks — is revived where they fell. The practice setup
//! (dummies that never die and a rack of every weapon, then the `train` console's practice mobs and chests) is placed at
//! the raid-start hook at its recorded chain position, deterministically and without drawing from any RNG stream.

mod console;
pub(crate) use console::handle_train;

use super::Cx;
use crate::{
    constants::*,
    fighter::Fate,
    hooks::{HookArgs, Hx},
    map::{tile_to_world_center, world_to_tile},
    math::hypot,
    mob_runtime::MobKind,
    pathfind::{self, Pathfinder},
    state::{ContainerKind, Sample, Status, Targeting, World},
    statics::MatchStatic,
    Vec2, WeaponId,
};

/// Legacy `installTraining`: the practice run has no patience timer to show. `beginRun` arms it before the raid-start
/// chain runs, so the link at this recorded position clears it again.
pub(crate) fn raid_started(hx: &mut Hx, _: &HookArgs) {
    hx.w.rt.patience_ends_at = None;
}

/// Legacy `installTraining`: a fighter keeps their weapons when they go down (they are revived at once, not looted). The
/// link replaces the looted-body link in a training world.
pub(crate) fn drop_body(_: &mut Hx, _: &HookArgs) {}

/// System (legacy `arena.settle` in a training world, `trainingSettle`): nobody's run is settled and nothing is banked.
/// Whoever is down — a downed tick victim or a between-tick down that already emitted a result — is revived at full health
/// where they fell, at rest. A player removed from the world is simply gone; a `mia` player stays mia.
pub(crate) fn settle(cx: &mut Cx) {
    let now = cx.w.server_time;
    let Cx { w, s, .. } = cx;
    s.downed_this_tick.clear();
    w.rt.downs_between_ticks = 0;
    for p in w.players.iter_mut() {
        if p.status != Status::Dead {
            continue;
        }
        p.down = None;
        p.resolved = false;
        p.fate = Fate::default();
        p.credit.last_hit = None;
        p.motion.path.clear();
        p.motion.slip = None;
        let (x, y) = (p.body.x, p.body.y);
        p.body.history.reset(Sample { t: now, x, y });
        p.status = Status::Alive;
        p.core.vitals.hp = p.core.vitals.max_hp;
        p.weapon.targeting = Targeting::default();
        p.weapon.reset_runtime();
        p.weapon.ready_at = 0.;
        p.weapon.draw_started_at = 0.;
    }
}

/// System (legacy `mobs.resetDummies`): a dummy unhit for `DUMMY_RESET_SECONDS` heals back to full. Installed in every
/// world (the row is ungated) and harmless outside one with dummies, as the source's is.
pub(crate) fn reset_dummies(cx: &mut Cx) {
    let now = cx.w.server_time;
    for m in cx.w.mobs.iter_mut() {
        if m.kind != MobKind::Dummy || m.status != Status::Alive {
            continue;
        }
        if m.core.vitals.hp < m.core.vitals.max_hp
            && now - m.last_hit_at >= DUMMY_RESET_SECONDS * 1000.
        {
            m.core.vitals.hp = m.core.vitals.max_hp;
        }
    }
}

/// One number per tile (the stride keeps columns from wrapping into rows), as the source's `tileKey`.
fn tile_key(at: Vec2) -> i64 {
    world_to_tile(at.y) * 65536 + world_to_tile(at.x)
}

/// Legacy `mobs.ts trainingTiles`: free floor tile centres in the training band around `from` that nothing has claimed
/// yet, nearest first (ties keep the row-major scan order, so the layout depends only on the map and what stands there).
fn training_tiles(map: &crate::TileMap, from: Vec2, taken: &[i64]) -> Vec<Vec2> {
    let mut out: Vec<(Vec2, f64)> = Vec::new();
    let tx0 = world_to_tile(from.x);
    let ty0 = world_to_tile(from.y);
    let reach = TRAINING_MAX_TILES as i64;
    for ty in ty0 - reach..=ty0 + reach {
        for tx in tx0 - reach..=tx0 + reach {
            if tx < 0 || ty < 0 || tx >= i64::from(map.w) || ty >= i64::from(map.h) {
                continue;
            }
            let at = Vec2::new(tile_to_world_center(tx), tile_to_world_center(ty));
            let d = hypot(at.x - from.x, at.y - from.y) / TILE;
            if !(TRAINING_MIN_TILES..=TRAINING_MAX_TILES).contains(&d) {
                continue;
            }
            if taken.contains(&tile_key(at))
                || !crate::geometry::circle_clear(map, at, PLAYER_RADIUS, MASK_MOVE)
            {
                continue;
            }
            out.push((at, d));
        }
    }
    out.sort_by(|a, b| a.1.total_cmp(&b.1));
    out.into_iter().map(|(at, _)| at).collect()
}

/// The deterministic layout of one training setup around one player's spawn (legacy `mobs.ts trainingTiles`/`rackRow`/
/// `spawnTraining`). Claims tiles across players: every piece placed here keeps its tile for the next player too.
struct Layout<'a> {
    map: &'a crate::TileMap,
    from: Vec2,
    tiles: Vec<Vec2>,
    taken: &'a mut Vec<i64>,
    reachable: Vec<(i64, bool)>,
    pf: Pathfinder,
}

impl<'a> Layout<'a> {
    fn new(map: &'a crate::TileMap, from: Vec2, taken: &'a mut Vec<i64>) -> Self {
        let tiles = training_tiles(map, from, taken);
        Self {
            map,
            from,
            tiles,
            taken,
            reachable: Vec::new(),
            pf: Pathfinder::default(),
        }
    }

    /// Legacy `planPath(world, from, at).length > 0`, cached per tile.
    fn can_walk_to(&mut self, at: Vec2) -> bool {
        let key = tile_key(at);
        if let Some((_, ok)) = self.reachable.iter().find(|(k, _)| *k == key) {
            return *ok;
        }
        let ok = !pathfind::plan_path(&mut self.pf, self.map, self.from, at).is_empty();
        self.reachable.push((key, ok));
        ok
    }

    fn claim(&mut self, at: Vec2) {
        self.taken.push(tile_key(at));
    }

    fn is_taken(&self, at: Vec2) -> bool {
        self.taken.contains(&tile_key(at))
    }

    /// Legacy `nearest(accept)`: the first free, walkable, accepted tile in scan order (nearest distance first).
    fn nearest(&mut self, visible: bool) -> Option<Vec2> {
        let tiles = self.tiles.clone();
        let mut found = None;
        for at in &tiles {
            if self.is_taken(*at) || !self.can_walk_to(*at) {
                continue;
            }
            if visible && !self.is_visible(*at) {
                continue;
            }
            found = Some(*at);
            break;
        }
        if let Some(at) = found {
            self.claim(at);
        }
        found
    }

    fn is_visible(&self, at: Vec2) -> bool {
        crate::geometry::has_line_of_sight(self.map, self.from, at, MASK_SIGHT)
    }

    fn facing(&self, at: Vec2) -> f64 {
        crate::math::atan2(self.from.y - at.y, self.from.x - at.x)
    }

    /// Five free, walkable tiles side by side (a row, else a column) from the nearest start that has them.
    fn rack_row(&mut self) -> Option<Vec<Vec2>> {
        let open: Vec<(i64, Vec2)> = self
            .tiles
            .iter()
            .filter(|t| !self.is_taken(**t))
            .map(|t| (tile_key(*t), *t))
            .collect();
        let starts = self.tiles.clone();
        for start in starts {
            for (dx, dy) in [(1.0, 0.0), (0.0, 1.0)] {
                let mut row = Vec::with_capacity(5);
                for i in 0..5 {
                    let at = Vec2::new(
                        start.x + dx * i as f64 * TILE,
                        start.y + dy * i as f64 * TILE,
                    );
                    let key = tile_key(at);
                    match open.iter().find(|(k, _)| *k == key) {
                        Some((_, at)) if self.can_walk_to(*at) => row.push(*at),
                        _ => break,
                    }
                }
                if row.len() == 5 {
                    for at in &row {
                        self.claim(*at);
                    }
                    return Some(row);
                }
            }
        }
        None
    }
}

/// Hook (legacy `mobs.spawnTraining`): the practice setup next to every player's spawn — a plain dummy, a shield dummy
/// facing the spawn and a rack of one loose weapon of every id, 3-6 tiles away on free floor reachable from the spawn.
/// Spawns, players, containers and mobs already there keep their tiles, and so does every piece placed here. A piece that
/// finds no tile is skipped. Deterministic for a map and a player order; it draws nothing from any RNG.
pub(crate) fn spawn_training(hx: &mut Hx, _: &HookArgs) {
    let k = hx.k;
    let map = k.collision_map(hx.w.rt.gates_locked);
    let mut taken: Vec<i64> = Vec::new();
    for s in &k.arena.spawns {
        taken.push(tile_key(*s));
    }
    let player_spots: Vec<Vec2> = hx.w.players.iter().map(|p| p.core.pos()).collect();
    for at in &player_spots {
        taken.push(tile_key(*at));
    }
    for c in &hx.w.containers {
        taken.push(tile_key(c.at));
    }
    for m in hx.w.mobs.iter() {
        taken.push(tile_key(m.core.pos()));
    }
    // The five loop weapons, in the source's `WEAPON_IDS` order.
    fn rack_weapons() -> [WeaponId; 5] {
        [
            WeaponId::Sword,
            WeaponId::Bow,
            WeaponId::Wand,
            WeaponId::Shield,
            WeaponId::Axe,
        ]
    }
    let rack = rack_weapons();
    for from in player_spots {
        let mut layout = Layout::new(map, from, &mut taken);
        // A dummy is for shooting at, so it prefers a tile the spawn can see; a spawn with a wall in front of it takes
        // one around the corner.
        let plain = layout.nearest(true).or_else(|| layout.nearest(false));
        if let Some(at) = plain {
            let facing = layout.facing(at);
            super::mobs::place_dummy(hx.w, at, facing, false);
        }
        let shield = layout.nearest(true).or_else(|| layout.nearest(false));
        if let Some(at) = shield {
            let facing = layout.facing(at);
            super::mobs::place_dummy(hx.w, at, facing, true);
        }
        let row = layout.rack_row();
        let spots: Vec<Option<Vec2>> = match row {
            Some(row) => row.into_iter().map(Some).collect(),
            None => (0..rack.len()).map(|_| layout.nearest(false)).collect(),
        };
        for (i, weapon) in rack.iter().enumerate() {
            if let Some(Some(at)) = spots.get(i) {
                super::items::add_container(
                    hx.w,
                    ContainerKind::Ground,
                    *at,
                    [Some(*weapon), None],
                    hx.w.tick,
                    false,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests;

/// Checkpoint/world admission for a training world (the `systems/mobs.validate` arm).
pub(crate) fn validate_actors(
    _k: &MatchStatic,
    w: &World,
    near: impl Fn(f64, f64) -> bool,
) -> Result<(), &'static str> {
    let Some(rt) = w.mob_runtime.as_ref() else {
        return Err("training world needs the shared actor runtime");
    };
    let Some(practice) = w.practice.as_ref() else {
        return Err("training world needs the practice console state");
    };
    if practice.spawned > TRAIN_MAX_MOBS_SPAWNED
        || !(PRACTICE_CAMP_FIRST..=PRACTICE_CAMP_LAST).contains(&practice.next_camp)
        || practice
            .last_camp_at
            .is_some_and(|t| !t.is_finite() || t > w.server_time)
        || practice
            .last_chest_at
            .is_some_and(|t| !t.is_finite() || t > w.server_time)
    {
        return Err("invalid practice console state");
    }
    if !rt.camps.is_empty() || !rt.life.is_empty() {
        return Err("training world has no map camps");
    }
    for m in w.mobs.iter() {
        let pos = m.core.pos();
        if !near(pos.x, pos.y) {
            return Err("training mob outside the arena");
        }
        match m.kind {
            MobKind::Dummy => {
                if m.mob_type.is_some()
                    || m.status != Status::Alive
                    || (m.core.vitals.max_hp - DUMMY_HP).abs() > f64::EPSILON
                    || m.elite
                    || m.camp != 0
                {
                    return Err("invalid training dummy");
                }
            }
            MobKind::Practice => {
                let Some(ty) = m.mob_type else {
                    return Err("practice mob without a catalog type");
                };
                if !((PRACTICE_CAMP_FIRST - 1)..=(PRACTICE_CAMP_LAST - 1)).contains(&m.camp) {
                    return Err("practice mob camp ref out of range");
                }
                let row = crate::mob_catalog::mob_type_by_id(ty.as_str())
                    .ok_or("practice mob unknown catalog type")?;
                if m.core.vitals.faction != row.zone {
                    return Err("practice mob zone mismatch");
                }
            }
            MobKind::Regional => return Err("training world has a map-camp mob"),
        }
    }
    Ok(())
}
