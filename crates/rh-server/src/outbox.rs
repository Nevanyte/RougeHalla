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
    /// `Notify::notify_one` calls made so far (counted under the lock the push already holds: no extra atomic), and how
    /// many of them were the close.
    notifies: u64,
    close_notifies: u64,
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

/// What one [`Outbox::drain_into`] took.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Drained {
    /// Frames appended to the caller's buffer.
    pub frames: usize,
    /// Set when the outbox is closed: every important frame is in the buffer, nothing disposable follows, and the writer
    /// must send the Reject for this code and end.
    pub close: Option<RejectCode>,
}

impl Drained {
    pub fn is_empty(&self) -> bool {
        self.frames == 0 && self.close.is_none()
    }
}

/// The counter half of the outbox, borrowed separately from the locked state.
struct Counts<'a> {
    fx_dropped: &'a AtomicU64,
    snapshots_skipped: &'a AtomicU64,
    bytes_enqueued_total: &'a AtomicU64,
}

impl State {
    fn push_important(&mut self, c: &Counts, frame: Vec<u8>) {
        if self.closed.is_some() {
            return;
        }
        if self.important.len() >= IMPORTANT_CAP {
            self.closed = Some(RejectCode::TooSlow);
        } else {
            c.bytes_enqueued_total
                .fetch_add(frame.len() as u64, Ordering::Relaxed);
            self.important.push_back(frame);
        }
    }

    fn push_fx(&mut self, c: &Counts, frame: Vec<u8>) {
        if self.closed.is_some() {
            return;
        }
        if self.fx.len() >= FX_CAP {
            self.fx.pop_front();
            c.fx_dropped.fetch_add(1, Ordering::Relaxed);
        }
        c.bytes_enqueued_total
            .fetch_add(frame.len() as u64, Ordering::Relaxed);
        self.fx.push_back(frame);
    }

    fn push_snapshot(&mut self, c: &Counts, frame: Vec<u8>) {
        if self.closed.is_some() {
            return;
        }
        c.bytes_enqueued_total
            .fetch_add(frame.len() as u64, Ordering::Relaxed);
        if self.snapshot.replace(frame).is_some() {
            c.snapshots_skipped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

impl Outbox {
    /// Wakes the writer: the one place `notify_one` is called, so every call is counted.
    fn wake(&self, mut s: std::sync::MutexGuard<'_, State>, close: bool) {
        s.notifies += 1;
        s.close_notifies += u64::from(close);
        drop(s);
        self.notify.notify_one();
    }

    /// How many times this outbox has called `Notify::notify_one` (a push that queued something, or a close). The density
    /// benchmark counts real notifies with it instead of trusting a side counter.
    pub fn notify_calls(&self) -> u64 {
        self.state.lock().expect("outbox lock").notifies
    }

    /// The part of [`Outbox::notify_calls`] made by `close` (a connection ends with one; ticks do not make it).
    pub fn close_notify_calls(&self) -> u64 {
        self.state.lock().expect("outbox lock").close_notifies
    }

    fn counts(&self) -> Counts<'_> {
        Counts {
            fx_dropped: &self.fx_dropped,
            snapshots_skipped: &self.snapshots_skipped,
            bytes_enqueued_total: &self.bytes_enqueued_total,
        }
    }

    pub fn important(&self, frame: Vec<u8>) {
        let mut s = self.state.lock().expect("outbox lock");
        s.push_important(&self.counts(), frame);
        self.wake(s, false);
    }

    pub fn fx(&self, frame: Vec<u8>) {
        let mut s = self.state.lock().expect("outbox lock");
        s.push_fx(&self.counts(), frame);
        self.wake(s, false);
    }

    pub fn snapshot(&self, frame: Vec<u8>) {
        let mut s = self.state.lock().expect("outbox lock");
        s.push_snapshot(&self.counts(), frame);
        self.wake(s, false);
    }

    /// One tick's frames for this client: one lock and one notify however many there are. Exactly equivalent to calling
    /// [`Outbox::important`], [`Outbox::fx`] and [`Outbox::snapshot`] in that order (an important frame that overflows
    /// the queue closes the outbox, and the disposable frames after it are then ignored).
    pub fn push_tick(
        &self,
        important: Option<Vec<u8>>,
        fx: Option<Vec<u8>>,
        snapshot: Option<Vec<u8>>,
    ) {
        if important.is_none() && fx.is_none() && snapshot.is_none() {
            return;
        }
        let c = self.counts();
        let mut s = self.state.lock().expect("outbox lock");
        if let Some(f) = important {
            s.push_important(&c, f);
        }
        if let Some(f) = fx {
            s.push_fx(&c, f);
        }
        if let Some(f) = snapshot {
            s.push_snapshot(&c, f);
        }
        self.wake(s, false);
    }

    pub fn counters(&self) -> OutboxCounters {
        OutboxCounters {
            fx_dropped: self.fx_dropped.load(Ordering::Relaxed),
            snapshots_skipped: self.snapshots_skipped.load(Ordering::Relaxed),
            bytes_enqueued_total: self.bytes_enqueued_total.load(Ordering::Relaxed),
        }
    }

    /// Never panics (a poisoned lock is still closed): a crashed room closes its connections while unwinding.
    pub fn close(&self, why: RejectCode) {
        let mut s = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if s.closed.is_none() {
            s.closed = Some(why);
        }
        self.wake(s, true);
    }

    /// The next single frame to write: important first, then fx, then the latest snapshot. Waits when there is none. The
    /// connection writer uses [`Outbox::wait_drain`]; this is the one-at-a-time reference order.
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

    /// Moves everything queued into `out` in the order [`Outbox::next`] would return it: all important frames, then (when
    /// the outbox is closed) the close, otherwise all fx, then the latest snapshot. Never waits.
    pub fn drain_into(&self, out: &mut Vec<Vec<u8>>) -> Drained {
        let before = out.len();
        let mut s = self.state.lock().expect("outbox lock");
        out.extend(s.important.drain(..));
        let close = s.closed;
        if close.is_none() {
            out.extend(s.fx.drain(..));
            out.extend(s.snapshot.take());
        }
        Drained {
            frames: out.len() - before,
            close,
        }
    }

    /// Waits until there is something to write, then takes all of it ([`Outbox::drain_into`]): one wake per batch.
    pub async fn wait_drain(&self, out: &mut Vec<Vec<u8>>) -> Drained {
        loop {
            let d = self.drain_into(out);
            if !d.is_empty() {
                return d;
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
    fn a_tick_push_is_one_notify_however_many_frames_and_an_empty_one_is_none() {
        let o = Outbox::default();
        o.push_tick(None, None, None);
        assert_eq!(o.notify_calls(), 0);
        o.push_tick(Some(vec![1]), Some(vec![2]), Some(vec![3]));
        assert_eq!(o.notify_calls(), 1);
        o.push_tick(None, None, Some(vec![3]));
        o.close(RejectCode::Kicked);
        assert_eq!((o.notify_calls(), o.close_notify_calls()), (3, 1));
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

    #[test]
    fn push_tick_equals_the_three_single_pushes_and_drain_equals_repeated_next() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        for case in 0..4u8 {
            let single = Outbox::default();
            let batched = Outbox::default();
            // Several ticks queue up before the writer wakes (a slow client): fx overflow, snapshot replacement.
            for tick in 0..40u8 {
                let imp = (case & 1 == 1 || tick % 7 == 0).then(|| vec![1, tick]);
                let fx = (case & 2 == 2 || tick % 3 == 0).then(|| vec![2, tick]);
                let snap = Some(vec![3, tick]);
                if let Some(f) = imp.clone() {
                    single.important(f);
                }
                if let Some(f) = fx.clone() {
                    single.fx(f);
                }
                single.snapshot(snap.clone().unwrap());
                batched.push_tick(imp, fx, snap);
            }
            assert_eq!(single.counters(), batched.counters(), "case {case}");
            let mut want = Vec::new();
            rt.block_on(async {
                while single.pending() != (0, 0, false) {
                    match single.next().await {
                        Next::Frame(f) => want.push(f),
                        Next::Close(_) => unreachable!(),
                    }
                }
            });
            let mut got = Vec::new();
            let d = batched.drain_into(&mut got);
            assert_eq!(got, want, "case {case}: byte-identical frames, old order");
            assert_eq!((d.frames, d.close), (want.len(), None));
            assert!(batched.drain_into(&mut got).is_empty());
        }
    }

    #[test]
    fn a_closed_outbox_drains_its_important_frames_then_the_close_and_drops_disposables() {
        let o = Outbox::default();
        o.push_tick(Some(vec![1]), Some(vec![2]), Some(vec![3]));
        o.close(RejectCode::RateLimited);
        o.push_tick(Some(vec![9]), Some(vec![9]), Some(vec![9]));
        let mut out = Vec::new();
        let d = o.drain_into(&mut out);
        assert_eq!(out, vec![vec![1]]);
        assert_eq!(d.close, Some(RejectCode::RateLimited));
    }

    #[test]
    fn an_important_overflow_inside_push_tick_closes_and_ignores_the_rest_of_the_tick() {
        let o = Outbox::default();
        for _ in 0..IMPORTANT_CAP {
            o.important(vec![1]);
        }
        o.push_tick(Some(vec![1]), Some(vec![2]), Some(vec![3]));
        let (imp, fx, snap) = o.pending();
        assert_eq!((imp, fx, snap), (IMPORTANT_CAP, 0, false));
        let mut out = Vec::new();
        assert_eq!(o.drain_into(&mut out).close, Some(RejectCode::TooSlow));
    }
}
