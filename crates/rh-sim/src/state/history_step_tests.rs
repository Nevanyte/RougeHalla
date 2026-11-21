//! The rewind ring at every allowed step (P-TICK-1a, ADR 0029), kept beside `state.rs` so that frozen file stays
//! under the size limit after P-SYNC-ORIGIN-1 merged both lines' additions to it.

use super::{history_cap, History, Sample};
use crate::constants::{MAX_REWIND_MS, TICK_MS};

/// The legacy recorder at any step: push, then trim while longer than two and the oldest is before the cutoff.
fn reference_at(h: &mut Vec<Sample>, now: f64, step: f64) {
    h.push(Sample {
        t: now,
        x: 0.0,
        y: 0.0,
    });
    let cutoff = now - MAX_REWIND_MS - step;
    while h.len() > 2 && h[0].t < cutoff {
        h.remove(0);
    }
}

#[test]
fn the_ring_holds_the_whole_rewind_window_at_every_allowed_step() {
    // P-TICK-1a (ADR 0029): sized for 25 ms, the ring holds the window at 25 ms with the match's own cutoff and with
    // the legacy one, and at 50 ms it keeps exactly the samples the legacy recorder keeps.
    for (spacing, cutoff_step) in [(25.0, 25.0), (25.0, TICK_MS), (TICK_MS, TICK_MS)] {
        let mut ring = History::default();
        let mut vec = Vec::new();
        for n in 0..400u32 {
            let now = spacing * n as f64;
            ring.record_at_step(now, 0.0, 0.0, cutoff_step);
            reference_at(&mut vec, now, cutoff_step);
            assert_eq!(ring.iter().collect::<Vec<_>>(), vec);
            assert!(ring.len() < history_cap(), "{spacing} ms spacing");
        }
        let want = ((MAX_REWIND_MS + cutoff_step) / spacing) as usize + 1;
        assert_eq!(
            ring.len(),
            want,
            "{spacing} ms spacing, {cutoff_step} ms cutoff"
        );
    }
}
