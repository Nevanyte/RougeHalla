# Placement library and its durable ledger

The pure planner and the asynchronous `PlacementService` are tested with local fakes. This crate has no production HTTP
handler, AWS adapter or DNS adapter, and nothing here proves that a cloud placement, a public TLS join, a capacity target
or a cost bound works. What it does have is a **durable request ledger** (memory store, PostgreSQL store) that the service
writes to before and after every external effect, so a restarted service can reconcile.

## Boundary

* Placement runs off the game tick, in the placement service. No AWS SDK, no credentials, no game code here.
* `Scope` is a trusted caller-supplied namespace (for example the authenticated account id, 1..=128 printable ASCII). It is
  part of request identity, **not authentication**: the HTTP boundary must authenticate and pass the right scope.
  `place`/`place_with` use `Scope::default()`; `place_scoped`/`place_with_scoped` take one.
* `GameSessionData` carries a SHA-256 ownership binding (nonce + request + config + attempt). It is cleanup metadata, not
  an admission credential. The adapter must preserve it in every receipt. Recovery compares receipts with the binding
  **stored per attempt**, by placement id and exact `GameSessionData`; missing evidence stays unresolved and foreign
  evidence is never stopped, terminated, published or deleted.
* `JoinOffer` (with player-session ids) is stored in the ledger: treat the table like the offer itself.

## State machine

One ledger row per `request_id` (the key: it is part of the GameLift placement id). `phase`:
`active` (a `place` call owns it, or crashed) -> `offered` | `finished` (no host, every attempt resolved);
`offered` -> `releasing` -> `released` (explicit session end only); `finished`/`released` -> `tombstone` (retention).
Every write is a compare-and-swap on the claim's **fence** (claims bump it; holder, kind and lease are checked too).
Identical retry: `offered` replays the stored offer; anything else is `RequestIdReused` (mint a new id); a different scope,
request or config under an id is `Invalid` and fails before any backend call.

Per attempt, intent first, effect second: `start Intent` -> `start_placement` -> `Accepted` (verified receipt) -> poll ->
timeout: `stop Intent` -> `stop`/describe (identity verified, only a terminal status resolves it) -> `Resolved`;
fulfilled -> `fulfilled` -> `dns Intent` -> upsert + authoritative verify -> `Verified` -> **offer committed with phase
`offered`** -> only then returned. Publication failure runs the same cleanup routine the reaper uses
(`DeleteIntent`/`terminate Intent`, then delete + terminate, then `CleanedUp`). The store refuses an `offered` write when
cleanup or a stop is in flight for that placement, and refuses `finished` with an unresolved attempt.

**Reaper** (`reap_abandoned`, bounded by `reap_batch`): claims `active`/`releasing` rows whose claim expired
(`FOR UPDATE SKIP LOCKED`, fence + 1). `offered`, `released`, `finished`, `tombstone` are never selected: offer age and
lease expiry never imply session end. Per open attempt: describe -> not found: resolved only if accepted and last seen
terminal; otherwise counted, and `Settled` only after two NotFounds AND `start_settle_after` (1 h) since the start intent
(a provider start delayed beyond that is untracked; the game host's unclaimed-session timeout bounds its cost). Pending ->
stop; fulfilled -> delete DNS (stored original zone) + terminate. Errors leave work unresolved. A cancelled pass frees its
claims.

**Uncertain commit**: a write that errors or times out is ambiguous. The worker re-reads the row: committed (same fence,
same state) means done; unchanged means retry (bounded); fence moved or unreadable means it stops, performs no further
effect and starts **no cleanup** because of the failure. An offer that did commit is `offered` and protected; one that did
not leaves an `active` row the reaper owns.

**Explicit release**: `release_session(scope, request_id, placement_id)` (trusted session-end hook, not HTTP
authorization). Validates scope and that `placement_id` is the stored offer's; wrong scope/request is `Unknown`, wrong
placement `WrongPlacement`, no offer `NotOffered`, all with no DNS call. Records `releasing`, deletes the offer's hostname
(original zone), records `released`; a duplicate is `Ok` with no DNS call; a half-done release is resumed by a retry or by
the reaper. A released id never replays its offer. `release_host(region, id)` is gone: no ID-only deletion path remains.

**Retention** (`purge_retained`): `finished`/`released` rows older than `DurabilityConfig::retention` (30 days) become
tombstones (id, scope, fingerprint, final phase, timestamps kept forever; request/config/state dropped), so an old id never
replays or restarts. `active`, `releasing`, `offered` are never purged. The memory store is capped at 4096 ids, fails closed
(`ServiceUnavailable` before any call) and never evicts; PostgreSQL has no cap.

**Epoch**: the ledger holds one 32-byte ownership nonce. `PlacementService::with_ledger(candidate, ..)` opens it: a stored
epoch wins; a candidate is stored only when there is no epoch and no records; records without an epoch are `Corrupt`.
Pass a fresh CSPRNG candidate (this crate generates no randomness). `PlacementService::new(nonce, ..)` is a fresh memory
ledger with that nonce.

Known boundary: database fencing cannot recall a request already sent to a provider. A stale worker's in-flight DNS upsert
may land after takeover cleanup (a never-offered hostname remains), and a stale start may be accepted later (covered by the
NotFound rule). Cleanup operations must be idempotent; nothing is exactly-once. A held connection during a backend call is
never a lock: no transaction or row lock spans an external await.

## PostgreSQL store (feature `postgres`)

`PgLedger::connect(url, PgLedgerConfig)` makes a bounded pool (acquire timeout, server `statement_timeout`/`lock_timeout`,
per-call timeout) and applies `migrations/0001_placement_ledger.sql` (**schema version 1**, `ledger::SCHEMA_VERSION`) in one
transaction under an advisory lock. Compatibility: own tables `rh_placement_epoch`, `rh_placement_requests` and version
table `rh_placement_schema`; sqlx's migrator is not used, so `_sqlx_migrations` (rh-persist's) is never touched and both can
share a database. A database with a newer schema version is refused. Statements are parameterized; errors keep only a
category and SQLSTATE, never the URL or any binding or nonce. `DurabilityConfig` (worker/reaper lease, `db_op_timeout`,
`backend_op_timeout` wrapping every backend call, `start_settle_after`, `reap_batch`, `retention`) is separate from
`ServiceConfig`, so bindings are unchanged.

## Fault injection (feature `fault-injection`, off by default)

`ledger::faults` offers named points `before|after.write.<label>` and `before|after.backend.<call>` (a hook may fail a
point, await a barrier, hang or end the process) and the mutants read from `RH_PLACEMENT_MUTANT`: `skip_write_ahead`,
`skip_ownership_check`, `skip_fencing`, `premature_completion` (unset or `none` is the unchanged control; unknown names
panic). Nothing in a default build reads either.

## Commands

```sh
cargo test -p rh-placement --locked                       # no database; memory conformance + service tests
eval "$(tools/pgtest/start.sh)"                           # throwaway PostgreSQL; sets DATABASE_URL (never printed)
cargo test -p rh-placement --features postgres            # + PostgreSQL conformance and service tests (panic without DATABASE_URL)
cargo test -p rh-placement --features fault-injection --test fault_hooks
RH_PLACEMENT_MUTANT=skip_fencing cargo test -p rh-placement --features fault-injection,postgres --no-fail-fast  # must FAIL
cargo clippy -p rh-placement --all-targets --all-features -- -D warnings
```

## API example

```rust
use rh_placement::ledger::{postgres::{PgLedger, PgLedgerConfig}, Scope};
use rh_placement::service::{DurabilityConfig, PlacementService};

let ledger = PgLedger::connect(&url, PgLedgerConfig::default()).await?;      // url from the environment, never logged
let svc = PlacementService::with_ledger(fresh_csprng_nonce, cfg, gamelift, dns, ledger, DurabilityConfig::default()).await?;
let scope = Scope::new(authenticated_account_id)?;
let offer = svc.place_scoped(&scope, &request).await?;       // identical retry after a crash returns the same offer
svc.reap_abandoned().await;                                  // schedule it; bounded per pass
svc.release_session(&scope, &request.request_id, &offer.placement_id).await?; // session-end hook
svc.purge_retained().await?;                                 // schedule it
```
