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
`/info`), `recovered`, `refused`, `failed`, `deadLettered`, `spoolFull`, `spoolErrors`, `spoolPending`, `spoolDead`. `/info`
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
- **Bounded retry.** A transient error is retried with backoff (default 100 ms doubling to 5 s) until `--result-retry-secs`
  (default 900) passes, then the record is dead-lettered as out of time (`failed`, `deadLettered`). Dead
  letters are never retried by the server; an operator can move one back into the spool directory before a start, and it
  is replayed through the same fenced path (it is refused again if a newer owner exists).
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
- **Live path.** With a spool the live write is the same loop as recovery (spool, then retry until committed, refused or
  the deadline). The lease is not released when a record is dead-lettered, so an operator replay remains possible; the lease
  then simply expires.
- **Bound.** `--result-spool-max` (default 4096) caps pending plus dead-lettered records. When full, new results fall back
  to the in-memory retry (counted and logged, never dropped silently, never blocking a tick).

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
