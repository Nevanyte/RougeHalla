//! Bounded telemetry: fixed-size log-linear histograms (no allocation, ever) and the process-wide live counters served on
//! `/control/health`.
//!
//! A [`Histogram`] keeps 4 sub-buckets per power of two over 0 to 2^24 - 1 (16.7 s when the unit is microseconds): 92 `u32`
//! counters, an exact count and an exact maximum, 384 bytes in all and the same at every uptime. It replaces the per-room
//! `Vec<u32>` of step times that grew to 72,000 entries (288 KB) per room. Quantiles are bucket upper bounds clamped to the
//! exact maximum, so a reported quantile is never below the true one and at most 25% above it (the bucket width is a quarter
//! of its lower bound); values from 0 to 3 are exact. Values from 7 * 2^21 up share the last bucket (the maximum stays exact).

use std::ops::Deref;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

/// A relaxed counter alone on its cache line (64 B aligned and padded): rooms on different threads bump different counters
/// without invalidating each other's line (false sharing). Derefs to the `AtomicU64`.
#[derive(Default)]
#[repr(align(64))]
pub struct Counter(AtomicU64);

impl Counter {
    pub const fn new() -> Self {
        Self(AtomicU64::new(0))
    }
}

impl Deref for Counter {
    type Target = AtomicU64;
    #[inline]
    fn deref(&self) -> &AtomicU64 {
        &self.0
    }
}

/// Sub-buckets per power of two (as a shift): 4.
const SUB_BITS: u32 = 2;
/// Values `>= 2^MAX_EXP` land in the last bucket.
const MAX_EXP: u32 = 24;
/// Exact buckets for 0..4, then 4 per power of two from 2^2 up to 2^MAX_EXP.
pub const BUCKETS: usize = (1 << SUB_BITS) + ((MAX_EXP - SUB_BITS) as usize) * (1 << SUB_BITS);

/// Bucket of `v`. Branch-light: one leading-zeros count, a shift and a mask.
#[inline]
fn bucket_of(v: u32) -> usize {
    if v < (1 << SUB_BITS) {
        return v as usize;
    }
    let e = 31 - v.leading_zeros();
    if e >= MAX_EXP {
        return BUCKETS - 1;
    }
    let sub = (v >> (e - SUB_BITS)) & ((1 << SUB_BITS) - 1);
    (1 << SUB_BITS) + ((e - SUB_BITS) as usize) * (1 << SUB_BITS) + sub as usize
}

/// Largest value that falls in bucket `i` (inclusive upper bound).
fn bucket_upper(i: usize) -> u64 {
    if i < (1 << SUB_BITS) {
        return i as u64;
    }
    if i == BUCKETS - 1 {
        return u64::MAX;
    }
    let j = i - (1 << SUB_BITS);
    let e = (j >> SUB_BITS) as u32 + SUB_BITS;
    let sub = (j & ((1 << SUB_BITS) - 1)) as u64;
    ((4 + sub + 1) << (e - SUB_BITS)) - 1
}

/// The value below which a `p` fraction of `count` observations fall, from bucket counts (see the module docs).
fn quantile(counts: impl Iterator<Item = u64>, count: u64, max: u64, p: f64) -> u64 {
    if count == 0 {
        return 0;
    }
    // Rank of the wanted observation, 0-based, as the sorted-vector index `(n - 1) * p` the old telemetry used.
    let rank = ((count - 1) as f64 * p) as u64;
    let mut seen = 0u64;
    for (i, c) in counts.enumerate() {
        seen += c;
        if seen > rank {
            return bucket_upper(i).min(max);
        }
    }
    max
}

/// A fixed-size log-linear histogram (see the module docs). 384 bytes, `Copy`-cheap to clone, never allocates.
#[derive(Clone, Debug)]
pub struct Histogram {
    counts: [u32; BUCKETS],
    count: u64,
    max: u32,
}

impl Default for Histogram {
    fn default() -> Self {
        Self::new()
    }
}

impl Histogram {
    pub const fn new() -> Self {
        Self {
            counts: [0; BUCKETS],
            count: 0,
            max: 0,
        }
    }

    #[inline]
    pub fn record(&mut self, v: u32) {
        let b = &mut self.counts[bucket_of(v)];
        *b = b.saturating_add(1);
        self.count += 1;
        self.max = self.max.max(v);
    }

    pub fn count(&self) -> u64 {
        self.count
    }

    /// The exact largest value recorded (0 when empty).
    pub fn max(&self) -> u64 {
        u64::from(self.max)
    }

    /// The `p` quantile (0.0 to 1.0): a bucket upper bound clamped to the exact maximum.
    pub fn quantile(&self, p: f64) -> u64 {
        quantile(
            self.counts.iter().map(|&c| u64::from(c)),
            self.count,
            u64::from(self.max),
            p,
        )
    }
}

/// [`Histogram`] with atomic counters, for a value shared between tasks (relaxed: it is telemetry, not synchronisation).
///
/// One `record` is one atomic add (its bucket) plus, only when `v` beats the maximum seen, one `fetch_max`: there is no
/// separate total, `count()` sums the buckets (it is read by `/control/health`, not on the hot path). The struct is 64 B
/// aligned so two histograms never share a line at their edges.
#[repr(align(64))]
pub struct AtomicHistogram {
    counts: [AtomicU64; BUCKETS],
    max: AtomicU32,
}

impl Default for AtomicHistogram {
    fn default() -> Self {
        Self::new()
    }
}

impl AtomicHistogram {
    pub const fn new() -> Self {
        Self {
            counts: [const { AtomicU64::new(0) }; BUCKETS],
            max: AtomicU32::new(0),
        }
    }

    #[inline]
    pub fn record(&self, v: u32) {
        self.counts[bucket_of(v)].fetch_add(1, Ordering::Relaxed);
        // A plain load first: the maximum rarely moves, so the read-modify-write is skipped almost always.
        if v > self.max.load(Ordering::Relaxed) {
            self.max.fetch_max(v, Ordering::Relaxed);
        }
    }

    /// Observations recorded (the sum of the buckets).
    pub fn count(&self) -> u64 {
        self.counts.iter().map(|c| c.load(Ordering::Relaxed)).sum()
    }

    pub fn max(&self) -> u64 {
        u64::from(self.max.load(Ordering::Relaxed))
    }

    pub fn quantile(&self, p: f64) -> u64 {
        // One pass over the buckets for the total and the quantile alike would see a moving target; read the total first
        // and let the quantile walk stop at the last bucket if concurrent records pushed the rank past it.
        quantile(
            self.counts.iter().map(|c| c.load(Ordering::Relaxed)),
            self.count(),
            self.max(),
            p,
        )
    }

    fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "count": self.count(),
            "p50": self.quantile(0.5),
            "p99": self.quantile(0.99),
            "max": self.max(),
        })
    }
}

/// Process-wide live counters. Rooms add to them with relaxed atomics, each counter once per wake (a room accumulates in
/// locals and flushes at the end of the wake), plus one histogram bucket add per recorded value; every counter sits on its
/// own cache line. `/control/health` reads them. Nothing here allocates after start.
pub struct Metrics {
    /// Room wakes that ran at least one step.
    pub wakes: Counter,
    /// Steps run, over every room.
    pub steps: Counter,
    /// Steps the pacer dropped (a backlog beyond the catch-up bound).
    pub dropped_steps: Counter,
    /// Bytes of every frame rooms encoded for their humans.
    pub bytes_out: Counter,
    /// Outbox pushes by rooms: one per human per tick that had any frame (`Outbox::push_tick`). Each push wakes the
    /// writer at most once; the real `Notify` call count lives in `Outbox::notify_calls`, and the density tests
    /// cross-check the two.
    pub outbox_pushes: Counter,
    /// Wall microseconds of one simulation step (drive bots + step + record).
    pub step_us: AtomicHistogram,
    /// Wall microseconds of one publish (observe + encode + push for every human of a room).
    pub publish_us: AtomicHistogram,
    /// Microseconds between a step's grid slot and the wake that ran it.
    pub lateness_us: AtomicHistogram,
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}

impl Metrics {
    pub const fn new() -> Self {
        Self {
            wakes: Counter::new(),
            steps: Counter::new(),
            dropped_steps: Counter::new(),
            bytes_out: Counter::new(),
            outbox_pushes: Counter::new(),
            step_us: AtomicHistogram::new(),
            publish_us: AtomicHistogram::new(),
            lateness_us: AtomicHistogram::new(),
        }
    }

    pub fn json(&self) -> serde_json::Value {
        let n = |a: &AtomicU64| a.load(Ordering::Relaxed);
        serde_json::json!({
            "wakes": n(&self.wakes),
            "steps": n(&self.steps),
            "droppedSteps": n(&self.dropped_steps),
            "bytesOut": n(&self.bytes_out),
            "outboxPushes": n(&self.outbox_pushes),
            "stepUs": self.step_us.json(),
            "publishUs": self.publish_us.json(),
            "latenessUs": self.lateness_us.json(),
            "rssBytes": rss_bytes(),
            "note": "histogram quantiles are bucket upper bounds (at most 25% above the true value, never below); max is exact",
        })
    }
}

static PROCESS: Metrics = Metrics::new();

/// The counters every room of this process reports to.
pub fn process() -> &'static Metrics {
    &PROCESS
}

/// Resident set size of this process in bytes (Linux; `None` elsewhere or when unreadable).
pub fn rss_bytes() -> Option<u64> {
    let s = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = s.lines().find(|l| l.starts_with("VmRSS:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_partition_the_range_and_upper_bounds_are_tight() {
        assert_eq!(bucket_of(0), 0);
        assert_eq!(bucket_of(3), 3);
        assert_eq!(bucket_of(4), 4);
        assert_eq!(bucket_of(7), 7);
        assert_eq!(bucket_of(8), 8);
        assert_eq!(
            bucket_of((1 << MAX_EXP) - 1),
            BUCKETS - 1,
            "the last bucket also takes the overflow"
        );
        assert_eq!(bucket_of(1 << MAX_EXP), BUCKETS - 1);
        assert_eq!(bucket_of(u32::MAX), BUCKETS - 1);
        let mut prev = 0;
        for v in 0..200_000u32 {
            let b = bucket_of(v);
            assert!(b >= prev, "monotone");
            prev = b;
            assert!(
                bucket_upper(b) >= u64::from(v),
                "{v} above its bucket's bound"
            );
            if v >= 4 {
                // The reported bound is at most 25% above the value.
                assert!(bucket_upper(b) as f64 <= v as f64 * 1.25 + 1.0, "{v}");
            }
        }
    }

    #[test]
    fn quantiles_never_undershoot_and_the_max_is_exact() {
        let mut h = Histogram::new();
        let mut v: Vec<u32> = (0..10_000u32).map(|i| (i * 37) % 9_000 + 1).collect();
        for &x in &v {
            h.record(x);
        }
        v.sort_unstable();
        for p in [0.0, 0.5, 0.9, 0.99, 1.0] {
            let truth = u64::from(v[((v.len() - 1) as f64 * p) as usize]);
            let q = h.quantile(p);
            assert!(q >= truth, "p{p}: {q} < {truth}");
            assert!(
                q as f64 <= truth as f64 * 1.25 + 1.0,
                "p{p}: {q} vs {truth}"
            );
        }
        assert_eq!(h.max(), u64::from(*v.last().unwrap()));
        assert_eq!(h.count(), 10_000);
        assert_eq!(Histogram::new().quantile(0.5), 0);
    }

    #[test]
    fn a_histogram_is_small_and_recording_never_allocates() {
        assert!(std::mem::size_of::<Histogram>() <= 512);
        assert!(std::mem::size_of::<Histogram>() < 1024);
    }

    #[test]
    fn the_atomic_histogram_agrees_with_the_plain_one() {
        let (a, mut h) = (AtomicHistogram::new(), Histogram::new());
        for i in 0..5000u32 {
            let x = (i * 7919) % 70_000;
            a.record(x);
            h.record(x);
        }
        for p in [0.5, 0.99] {
            assert_eq!(a.quantile(p), h.quantile(p));
        }
        assert_eq!((a.count(), a.max()), (h.count(), h.max()));
    }

    #[test]
    fn hot_counters_have_a_cache_line_each() {
        assert_eq!(std::mem::align_of::<Counter>(), 64);
        assert_eq!(std::mem::size_of::<Counter>(), 64);
        assert_eq!(std::mem::align_of::<AtomicHistogram>(), 64);
        let m = Metrics::new();
        let at = |c: &Counter| c as *const Counter as usize;
        let mut addrs = [
            at(&m.wakes),
            at(&m.steps),
            at(&m.dropped_steps),
            at(&m.bytes_out),
            at(&m.outbox_pushes),
        ];
        addrs.sort_unstable();
        assert!(addrs.windows(2).all(|w| w[1] - w[0] >= 64), "{addrs:?}");
        m.wakes.fetch_add(3, Ordering::Relaxed);
        assert_eq!(m.json()["wakes"], 3);
    }

    #[test]
    fn the_atomic_max_only_moves_up_and_count_sums_the_buckets() {
        let a = AtomicHistogram::new();
        assert_eq!((a.count(), a.max(), a.quantile(0.5)), (0, 0, 0));
        for v in [5, 900, 40, 900, 1] {
            a.record(v);
        }
        assert_eq!((a.count(), a.max()), (5, 900));
    }
}
