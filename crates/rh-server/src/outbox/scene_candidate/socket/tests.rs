//! Actual-loopback and poll-boundary tests for the private SceneCandidate socket owner.
//! This is adapter DATA acceptance only; it does not exercise the production Room/conn route.
//! The test-only route uses bare `axum::serve`; it does not prove production `serve_with` or TCP_NODELAY behavior.

use super::*;
use axum::{
    extract::{
        ws::{Message as ServerMessage, WebSocket, WebSocketUpgrade},
        State,
    },
    response::Response,
    routing::get,
    Router,
};
use futures_util::{
    stream::FusedStream, task::AtomicWaker, FutureExt, Sink, SinkExt, Stream, StreamExt,
};
use rh_protocol::scene_candidate::{Ack, PreparedScene, Receiver};
use std::{
    panic::{resume_unwind, AssertUnwindSafe},
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::Duration,
};
use tokio::task::JoinHandle;
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{protocol::WebSocketConfig, Message as ClientMessage},
};

/// A fixture-backed scene input, preserving each golden's exact inner records and metadata.
fn source_case(name: &str) -> (Limits, Meta, Vec<Vec<u8>>) {
    let document: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../../protocol/fixtures/scene-candidate/full14.json"
    ))
    .expect("sealed Full14 fixture JSON");
    let l = &document["limits"];
    let limits = Limits {
        body_bytes: l["bodyBytes"].as_u64().unwrap() as usize,
        retained_body_bytes: l["retainedBodyBytes"].as_u64().unwrap() as usize,
        part_bytes: l["partBytes"].as_u64().unwrap() as usize,
        parts: l["parts"].as_u64().unwrap() as usize,
        frames: l["frames"].as_u64().unwrap() as usize,
        frame_bytes: l["frameBytes"].as_u64().unwrap() as usize,
    };
    let case = document["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == name)
        .unwrap_or_else(|| panic!("missing sealed source case {name}"));
    let meta = &case["meta"];
    let read_u64 = |field: &str| meta[field].as_str().unwrap().parse::<u64>().unwrap();
    let inner = case["inner14Hex"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hex| unhex(hex.as_str().unwrap()))
        .collect();
    (
        limits,
        Meta {
            epoch: read_u64("epoch"),
            scene: read_u64("scene"),
            tick: meta["tick"].as_u64().unwrap() as u32,
            source_time: meta["sourceTime"].as_f64().unwrap(),
            cue_from: read_u64("cueFrom"),
            cue_through: read_u64("cueThrough"),
        },
        inner,
    )
}

fn unhex(value: &str) -> Vec<u8> {
    assert_eq!(value.len() % 2, 0, "fixture hex has whole bytes");
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).unwrap())
        .collect()
}

fn source_pair() -> (Limits, Meta, Vec<Vec<u8>>, Meta, Vec<Vec<u8>>) {
    let (limits, first_meta, frames) = source_case("native-prepared-small");
    let second_meta = Meta {
        epoch: first_meta.epoch,
        scene: first_meta.scene + 1,
        tick: first_meta.tick,
        source_time: first_meta.source_time,
        cue_from: first_meta.cue_through,
        cue_through: first_meta.cue_through,
    };
    (limits, first_meta, frames.clone(), second_meta, frames)
}

/// A bounded exact-byte tail made only from an existing protocol vector: the synthetic spectator Full plus
/// two copies of the immutable two-occurrence `server.fx` frame. The four event occurrences stay in the body order.
fn source_nonzero_tail() -> (Limits, Meta, Vec<Vec<u8>>) {
    let (limits, mut meta, mut frames) = source_case("synthetic-spectator-clock");
    assert_eq!(frames.len(), 2, "the spectator sample has no event/Fx tail");
    let gold: serde_json::Value =
        serde_json::from_str(include_str!("../../../../../../protocol/fixtures/v14.json")).unwrap();
    let fx = gold["server"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == "fx")
        .unwrap_or_else(|| panic!("missing immutable server.fx sample"));
    let fx_bytes = unhex(fx["hex"].as_str().unwrap());
    assert!(matches!(
        rh_protocol::ServerMsg::decode(&fx_bytes),
        Ok(rh_protocol::ServerMsg::Fx { fx, .. }) if fx.len() == 2
    ));
    frames.push(fx_bytes.clone());
    frames.push(fx_bytes);
    meta.cue_through = meta.cue_from + 4;
    PreparedScene::prepare(meta, &frames, limits)
        .expect("declared codec-tail combination is valid");
    (limits, meta, frames)
}

fn scene_records(meta: Meta, frames: &[Vec<u8>], limits: Limits) -> Vec<Vec<u8>> {
    let scene =
        PreparedScene::prepare(meta, frames, limits).expect("fixture is a valid Full scene");
    (0..scene.record_count())
        .map(|index| scene.record(index).expect("record index"))
        .collect()
}

fn ack_from_records(records: &[Vec<u8>]) -> Ack {
    let commit = records.last().expect("COMMIT record");
    assert_eq!(commit.get(9), Some(&3), "last record must be COMMIT");
    Ack {
        epoch: u64::from_le_bytes(commit[10..18].try_into().unwrap()),
        scene: u64::from_le_bytes(commit[18..26].try_into().unwrap()),
        cue_through: u64::from_le_bytes(commit[32..40].try_into().unwrap()),
    }
}

fn socket_limits() -> SocketLimits {
    SocketLimits {
        read_buffer_bytes: 4096,
        inbound_message_bytes: 256,
        inbound_frame_bytes: 256,
        write_buffer_bytes: 32768,
        max_write_buffer_bytes: 65536,
        scene_timeout: Duration::from_secs(2),
        ack_timeout: Duration::from_secs(2),
        idle_timeout: Duration::from_secs(10),
        read_quota: 32,
        write_quota: 32,
    }
}

fn queue_limits() -> QueueLimits {
    QueueLimits {
        outstanding_bytes: 65536,
        scenes: 4,
        pending_bytes: 131072,
        pending_scenes: 4,
        scratch_bytes: 32768,
    }
}

struct EndpointSlot<F> {
    endpoint: Mutex<Option<Endpoint>>,
    wrap: Mutex<Option<F>>,
}

async fn take_endpoint<F, S>(
    State(slot): State<Arc<EndpointSlot<F>>>,
    upgrade: WebSocketUpgrade,
) -> Response
where
    S: SocketIo,
    F: FnOnce(WebSocket) -> S + Send + 'static,
{
    let endpoint = slot
        .endpoint
        .lock()
        .unwrap()
        .take()
        .expect("single test upgrade");
    let wrap = slot
        .wrap
        .lock()
        .unwrap()
        .take()
        .expect("single test wrapper");
    endpoint.upgrade_with(upgrade, wrap)
}

struct TestPeer {
    client: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    server: Option<JoinHandle<()>>,
    shared: Arc<Shared>,
}

async fn open_test_peer_with<F, S>(endpoint: Endpoint, wrap: F) -> TestPeer
where
    S: SocketIo,
    F: FnOnce(WebSocket) -> S + Send + 'static,
{
    let shared = endpoint
        .shared
        .as_ref()
        .expect("owned endpoint context")
        .clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let slot = Arc::new(EndpointSlot {
        endpoint: Mutex::new(Some(endpoint)),
        wrap: Mutex::new(Some(wrap)),
    });
    let app = Router::new()
        .route("/scene", get(take_endpoint::<F, S>))
        .with_state(slot);
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let url = format!("ws://{address}/scene");
    let config = WebSocketConfig {
        max_message_size: Some(256),
        max_frame_size: Some(256),
        ..Default::default()
    };
    let connected = tokio::time::timeout(
        Duration::from_secs(2),
        connect_async_with_config(url, Some(config), false),
    )
    .await;
    let (client, _) = match connected {
        Ok(Ok(connection)) => connection,
        Ok(Err(error)) => {
            shared.close();
            server.abort();
            let _ = server.await;
            wait_trace(&shared, |events| {
                events
                    .iter()
                    .any(|e| matches!(e, Trace::DriverFinished | Trace::UpgradeDropped))
            })
            .await;
            panic!("loopback WebSocket handshake failed: {error}");
        }
        Err(_) => {
            shared.close();
            server.abort();
            let _ = server.await;
            wait_trace(&shared, |events| {
                events
                    .iter()
                    .any(|e| matches!(e, Trace::DriverFinished | Trace::UpgradeDropped))
            })
            .await;
            panic!("loopback WebSocket handshake deadline");
        }
    };
    TestPeer {
        client,
        server: Some(server),
        shared,
    }
}

async fn open_test_peer(endpoint: Endpoint) -> TestPeer {
    open_test_peer_with(endpoint, |socket| socket).await
}

impl TestPeer {
    async fn recv_binary(&mut self) -> Vec<u8> {
        loop {
            let message = tokio::time::timeout(Duration::from_secs(3), self.client.next())
                .await
                .expect("bounded receive")
                .expect("socket remains open")
                .expect("valid WebSocket message");
            match message {
                ClientMessage::Binary(bytes) => return bytes.to_vec(),
                ClientMessage::Ping(payload) => {
                    self.client
                        .send(ClientMessage::Pong(payload))
                        .await
                        .expect("reply to control ping");
                }
                ClientMessage::Pong(_) => {}
                ClientMessage::Close(frame) => {
                    panic!("unexpected close before test cleanup: {frame:?}")
                }
                ClientMessage::Text(text) => panic!("unexpected text frame: {text}"),
                ClientMessage::Frame(_) => {}
            }
        }
    }

    async fn send_ack(&mut self, ack: Ack) {
        self.client
            .send(ClientMessage::Binary(
                rh_protocol::scene_candidate::encode_ack(ack).into(),
            ))
            .await
            .expect("send actual ACK frame");
    }

    async fn shutdown(&mut self) {
        self.shared.close();
        let _ = tokio::time::timeout(Duration::from_millis(250), self.client.close(None)).await;
        let finished = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let notified = self.shared.observed.notified();
                tokio::pin!(notified);
                let _ = notified.as_mut().enable();
                if trace(&self.shared)
                    .iter()
                    .any(|e| matches!(e, Trace::DriverFinished))
                {
                    break;
                }
                notified.await;
            }
        })
        .await;
        if let Some(server) = self.server.take() {
            server.abort();
            let _ = server.await;
        }
        assert!(finished.is_ok(), "socket driver completion deadline");
    }
}

macro_rules! with_peer_cleanup {
    ($peer:ident, $body:block) => {{
        let result = AssertUnwindSafe(async $body).catch_unwind().await;
        $peer.shutdown().await;
        if let Err(payload) = result {
            resume_unwind(payload);
        }
    }};
}

impl Drop for TestPeer {
    fn drop(&mut self) {
        self.shared.close();
        if let Some(server) = self.server.take() {
            server.abort();
        }
    }
}

#[derive(Default)]
struct FlushGateState {
    next_record: usize,
    cached_success: bool,
    released: bool,
}

struct FlushGate {
    target_record: usize,
    state: Mutex<FlushGateState>,
    captured: tokio::sync::Notify,
    waker: AtomicWaker,
}

impl FlushGate {
    fn new(target_record: usize) -> Arc<Self> {
        Arc::new(Self {
            target_record,
            state: Mutex::new(FlushGateState::default()),
            captured: tokio::sync::Notify::new(),
            waker: AtomicWaker::new(),
        })
    }

    async fn wait_captured(&self) {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let notified = self.captured.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();
                if self.state.lock().unwrap().cached_success {
                    return;
                }
                notified.await;
            }
        })
        .await
        .expect("inner socket flush reached the gate");
    }

    fn release(&self) {
        self.state.lock().unwrap().released = true;
        self.waker.wake();
    }
}

/// Test wrapper around the actual Axum WebSocket. For one chosen record it caches a real
/// successful inner `poll_flush`, keeps polling the same socket Stream, and later returns
/// that cached result once. It never manufactures readiness or polls the flush twice.
struct FlushGatedSocket {
    inner: WebSocket,
    gate: Arc<FlushGate>,
    target_this_record: bool,
}

impl Stream for FlushGatedSocket {
    type Item = std::result::Result<ServerMessage, axum::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Pin::new(&mut self.inner).poll_next(cx)
    }
}

impl FusedStream for FlushGatedSocket {
    fn is_terminated(&self) -> bool {
        self.inner.is_terminated()
    }
}

impl Sink<ServerMessage> for FlushGatedSocket {
    type Error = axum::Error;

    fn poll_ready(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::result::Result<(), Self::Error>> {
        Pin::new(&mut self.inner).poll_ready(cx)
    }

    fn start_send(
        mut self: Pin<&mut Self>,
        item: ServerMessage,
    ) -> std::result::Result<(), Self::Error> {
        let index = {
            let mut state = self.gate.state.lock().unwrap();
            let index = state.next_record;
            state.next_record += 1;
            index
        };
        self.target_this_record = index == self.gate.target_record;
        Pin::new(&mut self.inner).start_send(item)
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::result::Result<(), Self::Error>> {
        if !self.target_this_record {
            return Pin::new(&mut self.inner).poll_flush(cx);
        }
        {
            let mut state = self.gate.state.lock().unwrap();
            if state.cached_success {
                if state.released {
                    state.cached_success = false;
                    state.released = false;
                    drop(state);
                    self.target_this_record = false;
                    return Poll::Ready(Ok(()));
                }
                self.gate.waker.register(cx.waker());
                let released = state.released;
                drop(state);
                if released {
                    cx.waker().wake_by_ref();
                }
                return Poll::Pending;
            }
        }
        match Pin::new(&mut self.inner).poll_flush(cx) {
            Poll::Ready(Ok(())) => {
                // Register before publishing capture. If release races the observer's
                // wake-up, either this waker is notified or the state recheck self-wakes.
                self.gate.waker.register(cx.waker());
                let released = {
                    let mut state = self.gate.state.lock().unwrap();
                    state.cached_success = true;
                    state.released
                };
                self.gate.captured.notify_waiters();
                if released {
                    cx.waker().wake_by_ref();
                }
                Poll::Pending
            }
            other => other,
        }
    }

    fn poll_close(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::result::Result<(), Self::Error>> {
        Pin::new(&mut self.inner).poll_close(cx)
    }
}

fn test_channel(meta: Meta, qlimits: QueueLimits) -> (Ingress, Endpoint) {
    let (limits, _, _) = source_case("native-prepared-small");
    let (ingress, endpoint) = channel(41, meta.epoch, limits, qlimits, socket_limits()).unwrap();
    (ingress, endpoint)
}

fn admit(ingress: &Ingress, meta: Meta, frames: Vec<Vec<u8>>, sample: u64) -> PendingScene {
    let mut pending = ingress
        .prepare(
            meta,
            frames,
            Publication {
                alias_cursor: sample,
                sample_cursor: sample,
            },
        )
        .unwrap();
    pending.try_admit().unwrap();
    pending
}

fn trace(shared: &Shared) -> Vec<Trace> {
    shared.trace.lock().unwrap().clone()
}

async fn wait_trace(shared: &Shared, predicate: impl Fn(&[Trace]) -> bool) -> Vec<Trace> {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let notified = shared.observed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let events = trace(shared);
            if predicate(&events) {
                return events;
            }
            notified.await;
        }
    })
    .await
    .expect("bounded wait for socket trace")
}

fn record_index(events: &[Trace], target: impl Fn(&Trace) -> bool) -> usize {
    events
        .iter()
        .position(target)
        .expect("required trace event")
}

#[tokio::test]
async fn real_loopback_full_records_apply_atomically_then_ack() {
    let (limits, meta, frames) = source_case("native-prepared-small");
    let (ingress, endpoint) = test_channel(meta, queue_limits());
    let shared = ingress.shared.clone();
    let application = Arc::new(Mutex::new(None::<Arc<rh_protocol::scene_candidate::View>>));
    let mut receiver = Receiver::new(meta.epoch, limits).unwrap();
    let expected = scene_records(meta, &frames, limits);
    let _pending = admit(&ingress, meta, frames, 1);
    let mut peer = open_test_peer(endpoint).await;

    with_peer_cleanup!(peer, {
        for (index, expected_record) in expected.iter().enumerate() {
            let actual = peer.recv_binary().await;
            assert_eq!(
                &actual, expected_record,
                "record {index} remains byte-identical"
            );
            let committed = receiver.push(&actual).unwrap();
            assert_eq!(committed, index + 1 == expected.len());
            if committed {
                let accepted = receiver.current().unwrap().clone();
                *application.lock().unwrap() = Some(accepted);
            } else {
                assert!(application.lock().unwrap().is_none());
                assert!(receiver.current().is_none());
            }
        }
        let accepted = application.lock().unwrap().as_ref().unwrap().clone();
        assert_eq!(accepted.meta(), meta);
        assert_eq!(accepted.body().len(), receiver.owned_body_bytes());
        peer.send_ack(ack_from_records(&expected)).await;

        let events = wait_trace(&shared, |events| {
        events.iter().any(|event| matches!(event, Trace::Completed { scene, record } if *scene == meta.scene && *record + 1 == expected.len()))
            && shared.queue.meter().acked == meta.scene
    })
    .await;
        let completed = record_index(
            &events,
            |event| matches!(event, Trace::Completed { scene, record } if *scene == meta.scene && *record + 1 == expected.len()),
        );
        assert_eq!(shared.queue.meter().written, meta.scene);
        assert_eq!(shared.queue.meter().acked, meta.scene);
        assert!(events[..=completed].iter().any(|e| matches!(e, Trace::Flushed { scene, record } if *scene == meta.scene && *record + 1 == expected.len())));
        assert!(
            Arc::strong_count(&accepted) >= 2,
            "receiver and application retain the accepted view"
        );

        ingress.close();
    });
}

#[tokio::test]
async fn real_loopback_replacement_keeps_old_application_until_commit_apply() {
    let (limits, first_meta, first_frames, second_meta, second_frames) = source_pair();
    let (ingress, endpoint) = test_channel(first_meta, queue_limits());
    let shared = ingress.shared.clone();
    let mut receiver = Receiver::new(first_meta.epoch, limits).unwrap();
    let application = Arc::new(Mutex::new(None::<Arc<rh_protocol::scene_candidate::View>>));
    let first_records = scene_records(first_meta, &first_frames, limits);
    let _first = admit(&ingress, first_meta, first_frames, 1);
    let mut peer = open_test_peer(endpoint).await;

    with_peer_cleanup!(peer, {
        for record in &first_records {
            let actual = peer.recv_binary().await;
            assert_eq!(&actual, record);
            if receiver.push(&actual).unwrap() {
                *application.lock().unwrap() = Some(receiver.current().unwrap().clone());
            }
        }
        peer.send_ack(ack_from_records(&first_records)).await;
        wait_trace(&shared, |events| {
        events.iter().any(|e| matches!(e, Trace::Completed { scene, record } if *scene == first_meta.scene && *record + 1 == first_records.len()))
            && shared.queue.meter().acked == first_meta.scene
    })
    .await;
        let old = application.lock().unwrap().as_ref().unwrap().clone();
        let old_body = old.body().to_vec();

        let second_records = scene_records(second_meta, &second_frames, limits);
        let _second = admit(&ingress, second_meta, second_frames, 2);
        for (index, expected) in second_records.iter().enumerate() {
            let actual = peer.recv_binary().await;
            assert_eq!(&actual, expected);
            let committed = receiver.push(&actual).unwrap();
            if index + 1 == second_records.len() {
                assert!(committed);
                assert_eq!(receiver.current().unwrap().meta(), second_meta);
                assert!(Arc::ptr_eq(
                    application.lock().unwrap().as_ref().unwrap(),
                    &old
                ));
                *application.lock().unwrap() = Some(receiver.current().unwrap().clone());
            } else {
                assert!(!committed);
                assert!(Arc::ptr_eq(receiver.current().unwrap(), &old));
                assert!(Arc::ptr_eq(
                    application.lock().unwrap().as_ref().unwrap(),
                    &old
                ));
            }
        }
        assert_eq!(
            old.body(),
            old_body.as_slice(),
            "accepted prior bytes remain immutable"
        );
        peer.send_ack(ack_from_records(&second_records)).await;
        wait_trace(&shared, |events| {
        events.iter().any(|e| matches!(e, Trace::Completed { scene, record } if *scene == second_meta.scene && *record + 1 == second_records.len()))
            && shared.queue.meter().acked == second_meta.scene
    })
    .await;

        ingress.close();
    });
}

#[tokio::test]
async fn actual_flush_ack_race_defers_exact_ack_until_flush_observation() {
    let (limits, meta, frames) = source_nonzero_tail();
    let (ingress, endpoint) = test_channel(meta, queue_limits());
    let shared = ingress.shared.clone();
    let expected = scene_records(meta, &frames, limits);
    let final_index = expected.len() - 1;
    let gate = FlushGate::new(final_index);
    let _pending = admit(&ingress, meta, frames, 1);
    let mut peer = open_test_peer_with(endpoint, {
        let gate = gate.clone();
        move |socket| FlushGatedSocket {
            inner: socket,
            gate,
            target_this_record: false,
        }
    })
    .await;
    let mut receiver = Receiver::new(meta.epoch, limits).unwrap();
    with_peer_cleanup!(peer, {
        for (index, expected_record) in expected.iter().enumerate() {
            let actual = peer.recv_binary().await;
            assert_eq!(&actual, expected_record);
            assert_eq!(receiver.push(&actual).unwrap(), index + 1 == expected.len());
        }
        gate.wait_captured().await;
        peer.send_ack(ack_from_records(&expected)).await;
        wait_trace(&shared, |events| {
            events
                .iter()
                .any(|e| matches!(e, Trace::Ack { scene, deferred: true } if *scene == meta.scene))
        })
        .await;
        assert_eq!(
            shared.queue.meter().written,
            0,
            "ACK race cannot mint flush completion"
        );
        assert_eq!(
            shared.queue.meter().acked,
            0,
            "deferred ACK cannot return credit early"
        );
        assert!(shared.queue.meter().pending_ack);
        assert!(
            gate.state.lock().unwrap().cached_success,
            "the gate holds only after an actual inner flush success"
        );

        gate.release();
        let events = wait_trace(&shared, |events| {
        events.iter().any(|e| matches!(e, Trace::Completed { scene, record } if *scene == meta.scene && *record == final_index))
            && shared.queue.meter().acked == meta.scene
    })
    .await;
        let complete = record_index(
            &events,
            |e| matches!(e, Trace::Completed { scene, record } if *scene == meta.scene && *record == final_index),
        );
        assert_eq!(shared.queue.meter().written, meta.scene);
        assert_eq!(shared.queue.meter().acked, meta.scene);
        assert!(events[..=complete]
            .iter()
            .any(|e| matches!(e, Trace::Ack { scene, deferred: true } if *scene == meta.scene)));

        ingress.close();
    });
}

#[tokio::test]
async fn close_or_generation_change_before_borrowed_complete_keeps_credit_until_drop() {
    for generation_fault in [false, true] {
        let (limits, meta, frames) = source_case("native-prepared-small");
        let (ingress, endpoint) = test_channel(meta, queue_limits());
        let shared = ingress.shared.clone();
        let expected = scene_records(meta, &frames, limits);
        let final_index = expected.len() - 1;
        let gate = FlushGate::new(final_index);
        let before_fault = Arc::new(Mutex::new(None::<Meter>));
        let _pending = admit(&ingress, meta, frames, 1);
        let mut peer = open_test_peer_with(endpoint, {
            let gate = gate.clone();
            move |socket| FlushGatedSocket {
                inner: socket,
                gate,
                target_this_record: false,
            }
        })
        .await;
        let mut receiver = Receiver::new(meta.epoch, limits).unwrap();
        with_peer_cleanup!(peer, {
            for (index, expected_record) in expected.iter().enumerate() {
                let actual = peer.recv_binary().await;
                assert_eq!(&actual, expected_record);
                assert_eq!(receiver.push(&actual).unwrap(), index + 1 == expected.len());
            }
            assert_eq!(receiver.current().unwrap().meta(), meta);
            gate.wait_captured().await;
            *shared.before_complete.lock().unwrap() = Some({
                let before_fault = before_fault.clone();
                Box::new(move |shared| {
                    *before_fault.lock().unwrap() = Some(shared.queue.meter());
                    if generation_fault {
                        // Declared test-only stale callback: mutate the captured Queue's private
                        // generation after flush/read success, with no replacement context.
                        let mut state = shared.queue.0.lock().unwrap();
                        state.generation += 1;
                    } else {
                        shared.close();
                    }
                })
            });
            gate.release();
            let events = wait_trace(&shared, |events| {
                events.iter().any(|e| matches!(e, Trace::Terminal(_)))
                    && events.iter().any(|e| matches!(e, Trace::SocketDropped))
                    && events.iter().any(|e| matches!(e, Trace::RecordReleased))
                    && events.iter().any(|e| matches!(e, Trace::WriterReleased))
            })
            .await;
            let snapshot = before_fault
                .lock()
                .unwrap()
                .expect("hook ran immediately before borrowed complete");
            assert_eq!(snapshot.written, 0);
            assert!(snapshot.outstanding_bytes > 0);
            assert_eq!(
                shared.queue.meter().written,
                0,
                "closed candidate never advances written"
            );
            assert_eq!(shared.queue.meter().acked, 0);
            assert!(shared.queue.meter().closed);
            assert_eq!(
                shared.queue.0.lock().unwrap().generation,
                if generation_fault { 42 } else { 41 },
                "generation case is a test-only stale captured-context fault"
            );
            let terminal = record_index(&events, |e| matches!(e, Trace::Terminal(_)));
            let socket_drop = record_index(&events, |e| matches!(e, Trace::SocketDropped));
            let record_drop = record_index(&events, |e| matches!(e, Trace::RecordReleased));
            let writer_drop = record_index(&events, |e| matches!(e, Trace::WriterReleased));
            assert!(
                terminal < socket_drop && socket_drop < record_drop && record_drop < writer_drop
            );
            assert!(!events.iter().any(|e| matches!(e, Trace::Completed { scene, record } if *scene == meta.scene && *record == final_index)));
        });
    }
}

#[tokio::test]
async fn capacity_refusal_retries_the_same_pending_scene_after_ack_and_writer_release() {
    let (limits, first_meta, first_frames, second_meta, second_frames) = source_pair();
    let first_scene = PreparedScene::prepare(first_meta, &first_frames, limits).unwrap();
    let first_charge = first_scene.framed_bytes();
    let queue_limits = QueueLimits {
        outstanding_bytes: first_charge,
        scenes: 1,
        pending_bytes: 262_144,
        pending_scenes: 3,
        scratch_bytes: 32_768,
    };
    let (ingress, endpoint) = test_channel(first_meta, queue_limits);
    let shared = ingress.shared.clone();
    let first_records = scene_records(first_meta, &first_frames, limits);
    let second_records = scene_records(second_meta, &second_frames, limits);
    let mut first = ingress
        .prepare(
            first_meta,
            first_frames,
            Publication {
                alias_cursor: 1,
                sample_cursor: 1,
            },
        )
        .unwrap();
    let mut second = ingress
        .prepare(
            second_meta,
            second_frames,
            Publication {
                alias_cursor: 2,
                sample_cursor: 2,
            },
        )
        .unwrap();
    let pending_meta = second.meta().unwrap();
    first.try_admit().unwrap();
    let before_refusal = second.meter();
    assert_eq!(second.try_admit(), Err(SocketError::Full));
    assert_eq!(second.meta().unwrap(), pending_meta);
    assert_eq!(
        second.meter(),
        before_refusal,
        "refusal retains the same pending reservation"
    );
    let mut peer = open_test_peer(endpoint).await;
    with_peer_cleanup!(peer, {
        let mut receiver = Receiver::new(first_meta.epoch, limits).unwrap();
        for (index, expected) in first_records.iter().enumerate() {
            let actual = peer.recv_binary().await;
            assert_eq!(&actual, expected);
            assert_eq!(
                receiver.push(&actual).unwrap(),
                index + 1 == first_records.len()
            );
        }
        peer.send_ack(ack_from_records(&first_records)).await;
        wait_trace(&shared, |events| {
            events.iter().any(|e| matches!(e, Trace::WriterReleased))
                && shared.queue.meter().acked == first_meta.scene
        })
        .await;
        let before_retry = second.meter();
        second.try_admit().unwrap();
        assert_eq!(second.meta(), Err(SocketError::Model("already admitted")));
        assert_eq!(before_retry.published, first_meta.scene);
        assert_eq!(shared.queue.meter().published, second_meta.scene);
        for (index, expected) in second_records.iter().enumerate() {
            let actual = peer.recv_binary().await;
            assert_eq!(
                &actual, expected,
                "retry keeps the exact pre-refusal bytes at {index}"
            );
            assert_eq!(
                receiver.push(&actual).unwrap(),
                index + 1 == second_records.len()
            );
        }
        peer.send_ack(ack_from_records(&second_records)).await;
        wait_trace(&shared, |events| {
            events
                .iter()
                .filter(|e| matches!(e, Trace::WriterReleased))
                .count()
                >= 2
                && shared.queue.meter().acked == second_meta.scene
        })
        .await;
        ingress.close();
    });
}

#[tokio::test]
async fn actual_socket_duplicate_ack_is_idempotent_then_stale_tuple_closes_epoch() {
    let (limits, meta, frames) = source_case("native-prepared-small");
    let (ingress, endpoint) = test_channel(meta, queue_limits());
    let shared = ingress.shared.clone();
    let expected = scene_records(meta, &frames, limits);
    let _pending = admit(&ingress, meta, frames, 1);
    let mut peer = open_test_peer(endpoint).await;
    with_peer_cleanup!(peer, {
        for expected_record in &expected {
            assert_eq!(&peer.recv_binary().await, expected_record);
        }
        wait_trace(&shared, |events| {
            events.iter().any(|e| matches!(e, Trace::Completed { scene, record } if *scene == meta.scene && *record + 1 == expected.len()))
        })
        .await;
        let ack = ack_from_records(&expected);
        peer.send_ack(ack).await;
        wait_trace(&shared, |_| shared.queue.meter().acked == meta.scene).await;
        let meter_after_first = shared.queue.meter();
        peer.send_ack(ack).await;
        let events = wait_trace(&shared, |events| {
            events
                .iter()
                .filter(
                    |e| matches!(e, Trace::Ack { scene, deferred: false } if *scene == meta.scene),
                )
                .count()
                >= 2
        })
        .await;
        assert_eq!(shared.queue.meter().acked, meter_after_first.acked);
        assert!(
            !shared.queue.meter().closed,
            "an exact duplicate is idempotent"
        );
        assert!(
            events
                .iter()
                .filter(
                    |e| matches!(e, Trace::Ack { scene, deferred: false } if *scene == meta.scene)
                )
                .count()
                >= 2
        );

        peer.send_ack(Ack { scene: 0, ..ack }).await;
        wait_trace(&shared, |events| {
            events.iter().any(|e| matches!(e, Trace::DriverFinished))
        })
        .await;
        assert!(shared.queue.meter().closed);
        assert_eq!(
            shared.queue.meter().acked,
            meta.scene,
            "stale ACK cannot alter accepted progress"
        );
    });
}

#[tokio::test]
async fn actual_socket_rejects_wrong_epoch_future_and_wrong_cue_acks() {
    let (limits, meta, frames) = source_nonzero_tail();
    let expected = scene_records(meta, &frames, limits);
    let exact = ack_from_records(&expected);
    let invalid = [
        Ack {
            epoch: exact.epoch + 1,
            ..exact
        },
        Ack {
            scene: exact.scene + 1,
            ..exact
        },
        Ack {
            cue_through: exact.cue_through - 1,
            ..exact
        },
    ];
    for ack in invalid {
        let (ingress, endpoint) = test_channel(meta, queue_limits());
        let shared = ingress.shared.clone();
        let _pending = admit(&ingress, meta, frames.clone(), 1);
        let mut peer = open_test_peer(endpoint).await;
        with_peer_cleanup!(peer, {
            for expected_record in &expected {
                assert_eq!(&peer.recv_binary().await, expected_record);
            }
            wait_trace(&shared, |events| {
                events.iter().any(|e| matches!(e, Trace::Completed { scene, record } if *scene == meta.scene && *record + 1 == expected.len()))
            })
            .await;
            peer.send_ack(ack).await;
            wait_trace(&shared, |events| {
                events.iter().any(|e| matches!(e, Trace::DriverFinished))
            })
            .await;
            assert!(shared.queue.meter().closed);
            assert_eq!(shared.queue.meter().acked, 0);
            assert!(!shared.queue.meter().pending_ack);
            assert!(!trace(&shared)
                .iter()
                .any(|e| matches!(e, Trace::Ack { .. })));
        });
    }
}

#[tokio::test]
async fn close_at_each_record_flush_fence_drops_socket_before_credit() {
    let (limits, meta, frames) = source_case("native-prepared-small");
    let expected = scene_records(meta, &frames, limits);
    for target_record in 0..expected.len() {
        let mut io = socket_limits();
        io.read_quota = 1;
        let (ingress, endpoint) = channel(41, meta.epoch, limits, queue_limits(), io).unwrap();
        let shared = ingress.shared.clone();
        let gate = FlushGate::new(target_record);
        let _pending = admit(&ingress, meta, frames.clone(), 1);
        let mut peer = open_test_peer_with(endpoint, {
            let gate = gate.clone();
            move |socket| FlushGatedSocket {
                inner: socket,
                gate,
                target_this_record: false,
            }
        })
        .await;
        with_peer_cleanup!(peer, {
            let mut receiver = Receiver::new(meta.epoch, limits).unwrap();
            for index in 0..=target_record {
                let actual = peer.recv_binary().await;
                assert_eq!(&actual, &expected[index]);
                let completed = receiver.push(&actual).unwrap();
                assert_eq!(completed, index + 1 == expected.len());
            }
            gate.wait_captured().await;
            let held = shared.queue.meter();
            assert!(!held.closed);
            assert_eq!(held.written, 0);
            assert!(held.outstanding_bytes > 0 && held.scratch_bytes > 0);
            peer.client.send(ClientMessage::Close(None)).await.unwrap();
            let events = wait_trace(&shared, |events| {
                events.iter().any(|e| matches!(e, Trace::SocketDropped))
                    && events.iter().any(|e| matches!(e, Trace::RecordReleased))
                    && events.iter().any(|e| matches!(e, Trace::WriterReleased))
            })
            .await;
            assert!(shared.queue.meter().closed);
            assert_eq!(
                shared.queue.meter().written,
                0,
                "a held COMMIT flush is never reported written"
            );
            let dropped = record_index(&events, |e| matches!(e, Trace::SocketDropped));
            let record_released = record_index(&events, |e| matches!(e, Trace::RecordReleased));
            let writer_released = record_index(&events, |e| matches!(e, Trace::WriterReleased));
            assert!(dropped < record_released && record_released < writer_released);
            assert!(events.iter().any(|e| matches!(e, Trace::Started { scene, record } if *scene == meta.scene && *record == target_record)));
            assert!(!events.iter().any(|e| matches!(e, Trace::Completed { scene, record } if *scene == meta.scene && *record == target_record)));
            ingress.close();
        });
    }
}

#[tokio::test]
async fn oversized_inbound_message_is_rejected_at_websocket_limit() {
    let (_, meta, _) = source_case("native-prepared-small");
    let (ingress, endpoint) = test_channel(meta, queue_limits());
    let shared = ingress.shared.clone();
    let mut peer = open_test_peer(endpoint).await;
    peer.client
        .send(ClientMessage::Binary(vec![0u8; 257].into()))
        .await
        .expect("client can transmit the declared oversize probe");
    with_peer_cleanup!(peer, {
        let events = wait_trace(&shared, |events| {
            events
                .iter()
                .any(|event| matches!(event, Trace::DriverFinished))
        })
        .await;
        assert!(shared.queue.meter().closed);
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, Trace::Ack { .. })),
            "oversized message never reaches ACK decoding"
        );
    });
}

struct NeverPolledSocket;
impl Stream for NeverPolledSocket {
    type Item = std::result::Result<ServerMessage, axum::Error>;
    fn poll_next(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Poll::Pending
    }
}
impl FusedStream for NeverPolledSocket {
    fn is_terminated(&self) -> bool {
        false
    }
}
impl Sink<ServerMessage> for NeverPolledSocket {
    type Error = axum::Error;
    fn poll_ready(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<std::result::Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }
    fn start_send(
        self: Pin<&mut Self>,
        _item: ServerMessage,
    ) -> std::result::Result<(), Self::Error> {
        Ok(())
    }
    fn poll_flush(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<std::result::Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }
    fn poll_close(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<std::result::Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }
}

#[tokio::test]
async fn dropping_unpolled_driver_closes_its_queue_owner() {
    let (_, meta, frames) = source_case("native-prepared-small");
    let (ingress, endpoint) = test_channel(meta, queue_limits());
    let shared = ingress.shared.clone();
    let _pending = admit(&ingress, meta, frames, 1);
    let driver = endpoint.driver(NeverPolledSocket);
    drop(driver);
    assert!(shared.queue.meter().closed);
    assert_eq!(shared.queue.meter().written, 0);
    assert_eq!(shared.queue.meter().acked, 0);
    let events = trace(&shared);
    assert_eq!(events.first(), Some(&Trace::SocketDropped));
}

mod ownership;
mod poll_faults;
