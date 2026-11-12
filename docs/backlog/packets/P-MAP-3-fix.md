# P-MAP-3-fix: the map pool never generates under the director lock, bounds its abandoned workers and logs what it served

- **Serves:** backlog row P-MAP-3; reviewer-opus notes on P-MAP-3 (2026-11-11, LAND WITH NOTES: one REAL, two MINOR)
- **Implementer tier:** implementer-sonnet (one crate, `rh-server`; the oracle is a unit test on the pool)
- **Reviewer:** reviewer-opus (code on the director's match-start path)
- **Integration base:** feature/unity-rework
- **D-rules touched:** none (no sim, wire, content-hash or parity change)

## 1. ID and outcome
`MapPool::take` is called by the director while it holds its lock. When the pool is empty, `fallback`
(`crates/rh-server/src/map_pool.rs:277`) generates and certifies maps inline: tens of milliseconds per seed, up to
`MAP_FALLBACK_SEEDS` seeds, with every room start and join waiting behind it. A hung generator is abandoned after
`MAP_WORKER_HANG` and a new worker thread started, with no bound on how many abandoned threads can pile up. The log
never says which map a match got. When this lands an empty pool serves the configured map at once (counted as a
fallback) and never generates on the caller's thread; abandoned workers are capped, after which the pool stops
restarting and serves the configured map; and every `take` logs the map's identity.

## 2. Dependencies
none (P-MAP-3 is merged)

## 3. Relevant legacy paths
- none (server infrastructure; legacy generated one map per room at creation)

## 4. New paths
- none

## 5. Exclusive write scope
- `crates/rh-server/src/map_pool.rs`, `crates/rh-server/src/map_pool/tests.rs`
- `crates/rh-server/src/director.rs`: only the `take` call site and its log line

## 6. Contracts and references
- `docs/backlog/packets/P-MAP-3.md` (the pool's rules: target, refill mark, reject limit, restart backoff).
- The director lock is held across `take`: nothing reachable from `take` may block on generation, certification, a
  channel receive without a ready value, or a thread join.

## 7. Behaviour to preserve
- Every existing pool test; pool target, refill mark, backoff and reject limit; `--map` without `--map-pool` unchanged;
  a resumed room keeps its map.
- `MapPoolStats` fields keep their meaning; new counters are additions.

## 8. Acceptance checks
- Oracle (unit, with a `MapMaker` double that blocks until released): with an empty pool, `take` returns the configured
  map without calling `make` on the calling thread and within a short bound while the maker is blocked; `fallbacks`
  counts it.
- Oracle: with a maker that hangs every time, the number of live abandoned worker threads never exceeds the cap (a
  named constant), the pool keeps serving the configured map, and a stat reports the pool as degraded.
- The served map's identity (seed and map hash, or "configured") appears in one log line per match start; a unit test
  on the value the director logs is enough.
- `scripts/gate.sh --oracle packet/P-MAP-3-fix` passes.

## Oracle files (read-only for implementers)
- `crates/rh-server/src/map_pool/tests.rs`: the four new cases at the end of the file (marked "P-MAP-3-fix"); the
  existing cases are untouched.

## Confirmed findings (legacy-free; code cited at the P-MAP-3 merge)
1. `take` (`map_pool.rs:264`) pops the queue and, when empty, calls `fallback` (`:277`), which runs `maker.make` in a loop
   of up to `MAP_FALLBACK_SEEDS` on the calling thread. `director.rs:893-894` calls it with the director lock held.
2. `supervise` (`:356`) calls `fail(.., Failure::Hang)` after `opts.hang`; `fail` sets `*worker = None` (the thread is
   abandoned) and the loop spawns a new one via `spawn_worker` (`:324`) once the backoff (max 60 s) passes. Nothing counts
   or bounds abandoned threads. Observed: 12 hangs in about 1.5 s with a 50 ms hang limit.
3. Nothing logs the served map: `fallback` logs only fallback successes; queued maps and the configured map are silent,
   and `director.rs:894` discards the identity.
No finding is wrong.

## Stub signatures (commit `stub:`; the implementer replaces the bodies)
- `pub const MAP_ABANDONED_CAP: usize = 2;` (value final; not yet enforced)
- `MapPoolStats` gains `abandoned: u64` (abandoned threads whose generator call has not returned) and `degraded: bool`.
- `pub struct Served { seed: Option<u32>, hash: Option<u32>, configured: bool }` (Default, Eq) with `Display`: pooled is
  `pooled seed <decimal> hash <8 lowercase hex>`, configured contains `configured`. Hash is
  `arena.map.layers().map(|l| l.legacy_map_hash_u32())`. The queue must carry the seed with each map.
- `MapPool::take_served(&self) -> (MapAssets, Served)`; `take` stays. The director calls `take_served` and logs
  `Served` once per match start (`director.rs:893`).

## What the oracle pins, and what it leaves open
- Test 1 uses `target` 2 (a worker exists, blocked in the generator): `take` returns the configured map in under 30 ms,
  the generator never runs on the caller thread, `fallbacks == 1`. A pool with `target` 0 has no worker and the existing
  cases (`an_empty_queue_certifies_on_the_caller`, `every_fallback_seed_failing_...`, `a_panicking_fallback_seed_...`)
  require it to keep certifying on the caller. Keep that test-only mode; production (`MapPool::start`) never uses it.
  If the implementer wants to remove it, those cases change and the owner must approve.
- Test 2: after the cap the pool reports `degraded`, `abandoned == MAP_ABANDONED_CAP`, never more than cap + 1
  generator calls alive, no further worker starts, `take` returns the configured map at once.
- Tests 3 and 4: `take_served` identity for a pooled map (seed from the seed source, hash from the layers) and for the
  configured one. The pooled case runs the real generator once (seed 1), a second or so in a debug build.
- Not pinned: the exact log wording beyond the `Display` contract, and recovery of `abandoned` after a release.

## 9. Validation commands
- `cargo test -p rh-server map_pool`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Sonnet. Concurrency in one file; the tests must not sleep for real seconds (inject the durations through
`MapPoolOptions`).

## 11. Known traps
- A thread that hangs inside the generator cannot be killed: the cap counts it until it returns.
- Do not hold the pool's own mutex while logging or while waking the worker.

## Notes from previous attempts
