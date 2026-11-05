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

**Evidence.** 20 tests against a real local PostgreSQL 16 (duplicates, concurrent writers, stale fences, a connection
killed mid-transaction, double-spend, import/reconcile): `crates/rh-persist/tests/`. Not yet tested: Aurora failover,
connection-pool exhaustion under load, achievements (not ported).


## Addendum: durable-data lock-in (L-durable)

No production database exists yet (persistence is proven only against local and test PostgreSQL), so `0001_init.sql` was
**rewritten in place** rather than followed by a migration. sqlx checksums only matter for databases that already applied the
old text, and only throwaway test databases did. From the first real deployment on, every schema change is a new migration.

- **Identity.** A profile is its surrogate `profile_id` (bigint identity). The callsign is a unique (`lower(callsign)`),
  renamable display attribute. Every child table (`gv_by_month`, `gv_ledger`, `session_leases`, `match_results`,
  `purchases`) references `profile_id`, so a moderation rename, a legacy case-collision fix or an erasure touches one row and
  never the append-only ledger. `Store` and the director still take a callsign at the edge and resolve it once per call.
- **Match record.** `match_results.result` holds the complete `RunResult` fields plus faction and weapon, camelCase, with a
  `"v":1` key. A small `matches` row (match id, owner, region, placement id, build, content hash, ended_at, humans, bots,
  replay_ref) is inserted idempotently (`ON CONFLICT DO NOTHING`) in the result transaction. `region`, `placement_id` and
  `replay_ref` stay NULL until P-HOST-1 and the replay store (P-OPS-6) report them.
- **Tolerant blobs and the compat floor.** `stats`, `progress` and `cosmetics` decode with defaults and keep unknown keys
  through a read-modify-write (a flattened catch-all), so an older binary never erases a newer binary's field during a rolling
  deploy. The old rule "any newer migration blocks older binaries" is replaced by `schema_compat.min_binary`: a binary whose
  newest embedded migration is below it refuses to start (`rh-server` exits 78 with the message). Additive migrations leave it
  alone (expand/contract); only a migration that old binaries cannot survive raises it.
- **Replays and checkpoints** name their build (`BUILD_ID`, the `RH_BUILD` environment variable at compile time) and the
  match; checkpoints also carry `content_hash` and `Sim::restore` refuses other content (`CheckpointError::ContentMismatch`).
  Policy: a replay or checkpoint is verified by the build that recorded it, never across builds; releases keep their commit
  buildable. Format tags are unchanged: the new keys are additive and older files without them still verify (with a warning).
- **Durable ids** (faction, weapon, cosmetic and achievement strings, outcome and win-bonus spellings) are append only;
  `crates/rh-server/tests/durable_ids.rs` pins them.
- **Topology.** There is exactly one global writable primary (for example Aurora Global Database with one writer region).
  Profiles are not region-homed, and leases and fences depend on that: per-region primaries would break fencing. A cross-region
  result transaction holds the profile row lock for a few seconds at worst; collapsing it into fewer round trips is
  P-PERSIST-4. P-HOST-1 passes the GameLift compute or instance id as `--instance-id` so lease owners are meaningful.
