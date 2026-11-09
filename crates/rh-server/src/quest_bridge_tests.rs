use super::tests::{cfg, drain, source_arena};
use super::*;

#[test]
fn quest_bridge_wire_bounds_cover_the_native_domain() {
    use rh_protocol::state::{
        MAX_QUEST_OBJECTIVES, MAX_QUEST_OBJECTIVES_PER_ROW, MAX_QUEST_ROSTER, MAX_QUEST_ROWS,
    };
    assert_eq!(MAX_QUEST_ROWS, rh_sim::constants::QUEST_COUNT as usize);
    assert_eq!(MAX_QUEST_ROSTER, rh_sim::constants::MAX_PLAYERS);
    let catalog = rh_sim::quests::catalog::DEFINITION;
    assert_eq!(catalog.iter().map(|row| row.id.len()).max(), Some(16));
    assert_eq!(
        catalog.iter().map(|row| row.token_spawns as usize).max(),
        Some(MAX_QUEST_OBJECTIVES_PER_ROW)
    );
    assert_eq!(
        MAX_QUEST_OBJECTIVES,
        MAX_QUEST_ROWS * MAX_QUEST_OBJECTIVES_PER_ROW
    );
    assert_eq!(rh_sim::FactionId::ALL.len(), 5);
}

fn quest_bridge_sim(at: Option<rh_sim::Vec2>) -> Sim {
    let arena = source_arena();
    let origin = at.unwrap_or(arena.spawns[0]);
    let peer_at = arena.spawns[1];
    Sim::reset_active(
        SimConfig {
            quests: true,
            pvp_rules: false,
            ..cfg(Duration::from_millis(50)).sim
        },
        arena,
        Secrets::from_seed(7),
        &[
            rh_sim::Placement {
                profile: "quest-owner".into(),
                faction: FactionId::Holy,
                bot: false,
                at: origin,
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            rh_sim::Placement {
                profile: "quest-peer".into(),
                faction: FactionId::Fire,
                bot: false,
                at: peer_at,
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    )
}

fn quest_bridge_runtime(sim: &Sim) -> rh_sim::quests::live::Quests {
    // Test-only inspection of native genesis, never a public projection or state mutation.
    let checkpoint = serde_json::to_value(sim).unwrap();
    serde_json::from_value(checkpoint["world"]["quests"].clone()).unwrap()
}

fn quest_bridge_view(out: &Outbox) -> rh_protocol::WireQuestView {
    drain(out)
        .into_iter()
        .find_map(|message| match message {
            ServerMsg::State { items, .. } => items.into_iter().find_map(|item| match item {
                rh_protocol::StateItem::Quests(view) => view,
                _ => None,
            }),
            _ => None,
        })
        .expect("reliable native quest replacement")
}

fn quest_bridge_accept(handle: rh_protocol::QuestHandle) -> rh_protocol::WireCommand {
    quest_bridge_decode(rh_protocol::WireCommand::QuestAccept { handle })
}

fn quest_bridge_decode(command: rh_protocol::WireCommand) -> rh_protocol::WireCommand {
    let message = rh_protocol::ClientMsg::Input {
        seq: 1,
        commands: vec![command],
    };
    let bytes = message.try_encode().unwrap();
    let rh_protocol::ClientMsg::Input { mut commands, .. } =
        rh_protocol::ClientMsg::decode(&bytes).unwrap()
    else {
        panic!("input")
    };
    commands.remove(0)
}

#[test]
fn quest_bridge_native_token_and_parcel_keep_the_existing_pickup_door() {
    use rh_sim::quests::catalog::{Kind, DEFINITION};
    for kind in [Kind::Collect, Kind::Fetch] {
        let runtime = quest_bridge_runtime(&quest_bridge_sim(None));
        let offer = runtime
            .offers
            .iter()
            .find(|offer| {
                offer.status == rh_sim::quests::live::Status::Open
                    && DEFINITION[offer.def as usize].kind == kind
            })
            .expect("source quest kind");
        let def = DEFINITION[offer.def as usize].id;
        let mut sim = quest_bridge_sim(Some(offer.at));
        let mut observer = rh_sim::ItemObserver::new(PlayerId(1));
        let mut obs = rh_sim::Observation::default();
        observer.observe_into(&sim, &[], &mut obs, None).unwrap();
        if !offer.published {
            let reveal_ticks =
                (rh_sim::constants::QUEST_REVEAL_HEAD_START_MS / TICK_MS).ceil() as usize + 2;
            for _ in 0..reveal_ticks {
                sim.step();
            }
            observer.observe_into(&sim, &[], &mut obs, None).unwrap();
        }
        let handle = obs
            .quests
            .as_ref()
            .unwrap()
            .rows
            .iter()
            .find(|row| row.def == def)
            .unwrap()
            .handle;
        let command = observer
            .resolve(
                &sim,
                wire::command(quest_bridge_accept(
                    rh_protocol::QuestHandle::new(handle.get()).unwrap(),
                )),
            )
            .unwrap();
        sim.submit(PlayerId(1), command).unwrap();
        sim.step();
        observer.observe_into(&sim, &[], &mut obs, None).unwrap();
        let objective = obs
            .quests
            .as_ref()
            .unwrap()
            .objectives
            .iter()
            .find(|o| o.quest == handle)
            .unwrap()
            .at;
        let command = observer
            .resolve(
                &sim,
                wire::command(quest_bridge_decode(rh_protocol::WireCommand::Move {
                    x: objective.x as f32,
                    y: objective.y as f32,
                    seq: Some(1),
                })),
            )
            .unwrap();
        sim.submit(PlayerId(1), command).unwrap();
        let mut eligible = None;
        for i in 0..4000 {
            sim.step();
            if i % 10 != 0 {
                continue;
            }
            observer.observe_into(&sim, &[], &mut obs, None).unwrap();
            eligible = obs.props.iter().find(|prop| matches!(prop.cue.kind,
                rh_sim::PropKind::QuestItem { quest, fetch } if quest == handle && fetch == (kind == Kind::Fetch))).cloned();
            if eligible.is_some() {
                break;
            }
        }
        let eligible = eligible.expect("ordinary movement reaches an entitled native quest pickup");
        let mut publisher = crate::wire_state::CollectionPublisher::default();
        let pending = publisher.prepare(&obs, true, false, false).unwrap();
        let ServerMsg::State { items, .. } =
            ServerMsg::decode(pending.frame.as_ref().unwrap()).unwrap()
        else {
            panic!()
        };
        let wire_prop = items
            .iter()
            .find_map(|item| match item {
                rh_protocol::StateItem::Props(props) => props
                    .rows
                    .iter()
                    .find(|p| p.handle.get() == eligible.handle.get()),
                _ => None,
            })
            .unwrap();
        assert_eq!(
            wire_prop.kind,
            rh_protocol::WirePropKind::QuestItem {
                quest: rh_protocol::QuestHandle::new(handle.get()).unwrap(),
                fetch: kind == Kind::Fetch,
            }
        );
        pending.commit(&mut publisher);
        let pickup = quest_bridge_decode(rh_protocol::WireCommand::Pickup {
            handle: rh_protocol::PickupHandle::new(wire_prop.handle.get()).unwrap(),
        });
        let command = observer.resolve(&sim, wire::command(pickup)).unwrap();
        sim.submit(PlayerId(1), command).unwrap();
        sim.step();
        observer.observe_into(&sim, &[], &mut obs, None).unwrap();
        let view = obs.quests.as_ref().unwrap();
        let row = view.rows.iter().find(|row| row.handle == handle).unwrap();
        if kind == Kind::Fetch {
            assert_eq!(row.carrier, view.owner_roster);
            assert!(row.carrier.is_some());
        } else {
            assert!(row.owner_progress >= 1);
        }
    }
}

#[tokio::test(start_paused = true)]
async fn quest_bridge_room_failed_enqueue_accept_resync_and_resume() {
    let genesis = quest_bridge_sim(None);
    let runtime = quest_bridge_runtime(&genesis);
    let offer = runtime
        .offers
        .iter()
        .find(|o| {
            o.published
                && o.status == rh_sim::quests::live::Status::Open
                && rh_sim::quests::catalog::DEFINITION[o.def as usize].kind
                    != rh_sim::quests::catalog::Kind::Kill
        })
        .unwrap();
    let def = rh_sim::quests::catalog::DEFINITION[offer.def as usize].id;
    let sim = quest_bridge_sim(Some(offer.at));
    let tick = Duration::from_millis(50);
    let assets = MapAssets::new(source_arena()).unwrap();
    let mut config = cfg(tick);
    config.arena = assets.arena;
    config.welcome_map = assets.welcome_map;
    assert!(
        !config.sim.quests,
        "ordinary Room admission remains quest-gated"
    );
    let (reports, _) = mpsc::unbounded_channel();
    let start = Instant::now();
    let mut room = Room::new([9; 16], config, reports, start);
    let refused = Arc::new(Outbox::default());
    let joined = room
        .join("quest-owner".into(), None, refused.clone(), 1, 1, None)
        .unwrap();
    // Explicit component fixture: the hosted profile gate is tested separately and never bypassed in production.
    room.sim = sim;
    room.humans[0].fx.rebind(&room.sim, PlayerId(1));
    room.humans[0].items = rh_sim::ItemObserver::new(PlayerId(1));
    let mut candidate_observer = rh_sim::ItemObserver::new(PlayerId(1));
    let mut observation = rh_sim::Observation::default();
    drop(
        candidate_observer
            .prepare_into(&room.sim, &[], &mut observation, None)
            .unwrap(),
    );
    let candidate = observation
        .quests
        .as_ref()
        .unwrap()
        .rows
        .iter()
        .find(|r| r.def == def)
        .unwrap()
        .handle;
    let missing = rh_sim::validate(rh_sim::RawCommand::QuestAccept { quest_id: None }).unwrap();
    let proposal = rh_sim::PublicCommand::QuestAccept { handle: candidate };
    for _ in 0..crate::outbox::IMPORTANT_CAP {
        refused.important(vec![0x99]);
    }
    let before = refused.pending();
    room.publish(&[]);
    assert_eq!(
        refused.pending(),
        before,
        "failed batch enqueues no quest state"
    );
    assert_eq!(
        room.humans[0].items.resolve(&room.sim, proposal).unwrap(),
        missing,
        "failed enqueue grants no quest acceptance capability"
    );
    let mut fresh = Arc::new(Outbox::default());
    room.humans[0].outbox = Some(fresh.clone());
    room.publish(&[]);
    let delivered = quest_bridge_view(&fresh);
    let row = delivered.rows.iter().find(|r| r.def == def).unwrap();
    assert_eq!(
        row.handle.get(),
        candidate.get(),
        "failed enqueue did not advance issuance"
    );
    assert!(row.can_accept);
    room.handle(
        RoomCmd::Input {
            player: PlayerId(1),
            conn: 1,
            seq: 1,
            commands: vec![quest_bridge_accept(row.handle)],
        },
        start,
    );
    room.sim.step();
    room.publish(&[]);
    let accepted = quest_bridge_view(&fresh);
    let accepted_row = accepted.rows.iter().find(|r| r.def == def).unwrap();
    assert!(
        accepted_row.owner_accepted,
        "decoded current accept follows Room resolve, validate and submit"
    );
    assert!(!accepted_row.owner_completed);
    assert!(accepted.owner_roster.is_some());
    assert!(quest_bridge_runtime(&room.sim)
        .offers
        .iter()
        .find(|o| o.id == offer.id)
        .unwrap()
        .accepted
        .contains(&PlayerId(1)));
    {
        let mut replacement = room.humans[0].items.renewed();
        let mut malformed = rh_sim::Observation::default();
        let offer = replacement
            .prepare_into(&room.sim, &[], &mut malformed, None)
            .unwrap();
        malformed.quests.as_mut().unwrap().rows[0].giver.x = f64::NAN;
        assert!(room.humans[0]
            .collections
            .prepare(&malformed, true, true, true)
            .is_err());
        drop(offer);
        assert_ne!(
            room.humans[0].items.resolve(&room.sim, proposal).unwrap(),
            missing,
            "failed replacement encoding preserves old capabilities"
        );
    }
    for _ in 0..crate::outbox::IMPORTANT_CAP {
        fresh.important(vec![0x99]);
    }
    fresh.request_resync();
    room.publish(&[]);
    assert_ne!(
        room.humans[0].items.resolve(&room.sim, proposal).unwrap(),
        missing,
        "failed resync preserves the previously published epoch"
    );
    let mut rejected = Vec::new();
    assert_eq!(
        fresh.drain_into(&mut rejected).close,
        Some(RejectCode::TooSlow)
    );
    assert!(rejected.iter().all(|frame| frame == &[0x99]));
    room.publish(&[]); // Closed outbound path refuses enqueue independently of the capacity attempt.
    assert_ne!(
        room.humans[0].items.resolve(&room.sim, proposal).unwrap(),
        missing,
        "closed outbox refuses replacement without revoking old capabilities"
    );
    fresh = Arc::new(Outbox::default());
    room.humans[0].outbox = Some(fresh.clone());
    fresh.request_resync();
    room.publish(&[]);
    let resynced = quest_bridge_view(&fresh);
    let renewed = resynced.rows.iter().find(|r| r.def == def).unwrap().handle;
    assert_ne!(renewed, row.handle, "resync replaces capabilities");
    assert_eq!(
        room.humans[0].items.resolve(&room.sim, proposal).unwrap(),
        missing
    );
    assert!(!fresh.state_resync_requested());
    let resumed_out = Arc::new(Outbox::default());
    let (reply, response) = oneshot::channel();
    room.handle(
        RoomCmd::Resume {
            session: joined.session,
            outbox: resumed_out.clone(),
            conn: 2,
            reply,
        },
        start,
    );
    response.await.unwrap().unwrap();
    room.publish(&[]);
    let resumed = quest_bridge_view(&resumed_out);
    let last = resumed.rows.iter().find(|r| r.def == def).unwrap().handle;
    assert_ne!(
        last, renewed,
        "reconnect issues a replacement namespace generation"
    );
    assert_eq!(
        room.humans[0]
            .items
            .resolve(&room.sim, wire::command(quest_bridge_accept(renewed)))
            .unwrap(),
        missing
    );
    assert!(
        resumed
            .rows
            .iter()
            .find(|r| r.def == def)
            .unwrap()
            .owner_accepted
    );
}

#[test]
fn quest_bridge_preview_hidden_and_closed_refs_never_accept() {
    let genesis = quest_bridge_sim(None);
    let runtime = quest_bridge_runtime(&genesis);
    let hidden = runtime
        .offers
        .iter()
        .find(|o| {
            !o.published
                && rh_sim::quests::catalog::DEFINITION[o.def as usize].kind
                    != rh_sim::quests::catalog::Kind::Kill
        })
        .unwrap();
    let def = rh_sim::quests::catalog::DEFINITION[hidden.def as usize].id;
    let mut sim = quest_bridge_sim(Some(hidden.at));
    let mut observer = rh_sim::ItemObserver::new(PlayerId(1));
    let mut obs = rh_sim::Observation::default();
    observer.observe_into(&sim, &[], &mut obs, None).unwrap();
    assert!(!obs
        .quests
        .as_ref()
        .unwrap()
        .rows
        .iter()
        .any(|r| r.def == def));
    let missing = rh_sim::validate(rh_sim::RawCommand::QuestAccept { quest_id: None }).unwrap();
    assert_eq!(
        observer
            .resolve(
                &sim,
                wire::command(quest_bridge_accept(
                    rh_protocol::QuestHandle::new(u32::MAX).unwrap()
                ))
            )
            .unwrap(),
        missing
    );
    sim.step(); // Native discovery creates the viewer's delayed finder preview.
    observer.observe_into(&sim, &[], &mut obs, None).unwrap();
    let preview = obs
        .quests
        .as_ref()
        .unwrap()
        .rows
        .iter()
        .find(|r| r.def == def)
        .unwrap();
    assert_eq!(preview.state, rh_sim::quest_view::RowState::Preview);
    assert!(!preview.can_accept);
    let handle = preview.handle;
    let proposal = wire::command(quest_bridge_accept(
        rh_protocol::QuestHandle::new(handle.get()).unwrap(),
    ));
    assert_eq!(observer.resolve(&sim, proposal).unwrap(), missing);
    let reveal_ticks =
        (rh_sim::constants::QUEST_REVEAL_HEAD_START_MS / TICK_MS).ceil() as usize + 1;
    for _ in 0..reveal_ticks {
        sim.step();
    }
    observer.observe_into(&sim, &[], &mut obs, None).unwrap();
    let current = obs
        .quests
        .as_ref()
        .unwrap()
        .rows
        .iter()
        .find(|r| r.def == def)
        .unwrap();
    assert_eq!(current.state, rh_sim::quest_view::RowState::Open);
    let accepted = observer.resolve(&sim, proposal).unwrap();
    assert_ne!(accepted, missing);
    sim.submit(PlayerId(1), accepted).unwrap();
    sim.step();
    let deadline = quest_bridge_runtime(&sim)
        .offers
        .iter()
        .find(|o| o.id == hidden.id)
        .unwrap()
        .expires_at;
    assert!(deadline > 0.);
    while sim.server_time() <= deadline {
        sim.step();
    }
    assert_eq!(
        observer.resolve(&sim, proposal).unwrap(),
        missing,
        "closed native offer refuses even before replacement"
    );
    observer.observe_into(&sim, &[], &mut obs, None).unwrap();
    let closed = obs
        .quests
        .as_ref()
        .unwrap()
        .rows
        .iter()
        .find(|r| r.def == def)
        .unwrap();
    assert_eq!(closed.state, rh_sim::quest_view::RowState::Expired);
    assert!(!closed.can_accept);
}
