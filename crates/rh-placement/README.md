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
Every write is a compare-and-swap on the claim's **fence** (claims bump it; holder, kind and lease are checked too) AND on the
row's **version**: each write, and each claim, bumps it by one, and a write must present exactly the version it last saw
(`Claim::version`; after a write the next claim is `claim.next()`). A write that timed out client-side but is still queued at
the store can therefore never land after a retry and a later write of the same claim; it is `Fenced`.
Identical retry: `offered` replays the stored offer; anything else is `RequestIdReused` (mint a new id); a different scope,
request or config under an id is `Invalid` and fails before any backend call.

Per attempt, intent first, effect second: `start Intent` -> `start_placement` -> `Accepted` (verified receipt) -> poll ->
timeout: `stop Intent` -> `stop`/describe (identity verified, only a terminal status resolves it) -> `Resolved`;
fulfilled -> `fulfilled` -> `dns Intent` + `dns_upsert InFlight` -> upsert -> fenced acknowledgement (`dns_upsert Idle`)
-> authoritative verify -> `Verified` -> **offer committed with phase
`offered`** -> only then returned. Publication failure runs the same cleanup routine the reaper uses
(`DeleteIntent`/`terminate Intent`, then delete + terminate, then `CleanedUp` only if no upsert remains unresolved). The store refuses an `offered` write when
cleanup or a stop is in flight for that placement, and refuses `finished` with an unresolved attempt.

**Reaper** (`reap_abandoned`, bounded by `reap_batch`): claims `active`/`releasing` rows whose claim expired
(`FOR UPDATE SKIP LOCKED`, fence + 1). `offered`, `released`, `finished`, `tombstone` are never selected: offer age and
lease expiry never imply session end. Per open attempt: describe -> not found: resolved only if accepted and last seen
terminal; otherwise counted and retained indefinitely. Neither repeated NotFound nor any elapsed duration proves that a
sent start cannot still be accepted. `start_settle_after` remains a compatibility-only, ignored setting. Pending ->
stop; fulfilled -> delete DNS (stored original zone) + terminate. Errors leave work unresolved. Rows are claimed one at a
time (so a slow backend on one row cannot run out the leases of the rows behind it); a row that could not be settled keeps its
claim until the pass ends, and a cancelled pass frees them.

Conservative rules (a row stays **open**, visible in `unresolved_count`, rather than losing owned work):
* DNS send obligations are separate from `DnsStep` cleanup progress. Before **each** upsert the service commits
  `dns_upsert InFlight`; a successful receipt clears only that send through the same fenced/versioned claim. If another send
  is retried while the previous one is unresolved, it becomes `Ambiguous`, which no later receipt, resolve, delete or
  termination can discharge. A crash or unreadable acknowledgement outcome retains whatever was actually committed.
* Any unresolved DNS send forbids offers and finalization. Cleanup continues deleting the original hostname on bounded
  reaper passes indefinitely, even after a prior delete/termination succeeded or the provider forgot the placement.
  This is necessary because the backend has no operation identity, cancellation or drain barrier. Ordinary first-send
  success is acknowledged and can publish/release normally.
* An attempt with an open cleanup intent or unresolved upsert is never settled by NotFound answers: cleanup is retried
  from the stored arn and hostname, preserving the separate obligation.
* A refused (`Invalid`) start proves nothing was started only on the very first try; after an unavailable or timed-out try the
  attempt is left open for the reaper.
* Receipts that contradict an attempt already proven ours (acceptance recorded, a fulfilment, or any DNS/terminate intent) are
  never resolved `Foreign`, and nothing is mutated on their strength, not even our own recorded name. The attempt waits until the
  provider agrees with the ledger again. Only an attempt never proven ours resolves `Foreign`.

**Uncertain commit**: a write that errors or times out is ambiguous. The worker re-reads the row: committed (same fence,
version + 1, same state) means done; unchanged (same version) means retry (bounded); fence or version moved elsewhere, or an
unreadable row, means it stops, performs no further effect and starts **no cleanup** because of the failure. If a retry after an
ambiguous try is `Fenced`, the row is read once more: the delayed original may have landed first, in which case the write is
committed. Ledger calls are never abandoned by the service before the store's own budget (`Ledger::op_budget`; `with_ledger`
raises `db_op_timeout` to it), and `PgLedger::connect` sets the server's `statement_timeout`/`lock_timeout` to four fifths of
the client budget, so the database cancels a statement before the client stops waiting for it. With `PgLedger::from_pool` the
caller must do the same. An offer that did commit is `offered` and protected; one that did
not leaves an `active` row the reaper owns.

**Explicit release**: `release_session(scope, request_id, placement_id)` (trusted session-end hook, not HTTP
authorization). Validates scope and that `placement_id` is the stored offer's; wrong scope/request is `Unknown`, wrong
placement `WrongPlacement`, no offer `NotOffered`, all with no DNS call. Records `releasing`, deletes the offer's hostname
(original zone), records `released`; a duplicate is `Ok` with no DNS call; a half-done release is resumed by a retry or by
the reaper. A released id never replays its offer. After retention the tombstone keeps the offer's placement id, so a duplicate release still has to name it
(`WrongPlacement` otherwise; tombstones made by a schema 1 binary have none and refuse every release, fail closed).
`release_host(region, id)` is gone: the service has no ID-only release operation. Raw backend accessors remain available
to trusted library owners and tests; their methods can mutate providers without ledger checks. These accessors are not
read-only views, and `doc(hidden)` does not restrict access. The service governs its managed lifecycle operations, not
capabilities callers already hold through the backends they supply. Route managed session-end cleanup through
`release_session`; this does not establish HTTP authorization or capability confinement.

**Retention** (`purge_retained`): `finished`/`released` rows older than `DurabilityConfig::retention` (30 days) become
tombstones (id, scope, fingerprint, final phase, timestamps kept forever; request/config/state dropped), so an old id never
replays or restarts. `active`, `releasing`, `offered` are never purged. The memory store is capped at 4096 ids, fails closed
(`ServiceUnavailable` before any call) and never evicts; PostgreSQL has no cap.

**Epoch**: the ledger holds one 32-byte ownership nonce. `PlacementService::with_ledger(candidate, ..)` opens it: a stored
epoch wins; a candidate is stored only when there is no epoch and no records; records without an epoch are `Corrupt`.
Pass a fresh CSPRNG candidate (this crate generates no randomness). `PlacementService::new(nonce, ..)` is a fresh memory
ledger with that nonce.

Known boundary: database fencing cannot recall a request already sent to a provider. A stale upsert may recreate the
never-offered hostname after takeover cleanup; the durable unresolved obligation keeps reconciliation discoverable.
A name may remain present until the next reaper pass. There is deliberately no automatic finalization for an uncertain
upsert without stronger backend evidence. A stale start is retained until exact owned terminal/cancel evidence or
confirmed session cleanup. Cleanup operations must be idempotent; nothing is exactly-once. No transaction or row lock
spans an external await.

## PostgreSQL store (feature `postgres`)

`PgLedger::connect(url, PgLedgerConfig)` makes a bounded pool (acquire timeout, server `statement_timeout`/`lock_timeout`,
per-call timeout) and applies migrations 0001–0003 (**schema version 3**, `ledger::SCHEMA_VERSION`) in one
transaction under an advisory lock. Compatibility: own tables `rh_placement_epoch`, `rh_placement_requests` and version
table `rh_placement_schema`; sqlx's migrator is not used, so `_sqlx_migrations` (rh-persist's) is never touched and both can
share a database. A database with a newer schema version is refused.
Version 3 refuses a **nonempty** v1/v2 placement ledger with `LedgerError::Incompatible`, without changing rows, schema
version or nonce: older state may already have forgotten ambiguous work, so it cannot be upgraded safely by inference.
Such a database needs a quiesced, explicit operator reconciliation/migration plan; no automatic deletion or rewriting is
performed. Empty old ledgers upgrade and preserve their epoch. Stop all older instances before upgrading; the version check
prevents them reopening a v3 database. An already-open older connection is also blocked: migration 0003 installs a database
CHECK requiring explicit valid `dns_upsert` metadata on every attempt, so an old binary cannot commit its field-less start
or cleanup intent before sending effects. An exclusive table lock serializes the old-version emptiness check with concurrent
legacy inserts/writes. This ledger has not been deployed to production. Statements are parameterized; errors keep only a
category and SQLSTATE, never the URL or any binding or nonce. `DurabilityConfig` (worker/reaper lease, `db_op_timeout`,
`backend_op_timeout` wrapping every backend call, `reap_batch`, `retention`) is separate from
`ServiceConfig`, so bindings are unchanged.

## Fault injection (feature `fault-injection`, off by default, test builds only)

Enabling the feature without `debug_assertions` (a release build) is a `compile_error!`: fault points and mutants can never ship.

`ledger::faults` offers named points `before|after.write.<label>` and `before|after.backend.<call>` (a hook may fail a
point, await a barrier, hang or end the process) and the mutants read from `RH_PLACEMENT_MUTANT`: `skip_write_ahead`,
`skip_ownership_check`, `skip_fencing`, `premature_completion` (unset or `none` is the unchanged control; unknown names
panic). Nothing in a default build reads either.

## Commands

**Acceptance command:** `cargo test -p rh-placement --features postgres,fault-injection` (with `DATABASE_URL` set). The
PostgreSQL conformance target (`ledger_conformance_postgres`) and the crash/restart targets declare `required-features`, so cargo
refuses to build them without the feature instead of running zero tests and reporting success; the PostgreSQL cases inside
`placement_durable` are compiled only with `--features postgres` and panic when `DATABASE_URL` is missing. A run without
`--features postgres` has NOT exercised PostgreSQL.

`Debug` output of ledger records, offers, backend receipts and `JoinOffer` never prints bindings, player-session ids or request
JSON.

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
