//! The hand (docs/BOTS.md 2.3): where a click lands, and what the game client makes of it
//! (packages/server/src/bots/brain/clicks.ts). A left click goes through a port of the client's own picker over the
//! candidates the client offers; a right click on the ground is scattered and stays on screen. Pure given the streams
//! handed in: when anything is clicked is the humanizer's business.
use crate::bots::random::Rng;
use crate::bots::random::{chance, gaussian};
use crate::bots::types::{
    FighterId, Percept, TierParams, BOT_VIEW_HALF_H, BOT_VIEW_HALF_W, WORLD_H, WORLD_W,
};
use rh_sim::Vec2;

/// The legacy shared TILE (shared/constants.ts): world units per map tile.
pub const TILE: f64 = 32.;
/// The legacy shared MASK_MOVE bits: every non-floor class blocks a body.
pub const MASK_MOVE: u8 = 0xff;

/// A collision map as the hand sees it. Built from the match's public arena (never from match state) or from the
/// captured corpus in tests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BotMap {
    pub w: i64,
    pub h: i64,
    pub tiles: Vec<u8>,
}
impl BotMap {
    pub fn new(w: i64, h: i64, tiles: Vec<u8>) -> Self {
        Self { w, h, tiles }
    }
    /// The authoritative collision layer (read-only static data: the same map every client renders).
    pub fn from_tile_map(map: &rh_sim::TileMap) -> Self {
        Self::new(i64::from(map.w), i64::from(map.h), map.tiles.clone())
    }
    /// The loaded map's own width in world units.
    pub fn map_w(&self) -> f64 {
        self.w as f64 * TILE
    }
    pub fn map_h(&self) -> f64 {
        self.h as f64 * TILE
    }
    /// Legacy shared isSolidTile: out of bounds counts as solid.
    pub fn is_solid_tile(&self, tx: i64, ty: i64) -> bool {
        if tx < 0 || ty < 0 || tx >= self.w || ty >= self.h {
            return true;
        }
        self.tiles[(ty * self.w + tx) as usize] & MASK_MOVE != 0
    }
    /// Legacy shared isSolidAt: solid at a world point.
    pub fn is_solid_at(&self, x: f64, y: f64) -> bool {
        self.is_solid_tile(rh_sim::map::world_to_tile(x), rh_sim::map::world_to_tile(y))
    }
}
pub struct TargetCandidate {
    pub id: FighterId,
    pub x: f64,
    pub y: f64,
}

/// A port of the client's pickTarget (client render/targeting.ts), pinned equal to it by test/bots/clicks.test.ts: the
/// candidate drawn nearest the cursor's ground point within radius, a tie to the lower id, or null.
pub fn pick_target(cursor: Vec2, candidates: &[TargetCandidate], radius: f64) -> Option<FighterId> {
    let mut best: Option<FighterId> = None;
    let mut best_sq = radius * radius;
    for c in candidates {
        let dx = c.x - cursor.x;
        let dy = c.y - cursor.y;
        let sq = dx * dx + dy * dy;
        if sq < best_sq || (sq == best_sq && best.as_ref().is_some_and(|b| c.id < *b)) {
            best = Some(c.id.clone());
            best_sq = sq;
        }
    }
    best
}

/// Every fighter a left click could lock, as the client offers them (RaidScene.targetCandidates): the other players and
/// the mobs that are alive and drawn, mobs not while the gates are locked. Untargetable fighters and quest givers are not
/// offered (the server refuses both); the percept never holds the bot itself.
pub fn lock_candidates(p: &Percept) -> Vec<TargetCandidate> {
    let mut list = Vec::new();
    for f in &p.fighters {
        if f.status == "alive" && f.targetable {
            list.push(TargetCandidate {
                id: f.id.clone(),
                x: f.x,
                y: f.y,
            });
        }
    }
    if !p.hud.gates_locked {
        for m in &p.mobs {
            if m.status == "alive" && m.kind != "quest" {
                list.push(TargetCandidate {
                    id: m.id.clone(),
                    x: m.x,
                    y: m.y,
                });
            }
        }
    }
    list
}

struct Drawn {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
}
fn drawn_at(p: &Percept, id: &str) -> Option<Drawn> {
    for f in &p.fighters {
        if f.id == id {
            return Some(Drawn {
                x: f.x,
                y: f.y,
                vx: f.vx,
                vy: f.vy,
            });
        }
    }
    for m in &p.mobs {
        if m.id == id {
            return Some(Drawn {
                x: m.x,
                y: m.y,
                vx: m.vx,
                vy: m.vy,
            });
        }
    }
    None
}

pub struct LockClick {
    /// Where the cursor landed on the ground.
    pub cursor: Vec2,
    /// The fighter the client would lock, or null when the click was on empty ground (nothing is sent).
    pub picked: Option<FighterId>,
    /// The sigma was multiplied by slipMult (a mis-aimed flick).
    pub slipped: bool,
}

/// A left click meant for target: the cursor is where it is drawn now (or target.at when it has left the percept) minus
/// its velocity x lagS, since the hand trails a mover, plus a 2D Gaussian; with chance slipP the sigma is slipMult times
/// larger. The scatter is the motor stream's, the slip the lapse stream's.
pub fn lock_click(
    motor: &mut Rng,
    lapse: &mut Rng,
    tier: &TierParams,
    p: &Percept,
    target: &crate::bots::types::LockTarget,
    snap_radius: f64,
) -> LockClick {
    let s = tier.target_scatter;
    let seen = drawn_at(p, &target.id);
    let slipped = chance(lapse, s.slip_p);
    let sigma = if slipped {
        s.sigma * s.slip_mult
    } else {
        s.sigma
    };
    let cursor = match seen {
        Some(seen) => Vec2::new(
            seen.x - seen.vx * s.lag_s + gaussian(motor, 0., sigma),
            seen.y - seen.vy * s.lag_s + gaussian(motor, 0., sigma),
        ),
        None => Vec2::new(
            target.at.x + gaussian(motor, 0., sigma),
            target.at.y + gaussian(motor, 0., sigma),
        ),
    };
    LockClick {
        cursor,
        picked: pick_target(cursor, &lock_candidates(p), snap_radius),
        slipped,
    }
}

/// On the screen: within the window around the bot.
pub fn in_window(self_at: Vec2, pt: Vec2) -> bool {
    (pt.x - self_at.x).abs() <= BOT_VIEW_HALF_W && (pt.y - self_at.y).abs() <= BOT_VIEW_HALF_H
}

fn clamp_axis(v: f64, lo: f64, hi: f64) -> f64 {
    v.min(hi).max(lo)
}

/// The nearest point of the world that is also on screen.
pub fn clamp_to_window(_map: &BotMap, self_at: Vec2, pt: Vec2) -> Vec2 {
    Vec2::new(
        clamp_axis(
            pt.x,
            (self_at.x - BOT_VIEW_HALF_W).max(0.),
            (self_at.x + BOT_VIEW_HALF_W).min(WORLD_W),
        ),
        clamp_axis(
            pt.y,
            (self_at.y - BOT_VIEW_HALF_H).max(0.),
            (self_at.y + BOT_VIEW_HALF_H).min(WORLD_H),
        ),
    )
}

/// Tries before an aim that keeps landing in a wall gives up and clicks the point it meant.
const WALL_RETRIES: usize = 4;

fn scatter(
    motor: &mut Rng,
    map: &BotMap,
    centre: Vec2,
    sigma: f64,
    fit: impl Fn(Vec2) -> Vec2,
) -> Vec2 {
    let on_wall = map.is_solid_at(centre.x, centre.y);
    for _ in 0..WALL_RETRIES {
        let pt = fit(Vec2::new(
            centre.x + gaussian(motor, 0., sigma),
            centre.y + gaussian(motor, 0., sigma),
        ));
        if on_wall || !map.is_solid_at(pt.x, pt.y) {
            return pt;
        }
    }
    fit(centre)
}

/// The point on the window's border along the heading from self toward to, pulled in a little and further in until it is
/// floor.
pub fn edge_toward(map: &BotMap, self_at: Vec2, to: Vec2) -> Vec2 {
    let dx = to.x - self_at.x;
    let dy = to.y - self_at.y;
    let tx = if dx == 0. {
        f64::INFINITY
    } else {
        BOT_VIEW_HALF_W / dx.abs()
    };
    let ty = if dy == 0. {
        f64::INFINITY
    } else {
        BOT_VIEW_HALF_H / dy.abs()
    };
    let t = tx.min(ty);
    if !t.is_finite() {
        return self_at;
    }
    let mut pt = self_at;
    for f in [0.97, 0.85, 0.7, 0.55, 0.4] {
        pt = Vec2::new(self_at.x + dx * t * f, self_at.y + dy * t * f);
        if !map.is_solid_at(pt.x, pt.y) {
            break;
        }
    }
    pt
}

/// Sigma of a ground click: the cursor travels from the bot, so it grows with the distance.
pub fn ground_sigma(tier: &TierParams, self_at: Vec2, pt: Vec2) -> f64 {
    tier.move_scatter.base
        + tier.move_scatter.per_unit * rh_sim::math::hypot(pt.x - self_at.x, pt.y - self_at.y)
}

/// A ground click at pt (on screen): scattered, clamped to the world and the window. A cast on the ground aims the same.
pub fn ground_click(
    motor: &mut Rng,
    tier: &TierParams,
    map: &BotMap,
    self_at: Vec2,
    pt: Vec2,
) -> Vec2 {
    let on = clamp_to_window(map, self_at, pt);
    let sigma = ground_sigma(tier, self_at, on);
    scatter(motor, map, on, sigma, |q| clamp_to_window(map, self_at, q))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MoveClickKind {
    Ground,
    Edge,
    Minimap,
}

pub struct MoveClick {
    pub to: Vec2,
    pub kind: MoveClickKind,
}

/// A right click that orders a walk to to. On screen it lands on the ground with the tier's scatter. Off screen the bot
/// either clicks the window's edge toward it (and will click again as it walks; with chance edgeClickP) or the minimap,
/// whose dot is hit with minimapSigma. The edge is a ground click, so it never leaves the screen.
pub fn move_click(
    motor: &mut Rng,
    tier: &TierParams,
    map: &BotMap,
    self_at: Vec2,
    to: Vec2,
) -> MoveClick {
    if in_window(self_at, to) {
        return MoveClick {
            to: ground_click(motor, tier, map, self_at, to),
            kind: MoveClickKind::Ground,
        };
    }
    if chance(motor, tier.edge_click_p) {
        return MoveClick {
            to: ground_click(motor, tier, map, self_at, edge_toward(map, self_at, to)),
            kind: MoveClickKind::Edge,
        };
    }
    let world = |q: Vec2| Vec2::new(clamp_axis(q.x, 0., WORLD_W), clamp_axis(q.y, 0., WORLD_H));
    MoveClick {
        to: scatter(motor, map, world(to), tier.minimap_sigma, world),
        kind: MoveClickKind::Minimap,
    }
}
