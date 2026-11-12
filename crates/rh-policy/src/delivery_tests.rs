//! Delivered-policy component and real input-door controls. Explicit public DTO mutations below
//! test refusal/precision; they are not installed native gameplay or claimed source producers.
use super::*;
use crate::bots::delivered::{Epoch, Fact, PlayerRef};
use crate::delivery::{
    CollectionView, DeliveryError, DeliverySession, Frame14, FrameContext14, SampleId,
};
use rh_protocol::{ServerMsg, SnapshotData, SnapshotTracker, StateItem, WireOwnerLock};
use rh_sim::{FactionId, Placement, Secrets, SimConfig, Vec2, WeaponId};
use std::sync::Mutex;

fn scene(hidden_x: f64) -> Sim {
    Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[
            Placement {
                profile: "owner".into(),
                faction: FactionId::Fire,
                bot: true,
                at: Vec2::new(300., 272.),
                hp: None,
                weapon0: Some(WeaponId::Wand),
                weapon1: None,
            },
            Placement {
                profile: "hidden".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(hidden_x, 272.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    )
}
fn npc_scene() -> Sim {
    let map =
        serde_json::from_str(include_str!("../../rh-sim/tests/fixtures/mob-pve-map.json")).unwrap();
    let (w, h, tiles, layers) = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map,
    }
    .validate()
    .unwrap()
    .into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Sim::reset_active(
        SimConfig {
            consumables: false,
            mob_mode: rh_sim::mob_runtime::MobMode::Pve,
            ..Default::default()
        },
        Arena {
            map: rh_sim::TileMap::new(w, h, tiles)
                .unwrap()
                .with_layers(layers)
                .unwrap(),
            spawns,
        },
        Secrets::from_seed(7),
        &[Placement {
            profile: "owner".into(),
            faction: FactionId::Holy,
            bot: true,
            at: Vec2::new(80., 112.),
            hp: None,
            weapon0: Some(WeaponId::Wand),
            weapon1: None,
        }],
    )
}
fn snapshot(f: &Frame14) -> ServerMsg {
    ServerMsg::Snapshot {
        tick: f.tick,
        server_time: f.source_time,
        phase: f.phase,
        ack_input: f.ack_input,
        me: f.owner,
        owner_combat: f.owner_combat,
        actors: f.actors.clone(),
        training: f.training,
    }
}
fn context(viewer: u32, sample: u64) -> FrameContext14 {
    FrameContext14 {
        protocol: rh_protocol::PROTOCOL_VERSION,
        epoch: Epoch(1),
        sample: SampleId(sample),
        viewer: PlayerRef::new(viewer).unwrap(),
    }
}
fn prepared(
    sim: &Sim,
    observer: &mut ItemObserver,
    session: &mut DeliverySession,
) -> delivery::AcceptedFrame14 {
    let mut obs = Observation::default();
    let offer = observer.prepare_into(sim, &[], &mut obs, None).unwrap();
    let frame = session
        .prepare(&obs, offer.props_changed(), offer.rewards_changed(), &[])
        .unwrap();
    offer.commit();
    session.commit(frame)
}
fn data(sim: &Sim) -> Frame14 {
    let obs = rh_sim::try_observe(sim, PlayerId(1), &[]).unwrap();
    (*DeliverySession::new(PlayerId(1))
        .prepare(&obs, true, true, &[])
        .unwrap()
        .frame)
        .clone()
}

#[test]
fn actual_prepared_target_has_same_quantized_scene_and_only_accepted_aliases_resolve() {
    let mut sim = npc_scene();
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut session = DeliverySession::new(PlayerId(1));
    let first = prepared(&sim, &mut observer, &mut session);
    let npc = first
        .frame()
        .actors()
        .find(|a| a.kind() == delivery::ActorKind14::Regional)
        .unwrap()
        .npc()
        .unwrap();
    let command = observer
        .resolve(
            &sim,
            PublicCommand::Target {
                actor: PlayerId(npc.wire_id()),
            },
        )
        .unwrap();
    sim.submit(PlayerId(1), command).unwrap();
    sim.step();
    let mut obs = Observation::default();
    let offer = observer.prepare_into(&sim, &[], &mut obs, None).unwrap();
    let staged = session
        .prepare(&obs, offer.props_changed(), offer.rewards_changed(), &[])
        .unwrap();
    let expected = staged.frame.clone();
    let Fact::Delivered(group) = expected.owner_combat() else {
        panic!("actual owner group")
    };
    let WireOwnerLock::Held {
        target: Some(alias),
    } = group.lock
    else {
        panic!("real validated target retained")
    };
    assert!(alias >= 1 << 31 && expected.actors().any(|a| a.wire().id == alias));
    assert_eq!(
        obs.me.as_ref().unwrap().attack_target,
        Some(PlayerId(alias))
    );
    let mut bytes = Vec::new();
    let mut wire = SnapshotData::build_with_server_time(
        sim.tick(),
        sim.server_time(),
        1,
        0,
        expected.owner,
        expected.actors.iter().copied(),
    )
    .unwrap();
    wire.set_owner_combat(expected.owner_combat).unwrap();
    wire.encode_full_into(&mut bytes);
    let decoded = SnapshotTracker::new().decode(&bytes).unwrap();
    assert_eq!(decoded, snapshot(&expected));
    drop(staged);
    drop(offer);
    assert_eq!(
        observer
            .resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(alias)
                }
            )
            .unwrap(),
        rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap()
    );
    let accepted = prepared(&sim, &mut observer, &mut session);
    assert_eq!(
        accepted.frame(),
        &*expected,
        "drop consumed neither sample nor NPC alias block"
    );
    assert_ne!(
        observer
            .resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(alias)
                }
            )
            .unwrap(),
        rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap()
    );
    assert!(!first
        .frame()
        .actors()
        .find_map(|a| a.npc())
        .unwrap()
        .context()
        .eq(&accepted
            .frame()
            .actors()
            .find_map(|a| a.npc())
            .unwrap()
            .context()));
}

#[test]
fn data_constructor_is_not_acceptance_and_keeps_owner_unavailable_clear_held_distinct() {
    let sim = scene(1600.);
    let obs = rh_sim::observe(&sim, PlayerId(1), &[]);
    let session = DeliverySession::new(PlayerId(1));
    let staged = session.prepare(&obs, true, true, &[]).unwrap();
    let original = staged.frame.clone();
    for lock in [
        None,
        Some(WireOwnerLock::Clear),
        Some(WireOwnerLock::Held { target: None }),
    ] {
        let mut msg = snapshot(&original);
        let ServerMsg::Snapshot { owner_combat, .. } = &mut msg else {
            unreachable!()
        };
        *owner_combat = lock.map(|lock| rh_protocol::WireOwnerCombat {
            lock,
            draw_started_at: u32::MAX,
            ready_at: u32::MAX - 7,
            as_milli: f64::from_bits(0x7fef_ffff_ffff_ffff),
            windup_milli: 1000.,
            speed_milli: 50.,
        });
        let frame = Frame14::from_reconstructed(
            context(1, 1),
            msg,
            original.collections.clone(),
            vec![],
            vec![],
        )
        .unwrap();
        match (lock, frame.owner_combat()) {
            (None, Fact::Unavailable) => {}
            (Some(a), Fact::Delivered(b)) => {
                assert_eq!(a, b.lock);
                assert_eq!(b.draw_started_at, u32::MAX);
                assert_eq!(b.as_milli.to_bits(), 0x7fef_ffff_ffff_ffff);
            }
            _ => panic!("unavailable must not become clear"),
        }
    }
    assert!(matches!(
        Frame14::from_reconstructed(
            FrameContext14 {
                protocol: 13,
                ..context(1, 1)
            },
            snapshot(&original),
            original.collections.clone(),
            vec![],
            vec![]
        ),
        Err(DeliveryError::Protocol)
    ));
    let after = session.prepare(&obs, true, true, &[]).unwrap();
    assert_eq!(after.frame.context().sample, SampleId(1));
    assert_eq!(original.context().sample, SampleId(1)); // merely constructing/copying data never commits
}

fn golden() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../protocol/fixtures/v14.json")).unwrap()
}
fn unhex(s: &str) -> Vec<u8> {
    s.as_bytes()
        .chunks_exact(2)
        .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
        .collect()
}
#[test]
fn owner14_shared_goldens_and_reconstructed_delta_chains_keep_every_clock_and_mirror_bit() {
    let g = golden();
    let collections = data(&scene(1600.)).collections;
    let mut count = 0;
    for sample in g["server"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["name"].as_str().unwrap().starts_with("owner_combat_"))
    {
        let msg = ServerMsg::decode(&unhex(sample["hex"].as_str().unwrap())).unwrap();
        let ServerMsg::Snapshot {
            me, owner_combat, ..
        } = &msg
        else {
            panic!()
        };
        let owner = *owner_combat;
        let f = Frame14::from_reconstructed(
            context(me.unwrap().id, 1),
            msg,
            collections.clone(),
            vec![],
            vec![],
        )
        .unwrap();
        assert_eq!(f.owner_combat, owner);
        count += 1;
    }
    assert_eq!(count, 5);
    let mut steps = 0;
    for chain in g["chains"].as_array().unwrap().iter().filter(|v| {
        [
            "owner_combat_retain_and_clear",
            "owner_combat_owner_loss_clears",
            "owner_combat_dangling_delta_refused",
            "owner_combat_redundant_unavailable_without_self",
        ]
        .contains(&v["name"].as_str().unwrap())
    }) {
        let mut tracker = SnapshotTracker::new();
        let mut viewer = 1;
        for (i, step) in chain["steps"].as_array().unwrap().iter().enumerate() {
            let before = tracker.snapshot();
            let decoded = tracker.decode(&unhex(step["hex"].as_str().unwrap()));
            if step.get("refused").is_some() {
                assert_eq!(step["refused"], "owner_combat");
                assert!(matches!(
                    decoded,
                    Err(rh_protocol::TrackError::Delta(
                        rh_protocol::DeltaError::InvalidOwnerCombat
                    ))
                ));
                assert_eq!(tracker.snapshot(), before);
                continue;
            }
            let msg = decoded.unwrap();
            if let ServerMsg::Snapshot {
                me, owner_combat, ..
            } = &msg
            {
                if let Some(me) = me {
                    viewer = me.id;
                }
                let held = *owner_combat;
                let f = Frame14::from_reconstructed(
                    context(viewer, i as u64 + 1),
                    msg,
                    collections.clone(),
                    vec![],
                    vec![],
                )
                .unwrap();
                assert_eq!(f.owner_combat, held);
                steps += 1;
            }
        }
    }
    assert_eq!(steps, 8);
}

#[test]
fn reconstructed_collections_keep_none_empty_retained_rows_and_refuse_dangling_or_unknown_updates_atomically(
) {
    let mut state = data(&scene(1600.)).collections;
    assert!(state.complete());
    assert!(state.quests.is_none());
    let g = golden();
    let sample = g["server"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "state_quests_available")
        .unwrap();
    state
        .apply(&ServerMsg::decode(&unhex(sample["hex"].as_str().unwrap())).unwrap())
        .unwrap();
    assert!(state.quests.as_ref().is_some_and(|q| !q.rows.is_empty()));
    let retained = state.clone();
    state
        .apply(&ServerMsg::State {
            tick: 999,
            items: vec![StateItem::Inventory(None)],
        })
        .unwrap();
    assert!(state.inventory.is_none());
    assert_eq!(state.quests, retained.quests);
    assert_eq!(state.props, retained.props);
    if state
        .props
        .rows
        .iter()
        .any(|p| matches!(p.kind, rh_protocol::WirePropKind::QuestItem { .. }))
    {
        let before = state.clone();
        assert!(state
            .apply(&ServerMsg::State {
                tick: 1000,
                items: vec![StateItem::Quests(None)]
            })
            .is_err());
        assert_eq!(state, before);
    } else {
        panic!("golden must witness retained quest prop cross-reference")
    }
    state
        .apply(&ServerMsg::State {
            tick: 1001,
            items: vec![
                StateItem::Props(Default::default()),
                StateItem::Quests(None),
            ],
        })
        .unwrap();
    assert!(state.quests.is_none() && state.props.rows.is_empty());
    let empty = g["server"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "state_quests_empty")
        .unwrap();
    state
        .apply(&ServerMsg::decode(&unhex(empty["hex"].as_str().unwrap())).unwrap())
        .unwrap();
    assert!(state.quests.as_ref().is_some_and(|q| q.rows.is_empty()));
    assert!(!CollectionView::default().complete());
    assert!(
        ServerMsg::decode(&[0x88, 0x01, 0x01, 0x7f, 0x00]).is_err(),
        "unknown State key is never silently accepted"
    );
}

fn golden_state(name: &str) -> ServerMsg {
    let g = golden();
    let sample = g["server"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == name)
        .unwrap();
    ServerMsg::decode(&unhex(sample["hex"].as_str().unwrap())).unwrap()
}
fn trade_bytes(view: Option<&rh_protocol::WireTradeView>) -> Vec<u8> {
    ServerMsg::State {
        tick: 0,
        items: vec![StateItem::Trade(view.cloned())],
    }
    .try_encode()
    .unwrap()
}

#[test]
fn frame14_requires_all_eleven_keys_including_explicit_trade_unavailable() {
    let original = data(&scene(1600.));
    let c = &original.collections;
    let mut state = CollectionView::default();
    state
        .apply(&ServerMsg::State {
            tick: 1,
            items: vec![
                StateItem::Inventory(c.inventory),
                StateItem::Props(c.props.clone()),
                StateItem::Fields(c.fields.clone()),
                StateItem::RewardChests(c.reward_chests.clone()),
                StateItem::Build(c.build),
                StateItem::Camps(c.camps.clone()),
                StateItem::Projectiles(c.projectiles.clone()),
                StateItem::Plan(c.plan.clone()),
                StateItem::Arena(c.arena),
                StateItem::Quests(c.quests.clone()),
            ],
        })
        .unwrap();
    assert!(
        !state.complete(),
        "keys 1..10 cannot imply receipt of key 11"
    );
    assert!(matches!(
        Frame14::from_reconstructed(
            context(1, 1),
            snapshot(&original),
            state.clone(),
            vec![],
            vec![]
        ),
        Err(DeliveryError::Incomplete)
    ));
    state
        .apply(&ServerMsg::State {
            tick: 2,
            items: vec![StateItem::Trade(None)],
        })
        .unwrap();
    // ADR0026: key 12, the roster, is required too.
    assert!(
        !state.complete(),
        "keys 1..11 cannot imply receipt of key 12"
    );
    state
        .apply(&ServerMsg::State {
            tick: 2,
            items: vec![StateItem::Roster(c.roster.clone())],
        })
        .unwrap();
    // P-WIRE17-HUD-1: key 13, the owner's build summary, is required too.
    assert!(
        !state.complete(),
        "keys 1..12 cannot imply receipt of key 13"
    );
    state
        .apply(&ServerMsg::State {
            tick: 2,
            items: vec![StateItem::BuildSummary(c.summary.clone())],
        })
        .unwrap();
    assert!(state.complete());
    let f = Frame14::from_reconstructed(context(1, 1), snapshot(&original), state, vec![], vec![])
        .unwrap();
    assert!(matches!(f.trade(), Fact::Delivered(None)));
    assert!(
        ServerMsg::decode(&[0x88, 0x01, 0x01, 14, 0]).is_err(),
        "State 14 is still unknown"
    );
}

#[test]
fn frame14_retains_exact_trade_order_bits_and_explicit_empty_or_unavailable_replacements() {
    let original = data(&scene(1600.));
    let mut state = original.collections.clone();
    // These are decoded public-contract diagnostics, not invented native merchant transactions.
    for name in [
        "state_trade_available",
        "state_trade_duplicate_delta_stats",
        "state_trade_max_2213",
    ] {
        let msg = golden_state(name);
        let ServerMsg::State { items, .. } = &msg else {
            panic!()
        };
        let Some(StateItem::Trade(expected)) =
            items.iter().find(|v| matches!(v, StateItem::Trade(_)))
        else {
            panic!()
        };
        state.apply(&msg).unwrap();
        let f = Frame14::from_reconstructed(
            context(1, 1),
            snapshot(&original),
            state.clone(),
            vec![],
            vec![],
        )
        .unwrap();
        let Fact::Delivered(actual) = f.trade() else {
            panic!()
        };
        assert_eq!(
            trade_bytes(actual),
            trade_bytes(expected.as_ref()),
            "{name}"
        );
    }
    state
        .apply(&golden_state("state_trade_duplicate_delta_stats"))
        .unwrap();
    let mut view = state.trade().unwrap().clone();
    view.stats[0].value = -0.0;
    view.stats[1].value = 0.0;
    view.merchants[0].x = -0.0;
    for deadline in [None, Some(0.0), Some(1.000_000_000_000_000_2)] {
        view.barter_ready_at = deadline;
        let bytes = trade_bytes(Some(&view));
        state.apply(&ServerMsg::decode(&bytes).unwrap()).unwrap();
        assert_eq!(trade_bytes(state.trade()), bytes);
        assert_eq!(
            state.trade().unwrap().stats[0].value.to_bits(),
            (-0.0f64).to_bits()
        );
        assert_eq!(
            state.trade().unwrap().stats[1].value.to_bits(),
            0.0f64.to_bits()
        );
        let retained = trade_bytes(state.trade());
        state
            .apply(&ServerMsg::State {
                tick: 999,
                items: vec![StateItem::Inventory(None)],
            })
            .unwrap();
        assert_eq!(
            trade_bytes(state.trade()),
            retained,
            "omitted key retains all exact ordered facts"
        );
    }
    state.apply(&golden_state("state_trade_empty")).unwrap();
    assert!(state
        .trade()
        .is_some_and(|v| v.offers.is_empty() && v.stats.is_empty() && v.merchants.is_empty()));
    state
        .apply(&golden_state("state_trade_unavailable"))
        .unwrap();
    assert!(
        state.trade().is_none(),
        "explicit unavailable is distinct from available-empty"
    );
}

#[test]
fn frame14_refuses_malformed_trade_update_without_mutating_retained_facts_or_tick() {
    let mut state = data(&scene(1600.)).collections;
    state.apply(&golden_state("state_trade_available")).unwrap();
    let before = state.clone();
    let bytes = trade_bytes(state.trade());
    let mut malformed = state.trade().unwrap().clone();
    malformed.offers[0].gain_value = f64::NAN;
    assert!(state
        .apply(&ServerMsg::State {
            tick: 999,
            items: vec![
                StateItem::Inventory(None),
                StateItem::Trade(Some(malformed))
            ]
        })
        .is_err());
    assert_eq!(state, before);
    assert_eq!(trade_bytes(state.trade()), bytes);
}

#[test]
fn frame14_keeps_all_five_final_quest_strings_owned_retained_and_replaced() {
    let original = data(&scene(1600.));
    let mut state = original.collections.clone();
    let msg = golden_state("state_quests_available");
    state.apply(&msg).unwrap();
    let expected = state.quests().unwrap().clone();
    let expected_props = state.props().clone();
    assert!(!expected.rows.is_empty());
    let row = &expected.rows[0];
    assert!([
        &row.name,
        &row.giver_label,
        &row.brief,
        &row.objective,
        &row.reward
    ]
    .iter()
    .all(|s| !s.is_empty()));
    state
        .apply(&ServerMsg::State {
            tick: 900,
            items: vec![StateItem::Inventory(None)],
        })
        .unwrap();
    let frame = Frame14::from_reconstructed(
        context(1, 1),
        snapshot(&original),
        state.clone(),
        vec![],
        vec![],
    )
    .unwrap();
    assert_eq!(frame.collections().quests(), Some(&expected));
    let mut replacement = expected.clone();
    let row = &mut replacement.rows[0];
    row.name = "name replacement".into();
    row.giver_label = "".into();
    row.brief = "brief α".into();
    row.objective = "objective replacement".into();
    row.reward = "reward replacement".into();
    let msg = ServerMsg::State {
        tick: 901,
        items: vec![StateItem::Quests(Some(replacement.clone()))],
    };
    state
        .apply(&ServerMsg::decode(&msg.try_encode().unwrap()).unwrap())
        .unwrap();
    let frame =
        Frame14::from_reconstructed(context(1, 2), snapshot(&original), state, vec![], vec![])
            .unwrap();
    assert_eq!(frame.collections().quests(), Some(&replacement));
    assert_eq!(
        frame.collections().quests().unwrap().rows[0].owner_ready,
        expected.rows[0].owner_ready
    );
    assert_eq!(
        frame.collections().quests().unwrap().rows[0].owner_progress,
        expected.rows[0].owner_progress
    );
    assert_eq!(
        frame.collections().props(),
        &expected_props,
        "retained same-view quest props remain intact"
    );
}

struct Capture {
    seen: Arc<Mutex<Vec<Frame14>>>,
    reject: bool,
    gate: Option<mpsc::Receiver<()>>,
    notice: Option<mpsc::Sender<()>>,
}
impl Capture {
    fn new() -> (Self, Arc<Mutex<Vec<Frame14>>>) {
        let seen = Arc::new(Mutex::new(vec![]));
        (
            Self {
                seen: seen.clone(),
                reject: false,
                gate: None,
                notice: None,
            },
            seen,
        )
    }
}
impl Policy for Capture {
    fn input_kind(&self) -> InputKind {
        InputKind::Delivered14
    }
    fn check_input(&self, input: InputPreview<'_>) -> Result<(), InputRefusal> {
        if self.reject {
            return Err(InputRefusal::InvalidOwner);
        }
        match input {
            InputPreview::Delivered14(_) => Ok(()),
            _ => Err(InputRefusal::RequiresDelivered14),
        }
    }
    fn decide_input_into(
        &mut self,
        input: PolicyInput<'_>,
        out: &mut Vec<PublicCommand>,
    ) -> Result<(), InputRefusal> {
        let PolicyInput::Delivered14(frame) = input else {
            panic!("delivered policy got raw fallback")
        };
        self.seen.lock().unwrap().push(frame.frame().clone());
        if let Some(notice) = self.notice.take() {
            notice.send(()).unwrap();
        }
        if let Some(gate) = self.gate.take() {
            gate.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        if let Some(a) = frame
            .frame()
            .actors()
            .find(|a| a.kind() == delivery::ActorKind14::Regional)
        {
            out.push(PublicCommand::Target {
                actor: PlayerId(a.wire().id),
            });
        }
        Ok(())
    }
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            name: "delivered-capture".into(),
            version: "1".into(),
            contract: POLICY_CONTRACT_VERSION,
            observation_version: OBSERVATION_VERSION,
            decision_interval_ticks: 1,
        }
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        panic!("raw shortcut")
    }
}
#[test]
fn sync_preflight_refusal_keeps_events_cadence_and_aliases_until_a_receiver_accepts() {
    let mut sim = npc_scene();
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let (mut policy, seen) = Capture::new();
    policy.reject = true;
    let (mut fallback, fseen) = Capture::new();
    fallback.reject = true;
    let mut seats = [Seat::new(&start, Box::new(policy), Box::new(fallback))];
    seats[0].pending.push(SeenEvent::Toast {
        text: "held carry".into(),
    });
    drive_seats(&mut sim, &mut seats, &[]);
    assert_eq!(seats[0].next_tick, 0);
    assert_eq!(seats[0].stats.decisions, 0);
    assert_eq!(seats[0].pending.len(), 1);
    assert!(seen.lock().unwrap().is_empty() && fseen.lock().unwrap().is_empty());
    let mut retry = Observation::default();
    drop(
        seats[0]
            .observer
            .prepare_into(&sim, &[], &mut retry, None)
            .unwrap(),
    );
    let mut fresh = Observation::default();
    ItemObserver::new(PlayerId(1))
        .observe_into(&sim, &[], &mut fresh, None)
        .unwrap();
    assert_eq!(retry, fresh);
    let (fallback, fseen) = Capture::new();
    seats[0].fallback = Box::new(fallback);
    drive_seats(&mut sim, &mut seats, &[]);
    assert_eq!(seats[0].stats.fallback_decisions, 1);
    assert!(seats[0].pending.is_empty());
    let frame = fseen.lock().unwrap().pop().unwrap();
    assert_eq!(frame.context().sample, SampleId(1));
    assert!(frame
        .events()
        .iter()
        .flat_map(|b| &b.events)
        .any(|e| matches!(e,rh_protocol::WireEvent::Toast{text} if text=="held carry")));
}

#[test]
fn async_failed_send_and_failed_fallback_do_not_accept_anything_but_successful_fallback_does_once()
{
    let mut sim = npc_scene();
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let (policy, seen) = Capture::new();
    let (mut fallback, fseen) = Capture::new();
    fallback.reject = true;
    let mut seat = AsyncSeat::spawn(&start, Box::new(policy), Box::new(fallback), 2);
    seat.bind_fx(&sim).unwrap();
    let (tx, rx) = mpsc::sync_channel(1);
    drop(rx);
    seat.tx = tx;
    seat.seen.push(SeenEvent::Toast {
        text: "not lost".into(),
    });
    seat.poll(&mut sim, &[], |_, _| panic!("no accepted receiver"))
        .unwrap();
    assert_eq!(seat.next_tick, 0);
    assert_eq!(seat.stats.decisions, 0);
    assert_eq!(seat.seen.len(), 1);
    assert!(seat.pending.is_none());
    assert!(seen.lock().unwrap().is_empty() && fseen.lock().unwrap().is_empty());
    let mut retry = Observation::default();
    drop(
        seat.observer
            .prepare_into(&sim, &[], &mut retry, None)
            .unwrap(),
    );
    let mut fresh = Observation::default();
    ItemObserver::new(PlayerId(1))
        .observe_into(&sim, &[], &mut fresh, None)
        .unwrap();
    assert_eq!(retry, fresh);
    let (fallback, fseen) = Capture::new();
    seat.fallback = Box::new(fallback);
    seat.poll(&mut sim, &[], |_, _| {}).unwrap();
    assert_eq!(seat.stats.fallback_decisions, 1);
    assert!(seat.seen.is_empty());
    assert_eq!(fseen.lock().unwrap()[0].context().sample, SampleId(1));
}

#[test]
fn actual_async_receiver_and_same_public_fallback_use_typed_sample_and_session_reply_tokens() {
    let mut sim = npc_scene();
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let (mut policy, seen) = Capture::new();
    let (release, gate) = mpsc::channel();
    let (notice, arrived) = mpsc::channel();
    policy.gate = Some(gate);
    policy.notice = Some(notice);
    let (fallback, fseen) = Capture::new();
    let mut seat = AsyncSeat::spawn(&start, Box::new(policy), Box::new(fallback), 0);
    seat.bind_fx(&sim).unwrap();
    seat.poll(&mut sim, &[], |_, _| panic!("worker blocked"))
        .unwrap();
    arrived.recv_timeout(Duration::from_secs(5)).unwrap();
    let token = seat.pending.clone().unwrap();
    assert_eq!(token.sample, seen.lock().unwrap()[0].context().sample);
    sim.step();
    seat.poll(&mut sim, &[], |_, _| {}).unwrap();
    assert_eq!(seat.stats.fallback_decisions, 1);
    assert_eq!(fseen.lock().unwrap()[0].context().sample, SampleId(2));
    release.send(()).unwrap();
    // Controlled reply channel isolates token rejection without depending on worker scheduling.
    let (tx, rx) = mpsc::channel();
    seat.rx = rx;
    let current = seat.pending.clone().unwrap();
    let mut wrong = current.clone();
    wrong.session = delivery::frame::SessionId::new();
    tx.send((wrong, Ok(vec![PublicCommand::Stop { seq: None }])))
        .unwrap();
    seat.poll(&mut sim, &[], |_, _| panic!("foreign session reply"))
        .unwrap();
    assert_eq!(seat.pending, Some(current.clone()));
    let mut wrong = current.clone();
    wrong.sample = SampleId(current.sample.0 + 99);
    tx.send((wrong, Ok(vec![PublicCommand::Stop { seq: None }])))
        .unwrap();
    seat.poll(&mut sim, &[], |_, _| panic!("foreign sample reply"))
        .unwrap();
    assert_eq!(seat.pending, Some(current.clone()));
    tx.send((current, Ok(vec![PublicCommand::Stop { seq: None }])))
        .unwrap();
    let mut submitted = vec![];
    seat.poll(&mut sim, &[], |_, command| submitted.push(command))
        .unwrap();
    assert_eq!(
        submitted,
        vec![rh_sim::validate(rh_sim::RawCommand::Stop { seq: None }).unwrap()],
        "matching reply must reach real intake"
    );
}

#[test]
fn owner_loss_is_a_real_cleared_delivery_and_new_local_sessions_have_distinct_receipts() {
    let mut sim = scene(1600.);
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let (policy, seen) = Capture::new();
    let mut seats = [Seat::new(
        &start,
        Box::new(policy),
        Box::new(scripted::Idle),
    )];
    drive_seats(&mut sim, &mut seats, &[]);
    sim.remove_player(PlayerId(1));
    sim.step();
    drive_seats(&mut sim, &mut seats, &[]);
    let frames = seen.lock().unwrap();
    assert_eq!(frames.len(), 2);
    assert!(matches!(frames[1].owner(), Fact::Delivered(None)));
    assert!(matches!(frames[1].owner_combat(), Fact::Unavailable));
    drop(frames);
    let sim = scene(1600.);
    let mut a = DeliverySession::new(PlayerId(1));
    let mut b = DeliverySession::new(PlayerId(1));
    let aa = prepared(&sim, &mut ItemObserver::new(PlayerId(1)), &mut a);
    let bb = prepared(&sim, &mut ItemObserver::new(PlayerId(1)), &mut b);
    assert!(!aa.same_session(&bb));
    assert!(aa.same_session(&aa.clone()));
    assert_eq!(
        aa.frame(),
        bb.frame(),
        "session identity exposes no process-global number in public facts"
    );
}

#[test]
fn hidden_a_b_produce_equal_delivered_frames_and_human_commands_without_raw_fallback() {
    fn run(hidden: f64) -> (Vec<Frame14>, Vec<rh_sim::Command>) {
        let mut sim = scene(hidden);
        let start = MatchStart::of(&sim, PlayerId(1), 7);
        let mut observer = ItemObserver::new(PlayerId(1));
        let mut session = DeliverySession::new(PlayerId(1));
        let mut frames = vec![];
        let mut seats = [Seat::new(
            &start,
            Box::new(bots::bot::HumanBot::new(
                bots::types::TierId::Normal,
                bots::types::PersonaId::Hunter,
            )),
            Box::new(scripted::Idle),
        )];
        seats[0].bind_fx(&sim).unwrap();
        let mut sight = SightCache::new();
        let mut sent = vec![];
        let mut events = vec![];
        for _ in 0..30 {
            let frame = prepared(&sim, &mut observer, &mut session);
            assert!(frame.frame().actors().next().is_none());
            frames.push(frame.frame().clone());
            drive_seats_with(&mut sim, &mut seats, &events, &mut sight, |_, c| {
                sent.push(c)
            });
            events = sim.step();
        }
        assert!(seats[0].fault.is_none());
        assert_eq!(seats[0].stats.fallback_decisions, 0);
        assert!(!sent.is_empty());
        (frames, sent)
    }
    assert_eq!(run(1600.), run(1700.));
}

#[test]
fn genuine_landed_attack_owner_result_survives_cadence_and_never_includes_another_seats_result() {
    let place = |name: &str, x, hp| Placement {
        profile: name.into(),
        faction: FactionId::Holy,
        bot: false,
        at: Vec2::new(x, 272.),
        hp,
        weapon0: Some(WeaponId::Wand),
        weapon1: None,
    };
    let mut sim = Sim::reset_active(
        SimConfig {
            pvp_rules: false,
            consumables: false,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[place("owner", 300., None), place("victim", 420., Some(1.))],
    );
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let (policy, seen) = Capture::new();
    let mut seats = [Seat::new(
        &start,
        Box::new(policy),
        Box::new(scripted::Idle),
    )];
    seats[0].interval = 17;
    seats[0].bind_fx(&sim).unwrap();
    let mut events = vec![];
    let mut expected = vec![];
    let mut foreign = 0;
    let mut result_tick = None;
    sim.submit(
        PlayerId(1),
        rh_sim::validate(rh_sim::RawCommand::Target { id: PlayerId(2) }).unwrap(),
    )
    .unwrap();
    for _ in 0..50 {
        drive_seats(&mut sim, &mut seats, &events);
        events = sim.step();
        for event in &events {
            if let Event::Resolved { id, result, .. } = event {
                if *id == PlayerId(1) {
                    expected.push(delivery::projection::result(result));
                    result_tick = Some(sim.tick());
                } else {
                    foreign += 1;
                }
            }
        }
    }
    assert!(
        !expected.is_empty() && foreign > 0,
        "actual attack must produce both own and foreign outcomes"
    );
    assert_ne!(
        result_tick.unwrap(),
        18,
        "result is produced between policy delivery ticks"
    );
    let actual: Vec<_> = seen
        .lock()
        .unwrap()
        .iter()
        .flat_map(|f| f.events())
        .flat_map(|b| &b.events)
        .filter_map(|e| {
            if let rh_protocol::WireEvent::Result(v) = e {
                Some(v.clone())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        actual, expected,
        "own public result retained, foreign private result never projected"
    );
}

#[test]
fn malformed_public_event_or_owner_clock_refuses_entire_candidate_without_advancing_baseline() {
    let sim = npc_scene();
    let observer = ItemObserver::new(PlayerId(1));
    drop(observer);
    let good = rh_sim::observe(&sim, PlayerId(1), &[]);
    let session = DeliverySession::new(PlayerId(1));
    let original = session.prepare(&good, true, true, &[]).unwrap().frame;
    for bad_clock in [false, true] {
        let mut bad = good.clone();
        if bad_clock {
            bad.server_time = f64::NAN;
        } else {
            bad.events.push(SeenEvent::Toast {
                text: "x".repeat(20_000),
            });
        }
        assert!(session.prepare(&bad, true, true, &[]).is_err());
        assert_eq!(
            session.prepare(&good, true, true, &[]).unwrap().frame,
            original
        );
    }
}

#[test]
fn full_async_queue_and_refused_fallback_preserve_next_alias_sample_and_carried_events() {
    let mut sim = npc_scene();
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let (mut policy, seen) = Capture::new();
    let (release, gate) = mpsc::channel();
    let (notice, arrived) = mpsc::channel();
    policy.gate = Some(gate);
    policy.notice = Some(notice);
    let (fallback, fseen) = Capture::new();
    let mut seat = AsyncSeat::spawn(&start, Box::new(policy), Box::new(fallback), 0);
    seat.bind_fx(&sim).unwrap();
    seat.poll(&mut sim, &[], |_, _| {}).unwrap();
    arrived.recv_timeout(Duration::from_secs(5)).unwrap();
    sim.step();
    seat.poll(&mut sim, &[], |_, _| {}).unwrap(); // active request1, queued request2, accepted fallback2
    let published = fseen.lock().unwrap()[0]
        .actors()
        .find_map(|a| a.npc())
        .unwrap()
        .wire_id();
    let (mut reject, _) = Capture::new();
    reject.reject = true;
    seat.fallback = Box::new(reject);
    sim.step();
    seat.seen.push(SeenEvent::Toast {
        text: "full queue carry".into(),
    });
    let decisions = seat.stats.decisions;
    let next_tick = seat.next_tick;
    seat.poll(&mut sim, &[], |_, _| {
        panic!("full queue and refusing fallback cannot submit")
    })
    .unwrap();
    assert_eq!(seat.stats.decisions, decisions);
    assert_eq!(seat.next_tick, next_tick);
    assert_eq!(seen.lock().unwrap().len(), 1);
    assert!(seat
        .seen
        .iter()
        .any(|e| matches!(e,SeenEvent::Toast{text} if text=="full queue carry")));
    assert_ne!(
        seat.observer
            .resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(published)
                }
            )
            .unwrap(),
        rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap(),
        "old target is still live/visible; failure is delivery, not an unrelated gate"
    );
    let mut out = Observation::default();
    let offer = seat
        .observer
        .prepare_into(&sim, &[], &mut out, None)
        .unwrap();
    let pending = seat
        .delivery
        .prepare(&out, offer.props_changed(), offer.rewards_changed(), &[])
        .unwrap();
    assert_eq!(pending.frame.context().sample, SampleId(3));
    let candidate = pending.frame.clone();
    drop(pending);
    drop(offer);
    let unpublished = candidate.actors().find_map(|a| a.npc()).unwrap().wire_id();
    assert_ne!(published, unpublished);
    assert_eq!(
        seat.observer
            .resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(unpublished)
                }
            )
            .unwrap(),
        rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap()
    );
    let (fallback, fseen) = Capture::new();
    seat.fallback = Box::new(fallback);
    seat.poll(&mut sim, &[], |_, _| {}).unwrap();
    let delivered = &fseen.lock().unwrap()[0];
    assert_eq!(delivered.context().sample, SampleId(3));
    assert_eq!(
        delivered.actors().find_map(|a| a.npc()).unwrap().wire_id(),
        unpublished
    );
    assert!(delivered
        .events()
        .iter()
        .flat_map(|b| &b.events)
        .any(|e| matches!(e,rh_protocol::WireEvent::Toast{text} if text=="full queue carry")));
    release.send(()).unwrap();
}

#[test]
fn renewed_observer_drop_preserves_old_aliases_and_the_next_delivery_reuses_the_same_new_scene() {
    let sim = npc_scene();
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut session = DeliverySession::new(PlayerId(1));
    let old = prepared(&sim, &mut observer, &mut session);
    let old_alias = old
        .frame()
        .actors()
        .find_map(|a| a.npc())
        .unwrap()
        .wire_id();
    let mut renewal = observer.renewed();
    let mut out = Observation::default();
    let offer = renewal.prepare_into(&sim, &[], &mut out, None).unwrap();
    let pending = session
        .prepare(&out, offer.props_changed(), offer.rewards_changed(), &[])
        .unwrap();
    let candidate = pending.frame.clone();
    let new_alias = candidate.actors().find_map(|a| a.npc()).unwrap().wire_id();
    assert_ne!(old_alias, new_alias);
    drop(pending);
    drop(offer);
    drop(renewal);
    assert_ne!(
        observer
            .resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(old_alias)
                }
            )
            .unwrap(),
        rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap()
    );
    assert_eq!(
        observer
            .resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(new_alias)
                }
            )
            .unwrap(),
        rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap()
    );
    let mut renewal = observer.renewed();
    let accepted = prepared(&sim, &mut renewal, &mut session);
    assert_eq!(accepted.frame(), &*candidate);
    observer = renewal;
    assert_ne!(
        observer
            .resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(new_alias)
                }
            )
            .unwrap(),
        rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap()
    );
    assert_eq!(
        observer
            .resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(old_alias)
                }
            )
            .unwrap(),
        rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap()
    );
}

#[derive(Clone, Copy, Debug)]
enum AppendedDecision {
    Success,
    Refuse,
    Panic,
}
struct AppendThenFinish {
    finish: AppendedDecision,
    seen: Arc<Mutex<Vec<Frame14>>>,
}
impl Policy for AppendThenFinish {
    fn input_kind(&self) -> InputKind {
        InputKind::Delivered14
    }
    fn check_input(&self, input: InputPreview<'_>) -> Result<(), InputRefusal> {
        match input {
            InputPreview::Delivered14(_) => Ok(()),
            _ => Err(InputRefusal::RequiresDelivered14),
        }
    }
    fn decide_input_into(
        &mut self,
        input: PolicyInput<'_>,
        out: &mut Vec<PublicCommand>,
    ) -> Result<(), InputRefusal> {
        let PolicyInput::Delivered14(receipt) = input else {
            panic!("raw fallback shortcut")
        };
        self.seen.lock().unwrap().push(receipt.frame().clone());
        out.push(PublicCommand::Stop { seq: None });
        match self.finish {
            AppendedDecision::Success => Ok(()),
            AppendedDecision::Refuse => Err(InputRefusal::InvalidOwner),
            AppendedDecision::Panic => panic!("fallback failed after appending a valid stop"),
        }
    }
    fn spec(&self) -> PolicySpec {
        Capture::new().0.spec()
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        panic!("raw fallback shortcut")
    }
}
fn assert_append_failure_is_discarded(finish: AppendedDecision) {
    for queued in [false, true] {
        for primary_refuses_preflight in [true, false] {
            let mut sim = npc_scene();
            let start = MatchStart::of(&sim, PlayerId(1), 7);
            let primary: Box<dyn Policy> = if primary_refuses_preflight {
                let (mut p, _) = Capture::new();
                p.reject = true;
                Box::new(p)
            } else {
                Box::new(AppendThenFinish {
                    finish: AppendedDecision::Refuse,
                    seen: Arc::new(Mutex::new(vec![])),
                })
            };
            let seen = Arc::new(Mutex::new(vec![]));
            let fallback = AppendThenFinish {
                finish,
                seen: seen.clone(),
            };
            let mut seats = [Seat::new(&start, primary, Box::new(fallback))];
            let mut sight = SightCache::new();
            let mut proposals = vec![];
            let mut submitted = vec![];
            let ran = catch_unwind(AssertUnwindSafe(|| {
                if queued {
                    drive_seats_queued(&mut sim, &mut seats, &[], &mut sight, |_, p| {
                        proposals.push(p)
                    });
                } else {
                    drive_seats_with(&mut sim, &mut seats, &[], &mut sight, |_, c| {
                        submitted.push(c)
                    });
                }
            }));
            assert!(ran.is_ok(),"fallback panic must stay inside the policy fault seam: queued={queued}, preflight={primary_refuses_preflight}");
            assert!(
                proposals.is_empty() && submitted.is_empty(),
                "refused fallback leaked valid proposals: {proposals:?}/{submitted:?}"
            );
            assert_eq!(seats[0].stats.proposed, 0);
            assert_eq!(seats[0].stats.accepted, 0);
            assert_eq!(seats[0].stats.rejected, 0);
            assert_eq!(seats[0].stats.decisions, 1);
            assert_eq!(seats[0].stats.fallback_decisions, 1);
            assert_eq!(
                seen.lock().unwrap().len(),
                1,
                "failure occurs during decision after real frame acceptance"
            );
            let frame = seen.lock().unwrap()[0].clone();
            let npc = frame.actors().find_map(|a| a.npc()).unwrap().wire_id();
            assert_ne!(
                seats[0]
                    .observer
                    .resolve(
                        &sim,
                        PublicCommand::Target {
                            actor: PlayerId(npc)
                        }
                    )
                    .unwrap(),
                rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap(),
                "accepted frame remains committed; no arbitrary policy-memory rollback is promised"
            );
            assert_eq!(
                seats[0].fault,
                Some(match finish {
                    AppendedDecision::Refuse => Fault::Input(InputRefusal::InvalidOwner),
                    AppendedDecision::Panic => Fault::Panicked,
                    AppendedDecision::Success => unreachable!(),
                })
            );
        }
    }
}
#[test]
fn fallback_append_then_refusal_never_reaches_sync_submit_or_queued_delivery() {
    assert_append_failure_is_discarded(AppendedDecision::Refuse);
}
#[test]
fn fallback_append_then_panic_is_contained_and_never_reaches_either_driver() {
    assert_append_failure_is_discarded(AppendedDecision::Panic);
}
#[test]
fn successful_fallback_stop_is_valid_and_reaches_real_intake_in_both_drivers() {
    for queued in [false, true] {
        let mut sim = npc_scene();
        let start = MatchStart::of(&sim, PlayerId(1), 7);
        let (mut p, _) = Capture::new();
        p.reject = true;
        let mut seats = [Seat::new(
            &start,
            Box::new(p),
            Box::new(AppendThenFinish {
                finish: AppendedDecision::Success,
                seen: Arc::new(Mutex::new(vec![])),
            }),
        )];
        let mut sight = SightCache::new();
        let mut submitted = vec![];
        let mut proposals = vec![];
        if queued {
            drive_seats_queued(&mut sim, &mut seats, &[], &mut sight, |_, p| {
                proposals.push(p)
            });
            assert_eq!(proposals, vec![PublicCommand::Stop { seq: None }]);
            for p in proposals {
                let c = seats[0].resolve(&sim, p).unwrap();
                submitted.push(c);
                let accepted = sim.submit(PlayerId(1), c).is_ok();
                seats[0].note_delivery(accepted);
            }
        } else {
            drive_seats_with(&mut sim, &mut seats, &[], &mut sight, |_, c| {
                submitted.push(c)
            });
        }
        assert_eq!(
            submitted,
            vec![rh_sim::validate(rh_sim::RawCommand::Stop { seq: None }).unwrap()]
        );
        assert_eq!(seats[0].stats.proposed, 1);
        assert_eq!(seats[0].stats.accepted, 1);
        assert_eq!(seats[0].stats.rejected, 0);
    }
}

#[test]
fn identical_public_frames_do_not_make_fresh_session_npc_references_equal() {
    let sim = npc_scene();
    let mut a = DeliverySession::new(PlayerId(1));
    let mut b = DeliverySession::new(PlayerId(1));
    let left = prepared(&sim, &mut ItemObserver::new(PlayerId(1)), &mut a);
    let right = prepared(&sim, &mut ItemObserver::new(PlayerId(1)), &mut b);
    assert_eq!(
        left.frame(),
        right.frame(),
        "opaque affinity is not a public decoded fact"
    );
    let l = left.frame().actors().find_map(|a| a.npc()).unwrap();
    let r = right.frame().actors().find_map(|a| a.npc()).unwrap();
    assert_eq!(l.wire_id(), r.wire_id());
    assert_eq!(
        l.context(),
        r.context(),
        "numeric epoch/sample alone collide across fresh sessions"
    );
    assert_eq!(l, l.clone());
    assert_eq!(
        l,
        left.frame().clone().actors().find_map(|a| a.npc()).unwrap()
    );
    assert_ne!(
        l, r,
        "reference equality must also carry private local session affinity"
    );
    let f = left.frame();
    let independent = Frame14::from_reconstructed(
        f.context(),
        snapshot(f),
        f.collections().clone(),
        f.events().to_vec(),
        f.fx().to_vec(),
    )
    .unwrap();
    assert_eq!(
        &independent, f,
        "independently reconstructed equal data remains equal"
    );
    assert_ne!(
        l,
        independent.actors().find_map(|a| a.npc()).unwrap(),
        "data construction creates its own local reference scope"
    );
}

struct AckHumanBot {
    inner: bots::bot::HumanBot,
    ack: mpsc::Sender<(FrameContext14, Vec<PublicCommand>)>,
}
impl Policy for AckHumanBot {
    fn input_kind(&self) -> InputKind {
        self.inner.input_kind()
    }
    fn input_requirements(&self) -> InputRequirements {
        self.inner.input_requirements()
    }
    fn check_input(&self, input: InputPreview<'_>) -> Result<(), InputRefusal> {
        self.inner.check_input(input)
    }
    fn decide_input_into(
        &mut self,
        input: PolicyInput<'_>,
        out: &mut Vec<PublicCommand>,
    ) -> Result<(), InputRefusal> {
        let PolicyInput::Delivered14(frame) = input else {
            panic!("actual HumanBot worker received raw input")
        };
        let base = out.len();
        self.inner.decide_input_into(input, out)?;
        // Observe only real delegated output. This wrapper never creates, changes or installs a command.
        let emitted = out[base..].to_vec();
        for proposal in &emitted {
            if let PublicCommand::Target { actor } = proposal {
                assert!(frame.frame().actors().any(|row| row.wire().id == actor.0));
            }
        }
        self.ack.send((frame.frame().context(), emitted)).unwrap();
        Ok(())
    }
    fn spec(&self) -> PolicySpec {
        self.inner.spec()
    }
    fn reset(&mut self, start: &MatchStart) {
        self.inner.reset(start)
    }
    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        panic!("actual HumanBot async raw shortcut")
    }
}
#[test]
#[allow(clippy::disallowed_methods)] // Harness-only real-worker timeout; never read by the policy.
fn actual_human_bot_async_handshake_delivers_frame14_and_submits_real_nonempty_commands_without_fallback(
) {
    let mut sim = npc_scene();
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let (ack, received) = mpsc::channel();
    let bot = AckHumanBot {
        inner: bots::bot::HumanBot::new(
            bots::types::TierId::Normal,
            bots::types::PersonaId::Hunter,
        ),
        ack,
    };
    let mut seat = AsyncSeat::spawn(&start, Box::new(bot), Box::new(scripted::Idle), 4);
    seat.bind_fx(&sim).unwrap();
    let mut submitted = vec![];
    let mut real_output = vec![];
    let mut events = vec![];
    let mut samples = 0;
    for _ in 0..200 {
        seat.poll(&mut sim, &events, |_, c| submitted.push(c))
            .unwrap();
        let token = seat
            .pending
            .clone()
            .expect("real HumanBot request is queued");
        let (context, commands) = received
            .recv_timeout(Duration::from_secs(5))
            .expect("real delegated HumanBot callback ack");
        assert_eq!((context.sample, context.epoch), (token.sample, token.epoch));
        assert_eq!(context.viewer, PlayerRef::new(1).unwrap());
        assert_eq!(context.protocol, rh_protocol::PROTOCOL_VERSION);
        real_output.extend(commands);
        samples += 1;
        // Ack is issued before the worker posts its reply. Yield to that real sender until poll
        // consumes it; no fabricated reply, sleep, source-clock override or installed outcome.
        let limit = Instant::now() + Duration::from_secs(5);
        while seat.pending.is_some() {
            assert!(Instant::now() < limit, "actual worker reply did not arrive");
            seat.poll(&mut sim, &events, |_, c| submitted.push(c))
                .unwrap();
            std::thread::yield_now();
        }
        assert!(seat.fault.is_none(), "{:?}", seat.fault);
        assert_eq!(seat.stats.fallback_decisions, 0);
        events = sim.step();
        if seat.stats.accepted > 0 {
            break;
        }
    }
    assert!(
        samples > 1,
        "exercise actual HumanBot scheduling across real native steps"
    );
    assert!(!real_output.is_empty() && !submitted.is_empty());
    assert!(seat.stats.proposed > 0 && seat.stats.accepted > 0);
    assert_eq!(seat.stats.fallback_decisions, 0);
    assert!(
        real_output.iter().all(|c| matches!(
            c,
            PublicCommand::Move { .. }
                | PublicCommand::Stop { .. }
                | PublicCommand::Target { .. }
                | PublicCommand::Aim { .. }
                | PublicCommand::Attack { .. }
                | PublicCommand::Release { .. }
        )),
        "this is compatibility-front-end input-door proof, not full fight/RNG parity"
    );
}
