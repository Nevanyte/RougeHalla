//! Player commands, their validation, the per-tick input queue and the order budget. Every source of actions (a human over the
//! network, a scripted bot, a future learned policy) goes through [`validate`], the [`OrderBudget`] and the same
//! [`InputQueue`], so nobody gets extra actions per simulated second (docs/CONTRACTS.md C-INPUT).
//!
//! Nothing else enqueues a command: `push` is private to this module and [`accept`] is the one function that reaches it.
//! `accept` has one caller, `systems::inputs::submit`, which both `Sim::submit` (network clients, scripted bots, policies)
//! and `Cx::submit` (an actor inside the tick, such as a future mob brain) run. The queue's fields are crate-visible (the
//! hash and the checkpoint read them), and `drain` also empties it (the tick's input phase, the lobby's start and a
//! finished match's `drain_all`); only `accept` adds to it.

use crate::constants::{MAX_ACTIONS_PER_TICK, ORDER_BURST, ORDER_PER_SECOND, WORLD_H, WORLD_W};
use crate::math::wrap_angle;
use crate::state::Player;

/// A command as it arrives (decoded from the wire or proposed by a policy), not yet validated.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum RawCommand {
    /// Walk to a point (right click / WASD goal). `seq` is echoed in the player's `move_seq` once applied.
    Move {
        x: f64,
        y: f64,
        seq: Option<u8>,
    },
    Stop {
        seq: Option<u8>,
    },
    /// Cursor aim (radians).
    Aim {
        a: f64,
    },
    /// Press the trigger toward `a`; `t` is the client's render time (lag compensation), clamped by the server.
    Attack {
        a: f64,
        t: Option<f64>,
    },
    Release {
        a: f64,
        t: Option<f64>,
    },
}

/// A validated command: points finite and clamped to the world, angles finite and wrapped.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum Command {
    Move { x: f64, y: f64, seq: Option<u8> },
    Stop { seq: Option<u8> },
    Aim { a: f64 },
    Attack { a: f64, t: Option<f64> },
    Release { a: f64, t: Option<f64> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reject {
    NonFinite,
    /// Over the seat's order budget (dropped silently on the wire, counted for diagnostics).
    OverBudget,
    /// The input queue already holds MAX_ACTIONS_PER_TICK actions this tick.
    QueueFull,
}

/// Legacy `enqueueClientMessage` rules: a non-finite point or angle rejects the command; a non-finite render time only costs
/// the attacker lag compensation (the command still counts).
pub fn validate(raw: RawCommand) -> Result<Command, Reject> {
    let clamp_pt = |x: f64, y: f64| -> Result<(f64, f64), Reject> {
        if !x.is_finite() || !y.is_finite() {
            return Err(Reject::NonFinite);
        }
        Ok((x.clamp(0.0, WORLD_W), y.clamp(0.0, WORLD_H)))
    };
    let angle = |a: f64| {
        if a.is_finite() {
            Ok(wrap_angle(a))
        } else {
            Err(Reject::NonFinite)
        }
    };
    let time = |t: Option<f64>| t.filter(|v| v.is_finite());
    Ok(match raw {
        RawCommand::Move { x, y, seq } => {
            let (x, y) = clamp_pt(x, y)?;
            Command::Move { x, y, seq }
        }
        RawCommand::Stop { seq } => Command::Stop { seq },
        RawCommand::Aim { a } => Command::Aim { a: angle(a)? },
        RawCommand::Attack { a, t } => Command::Attack {
            a: angle(a)?,
            t: time(t),
        },
        RawCommand::Release { a, t } => Command::Release {
            a: angle(a)?,
            t: time(t),
        },
    })
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) enum MoveCmd {
    Move { x: f64, y: f64, seq: Option<u8> },
    Stop { seq: Option<u8> },
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) enum ActionCmd {
    Attack { a: f64, t: Option<f64> },
    Release { a: f64, t: Option<f64> },
}

/// The actions queued for one tick: the first `len` of `MAX_ACTIONS_PER_TICK` inline slots (the cap is a constant, so the
/// heap buys nothing). Serialized, compared and hashed as the plain sequence of the queued actions, as the `Vec` it replaces
/// was; the slots past `len` are dead data and never observed.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ActionBuf {
    items: [ActionCmd; MAX_ACTIONS_PER_TICK],
    len: u8,
}

impl Default for ActionBuf {
    fn default() -> Self {
        const { assert!(MAX_ACTIONS_PER_TICK <= u8::MAX as usize) };
        Self {
            items: [ActionCmd::Release { a: 0.0, t: None }; MAX_ACTIONS_PER_TICK],
            len: 0,
        }
    }
}

impl ActionBuf {
    pub(crate) fn len(&self) -> usize {
        self.len as usize
    }
    pub(crate) fn as_slice(&self) -> &[ActionCmd] {
        &self.items[..self.len()]
    }
    pub(crate) fn get(&self, i: usize) -> Option<&ActionCmd> {
        self.as_slice().get(i)
    }
    fn push(&mut self, cmd: ActionCmd) -> bool {
        if self.len() >= MAX_ACTIONS_PER_TICK {
            return false;
        }
        self.items[self.len()] = cmd;
        self.len += 1;
        true
    }
}

impl PartialEq for ActionBuf {
    fn eq(&self, o: &Self) -> bool {
        self.as_slice() == o.as_slice()
    }
}

impl serde::Serialize for ActionBuf {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(self.as_slice())
    }
}

impl<'de> serde::Deserialize<'de> for ActionBuf {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = Vec::<ActionCmd>::deserialize(d)?;
        let mut b = ActionBuf::default();
        for cmd in v {
            if !b.push(cmd) {
                return Err(serde::de::Error::custom(format!(
                    "more than {MAX_ACTIONS_PER_TICK} queued actions"
                )));
            }
        }
        Ok(b)
    }
}

/// One fighter's commands for the next tick, in arrival order (legacy `InputQueue`): the latest move and the latest aim win,
/// each remembering how many actions had arrived before it so orders replace each other in arrival order. The fields are
/// readable inside the crate (the state hash reads their shape); only [`accept`] writes them.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct InputQueue {
    pub(crate) mv: Option<MoveCmd>,
    pub(crate) move_before: usize,
    pub(crate) aim: Option<f64>,
    pub(crate) aim_before: usize,
    pub(crate) actions: ActionBuf,
    pub(crate) dropped: u32,
}

pub(crate) struct Drained {
    pub(crate) mv: Option<MoveCmd>,
    pub(crate) move_before: usize,
    pub(crate) aim: Option<f64>,
    pub(crate) aim_before: usize,
    pub(crate) actions: ActionBuf,
}

/// The seat's intake (C-INPUT): a validated command spends the seat's order budget (unless `budgeted` is false, the
/// parity harness only: the legacy capture fed the sim directly) and joins its queue with the arrival-order rules. The
/// only function that writes an [`InputQueue`] outside this module's tests.
pub(crate) fn accept(
    p: &mut Player,
    cmd: Command,
    now_ms: f64,
    budgeted: bool,
) -> Result<(), Reject> {
    if budgeted && !p.budget.allow(&cmd, now_ms) {
        return Err(Reject::OverBudget);
    }
    p.inputs.push(cmd)
}

impl InputQueue {
    fn push(&mut self, cmd: Command) -> Result<(), Reject> {
        match cmd {
            Command::Move { x, y, seq } => {
                self.mv = Some(MoveCmd::Move { x, y, seq });
                self.move_before = self.actions.len();
            }
            Command::Stop { seq } => {
                self.mv = Some(MoveCmd::Stop { seq });
                self.move_before = self.actions.len();
            }
            Command::Aim { a } => {
                self.aim = Some(a);
                self.aim_before = self.actions.len();
            }
            Command::Attack { a, t } => return self.push_action(ActionCmd::Attack { a, t }),
            Command::Release { a, t } => return self.push_action(ActionCmd::Release { a, t }),
        }
        Ok(())
    }

    fn push_action(&mut self, cmd: ActionCmd) -> Result<(), Reject> {
        if !self.actions.push(cmd) {
            self.dropped += 1;
            return Err(Reject::QueueFull);
        }
        Ok(())
    }

    pub(crate) fn drain(&mut self) -> Drained {
        let out = Drained {
            mv: self.mv.take(),
            move_before: self.move_before,
            aim: self.aim.take(),
            aim_before: self.aim_before,
            actions: self.actions,
        };
        self.clear();
        out
    }

    /// Drops everything queued without handing it out (a lobby, a finished match, a dropped connection).
    pub(crate) fn clear(&mut self) {
        self.mv = None;
        self.aim = None;
        self.actions.len = 0;
        self.move_before = 0;
        self.aim_before = 0;
    }
}

/// Token bucket on SIM time (deterministic: live and headless agree): `ORDER_BURST` tokens, refilled at `ORDER_PER_SECOND`;
/// every command but `Aim` spends one (the legacy order budget, which the legacy server applied to human sockets only).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct OrderBudget {
    tokens: f64,
    at_ms: f64,
}

impl Default for OrderBudget {
    fn default() -> Self {
        Self {
            tokens: ORDER_BURST,
            at_ms: 0.0,
        }
    }
}

impl OrderBudget {
    /// (tokens, last refill time) for the state hash.
    pub fn state(&self) -> (f64, f64) {
        (self.tokens, self.at_ms)
    }

    pub fn allow(&mut self, cmd: &Command, now_ms: f64) -> bool {
        if matches!(cmd, Command::Aim { .. }) {
            return true;
        }
        if now_ms > self.at_ms {
            self.tokens =
                ORDER_BURST.min(self.tokens + (now_ms - self.at_ms) / 1000.0 * ORDER_PER_SECOND);
            self.at_ms = now_ms;
        }
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_clamps_and_rejects() {
        assert_eq!(
            validate(RawCommand::Move {
                x: -50.0,
                y: 99999.0,
                seq: None
            }),
            Ok(Command::Move {
                x: 0.0,
                y: WORLD_H,
                seq: None
            })
        );
        assert_eq!(
            validate(RawCommand::Aim { a: f64::NAN }),
            Err(Reject::NonFinite)
        );
        assert_eq!(
            validate(RawCommand::Attack {
                a: 0.0,
                t: Some(f64::INFINITY)
            }),
            Ok(Command::Attack { a: 0.0, t: None })
        );
        let Command::Aim { a } = validate(RawCommand::Aim { a: 7.0 }).unwrap() else {
            panic!()
        };
        assert!(a > -std::f64::consts::PI && a <= std::f64::consts::PI);
    }

    #[test]
    fn queue_caps_actions_per_tick() {
        let mut q = InputQueue::default();
        for _ in 0..MAX_ACTIONS_PER_TICK {
            q.push(Command::Attack { a: 0.0, t: None }).unwrap();
        }
        assert_eq!(
            q.push(Command::Attack { a: 0.0, t: None }),
            Err(Reject::QueueFull)
        );
        assert_eq!(q.drain().actions.len(), MAX_ACTIONS_PER_TICK);
    }

    #[test]
    fn budget_refills_on_sim_time() {
        let mut b = OrderBudget::default();
        let mv = Command::Stop { seq: None };
        let allowed = (0..40).filter(|_| b.allow(&mv, 0.0)).count();
        assert_eq!(allowed, 30);
        assert!(
            b.allow(&Command::Aim { a: 0.0 }, 0.0),
            "aim never spends a token"
        );
        assert!(!b.allow(&mv, 50.0), "0.75 token after 50 ms");
        assert!(b.allow(&mv, 100.0));
    }
}
