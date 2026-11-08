//! Source `brain/modules/hazards.ts`, over public map data and delivered owner facts only.
//! This independent module is not activated on seats: public hazard-mode admission and the
//! full brain goal/memory adapter remain separate. It proposes intents, never movement or damage.
use super::types::{Intent, IntentBody, IntentTiming, PRIORITY_GOAL};
use rh_sim::geometry::{circle_clear, segment_clear};
use rh_sim::{
    constants::PLAYER_RADIUS, map::MASK_MOVE, FactionId, Observation, Phase, Status, TileMap, Vec2,
};

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
#[derive(Clone, Debug)]
struct Step {
    to: Vec2,
    at: f64,
    why: &'static str,
}
#[derive(Default)]
pub struct Hazards {
    step: Option<Step>,
    last_step_at: Option<f64>,
}
fn dist(a: Vec2, b: Vec2) -> f64 {
    rh_sim::math::hypot(a.x - b.x, a.y - b.y)
}
fn terrain_at(map: &TileMap, p: Vec2) -> u8 {
    let x = rh_sim::map::world_to_tile(p.x);
    let y = rh_sim::map::world_to_tile(p.y);
    if x < 0 || y < 0 || x >= i64::from(map.w) || y >= i64::from(map.h) {
        return 0;
    }
    map.layers()
        .map_or(0, |l| l.data().terrain[(y * i64::from(map.w) + x) as usize])
}
/// Policy risk classification of the public art tile. No authoritative surface effect is applied.
pub fn burns(map: &TileMap, faction: FactionId, at: Vec2) -> bool {
    terrain_at(map, at) == 4 && faction != FactionId::Fire
}
pub fn bad(map: &TileMap, faction: FactionId, at: Vec2) -> bool {
    match terrain_at(map, at) {
        4 => faction != FactionId::Fire,
        5 => faction != FactionId::Plague,
        6 => faction != FactionId::Frost,
        _ => false,
    }
}
fn clean(map: &TileMap, faction: FactionId, at: Vec2) -> bool {
    if bad(map, faction, at) {
        return false;
    }
    let tile = rh_sim::constants::TILE;
    for (dx, dy) in [(tile, 0.), (-tile, 0.), (0., tile), (0., -tile)] {
        let p = Vec2::new(at.x + dx, at.y + dy);
        if circle_clear(map, p, 0., MASK_MOVE) && bad(map, faction, p) {
            return false;
        }
    }
    true
}
fn centre(x: i64, y: i64) -> Vec2 {
    let tile = rh_sim::constants::TILE;
    Vec2::new((x as f64 + 0.5) * tile, (y as f64 + 0.5) * tile)
}
fn nearest_tile(
    map: &TileMap,
    faction: FactionId,
    around: Vec2,
    tiles: i64,
    require_clear: Option<Vec2>,
) -> Option<Vec2> {
    let cx = rh_sim::map::world_to_tile(around.x);
    let cy = rh_sim::map::world_to_tile(around.y);
    let mut open = Vec::new();
    for dy in -tiles..=tiles {
        for dx in -tiles..=tiles {
            let p = centre(cx + dx, cy + dy);
            if circle_clear(map, p, PLAYER_RADIUS, MASK_MOVE) {
                open.push(p);
            }
        }
    }
    // JS stable Array.sort preserves dy/dx order on equal distances.
    open.sort_by(|a, b| dist(*a, around).total_cmp(&dist(*b, around)));
    for strict in [true, false] {
        for &p in &open {
            if (if strict {
                clean(map, faction, p)
            } else {
                !bad(map, faction, p)
            }) && require_clear
                .is_none_or(|from| segment_clear(map, from, p, PLAYER_RADIUS, MASK_MOVE))
            {
                return Some(p);
            }
        }
    }
    None
}
fn movement(step: &Step) -> Intent {
    Intent {
        body: IntentBody::Move { to: step.to },
        priority: PRIORITY_GOAL,
        timing: IntentTiming::Step {},
        why: step.why.into(),
    }
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
        if obs.phase != Phase::Active || me.status != Status::Alive || arena.in_coliseum {
            return None;
        }
        let now = obs.server_time;
        let at = Vec2::new(me.x, me.y);
        if let Some(step) = &self.step {
            if now - step.at > HOLD_MS || dist(at, step.to) <= ARRIVE_U {
                self.step = None;
            } else {
                return Some(movement(step));
            }
        }
        let mut next = None;
        if ctx.goal != Goal::Loot
            && self
                .last_step_at
                .is_none_or(|last| now - last >= STEP_EVERY_MS)
            && burns(map, me.faction, at)
            && me.attack_target.is_none()
            && now - ctx.still_since >= STILL_MS
        {
            next = nearest_tile(map, me.faction, at, STEP_TILES, Some(at)).map(|to| Step {
                to,
                at: now,
                why: "step off the embers",
            });
            if next.is_some() {
                self.last_step_at = Some(now);
            }
        }
        if next.is_none()
            && matches!(ctx.goal, Goal::HoldAmbush | Goal::HoldWait)
            && me.max_hp > 0.
            && me.hp / me.max_hp < ctx.reengage_hp
            && !ctx.engaged
            && terrain_at(map, at) != 7
        {
            let cx = rh_sim::map::world_to_tile(at.x);
            let cy = rh_sim::map::world_to_tile(at.y);
            let mut best_d = f64::INFINITY;
            for dy in -LIGHT_TILES..=LIGHT_TILES {
                for dx in -LIGHT_TILES..=LIGHT_TILES {
                    let q = centre(cx + dx, cy + dy);
                    if terrain_at(map, q) != 7 || !circle_clear(map, q, PLAYER_RADIUS, MASK_MOVE) {
                        continue;
                    }
                    let d = dist(at, q);
                    if d < best_d && segment_clear(map, at, q, PLAYER_RADIUS, MASK_MOVE) {
                        best_d = d;
                        next = Some(Step {
                            to: q,
                            at: now,
                            why: "lie low in the light",
                        });
                    }
                }
            }
        }
        self.step = next;
        self.step.as_ref().map(movement)
    }
    /// Source adjust pass: preserve nonmove/short intents and all priority/timing data.
    /// This runs independently of phase/coliseum, just as the source adjust hook does.
    pub fn adjust<'a>(
        &self,
        observation: &Observation,
        map: &TileMap,
        intents: &'a [Intent],
    ) -> std::borrow::Cow<'a, [Intent]> {
        let mut out = std::borrow::Cow::Borrowed(intents);
        let Some(me) = observation
            .me
            .as_ref()
            .filter(|me| me.status == Status::Alive)
        else {
            return out;
        };
        let at = Vec2::new(me.x, me.y);
        for (k, intent) in intents.iter().enumerate() {
            let IntentBody::Move { to } = intent.body else {
                continue;
            };
            if dist(at, to) < REDIRECT_MIN_U || !bad(map, me.faction, to) {
                continue;
            }
            let Some(to) = nearest_tile(map, me.faction, to, REDIRECT_TILES, None) else {
                continue;
            };
            let changed = &mut out.to_mut()[k];
            changed.body = IntentBody::Move { to };
            changed.why.push_str(" (round the bad ground)");
        }
        out
    }
}
#[cfg(test)]
mod tests;
