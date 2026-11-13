//! The production [`BrainPathService`] (P-BOT-BRAIN-LIVE-1): the room path service over the match's public static map,
//! with the source `withGates` view while the coliseum gates are locked.
//!
//! It answers from the bound public map only (never `World`), forwards every walk/path to the actual
//! [`RoomPathService`] cache under the caller's borrowed allowance, and keeps two services (open and gate-locked) so a
//! cached open-gate route is never answered while the gates are shut. `set_frame` selects the view; it never refills the
//! allowance (the seat starts it once per decision).

use super::config::BrainPathService;
use crate::bots::paths::{PathBudget, PathStats, RoomPathService, WalkAnswer};
use rh_sim::{TileMap, Vec2};

/// Source `withGates(map)`: the same map with every coliseum gate tile set to wall. A map without public layers has no
/// gates, so its locked view is the open map.
pub(crate) fn with_gates(open: &TileMap) -> TileMap {
    let Some(layers) = open.layers() else {
        return open.clone();
    };
    let data = layers.data();
    let mut tiles = open.tiles.clone();
    let width = open.w as usize;
    for gate in &data.coliseum.gates {
        for tile in &gate.tiles {
            if tile.x < 0 || tile.y < 0 || tile.x as u32 >= open.w || tile.y as u32 >= open.h {
                continue;
            }
            tiles[tile.y as usize * width + tile.x as usize] = rh_sim::map::TILE_WALL;
        }
    }
    TileMap::new(open.w, open.h, tiles).unwrap_or_else(|_| open.clone())
}

/// One seat's path service: the open and the gate-locked room services and the frame's gate state.
pub(crate) struct ArenaPathService {
    open: RoomPathService,
    locked: RoomPathService,
    gated: bool,
}

impl ArenaPathService {
    pub(crate) fn new(open: &TileMap, locked: &TileMap) -> Self {
        Self {
            open: RoomPathService::new(open, PathBudget::default()),
            locked: RoomPathService::new(locked, PathBudget::default()),
            gated: false,
        }
    }

    fn current(&self) -> &RoomPathService {
        if self.gated {
            &self.locked
        } else {
            &self.open
        }
    }

    fn current_mut(&mut self) -> &mut RoomPathService {
        if self.gated {
            &mut self.locked
        } else {
            &mut self.open
        }
    }
}

impl BrainPathService for ArenaPathService {
    fn set_frame(&mut self, now: f64, gates_locked: bool) {
        self.gated = gates_locked;
        self.current_mut().set_frame(now, gates_locked);
    }

    fn walk(&mut self, from: Vec2, to: Vec2, budget: &mut PathBudget) -> Option<WalkAnswer> {
        self.current_mut().walk_with_budget(from, to, budget)
    }

    fn path(&mut self, from: Vec2, to: Vec2, budget: &mut PathBudget) -> Option<Vec<Vec2>> {
        self.current_mut().path_with_budget(from, to, budget)
    }

    fn los(&self, a: Vec2, b: Vec2) -> bool {
        self.current().los(a, b)
    }

    fn clear(&self, a: Vec2, b: Vec2) -> bool {
        self.current().clear(a, b)
    }

    fn collision_map(&self) -> &TileMap {
        self.current().collision_map()
    }

    fn stats(&self) -> PathStats {
        let (open, locked) = (self.open.stats(), self.locked.stats());
        PathStats {
            searches: open.searches + locked.searches,
            hits: open.hits + locked.hits,
            fallbacks: open.fallbacks + locked.fallbacks,
        }
    }

    fn module_paths_capable(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_locked_view_walls_every_gate_tile_and_the_service_follows_the_frame() {
        let arena = super::super::compose14::test_support::seed1_arena();
        let open = &arena.map;
        let locked = with_gates(open);
        let gates = &open.layers().expect("full map").data().coliseum.gates;
        assert!(!gates.is_empty());
        for tile in gates.iter().flat_map(|g| &g.tiles) {
            let i = tile.y as usize * open.w as usize + tile.x as usize;
            assert_eq!(locked.tiles[i], rh_sim::map::TILE_WALL);
        }
        let mut service = ArenaPathService::new(open, &locked);
        service.set_frame(0., true);
        assert!(std::ptr::eq(
            service.collision_map(),
            service.locked.collision_map()
        ));
        service.set_frame(50., false);
        assert!(std::ptr::eq(
            service.collision_map(),
            service.open.collision_map()
        ));
    }
}
