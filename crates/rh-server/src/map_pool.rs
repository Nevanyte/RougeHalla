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
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

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

struct State {
    queue: VecDeque<MapAssets>,
    stats: MapPoolStats,
}

#[allow(dead_code)] // stub: P-MAP-3
struct Shared {
    state: Mutex<State>,
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

    /// stub: P-MAP-3 (no worker, no fallback yet).
    pub fn with(
        configured: MapAssets,
        maker: Arc<dyn MapMaker>,
        seed: Box<dyn Fn() -> u32 + Send + Sync>,
        opts: MapPoolOptions,
    ) -> Self {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                queue: VecDeque::new(),
                stats: MapPoolStats::default(),
            }),
            opts,
            maker,
            seed,
            configured,
        });
        Self { shared }
    }

    pub fn size(&self) -> usize {
        self.shared.lock().queue.len()
    }

    pub fn stats(&self) -> MapPoolStats {
        self.shared.lock().stats
    }

    /// stub: always the configured map.
    pub fn take(&self) -> MapAssets {
        self.shared.configured.clone()
    }
}

#[cfg(test)]
mod tests;
