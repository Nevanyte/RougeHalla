# ADR 0006: PostgreSQL with fenced session leases and idempotent results

**Status:** Accepted. **Context:** legacy profiles live in one JSON file behind a single-writer process (mirrored to R2 as a
whole-file snapshot, last writer wins). Many hosts writing results would lose updates and double-credit retries.

**Decision.** `rh-persist` on PostgreSQL (RDS/Aurora in production; any Postgres 16 locally):
- `match_results (match_id, profile_id)` primary key: a result is applied at most once; a retry returns `AlreadyApplied`.
- Session ownership: `session_leases` with a monotonic **fence** per profile. A takeover after expiry increments it; a
  late write from the previous owner is refused (`StaleFence`). The server acquires the lease at admission (off the tick)
  and presents the fence with the result.
- GV changes only with an append-only `gv_ledger` row in the same transaction (`reconcile` checks sum(ledger) = gv).
- Purchases idempotent by purchase id, atomic `gv >= price` debit. Tokens stored as SHA-256 only.
- Durable I/O never runs on a room task: results go through a channel to a retrying writer (`rh-server` director).
- Migration from the legacy file: `rh-persist-admin import-legacy --dry-run` then a real run in one transaction;
  `reconcile`; `export-legacy` for inspection. Rollback to the legacy server needs the ORIGINAL file (tokens are hashed).

**Evidence.** The persistence tests against a real local PostgreSQL 16 (duplicates, concurrent writers, stale fences, a connection
killed mid-transaction, double-spend, import/reconcile): `crates/rh-persist/tests/`. Not yet tested: Aurora failover,
connection-pool exhaustion under load. Stage 2 achievements are now ported and verified against 83 legacy observations;
the 57-entry cosmetic catalog and validated look words match 301 further legacy observations. Live profile routes,
result faction/weapon metadata remain separate integration work. Stage 2 lease renewal and identity/cancellation
repairs are verified against local PostgreSQL; see the live-ownership addendum below.

## Addendum: live ownership and cancellation

PostgreSQL authentication captures the durable profile ID from the token-verified row. Admission reservations, room
reports, renewals, result retries and give-backs use that identity plus admission generation/match/fence. Display-name
changes cannot create a second seat for the same principal or redirect a waiting authenticated login to a replacement
profile. Distinct principals can safely retain the same historical display label. Missing or ambiguous ID-less live
receipts refuse to write/release rather than resolving a reassigned callsign.

The director renews off the room task. Defaults are a 120 s TTL, 30 s interval and 5 s database-call budget; validation
requires positive interval/timeout, their sum below TTL, and TTL at most one hour. CLI flags are `--lease-ttl-secs`,
`--lease-renew-secs` and `--lease-db-timeout-secs`. Renewal uses captured IDs and a live-only unexpired, matching row
guard with nonblocking row acquisition. A busy row retains the prior confirmed deadline and retries. Rooms check that
deadline before commands/resume and every simulation step; a delayed success cannot revive an expired seat. Resolved
result delivery survives the release of its lease. Pending result writes retain their independent fenced lifecycle.

Live acquisition has transaction/cancellation cleanup, and an exact-generation reservation guard covers abandoned
admissions before and after a join is submitted. Stale cleanup cannot release a successor. The existing Store edge/admin
APIs retain their stated per-call name resolution and expired-renewal semantics; they are distinct from live receipts.
No schema or dependency change was needed. Actual row-lock, cancellation, rename/reassignment, late-commit and abrupt
host-stop reproductions and remaining deployment limits are in [the evidence](../evidence/stage2-leases/README.md).


## Addendum: durable-data lock-in (L-durable)

No production database exists yet (persistence is proven only against local and test PostgreSQL), so `0001_init.sql` was
**rewritten in place** rather than followed by a migration. sqlx checksums only matter for databases that already applied the
old text, and only throwaway test databases did. From the first real deployment on, every schema change is a new migration.

- **Identity.** A profile is its surrogate `profile_id` (bigint identity). The callsign is a unique (`lower(callsign)`),
  renamable display attribute. Every child table (`gv_by_month`, `gv_ledger`, `session_leases`, `match_results`,
  `purchases`) references `profile_id`, so a moderation rename or a legacy case-collision fix touches one row and never the
  append-only ledger. (Deleting a profile is blocked by the ledger and result foreign keys on purpose: a privacy erasure means
  anonymising the profile row, and `match_results.result.killedBy` and replays keep the killer's callsign as a display snapshot.)
  The callsign is resolved once, at admission: `Store::acquire_lease` returns the `profile_id`, the server keeps it with the
  admission, and every later call (`record_result_by_id`, `renew_lease_by_id`, `release_lease_by_id`) goes by that id, so a
  rename or a name swap while a player is in a live match neither loses the result nor strands the lease. The callsign forms
  of those calls resolve the name per call and are for edge and admin callers only.
- **Match record.** `match_results.result` holds the complete `RunResult` fields plus faction and weapon, camelCase, with a
  `"v":1` key. A small `matches` row (match id, owner, region, placement id, build, content hash, ended_at, humans, bots,
  replay_ref) is inserted by the first result transaction of the match and found by the others (`ON CONFLICT` advances `ended_at` to the
  latest result, so it is the time of the last recorded result, not of the first player's death; per-player times are
  `match_results.applied_at`). `humans` is the number of lobby seats taken and `bots` the bots seated when the first result was
  reported, both a snapshot. `region`, `placement_id` and
  `replay_ref` stay NULL until P-HOST-1 and the replay store (P-OPS-6) report them.
- **Tolerant blobs and the compat floor.** `stats`, `progress` and `cosmetics` decode with defaults and keep unknown keys
  through a read-modify-write (a flattened catch-all), so an older binary never erases a newer binary's field during a rolling
  deploy. The old rule "any newer migration blocks older binaries" is replaced by `schema_compat.min_binary`: a binary whose
  newest embedded migration is below it refuses to start (`rh-server` exits 78 with the message). Additive migrations leave it
  alone (expand/contract); only a migration that old binaries cannot survive raises it.
- **Replays and checkpoints** name their build (`BUILD_ID`, the `RH_BUILD` environment variable at compile time) and the
  match; checkpoints also carry `content_hash` and `Sim::restore` refuses other content (`CheckpointError::ContentMismatch`).
  Policy: a replay or checkpoint is verified by the build that recorded it, never across builds; releases keep their commit
  buildable. Format tags are unchanged: the new keys are additive and older files without them still verify (`rh-headless
  --verify-replay` warns about a replay with no build; a checkpoint without the keys restores silently). `RH_BUILD` is not
  yet set by any pipeline, so every dev build reads `dev-<crate version>`; the release pipeline must set it.
- **Durable ids** (faction, weapon, cosmetic and achievement strings, outcome and win-bonus spellings) are append only;
  `crates/rh-server/tests/durable_ids.rs` (faction and weapon strings) and
  `crates/rh-persist/tests/ids.rs` (outcome spellings, win-counter lists) pin them; both run in the default `cargo test`.
- **Topology.** There is exactly one global writable primary (for example Aurora Global Database with one writer region).
  Profiles are not region-homed, and leases and fences depend on that: per-region primaries would break fencing. A cross-region
  result transaction holds the profile row lock for several round trips (an estimate, not measured; P-PERSIST-4 measures it); collapsing it into fewer round trips is
  P-PERSIST-4. P-HOST-1 passes the GameLift compute or instance id as `--instance-id` so lease owners are meaningful.

## Addendum: durable result handoff (P-CLAUDE-INFRA-1, 2026-11-05)

Before this addendum a result was retried in memory (about two minutes) off the room task; if the process died or the
retries ran out, the result was gone. `rh-server --result-spool <dir>` adds a local, fsynced spool and a startup recovery
pass. Code: `crates/rh-server/src/spool.rs`, `Director::{write_result, drive_spooled, recover_spooled}`,
`Persistence::record_spooled`. Tests: `crates/rh-server/tests/result_recovery.rs` (real PostgreSQL).

### The boundary, stated exactly

A result passes three points. **Emitted**: the room task sent `RoomReport::Result` on an in-memory channel (not durable).
**Spooled**: a versioned, CRC-checked record was written to a temporary file, `fsync`ed, renamed to
`<match>-<profile_id>.rec` and the directory `fsync`ed (durable on this host and volume; logged and counted as `spooled`).
**Committed**: the fenced PostgreSQL transaction returned `Applied` or `AlreadyApplied` (logged and counted as `committed`;
the only point that survives host loss). A record is removed only after the commit (or after a definitive
`AlreadyApplied`).

The result can still be lost: (a) between emitted and the directory fsync (the process dies in that window; milliseconds on
a healthy disk); (b) when the append fails (spool full, unwritable, record over 64 KiB), in which case the result takes the
old in-memory retry path and is counted (`spoolFull`, `spoolErrors`) and logged; (c) with no `--result-spool` (unchanged
behaviour, documented in `--help` text at the top of `main.rs`); (d) on host replacement or volume loss. A match
interrupted before it emitted results has no result to recover. Nothing recovers an unrecorded result and nothing invents
one for an interrupted match.

### Scope: process restart yes, host loss no

The spool survives a process crash or restart on the same host/volume. It does **not** survive host replacement; only the
PostgreSQL commit does. We deliberately do not claim more and did not build an off-host record: that needs another
durable dependency (queue or object store) with its own durability, fencing and failure analysis, and a result held there
would still have to pass the same fence check at the database. Hosting (P-HOST) may place the spool on a persistent
volume; that makes a replaced instance recoverable only if the volume is reattached, which is a deployment decision to be
proved, not assumed. `tools/pgtest/start.sh` runs PostgreSQL with `fsync=off`; the local tests prove process-kill
behaviour, not power-loss durability.

### Observability

The loopback `GET /control/health` JSON has a `results` object: `spooled`, `committed` (same count as `resultsOk` in
`/info`), `recovered`, `refused`, `failed`, `deadLettered`, `spoolFull`, `spoolErrors`, `spoolPending`, `spoolDead`, `stuckAlerts`, `deadOverflow`. `/info`
and its pinned key set are unchanged. Log lines say `spooled match=... (durable on this host only; not yet committed)`,
`committed match=... (applied|already applied[, recovered from spool])` and `DEAD-LETTERED match=...: <reason>`; they carry the
match id and profile id, never a token or ticket.

### Recovery rules

- **Same fenced path.** Startup replays each record through `Store::record_result_by_id_at` (the same transaction as
  `record_result_by_id`) with the ORIGINAL profile id, fence, stored result document and match metadata (owner, region,
  placement, build, content hash, humans, bots) captured when the result was produced. The restarted build's values are
  never substituted (test: a record with owner `dead-host`, build `old-build-7` and a distinct content hash lands with
  exactly those values).
- **No lease action.** Recovery never acquires, renews or releases a lease. A newer owner's fence gives `StaleFence`; a
  released or foreign lease gives `NoLease`; both are *permanent* refusals and the record is moved to `<dir>/dead/` with a
  `.reason` file (metrics `deadLettered`, `spoolDead`; log line with match and profile id only). Test: after a
  takeover the new owner's lease row (match, fence, release state, owner, expiry) is byte-identical after recovery.
- **Duplicates.** A record whose result was already committed returns `AlreadyApplied`, is cleared, and credits nothing
  (tests: committed-before-crash; the same record replayed twice).
- **Retry without a deadline.** A transient error (connection, pool, timeout, deadlock, shutdown: anything the database
  may cure) is retried with backoff (default 100 ms doubling to 5 s, then every 5 s) **for as long as it takes**. It is never
  dead-lettered for time: a database outage of any length would otherwise free the seat, let the lease expire, let a new
  owner take the profile, and turn the later replay into `StaleFence` (a lost result). The record stays pending and the
  profile gate stays held; this costs nothing during an outage because admission needs the same database. `--result-retry-secs`
  (default 900) is only an **alert threshold**: a result still uncommitted after it is logged `STUCK match=... profile_id=...`
  and counted (`stuckAlerts` in `/control/health`), again every interval, while it keeps retrying. (Before this fix the flag
  was a deadline that dead-lettered; the old default of 15 minutes was the loss window.)
- **Definitive refusals only are dead-lettered.** `StaleFence`, `NoLease`, and a *permanent* store error (the database rejects
  the data itself: SQLSTATE class 22 data exception, class 23 constraint violation except `23505` unique violation, which a
  retry resolves to `AlreadyApplied`, class 42, or an invalid-input/decode error; see `rh_persist::Error::is_permanent`,
  `RecordError::Permanent`) move to `<dir>/dead/` with a `.reason`. Dead letters are never retried by the server; an operator
  can move one back into the spool directory before a start, and it is replayed through the same fenced path (it is refused
  again if a newer owner exists).
- **Corrupt records.** A truncated, bit-flipped, empty, wrong-version or misnamed file is dead-lettered at startup with its
  parse reason, never deleted and never retried. Half-written temporaries are deleted at open (they were never
  acknowledged).
- **No blocking.** Spool I/O runs on `spawn_blocking`, database attempts on the director's tasks; recovery runs in the
  background. A database outage delays commits, never startup or a tick (test: with PostgreSQL stopped, snapshot ticks keep
  advancing, the match ends, results are spooled, and after the restart both commit and the spool drains).
- **Admission gate.** For each profile with a pending record, the director holds a `Leaving` entry with no lease state
  until its records resolve, so an admission in the same process waits (the existing `LEAVING_WAIT`) or is refused
  `ProfileInUse` instead of racing the replay. This cannot stop a different host admitting the profile after the lease TTL:
  that host's new fence is then exactly why the old record becomes a dead letter. A result must therefore commit within
  the lease TTL after its process dies; recovery on restart is first-come against the next admission, by design.
- **Live path.** With a spool the live write is the same loop as recovery (spool, then retry until committed or definitively
  refused). The lease is not released when a record is dead-lettered, so an operator replay remains possible; the lease
  then simply expires.
- **Bounds.** `--result-spool-max` (default 4096) caps *pending* records only; dead letters do not count toward it, so a
  burst of refusals cannot shut the spool to new results. `--result-dead-max` (default 1024) bounds `dead/`. At that bound a
  further definitive refusal is **not moved**: its record stays in place (pending, never deleted), the server stops retrying
  it in this process, counts it (`deadOverflow`) and logs `DEAD-LETTER DIRECTORY FULL ...` on every occurrence; a restart
  tries it again, and the operator frees space by clearing `dead/`. When the pending bound is full, new results fall back to
  the in-memory retry (counted and logged, never dropped silently, never blocking a tick). Concurrent appends of one
  `(match, profile)` count it once; a dead-letter for a record that was committed meanwhile is a no-op (no orphan `.reason`).

### Contract change (one, additive)

`Store::record_result_by_id_at(.., ended_at_ms)` is new; `record_result_by_id` is unchanged and calls it with `None`. A
replayed result would otherwise stamp `matches.ended_at` with the recovery time, which misstates when the match ended.
With `Some(ms)` the `matches` row takes that time (still advanced with `greatest` by later results). `applied_at`, the
monthly GV bucket and achievement timestamps stay the commit time: they record when the credit landed, as for any retried
result today, so a result recovered after midnight on the last day of a month credits the month it commits in. All
existing assertions are untouched; no schema change.

### Not covered

An actual managed-database failover (Aurora), host replacement, power-loss durability, pool exhaustion under load, and
a spool on a network filesystem (whose rename/fsync semantics were not examined; use a local filesystem).

## Addendum: account HTTP service (P-PERSIST-2 REST, P-PERSIST-3 leaderboard, P-PERSIST-5 guards)

**Placement.** The legacy `/api/*` contracts are served by `rh-server` on the PUBLIC listener beside `/ws`
(`rh_server::public_router_with_api`, code in `crates/rh-server/src/api.rs`), not by a separate service and never on the control
listener. Reasons: one process already holds the pool and the catalog, the browser client addresses one origin per region
(`apiBase()`), and a separate `rh-api` would add a deploy unit with no isolation gain (all writers share one primary anyway).
The module has no dependency on the director, so it can be lifted into its own binary if the edge later wants that; the routes are
a plain `Router`.

**Contracts** (legacy `index.ts`, status codes and JSON shapes kept; the legacy TypeScript client works unchanged):
`GET /api/profile/:name` claims a free name (fresh 256-bit random token, 64 hex characters, returned once; only SHA-256 is
stored) or opens it with `x-profile-token` (else 403). The open response echoes the CALLER'S OWN presented token because the legacy
client persists `token` from every profile response; no stored secret exists to leak, and no other profile's token appears anywhere.
Passcode (`PLAYTEST_PASSCODE` environment variable, never argv) and the new-profile caps apply to claims only; the caps (30 per
hour total, 10 per address) are reserved before the insert and refunded when no name was created. Purchase and equip validate the
cosmetic id and slot against the Rust catalog before the atomic `Store::purchase`/`equip` calls. Leaderboard: UTC month key, repeated or malformed `month`
is 400, `limit` follows the legacy regex and clamp 1..=100, `you` only with the named profile's own token. Bodies are capped at
1 KiB and parsed as strict JSON (unknown fields, trailing bytes and non-objects are 400, wrong media type 415, too large 413).
Whole requests are bounded by `--api-timeout-secs` (default 10; 408).

**Idempotency.** The legacy contract has no purchase id. Idempotency is by ownership: under the profile row lock a second
purchase of an owned item answers 409 `already_owned` and never debits twice; concurrent purchases serialise on that lock, so
GV cannot be spent twice (tested with 24 parallel requests). An optional `Idempotency-Key: <uuid>` header (an extension) becomes
the durable `purchases.purchase_id`: a retry of the same key and item returns 200 with the same single debit, a key reused for
another item is 409. A request cancelled by a client or the timeout is a rolled-back or committed transaction, never a partial one.

**Leaderboard cache and invalidation.** Pages (top 100 per month, plus the month list) are cached per month. `Store` carries a
GV-credit epoch (`Store::gv_epoch`, shared by its clones); `record_inner` bumps it after COMMIT whenever a result credits GV, so the
result writer (director, any room) invalidates the cache without calling into the API. The epoch is read BEFORE the query and
stored with the page, so a credit that lands mid-query makes the page stale rather than the new epoch masking it. Credits made by
OTHER hosts are not visible to this process: `--leaderboard-ttl-secs` (default 5) bounds that staleness. Months with no GV are
cached too (a bounded map: stale entries go first, then empty months). An equip also bumps the epoch, because rows show titles. `you` is computed per request, uncached. Purchases never touch the board (GV earned, not balance, is ranked).

**Rate limits and addresses.** Limits live in `api/limits.rs` and are called by handlers; each is disabled by a 0, which is how an
edge limiter takes over. They are per process (N hosts allow N times the caps). Caps key on the TCP peer address; a forwarded
header (`--client-ip-header`) is read only from a loopback or `--trusted-proxies` peer, a repeated header counts as absent, a
comma list uses its last entry; `X-Forwarded-For` is otherwise never trusted. Wrong passcodes are throttled before comparison
(6/min per address, 40/min total); the passcode and token hashes are compared in constant time (`ct_eq`, also now used for token
hashes in `rh-persist`). Shop bucket (burst 6, 3/s) is per profile id and charged only after the token is proven.
Every `/api/profile*` and `/api/leaderboard` request first spends one token from a **per-address** bucket
(`--lookup-burst` 40, `--lookup-per-second` 20, 0 disables), before any database query; an empty bucket is 429 `rate_limited`
with `Retry-After`. The legacy answers (403 for someone else's name, claim of a free one) are decided after it and unchanged.
IPv6 addresses are keyed by their /64 in every per-address cap (IPv4-mapped addresses as the IPv4 they carry). A cap of 0
records nothing. The passcode throttle reserves its failure slot and checks in one step under one lock (concurrent wrong
guesses cannot all pass), handing the slot back for a right or absent passcode. The account API also has its own bound on
concurrent database users (`--api-db-concurrency`, default 6 of the pool's 16, 0 = unbounded): a request waits up to 2 s for a
slot and then gets 503 `busy`, so anonymous lookups cannot take every connection from lease and result writes. A slot is
held around database work only, never while a request body is read.

**Claim cancellation safety.** A claim's INSERT, its answer and any compensation run in a task the request timeout cannot
cancel; the handler only waits for it, and the answer is built from the insert (`Profile::fresh`), not a read-back. If the
handler is gone (timeout, client left) by the time the claim commits, nobody can receive the token, so the task deletes the
fresh, history-free profile (`Store::discard_unclaimed_profile`) and returns the new-profile reservation; the caller's retry
claims the name. The reservation is returned on every exit that leaves no claimed name (error, lost race, panic, undone
claim). A concurrent same `Idempotency-Key` from two different profiles is a clean 409, not a primary-key 500.

**CORS.** The legacy server answered `*` in development and an allowlist only when hosting. The Rust default is the safe one: no
allow header unless `--api-cors-origins` lists origins (or `*` for development); no credentials header is ever sent.

**Memory mode.** Without `--database-url` (or without the `postgres` feature) profile, shop and leaderboard routes answer 503
`storage_unavailable` with a plain message; `/api/health` stays 200 and `/readyz` reports `storage: memory`. There is no in-memory
account store: it would be a second implementation of the money rules.

**Health.** `/api/health` is `{ok:true}`. `/readyz` is 200 only while the lifecycle is `ready` (not starting or draining) and a
bounded `SELECT 1` (cached 1 s) succeeds; the body names the lifecycle state and `ok|unavailable|memory`, nothing else (no DSN,
no counts). Storage outages answer 503 with `Retry-After`; a claim whose insert failed issues no token.

**Not covered / still open.** Hyper header-read (slowloris) timeouts and TLS-level limits are the edge's job; no per-address limit
exists for requests with invalid tokens (a flood costs one indexed lookup each); lobby presence and matchmaking `/api/lobby*`
are not ported (404); pool exhaustion and Aurora failover remain P-PERSIST-4. A claim whose response is lost leaves the name
claimed with an unrecoverable token, as in the legacy server (the legacy 503 body returned the token; the Rust server issues none on failure).
Evidence: `crates/rh-server/tests/account_api.rs` (11 tests, real PostgreSQL through the real router), `account_api_memory.rs`,
`crates/rh-persist/tests/account.rs`.
