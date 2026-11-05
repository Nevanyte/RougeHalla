//! Live/headless equivalence for the implemented slice (docs/CONTRACTS.md C-DET-4, C-POLICY-2).
//!
//! A real match is played through the live server (sockets, wall-clock pacing, arrival-order inputs, a reconnect, fill
//! bots) with recording on. Then, with no waiting:
//!  1. the recorded replay is re-run headless and must reproduce the live state hash after EVERY step;
//!  2. the match is re-run headless with the bots' commands NOT replayed: the same bot policies, rebuilt from their recorded
//!     seeds and cadences, decide again from their observations, and every step's hash must still match. So a policy
//!     behaves identically attached to the live server or to the headless runner.

use futures_util::{SinkExt, StreamExt};
use rh_policy::{drive_seats, scripted, MatchStart, Seat};
use rh_protocol::{ClientMsg, ServerMsg, WireCommand, WireEvent, PROTOCOL_VERSION};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use rh_sim::map::tile_to_world_center;
use rh_sim::replay::{apply_input, run_replay, start_sim, ReplayInput};
use rh_sim::{Arena, Event, SimConfig, TileMap, Vec2};
use std::future::IntoFuture;
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

fn small_arena() -> Arena {
    let rows: Vec<String> = (0..12)
        .map(|y| {
            (0..16)
                .map(|x| {
                    if x == 0 || y == 0 || x == 15 || y == 11 || (x == 8 && (3..=5).contains(&y)) {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    let map = TileMap::from_rows(&rows).unwrap();
    let t = |x, y| Vec2::new(tile_to_world_center(x), tile_to_world_center(y));
    Arena {
        map,
        spawns: vec![t(3, 3), t(12, 3), t(3, 8), t(12, 8)],
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_live_match_replays_and_its_bots_decide_identically_headless() {
    let sim = SimConfig {
        min_players: 1,
        lobby_seconds: 30.0,
        fill_seconds: 0.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
    };
    let cfg = DirectorConfig {
        tick: Duration::from_millis(3),
        linger: Duration::from_millis(100),
        reconnect_grace: Duration::from_secs(5),
        fill_bots_to: 4,
        record: true,
        ..DirectorConfig::new(sim, small_arena())
    };
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        lifecycle.clone(),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/ws", listener.local_addr().unwrap());
    tokio::spawn(axum::serve(listener, rh_server::public_router(director.clone())).into_future());
    lifecycle.ready();

    let hello = |resume: Option<[u8; 16]>| ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        build: String::new(),
        profile: "oscar".into(),
        ticket: b"t".to_vec(),
        faction: Some(2),
        resume,
    };
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    ws.send(Message::Binary(hello(None).encode().into()))
        .await
        .unwrap();
    let mut session = [0u8; 16];
    let mut track = rh_protocol::SnapshotTracker::new();
    let mut seq = 0u32;
    let mut snaps = 0;
    let mut dropped_once = false;
    let result: Option<rh_protocol::WireResult>;
    loop {
        let msg = match tokio::time::timeout(Duration::from_secs(10), ws.next()).await {
            Ok(Some(Ok(Message::Binary(b)))) => track.decode(&b).unwrap(),
            Ok(Some(Ok(_))) => continue,
            other => panic!("socket ended early: {other:?}"),
        };
        match msg {
            ServerMsg::Welcome { session: s, .. } => session = s,
            ServerMsg::Snapshot {
                me: Some(me),
                phase: 1,
                ..
            } => {
                snaps += 1;
                // A human playing badly but actively: wander and swing, at a client's cadence.
                if snaps % 7 == 0 {
                    seq += 1;
                    let cmds = vec![
                        WireCommand::Move {
                            x: me.x + if snaps % 14 == 0 { 90.0 } else { -90.0 },
                            y: me.y + 40.0,
                            seq: Some(seq as u8),
                        },
                        WireCommand::Attack {
                            a: (snaps as f32) * 0.3,
                            t: None,
                        },
                    ];
                    ws.send(Message::Binary(
                        ClientMsg::Input {
                            seq,
                            commands: cmds,
                        }
                        .encode()
                        .into(),
                    ))
                    .await
                    .unwrap();
                }
                if snaps == 40 && !dropped_once {
                    // Drop and resume mid-run: the replay must carry the drop marks too.
                    dropped_once = true;
                    drop(ws);
                    tokio::time::sleep(Duration::from_millis(30)).await;
                    ws = tokio_tungstenite::connect_async(&url).await.unwrap().0;
                    ws.send(Message::Binary(hello(Some(session)).encode().into()))
                        .await
                        .unwrap();
                }
            }
            ServerMsg::Events { events, .. } => {
                if let Some(r) = events.into_iter().find_map(|e| {
                    if let WireEvent::Result(r) = e {
                        Some(r)
                    } else {
                        None
                    }
                }) {
                    result = Some(r);
                    break;
                }
            }
            _ => {}
        }
    }
    assert!(result.is_some() && dropped_once);
    // The room closes after its linger (the match continues among bots only until the room notices no human is left).
    let mut replays = Vec::new();
    for _ in 0..100 {
        replays = director.take_replays();
        if !replays.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let replay = replays.pop().expect("the closed room's replay");
    assert!(
        replay.hashes.len() > 50,
        "the run was recorded ({} steps)",
        replay.hashes.len()
    );

    // 1. The recorded inputs reproduce every live step.
    run_replay(&replay).expect("the live match replays headless, step for step");

    // 2. The bots decide again, headless, from their recorded seeds: same states.
    let mut sim = start_sim(&replay);
    let mut seats: Vec<Seat> = Vec::new();
    let mut bot_ids = Vec::new();
    let mut next = 0;
    let mut last: Vec<Event> = Vec::new();
    for (step, expected) in replay.hashes.iter().enumerate() {
        let target = sim.tick() + 1;
        if let Some(t) = replay.ticks.get(next) {
            if t.tick == target {
                for input in &t.inputs {
                    match input {
                        ReplayInput::Join {
                            bot: true,
                            policy: Some(p),
                            ..
                        } => {
                            apply_input(&mut sim, input);
                            let id = sim.players().last().unwrap().id;
                            bot_ids.push(id);
                            seats.push(Seat::new(
                                &MatchStart::of(&sim, id, p.seed),
                                Box::new(scripted::Brawler::new(p.interval)),
                                Box::new(scripted::Idle),
                            ));
                        }
                        ReplayInput::Command { player, .. } if bot_ids.contains(player) => {} // the bots decide again below
                        other => apply_input(&mut sim, other),
                    }
                }
                next += 1;
            }
        }
        drive_seats(&mut sim, &mut seats, &last);
        last = sim.step();
        assert_eq!(
            sim.state_hash(),
            *expected,
            "headless bots diverged from the live ones at step {step}"
        );
    }
    assert!(!bot_ids.is_empty());
}
