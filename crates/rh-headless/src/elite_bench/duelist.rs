//! The bench-local scripted `duelist` fighter (packet P-ELITE-BENCH-2): commits to the target elite camp, plays its
//! weapon's range and casts its Wish when ready. It acts only through `PublicCommand`s returned from `decide`; they go
//! through `validate` + `Sim::submit` inside `Env::step`. It reads its `Observation` plus what the bench tells it (the
//! camp centre and mob types: facts any client can see).
use rh_policy::{MatchStart, Policy, PolicySpec, POLICY_CONTRACT_VERSION};
use rh_sim::abilities::{definition_for, Slot, Target};
use rh_sim::content::{weapon, Shape};
use rh_sim::mob_catalog::MobTypeId;
use rh_sim::observe::Observation;
use rh_sim::{PublicCommand, SimConfig, Vec2, OBSERVATION_VERSION};

/// Only actors within this distance of the camp centre are targets.
const CAMP_RADIUS: f64 = 800.;
/// Melee: close to this fraction of the reach before swinging.
const MELEE_FRACTION: f64 = 0.9;
/// Ranged: hold at this fraction of the weapon range.
const HOLD_FRACTION: f64 = 0.8;
/// A `Self_` Wish also fires when the fighter lost hp within this many milliseconds.
const HIT_WINDOW_MS: f64 = 2000.;
/// A `Self_` Wish is cast when the target is within this distance.
const SELF_CAST_RANGE: f64 = 250.;
/// A `Point` or `Placed` Wish is cast when the target is within this distance.
const POINT_CAST_RANGE: f64 = 400.;

pub struct Duelist {
    centre: Vec2,
    types: Vec<MobTypeId>,
    config: SimConfig,
    /// The fighter's hp at its last observation, and the server time of its last loss (for the `Self_` Wish).
    last_hp: Option<f64>,
    last_hit_ms: f64,
}

impl Duelist {
    pub fn new(centre: Vec2, types: Vec<MobTypeId>, config: SimConfig) -> Self {
        Self {
            centre,
            types,
            config,
            last_hp: None,
            last_hit_ms: f64::NEG_INFINITY,
        }
    }
}

impl Policy for Duelist {
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            name: "duelist".into(),
            version: "1".into(),
            contract: POLICY_CONTRACT_VERSION,
            observation_version: OBSERVATION_VERSION,
            decision_interval_ticks: 1,
        }
    }
    fn reset(&mut self, _: &MatchStart) {
        self.last_hp = None;
        self.last_hit_ms = f64::NEG_INFINITY;
    }
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        let mut out = Vec::new();
        self.decide_into(obs, &mut out);
        out
    }
    fn decide_into(&mut self, obs: &Observation, out: &mut Vec<PublicCommand>) {
        if obs.phase != rh_sim::Phase::Active {
            return;
        }
        let Some(me) = &obs.me else { return };
        if me.status != rh_sim::Status::Alive {
            return;
        }
        if self.last_hp.is_some_and(|h| me.hp < h) {
            self.last_hit_ms = obs.server_time;
        }
        self.last_hp = Some(me.hp);
        let hit_lately = obs.server_time - self.last_hit_ms <= HIT_WINDOW_MS;
        let dist2 = |x: f64, y: f64, p: (f64, f64)| (x - p.0) * (x - p.0) + (y - p.1) * (y - p.1);
        let target = obs
            .visible
            .iter()
            .filter(|a| {
                a.status == rh_sim::Status::Alive
                    && a.mob_type.is_some_and(|t| self.types.contains(&t))
                    && dist2(a.x, a.y, (self.centre.x, self.centre.y)) <= CAMP_RADIUS * CAMP_RADIUS
            })
            .min_by(|a, b| {
                dist2(a.x, a.y, (me.x, me.y))
                    .total_cmp(&dist2(b.x, b.y, (me.x, me.y)))
                    .then(a.id.cmp(&b.id))
            });
        let Some(t) = target else {
            out.push(PublicCommand::Move {
                x: self.centre.x,
                y: self.centre.y,
                seq: None,
            });
            return;
        };
        let (dx, dy) = (t.x - me.x, t.y - me.y);
        let d = rh_sim::math::sqrt(dx * dx + dy * dy);
        let a = rh_sim::math::atan2(dy, dx);

        // The Wish: the only ability a card-less fighter has.
        if let Some(w) = &me.wish {
            if w.charges > 0 && obs.server_time >= w.ready_at && w.cast.is_none() {
                let (ok, x, y, id) = match definition_for(&self.config, w.ability).target {
                    Target::Unit(r) => (d <= r, t.x, t.y, Some(t.id)),
                    Target::Self_ => (d <= SELF_CAST_RANGE || hit_lately, me.x, me.y, None),
                    Target::Point | Target::Placed { .. } => {
                        (d <= POINT_CAST_RANGE, t.x, t.y, None)
                    }
                };
                if ok {
                    out.push(PublicCommand::Cast {
                        slot: Slot::Wish,
                        x,
                        y,
                        id,
                        t: None,
                        seq: None,
                    });
                }
            }
        }

        let attack = PublicCommand::Attack {
            a,
            t: Some(obs.server_time - 100.),
        };
        let go = PublicCommand::Move {
            x: t.x,
            y: t.y,
            seq: None,
        };
        match weapon(me.weapon).shape {
            Shape::Arc { reach, .. } => {
                out.push(if d <= MELEE_FRACTION * reach {
                    attack
                } else {
                    go
                });
            }
            // Stand and shoot: a mob gives up after 20 s without hitting a player, so a fighter that kites resets the
            // camp. Approach to the hold distance, then never step back.
            Shape::Projectile { range, .. } => {
                out.push(if d <= HOLD_FRACTION * range {
                    attack
                } else {
                    go
                });
            }
        }
    }
}
