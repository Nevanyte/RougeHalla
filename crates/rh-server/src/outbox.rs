//! Per-connection outbound queues with slow-client isolation (docs/CONTRACTS.md C-NET-5). The room never blocks on a socket:
//! it pushes into an [`Outbox`] and a writer task drains it.
//!
//! * important frames (Events: deaths, results, the end) are never dropped; if a client falls IMPORTANT_CAP frames behind,
//!   it is disconnected with `TooSlow` (it would desync anyway) and may reconnect to a fresh snapshot;
//! * the snapshot is latest-wins: a slow client skips stale snapshots instead of queueing them;
//! * fx are disposable: at most FX_CAP are kept, the oldest dropped first.

use rh_protocol::RejectCode;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tokio::sync::Notify;

pub const IMPORTANT_CAP: usize = 256;
pub const FX_CAP: usize = 32;

#[derive(Default)]
struct State {
    important: VecDeque<Vec<u8>>,
    fx: VecDeque<Vec<u8>>,
    snapshot: Option<Vec<u8>>,
    closed: Option<RejectCode>,
}

/// What an [`Outbox`] counted over its life (relaxed reads: the room that pushes is the only writer).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct OutboxCounters {
    /// Fx frames evicted unsent because the client was FX_CAP frames behind.
    pub fx_dropped: u64,
    /// Snapshots replaced by a newer one before the writer took them.
    pub snapshots_skipped: u64,
    /// Bytes of every frame accepted into the queues (including fx and snapshots later dropped); only ever increases.
    pub bytes_enqueued_total: u64,
}

impl OutboxCounters {
    pub fn add(&mut self, o: OutboxCounters) {
        self.fx_dropped += o.fx_dropped;
        self.snapshots_skipped += o.snapshots_skipped;
        self.bytes_enqueued_total += o.bytes_enqueued_total;
    }
}

#[derive(Default)]
pub struct Outbox {
    state: Mutex<State>,
    notify: Notify,
    pub fx_dropped: AtomicU64,
    pub snapshots_skipped: AtomicU64,
    /// Total bytes of frames accepted into the queues (see [`OutboxCounters::bytes_enqueued_total`]).
    pub bytes_enqueued_total: AtomicU64,
}

pub enum Next {
    Frame(Vec<u8>),
    Close(RejectCode),
}

impl Outbox {
    pub fn important(&self, frame: Vec<u8>) {
        let mut s = self.state.lock().expect("outbox lock");
        if s.closed.is_some() {
            return;
        }
        if s.important.len() >= IMPORTANT_CAP {
            s.closed = Some(RejectCode::TooSlow);
        } else {
            self.bytes_enqueued_total
                .fetch_add(frame.len() as u64, Ordering::Relaxed);
            s.important.push_back(frame);
        }
        drop(s);
        self.notify.notify_one();
    }

    pub fn fx(&self, frame: Vec<u8>) {
        let mut s = self.state.lock().expect("outbox lock");
        if s.closed.is_some() {
            return;
        }
        if s.fx.len() >= FX_CAP {
            s.fx.pop_front();
            self.fx_dropped.fetch_add(1, Ordering::Relaxed);
        }
        self.bytes_enqueued_total
            .fetch_add(frame.len() as u64, Ordering::Relaxed);
        s.fx.push_back(frame);
        drop(s);
        self.notify.notify_one();
    }

    pub fn snapshot(&self, frame: Vec<u8>) {
        let mut s = self.state.lock().expect("outbox lock");
        if s.closed.is_some() {
            return;
        }
        self.bytes_enqueued_total
            .fetch_add(frame.len() as u64, Ordering::Relaxed);
        if s.snapshot.replace(frame).is_some() {
            self.snapshots_skipped.fetch_add(1, Ordering::Relaxed);
        }
        drop(s);
        self.notify.notify_one();
    }

    pub fn counters(&self) -> OutboxCounters {
        OutboxCounters {
            fx_dropped: self.fx_dropped.load(Ordering::Relaxed),
            snapshots_skipped: self.snapshots_skipped.load(Ordering::Relaxed),
            bytes_enqueued_total: self.bytes_enqueued_total.load(Ordering::Relaxed),
        }
    }

    pub fn close(&self, why: RejectCode) {
        let mut s = self.state.lock().expect("outbox lock");
        if s.closed.is_none() {
            s.closed = Some(why);
        }
        drop(s);
        self.notify.notify_one();
    }

    /// The next frame to write: important first, then fx, then the latest snapshot. Waits when there is none.
    pub async fn next(&self) -> Next {
        loop {
            {
                let mut s = self.state.lock().expect("outbox lock");
                if let Some(f) = s.important.pop_front() {
                    return Next::Frame(f);
                }
                if let Some(why) = s.closed {
                    return Next::Close(why);
                }
                if let Some(f) = s.fx.pop_front() {
                    return Next::Frame(f);
                }
                if let Some(f) = s.snapshot.take() {
                    return Next::Frame(f);
                }
            }
            self.notify.notified().await;
        }
    }

    #[cfg(test)]
    pub fn pending(&self) -> (usize, usize, bool) {
        let s = self.state.lock().unwrap();
        (s.important.len(), s.fx.len(), s.snapshot.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slow_client_loses_fx_and_stale_snapshots_but_never_important_frames() {
        let o = Outbox::default();
        for i in 0..100u8 {
            o.fx(vec![i]);
            o.snapshot(vec![i]);
        }
        o.important(vec![9]);
        let (imp, fx, snap) = o.pending();
        assert_eq!((imp, fx, snap), (1, FX_CAP, true));
        assert_eq!(o.fx_dropped.load(Ordering::Relaxed), 100 - FX_CAP as u64);
        assert_eq!(o.snapshots_skipped.load(Ordering::Relaxed), 99);
    }

    #[test]
    fn counters_total_every_accepted_frame_and_ignore_a_closed_outbox() {
        let o = Outbox::default();
        o.important(vec![0; 10]);
        for _ in 0..FX_CAP + 2 {
            o.fx(vec![0; 3]);
        }
        o.snapshot(vec![0; 100]);
        o.snapshot(vec![0; 200]);
        let c = o.counters();
        assert_eq!(c.fx_dropped, 2);
        assert_eq!(c.snapshots_skipped, 1);
        assert_eq!(c.bytes_enqueued_total, 10 + 3 * (FX_CAP as u64 + 2) + 300);
        o.close(RejectCode::Kicked);
        o.fx(vec![0; 50]);
        o.snapshot(vec![0; 50]);
        assert_eq!(
            o.counters(),
            c,
            "a closed outbox accepts and counts nothing"
        );
        let mut sum = OutboxCounters::default();
        sum.add(c);
        sum.add(c);
        assert_eq!(sum.fx_dropped, 4);
    }

    #[test]
    fn falling_too_far_behind_on_important_frames_closes_the_client() {
        let o = Outbox::default();
        for _ in 0..=IMPORTANT_CAP {
            o.important(vec![1]);
        }
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        rt.block_on(async {
            for _ in 0..IMPORTANT_CAP {
                assert!(matches!(o.next().await, Next::Frame(_)));
            }
            assert!(matches!(o.next().await, Next::Close(RejectCode::TooSlow)));
        });
    }
}
