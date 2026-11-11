//! Room and director lifecycle: when a room closes, what a Welcome carries, what the telemetry reports, what a room
//! costs. Rooms are driven by hand or on a paused clock (virtual time), so nothing here waits or flakes.

use rh_protocol::map::MapBlob;
use rh_protocol::{ServerMsg, PROTOCOL_VERSION};
use rh_server::director::{Director, DirectorConfig, Hello};
use rh_server::hosting::Lifecycle;
use rh_server::outbox::{Next, Outbox, FX_CAP};
use rh_server::persist::{Auth, Persistence};
use rh_server::room::{
    JoinOk, MapAssets, Room, RoomCmd, RoomConfig, RoomReport, UNCLAIMED_TIMEOUT,
};
use rh_sim::map::tile_to_world_center;
use rh_sim::{Arena, SimConfig, TileMap, Vec2};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

const TICK: Duration = Duration::from_millis(50);

/// A 12x8 room with two spawns: a lobby that stays a lobby (min 2 humans, a 30 s timer).
fn arena() -> Arena {
    let rows: Vec<String> = (0..8)
        .map(|y| {
            (0..12)
                .map(|x| {
                    if x == 0 || y == 0 || x == 11 || y == 7 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: vec![
            Vec2::new(tile_to_world_center(5), tile_to_world_center(4)),
            Vec2::new(tile_to_world_center(6), tile_to_world_center(4)),
        ],
    }
}

fn sim_config() -> SimConfig {
    SimConfig {
        hitboxes: Default::default(),
        mob_spacing: Default::default(),
        regen_in_combat: rh_sim::RegenInCombat::Legacy,
        walk_hints: None,
        regen: false,
        quests: false,
        training: false,
        dummies: false,
        consumables: true,
        abilities: rh_sim::abilities::Mode::Off,
        wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
        lifecycle: rh_sim::ArenaMode::Off,
        hazards: rh_sim::terrain::Mode::Off,
        mob_mode: rh_sim::mob_runtime::MobMode::Off,
        initial_loot: false,
        min_players: 2,
        lobby_seconds: 30.0,
        fill_seconds: 0.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
    }
}

fn director(tweak: impl FnOnce(&mut DirectorConfig)) -> Arc<Director> {
    let mut cfg = DirectorConfig {
        fill_bots_to: 4,
        ..DirectorConfig::new(sim_config(), arena())
    };
    tweak(&mut cfg);
    Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        Arc::new(Lifecycle::default()),
    )
}

async fn admit(
    d: &Director,
    profile: &str,
    conn: u64,
) -> (mpsc::Sender<RoomCmd>, JoinOk, Arc<Outbox>) {
    let outbox = Arc::new(Outbox::default());
    let (tx, ok) = d
        .admit(
            Hello {
                protocol: PROTOCOL_VERSION,
                content_hash: rh_sim::content::content_hash(),
                profile: profile.into(),
                ticket: b"t".to_vec(),
                faction: None,
                resume: None,
            },
            outbox.clone(),
            conn,
        )
        .await
        .unwrap_or_else(|e| panic!("admit {profile}: {e:?}"));
    (tx, ok, outbox)
}

fn closed_rooms(d: &Director) -> Vec<serde_json::Value> {
    d.info()["closedRooms"].as_array().unwrap().clone()
}

#[tokio::test(start_paused = true)]
async fn an_abandoned_lobby_closes_when_its_last_human_leaves_not_half_a_minute_later() {
    let d = director(|_| {});
    let (tx, ok, _out) = admit(&d, "alpha", 1).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(
        d.room_count(),
        1,
        "the lobby is up while its human is in it"
    );
    tx.send(RoomCmd::Leave {
        player: ok.player,
        conn: 1,
    })
    .await
    .unwrap();
    // The room's next wake sees nobody left to play for (it used to keep running its bots for UNCLAIMED_TIMEOUT).
    tokio::time::sleep(3 * TICK).await;
    assert_eq!(d.room_count(), 0, "the room closed at its first wake");
    assert_eq!(closed_rooms(&d).len(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_stalled_clients_skipped_snapshots_reach_the_closed_rooms_stats() {
    let d = director(|_| {});
    // The outbox is never drained: every snapshot after the first replaces an unsent one.
    let (tx, ok, out) = admit(&d, "alpha", 1).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    tx.send(RoomCmd::Leave {
        player: ok.player,
        conn: 1,
    })
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let c = out.counters();
    assert!(c.snapshots_skipped >= 15, "{c:?}");
    let closed = closed_rooms(&d);
    assert_eq!(closed.len(), 1);
    assert_eq!(closed[0]["snapshotsSkipped"], c.snapshots_skipped);
    assert_eq!(closed[0]["bytesEnqueuedTotal"], c.bytes_enqueued_total);
    assert!(closed[0]["bytesEnqueuedTotal"].as_u64().unwrap() > 0);
}

/// A room, driven by hand: `wake` at the instants the test chooses.
struct Hand {
    room: Room,
    opened: Instant,
    now: Instant,
    reports: mpsc::UnboundedReceiver<RoomReport>,
}

impl Hand {
    fn new(assets: &MapAssets, fill_bots_to: usize) -> Self {
        let (tx, reports) = mpsc::unbounded_channel();
        let now = Instant::now();
        let cfg = RoomConfig {
            sim: sim_config(),
            arena: assets.arena.clone(),
            welcome_map: assets.welcome_map.clone(),
            fill_bots_to,
            tick: TICK,
            record: false,
            fixed_secrets: None,
            fixed_bot_seed: None,
            reconnect_grace: Duration::from_secs(10),
            linger: Duration::from_secs(5),
        };
        Self {
            room: Room::new([7; 16], cfg, tx, now),
            opened: now,
            now,
            reports,
        }
    }

    fn join(&mut self, profile: &str, conn: u64, outbox: Arc<Outbox>) -> JoinOk {
        let (reply, mut rx) = oneshot::channel();
        self.room.handle(
            RoomCmd::Join {
                profile: profile.into(),
                faction: None,
                outbox,
                conn,
                fence: 1,
                reply,
            },
            self.now,
        );
        rx.try_recv().expect("replied").expect("seated")
    }

    fn handle(&mut self, cmd: RoomCmd) {
        self.room.handle(cmd, self.now);
    }

    /// One grid slot later; whether the room is still open.
    fn wake(&mut self) -> bool {
        self.now += TICK;
        self.room.wake(self.now)
    }

    fn reports(&mut self) -> Vec<RoomReport> {
        std::iter::from_fn(|| self.reports.try_recv().ok()).collect()
    }
}

fn assets() -> MapAssets {
    MapAssets::new(arena()).unwrap()
}

#[test]
fn a_room_closes_at_the_first_wake_after_its_last_human_leaves() {
    let mut h = Hand::new(&assets(), 4);
    let ok = h.join("alpha", 1, Arc::new(Outbox::default()));
    for _ in 0..40 {
        assert!(h.wake(), "open while its human is in it");
    }
    h.handle(RoomCmd::Leave {
        player: ok.player,
        conn: 1,
    });
    assert!(
        !h.wake(),
        "closed at the very next wake (it used to run on for ~600 steps)"
    );
    assert!(h
        .reports()
        .iter()
        .any(|r| matches!(r, RoomReport::Closed { .. })));
}

#[test]
fn a_dropped_human_keeps_the_room_open_until_its_grace_lapses() {
    let mut h = Hand::new(&assets(), 4);
    let ok = h.join("alpha", 1, Arc::new(Outbox::default()));
    h.handle(RoomCmd::Disconnected {
        player: ok.player,
        conn: 1,
    });
    for _ in 0..150 {
        assert!(h.wake(), "the seat is held for the reconnect grace");
    }
    let mut wakes = 150;
    while h.wake() {
        wakes += 1;
        assert!(wakes < 400, "the lapsed seat leaves and the room closes");
    }
    assert!(
        wakes >= 195,
        "closed only once the 10 s grace lapsed ({wakes} wakes)"
    );
}

#[test]
fn a_room_nobody_has_joined_yet_waits_for_its_first_player() {
    let mut h = Hand::new(&assets(), 4);
    // Admission may still be acquiring a durable lease: no human yet is not abandonment.
    while h.now + TICK < h.opened + UNCLAIMED_TIMEOUT {
        assert!(h.wake());
    }
    let mut closed = false;
    for _ in 0..3 {
        closed |= !h.wake();
    }
    assert!(closed, "an unclaimed room gives up after UNCLAIMED_TIMEOUT");
}

#[test]
fn stats_carry_every_connections_outbox_counters() {
    let mut h = Hand::new(&assets(), 0);
    let first = Arc::new(Outbox::default());
    let ok = h.join("alpha", 1, first.clone());
    // 40 fx frames into an outbox that holds FX_CAP: the rest are evicted unsent.
    for _ in 0..FX_CAP + 8 {
        first.fx(vec![0; 4]);
    }
    for _ in 0..3 {
        assert!(h.wake());
    }
    let s = h.room.stats();
    assert_eq!(s.fx_dropped, 8);
    assert!(s.snapshots_skipped >= 2, "{s:?}");
    assert!(s.bytes_enqueued_total >= 4 * (FX_CAP as u64 + 8));
    assert!(s.bytes_enqueued_total <= s.bytes_out + 4 * (FX_CAP as u64 + 8));

    // The connection drops and a new one resumes the seat: the old connection's counts stay in the room's totals.
    h.handle(RoomCmd::Disconnected {
        player: ok.player,
        conn: 1,
    });
    assert_eq!(h.room.stats().fx_dropped, 8, "kept after the disconnect");
    let second = Arc::new(Outbox::default());
    let (reply, mut rx) = oneshot::channel();
    h.handle(RoomCmd::Resume {
        session: ok.session,
        outbox: second.clone(),
        conn: 2,
        reply,
    });
    rx.try_recv().unwrap().expect("resumed");
    for _ in 0..FX_CAP + 3 {
        second.fx(vec![0; 4]);
    }
    assert_eq!(h.room.stats().fx_dropped, 8 + 3, "both connections count");
    let before = h.room.stats().snapshots_skipped;
    for _ in 0..3 {
        assert!(h.wake());
    }
    assert!(h.room.stats().snapshots_skipped > before);

    // The room closing folds the live outbox in too and reports the totals.
    h.handle(RoomCmd::Leave {
        player: ok.player,
        conn: 2,
    });
    assert!(!h.wake());
    let totals = h.room.stats();
    let closed = h
        .reports()
        .into_iter()
        .find_map(|r| match r {
            RoomReport::Closed { stats, .. } => Some(stats),
            _ => None,
        })
        .expect("Closed report");
    assert_eq!(closed.fx_dropped, 11);
    assert_eq!(closed.fx_dropped, totals.fx_dropped);
    assert_eq!(closed.snapshots_skipped, totals.snapshots_skipped);
    assert_eq!(closed.bytes_enqueued_total, totals.bytes_enqueued_total);
}

#[test]
fn rooms_of_one_map_share_one_arena_and_one_encoded_welcome_blob() {
    let assets = assets();
    let a = Hand::new(&assets, 0);
    let b = Hand::new(&assets, 0);
    assert!(Arc::ptr_eq(
        a.room.sim().shared_arena(),
        b.room.sim().shared_arena()
    ));
    assert!(Arc::ptr_eq(a.room.sim().shared_arena(), &assets.arena));
}

/// The legacy frame: the map copied into a `ServerMsg::Welcome` and run-length encoded for this one message.
fn legacy_welcome(room_welcome: &[u8], arena: &Arena) -> Vec<u8> {
    let ServerMsg::Welcome {
        protocol,
        content_hash,
        match_id,
        player_id,
        session,
        tick_rate,
        tick,
        server_ms,
        archetypes,
        vision,
        weapons,
        map,
    } = ServerMsg::decode(room_welcome).expect("a Welcome")
    else {
        panic!("not a Welcome")
    };
    assert_eq!(map.tiles, arena.map.tiles, "the map the sim plays on");
    assert_eq!(
        weapons,
        rh_server::room::weapon_table(),
        "the room's Welcome carries the sim content's weapon table"
    );
    ServerMsg::Welcome {
        archetypes,
        vision,
        weapons,
        protocol,
        content_hash,
        match_id,
        player_id,
        session,
        tick_rate,
        tick,
        server_ms,
        map: MapBlob::new(
            arena.map.w as u16,
            arena.map.h as u16,
            arena.map.tiles.clone(),
        ),
    }
    .encode()
}

#[test]
fn the_welcome_is_byte_identical_to_encoding_the_map_per_message_on_join_and_resume() {
    let arena = arena();
    let mut h = Hand::new(&MapAssets::new(arena.clone()).unwrap(), 0);
    let ok = h.join("alpha", 1, Arc::new(Outbox::default()));
    assert_eq!(ok.welcome, legacy_welcome(&ok.welcome, &arena));
    let (reply, mut rx) = oneshot::channel();
    for _ in 0..7 {
        assert!(h.wake());
    }
    h.handle(RoomCmd::Resume {
        session: ok.session,
        outbox: Arc::new(Outbox::default()),
        conn: 2,
        reply,
    });
    let again = rx.try_recv().unwrap().expect("resumed");
    assert_eq!(again.session, ok.session);
    assert_ne!(
        again.welcome, ok.welcome,
        "the resync carries the current tick"
    );
    assert_eq!(again.welcome, legacy_welcome(&again.welcome, &arena));
}

#[tokio::test(start_paused = true)]
async fn the_director_sends_the_same_welcome_bytes_as_a_per_message_encode() {
    let d = director(|_| {});
    let (_tx, ok, _out) = admit(&d, "alpha", 1).await;
    assert_eq!(ok.welcome, legacy_welcome(&ok.welcome, &arena()));
}

/// Allocation probe, run under DHAT by hand (see docs): N rooms (each on its own run) holding the seed-1 map, and the
/// bytes they keep. `cargo test -p rh-server --test lifecycle -- --ignored --exact room_heap_probe --nocapture` with
/// ROOMS=n, under `valgrind --tool=dhat`.
#[tokio::test(start_paused = true)]
#[ignore = "measurement, run under valgrind --tool=dhat"]
async fn room_heap_probe() {
    let n: usize = std::env::var("ROOMS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8);
    let map =
        std::env::var("RH_PROBE_MAP").unwrap_or_else(|_| "../../parity/maps/seed1.map.json".into());
    let arena = rh_headless::load_arena(&map).expect("map");
    // One human closes the lobby on the first step: the next admission opens a room of its own.
    let sim = SimConfig {
        hitboxes: Default::default(),
        mob_spacing: Default::default(),
        regen_in_combat: rh_sim::RegenInCombat::Legacy,
        walk_hints: None,
        regen: false,
        quests: false,
        training: false,
        dummies: false,
        consumables: true,
        abilities: rh_sim::abilities::Mode::Off,
        wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
        lifecycle: rh_sim::ArenaMode::Off,
        hazards: rh_sim::terrain::Mode::Off,
        mob_mode: rh_sim::mob_runtime::MobMode::Off,
        initial_loot: false,
        min_players: 1,
        lobby_seconds: 0.0,
        fill_seconds: 0.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
    };
    let mut cfg = DirectorConfig::new(sim, arena);
    cfg.max_rooms = n;
    let d = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        Arc::new(Lifecycle::default()),
    );
    let mut held = Vec::new();
    for i in 0..n {
        held.push(admit(&d, &format!("probe{i}"), i as u64 + 1).await);
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert_eq!(d.room_count(), n);
    // A few seconds of steps in every room, outboxes drained like a writer would.
    for _ in 0..40 {
        tokio::time::sleep(TICK).await;
        for (_, _, out) in &held {
            while let Ok(next) = tokio::time::timeout(Duration::ZERO, out.next()).await {
                if matches!(next, Next::Close(_)) {
                    break;
                }
            }
        }
    }
    assert_eq!(d.room_count(), n);
    println!("PROBE rooms={n} ok");
    drop(held);
}
