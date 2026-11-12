//! Private component admission: real native trades through decoded inputs and Room publication.
//! This does not enable a hosted quest/trade profile or stand in for browser/UI acceptance.
use super::tests::{cfg, drain, source_arena};
use super::*;
use rh_protocol::{ClientMsg, StateItem, WireCommand, WireTradeKind, WireTradeView};
use rh_sim::{traders::Kind, Placement, Vec2, WeaponId};

fn scene(places: Option<[Vec2; 2]>) -> Sim {
    let arena = source_arena();
    let places = places.unwrap_or([arena.spawns[0], arena.spawns[1]]);
    let placements = places
        .into_iter()
        .enumerate()
        .map(|(i, at)| Placement {
            profile: format!("trader{i}"),
            faction: FactionId::Holy,
            bot: false,
            at,
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        })
        .collect::<Vec<_>>();
    Sim::reset_active(
        SimConfig {
            quests: true,
            consumables: true,
            pvp_rules: false,
            regen: false,
            ..Default::default()
        },
        arena,
        Secrets {
            order_salt: 7,
            spawn_seed: 0,
            reward_salt: [1, 2, 3, 4],
        },
        &placements,
    )
}

fn merchant_places() -> [Vec2; 2] {
    // Test navigation reads the actual deterministic producer positions, then uses ordinary
    // typed initial placements in a fresh world. No quotes, cooldowns or outcomes are installed.
    let probe = serde_json::to_value(scene(None)).unwrap();
    let rows = probe["world"]["traders"]["traders"].as_array().unwrap();
    let at = |kind| {
        let row = rows
            .iter()
            .find(|row| row["kind"] == serde_json::to_value(kind).unwrap())
            .unwrap();
        serde_json::from_value(row["at"].clone()).unwrap()
    };
    [at(Kind::Stats), at(Kind::Barter)]
}

fn room() -> (Room, [Arc<Outbox>; 2], [u8; 16]) {
    let start = Instant::now();
    let mut config = cfg(Duration::from_millis(50));
    let assets = MapAssets::new(source_arena()).unwrap();
    config.arena = assets.arena;
    config.welcome_map = assets.welcome_map;
    let (reports, _) = mpsc::unbounded_channel();
    // Room admission remains the ordinary supported profile. Only this private test replaces
    // its simulation with the native quest/trade component genesis after seat creation.
    let mut room = Room::new([38; 16], config, reports, start);
    let boxes = [Arc::new(Outbox::default()), Arc::new(Outbox::default())];
    let mut session = [0; 16];
    for (i, out) in boxes.iter().enumerate() {
        let joined = room
            .join(
                format!("trader{i}"),
                Some(FactionId::Holy),
                out.clone(),
                i as u64 + 1,
                1,
                None,
            )
            .unwrap();
        if i == 0 {
            session = joined.session;
        }
        drain(out);
    }
    room.sim = scene(Some(merchant_places()));
    for seat in &mut room.humans {
        seat.items = rh_sim::ItemObserver::new(seat.player);
        seat.fx.rebind(&room.sim, seat.player);
    }
    (room, boxes, session)
}

fn trade(messages: &[ServerMsg]) -> WireTradeView {
    messages
        .iter()
        .find_map(|message| match message {
            ServerMsg::State { items, .. } => items.iter().find_map(|item| match item {
                StateItem::Trade(Some(value)) => Some(value.clone()),
                _ => None,
            }),
            _ => None,
        })
        .expect("an available native Trade replacement")
}

fn input(room: &mut Room, player: u32, conn: u64, seq: u32, kind: WireTradeKind, pick: u8) {
    let bytes = ClientMsg::Input {
        seq,
        commands: vec![WireCommand::Trade { kind, pick }],
    }
    .encode();
    let ClientMsg::Input { seq, commands } = ClientMsg::decode(&bytes).unwrap() else {
        panic!("not input")
    };
    room.handle(
        RoomCmd::Input {
            received: std::time::Instant::now(),
            player: PlayerId(player),
            conn,
            seq,
            commands,
        },
        Instant::now(),
    );
}

fn toast(messages: &[ServerMsg], text: &str) -> bool {
    messages.iter().any(|message| {
        matches!(message,
        ServerMsg::Events { events, .. } if events.iter().any(|event| matches!(event,
            rh_protocol::WireEvent::Toast { text: value } if value == text)))
    })
}

fn step(room: &mut Room) -> Vec<rh_sim::Event> {
    let events = room.sim.step();
    // Same per-step temporal projector used by Room::wake. publish's `all` argument carries
    // results; it deliberately does not observe ordinary events a second time.
    for seat in &mut room.humans {
        let status = seat.fx.feed(room.sim.fx_report()).unwrap();
        if status != rh_sim::FeedStatus::Duplicate {
            seat.fx
                .append_into(&room.sim, seat.player, &mut seat.carry)
                .unwrap();
        }
    }
    events
}

#[test]
fn native_trade_input_and_owner_state_keep_first_contact_privacy_and_source_order() {
    let (mut room, boxes, _) = room();
    room.publish(&[]);
    let first = trade(&drain(&boxes[0]));
    let stranger = trade(&drain(&boxes[1]));
    assert!(first.offers.is_empty() && stranger.offers.is_empty());
    assert!(first
        .merchants
        .iter()
        .any(|row| row.kind == WireTradeKind::Stats));
    assert!(stranger
        .merchants
        .iter()
        .any(|row| row.kind == WireTradeKind::Barter));

    input(&mut room, 1, 1, 1, WireTradeKind::Stats, 0);
    let events = step(&mut room);
    room.publish(&events);
    let first_contact = drain(&boxes[0]);
    assert!(toast(&first_contact, "Wait for the trader's offers"));
    let quotes = trade(&first_contact);
    assert_eq!(quotes.offers.len(), 3);
    assert!(!quotes.trade_used && quotes.stats.is_empty());
    let peer_frames = drain(&boxes[1]);
    let peer_after_contact = peer_frames
        .iter()
        .find_map(|message| match message {
            ServerMsg::State { items, .. } => items.iter().find_map(|item| match item {
                StateItem::Trade(value) => Some(value.clone()),
                _ => None,
            }),
            _ => None,
        })
        .map(|value| value.expect("eligible peer Trade facts remain available"))
        .unwrap_or(stranger);
    assert!(
        peer_after_contact.offers.is_empty() && peer_after_contact.stats.is_empty(),
        "an omitted unchanged replacement retains the peer's empty private facts"
    );

    input(&mut room, 1, 1, 2, WireTradeKind::Stats, 0);
    input(&mut room, 2, 2, 1, WireTradeKind::Barter, 0);
    let events = step(&mut room);
    room.publish(&events);
    let own = trade(&drain(&boxes[0]));
    let peer = trade(&drain(&boxes[1]));
    assert!(own.trade_used && !own.stats.is_empty());
    assert_eq!(own.offers, quotes.offers, "saved quotes are not repriced");
    assert!(!peer.trade_used && peer.stats.is_empty() && peer.offers.is_empty());
    assert!(own.barter_ready_at.is_none());
    assert_eq!(peer.barter_ready_at, Some(room.sim.server_time() + 5000.));
    assert_eq!(
        room.sim.player(PlayerId(2)).unwrap().weapon.weapon0,
        Some(WeaponId::Bow)
    );
    assert_eq!(
        peer.barter_labels,
        rh_sim::traders::barter_labels(Some(WeaponId::Bow)),
        "same prepared inventory after the real swap"
    );

    input(&mut room, 1, 1, 3, WireTradeKind::Stats, 1);
    input(&mut room, 2, 2, 2, WireTradeKind::Barter, 1);
    let events = step(&mut room);
    room.publish(&events);
    assert!(toast(
        &drain(&boxes[0]),
        "You already made your stat trade this run"
    ));
    assert!(toast(
        &drain(&boxes[1]),
        "The villager is packing your last trade"
    ));
    assert_eq!(room.snapshot_refusals, 0);
    assert_eq!(room.frame_refusals, 0);
}

#[tokio::test(start_paused = true)]
async fn trade_failed_encode_capacity_closed_resync_and_resume_preserve_delivery_baselines() {
    for failure in 0..3 {
        let (mut room, boxes, session) = room();
        room.publish(&[]);
        drain(&boxes[0]);
        drain(&boxes[1]);
        let events = step(&mut room);
        room.publish(&events);
        let quotes = trade(&drain(&boxes[0]));
        drain(&boxes[1]);
        assert_eq!(quotes.offers.len(), 3);
        input(&mut room, 1, 1, 1, WireTradeKind::Stats, 0);
        let events = step(&mut room);
        assert!(
            room.sim.player(PlayerId(1)).unwrap().trade_used,
            "delivery failure never rolls back an accepted game action"
        );
        boxes[0].request_resync();
        if failure == 0 {
            // Encoder-fault diagnostic only; no native reward/action state is installed.
            room.humans[0].carry.push(rh_sim::SeenEvent::Toast {
                text: "x".repeat(256),
            });
        } else if failure == 1 {
            for _ in 0..crate::outbox::IMPORTANT_CAP {
                boxes[0].important(vec![0x99]);
            }
        } else {
            boxes[0].close(RejectCode::TooSlow);
        }
        let counted = boxes[0].counters();
        let queued = boxes[0].pending();
        room.publish(&events);
        assert_eq!(boxes[0].pending(), queued);
        assert_eq!(boxes[0].counters(), counted);
        assert!(
            boxes[0].state_resync_requested(),
            "failed full replacement does not answer resync"
        );

        let retry = Arc::new(Outbox::default());
        retry.request_resync();
        // Replace only the closed diagnostic sink to retry the same live observer/baselines.
        // The actual Room Resume path, with new connection fencing, is exercised below.
        room.humans[0].outbox = Some(retry.clone());
        room.publish(&[]);
        assert!(!retry.state_resync_requested());
        let accepted = drain(&retry);
        let own = trade(&accepted);
        assert!(own.trade_used && !own.stats.is_empty());
        assert_eq!(own.offers, quotes.offers);
        assert!(accepted
            .iter()
            .any(|message| matches!(message, ServerMsg::State { items, .. } if items.len() == 13)));
        room.publish(&[]);
        assert!(!drain(&retry).iter().any(|message| matches!(message,
            ServerMsg::State { items, .. } if items.iter().any(|item| matches!(item, StateItem::Trade(_))))));

        let resumed = Arc::new(Outbox::default());
        let (reply, received) = oneshot::channel();
        room.handle(
            RoomCmd::Resume {
                session,
                outbox: resumed.clone(),
                conn: 3,
                reply,
            },
            Instant::now(),
        );
        let joined = received.await.unwrap().unwrap();
        assert!(
            matches!(
                ServerMsg::decode(&joined.welcome).unwrap(),
                ServerMsg::Welcome { .. }
            ),
            "the connection writes the returned Welcome before draining the outbox"
        );
        room.publish(&[]);
        let full = drain(&resumed);
        let after = trade(&full);
        assert_eq!(
            after, own,
            "ordinary Resume restores actual owner facts and saved quotes"
        );
        assert!(full
            .iter()
            .any(|message| matches!(message, ServerMsg::State { items, .. } if items.len() == 13)));
        let ack = room.humans[0].ack_input;
        input(&mut room, 1, 1, 999, WireTradeKind::Barter, 0);
        assert_eq!(
            room.humans[0].ack_input, ack,
            "old connection cannot submit a new Trade intent"
        );
        assert_eq!(room.snapshot_refusals, 0);
        assert_eq!(room.frame_refusals, u64::from(failure == 0));
    }
}
