//! P-WIRE17-MAP-3 oracle (server): the Welcome's map blob carries each zone's landmark anchor exactly as the generator
//! recorded it on `GameMapData::anchors` for the pooled map (the arena drops them; the pool's maker holds the generator's
//! map before `into_arena`). Public map data, not gameplay: no state hash, content hash or replay moves. The fixed `--map`
//! and the practice arena carry none. No landmark's geometry is pinned here: every comparison is against what the
//! generator records for the same seed and options.
//!
//! Wire form of a `ZoneAnchor` (docs/backlog/packets/P-WIRE17-MAP-3.md "Wire layout"): zone `Zone::code`; kind the wire
//! code table below (not the `FeatureKind` ordinal); centre, footprint and entrance tiles as `u16`, generator order;
//! front as is.

use rh_protocol::map::{
    EncodedMap, MapAnchor, MapBlob, MapPublic, MapRect, MapTile, ANCHOR_KIND_BOG_TREE,
    ANCHOR_KIND_CAVE, ANCHOR_KIND_CHURCH, ANCHOR_KIND_HALL, ANCHOR_KIND_VOLCANO,
};
use rh_protocol::{GroundMode, Reader, ServerMsg, Writer};
use rh_server::map_pool::{MapPool, MapPoolOptions, StyledMaker};
use rh_server::outbox::Outbox;
use rh_server::room::{MapAssets, Room, RoomCmd, RoomConfig, RoomReport};
use rh_sim::mapdata::{FeatureKind, GameMapData, ZoneAnchor};
use rh_sim::mapgen::{coliseum, pipeline};
use rh_sim::Secrets;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

const SEED: u32 = 1;
const SEED1_EXPORT: &[u8] = include_bytes!("../../rh-sim/src/mapdata/fixtures/seed1.map.json");

/// The map the pool's real maker certifies for `seed`, before it becomes an arena (the anchors are still on it).
fn generated(signature: bool, seed: u32) -> GameMapData {
    let fixed = coliseum::fixed_layout();
    pipeline::Pipeline::new(&fixed)
        .certified_styled(i64::from(seed), StyledMaker { signature }.options())
        .expect("generator runs")
        .expect("the seed certifies")
}

/// The wire's landmark kind code table.
fn kind_code(kind: FeatureKind) -> u8 {
    match kind {
        FeatureKind::Volcano => ANCHOR_KIND_VOLCANO,
        FeatureKind::Church => ANCHOR_KIND_CHURCH,
        FeatureKind::BogTree => ANCHOR_KIND_BOG_TREE,
        FeatureKind::Cave => ANCHOR_KIND_CAVE,
        FeatureKind::Hall => ANCHOR_KIND_HALL,
        other => panic!("{other:?} is not a landmark kind the wire knows"),
    }
}

fn u(v: i32) -> u16 {
    u16::try_from(v).expect("a tile inside the map")
}

/// A generator anchor as the wire carries it.
fn wire(a: &ZoneAnchor) -> MapAnchor {
    MapAnchor {
        zone: a.zone.code(),
        kind: kind_code(a.kind),
        centre: MapTile {
            x: u(a.centre.x),
            y: u(a.centre.y),
        },
        footprint: MapRect {
            x: u(a.footprint.x),
            y: u(a.footprint.y),
            w: u16::try_from(a.footprint.w).unwrap(),
            h: u16::try_from(a.footprint.h).unwrap(),
        },
        front: a.front,
        entrance: a
            .entrance
            .iter()
            .map(|t| MapTile {
                x: u(t.x),
                y: u(t.y),
            })
            .collect(),
    }
}

/// The map blob a client decodes from these assets.
fn blob(assets: &MapAssets) -> MapBlob {
    let mut w = Writer::default();
    assets.welcome_map.write_with_mode(&mut w, GroundMode::Off);
    let bytes = w.finish();
    MapBlob::read(&mut Reader::new(&bytes)).expect("the served blob decodes")
}

/// One map prepared by the pool exactly as a live room gets it (inline mode: the take certifies on the caller).
fn pooled(signature: bool, seed: u32) -> MapAssets {
    let configured = MapAssets::new(rh_sim::arenas::practice_arena()).unwrap();
    let pool = MapPool::with(
        configured,
        Arc::new(StyledMaker { signature }),
        Box::new(move || seed),
        MapPoolOptions {
            target: 0,
            ..MapPoolOptions::default()
        },
    );
    let (assets, served) = pool.take_served();
    assert!(!served.configured, "seed {seed} certified");
    assets
}

// ---- the blob carries the generator's anchors -----------------------------------------------------------------------

#[test]
fn a_pooled_landmark_map_s_blob_carries_exactly_the_generator_s_anchors() {
    for seed in [SEED, 2] {
        let want: Vec<MapAnchor> = generated(true, seed).anchors.iter().map(wire).collect();
        assert_eq!(want.len(), 5, "seed {seed}: one anchor per zone");
        assert_eq!(
            blob(&pooled(true, seed)).public.anchors,
            want,
            "seed {seed}: the served anchors are the generator's, zone-code order"
        );
    }
}

#[test]
fn guard_an_option_off_pooled_map_carries_no_anchors() {
    assert!(
        generated(false, SEED).anchors.is_empty(),
        "the generator records none"
    );
    assert!(blob(&pooled(false, SEED)).public.anchors.is_empty());
}

#[test]
fn guard_the_fixed_map_and_the_practice_arena_carry_no_anchors() {
    let arena = rh_server::runtime::source_map(SEED1_EXPORT).unwrap();
    assert!(blob(&MapAssets::new(arena).unwrap())
        .public
        .anchors
        .is_empty());
    let practice = blob(&MapAssets::new(rh_sim::arenas::practice_arena()).unwrap());
    assert_eq!(practice.public, MapPublic::default());
}

// ---- rooms --------------------------------------------------------------------------------------------------------------

fn sim_config() -> rh_sim::SimConfig {
    let args: Vec<String> = "--runtime source-arena --map pooled"
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    rh_server::runtime::Settings::from_args(&args)
        .unwrap()
        .unwrap()
        .sim()
}

const TICK: Duration = Duration::from_millis(50);

struct Hand {
    room: Room,
    now: Instant,
    reports: mpsc::UnboundedReceiver<RoomReport>,
    welcome: Vec<u8>,
    player: rh_sim::PlayerId,
}

impl Hand {
    /// A recording room with fixed secrets and bot seed, three fill bots and one human, on `assets`.
    fn new(assets: &MapAssets) -> Self {
        let (tx, reports) = mpsc::unbounded_channel();
        let now = Instant::now();
        let cfg = RoomConfig {
            sim: sim_config(),
            arena: assets.arena.clone(),
            welcome_map: assets.welcome_map.clone(),
            fill_bots_to: 3,
            tick: TICK,
            record: true,
            fixed_secrets: Some(Secrets::from_seed(7)),
            fixed_bot_seed: Some(11),
            reconnect_grace: Duration::from_secs(10),
            linger: Duration::from_millis(0),
        };
        let mut room = Room::new([4; 16], cfg, tx, now);
        let (reply, mut rx) = oneshot::channel();
        room.handle(
            RoomCmd::Join {
                profile: "alpha".into(),
                faction: None,
                outbox: Arc::new(Outbox::default()),
                conn: 1,
                fence: 1,
                reply,
            },
            now,
        );
        let joined = rx.try_recv().expect("replied").expect("seated");
        Self {
            room,
            now,
            reports,
            welcome: joined.welcome,
            player: joined.player,
        }
    }

    /// The join's Welcome: its map blob's bytes, the decoded blob and the content hash it names.
    fn welcome(&self) -> (Vec<u8>, MapBlob, u64) {
        match ServerMsg::decode(&self.welcome) {
            Ok(ServerMsg::Welcome {
                map, content_hash, ..
            }) => {
                let mut w = Writer::default();
                map.write(&mut w);
                (w.finish(), map, content_hash)
            }
            other => panic!("the join answered with a Welcome, not {other:?}"),
        }
    }

    fn wake(&mut self) -> bool {
        self.now += TICK;
        self.room.wake(self.now)
    }

    /// Leaves, wakes until the room closes and returns its replay.
    fn close(mut self) -> rh_sim::replay::Replay {
        self.room.handle(
            RoomCmd::Leave {
                player: self.player,
                conn: 1,
            },
            self.now,
        );
        for _ in 0..400 {
            if !self.wake() {
                break;
            }
        }
        while let Ok(r) = self.reports.try_recv() {
            if let RoomReport::Closed {
                replay: Some(replay),
                ..
            } = r
            {
                return *replay;
            }
        }
        panic!("the room closed with a replay")
    }
}

#[tokio::test(start_paused = true)]
async fn two_rooms_on_one_map_send_byte_identical_blobs_with_the_anchors() {
    let a = pooled(true, SEED);
    let b = pooled(true, SEED);
    assert_eq!(a.welcome_map.static_bytes(), b.welcome_map.static_bytes());
    let (bytes_a, map_a, _) = Hand::new(&a).welcome();
    let (bytes_b, _, _) = Hand::new(&b).welcome();
    let want: Vec<MapAnchor> = generated(true, SEED).anchors.iter().map(wire).collect();
    assert_eq!(
        map_a.public.anchors, want,
        "the room's Welcome carries the anchors"
    );
    assert_eq!(bytes_a, bytes_b, "every client of every room gets one blob");
}

// ---- not gameplay -------------------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn anchors_change_no_state_hash_no_content_hash_and_no_replay() {
    let with = pooled(true, SEED);
    // The same served blob with only the anchors section removed.
    let served = blob(&with);
    let stripped = MapPublic {
        anchors: Vec::new(),
        ..served.public.clone()
    };
    let without = MapAssets {
        arena: with.arena.clone(),
        welcome_map: Arc::new(
            EncodedMap::from_public(
                served.w,
                served.h,
                &served.tiles,
                served.terrain.as_deref(),
                served.regions.as_deref(),
                &stripped,
            )
            .expect("the stripped blob encodes"),
        ),
    };
    let mut on = Hand::new(&with);
    let mut off = Hand::new(&without);
    let (_, on_map, on_content) = on.welcome();
    let (_, off_map, off_content) = off.welcome();
    assert!(
        off_map.public.anchors.is_empty(),
        "the control room sends no anchors"
    );
    assert!(
        !on_map.public.anchors.is_empty(),
        "the landmark room's Welcome carries anchors"
    );
    assert_eq!(off_content, rh_sim::content::content_hash());
    assert_eq!(
        on_content,
        rh_sim::content::content_hash(),
        "content hash unchanged"
    );
    for step in 0..120 {
        assert!(off.wake() && on.wake());
        assert_eq!(
            off.room.sim().state_hash(),
            on.room.sim().state_hash(),
            "state hash at step {step}"
        );
    }
    let recorded_without = off.close();
    let recorded_with = on.close();
    assert_eq!(recorded_without.hashes, recorded_with.hashes);
    assert_eq!(recorded_without.arena, recorded_with.arena);
    rh_sim::replay::run_replay(&recorded_with).expect("the replay of the anchored room verifies");
}
