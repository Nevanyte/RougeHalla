//! One client connection: WebSocket binary frames, one protocol message per frame. Admission happens on the first frame
//! (Hello, within HELLO_TIMEOUT); after that, inputs are forwarded to the room in arrival order. Guards (docs/CONTRACTS.md
//! C-NET-4): frame size capped by the WebSocket layer before any decoding, a per-connection frame-rate bucket, strict
//! decoding (a malformed frame closes the connection with `Malformed`), and a bounded room inbox (a client that cannot be
//! served in time is closed with `TooSlow`, never allowed to stall the match).

use crate::director::{Director, Hello};
use crate::outbox::Outbox;
use crate::room::RoomCmd;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, RejectCode, ServerMsg, PROTOCOL_VERSION};
use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
/// Liveness: a client that sends nothing (clients ping at least every second) for this long is treated as dropped; its
/// seat is held for the reconnect grace (legacy: a 4.5 s beat timeout). Catches half-open sockets.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(10);
/// A socket write that cannot complete in this long ends the connection (a client that stopped reading).
pub const SEND_TIMEOUT: Duration = Duration::from_secs(5);
/// After the server closes a connection it keeps reading (and discarding) for up to this long, until the peer's close
/// or EOF. Dropping a socket with unread input makes the kernel reset it, and a reset can destroy the Reject frame
/// before the client reads it (seen under load with a flooding client).
pub const CLOSE_LINGER: Duration = Duration::from_secs(1);
/// Frames per second a client may send (aim 40/s + orders + pings fit well under it), with a burst. Every inbound frame
/// counts, WebSocket control frames (Ping, Pong) included, except a Pong that answers a currently in-flight server RTT
/// Ping: that Pong is the compulsory answer to a server control frame and is exempt (see `admit_pong`). A client cannot
/// keep its socket readable forever for free.
pub const FRAMES_PER_SECOND: f64 = 60.0;
pub const FRAME_BURST: f64 = 120.0;
/// Fairness of the reader's biased select: after this many frames in a row, the next wait looks at the writer first (once,
/// without waiting). Bounds how long a client whose frames are always readable can hide a finished writer, independently
/// of the frame bucket.
pub const FAIR_STREAK: u32 = 32;
/// How often the connection pings the client for a server-measured RTT (P-NET-1 Phase 3). The client's WebSocket stack
/// answers a control Ping with a Pong on its own; a RTT sample is cheap and this rate is far below the frame budget.
pub const RTT_PING_PERIOD: Duration = Duration::from_millis(500);
/// How many of the most recent ping payloads a Pong may answer. More than one period of RTT tolerates a slow link without
/// letting an old payload be replayed forever.
const RTT_PINGS_IN_FLIGHT: usize = 8;

/// Connection ids, unique per process: a seat only listens to the connection that currently owns it.
static NEXT_CONN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

struct Bucket {
    tokens: f64,
    at: tokio::time::Instant,
}

impl Bucket {
    fn allow(&mut self, now: tokio::time::Instant) -> bool {
        self.tokens = FRAME_BURST
            .min(self.tokens + now.duration_since(self.at).as_secs_f64() * FRAMES_PER_SECOND);
        self.at = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Sends `msgs` in order, all under one `SEND_TIMEOUT`: false when a send failed or the time ran out (a client that
/// stopped reading cannot hold the task). Every write of a connection is bounded so; the batched writer uses `write_batch`.
async fn send_bounded<S, I>(sock: &mut S, msgs: I) -> bool
where
    S: futures_util::Sink<Message> + Unpin,
    I: IntoIterator<Item = Message>,
{
    let all = async {
        for m in msgs {
            sock.send(m).await.map_err(|_| ())?;
        }
        Ok::<(), ()>(())
    };
    matches!(tokio::time::timeout(SEND_TIMEOUT, all).await, Ok(Ok(())))
}

/// The longest Reject reason the wire carries (wire strings carry a u8 length). The diagnostic text of a
/// refusal is cut here, on a char boundary, by the caller that owns it: the codec itself never truncates.
const MAX_REASON: usize = rh_protocol::codec::MAX_STR;

fn clip_reason(reason: &str) -> &str {
    let mut end = reason.len().min(MAX_REASON);
    while !reason.is_char_boundary(end) {
        end -= 1;
    }
    &reason[..end]
}

async fn reject(sock: &mut WebSocket, code: RejectCode, reason: &str) {
    let frame = ServerMsg::Reject {
        code,
        reason: clip_reason(reason).into(),
    }
    .encode();
    send_bounded(sock, [Message::Binary(frame.into()), Message::Close(None)]).await;
}

pub async fn serve(sock: WebSocket, director: Arc<Director>) {
    serve_guarded(sock, director, None).await
}

/// [`serve`] for a socket admitted by the public edge guard: the ticket is held for the connection's whole life (its
/// per-address slot), a fresh Hello first reserves a failed-credential slot for the client address (a client over its limit
/// is answered `RateLimited` before its ticket reaches the credential check), and the pending slot is given back once the
/// Hello is answered.
pub async fn serve_guarded(
    mut sock: WebSocket,
    director: Arc<Director>,
    mut edge: Option<crate::edge::WsTicket>,
) {
    let first = match tokio::time::timeout(HELLO_TIMEOUT, sock.recv()).await {
        Ok(Some(Ok(Message::Binary(b)))) => b,
        Ok(_) | Err(_) => {
            reject(&mut sock, RejectCode::Malformed, "expected Hello").await;
            return;
        }
    };
    // The envelope first: a Hello of another protocol version is answered with ProtocolMismatch whatever its layout, so an
    // old cached client always gets the reload hint even after a version changes the fields behind these three bytes.
    if let Some(theirs) = ClientMsg::hello_protocol(&first) {
        if theirs != PROTOCOL_VERSION {
            reject(
                &mut sock,
                RejectCode::ProtocolMismatch,
                &format!("server speaks protocol {PROTOCOL_VERSION}, client {theirs}"),
            )
            .await;
            return;
        }
    }
    let hello = match ClientMsg::decode(&first) {
        Ok(ClientMsg::Hello {
            protocol,
            content_hash,
            profile,
            ticket,
            faction,
            resume,
            ..
        }) => Hello {
            protocol,
            content_hash,
            profile,
            ticket,
            faction,
            resume,
        },
        _ => {
            reject(&mut sock, RejectCode::Malformed, "expected Hello").await;
            return;
        }
    };
    let attempt = match edge
        .as_ref()
        .map(|t| t.hello_attempt(hello.resume.is_some()))
    {
        None => None,
        Some(Ok(a)) => Some(a),
        Some(Err(wait)) => {
            reject(
                &mut sock,
                RejectCode::RateLimited,
                &format!(
                    "too many failed sign-ins from this address; retry in {} s",
                    wait.as_secs().max(1)
                ),
            )
            .await;
            return;
        }
    };
    let outbox = Arc::new(Outbox::default());
    let conn = NEXT_CONN.fetch_add(1, Ordering::Relaxed);
    let admitted = director.admit(hello, outbox.clone(), conn).await;
    if let (Some(t), Some(a)) = (edge.as_mut(), attempt) {
        let refused = matches!(admitted, Err((RejectCode::BadCredentials, _)));
        t.hello_done(a, refused);
    }
    let (room, ok) = match admitted {
        Ok(x) => x,
        Err((code, reason)) => {
            reject(&mut sock, code, &reason).await;
            return;
        }
    };
    // Under SEND_TIMEOUT like every later write: a client that completed Hello and then stopped reading (a zero TCP window)
    // must not hold its seat live forever before the reader's idle check has even started.
    if !send_bounded(&mut sock, [Message::Binary(ok.welcome.into())]).await {
        let _ = room
            .send(RoomCmd::Disconnected {
                player: ok.player,
                conn,
            })
            .await;
        return;
    }
    let player = ok.player;
    let clock = ok.clock.clone();
    let start = tokio::time::Instant::now();
    // The payloads this connection has been sent and not yet answered: only a Pong echoing one of them is a sample, so a
    // client cannot choose an arbitrary (e.g. future) payload to shrink its own rewind window.
    let pings = Arc::new(Mutex::new(VecDeque::<u64>::with_capacity(
        RTT_PINGS_IN_FLIGHT,
    )));
    let (mut tx, mut rx) = sock.split();
    let writer_out = outbox.clone();
    let writer_pings = pings.clone();
    let mut writer = tokio::spawn(async move {
        // One wake takes everything queued (a tick's frames for this client) and flushes it once.
        let mut batch: Vec<Vec<u8>> = Vec::with_capacity(8);
        let mut next_ping = start;
        loop {
            let now = tokio::time::Instant::now();
            if now >= next_ping {
                // P-NET-1 Phase 3: a control Ping carrying the connection's elapsed milliseconds. The reader subtracts
                // that payload from its own elapsed clock, so the RTT is measured by the server, never claimed by the
                // client. Pings are outbound: they do not touch the client-inbound frame bucket.
                let payload = now
                    .duration_since(start)
                    .as_millis()
                    .min(u128::from(u64::MAX)) as u64;
                {
                    let mut in_flight = writer_pings
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    if in_flight.len() == RTT_PINGS_IN_FLIGHT {
                        in_flight.pop_front();
                    }
                    in_flight.push_back(payload);
                }
                if !send_bounded(
                    &mut tx,
                    [Message::Ping(payload.to_le_bytes().to_vec().into())],
                )
                .await
                {
                    return;
                }
                next_ping = tokio::time::Instant::now() + RTT_PING_PERIOD;
                continue;
            }
            let d = tokio::select! {
                d = writer_out.wait_drain(&mut batch) => d,
                // A due Ping is never starved by an outbox that is always ready: every batch loops back through the
                // deadline check at the top before waiting again.
                _ = tokio::time::sleep_until(next_ping) => continue,
            };
            let step_started = d.step_started;
            if let Some(at) = step_started {
                crate::metrics::process().note_step_to_conn(at.elapsed());
            }
            if write_batch(&mut tx, &mut batch, d.close).await.is_err() || d.close.is_some() {
                return;
            }
            if let Some(at) = step_started {
                crate::metrics::process().note_step_to_written(at.elapsed());
            }
        }
    });
    let mut bucket = Bucket {
        tokens: FRAME_BURST,
        at: start,
    };
    // Liveness: the time of the last frame of any kind from the client, checked by a coarse interval instead of one timer
    // per message. A silent client is dropped between `idle` and `idle + period` after its last frame.
    let idle = director.idle_timeout();
    let period = (idle / 4).clamp(Duration::from_millis(10), Duration::from_secs(1));
    let mut liveness = tokio::time::interval_at(start + period, period);
    liveness.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last_seen = start;
    let mut streak = 0u32;
    let mut left = false;
    let mut writer_done = false;
    loop {
        // Stop reading as soon as the writer is done (a TooSlow/RateLimited close, or a dead socket), or on idleness.
        let msg = match next_wake(
            &mut rx,
            &mut liveness,
            &mut last_seen,
            idle,
            &mut writer,
            &mut streak,
        )
        .await
        {
            Wake::Frame(m) => m,
            Wake::Closed | Wake::Idle => break,
            Wake::WriterDone => {
                writer_done = true;
                break;
            }
        };
        let bytes = match msg {
            Ok(Message::Binary(b)) => b,
            // Control frames are charged like data frames: a Ping flood ends RateLimited (tungstenite answers each
            // client Ping with a Pong on its own; that answer is all a client Ping gets).
            Ok(Message::Ping(_)) => {
                if !bucket.allow(last_seen) {
                    outbox.close(RejectCode::RateLimited);
                    break;
                }
                continue;
            }
            // A Pong is the answer to this connection's own RTT Ping (the only use of server control frames). A Pong
            // that answers a currently in-flight challenge is exempt from the user-frame bucket and is one
            // server-measured sample for the seat; any other Pong is charged like every other inbound frame.
            Ok(Message::Pong(payload)) => {
                match admit_pong(&mut bucket, &pings, &payload, start, last_seen) {
                    PongAdmission::Matched(rtt_ms) => {
                        // Advisory: an overloaded room may drop a sample; the seat keeps its last estimate.
                        let _ = room.try_send(RoomCmd::RttSample {
                            player,
                            conn,
                            rtt_ms,
                        });
                    }
                    PongAdmission::Unmatched => {}
                    PongAdmission::RateLimited => {
                        outbox.close(RejectCode::RateLimited);
                        break;
                    }
                }
                continue;
            }
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(Message::Text(_)) => {
                outbox.close(RejectCode::Malformed);
                break;
            }
        };
        if !bucket.allow(last_seen) {
            outbox.close(RejectCode::RateLimited);
            break;
        }
        match ClientMsg::decode(&bytes) {
            Ok(ClientMsg::Input { seq, commands }) => {
                if room
                    .try_send(RoomCmd::Input {
                        player,
                        conn,
                        seq,
                        commands,
                        received: std::time::Instant::now(),
                    })
                    .is_err()
                {
                    outbox.close(RejectCode::TooSlow);
                    break;
                }
            }
            Ok(ClientMsg::Ping { nonce, client_ms }) => {
                let server_ms = f64::from_bits(clock.load(Ordering::Relaxed));
                outbox.important(
                    ServerMsg::Pong {
                        nonce,
                        client_ms,
                        server_ms,
                    }
                    .encode(),
                );
            }
            Ok(ClientMsg::Resync) => {
                // The client refused a delta: it gets a Full frame. The request is never dropped; the writer spaces forced Full
                // frames by MIN_FORCED_FULL_TICKS and keeps a request that arrives sooner pending (the frame bucket above
                // bounds a flood).
                outbox.request_resync();
            }
            Ok(ClientMsg::Leave) => {
                let _ = room.send(RoomCmd::Leave { player, conn }).await;
                left = true;
                break;
            }
            Ok(ClientMsg::Hello { .. }) | Err(_) => {
                outbox.close(RejectCode::Malformed);
                break;
            }
        }
    }
    if !left {
        // A dropped connection keeps the seat for the reconnect grace (room.rs).
        let _ = room.send(RoomCmd::Disconnected { player, conn }).await;
    }
    outbox.close(RejectCode::Kicked);
    if !writer_done
        && tokio::time::timeout(SEND_TIMEOUT, &mut writer)
            .await
            .is_err()
    {
        writer.abort();
    }
    let _ = tokio::time::timeout(CLOSE_LINGER, async {
        while let Some(Ok(m)) = rx.next().await {
            if matches!(m, Message::Close(_)) {
                break;
            }
        }
    })
    .await;
}

/// What one inbound Pong costs the reader: a matched server challenge is a compulsory control response and costs no
/// user-frame token; anything else costs one token (or the connection closes because the bucket is depleted).
enum PongAdmission {
    Matched(f64),
    Unmatched,
    RateLimited,
}

/// Decides one inbound Pong. The one-shot challenge is validated and consumed *before* the user-frame bucket is
/// charged, so only a Pong answering a currently in-flight server Ping is exempt. Malformed, unknown, duplicate,
/// evicted and old-connection payloads are charged exactly like any other inbound frame.
fn admit_pong(
    bucket: &mut Bucket,
    pings: &Mutex<VecDeque<u64>>,
    payload: &[u8],
    start: tokio::time::Instant,
    now: tokio::time::Instant,
) -> PongAdmission {
    if let Some(rtt_ms) = pong_rtt(pings, payload, start) {
        return PongAdmission::Matched(rtt_ms);
    }
    if bucket.allow(now) {
        PongAdmission::Unmatched
    } else {
        PongAdmission::RateLimited
    }
}

/// Turns one Pong into a server-measured RTT. Only a payload the writer actually sent (and this connection has not
/// answered yet) counts: a Pong with an unknown, stale, duplicate or malformed payload is not a sample. The payload is the
/// connection-start-relative millisecond clock, so the RTT is `now - sent` on that same clock.
fn pong_rtt(
    pings: &Mutex<VecDeque<u64>>,
    payload: &[u8],
    start: tokio::time::Instant,
) -> Option<f64> {
    let sent = u64::from_le_bytes(payload.try_into().ok()?);
    {
        let mut in_flight = pings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let at = in_flight.iter().position(|p| *p == sent)?;
        in_flight.remove(at);
    }
    let now_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    Some(now_ms.saturating_sub(sent) as f64)
}

/// What ended one wait of the reader loop.
enum Wake<M> {
    /// A frame arrived (and `last_seen` is now).
    Frame(M),
    /// The peer's stream ended.
    Closed,
    /// Nothing was heard for `idle`.
    Idle,
    /// The writer task finished (a close it was told to send, or a dead socket).
    WriterDone,
}

/// Waits for the next thing the reader loop acts on. The select is `biased` with the client's frames first: when a frame
/// is already readable and an overdue liveness tick is ready too, the frame wins and refreshes `last_seen`, so a client
/// that did send is never dropped for idleness by the tick winning a coin flip. Then the writer, then the liveness check.
///
/// Fairness: `streak` counts the frames returned in a row. Once it reaches [`FAIR_STREAK`], this wait first looks (without
/// waiting) at the writer, so a client whose frames are always readable cannot starve it: a finished writer (a TooSlow or
/// RateLimited close, a dead socket) ends the reader within `FAIR_STREAK + 1` frames. The liveness tick is never looked at
/// ahead of a ready frame (the P5d rule holds); while frames keep coming it has nothing to find anyway.
async fn next_wake<R, M, W>(
    rx: &mut R,
    liveness: &mut tokio::time::Interval,
    last_seen: &mut tokio::time::Instant,
    idle: Duration,
    writer: &mut W,
    streak: &mut u32,
) -> Wake<M>
where
    R: futures_util::Stream<Item = M> + Unpin,
    W: std::future::Future + Unpin,
{
    if *streak >= FAIR_STREAK {
        *streak = 0;
        let done = std::future::poll_fn(|cx| {
            std::task::Poll::Ready(std::pin::Pin::new(&mut *writer).poll(cx).is_ready())
        })
        .await;
        if done {
            return Wake::WriterDone;
        }
    }
    loop {
        tokio::select! {
            biased;
            m = rx.next() => {
                return match m {
                    Some(m) => {
                        *last_seen = tokio::time::Instant::now();
                        *streak += 1;
                        Wake::Frame(m)
                    }
                    None => Wake::Closed,
                };
            }
            _ = &mut *writer => return Wake::WriterDone,
            t = liveness.tick() => {
                *streak = 0;
                if t.duration_since(*last_seen) >= idle {
                    return Wake::Idle;
                }
            }
        }
    }
}

/// WebSocket framing a server frame is charged in the write buffer. A server frame is unmasked (header at most 10 bytes);
/// 14 is the masked maximum (10 + a 4-byte mask), kept as a conservative bound: the budget only ever errs towards an
/// early flush.
const FRAME_OVERHEAD: usize = 14;

/// Writes one drained batch: every frame is fed as its own WebSocket message (identical bytes, identical order), then the
/// sink is flushed once, all under one `SEND_TIMEOUT`. A close appends the Reject and the Close message to the same flush.
/// Returns the number of flushes made. The fed total between two flushes never exceeds `WS_MAX_WRITE_BUFFER` (the limit
/// of tungstenite's out-buffer): when the next frame would pass it, the batch flushes early, so a very large batch costs
/// extra flushes instead of failing the send. Frames are consumed from `frames`, which is left empty.
pub(crate) async fn write_batch<S>(
    tx: &mut S,
    frames: &mut Vec<Vec<u8>>,
    close: Option<RejectCode>,
) -> Result<u32, ()>
where
    S: futures_util::Sink<Message> + Unpin,
{
    let r = tokio::time::timeout(SEND_TIMEOUT, async {
        let mut flushes = 0u32;
        let mut fed = 0usize;
        for f in frames.drain(..) {
            let cost = f.len() + FRAME_OVERHEAD;
            if fed > 0 && fed + cost > crate::WS_MAX_WRITE_BUFFER {
                tx.flush().await.map_err(|_| ())?;
                flushes += 1;
                fed = 0;
            }
            tx.feed(Message::Binary(f.into())).await.map_err(|_| ())?;
            fed += cost;
        }
        if let Some(code) = close {
            let reject = ServerMsg::Reject {
                code,
                reason: "closed".into(),
            }
            .encode();
            if fed > 0 && fed + reject.len() + 2 * FRAME_OVERHEAD > crate::WS_MAX_WRITE_BUFFER {
                tx.flush().await.map_err(|_| ())?;
                flushes += 1;
            }
            tx.feed(Message::Binary(reject.into()))
                .await
                .map_err(|_| ())?;
            tx.feed(Message::Close(None)).await.map_err(|_| ())?;
        }
        tx.flush().await.map_err(|_| ())?;
        Ok::<u32, ()>(flushes + 1)
    })
    .await;
    frames.clear();
    r.unwrap_or(Err(()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A Pong is a sample only for a payload this connection was sent and has not answered yet (once): an unknown,
    /// duplicate or malformed payload is ignored, so a client cannot pick its own RTT.
    #[test]
    fn only_an_unanswered_server_ping_payload_is_an_rtt_sample() {
        let start = tokio::time::Instant::now() - Duration::from_millis(100);
        let pings = Mutex::new(VecDeque::from(vec![10u64, 20]));
        let rtt = pong_rtt(&pings, &20u64.to_le_bytes(), start).expect("matched");
        assert!(
            (80.0..=130.0).contains(&rtt),
            "now ~100 ms - sent 20 ms: {rtt}"
        );
        assert_eq!(
            pong_rtt(&pings, &20u64.to_le_bytes(), start),
            None,
            "answered once"
        );
        assert_eq!(
            pong_rtt(&pings, &99u64.to_le_bytes(), start),
            None,
            "never sent"
        );
        assert_eq!(
            pong_rtt(&pings, &[0u8; 4], start),
            None,
            "not the 8-byte payload"
        );
        let rtt = pong_rtt(&pings, &10u64.to_le_bytes(), start).expect("still in flight");
        assert!(
            (90.0..=140.0).contains(&rtt),
            "now ~100 ms - sent 10 ms: {rtt}"
        );
    }

    /// The writer keeps at most `RTT_PINGS_IN_FLIGHT` challenges; when a ninth is sent the oldest is evicted and can
    /// no longer be answered as a sample. A matched payload is still consumed once (the existing test's duplicate case).
    #[test]
    fn an_evicted_server_ping_payload_is_not_a_sample() {
        let start = tokio::time::Instant::now();
        let pings = Mutex::new(VecDeque::new());
        for payload in 0u64..=(RTT_PINGS_IN_FLIGHT as u64) {
            let mut in_flight = pings
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if in_flight.len() == RTT_PINGS_IN_FLIGHT {
                in_flight.pop_front();
            }
            in_flight.push_back(payload);
        }
        assert_eq!(
            pong_rtt(&pings, &0u64.to_le_bytes(), start),
            None,
            "the ninth challenge evicted payload 0"
        );
        for payload in 1u64..=RTT_PINGS_IN_FLIGHT as u64 {
            assert!(
                pong_rtt(&pings, &payload.to_le_bytes(), start).is_some(),
                "payload {payload} is still in flight"
            );
        }
        assert_eq!(
            pong_rtt(&pings, &(RTT_PINGS_IN_FLIGHT as u64).to_le_bytes(), start),
            None,
            "an answered payload is consumed once"
        );
    }

    #[test]
    fn a_long_reason_is_clipped_on_a_char_boundary_and_still_encodes() {
        let long = "é".repeat(300);
        let c = clip_reason(&long);
        assert_eq!(c.len(), 254);
        assert!(long.is_char_boundary(c.len()));
        let m = ServerMsg::Reject {
            code: RejectCode::ProfileInUse,
            reason: c.into(),
        };
        assert!(m.try_encode().is_ok());
        assert_eq!(clip_reason("short"), "short");
    }
    use std::convert::Infallible;
    use std::pin::Pin;
    use std::task::{Context, Poll};

    /// Records what the writer does to a socket sink: every message in order, and when each flush happened.
    #[derive(Default)]
    struct CountingSink {
        sent: Vec<Message>,
        flushes: usize,
        /// Length of `sent` at each flush.
        flush_marks: Vec<usize>,
        /// Largest number of bytes fed between two flushes.
        max_unflushed: usize,
        unflushed: usize,
    }

    impl futures_util::Sink<Message> for CountingSink {
        type Error = Infallible;
        fn poll_ready(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), Infallible>> {
            Poll::Ready(Ok(()))
        }
        fn start_send(mut self: Pin<&mut Self>, m: Message) -> Result<(), Infallible> {
            if let Message::Binary(b) = &m {
                self.unflushed += b.len() + FRAME_OVERHEAD;
                self.max_unflushed = self.max_unflushed.max(self.unflushed);
            }
            self.sent.push(m);
            Ok(())
        }
        fn poll_flush(
            mut self: Pin<&mut Self>,
            _: &mut Context<'_>,
        ) -> Poll<Result<(), Infallible>> {
            self.flushes += 1;
            let n = self.sent.len();
            self.flush_marks.push(n);
            self.unflushed = 0;
            Poll::Ready(Ok(()))
        }
        fn poll_close(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), Infallible>> {
            Poll::Ready(Ok(()))
        }
    }

    fn snap(tick: u32) -> rh_protocol::SnapshotData {
        rh_protocol::SnapshotData::build(tick, 1, 0, None, std::iter::empty()).expect("valid")
    }

    /// The Full frame of `snap(tick)`.
    fn snap_frame(tick: u32) -> Vec<u8> {
        let mut v = Vec::new();
        snap(tick).encode_full_into(&mut v);
        v
    }

    fn bin(m: &Message) -> &[u8] {
        match m {
            Message::Binary(b) => b,
            _ => panic!("expected a binary message"),
        }
    }

    /// A ready frame and an overdue liveness tick are both ready: the frame must win every time (the old unbiased select
    /// let the tick win about half of these and dropped a client whose frame had already arrived).
    #[tokio::test]
    async fn a_ready_frame_beats_an_overdue_liveness_tick() {
        let idle = Duration::from_millis(1);
        for trial in 0..200 {
            let start = tokio::time::Instant::now();
            let mut liveness = tokio::time::interval_at(start, Duration::from_millis(1));
            // The tick is ready now and, after the 2 ms sleep below, the last frame is past `idle` (no clock
            // subtraction, which could underflow on a young monotonic clock): a tick that wins ends the connection.
            let mut last_seen = start;
            let mut rx = futures_util::stream::iter([7u8, 8]);
            let mut writer = std::future::pending::<()>();
            tokio::time::sleep(Duration::from_millis(2)).await;
            match next_wake(
                &mut rx,
                &mut liveness,
                &mut last_seen,
                idle,
                &mut writer,
                &mut 0,
            )
            .await
            {
                Wake::Frame(7) => {}
                _ => panic!("trial {trial}: the tick won over a ready frame"),
            }
            assert!(
                last_seen >= start,
                "the frame refreshed last_seen, so the next tick finds the client alive"
            );
        }
    }

    #[tokio::test]
    async fn a_silent_client_is_idle_and_a_finished_writer_or_stream_ends_the_wait() {
        let idle = Duration::from_millis(30);
        let start = tokio::time::Instant::now();
        let mut liveness =
            tokio::time::interval_at(start + Duration::from_millis(5), Duration::from_millis(5));
        let mut last_seen = start;
        let mut rx = futures_util::stream::pending::<u8>();
        let mut writer = std::future::pending::<()>();
        assert!(matches!(
            next_wake(
                &mut rx,
                &mut liveness,
                &mut last_seen,
                idle,
                &mut writer,
                &mut 0
            )
            .await,
            Wake::Idle
        ));
        assert!(start.elapsed() >= idle);
        let mut done = std::future::ready(());
        assert!(matches!(
            next_wake(
                &mut rx,
                &mut liveness,
                &mut last_seen,
                idle,
                &mut done,
                &mut 0
            )
            .await,
            Wake::WriterDone
        ));
        let mut ended = futures_util::stream::empty::<u8>();
        assert!(matches!(
            next_wake(
                &mut ended,
                &mut liveness,
                &mut last_seen,
                idle,
                &mut writer,
                &mut 0
            )
            .await,
            Wake::Closed
        ));
    }

    /// A client whose frames are always readable (a Ping flood) cannot starve a writer that already finished: the reader
    /// learns of it within FAIR_STREAK + 1 frames, where the biased select alone would return frames forever.
    #[tokio::test]
    async fn a_flood_of_ready_frames_cannot_hide_a_finished_writer() {
        let idle = Duration::from_secs(10);
        let start = tokio::time::Instant::now();
        let mut liveness = tokio::time::interval_at(start + idle, idle);
        let mut last_seen = start;
        let mut rx = futures_util::stream::repeat(0u8);
        let mut writer = std::future::ready(());
        let mut streak = 0;
        let mut frames = 0;
        loop {
            match next_wake(
                &mut rx,
                &mut liveness,
                &mut last_seen,
                idle,
                &mut writer,
                &mut streak,
            )
            .await
            {
                Wake::Frame(_) => frames += 1,
                Wake::WriterDone => break,
                _ => panic!("only frames and the writer are ready"),
            }
            assert!(frames <= FAIR_STREAK, "the writer was starved");
        }
        assert_eq!(frames, FAIR_STREAK);
    }

    /// The fairness look never puts an overdue liveness tick ahead of a ready frame (the P5d rule): at a look, with the
    /// client silent past `idle`, the tick overdue and a frame readable, the frame still wins, on every trial.
    #[tokio::test]
    async fn the_fairness_look_keeps_a_ready_frame_ahead_of_an_overdue_tick() {
        let idle = Duration::from_millis(1);
        for trial in 0..50 {
            let start = tokio::time::Instant::now();
            let mut liveness = tokio::time::interval_at(start, Duration::from_millis(1));
            let mut last_seen = start;
            let mut rx = futures_util::stream::repeat(0u8);
            let mut writer = std::future::pending::<()>();
            let mut streak = FAIR_STREAK;
            tokio::time::sleep(Duration::from_millis(2)).await;
            match next_wake(
                &mut rx,
                &mut liveness,
                &mut last_seen,
                idle,
                &mut writer,
                &mut streak,
            )
            .await
            {
                Wake::Frame(_) => {}
                _ => panic!("trial {trial}: the look dropped a client whose frame was ready"),
            }
            assert_eq!(streak, 1);
        }
    }

    /// The bucket a control frame is charged to lets exactly `FRAME_BURST` frames through at one instant (the wiring is guarded
    /// end to end by tests/transport.rs `a_websocket_ping_flood_is_rate_limited`).
    #[test]
    fn the_frame_bucket_allows_exactly_its_burst_at_one_instant() {
        let t = tokio::time::Instant::now();
        let mut b = Bucket {
            tokens: FRAME_BURST,
            at: t,
        };
        let allowed = (0..1000).take_while(|_| b.allow(t)).count();
        assert_eq!(allowed, FRAME_BURST as usize);
    }

    /// One simulated 65 s stream: how far it got and the bucket level it ended at.
    #[derive(Debug, Default)]
    struct StreamRun {
        frames_charged: usize,
        pongs: usize,
        matched_pongs: usize,
        first_frame_failure_s: Option<f64>,
        first_pong_failure_s: Option<f64>,
        min_tokens: f64,
        final_tokens: f64,
    }

    /// Drives the real [`Bucket`] and [`admit_pong`] over a deterministic timeline: 60 user frames/s for 65 s plus one
    /// answer to a server control Ping every 500 ms. The first Ping is sent at connection start and the last Pong lands at
    /// 65.0 s, after the last frame. `charge_matched_pongs` selects the old buggy charge-before-match order as a negative
    /// control; the fixed path calls `admit_pong` itself, so reordering that function makes the acceptance test fail.
    fn stream_65s(charge_matched_pongs: bool) -> StreamRun {
        let start = tokio::time::Instant::now();
        let mut bucket = Bucket {
            tokens: FRAME_BURST,
            at: start,
        };
        let pings = Mutex::new(VecDeque::<u64>::new());
        let mut run = StreamRun {
            min_tokens: FRAME_BURST,
            ..Default::default()
        };
        // 3,900 frame instants (60/s over 65 s) and 131 Pong instants (the Ping at start plus every 500 ms, 65 s
        // inclusive); the last Pong follows the last user frame.
        for i in 0..=3900 {
            let t = start + Duration::from_secs_f64(i as f64 / FRAMES_PER_SECOND);
            if i < 3900 {
                if !bucket.allow(t) {
                    run.first_frame_failure_s = Some((t - start).as_secs_f64());
                    break;
                }
                run.frames_charged += 1;
                run.min_tokens = run.min_tokens.min(bucket.tokens);
            }
            if i % 30 == 0 {
                let sent = t.duration_since(start).as_millis() as u64;
                let payload = sent.to_le_bytes();
                {
                    let mut in_flight = pings
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    if in_flight.len() == RTT_PINGS_IN_FLIGHT {
                        in_flight.pop_front();
                    }
                    in_flight.push_back(sent);
                }
                run.pongs += 1;
                if charge_matched_pongs {
                    // The old reader loop: charge every Pong against the user-frame bucket, then try to match it.
                    if !bucket.allow(t) {
                        run.first_pong_failure_s = Some((t - start).as_secs_f64());
                        break;
                    }
                    if pong_rtt(&pings, &payload, start).is_some() {
                        run.matched_pongs += 1;
                    }
                } else {
                    match admit_pong(&mut bucket, &pings, &payload, start, t) {
                        PongAdmission::Matched(_) => run.matched_pongs += 1,
                        PongAdmission::Unmatched | PongAdmission::RateLimited => {
                            run.first_pong_failure_s = Some((t - start).as_secs_f64());
                            break;
                        }
                    }
                }
                run.min_tokens = run.min_tokens.min(bucket.tokens);
            }
        }
        run.final_tokens = bucket.tokens;
        run
    }

    /// The PONG_REPAIR acceptance proof: a lawful 60 frames/s client plus the compulsory 2 Pong/s answers to the
    /// server's 500 ms RTT challenges never drains the user-frame bucket. The negative control in the same test charges
    /// the matched Pongs as the old reader did and shows the same stream collapsing: the first refusal lands at ~59.0 s.
    #[test]
    fn a_lawful_60hz_stream_with_compulsory_pongs_survives_65_seconds() {
        let fixed = stream_65s(false);
        assert_eq!(
            fixed.frames_charged, 3900,
            "every lawful user frame was charged"
        );
        assert_eq!(
            fixed.first_frame_failure_s, None,
            "the lawful stream was never RateLimited"
        );
        assert_eq!(
            fixed.first_pong_failure_s, None,
            "every compulsory Pong matched and was exempt"
        );
        assert_eq!(
            fixed.matched_pongs, 131,
            "the 500 ms challenges were answered one for one"
        );
        assert!(
            fixed.min_tokens > 1.0,
            "the bucket never collapsed: min tokens {}",
            fixed.min_tokens
        );
        assert!(
            fixed.final_tokens > 0.0,
            "tokens remain after 65 s: {}",
            fixed.final_tokens
        );

        let old = stream_65s(true);
        let failed_at = old
            .first_frame_failure_s
            .or(old.first_pong_failure_s)
            .expect("the old charge-before-match order depletes the bucket");
        assert!(
            (59.0..=60.0).contains(&failed_at),
            "the negative control fails ~59-60 s in, got {failed_at} s"
        );
        assert!(
            old.final_tokens < 1.0,
            "the negative control ends with a depleted bucket: {}",
            old.final_tokens
        );
        assert!(
            old.frames_charged > 3_500,
            "the old order survived most of the stream before refusing"
        );
    }

    /// A matched response is free, but the normal 60 frames/s bucket still bounds every Pong that cannot answer a
    /// currently in-flight challenge: malformed, unknown, duplicate and evicted payloads are charged, exactly
    /// `FRAME_BURST` are admitted at one instant, and the next one closes the connection.
    #[test]
    fn unmatched_pongs_are_charged_but_a_matched_pong_is_free_under_a_flood() {
        let t = tokio::time::Instant::now();
        let start = t;
        // Eight outstanding challenges, as the writer leaves them. Payload 2 is answered first below; payload 1 is
        // already evicted by a ninth send, mirroring the writer's bounded deque.
        let pings = Mutex::new(VecDeque::from(vec![2u64, 3, 4, 5, 6, 7, 8, 9]));
        let mut bucket = Bucket {
            tokens: FRAME_BURST,
            at: t,
        };
        match admit_pong(&mut bucket, &pings, &2u64.to_le_bytes(), start, t) {
            PongAdmission::Matched(_) => {}
            PongAdmission::Unmatched | PongAdmission::RateLimited => {
                panic!("the first answer to a live challenge must be matched")
            }
        }
        assert_eq!(
            bucket.tokens, FRAME_BURST,
            "a matched Pong costs no user-frame token"
        );

        let mut admitted = 0usize;
        let mut rate_limited = false;
        // Every payload below is unmatched: a duplicate of the consumed challenge, a malformed payload, an evicted
        // challenge and an unknown payload.
        for i in 0..(FRAME_BURST as usize + 5) {
            let payload: Vec<u8> = match i % 4 {
                0 => 2u64.to_le_bytes().to_vec(),
                1 => vec![0u8; 4],
                2 => 1u64.to_le_bytes().to_vec(),
                _ => (1_000u64 + i as u64).to_le_bytes().to_vec(),
            };
            match admit_pong(&mut bucket, &pings, &payload, start, t) {
                PongAdmission::Unmatched => admitted += 1,
                PongAdmission::RateLimited => {
                    rate_limited = true;
                    break;
                }
                PongAdmission::Matched(_) => panic!("payload at i={i} must not match"),
            }
        }
        assert!(rate_limited, "the flood is eventually refused");
        assert_eq!(
            admitted, FRAME_BURST as usize,
            "one instant admits exactly the burst, with the matched Pong free"
        );
    }

    /// A sink that never accepts anything (a client with a zero TCP window).
    struct StalledSink;

    impl futures_util::Sink<Message> for StalledSink {
        type Error = Infallible;
        fn poll_ready(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), Infallible>> {
            Poll::Pending
        }
        fn start_send(self: Pin<&mut Self>, _: Message) -> Result<(), Infallible> {
            Ok(())
        }
        fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), Infallible>> {
            Poll::Pending
        }
        fn poll_close(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), Infallible>> {
            Poll::Pending
        }
    }

    /// The Welcome (and a Reject) are bounded like every later write: a client that stops reading right after its Hello
    /// gives up its connection after SEND_TIMEOUT instead of holding the task (and its seat) forever.
    #[tokio::test(start_paused = true)]
    async fn the_welcome_and_reject_sends_give_up_after_send_timeout() {
        let t0 = tokio::time::Instant::now();
        assert!(!send_bounded(&mut StalledSink, [Message::Binary(vec![1u8; 9].into())]).await);
        assert_eq!(t0.elapsed(), SEND_TIMEOUT);
        let mut ok = CountingSink::default();
        assert!(
            send_bounded(
                &mut ok,
                [Message::Binary(vec![1u8].into()), Message::Close(None)]
            )
            .await
        );
        assert_eq!((ok.sent.len(), ok.flushes), (2, 2));
    }

    #[tokio::test]
    async fn one_wake_is_one_flush_with_every_frame_in_the_old_order() {
        let out = Outbox::default();
        // A tick for a client that is also owed a Pong: pong, events, fx, snapshot.
        out.important(vec![1, 1]);
        out.push_tick(Some(vec![1, 2]), Some(vec![2, 1]), Some(snap(1)));
        let mut batch = Vec::new();
        let d = out.wait_drain(&mut batch).await;
        assert_eq!(d.frames, 4);
        let mut sink = CountingSink::default();
        let flushes = write_batch(&mut sink, &mut batch, d.close).await.unwrap();
        assert_eq!(flushes, 1);
        assert_eq!(sink.flushes, 1, "exactly one flush per wake");
        assert_eq!(
            sink.flush_marks,
            vec![4],
            "the flush comes after every frame"
        );
        let got: Vec<&[u8]> = sink.sent.iter().map(bin).collect();
        let full = snap_frame(1);
        assert_eq!(got, vec![&[1u8, 1][..], &[1, 2], &[2, 1], &full[..]]);
        assert!(batch.is_empty());
    }

    #[tokio::test]
    async fn a_close_shares_the_flush_of_the_frames_before_it() {
        let out = Outbox::default();
        out.push_tick(Some(vec![7]), Some(vec![8]), Some(snap(9)));
        out.close(RejectCode::RateLimited);
        let mut batch = Vec::new();
        let d = out.wait_drain(&mut batch).await;
        let mut sink = CountingSink::default();
        write_batch(&mut sink, &mut batch, d.close).await.unwrap();
        assert_eq!(sink.flushes, 1);
        assert_eq!(
            sink.sent.len(),
            3,
            "the important frame, the Reject, the Close"
        );
        assert_eq!(bin(&sink.sent[0]), &[7]);
        assert!(matches!(
            ServerMsg::decode(bin(&sink.sent[1])),
            Ok(ServerMsg::Reject {
                code: RejectCode::RateLimited,
                ..
            })
        ));
        assert!(matches!(sink.sent[2], Message::Close(None)));
    }

    #[tokio::test]
    async fn a_batch_never_feeds_more_than_the_write_buffer_cap_between_flushes() {
        // Worst case: the important queue is full of the largest frames the protocol allows.
        let big = vec![0u8; rh_protocol::MAX_SERVER_FRAME];
        let mut batch: Vec<Vec<u8>> = (0..crate::outbox::IMPORTANT_CAP)
            .map(|_| big.clone())
            .collect();
        let total = batch.len();
        let mut sink = CountingSink::default();
        let flushes = write_batch(&mut sink, &mut batch, Some(RejectCode::TooSlow))
            .await
            .unwrap();
        assert!(sink.max_unflushed <= crate::WS_MAX_WRITE_BUFFER);
        assert!(
            flushes > 1,
            "a huge batch flushes early instead of overrunning the buffer"
        );
        assert_eq!(sink.flushes as u32, flushes);
        assert_eq!(sink.sent.len(), total + 2);
        // A normal tick (a few KiB) stays far below the cap: one flush.
        let mut tick = vec![vec![0u8; 3000], vec![0u8; 200], vec![0u8; 9000]];
        let mut sink = CountingSink::default();
        assert_eq!(write_batch(&mut sink, &mut tick, None).await, Ok(1));
    }
}
