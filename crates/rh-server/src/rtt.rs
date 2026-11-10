//! Server-measured round-trip time and the rewind window it allows (P-NET-1 Phase 3).
//!
//! The client's attack `t` is its render time and cannot be verified. What the server can measure itself is the round trip
//! of its own connection: the connection writer sends WebSocket control Ping frames carrying an 8-byte monotonic payload,
//! and the reader turns a matching Pong into `now - payload`. No client-claimed latency is trusted.
//!
//! [`RttEstimator`] smooths those samples (an EWMA), floors them so one lucky sample cannot collapse the window, and
//! ceilings them so an absurd sample cannot matter beyond the protocol's existing rewind cap. The clamp itself is applied
//! at room intake (`RoomCmd::Input`, before `Sim::submit`), so the simulation keeps its historical `lag = now - t`
//! clamp in `weapons::note_lag`; this module only decides what `t` the simulation may see.
//!
//! Formula:
//!
//! `allowed = clamp(smoothed_rtt_ms + RENDER_DELAY_ALLOWANCE_MS + TICK_MS + INTAKE_SLACK_MS, TICK_MS, MAX_REWIND_MS)`
//!
//! and a render time is clamped into `[now_apply - allowed, now_apply]`, where `now_apply` is the server time of the step
//! that will apply the command (the current sim time plus one tick). A future `t` is clamped like an old one.
//!
//! Why the full RTT (derivation from the code, not measured). The room stamps each snapshot with the sim time `S_k` of the
//! step it just ran. The Unity `RenderClock` records `d = local_poll - S_k` per snapshot and keeps `minD`, the smallest,
//! which is the clock offset plus the fastest downlink `down_min`. Each frame it sets `render = local - minD - delay`, where
//! `delay` is its interpolation delay (`RenderClock.MinDelayMs..MaxDelayMs`, 70..150 ms, starting at 100). An attack
//! read in that frame carries `t = render` (`MatchClient`, `LocalMotion.AttackTime` is the identity) and is flushed in the
//! same frame. On the server's sim-time axis the press happens at `P`, so `t = P - down_min - delay`. The command reaches
//! the room at `P + up`, between two steps: `sim.server_time() = P + up - phase` with `phase` in `[0, TICK_MS)`, and
//! `now_apply` is one tick later. So the lag an honest client presents is
//!
//! `now_apply - t = up + down_min + delay + (TICK_MS - phase) + intake`  (`intake`: the few ms between the frame's
//! render-clock update and the room handling the frame, beyond the network itself)
//!
//! and `up + down_min` is, on average, at most the RTT the server measures (`smoothed_rtt_ms`, an EWMA of `up + down`;
//! the intake slack absorbs a little uplink jitter on top). The window
//! therefore counts the whole RTT, the client's largest delay, a whole tick and a small intake slack. An earlier formula
//! counted only half the RTT, the starting delay and no tick phase, which clamped honest clients at about 60 ms RTT and
//! above. Only the old edge moves: an honest `t` is never later than `now_apply`.
//!
//! What a dishonest client can obtain is unchanged: `MAX_REWIND_MS` stays the outer bound (it is also the sim's own
//! `note_lag` cap). A client that delays its Pongs can already raise `smoothed_rtt_ms` to the ceiling and the window to
//! `MAX_REWIND_MS`, at no input cost; a forged `t` outside the window is clamped to its edge.
//!
//! The clamp applies per `Attack`/`Release` command, to an optional Wish render-time claim at admission, and to the
//! issue-time stamp of a `MoveAt`/`AttackMoveAt` order (protocol 15). That stamp is the client's server-time estimate
//! WITHOUT its interpolation delay, so an honest one sits nearer `now_apply` than an attack's `t`; the simulation turns it
//! into at most one tick of walk credit for a walker that stood idle (`rh_sim::systems::inputs`), so the clamp here bounds
//! the claim and counts forgeries, and the tick cap in the simulation bounds what any claim can buy. Wish effects
//! are not rewound; the latter is retained only as bounded input metadata. A held attack keeps its legacy press-time lag
//! until another `Attack`/`Release` command arrives.

use rh_sim::constants::{MAX_REWIND_MS, TICK_MS};
use rh_sim::{PlayerId, PublicCommand};
use std::sync::Mutex;

use super::MatchId;

/// The client's largest remote-interpolation delay (`RenderClock.MaxDelayMs`): the part of an honest attack render time
/// that is not RTT or tick phase. The client renders remote actors 70-150 ms in the past (starting at 100) and moves
/// within that range with its downlink jitter, which the server cannot see, so the window allows the largest.
pub const RENDER_DELAY_ALLOWANCE_MS: f64 = 150.0;
/// Slack for the time between the client's per-frame render-clock update and the room handling the input frame that is
/// not network (the rest of that frame, the browser send, the connection reader and the room mailbox).
pub const INTAKE_SLACK_MS: f64 = 20.0;
/// Weight of the newest sample in the EWMA: one sample moves the estimate a quarter of the way.
pub const SMOOTHING_ALPHA: f64 = 0.25;
/// The lowest RTT the estimator reports. A lucky zero-latency sample must not collapse the rewind window, and sub-tick
/// timing noise is not a meaningful measurement.
pub const RTT_FLOOR_MS: f64 = 20.0;
/// The highest RTT the estimator reports. `MAX_REWIND_MS` already caps the window, so this only keeps the number sane.
pub const RTT_CEILING_MS: f64 = 2_000.0;
/// The estimate before the connection's first Pong. The first Ping is sent as soon as the Welcome is written, so this only
/// covers the first moments of a connection; it is deliberately mid-range rather than the floor.
pub const DEFAULT_RTT_MS: f64 = 100.0;

/// A per-connection smoothed RTT, fed by server-measured Ping/Pong samples only.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RttEstimator {
    smoothed_ms: f64,
    samples: u64,
}

impl Default for RttEstimator {
    fn default() -> Self {
        Self::new()
    }
}

impl RttEstimator {
    /// A fresh estimate: the default RTT, no samples.
    pub fn new() -> Self {
        Self {
            smoothed_ms: DEFAULT_RTT_MS,
            samples: 0,
        }
    }

    /// Samples taken so far (a Pong that matched a server Ping). Unit-test accessor: production reads the room's stats.
    #[cfg(test)]
    pub fn samples(&self) -> u64 {
        self.samples
    }

    /// The smoothed RTT in milliseconds.
    pub fn estimate_ms(&self) -> f64 {
        self.smoothed_ms
    }

    /// Takes one server-measured round trip and returns the smoothed estimate. The sample is floored and ceiled before it
    /// is folded in; the first sample *is* the estimate (there is no history to smooth against). Non-finite samples are
    /// ignored.
    pub fn sample(&mut self, rtt_ms: f64) -> f64 {
        if rtt_ms.is_finite() {
            let sample = rtt_ms.clamp(RTT_FLOOR_MS, RTT_CEILING_MS);
            self.smoothed_ms = if self.samples == 0 {
                sample
            } else {
                SMOOTHING_ALPHA * sample + (1.0 - SMOOTHING_ALPHA) * self.smoothed_ms
            };
            self.samples += 1;
        }
        self.smoothed_ms
    }

    /// The rewind window this connection's RTT allows (see [`allowed_rewind_ms`]).
    pub fn allowed_rewind_ms(&self) -> f64 {
        allowed_rewind_ms(self.smoothed_ms)
    }
}

/// The window an honest client needs (module docs): the smoothed RTT, plus the client's largest render delay, plus one
/// tick of phase, plus the intake slack, held inside `[TICK_MS, MAX_REWIND_MS]` (50..300 ms here).
pub fn allowed_rewind_ms(smoothed_rtt_ms: f64) -> f64 {
    let rtt = if smoothed_rtt_ms.is_finite() {
        smoothed_rtt_ms
    } else {
        DEFAULT_RTT_MS
    };
    (rtt + RENDER_DELAY_ALLOWANCE_MS + TICK_MS + INTAKE_SLACK_MS).clamp(TICK_MS, MAX_REWIND_MS)
}

/// Clamps a client render time into the window that ends at `now_apply` (the sim time the command will be applied at).
pub fn clamp_rewind_t(t: f64, now_apply: f64, allowed_ms: f64) -> f64 {
    t.clamp(now_apply - allowed_ms, now_apply)
}

/// Applies the connection's existing render-time admission bound. Wish `t` is not used for rewind; it is still bounded
/// here like an attack claim. Returns whether a finite claim was clamped (for the shared diagnostic counter).
pub fn clamp_render_time(
    cmd: PublicCommand,
    now_apply: f64,
    allowed_ms: f64,
) -> (PublicCommand, bool) {
    let clamp = |t: Option<f64>| match t {
        Some(t) if t.is_finite() => {
            let clamped = clamp_rewind_t(t, now_apply, allowed_ms);
            (Some(clamped), clamped != t)
        }
        other => (other, false),
    };
    match cmd {
        PublicCommand::Attack { a, t } => {
            let (t, clamped) = clamp(t);
            (PublicCommand::Attack { a, t }, clamped)
        }
        PublicCommand::Release { a, t } => {
            let (t, clamped) = clamp(t);
            (PublicCommand::Release { a, t }, clamped)
        }
        PublicCommand::Cast {
            slot,
            x,
            y,
            id,
            t,
            seq,
        } => {
            let (t, clamped) = clamp(t);
            (
                PublicCommand::Cast {
                    slot,
                    x,
                    y,
                    id,
                    t,
                    seq,
                },
                clamped,
            )
        }
        PublicCommand::MoveAt { x, y, seq, t } if t.is_finite() => {
            let c = clamp_rewind_t(t, now_apply, allowed_ms);
            (PublicCommand::MoveAt { x, y, seq, t: c }, c != t)
        }
        PublicCommand::AttackMoveAt { x, y, seq, t } if t.is_finite() => {
            let c = clamp_rewind_t(t, now_apply, allowed_ms);
            (PublicCommand::AttackMoveAt { x, y, seq, t: c }, c != t)
        }
        other => (other, false),
    }
}

/// [`clamp_render_time`] with this seat's window, recording any clamp in `stats` (which edge, by how much, at what RTT).
pub fn clamp_render_time_noted(
    cmd: PublicCommand,
    now_apply: f64,
    rtt: &RttEstimator,
    stats: &mut RewindClampStats,
) -> (PublicCommand, bool) {
    let allowed_ms = rtt.allowed_rewind_ms();
    let (bounded, clamped) = clamp_render_time(cmd, now_apply, allowed_ms);
    if clamped {
        if let Some(t) = render_time(cmd) {
            stats.note(t, now_apply, allowed_ms, rtt.estimate_ms());
        }
    }
    (bounded, clamped)
}

/// The render-time claim a command carries, if any.
fn render_time(cmd: PublicCommand) -> Option<f64> {
    match cmd {
        PublicCommand::Attack { t, .. }
        | PublicCommand::Release { t, .. }
        | PublicCommand::Cast { t, .. } => t,
        PublicCommand::MoveAt { t, .. } | PublicCommand::AttackMoveAt { t, .. } => Some(t),
        _ => None,
    }
}

/// Upper bounds (ms) of the clamp-size buckets; the last bucket holds everything above the last bound.
pub const CLAMP_EXCESS_BUCKETS_MS: [f64; 3] = [25.0, 50.0, 100.0];

/// The clamps on one edge of the rewind window.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct EdgeClamps {
    pub count: u64,
    /// How far past the edge the claim was, bucketed by [`CLAMP_EXCESS_BUCKETS_MS`]: `<= 25`, `<= 50`, `<= 100`, `> 100`.
    pub excess_buckets: [u64; 4],
    pub excess_ms_max: f64,
}

impl EdgeClamps {
    fn note(&mut self, excess_ms: f64) {
        self.count += 1;
        let bucket = CLAMP_EXCESS_BUCKETS_MS
            .iter()
            .position(|bound| excess_ms <= *bound)
            .unwrap_or(CLAMP_EXCESS_BUCKETS_MS.len());
        self.excess_buckets[bucket] += 1;
        self.excess_ms_max = self.excess_ms_max.max(excess_ms);
    }
}

/// Per-seat rewind-clamp diagnostics. An old-edge clamp is a `t` older than the window allows (an honest client the
/// formula under-counts, or a forged or Pong-inflation claim); a future-edge clamp is a `t` later than `now_apply`, which
/// an honest client never sends. Consistently large old-edge clamps at a high `srtt_ms_at_last_clamp` are the signature
/// of Pong inflation. In-process only: nothing here is on the wire.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RewindClampStats {
    pub old_edge: EdgeClamps,
    pub future_edge: EdgeClamps,
    /// The seat's smoothed RTT when it was last clamped (0 before any clamp).
    pub srtt_ms_at_last_clamp: f64,
}

impl RewindClampStats {
    /// Records one clamped claim `t` against the window `[now_apply - allowed_ms, now_apply]`; a `t` inside it (not a
    /// clamp) records nothing.
    pub fn note(&mut self, t: f64, now_apply: f64, allowed_ms: f64, srtt_ms: f64) {
        let oldest = now_apply - allowed_ms;
        if t < oldest {
            self.old_edge.note(oldest - t);
        } else if t > now_apply {
            self.future_edge.note(t - now_apply);
        } else {
            return;
        }
        self.srtt_ms_at_last_clamp = srtt_ms;
    }

    /// Clamps on either edge.
    pub fn total(&self) -> u64 {
        self.old_edge.count + self.future_edge.count
    }
}

/// In-process diagnostics: the last smoothed estimate for a player of a match, bounded so a long-lived process cannot
/// grow it. The seat's estimator is authoritative; this readout is what the transport-level proof (and a future P-OPS-2
/// panel) can see from outside the room task.
static LAST_ESTIMATES: Mutex<Vec<((MatchId, PlayerId), f64)>> = Mutex::new(Vec::new());
const LAST_ESTIMATES_CAP: usize = 16;

/// Records the diagnostic value; the room calls this when it accepts a sample.
pub(crate) fn note_estimate(match_id: MatchId, player: PlayerId, estimate_ms: f64) {
    let mut last = LAST_ESTIMATES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    last.retain(|((m, p), _)| !(*m == match_id && *p == player));
    last.push(((match_id, player), estimate_ms));
    if last.len() > LAST_ESTIMATES_CAP {
        last.remove(0);
    }
}

/// The last smoothed RTT estimate this process reported for one player of one match, if any.
pub fn last_estimate_ms(match_id: MatchId, player: PlayerId) -> Option<f64> {
    let last = LAST_ESTIMATES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    last.iter()
        .find(|((m, p), _)| *m == match_id && *p == player)
        .map(|(_, v)| *v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_estimate_is_the_default_and_its_first_sample_is_the_estimate() {
        let mut rtt = RttEstimator::new();
        assert_eq!(rtt.samples(), 0);
        assert_eq!(rtt.estimate_ms(), DEFAULT_RTT_MS);
        assert_eq!(
            rtt.allowed_rewind_ms(),
            300.0,
            "100 + 150 + 50 + 20, at the cap"
        );
        assert_eq!(rtt.sample(60.0), 60.0);
        assert_eq!(rtt.samples(), 1);
        assert_eq!(rtt.allowed_rewind_ms(), 280.0, "60 + 150 + 50 + 20");
    }

    #[test]
    fn smoothing_moves_a_quarter_of_the_way_to_each_new_sample() {
        let mut rtt = RttEstimator::new();
        rtt.sample(150.0);
        // 0.25 * 50 + 0.75 * 150 = 125.
        assert_eq!(rtt.sample(50.0), 125.0);
        // 0.25 * 20 + 0.75 * 125 = 98.75 (the 20 is the floor).
        assert_eq!(rtt.sample(1.0), 98.75);
        assert_eq!(rtt.samples(), 3);
        assert_eq!(
            rtt.allowed_rewind_ms(),
            300.0,
            "98.75 + 220 is past the cap"
        );
    }

    #[test]
    fn the_floor_stops_a_lucky_sample_from_collapsing_the_window() {
        let mut rtt = RttEstimator::new();
        assert_eq!(rtt.sample(0.0), RTT_FLOOR_MS);
        assert_eq!(rtt.sample(0.0), RTT_FLOOR_MS);
        assert_eq!(rtt.allowed_rewind_ms(), 240.0, "20 + 150 + 50 + 20");
        // The window never goes below its own TICK_MS floor, even for an impossible negative RTT.
        assert_eq!(allowed_rewind_ms(-1_000.0), TICK_MS);
    }

    #[test]
    fn the_ceiling_bounds_an_absurd_sample() {
        let mut rtt = RttEstimator::new();
        assert_eq!(rtt.sample(10_000.0), RTT_CEILING_MS);
        assert_eq!(rtt.allowed_rewind_ms(), MAX_REWIND_MS);
        // A non-finite sample changes nothing (and is not counted).
        assert_eq!(rtt.sample(f64::NAN), RTT_CEILING_MS);
        assert_eq!(rtt.samples(), 1);
    }

    #[test]
    fn the_window_by_rtt_floor_and_ceiling() {
        assert_eq!(allowed_rewind_ms(20.0), 240.0);
        assert_eq!(allowed_rewind_ms(60.0), 280.0);
        assert_eq!(allowed_rewind_ms(80.0), 300.0);
        assert_eq!(allowed_rewind_ms(150.0), 300.0, "capped by MAX_REWIND_MS");
        assert_eq!(allowed_rewind_ms(2_000.0), 300.0, "capped by MAX_REWIND_MS");
        assert_eq!(allowed_rewind_ms(-1_000.0), 50.0, "floored at TICK_MS");
        assert_eq!(TICK_MS, 50.0);
        assert_eq!(MAX_REWIND_MS, 300.0);
    }

    #[test]
    fn a_render_time_is_clamped_into_the_window_ending_at_now_apply() {
        let now_apply = 1_000.0;
        let allowed = 160.0;
        assert_eq!(
            clamp_rewind_t(700.0, now_apply, allowed),
            840.0,
            "older than the bound"
        );
        assert_eq!(clamp_rewind_t(900.0, now_apply, allowed), 900.0, "inside");
        assert_eq!(
            clamp_rewind_t(1_000.0, now_apply, allowed),
            1_000.0,
            "at now_apply"
        );
        assert_eq!(
            clamp_rewind_t(1_200.0, now_apply, allowed),
            1_000.0,
            "future"
        );
        assert_eq!(now_apply - allowed, 840.0, "the oldest window edge");
    }

    #[test]
    fn attack_and_release_render_times_are_clamped_and_counted() {
        let now_apply = 1_000.0;
        let allowed = 160.0;
        let (cmd, clamped) = clamp_render_time(
            PublicCommand::Attack {
                a: 1.0,
                t: Some(700.0),
            },
            now_apply,
            allowed,
        );
        assert_eq!(
            cmd,
            PublicCommand::Attack {
                a: 1.0,
                t: Some(840.0)
            }
        );
        assert!(clamped, "the forged old t was clamped");
        let (cmd, clamped) = clamp_render_time(
            PublicCommand::Release {
                a: 1.0,
                t: Some(1_500.0),
            },
            now_apply,
            allowed,
        );
        assert_eq!(
            cmd,
            PublicCommand::Release {
                a: 1.0,
                t: Some(1_000.0)
            }
        );
        assert!(clamped, "a future t is clamped too");
        let (cmd, clamped) = clamp_render_time(
            PublicCommand::Attack {
                a: 1.0,
                t: Some(900.0),
            },
            now_apply,
            allowed,
        );
        assert_eq!(
            cmd,
            PublicCommand::Attack {
                a: 1.0,
                t: Some(900.0)
            }
        );
        assert!(!clamped, "inside the window costs nothing");
        let (cmd, clamped) = clamp_render_time(
            PublicCommand::Attack { a: 1.0, t: None },
            now_apply,
            allowed,
        );
        assert_eq!(cmd, PublicCommand::Attack { a: 1.0, t: None });
        assert!(!clamped, "a locked attack has no render time to clamp");
        let (_, clamped) = clamp_render_time(
            PublicCommand::Move {
                x: 1.0,
                y: 2.0,
                seq: None,
            },
            now_apply,
            allowed,
        );
        assert!(!clamped, "an unstamped order is never rewritten");
    }

    #[test]
    fn stamped_move_orders_are_clamped_into_the_same_window_and_counted() {
        let (now_apply, allowed) = (1_000.0, 160.0);
        let mv = |t| PublicCommand::MoveAt {
            x: 1.0,
            y: 2.0,
            seq: Some(3),
            t,
        };
        let am = |t| PublicCommand::AttackMoveAt {
            x: 1.0,
            y: 2.0,
            seq: None,
            t,
        };
        assert_eq!(
            clamp_render_time(mv(-1e12), now_apply, allowed),
            (mv(840.0), true)
        );
        assert_eq!(
            clamp_render_time(mv(9e15), now_apply, allowed),
            (mv(1_000.0), true)
        );
        assert_eq!(
            clamp_render_time(mv(930.0), now_apply, allowed),
            (mv(930.0), false)
        );
        assert_eq!(
            clamp_render_time(am(0.0), now_apply, allowed),
            (am(840.0), true)
        );
        assert_eq!(
            clamp_render_time(am(975.5), now_apply, allowed),
            (am(975.5), false)
        );
        let mut stats = RewindClampStats::default();
        let mut rtt = RttEstimator::new();
        rtt.sample(20.0);
        let (bounded, clamped) = clamp_render_time_noted(mv(0.0), now_apply, &rtt, &mut stats);
        assert!(clamped);
        assert_eq!(bounded, mv(now_apply - rtt.allowed_rewind_ms()));
        assert_eq!(
            stats.old_edge.count, 1,
            "a forged stamp shows up in the clamp telemetry"
        );
        clamp_render_time_noted(mv(5_000.0), now_apply, &rtt, &mut stats);
        assert_eq!(stats.future_edge.count, 1);
    }

    #[test]
    fn wish_render_time_uses_the_same_admission_window_without_adding_rewind() {
        let cmd = PublicCommand::Cast {
            slot: rh_sim::abilities::Slot::Wish,
            x: 4.0,
            y: 5.0,
            id: None,
            t: Some(100.0),
            seq: Some(7),
        };
        let (bounded, clamped) = clamp_render_time(cmd, 1_000.0, 200.0);
        assert!(clamped);
        assert!(matches!(
            bounded,
            PublicCommand::Cast { t: Some(t), .. } if t == 800.0
        ));

        let without_time = PublicCommand::Cast {
            slot: rh_sim::abilities::Slot::Wish,
            x: 4.0,
            y: 5.0,
            id: None,
            t: None,
            seq: Some(7),
        };
        assert_eq!(
            clamp_render_time(without_time, 1_000.0, 200.0),
            (without_time, false)
        );
    }

    /// The render time an honest Unity client sends (module docs): pressed when the server's sim clock reads `press`,
    /// with a symmetric path of `rtt` (so `up = down_min = rtt / 2`), its render delay, and `intake` ms of non-network
    /// intake. Returns `(t, now_apply)` for a command that reaches the room `phase` ms after the last step at `sim_time`.
    fn honest(rtt: f64, delay: f64, phase: f64, intake: f64) -> (f64, f64) {
        let sim_time = 10_000.0;
        let now_apply = sim_time + TICK_MS;
        let press = sim_time + phase - rtt / 2.0 - intake;
        (press - rtt / 2.0 - delay, now_apply)
    }

    #[test]
    fn honest_clients_at_20_60_100_and_200ms_are_not_clamped_inside_the_hard_cap() {
        for rtt_ms in [20.0, 60.0, 100.0, 200.0] {
            let mut rtt = RttEstimator::new();
            for _ in 0..8 {
                rtt.sample(rtt_ms);
            }
            for delay in [70.0, 100.0, 150.0] {
                for phase in [0.0, 10.0, 25.0, 49.9] {
                    for intake in [0.0, INTAKE_SLACK_MS] {
                        let (t, now_apply) = honest(rtt_ms, delay, phase, intake);
                        let honest_lag = now_apply - t;
                        let mut stats = RewindClampStats::default();
                        let (cmd, clamped) = clamp_render_time_noted(
                            PublicCommand::Attack { a: 0.0, t: Some(t) },
                            now_apply,
                            &rtt,
                            &mut stats,
                        );
                        let PublicCommand::Attack {
                            t: Some(bounded), ..
                        } = cmd
                        else {
                            unreachable!()
                        };
                        let case =
                            format!("rtt {rtt_ms} delay {delay} phase {phase} intake {intake}");
                        // The room clamp never shortens an honest rewind below what the sim's own cap gives.
                        assert_eq!(now_apply - bounded, honest_lag.min(MAX_REWIND_MS), "{case}");
                        assert_eq!(clamped, honest_lag > MAX_REWIND_MS, "{case}");
                        assert_eq!(stats.future_edge.count, 0, "{case}: never the future edge");
                        assert_eq!(stats.total(), u64::from(clamped), "{case}");
                    }
                }
            }
        }
        // Below the cap nothing honest is clamped: at 60 ms RTT with the starting 100 ms delay and the worst phase the
        // client presents 60 + 100 + 50 + 20 = 230 ms (the former formula allowed 180).
        let (t, now_apply) = honest(60.0, 100.0, 0.0, INTAKE_SLACK_MS);
        assert_eq!(now_apply - t, 230.0);
        assert!(now_apply - t <= allowed_rewind_ms(60.0));
    }

    #[test]
    fn inflated_rtt_and_forged_render_times_stay_inside_max_rewind() {
        // Whatever the estimate (delayed Pongs push it up to the ceiling), the window never exceeds MAX_REWIND_MS.
        let mut srtt = -100.0;
        while srtt <= 5_000.0 {
            let allowed = allowed_rewind_ms(srtt);
            assert!(
                (TICK_MS..=MAX_REWIND_MS).contains(&allowed),
                "{srtt}: {allowed}"
            );
            srtt += 7.5;
        }
        assert_eq!(
            allowed_rewind_ms(f64::INFINITY),
            allowed_rewind_ms(DEFAULT_RTT_MS)
        );

        let mut inflated = RttEstimator::new();
        for _ in 0..20 {
            inflated.sample(4_000.0);
        }
        assert_eq!(inflated.estimate_ms(), RTT_CEILING_MS);
        assert_eq!(inflated.allowed_rewind_ms(), MAX_REWIND_MS);

        let now_apply = 10_050.0;
        let mut stats = RewindClampStats::default();
        let (cmd, clamped) = clamp_render_time_noted(
            PublicCommand::Attack {
                a: 0.0,
                t: Some(now_apply - 10_000.0),
            },
            now_apply,
            &inflated,
            &mut stats,
        );
        assert!(clamped);
        assert_eq!(
            cmd,
            PublicCommand::Attack {
                a: 0.0,
                t: Some(now_apply - MAX_REWIND_MS)
            },
            "a forged old t gets the hard cap, no more"
        );
        let (cmd, clamped) = clamp_render_time_noted(
            PublicCommand::Release {
                a: 0.0,
                t: Some(now_apply + 500.0),
            },
            now_apply,
            &inflated,
            &mut stats,
        );
        assert!(clamped);
        assert_eq!(
            cmd,
            PublicCommand::Release {
                a: 0.0,
                t: Some(now_apply)
            },
            "a forged future t gets no negative rewind"
        );
        assert_eq!(stats.old_edge.count, 1);
        assert_eq!(stats.future_edge.count, 1);
        assert_eq!(stats.srtt_ms_at_last_clamp, RTT_CEILING_MS);
    }

    #[test]
    fn clamp_diagnostics_separate_the_edges_and_bucket_the_excess() {
        let mut rtt = RttEstimator::new();
        rtt.sample(20.0);
        let allowed = rtt.allowed_rewind_ms();
        assert_eq!(allowed, 240.0);
        let now_apply = 1_000.0;
        let oldest = now_apply - allowed;
        let mut stats = RewindClampStats::default();
        let send = |t: f64, stats: &mut RewindClampStats| {
            clamp_render_time_noted(
                PublicCommand::Attack { a: 0.0, t: Some(t) },
                now_apply,
                &rtt,
                stats,
            )
            .1
        };
        // Inside the window (both edges included): nothing is recorded.
        assert!(!send(oldest, &mut stats));
        assert!(!send(now_apply, &mut stats));
        assert!(!send(now_apply - 100.0, &mut stats));
        assert_eq!(stats, RewindClampStats::default());

        // Old edge: 10, 25 (bucket 0), 40 (1), 75 (2), 500 (3) ms past it.
        for excess in [10.0, 25.0, 40.0, 75.0, 500.0] {
            assert!(send(oldest - excess, &mut stats));
        }
        assert_eq!(stats.old_edge.count, 5);
        assert_eq!(stats.old_edge.excess_buckets, [2, 1, 1, 1]);
        assert_eq!(stats.old_edge.excess_ms_max, 500.0);
        assert_eq!(stats.future_edge, EdgeClamps::default());

        // Future edge: 30 ms (bucket 1) past now_apply.
        assert!(send(now_apply + 30.0, &mut stats));
        assert_eq!(stats.future_edge.count, 1);
        assert_eq!(stats.future_edge.excess_buckets, [0, 1, 0, 0]);
        assert_eq!(stats.future_edge.excess_ms_max, 30.0);
        assert_eq!(stats.old_edge.count, 5, "the old edge is untouched");
        assert_eq!(stats.total(), 6);
        assert_eq!(stats.srtt_ms_at_last_clamp, 20.0);

        // No render time (a locked attack) or a command without one: nothing to clamp or record.
        let (_, clamped) = clamp_render_time_noted(
            PublicCommand::Attack { a: 0.0, t: None },
            now_apply,
            &rtt,
            &mut stats,
        );
        assert!(!clamped);
        assert_eq!(stats.total(), 6);
    }
}
