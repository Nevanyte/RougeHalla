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
//! Formula (the packet's, with named constants):
//!
//! `allowed = clamp(smoothed_rtt_ms / 2 + RENDER_DELAY_ALLOWANCE_MS + TICK_MS, TICK_MS, MAX_REWIND_MS)`
//!
//! and a render time is clamped into `[now_apply - allowed, now_apply]`, where `now_apply` is the server time of the step
//! that will apply the command (the current sim time plus one tick). A future `t` is clamped like an old one.

use rh_sim::constants::{MAX_REWIND_MS, TICK_MS};
use rh_sim::{PlayerId, PublicCommand};
use std::sync::Mutex;

use super::MatchId;

/// The client's starting remote-interpolation delay: the part of an honest attack render time that is not RTT. The client
/// renders remote actors 70-150 ms in the past, starting at 100 (P-NET-1, docs/PLAYER_PREDICTION.md), so an honest client
/// at RTT `r` sends `t = press - (r / 2 + 100)`.
pub const RENDER_DELAY_ALLOWANCE_MS: f64 = 100.0;
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

/// The packet formula: half the smoothed RTT, plus the render-delay allowance, plus one tick of slack, held inside
/// `[TICK_MS, MAX_REWIND_MS]` (50..300 ms here).
pub fn allowed_rewind_ms(smoothed_rtt_ms: f64) -> f64 {
    let rtt = if smoothed_rtt_ms.is_finite() {
        smoothed_rtt_ms
    } else {
        DEFAULT_RTT_MS
    };
    (rtt / 2.0 + RENDER_DELAY_ALLOWANCE_MS + TICK_MS).clamp(TICK_MS, MAX_REWIND_MS)
}

/// Clamps a client render time into the window that ends at `now_apply` (the sim time the command will be applied at).
pub fn clamp_rewind_t(t: f64, now_apply: f64, allowed_ms: f64) -> f64 {
    t.clamp(now_apply - allowed_ms, now_apply)
}

/// Applies the clamp to a client proposal: only `Attack`/`Release` with a finite `t` (the commands `note_lag` reads).
/// Returns the proposal and whether the render time was outside the window (and therefore changed: a clamp to count).
/// `t = None` (locked attacks) is untouched.
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
        other => (other, false),
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
        assert_eq!(rtt.allowed_rewind_ms(), 200.0, "100/2 + 100 + 50");
        assert_eq!(rtt.sample(150.0), 150.0);
        assert_eq!(rtt.samples(), 1);
        assert_eq!(rtt.allowed_rewind_ms(), 225.0, "150/2 + 100 + 50");
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
        assert_eq!(rtt.allowed_rewind_ms(), 199.375, "98.75/2 + 100 + 50");
    }

    #[test]
    fn the_floor_stops_a_lucky_sample_from_collapsing_the_window() {
        let mut rtt = RttEstimator::new();
        assert_eq!(rtt.sample(0.0), RTT_FLOOR_MS);
        assert_eq!(rtt.sample(0.0), RTT_FLOOR_MS);
        assert_eq!(rtt.allowed_rewind_ms(), 160.0, "20/2 + 100 + 50");
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
        assert_eq!(allowed_rewind_ms(20.0), 160.0);
        assert_eq!(allowed_rewind_ms(150.0), 225.0);
        assert_eq!(allowed_rewind_ms(300.0), 300.0);
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
    fn only_attack_and_release_render_times_are_clamped_and_counted() {
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
        assert!(!clamped, "movement is never rewritten");
    }
}
