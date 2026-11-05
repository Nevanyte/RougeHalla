//! Scripted policies: a simple brawler (the reference bot of the slice), an idle fallback, and fault-injection policies for
//! tests. The legacy human-like bot brain (packages/server/src/bots) is NOT ported yet (docs/backlog P-BOTS-1).

use crate::{MatchStart, Policy, PolicySpec, POLICY_CONTRACT_VERSION};
use rh_sim::observe::Observation;
use rh_sim::{PlayerId, PublicCommand, OBSERVATION_VERSION};

fn spec(name: &str, interval: u32) -> PolicySpec {
    PolicySpec {
        name: name.into(),
        version: "1".into(),
        contract: POLICY_CONTRACT_VERSION,
        observation_version: OBSERVATION_VERSION,
        decision_interval_ticks: interval,
    }
}

/// Does nothing. The fallback of every seat.
#[derive(Default)]
pub struct Idle;
impl Policy for Idle {
    fn spec(&self) -> PolicySpec {
        spec("idle", 1)
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        Vec::new()
    }
}

/// Walks to the nearest visible enemy and presses attack when in fists reach; wanders toward a remembered point otherwise.
/// Uses only its observation and its own seeded randomness. `interval`: decision cadence in ticks.
pub struct Brawler {
    interval: u32,
    rng: u64,
    me: PlayerId,
    wander: Option<(f64, f64)>,
}

impl Brawler {
    pub fn new(interval: u32) -> Self {
        Self {
            interval,
            rng: 1,
            me: PlayerId(0),
            wander: None,
        }
    }
    fn next(&mut self) -> f64 {
        // xorshift64*: the policy's own stream (never a match secret).
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        (self.rng.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 11) as f64 / (1u64 << 53) as f64
    }
}

impl Policy for Brawler {
    fn spec(&self) -> PolicySpec {
        spec("brawler", self.interval)
    }
    fn reset(&mut self, m: &MatchStart) {
        self.rng = m.seed | 1;
        self.me = m.me;
        self.wander = None;
    }
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        let mut out = Vec::new();
        self.decide_into(obs, &mut out);
        out
    }
    fn decide_into(&mut self, obs: &Observation, out: &mut Vec<PublicCommand>) {
        let Some(me) = &obs.me else { return };
        let target = obs
            .visible
            .iter()
            .filter(|a| a.status == rh_sim::Status::Alive)
            .min_by(|a, b| {
                let da = (a.x - me.x) * (a.x - me.x) + (a.y - me.y) * (a.y - me.y);
                let db = (b.x - me.x) * (b.x - me.x) + (b.y - me.y) * (b.y - me.y);
                da.total_cmp(&db).then(a.id.cmp(&b.id))
            });
        match target {
            Some(t) => {
                let (dx, dy) = (t.x - me.x, t.y - me.y);
                // The core's libm-backed math: a bot decides identically on every target.
                let d = rh_sim::math::sqrt(dx * dx + dy * dy);
                let a = rh_sim::math::atan2(dy, dx);
                if d < 80.0 {
                    out.push(PublicCommand::Attack {
                        a,
                        t: Some(obs.server_time - 100.0),
                    });
                } else {
                    out.push(PublicCommand::Move {
                        x: t.x,
                        y: t.y,
                        seq: None,
                    });
                }
            }
            None => {
                let reached = self
                    .wander
                    .is_none_or(|(x, y)| (x - me.x).abs() < 16.0 && (y - me.y).abs() < 16.0);
                if reached {
                    let (rx, ry) = (self.next(), self.next());
                    self.wander = Some((me.x + (rx - 0.5) * 600.0, me.y + (ry - 0.5) * 600.0));
                    let (x, y) = self.wander.unwrap();
                    out.push(PublicCommand::Move { x, y, seq: None });
                }
            }
        }
    }
}

/// Panics on its N-th decision (fault injection).
pub struct Panicky(pub u32);
impl Policy for Panicky {
    fn spec(&self) -> PolicySpec {
        spec("panicky", 1)
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        if self.0 == 0 {
            panic!("test policy failure");
        }
        self.0 -= 1;
        Vec::new()
    }
}

/// Sleeps before answering (deadline tests).
pub struct Slow(pub std::time::Duration);
impl Policy for Slow {
    fn spec(&self) -> PolicySpec {
        spec("slow", 1)
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        std::thread::sleep(self.0);
        vec![PublicCommand::Stop { seq: None }]
    }
}

/// Proposes far more commands than any player may give (budget and queue caps must hold).
pub struct Flood;
impl Policy for Flood {
    fn spec(&self) -> PolicySpec {
        spec("flood", 1)
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        let mut v = Vec::new();
        for i in 0..100 {
            v.push(PublicCommand::Attack {
                a: i as f64 * 0.01,
                t: Some(obs.server_time),
            });
            v.push(PublicCommand::Move {
                x: 100.0 + i as f64,
                y: 100.0,
                seq: None,
            });
            v.push(PublicCommand::Aim { a: f64::NAN });
        }
        v
    }
}
