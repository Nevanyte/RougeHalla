//! Density and telemetry: the room task's deterministic step-before-commands order, bounded telemetry (a room's step-time
//! record is a fixed 384 bytes at any uptime), the density benchmark engine (the same counts on every run, one writer wake
//! per human-tick), and the live process metrics on /control/health.
//!
//! The benchmark engine is the one the `densitybench` binary runs (included by path: a bin cannot be imported).
#![allow(irrefutable_let_patterns)]

#[allow(dead_code)]
#[path = "../src/bin/densitybench/engine.rs"]
mod engine;

use rh_protocol::ServerMsg;
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::metrics::{Histogram, Metrics};
use rh_server::outbox::Outbox;
use rh_server::persist::{Auth, Persistence};
use rh_server::room::{run_room, MapAssets, Room, RoomCmd, RoomConfig};
use rh_sim::{Secrets, SimConfig};
use std::future::Future;
use std::sync::Arc;
use std::task::{Context, Poll, Waker};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

const TICK: Duration = Duration::from_millis(50);

fn room_cfg() -> RoomConfig {
    let assets = MapAssets::new(rh_sim::arenas::practice_arena()).unwrap();
    RoomConfig {
        sim: SimConfig {
            min_players: 2,
            lobby_seconds: 30.0,
            fill_seconds: 0.0,
            pvp_rules: true,
        },
        arena: assets.arena,
        welcome_map: assets.welcome_map,
        fill_bots_to: 0,
        tick: TICK,
        record: false,
        fixed_secrets: Some(Secrets::from_seed(7)),
        fixed_bot_seed: Some(7),
        reconnect_grace: rh_server::room::RECONNECT_GRACE,
        linger: rh_server::room::LINGER,
    }
}

fn leaked_metrics() -> &'static Metrics {
    Box::leak(Box::new(Metrics::new()))
}

fn join(
    profile: &str,
    conn: u64,
) -> (
    RoomCmd,
    oneshot::Receiver<Result<rh_server::room::JoinOk, rh_protocol::RejectCode>>,
) {
    let (reply, rx) = oneshot::channel();
    (
        RoomCmd::Join {
            profile: profile.into(),
            faction: None,
            outbox: Arc::new(Outbox::default()),
            conn,
            fence: 0,
            reply,
        },
        rx,
    )
}

fn welcome_tick(welcome: &[u8]) -> u32 {
    match ServerMsg::decode(welcome).expect("a Welcome") {
        ServerMsg::Welcome { tick, .. } => tick,
        other => panic!("not a Welcome: {other:?}"),
    }
}

/// C-TICK: with a step due and a command queued at the same poll, the step runs first. The room future is polled by hand
/// (so nothing runs it between the command arriving and the timer firing); under the old unbiased select the command won
/// half of these polls and the Welcome would carry tick 0.
#[tokio::test(start_paused = true)]
async fn a_due_step_runs_before_a_queued_command() {
    let mut cx = Context::from_waker(Waker::noop());
    for trial in 0..40u64 {
        let (reports, _keep) = mpsc::unbounded_channel();
        let room = Room::new([trial as u8; 16], room_cfg(), reports, Instant::now())
            .with_metrics(leaked_metrics());
        let (tx, rx) = mpsc::channel(8);
        let mut fut = Box::pin(run_room(room, rx));
        assert!(
            fut.as_mut().poll(&mut cx).is_pending(),
            "armed, nothing due"
        );
        let (cmd, reply) = join("alpha", 1);
        tx.try_send(cmd).unwrap();
        // Time passes with the room not being polled; the park inside advance() fires its timer.
        tokio::time::advance(TICK).await;
        assert!(fut.as_mut().poll(&mut cx).is_pending());
        let ok = reply.await.unwrap().expect("seated");
        assert_eq!(
            welcome_tick(&ok.welcome),
            1,
            "trial {trial}: the step ran before the join was handled"
        );
        drop(tx);
        assert_eq!(
            fut.as_mut().poll(&mut cx),
            Poll::Ready(()),
            "closes with its inbox"
        );
    }
}

/// The pinned sleep follows the grid: one step per slot over a long stretch, no step lost or doubled.
#[tokio::test(start_paused = true)]
async fn the_pinned_sleep_steps_once_per_slot() {
    let (reports, _keep) = mpsc::unbounded_channel();
    let m = leaked_metrics();
    let room = Room::new([1; 16], room_cfg(), reports, Instant::now()).with_metrics(m);
    let (tx, rx) = mpsc::channel(8);
    tokio::spawn(run_room(room, rx));
    let (cmd, reply) = join("alpha", 1);
    tx.send(cmd).await.unwrap();
    reply.await.unwrap().expect("seated");
    tokio::time::sleep(TICK * 200 + TICK / 2).await;
    assert_eq!(m.steps.load(std::sync::atomic::Ordering::Relaxed), 200);
    assert_eq!(m.wakes.load(std::sync::atomic::Ordering::Relaxed), 200);
    assert_eq!(
        m.dropped_steps.load(std::sync::atomic::Ordering::Relaxed),
        0
    );
}

/// Telemetry is bounded: the step-time record is a fixed-size histogram (no Vec to grow), under 1 KB, and a room that has
/// run past the old 72,000-sample cap still counts every step.
#[tokio::test(start_paused = true)]
async fn step_telemetry_is_bounded_and_counts_every_step() {
    assert!(
        std::mem::size_of::<Histogram>() <= 1024,
        "a room's step telemetry is {} bytes",
        std::mem::size_of::<Histogram>()
    );
    let (reports, _keep) = mpsc::unbounded_channel();
    let mut room =
        Room::new([2; 16], room_cfg(), reports, Instant::now()).with_metrics(leaked_metrics());
    let (cmd, _reply) = join("alpha", 1);
    room.handle(cmd, Instant::now());
    let mut now = Instant::now();
    for _ in 0..75_000u64 {
        now += TICK;
        assert!(room.wake(now));
    }
    let s = room.stats();
    assert_eq!(s.ticks, 75_000, "the old record stopped at 72,000 samples");
    assert!(
        s.step_us_p50 <= s.step_us_p99 && s.step_us_p99 <= s.step_us_max,
        "{s:?}"
    );
}

/// The engine is deterministic: the same options give the same counts, every room ends at the end of its inbox, and a
/// writer wakes at most once per human-tick (it drains everything queued in one wake).
#[tokio::test(start_paused = true)]
async fn the_density_engine_is_deterministic() {
    let mut o = engine::Opts::new(rh_sim::arenas::practice_arena());
    o.rooms = 2;
    o.secs = 6;
    let a = engine::run(&o, true).await;
    let b = engine::run(&o, true).await;
    assert_eq!(a.rooms_closed, 2);
    assert_eq!(a.steps, 2 * 6 * 20);
    assert_eq!(a.dropped_steps, 0);
    assert_eq!(
        (a.frames, a.bytes, a.notifies, a.writer_wakes),
        (b.frames, b.bytes, b.notifies, b.writer_wakes)
    );
    assert_eq!((a.steps, a.human_ticks), (b.steps, b.human_ticks));
    assert!(a.frames > 0 && a.bytes > 0);
    assert!(
        a.writer_wakes <= a.human_ticks,
        "{} wakes over {} human-ticks",
        a.writer_wakes,
        a.human_ticks
    );
    // Every push is a notify: a frame per push, at least one snapshot per human-tick.
    assert!(a.notifies >= a.human_ticks);
}

/// The live process metrics are on /control/health.
#[tokio::test]
async fn control_health_serves_live_process_metrics() {
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        DirectorConfig::new(SimConfig::default(), rh_sim::arenas::practice_arena()),
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        lifecycle.clone(),
    );
    lifecycle.ready();
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    let router = rh_server::control_router(director);
    tokio::spawn(async move { axum::serve(l, router).await.unwrap() });
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    s.write_all(b"GET /control/health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut buf = String::new();
    s.read_to_string(&mut buf).await.unwrap();
    assert!(buf.starts_with("HTTP/1.1 200"), "{buf}");
    let body: serde_json::Value =
        serde_json::from_str(buf.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(body["rooms"], 0);
    let m = &body["metrics"];
    for k in ["wakes", "steps", "droppedSteps", "bytesOut", "outboxPushes"] {
        assert!(m[k].is_u64(), "metrics.{k} in {body}");
    }
    for k in ["stepUs", "publishUs", "latenessUs"] {
        assert!(m[k]["p99"].is_u64() && m[k]["max"].is_u64(), "metrics.{k}");
    }
}
