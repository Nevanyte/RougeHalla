//! Server-resolved owner facts. A consumer chooses an index; it never computes paths or deals.
use super::*;
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SpawnOptionView {
    pub index: u32,
    pub at: Vec2,
    pub zone: crate::mapdata::Zone,
    pub walk_distance: Option<f64>,
    pub walk_seconds: Option<f64>,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PlanningView {
    pub plan: PlanView,
    pub options: [Option<SpawnOptionView>; 2],
    pub ready: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ArenaView {
    pub lobby_ends_at: f64,
    pub plan_ends_at: f64,
    pub raid_started_at: f64,
    pub patience_ends_at: Option<f64>,
    pub in_coliseum: bool,
    pub gates_locked: bool,
    pub sudden_death_at: f64,
    pub started_with: u32,
    /// P-WIRE17-HUD-3: the room's minimum players (`SimConfig::min_players`, legacy `RaidState.minPlayers`), public.
    pub min_players: u32,
}
pub(crate) fn owner_view(k: &MatchStatic, w: &World, id: PlayerId) -> Option<PlanningView> {
    let plan = plan_for(w, id)?;
    let player = w.player(id)?;
    let options = std::array::from_fn(|i| {
        let index = usize::try_from(plan.spawns[i]).ok()?;
        let p = k.arena.map.layers()?.data().spawn_pool.get(index)?;
        let distance = k.planning_walks.get(index).copied().flatten();
        Some(SpawnOptionView {
            index: index as u32,
            at: Vec2::new(p.x, p.y),
            zone: p.zone,
            walk_distance: distance,
            walk_seconds: distance.map(walk_seconds),
        })
    });
    Some(PlanningView {
        plan,
        options,
        ready: player.plan_ready,
    })
}
pub(crate) fn arena_view(k: &MatchStatic, w: &World) -> Option<ArenaView> {
    k.config.lifecycle.rules().map(|_| ArenaView {
        lobby_ends_at: w.lobby_ends_at,
        plan_ends_at: w.plan_ends_at,
        raid_started_at: w.raid_started_at,
        patience_ends_at: w.rt.patience_ends_at,
        in_coliseum: w.rt.in_coliseum,
        gates_locked: w.rt.gates_locked,
        sudden_death_at: w.rt.sudden_death_at,
        started_with: if w.raid_started_at > 0. {
            w.rt.started_with
        } else {
            0
        },
        // Public room configuration (legacy world.ts:899 `state.minPlayers = opts.config.minPlayers`).
        min_players: u32::try_from(k.config.min_players).unwrap_or(u32::MAX),
    })
}

pub(crate) fn walk_seconds(distance: f64) -> f64 {
    distance / crate::constants::PLAYER_SPEED
}
