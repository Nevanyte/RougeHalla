//! Conversions between simulation types and wire types (rh-protocol stays independent of the sim). Codes are the protocol's
//! (docs/CONTRACTS.md C-NET-3): status 0 lobby, 1 alive, 2 dead, 3 mia; phase 0 lobby, 1 active, 2 ended; outcome 0 won,
//! 1 draw, 2 died, 3 mia; faction and weapon codes are the content tables' order.

use rh_policy::delivery::projection::{
    checked_actor, observation_supported, to_wire, wire_owner_combat, wire_self, Wire,
};
pub use rh_policy::delivery::projection::{checked_phase, checked_snapshot, phase, result, status};
#[cfg(test)]
use rh_policy::delivery::projection::{hp_pct, sat16, wire_actor, wire_point, WIRE_NO_SOURCE};
use rh_protocol::quant::POS_MAX;
#[cfg(test)]
use rh_protocol::WirePoint;
use rh_protocol::{QActor, ServerMsg, SnapshotData, WireCommand, WireEvent, WireFx};
use rh_sim::observe::{ActorView, Observation, SeenEvent};
#[cfg(test)]
use rh_sim::sim::{Phase, Status};
use rh_sim::Class;

/// Public intents only. Trade names its fixed catalog kind; Cast references are resolved through
/// the seat's delivered actor references before ordinary validation and submission.
pub fn command(c: WireCommand) -> rh_sim::PublicCommand {
    use rh_sim::PublicCommand as Public;
    match c {
        WireCommand::Trade { kind, pick } => Public::Trade {
            merchant: match kind {
                rh_protocol::WireTradeKind::Barter => rh_sim::traders::Kind::Barter,
                rh_protocol::WireTradeKind::Stats => rh_sim::traders::Kind::Stats,
            },
            pick: pick as i8,
        },
        WireCommand::QuestAccept { handle } => Public::QuestAccept {
            handle: rh_sim::quest_view::QuestHandle::new(handle.get())
                .expect("nonzero wire quest handle"),
        },
        WireCommand::UseConsumable => Public::UseConsumable,
        // This remains a public reference: Room intake resolves it through the seat ItemObserver.
        WireCommand::HuntTarget { actor } => Public::HuntTarget {
            actor: rh_sim::PlayerId(actor),
        },
        WireCommand::ConsumeCorpse { handle } => Public::ConsumeCorpse {
            handle: rh_sim::PickupHandle::new(handle.get()).expect("nonzero wire handle"),
        },
        WireCommand::Target { actor } => Public::Target {
            actor: rh_sim::PlayerId(actor),
        },
        WireCommand::AttackMove { x, y, seq } => Public::AttackMove {
            x: f64::from(x),
            y: f64::from(y),
            seq,
        },
        WireCommand::Move { x, y, seq } => Public::Move {
            x: x as f64,
            y: y as f64,
            seq,
        },
        WireCommand::Swap { slot } => Public::Swap { slot },
        WireCommand::Pickup { handle } => Public::Pickup {
            handle: rh_sim::PickupHandle::new(handle.get()).expect("checked wire handle"),
        },
        WireCommand::Choose { handle, pick } => Public::Choose {
            handle: rh_sim::reward_chests::RewardChestHandle::from_wire(handle.get())
                .expect("checked reward handle"),
            pick,
        },
        WireCommand::Plan { spawn, boon, ready } => Public::Plan { spawn, boon, ready },
        WireCommand::Stop { seq } => Public::Stop { seq },
        WireCommand::MoveAt { x, y, seq, t } => Public::MoveAt {
            x: f64::from(x),
            y: f64::from(y),
            seq,
            t,
        },
        WireCommand::AttackMoveAt { x, y, seq, t } => Public::AttackMoveAt {
            x: f64::from(x),
            y: f64::from(y),
            seq,
            t,
        },
        WireCommand::Aim { a } => Public::Aim { a: a as f64 },
        WireCommand::Attack { a, t } => Public::Attack { a: a as f64, t },
        WireCommand::Release { a, t } => Public::Release { a: a as f64, t },
        WireCommand::Cast {
            slot,
            x,
            y,
            actor,
            t,
            seq,
        } => Public::Cast {
            slot: match slot {
                0 => rh_sim::abilities::Slot::Wish,
                1 => rh_sim::abilities::Slot::Q,
                2 => rh_sim::abilities::Slot::E,
                _ => unreachable!("protocol decoder checks Cast slot"),
            },
            x: f64::from(x),
            y: f64::from(y),
            id: actor.map(rh_sim::PlayerId),
            t,
            seq,
        },
        WireCommand::Train {
            command,
            id,
            count,
            options,
            option_count,
        } => Public::Train(rh_sim::input::TrainRaw {
            command,
            id,
            count,
            options,
            option_count,
        }),
    }
}

/// Protocol 14 carries neutral quest givers, private quest/trade/plan state and the training bit. Configuration
/// admission still refuses a training/arena combination: training has no quests, planning or arena lifecycle.
pub fn profile_supported(config: &rh_sim::SimConfig) -> Result<(), rh_protocol::EncodeError> {
    if config.training && (config.quests || config.lifecycle != rh_sim::ArenaMode::Off) {
        return Err(rh_protocol::EncodeError::BadValue(
            "training cannot host quests or arena lifecycle",
        ));
    }
    Ok(())
}

/// Whether the wire can carry every position of a match on `arena`: the world extent (`w * TILE` by `h * TILE` u) and
/// every spawn must lie within `0 ..= POS_MAX` (8191.875 u, a map of at most 255 tiles a side), the range of the u16 1/8 u
/// position grid of protocol v2. The encoder refuses a position outside it rather than clamp, so a larger map is refused
/// here, at startup, instead of failing every snapshot.
pub fn arena_fits(arena: &rh_sim::Arena) -> Result<(), String> {
    let tile = rh_sim::constants::TILE;
    let limit = POS_MAX as f64;
    let (w, h) = (arena.map.w as f64 * tile, arena.map.h as f64 * tile);
    if w > limit || h > limit {
        return Err(format!(
            "map {}x{} tiles is a world of {w} x {h} u, which does not fit the wire position range 0..={limit} u \
             (protocol v2: u16 at 1/8 u, at most {} tiles a side)",
            arena.map.w,
            arena.map.h,
            (limit / tile) as u32
        ));
    }
    if let Some(p) = arena
        .spawns
        .iter()
        .find(|p| !(0.0..=limit).contains(&p.x) || !(0.0..=limit).contains(&p.y))
    {
        return Err(format!(
            "spawn ({}, {}) is outside the wire position range 0..={limit} u",
            p.x, p.y
        ));
    }
    Ok(())
}

pub fn snapshot(obs: &Observation, ack_input: u32) -> ServerMsg {
    checked_snapshot(obs, ack_input)
        .expect("native observation is unsupported by the wire protocol")
}

/// Whether the protocol-6 actor fields match bit for bit (`0.0` and `-0.0`, or two NaNs, never count as equal).
#[inline]
fn same_view(a: &ActorView, b: &ActorView) -> bool {
    a.id == b.id
        && a.x.to_bits() == b.x.to_bits()
        && a.y.to_bits() == b.y.to_bits()
        && a.facing.to_bits() == b.facing.to_bits()
        && a.hp_frac.to_bits() == b.hp_frac.to_bits()
        && a.barrier_frac.to_bits() == b.barrier_frac.to_bits()
        && a.barrier_ring_step == b.barrier_ring_step
        && a.bounty == b.bounty
        && a.status == b.status
        && a.faction == b.faction
        && a.weapon == b.weapon
        && a.sig == b.sig
        && a.effects == b.effects
        && a.displace_seq == b.displace_seq
        && a.kind == b.kind
        && a.mob_type == b.mob_type
        && windup_bits_equal(a.windup, b.windup)
}

/// Protocol 15 windups compared bitwise, like the other float fields of [`same_view`].
fn windup_bits_equal(
    a: Option<rh_sim::observe::WindupView>,
    b: Option<rh_sim::observe::WindupView>,
) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => {
            a.kind == b.kind
                && a.started_at.to_bits() == b.started_at.to_bits()
                && a.lands_at.to_bits() == b.lands_at.to_bits()
                && a.a.map(f64::to_bits) == b.a.map(f64::to_bits)
        }
        _ => false,
    }
}

/// Highest actor id (exclusive) [`ActorMemo`] remembers; an actor with a higher id is converted every time.
const MEMO_IDS: usize = rh_protocol::MAX_ACTORS;

/// The wire form of each actor last shown, by id. An actor is the same to every viewer who sees it, so its check and
/// quantization is done once per distinct state rather than once per viewer (and not again while it stands still). The key is
/// the whole view, compared bitwise, and the result is a pure function of it: a stale entry cannot be returned.
#[derive(Default)]
struct ActorMemo {
    slots: Vec<Option<(ActorView, Result<QActor, &'static str>)>>,
}

impl ActorMemo {
    #[inline]
    fn get(&mut self, a: &ActorView) -> Result<QActor, &'static str> {
        let i = a.id.0 as usize;
        if i >= MEMO_IDS {
            return checked_actor(a);
        }
        if i >= self.slots.len() {
            self.slots.resize_with(i + 1, || None);
        }
        match &mut self.slots[i] {
            Some((src, q)) if same_view(src, a) => *q,
            slot => {
                let q = checked_actor(a);
                *slot = Some((a.clone(), q));
                q
            }
        }
    }
}

/// One viewer's frames for one wake. Each is one allocation of its exact size.
pub struct ViewFrames {
    /// Reliable events (deaths, bounties, the end, the viewer's own result), if any.
    pub important: Option<Vec<u8>>,
    /// Disposable fx the viewer can see, if any.
    pub fx: Option<Vec<u8>>,
    /// The state snapshot as wire data for the connection's writer to encode (Full or delta); an error when the codec
    /// refuses the observation (never a repaired snapshot).
    pub snapshot: Result<SnapshotData, rh_protocol::EncodeError>,
    /// The first refusal of the Events or Fx frame (that frame is then `None`): the codec never clamps or repairs one.
    pub refused: Option<rh_protocol::EncodeError>,
}

impl ViewFrames {
    fn unsupported(error: rh_protocol::EncodeError) -> Self {
        Self {
            important: None,
            fx: None,
            snapshot: Err(error.clone()),
            refused: Some(error),
        }
    }

    /// Bytes handed to the outbox: the events and fx frames, and the snapshot at a lower bound of the size of its Full frame
    /// ([`SnapshotData::min_len`]; the writer sends a Full frame or a smaller delta and counts the real bytes).
    pub fn bytes(&self) -> usize {
        [&self.important, &self.fx]
            .into_iter()
            .flatten()
            .map(Vec::len)
            .sum::<usize>()
            + self.snapshot.as_ref().map_or(0, SnapshotData::min_len)
    }
}

/// A refusing profile check or a failed native observation offer.
#[derive(Debug)]
pub enum PrepareFramesError {
    Unsupported(rh_protocol::EncodeError),
    Offer(rh_sim::OfferError),
}
impl From<rh_sim::OfferError> for PrepareFramesError {
    fn from(error: rh_sim::OfferError) -> Self {
        Self::Offer(error)
    }
}

/// The shared production and benchmark publish path, retaining intermediate buffers.
#[derive(Default)]
pub struct Publisher {
    obs: Observation,
    actors: ActorMemo,
    events: Vec<WireEvent>,
    fx: Vec<WireFx>,
    /// Line-of-sight verdicts the observations reuse for pairs whose endpoints did not move (derived, exact).
    sight: rh_sim::SightCache,
}

impl Publisher {
    /// Hits and misses of the publisher's line-of-sight memo so far (diagnostics).
    pub fn sight_stats(&self) -> rh_sim::SightStats {
        self.sight.stats()
    }

    /// [`rh_sim::observe_events_into`] through the publisher's line-of-sight memo (same events appended).
    pub fn observe_events_into(
        &mut self,
        sim: &rh_sim::Sim,
        viewer: rh_sim::PlayerId,
        events: &[rh_sim::Event],
        out: &mut Vec<SeenEvent>,
    ) {
        rh_sim::observe_events_into_cached(sim, viewer, events, out, &mut self.sight);
    }

    /// Scratch observation: consume only after successful frame/prepared delivery. On refusal it is unspecified.
    pub fn observation(&self) -> &Observation {
        &self.obs
    }

    /// The frames for `viewer` after a wake.
    ///
    /// * `last_step`: the events of the wake's LAST step; the observation is built from them against the sim as it stands.
    /// * `earlier`: what `viewer` could know of the wake's earlier steps, judged step by step as they ran
    ///   ([`rh_sim::observe_events_into`]); empty on a one-step wake. It is emptied here, and those events come first.
    /// * `all`: every event of the wake, for the viewer's own result (a dedicated path, not an observed event).
    pub fn frames(
        &mut self,
        sim: &rh_sim::Sim,
        viewer: rh_sim::PlayerId,
        ack_input: u32,
        last_step: &[rh_sim::Event],
        earlier: &mut Vec<SeenEvent>,
        all: &[rh_sim::Event],
    ) -> ViewFrames {
        self.frames_in(None, sim, viewer, ack_input, last_step, earlier, all)
    }

    /// [`Publisher::frames`] with the snapshot built in `spare`, a snapshot a connection has finished with
    /// ([`rh_protocol::ConnEncoder::take_spare`], [`crate::outbox::Outbox::push_tick`]).
    #[allow(clippy::too_many_arguments)]
    pub fn frames_in(
        &mut self,
        spare: Option<SnapshotData>,
        sim: &rh_sim::Sim,
        viewer: rh_sim::PlayerId,
        ack_input: u32,
        last_step: &[rh_sim::Event],
        earlier: &mut Vec<SeenEvent>,
        all: &[rh_sim::Event],
    ) -> ViewFrames {
        // Hosting admission is enforced by Room/director/main. Component publishers can project
        // an admitted native view without claiming full quest/giver hosting support.
        if let Err(error) =
            rh_sim::try_observe_into_cached(sim, viewer, last_step, &mut self.obs, &mut self.sight)
        {
            let reason = match error {
                rh_sim::OfferError::UnrepresentablePublicVitals => "public vitals",
                rh_sim::OfferError::UnrepresentableOwnerCombat => "owner combat",
                _ => "observation bounds",
            };
            return ViewFrames::unsupported(rh_protocol::EncodeError::BadValue(reason));
        }
        self.build_observation_frames(spare, viewer, ack_input, earlier, all)
    }

    /// An action-producing observer is seat-owned; the caller commits only after its reliable
    /// state and snapshot have entered the outbox. Event-only catch-up never touches this offer.
    #[allow(clippy::too_many_arguments)]
    pub fn frames_prepared<'a>(
        &mut self,
        observer: &'a mut rh_sim::ItemObserver,
        spare: Option<SnapshotData>,
        sim: &rh_sim::Sim,
        ack_input: u32,
        last_step: &[rh_sim::Event],
        earlier: &mut Vec<SeenEvent>,
        all: &[rh_sim::Event],
    ) -> Result<(ViewFrames, rh_sim::item_view::PreparedOffer<'a>), PrepareFramesError> {
        let viewer = observer.viewer();
        let offer = observer.prepare_with_seen(
            sim,
            last_step,
            earlier,
            &mut self.obs,
            Some(&mut self.sight),
        )?;
        observation_supported(&self.obs).map_err(PrepareFramesError::Unsupported)?;
        earlier.clear();
        Ok((
            self.build_observation_frames(spare, viewer, ack_input, earlier, all),
            offer,
        ))
    }

    fn build_observation_frames(
        &mut self,
        spare: Option<SnapshotData>,
        viewer: rh_sim::PlayerId,
        ack_input: u32,
        earlier: &mut Vec<SeenEvent>,
        all: &[rh_sim::Event],
    ) -> ViewFrames {
        if !earlier.is_empty() {
            earlier.append(&mut self.obs.events);
            std::mem::swap(earlier, &mut self.obs.events);
        }
        if let Err(error) = observation_supported(&self.obs) {
            return ViewFrames::unsupported(error);
        }
        self.events.clear();
        self.fx.clear();
        for e in &self.obs.events {
            match to_wire(e) {
                Wire::Event(w) => {
                    debug_assert_eq!(e.class(), Class::Important);
                    self.events.push(w);
                }
                Wire::Fx(w) => {
                    debug_assert_eq!(e.class(), Class::Fx);
                    self.fx.push(w);
                }
                Wire::Omitted => {}
                Wire::Refused(reason) => {
                    return ViewFrames::unsupported(rh_protocol::EncodeError::BadValue(reason))
                }
            }
        }
        for e in all {
            if let rh_sim::Event::Resolved { id, result: r, .. } = e {
                if *id == viewer {
                    debug_assert_eq!(e.class(), Class::Important);
                    self.events.push(WireEvent::Result(result(r)));
                }
            }
        }
        let tick = self.obs.tick;
        // Both go through the refusing encoder: a frame a decoder would reject (an fx position off the grid, too many
        // entries) is not sent, never clamped (release) nor a panic (debug).
        let mut refused = None;
        let important = if self.events.is_empty() {
            None
        } else {
            let msg = ServerMsg::Events {
                tick,
                events: std::mem::take(&mut self.events),
            };
            let frame = encode_or_refuse(&msg, &mut refused);
            if let ServerMsg::Events { events, .. } = msg {
                self.events = events;
            }
            frame
        };
        let fx = if self.fx.is_empty() {
            None
        } else {
            let msg = ServerMsg::Fx {
                tick,
                fx: std::mem::take(&mut self.fx),
            };
            let frame = encode_or_refuse(&msg, &mut refused);
            if let ServerMsg::Fx { fx, .. } = msg {
                self.fx = fx;
            }
            frame
        };
        let memo = &mut self.actors;
        let training = self.obs.training;
        let snapshot = SnapshotData::build_checked_with_server_time(
            spare,
            tick,
            self.obs.server_time,
            phase(self.obs.phase),
            ack_input,
            self.obs.me.as_ref().map(wire_self),
            self.obs.visible.iter().map(|a| memo.get(a)),
        )
        .and_then(|mut snapshot| {
            snapshot.set_training(training);
            snapshot.set_owner_combat(self.obs.owner_combat.map(wire_owner_combat))?;
            Ok(snapshot)
        });
        ViewFrames {
            important,
            fx,
            snapshot,
            refused,
        }
    }
}

#[cfg(test)]
#[path = "wire_owner_combat_tests.rs"]
mod owner_combat_tests;

/// The frame of `msg`, or `None` with the reason kept in `refused` (the first one wins) when a decoder would reject it:
/// never a clamped frame (release) and never a panic (debug).
fn encode_or_refuse(
    msg: &ServerMsg,
    refused: &mut Option<rh_protocol::EncodeError>,
) -> Option<Vec<u8>> {
    match msg.try_encode() {
        Ok(f) => Some(f),
        Err(e) => {
            refused.get_or_insert(e);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
    use rh_policy::scripted::Brawler;
    use rh_protocol::quant::POS_SCALE;
    use rh_protocol::{snapshot_server_ms, StateItem, WireArena, WirePlan, TICK_MS};
    use rh_sim::{FactionId, SimConfig};

    /// The planning-capable source arena: the admitted rh-map/2 export the arena capture uses (spawn pool, coliseum and
    /// planning walks), copied without modification into an Arena exactly as the parity harness does.
    fn source_arena() -> rh_sim::Arena {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/arena/source.json"
        ))
        .expect("parity/arena/source.json");
        let source: serde_json::Value = serde_json::from_str(&text).expect("arena capture json");
        let export: rh_sim::mapdata::MapExport =
            serde_json::from_value(source["map"]["export"].clone()).expect("rh-map/2 export");
        let (w, h, tiles, layers) = export.validate().expect("admitted map layers").into_parts();
        let spawns = layers
            .data()
            .spawns
            .iter()
            .map(|p| rh_sim::Vec2::new(p.x, p.y))
            .collect();
        rh_sim::Arena {
            map: rh_sim::TileMap::new(w, h, tiles)
                .expect("map tiles")
                .with_layers(layers)
                .expect("layers fit the tiles"),
            spawns,
        }
    }

    fn arena_env() -> Env {
        let arena = source_arena();
        Env::new(
            EnvConfig {
                arena,
                sim: SimConfig {
                    lifecycle: rh_sim::ArenaMode::Source(rh_sim::ArenaRules::default()),
                    min_players: 2,
                    lobby_seconds: 0.,
                    fill_seconds: 0.,
                    ..Default::default()
                },
                max_ticks: 100,
                record: false,
            },
            (0..2)
                .map(|i| AgentSpec {
                    profile: format!("p{i}"),
                    faction: FactionId::Holy,
                    bot: false,
                    agent: Agent::External,
                })
                .collect(),
            12,
        )
    }

    fn arena_plan_command(ready: bool) -> rh_sim::PublicCommand {
        rh_sim::PublicCommand::Plan {
            spawn: Some(0),
            boon: None,
            ready: Some(ready),
        }
    }

    fn state_items(frames: &[u8]) -> Vec<StateItem> {
        let ServerMsg::State { items, .. } = ServerMsg::decode(frames).expect("state frame") else {
            panic!("not a state frame")
        };
        items
    }

    fn plan_of(items: &[StateItem]) -> Option<WirePlan> {
        items.iter().find_map(|item| match item {
            StateItem::Plan(plan) => plan.clone(),
            _ => None,
        })
    }

    fn arena_of(items: &[StateItem]) -> Option<WireArena> {
        items.iter().find_map(|item| match item {
            StateItem::Arena(arena) => *arena,
            _ => None,
        })
    }

    /// The source lifecycle's Lobby -> Planning -> Active phases and the owner-plan/public-arena transport encode; the
    /// teleport event is the source's room-wide fx, never a refused frame.
    #[test]
    fn arena_profile_transports_lobby_planning_and_active_with_owner_plan_state() {
        let mut env = arena_env();
        let viewer = env.observations()[0].me.as_ref().unwrap().id;
        let mut publisher = Publisher::default();
        let mut observer = rh_sim::ItemObserver::new(viewer);
        let mut collections = crate::wire_state::CollectionPublisher::default();
        for expected in [Phase::Lobby, Phase::Planning, Phase::Active] {
            assert_eq!(env.sim.phase(), expected);
            let mut earlier = vec![SeenEvent::Teleported];
            let frames = publisher.frames(&env.sim, viewer, 0, &[], &mut earlier, &[]);
            assert!(frames.refused.is_none());
            assert!(frames.snapshot.is_ok());
            // The source teleport presentation effect maps to the wire's Teleport fx.
            let ServerMsg::Fx { fx, .. } =
                ServerMsg::decode(frames.fx.as_ref().expect("teleport fx")).unwrap()
            else {
                panic!("not an fx frame")
            };
            assert_eq!(fx, vec![WireFx::Teleport]);
            assert!(publisher
                .frames_prepared(&mut observer, None, &env.sim, 0, &[], &mut earlier, &[])
                .is_ok());
            let obs = rh_sim::observe(&env.sim, viewer, &[]);
            let snapshot = checked_snapshot(&obs, 0).expect("phase is wire-encodable");
            let ServerMsg::Snapshot { phase, .. } = &snapshot else {
                panic!("not a snapshot")
            };
            assert_eq!(*phase, checked_phase(expected).unwrap());
            assert!(snapshot.try_encode().is_ok());
            let pending = collections
                .prepare(publisher.observation(), false, false, false)
                .expect("plan/arena state encodes");
            let items = state_items(pending.frame.as_ref().expect("full state after welcome"));
            let plan = plan_of(&items);
            let arena = arena_of(&items).expect("source arena view");
            assert_eq!(arena.lobby_ends_at, 0.);
            match expected {
                Phase::Lobby => {
                    assert!(plan.is_none());
                    assert_eq!(arena.started_with, 0);
                    assert_eq!(arena.raid_started_at, 0.);
                }
                Phase::Planning => {
                    let plan = plan.expect("the owner's private plan");
                    assert!(plan.ends_at >= 0.);
                    // The admitted source map deals a real ordered pool; the server resolves both option facts.
                    assert!(plan.spawns.iter().all(|s| s.is_some()));
                    assert!(plan.options.iter().all(|o| o.is_some()));
                    for option in plan.options.iter().flatten() {
                        assert!((1..=5).contains(&option.zone));
                        assert!(option.walk_seconds.is_some());
                    }
                    assert!(!plan.ready);
                    assert_eq!(arena.plan_ends_at, plan.ends_at);
                }
                Phase::Active => {
                    assert!(plan.is_none(), "the private plan clears when planning ends");
                    assert!(arena.raid_started_at > 0.);
                    assert!(arena.started_with >= 2);
                }
                Phase::Ended => unreachable!(),
            }
            pending.commit(&mut collections);
            if expected == Phase::Lobby {
                env.step(&[]);
            } else if expected == Phase::Planning {
                env.step(&[
                    vec![arena_plan_command(true)],
                    vec![arena_plan_command(true)],
                ]);
            }
        }
    }

    #[test]
    fn full_wish_owner_and_barrier_snapshot_encode_with_arena_off() {
        let mut sim = rh_sim::Sim::new(
            SimConfig {
                quests: false,
                abilities: rh_sim::abilities::Mode::Full,
                lifecycle: rh_sim::ArenaMode::Off,
                min_players: 2,
                lobby_seconds: 0.,
                fill_seconds: 0.,
                ..Default::default()
            },
            rh_sim::arenas::practice_arena(),
            rh_sim::Secrets::from_seed(12),
        );
        let viewer = sim.add_player("p0", Some(FactionId::Holy), false).unwrap();
        sim.add_player("p1", Some(FactionId::Holy), false).unwrap();
        let mut publisher = Publisher::default();
        let mut observer = rh_sim::ItemObserver::new(viewer);
        for expected in [Phase::Lobby, Phase::Active] {
            assert_eq!(sim.phase(), expected);
            assert!(profile_supported(sim.config()).is_ok());
            let mut earlier = vec![SeenEvent::Stagger { id: viewer }];
            let frames = publisher.frames(&sim, viewer, 0, &[], &mut earlier, &[]);
            assert!(frames.snapshot.is_ok());
            assert!(frames.fx.is_some());
            assert!(publisher
                .frames_prepared(&mut observer, None, &sim, 0, &[], &mut earlier, &[])
                .is_ok());
            let obs = rh_sim::observe(&sim, viewer, &[]);
            assert!(obs.me.as_ref().unwrap().wish.is_some());
            assert!(obs.arena.is_none() && obs.plan.is_none());
            let direct = checked_snapshot(&obs, 0).expect("full Wish owner fact is supported");
            assert!(!direct.try_encode().unwrap().is_empty());
            assert!(matches!(
                direct,
                ServerMsg::Snapshot { server_time, .. } if server_time == obs.server_time
            ));
            if expected == Phase::Lobby {
                sim.step();
            }
        }
    }

    #[test]
    fn a_prerequisite_refusal_uses_the_existing_owner_toast_without_poisoning_frames() {
        let env = seed1_match(1);
        let viewer = env.sim.players()[0].id;
        let event = SeenEvent::ChestRefused {
            reason: rh_sim::reward_chests::Refusal::Needs(rh_sim::cards::BaseStatId::Ad),
        };
        assert!(
            matches!(to_wire(&event), Wire::Event(WireEvent::Toast { text }) if text == "Needs Offense")
        );
        let mut publisher = Publisher::default();
        let mut earlier = vec![event];
        let frames = publisher.frames(&env.sim, viewer, 0, &[], &mut earlier, &[]);
        assert!(frames.snapshot.is_ok() && frames.refused.is_none());
        let ServerMsg::Events { events, .. } =
            ServerMsg::decode(&frames.important.unwrap()).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            events,
            vec![WireEvent::Toast {
                text: "Needs Offense".into()
            }]
        );
        assert!(earlier.is_empty());
        assert!(publisher
            .frames(&env.sim, viewer, 0, &[], &mut earlier, &[])
            .snapshot
            .is_ok());
    }

    #[test]
    fn wish_start_and_landing_encode_as_checked_fx() {
        let env = seed1_match(1);
        let viewer = env.sim.players()[0].id;
        let mut publisher = Publisher::default();
        for event in [
            SeenEvent::CastStarted {
                event_time: 100.0,
                id: viewer,
                ability: rh_sim::status_runtime::AbilityId::Freeze,
                ms: 250.,
                target: None,
                at: Some(rh_sim::Vec2::new(2.0, 3.0)),
            },
            SeenEvent::CastLanded {
                event_time: 100.0,
                id: Some(viewer),
                ability: rh_sim::status_runtime::AbilityId::Freeze,
                target: None,
                at: None,
                to: None,
            },
        ] {
            assert!(matches!(to_wire(&event), Wire::Fx(_)));
            let frames = publisher.frames(&env.sim, viewer, 0, &[], &mut vec![event], &[]);
            assert!(frames.fx.is_some());
            assert!(frames.snapshot.is_ok());
            assert!(frames.refused.is_none());
        }
        assert!(matches!(
            to_wire(&SeenEvent::CastStarted {
                event_time: 100.0,
                id: viewer,
                ability: rh_sim::status_runtime::AbilityId::Freeze,
                ms: 250.0,
                target: None,
                at: Some(rh_sim::Vec2::new(-1.0, 3.0)),
            }),
            Wire::Refused("wish position")
        ));
    }

    #[test]
    fn wish_points_check_source_f64_before_narrowing() {
        let max = f64::from(POS_MAX);
        assert_eq!(
            wire_point(Some(rh_sim::Vec2::new(max, max))),
            Ok(Some(WirePoint {
                x: POS_MAX,
                y: POS_MAX
            }))
        );
        let rounds_to_max = max + 0.0001;
        assert_eq!(
            rounds_to_max as f32, POS_MAX,
            "regression input must narrow back into range"
        );
        assert_eq!(
            wire_point(Some(rh_sim::Vec2::new(rounds_to_max, max))),
            Err("wish position")
        );
        let negative_underflow = -f64::MIN_POSITIVE;
        assert_eq!(
            negative_underflow as f32, -0.0,
            "regression input must underflow to negative zero"
        );
        assert_eq!(
            wire_point(Some(rh_sim::Vec2::new(negative_underflow, 1.0))),
            Err("wish position")
        );
        assert_eq!(
            wire_point(Some(rh_sim::Vec2::new(f64::NAN, 1.0))),
            Err("wish position")
        );
    }

    #[test]
    fn arena_events_map_to_transport_and_off_profiles_still_encode() {
        let env = seed1_match(1);
        let viewer = env.sim.players()[0].id;
        let mut publisher = Publisher::default();
        let frames = publisher.frames(&env.sim, viewer, 7, &[], &mut Vec::new(), &[]);
        assert!(frames.snapshot.is_ok() && frames.refused.is_none());
        let obs = publisher.observation();
        assert!(checked_snapshot(obs, 7).unwrap().try_encode().is_ok());
        // Protocol 8 carries the planning phase and the source lifecycle profile (Wishes remain refused).
        assert_eq!(checked_phase(Phase::Planning), Ok(3));
        let mut planning = obs.clone();
        planning.phase = Phase::Planning;
        assert!(checked_snapshot(&planning, 7).unwrap().try_encode().is_ok());
        assert!(profile_supported(&SimConfig {
            lifecycle: rh_sim::ArenaMode::Source(Default::default()),
            ..Default::default()
        })
        .is_ok());
        // The source teleport is a room-wide presentation fx.
        assert!(matches!(
            to_wire(&SeenEvent::Teleported),
            Wire::Fx(WireFx::Teleport)
        ));
        let frames = publisher.frames(
            &env.sim,
            viewer,
            7,
            &[],
            &mut vec![SeenEvent::Teleported],
            &[],
        );
        assert!(frames.snapshot.is_ok() && frames.refused.is_none());
        let ServerMsg::Fx { fx, .. } =
            ServerMsg::decode(frames.fx.as_ref().expect("teleport fx")).unwrap()
        else {
            panic!("not an fx frame")
        };
        assert_eq!(fx, vec![WireFx::Teleport]);
        // The owner's deal is a complete-replacement State key, never a one-shot event.
        let plan = SeenEvent::Plan(rh_sim::PlanView {
            ends_at: 1.,
            spawns: [0, 1],
            taken: [false, false],
            pick: -1,
            boons: Vec::new(),
            boon: -1,
        });
        assert!(matches!(to_wire(&plan), Wire::Omitted));
        let frames = publisher.frames(&env.sim, viewer, 7, &[], &mut vec![plan], &[]);
        assert!(frames.snapshot.is_ok() && frames.refused.is_none());
        assert!(frames.important.is_none() && frames.fx.is_none());
        let mut observer = rh_sim::ItemObserver::new(viewer);
        let (frames, offer) = publisher
            .frames_prepared(&mut observer, None, &env.sim, 7, &[], &mut Vec::new(), &[])
            .unwrap();
        assert!(frames.snapshot.is_ok() && frames.refused.is_none());
        offer.commit();
    }

    fn seed1_match(ticks: u32) -> Env {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/maps/seed1.map.json"
        );
        let arena = rh_headless::load_arena(path).expect("seed-1 map");
        let agents = (0..8)
            .map(|i| AgentSpec {
                profile: format!("b{i}"),
                faction: FactionId::ALL[i % 5],
                bot: true,
                agent: Agent::Policy {
                    policy: Box::new(Brawler::new(2)),
                },
            })
            .collect();
        Env::new(
            EnvConfig {
                arena,
                sim: SimConfig::default(),
                max_ticks: ticks,
                record: false,
            },
            agents,
            1,
        )
    }

    /// A faction or weapon code rides in a 4-bit nibble, a status or phase code in 2 bits: adding content past that is a
    /// protocol change, and this test is where it shows up first.
    #[test]
    fn content_codes_fit_the_wire_bit_widths() {
        assert!(FactionId::ALL.len() as u8 <= rh_protocol::MAX_KIT_CODE + 1);
        assert!(rh_sim::content::WeaponId::ALL.len() as u8 <= rh_protocol::MAX_KIT_CODE + 1);
        for s in [Status::Lobby, Status::Alive, Status::Dead, Status::Mia] {
            assert!(status(s) <= rh_protocol::MAX_STATUS_CODE);
        }
        for p in [Phase::Lobby, Phase::Active, Phase::Ended] {
            assert!(phase(p) <= rh_protocol::MAX_PHASE_CODE);
        }
    }

    /// Ordinary source clocks equal `tick * 50 ms`; protocol 12 only needs the absolute clock override when that default
    /// does not match the observation's source time.
    #[test]
    fn server_time_is_tick_times_50() {
        assert_eq!(rh_sim::constants::TICK_MS, TICK_MS as f64);
        let mut env = seed1_match(600);
        let ids: Vec<_> = env.sim.players().iter().map(|p| p.id).collect();
        for _ in 0..600 {
            let out = env.step(&[]);
            assert_eq!(
                env.sim.server_time(),
                env.sim.tick() as f64 * rh_sim::constants::TICK_MS
            );
            assert_eq!(env.sim.server_time(), snapshot_server_ms(env.sim.tick()));
            for id in &ids {
                let obs = rh_sim::observe(&env.sim, *id, &out.events);
                assert_eq!(obs.server_time, snapshot_server_ms(obs.tick));
            }
            if out.terminated {
                break;
            }
        }
        assert!(env.sim.tick() > 0);
    }

    /// The snapshot the Publisher hands a connection (its actors checked once for all viewers and remembered across ticks) is
    /// the one built straight from the observation, and its Full frame is the message's frame, byte for byte, over a whole
    /// match (every viewer, every tick).
    #[test]
    fn the_published_snapshot_is_the_one_built_from_the_observation_over_a_match() {
        let mut env = seed1_match(900);
        let ids: Vec<_> = env.sim.players().iter().map(|p| p.id).collect();
        let mut publisher = Publisher::default();
        let (mut frames, mut with_actors) = (0, 0);
        let mut spare = None;
        for t in 0..900u32 {
            let out = env.step(&[]);
            for id in &ids {
                let f = publisher.frames_in(
                    spare.take(),
                    &env.sim,
                    *id,
                    t,
                    &out.events,
                    &mut Vec::new(),
                    &out.events,
                );
                let got = f.snapshot.expect("builds");
                let obs = publisher.observation();
                let mut want = SnapshotData::build(
                    obs.tick,
                    phase(obs.phase),
                    t,
                    obs.me.as_ref().map(wire_self),
                    obs.visible.iter().map(|a| wire_actor(a).unwrap()),
                )
                .expect("builds");
                want.set_owner_combat(obs.owner_combat.map(wire_owner_combat))
                    .expect("the same checked current-scene owner group");
                assert_eq!(got, want);
                let mut full = Vec::new();
                got.encode_full_into(&mut full);
                assert_eq!(full, snapshot(obs, t).try_encode().expect("encodes"));
                frames += 1;
                with_actors += !got.actors().is_empty() as u32;
                // A recycled block builds the same snapshot.
                spare = Some(got);
            }
        }
        assert!(frames > 1000 && with_actors > 300, "{frames} {with_actors}");
    }

    fn view(id: u32) -> ActorView {
        ActorView {
            kind: rh_sim::observe::ActorKind::Player,
            owner: None,
            mob_type: None,
            effects: 0,
            displace_seq: 0,
            mark_tier: 0,
            brand: 0,
            mark_by: None,
            mark_tax: 0,
            sig: 0,
            id: rh_sim::PlayerId(id),
            faction: FactionId::ALL[1].into(),
            x: 100.3,
            y: 50.7,
            facing: 0.5,
            hp_frac: 0.75,
            barrier_frac: 0.,
            barrier_ring_step: 0,
            status: Status::Alive,
            weapon: Some(rh_sim::content::WeaponId::ALL[2]),
            bounty: 3,
            windup: None,
        }
    }

    /// Protocol 15: a draw carries whole milliseconds and no aim, a cast its aim code; both survive the Full frame.
    #[test]
    fn windups_map_to_whole_milliseconds_and_a_cast_aim_only() {
        use rh_sim::observe::{WindupKind, WindupView};
        let draw = ActorView {
            windup: Some(WindupView {
                kind: WindupKind::Draw,
                started_at: 1950.5,
                lands_at: 2500.25,
                a: None,
            }),
            ..view(5)
        };
        let cast = ActorView {
            windup: Some(WindupView {
                kind: WindupKind::Cast,
                started_at: 3000.,
                lands_at: 3450.,
                a: Some(-1.5),
            }),
            ..view(6)
        };
        let wd = wire_actor(&draw).unwrap().windup.unwrap();
        assert_eq!(
            wd,
            rh_protocol::WireWindup {
                kind: rh_protocol::WINDUP_DRAW,
                started_at: 1950,
                duration: 551,
                aim: 0,
            }
        );
        let wc = wire_actor(&cast).unwrap().windup.unwrap();
        assert_eq!(
            (wc.kind, wc.started_at, wc.duration),
            (rh_protocol::WINDUP_CAST, 3000, 450)
        );
        assert_eq!(wc.aim, rh_protocol::quant::quantize_facing(-1.5));
        assert_eq!(wire_actor(&view(7)).unwrap().windup, None);
        let data = SnapshotData::build(
            3,
            1,
            0,
            None,
            [draw, cast]
                .iter()
                .map(|a| checked_actor(a).unwrap())
                .map(|q| q.to_wire()),
        )
        .unwrap();
        let mut frame = Vec::new();
        data.encode_full_into(&mut frame);
        let ServerMsg::Snapshot { actors, .. } = ServerMsg::decode(&frame).unwrap() else {
            panic!("a Full snapshot")
        };
        assert_eq!(actors[0].windup, Some(wd));
        assert_eq!(actors[1].windup, Some(wc));
    }

    /// The memo is a cache of a pure function: whatever it holds, `get` is what a fresh conversion gives, for a hit, for every
    /// field that changes (a miss), for the values that compare equal but convert differently (`0.0` and `-0.0`), for a
    /// refused actor (and the actor after it is good again), and for an id past the memo.
    #[test]
    fn the_actor_memo_is_always_a_fresh_conversion() {
        let mut memo = ActorMemo::default();
        let mut a = view(5);
        type Edit = Box<dyn Fn(&mut ActorView)>;
        let edits: Vec<(&str, Edit)> = vec![
            ("same", Box::new(|_| {})),
            ("sig", Box::new(|a| a.sig = 255)),
            (
                "mob type",
                Box::new(|a| a.mob_type = Some(rh_sim::mob_catalog::MobTypeId::Archon)),
            ),
            (
                "kind",
                Box::new(|a| a.kind = rh_sim::observe::ActorKind::Regional),
            ),
            ("effects", Box::new(|a| a.effects = 4096)),
            ("displacement", Box::new(|a| a.displace_seq = 255)),
            ("x", Box::new(|a| a.x = 101.25)),
            ("y", Box::new(|a| a.y = 51.0)),
            ("facing", Box::new(|a| a.facing = -2.0)),
            ("hp", Box::new(|a| a.hp_frac = 0.01)),
            ("barrier share", Box::new(|a| a.barrier_frac = 0.25)),
            ("barrier ring", Box::new(|a| a.barrier_ring_step = 4)),
            ("bounty", Box::new(|a| a.bounty = 70_000)),
            ("status", Box::new(|a| a.status = Status::Dead)),
            (
                "faction",
                Box::new(|a| a.faction = FactionId::ALL[3].into()),
            ),
            (
                "weapon",
                Box::new(|a| a.weapon = Some(rh_sim::content::WeaponId::ALL[4])),
            ),
            (
                "windup",
                Box::new(|a| {
                    a.windup = Some(rh_sim::observe::WindupView {
                        kind: rh_sim::observe::WindupKind::Cast,
                        started_at: 1000.,
                        lands_at: 1450.,
                        a: Some(0.25),
                    })
                }),
            ),
            (
                "windup pushed",
                Box::new(|a| {
                    if let Some(w) = &mut a.windup {
                        w.lands_at = 1463.5;
                    }
                }),
            ),
            ("windup ended", Box::new(|a| a.windup = None)),
            ("zero", Box::new(|a| a.x = 0.0)),
            ("negative zero", Box::new(|a| a.x = -0.0)),
            ("off the grid", Box::new(|a| a.x = 1.0e9)),
            ("nan", Box::new(|a| a.y = f64::NAN)),
            ("good again", Box::new(|a| (a.x, a.y) = (10.0, 10.0))),
        ];
        for (name, edit) in edits {
            edit(&mut a);
            for round in 0..3 {
                assert_eq!(memo.get(&a), checked_actor(&a), "{name} round {round}");
            }
            // Another id never aliases it.
            let other = view(6);
            assert_eq!(memo.get(&other), checked_actor(&other), "{name}: other id");
            assert_eq!(memo.get(&a), checked_actor(&a), "{name}: after another id");
        }
        assert_eq!(checked_actor(&view(1)).map(|q| q.id), Ok(1));
        assert_eq!(
            checked_actor(&ActorView {
                x: 1.0e9,
                ..view(1)
            }),
            Err("position")
        );
        for id in [MEMO_IDS as u32 - 1, MEMO_IDS as u32, MEMO_IDS as u32 + 1000] {
            let v = view(id);
            assert_eq!(memo.get(&v), checked_actor(&v), "id {id}");
            assert_eq!(memo.get(&v), checked_actor(&v), "id {id} again");
        }
        assert!(memo.slots.len() <= MEMO_IDS);
    }

    /// The seed-1 160 x 160 map (and the nominal world) fits the u16 position grid, and over a whole match every remote
    /// actor a client decodes is within the documented error of the observation (position 1/16 u, facing 4.85e-5 rad),
    /// with the same ids, in the same order, and everything else exact (C-OBS: only the encoding changed).
    #[test]
    fn remote_actors_decode_within_the_documented_bound_over_a_match() {
        let mut env = seed1_match(1200);
        let tile = rh_sim::constants::TILE as f32;
        assert_eq!(env.sim.arena().map.w, 160);
        assert_eq!(env.sim.arena().map.h, 160);
        assert!(env.sim.arena().map.w as f32 * tile * POS_SCALE <= 65535.0);
        assert!(env.sim.arena().map.h as f32 * tile * POS_SCALE <= 65535.0);
        assert!(rh_sim::constants::WORLD_W as f32 <= POS_MAX);
        assert!(rh_sim::constants::WORLD_H as f32 <= POS_MAX);
        let ids: Vec<_> = env.sim.players().iter().map(|p| p.id).collect();
        let (mut actors_seen, mut worst_pos, mut worst_facing) = (0usize, 0f64, 0f64);
        for _ in 0..1200 {
            let out = env.step(&[]);
            for id in &ids {
                let obs = rh_sim::observe(&env.sim, *id, &out.events);
                let ServerMsg::Snapshot {
                    tick,
                    server_time,
                    me,
                    actors,
                    phase: p,
                    ack_input,
                    training: _,
                    owner_combat: _,
                } = ServerMsg::decode(&snapshot(&obs, 9).encode()).expect("decodes")
                else {
                    panic!("a snapshot")
                };
                assert_eq!((tick, ack_input, p), (obs.tick, 9, phase(obs.phase)));
                assert_eq!(server_time, obs.server_time);
                // Self is exact (the f32 of the sim's f64, as before).
                assert_eq!(
                    me.map(|m| (m.x, m.y)),
                    obs.me.as_ref().map(|m| (m.x as f32, m.y as f32))
                );
                assert_eq!(actors.len(), obs.visible.len());
                for (w, a) in actors.iter().zip(&obs.visible) {
                    actors_seen += 1;
                    assert_eq!(w.id, a.id.0);
                    assert_eq!(w.faction, a.faction.faction_id().unwrap().code());
                    assert_eq!(w.status, status(a.status));
                    assert_eq!(w.weapon, a.weapon.unwrap().code());
                    assert_eq!(w.bounty, sat16(a.bounty));
                    assert_eq!(w.hp_pct, hp_pct(a.hp_frac));
                    worst_pos = worst_pos
                        .max((w.x as f64 - a.x).abs())
                        .max((w.y as f64 - a.y).abs());
                    let tau = std::f64::consts::TAU;
                    let mut d = (w.facing as f64 - a.facing).rem_euclid(tau);
                    if d > tau / 2.0 {
                        d -= tau;
                    }
                    worst_facing = worst_facing.max(d.abs());
                }
            }
        }
        assert!(
            actors_seen > 1000,
            "the match must show remote actors: {actors_seen}"
        );
        // 1/16 u from the grid, plus the f32 rounding of the sim's f64 position (under 0.001 at 5120 u).
        assert!(worst_pos <= 0.0626, "position error {worst_pos}");
        // Remote facing is 8 bits (protocol 15): half of 2 pi / 256.
        assert!(worst_facing <= 0.01228, "facing error {worst_facing}");
    }

    /// `hp_pct` is the `round` expression it replaced for every fraction a match produces, ties and edges included.
    #[test]
    fn hp_pct_matches_the_f64_round_reference() {
        let reference = |f: f64| (f * 100.0).round().clamp(0.0, 100.0) as u8;
        for i in 0..=200_000u32 {
            let f = i as f64 / 100_000.0 - 0.5;
            assert_eq!(hp_pct(f), reference(f), "{f}");
        }
        for k in 0..=100u32 {
            for d in [-1i64, 0, 1] {
                let tie = (k as f64 + 0.5) / 100.0;
                let f = f64::from_bits((tie.to_bits() as i64 + d) as u64);
                assert_eq!(hp_pct(f), reference(f), "{f}");
            }
        }
        for f in [
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            -0.0,
            1e300,
            -1e300,
        ] {
            assert_eq!(hp_pct(f), reference(f), "{f}");
        }
    }

    /// An Fx frame with a swing off the position grid is refused and reported, not clamped (release) nor a panic in the
    /// room (debug); a good frame is the message's own bytes.
    #[test]
    fn an_fx_frame_off_the_grid_is_refused_not_clamped() {
        let swing = |x: f32| WireFx::Swing {
            by: 3,
            weapon: 1,
            x,
            y: 10.0,
            a: 0.5,
        };
        let mut refused = None;
        let good = ServerMsg::Fx {
            tick: 9,
            fx: vec![swing(100.0)],
        };
        assert_eq!(encode_or_refuse(&good, &mut refused), Some(good.encode()));
        assert!(refused.is_none());
        for x in [POS_MAX + 1.0, -1.0, f32::NAN] {
            let bad = ServerMsg::Fx {
                tick: 9,
                fx: vec![swing(100.0), swing(x)],
            };
            let mut refused = None;
            assert_eq!(encode_or_refuse(&bad, &mut refused), None, "{x}");
            assert_eq!(
                refused,
                Some(rh_protocol::EncodeError::BadValue("position"))
            );
        }
        // The first refusal of a wake is the one kept.
        let mut refused = Some(rh_protocol::EncodeError::NonFinite);
        let bad = ServerMsg::Fx {
            tick: 9,
            fx: vec![swing(-5.0)],
        };
        assert_eq!(encode_or_refuse(&bad, &mut refused), None);
        assert_eq!(refused, Some(rh_protocol::EncodeError::NonFinite));
    }

    #[test]
    fn omitted_effect_announcements_leave_frames_and_redaction_unchanged() {
        use rh_sim::status_runtime::{AbilityId, StatusKind};
        assert_eq!(rh_protocol::PROTOCOL_VERSION, 15);
        let env = seed1_match(1);
        let id = env.sim.players()[0].id;
        let mut publisher = Publisher::default();
        let baseline = publisher.frames(&env.sim, id, 7, &[], &mut Vec::new(), &[]);
        assert!(baseline.important.is_none() && baseline.fx.is_none());
        for by in [None, Some(id)] {
            // These are already-observed carry events, the input boundary of this wire adapter.
            let omitted = vec![
                SeenEvent::AbilityHit {
                    victim: id,
                    by,
                    ability: AbilityId::Blaze,
                    amount: 3.,
                },
                SeenEvent::StatusApplied {
                    id,
                    by,
                    kind: StatusKind::Hidden,
                    ms: 500.,
                },
                SeenEvent::SignatureHit {
                    victim: id,
                    by,
                    sig: rh_sim::factions::SignatureKind::Burn,
                    weapon: None,
                    amount: 3.,
                },
                SeenEvent::Heal { id, amount: 3. },
            ];
            let mut carry = omitted.clone();
            let frames = publisher.frames(&env.sim, id, 7, &[], &mut carry, &[]);
            assert!(carry.is_empty());
            assert!(frames.important.is_none() && frames.fx.is_none() && frames.refused.is_none());
            assert_eq!(frames.snapshot, baseline.snapshot);
            assert_eq!(publisher.observation().events, omitted);

            let mut carry = omitted;
            carry.push(SeenEvent::Hit {
                victim: id,
                by,
                amount: 2.,
                passive: true,
            });
            let frames = publisher.frames(&env.sim, id, 7, &[], &mut carry, &[]);
            assert!(frames.important.is_none() && frames.refused.is_none());
            assert_eq!(frames.snapshot, baseline.snapshot);
            let expected = ServerMsg::Fx {
                tick: env.sim.tick(),
                fx: vec![WireFx::Hit {
                    victim: id.0,
                    by: by.map_or(WIRE_NO_SOURCE, |p| p.0),
                    amount: 2.,
                    passive: true,
                }],
            }
            .try_encode()
            .unwrap();
            assert_eq!(frames.fx, Some(expected));
            let empty = publisher.frames(&env.sim, id, 7, &[], &mut Vec::new(), &[]);
            assert!(empty.fx.is_none() && empty.important.is_none());
        }
    }

    #[test]
    fn combat_mapping_preserves_privacy_passive_and_channels() {
        use rh_sim::{PickupRefusal, PlayerId};
        let id = PlayerId(2);
        assert!(matches!(
            to_wire(&SeenEvent::Death { id, by: None }),
            Wire::Event(WireEvent::Death { id: 2, by: None })
        ));
        for passive in [false, true] {
            let e = SeenEvent::Hit {
                victim: id,
                by: None,
                amount: 3.0,
                passive,
            };
            assert_eq!(e.class(), Class::Fx);
            assert!(
                matches!(to_wire(&e), Wire::Fx(WireFx::Hit { by: WIRE_NO_SOURCE, passive: p, .. }) if p == passive)
            );
        }
        for by in [None, Some(PlayerId(1))] {
            let e = SeenEvent::Block {
                id,
                by,
                weapon: rh_sim::content::WeaponId::ALL[1],
            };
            assert_eq!(e.class(), Class::Fx);
            assert!(
                matches!(to_wire(&e), Wire::Fx(WireFx::Block { by: b, .. }) if b == by.map_or(WIRE_NO_SOURCE, |p| p.0))
            );
        }
        assert!(matches!(
            to_wire(&SeenEvent::Stagger { id }),
            Wire::Fx(WireFx::Stagger { id: 2 })
        ));
        assert!(matches!(
            to_wire(&SeenEvent::AttackCancelled { id }),
            Wire::Omitted
        ));
        assert!(matches!(
            to_wire(&SeenEvent::Heal { id, amount: 1.0 }),
            Wire::Omitted
        ));
        for by in [None, Some(PlayerId(1))] {
            for kind in rh_sim::status_runtime::STATUS_KINDS {
                assert!(matches!(
                    to_wire(&SeenEvent::StatusApplied {
                        id,
                        by,
                        kind,
                        ms: 500.
                    }),
                    Wire::Omitted
                ));
            }
            for ability in rh_sim::status_runtime::AbilityId::ALL {
                assert!(matches!(
                    to_wire(&SeenEvent::AbilityHit {
                        victim: id,
                        by,
                        ability,
                        amount: 10.
                    }),
                    Wire::Omitted
                ));
            }
        }
        for ability in rh_sim::status_runtime::AbilityId::ALL {
            for reason in [
                rh_sim::status_runtime::CastEndReason::Fizzle,
                rh_sim::status_runtime::CastEndReason::Interrupted,
                rh_sim::status_runtime::CastEndReason::Cancelled,
            ] {
                assert!(matches!(
                    to_wire(&SeenEvent::CastEnded {
                        event_time: 100.,
                        id,
                        ability,
                        reason
                    }),
                    Wire::Fx(WireFx::WishEnded {
                        event_time: 100.,
                        ..
                    })
                ));
            }
        }
        for (by, sig) in [None, Some(id)]
            .into_iter()
            .flat_map(|by| rh_sim::factions::SignatureKind::ALL.map(|sig| (by, sig)))
        {
            assert!(matches!(
                to_wire(&SeenEvent::SignatureHit {
                    victim: id,
                    by,
                    sig,
                    weapon: Some(rh_sim::WeaponId::Axe),
                    amount: 10.
                }),
                Wire::Omitted
            ));
        }
        for (reason, code) in [
            (PickupRefusal::Blocked, 1),
            (PickupRefusal::NothingThere, 2),
            (PickupRefusal::TooFar, 3),
            (PickupRefusal::Unreachable, 4),
            (PickupRefusal::NothingToTake, 5),
        ] {
            let e = SeenEvent::PickupRefused { reason };
            assert_eq!(e.class(), Class::Important);
            assert!(
                matches!(to_wire(&e), Wire::Event(WireEvent::PickupRefused { reason: r }) if r == code)
            );
        }
        assert!(matches!(
            command(WireCommand::Swap { slot: None }),
            rh_sim::PublicCommand::Swap { slot: None }
        ));
        assert!(matches!(
            command(WireCommand::Pickup {
                handle: rh_protocol::PickupHandle::new(42).unwrap()
            }),
            rh_sim::PublicCommand::Pickup { handle } if handle.get()==42
        ));
    }

    fn flat_arena(w: u32, h: u32) -> rh_sim::Arena {
        rh_sim::Arena {
            map: rh_sim::TileMap::new(w, h, vec![0; (w * h) as usize]).expect("map"),
            spawns: vec![rh_sim::Vec2::new(48.0, 48.0)],
        }
    }

    /// 255 tiles (8160 u) fits the position grid; 256 (8192 u) does not, on either axis, and the refusal names the limit.
    #[test]
    fn an_arena_larger_than_the_position_grid_is_refused() {
        assert!(arena_fits(&flat_arena(255, 255)).is_ok());
        assert!(arena_fits(&flat_arena(160, 160)).is_ok());
        for (w, h) in [(256, 4), (4, 256), (300, 300)] {
            let e = arena_fits(&flat_arena(w, h)).expect_err("too large");
            assert!(e.contains("8191.875") && e.contains("255 tiles"), "{e}");
        }
        let mut a = flat_arena(8, 8);
        a.spawns.push(rh_sim::Vec2::new(9000.0, 1.0));
        assert!(arena_fits(&a).expect_err("spawn").contains("spawn"));
        assert!(arena_fits(&rh_sim::arenas::practice_arena()).is_ok());
    }
    #[test]
    fn pve_commands_and_notices_keep_normal_public_semantics() {
        assert_eq!(
            command(WireCommand::UseConsumable),
            rh_sim::PublicCommand::UseConsumable
        );
        assert_eq!(
            command(WireCommand::Target { actor: 0x8000_0201 }),
            rh_sim::PublicCommand::Target {
                actor: rh_sim::PlayerId(0x8000_0201)
            }
        );
        assert_eq!(
            command(WireCommand::HuntTarget { actor: 2 }),
            rh_sim::PublicCommand::HuntTarget {
                actor: rh_sim::PlayerId(2)
            }
        );
        assert_eq!(
            command(WireCommand::AttackMove {
                x: 12.5,
                y: 20.,
                seq: Some(9)
            }),
            rh_sim::PublicCommand::AttackMove {
                x: 12.5,
                y: 20.,
                seq: Some(9)
            }
        );
        assert_eq!(
            command(WireCommand::Cast {
                slot: 0,
                x: 12.5,
                y: 20.0,
                actor: Some(17),
                t: Some(777.0),
                seq: Some(9),
            }),
            rh_sim::PublicCommand::Cast {
                slot: rh_sim::abilities::Slot::Wish,
                x: 12.5,
                y: 20.0,
                id: Some(rh_sim::PlayerId(17)),
                t: Some(777.0),
                seq: Some(9),
            }
        );
        use rh_sim::potions::Notice::*;
        for (notice, code) in [Stored, BagFull, Used, Blocked, Busy, Full, Empty]
            .into_iter()
            .zip(1..=7)
        {
            let event = SeenEvent::PotionNotice { notice };
            assert_eq!(event.class(), Class::Important);
            assert!(
                matches!(to_wire(&event),Wire::Event(WireEvent::PotionNotice {notice:n}) if n==code)
            );
        }
        let env = seed1_match(2);
        let id = env.sim.players()[0].id;
        let mut own = rh_sim::observe(&env.sim, id, &[]).me.unwrap();
        own.barrier = 12.5;
        own.barrier_ring_step = 4;
        own.wish = Some(rh_sim::abilities::OwnerView {
            ability: rh_sim::status_runtime::AbilityId::Freeze,
            ready_at: 12.0,
            full_at: Some(42.0),
            max_charges: 1,
            recharge_ms: 45_000.0,
            charges: 1,
            next_charge_at: None,
            cast: Some(rh_sim::abilities::CastView {
                ability: rh_sim::status_runtime::AbilityId::Freeze,
                started_at: 10.0,
                lands_at: 260.0,
            }),
        });
        own.sig = 255;
        let owner_wire = wire_self(&own);
        assert_eq!(owner_wire.sig, 255);
        assert_eq!(
            (owner_wire.barrier, owner_wire.barrier_ring_step),
            (12.5, 4)
        );
        let wish = owner_wire.wish.unwrap();
        assert_eq!(wish.ability, 0, "Freeze keeps its protocol ability code");
        assert_eq!(
            (
                wish.ready_at,
                wish.full_at,
                wish.max_charges,
                wish.recharge_ms,
                wish.charges,
                wish.next_charge_at,
                wish.cast.unwrap().started_at,
                wish.cast.unwrap().lands_at,
            ),
            (12.0, Some(42.0), 1, 45_000.0, 1, None, 10.0, 260.0)
        );
        own.sig = 0;
        assert_eq!(wire_self(&own).sig, 0);
        let mut actor = view(9);
        actor.barrier_frac = 0.25;
        actor.barrier_ring_step = 3;
        actor.sig = 255;
        actor.mob_type = Some(rh_sim::mob_catalog::MobTypeId::Archon);
        let wire = wire_actor(&actor).unwrap();
        assert_eq!((wire.sig, wire.mob_type_code), (255, 30));
        assert_eq!((wire.barrier_pct, wire.barrier_ring_step), (25, 3));
        actor.sig = 0;
        actor.mob_type = None;
        let wire = wire_actor(&actor).unwrap();
        assert_eq!((wire.sig, wire.mob_type_code), (0, 0));
    }

    #[test]
    fn target_conversion_never_bypasses_observer_delivery() {
        use rh_sim::{ItemObserver, Placement, PlayerId, Secrets, Sim, Vec2};
        let sim = Sim::reset_active(
            SimConfig::default(),
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(7),
            &[
                Placement {
                    profile: "viewer".into(),
                    faction: FactionId::Holy,
                    bot: false,
                    at: Vec2::new(100., 272.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
                Placement {
                    profile: "other".into(),
                    faction: FactionId::Fire,
                    bot: false,
                    at: Vec2::new(120., 272.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
            ],
        );
        let mut observer = ItemObserver::new(PlayerId(1));
        let proposal = command(WireCommand::Target { actor: 2 });
        let missing = rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap();
        assert_eq!(observer.resolve(&sim, proposal).unwrap(), missing);
        let mut obs = Observation::default();
        drop(observer.prepare_into(&sim, &[], &mut obs, None).unwrap());
        assert_eq!(observer.resolve(&sim, proposal).unwrap(), missing);
        observer
            .prepare_into(&sim, &[], &mut obs, None)
            .unwrap()
            .commit();
        assert_eq!(
            observer.resolve(&sim, proposal).unwrap(),
            rh_sim::validate(rh_sim::RawCommand::Target { id: PlayerId(2) }).unwrap()
        );
        assert_eq!(
            observer
                .resolve(&sim, command(WireCommand::Target { actor: 0x8000_0201 }))
                .unwrap(),
            missing
        );
        assert_eq!(
            observer
                .resolve(&sim, command(WireCommand::Target { actor: 999 }))
                .unwrap(),
            missing
        );
    }

    #[test]
    fn protocol_8_training_frames_carry_the_training_set() {
        let config = SimConfig {
            min_players: 1,
            lobby_seconds: 0.,
            fill_seconds: 0.,
            training: true,
            dummies: true,
            ..Default::default()
        };
        let mut sim = rh_sim::Sim::new(
            config,
            rh_sim::arenas::practice_arena(),
            rh_sim::Secrets::from_seed(7),
        );
        sim.add_player("p0", Some(FactionId::Holy), false).unwrap();
        sim.step();
        let id = sim.players()[0].id;
        let obs = rh_sim::observe(&sim, id, &[]);
        assert!(obs.training, "a training observation says so");
        let ServerMsg::Snapshot { training, .. } = snapshot(&obs, 0) else {
            panic!("a snapshot")
        };
        assert!(training, "the training head bit reaches the wire");
        let public = command(WireCommand::Train {
            command: 4,
            id: 0,
            count: 0,
            options: [3, 7, 12],
            option_count: 3,
        });
        match public {
            rh_sim::PublicCommand::Train(raw) => assert_eq!(
                (
                    raw.command,
                    raw.id,
                    raw.count,
                    raw.options,
                    raw.option_count
                ),
                (4, 0, 0, [3, 7, 12], 3)
            ),
            _ => panic!("a train command maps to the public console proposal"),
        }
        let Wire::Event(WireEvent::Toast { ref text }) = to_wire(&SeenEvent::Toast {
            text: "Slow down".into(),
        }) else {
            panic!("an owner-only toast maps to the protocol 8 event")
        };
        let frame = ServerMsg::Events {
            tick: 1,
            events: vec![WireEvent::Toast { text: text.clone() }],
        }
        .encode();
        assert!(matches!(
            ServerMsg::decode(&frame),
            Ok(ServerMsg::Events { .. })
        ));
    }
    #[test]
    fn invalid_giver_and_unarmed_views_refuse_before_publisher_work() {
        use rh_sim::{fighter::FighterAffiliation, observe::ActorKind};
        let mut publisher = Publisher::default();
        let good = view(5);
        let expected = publisher.actors.get(&good);
        let before = publisher.actors.slots.clone();
        for actor in [
            ActorView {
                kind: ActorKind::QuestGiver,
                ..good.clone()
            },
            ActorView {
                faction: FighterAffiliation::Neutral,
                ..good.clone()
            },
            ActorView {
                weapon: None,
                ..good.clone()
            },
            ActorView {
                kind: ActorKind::QuestGiver,
                faction: FighterAffiliation::Neutral,
                weapon: None,
                mob_type: Some(rh_sim::mob_catalog::MobTypeId::Archon),
                ..good.clone()
            },
            ActorView {
                kind: ActorKind::QuestGiver,
                faction: FighterAffiliation::Neutral,
                weapon: Some(rh_sim::WeaponId::Fists),
                ..good.clone()
            },
        ] {
            assert!(checked_actor(&actor).is_err());
            publisher.obs.visible = vec![good.clone(), actor];
            assert!(checked_snapshot(&publisher.obs, 0).is_err());
            // Full, delta's spare buffer, and a new/resync publisher share this strict gate.
            for spare in [
                None,
                Some(
                    SnapshotData::build(0, 1, 0, None, [wire_actor(&good).unwrap()].into_iter())
                        .unwrap(),
                ),
            ] {
                let frames =
                    publisher.build_observation_frames(spare, good.id, 0, &mut Vec::new(), &[]);
                assert!(frames.snapshot.is_err() && frames.refused.is_some());
                assert!(frames.important.is_none() && frames.fx.is_none());
                assert_eq!(
                    publisher.actors.slots, before,
                    "refusal must not quantize/cache a prefix"
                );
            }
            let mut fresh = Publisher {
                obs: publisher.obs.clone(),
                ..Default::default()
            };
            assert!(fresh
                .build_observation_frames(None, good.id, 0, &mut Vec::new(), &[])
                .snapshot
                .is_err());
            assert!(fresh.actors.slots.is_empty());
        }
        assert_eq!(publisher.actors.get(&good), expected);
    }

    #[test]
    fn giver_actor_mapping_preserves_source_fields_and_memo() {
        use rh_sim::{fighter::FighterAffiliation, observe::ActorKind};
        let giver = ActorView {
            kind: ActorKind::QuestGiver,
            faction: FighterAffiliation::Neutral,
            weapon: None,
            mob_type: None,
            hp_frac: 0.37,
            barrier_frac: 0.25,
            barrier_ring_step: 3,
            status: Status::Mia,
            effects: 0x1234,
            sig: 73,
            displace_seq: 9,
            bounty: 17,
            ..view(7)
        };
        let wire = wire_actor(&giver).unwrap();
        assert_eq!(
            (wire.kind, wire.faction, wire.weapon, wire.mob_type_code),
            (4, 15, 15, 0)
        );
        assert_eq!(
            (wire.hp_pct, wire.barrier_pct, wire.barrier_ring_step),
            (37, 25, 3)
        );
        assert_eq!(
            (
                wire.status,
                wire.effects,
                wire.sig,
                wire.displace_seq,
                wire.bounty
            ),
            (3, 0x1234, 73, 9, 17)
        );
        assert_eq!(
            (wire.x, wire.y, wire.facing),
            (giver.x as f32, giver.y as f32, giver.facing as f32)
        );
        let mut memo = ActorMemo::default();
        assert_eq!(memo.get(&giver), checked_actor(&giver));
        let mut changed = giver.clone();
        changed.hp_frac = 0.41;
        assert_ne!(memo.get(&changed), checked_actor(&giver));
        assert_eq!(memo.get(&changed), checked_actor(&changed));
        changed.kind = ActorKind::Player;
        changed.faction = FactionId::Holy.into();
        changed.weapon = Some(rh_sim::WeaponId::Fists);
        assert_eq!(memo.get(&changed), checked_actor(&changed));
        assert_ne!(memo.get(&changed).unwrap().kind, 4);
        for spare in [
            None,
            Some(SnapshotData::build(0, 1, 0, None, [wire].into_iter()).unwrap()),
        ] {
            let mut publisher = Publisher::default();
            publisher.obs.visible = vec![giver.clone()];
            let frames = publisher.build_observation_frames(
                spare,
                rh_sim::PlayerId(1),
                0,
                &mut Vec::new(),
                &[],
            );
            assert!(frames.refused.is_none());
            let data = frames.snapshot.unwrap();
            let decoded = data.decoded();
            let bytes = decoded.try_encode().unwrap();
            assert_eq!(ServerMsg::decode(&bytes).unwrap(), decoded);
        }
    }

    #[test]
    fn giver_native_alias_prepare_drop_renewal_and_target_resolution() {
        use rh_sim::{ItemObserver, Placement, PlayerId, PublicCommand, Secrets, Sim, Vec2};
        let arena = source_arena();
        let config = SimConfig {
            quests: true,
            pvp_rules: false,
            ..Default::default()
        };
        let at = arena.spawns[0];
        let peer = arena.spawns[1];
        let placements = |at: Vec2| {
            [
                Placement {
                    profile: "giver-viewer".into(),
                    faction: FactionId::Holy,
                    bot: false,
                    at,
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
                Placement {
                    profile: "giver-peer".into(),
                    faction: FactionId::Fire,
                    bot: false,
                    at: peer,
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
            ]
        };
        let genesis = Sim::reset_active(
            config.clone(),
            arena.clone(),
            Secrets::from_seed(7),
            &placements(at),
        );
        let mut scout = ItemObserver::new(PlayerId(1));
        let mut obs = Observation::default();
        scout.observe_into(&genesis, &[], &mut obs, None).unwrap();
        let giver_at = obs
            .quests
            .as_ref()
            .unwrap()
            .rows
            .iter()
            .find(|r| r.state == rh_sim::quest_view::RowState::Open)
            .unwrap()
            .giver;
        let sim = Sim::reset_active(config, arena, Secrets::from_seed(7), &placements(giver_at));
        let mut observer = ItemObserver::new(PlayerId(1));
        let mut publisher = Publisher::default();
        let (frames, offer) = publisher
            .frames_prepared(&mut observer, None, &sim, 0, &[], &mut Vec::new(), &[])
            .unwrap();
        assert!(frames.refused.is_none());
        let giver = publisher
            .observation()
            .visible
            .iter()
            .find(|a| a.kind == rh_sim::observe::ActorKind::QuestGiver)
            .expect("actual native giver in entitled scene")
            .clone();
        assert!(u64::from(giver.id.0) >= (1u64 << 31));
        let decoded =
            ServerMsg::decode(&frames.snapshot.unwrap().decoded().try_encode().unwrap()).unwrap();
        assert!(
            matches!(decoded,ServerMsg::Snapshot{actors,..} if actors.iter().any(|a|a.id==giver.id.0 && a.kind==4 && a.faction==15 && a.weapon==15 && a.mob_type_code==0))
        );
        drop(offer);
        let proposal = PublicCommand::Target { actor: giver.id };
        let missing = rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap();
        assert_eq!(
            observer.resolve(&sim, proposal).unwrap(),
            missing,
            "prepared alias grants no capability"
        );
        let (_, offer) = publisher
            .frames_prepared(&mut observer, None, &sim, 0, &[], &mut Vec::new(), &[])
            .unwrap();
        let issued = publisher
            .observation()
            .visible
            .iter()
            .find(|a| {
                a.kind == rh_sim::observe::ActorKind::QuestGiver && a.x == giver.x && a.y == giver.y
            })
            .unwrap()
            .id;
        assert_eq!(issued, giver.id, "drop does not consume a namespace block");
        offer.commit();
        assert_ne!(
            observer.resolve(&sim, proposal).unwrap(),
            missing,
            "normal target resolve uses committed alias, not quest IDs"
        );
        let mut replacement = observer.renewed();
        let (_, offer) = publisher
            .frames_prepared(&mut replacement, None, &sim, 0, &[], &mut Vec::new(), &[])
            .unwrap();
        let next = publisher
            .observation()
            .visible
            .iter()
            .find(|a| {
                a.kind == rh_sim::observe::ActorKind::QuestGiver && a.x == giver.x && a.y == giver.y
            })
            .unwrap()
            .id;
        assert_ne!(next, issued);
        drop(offer);
        drop(replacement);
        assert_ne!(
            observer.resolve(&sim, proposal).unwrap(),
            missing,
            "failed replacement retains committed giver alias"
        );
        let mut replacement = observer.renewed();
        let (_, offer) = publisher
            .frames_prepared(&mut replacement, None, &sim, 0, &[], &mut Vec::new(), &[])
            .unwrap();
        offer.commit();
        observer = replacement;
        assert_eq!(
            observer.resolve(&sim, proposal).unwrap(),
            missing,
            "successful replacement revokes old NPC alias"
        );
        assert_ne!(
            observer
                .resolve(&sim, PublicCommand::Target { actor: next })
                .unwrap(),
            missing
        );
    }

    #[test]
    fn quest_hosting_is_supported_and_incompatible_training_is_refused() {
        let config = rh_sim::SimConfig {
            quests: true,
            ..Default::default()
        };
        assert!(profile_supported(&config).is_ok());
        assert!(profile_supported(&rh_sim::SimConfig {
            training: true,
            ..config
        })
        .is_err());
        let obs = Observation {
            quests: Some(rh_sim::quest_view::QuestView::default()),
            ..Default::default()
        };
        assert!(observation_supported(&obs).is_ok());
        assert!(profile_supported(&rh_sim::SimConfig::default()).is_ok());
    }
}
