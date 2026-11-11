# P-MAP-3: off-tick certified-map pool for source-arena rooms

- **Serves:** backlog row P-MAP-3 (Coarse) and owner beta-follow-up decision 5 (MIGRATION, 2026-11-10: "matches draw
  from a rotating pool of certified maps"). Not in ORDER_OF_OPERATIONS; covered by the plan's approvals.
- **Implementer tier:** cloud session (single agent, oracle commit first)
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Every room today plays the one `--map` file the server was started with (the beta: the hand-authored 48×40
`maps/first-playable.json`). Legacy rooms each take a fresh certified map from a pool a worker thread keeps full. When
this lands, a source-arena server started with `--map-pool` gives every new room its own certified generated map, made
ahead of time on a worker thread; the configured `--map` is the last resort. Without the flag nothing changes.

## 2. Dependencies
P-MAP-1 (complete styled generator and certification, integrated).

## 3. Relevant legacy paths
- `packages/server/src/mapPool.ts` (sizes, fallback, crash/hang/reject handling, training reuse)
- `packages/server/src/mapWorker.ts`
- `packages/shared/src/mapgen` `certifiedMap(seed, { decor: false })`

## 4. New paths
- `crates/rh-server/src/map_pool.rs`, `crates/rh-server/src/map_pool/tests.rs`

## 5. Exclusive write scope
- the new files; `crates/rh-server/src/lib.rs` (module line)
- `crates/rh-server/src/room.rs` (`MapAssets` derives `Clone`)
- `crates/rh-server/src/director.rs` (`DirectorConfig.map_pool`, `spawn_room` takes the room's map from it)
- `crates/rh-server/src/runtime.rs` (`--map-pool` flag, source-arena only) and `crates/rh-server/src/main.rs` (start the pool)

## 6. Contracts and references
- C-RNG: map seeds are public (legacy sends them); they come from OS entropy in the server, never from match secrets, and
  `rh-sim` stays pure.
- Each room still asserts its Welcome blob matches its arena (`room.rs`); no wire change, the map blob already travels in
  the Welcome.
- rh-server AGENTS.md: shared state is poison-tolerant; background work fails visibly (logged, counted).

## 7. Behaviour to preserve
- Without `--map-pool`, every path is unchanged (same arena, same Welcome, same tests).
- Training servers never run a pool.

## 8. Acceptance checks
- Oracle: unit tests in `map_pool/tests.rs` (refill, caller fallback, configured-map last resort, panicking seed,
  generator error, panicking worker, hang, admission rejects, capped backoff) and one loose proof: the real generator
  certifies two seeds, both pass admission, they differ, and the source-arena profile steps a match on one.
- `runtime.rs` tests: `--map-pool` accepted only with `--runtime source-arena`.
- `scripts/gate.sh --quick` passes; the full gate passes.

## 9. Validation commands
- `cargo test -p rh-server map_pool`, `cargo test -p rh-server runtime`

## 10. Risk and suggested model tier
Medium: threads and timing. The generator is pure and already covered by P-MAP-1's corpus.

## 11. Known traps
- Generated maps are full 160×160 maps with about 50 camps; the beta map is 48×40 with 3. Server load per room, the
  first-playable map budget notes (`maps/README.md`) and Unity frame time on a full map are not established by this
  packet. Keep the flag off in hosting until they are measured.
- A hung generator thread cannot be killed in Rust: it is abandoned and keeps its core until it returns.

## Notes from previous attempts
None.
