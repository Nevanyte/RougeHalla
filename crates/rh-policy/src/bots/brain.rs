//! Source brain.ts scheduling and goal lifecycle. Candidate selection remains the explicitly
//! bounded HumanBot compatibility front end; this is not the complete source strategy.
use super::random::{uniform, Rng};
use super::types::{Intent, IntentChannel, Stimulus, StimulusKind, TierParams};
use rh_sim::Vec2;

#[derive(Clone, Debug, PartialEq)]
pub enum Goal {
    Idle,
    Roam {
        to: Vec2,
        why: &'static str,
    },
    Hold {
        at: Vec2,
        why: &'static str,
    },
    Fight {
        target: String,
    },
    Farm {
        target: String,
    },
    WishSlip,
    /// World tactics LOOT (world.ts actLoot): a container under its public cue key (bots::loot).
    Loot {
        container: String,
    },
    /// The chests module goal (chests.ts act): a reward chest under its public cue key (bots::loot).
    Chest {
        chest: String,
    },
}
impl Goal {
    fn same_key(&self, other: &Self) -> bool {
        let cell = |x: f64| ((x / (3. * rh_sim::constants::TILE)) + 0.5).floor() as i64;
        match (self, other) {
            (Self::Idle, Self::Idle) | (Self::WishSlip, Self::WishSlip) => true,
            (Self::Roam { to: a, why: x }, Self::Roam { to: b, why: y }) => {
                x == y && cell(a.x) == cell(b.x) && cell(a.y) == cell(b.y)
            }
            (Self::Hold { why: a, .. }, Self::Hold { why: b, .. }) => a == b,
            (Self::Fight { target: a }, Self::Fight { target: b })
            | (Self::Farm { target: a }, Self::Farm { target: b }) => a == b,
            (Self::Loot { container: a }, Self::Loot { container: b })
            | (Self::Chest { chest: a }, Self::Chest { chest: b }) => a == b,
            _ => false,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Running,
    Done,
    Failed,
    Blocked,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Output {
    pub intents: Vec<Intent>,
    pub status: Status,
    pub why: &'static str,
    pub attacking: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Brain {
    pub goal: Goal,
    pub status: Status,
    pub attacking: bool,
    started: bool,
    next_strategy_at: f64,
    next_think_at: f64,
}
impl Default for Brain {
    fn default() -> Self {
        Self {
            goal: Goal::Idle,
            status: Status::Running,
            attacking: false,
            started: false,
            next_strategy_at: 0.,
            next_think_at: 0.,
        }
    }
}
impl Brain {
    /// Called only for a live, active accepted percept. Every other phase still releases the hand.
    pub fn strategy_due(&self, now: f64, stimuli: &[Stimulus]) -> bool {
        !self.started
            || now >= self.next_strategy_at
            || self.status != Status::Running
            || stimuli.iter().any(|s| {
                matches!(
                    s.kind,
                    StimulusKind::NewThreat
                        | StimulusKind::LowHp
                        | StimulusKind::Teleport
                        | StimulusKind::TargetDown
                        | StimulusKind::Announcement
                        | StimulusKind::ChestUp
                        | StimulusKind::PlanOffer
                        | StimulusKind::LockLost
                )
            })
    }
    /// Source strategy runs before its cadence draw; adoption happens after that draw.
    pub fn adopt(&mut self, goal: Goal, now: f64, tier: &TierParams, rng: &mut Rng) -> bool {
        let first = !self.started;
        self.started = true;
        self.status = Status::Running;
        self.next_strategy_at = now
            + uniform(
                rng,
                tier.strategy_ms.mean - tier.strategy_ms.jitter,
                tier.strategy_ms.mean + tier.strategy_ms.jitter,
            );
        let changed = !self.goal.same_key(&goal);
        self.goal = goal;
        if changed {
            self.attacking = false;
        }
        changed || first
    }
    pub fn tactics_due(&self, now: f64, changed: bool, toast: bool, stimuli: &[Stimulus]) -> bool {
        changed || toast || !stimuli.is_empty() || now >= self.next_think_at
    }
    pub fn acted(&mut self, now: f64, output: &Output, tier: &TierParams, rng: &mut Rng) {
        self.status = output.status;
        self.attacking = output.attacking;
        self.next_think_at = now
            + uniform(
                rng,
                tier.think_ms.mean - tier.think_ms.jitter,
                tier.think_ms.mean + tier.think_ms.jitter,
            )
            .min(2000.);
    }
}
/// Source mergeIntents: first extra per channel wins; cast/menu override, other channels
/// replace only with strictly better (numerically lower) priority. No draw or command is sent here.
pub fn merge_intents(mut base: Vec<Intent>, extra: Vec<Intent>) -> Vec<Intent> {
    let mut claimed = Vec::new();
    for intent in extra {
        let ch = intent.kind().channel();
        if claimed.contains(&ch) {
            continue;
        }
        if let Some(at) = base.iter().position(|i| i.kind().channel() == ch) {
            if matches!(ch, IntentChannel::Cast | IntentChannel::Menu)
                || intent.priority < base[at].priority
            {
                base[at] = intent;
                claimed.push(ch);
            }
        } else {
            base.push(intent);
            claimed.push(ch);
        }
    }
    base
}

#[cfg(test)]
mod tests;
