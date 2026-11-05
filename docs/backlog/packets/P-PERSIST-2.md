# P-PERSIST-2: production persistence wiring in `rh-server`

## Stage 2 checkpoint

Transactional achievements/catalog and live lease renewal are implemented and independently reviewed. Live ownership
uses the authenticated durable ID through rename, admission waits, cancellation, result retries and release. Defaults
are TTL 120 s / renewal 30 s / database budget 5 s, with a one-hour TTL cap. See
[ADR 0006](../../adr/0006-persistence.md) and [evidence](../../evidence/stage2-leases/README.md). No production database,
AWS deployment or schema change is implied. Ending faction/weapon metadata, unwritten-result recovery and profile
REST routes remain open. The original pre-implementation descriptions below are retained as source/acceptance scope.

## ID and outcome
P-PERSIST-2. `rh-server` runs in production on PostgreSQL through `rh-persist`: callsign/token auth against the database,
fenced session leases that are **renewed** while a match runs, the achievements system ported and evaluated inside
`record_result`, faction and weapon carried in `RunResult` so the per-win counters work, and the profile REST API
(claim, open, purchase, equip, leaderboard, health) ported with the legacy guards. After it, the legacy `ProfileStore` has no
remaining feature that the Rust stack lacks (P-MIG-1 can then rehearse the import).

## Dependencies
None to start. Note: while this backlog was written, a parallel worker was adding `--database-url`/`--instance-id` (feature `postgres`) to `crates/rh-server/src/main.rs` and a `tests/pg_e2e.rs`; re-read the tree (`git log`, `git status`) before starting and build on what landed rather than redoing it. Faction/weapon in results touches `rh-sim::RunResult` (a small additive change; weapon-in-hand at the end is
`Player::active_weapon`, items arrive with P-COMBAT-1: until then it is always `fists`/none and the counters are tested with
injected values). Cosmetics `look` on the wire is P-PERSIST-3.

## Relevant legacy paths (verified)
- Legacy store: `packages/server/src/persistence/ProfileStore.ts` (929 lines: `claim`, `recordRun` l.668, `bankGv` l.693, `purchase`, `equip`, leaderboard cache, `evaluateAchievements` call l.827, v1 migration), `FileSnapshotMirror.ts`, `RemoteSnapshot.ts` (R2 mirror, retired by P-MIG-3).
- HTTP: `packages/server/src/index.ts` l.366-516 (`/readyz`, `/api/health`, `GET /api/profile/:name` claim/open with token header and passcode gate, `POST /api/profile/:name/purchase` and `/equip` with token and a shop bucket, `GET /api/leaderboard?month&limit&name`), guards in `packages/server/src/guards/` and `config.ts` defaults (new profiles: 30 an hour in all, 10 per address; shop burst 6 / 3 per second; only when hosting).
- Shared rules: `packages/shared/src/achievements.ts` (130 lines: `ACHIEVEMENTS`, `AchievementGoal`, `evaluateAchievements(snapshot, unlocked)`), `cosmetics.ts` (catalog, slots, prices, `isForSale`), `messages.ts` (`ProfileDTO`, `ProfileResponse`, `PROFILE_RE`, `JoinOptions`).
- Rust: `crates/rh-persist/` (`Store`: `create_profile`, `verify_token`, `get_profile`, `leaderboard`, `acquire_lease`, `renew_lease` l.301, `release_lease`, `record_result`, `purchase`, `equip`; `model.rs`: `MatchResult { outcome, kills, gv, faction, weapon, win_qualified }`, `Progress`, `Stats`; `migrations/0001_init.sql`; README guarantees), `crates/rh-server/src/{persist.rs,director.rs,main.rs}` (`Auth::Postgres`, `Persistence::Postgres`; `--database-url`, `--instance-id` under `--features postgres`; `to_persist` sets `faction: None, weapon: None`; lease TTL is a fixed 3600 s and **nothing calls `renew_lease`**).

## New paths
`crates/rh-server/src/api.rs` (profile HTTP routes; or a new crate `rh-api` if the coordinator prefers a separate service: decide in the first PR, record in ADR 0006), `crates/rh-persist/src/achievements.rs` + a migration `0002_*.sql` only if the schema needs it, `crates/rh-server/tests/persist_pg.rs`, achievements data tables as Rust consts generated from `achievements.ts`/`cosmetics.ts` with a parity test.

## Exclusive write scope
`crates/rh-persist/**`, `crates/rh-server/src/{persist.rs,director.rs,main.rs,api.rs,lib.rs}`, `crates/rh-server/tests/persist_pg.rs`, `crates/rh-sim/src/results.rs` (only `RunResult` fields: coordinate, shared file), `docs/adr/0006-persistence.md` (evidence lines), `crates/rh-persist/README.md`. `tools/pgtest/*` for test infrastructure.

## Contracts and references
C-PERSIST (idempotent results, fenced leases, ledger reconciliation: FROZEN), C-NET (admission order: profile ownership by process then fenced lease, before capacity), ADR 0006, `crates/rh-persist/README.md`. Durable I/O never runs on a room task.

## Behaviour to preserve
- Claim/open: `GET /api/profile/:name` with `PROFILE_RE` (`^[A-Za-z0-9_-]{2,16}$`, already `valid_callsign`) claims a free name and returns a random token (legacy `randomUUID`) once; opening an existing profile needs its token (header `PROFILE_TOKEN_HEADER`), else 403. Only claiming a new name is guarded: passcode (optional, throttled per address and globally) and new-profile caps. Rust stores `token_sha256` only: the response returns the token exactly once.
- Results: `recordRun` increments `runs` and, by outcome, wins/draws/deaths; MIA counts as a run and a death; `kills`, `bestRunKills`, `bountyRuns` (runs that paid bounty GV), and **only qualified wins** (`winQualified = !winBonusWithheld`) feed `qualifiedWins`, `winsByFaction`, `winsByWeapon` (gold lists `GOLD_FACTIONS`, `GOLD_WEAPONS`). Bots never touch persistence (already in `rh-sim`). GV: lifetime and monthly (`gv_by_month`, UTC month key) with an append-only ledger row in the same transaction; a run voided by shutdown pays earned GV and records no run (`outcome: None`). `purchase` lowers `gv` only.
- Achievements are evaluated inside the same result transaction: an id is stored once with its timestamp; its reward cosmetics are granted in the same step; goals read `stats`, `progress` and lifetime GV. `RecordOutcome::Applied { unlocked }` is "always empty until achievements are ported": fill it. Kill and bounty achievements are not win-gated (owner decision recorded in docs/legacy/CLAUDE_LEGACY.md).
- Leaderboard ranks GV earned in the month (not balance); `you` is returned only with the profile's own token; cached per month, dropped when GV is credited.
- Leases (Stage 1 already: acquire at admission, the fence carried by the seat and reported with each result, release on a
  lobby leave, a refused join and a closed room; an MIA leaver stays reserved until its result is written): acquire at admission (before a seat), release at match end/leave; takeover after expiry increments the fence; a late write from the old owner is `StaleFence`. Keep the TTL short (suggest minutes) and **renew** from a timer owned by the director while a seat is live, off the room task; define behaviour when renewal fails (stop crediting, end the seat, never panic).
- Legacy rate limits and their defaults are listed above; they are edge concerns (P-PERSIST-5), but the routes must accept a limiter layer.
- Doc/code note: docs/legacy/CLAUDE_LEGACY.md describes the profile store as a single JSON file plus R2 snapshot; production is Cloudflare + R2 (INVENTORY section 7). Rust replaces both.

## Acceptance checks
1. Run with a real PostgreSQL 16 (`tools/pgtest/start.sh`); all existing 20 `rh-persist` tests pass.
2. Achievements parity: a Rust test table of >= 30 snapshots (generated by a one-off legacy script that calls `evaluateAchievements`, committed as JSON) gives identical unlocked ids; reward cosmetics granted; idempotent on replay of a result.
3. `to_persist` fills `faction`/`weapon`; test that a qualified win increments exactly `winsByFaction[faction]` and `winsByWeapon[weapon]`; a withheld win does not.
4. Lease renewal: a long match keeps its lease past one TTL; a stopped renewer lets another host take over and the old host's late result is `StaleFence`.
5. REST: contract tests for claim (new, existing with right/wrong token, invalid name), purchase (insufficient GV, idempotent id, double-spend race), equip, leaderboard (month validation, `limit` clamp, `you`), all using the Rust API against Postgres.
6. `rh-server --features postgres --database-url ... --auth` path: admission rejects a wrong token with the documented reason and never takes a seat.
7. No DB call on the tick path: a test with a stalled database does not delay `step` (the existing off-tick sink pattern).

## Validation commands
`eval "$(tools/pgtest/start.sh)"` then `cargo test -p rh-persist`, `cargo test -p rh-server --features postgres`, `cargo test --workspace`,
`cargo clippy --workspace --all-targets --features postgres`; `tools/pgtest/stop.sh`. Admin: `cargo run -p rh-persist --bin rh-persist-admin -- reconcile --url "$DATABASE_URL"` (exit 1 on mismatch).

## Risk and suggested model tier
Medium-high: money-like invariants (GV, double credit) but a strong test base exists. Strong builder, high effort for lease
renewal and the achievements port; medium for the REST routes.

## Known traps
- Tokens are hashed; rollback to the legacy server needs the ORIGINAL profile file (P-MIG-1). Never log tokens.
- Callsigns are case-insensitive unique (`lower(callsign)`), but display keeps the claimed case.
- Do not hold a Postgres transaction across an await on a room channel; lease and result paths already use short transactions.
- Month keys are UTC; use the same `monthKey` semantics as `shared` (read `ProfileStore`/`rules` for it).
- Connection pool exhaustion and Aurora failover are untested (ADR 0006); size the pool and set timeouts, then hand P-PERSIST-4 the open points.
- Legacy results carry the weapon *in hand at the end*; a dead player's slots are cleared by `dropBody`: capture the weapon before the drop.
