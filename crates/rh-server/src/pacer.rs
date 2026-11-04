//! When a room steps (docs/CONTRACTS.md C-TICK): a fixed grid of TICK_MS slots on the monotonic clock. Each wake runs the
//! steps the grid owes: normally one; after a late wake up to MAX_CATCHUP steps; a longer backlog is DROPPED and the grid
//! re-anchored (the server sheds load instead of spiralling). Simulation time itself is virtual: +TICK_MS per step, so a
//! dropped backlog only stretches wall time, it never changes an outcome. Uses `tokio::time::Instant`, so tests can run on
//! a paused clock and the live and headless paths share the exact same step function.

use std::time::Duration;
use tokio::time::Instant;

pub const MAX_CATCHUP: u32 = 3;

pub struct Pacer {
    anchor: Instant,
    period: Duration,
    steps: u64,
    pub dropped: u64,
    pub late_wakes: u64,
}

impl Pacer {
    pub fn new(start: Instant, period: Duration) -> Self {
        Self {
            anchor: start,
            period,
            steps: 0,
            dropped: 0,
            late_wakes: 0,
        }
    }

    /// The instant of the next slot.
    pub fn next_deadline(&self) -> Instant {
        self.anchor + self.period * (self.steps as u32 + 1)
    }

    /// How many steps to run now (0 if woken early). Re-anchors when more than MAX_CATCHUP are owed.
    pub fn due(&mut self, now: Instant) -> u32 {
        if now < self.next_deadline() {
            return 0;
        }
        let owed = ((now - self.anchor).as_nanos() / self.period.as_nanos()) as u64 - self.steps;
        if owed > 1 {
            self.late_wakes += 1;
        }
        if owed > MAX_CATCHUP as u64 {
            self.dropped += owed - MAX_CATCHUP as u64;
            // Re-anchor so that the steps we do run end exactly at `now`'s slot.
            self.anchor = now - self.period * MAX_CATCHUP;
            self.steps = 0;
            self.steps += MAX_CATCHUP as u64;
            return MAX_CATCHUP;
        }
        self.steps += owed;
        owed as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_step_per_slot_bounded_catch_up_and_backlog_dropped() {
        let t0 = Instant::now();
        let p50 = Duration::from_millis(50);
        let mut p = Pacer::new(t0, p50);
        assert_eq!(p.due(t0 + Duration::from_millis(49)), 0);
        assert_eq!(p.due(t0 + Duration::from_millis(50)), 1);
        assert_eq!(
            p.due(t0 + Duration::from_millis(160)),
            2,
            "a late wake catches up"
        );
        assert_eq!(
            p.due(t0 + Duration::from_millis(1200)),
            MAX_CATCHUP,
            "a long stall runs at most MAX_CATCHUP"
        );
        assert!(p.dropped > 0);
        let next = p.next_deadline();
        assert_eq!(
            next,
            t0 + Duration::from_millis(1250),
            "the grid re-anchors on the slot after the stall"
        );
    }
}
