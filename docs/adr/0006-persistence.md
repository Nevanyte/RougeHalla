# ADR 0006: PostgreSQL with fenced session leases and idempotent results

**Status:** Accepted. **Context:** legacy profiles live in one JSON file behind a single-writer process (mirrored to R2 as a
whole-file snapshot, last writer wins). Many hosts writing results would lose updates and double-credit retries.

**Decision.** `rh-persist` on PostgreSQL (RDS/Aurora in production; any Postgres 16 locally):
- `match_results (match_id, callsign)` primary key: a result is applied at most once; a retry returns `AlreadyApplied`.
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
