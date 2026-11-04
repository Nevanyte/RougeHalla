//! One client connection: WebSocket binary frames, one protocol message per frame. Admission happens on the first frame
//! (Hello, within HELLO_TIMEOUT); after that, inputs are forwarded to the room in arrival order. Guards (docs/CONTRACTS.md
//! C-NET-4): frame size capped by the WebSocket layer before any decoding, a per-connection frame-rate bucket, strict
//! decoding (a malformed frame closes the connection with `Malformed`), and a bounded room inbox (a client that cannot be
//! served in time is closed with `TooSlow`, never allowed to stall the match).

use crate::director::{Director, Hello};
use crate::outbox::{Next, Outbox};
use crate::room::RoomCmd;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, RejectCode, ServerMsg};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

pub const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
/// Frames per second a client may send (aim 40/s + orders + pings fit well under it), with a burst.
pub const FRAMES_PER_SECOND: f64 = 60.0;
pub const FRAME_BURST: f64 = 120.0;

struct Bucket {
    tokens: f64,
    at: tokio::time::Instant,
}

impl Bucket {
    fn allow(&mut self) -> bool {
        let now = tokio::time::Instant::now();
        self.tokens = FRAME_BURST.min(self.tokens + now.duration_since(self.at).as_secs_f64() * FRAMES_PER_SECOND);
        self.at = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

async fn reject(sock: &mut WebSocket, code: RejectCode, reason: &str) {
    let _ = sock.send(Message::Binary(ServerMsg::Reject { code, reason: reason.into() }.encode().into())).await;
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
        Ok(ClientMsg::Hello { protocol, content_hash, profile, token, faction, resume, .. }) => Hello { protocol, content_hash, profile, token, faction, resume },
        _ => {
            reject(&mut sock, RejectCode::Malformed, "expected Hello").await;
            return;
        }
    };
    let outbox = Arc::new(Outbox::default());
    let (room, ok) = match director.admit(hello, outbox.clone()).await {
        Ok(x) => x,
        Err((code, reason)) => {
            reject(&mut sock, code, &reason).await;
            return;
        }
    };
    if sock.send(Message::Binary(ok.welcome.into())).await.is_err() {
        let _ = room.send(RoomCmd::Disconnected { player: ok.player }).await;
        return;
    }
    let player = ok.player;
    let clock = ok.clock.clone();
    let (mut tx, mut rx) = sock.split();
    let writer_out = outbox.clone();
    let writer = tokio::spawn(async move {
        loop {
            match writer_out.next().await {
                Next::Frame(f) => {
                    if tx.send(Message::Binary(f.into())).await.is_err() {
                        return;
                    }
                }
                Next::Close(code) => {
                    let _ = tx.send(Message::Binary(ServerMsg::Reject { code, reason: "closed".into() }.encode().into())).await;
                    let _ = tx.send(Message::Close(None)).await;
                    return;
                }
            }
        }
    });
    let mut bucket = Bucket { tokens: FRAME_BURST, at: tokio::time::Instant::now() };
    let mut left = false;
    while let Some(msg) = rx.next().await {
        let bytes = match msg {
            Ok(Message::Binary(b)) => b,
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => continue,
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(Message::Text(_)) => {
                outbox.close(RejectCode::Malformed);
                break;
            }
        };
        if !bucket.allow() {
            outbox.close(RejectCode::RateLimited);
            break;
        }
        match ClientMsg::decode(&bytes) {
            Ok(ClientMsg::Input { seq, commands }) => {
                if room.try_send(RoomCmd::Input { player, seq, commands }).is_err() {
                    outbox.close(RejectCode::TooSlow);
                    break;
                }
            }
            Ok(ClientMsg::Ping { nonce, client_ms }) => {
                let server_ms = f64::from_bits(clock.load(Ordering::Relaxed));
                outbox.important(ServerMsg::Pong { nonce, client_ms, server_ms }.encode());
            }
            Ok(ClientMsg::Leave) => {
                let _ = room.send(RoomCmd::Leave { player }).await;
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
        let _ = room.send(RoomCmd::Disconnected { player }).await;
    }
    outbox.close(RejectCode::Kicked);
    let _ = writer.await;
}
