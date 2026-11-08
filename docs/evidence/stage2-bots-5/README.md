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
