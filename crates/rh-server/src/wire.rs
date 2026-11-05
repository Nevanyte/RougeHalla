//! Conversions between simulation types and wire types (rh-protocol stays independent of the sim). Codes are the protocol's
//! (docs/CONTRACTS.md C-NET-3): status 0 lobby, 1 alive, 2 dead, 3 mia; phase 0 lobby, 1 active, 2 ended; outcome 0 won,
//! 1 draw, 2 died, 3 mia; faction and weapon codes are the content tables' order.

use rh_protocol::quant::POS_MAX;
use rh_protocol::{
    QActor, ServerMsg, SnapshotData, WireActor, WireCommand, WireEvent, WireFx, WireResult,
    WireSelf,
};
use rh_sim::observe::{ActorView, Observation, SeenEvent};
use rh_sim::sim::{Outcome, Phase, Status};
use rh_sim::Class;
use rh_sim::{RawCommand, RunResult};

pub fn command(c: WireCommand) -> RawCommand {
    match c {
        WireCommand::Move { x, y, seq } => RawCommand::Move {
            x: x as f64,
            y: y as f64,
            seq,
        },
        WireCommand::Swap { slot } => RawCommand::Swap { slot },
        WireCommand::Pickup { container_id } => RawCommand::Pickup { container_id },
        WireCommand::Stop { seq } => RawCommand::Stop { seq },
        WireCommand::Aim { a } => RawCommand::Aim { a: a as f64 },
        WireCommand::Attack { a, t } => RawCommand::Attack { a: a as f64, t },
        WireCommand::Release { a, t } => RawCommand::Release { a: a as f64, t },
    }
}

pub fn status(s: Status) -> u8 {
    match s {
        Status::Lobby => 0,
        Status::Alive => 1,
        Status::Dead => 2,
        Status::Mia => 3,
    }
}

pub fn phase(p: Phase) -> u8 {
    match p {
        Phase::Lobby => 0,
        Phase::Active => 1,
        Phase::Ended => 2,
    }
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

fn sat16(v: u32) -> u16 {
    v.min(u16::MAX as u32) as u16
}

fn wire_self(m: &rh_sim::observe::SelfView) -> WireSelf {
    WireSelf {
        id: m.id.0,
        faction: m.faction.code(),
        x: m.x as f32,
        y: m.y as f32,
        facing: m.facing as f32,
        hp: m.hp as f32,
        max_hp: m.max_hp as f32,
        status: status(m.status),
        weapon: m.weapon.code(),
        ready_in_ms: m.ready_in_ms.min(u16::MAX as f64) as u16,
        kills: sat16(m.kills),
        bounty: sat16(m.bounty),
        gv: sat16(m.gv),
        move_seq: m.move_seq,
    }
}

/// Health as a whole percent, 0 to 100: `(f * 100).round()` clamped (half away from zero, NaN is 0) without the libm
/// `round` call; a test holds it equal to that expression.
#[inline]
fn hp_pct(f: f64) -> u8 {
    rh_protocol::quant::round_half_away(f * 100.0).clamp(0, 100) as u8
}

fn wire_actor(a: &rh_sim::observe::ActorView) -> WireActor {
    WireActor {
        id: a.id.0,
        faction: a.faction.code(),
        x: a.x as f32,
        y: a.y as f32,
        facing: a.facing as f32,
        hp_pct: hp_pct(a.hp_frac),
        status: status(a.status),
        weapon: a.weapon.code(),
        bounty: sat16(a.bounty),
        // Every actor is a player today; a mob packet maps its kind here (the id namespace is shared: docs/adr/0011).
        kind: 0,
    }
}

pub fn snapshot(obs: &Observation, ack_input: u32) -> ServerMsg {
    ServerMsg::Snapshot {
        tick: obs.tick,
        phase: phase(obs.phase),
        ack_input,
        me: obs.me.as_ref().map(wire_self),
        actors: obs.visible.iter().map(wire_actor).collect(),
    }
}

/// An actor checked and quantized for the wire: [`QActor::checked`] of its [`wire_actor`].
#[inline]
fn checked_actor(a: &ActorView) -> Result<QActor, &'static str> {
    QActor::checked(&wire_actor(a))
}

/// Whether two views are the same actor state, bit for bit (`0.0` and `-0.0`, or two NaNs, never count as equal).
#[inline]
fn same_view(a: &ActorView, b: &ActorView) -> bool {
    a.id == b.id
        && a.x.to_bits() == b.x.to_bits()
        && a.y.to_bits() == b.y.to_bits()
        && a.facing.to_bits() == b.facing.to_bits()
        && a.hp_frac.to_bits() == b.hp_frac.to_bits()
        && a.bounty == b.bounty
        && a.status == b.status
        && a.faction == b.faction
        && a.weapon == b.weapon
}

/// Source absent or redacted by observation: no actor has this sentinel (Hit and Block).
const WIRE_NO_SOURCE: u32 = u32::MAX;

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

/// Each observed event's explicit protocol-5 treatment. Exhaustive over [`SeenEvent`] (no wildcard): a new core
/// event needs a deliberate wire mapping or an explicit omission until a compatible transport is implemented.
enum Wire {
    Event(WireEvent),
    Fx(WireFx),
    OmittedInV5,
}

fn to_wire(e: &SeenEvent) -> Wire {
    match *e {
        SeenEvent::Death { id, by } => Wire::Event(WireEvent::Death {
            id: id.0,
            by: by.map(|b| b.0),
        }),
        SeenEvent::Bounty { id, bounty } => Wire::Event(WireEvent::Bounty {
            id: id.0,
            bounty: sat16(bounty),
        }),
        SeenEvent::Ended { winner, draw } => Wire::Event(WireEvent::MatchEnded {
            winner: winner.map(|w| w.0),
            draw,
        }),
        SeenEvent::Block { id, by, weapon } => Wire::Fx(WireFx::Block {
            id: id.0,
            by: by.map_or(WIRE_NO_SOURCE, |b| b.0),
            weapon: weapon.code(),
        }),
        SeenEvent::Stagger { id } => Wire::Fx(WireFx::Stagger { id: id.0 }),
        // Target locking is currently a core/policy/headless feature. Protocol 5 has no cancel telegraph.
        SeenEvent::AttackCancelled { .. } => Wire::OmittedInV5,
        SeenEvent::SignatureHit { .. } | SeenEvent::Heal { .. } => Wire::OmittedInV5,
        SeenEvent::PickupRefused { reason } => Wire::Event(WireEvent::PickupRefused {
            reason: match reason {
                rh_sim::PickupRefusal::Blocked => 1,
                rh_sim::PickupRefusal::NothingThere => 2,
                rh_sim::PickupRefusal::TooFar => 3,
                rh_sim::PickupRefusal::Unreachable => 4,
                rh_sim::PickupRefusal::NothingToTake => 5,
            },
        }),
        SeenEvent::Swing {
            by,
            weapon,
            x,
            y,
            a,
        } => Wire::Fx(WireFx::Swing {
            by: by.0,
            weapon: weapon.code(),
            x: x as f32,
            y: y as f32,
            a: a as f32,
        }),
        SeenEvent::Hit {
            victim,
            by,
            amount,
            passive,
        } => Wire::Fx(WireFx::Hit {
            victim: victim.0,
            by: by.map_or(WIRE_NO_SOURCE, |b| b.0),
            amount: amount as f32,
            passive,
        }),
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

/// The publish path: the observation, its wire forms and the frames, with every intermediate buffer kept between viewers
/// and ticks. The room and wirebench both call [`Publisher::frames`], so the bench measures the production path.
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

    /// The observation of the last [`Publisher::frames`] call.
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
        rh_sim::observe_into_cached(sim, viewer, last_step, &mut self.obs, &mut self.sight);
        if !earlier.is_empty() {
            earlier.append(&mut self.obs.events);
            std::mem::swap(earlier, &mut self.obs.events);
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
                Wire::OmittedInV5 => {}
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
        let snapshot = SnapshotData::build_checked(
            spare,
            tick,
            phase(self.obs.phase),
            ack_input,
            self.obs.me.as_ref().map(wire_self),
            self.obs.visible.iter().map(|a| memo.get(a)),
        );
        ViewFrames {
            important,
            fx,
            snapshot,
            refused,
        }
    }
}

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

pub fn result(r: &RunResult) -> WireResult {
    WireResult {
        outcome: match r.outcome {
            Outcome::Won => 0,
            Outcome::Draw => 1,
            Outcome::Died => 2,
            Outcome::Mia => 3,
        },
        place: r.place.min(255) as u8,
        players: r.players.min(255) as u8,
        kills: sat16(r.kills),
        killed_by: r.killed_by.clone(),
        gv_total: r.gv.total,
        gv_win: r.gv.win,
        duration_sec: r.duration_sec,
        win_bonus_withheld: r.win_bonus_withheld,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
    use rh_policy::scripted::Brawler;
    use rh_protocol::quant::POS_SCALE;
    use rh_protocol::{snapshot_server_ms, TICK_MS};
    use rh_sim::{FactionId, SimConfig};

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

    /// The v2 Snapshot carries no server time because it is always `tick x 50 ms`: the simulation starts at 0 and adds
    /// exactly one tick step per step, and an integer multiple of 50 is exact in f64.
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
                let want = SnapshotData::build(
                    obs.tick,
                    phase(obs.phase),
                    t,
                    obs.me.as_ref().map(wire_self),
                    obs.visible.iter().map(wire_actor),
                )
                .expect("builds");
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
            sig: 0,
            id: rh_sim::PlayerId(id),
            faction: FactionId::ALL[1],
            x: 100.3,
            y: 50.7,
            facing: 0.5,
            hp_frac: 0.75,
            status: Status::Alive,
            weapon: rh_sim::content::WeaponId::ALL[2],
            bounty: 3,
        }
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
            ("x", Box::new(|a| a.x = 101.25)),
            ("y", Box::new(|a| a.y = 51.0)),
            ("facing", Box::new(|a| a.facing = -2.0)),
            ("hp", Box::new(|a| a.hp_frac = 0.01)),
            ("bounty", Box::new(|a| a.bounty = 70_000)),
            ("status", Box::new(|a| a.status = Status::Dead)),
            ("faction", Box::new(|a| a.faction = FactionId::ALL[3])),
            (
                "weapon",
                Box::new(|a| a.weapon = rh_sim::content::WeaponId::ALL[4]),
            ),
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
                    me,
                    actors,
                    phase: p,
                    ack_input,
                } = ServerMsg::decode(&snapshot(&obs, 9).encode()).expect("decodes")
                else {
                    panic!("a snapshot")
                };
                assert_eq!((tick, ack_input, p), (obs.tick, 9, phase(obs.phase)));
                // Self is exact (the f32 of the sim's f64, as before).
                assert_eq!(
                    me.map(|m| (m.x, m.y)),
                    obs.me.as_ref().map(|m| (m.x as f32, m.y as f32))
                );
                assert_eq!(actors.len(), obs.visible.len());
                for (w, a) in actors.iter().zip(&obs.visible) {
                    actors_seen += 1;
                    assert_eq!(w.id, a.id.0);
                    assert_eq!(w.faction, a.faction.code());
                    assert_eq!(w.status, status(a.status));
                    assert_eq!(w.weapon, a.weapon.code());
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
        assert!(worst_facing <= 4.9e-5, "facing error {worst_facing}");
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
            Wire::OmittedInV5
        ));
        assert!(matches!(
            to_wire(&SeenEvent::Heal { id, amount: 1.0 }),
            Wire::OmittedInV5
        ));
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
                Wire::OmittedInV5
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
            RawCommand::Swap { slot: None }
        ));
        assert!(matches!(
            command(WireCommand::Pickup { container_id: 42 }),
            RawCommand::Pickup { container_id: 42 }
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
}
