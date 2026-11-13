//! P-DRESS-BAKE-1 oracle: the server dresses every map it serves, once, when the map is prepared, with
//! `rh_mapdress::dress(map, map_hash, rules)` and the shipped rules, and the Welcome's map blob carries the result. The
//! tests compare against `dress` itself and the rules' own declared values (never pinned digests of generated maps:
//! the generator and the rules move under P-DRESS-* and P-MAPGEN-* packets).
//!
//! Wire form of a `Dressing` (docs/backlog/packets/P-DRESS-BAKE-1.md "Server rules"):
//! - props: every `DressProp` as a `MapProp` with the same five fields, sorted by `(y, x, kind)`; absent when empty;
//! - ground plane: `Dressing::ground_variants` as is when any cell is non-zero, else absent;
//! - `map_hash` is `u64::from(legacy_map_hash_u32)` of the map's export (the pool's maker sets it to `map_hash::map_hash`).

use rh_mapdress::{dress, Dressing, Rules};
use rh_protocol::map::{
    MapBlob, MapProp, MapPublic, LEGACY_PROP_KINDS, MAX_GROUND_VARIANT, MAX_MAP_PROPS,
    MAX_PROP_KIND, PROP_FLAG_LEGACY, PROP_FLAG_TALL,
};
use rh_protocol::{GroundMode, Reader, ServerMsg, Writer};
use rh_server::map_pool::{MapPool, MapPoolOptions, StyledMaker};
use rh_server::outbox::Outbox;
use rh_server::room::{MapAssets, Room, RoomCmd, RoomConfig, RoomReport};
use rh_sim::mapdata::{GameMapData, MapExport};
use rh_sim::mapgen::{coliseum, map_hash, pipeline};
use rh_sim::{Arena, Secrets};
use std::collections::BTreeSet;
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

fn dressed(map: &GameMapData, hash: u32) -> Dressing {
    dress(map, u64::from(hash), &Rules::starter())
}

fn hash_of(map: &GameMapData) -> u32 {
    u32::from_str_radix(&map_hash::map_hash(map), 16).expect("hex map hash")
}

/// `Dressing` in its wire form: props sorted by `(y, x, kind)`, the plane only when some cell is non-zero.
fn wire(d: &Dressing) -> (Vec<MapProp>, Option<Vec<u8>>) {
    let mut props: Vec<MapProp> = d
        .props
        .iter()
        .map(|p| MapProp {
            kind: p.kind,
            x: p.x,
            y: p.y,
            variant: p.variant,
            flags: p.flags,
        })
        .collect();
    props.sort_by_key(|p| (p.y, p.x, p.kind));
    let ground = d
        .ground_variants
        .iter()
        .any(|&v| v != 0)
        .then(|| d.ground_variants.clone());
    (props, ground)
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

fn seed1_export() -> MapExport {
    serde_json::from_slice(SEED1_EXPORT).unwrap()
}

// ---- the blob carries `dress` of the served map ---------------------------------------------------------------------

#[test]
fn a_pooled_map_s_blob_carries_dress_of_that_map_with_the_shipped_rules() {
    for signature in [false, true] {
        let map = generated(signature, SEED);
        let (props, ground) = wire(&dressed(&map, hash_of(&map)));
        assert!(!props.is_empty(), "the shipped rules dress seed {SEED}");
        let served = blob(&pooled(signature, SEED));
        assert_eq!(
            served.public.props.len(),
            props.len(),
            "signature {signature}: one wire prop per dressed prop"
        );
        assert_eq!(served.public.props, props, "signature {signature}: props");
        assert_eq!(
            served.public.ground_variants, ground,
            "signature {signature}: ground plane"
        );
    }
}

#[test]
fn the_fixed_map_is_dressed_and_a_map_without_layers_is_not() {
    let export = seed1_export();
    let (props, ground) = wire(&dressed(&export.map, export.legacy_map_hash_u32));
    let arena = rh_server::runtime::source_map(SEED1_EXPORT).unwrap();
    let served = blob(&MapAssets::new(arena).unwrap());
    assert_eq!(
        served.public.props.len(),
        props.len(),
        "the fixed --map carries one wire prop per dressed prop"
    );
    assert_eq!(served.public.props, props);
    assert_eq!(served.public.ground_variants, ground);

    // A map with no layers has nothing to dress: exactly today's blob.
    let practice = blob(&MapAssets::new(rh_sim::arenas::practice_arena()).unwrap());
    assert_eq!(practice.public, MapPublic::default());
}

#[test]
fn a_landmark_map_s_blob_carries_the_landmark_bands_ground_variants() {
    let rules = Rules::starter();
    let fallback: BTreeSet<u8> = rules
        .zones
        .iter()
        .flat_map(|z| {
            z.rings
                .iter()
                .map(|r| r.ground_variant)
                .chain(z.terrain_rings.iter().map(|r| r.ground_variant))
        })
        .collect();
    let bands: BTreeSet<u8> = rules
        .zones
        .iter()
        .flat_map(|z| z.landmark.iter().flat_map(|l| l.rings.iter()))
        .map(|r| r.ground_variant)
        .filter(|v| *v != 0 && !fallback.contains(v))
        .collect();
    assert!(
        !bands.is_empty(),
        "the shipped rules declare landmark band variants"
    );
    let map = generated(true, SEED);
    assert!(!map.anchors.is_empty(), "landmark mode places anchors");

    let landmark = blob(&pooled(true, SEED));
    let plane = landmark.public.ground_variants.as_deref().unwrap_or(&[]);
    assert_eq!(
        plane.len(),
        landmark.tiles.len(),
        "a landmark-mode map ships a ground-variant plane"
    );
    let present: BTreeSet<u8> = plane.iter().copied().collect();
    for v in &bands {
        assert!(
            present.contains(v),
            "landmark band ground variant {v} reaches the wire"
        );
    }

    // Without the signature option the fallback rings dress the map: no landmark band variant.
    let off = blob(&pooled(false, SEED));
    let off_plane = off.public.ground_variants.as_deref().unwrap_or(&[]);
    assert!(
        !off_plane.is_empty(),
        "an option-off map ships its fallback ground plane"
    );
    assert!(
        off_plane.iter().all(|v| !bands.contains(v)),
        "an option-off map has no landmark band variant"
    );
}

// ---- determinism: two preparations, two rooms, one blob ---------------------------------------------------------------

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
async fn two_rooms_given_the_same_map_send_byte_identical_blobs() {
    // Two independent preparations of one seed (two pool takes), one room on each.
    let a = pooled(true, SEED);
    let b = pooled(true, SEED);
    assert_eq!(a.welcome_map.static_bytes(), b.welcome_map.static_bytes());
    let (bytes_a, map_a, _) = Hand::new(&a).welcome();
    let (bytes_b, _, _) = Hand::new(&b).welcome();
    assert!(
        !map_a.public.props.is_empty(),
        "the rooms' Welcome carries the dressing"
    );
    assert_eq!(bytes_a, bytes_b, "every client of every room gets one blob");
}

// ---- not gameplay -----------------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn dressing_changes_no_state_hash_no_content_hash_and_no_replay() {
    let arena: Arena = rh_server::runtime::source_map(SEED1_EXPORT).unwrap();
    let undressed = MapAssets {
        arena: Arc::new(arena.clone()),
        welcome_map: Arc::new(rh_server::public_ground::encode_static_map(&arena.map).unwrap()),
    };
    let with_dressing = MapAssets::new(arena).unwrap();
    let mut off = Hand::new(&undressed);
    let mut on = Hand::new(&with_dressing);
    let (_, off_map, off_content) = off.welcome();
    let (_, on_map, on_content) = on.welcome();
    assert!(
        off_map.public.props.is_empty(),
        "the control room is undressed"
    );
    assert!(
        !on_map.public.props.is_empty(),
        "the dressed room's Welcome carries props"
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
    // The replay recorded without dressing verifies on this build, which dresses.
    rh_sim::replay::run_replay(&recorded_without).expect("the undressed replay verifies");
}

// ---- start-up and caps ------------------------------------------------------------------------------------------------

#[test]
fn dressing_rules_that_fail_to_parse_are_a_start_up_error() {
    let shipped = rh_server::runtime::dress_rules(rh_server::runtime::DRESS_RULES_JSON);
    assert_eq!(shipped, Ok(Rules::starter()));
    let broken = rh_server::runtime::dress_rules("{\"version\": 1, \"kinds\": ");
    assert!(broken.is_err(), "a broken rule file is refused");
    let msg = broken.unwrap_err();
    assert!(
        msg.contains("dressing rules") && msg.contains("rule file"),
        "the message names the dressing rules and the parser's reason: {msg}"
    );
}

#[test]
fn the_wire_caps_cover_the_shipped_rules() {
    let rules = Rules::starter();
    for k in &rules.kinds {
        assert!(
            (1..=MAX_PROP_KIND).contains(&k.code),
            "kind {} code {} is inside the wire's rule range",
            k.name,
            k.code
        );
    }
    let variants = rules.zones.iter().flat_map(|z| {
        z.rings
            .iter()
            .map(|r| r.ground_variant)
            .chain(
                z.landmark
                    .iter()
                    .flat_map(|l| l.rings.iter().map(|r| r.ground_variant)),
            )
            .chain(z.terrain_rings.iter().map(|r| r.ground_variant))
    });
    for v in variants {
        assert!(v <= MAX_GROUND_VARIANT, "ground variant {v} fits the wire");
    }
    assert_eq!(
        usize::from(LEGACY_PROP_KINDS),
        rh_sim::mapgen::terrain_gate::DEFAULT_DEFINITION.props.len()
    );
    assert_eq!(rh_mapdress::MAX_PROPS, MAX_MAP_PROPS);
    assert_eq!(rh_mapdress::FLAG_TALL, PROP_FLAG_TALL);
    assert_eq!(rh_mapdress::FLAG_LEGACY, PROP_FLAG_LEGACY);
}
