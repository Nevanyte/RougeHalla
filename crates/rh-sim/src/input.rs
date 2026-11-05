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

/// A proposal from a public seat. Pickup names an issued item handle; target names an actor
/// from the viewer’s most recently delivered complete observation.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum PublicCommand {
    Target {
        actor: crate::PlayerId,
    },
    /// Walk to a point (right click / WASD goal). `seq` is echoed in the player's `move_seq` once applied.
    Move {
        x: f64,
        y: f64,
        seq: Option<u8>,
    },
    AttackMove {
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
    Swap {
        slot: Option<u8>,
    },
    Pickup {
        handle: crate::PickupHandle,
    },
}

/// Trusted fixture/replay-side proposal. Public seats use [`PublicCommand`].
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum RawCommand {
    Target {
        id: crate::PlayerId,
    },
    MissingTarget,
    /// Walk to a point (right click / WASD goal). `seq` is echoed in the player's `move_seq` once applied.
    Move {
        x: f64,
        y: f64,
        seq: Option<u8>,
    },
    AttackMove {
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
    Swap {
        slot: Option<u8>,
    },
    Pickup {
        container_id: u32,
    },
    /// A nonzero public handle did not resolve at intake. Still spends the normal budget.
    MissingPickup,
}

/// A validated command: points finite and clamped to the world, angles finite and wrapped. Opaque on purpose: the only
/// ways to hold one are [`validate`] and decoding (a replay), which runs [`validate`] again and refuses anything it would
/// change, so no code path (a test fixture, an edited replay) can hand the sim an unvalidated command (C-INPUT). It
/// serializes as the plain variant it wraps, so recorded replays keep their shape.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(transparent)]
pub struct Command(Kind);

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
enum Kind {
    Target { id: crate::PlayerId },
    MissingTarget,
    AttackMove { x: f64, y: f64, seq: Option<u8> },
    Move { x: f64, y: f64, seq: Option<u8> },
    Stop { seq: Option<u8> },
    Aim { a: f64 },
    Attack { a: f64, t: Option<f64> },
    Release { a: f64, t: Option<f64> },
    Swap { slot: Option<u8> },
    Pickup { container_id: u32 },
    MissingPickup,
}

impl PublicCommand {
    /// All ordinary proposals and resolved exact targets pass through the existing validator.
    pub(crate) fn resolve(
        self,
        lookup: impl FnOnce(crate::PickupHandle) -> Option<u32>,
        seen: impl FnOnce(crate::PlayerId) -> bool,
    ) -> Result<Command, Reject> {
        validate(match self {
            Self::Target { actor } if actor.0 == 0 => return Err(Reject::InvalidTarget),
            Self::Target { actor } => {
                if seen(actor) {
                    RawCommand::Target { id: actor }
                } else {
                    RawCommand::MissingTarget
                }
            }
            Self::AttackMove { x, y, seq } => RawCommand::AttackMove { x, y, seq },
            Self::Pickup { handle } => match lookup(handle) {
                Some(container_id) => RawCommand::Pickup { container_id },
                None => RawCommand::MissingPickup,
            },
            Self::Move { x, y, seq } => RawCommand::Move { x, y, seq },
            Self::Stop { seq } => RawCommand::Stop { seq },
            Self::Aim { a } => RawCommand::Aim { a },
            Self::Attack { a, t } => RawCommand::Attack { a, t },
            Self::Release { a, t } => RawCommand::Release { a, t },
            Self::Swap { slot } => RawCommand::Swap { slot },
        })
    }
}

impl Kind {
    fn raw(self) -> RawCommand {
        match self {
            Kind::Target { id } => RawCommand::Target { id },
            Kind::MissingTarget => RawCommand::MissingTarget,
            Kind::AttackMove { x, y, seq } => RawCommand::AttackMove { x, y, seq },
            Kind::MissingPickup => RawCommand::MissingPickup,
            Kind::Swap { slot } => RawCommand::Swap { slot },
            Kind::Pickup { container_id } => RawCommand::Pickup { container_id },
            Kind::Move { x, y, seq } => RawCommand::Move { x, y, seq },
            Kind::Stop { seq } => RawCommand::Stop { seq },
            Kind::Aim { a } => RawCommand::Aim { a },
            Kind::Attack { a, t } => RawCommand::Attack { a, t },
            Kind::Release { a, t } => RawCommand::Release { a, t },
        }
    }
}

impl<'de> serde::Deserialize<'de> for Command {
    /// A decoded command is validated again, and one that validation would alter (an angle out of range, a point outside
    /// the world, a non-finite number) or reject is refused: what is stored is what `validate` produced.
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let kind = Kind::deserialize(d)?;
        match validate(kind.raw()) {
            Ok(c) if c.0 == kind => Ok(c),
            Ok(_) => Err(serde::de::Error::custom(
                "command was not produced by validation (out of range)",
            )),
            Err(r) => Err(serde::de::Error::custom(format!(
                "command is not valid: {r:?}"
            ))),
        }
    }
}

/// A valid command for a unit test (the one door in is [`validate`], tests included).
#[cfg(test)]
pub(crate) fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reject {
    InvalidTarget,
    NonFinite,
    InvalidSlot,
    InvalidContainer,
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
    Ok(Command(match raw {
        RawCommand::Swap { slot } if slot.is_some_and(|i| i > 1) => {
            return Err(Reject::InvalidSlot)
        }
        RawCommand::Target { id } if id.0 == 0 => return Err(Reject::InvalidTarget),
        RawCommand::Target { id } => Kind::Target { id },
        RawCommand::MissingTarget => Kind::MissingTarget,
        RawCommand::AttackMove { x, y, seq } => {
            let (x, y) = clamp_pt(x, y)?;
            Kind::AttackMove { x, y, seq }
        }
        RawCommand::MissingPickup => Kind::MissingPickup,
        RawCommand::Pickup { container_id: 0 } => return Err(Reject::InvalidContainer),
        RawCommand::Swap { slot } => Kind::Swap { slot },
        RawCommand::Pickup { container_id } => Kind::Pickup { container_id },
        RawCommand::Move { x, y, seq } => {
            let (x, y) = clamp_pt(x, y)?;
            Kind::Move { x, y, seq }
        }
        RawCommand::Stop { seq } => Kind::Stop { seq },
        RawCommand::Aim { a } => Kind::Aim { a: angle(a)? },
        RawCommand::Attack { a, t } => Kind::Attack {
            a: angle(a)?,
            t: time(t),
        },
        RawCommand::Release { a, t } => Kind::Release {
            a: angle(a)?,
            t: time(t),
        },
    }))
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) enum MoveCmd {
    AttackMove { x: f64, y: f64, seq: Option<u8> },
    Move { x: f64, y: f64, seq: Option<u8> },
    Stop { seq: Option<u8> },
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) enum ActionCmd {
    Target { id: crate::PlayerId },
    MissingTarget,
    Attack { a: f64, t: Option<f64> },
    Release { a: f64, t: Option<f64> },
    Swap { slot: Option<u8> },
    Pickup { container_id: u32 },
    MissingPickup,
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
    /// Becomes a copy of `o`, moving only the queued actions (not the whole inline array).
    fn copy_from(&mut self, o: &ActionBuf) {
        let n = o.len();
        self.items[..n].copy_from_slice(&o.items[..n]);
        self.len = o.len;
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

impl InputQueue {
    /// Whether every queued value is one [`validate`] produced (finite, clamped, wrapped): the rule [`Command`]'s decoder
    /// applies, for a checkpoint taken between a submit and the step.
    pub(crate) fn check(&self) -> Result<(), String> {
        let same = |raw: RawCommand, kind: Kind| match validate(raw) {
            Ok(c) if c.0 == kind => Ok(()),
            _ => Err(format!("queued input {kind:?} is not a validated command")),
        };
        if let Some(MoveCmd::Move { x, y, seq }) = self.mv {
            same(RawCommand::Move { x, y, seq }, Kind::Move { x, y, seq })?;
        }
        if let Some(MoveCmd::AttackMove { x, y, seq }) = self.mv {
            same(
                RawCommand::AttackMove { x, y, seq },
                Kind::AttackMove { x, y, seq },
            )?;
        }
        if let Some(a) = self.aim {
            same(RawCommand::Aim { a }, Kind::Aim { a })?;
        }
        for act in self.actions.as_slice() {
            match *act {
                ActionCmd::Target { id } => same(RawCommand::Target { id }, Kind::Target { id })?,
                ActionCmd::MissingTarget => same(RawCommand::MissingTarget, Kind::MissingTarget)?,
                ActionCmd::MissingPickup => same(RawCommand::MissingPickup, Kind::MissingPickup)?,
                ActionCmd::Swap { slot } => same(RawCommand::Swap { slot }, Kind::Swap { slot })?,
                ActionCmd::Pickup { container_id } => same(
                    RawCommand::Pickup { container_id },
                    Kind::Pickup { container_id },
                )?,
                ActionCmd::Attack { a, t } => {
                    same(RawCommand::Attack { a, t }, Kind::Attack { a, t })?
                }
                ActionCmd::Release { a, t } => {
                    same(RawCommand::Release { a, t }, Kind::Release { a, t })?
                }
            }
        }
        Ok(())
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

#[derive(Debug, Default)]
pub(crate) struct Drained {
    pub(crate) mv: Option<MoveCmd>,
    pub(crate) move_before: usize,
    pub(crate) aim: Option<f64>,
    pub(crate) aim_before: usize,
    pub(crate) actions: ActionBuf,
}

/// The intake (C-INPUT): a validated command spends the order budget it is given (`None`: an actor with no seat, or the
/// parity harness, whose legacy capture fed the sim directly) and joins the queue with the arrival-order rules. The only
/// function that writes an [`InputQueue`] outside this module's tests.
pub(crate) fn accept(
    queue: &mut InputQueue,
    budget: Option<&mut OrderBudget>,
    cmd: Command,
    now_ms: f64,
) -> Result<(), Reject> {
    if budget.is_some_and(|b| !b.allow(&cmd, now_ms)) {
        return Err(Reject::OverBudget);
    }
    queue.push(cmd)
}

impl InputQueue {
    fn push(&mut self, cmd: Command) -> Result<(), Reject> {
        match cmd.0 {
            Kind::Move { x, y, seq } => {
                self.mv = Some(MoveCmd::Move { x, y, seq });
                self.move_before = self.actions.len();
            }
            Kind::AttackMove { x, y, seq } => {
                self.mv = Some(MoveCmd::AttackMove { x, y, seq });
                self.move_before = self.actions.len();
            }
            Kind::Target { id } => return self.push_action(ActionCmd::Target { id }),
            Kind::MissingTarget => return self.push_action(ActionCmd::MissingTarget),
            Kind::Stop { seq } => {
                self.mv = Some(MoveCmd::Stop { seq });
                self.move_before = self.actions.len();
            }
            Kind::Aim { a } => {
                self.aim = Some(a);
                self.aim_before = self.actions.len();
            }
            Kind::MissingPickup => return self.push_action(ActionCmd::MissingPickup),
            Kind::Swap { slot } => return self.push_action(ActionCmd::Swap { slot }),
            Kind::Pickup { container_id } => {
                return self.push_action(ActionCmd::Pickup { container_id })
            }
            Kind::Attack { a, t } => return self.push_action(ActionCmd::Attack { a, t }),
            Kind::Release { a, t } => return self.push_action(ActionCmd::Release { a, t }),
        }
        Ok(())
    }

    fn push_action(&mut self, cmd: ActionCmd) -> Result<(), Reject> {
        if !self.actions.push(cmd) {
            self.dropped = self.dropped.saturating_add(1);
            return Err(Reject::QueueFull);
        }
        Ok(())
    }

    /// [`InputQueue::drain_into`] for a caller that wants the queue by value (tests).
    #[cfg(test)]
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

    /// [`InputQueue::drain`] into a reused buffer, copying only the queued actions: the tick's input phase (a drain in place,
    /// since each fighter's queue is applied while the world is borrowed by the handlers).
    pub(crate) fn drain_into(&mut self, out: &mut Drained) {
        out.mv = self.mv;
        out.move_before = self.move_before;
        out.aim = self.aim;
        out.aim_before = self.aim_before;
        out.actions.copy_from(&self.actions);
        self.clear();
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
        if matches!(cmd.0, Kind::Aim { .. }) {
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
            Ok(cmd(RawCommand::Move {
                x: 0.0,
                y: WORLD_H,
                seq: None
            }))
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
            Ok(cmd(RawCommand::Attack { a: 0.0, t: None }))
        );
        let wrapped = 7.0 - 2.0 * std::f64::consts::PI;
        assert!(wrapped > -std::f64::consts::PI && wrapped <= std::f64::consts::PI);
        assert_eq!(
            validate(RawCommand::Aim { a: 7.0 }),
            Ok(cmd(RawCommand::Aim { a: wrapped }))
        );
    }

    #[test]
    fn a_command_decodes_only_as_validation_made_it() {
        let valid = [
            RawCommand::Move {
                x: 10.5,
                y: 20.25,
                seq: Some(3),
            },
            RawCommand::Stop { seq: None },
            RawCommand::Aim { a: -3.0 },
            RawCommand::Attack {
                a: 2.75,
                t: Some(1234.5),
            },
            RawCommand::Release { a: 0.0, t: None },
        ];
        for raw in valid {
            let c = cmd(raw);
            let json = serde_json::to_value(c).unwrap();
            // Serialized as the bare variant, so recorded replays keep their shape.
            assert!(json.is_object(), "{json}");
            assert_eq!(serde_json::from_value::<Command>(json).unwrap(), c);
        }
        let json = serde_json::json!({"Move": {"x": 1.0, "y": 2.0, "seq": 7}});
        assert_eq!(
            serde_json::from_value::<Command>(json).unwrap(),
            cmd(RawCommand::Move {
                x: 1.0,
                y: 2.0,
                seq: Some(7)
            })
        );
        // What validation would alter is refused, not silently repaired.
        for bad in [
            serde_json::json!({"Move": {"x": -5.0, "y": 2.0, "seq": null}}),
            serde_json::json!({"Move": {"x": 1.0, "y": 1e9, "seq": null}}),
            serde_json::json!({"Aim": {"a": 9.0}}),
            serde_json::json!({"Attack": {"a": -4.0, "t": null}}),
            serde_json::json!({"Release": {"a": 100.0, "t": 1.0}}),
        ] {
            assert!(
                serde_json::from_value::<Command>(bad.clone()).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn queue_caps_actions_per_tick() {
        let mut q = InputQueue::default();
        for _ in 0..MAX_ACTIONS_PER_TICK {
            q.push(cmd(RawCommand::Attack { a: 0.0, t: None })).unwrap();
        }
        assert_eq!(
            q.push(cmd(RawCommand::Attack { a: 0.0, t: None })),
            Err(Reject::QueueFull)
        );
        assert_eq!(q.drain().actions.len(), MAX_ACTIONS_PER_TICK);
    }

    #[test]
    fn the_inline_queue_serializes_as_the_sequence_it_replaced() {
        let mut q = InputQueue::default();
        q.push(cmd(RawCommand::Attack { a: 1.0, t: None })).unwrap();
        q.push(cmd(RawCommand::Release {
            a: 2.0,
            t: Some(5.0),
        }))
        .unwrap();
        let want = vec![
            ActionCmd::Attack { a: 1.0, t: None },
            ActionCmd::Release {
                a: 2.0,
                t: Some(5.0),
            },
        ];
        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["actions"], serde_json::to_value(&want).unwrap());
        let back: InputQueue = serde_json::from_value(json).unwrap();
        assert_eq!(back, q);
        // Slots past the length are dead data: a drained-and-refilled queue equals a fresh one with the same actions.
        let mut used = InputQueue::default();
        for _ in 0..MAX_ACTIONS_PER_TICK {
            used.push(cmd(RawCommand::Attack { a: 9.0, t: None }))
                .unwrap();
        }
        used.clear();
        used.push(cmd(RawCommand::Attack { a: 1.0, t: None }))
            .unwrap();
        used.push(cmd(RawCommand::Release {
            a: 2.0,
            t: Some(5.0),
        }))
        .unwrap();
        assert_eq!(used.actions, q.actions);
        // A checkpoint with more actions than a tick may queue is refused.
        let too_many = serde_json::json!({
            "mv": null, "move_before": 0, "aim": null, "aim_before": 0, "dropped": 0,
            "actions": vec![serde_json::to_value(ActionCmd::Release { a: 0.0, t: None }).unwrap(); MAX_ACTIONS_PER_TICK + 1],
        });
        assert!(serde_json::from_value::<InputQueue>(too_many).is_err());
    }

    #[test]
    fn budget_refills_on_sim_time() {
        let mut b = OrderBudget::default();
        let mv = cmd(RawCommand::Stop { seq: None });
        let allowed = (0..40).filter(|_| b.allow(&mv, 0.0)).count();
        assert_eq!(allowed, 30);
        assert!(
            b.allow(&cmd(RawCommand::Aim { a: 0.0 }), 0.0),
            "aim never spends a token"
        );
        assert!(!b.allow(&mv, 50.0), "0.75 token after 50 ms");
        assert!(b.allow(&mv, 100.0));
    }
}
