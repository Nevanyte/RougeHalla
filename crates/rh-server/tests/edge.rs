//! The public edge (src/edge.rs) on the real serve path with real sockets: `/ws` origin allow-list, per-address and global
//! connection caps refused before the upgrade, failed-Hello throttling, `/ping` CORS, the trimmed public `/info` (its
//! counters now on `/control/info`), the HTTP header/first-request timeouts, and the binary's refusal of insecure public
//! settings.

#[path = "support/http.rs"]
mod http;
#[path = "support/ws.rs"]
mod ws;

use futures_util::{SinkExt, StreamExt};
use rh_protocol::RejectCode;
use rh_server::api::{AccountApi, ApiConfig};
use rh_server::director::{Director, DirectorConfig};
use rh_server::edge::{EdgeConfig, EdgeGuard, HttpLimits, OriginPolicy};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

const ORIGIN: &str = "https://play.rougehalla.com";

struct Rig {
    public: SocketAddr,
    control: SocketAddr,
    handle: axum_server::Handle,
}

async fn rig(edge: EdgeConfig, limits: HttpLimits) -> Rig {
    let tokens = [("alice", "alice-token"), ("bob", "bob-token")]
        .iter()
        .map(|(c, t)| (c.to_string(), t.to_string()))
        .collect();
    rig_with_auth(edge, limits, Auth::Static(tokens)).await
}

async fn rig_with_auth(edge: EdgeConfig, limits: HttpLimits, auth: Auth) -> Rig {
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        DirectorConfig::new(Default::default(), rh_sim::arenas::practice_arena()),
        Arc::new(Persistence::memory()),
        Arc::new(auth),
        lifecycle.clone(),
    );
    let app = rh_server::public_router_with_api_guarded(
        director.clone(),
        AccountApi::disabled(ApiConfig::default()),
        EdgeGuard::new(edge),
    );
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve_with_limits(
            "127.0.0.1:0".parse().unwrap(),
            None,
            app,
            h,
            rh_server::NoDelay::new(),
            limits,
        )
        .await
        .unwrap()
    });
    let public = handle.listening().await.expect("listening");
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let control = l.local_addr().unwrap();
    let router = rh_server::control_router(director);
    tokio::spawn(async move { axum::serve(l, router).await.unwrap() });
    lifecycle.ready();
    Rig {
        public,
        control,
        handle,
    }
}

/// The proxy shape of the shipped deployments: the forwarded header is read from the loopback peer.
fn proxied(cfg: EdgeConfig) -> EdgeConfig {
    EdgeConfig {
        client_ip_header: Some(axum::http::HeaderName::from_static("x-forwarded-for")),
        trusted_proxies: vec!["127.0.0.1".parse().unwrap()],
        ..cfg
    }
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// A WebSocket handshake with extra headers: the socket, or the HTTP status of the refusal.
async fn open(addr: SocketAddr, headers: &[(&str, &str)]) -> Result<Socket, u16> {
    let mut req = format!("ws://{addr}/ws").into_client_request().unwrap();
    for (k, v) in headers {
        req.headers_mut().insert(
            axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
            v.parse().unwrap(),
        );
    }
    match tokio_tungstenite::connect_async(req).await {
        Ok((s, _)) => Ok(s),
        Err(tokio_tungstenite::tungstenite::Error::Http(r)) => Err(r.status().as_u16()),
        Err(e) => panic!("handshake failed: {e}"),
    }
}

/// Sends a Hello and returns the Reject code, or `None` for a Welcome.
async fn hello(sock: &mut Socket, callsign: &str, ticket: &str) -> Option<RejectCode> {
    hello_reason(sock, callsign, ticket)
        .await
        .map(|(code, _)| code)
}

/// [`hello`] with the Reject reason.
async fn hello_reason(
    sock: &mut Socket,
    callsign: &str,
    ticket: &str,
) -> Option<(RejectCode, String)> {
    sock.send(Message::Binary(
        ws::hello(callsign, ticket, None).encode().into(),
    ))
    .await
    .unwrap();
    let mut track = rh_protocol::SnapshotTracker::new();
    loop {
        let next = tokio::time::timeout(Duration::from_secs(3), sock.next())
            .await
            .expect("a frame within 3 s");
        let Some(Ok(Message::Binary(b))) = next else {
            panic!("socket ended before Welcome or Reject: {next:?}");
        };
        match track.decode(&b).expect("frames decode") {
            rh_protocol::ServerMsg::Welcome { .. } => return None,
            rh_protocol::ServerMsg::Reject { code, reason } => return Some((code, reason)),
            _ => {}
        }
    }
}

#[tokio::test]
async fn public_info_is_trimmed_and_the_counters_moved_to_control() {
    let r = rig(EdgeConfig::default(), HttpLimits::default()).await;
    let info = http::get(r.public, "/info", &[]).await;
    assert_eq!(info.status, 200);
    assert_eq!(info.header("cache-control"), Some("no-store"));
    let v = info.json();
    let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
    assert_eq!(keys, ["contentHash", "protocol", "state"]);
    assert_eq!(v["protocol"], rh_protocol::PROTOCOL_VERSION);
    assert_eq!(
        v["contentHash"],
        format!("{:016x}", rh_sim::content::content_hash())
    );
    assert_eq!(v["state"], "ready");
    let ctl = http::get(r.control, "/control/info", &[]).await;
    assert_eq!(ctl.status, 200);
    let c = ctl.json();
    for key in [
        "protocol",
        "contentHash",
        "rooms",
        "lobbies",
        "maxRooms",
        "players",
        "state",
        "resultsOk",
        "resultsFailed",
        "resultsRefused",
        "closedRooms",
    ] {
        assert!(c.get(key).is_some(), "/control/info lacks {key}: {c}");
    }
    assert_eq!(c.as_object().unwrap().len(), 11);
    // The public listener does not serve the control surface.
    assert_eq!(http::get(r.public, "/control/info", &[]).await.status, 404);
    r.handle.shutdown();
}

#[tokio::test]
async fn ws_origin_allow_list_refuses_foreign_browsers_before_the_upgrade() {
    let r = rig(
        EdgeConfig {
            origins: OriginPolicy::parse(ORIGIN),
            ..EdgeConfig::default()
        },
        HttpLimits::default(),
    )
    .await;
    assert_eq!(
        open(r.public, &[("origin", "https://evil.example")])
            .await
            .err(),
        Some(403)
    );
    assert_eq!(open(r.public, &[("origin", "null")]).await.err(), Some(403));
    let mut ok = open(r.public, &[("origin", ORIGIN)]).await.unwrap();
    assert_eq!(hello(&mut ok, "alice", "alice-token").await, None);
    // A non-browser client (no Origin) still connects: the Unity editor, tools, bots.
    let mut tool = open(r.public, &[]).await.unwrap();
    assert_eq!(hello(&mut tool, "bob", "bob-token").await, None);
    r.handle.shutdown();
}

#[tokio::test]
async fn ping_cors_follows_the_origin_policy() {
    let r = rig(
        EdgeConfig {
            origins: OriginPolicy::parse(ORIGIN),
            ..EdgeConfig::default()
        },
        HttpLimits::default(),
    )
    .await;
    let ok = http::get(r.public, "/ping", &[("origin", ORIGIN)]).await;
    assert_eq!(ok.body, "pong");
    assert_eq!(ok.header("access-control-allow-origin"), Some(ORIGIN));
    assert_eq!(ok.header("vary"), Some("Origin"));
    let foreign = http::get(r.public, "/ping", &[("origin", "https://evil.example")]).await;
    assert_eq!(foreign.status, 200);
    assert_eq!(foreign.header("access-control-allow-origin"), None);
    r.handle.shutdown();

    let any = rig(EdgeConfig::default(), HttpLimits::default()).await;
    let p = http::get(any.public, "/ping", &[("origin", "https://elsewhere.test")]).await;
    assert_eq!(p.header("access-control-allow-origin"), Some("*"));
    any.handle.shutdown();
}

#[tokio::test]
async fn per_address_cap_and_connect_rate_answer_429_before_the_upgrade() {
    let r = rig(
        proxied(EdgeConfig {
            max_per_ip: 2,
            connect_burst: 3.0,
            connect_per_second: 0.01,
            ..EdgeConfig::default()
        }),
        HttpLimits::default(),
    )
    .await;
    let from = |ip: &'static str| [("x-forwarded-for", ip)];
    let a = open(r.public, &from("198.51.100.1")).await.unwrap();
    let b = open(r.public, &from("198.51.100.1")).await.unwrap();
    assert_eq!(
        open(r.public, &from("198.51.100.1")).await.err(),
        Some(429),
        "third concurrent socket from one address"
    );
    let other = open(r.public, &from("198.51.100.2")).await.unwrap();
    drop((a, b));
    // The slots come back when the sockets end (the server notices the close after its Hello wait).
    let started = Instant::now();
    let third = loop {
        match open(r.public, &from("198.51.100.1")).await {
            Ok(s) => break s,
            Err(429) if started.elapsed() < Duration::from_secs(8) => {
                tokio::time::sleep(Duration::from_millis(100)).await
            }
            Err(s) => panic!("slot never came back: {s}"),
        }
    };
    drop(third);
    // That address has now spent its burst of 3 connections: the bucket refuses the next one even with free slots.
    assert_eq!(open(r.public, &from("198.51.100.1")).await.err(), Some(429));
    drop(other);
    r.handle.shutdown();
}

#[tokio::test]
async fn global_pending_cap_answers_503_until_a_hello_is_answered() {
    let r = rig(
        EdgeConfig {
            max_pending: 2,
            ..EdgeConfig::default()
        },
        HttpLimits::default(),
    )
    .await;
    let mut a = open(r.public, &[]).await.unwrap();
    let _b = open(r.public, &[]).await.unwrap();
    assert_eq!(open(r.public, &[]).await.err(), Some(503));
    assert_eq!(hello(&mut a, "alice", "alice-token").await, None);
    let mut c = open(r.public, &[]).await.unwrap();
    assert_eq!(hello(&mut c, "bob", "bob-token").await, None);
    r.handle.shutdown();
}

#[tokio::test]
async fn repeated_bad_tickets_are_rate_limited_before_the_credential_check() {
    let r = rig(
        proxied(EdgeConfig {
            auth_fails_per_minute: 3,
            ..EdgeConfig::default()
        }),
        HttpLimits::default(),
    )
    .await;
    let attacker = [("x-forwarded-for", "203.0.113.66")];
    for _ in 0..3 {
        let mut s = open(r.public, &attacker).await.unwrap();
        assert_eq!(
            hello(&mut s, "alice", "guess").await,
            Some(RejectCode::BadCredentials)
        );
    }
    let mut s = open(r.public, &attacker).await.unwrap();
    assert_eq!(
        hello(&mut s, "alice", "alice-token").await,
        Some(RejectCode::RateLimited),
        "even the right ticket is not checked once the address is over its limit"
    );
    let mut honest = open(r.public, &[("x-forwarded-for", "203.0.113.7")])
        .await
        .unwrap();
    assert_eq!(hello(&mut honest, "alice", "alice-token").await, None);
    r.handle.shutdown();
}

#[tokio::test]
async fn slow_or_silent_http_clients_are_disconnected_by_the_header_timeout() {
    let r = rig(
        EdgeConfig::default(),
        HttpLimits {
            header_read_timeout: Duration::from_secs(1),
        },
    )
    .await;
    // Silent after connecting, a dripped HTTP/2 preface prefix, and a request head that never ends.
    for first in [
        &b""[..],
        b"PRI * HTTP",
        b"GET /info HTTP/1.1\r\nHost: x\r\n",
    ] {
        let mut s = tokio::net::TcpStream::connect(r.public).await.unwrap();
        s.write_all(first).await.unwrap();
        let started = Instant::now();
        let mut buf = [0u8; 512];
        let n = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                match s.read(&mut buf).await {
                    Ok(0) | Err(_) => return 0,
                    Ok(_) => continue,
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("{first:?}: still open after 5 s"));
        assert_eq!(n, 0);
        assert!(
            started.elapsed() < Duration::from_secs(4),
            "{first:?} closed after {:?}",
            started.elapsed()
        );
    }
    // A prompt request is served as before, and a WebSocket outlives the header timeout.
    assert_eq!(http::get(r.public, "/healthz", &[]).await.status, 200);
    let mut sock = open(r.public, &[]).await.unwrap();
    assert_eq!(hello(&mut sock, "alice", "alice-token").await, None);
    tokio::time::sleep(Duration::from_millis(2500)).await;
    sock.send(Message::Binary(
        rh_protocol::ClientMsg::Ping {
            nonce: 1,
            client_ms: 0.0,
        }
        .encode()
        .into(),
    ))
    .await
    .unwrap();
    let mut track = rh_protocol::SnapshotTracker::new();
    loop {
        let next = tokio::time::timeout(Duration::from_secs(3), sock.next())
            .await
            .expect("a frame within 3 s");
        match next {
            Some(Ok(Message::Binary(b))) => {
                if let Ok(rh_protocol::ServerMsg::Pong { nonce: 1, .. }) = track.decode(&b) {
                    break;
                }
            }
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
            other => panic!("the upgraded socket ended after the header timeout: {other:?}"),
        }
    }
    r.handle.shutdown();
}

#[tokio::test]
async fn behind_a_declared_proxy_requests_without_one_forwarded_address_share_a_capped_bucket() {
    let r = rig(
        proxied(EdgeConfig {
            max_per_ip: 2,
            ..EdgeConfig::default()
        }),
        HttpLimits::default(),
    )
    .await;
    // From the loopback proxy peer: no header, an unparsable one, then a repeated one (raw request, two header lines).
    let a = open(r.public, &[]).await.unwrap();
    let b = open(r.public, &[("x-forwarded-for", "not-an-ip")])
        .await
        .unwrap();
    assert_eq!(open(r.public, &[]).await.err(), Some(429));
    let mut raw = tokio::net::TcpStream::connect(r.public).await.unwrap();
    raw.write_all(
        b"GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n\
          Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nX-Forwarded-For: 198.51.100.1\r\nX-Forwarded-For: 198.51.100.2\r\n\r\n",
    )
    .await
    .unwrap();
    let mut head = [0u8; 12];
    raw.read_exact(&mut head).await.unwrap();
    assert_eq!(
        &head, b"HTTP/1.1 429",
        "a repeated header counts as unresolved"
    );
    // A client whose address the proxy did forward is unaffected.
    assert!(open(r.public, &[("x-forwarded-for", "198.51.100.9")])
        .await
        .is_ok());
    drop((a, b));
    r.handle.shutdown();
}

/// A credential store that cannot answer is not a bad credential: the client is told to retry, and the address's failed
/// sign-in budget is untouched (an outage must not lock players out for a minute after it ends).
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_credential_store_outage_is_not_counted_as_failed_sign_ins() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
            eprintln!("SKIPPED: RH_SKIP_PG_TESTS=1");
            return;
        }
        panic!("DATABASE_URL is not set (eval \"$(tools/pgtest/start.sh)\")");
    };
    let store = Arc::new(rh_persist::Store::connect(&url).await.unwrap());
    store.pool().close().await;
    let r = rig_with_auth(
        proxied(EdgeConfig {
            auth_fails_per_minute: 1,
            ..EdgeConfig::default()
        }),
        HttpLimits::default(),
        Auth::Postgres(store),
    )
    .await;
    let from = [("x-forwarded-for", "203.0.113.5")];
    for attempt in 0..4 {
        let mut s = open(r.public, &from).await.unwrap();
        let (code, reason) = hello_reason(&mut s, "alice", "alice-token").await.unwrap();
        assert_eq!(code, RejectCode::RateLimited, "attempt {attempt}");
        assert!(
            reason.contains("storage unavailable"),
            "attempt {attempt}: {reason} (not the failed-sign-in throttle)"
        );
    }
    r.handle.shutdown();
}

mod binary {
    use std::process::{Command, Stdio};

    fn run(args: &[&str]) -> (Option<i32>, String) {
        let out = Command::new(env!("CARGO_BIN_EXE_rh-server"))
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .expect("spawn rh-server");
        (
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).to_string(),
        )
    }

    #[test]
    fn dev_auth_on_a_public_bind_refuses_to_start() {
        for args in [
            vec!["--bind", "0.0.0.0:0"],
            vec!["--bind", "0.0.0.0:0", "--auth", "dev"],
            vec![
                "--bind",
                "127.0.0.1:0",
                "--client-ip-header",
                "x-forwarded-for",
            ],
        ] {
            let (code, err) = run(&args);
            assert_eq!(code, Some(2), "{args:?}: {err}");
            assert!(err.contains("--insecure-dev-auth"), "{err}");
        }
    }

    #[test]
    fn self_signed_on_a_public_bind_refuses_to_start() {
        let (code, err) = run(&[
            "--bind",
            "0.0.0.0:0",
            "--auth",
            "static:/nonexistent",
            "--self-signed",
        ]);
        assert_eq!(code, Some(2), "{err}");
        assert!(err.contains("--insecure-self-signed"), "{err}");
    }

    #[test]
    fn a_misspelt_insecure_or_edge_flag_refuses_to_start() {
        for args in [
            vec!["--bind", "127.0.0.1:0", "--insecure-devauth"],
            vec!["--bind", "127.0.0.1:0", "--ws-max-per-address", "3"],
        ] {
            let (code, err) = run(&args);
            assert_eq!(code, Some(2), "{args:?}: {err}");
            assert!(err.contains("unknown flag"), "{err}");
        }
    }
}
