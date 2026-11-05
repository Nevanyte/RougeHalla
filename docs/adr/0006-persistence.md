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
