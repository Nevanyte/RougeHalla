//! Statistics the harness reports. Exact where it can be (sorted samples), fixed-resolution where the sample count is
//! unbounded (the tick-interval histogram: 1 ms buckets).

use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

/// The `p` quantile (0.0..=1.0) of ascending `sorted`, by linear interpolation between closest ranks. `None` when empty.
pub fn percentile(sorted: &[f64], p: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let p = p.clamp(0.0, 1.0);
    let pos = p * (sorted.len() - 1) as f64;
    let (lo, hi) = (pos.floor() as usize, pos.ceil() as usize);
    Some(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo as f64))
}

#[derive(Clone, Debug, PartialEq)]
pub struct Summary {
    pub count: usize,
    pub min: f64,
    pub mean: f64,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
    pub max: f64,
}

/// Summary of unsorted samples (NaN samples are dropped). `None` when nothing is left.
pub fn summarize(mut v: Vec<f64>) -> Option<Summary> {
    v.retain(|x| x.is_finite());
    if v.is_empty() {
        return None;
    }
    v.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
    Some(Summary {
        count: v.len(),
        min: v[0],
        mean: v.iter().sum::<f64>() / v.len() as f64,
        p50: percentile(&v, 0.5)?,
        p95: percentile(&v, 0.95)?,
        p99: percentile(&v, 0.99)?,
        max: *v.last()?,
    })
}

impl Summary {
    pub fn json(&self) -> Value {
        let r = |x: f64| (x * 1000.0).round() / 1000.0;
        json!({"count": self.count, "min": r(self.min), "mean": r(self.mean), "p50": r(self.p50),
               "p95": r(self.p95), "p99": r(self.p99), "max": r(self.max)})
    }
}

pub fn summary_json(v: Vec<f64>) -> Value {
    summarize(v).map_or(Value::Null, |s| s.json())
}

/// Server CPU in cores (1.0 = one fully busy core) from two cumulative CPU-time readings `wall` seconds apart.
pub fn cpu_cores(cpu_before: f64, cpu_after: f64, wall: f64) -> Option<f64> {
    (wall > 0.0 && cpu_after >= cpu_before).then(|| (cpu_after - cpu_before) / wall)
}

/// Millisecond-resolution histogram shared by many tasks (relaxed atomics). Values at or above `LIMIT_MS` share the last bucket.
pub struct MsHist {
    buckets: Vec<AtomicU64>,
}

pub const LIMIT_MS: usize = 3000;

impl Default for MsHist {
    fn default() -> Self {
        Self {
            buckets: (0..=LIMIT_MS).map(|_| AtomicU64::new(0)).collect(),
        }
    }
}

impl MsHist {
    pub fn record(&self, ms: f64) {
        let i = if ms.is_finite() && ms > 0.0 {
            (ms.round() as usize).min(LIMIT_MS)
        } else {
            0
        };
        self.buckets[i].fetch_add(1, Ordering::Relaxed);
    }
    pub fn count(&self) -> u64 {
        self.buckets.iter().map(|b| b.load(Ordering::Relaxed)).sum()
    }
    /// Smallest bucket value with at least `p` of the samples at or below it (nearest rank). 0 when empty.
    pub fn quantile(&self, p: f64) -> u64 {
        let counts: Vec<u64> = self
            .buckets
            .iter()
            .map(|b| b.load(Ordering::Relaxed))
            .collect();
        quantile_of_counts(&counts, p)
    }
    pub fn max(&self) -> u64 {
        self.buckets
            .iter()
            .rposition(|b| b.load(Ordering::Relaxed) > 0)
            .unwrap_or(0) as u64
    }
    pub fn json(&self) -> Value {
        json!({"count": self.count(), "p50": self.quantile(0.5), "p95": self.quantile(0.95),
               "p99": self.quantile(0.99), "p999": self.quantile(0.999), "max": self.max(),
               "resolutionMs": 1, "capMs": LIMIT_MS})
    }
}

pub fn quantile_of_counts(counts: &[u64], p: f64) -> u64 {
    let total: u64 = counts.iter().sum();
    if total == 0 {
        return 0;
    }
    let want = ((total as f64) * p.clamp(0.0, 1.0)).ceil().max(1.0) as u64;
    let mut seen = 0;
    for (i, c) in counts.iter().enumerate() {
        seen += c;
        if seen >= want {
            return i as u64;
        }
    }
    (counts.len() - 1) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_interpolates_and_handles_edges() {
        let v = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(percentile(&v, 0.0), Some(1.0));
        assert_eq!(percentile(&v, 1.0), Some(5.0));
        assert_eq!(percentile(&v, 0.5), Some(3.0));
        assert_eq!(percentile(&v, 0.25), Some(2.0));
        assert!((percentile(&v, 0.9).unwrap() - 4.6).abs() < 1e-9);
        assert_eq!(percentile(&[7.0], 0.99), Some(7.0));
        assert_eq!(percentile(&[], 0.5), None);
        assert_eq!(percentile(&v, 9.0), Some(5.0), "clamped");
    }

    #[test]
    fn summarize_sorts_drops_nan_and_matches_hand_math() {
        let s = summarize(vec![10.0, f64::NAN, 30.0, 20.0, 40.0]).unwrap();
        assert_eq!(s.count, 4);
        assert_eq!((s.min, s.max, s.mean), (10.0, 40.0, 25.0));
        assert_eq!(s.p50, 25.0);
        assert!(summarize(vec![f64::NAN]).is_none());
        assert!(summarize(vec![]).is_none());
        let hundred: Vec<f64> = (1..=100).map(f64::from).collect();
        let s = summarize(hundred).unwrap();
        assert!((s.p95 - 95.05).abs() < 1e-9 && (s.p99 - 99.01).abs() < 1e-9);
    }

    #[test]
    fn cpu_cores_is_a_rate_and_refuses_nonsense() {
        assert_eq!(cpu_cores(1.0, 4.0, 2.0), Some(1.5));
        assert_eq!(
            cpu_cores(5.0, 4.0, 2.0),
            None,
            "cpu time went backwards (pid reuse)"
        );
        assert_eq!(cpu_cores(1.0, 2.0, 0.0), None);
    }

    #[test]
    fn ms_hist_quantiles_are_nearest_rank_and_cap() {
        let h = MsHist::default();
        assert_eq!((h.count(), h.quantile(0.5), h.max()), (0, 0, 0));
        for ms in [50.0, 50.0, 50.0, 51.0, 120.0] {
            h.record(ms);
        }
        assert_eq!(h.count(), 5);
        assert_eq!(h.quantile(0.5), 50);
        assert_eq!(h.quantile(0.8), 51);
        assert_eq!(h.quantile(0.99), 120);
        assert_eq!(h.max(), 120);
        h.record(1e9);
        assert_eq!(h.max(), LIMIT_MS as u64);
        h.record(f64::NAN);
        assert_eq!(h.count(), 7);
    }

    #[test]
    fn quantile_of_counts_edges() {
        assert_eq!(quantile_of_counts(&[0, 0, 0], 0.5), 0);
        assert_eq!(quantile_of_counts(&[1, 0, 1], 0.0), 0);
        assert_eq!(quantile_of_counts(&[1, 0, 1], 1.0), 2);
    }
}
