//! Source `brain/modules/hazards.ts`, over public map data and delivered owner facts only.
//! This independent module is not activated on seats: public hazard-mode admission and the
//! full brain goal/memory adapter remain separate. It proposes intents, never movement or damage.
//!
//! The classification/search and step/hold/expiry/arrival/throttle/light/adjust machinery lives once in the private
//! fact/service-based core ([`source_core`]); this public wrapper is a compatibility adapter over it (an `Observation`
//! and static map in, the same `Intent`s out) and the complete source feature module
//! (`temporal_percept/modules/hazards.rs`) calls the same core from its earned private context.
use super::types::Intent;
// The legacy adapter tests (`hazards/tests.rs`) reach these two names through `use super::*`.
#[allow(unused_imports)]
use super::types::{IntentBody, IntentTiming};
use rh_sim::{FactionId, Observation, Phase, Status, TileMap, Vec2};

pub(crate) mod source_core;

pub const STEP_EVERY_MS: f64 = 600.;
pub const STILL_MS: f64 = 250.;
pub const STEP_TILES: i64 = 6;
pub const HOLD_MS: f64 = 1500.;
pub const ARRIVE_U: f64 = 20.;
pub const REDIRECT_TILES: i64 = 3;
pub const REDIRECT_MIN_U: f64 = 4. * rh_sim::constants::TILE;
pub const LIGHT_TILES: i64 = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Goal {
    Loot,
    HoldAmbush,
    HoldWait,
    Other,
}
/// These are remembered policy decisions, not reads of private simulation state.
/// `still_since` is measured from delivered owner positions at delivered source times
/// (source memory resets the anchor after a displacement >1); `engaged` is policy memory.
pub struct Context<'a> {
    pub observation: &'a Observation,
    pub still_since: f64,
    pub engaged: bool,
    pub reengage_hp: f64,
    pub goal: Goal,
}
#[derive(Default)]
pub struct Hazards {
    step: Option<source_core::Step>,
    last_step_at: Option<f64>,
}
fn dist(a: Vec2, b: Vec2) -> f64 {
    rh_sim::math::hypot(a.x - b.x, a.y - b.y)
}
/// The declared map's terrain layer; a layer-less map is source NONE ground (the pre-core public behavior).
fn map_terrain(map: &TileMap) -> &[u8] {
    map.layers()
        .map_or(&[], |layers| layers.data().terrain.as_slice())
}
/// Policy risk classification of the public art tile. No authoritative surface effect is applied.
pub fn burns(map: &TileMap, faction: FactionId, at: Vec2) -> bool {
    source_core::burns(map, map_terrain(map), Some(faction), at)
}
pub fn bad(map: &TileMap, faction: FactionId, at: Vec2) -> bool {
    source_core::bad(map, map_terrain(map), Some(faction), at)
}
impl Hazards {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    /// Call only after the room's hazard feature is admitted/enabled. Absence of public
    /// arena/owner facts yields no intent; it never guesses an arena phase or coliseum flag.
    pub fn intents(&mut self, ctx: &Context<'_>, map: &TileMap) -> Option<Intent> {
        let obs = ctx.observation;
        let me = obs.me.as_ref()?;
        let arena = obs.arena.as_ref()?;
        let facts = source_core::Facts {
            now: obs.server_time,
            pos: Vec2::new(me.x, me.y),
            status_alive: me.status == Status::Alive,
            faction_present: true,
            home: Some(me.faction),
            hp: me.hp,
            max_hp: me.max_hp,
            attack_target: me.attack_target.is_some(),
            phase_active: obs.phase == Phase::Active,
            in_coliseum: arena.in_coliseum,
            goal: ctx.goal,
            engaged: ctx.engaged,
            reengage_hp: ctx.reengage_hp,
            still_since: ctx.still_since,
        };
        let services = source_core::MapService { map };
        source_core::intents(self, &facts, &services, map_terrain(map), &dist)
            .map(source_core::intent)
    }
    /// Source adjust pass: preserve nonmove/short intents and all priority/timing data.
    /// This runs independently of phase/coliseum, just as the source adjust hook does.
    pub fn adjust<'a>(
        &self,
        observation: &Observation,
        map: &TileMap,
        intents: &'a [Intent],
    ) -> std::borrow::Cow<'a, [Intent]> {
        let Some(me) = observation
            .me
            .as_ref()
            .filter(|me| me.status == Status::Alive)
        else {
            return std::borrow::Cow::Borrowed(intents);
        };
        let facts = source_core::Facts {
            now: observation.server_time,
            pos: Vec2::new(me.x, me.y),
            status_alive: true,
            faction_present: true,
            home: Some(me.faction),
            hp: me.hp,
            max_hp: me.max_hp,
            attack_target: me.attack_target.is_some(),
            phase_active: false,
            in_coliseum: false,
            goal: Goal::Other,
            engaged: false,
            reengage_hp: 0.,
            still_since: 0.,
        };
        let services = source_core::MapService { map };
        source_core::adjust(&facts, &services, map_terrain(map), intents, &dist)
    }
}
#[cfg(test)]
mod tests;
