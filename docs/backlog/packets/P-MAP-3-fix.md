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
- listed by the oracle author on `packet/P-MAP-3-fix`

## 9. Validation commands
- `cargo test -p rh-server map_pool`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Sonnet. Concurrency in one file; the tests must not sleep for real seconds (inject the durations through
`MapPoolOptions`).

## 11. Known traps
- A thread that hangs inside the generator cannot be killed: the cap counts it until it returns.
- Do not hold the pool's own mutex while logging or while waking the worker.

## Notes from previous attempts
