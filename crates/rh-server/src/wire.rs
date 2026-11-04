//! Conversions between simulation types and wire types (rh-protocol stays independent of the sim). Codes are the protocol's
//! (docs/CONTRACTS.md C-NET-3): status 0 lobby, 1 alive, 2 dead, 3 mia; phase 0 lobby, 1 active, 2 ended; outcome 0 won,
//! 1 draw, 2 died, 3 mia; faction and weapon codes are the content tables' order.

use rh_protocol::quant::POS_MAX;
use rh_protocol::{
    ServerMsg, SnapshotData, WireActor, WireCommand, WireEvent, WireFx, WireResult, WireSelf,
};
use rh_sim::observe::{Observation, SeenEvent};
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

/// The Snapshot frame of `obs`: byte-identical to `snapshot(obs, ack_input).try_encode()`, but streamed actor by actor
/// into the caller's reused `scratch` buffer, so no `Vec<WireActor>` is built and the only allocation is the returned
/// frame (one block of exactly its size, which the outbox then owns). An observation the codec refuses (a position off the
/// wire grid) is an error, never a repaired frame.
pub fn encode_snapshot(
    obs: &Observation,
    ack_input: u32,
    scratch: &mut Vec<u8>,
) -> Result<Vec<u8>, rh_protocol::EncodeError> {
    scratch.clear();
    let me = obs.me.as_ref().map(wire_self);
    rh_protocol::encode_snapshot_into(
        scratch,
        obs.tick,
        phase(obs.phase),
        ack_input,
        me.as_ref(),
        obs.visible.iter().map(wire_actor),
    )?;
    Ok(scratch.clone())
}

/// The snapshot of `obs` as the wire data a connection's writer encodes (protocol v3): the actors quantized, the self at full
/// precision, validated. Its Full frame is byte-identical to `snapshot(obs, ack_input).try_encode()`. An observation the codec
/// refuses (a position off the wire grid) is an error, never a repaired snapshot.
pub fn snapshot_data(
    obs: &Observation,
    ack_input: u32,
) -> Result<SnapshotData, rh_protocol::EncodeError> {
    SnapshotData::build(
        obs.tick,
        phase(obs.phase),
        ack_input,
        obs.me.as_ref().map(wire_self),
        obs.visible.iter().map(wire_actor),
    )
}

/// What one observed event is on the wire: the reliable Events frame or the disposable Fx frame. Exhaustive over
/// [`SeenEvent`] (no wildcard): a new kind of observed event cannot reach a client without a wire form being chosen.
enum Wire {
    Event(WireEvent),
    Fx(WireFx),
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
        SeenEvent::Hit { victim, by, amount } => Wire::Fx(WireFx::Hit {
            victim: victim.0,
            by: by.0,
            amount: amount as f32,
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
}

impl ViewFrames {
    /// Bytes handed to the outbox: the events and fx frames, and the snapshot at the size of its Full frame (the writer may
    /// send less: a delta).
    pub fn bytes(&self) -> usize {
        [&self.important, &self.fx]
            .into_iter()
            .flatten()
            .map(Vec::len)
            .sum::<usize>()
            + self.snapshot.as_ref().map_or(0, SnapshotData::full_len)
    }
}

/// The publish path: the observation, its wire forms and the frames, with every intermediate buffer kept between viewers
/// and ticks. The room and wirebench both call [`Publisher::frames`], so the bench measures the production path.
#[derive(Default)]
pub struct Publisher {
    obs: Observation,
    events: Vec<WireEvent>,
    fx: Vec<WireFx>,
}

impl Publisher {
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
        rh_sim::observe_into(sim, viewer, last_step, &mut self.obs);
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
        let important = if self.events.is_empty() {
            None
        } else {
            let msg = ServerMsg::Events {
                tick,
                events: std::mem::take(&mut self.events),
            };
            let frame = msg.encode();
            if let ServerMsg::Events { events, .. } = msg {
                self.events = events;
            }
            Some(frame)
        };
        let fx = if self.fx.is_empty() {
            None
        } else {
            let msg = ServerMsg::Fx {
                tick,
                fx: std::mem::take(&mut self.fx),
            };
            let frame = msg.encode();
            if let ServerMsg::Fx { fx, .. } = msg {
                self.fx = fx;
            }
            Some(frame)
        };
        let snapshot = snapshot_data(&self.obs, ack_input);
        ViewFrames {
            important,
            fx,
            snapshot,
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

    /// The streamed frame is the message's frame, byte for byte, over a whole match (every viewer, every tick), and the
    /// scratch buffer it reuses never leaks one frame into the next.
    #[test]
    fn encode_snapshot_is_byte_identical_to_the_message_encoding() {
        let mut env = seed1_match(900);
        let ids: Vec<_> = env.sim.players().iter().map(|p| p.id).collect();
        let mut frames = 0;
        let mut scratch = Vec::new();
        for t in 0..900u32 {
            let out = env.step(&[]);
            for id in &ids {
                let obs = rh_sim::observe(&env.sim, *id, &out.events);
                let streamed = encode_snapshot(&obs, t, &mut scratch).expect("encodes");
                assert_eq!(streamed, snapshot(&obs, t).try_encode().expect("encodes"));
                assert_eq!(streamed.capacity(), streamed.len());
                frames += 1;
            }
        }
        assert!(frames > 1000);
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
