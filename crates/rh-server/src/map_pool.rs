//! The map pool (P-MAP-3; legacy `packages/server/src/mapPool.ts` and `mapWorker.ts`): certified maps made ahead of time on
//! a worker thread, so opening a room never waits for the generator. Process infrastructure, outside `rh-sim`: the sim
//! only ever receives a finished [`Arena`], and the seeds come from the server's entropy, never from a match's secrets.
//!
//! One worker thread holds its own layout tables and certifies fresh random seeds, one request per map, only while the
//! queue is short: an idle server generates nothing. Every map is admitted again on arrival ([`admit`]: it fits the wire,
//! seats every player and encodes as a Welcome), and what the pool serves is that admitted [`MapAssets`].
//!
//! An empty queue (a burst, a worker that is down or still warming) falls back to one certification on the calling
//! thread, logged. If `MAP_FALLBACK_SEEDS` fresh seeds all fail there, the room gets the server's configured map instead
//! of an error (legacy throws; a room that cannot open is worse than a repeated map). A worker that panics, reports a
//! generator error, keeps sending maps that fail admission, or answers nothing for `MAP_WORKER_HANG` while it owes a reply
//! is replaced, with a restart delay that doubles per failure in a row (1 s up to 60 s). A hung thread cannot be killed:
//! it is abandoned (its replies go nowhere) and keeps its core until the generator returns.
//!
//! Legacy's training-room reuse (`takeForTraining`) has no counterpart: a Rust training server plays the practice arena
//! (`runtime.rs`) and never runs a pool.
use crate::room::MapAssets;
use rh_sim::Arena;
use std::collections::VecDeque;
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
/// How often the supervisor looks at the worker while a reply is owed.
const SUPERVISOR_TICK: Duration = Duration::from_millis(100);

/// What makes a map from a seed: the real generator ([`StyledMaker`]) or a test double.
pub trait MapMaker: Send + Sync + 'static {
    /// The certified map for `seed`; `Ok(None)` when no attempt certifies (a discarded seed); `Err` when the generator
    /// itself failed (a bug, not a refused attempt).
    fn make(&self, seed: u32) -> Result<Option<Arena>, String>;
}

/// The generator as the server runs it: legacy `certifiedMap(seed, { decor: false })`, the complete styled pipeline. The
/// server builds no decor (props are cosmetic and the client draws its own).
pub struct StyledMaker;

impl MapMaker for StyledMaker {
    fn make(&self, seed: u32) -> Result<Option<Arena>, String> {
        use rh_sim::mapgen::{coliseum, map_hash, pipeline};
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        let options = pipeline::Options {
            decor: false,
            ..pipeline::Options::default()
        };
        let Some(map) = generator
            .certified_styled(i64::from(seed), options)
            .map_err(|e| format!("{e:?}"))?
        else {
            return Ok(None);
        };
        let legacy_map_hash_u32 =
            u32::from_str_radix(&map_hash::map_hash(&map), 16).map_err(|e| e.to_string())?;
        let arena = rh_sim::mapdata::MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32,
            map,
        }
        .validate()
        .map_err(|e| e.to_string())?
        .into_arena()
        .map_err(|e| e.to_string())?;
        Ok(Some(arena))
    }
}

/// The arrival check: a map is served only if it fits the wire position range, has a spawn for every seat and encodes as
/// a Welcome. Run on every worker map before it is queued and on every fallback map.
pub fn admit(arena: Arena) -> Result<MapAssets, String> {
    crate::wire::arena_fits(&arena)?;
    if arena.spawns.len() < rh_sim::constants::MAX_PLAYERS {
        return Err(format!(
            "{} spawns for {} seats",
            arena.spawns.len(),
            rh_sim::constants::MAX_PLAYERS
        ));
    }
    MapAssets::new(arena).map_err(|e| format!("{e:?}"))
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
    /// Maps certified on the calling thread because the queue was empty.
    pub fallbacks: u64,
    /// Rooms given the configured map because every fallback seed failed.
    pub configured: u64,
    /// Seeds that certified in no attempt or failed (worker and fallback).
    pub discards: u64,
    /// Worker failures: panic, generator error, repeated admission failures, hang.
    pub crashes: u64,
    /// Of those, workers replaced for answering nothing within the hang limit.
    pub hangs: u64,
    /// Worker maps that failed admission (never served).
    pub rejected: u64,
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
    Map(Arena),
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
}

struct State {
    queue: VecDeque<MapAssets>,
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
    /// Starts a pool over the real generator with the legacy sizes.
    pub fn start(configured: MapAssets) -> Self {
        Self::with(
            configured,
            Arc::new(StyledMaker),
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
        self.shared.lock().stats
    }

    /// A map for a new room, without waiting for the worker: the oldest in the queue, else one certified here and now
    /// (logged), else the configured map. Never fails.
    pub fn take(&self) -> MapAssets {
        let queued = {
            let mut st = self.shared.lock();
            let map = st.queue.pop_front();
            if map.is_some() {
                st.stats.served += 1;
            }
            map
        };
        self.shared.wake.notify_all();
        queued.unwrap_or_else(|| self.fallback())
    }

    fn fallback(&self) -> MapAssets {
        let t0 = Instant::now();
        let mut discards = 0;
        for _ in 0..MAP_FALLBACK_SEEDS {
            let seed = (self.shared.seed)();
            let made = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                self.shared.maker.make(seed)
            }))
            .unwrap_or_else(|_| Err("the generator panicked".into()));
            match made.and_then(|m| m.map(admit).transpose()) {
                Ok(Some(map)) => {
                    let mut st = self.shared.lock();
                    st.stats.fallbacks += 1;
                    st.stats.discards += discards;
                    eprintln!(
                        "[maps] pool empty: certified seed {seed} on the caller in {} ms",
                        t0.elapsed().as_millis()
                    );
                    return map;
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
        self.shared.configured.clone()
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
    thread::Builder::new()
        .name("map-worker".into())
        .spawn(move || {
            // Ends when the pool drops its request sender (stop or replacement) or a reply has nowhere to go.
            while let Ok(seed) = req_rx.recv() {
                let reply = match maker.make(seed) {
                    Ok(Some(arena)) => Reply::Map(arena),
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
            if worker.is_none() && st.restart_at.is_none_or(|t| now >= t) {
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
                let wait = st
                    .restart_at
                    .map_or(SUPERVISOR_TICK * 10, |t| t.saturating_duration_since(now));
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
        Reply::Map(arena) => match admit(arena) {
            Ok(map) => {
                let mut st = s.lock();
                st.reject_streak = 0;
                st.crash_streak = 0;
                if st.queue.len() < s.opts.target {
                    st.queue.push_back(map);
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
    *worker = None;
    let mut st = s.lock();
    st.reject_streak = 0;
    st.stats.crashes += 1;
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
    eprintln!(
        "[maps] map worker replaced ({reason}); restart in {} ms",
        delay.as_millis()
    );
}

#[cfg(test)]
mod tests;
