//! Source kite.ts stateful OrbWalk component. This has no live/decoded-frame adapter:
//! callers must first establish the source normal branch (real reflex absent and no pending hold).
use super::delivered::PlayerRef;
use super::fight::{key, Owner};
use super::kite::{away_point, own_timings};
use super::paths::RoomPathService;
use super::random::Rng;
use super::types::{BotWeapon, Intent, IntentBody, IntentTiming, TierParams, PRIORITY_COMBAT};
use rh_sim::Vec2;

#[derive(Clone, Debug, PartialEq)]
pub enum Step {
    Ordinary,
    Wait,
    Order(Intent),
}
pub struct Context<'a> {
    pub now: f64,
    pub owner: &'a Owner,
    pub tier: &'a TierParams,
    pub paths: &'a RoomPathService,
    pub decide: &'a mut Rng,
}
#[derive(Clone, Debug, PartialEq)]
pub struct OrbWalk {
    cycle_ready: f64,
    away: bool,
    away_at: f64,
    applied: bool,
    cycles: u64,
}
impl Default for OrbWalk {
    fn default() -> Self {
        Self {
            cycle_ready: f64::INFINITY,
            away: false,
            away_at: 0.,
            applied: false,
            cycles: 0,
        }
    }
}
impl OrbWalk {
    /// Source reset retains the lifetime cycle counter, and forgets the previous shot/away phase.
    pub fn reset(&mut self, ready_at: f64) {
        self.cycle_ready = ready_at;
        self.away = false;
        self.applied = false;
    }
    pub fn cycles(&self) -> u64 {
        self.cycles
    }
    pub fn step(
        &mut self,
        ctx: Context<'_>,
        foe: PlayerRef,
        at: Vec2,
        weapon: BotWeapon,
        locked: bool,
    ) -> Step {
        let Context {
            now,
            owner,
            tier,
            paths,
            decide,
        } = ctx;
        if self.away {
            if !self.applied {
                if !locked {
                    self.applied = true;
                } else if now - self.away_at > 900. {
                    self.away = false;
                    return Step::Ordinary;
                } else {
                    return Step::Wait;
                }
            }
            if locked || now - self.away_at > 3000. {
                self.away = false;
                return Step::Ordinary;
            }
            return Step::Order(Intent {
                body: IntentBody::Lock {
                    target: key(foe),
                    at,
                },
                priority: PRIORITY_COMBAT,
                timing: IntentTiming::Timed {
                    due: (owner.ready_at - 100.).max(now),
                },
                why: "orb-walk re-lock at the cooldown".into(),
            });
        }
        let Some(t) = own_timings(owner.faction, weapon, owner.as_mult, owner.windup_mult) else {
            return Step::Ordinary;
        };
        if !locked || owner.ready_at <= self.cycle_ready {
            return Step::Ordinary;
        }
        if owner.ready_at - self.cycle_ready < t.interval_ms * 0.9 {
            self.cycle_ready = owner.ready_at;
            return Step::Ordinary;
        }
        let launch_at = owner.ready_at - t.interval_ms + t.windup_ms;
        if now < launch_at || (weapon == BotWeapon::Bow && owner.draw_started_at > 0.) {
            return Step::Ordinary;
        }
        self.cycle_ready = owner.ready_at;
        if owner.ready_at - now < tier.step.mean() + 55. + 100. + 100. {
            return Step::Ordinary;
        }
        let jitter = (decide.next_f64() * 2. - 1.) * tier.orbwalk.angle_jitter;
        let Some(to) = away_point(paths, owner.at, at, tier.orbwalk.step_u, jitter) else {
            return Step::Ordinary;
        };
        self.away = true;
        self.away_at = now;
        self.applied = false;
        self.cycles += 1;
        Step::Order(Intent {
            body: IntentBody::Move { to },
            priority: PRIORITY_COMBAT,
            timing: IntentTiming::Step {},
            why: "orb-walk: step away after the shot".into(),
        })
    }
}
