//! P-NET-DRAWAHEAD-1a oracle: the sim's walk hint (legacy `PlayerExtraState.walkDir`/`walkTicks`, `walkHint.ts`) reaches a
//! remote viewer's client through the production publish path (observation -> `wire_actor` -> `SnapshotData` ->
//! `ConnEncoder` -> `SnapshotTracker`), in Full frames and in delta frames that set and clear it, for players only, at
//! protocol 19.
//!
//! An open 64 x 40 room with walk hints on (`SimConfig.walk_hints`, as `live_content()` sets it), a training world so the
//! practice dummies (kind 3) stand next to the spawns.
//! The walker is ordered due south (heading 64/256 of a turn) along a lane that stays clear for well over three ticks, so
//! the sim's hint is `(64, WALK_HINT_MAX_TICKS = 3)` on every tick of that stretch whatever the seed; then a Stop clears it
//! and a second order sets it again.
use rh_protocol::{
    ConnEncoder, FrameKind, ServerMsg, SnapshotTracker, WireActor, PROTOCOL_VERSION,
};
use rh_server::wire::Publisher;
use rh_sim::{
    validate, Arena, ArenaMode, ArenaRules, FactionId, Phase, PlayerId, RawCommand, Secrets, Sim,
    SimConfig, TileMap, Vec2,
};

const VIEWER: PlayerId = PlayerId(1);
const WALKER: PlayerId = PlayerId(2);
/// South: `encodeWalkDir(PI / 2)` = round(64) & 255 (legacy `shared/src/interp.ts:5-7`).
const SOUTH: u8 = 64;
/// `WALK_HINT_MAX_TICKS` at 20 Hz (legacy `shared/src/constants.ts:33`).
const FULL_HINT: u8 = 3;

fn room() -> Sim {
    let (width, height) = (64usize, 40usize);
    let mut tiles = vec![0; width * height];
    for y in 0..height {
        for x in 0..width {
            if x == 0 || y == 0 || x + 1 == width || y + 1 == height {
                tiles[y * width + x] = 1;
            }
        }
    }
    let arena = Arena {
        map: TileMap::new(width as u32, height as u32, tiles).unwrap(),
        // Two spawns side by side in the north of the room; either one's lane south is open for ~28 tiles.
        spawns: vec![Vec2::new(176., 176.), Vec2::new(240., 176.)],
    };
    let mut sim = Sim::try_new(
        SimConfig {
            min_players: 1,
            lobby_seconds: 1.,
            fill_seconds: 0.,
            pvp_rules: false,
            wish_lock_ms: 0.,
            walk_hints: Some(true),
            training: true,
            dummies: true,
            lifecycle: ArenaMode::Source(ArenaRules {
                plan_seconds: 0.,
                first_patience_seconds: Some(0.),
                coliseum_schedule: None,
                patience_seconds: 86_400.,
                patience_min_seconds: 86_400.,
                sudden_death_seconds: 86_400.,
            }),
            ..Default::default()
        },
        arena,
        Secrets {
            spawn_seed: 7,
            order_salt: 0,
            reward_salt: [1, 2, 3, 4],
        },
    )
    .unwrap();
    assert_eq!(
        sim.add_player("viewer", Some(FactionId::Holy), false),
        Some(VIEWER)
    );
    assert_eq!(
        sim.add_player("walker", Some(FactionId::Fire), false),
        Some(WALKER)
    );
    sim
}

/// The viewer's connection: the production publisher and a connection encoder, and the client's tracker.
struct Link {
    publisher: Publisher,
    enc: ConnEncoder,
    tracker: SnapshotTracker,
    frame: Vec<u8>,
    ack: u32,
}

impl Link {
    fn new() -> Self {
        Self {
            publisher: Publisher::default(),
            enc: ConnEncoder::new(),
            tracker: SnapshotTracker::new(),
            frame: Vec::new(),
            ack: 0,
        }
    }

    /// Steps the sim one tick, publishes the viewer's snapshot and decodes it as the client would. Returns the frame kind.
    fn tick(&mut self, sim: &mut Sim, full: bool) -> FrameKind {
        let events = sim.step();
        let frames =
            self.publisher
                .frames(sim, VIEWER, self.ack, &events, &mut Vec::new(), &events);
        let snap = frames.snapshot.expect("the viewer's snapshot encodes");
        if full {
            self.enc.request_full();
        }
        self.frame.clear();
        let kind = self.enc.encode(snap, &mut self.frame);
        match self.tracker.decode(&self.frame) {
            Ok(ServerMsg::Snapshot { .. }) | Ok(ServerMsg::SnapshotDelta(_)) => {}
            other => panic!("the client decodes the frame: {other:?}"),
        }
        kind
    }

    fn walker(&self) -> Option<WireActor> {
        self.tracker
            .actors()
            .iter()
            .find(|a| a.id == WALKER.0)
            .copied()
    }

    /// Every decoded non-player actor carries no hint; returns how many there were.
    fn mobs_carry_none(&self) -> usize {
        let mut n = 0;
        for a in self.tracker.actors().iter().filter(|a| a.kind != 0) {
            assert_eq!(
                a.walk_hint(),
                (0, 0),
                "a non-player actor (id {}, kind {}) carries a walk hint",
                a.id,
                a.kind
            );
            n += 1;
        }
        n
    }
}

fn order(sim: &mut Sim, x: f64, y: f64, seq: u8) {
    let cmd = validate(RawCommand::Move {
        x,
        y,
        seq: Some(seq),
    })
    .unwrap();
    sim.submit(WALKER, cmd).unwrap();
}

fn stop(sim: &mut Sim, seq: u8) {
    sim.submit(
        WALKER,
        validate(RawCommand::Stop { seq: Some(seq) }).unwrap(),
    )
    .unwrap();
}

#[test]
fn a_walking_player_s_hint_round_trips_full_and_delta_frames_and_no_mob_carries_one() {
    let mut sim = room();
    let mut link = Link::new();
    let mut mob_rows = 0;
    for _ in 0..400 {
        if sim.phase() == Phase::Active {
            break;
        }
        link.tick(&mut sim, false);
        mob_rows += link.mobs_carry_none();
    }
    assert_eq!(sim.phase(), Phase::Active, "the run starts");
    // Settle a few ticks so the dummies stand and the encoder runs deltas.
    for _ in 0..5 {
        link.tick(&mut sim, false);
        mob_rows += link.mobs_carry_none();
    }
    let still = link.walker().expect("the viewer is delivered the walker");
    assert_eq!(
        still.walk_hint(),
        (0, 0),
        "a standing player carries no hint"
    );

    // Walk due south from where the walker stands (the spawn draw decides which spawn it got), about 900 u, over five
    // seconds at 170 u/s: the heading is PI/2 to within a sixteenth of a unit over 900 u, so 64 exactly.
    order(&mut sim, f64::from(still.x), 1100., 1);
    let (mut full_walking, mut delta_walking) = (0, 0);
    for t in 0..40 {
        // A Full frame mid-walk (a resync or a new connection) carries the hint too.
        let kind = link.tick(&mut sim, t == 20);
        mob_rows += link.mobs_carry_none();
        if t < 2 {
            continue; // the order lands and the walk starts
        }
        let w = link.walker().expect("the walker stays delivered");
        assert_eq!(
            w.walk_hint(),
            (SOUTH, FULL_HINT),
            "tick {t} ({kind:?} frame): a player walking a clear lane south carries (64, 3)"
        );
        match kind {
            FrameKind::Full => full_walking += 1,
            FrameKind::Delta => delta_walking += 1,
        }
    }
    assert!(full_walking >= 1, "a Full frame was checked while walking");
    assert!(
        delta_walking >= 20,
        "delta frames were checked while walking ({delta_walking})"
    );

    // Stop: the next delta clears the hint to (0, 0) (legacy schema.ts: walkDir is meaningless at walkTicks 0).
    stop(&mut sim, 2);
    let kind = link.tick(&mut sim, false);
    let w = link.walker().expect("the walker stays delivered");
    assert_eq!(kind, FrameKind::Delta, "the stop goes out as a delta");
    assert_eq!(
        w.walk_hint(),
        (0, 0),
        "the delta of the stop tick clears the hint to (0, 0)"
    );
    mob_rows += link.mobs_carry_none();

    // Walk again: a delta sets it again (east this time: heading 0 with ticks 3).
    order(&mut sim, 1800., w.y as f64, 3);
    for t in 0..12 {
        link.tick(&mut sim, false);
        mob_rows += link.mobs_carry_none();
        if t < 2 {
            continue;
        }
        let w = link.walker().expect("the walker stays delivered");
        assert_eq!(
            w.walk_hint(),
            (0, FULL_HINT),
            "tick {t}: walking east again, a delta sets (0, 3)"
        );
    }

    assert!(
        mob_rows >= 50,
        "non-player rows were checked (practice dummies): {mob_rows}"
    );
    assert_eq!(
        PROTOCOL_VERSION, 22,
        "the walk hint is protocol 19 on origin, 20 with P-WIRE19-A/B (P-SYNC-ORIGIN-1), 22 with origin's 20 and 21 (P-SYNC-ORIGIN-2)"
    );
}
