//! The density benchmark engine: N rooms of H humans through the real `Room`/`run_room`, `Outbox` and `Pacer`, on a
//! paused tokio clock, with in-process clients in place of sockets. Deterministic: fixed secrets and bot seeds, no
//! entropy in the timing path, a paused clock (virtual time advances only when every task is idle), one thread, and
//! every `select!` biased. Two runs of the same options execute the same instructions (callgrind: within +-0.05%).
//!
//! The in-process client is what `conn.rs`'s writer does with the outbox minus the socket: it awaits
//! `Outbox::wait_drain()` and takes the whole batch of one tick. A "writer wake" is a time that await had to park
//! (the outbox was empty) and was woken by a notify; frames that were already queued when the client looked are
//! drained in the same wake. A human also sends inputs on a deterministic schedule (profile `active`) through the
//! room's inbox, as `conn.rs` forwards them.
//!
//! Bots: `Opts::fill_to` fills each room with scripted bots up to that many players, driven by the room task like any
//! other seat; they have no outbox and no in-process client, so `humans` alone is what the per-human-tick figures
//! divide by (the default `humans` = `fill_to` = 8 means no bots at all: use e.g. `humans 4, fill_to 8` for a mixed
//! room).
//!
//! Heap per room is not measured here: the workspace forbids `unsafe`, so no counting allocator. Run the binary under
//! DHAT (`valgrind --tool=dhat`) at `--rooms 1` and `--rooms N`: (t-gmax(N) - t-gmax(1)) / (N - 1) is the exact heap
//! per room, deterministic. `rssPerRoomBytes` in the output is only an informational cross-check.
//!
//! Why not sockets (`rh_server::serve_with`, as `examples/connheap.rs` does): a paused clock auto-advances whenever
//! the runtime parks, including while a loopback socket round-trip is in flight, so a socket run is neither
//! deterministic nor reproducible in instructions (and tokio-tungstenite, the client, is a dev-dependency a bin
//! cannot use). `connheap` stays the socket-level heap check; `transport.rs`/`live.rs` the socket-level behaviour.
//! This engine covers everything behind the connection: room, sim, observe, encode, outbox, pacer. The director is
//! not in the path either: it would put all humans into one lobby per MAX_PLAYERS in arrival order with OS-random
//! match ids and secrets.

use rh_protocol::{ServerMsg, WireCommand};
use rh_server::metrics::Metrics;
use rh_server::outbox::{Drained, Outbox};
use rh_server::room::{run_room, MapAssets, Room, RoomCmd, RoomConfig, RoomReport};
use rh_sim::{Arena, Secrets, SimConfig};
use std::future::Future;
use std::pin::pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::task::Poll;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Profile {
    /// Joined and connected, sending nothing.
    Idle,
    /// A move order every 100 ms, an attack/release pair every 500 ms (a busy but plausible human).
    Active,
}

#[derive(Clone)]
pub struct Opts {
    pub rooms: usize,
    pub humans: usize,
    /// Rooms are filled with scripted bots up to this many players (0: none).
    pub fill_to: usize,
    /// Virtual seconds to run after everyone joined.
    pub secs: u64,
    pub lobby_secs: f64,
    pub profile: Profile,
    pub seed: u64,
    pub arena: Arc<Arena>,
}

impl Opts {
    pub fn new(arena: Arena) -> Self {
        Self {
            rooms: 4,
            humans: 8,
            fill_to: 8,
            secs: 20,
            lobby_secs: 2.0,
            profile: Profile::Active,
            seed: 1,
            arena: Arc::new(arena),
        }
    }
}

#[derive(Default)]
struct ClientCounters {
    frames: AtomicU64,
    bytes: AtomicU64,
    /// Times the client had to park on an empty outbox and was woken by a notify.
    wakes: AtomicU64,
}

pub struct Report {
    pub rooms: usize,
    pub humans: usize,
    pub rooms_closed: usize,
    pub match_seconds: f64,
    pub human_ticks: u64,
    pub steps: u64,
    pub dropped_steps: u64,
    pub frames: u64,
    pub bytes: u64,
    /// Real `Notify::notify_one` calls on the clients' outboxes (counted by the outbox at the call), over the run, not
    /// counting the ones that closed a connection.
    pub notifies: u64,
    /// Outbox pushes the rooms counted in their metrics (`Metrics::outbox_pushes`): the cross-check for `notifies`.
    pub pushes: u64,
    pub writer_wakes: u64,
    /// Resident-set growth per room over the run (informational: RSS is not deterministic; exact heap comes from DHAT).
    pub rss_per_room: Option<u64>,
    pub wall: Duration,
    pub metrics: serde_json::Value,
}

impl Report {
    pub fn per_human_tick(&self, n: u64) -> f64 {
        n as f64 / self.human_ticks.max(1) as f64
    }
}

struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
}

/// `outbox.wait_drain(batch)` and whether it had to park first.
async fn drain_counted(outbox: &Outbox, batch: &mut Vec<Vec<u8>>, wakes: &AtomicU64) -> Drained {
    let mut fut = pin!(outbox.wait_drain(batch));
    let mut parked = false;
    std::future::poll_fn(|cx| match fut.as_mut().poll(cx) {
        Poll::Pending => {
            parked = true;
            Poll::Pending
        }
        Poll::Ready(v) => {
            if parked {
                wakes.fetch_add(1, Ordering::Relaxed);
            }
            Poll::Ready(v)
        }
    })
    .await
}

async fn drain(outbox: Arc<Outbox>, c: Arc<ClientCounters>, check: bool) {
    let mut batch: Vec<Vec<u8>> = Vec::new();
    loop {
        let d = drain_counted(&outbox, &mut batch, &c.wakes).await;
        for f in batch.drain(..) {
            c.frames.fetch_add(1, Ordering::Relaxed);
            c.bytes.fetch_add(f.len() as u64, Ordering::Relaxed);
            if check {
                ServerMsg::decode(&f).expect("every frame the room pushed decodes");
            }
        }
        if d.close.is_some() {
            return;
        }
    }
}

async fn inputs(
    tx: mpsc::Sender<RoomCmd>,
    player: rh_sim::PlayerId,
    conn: u64,
    arena: Arc<Arena>,
    mut rng: Lcg,
) {
    let (w, h) = (i64::from(arena.map.w), i64::from(arena.map.h));
    let mut seq = 0u32;
    loop {
        tokio::time::sleep(Duration::from_millis(100)).await;
        seq += 1;
        let tx_ = (rng.next() as i64 % (w - 2).max(1)) + 1;
        let ty_ = (rng.next() as i64 % (h - 2).max(1)) + 1;
        let a = (rng.next() % 6283) as f32 / 1000.0;
        let mut commands = vec![WireCommand::Move {
            x: rh_sim::map::tile_to_world_center(tx_) as f32,
            y: rh_sim::map::tile_to_world_center(ty_) as f32,
            seq: Some((seq & 0xff) as u8),
        }];
        if seq % 5 == 0 {
            commands.push(WireCommand::Attack { a, t: None });
            commands.push(WireCommand::Release { a, t: None });
        }
        let cmd = RoomCmd::Input {
            player,
            conn,
            seq,
            commands,
        };
        match tx.try_send(cmd) {
            Ok(()) | Err(mpsc::error::TrySendError::Full(_)) => {}
            Err(mpsc::error::TrySendError::Closed(_)) => return,
        }
    }
}

/// Runs the benchmark on the current (paused, single-threaded) runtime. `check_frames` also decodes every frame (a
/// correctness check for tests; it adds client-side instructions).
pub async fn run(o: &Opts, check_frames: bool) -> Report {
    let metrics: &'static Metrics = Box::leak(Box::new(Metrics::new()));
    let assets = MapAssets::new(o.arena.clone()).expect("map encodes");
    let sim = SimConfig {
        regen: false,
        quests: false,
        abilities: rh_sim::abilities::Mode::Off,
        wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
        lifecycle: rh_sim::ArenaMode::Off,
        hazards: rh_sim::terrain::Mode::Off,
        mob_mode: rh_sim::mob_runtime::MobMode::Off,
        initial_loot: false,
        min_players: 2,
        lobby_seconds: o.lobby_secs,
        fill_seconds: 0.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
    };
    let (rep_tx, mut rep_rx) = mpsc::unbounded_channel();
    let rss0 = rh_server::metrics::rss_bytes();
    let mut senders = Vec::new();
    let mut counters = Vec::new();
    let mut outboxes: Vec<Arc<Outbox>> = Vec::new();
    let mut tasks = Vec::new();
    let mut input_tasks = Vec::new();
    let mut conn = 0u64;
    for r in 0..o.rooms {
        let mut id = [0u8; 16];
        id[8..].copy_from_slice(&(r as u64).to_be_bytes());
        let cfg = RoomConfig {
            sim: sim.clone(),
            arena: assets.arena.clone(),
            welcome_map: assets.welcome_map.clone(),
            fill_bots_to: o.fill_to,
            tick: Duration::from_millis(rh_sim::constants::TICK_MS as u64),
            record: false,
            fixed_secrets: Some(Secrets::from_seed(o.seed.wrapping_add(r as u64))),
            fixed_bot_seed: Some(o.seed.wrapping_mul(1_000_003).wrapping_add(r as u64)),
            reconnect_grace: rh_server::room::RECONNECT_GRACE,
            linger: rh_server::room::LINGER,
        };
        let room = Room::new(id, cfg, rep_tx.clone(), Instant::now()).with_metrics(metrics);
        let (tx, rx) = mpsc::channel(rh_server::room::INBOUND_CAP);
        tasks.push(tokio::spawn(run_room(room, rx)));
        for hnum in 0..o.humans {
            conn += 1;
            let outbox = Arc::new(Outbox::default());
            let (rtx, rrx) = oneshot::channel();
            tx.send(RoomCmd::Join {
                profile: format!("r{r}h{hnum}"),
                faction: None,
                outbox: outbox.clone(),
                conn,
                fence: 0,
                reply: rtx,
            })
            .await
            .expect("room inbox");
            let ok = rrx.await.expect("join reply").expect("seat");
            let c = Arc::new(ClientCounters::default());
            counters.push(c.clone());
            outboxes.push(outbox.clone());
            tasks.push(tokio::spawn(drain(outbox, c, check_frames)));
            if o.profile == Profile::Active {
                let rng = Lcg(o.seed ^ conn.wrapping_mul(0x9E37_79B9_7F4A_7C15));
                input_tasks.push(tokio::spawn(inputs(
                    tx.clone(),
                    ok.player,
                    conn,
                    o.arena.clone(),
                    rng,
                )));
            }
        }
        senders.push(tx);
    }
    let wall0 = std::time::Instant::now();
    tokio::time::sleep(Duration::from_secs(o.secs)).await;
    let wall = wall0.elapsed();
    let rss1 = rh_server::metrics::rss_bytes();
    // The input tasks hold inbox senders: stop them, then closing every inbox closes the rooms; their stats arrive as `Closed` reports.
    for t in &input_tasks {
        t.abort();
    }
    drop(senders);
    let mut stats = Vec::new();
    while stats.len() < o.rooms {
        if let RoomReport::Closed { stats: s, .. } = rep_rx.recv().await.expect("room reports") {
            stats.push(s);
        }
    }
    for t in tasks {
        let _ = t.await;
    }
    // The notifies the ticks caused: every real call, less the one each connection's close made.
    let notifies: u64 = outboxes
        .iter()
        .map(|o| o.notify_calls() - o.close_notify_calls())
        .sum();
    let ticks: u64 = stats.iter().map(|s| s.ticks).sum();
    let dropped: u64 = stats.iter().map(|s| s.dropped_steps).sum();
    let sum = |f: fn(&ClientCounters) -> &AtomicU64| {
        counters
            .iter()
            .map(|c| f(c).load(Ordering::Relaxed))
            .sum::<u64>()
    };
    Report {
        rooms: o.rooms,
        humans: o.humans,
        rooms_closed: stats.len(),
        match_seconds: ticks as f64 / rh_sim::constants::TICK_RATE as f64,
        human_ticks: ticks * o.humans as u64,
        steps: ticks,
        dropped_steps: dropped,
        frames: sum(|c| &c.frames),
        bytes: sum(|c| &c.bytes),
        notifies,
        pushes: metrics.outbox_pushes.load(Ordering::Relaxed),
        writer_wakes: sum(|c| &c.wakes),
        rss_per_room: rss0
            .zip(rss1)
            .map(|(a, b)| b.saturating_sub(a) / o.rooms.max(1) as u64),
        wall,
        metrics: metrics.json(),
    }
}
