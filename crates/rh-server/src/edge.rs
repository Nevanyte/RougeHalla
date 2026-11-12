//! Guards on the public game listener, in front of anything the game itself does.
//!
//! * `/ws` admission ([`EdgeGuard::admit_ws`]), checked BEFORE the WebSocket upgrade so a refused socket costs one small HTTP
//!   reply: the `Origin` allow-list (403), a global cap on sockets that have not finished their Hello (503), a cap on
//!   concurrent sockets per client address (429) and a new-connection token bucket per client address (429).
//! * Failed Hello credentials per client address ([`WsTicket::hello_attempt`]): a client that keeps presenting bad tickets is
//!   answered `RateLimited` before its next ticket reaches `Auth::verify` (and PostgreSQL's `verify_token`).
//! * `/ping` CORS ([`OriginPolicy::cors_allow`]): the same allow-list as `/ws`.
//! * Slow clients on the HTTP listener ([`FirstRequestAcceptor`] + [`HttpLimits`]): a connection must decide its HTTP version
//!   within the header timeout, and hyper bounds the header read of every HTTP/1 request (which also ends an idle keep-alive).
//!
//! Client address: the forwarded-address rules of the account API ([`crate::api`], one implementation). Per-address caps are
//! keyed by [`limit_key`] (IPv6 by /64). Without a forwarded-address header configured, a loopback client address is exempt
//! from the per-address caps: it is the operator's own tooling (or a proxy that was not declared, whose clients this process
//! cannot tell apart; capping it would cap the whole server). With `--client-ip-header` configured, an address that still
//! resolves to loopback or unspecified (the header missing, repeated or unparsable, or naming loopback) is NOT exempt: every
//! such request counts under one shared [`UNRESOLVED`] key, so stripping the header cannot bypass the caps (fail closed). The
//! global pending cap applies to every request. Every per-address cap of 0 is off. State is per process.

use crate::api::limits::{limit_key, AddressWindowLimiter, KeyedBuckets};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum_server::accept::Accept;
use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::net::IpAddr;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Concurrent WebSocket connections per client address (a household or a small LAN behind one NAT address fits).
pub const DEFAULT_WS_MAX_PER_IP: usize = 16;
/// New WebSocket connections per client address: a burst, then a steady rate a second (reconnect storms fit the burst).
pub const DEFAULT_WS_CONNECT_BURST: u32 = 20;
pub const DEFAULT_WS_CONNECT_PER_SECOND: u32 = 2;
/// Sockets over the whole process that are upgraded but have not finished their Hello admission (at most `HELLO_TIMEOUT`).
pub const DEFAULT_WS_MAX_PENDING: usize = 256;
/// Failed Hello credentials a minute per client address / over the whole process (0 = no limit). The process-wide cap is off
/// by default: any client could fill it and lock every honest player out of signing in.
pub const DEFAULT_WS_AUTH_FAILS_PER_MINUTE: u32 = 10;
pub const DEFAULT_WS_AUTH_FAILS_PER_MINUTE_ALL: u32 = 0;
/// How long a client has to send a request's headers (also: to decide its HTTP version after the connection is accepted).
pub const DEFAULT_HTTP_HEADER_TIMEOUT: Duration = Duration::from_secs(10);
/// The one shared key of requests whose client address could not be resolved although a forwarded-address header is
/// configured (module docs). `::` is never a real client's address.
pub const UNRESOLVED: IpAddr = IpAddr::V6(std::net::Ipv6Addr::UNSPECIFIED);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Which browser origins may open `/ws` and read `/ping`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OriginPolicy {
    /// Any origin (local development; `--ws-origins '*'`).
    Any,
    /// Only these origins (lower case, no trailing slash). Empty: no browser origin at all.
    Only(Vec<String>),
}

/// An origin as the allow-list stores it.
pub fn normalize_origin(origin: &str) -> String {
    origin.trim().trim_end_matches('/').to_ascii_lowercase()
}

impl OriginPolicy {
    /// `*` or a comma list of origins.
    pub fn parse(list: &str) -> Self {
        if list.trim() == "*" {
            return Self::Any;
        }
        Self::Only(
            list.split(',')
                .map(normalize_origin)
                .filter(|o| !o.is_empty())
                .collect(),
        )
    }

    fn listed(&self, origin: &str) -> bool {
        match self {
            Self::Any => true,
            Self::Only(list) => {
                let o = normalize_origin(origin);
                list.contains(&o)
            }
        }
    }

    /// Whether a WebSocket upgrade with these headers may proceed. A request without `Origin` is not a browser's (every
    /// browser sends it on a WebSocket handshake), so it is allowed: cross-site WebSocket hijacking needs a browser. A
    /// repeated `Origin` is refused.
    pub fn allows(&self, headers: &HeaderMap) -> bool {
        let mut values = headers.get_all(header::ORIGIN).iter();
        match (values.next(), values.next()) {
            (None, _) => true,
            (Some(_), Some(_)) => false,
            (Some(v), None) => v.to_str().is_ok_and(|o| self.listed(o)),
        }
    }

    /// The `Access-Control-Allow-Origin` value for a request from `origin`, if any.
    pub fn cors_allow(&self, origin: Option<&str>) -> Option<HeaderValue> {
        match self {
            Self::Any => Some(HeaderValue::from_static("*")),
            Self::Only(_) => origin
                .filter(|o| self.listed(o))
                .and_then(|o| HeaderValue::from_str(o).ok()),
        }
    }
}

/// The guard's configuration. `Default` is the production defaults with [`OriginPolicy::Any`] (what the library routers use;
/// main.rs derives the origin policy from its flags and the bind).
#[derive(Clone, Debug)]
pub struct EdgeConfig {
    pub origins: OriginPolicy,
    /// The forwarded-address header and its trusted proxies (the account API's `--client-ip-header`/`--trusted-proxies`).
    pub client_ip_header: Option<HeaderName>,
    pub trusted_proxies: Vec<IpAddr>,
    pub max_per_ip: usize,
    pub connect_burst: f64,
    pub connect_per_second: f64,
    pub max_pending: usize,
    pub auth_fails_per_minute: u32,
    pub auth_fails_per_minute_all: u32,
}

impl Default for EdgeConfig {
    fn default() -> Self {
        Self {
            origins: OriginPolicy::Any,
            client_ip_header: None,
            trusted_proxies: vec![],
            max_per_ip: DEFAULT_WS_MAX_PER_IP,
            connect_burst: f64::from(DEFAULT_WS_CONNECT_BURST),
            connect_per_second: f64::from(DEFAULT_WS_CONNECT_PER_SECOND),
            max_pending: DEFAULT_WS_MAX_PENDING,
            auth_fails_per_minute: DEFAULT_WS_AUTH_FAILS_PER_MINUTE,
            auth_fails_per_minute_all: DEFAULT_WS_AUTH_FAILS_PER_MINUTE_ALL,
        }
    }
}

/// The live guard state of one public listener.
pub struct EdgeGuard {
    cfg: EdgeConfig,
    open: Mutex<HashMap<IpAddr, usize>>,
    connects: KeyedBuckets<IpAddr>,
    pending: Option<Arc<Semaphore>>,
    auth_fails: AddressWindowLimiter,
}

impl EdgeGuard {
    pub fn new(cfg: EdgeConfig) -> Arc<Self> {
        Arc::new(Self {
            open: Mutex::default(),
            connects: KeyedBuckets::new(cfg.connect_burst, cfg.connect_per_second),
            pending: (cfg.max_pending > 0).then(|| Arc::new(Semaphore::new(cfg.max_pending))),
            auth_fails: AddressWindowLimiter::new(
                cfg.auth_fails_per_minute_all,
                cfg.auth_fails_per_minute,
                Duration::from_secs(60),
            ),
            cfg,
        })
    }

    pub fn config(&self) -> &EdgeConfig {
        &self.cfg
    }

    /// The client address a request counts under (`peer` is the TCP peer; `None` when the listener has no connect info).
    pub fn client_ip(&self, peer: Option<IpAddr>, headers: &HeaderMap) -> IpAddr {
        crate::api::resolve_client_ip(
            self.cfg.client_ip_header.as_ref(),
            &self.cfg.trusted_proxies,
            peer.map(|p| p.to_canonical()),
            headers,
        )
    }

    /// The per-address key, or `None` for an address the per-address caps do not apply to (module docs): a loopback or
    /// unspecified address is exempt only when no forwarded-address header is configured; with one configured it counts
    /// under the shared [`UNRESOLVED`] key.
    pub fn key(&self, ip: IpAddr) -> Option<IpAddr> {
        let k = limit_key(ip);
        if !(k.is_loopback() || k.is_unspecified()) {
            return Some(k);
        }
        self.cfg.client_ip_header.is_some().then_some(UNRESOLVED)
    }

    /// Open sockets currently counted under `ip`'s key.
    pub fn open_for(&self, ip: IpAddr) -> usize {
        self.key(ip)
            .map_or(0, |k| lock(&self.open).get(&k).copied().unwrap_or(0))
    }

    /// The checks before a WebSocket upgrade, in order: origin (403), the global pending cap (503), the per-address
    /// concurrent cap and new-connection bucket (429). The ticket holds the address's slot for the socket's whole life and
    /// the pending slot until the Hello is answered.
    pub fn admit_ws(
        self: &Arc<Self>,
        peer: Option<IpAddr>,
        headers: &HeaderMap,
    ) -> Result<WsTicket, WsRefusal> {
        if !self.cfg.origins.allows(headers) {
            return Err(WsRefusal::Origin);
        }
        let ip = self.client_ip(peer, headers);
        let pending = match &self.pending {
            None => None,
            Some(s) => match s.clone().try_acquire_owned() {
                Ok(p) => Some(p),
                Err(_) => return Err(WsRefusal::Pending),
            },
        };
        let limit = self.key(ip);
        let mut ticket = WsTicket {
            guard: self.clone(),
            ip,
            limit,
            counted: None,
            pending,
        };
        if let Some(key) = limit {
            {
                let mut open = lock(&self.open);
                let n = open.entry(key).or_insert(0);
                if self.cfg.max_per_ip > 0 && *n >= self.cfg.max_per_ip {
                    return Err(WsRefusal::PerAddress);
                }
                *n += 1;
            }
            ticket.counted = Some(key);
            if !self.connects.take(&key, Instant::now()) {
                return Err(WsRefusal::Rate);
            }
        }
        Ok(ticket)
    }
}

/// Why a WebSocket upgrade was refused; answered as a small plain-text HTTP reply, never upgraded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WsRefusal {
    /// 403: a browser origin outside the allow-list.
    Origin,
    /// 503: the process-wide cap on sockets still in their Hello.
    Pending,
    /// 429: the client address has its cap of open sockets.
    PerAddress,
    /// 429: the client address's new-connection bucket is empty.
    Rate,
}

impl WsRefusal {
    pub fn status(self) -> StatusCode {
        match self {
            Self::Origin => StatusCode::FORBIDDEN,
            Self::Pending => StatusCode::SERVICE_UNAVAILABLE,
            Self::PerAddress | Self::Rate => StatusCode::TOO_MANY_REQUESTS,
        }
    }

    /// `Retry-After` seconds (none for a refused origin: retrying cannot help).
    pub fn retry_after(self) -> Option<u64> {
        match self {
            Self::Origin => None,
            Self::Pending | Self::Rate => Some(1),
            Self::PerAddress => Some(5),
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::Origin => "origin not allowed",
            Self::Pending => "too many connections are signing in; retry shortly",
            Self::PerAddress => "too many connections from this address",
            Self::Rate => "connecting too often from this address",
        }
    }
}

impl IntoResponse for WsRefusal {
    fn into_response(self) -> Response {
        let mut r = (
            self.status(),
            [(header::CACHE_CONTROL, "no-store")],
            self.message(),
        )
            .into_response();
        if let Some(s) = self.retry_after() {
            r.headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from(s));
        }
        r
    }
}

/// One admitted WebSocket's hold on the guard. Dropping it gives back the address slot (and the pending slot if still held).
pub struct WsTicket {
    guard: Arc<EdgeGuard>,
    ip: IpAddr,
    /// The per-address key this socket counts under (`None`: exempt).
    limit: Option<IpAddr>,
    counted: Option<IpAddr>,
    pending: Option<OwnedSemaphorePermit>,
}

/// A failed-credential slot reserved by [`WsTicket::hello_attempt`] (`None`: nothing reserved).
#[must_use]
pub struct HelloAttempt(Option<(IpAddr, Instant)>);

impl WsTicket {
    pub fn client_ip(&self) -> IpAddr {
        self.ip
    }

    /// Before a fresh (non-resume) Hello reaches the credential check: reserves a failure slot for this address (the
    /// throttle check and the count in one step, so concurrent bad tickets cannot all pass), or how long to wait. A resume
    /// presents no credential and reserves nothing.
    pub fn hello_attempt(&self, resuming: bool) -> Result<HelloAttempt, Duration> {
        let Some(key) = self.limit.filter(|_| !resuming) else {
            return Ok(HelloAttempt(None));
        };
        let now = Instant::now();
        self.guard
            .auth_fails
            .reserve(key, now)
            .map(|()| HelloAttempt(Some((key, now))))
    }

    /// The Hello was answered: the reserved slot is kept only when the credentials were refused, and the socket no longer
    /// counts as pending.
    pub fn hello_done(&mut self, attempt: HelloAttempt, credentials_refused: bool) {
        if let (Some((key, at)), false) = (attempt.0, credentials_refused) {
            self.guard.auth_fails.refund(key, at);
        }
        self.pending = None;
    }
}

impl Drop for WsTicket {
    fn drop(&mut self) {
        if let Some(key) = self.counted.take() {
            let mut open = lock(&self.guard.open);
            if let Some(n) = open.get_mut(&key) {
                *n = n.saturating_sub(1);
                if *n == 0 {
                    open.remove(&key);
                }
            }
        }
    }
}

// ---- HTTP listener limits --------------------------------------------------------------------------------------

/// Timeouts of the public HTTP listener (`--http-header-timeout-secs`).
#[derive(Clone, Copy, Debug)]
pub struct HttpLimits {
    /// hyper's HTTP/1 header read timeout (from the start of a request's head, including the idle wait for the next request
    /// on a keep-alive connection) and the [`FirstRequestAcceptor`] deadline.
    pub header_read_timeout: Duration,
}

impl Default for HttpLimits {
    fn default() -> Self {
        Self {
            header_read_timeout: DEFAULT_HTTP_HEADER_TIMEOUT,
        }
    }
}

/// The HTTP/2 connection preface; hyper's version sniffing reads up to these 24 bytes before it serves anything.
const H2_PREFACE: &[u8; 24] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

/// Wraps another acceptor (plain or TLS): the accepted stream must show its HTTP version within the deadline.
///
/// Why: hyper-util's automatic version detection (used by axum-server) reads until the bytes either stop matching the HTTP/2
/// preface or complete it, with no timeout of its own. A client that connects (or finishes TLS) and then sends nothing, or a
/// slowly dripped preface prefix, would otherwise hold its connection forever; hyper's header read timeout only starts once
/// the version is known.
#[derive(Clone)]
pub struct FirstRequestAcceptor<A> {
    inner: A,
    deadline: Duration,
}

impl<A> FirstRequestAcceptor<A> {
    pub fn new(inner: A, deadline: Duration) -> Self {
        Self { inner, deadline }
    }
}

type BoxedAccept<St, Sv> = Pin<Box<dyn Future<Output = io::Result<(St, Sv)>> + Send>>;

impl<I, S, A> Accept<I, S> for FirstRequestAcceptor<A>
where
    A: Accept<I, S>,
    A::Future: Send + 'static,
    A::Stream: Unpin + Send + 'static,
    A::Service: Send + 'static,
{
    type Stream = FirstRequestDeadline<A::Stream>;
    type Service = A::Service;
    type Future = BoxedAccept<Self::Stream, Self::Service>;

    fn accept(&self, stream: I, service: S) -> Self::Future {
        let accepted = self.inner.accept(stream, service);
        let deadline = self.deadline;
        Box::pin(async move {
            let (stream, service) = accepted.await?;
            Ok((FirstRequestDeadline::new(stream, deadline), service))
        })
    }
}

/// A stream whose reads fail with `TimedOut` if the HTTP version is still undecided when the deadline passes. Once the bytes
/// read so far rule the HTTP/2 preface out (HTTP/1) or complete it (HTTP/2) it is a plain pass-through.
pub struct FirstRequestDeadline<S> {
    inner: S,
    sleep: Option<Pin<Box<tokio::time::Sleep>>>,
    matched: usize,
}

impl<S> FirstRequestDeadline<S> {
    pub fn new(inner: S, deadline: Duration) -> Self {
        Self {
            inner,
            sleep: Some(Box::pin(tokio::time::sleep(deadline))),
            matched: 0,
        }
    }

    /// Whether the deadline still applies (tests).
    pub fn armed(&self) -> bool {
        self.sleep.is_some()
    }

    fn observe(&mut self, bytes: &[u8]) {
        for &b in bytes {
            if b != H2_PREFACE[self.matched] {
                self.sleep = None;
                return;
            }
            self.matched += 1;
            if self.matched == H2_PREFACE.len() {
                self.sleep = None;
                return;
            }
        }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for FirstRequestDeadline<S> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.sleep.is_none() {
            return Pin::new(&mut this.inner).poll_read(cx, buf);
        }
        let before = buf.filled().len();
        match Pin::new(&mut this.inner).poll_read(cx, buf) {
            Poll::Ready(Ok(())) => {
                let filled = buf.filled()[before..].to_vec();
                this.observe(&filled);
                Poll::Ready(Ok(()))
            }
            Poll::Pending => {
                if let Some(sleep) = this.sleep.as_mut() {
                    if sleep.as_mut().poll(cx).is_ready() {
                        return Poll::Ready(Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "no HTTP request head within the header timeout",
                        )));
                    }
                }
                Poll::Pending
            }
            other => other,
        }
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for FirstRequestDeadline<S> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }

    fn poll_write_vectored(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write_vectored(cx, bufs)
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }
}

/// hyper settings of the public listener: a timer (without one hyper applies no header timeout at all), the HTTP/1 header
/// read timeout, and HTTP/2 bounds (keep-alive pings, concurrent streams, header list size).
pub fn configure_http<E>(b: &mut hyper_util::server::conn::auto::Builder<E>, limits: HttpLimits) {
    use hyper_util::rt::TokioTimer;
    b.http1()
        .timer(TokioTimer::new())
        .header_read_timeout(limits.header_read_timeout)
        .keep_alive(true);
    b.http2()
        .timer(TokioTimer::new())
        .keep_alive_interval(Some(Duration::from_secs(20)))
        .keep_alive_timeout(Duration::from_secs(10))
        .max_concurrent_streams(64)
        .max_header_list_size(16 * 1024);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn public(last: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, last))
    }

    fn with_origin(o: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(header::ORIGIN, HeaderValue::from_str(o).unwrap());
        h
    }

    #[test]
    fn origin_policy_allows_listed_origins_and_non_browser_clients() {
        let p = OriginPolicy::parse("https://play.rougehalla.com/, HTTPS://Other.example");
        assert_eq!(
            p,
            OriginPolicy::Only(vec![
                "https://play.rougehalla.com".into(),
                "https://other.example".into()
            ])
        );
        assert!(p.allows(&HeaderMap::new()), "no Origin: not a browser");
        assert!(p.allows(&with_origin("https://play.rougehalla.com")));
        assert!(p.allows(&with_origin("https://PLAY.rougehalla.com")));
        assert!(!p.allows(&with_origin("https://evil.example")));
        assert!(!p.allows(&with_origin("null")));
        assert!(!p.allows(&with_origin("https://play.rougehalla.com.evil.example")));
        let mut twice = with_origin("https://play.rougehalla.com");
        twice.append(
            header::ORIGIN,
            HeaderValue::from_static("https://play.rougehalla.com"),
        );
        assert!(!p.allows(&twice), "a repeated Origin is refused");
        let none = OriginPolicy::Only(vec![]);
        assert!(!none.allows(&with_origin("https://play.rougehalla.com")));
        assert!(none.allows(&HeaderMap::new()));
        assert!(OriginPolicy::parse(" * ").allows(&with_origin("https://evil.example")));
    }

    #[test]
    fn cors_allow_reflects_only_listed_origins() {
        let p = OriginPolicy::parse("https://play.rougehalla.com");
        assert_eq!(
            p.cors_allow(Some("https://play.rougehalla.com")).unwrap(),
            "https://play.rougehalla.com"
        );
        assert!(p.cors_allow(Some("https://evil.example")).is_none());
        assert!(p.cors_allow(None).is_none());
        assert_eq!(OriginPolicy::Any.cors_allow(None).unwrap(), "*");
    }

    fn guard(cfg: EdgeConfig) -> Arc<EdgeGuard> {
        EdgeGuard::new(cfg)
    }

    #[test]
    fn per_address_cap_counts_open_sockets_and_releases_on_drop() {
        let g = guard(EdgeConfig {
            max_per_ip: 2,
            ..EdgeConfig::default()
        });
        let h = HeaderMap::new();
        let a = g.admit_ws(Some(public(1)), &h).ok().unwrap();
        let b = g.admit_ws(Some(public(1)), &h).ok().unwrap();
        let refused = g.admit_ws(Some(public(1)), &h).err().unwrap();
        assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(refused.retry_after(), Some(5));
        assert_eq!(refused.into_response().headers()[header::RETRY_AFTER], "5");
        assert!(
            g.admit_ws(Some(public(2)), &h).is_ok(),
            "another address has its own cap"
        );
        assert_eq!(g.open_for(public(1)), 2);
        drop(a);
        assert_eq!(g.open_for(public(1)), 1);
        let c = g.admit_ws(Some(public(1)), &h).ok().unwrap();
        drop((b, c));
        assert_eq!(g.open_for(public(1)), 0);
        assert!(
            lock(&g.open).is_empty(),
            "no entry lingers for a closed address"
        );
    }

    #[test]
    fn ipv6_addresses_of_one_slash_64_share_the_cap() {
        let g = guard(EdgeConfig {
            max_per_ip: 1,
            ..EdgeConfig::default()
        });
        let h = HeaderMap::new();
        let _a = g
            .admit_ws(Some("2001:db8:1:2::1".parse().unwrap()), &h)
            .ok()
            .unwrap();
        assert!(g
            .admit_ws(Some("2001:db8:1:2::ffff".parse().unwrap()), &h)
            .is_err());
        assert!(g
            .admit_ws(Some("2001:db8:1:3::1".parse().unwrap()), &h)
            .is_ok());
    }

    #[test]
    fn new_connection_bucket_refuses_a_burst_past_its_size() {
        let g = guard(EdgeConfig {
            connect_burst: 3.0,
            connect_per_second: 0.001,
            ..EdgeConfig::default()
        });
        let h = HeaderMap::new();
        for _ in 0..3 {
            drop(g.admit_ws(Some(public(9)), &h).ok().unwrap());
        }
        let r = g.admit_ws(Some(public(9)), &h).err().unwrap();
        assert_eq!(r.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(g.open_for(public(9)), 0, "a refused socket holds no slot");
    }

    #[test]
    fn pending_cap_is_global_and_freed_by_an_answered_hello() {
        let g = guard(EdgeConfig {
            max_pending: 2,
            ..EdgeConfig::default()
        });
        let h = HeaderMap::new();
        let lo = Some(IpAddr::V4(Ipv4Addr::LOCALHOST));
        let mut a = g.admit_ws(lo, &h).ok().unwrap();
        let _b = g.admit_ws(Some(public(1)), &h).ok().unwrap();
        let r = g.admit_ws(Some(public(2)), &h).err().unwrap();
        assert_eq!(r.status(), StatusCode::SERVICE_UNAVAILABLE);
        let attempt = a.hello_attempt(false).unwrap();
        a.hello_done(attempt, false);
        assert!(
            g.admit_ws(Some(public(2)), &h).is_ok(),
            "the answered Hello freed its slot"
        );
    }

    #[test]
    fn origin_is_checked_before_anything_is_counted() {
        let g = guard(EdgeConfig {
            origins: OriginPolicy::parse("https://play.rougehalla.com"),
            max_pending: 1,
            ..EdgeConfig::default()
        });
        let r = g
            .admit_ws(Some(public(1)), &with_origin("https://evil.example"))
            .err()
            .unwrap();
        assert_eq!(r.status(), StatusCode::FORBIDDEN);
        assert_eq!(g.open_for(public(1)), 0);
        assert!(g
            .admit_ws(Some(public(1)), &with_origin("https://play.rougehalla.com"))
            .is_ok());
    }

    #[test]
    fn loopback_is_exempt_from_per_address_caps_but_forwarded_addresses_are_not() {
        let lo = Some(IpAddr::V4(Ipv4Addr::LOCALHOST));
        let local = guard(EdgeConfig {
            max_per_ip: 1,
            ..EdgeConfig::default()
        });
        let _held: Vec<_> = (0..5)
            .map(|_| local.admit_ws(lo, &HeaderMap::new()).ok().unwrap())
            .collect();
        let g = guard(EdgeConfig {
            max_per_ip: 1,
            client_ip_header: Some(HeaderName::from_static("x-forwarded-for")),
            ..EdgeConfig::default()
        });
        let mut fwd = HeaderMap::new();
        fwd.insert("x-forwarded-for", HeaderValue::from_static("198.51.100.7"));
        let t = g.admit_ws(lo, &fwd).ok().unwrap();
        assert_eq!(t.client_ip(), "198.51.100.7".parse::<IpAddr>().unwrap());
        assert_eq!(
            g.admit_ws(lo, &fwd).err().unwrap().status(),
            StatusCode::TOO_MANY_REQUESTS,
            "the proxied client is capped by its own address"
        );
        // An untrusted peer cannot choose its address with the header.
        let t2 = g.admit_ws(Some(public(4)), &fwd).ok().unwrap();
        assert_eq!(t2.client_ip(), public(4));
    }

    #[test]
    fn behind_a_declared_proxy_an_unresolved_address_shares_one_capped_bucket() {
        let g = guard(EdgeConfig {
            max_per_ip: 2,
            auth_fails_per_minute: 2,
            client_ip_header: Some(HeaderName::from_static("x-forwarded-for")),
            ..EdgeConfig::default()
        });
        let lo = Some(IpAddr::V4(Ipv4Addr::LOCALHOST));
        let mut dup = HeaderMap::new();
        dup.append("x-forwarded-for", HeaderValue::from_static("198.51.100.1"));
        dup.append("x-forwarded-for", HeaderValue::from_static("198.51.100.2"));
        let mut junk = HeaderMap::new();
        junk.insert("x-forwarded-for", HeaderValue::from_static("not-an-ip"));
        let mut names_loopback = HeaderMap::new();
        names_loopback.insert("x-forwarded-for", HeaderValue::from_static("127.0.0.1"));
        // Missing, repeated, unparsable or loopback-naming header: all one bucket, capped like any address.
        let a = g.admit_ws(lo, &HeaderMap::new()).ok().unwrap();
        let b = g.admit_ws(lo, &dup).ok().unwrap();
        assert_eq!(g.admit_ws(lo, &junk).err(), Some(WsRefusal::PerAddress));
        assert_eq!(
            g.admit_ws(lo, &names_loopback).err(),
            Some(WsRefusal::PerAddress)
        );
        assert_eq!(
            g.admit_ws(None, &HeaderMap::new()).err(),
            Some(WsRefusal::PerAddress)
        );
        assert_eq!(g.open_for(Ipv4Addr::LOCALHOST.into()), 2);
        // Failed credentials of unresolved requests count together too.
        let (mut a, mut b) = (a, b);
        let failed = a.hello_attempt(false).unwrap();
        a.hello_done(failed, true);
        let failed = b.hello_attempt(false).unwrap();
        b.hello_done(failed, true);
        assert!(
            a.hello_attempt(false).is_err(),
            "two failures from different unresolved requests fill the shared bucket"
        );
        // A properly forwarded address is still its own key.
        let mut fwd = HeaderMap::new();
        fwd.insert("x-forwarded-for", HeaderValue::from_static("198.51.100.7"));
        assert!(g.admit_ws(lo, &fwd).is_ok());
        drop((a, b));
        // Without a configured header, loopback stays exempt (local tooling).
        let local = guard(EdgeConfig {
            max_per_ip: 1,
            ..EdgeConfig::default()
        });
        let _held: Vec<_> = (0..4)
            .map(|_| local.admit_ws(lo, &HeaderMap::new()).ok().unwrap())
            .collect();
    }

    #[test]
    fn failed_hellos_are_throttled_per_address_and_good_ones_refunded() {
        let g = guard(EdgeConfig {
            auth_fails_per_minute: 2,
            ..EdgeConfig::default()
        });
        let h = HeaderMap::new();
        let mut t = g.admit_ws(Some(public(1)), &h).ok().unwrap();
        for _ in 0..5 {
            let a = t.hello_attempt(false).unwrap();
            t.hello_done(a, false);
        }
        for _ in 0..2 {
            let a = t.hello_attempt(false).unwrap();
            t.hello_done(a, true);
        }
        assert!(
            t.hello_attempt(false).is_err(),
            "third failure in a minute is throttled"
        );
        assert!(
            t.hello_attempt(true).is_ok(),
            "a resume carries no credential"
        );
        let t2 = g.admit_ws(Some(public(2)), &h).ok().unwrap();
        assert!(
            t2.hello_attempt(false).is_ok(),
            "another address is unaffected"
        );
        let lo = g
            .admit_ws(Some(IpAddr::V4(Ipv4Addr::LOCALHOST)), &h)
            .ok()
            .unwrap();
        for _ in 0..10 {
            let a = lo.hello_attempt(false).unwrap();
            drop(a);
        }
    }

    #[test]
    fn concurrent_bad_tickets_cannot_all_pass_the_throttle() {
        let g = guard(EdgeConfig {
            auth_fails_per_minute: 3,
            max_per_ip: 0,
            connect_burst: 0.0,
            ..EdgeConfig::default()
        });
        let h = HeaderMap::new();
        let tickets: Vec<_> = (0..16)
            .map(|_| g.admit_ws(Some(public(1)), &h).ok().unwrap())
            .collect();
        let reserved: Vec<_> = tickets
            .iter()
            .filter_map(|t| t.hello_attempt(false).ok())
            .collect();
        assert_eq!(
            reserved.len(),
            3,
            "in-flight attempts count before their outcome"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_silent_connection_times_out_and_a_decided_one_does_not() {
        let (client, server) = tokio::io::duplex(64);
        let mut s = FirstRequestDeadline::new(server, Duration::from_secs(10));
        let read = tokio::spawn(async move {
            let mut b = [0u8; 8];
            s.read(&mut b).await
        });
        tokio::time::sleep(Duration::from_secs(11)).await;
        let err = read.await.unwrap().unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
        drop(client);

        let (mut client, server) = tokio::io::duplex(64);
        let mut s = FirstRequestDeadline::new(server, Duration::from_secs(10));
        client.write_all(b"GET").await.unwrap();
        let mut b = [0u8; 8];
        assert_eq!(s.read(&mut b).await.unwrap(), 3);
        assert!(
            !s.armed(),
            "a byte that is not the HTTP/2 preface decides HTTP/1"
        );
        let read = tokio::spawn(async move {
            let mut b = [0u8; 8];
            s.read(&mut b).await.map(|n| (n, b))
        });
        tokio::time::sleep(Duration::from_secs(60)).await;
        client.write_all(b" /").await.unwrap();
        assert_eq!(
            read.await.unwrap().unwrap().0,
            2,
            "hyper's own header timeout owns it now"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_dripped_preface_prefix_still_times_out_and_a_full_one_disarms() {
        let (mut client, server) = tokio::io::duplex(64);
        let mut s = FirstRequestDeadline::new(server, Duration::from_secs(10));
        client.write_all(b"PRI * ").await.unwrap();
        let mut b = [0u8; 64];
        assert_eq!(s.read(&mut b).await.unwrap(), 6);
        assert!(s.armed());
        let read = tokio::spawn(async move {
            let mut b = [0u8; 64];
            s.read(&mut b).await
        });
        tokio::time::sleep(Duration::from_secs(11)).await;
        assert_eq!(
            read.await.unwrap().unwrap_err().kind(),
            io::ErrorKind::TimedOut
        );

        let (mut client, server) = tokio::io::duplex(64);
        let mut s = FirstRequestDeadline::new(server, Duration::from_secs(10));
        client.write_all(H2_PREFACE).await.unwrap();
        let mut got = 0;
        while got < H2_PREFACE.len() {
            got += s.read(&mut b[got..]).await.unwrap();
        }
        assert!(!s.armed());
    }
}
