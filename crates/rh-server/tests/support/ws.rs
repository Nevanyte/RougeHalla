#![allow(dead_code)]
//! A minimal game client for the control and bridge tests: Hello (optionally a resume), Welcome or Reject, Leave.

use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, RejectCode, ServerMsg, PROTOCOL_VERSION};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

/// A connected player: the send half, and the receive half drained in the background so the server never sees a slow client.
type Sink = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    Message,
>;

/// A connected player. A ping every second keeps the seat live (the server drops a connection that is silent for 10 s).
pub struct Client {
    sink: std::sync::Arc<tokio::sync::Mutex<Sink>>,
    reader: tokio::task::JoinHandle<()>,
    pinger: tokio::task::JoinHandle<()>,
    pub session: [u8; 16],
}

impl Client {
    pub async fn leave(&mut self) {
        self.sink
            .lock()
            .await
            .send(Message::Binary(ClientMsg::Leave.encode().into()))
            .await
            .unwrap();
    }
    /// Drop the connection without a Leave (the seat enters its reconnect grace).
    pub fn drop_socket(self) {
        self.pinger.abort();
        self.reader.abort();
    }
}

pub fn hello(callsign: &str, ticket: &str, resume: Option<[u8; 16]>) -> ClientMsg {
    ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        build: "test".into(),
        profile: callsign.into(),
        ticket: ticket.as_bytes().to_vec(),
        faction: None,
        resume,
    }
}

pub async fn try_join(
    url: &str,
    callsign: &str,
    ticket: &str,
    resume: Option<[u8; 16]>,
) -> Result<Client, (RejectCode, String)> {
    let (ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("connect");
    let (mut sink, mut stream) = ws.split();
    sink.send(Message::Binary(
        hello(callsign, ticket, resume).encode().into(),
    ))
    .await
    .unwrap();
    let mut track = rh_protocol::SnapshotTracker::new();
    let session = loop {
        let next = tokio::time::timeout(Duration::from_secs(3), stream.next())
            .await
            .expect("a frame within 3 s");
        let Some(Ok(Message::Binary(b))) = next else {
            panic!("socket ended before Welcome or Reject: {next:?}");
        };
        match track.decode(&b).expect("frames decode") {
            ServerMsg::Welcome { session, .. } => break session,
            ServerMsg::Reject { code, reason } => return Err((code, reason)),
            _ => {}
        }
    };
    let reader = tokio::spawn(async move { while let Some(Ok(_)) = stream.next().await {} });
    let sink = std::sync::Arc::new(tokio::sync::Mutex::new(sink));
    let ping_sink = sink.clone();
    let pinger = tokio::spawn(async move {
        let mut nonce = 0u32;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            nonce += 1;
            let ping = ClientMsg::Ping {
                nonce,
                client_ms: 0.0,
            };
            if ping_sink
                .lock()
                .await
                .send(Message::Binary(ping.encode().into()))
                .await
                .is_err()
            {
                return;
            }
        }
    });
    Ok(Client {
        sink,
        reader,
        pinger,
        session,
    })
}
