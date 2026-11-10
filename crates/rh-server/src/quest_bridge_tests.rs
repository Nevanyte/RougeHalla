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
            received: std::time::Instant::now(),
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

// P-QUEST-ROOM-DELIVERY-1: one bounded component proof — a genuinely earned native `shards-frost` completion carried
// through the ordinary Room wake/publication path into two joined seats' real Outboxes and decoded as a client decodes
// them. The active-Sim swap below is an explicitly labelled deterministic component fixture, NOT the hosted
// lobby/startup path. The Source runtime profile already enables quests (`Settings::sim` sets `quests: !training`); the
// shared bridge `cfg` starts quest-disabled only because it is a component fixture. No production profile, wire, rule,
// source corpus or host configuration is changed or claimed by this test.

use rh_protocol::{
    SnapshotTracker, StateItem, WireCommand, WireEvent, WirePropKind, WireProps, WireQuestRow,
    WireQuestView, WireSelf,
};
use rh_sim::quests::catalog::DEFINITION as QUEST_DEFINITION;
use rh_sim::quests::live::Status as QuestStatus;
use rh_sim::{ItemObserver, Placement, Vec2};

/// One joined seat's real Outbox decoded the way a client decodes it: every frame goes through the protocol
/// [`SnapshotTracker`] (Full and delta snapshots alike) and reliable collection keys are kept as the latest complete
/// replacement. Every derived action fact in this proof comes from this delivered surface.
struct QuestRoomSeat {
    out: Arc<Outbox>,
    tracker: SnapshotTracker,
    quests: Option<WireQuestView>,
    props: Option<WireProps>,
    me: Option<WireSelf>,
    ack_input: u32,
    snapshot_tick: Option<u32>,
    /// The Events frames decoded since the last wake (the actual completion window's decoded delivery).
    events: Vec<(u32, Vec<WireEvent>)>,
}

impl QuestRoomSeat {
    fn new(out: Arc<Outbox>) -> Self {
        Self {
            out,
            tracker: SnapshotTracker::new(),
            quests: None,
            props: None,
            me: None,
            ack_input: 0,
            snapshot_tick: None,
            events: Vec::new(),
        }
    }

    /// Drain and decode this wake's real frames. A delta snapshot is applied against the tracker's base exactly as the
    /// browser client applies it; the decoded delivery (never a hand-built event batch) is the proof subject.
    fn drain(&mut self) {
        self.events.clear();
        let mut frames = Vec::new();
        let drained = self.out.drain_into(&mut frames);
        assert_eq!(
            drained.close, None,
            "the component proof seat's delivery path stays open"
        );
        for frame in &frames {
            let message = self
                .tracker
                .decode(frame)
                .expect("the client decodes the real Room publication stream");
            match message {
                ServerMsg::State { items, .. } => {
                    for item in items {
                        match item {
                            StateItem::Quests(view) => self.quests = view,
                            StateItem::Props(props) => self.props = Some(props),
                            _ => {}
                        }
                    }
                }
                ServerMsg::Snapshot {
                    tick,
                    ack_input,
                    me,
                    ..
                } => {
                    self.snapshot_tick = Some(tick);
                    self.ack_input = ack_input;
                    self.me = me;
                }
                ServerMsg::Events { tick, events } => self.events.push((tick, events)),
                _ => {}
            }
        }
    }

    fn row(&self, def: &str) -> Option<&WireQuestRow> {
        self.quests.as_ref()?.rows.iter().find(|row| row.def == def)
    }

    fn self_at(&self) -> Option<(f64, f64)> {
        self.me.map(|me| (f64::from(me.x), f64::from(me.y)))
    }

    fn event_toasts(&self) -> Vec<(u32, String)> {
        self.events
            .iter()
            .flat_map(|(tick, events)| {
                events.iter().filter_map(move |event| match event {
                    WireEvent::Toast { text } => Some((*tick, text.clone())),
                    _ => None,
                })
            })
            .collect()
    }
}

/// A correctly sequenced, typed ordinary Room input from one joined seat. `Room::handle` performs the
/// resolve/validate/submit intake itself; the test never submits to the Sim directly.
fn quest_room_input(
    room: &mut Room,
    player: PlayerId,
    conn: u64,
    seq: u32,
    commands: Vec<WireCommand>,
    at: Instant,
) {
    room.handle(
        RoomCmd::Input {
            received: std::time::Instant::now(),
            player,
            conn,
            seq,
            commands,
        },
        at,
    );
}

/// One ordinary fixed-50 ms Room wake, then drain both real Outboxes. This helper is the only advancement the proof
/// allows: `Room::wake` runs the due Sim steps, feeds each completed `FxTickReport` into the seat's `FxProjector` and
/// appends the viewer-filtered events into the seat carry, then publishes through the Room Publisher into the Outboxes.
fn quest_room_wake(
    room: &mut Room,
    at: &mut Instant,
    tick: Duration,
    owner: &mut QuestRoomSeat,
    foreign: &mut QuestRoomSeat,
) {
    *at += tick;
    assert!(room.wake(*at), "the component proof room stays open");
    assert_eq!(
        room.frame_refusals, 0,
        "the Room encoder refused no scheduled frame"
    );
    assert_eq!(
        room.snapshot_refusals, 0,
        "the Room snapshot encoder refused nothing"
    );
    for human in &room.humans {
        assert_eq!(
            human.fx.tick(),
            room.sim().tick(),
            "the wake fed the seat FxTickReport into its projector through the completed tick"
        );
    }
    owner.drain();
    foreign.drain();
    assert_eq!(
        owner.snapshot_tick,
        Some(room.sim().tick()),
        "the owner's delivered snapshot is stamped at the completed tick"
    );
    assert_eq!(
        foreign.snapshot_tick,
        Some(room.sim().tick()),
        "the foreign seat's delivered snapshot is stamped at the completed tick"
    );
}

/// The frozen legacy Room-method witness rows shown to one source viewer: its own `client` sends plus the one actual
/// public broadcast call (no invented fanout and no recipient property on the wire Toast).
fn quest_room_oracle_toasts(receiver: &serde_json::Value, viewer: &str) -> Vec<String> {
    receiver["rows"]
        .as_array()
        .expect("oracle rows")
        .iter()
        .filter_map(|row| {
            let route = row["route"].as_str().expect("oracle route");
            let shown = route == "broadcast" || (route == "client" && row["recipient"] == viewer);
            shown.then(|| {
                assert_eq!(row["type"], "toast");
                row["payload"]["text"]
                    .as_str()
                    .expect("oracle toast text")
                    .to_string()
            })
        })
        .collect()
}

/// The longest bounded ordinary walk the proof allows per leg; a real producer/reach gap must fail loudly here rather
/// than be papered over. The accepted offer's own 180 s deadline is much tighter than this outer test bound.
const QUEST_ROOM_WALK_TICKS: usize = 2_400;
const QUEST_ROOM_RETURN_TICKS: usize = 1_400;

/// Closed native `RowState` wire codes from `WireQuestRow::state`.
const WIRE_ROW_OPEN: u8 = 1;
const WIRE_ROW_DONE: u8 = 2;
const WIRE_ROW_EXPIRED: u8 = 3;

#[tokio::test(start_paused = true)]
async fn quest_room_earned_shards_completion_delivers_exact_owner_and_foreign_toasts() {
    let tick = Duration::from_millis(50);
    let declared_owner_name = "name0";
    let declared_foreign_name = "name1";

    // 1. Inspect ONLY the newly generated native offer set. The deterministic seed-7 Source-arena genesis is the same
    //    component recipe the existing quest bridge tests use; the selected offer must be the actually produced
    //    published Open `shards-frost` row, never an installed or substituted offer.
    let genesis = quest_bridge_sim(None);
    let genesis_runtime = quest_bridge_runtime(&genesis);
    let genesis_offer = genesis_runtime
        .offers
        .iter()
        .find(|offer| {
            offer.published
                && offer.status == QuestStatus::Open
                && QUEST_DEFINITION[offer.def as usize].id == "shards-frost"
        })
        .expect("the deterministic native genesis produces a published Open shards-frost offer");
    let def = &QUEST_DEFINITION[genesis_offer.def as usize];
    assert_eq!(def.id, "shards-frost");
    assert_eq!(def.kind, rh_sim::quests::catalog::Kind::Collect);
    assert_eq!(def.count, 3);
    assert_eq!(genesis_offer.tokens.len(), def.token_spawns as usize);
    let giver_at = genesis_offer.at;

    // 2. Two actually joined human seats with distinct connections and real Outboxes, plus the deterministic component
    //    bootstrap: one declared initial Placement at the actual generated giver (the only setup geometry) and one
    //    foreign placement. Both per-seat projectors and action observers are rebound to the swapped Sim BEFORE any
    //    handle or action is issued. This is a labelled component fixture, not the hosted lobby/startup path.
    let assets = MapAssets::new(source_arena()).unwrap();
    let mut config = cfg(tick);
    assert!(
        !config.sim.quests,
        "the shared bridge cfg is quest-disabled only as a component fixture; the Source runtime profile enables quests"
    );
    config.arena = assets.arena.clone();
    config.welcome_map = assets.welcome_map.clone();
    let (reports, _reports) = mpsc::unbounded_channel();
    let start = Instant::now();
    let mut room = Room::new([0x51; 16], config, reports, start);
    let owner_out = Arc::new(Outbox::default());
    let foreign_out = Arc::new(Outbox::default());
    let owner_join = room
        .join(
            declared_owner_name.into(),
            Some(FactionId::Holy),
            owner_out.clone(),
            1,
            1,
            None,
        )
        .unwrap();
    let foreign_join = room
        .join(
            declared_foreign_name.into(),
            Some(FactionId::Fire),
            foreign_out.clone(),
            2,
            2,
            None,
        )
        .unwrap();
    assert_eq!(owner_join.player, PlayerId(1));
    assert_eq!(foreign_join.player, PlayerId(2));
    let foreign_at = assets.arena.spawns[1];
    let active = Sim::reset_active(
        SimConfig {
            quests: true,
            pvp_rules: false,
            ..cfg(tick).sim
        },
        assets.arena.clone(),
        Secrets::from_seed(7),
        &[
            Placement {
                profile: declared_owner_name.into(),
                faction: FactionId::Holy,
                bot: false,
                at: giver_at,
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: declared_foreign_name.into(),
                faction: FactionId::Fire,
                bot: false,
                at: foreign_at,
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    );
    assert_eq!(active.phase(), Phase::Active);
    assert!(
        active.config().quests,
        "the labelled deterministic component fixture runs with the Source quest rule enabled"
    );
    room.sim = active;
    for human in &mut room.humans {
        human.fx.rebind(&room.sim, human.player);
        human.items = ItemObserver::new(human.player);
        human.carry.clear();
    }
    let mut owner_seat = QuestRoomSeat::new(owner_out);
    let mut foreign_seat = QuestRoomSeat::new(foreign_out);
    let mut at = start;
    let mut seq = 0u32;
    let mut move_seq = 0u8;

    // 3. First ordinary wake publishes the actual current QuestView/Props. The owner's issued QuestHandle comes from
    //    that decoded delivery; the declared initial placement is the actual generated giver spot.
    quest_room_wake(&mut room, &mut at, tick, &mut owner_seat, &mut foreign_seat);
    let initial = owner_seat
        .row("shards-frost")
        .expect("the actual produced shards-frost row is delivered to the owner");
    let handle = initial.handle;
    assert_eq!(initial.state, WIRE_ROW_OPEN, "the delivered row is Open");
    assert!(
        initial.can_accept,
        "the actual generated offer is acceptable"
    );
    assert_eq!(
        owner_seat.self_at().expect("delivered self view"),
        (giver_at.x, giver_at.y),
        "the single declared bootstrap Placement is at the actual generated giver"
    );
    let runtime = quest_bridge_runtime(&room.sim);
    assert_eq!(
        runtime
            .offers
            .iter()
            .find(|offer| offer.id == genesis_offer.id)
            .expect("the generated offer id survives the component bootstrap")
            .status,
        QuestStatus::Open
    );

    // 4. Accept through the ordinary typed Room input door and wait for the delivered accepted row.
    seq += 1;
    quest_room_input(
        &mut room,
        owner_join.player,
        1,
        seq,
        vec![quest_bridge_accept(handle)],
        at,
    );
    let mut accepted = false;
    for _ in 0..8 {
        quest_room_wake(&mut room, &mut at, tick, &mut owner_seat, &mut foreign_seat);
        if owner_seat
            .row("shards-frost")
            .is_some_and(|row| row.owner_accepted)
        {
            accepted = true;
            break;
        }
    }
    assert!(
        accepted,
        "Room resolve/validate/submit accepted the delivered handle"
    );
    let accept_wake_toasts = owner_seat.event_toasts();
    assert!(
        accept_wake_toasts
            .iter()
            .any(|(_, text)| *text == format!("Quest accepted: {}", def.name)),
        "the real quest accept producer's owner notice was delivered"
    );
    assert!(
        foreign_seat.event_toasts().is_empty(),
        "the foreign seat never receives the owner's accept notice"
    );
    let row = owner_seat
        .row("shards-frost")
        .expect("accepted current row");
    assert_eq!(row.owner_progress, 0);
    assert!(!row.owner_ready);
    eprintln!(
        "quest room proof: accepted shards-frost handle {} at native tick {}",
        handle.get(),
        room.sim().tick()
    );

    // 5. Earn the three objective units through accepted Move/Pickup Room inputs and one ordinary wake per 50 ms slot.
    //    Targets are the currently delivered objective navigation facts; pickup handles are the currently delivered
    //    props; no private pose, hidden container id, progress, reward, event or carry is installed anywhere.
    let mut pickups = 0u32;
    let mut delivered_pickup_handles = Vec::new();
    while pickups < def.count {
        let target = {
            let view = owner_seat
                .quests
                .as_ref()
                .expect("delivered quest view while earning objectives");
            let objectives: Vec<Vec2> = view
                .objectives
                .iter()
                .filter(|objective| objective.quest == handle)
                .map(|objective| Vec2::new(objective.at.x, objective.at.y))
                .collect();
            assert_eq!(
                objectives.len(),
                def.token_spawns as usize - pickups as usize,
                "the accepted owner is delivered exactly the remaining entitled objective cues"
            );
            let (from_x, from_y) = owner_seat.self_at().expect("delivered self position");
            objectives
                .into_iter()
                .min_by(|a, b| {
                    let da = (a.x - from_x) * (a.x - from_x) + (a.y - from_y) * (a.y - from_y);
                    let db = (b.x - from_x) * (b.x - from_x) + (b.y - from_y) * (b.y - from_y);
                    da.total_cmp(&db)
                })
                .expect("an entitled objective cue")
        };
        seq += 1;
        let move_input_seq = seq;
        move_seq = move_seq.wrapping_add(1);
        let expected_move_seq = move_seq;
        quest_room_input(
            &mut room,
            owner_join.player,
            1,
            seq,
            vec![WireCommand::Move {
                x: target.x as f32,
                y: target.y as f32,
                seq: Some(move_seq),
            }],
            at,
        );
        let mut advanced = false;
        for step in 0..QUEST_ROOM_WALK_TICKS {
            quest_room_wake(&mut room, &mut at, tick, &mut owner_seat, &mut foreign_seat);
            if step == 0 {
                assert_eq!(
                    owner_seat.ack_input, move_input_seq,
                    "the joined seat's snapshot acknowledges the accepted Move input"
                );
                assert_eq!(
                    owner_seat.me.expect("delivered self view").move_seq,
                    expected_move_seq,
                    "the ordinary accepted Move was applied by the native fighter"
                );
            }
            let progress = owner_seat
                .row("shards-frost")
                .expect("current delivered row while earning objectives")
                .owner_progress;
            if progress > pickups {
                let expected_notice = format!("{}: {}/{}", def.name, progress, def.count);
                assert!(
                    owner_seat
                        .event_toasts()
                        .iter()
                        .any(|(_, text)| *text == expected_notice),
                    "the native pickup producer delivered its progress notice"
                );
                pickups = progress;
                eprintln!(
                    "quest room proof: pickup {pickups}/{} delivered at native tick {}",
                    def.count,
                    room.sim().tick()
                );
                advanced = true;
                break;
            }
            // When the current delivered props expose the quest pickup cue at the current delivered position, submit the
            // ordinary typed Pickup with that issued handle. Refusals are ordinary native producer answers and retry.
            let cue = owner_seat
                .self_at()
                .zip(owner_seat.props.as_ref())
                .and_then(|((from_x, from_y), props)| {
                    props.rows.iter().find(|prop| {
                        matches!(
                            prop.kind,
                            WirePropKind::QuestItem { quest, fetch: false } if quest == handle
                        ) && {
                            let px = f64::from(rh_protocol::quant::dequantize_pos(prop.x));
                            let py = f64::from(rh_protocol::quant::dequantize_pos(prop.y));
                            (from_x - px) * (from_x - px) + (from_y - py) * (from_y - py)
                                <= 48.0 * 48.0
                        }
                    })
                });
            if let Some(cue) = cue {
                delivered_pickup_handles.push(cue.handle.get());
                seq += 1;
                quest_room_input(
                    &mut room,
                    owner_join.player,
                    1,
                    seq,
                    vec![WireCommand::Pickup { handle: cue.handle }],
                    at,
                );
            }
        }
        assert!(
            advanced,
            "the accepted Move reached the delivered objective and the native pickup producer advanced progress"
        );
    }
    let row = owner_seat
        .row("shards-frost")
        .expect("delivered row after the third pickup");
    assert_eq!(row.owner_progress, def.count);
    assert!(
        row.owner_ready,
        "the delivered view marks the native objective complete"
    );
    assert!(
        owner_seat
            .quests
            .as_ref()
            .expect("delivered quest view")
            .objectives
            .iter()
            .all(|objective| objective.quest != handle),
        "no ground objective cue remains after the earned pickups"
    );
    seq += 1;
    move_seq = move_seq.wrapping_add(1);
    let expected_return_seq = move_seq;
    let giver = row.giver;
    quest_room_input(
        &mut room,
        owner_join.player,
        1,
        seq,
        vec![WireCommand::Move {
            x: giver.x as f32,
            y: giver.y as f32,
            seq: Some(move_seq),
        }],
        at,
    );

    // 6. The ordinary automatic turn-in completes on a normal wake. Bind its tick from the unmodified native
    //    `last_events` producer batch; never from the frozen source tick/provenance row.
    let mut completion_tick = None;
    for step in 0..QUEST_ROOM_RETURN_TICKS {
        quest_room_wake(&mut room, &mut at, tick, &mut owner_seat, &mut foreign_seat);
        if step == 0 {
            assert_eq!(
                owner_seat.me.expect("delivered self view").move_seq,
                expected_return_seq,
                "the ordinary accepted return Move was applied by the native fighter"
            );
        }
        let produced_completion = room.last_events.iter().any(|event| {
            matches!(
                event,
                Event::Gv {
                    id,
                    reason: rh_sim::results::GvReason::Quest,
                    ..
                } if *id == owner_join.player
            )
        });
        if produced_completion {
            completion_tick = Some(room.sim().tick());
            break;
        }
        if owner_seat
            .row("shards-frost")
            .is_some_and(|row| row.state == WIRE_ROW_EXPIRED)
        {
            panic!(
                "the accepted shards-frost offer expired at native tick {} before the return turn-in",
                room.sim().tick()
            );
        }
    }
    let completion_tick =
        completion_tick.expect("the accepted native turn-in produced real quest completion");
    let completion_ms = room.sim().server_time();
    assert_eq!(
        completion_ms,
        f64::from(completion_tick) * TICK_MS,
        "the native completion time is the running room's own clock"
    );
    assert_ne!(
        completion_tick, 8,
        "source tick 8 / 400 ms is provenance only and is never forced on the native clock"
    );

    // 7. The sealed legacy Room-method completion witness: ordered owner private sends + the one public broadcast call.
    let oracle_text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/quest-room-feedback/source.json"
    ))
    .expect("parity/quest-room-feedback/source.json");
    let oracle: serde_json::Value = serde_json::from_str(&oracle_text).expect("oracle json");
    assert_eq!(oracle["format"], "rh-quest-room-feedback/1");
    assert_eq!(
        oracle["input"]["sha256"],
        "039d4e058fa914f42080f1c55d8640cc508c5b4745504930ca3db49579adc8b4"
    );
    assert_eq!(
        oracle["input"]["rawEventsSha256"],
        "6e40908a3cf563b1d5778b185129c829218af6fd80c903a8a1605552563e7a26"
    );
    assert_eq!(oracle["input"]["caseName"], "completion-retirement");
    assert_eq!(oracle["input"]["frameLabel"], "turned-in");
    // Provenance of the captured projection input, not a clock this test is allowed to impose.
    assert_eq!(oracle["input"]["tick"], 8);
    assert_eq!(oracle["input"]["time"], 400);
    let witness = &oracle["receivers"][0];
    assert_eq!(witness["name"], "genuine-completion-batch-human-receiver");
    assert_eq!(
        witness["rows"][0]["recipient"], "p0",
        "the witness owner alias bound below to the declared native owner name"
    );
    let expected_owner = quest_room_oracle_toasts(witness, "p0");
    let expected_foreign = quest_room_oracle_toasts(witness, "p1");
    assert_eq!(expected_owner.len(), 4, "the witness owner has four toasts");
    assert_eq!(
        expected_foreign.len(),
        1,
        "the foreign viewer hears only the public toast"
    );
    assert_eq!(
        expected_owner[3], expected_foreign[0],
        "the only foreign row is the public broadcast"
    );
    assert_eq!(
        expected_foreign[0],
        format!("{declared_owner_name} completed quest: {}", def.name),
        "explicit source p0/name0 -> declared native owner name binding"
    );

    // 8. Raw native producer batch (unmodified `room.last_events`): the actual completion step is exactly the quest GV
    //    plus the three notice producers, in source order. One native quest GV producer row, its protocol notice appears
    //    only through the observation mapping (never a duplicated world Toast), and the raw rows stay distinct from the
    //    decoded wire rows.
    let raw = room.last_events.as_slice();
    assert_eq!(
        raw.len(),
        4,
        "the completion step's unmodified native producer batch is the quest GV plus three notices"
    );
    let quest_gv: Vec<&Event> = raw
        .iter()
        .filter(|event| {
            matches!(
                event,
                Event::Gv {
                    reason: rh_sim::results::GvReason::Quest,
                    ..
                }
            )
        })
        .collect();
    assert_eq!(quest_gv.len(), 1, "one native quest GV producer event");
    let Event::Gv { id, amount, .. } = *quest_gv[0] else {
        unreachable!("filtered quest GV")
    };
    assert_eq!(id, owner_join.player);
    assert_eq!(amount, u32::from(def.reward_gv));
    let gv_text = format!("+{amount} GV (quest)");
    assert!(
        raw.iter()
            .all(|event| !matches!(event, Event::Toast { text, .. } if *text == gv_text)),
        "the observation mapping never duplicates the native GV producer as a world Toast"
    );
    let raw_toasts: Vec<&str> = raw
        .iter()
        .filter_map(|event| match event {
            Event::Toast { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        raw_toasts,
        vec![
            expected_owner[1].as_str(),
            expected_owner[2].as_str(),
            expected_owner[3].as_str()
        ],
        "native owner farm notice, owner completion notice, then the public notice, in source order"
    );

    // 9. Decode the actual completion-window Events from both real Outboxes at the actual native completion tick and
    //    compare the complete ordered Toast subsequences: no membership filtering, no extra row, no missing row.
    assert_eq!(
        owner_seat.events.len(),
        1,
        "one ordinary wake publishes the owner's completion window"
    );
    assert_eq!(
        foreign_seat.events.len(),
        1,
        "one ordinary wake publishes the foreign completion window"
    );
    let (owner_tick, owner_events) = &owner_seat.events[0];
    let (foreign_tick, foreign_events) = &foreign_seat.events[0];
    assert_eq!(*owner_tick, completion_tick);
    assert_eq!(*foreign_tick, completion_tick);
    assert_eq!(
        owner_events.len(),
        expected_owner.len(),
        "no extra decoded owner row in the completion window"
    );
    assert_eq!(
        foreign_events.len(),
        expected_foreign.len(),
        "no extra decoded foreign row in the completion window"
    );
    let owner_toasts: Vec<String> = owner_events
        .iter()
        .map(|event| match event {
            WireEvent::Toast { text } => text.clone(),
            other => panic!("unexpected decoded owner completion event {other:?}"),
        })
        .collect();
    let foreign_toasts: Vec<String> = foreign_events
        .iter()
        .map(|event| match event {
            WireEvent::Toast { text } => text.clone(),
            other => panic!("unexpected decoded foreign completion event {other:?}"),
        })
        .collect();
    assert_eq!(owner_toasts, expected_owner);
    assert_eq!(foreign_toasts, expected_foreign);
    assert_eq!(
        owner_toasts.iter().filter(|text| **text == gv_text).count(),
        1,
        "the owner protocol notice appears exactly once through the observation mapping"
    );
    assert!(
        owner_seat
            .row("shards-frost")
            .expect("completion row delivered")
            .owner_completed,
        "the delivered completion row binds the owner as the recorded completion actor"
    );

    // 10. Corroborate the native typed completion state in the running Room (never a substitute for the delivery).
    let completed = quest_bridge_runtime(&room.sim);
    let offer = completed
        .offers
        .iter()
        .find(|offer| offer.id == genesis_offer.id)
        .expect("the completed offer is the actual generated offer");
    assert_eq!(offer.status, QuestStatus::Done);
    assert_eq!(offer.done_by, Some(owner_join.player));
    assert!(offer.accepted.contains(&owner_join.player));
    assert!(!offer.accepted.contains(&foreign_join.player));
    assert_eq!(
        room.sim()
            .player(owner_join.player)
            .expect("owner native player")
            .credit
            .gv_parts
            .quest,
        u32::from(def.reward_gv)
    );
    let (reward_stat, reward_stacks) = rh_sim::quests::rules::reward_stats(def);
    assert_eq!(
        room.sim()
            .player(owner_join.player)
            .expect("owner native player")
            .farm
            .count(reward_stat),
        reward_stacks
    );
    let delivered = owner_seat.row("shards-frost").expect("completion row");
    assert_eq!(
        delivered.state, WIRE_ROW_DONE,
        "the delivered row is the closed Done code"
    );
    assert_eq!(
        delivered.done_by.as_deref(),
        Some(declared_owner_name),
        "the delivered done_by binds the declared native owner name"
    );
    eprintln!(
        "quest room proof: native completion tick {completion_tick} ({completion_ms} ms), \
         quest handle {}, delivered pickup handles {delivered_pickup_handles:?}, \
         owner toasts {owner_toasts:?}, foreign toasts {foreign_toasts:?}",
        handle.get()
    );
}
