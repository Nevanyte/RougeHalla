//! Replication cost of the slice: bytes per player per second and encode time, from the same observation path the live
//! room uses (observe -> wire -> protocol encode), on a headless 8-bot match.
//!   cargo run --release -p rh-server --bin wirebench -- [--map parity/maps/seed1.map.json] [--ticks 2400] [--seed 1]
//!                                                     [--digest]
//!                                                     [--trace-output PATH]
//! `--digest` adds `outcomeDigest`, the match's hash-independent behaviour fingerprint (rh_headless::digest), folded
//! outside the timed sections.
//! Protocol v3: each viewer has its own `ConnEncoder` (the connection writer's state, as `Outbox::drain_into` uses it) and
//! every snapshot is written, none skipped, so the bytes are the Full-or-delta frames a client that keeps up receives.
//! `--compare-full` adds `fullSnapshotBytesPerPlayerPerSec`, what the same snapshots cost as v2-style Full frames.
//! `--synthetic N` (build with `--features bench`) replaces the 8 bots by N synthetic fighters on the practice arena, past the
//! real lobby cap, wandering to random points (`Sim::synthetic`, the crowd of `scalebench`); 8 viewers spread over the crowd
//! are published to and encoded by the shipped path (the Publisher and one ConnEncoder each), so the bytes and the Full-versus-
//! delta split at 204 or 1000 fighters are the shipped codec's. The map flag is ignored there.
//! `--scenario idle|typical|heavy|all` (P-NET-1 Phase 0) prints one report per scenario, each with `"scenario"` and
//! `"aliveAtEnd"` added; without the flag the output is the single line above, unchanged. `typical` is exactly the default
//! run (8 Brawler(2) bots, the map's own spawns). `idle` is the same match with 8 `scripted::Idle` seats (they hold; no
//! combat). `heavy` is the same map with all 8 fighters on a 36 u ring at an open spot near the map centre, aggressive
//! `Scrum` seats (nearest-visible targeting, a fist attack on the fist cadence and a circle-strafe while in reach) and a
//! very large hp pool so nobody dies inside the window: every viewer sees the other 7 for the whole run and the scrum
//! keeps moving and swinging (the replication ceiling of an 8-way melee, not a claim about normal play).
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::scripted::{Brawler, Idle};
use rh_protocol::{ConnEncoder, FrameKind, ServerMsg};
use rh_sim::{Event, FactionId, SimConfig};
use std::time::Instant;
use std::{
    fs::File,
    io::{BufWriter, Write},
    path::PathBuf,
};

/// What the bench steps and publishes: the headless 8-bot match, the `heavy` scenario's scripted scrum, or (feature
/// `bench`) a synthetic crowd.
enum Source {
    Match(Box<Env>),
    Heavy(Box<Heavy>),
    #[cfg(feature = "bench")]
    Crowd(Box<Crowd>),
}

impl Source {
    fn sim(&self) -> &rh_sim::Sim {
        match self {
            Source::Match(e) => &e.sim,
            Source::Heavy(h) => &h.sim,
            #[cfg(feature = "bench")]
            Source::Crowd(c) => &c.sim,
        }
    }

    /// Steps once; whether the run is over.
    fn advance(&mut self) -> bool {
        match self {
            Source::Match(e) => e.advance(&[]).terminated,
            Source::Heavy(h) => {
                h.advance();
                h.sim.phase() == rh_sim::Phase::Ended
            }
            #[cfg(feature = "bench")]
            Source::Crowd(c) => {
                c.advance();
                false
            }
        }
    }

    fn events(&self) -> &[Event] {
        match self {
            Source::Match(e) => e.last_events(),
            Source::Heavy(h) => &h.events,
            #[cfg(feature = "bench")]
            Source::Crowd(c) => &c.events,
        }
    }
}

#[cfg(feature = "bench")]
struct Crowd {
    sim: rh_sim::Sim,
    ids: Vec<rh_sim::PlayerId>,
    rngs: Vec<u64>,
    events: Vec<Event>,
    tick: usize,
    world: (f64, f64),
}

#[cfg(feature = "bench")]
impl Crowd {
    /// `n` fighters on rings around the centre of the practice arena (invulnerable, so the crowd stays n).
    fn new(n: usize) -> Self {
        use rh_sim::{Placement, Secrets, Vec2};
        let arena = rh_sim::arenas::practice_arena();
        let c = arena.centre();
        let (mut ring, mut pl) = (0usize, Vec::new());
        while pl.len() < n {
            let slots = if ring == 0 { 1 } else { ring * 6 };
            for k in 0..slots {
                if pl.len() == n {
                    break;
                }
                let a = std::f64::consts::TAU * k as f64 / slots as f64;
                let r = ring as f64 * 22.0;
                pl.push(Placement {
                    profile: format!("s{}", pl.len()),
                    faction: FactionId::ALL[pl.len() % 5],
                    bot: true,
                    at: Vec2::new(c.x + r * a.cos(), c.y + r * a.sin()),
                    hp: Some(1.0e12),
                    weapon0: None,
                    weapon1: None,
                });
            }
            ring += 1;
        }
        let world = (arena.map.w as f64 * 32.0, arena.map.h as f64 * 32.0);
        let sim = rh_sim::Sim::synthetic(SimConfig::default(), arena, Secrets::from_seed(1), &pl);
        let ids: Vec<_> = sim.players().iter().map(|p| p.id).collect();
        let rngs = ids
            .iter()
            .map(|id| 0x9e37_79b9_7f4a_7c15 ^ (id.0 as u64).wrapping_mul(0xbf58_476d_1ce4_e5b9))
            .collect();
        Crowd {
            sim,
            ids,
            rngs,
            events: Vec::new(),
            tick: 0,
            world,
        }
    }

    fn advance(&mut self) {
        fn unit(s: &mut u64) -> f64 {
            let mut x = *s;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            *s = x;
            (x >> 11) as f64 / (1u64 << 53) as f64
        }
        for (i, id) in self.ids.iter().enumerate() {
            if (self.tick + i) % 16 == 0 {
                let rng = &mut self.rngs[i];
                let (x, y) = (
                    self.world.0 * (0.35 + 0.3 * unit(rng)),
                    self.world.1 * (0.35 + 0.3 * unit(rng)),
                );
                if let Ok(c) = rh_sim::validate(rh_sim::RawCommand::Move { x, y, seq: None }) {
                    let _ = self.sim.submit_unbudgeted(*id, c);
                }
            }
        }
        self.events.clear();
        self.sim.step_into(&mut self.events);
        self.tick += 1;
    }
}

/// The `heavy` scenario's seat policy: the brawler's nearest-visible targeting plus a circle-strafe around that target,
/// so the scrum keeps moving while it fights (a frozen scrum costs almost no snapshot delta bytes and would understate the
/// state path). It attacks at fist reach and steers at a point on a small orbit about the target; both are ordinary
/// `PublicCommand`s derived from the seat's own observation (C-OBS / C-INPUT), never from sim state.
struct Scrum;

impl rh_policy::Policy for Scrum {
    fn spec(&self) -> rh_policy::PolicySpec {
        rh_policy::PolicySpec {
            name: "heavy-scrum".into(),
            version: "1".into(),
            contract: rh_policy::POLICY_CONTRACT_VERSION,
            observation_version: rh_sim::OBSERVATION_VERSION,
            decision_interval_ticks: 1,
        }
    }
    fn reset(&mut self, _: &rh_policy::MatchStart) {}
    fn decide(&mut self, obs: &rh_sim::Observation) -> Vec<rh_sim::PublicCommand> {
        let mut out = Vec::new();
        if obs.phase != rh_sim::Phase::Active {
            return out;
        }
        let Some(me) = &obs.me else { return out };
        let target = obs
            .visible
            .iter()
            .filter(|a| a.status == rh_sim::Status::Alive)
            .min_by(|a, b| {
                let da = (a.x - me.x) * (a.x - me.x) + (a.y - me.y) * (a.y - me.y);
                let db = (b.x - me.x) * (b.x - me.x) + (b.y - me.y) * (b.y - me.y);
                da.total_cmp(&db).then(a.id.cmp(&b.id))
            });
        let Some(t) = target else { return out };
        let (dx, dy) = (t.x - me.x, t.y - me.y);
        let d = rh_sim::math::sqrt(dx * dx + dy * dy);
        // Keep the order rate inside the C-INPUT budget (15 orders/s): one attack per fist interval (~1.5/s) and one
        // move per 2 ticks (10/s) = about 11.5 orders/s. The 34 u orbit chord is walked at player speed before the next
        // move order, so the scrum keeps circling instead of standing still.
        if d < 80.0 && obs.tick % 13 == 0 {
            out.push(rh_sim::PublicCommand::Attack {
                a: rh_sim::math::atan2(dy, dx),
                t: Some(obs.server_time - 100.0),
            });
        }
        if obs.tick % 2 == 0 {
            if d < 80.0 {
                // Rotate the me->target offset by 1 rad and walk there: keeps the distance while moving.
                let (c, s) = (rh_sim::math::cos(1.0), rh_sim::math::sin(1.0));
                out.push(rh_sim::PublicCommand::Move {
                    x: t.x + (-dx) * c - (-dy) * s,
                    y: t.y + (-dx) * s + (-dy) * c,
                    seq: None,
                });
            } else {
                out.push(rh_sim::PublicCommand::Move {
                    x: t.x,
                    y: t.y,
                    seq: None,
                });
            }
        }
        out
    }
}

/// The `heavy` scenario: eight fighters on a tight ring at the most open spot near the map centre, each driven by the
/// shipped seat path with `Scrum` (a decision every tick), and each placed with a very large hp pool so the scrum lasts
/// the whole window. Nothing here is a new game rule: the sim, the observation and the publisher/encoder are the
/// production ones, and the seats are the same `rh_policy` seats `Env` uses (this is the only way to place fighters with
/// a non-default hp through public APIs; `Env::new` always takes the faction pool and the map's spawns).
struct Heavy {
    sim: rh_sim::Sim,
    seats: Vec<rh_policy::Seat>,
    sight: rh_sim::SightCache,
    events: Vec<Event>,
}

impl Heavy {
    fn new(arena: rh_sim::Arena, seed: u64) -> Self {
        use rh_sim::{Placement, Secrets, Vec2};
        let c = open_centre(&arena.map);
        // 36 u: adjacent fighters are 27.5 u apart and the farthest pair is 72 u, inside the Brawler's 80 u attack
        // gate -- every fighter has a target every tick.
        let radius = 36.0;
        let placements: Vec<Placement> = (0..8)
            .map(|i| {
                let a = std::f64::consts::TAU * i as f64 / 8.0;
                Placement {
                    profile: format!("h{i}"),
                    faction: FactionId::ALL[i % 5],
                    bot: true,
                    at: Vec2::new(c.x + radius * a.cos(), c.y + radius * a.sin()),
                    // Nobody dies inside the window, so the engagement is sustained. The wire carries hp as a percent,
                    // clamped to 100, so an over-full pool costs no extra bytes and cannot be refused.
                    hp: Some(1.0e6),
                    weapon0: None,
                    weapon1: None,
                }
            })
            .collect();
        let sim = rh_sim::Sim::reset_active(
            SimConfig::default(),
            arena,
            Secrets::from_seed(seed),
            &placements,
        );
        let seats = sim
            .players()
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let mut seat = rh_policy::Seat::new(
                    &rh_policy::MatchStart::of(
                        &sim,
                        p.id,
                        seed.wrapping_mul(31).wrapping_add(i as u64),
                    ),
                    Box::new(Scrum),
                    Box::new(Idle),
                );
                seat.bind_fx(&sim).expect("a fresh heavy seat binds");
                seat
            })
            .collect();
        Self {
            sim,
            seats,
            sight: rh_sim::SightCache::new(),
            events: Vec::new(),
        }
    }

    /// `Env::advance` without the external-observer machinery: drive the seats, step, feed the seats the new fx report.
    fn advance(&mut self) {
        rh_policy::drive_seats_with(
            &mut self.sim,
            &mut self.seats,
            &self.events,
            &mut self.sight,
            |_, _| {},
        );
        self.events.clear();
        self.sim.step_into(&mut self.events);
        rh_policy::feed_seats(&self.sim, &mut self.seats);
    }
}

/// The world centre of the most central all-floor square on the map (9x9 tiles, then 7, 5, 3, 1), so the scrum stands
/// on open ground whatever map the flag names. A map with no floor at all falls back to the arena centre.
fn open_centre(map: &rh_sim::TileMap) -> rh_sim::Vec2 {
    let mut best: Option<(i64, i64, i64)> = None;
    for size in [9i64, 7, 5, 3, 1] {
        for ty in 0..=(map.h as i64 - size) {
            for tx in 0..=(map.w as i64 - size) {
                let open = (0..size).all(|dy| (0..size).all(|dx| map.is_floor(tx + dx, ty + dy)));
                if !open {
                    continue;
                }
                let (cx, cy) = (tx + size / 2, ty + size / 2);
                let d = (cx * 2 - map.w as i64).pow(2) + (cy * 2 - map.h as i64).pow(2);
                if best.is_none_or(|(bd, _, _)| d < bd) {
                    best = Some((d, cx, cy));
                }
            }
        }
        if best.is_some() {
            break;
        }
    }
    let (_, tx, ty) = best.unwrap_or((0, map.w as i64 / 2, map.h as i64 / 2));
    rh_sim::Vec2::new(
        rh_sim::map::tile_to_world_center(tx),
        rh_sim::map::tile_to_world_center(ty),
    )
}

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter()
        .position(|a| a == k)
        .and_then(|i| args.get(i + 1).cloned())
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}

fn trace_line<T: serde::Serialize>(writer: &mut BufWriter<File>, value: &T) {
    serde_json::to_writer(&mut *writer, value).expect("write trace JSON");
    writer.write_all(b"\n").expect("write trace newline");
}

/// The P-NET-1 Phase 0 report scenarios. `None` is the historical default (one line, no scenario fields).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Scenario {
    /// Eight idle seats: the floor cost with no combat.
    Idle,
    /// Exactly the historical default run: eight `Brawler(2)` seats on the map's own spawns.
    Typical,
    /// Eight aggressive seats in one tight scrum, kept alive for the whole window (the replication ceiling).
    Heavy,
}

impl Scenario {
    fn parse(name: &str) -> Option<Self> {
        match name {
            "idle" => Some(Self::Idle),
            "typical" => Some(Self::Typical),
            "heavy" => Some(Self::Heavy),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Typical => "typical",
            Self::Heavy => "heavy",
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let trace_path = arg(&args, "--trace-output").map(PathBuf::from);
    let synthetic: Option<usize> =
        arg(&args, "--synthetic").map(|v| v.parse().expect("--synthetic N"));
    #[cfg(not(feature = "bench"))]
    assert!(
        synthetic.is_none(),
        "--synthetic needs a build with --features bench"
    );
    if args.iter().any(|a| a == "--trace-output") && arg(&args, "--trace-output").is_none() {
        panic!("--trace-output requires a PATH");
    }
    let ticks: u32 = arg(&args, "--ticks")
        .and_then(|v| v.parse().ok())
        .unwrap_or(2400);
    let seed: u64 = arg(&args, "--seed")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);
    // One line per scenario; `all` is the Phase 0 (idle, typical, heavy) report.
    let scenarios: Vec<Option<Scenario>> = match arg(&args, "--scenario").as_deref() {
        None => vec![None],
        Some("all") => vec![
            Some(Scenario::Idle),
            Some(Scenario::Typical),
            Some(Scenario::Heavy),
        ],
        Some(name) => vec![Some(Scenario::parse(name).unwrap_or_else(|| {
            panic!("--scenario takes idle, typical, heavy or all, not {name:?}")
        }))],
    };
    if synthetic.is_some() && scenarios.iter().any(Option::is_some) {
        panic!("--scenario and --synthetic are separate sources");
    }
    if scenarios.len() > 1 && trace_path.is_some() {
        panic!("--trace-output needs one --scenario");
    }
    for scenario in &scenarios {
        run(&args, ticks, seed, synthetic, trace_path.clone(), *scenario);
    }
}

fn run(
    args: &[String],
    ticks: u32,
    seed: u64,
    synthetic: Option<usize>,
    trace_path: Option<PathBuf>,
    scenario: Option<Scenario>,
) {
    let mut src = match synthetic {
        #[cfg(feature = "bench")]
        Some(n) => Source::Crowd(Box::new(Crowd::new(n))),
        _ => {
            let arena = match arg(args, "--map") {
                Some(p) => rh_headless::load_arena(&p).expect("map"),
                None => rh_headless::load_arena("parity/maps/seed1.map.json")
                    .expect("map (run from the repo root)"),
            };
            match scenario {
                Some(Scenario::Heavy) => Source::Heavy(Box::new(Heavy::new(arena, seed))),
                other => {
                    let agents = (0..8)
                        .map(|i| {
                            let policy: Box<dyn rh_policy::Policy> = match other {
                                Some(Scenario::Idle) => Box::new(Idle),
                                _ => Box::new(Brawler::new(2)),
                            };
                            AgentSpec {
                                profile: format!("b{i}"),
                                faction: FactionId::ALL[i % 5],
                                bot: true,
                                agent: Agent::Policy { policy },
                            }
                        })
                        .collect();
                    Source::Match(Box::new(Env::new(
                        EnvConfig {
                            arena,
                            sim: SimConfig::default(),
                            max_ticks: ticks,
                            record: false,
                        },
                        agents,
                        seed,
                    )))
                }
            }
        }
    };
    // The viewers: every player of the match, or eight spread over the crowd.
    let all: Vec<_> = src.sim().players().iter().map(|p| p.id).collect();
    let ids: Vec<_> = if synthetic.is_some() {
        (0..8).map(|k| all[k * all.len() / 8]).collect()
    } else {
        all
    };
    let welcome = ServerMsg::Welcome {
        protocol: rh_protocol::PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        match_id: [0; 16],
        player_id: ids.first().expect("at least one viewer").0,
        session: [0; 16],
        tick_rate: 20,
        tick: 0,
        server_ms: 0.0,
        map: rh_protocol::map::MapBlob::new(
            src.sim().arena().map.w as u16,
            src.sim().arena().map.h as u16,
            src.sim().arena().map.tiles.clone(),
        ),
    }
    .encode();
    // Diagnostic trace captures one real viewer's public wire frames. Capture work is deliberately
    // outside benchmark timing/claims; no writer is allocated or touched in the default run.
    let mut trace = trace_path.map(|path| {
        let file =
            File::create(&path).unwrap_or_else(|e| panic!("trace output {}: {e}", path.display()));
        BufWriter::new(file)
    });
    let trace_enabled = trace.is_some();
    // The trace says which source produced it; the default run's header is unchanged.
    let workload = match (synthetic.is_some(), scenario) {
        (true, _) => "synthetic-practice-crowd".to_owned(),
        (false, Some(s)) => format!("scenario-{}-8-player", s.name()),
        (false, None) => "headless-default-map-8-bot-match".to_owned(),
    };
    if let Some(w) = trace.as_mut() {
        let viewer_id = ids.first().expect("at least one viewer").0;
        let map = &src.sim().arena().map;
        trace_line(
            w,
            &serde_json::json!({
                "record":"header", "format":"rougehalla-wire-trace", "version":1,
                "protocol":rh_protocol::PROTOCOL_VERSION, "contentHash":format!("{:016x}", rh_sim::content::content_hash()),
                "provenance":"wirebench offline diagnostic; one actual selected viewer; trace capture excluded from benchmark claims",
                "workload": workload,
                "syntheticFighters": synthetic, "seed": seed, "requestedTicks": ticks,
                "map": if synthetic.is_some() { "practice-arena".to_owned() } else { arg(args, "--map").unwrap_or_else(|| "parity/maps/seed1.map.json".to_owned()) }, "mapWidth":map.w, "mapHeight":map.h,
                "viewerPlayerId":viewer_id, "tickRate":20,
                "mapBlobHex":hex(rh_protocol::map::MapBlob::new(map.w as u16, map.h as u16, map.tiles.clone()).pre_encode().expect("valid map").as_bytes()),
                "welcomeHex":hex(&welcome)
            }),
        );
    }
    let viewers = ids.len() as f64;
    let (mut bytes, mut frames, mut enc_ns, mut step_ns, mut n) = (0u64, 0u64, 0u128, 0u128, 0u64);
    let (mut snap_bytes, mut snaps, mut visible_sum) = (0u64, 0u64, 0u64);
    let (mut full_bytes, mut full_frames, mut delta_frames) = (0u64, 0u64, 0u64);
    // `--compare-full` also sizes every snapshot as a Full frame (a pass the writer itself rarely needs): off by default so the
    // measured work is the production work.
    let compare_full = args.iter().any(|a| a == "--compare-full");
    let mut encoders: Vec<ConnEncoder> = ids.iter().map(|_| ConnEncoder::new()).collect();
    let mut spares: Vec<Option<rh_protocol::SnapshotData>> = ids.iter().map(|_| None).collect();
    let (mut event_bytes, mut fx_bytes) = (0u64, 0u64);
    let mut snapshot_refusals = 0u64;
    let mut steps = 0;
    let mut digest = args
        .iter()
        .any(|a| a == "--digest")
        .then(rh_headless::digest::OutcomeDigest::new);
    // The room's own publish path (`wire::Publisher::frames`), one wake of one step per tick, with its buffers reused.
    let mut publisher = rh_server::wire::Publisher::default();
    let mut earlier: Vec<rh_sim::SeenEvent> = Vec::new();
    for _ in 0..ticks {
        let t = Instant::now();
        let terminated = src.advance();
        step_ns += t.elapsed().as_nanos();
        steps += 1;
        let events: &[Event] = src.events();
        if let Some(d) = digest.as_mut() {
            if let Err(error) = d.try_tick(src.sim(), events) {
                eprintln!("unrepresentable diagnostic snapshot: {error:?}");
                std::process::exit(2);
            }
        }
        let t = Instant::now();
        for (k, id) in ids.iter().enumerate() {
            let f = publisher.frames_in(
                spares[k].take(),
                src.sim(),
                *id,
                0,
                events,
                &mut earlier,
                events,
            );
            let capture_viewer = trace.is_some() && k == 0;
            let trace_tick = src.sim().tick();
            visible_sum += publisher.observation().visible.len() as u64;
            match f.snapshot {
                Ok(snap) => {
                    if compare_full {
                        full_bytes += snap.full_len() as u64;
                    }
                    // The connection writer's work: encode against the last frame it wrote, into an owned frame.
                    let (frame, kind) = encoders[k].encode_frame(snap);
                    if capture_viewer {
                        if let Some(w) = trace.as_mut() {
                            trace_line(
                                w,
                                &serde_json::json!({"record":"frame","tick":trace_tick,"viewerPlayerId":id.0,"kind":match kind { FrameKind::Full => "snapshot", FrameKind::Delta => "delta" },"bytesHex":hex(&frame)}),
                            );
                        }
                    }
                    match kind {
                        FrameKind::Full => full_frames += 1,
                        FrameKind::Delta => delta_frames += 1,
                    }
                    spares[k] = encoders[k].take_spare();
                    snap_bytes += frame.len() as u64;
                    snaps += 1;
                    bytes += frame.len() as u64;
                    frames += 1;
                }
                // A crowd past MAX_ACTORS in sight is refused by the codec (the room skips that snapshot): counted here.
                Err(_) if synthetic.is_some() => snapshot_refusals += 1,
                Err(e) => panic!("snapshot encodes: {e}"),
            }
            if let Some(imp) = &f.important {
                if capture_viewer {
                    if let Some(w) = trace.as_mut() {
                        trace_line(
                            w,
                            &serde_json::json!({"record":"frame","tick":trace_tick,"viewerPlayerId":id.0,"kind":"important","bytesHex":hex(imp)}),
                        );
                    }
                }
                bytes += imp.len() as u64;
                event_bytes += imp.len() as u64;
                frames += 1;
            }
            if let Some(fx) = &f.fx {
                if capture_viewer {
                    if let Some(w) = trace.as_mut() {
                        trace_line(
                            w,
                            &serde_json::json!({"record":"frame","tick":trace_tick,"viewerPlayerId":id.0,"kind":"fx","bytesHex":hex(fx)}),
                        );
                    }
                }
                bytes += fx.len() as u64;
                fx_bytes += fx.len() as u64;
                frames += 1;
            }
            n += 1;
        }
        // Trace mode includes file/hex serialization in the viewer loop, so its encode-time metric
        // is intentionally suppressed instead of presenting contaminated timing as a benchmark.
        if !trace_enabled {
            enc_ns += t.elapsed().as_nanos();
        }
        if terminated {
            break;
        }
    }
    if let Some(mut w) = trace {
        w.flush().expect("flush trace");
    }
    if args.iter().any(|a| a == "--sight-stats") {
        eprintln!(
            "sight memo: publisher {:?}, bots {:?}",
            publisher.sight_stats(),
            match &src {
                Source::Match(e) => format!("{:?}", e.sight_stats()),
                Source::Heavy(_) => "n/a (heavy seats hold their own memo)".to_string(),
                #[cfg(feature = "bench")]
                Source::Crowd(_) => "n/a (synthetic crowd has no bots)".to_string(),
            }
        );
    }
    let secs = steps as f64 * 0.05;
    let fighters = synthetic
        .map(|n| format!("\"fighters\":{n},\"snapshotRefusals\":{snapshot_refusals},"))
        .unwrap_or_default();
    let digest = digest
        .map(|d| format!("\"outcomeDigest\":\"{}\",", d.hex()))
        .unwrap_or_default();
    let encode_us = if trace_enabled {
        "null".to_string()
    } else {
        format!("{:.2}", enc_ns as f64 / 1000.0 / n.max(1) as f64)
    };
    let note = if trace_enabled {
        "diagnostic trace capture; capture timing excluded from benchmark claims"
    } else {
        "payload bytes only (no WebSocket/TCP/TLS framing); bots, no mobs: the slice; with --synthetic the viewers are 8 of the fighters"
    };
    // A scenario run names itself and reports how many fighters were still alive at the last measured step: the heavy
    // model's whole claim is that all eight are, for the whole window. The default line has neither field.
    let label = scenario.map_or_else(String::new, |s| {
        let alive = src
            .sim()
            .players()
            .iter()
            .filter(|p| p.status == rh_sim::Status::Alive)
            .count();
        format!("\"scenario\":\"{}\",\"aliveAtEnd\":{alive},", s.name())
    });
    println!(
        "{{{label}\"map\":\"{}x{}\",\"players\":{},{fighters}\"steps\":{steps},{digest}\"welcomeBytes\":{},\"bytesPerPlayerPerSec\":{:.0},\"snapshotBytesPerPlayerPerSec\":{:.0},\"fullSnapshotBytesPerPlayerPerSec\":{},\"fullSnapshotFrames\":{full_frames},\"deltaSnapshotFrames\":{delta_frames},\"eventBytesPerPlayerPerSec\":{:.0},\"fxBytesPerPlayerPerSec\":{:.0},\"framesPerPlayerPerSec\":{:.1},\"meanSnapshotBytes\":{:.1},\"meanVisibleActors\":{:.2},\"observeEncodeUsPerPlayerTick\":{encode_us},\"simStepUsMean\":{:.2},\"note\":\"{note}\"}}",
        src.sim().arena().map.w,
        src.sim().arena().map.h,
        ids.len(),
        welcome.len(),
        bytes as f64 / viewers / secs,
        snap_bytes as f64 / viewers / secs,
        if compare_full {
            format!("{:.0}", full_bytes as f64 / viewers / secs)
        } else {
            "null".to_string()
        },
        event_bytes as f64 / viewers / secs,
        fx_bytes as f64 / viewers / secs,
        frames as f64 / viewers / secs,
        snap_bytes as f64 / snaps.max(1) as f64,
        visible_sum as f64 / n.max(1) as f64,
        step_ns as f64 / 1000.0 / steps.max(1) as f64
    );
}
