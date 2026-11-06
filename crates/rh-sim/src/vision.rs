//! Private scene vision. On an immutable collision map the union of a viewer's unexpired
//! reveal origins represents exactly the legacy tile-expiry table: a tile's deadline is the
//! latest reveal that reached its centre (or stood on that tile). No actor/prop is remembered.
//! A gate transition must preserve the old reveal geometry when dynamic gates are ported.
use crate::constants::{
    BUSH_REVEAL_MS, BUSH_REVEAL_RADIUS, MASK_SIGHT, TICK_MS, TILE, VISION_RADIUS, VISION_TRAIL_MS,
    VISION_UPDATE_MS,
};
use crate::state::{Player, Status};
use crate::{PlayerId, Sim, TileMap, Vec2};
use std::collections::VecDeque;

const fn refresh_ticks() -> u32 {
    (VISION_UPDATE_MS / TICK_MS) as u32
}
const fn trail_ticks() -> u32 {
    (VISION_TRAIL_MS / TICK_MS) as u32
}
const fn max_samples() -> usize {
    trail_ticks().div_ceil(refresh_ticks()) as usize
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Reveal {
    tick: u32,
    origin: Vec2,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct VisionTrail {
    phase: Option<u32>,
    #[serde(deserialize_with = "decode_reveals")]
    reveals: VecDeque<Reveal>,
}
/// A malformed checkpoint cannot grow a viewer's trail past the live sampling bound.
fn decode_reveals<'de, D: serde::Deserializer<'de>>(
    decoder: D,
) -> Result<VecDeque<Reveal>, D::Error> {
    struct Bounded;
    impl<'de> serde::de::Visitor<'de> for Bounded {
        type Value = VecDeque<Reveal>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "at most {} private vision samples", max_samples())
        }
        fn visit_seq<A: serde::de::SeqAccess<'de>>(
            self,
            mut seq: A,
        ) -> Result<Self::Value, A::Error> {
            let mut out = VecDeque::with_capacity(max_samples());
            while let Some(reveal) = seq.next_element()? {
                if out.len() == max_samples() {
                    return Err(serde::de::Error::invalid_length(out.len() + 1, &self));
                }
                out.push_back(reveal);
            }
            Ok(out)
        }
    }
    decoder.deserialize_seq(Bounded)
}

impl Default for VisionTrail {
    fn default() -> Self {
        Self {
            phase: None,
            reveals: VecDeque::with_capacity(max_samples()),
        }
    }
}
impl VisionTrail {
    fn refresh(&mut self, origin: Vec2, tick: u32) {
        if self
            .reveals
            .back()
            .is_some_and(|r| tick - r.tick < refresh_ticks())
        {
            return;
        }
        while self
            .reveals
            .front()
            .is_some_and(|r| tick - r.tick >= trail_ticks())
        {
            self.reveals.pop_front();
        }
        if let Some(last) = self.reveals.back_mut() {
            if last.origin == origin {
                last.tick = tick;
                return;
            }
        }
        self.reveals.push_back(Reveal { tick, origin });
    }

    fn latest_reveal(
        &self,
        map: &TileMap,
        tx: i64,
        ty: i64,
        tick: u32,
        after: Option<u32>,
    ) -> Option<u32> {
        if !in_map(map, tx, ty) {
            return None;
        }
        let centre = Vec2::new((tx as f64 + 0.5) * TILE, (ty as f64 + 0.5) * TILE);
        self.reveals
            .iter()
            .rev()
            .take_while(|r| tick - r.tick < trail_ticks() && after.is_none_or(|old| r.tick > old))
            .find_map(|r| reveals_tile(map, r.origin, tx, ty, centre).then_some(r.tick))
    }
    fn remembers(&self, map: &TileMap, at: Vec2, tick: u32) -> bool {
        if !(at.x + at.y).is_finite() {
            return false;
        }
        let (tx, ty) = tile(at);
        self.latest_reveal(map, tx, ty, tick, None).is_some()
    }

    pub(crate) fn check(&self, tick: u32, near: impl Fn(f64, f64) -> bool) -> Result<(), String> {
        if self.phase.is_some_and(|p| p >= refresh_ticks()) || self.reveals.len() > max_samples() {
            return Err("invalid vision phase or reveal count".into());
        }
        let mut previous = None;
        for r in &self.reveals {
            if r.tick > tick
                || !near(r.origin.x, r.origin.y)
                || previous
                    .is_some_and(|p| r.tick.checked_sub(p).is_none_or(|dt| dt < refresh_ticks()))
            {
                return Err("invalid vision reveal time or origin".into());
            }
            previous = Some(r.tick);
        }
        Ok(())
    }
}

fn tile(at: Vec2) -> (i64, i64) {
    ((at.x / TILE).floor() as i64, (at.y / TILE).floor() as i64)
}
fn in_map(map: &TileMap, tx: i64, ty: i64) -> bool {
    (0..i64::from(map.w)).contains(&tx) && (0..i64::from(map.h)).contains(&ty)
}
fn reveals_tile(map: &TileMap, origin: Vec2, tx: i64, ty: i64, centre: Vec2) -> bool {
    if let Some(layers) = map.layers() {
        let rect = layers.coliseum().rect;
        // Membership is the source's regionGrid; the revealed area is the whole
        // rectangle, including its hidden walls and chamfered corners.
        if tx >= i64::from(rect.x)
            && ty >= i64::from(rect.y)
            && tx < i64::from(rect.x) + i64::from(rect.w)
            && ty < i64::from(rect.y) + i64::from(rect.h)
            && layers.is_coliseum_at_world(origin.x, origin.y)
        {
            return true;
        }
    }
    let (sx, sy) = tile(origin);
    // VisionMemory.update retains the standing tile even at a radius boundary.
    if (sx, sy) == (tx, ty) {
        !map.blocked(sx, sy, MASK_SIGHT)
    } else {
        in_radius(origin, centre)
            && !scene_line_blocked(map, origin.x, origin.y, centre.x, centre.y)
    }
}
fn in_radius(a: Vec2, b: Vec2) -> bool {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    dx * dx + dy * dy <= VISION_RADIUS * VISION_RADIUS
}

/// Legacy hasVisionLineOfSight: first wall face visible; crossing a corner adjacent to either
/// wall blocks. Stop upon reaching the destination tile, even when the point is on its boundary.
pub(crate) fn scene_line_blocked(map: &TileMap, x: f64, y: f64, end_x: f64, end_y: f64) -> bool {
    if !(x + y + end_x + end_y).is_finite() {
        return true;
    }
    let (mut tx, mut ty) = tile(Vec2::new(x, y));
    let (ex, ey) = tile(Vec2::new(end_x, end_y));
    if !in_map(map, ex, ey) || map.blocked(tx, ty, MASK_SIGHT) {
        return true;
    }
    let dx = end_x - x;
    let dy = end_y - y;
    let step = |d: f64| {
        if d > 0.0 {
            1i64
        } else if d < 0.0 {
            -1
        } else {
            0
        }
    };
    let (sx, sy) = (step(dx), step(dy));
    let crossing = |at: i64, sign: i64, start: f64, d: f64| {
        if sign == 0 {
            f64::INFINITY
        } else {
            ((at + i64::from(sign > 0)) as f64 * TILE - start) / d
        }
    };
    let mut cross_x = crossing(tx, sx, x, dx);
    let mut cross_y = crossing(ty, sy, y, dy);
    while tx != ex || ty != ey {
        let cross = cross_x.min(cross_y);
        let (across_x, across_y) = (cross_x == cross, cross_y == cross);
        if across_x
            && across_y
            && (map.blocked(tx + sx, ty, MASK_SIGHT) || map.blocked(tx, ty + sy, MASK_SIGHT))
        {
            return true;
        }
        if across_x {
            tx += sx;
            cross_x = crossing(tx, sx, x, dx);
        }
        if across_y {
            ty += sy;
            cross_y = crossing(ty, sy, y, dy);
        }
        if (tx, ty) != (ex, ey) && map.blocked(tx, ty, MASK_SIGHT) {
            return true;
        }
    }
    false
}

pub(crate) fn point_with(
    map: &TileMap,
    viewer: &Player,
    point: Vec2,
    tick: u32,
    line_blocked: impl FnOnce() -> bool,
) -> bool {
    viewer.status == Status::Alive
        && ((in_radius(viewer.pos(), point) && !line_blocked())
            || viewer.vision.remembers(map, point, tick))
}
/// Bush concealment applies only to living actors, after point visibility is established.
/// Actor-specific sight never grants discovery of nearby props or terrain.
pub(crate) fn actor_with(
    map: &TileMap,
    viewer: &Player,
    target: &Player,
    tick: u32,
    line_blocked: impl FnOnce() -> bool,
) -> bool {
    if (viewer.id != target.id
        && target.statuses.effects & crate::status_runtime::StatusKind::Hidden.rule().bit != 0)
        || target.status == Status::Lobby
        || !point_with(map, viewer, target.pos(), tick, line_blocked)
    {
        return false;
    }
    bush_visible(map, viewer, target, tick)
}

fn bush_visible(map: &TileMap, viewer: &Player, target: &Player, tick: u32) -> bool {
    if let Some(layers) = map.layers() {
        let at = target.pos();
        let bush = layers.bush_at_world(at.x, at.y);
        if bush != 0
            && target.status == Status::Alive
            && target.bush.until <= f64::from(tick) * TICK_MS
        {
            let from = viewer.pos();
            let dx = at.x - from.x;
            let dy = at.y - from.y;
            return layers.bush_at_world(from.x, from.y) == bush
                || dx * dx + dy * dy <= BUSH_REVEAL_RADIUS * BUSH_REVEAL_RADIUS;
        }
    }
    true
}

pub(crate) fn actor_visible(map: &TileMap, viewer: &Player, target: &Player, tick: u32) -> bool {
    actor_with(map, viewer, target, tick, || {
        scene_line_blocked(
            map,
            viewer.body.x,
            viewer.body.y,
            target.body.x,
            target.body.y,
        )
    })
}

/// Evaluate the viewer's due pre-movement reveal before committing it. Legacy's lookup itself
/// updates the trail; a concealed candidate cannot cause a different refresh than a missing one.
pub(crate) fn gameplay_actor_visible(
    map: &TileMap,
    viewer: &Player,
    target: &Player,
    tick: u32,
) -> bool {
    // Presentation uses the last source-timed hidden mirror; gameplay targetability uses
    // current status readers at its own phase, so terrain sight must not reuse that mirror.
    if target.status != Status::Lobby
        && point_visible(map, viewer, target.pos(), tick)
        && bush_visible(map, viewer, target, tick)
    {
        return true;
    }
    if viewer.status != Status::Alive
        || target.status == Status::Lobby
        || !bush_visible(map, viewer, target, tick)
        || viewer
            .vision
            .reveals
            .back()
            .is_some_and(|r| tick - r.tick < refresh_ticks())
    {
        return false;
    }
    let (tx, ty) = tile(target.pos());
    in_map(map, tx, ty)
        && reveals_tile(
            map,
            viewer.pos(),
            tx,
            ty,
            Vec2::new((tx as f64 + 0.5) * TILE, (ty as f64 + 0.5) * TILE),
        )
}

pub(crate) fn point_visible(map: &TileMap, viewer: &Player, point: Vec2, tick: u32) -> bool {
    let from = viewer.pos();
    point_with(map, viewer, point, tick, || {
        scene_line_blocked(map, from.x, from.y, point.x, point.y)
    })
}

/// Legacy abilities.onAttackStarted queues exposure, which only becomes visible at the next
/// abilities phase. A direct cursor attack starting during weapons cannot reveal its owner to
/// any input in that same tick. A future ability cast feeds this same queue from its own source.
#[derive(Clone, Copy, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct BushExposure {
    pending: Option<f64>,
    until: f64,
}
impl BushExposure {
    pub(crate) fn check(self, now: f64, phase: crate::Phase) -> bool {
        let limit = now
            + BUSH_REVEAL_MS
            + crate::constants::BOW_WINDUP_MAX_S.max(crate::constants::WAND_WINDUP_MAX_S) * 1000.0;
        // Ended ticks advance the clock without another abilities phase to spend the queue.
        let earliest = if phase == crate::Phase::Ended {
            0.0
        } else {
            now
        };
        (0.0..=limit).contains(&self.until)
            && self
                .pending
                .is_none_or(|until| (earliest..=limit).contains(&until))
    }
}
pub(crate) fn attack_started(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    let crate::hooks::HookArgs::AttackStarted(id) = *args else {
        return;
    };
    let Some(layers) = hx.k.arena.map.layers() else {
        return;
    };
    let i = hx.w.idx(id).expect("attacker in the weapons pass");
    let p = &mut hx.w.players[i];
    if layers.bush_at_world(p.body.x, p.body.y) == 0 {
        return;
    }
    if let Some(action) = p.weapon.action {
        let until = action.lands_at.max(hx.w.server_time) + BUSH_REVEAL_MS;
        p.bush.pending = Some(p.bush.pending.unwrap_or(0.).max(until));
    }
}

pub(crate) fn apply_exposures(cx: &mut crate::systems::Cx) {
    if cx.k.arena.map.layers().is_none() {
        return;
    }
    for p in &mut cx.w.players {
        if let Some(until) = p.bush.pending.take() {
            p.bush.until = p.bush.until.max(until);
        }
    }
}

/// Derived cache for scanning many props in one viewer's complete observation. A cached cell needs
/// to check only reveal origins added since it was last tested. Direct point sight is always exact
/// and outside this table. A map change or a different observer history discards all cached cells.
#[derive(Default)]
pub(crate) struct TileVisionCache {
    arena: Option<std::sync::Arc<crate::Arena>>,
    tick: Option<u32>,
    previous: Vec<Reveal>,
    cells: Vec<Option<Cell>>,
}
#[derive(Clone, Copy)]
struct Cell {
    tile: u64,
    through: u32,
    last_seen: Option<u32>,
}
impl TileVisionCache {
    /// Confirm that every previous unexpired origin still contributes the same revealed tiles and
    /// that no earlier origin was inserted. A coalesced stationary tail can move to a newer tick.
    fn extends(&self, trail: &VisionTrail, tick: u32) -> bool {
        let Some(old_tick) = self.tick.filter(|&t| t <= tick) else {
            return false;
        };
        let mut prior = self
            .previous
            .iter()
            .filter(|r| tick - r.tick < trail_ticks());
        let mut now = trail
            .reveals
            .iter()
            .filter(|r| tick - r.tick < trail_ticks())
            .peekable();
        while now.peek().is_some_and(|r| r.tick <= old_tick) {
            if now.next() != prior.next() {
                return false;
            }
        }
        match prior.next() {
            None => true,
            Some(tail) => {
                prior.next().is_none() && now.next().is_some_and(|r| r.origin == tail.origin)
            }
        }
    }

    pub(crate) fn begin(&mut self, sim: &Sim, viewer: &Player, persistent: bool) {
        let count = sim.containers().len();
        let trail = &viewer.vision;
        if !persistent || count < 2 || trail.reveals.len() < 2 {
            self.tick = None;
            return;
        }
        let size = 4 * count.min(crate::MAX_VISIBLE_PROPS).next_power_of_two();
        if self.cells.len() < size {
            self.cells.resize(size, None);
            self.tick = None;
        }
        if self
            .arena
            .as_ref()
            .is_none_or(|a| !std::sync::Arc::ptr_eq(a, sim.shared_arena()))
            || !self.extends(trail, sim.tick())
        {
            self.cells.fill(None);
        }
        self.arena = Some(std::sync::Arc::clone(sim.shared_arena()));
        self.previous.clear();
        self.previous.reserve(max_samples());
        self.previous.extend(trail.reveals.iter().copied());
        self.tick = Some(sim.tick());
    }

    pub(crate) fn sees(&mut self, map: &TileMap, viewer: &Player, point: Vec2, tick: u32) -> bool {
        if self.tick != Some(tick) {
            return point_visible(map, viewer, point, tick);
        }
        if viewer.status != Status::Alive {
            return false;
        }
        let origin = viewer.pos();
        if in_radius(origin, point)
            && !scene_line_blocked(map, origin.x, origin.y, point.x, point.y)
        {
            return true;
        }
        let (tx, ty) = tile(point);
        if !in_map(map, tx, ty) {
            return false;
        }
        let index = ty as u64 * u64::from(map.w) + tx as u64;
        let sets = self.cells.len() / 4;
        let key = index.wrapping_mul(0x9e37_79b9_7f4a_7c15);
        let start = ((key >> (64 - sets.trailing_zeros())) as usize) * 4;
        let bucket = &mut self.cells[start..start + 4];
        let pos = bucket
            .iter()
            .position(|c| c.is_some_and(|r| r.tile == index));
        let old = pos.and_then(|i| bucket[i]);
        let last_seen = viewer
            .vision
            .latest_reveal(map, tx, ty, tick, old.map(|c| c.through))
            .or(old.and_then(|c| c.last_seen));
        let slot = pos.unwrap_or_else(|| {
            bucket
                .iter()
                .enumerate()
                .min_by_key(|(_, c)| c.map(|r| r.through))
                .unwrap()
                .0
        });
        bucket[slot] = Some(Cell {
            tile: index,
            through: tick,
            last_seen,
        });
        last_seen.is_some_and(|t| tick - t < trail_ticks())
    }
}

impl Sim {
    /// Read-only public point visibility on the frozen tick. Samples never change a viewer's trail.
    pub fn can_see_point(&self, viewer: PlayerId, point: Vec2) -> bool {
        self.player(viewer)
            .is_some_and(|p| point_visible(&self.arena().map, p, point, self.tick()))
    }
}

/// Used by the installed module at raid start, its regular systems slot, and later authoritative
/// targeting queries before movement. Publication never invokes this mutating operation.
pub(crate) fn refresh_player(player: &mut Player, tick: u32) {
    if player.status == Status::Alive {
        let at = player.pos();
        player.vision.refresh(at, tick);
    }
}
pub(crate) fn raid_started(hx: &mut crate::hooks::Hx, _: &crate::hooks::HookArgs) {
    let tick = hx.w.tick;
    for p in &mut hx.w.players {
        refresh_player(p, tick);
    }
}
pub(crate) fn refresh(cx: &mut crate::systems::Cx) {
    let tick = cx.w.tick;
    for (i, p) in cx.w.players.iter_mut().enumerate() {
        let phase = *p
            .vision
            .phase
            .get_or_insert_with(|| (i as u32) % refresh_ticks());
        if (tick % refresh_ticks() + phase) % refresh_ticks() == 0 || p.vision.reveals.is_empty() {
            refresh_player(p, tick);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        arenas::practice_arena, ContainerKind, Event, FactionId, ItemObserver, Observation,
        PickupRefusal, Placement, PublicCommand, Secrets, SeenEvent, SimConfig, WeaponId,
    };

    #[test]
    fn the_first_wall_face_is_visible_but_corner_squeezes_and_floor_beyond_it_are_not() {
        let map = TileMap::from_rows(&["########", "#..#...#", "#..#...#", "########"]).unwrap();
        let a = Vec2::new(48., 48.);
        assert!(!scene_line_blocked(&map, a.x, a.y, 112., 48.));
        assert!(scene_line_blocked(&map, a.x, a.y, 144., 48.));
        assert!(scene_line_blocked(&map, 112., 48., a.x, a.y));
        let corner = TileMap::from_rows(&["....", "..#.", ".#..", "...."]).unwrap();
        assert!(scene_line_blocked(&corner, 48., 48., 80., 80.));
        assert!(scene_line_blocked(&corner, 80., 80., 48., 48.));
        assert!(!scene_line_blocked(&corner, 48., 48., 16., 16.));
        assert!(scene_line_blocked(&corner, 48., 48., -1., 16.));
    }

    #[test]
    fn trail_uses_tile_centres_and_exclusive_expiry_not_an_actors_remembered_position() {
        let row = ".".repeat(100);
        let map = TileMap::from_rows(&[row]).unwrap();
        let origin = Vec2::new(100., 16.);
        let far = Vec2::new(2800., 16.);
        let tile = Vec2::new(995., 16.); // its centre is x=1008, outside the old 900-unit circle
        let mut m = VisionTrail::default();
        m.refresh(origin, 1);
        assert!(in_radius(origin, tile));
        assert!(!m.remembers(&map, Vec2::new(f64::NAN, 16.), 1));
        assert!(!m.remembers(&map, tile, 1));
        let recorded = Vec2::new(990., 16.); // x=976 cell centre
        assert!(m.remembers(&map, recorded, 1));
        m.refresh(far, 2); // 50 ms is too soon
        assert!(!m.remembers(&map, far, 2));
        m.refresh(far, 3);
        assert!(m.remembers(&map, recorded, 600));
        assert!(!m.remembers(&map, recorded, 601));
        assert!(m.remembers(&map, far, 602));
        assert!(!m.remembers(&map, far, 603));
    }

    fn private_world() -> Sim {
        let mut arena = practice_arena();
        // The real raid-start discovery is east of the pillar. The scenario then places
        // the viewer on its west side, just as the capture runner overrides initial positions.
        arena.spawns = vec![Vec2::new(240., 176.)];
        let p = Placement {
            profile: "observer".into(),
            faction: FactionId::Holy,
            at: Vec2::new(181., 176.),
            hp: None,
            weapon0: None,
            weapon1: None,
            bot: false,
        };
        let target = Placement {
            profile: "source".into(),
            at: Vec2::new(228., 176.),
            ..p.clone()
        };
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arena,
            Secrets::from_seed(3),
            &[p, target],
        );
        sim.seed_weapon_container(
            ContainerKind::Ground,
            Vec2::new(228., 176.),
            &[WeaponId::Axe],
        )
        .unwrap();
        sim
    }

    #[test]
    fn bootstrap_discovery_grants_current_actors_props_and_attribution_until_expiry_but_never_hand_reach(
    ) {
        let mut sim = private_world();
        let (viewer, source) = (PlayerId(1), PlayerId(2));
        let ev = [Event::Hit {
            victim: viewer,
            by: Some(source),
            amount: 3.,
            weapon: Some(WeaponId::Sword),
            passive: false,
        }];
        let mut seat = ItemObserver::new(viewer);
        let mut o = Observation::default();
        let mut cache = crate::SightCache::new();
        seat.observe_into(&sim, &ev, &mut o, None).unwrap();
        assert_eq!(o.visible[0].id, source);
        assert_eq!(o.props.len(), 1);
        assert!(!o.props[0].cue.focused);
        let proposal = PublicCommand::Pickup {
            handle: o.props[0].handle,
        };
        sim.submit(viewer, seat.resolve(&sim, proposal).unwrap())
            .unwrap();
        let refused = sim.step();
        assert!(crate::observe(&sim, viewer, &refused).events.contains(
            &SeenEvent::PickupRefused {
                reason: PickupRefusal::Unreachable
            }
        ));
        sim.w.players[1].body.x = 231.; // live activity in the revealed tile
        while sim.tick() < 600 {
            sim.step();
        }
        seat.observe_into(&sim, &ev, &mut o, Some(&mut cache))
            .unwrap();
        assert_eq!(o.visible[0].x, 231.);
        let latest = PublicCommand::Pickup {
            handle: o.props[0].handle,
        };
        let mut earlier = Vec::new();
        crate::observe_events_into_cached(&sim, viewer, &ev, &mut earlier, &mut cache);
        assert_eq!(earlier, o.events);
        assert!(matches!(earlier[0],SeenEvent::Hit{by:Some(id),..} if id==source));
        sim.step(); // exact original deadline: tick 1 + 600
        seat.observe_into(&sim, &ev, &mut o, Some(&mut cache))
            .unwrap();
        assert!(o.visible.is_empty() && o.props.is_empty());
        assert!(matches!(o.events[0], SeenEvent::Hit { by: None, .. }));
        crate::observe_events_into_cached(&sim, viewer, &ev, &mut earlier, &mut cache);
        assert!(matches!(earlier[0], SeenEvent::Hit { by: Some(_), .. }));
        assert_eq!(&earlier[1..], o.events);
        assert_eq!(
            seat.resolve(&sim, latest).unwrap(),
            crate::validate(crate::RawCommand::MissingPickup).unwrap()
        );
        assert!(!sim.can_see_point(PlayerId(99), Vec2::new(181., 176.)));
        sim.w.players[0].status = Status::Dead;
        assert!(!sim.can_see_point(viewer, Vec2::new(181., 176.)));
    }

    #[test]
    fn the_stagger_and_an_authoritative_early_query_obey_the_same_update_throttle() {
        let mut s = private_world();
        assert_eq!(s.w.players[0].vision.reveals.back().unwrap().tick, 1);
        s.step(); // phase 0 is due, but its t=1 sample is still fresh
        assert_eq!(s.w.players[0].vision.phase, Some(0));
        assert_eq!(s.w.players[1].vision.phase, Some(1));
        s.step();
        assert_eq!(s.w.players[0].vision.reveals.back().unwrap().tick, 1);
        assert_eq!(s.w.players[1].vision.reveals.back().unwrap().tick, 3);
        refresh_player(&mut s.w.players[0], 3); // eligible gameplay query before phase-0 refresh
        s.step();
        assert_eq!(s.w.players[0].vision.reveals.back().unwrap().tick, 3);
        assert_eq!(s.w.players[1].vision.reveals.back().unwrap().tick, 3);
        assert_eq!(s.tick(), 4);
    }
    #[test]
    fn discarded_projection_cannot_reuse_a_different_private_trail() {
        let mut real = private_world();
        real.seed_weapon_container(
            ContainerKind::Chest,
            Vec2::new(230., 176.),
            &[WeaponId::Sword],
        )
        .unwrap();
        let viewer = PlayerId(1);
        let mut seat = ItemObserver::new(viewer);
        let mut shown = Observation::default();
        seat.observe_into(&real, &[], &mut shown, None).unwrap();
        let issued = shown.props.clone();
        assert_eq!(issued.len(), 2);
        for _ in 1..4 {
            real.step();
        }
        let mut unseen = real.clone();
        unseen.w.players[0].vision.reveals[0].origin = Vec2::new(181., 176.);
        let hash = unseen.state_hash();
        let rejected = seat.prepare_into(&unseen, &[], &mut shown, None).unwrap();
        assert!(shown.props.is_empty());
        drop(rejected);
        assert_eq!(hash, unseen.state_hash());
        // Same map, tick, positions and physical props as the discarded encode. Only this seat's
        // historical origin differs. Both the memo and the published handles must agree with reality.
        assert_eq!(real.tick(), unseen.tick());
        seat.observe_into(&real, &[], &mut shown, None).unwrap();
        assert_eq!(shown.props, issued);
        unseen.step();
        seat.observe_into(&unseen, &[], &mut shown, None).unwrap();
        assert!(shown.props.is_empty());
        let mut replacement = Sim::restore(serde_json::to_value(&real).unwrap()).unwrap();
        replacement.step();
        replacement.step();
        seat.observe_into(&replacement, &[], &mut shown, None)
            .unwrap();
        assert_eq!(shown.props.len(), 2);
        assert!(shown.props[0].handle.get() > issued[1].handle.get());
    }

    #[test]
    fn reconnect_refreshes_only_the_due_viewer_without_a_public_read() {
        let mut sim = private_world();
        sim.mark_dropped(PlayerId(1), true);
        sim.step();
        sim.step(); // phase 0 last sampled at tick 1
        let mine = &sim.w.players[0].vision;
        assert_eq!(mine.reveals.back().unwrap().tick, 1);
        let other = sim.w.players[1].vision.clone();
        sim.mark_dropped(PlayerId(1), false);
        assert_eq!(sim.w.players[0].vision.reveals.back().unwrap().tick, 3);
        assert_eq!(other, sim.w.players[1].vision);
        let hash = sim.state_hash();
        for _ in 0..5 {
            crate::observe(&sim, PlayerId(1), &[]);
        }
        assert_eq!(hash, sim.state_hash());
    }

    #[test]
    fn malformed_vision_history_is_refused_on_restore() {
        let mut s = private_world();
        for _ in 0..4 {
            s.step();
        }
        let cp = serde_json::to_value(&s).unwrap();
        for (field, value) in [
            ("phase", serde_json::json!(2)),
            (
                "reveals",
                serde_json::json!([{"tick":1000,"origin":{"x":100.,"y":100.}}]),
            ),
            (
                "reveals",
                serde_json::json!([{"tick":1,"origin":{"x":100.,"y":100.}},{"tick":2,"origin":{"x":180.,"y":100.}}]),
            ),
            (
                "reveals",
                serde_json::json!([{"tick":1,"origin":{"x":1e300,"y":100.}}]),
            ),
        ] {
            let mut bad = cp.clone();
            bad["world"]["players"][0]["vision"][field] = value;
            assert!(Sim::restore(bad).is_err(), "{field}");
        }
    }
}
