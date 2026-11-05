//! Rate-limit and passcode guards of the account API (legacy `packages/server/src/guards/{tokenBucket,windowLimiter,passcode}.ts`).
//!
//! Pure in-process state on a caller-supplied clock (`Instant`), with no timers and no I/O, so they are unit tested with made-up
//! times. They are an adapter layer in front of the handlers: a limit of 0 turns one off, which is how an edge limiter (WAF,
//! ALB rules, API gateway) takes over later without touching handler code. Keys are peer addresses (or profile ids for the
//! shop), never request-supplied names. State is per process: with N hosts the effective caps are N times these.

use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::hash::Hash;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Constant-time equality (the time does not depend on where the inputs first differ).
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= usize::from(a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0));
    }
    diff == 0
}

/// The key a per-address cap counts under. IPv4 is the address itself; IPv6 is its /64, because one subscriber is routinely
/// handed a whole /64 (or more) and could otherwise spread across 2^64 "addresses" to dodge every cap. An IPv4-mapped IPv6
/// address counts as the IPv4 it carries.
pub fn limit_key(ip: IpAddr) -> IpAddr {
    match ip.to_canonical() {
        IpAddr::V6(v6) => {
            let mut o = v6.octets();
            o[8..].fill(0);
            IpAddr::V6(o.into())
        }
        v4 => v4,
    }
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

impl Bucket {
    fn refill(&mut self, now: Instant, cap: f64, per_sec: f64) {
        // A clock that did not advance mints nothing.
        let dt = now.saturating_duration_since(self.last).as_secs_f64();
        self.tokens = (self.tokens + dt * per_sec).min(cap);
        if now > self.last {
            self.last = now;
        }
    }
}

/// One token bucket per key: a burst of `burst` goes through, then `per_second` steady. Buckets that refilled completely are
/// dropped when the map grows past `sweep_above`, so it cannot grow without bound. `burst` or `per_second` of 0 disables it.
pub struct KeyedBuckets<K> {
    burst: f64,
    per_second: f64,
    sweep_above: usize,
    map: Mutex<HashMap<K, Bucket>>,
}

impl<K: Hash + Eq + Clone> KeyedBuckets<K> {
    pub fn new(burst: f64, per_second: f64) -> Self {
        Self {
            burst,
            per_second,
            sweep_above: 512,
            map: Mutex::default(),
        }
    }

    pub fn enabled(&self) -> bool {
        self.burst > 0.0 && self.per_second > 0.0
    }

    /// Spends one token; false (and nothing spent) when the bucket is empty.
    pub fn take(&self, key: &K, now: Instant) -> bool {
        if !self.enabled() {
            return true;
        }
        let mut map = lock(&self.map);
        if !map.contains_key(key) && map.len() >= self.sweep_above {
            let (cap, rate) = (self.burst, self.per_second);
            map.retain(|_, b| {
                b.refill(now, cap, rate);
                b.tokens < cap
            });
        }
        let b = map.entry(key.clone()).or_insert(Bucket {
            tokens: self.burst,
            last: now,
        });
        b.refill(now, self.burst, self.per_second);
        if b.tokens >= 1.0 {
            b.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    pub fn len(&self) -> usize {
        lock(&self.map).len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// At most `max` events in any trailing `span` (`max` of 0: no limit).
struct Window {
    max: u32,
    span: Duration,
    stamps: VecDeque<Instant>,
}

impl Window {
    fn new(max: u32, span: Duration) -> Self {
        Self {
            max,
            span,
            stamps: VecDeque::new(),
        }
    }
    fn prune(&mut self, now: Instant) {
        while let Some(&t) = self.stamps.front() {
            if now.saturating_duration_since(t) >= self.span {
                self.stamps.pop_front();
            } else {
                break;
            }
        }
    }
    fn retry_after(&mut self, now: Instant) -> Duration {
        self.prune(now);
        if self.max == 0 || self.stamps.len() < self.max as usize {
            return Duration::ZERO;
        }
        let oldest_counted = self.stamps[self.stamps.len() - self.max as usize];
        (oldest_counted + self.span).saturating_duration_since(now)
    }
    fn record(&mut self, now: Instant) {
        // A cap of 0 means "no limit": nothing is ever counted against it, so nothing may accumulate either.
        if self.max == 0 {
            return;
        }
        self.prune(now);
        self.stamps.push_back(now);
    }
    fn unrecord(&mut self, at: Instant) {
        if let Some(i) = self.stamps.iter().rposition(|&t| t == at) {
            self.stamps.remove(i);
        }
    }
    fn is_empty(&mut self, now: Instant) -> bool {
        self.prune(now);
        self.stamps.is_empty()
    }
}

struct AddressInner {
    all: Window,
    per_ip: HashMap<IpAddr, Window>,
}

/// "At most N in a window" over the whole server and per client address. Only events that happened are recorded; `reserve`
/// records before the work (so concurrent requests cannot all pass one check) and `refund` takes it back when the work did
/// not happen.
pub struct AddressWindowLimiter {
    max_per_ip: u32,
    span: Duration,
    inner: Mutex<AddressInner>,
}

impl AddressWindowLimiter {
    pub fn new(max_all: u32, max_per_ip: u32, span: Duration) -> Self {
        Self {
            max_per_ip,
            span,
            inner: Mutex::new(AddressInner {
                all: Window::new(max_all, span),
                per_ip: HashMap::new(),
            }),
        }
    }

    fn wait(inner: &mut AddressInner, ip: IpAddr, now: Instant) -> Duration {
        let own = inner
            .per_ip
            .get_mut(&ip)
            .map_or(Duration::ZERO, |w| w.retry_after(now));
        inner.all.retry_after(now).max(own)
    }

    fn add(&self, inner: &mut AddressInner, ip: IpAddr, now: Instant) {
        inner.all.record(now);
        if self.max_per_ip == 0 {
            return;
        }
        let span = self.span;
        let max = self.max_per_ip;
        inner
            .per_ip
            .entry(ip)
            .or_insert_with(|| Window::new(max, span))
            .record(now);
        if inner.per_ip.len() > 256 {
            inner.per_ip.retain(|_, w| !w.is_empty(now));
        }
    }

    /// Zero when `ip` may go ahead, else how long it must wait.
    pub fn retry_after(&self, ip: IpAddr, now: Instant) -> Duration {
        Self::wait(&mut lock(&self.inner), limit_key(ip), now)
    }

    /// Checks and records in one step.
    pub fn reserve(&self, ip: IpAddr, now: Instant) -> Result<(), Duration> {
        let ip = limit_key(ip);
        let mut inner = lock(&self.inner);
        let wait = Self::wait(&mut inner, ip, now);
        if wait > Duration::ZERO {
            return Err(wait);
        }
        self.add(&mut inner, ip, now);
        Ok(())
    }

    /// Takes back the event `reserve` recorded at `at`.
    pub fn refund(&self, ip: IpAddr, at: Instant) {
        let ip = limit_key(ip);
        let mut inner = lock(&self.inner);
        inner.all.unrecord(at);
        if let Some(w) = inner.per_ip.get_mut(&ip) {
            w.unrecord(at);
        }
    }

    pub fn record(&self, ip: IpAddr, now: Instant) {
        let ip = limit_key(ip);
        let mut inner = lock(&self.inner);
        self.add(&mut inner, ip, now);
    }

    pub fn addresses(&self) -> usize {
        lock(&self.inner).per_ip.len()
    }

    /// Events currently counted over the whole server (0 for a limiter whose total cap is 0).
    pub fn counted_total(&self, now: Instant) -> usize {
        let mut inner = lock(&self.inner);
        inner.all.prune(now);
        inner.all.stamps.len()
    }
}

pub enum PasscodeVerdict {
    Ok,
    Missing,
    Wrong,
    Throttled(Duration),
}

/// The playtest passcode with a limit on wrong guesses. An address that used up its guesses is refused BEFORE the comparison,
/// so a right guess past the limit tells it nothing. Both sides are hashed first and compared in constant time. With no
/// passcode set nothing is asked or counted; a request carrying no passcode guesses nothing.
pub struct PasscodeGate {
    expected: Option<[u8; 32]>,
    fails: AddressWindowLimiter,
}

impl PasscodeGate {
    pub fn new(expected: Option<&str>, per_minute_per_ip: u32, per_minute_all: u32) -> Self {
        Self {
            expected: expected.map(|p| Sha256::digest(p.as_bytes()).into()),
            fails: AddressWindowLimiter::new(
                per_minute_all,
                per_minute_per_ip,
                Duration::from_secs(60),
            ),
        }
    }

    pub fn required(&self) -> bool {
        self.expected.is_some()
    }

    /// One atomic step: a failure slot is RESERVED under the limiter's single lock (which is also the throttle check), and
    /// handed back when the guess turns out right or absent. Checking first and recording after would let any number of
    /// concurrent wrong guesses all pass the check before the first one was counted.
    pub fn check(&self, given: Option<&str>, ip: IpAddr, now: Instant) -> PasscodeVerdict {
        let Some(expected) = &self.expected else {
            return PasscodeVerdict::Ok;
        };
        if let Err(wait) = self.fails.reserve(ip, now) {
            return PasscodeVerdict::Throttled(wait);
        }
        let Some(given) = given else {
            self.fails.refund(ip, now);
            return PasscodeVerdict::Missing;
        };
        let digest: [u8; 32] = Sha256::digest(given.as_bytes()).into();
        if ct_eq(&digest, expected) {
            self.fails.refund(ip, now);
            return PasscodeVerdict::Ok;
        }
        PasscodeVerdict::Wrong
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IP1: IpAddr = IpAddr::V4(std::net::Ipv4Addr::new(10, 0, 0, 1));
    const IP2: IpAddr = IpAddr::V4(std::net::Ipv4Addr::new(10, 0, 0, 2));

    #[test]
    fn bucket_bursts_then_refills() {
        let t0 = Instant::now();
        let b = KeyedBuckets::<i64>::new(6.0, 3.0);
        for _ in 0..6 {
            assert!(b.take(&1, t0));
        }
        assert!(!b.take(&1, t0));
        assert!(b.take(&2, t0), "another key has its own bucket");
        assert!(!b.take(&1, t0 + Duration::from_millis(300)));
        assert!(b.take(&1, t0 + Duration::from_millis(400)));
        assert!(!b.take(&1, t0 + Duration::from_millis(400)));
        let off = KeyedBuckets::<i64>::new(0.0, 3.0);
        assert!(off.take(&1, t0) && off.take(&1, t0));
    }

    #[test]
    fn bucket_map_is_swept() {
        let t0 = Instant::now();
        let mut b = KeyedBuckets::<i64>::new(1.0, 1.0);
        b.sweep_above = 4;
        for k in 0..4 {
            assert!(b.take(&k, t0));
        }
        assert!(b.take(&99, t0 + Duration::from_secs(5)));
        assert_eq!(b.len(), 1);
    }

    #[test]
    fn window_caps_total_and_per_address_and_refunds() {
        let t0 = Instant::now();
        let l = AddressWindowLimiter::new(3, 2, Duration::from_secs(3600));
        assert!(l.reserve(IP1, t0).is_ok());
        assert!(l.reserve(IP1, t0 + Duration::from_secs(1)).is_ok());
        let wait = l.reserve(IP1, t0 + Duration::from_secs(2)).unwrap_err();
        assert!(wait > Duration::from_secs(3590));
        assert!(l.reserve(IP2, t0 + Duration::from_secs(3)).is_ok());
        assert!(
            l.reserve(IP2, t0 + Duration::from_secs(4)).is_err(),
            "total cap"
        );
        l.refund(IP2, t0 + Duration::from_secs(3));
        assert!(l.reserve(IP2, t0 + Duration::from_secs(5)).is_ok());
        assert!(
            l.reserve(IP1, t0 + Duration::from_secs(3601)).is_ok(),
            "window slid"
        );
    }

    #[test]
    fn passcode_gate_throttles_before_comparing() {
        let t0 = Instant::now();
        let g = PasscodeGate::new(Some("open sesame"), 2, 100);
        assert!(matches!(g.check(None, IP1, t0), PasscodeVerdict::Missing));
        assert!(matches!(
            g.check(Some("nope"), IP1, t0),
            PasscodeVerdict::Wrong
        ));
        assert!(matches!(
            g.check(Some("nope2"), IP1, t0),
            PasscodeVerdict::Wrong
        ));
        assert!(matches!(
            g.check(Some("open sesame"), IP1, t0),
            PasscodeVerdict::Throttled(_)
        ));
        assert!(matches!(
            g.check(Some("open sesame"), IP2, t0),
            PasscodeVerdict::Ok
        ));
        let none = PasscodeGate::new(None, 2, 2);
        assert!(matches!(none.check(None, IP1, t0), PasscodeVerdict::Ok));
    }

    #[test]
    fn ct_eq_matches_normal_equality() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"ab"));
        assert!(ct_eq(b"", b""));
    }

    #[test]
    fn concurrent_wrong_guesses_cannot_all_pass_the_throttle() {
        for round in 0..20 {
            let g = std::sync::Arc::new(PasscodeGate::new(Some("open sesame"), 3, 1000));
            let t0 = Instant::now();
            let barrier = std::sync::Arc::new(std::sync::Barrier::new(16));
            let hs: Vec<_> = (0..16)
                .map(|i| {
                    let (g, b) = (g.clone(), barrier.clone());
                    std::thread::spawn(move || {
                        b.wait();
                        matches!(
                            g.check(Some(&format!("guess{i}")), IP1, t0),
                            PasscodeVerdict::Wrong
                        )
                    })
                })
                .collect();
            let wrong = hs
                .into_iter()
                .map(|h| h.join().unwrap())
                .filter(|w| *w)
                .count();
            assert_eq!(
                wrong, 3,
                "round {round}: only 3 guesses may be compared, the rest are throttled"
            );
        }
    }

    #[test]
    fn a_right_or_absent_passcode_does_not_spend_a_failure_slot() {
        let t0 = Instant::now();
        let g = PasscodeGate::new(Some("pw"), 2, 100);
        for _ in 0..5 {
            assert!(matches!(g.check(Some("pw"), IP1, t0), PasscodeVerdict::Ok));
            assert!(matches!(g.check(None, IP1, t0), PasscodeVerdict::Missing));
        }
        assert!(matches!(
            g.check(Some("x"), IP1, t0),
            PasscodeVerdict::Wrong
        ));
        assert!(matches!(
            g.check(Some("y"), IP1, t0),
            PasscodeVerdict::Wrong
        ));
        assert!(matches!(
            g.check(Some("pw"), IP1, t0),
            PasscodeVerdict::Throttled(_)
        ));
    }

    #[test]
    fn ipv6_counts_by_slash_64_and_mapped_ipv4_as_ipv4() {
        let a: IpAddr = "2001:db8:1:2:aaaa::1".parse().unwrap();
        let b: IpAddr = "2001:db8:1:2:bbbb::9".parse().unwrap();
        let other: IpAddr = "2001:db8:1:3::1".parse().unwrap();
        assert_eq!(limit_key(a), limit_key(b));
        assert_ne!(limit_key(a), limit_key(other));
        assert_eq!(limit_key("::ffff:10.0.0.1".parse().unwrap()), IP1);
        let t0 = Instant::now();
        let l = AddressWindowLimiter::new(0, 2, Duration::from_secs(3600));
        assert!(l.reserve(a, t0).is_ok());
        assert!(l.reserve(b, t0).is_ok());
        assert!(
            l.reserve(a, t0).is_err(),
            "two addresses of one /64 share a cap"
        );
        assert!(l.reserve(other, t0).is_ok());
        let bk = KeyedBuckets::<IpAddr>::new(1.0, 0.001);
        assert!(bk.take(&limit_key(a), t0));
        assert!(!bk.take(&limit_key(b), t0));
    }

    #[test]
    fn a_zero_cap_records_nothing() {
        let t0 = Instant::now();
        let l = AddressWindowLimiter::new(0, 0, Duration::from_secs(3600));
        for i in 0..1000 {
            let ip = IpAddr::V4(std::net::Ipv4Addr::new(
                10,
                1,
                (i / 250) as u8,
                (i % 250) as u8,
            ));
            assert!(l.reserve(ip, t0).is_ok());
            l.record(ip, t0);
        }
        assert_eq!(
            l.counted_total(t0),
            0,
            "no stamps pile up against a cap of 0"
        );
        assert_eq!(
            l.addresses(),
            0,
            "no per-address windows are created either"
        );
    }
}
