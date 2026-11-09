//! Complete source tactics/world.ts roam, idle and non-coliseum hold branches.
//! Loot and coliseum hold require their own complete consumers, not guessed inputs.
use super::brain::{Goal, Output, Status};
use super::types::{Intent, IntentBody, IntentTiming, PRIORITY_CHORE, PRIORITY_GOAL};
use rh_sim::Vec2;

#[derive(Clone, Copy)]
pub struct Context {
    pub now: f64,
    pub at: Vec2,
    pub still_since: f64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
enum Key {
    Idle,
    Hold(&'static str, i64, i64),
}
#[derive(Clone, Debug)]
struct Slot {
    key: Key,
    last_act_at: f64,
    stop_at: Option<f64>,
}
#[derive(Default)]
pub struct WorldTactics {
    slots: Vec<Slot>,
}
fn output(intents: Vec<Intent>, status: Status, why: &'static str) -> Output {
    Output {
        intents,
        status,
        why,
        attacking: false,
    }
}
impl WorldTactics {
    pub fn reset(&mut self) {
        self.slots.clear();
    }
    /// None means this executor does not implement the goal. It never substitutes an idle result.
    pub fn act(
        &mut self,
        goal: &Goal,
        ctx: Context,
        mut walkable: impl FnMut(Vec2, Vec2) -> bool,
    ) -> Option<Output> {
        let (key, why) = match goal {
            Goal::Roam { to, .. } => {
                let d = rh_sim::math::hypot(ctx.at.x - to.x, ctx.at.y - to.y);
                return Some(if d <= 48. {
                    output(vec![], Status::Done, "arrived")
                } else if d <= 150. && ctx.now - ctx.still_since >= 1200. {
                    output(vec![], Status::Done, "close enough")
                } else if !walkable(ctx.at, *to) {
                    output(vec![], Status::Failed, "unreachable")
                } else {
                    output(
                        vec![Intent {
                            body: IntentBody::Move { to: *to },
                            priority: PRIORITY_GOAL,
                            timing: IntentTiming::Step {},
                            why: "roam".into(),
                        }],
                        Status::Running,
                        "walking",
                    )
                });
            }
            Goal::Idle => (Key::Idle, "idle".to_owned()),
            Goal::Hold { at, why } if *why != "coliseum" => (
                Key::Hold(
                    why,
                    (at.x / 16. + 0.5).floor() as i64,
                    (at.y / 16. + 0.5).floor() as i64,
                ),
                format!("hold ({why})"),
            ),
            _ => return None,
        };
        self.slots.retain(|s| ctx.now - s.last_act_at <= 3000.);
        let i = self
            .slots
            .iter()
            .position(|s| s.key == key)
            .unwrap_or_else(|| {
                self.slots.push(Slot {
                    key,
                    last_act_at: ctx.now,
                    stop_at: None,
                });
                self.slots.len() - 1
            });
        let slot = &mut self.slots[i];
        slot.last_act_at = ctx.now;
        let moving = ctx.now - ctx.still_since < 150.;
        let send = slot.stop_at.is_none_or(|t| moving && ctx.now - t >= 800.);
        let intents = if send {
            slot.stop_at = Some(ctx.now);
            vec![Intent {
                body: IntentBody::Stop {},
                priority: PRIORITY_CHORE,
                timing: IntentTiming::Step {},
                why,
            }]
        } else {
            vec![]
        };
        Some(output(
            intents,
            Status::Running,
            if matches!(goal, Goal::Idle) {
                "idle"
            } else {
                "holding"
            },
        ))
    }
}
#[cfg(test)]
mod tests;
