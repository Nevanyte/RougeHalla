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
use rh_protocol::{ClientMsg, RejectCode, ServerMsg};
use std::sync::atomic::Ordering;
use std::sync::Arc;
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
/// A client's `Resync` (it refused a delta) is honoured at most this often; more are ignored, not punished (the frame bucket
/// below already bounds a flood).
pub const RESYNC_MIN_INTERVAL: Duration = Duration::from_secs(1);
/// Frames per second a client may send (aim 40/s + orders + pings fit well under it), with a burst.
pub const FRAMES_PER_SECOND: f64 = 60.0;
pub const FRAME_BURST: f64 = 120.0;

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

/// Admits a `Resync` when none was honoured within [`RESYNC_MIN_INTERVAL`].
#[derive(Default)]
struct ResyncLimit {
    last: Option<tokio::time::Instant>,
}

impl ResyncLimit {
    fn allow(&mut self, now: tokio::time::Instant) -> bool {
        if self
            .last
            .is_some_and(|t| now.duration_since(t) < RESYNC_MIN_INTERVAL)
        {
            return false;
        }
        self.last = Some(now);
        true
    }
}

async fn reject(sock: &mut WebSocket, code: RejectCode, reason: &str) {
    let _ = sock
        .send(Message::Binary(
            ServerMsg::Reject {
                code,
                reason: reason.into(),
            }
            .encode()
            .into(),
        ))
        .await;
    let _ = sock.send(Message::Close(None)).await;
}

pub async fn serve(mut sock: WebSocket, director: Arc<Director>) {
    let first = match tokio::time::timeout(HELLO_TIMEOUT, sock.recv()).await {
        Ok(Some(Ok(Message::Binary(b)))) => b,
        Ok(_) | Err(_) => {
            reject(&mut sock, RejectCode::Malformed, "expected Hello").await;
            return;
        }
    };
    let hello = match ClientMsg::decode(&first) {
        Ok(ClientMsg::Hello {
            protocol,
            content_hash,
            profile,
            token,
            faction,
            resume,
            ..
        }) => Hello {
            protocol,
            content_hash,
            profile,
            token,
            faction,
            resume,
        },
        _ => {
            reject(&mut sock, RejectCode::Malformed, "expected Hello").await;
            return;
        }
    };
    let outbox = Arc::new(Outbox::default());
    let conn = NEXT_CONN.fetch_add(1, Ordering::Relaxed);
    let (room, ok) = match director.admit(hello, outbox.clone(), conn).await {
        Ok(x) => x,
        Err((code, reason)) => {
            reject(&mut sock, code, &reason).await;
            return;
        }
    };
    if sock.send(Message::Binary(ok.welcome.into())).await.is_err() {
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
    let (mut tx, mut rx) = sock.split();
    let writer_out = outbox.clone();
    let mut writer = tokio::spawn(async move {
        // One wake takes everything queued (a tick's frames for this client) and flushes it once.
        let mut batch: Vec<Vec<u8>> = Vec::with_capacity(8);
        loop {
            let d = writer_out.wait_drain(&mut batch).await;
            if write_batch(&mut tx, &mut batch, d.close).await.is_err() || d.close.is_some() {
                return;
            }
        }
    });
    let start = tokio::time::Instant::now();
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
    let mut left = false;
    let mut writer_done = false;
    let mut resync = ResyncLimit::default();
    loop {
        // Stop reading as soon as the writer is done (a TooSlow/RateLimited close, or a dead socket), or on idleness.
        let msg = match next_wake(&mut rx, &mut liveness, &mut last_seen, idle, &mut writer).await {
            Wake::Frame(m) => m,
            Wake::Closed | Wake::Idle => break,
            Wake::WriterDone => {
                writer_done = true;
                break;
            }
        };
        let bytes = match msg {
            Ok(Message::Binary(b)) => b,
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => continue,
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
                // The client refused a delta: its next snapshot is a Full frame (rate limited; a flood is ignored).
                if resync.allow(last_seen) {
                    outbox.request_resync();
                }
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
async fn next_wake<R, M, W>(
    rx: &mut R,
    liveness: &mut tokio::time::Interval,
    last_seen: &mut tokio::time::Instant,
    idle: Duration,
    writer: &mut W,
) -> Wake<M>
where
    R: futures_util::Stream<Item = M> + Unpin,
    W: std::future::Future + Unpin,
{
    loop {
        tokio::select! {
            biased;
            m = rx.next() => {
                return match m {
                    Some(m) => {
                        *last_seen = tokio::time::Instant::now();
                        Wake::Frame(m)
                    }
                    None => Wake::Closed,
                };
            }
            _ = &mut *writer => return Wake::WriterDone,
            t = liveness.tick() => {
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
            match next_wake(&mut rx, &mut liveness, &mut last_seen, idle, &mut writer).await {
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
            next_wake(&mut rx, &mut liveness, &mut last_seen, idle, &mut writer).await,
            Wake::Idle
        ));
        assert!(start.elapsed() >= idle);
        let mut done = std::future::ready(());
        assert!(matches!(
            next_wake(&mut rx, &mut liveness, &mut last_seen, idle, &mut done).await,
            Wake::WriterDone
        ));
        let mut ended = futures_util::stream::empty::<u8>();
        assert!(matches!(
            next_wake(&mut ended, &mut liveness, &mut last_seen, idle, &mut writer).await,
            Wake::Closed
        ));
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

    #[tokio::test(start_paused = true)]
    async fn resyncs_are_honoured_once_per_interval() {
        let mut l = ResyncLimit::default();
        let t0 = tokio::time::Instant::now();
        assert!(l.allow(t0));
        assert!(!l.allow(t0 + Duration::from_millis(10)));
        assert!(!l.allow(t0 + RESYNC_MIN_INTERVAL - Duration::from_millis(1)));
        assert!(l.allow(t0 + RESYNC_MIN_INTERVAL));
        assert!(!l.allow(t0 + RESYNC_MIN_INTERVAL + Duration::from_millis(1)));
    }
}
