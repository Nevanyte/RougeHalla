//! The map pool (P-MAP-3; legacy `packages/server/src/mapPool.ts` and `mapWorker.ts`): certified maps made ahead of time on
//! a worker thread, so opening a room never waits for the generator. Process infrastructure, outside `rh-sim`: the sim
//! only ever receives a finished [`Arena`], and the seeds come from the server's entropy, never from a match's secrets.
//!
//! One worker thread holds its own layout tables and certifies fresh random seeds, one request per map, only while the
//! queue is short: an idle server generates nothing. Every map is admitted again on arrival ([`admit`]: it fits the wire,
//! seats every player and encodes as a Welcome), and what the pool serves is that admitted [`MapAssets`].
//!
//! An empty queue (a burst, a worker that is down or still warming) serves the configured map at once when a worker
//! exists, logged; the calling thread never certifies. `target` 0 (no worker) is the inline mode, for tests only: it
//! certifies on the calling thread, and if `MAP_FALLBACK_SEEDS` fresh seeds all fail there the room gets the configured
//! map instead of an error (legacy throws; a room that cannot open is worse than a repeated map). A worker that panics, reports a
//! generator error, keeps sending maps that fail admission, or answers nothing for `MAP_WORKER_HANG` while it owes a reply
//! is replaced, with a restart delay that doubles per failure in a row (1 s up to 60 s). A hung thread cannot be killed:
//! it is abandoned (its replies go nowhere) and keeps its core until the generator returns.
//!
//! Legacy's training-room reuse (`takeForTraining`) has no counterpart: a Rust training server plays the practice arena
//! (`runtime.rs`) and never runs a pool.
use crate::room::MapAssets;
use rh_sim::Arena;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

/// Maps the queue holds when full: a burst of this many rooms never waits.
pub const MAP_POOL_TARGET: usize = 8;
/// The worker is asked for more once the queue (counting maps already asked for) is down to this many.
pub const MAP_POOL_REFILL_AT: usize = 6;
/// Fresh seeds the in-process fallback tries before the room gets the configured map.
pub const MAP_FALLBACK_SEEDS: usize = 8;
/// Maps in a row from one worker that fail admission before it counts as crashed. One bad map is a blip, not a crash.
pub const MAP_REJECT_LIMIT: u32 = 3;
/// First restart delay after a worker failure; it doubles with every failure in a row, up to the max.
pub const MAP_WORKER_RESTART: Duration = Duration::from_secs(1);
pub const MAP_WORKER_RESTART_MAX: Duration = Duration::from_secs(60);
/// A worker that sends nothing for this long while it owes a reply is hung and replaced.
pub const MAP_WORKER_HANG: Duration = Duration::from_secs(5);
/// Most abandoned (hung, still running) worker threads at once; at the cap the pool stops restarting and serves the
/// configured map (P-MAP-3-fix).
pub const MAP_ABANDONED_CAP: usize = 2;
/// How often the supervisor looks at the worker while a reply is owed.
const SUPERVISOR_TICK: Duration = Duration::from_millis(100);

/// What makes a map from a seed: the real generator ([`StyledMaker`]) or a test double.
pub trait MapMaker: Send + Sync + 'static {
    /// The certified map for `seed`; `Ok(None)` when no attempt certifies (a discarded seed); `Err` when the generator
    /// itself failed (a bug, not a refused attempt).
    fn make(&self, seed: u32) -> Result<Option<Arena>, String>;

    /// [`Self::make`] with the map's decoration (P-DRESS-BAKE-1), computed where the map is made (the worker thread, or
    /// the caller in inline mode). The default computes none here: [`admit_made`] then dresses the arena itself
    /// ([`MapAssets::new`]).
    fn make_dressed(&self, seed: u32) -> Result<Option<MadeMap>, String> {
        Ok(self.make(seed)?.map(|arena| MadeMap {
            arena,
            dressing: None,
        }))
    }
}

/// A made map and, when the maker computed it, its decoration (`rh_mapdress::dress` of the generator's map, landmark
/// anchors included). `None`: the arena is dressed on admission.
pub struct MadeMap {
    pub arena: Arena,
    pub dressing: Option<rh_mapdress::Dressing>,
}

/// The generator as the server runs it: legacy `certifiedMap(seed, { decor: false })`, the complete styled pipeline. The
/// generator builds no decor; the server dresses the finished map with `rh_mapdress` (P-DRESS-BAKE-1,
/// [`MapMaker::make_dressed`]) before it becomes an arena, since the arena drops the landmark anchors the dressing reads.
#[derive(Clone, Copy, Debug, Default)]
pub struct StyledMaker {
    /// Generate every map with the signature landmarks (owner decision 6): the generator's `Options::signature`.
    pub signature: bool,
}

impl StyledMaker {
    /// The generator options this maker runs with: no decor, and with `signature` the generator places every zone's
    /// signature landmark itself (`rh_sim::mapgen::landmarks::signature`; P-MAPGEN-SIGNATURE-CORE-1, P-MAPGEN-SIG-FIRE-1,
    /// P-MAPGEN-SIG-FROST-1). Nothing is added after generation.
    pub fn options(&self) -> rh_sim::mapgen::pipeline::Options {
        rh_sim::mapgen::pipeline::Options {
            decor: false,
            signature: self.signature,
            ..rh_sim::mapgen::pipeline::Options::default()
        }
    }

    /// The certified generator map for `seed` (anchors still on it) and its export hash, `map_hash::map_hash`.
    fn generate(&self, seed: u32) -> Result<Option<rh_sim::mapdata::MapExport>, String> {
        use rh_sim::mapgen::{coliseum, map_hash, pipeline};
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        let options = self.options();
        let Some(map) = generator
            .certified_styled(i64::from(seed), options)
            .map_err(|e| format!("{e:?}"))?
        else {
            return Ok(None);
        };
        let legacy_map_hash_u32 =
            u32::from_str_radix(&map_hash::map_hash(&map), 16).map_err(|e| e.to_string())?;
        Ok(Some(rh_sim::mapdata::MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32,
            map,
        }))
    }
}

fn into_arena(export: rh_sim::mapdata::MapExport) -> Result<Arena, String> {
    export
        .validate()
        .map_err(|e| e.to_string())?
        .into_arena()
        .map_err(|e| e.to_string())
}

impl MapMaker for StyledMaker {
    fn make(&self, seed: u32) -> Result<Option<Arena>, String> {
        self.generate(seed)?.map(into_arena).transpose()
    }

    /// Dresses the generator's map with the shipped rules and its own hash BEFORE it becomes an arena: the arena drops
    /// the landmark anchors, and a landmark map dressed without them would get the fallback rings.
    fn make_dressed(&self, seed: u32) -> Result<Option<MadeMap>, String> {
        let Some(export) = self.generate(seed)? else {
            return Ok(None);
        };
        let rules = crate::runtime::shipped_dress_rules()?;
        let dressing = rh_mapdress::dress(
            &export.map,
            u64::from(export.legacy_map_hash_u32),
            rules,
        );
        Ok(Some(MadeMap {
            arena: into_arena(export)?,
            dressing: Some(dressing),
        }))
    }
}

/// The arrival check: a map is served only if it fits the wire position range, has a spawn for every seat and encodes as
/// a Welcome. Run on every worker map before it is queued and on every fallback map. Dresses the arena itself
/// ([`MapAssets::new`]).
pub fn admit(arena: Arena) -> Result<MapAssets, String> {
    admit_made(MadeMap {
        arena,
        dressing: None,
    })
}

/// [`admit`] for a made map: its own dressing when the maker computed one, else the arena's.
pub fn admit_made(made: MadeMap) -> Result<MapAssets, String> {
    let MadeMap { arena, dressing } = made;
    crate::wire::arena_fits(&arena)?;
    if arena.spawns.len() < rh_sim::constants::MAX_PLAYERS {
        return Err(format!(
            "{} spawns for {} seats",
            arena.spawns.len(),
            rh_sim::constants::MAX_PLAYERS
        ));
    }
    match dressing {
        Some(d) => MapAssets::dressed(arena, Some(&d)),
        None => MapAssets::new(arena),
    }
    .map_err(|e| format!("{e:?}"))
}

/// A fresh public map seed from the OS: legacy `freshSeed`, `randomInt(0, 2 ** 31)`.
pub fn fresh_seed() -> u32 {
    let mut b = [0u8; 4];
    getrandom::getrandom(&mut b).expect("OS entropy");
    u32::from_le_bytes(b) & 0x7fff_ffff
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MapPoolStats {
    /// Maps served from the queue.
    pub served: u64,
    /// Rooms served without a queued map because the queue was empty: the configured map at once (a pool with a
    /// worker), or a map certified on the calling thread (`target` 0, tests only).
    pub fallbacks: u64,
    /// Rooms given the configured map because every fallback seed failed. Operators read `fallbacks + configured` for
    /// "rooms that got the configured map".
    pub configured: u64,
    /// Seeds that certified in no attempt or failed (worker and fallback).
    pub discards: u64,
    /// Worker failures: panic, generator error, repeated admission failures, hang.
    pub crashes: u64,
    /// Of those, workers replaced for answering nothing within the hang limit.
    pub hangs: u64,
    /// Worker maps that failed admission (never served).
    pub rejected: u64,
    /// Abandoned worker threads whose generator call has not returned yet (a thread that returns later is uncounted).
    pub abandoned: u64,
    /// The pool has stopped restarting workers (the abandoned cap is reached); recovers when a hung thread returns.
    pub degraded: bool,
}

/// Which map a room was given, for the one log line per match start.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Served {
    /// The seed of a pooled map; `None` for the configured map.
    pub seed: Option<u32>,
    /// The certified map hash (`MapLayers::legacy_map_hash_u32`); `None` when the map carries no layers.
    pub hash: Option<u32>,
    /// The room got the configured map (empty pool, failed fallback, degraded pool).
    pub configured: bool,
}

impl Served {
    fn configured() -> Self {
        Self {
            seed: None,
            hash: None,
            configured: true,
        }
    }
}

fn map_hash(map: &MapAssets) -> Option<u32> {
    map.arena.map.layers().map(|l| l.legacy_map_hash_u32())
}

impl std::fmt::Display for Served {
    /// Pooled: `pooled seed <decimal> hash <8 lowercase hex digits>`; configured: `configured map`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.configured {
            return write!(f, "configured map");
        }
        write!(f, "pooled")?;
        if let Some(seed) = self.seed {
            write!(f, " seed {seed}")?;
        }
        if let Some(hash) = self.hash {
            write!(f, " hash {hash:08x}")?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug)]
pub struct MapPoolOptions {
    pub target: usize,
    pub refill_at: usize,
    pub restart: Duration,
    pub restart_max: Duration,
    pub hang: Duration,
}

impl Default for MapPoolOptions {
    fn default() -> Self {
        Self {
            target: MAP_POOL_TARGET,
            refill_at: MAP_POOL_REFILL_AT,
            restart: MAP_WORKER_RESTART,
            restart_max: MAP_WORKER_RESTART_MAX,
            hang: MAP_WORKER_HANG,
        }
    }
}

enum Reply {
    Map(u32, MadeMap),
    Discard,
    Error(String),
}

struct Worker {
    requests: Sender<u32>,
    replies: Receiver<Reply>,
    /// Requests sent and not answered yet.
    in_flight: usize,
    /// The later of the oldest unanswered request and the last reply: the hang clock.
    owed_since: Option<Instant>,
    /// True while the worker thread runs (cleared when it ends); an abandoned worker counts until then.
    alive: Arc<AtomicBool>,
}

/// Clears the flag when the worker thread ends, by return or by panic.
struct AliveGuard(Arc<AtomicBool>);

impl Drop for AliveGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

struct State {
    queue: VecDeque<(MapAssets, u32)>,
    /// Hung workers dropped by the supervisor; each counts until its thread ends.
    abandoned: Vec<Arc<AtomicBool>>,
    stats: MapPoolStats,
    stopped: bool,
    /// Worker maps in a row that failed admission.
    reject_streak: u32,
    /// Worker failures since the last admitted map: the backoff's exponent.
    crash_streak: u32,
    /// Not before this instant is a new worker started.
    restart_at: Option<Instant>,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
    opts: MapPoolOptions,
    maker: Arc<dyn MapMaker>,
    seed: Box<dyn Fn() -> u32 + Send + Sync>,
    /// The server's configured map: what a room gets if the pool and the fallback both fail.
    configured: MapAssets,
}

impl Shared {
    /// Abandoned workers still running; forgets the ones that have ended.
    fn live_abandoned(st: &mut State) -> usize {
        st.abandoned.retain(|a| a.load(Ordering::SeqCst));
        st.abandoned.len()
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // Poison-tolerant (rh-server AGENTS.md): the state is plain counters and a queue, valid after any panic.
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// A pool of certified maps. Dropping it stops the supervisor; the worker ends once its current map is done.
pub struct MapPool {
    shared: Arc<Shared>,
    supervisor: Option<thread::JoinHandle<()>>,
}

impl MapPool {
    /// Starts a pool over the real generator with the legacy sizes; `signature` generates with the signature landmarks.
    pub fn start(configured: MapAssets, signature: bool) -> Self {
        Self::with(
            configured,
            Arc::new(StyledMaker { signature }),
            Box::new(fresh_seed),
            MapPoolOptions::default(),
        )
    }

    /// A pool over any maker and seed source (tests). `target` 0 runs no worker: every take certifies on the caller.
    pub fn with(
        configured: MapAssets,
        maker: Arc<dyn MapMaker>,
        seed: Box<dyn Fn() -> u32 + Send + Sync>,
        opts: MapPoolOptions,
    ) -> Self {
        let opts = MapPoolOptions {
            refill_at: opts.refill_at.min(opts.target.saturating_sub(1)),
            ..opts
        };
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                queue: VecDeque::with_capacity(opts.target),
                abandoned: Vec::new(),
                stats: MapPoolStats::default(),
                stopped: false,
                reject_streak: 0,
                crash_streak: 0,
                restart_at: None,
            }),
            wake: Condvar::new(),
            opts,
            maker,
            seed,
            configured,
        });
        let supervisor = (opts.target > 0).then(|| {
            let s = shared.clone();
            thread::Builder::new()
                .name("map-pool".into())
                .spawn(move || supervise(&s))
                .expect("spawn the map pool supervisor")
        });
        Self { shared, supervisor }
    }

    /// Maps ready to serve.
    pub fn size(&self) -> usize {
        self.shared.lock().queue.len()
    }

    pub fn stats(&self) -> MapPoolStats {
        let mut st = self.shared.lock();
        let live = Shared::live_abandoned(&mut st);
        MapPoolStats {
            abandoned: live as u64,
            degraded: live >= MAP_ABANDONED_CAP,
            ..st.stats
        }
    }

    /// A map for a new room, without waiting for the worker: the oldest in the queue, else the configured map at once
    /// (counted as a fallback). Never generates on the caller, except in the test-only `target` 0 mode. Never fails.
    pub fn take(&self) -> MapAssets {
        self.take_served().0
    }

    /// `take` plus the identity of what was served (what the director logs).
    pub fn take_served(&self) -> (MapAssets, Served) {
        let queued = {
            let mut st = self.shared.lock();
            let map = st.queue.pop_front();
            if map.is_some() {
                st.stats.served += 1;
            }
            map
        };
        self.shared.wake.notify_all();
        match queued {
            Some((map, seed)) => {
                let served = Served {
                    seed: Some(seed),
                    hash: map_hash(&map),
                    configured: false,
                };
                (map, served)
            }
            None if self.shared.opts.target > 0 => {
                self.shared.lock().stats.fallbacks += 1;
                (self.shared.configured.clone(), Served::configured())
            }
            None => self.fallback(),
        }
    }

    /// Test-only inline mode (`target` 0, no worker): certify on the caller.
    fn fallback(&self) -> (MapAssets, Served) {
        let t0 = Instant::now();
        let mut discards = 0;
        for _ in 0..MAP_FALLBACK_SEEDS {
            let seed = (self.shared.seed)();
            let made = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                self.shared.maker.make_dressed(seed)
            }))
            .unwrap_or_else(|_| Err("the generator panicked".into()));
            match made.and_then(|m| m.map(admit_made).transpose()) {
                Ok(Some(map)) => {
                    let mut st = self.shared.lock();
                    st.stats.fallbacks += 1;
                    st.stats.discards += discards;
                    eprintln!(
                        "[maps] pool empty: certified seed {seed} on the caller in {} ms",
                        t0.elapsed().as_millis()
                    );
                    drop(st);
                    let served = Served {
                        seed: Some(seed),
                        hash: map_hash(&map),
                        configured: false,
                    };
                    return (map, served);
                }
                Ok(None) => discards += 1,
                Err(e) => {
                    discards += 1;
                    eprintln!("[maps] seed {seed} failed in the fallback: {e}");
                }
            }
        }
        let mut st = self.shared.lock();
        st.stats.discards += discards;
        st.stats.configured += 1;
        eprintln!(
            "[maps] {MAP_FALLBACK_SEEDS} fallback seeds failed; this room plays the configured map"
        );
        drop(st);
        (self.shared.configured.clone(), Served::configured())
    }
}

impl Drop for MapPool {
    fn drop(&mut self) {
        self.shared.lock().stopped = true;
        self.shared.wake.notify_all();
        if let Some(h) = self.supervisor.take() {
            let _ = h.join();
        }
    }
}

fn spawn_worker(maker: Arc<dyn MapMaker>) -> std::io::Result<Worker> {
    let (req_tx, req_rx) = mpsc::channel::<u32>();
    let (rep_tx, rep_rx) = mpsc::channel::<Reply>();
    let alive = Arc::new(AtomicBool::new(true));
    let guard = AliveGuard(alive.clone());
    thread::Builder::new()
        .name("map-worker".into())
        .spawn(move || {
            let _guard = guard;
            // Ends when the pool drops its request sender (stop or replacement) or a reply has nowhere to go.
            while let Ok(seed) = req_rx.recv() {
                let reply = match maker.make_dressed(seed) {
                    Ok(Some(made)) => Reply::Map(seed, made),
                    Ok(None) => Reply::Discard,
                    Err(e) => Reply::Error(e),
                };
                if rep_tx.send(reply).is_err() {
                    return;
                }
            }
        })?;
    Ok(Worker {
        requests: req_tx,
        replies: rep_rx,
        in_flight: 0,
        owed_since: None,
        alive,
    })
}

/// Why a worker was dropped.
enum Failure {
    Crash(String),
    Hang,
}

fn supervise(s: &Shared) {
    let mut worker: Option<Worker> = None;
    loop {
        // Start a worker when none runs and the backoff allows; ask it for maps once the queue is low.
        {
            let mut st = s.lock();
            if st.stopped {
                return;
            }
            let now = Instant::now();
            let capped = Shared::live_abandoned(&mut st) >= MAP_ABANDONED_CAP;
            if worker.is_none() && !capped && st.restart_at.is_none_or(|t| now >= t) {
                match spawn_worker(s.maker.clone()) {
                    Ok(w) => {
                        st.restart_at = None;
                        worker = Some(w);
                    }
                    Err(e) => {
                        drop(st);
                        fail(s, &mut worker, Failure::Crash(format!("spawn: {e}")));
                        continue;
                    }
                }
            }
            if let Some(w) = worker.as_mut() {
                if st.queue.len() + w.in_flight <= s.opts.refill_at {
                    while st.queue.len() + w.in_flight < s.opts.target {
                        if w.requests.send((s.seed)()).is_err() {
                            break;
                        }
                        if w.in_flight == 0 {
                            w.owed_since = Some(now);
                        }
                        w.in_flight += 1;
                    }
                }
            }
            if worker.as_ref().is_none_or(|w| w.in_flight == 0) {
                // Nothing owed: sleep until a take, a stop or the restart time.
                let wait = match st.restart_at {
                    Some(t) if !capped => t.saturating_duration_since(now),
                    _ => SUPERVISOR_TICK * 10,
                };
                let _ = s.wake.wait_timeout(st, wait.max(Duration::from_millis(1)));
                continue;
            }
        }
        let Some(w) = worker.as_mut() else { continue };
        match w.replies.recv_timeout(SUPERVISOR_TICK) {
            Ok(reply) => {
                w.in_flight -= 1;
                w.owed_since = (w.in_flight > 0).then(Instant::now);
                arrive(s, &mut worker, reply);
            }
            Err(RecvTimeoutError::Timeout) => {
                if w.owed_since.is_some_and(|t| t.elapsed() >= s.opts.hang) {
                    fail(s, &mut worker, Failure::Hang);
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                fail(
                    s,
                    &mut worker,
                    Failure::Crash("the worker thread ended".into()),
                );
            }
        }
    }
}

fn arrive(s: &Shared, worker: &mut Option<Worker>, reply: Reply) {
    match reply {
        Reply::Map(seed, made) => match admit_made(made) {
            Ok(map) => {
                let mut st = s.lock();
                st.reject_streak = 0;
                st.crash_streak = 0;
                if st.queue.len() < s.opts.target {
                    st.queue.push_back((map, seed));
                }
            }
            Err(e) => {
                let streak = {
                    let mut st = s.lock();
                    st.stats.rejected += 1;
                    st.reject_streak += 1;
                    st.reject_streak
                };
                eprintln!("[maps] a worker map failed admission: {e}");
                if streak >= MAP_REJECT_LIMIT {
                    fail(
                        s,
                        worker,
                        Failure::Crash(format!("{streak} maps in a row failed admission")),
                    );
                }
            }
        },
        Reply::Discard => s.lock().stats.discards += 1,
        Reply::Error(e) => fail(s, worker, Failure::Crash(format!("generator error: {e}"))),
    }
}

/// Drops the worker (a hung thread is abandoned: its replies go nowhere) and schedules its replacement with backoff.
fn fail(s: &Shared, worker: &mut Option<Worker>, why: Failure) {
    let old = worker.take();
    let mut st = s.lock();
    // Both messages are built under the lock and written after it is released: the director may be waiting on the pool.
    st.reject_streak = 0;
    st.stats.crashes += 1;
    // Every failure kind keeps the old thread's flag: after an error or the reject-limit crash it can still run one
    // more `make` from its queued request. A flag whose thread has ended is pruned, so a clean exit costs nothing.
    if let Some(w) = old {
        st.abandoned.push(w.alive);
    }
    let live = Shared::live_abandoned(&mut st);
    let cap_msg = (live >= MAP_ABANDONED_CAP).then(|| {
        format!("[maps] {live} abandoned workers still running: the pool serves the configured map")
    });
    let reason = match why {
        Failure::Hang => {
            st.stats.hangs += 1;
            format!("no reply within {} ms", s.opts.hang.as_millis())
        }
        Failure::Crash(reason) => reason,
    };
    let exp = st.crash_streak.min(16);
    st.crash_streak = st.crash_streak.saturating_add(1);
    let delay = s
        .opts
        .restart
        .saturating_mul(1u32 << exp)
        .min(s.opts.restart_max);
    st.restart_at = Some(Instant::now() + delay);
    let msg = format!(
        "[maps] map worker replaced ({reason}); restart in {} ms",
        delay.as_millis()
    );
    drop(st);
    if let Some(m) = cap_msg {
        eprintln!("{m}");
    }
    eprintln!("{msg}");
}

#[cfg(test)]
mod tests;
