//! A one-seat game client for the local fleet proof (hosting/scripts/fleet-local/): joins with Hello, keeps the seat live with a
//! ping per second, and prints one JSON line per event it cares about. It is a load-free driver, not a bot: it sends no input.
//!
//!   fleet_client --url ws://127.0.0.1:35000/ws --callsign alice [--ticket t] [--max-secs 120] [--leave-after-secs N]
//!
//! Output lines: {"ev":"welcome"} | {"ev":"reject","code":"...","reason":"..."} | {"ev":"result","outcome":N,"place":N} |
//! {"ev":"closed"} | {"ev":"timeout"} | {"ev":"left"}.
//! Exit codes: 0 the match produced a Result (or the client left on request), 3 rejected, 4 the socket closed with no Result,
//! 5 timeout, 2 usage.

use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, ServerMsg, SnapshotTracker, WireEvent, PROTOCOL_VERSION};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

fn arg(args: &[String], key: &str) -> Option<String> {
    args.iter()
        .position(|a| a == key)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn say(v: serde_json::Value) {
    println!("{v}");
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(url), Some(callsign)) = (arg(&args, "--url"), arg(&args, "--callsign")) else {
        eprintln!("usage: fleet_client --url ws://host:port/ws --callsign NAME [--ticket T] [--max-secs N] [--leave-after-secs N]");
        std::process::exit(2);
    };
    let ticket = arg(&args, "--ticket").unwrap_or_else(|| "t".into());
    let max = Duration::from_secs(
        arg(&args, "--max-secs")
            .and_then(|s| s.parse().ok())
            .unwrap_or(120),
    );
    let leave_after = arg(&args, "--leave-after-secs")
        .and_then(|s| s.parse::<u64>().ok())
        .map(Duration::from_secs);

    let (ws, _) = match tokio_tungstenite::connect_async(&url).await {
        Ok(x) => x,
        Err(e) => {
            say(serde_json::json!({"ev":"reject","code":"connect","reason":e.to_string()}));
            std::process::exit(3);
        }
    };
    let (mut sink, mut stream) = ws.split();
    let hello = ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        build: "fleet-client".into(),
        profile: callsign,
        ticket: ticket.into_bytes(),
        faction: None,
        resume: None,
    };
    sink.send(Message::Binary(hello.encode().into()))
        .await
        .expect("send hello");

    let started = Instant::now();
    let mut track = SnapshotTracker::new();
    let mut got_result = false;
    let mut nonce = 0u32;
    let mut ping = tokio::time::interval(Duration::from_secs(1));
    loop {
        if started.elapsed() >= max {
            say(serde_json::json!({"ev":"timeout"}));
            std::process::exit(5);
        }
        if leave_after.is_some_and(|d| started.elapsed() >= d) {
            let _ = sink
                .send(Message::Binary(ClientMsg::Leave.encode().into()))
                .await;
            say(serde_json::json!({"ev":"left"}));
            std::process::exit(0);
        }
        tokio::select! {
            _ = ping.tick() => {
                nonce += 1;
                let p = ClientMsg::Ping { nonce, client_ms: 0.0 };
                if sink.send(Message::Binary(p.encode().into())).await.is_err() {
                    break;
                }
            }
            next = stream.next() => {
                let Some(Ok(msg)) = next else { break };
                let Message::Binary(b) = msg else { continue };
                match track.decode(&b) {
                    Ok(ServerMsg::Welcome { .. }) => say(serde_json::json!({"ev":"welcome"})),
                    Ok(ServerMsg::Reject { code, reason }) => {
                        say(serde_json::json!({"ev":"reject","code":format!("{code:?}"),"reason":reason}));
                        std::process::exit(3);
                    }
                    Ok(ServerMsg::Events { events, .. }) => {
                        for e in events {
                            if let WireEvent::Result(r) = e {
                                got_result = true;
                                say(serde_json::json!({"ev":"result","outcome":r.outcome,"place":r.place,"players":r.players}));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    say(serde_json::json!({"ev":"closed"}));
    std::process::exit(if got_result { 0 } else { 4 });
}
