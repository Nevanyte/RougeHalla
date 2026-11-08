# Integrated bot learning scope (November 8)

The historical packet report below describes its original branch. The coordinator admits it only with the independently
reviewed repair of that prefix (patch SHA256 `ac191bf15f873ebe6a7023870d95955430839babad51fb6fd9352596b9ae8b88`).

Learning defaults **Off**, including when `--database-url` is supplied. Explicit `--bot-learning single-writer` requests
only the managed-faction learning consumer. One dedicated PostgreSQL session acquires the fixed advisory lock before
load and owns every live read/write transaction. It never falls back to pooled writes or reconnects with a stale cache.
Detected connection loss or query timeout disables that instance. A successor must acquire ownership and reload.
Advisory ownership requires cooperating repaired writers and a session-preserving PostgreSQL connection; an old raw
writer can bypass the lock, so do not enable beside the former automatic writer. Cached bias can remain until I/O detects
loss; this is not instantaneous cross-process failure detection.

Record and Closing serialize under one core lock. A shared observable CloseReport accounts for pending rows and errors;
close has one total six-second budget, then cancels/joins the actor and drops its connection. The actual HTTP shutdown
continuation proceeds afterward. Existing lifecycle termination and bounded durable human-result/spool draining still
precede statistics shutdown. A blocked database session can retain its advisory lock until PostgreSQL observes/finishes
the disconnect; a successor is refused while it does. Statistics never take priority over player results/currency.

Runtime eviction keeps insertion-age ties; source-sorted serialization deliberately restores lexical order after reload.
Each actual managed arrival refreshes faction bias without extra RNG draws. Successful seating precedes retained bot
specs; yielded specs are removed and repeated results are suppressed. Training admission/result guards, policy seed/
cadence, replay, native public-profile gates and measured-RTT intake are preserved during union composition. Planner,
strategy and other learning choices remain disabled. No schema floor, migration, dependency, lockfile, protocol, native
content identity or Sim rule was changed by this repair.

Integration checks on the current union: **166 server +9 persistence +71 policy tests pass** (246 across disjoint affected
batches), including the real-PG writer/contention/loss/blocked-close/lease-handoff tests. Both strict workspace Clippy
feature modes and formatting pass. Independent review also reproduced both immutable-source companion witnesses byte
for byte. Their runtime scope remains recorded: the managed companion is local Node25/macOS, not a claim of canonical
Linux22 capture. Original fixtures are unchanged. The newer7b fill/config/name continuation remains separately held.

---

# P-BOTS-5 — the learning stats store (`BotStatsStore`) in PostgreSQL

Queue A3b. Source `packages/server/src/bots/learning/BotStatsStore.ts` and its model in
`packages/server/src/bots/brain/types.ts` (`LEARN`, `ChoiceKey`, `LearnedBias`, `RunSummary`). Dependency P-PERSIST-2
(the profile store, renewal, achievements and the profile REST are landed). **No packet file exists** in
`docs/backlog/packets/`; the scope below is derived from the backlog row and the legacy code, and the gap is recorded here.

## Scope derived from the legacy store

The legacy `BotStatsStore` is a **JSON file** store, deliberately apart from the profile store (its own file, its own module,
no import of the profile store). Its model, kept exactly:

- `LEARN`: version 1, prior 0.5, strength 8, decay 0.99, cap 0.25, weight 0.3, explore 0.05, maxEntries 2000,
  writeEveryMs 10 000. A neutral score of 0.5.
- A per-tier **baseline** cell `{n, s}` (decayed count and decayed placement-score sum) and per-choice-key **entry** cells
  `{n, s}` (decayed count and decayed residual sum). A key is `domain|a|b` (`faction`, `opener`, `second`, `spawn`,
  `boon`, `skill`, `relic`, `camp`), at most 96 bytes, both parts non-empty; a damaged cell (negative, more sum than
  count, non-finite) is invalid.
- `record(RunSummary)`: void runs and `players < 2` learn nothing; `players = floor(players)`; a draw is first place,
  a placed run is `Math.round(place)` clamped to `1..=players`; `s = (players - place)/(players - 1)`; the tier baseline
  absorbs the run first (`n = decay*n + 1`, `s = decay*s + s`), then the residual
  `r = clamp(0.5 + s - baseline.s/baseline.n, 0, 1)`; each distinct valid choice key decays by 0.99 and adds `r`
  (a new key starts at `n = 1, s = r`); the table evicts the smallest `n` (never a key this run touched) beyond 2000.
- `snapshot()`: a frozen `LearnedBias` where a cell reads `clamp((s + 0.5*8)/(n + 8) - 0.5, -0.25, +0.25)`, 0 for an
  unknown key, `enabled: false` for the `NO_BIAS` singleton a bot reads without a store.
- Write discipline: **no timers**; writes only from `record` (at most one per `writeEveryMs`, and never blocked by a clock
  that went backwards), `flush` (never windowed) and `close`; a failed write keeps the dirty rows for the next attempt and
  never throws; loading trims a full table and drops a damaged entry on its own (a damaged file is set aside and the store
  starts empty).
- Read path in the source: the manager's `pickFaction` softmaxes `faction|<persona>|<faction>` biases at temperature 0.3
  behind an exploration floor of 0.05, and `strategy.ts` adds `LEARN.weight * bias` to its goal/tactic utilities. The
  manager records a resolved bot run with the outcome summary plus the managed faction key.

## Native slice delivered

- **Model (pure, no I/O):** `rh-policy::bots::learning` — the constants above, `Tier`/`RunOutcome`, `Cell` with the source
  validity and bias smoothing, `valid_key`, `Stats` (baseline + entries) with the exact `apply`/residual/decay/eviction
  algorithm (and a logged variant returning the touched/evicted rows for the durable batch), `LearnedBias`/`NO_BIAS`, and
  JS `Math.round` semantics. Reference tests pin every formula against the legacy code (first run neutral, second-run
  decay, draw/void/too-small guards, damaged cells, key rules, eviction and the cap).
- **Durable rows:** migration `crates/rh-persist/migrations/0002_bot_stats.sql` (additive, `schema_compat.min_binary`
  stays 1): `bot_learning_baseline(tier, n, s)` and `bot_learning_entries(key, n, s, updated_at)` with the source's
  domain/key and cell CHECKs; `rh-persist::bot_stats_db` loads all rows and saves one batch (baseline upserts, cell
  upserts, evicted deletes) **in one transaction**.
- **Store:** `rh-server::bot_learning::BotStatsStore<B: Backend>` — the source's load/apply/snapshot plus the exact write
  discipline (first record writes, window, backwards clock, `flush`/`close`, dirty rows retained on a failed batch,
  eviction deletions flushed with the next write, damaged rows dropped, one store per process). `PgBackend` is the
  PostgreSQL implementation behind the server's `postgres` feature. No I/O in `rh-sim`; writes happen only from
  `record`/`flush`/`close`, never inside a tick.
- **Read path:** `BotFillConfig.learned: LearnedBias` (default `NO_BIAS`, so the captured P-BOTS-7 manager stream is
  bit-identical with learning off); `pick_faction` now feeds the learned `faction|<persona>|<faction>` utilities into the
  existing softmax. The live server loads a store snapshot at startup from `--database-url` (`main.rs`) and passes it into
  the director's fill config; without a database it is `NO_BIAS`.

## Tests

- Pure model: `cargo test -p rh-policy --lib learning` — 7 passed (reference formulas).
- Store discipline against an in-memory backend: `cargo test -p rh-server --lib bot_learning` — 11 passed (empty store,
  first-record write, window vs `flush`, failed-batch retention and recovery, full-table eviction and newcomer, damaged
  rows, closed store, backwards clock, read-path snapshot, and the snapshot → `BotFillConfig` bridge).
- Fill read path: `cargo test -p rh-server --lib bot_fill` — 5 passed (the captured source scenarios with `NO_BIAS` plus
  the learned-bias distribution test).
- PostgreSQL boundary, pinned throwaway cluster (`eval "$(tools/pgtest/start.sh)"`):
  `cargo test -p rh-persist --test bot_stats_db --test schema` — 4 + 3 passed (schema version 2 additive; empty load; one
  batch upsert/delete/update; a broken-table batch rolls back every row; the schema guards refuse damaged cells, keys and
  tiers, NaN and Infinity).
- Workspace gate: **1,503 passed, 0 failed, 3 ignored, 155 test binaries, exit 0** (with the pinned PostgreSQL cluster;
  the previous 1,481 plus the 22 P-BOTS-5 tests: 7 model, 11 store discipline, 4 row boundary) — the new
  `tests/bot_stats_db.rs` target is the 155th binary.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` and `cargo fmt --all -- --check`: clean.

## Remaining (exact)

1. **The record caller (run-summary producer):** the source's manager records a bot's resolved run (`onResult`) with the
   brain's choice memory. The Rust server does not host the bots' brains yet (P-BOTS-1/3/4 remainder: memory/strategy),
   so the store's `record` has no live producer here; the store API and its write discipline are complete and tested.
2. **Live store ownership/refresh:** the server loads the snapshot once at startup for the fill read path; a live
   director-owned store (re-snapshot per lobby, `flush`/`close` on shutdown) belongs with the record caller above.
3. **The policy-side bias consumer:** `strategy.ts`'s `LEARN.weight * bias` on the strategy/tactics utilities has no Rust
   consumer yet (the strategy layer itself is P-BOTS-1 remainder); the fill read path (the other source consumer) is
   wired.
4. **Multi-writer semantics:** the source assumed one store per process/file. The Postgres table replaces the whole row per
   upsert (source file rewrite), so two simultaneous learning writers replace each other's rows; the documented contract
   is one live store process per database (the file-store contract), not a conflict-free merge.
5. **Write-error logging:** the source logged a failed file write; the store keeps `last_write_error()` for the caller, and
   the caller-side logging/telemetry comes with the producer wiring.

## Remainder round: the live store and the record caller

On the same branch/PR (P-BOTS-5 remainder), the store now runs live in the server and the source manager's `onResult` has its
Rust caller:

- **Room facts**: the room keeps the fill policy's `BotSeatSpec` per seated bot and its `RoomReport::Result` carries the spec
  for a managed bot (`bot_spec: Option<BotSeatSpec>`); a bot still never touches profile persistence.
- **The record caller**: the director's report loop now builds the source summary from the facts the room actually has —
  tier/persona/faction from the spec, outcome/place/players from the resolved `RunResult` — and the manager's own managed
  choice key `faction|<persona>|<faction>`. Those are exactly the keys the fill read path consumes.
- **The live store**: `rh-server::bot_learning::LiveLearning<Backend>` is the director-owned store: `record` updates the
  in-memory model and the shared `LearnedBias` snapshot synchronously (so the very next lobby sees a just-resolved run),
  one background writer task performs the off-tick batch writes and logs a failed one (keeping every dirty row), and
  `flush`/`close` drain on shutdown. The director reads a fresh snapshot in `fill_policy`, so every new lobby sees every run
  recorded before it opened. `main.rs` opens the live store from `--database-url` (one store per database/process),
  installs it, and closes it in the shutdown task after the durable result writes.
- **Dependency on the brain memory (exact)**: the source summary also carries the brain's `choices` from
  `memory.recordChoice` (opener/second/spawn/boon/skill/relic/camp — the strategy/tactics layer). The ported server does not
  retain that memory (P-BOTS-1 remainder), so only the manager's managed faction key is recorded; the store/bias path is
  key-agnostic and the remaining keys join when the memory layer lands. The `strategy.ts` `LEARN.weight × bias` consumer
  stays with that layer too.
- **Multi-writer contract (unchanged)**: the legacy file-store contract is one live store per database/process; the tables
  replace rows per upsert rather than merging two writers.

### Remainder-round tests

- `cargo test -p rh-server --lib --all-features bot_`: 21 passed — the P-BOTS-5 store discipline (10) plus the live-store
  tests: immediate snapshot refresh, window vs flush, failed-write retention and retry, close refusal, and the
  snapshot → `BotFillConfig` bridge.
- `cargo test -p rh-server --lib --all-features a_bot_result_report`: 1 passed — a resolved fill bot's report carries its
  spec.
- Director record-caller test (inside `--lib bot_`? no: `bot_results_reach_the_record_caller_and_a_new_lobby_reads_the_refreshed_bias`):
  1 passed — a bot result reaches the installed sink as the exact summary facts, and `fill_policy` reads the refreshed bias
  per lobby.
- PostgreSQL, pinned throwaway cluster (feature `postgres`): `cargo test -p rh-server --features postgres --test
  learning_live`: 1 passed — the live store's record → immediate snapshot → flushed rows → reload, and the second live
  store observing the persisted model (close is idempotent).
- Workspace gate: **1,509 passed, 0 failed, 3 ignored, 156 test binaries, exit 0** (with the pinned PostgreSQL cluster;
  the previous 1,503 plus the six remainder-round tests: 3 live-store, 1 room spec report, 1 director record caller and the
  pinned-PostgreSQL `learning_live` live-store test, which is the 156th binary).
