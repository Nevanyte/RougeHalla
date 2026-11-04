# rh-persist

Durable profile store for the Rust server, on PostgreSQL. It replaces the legacy single-file `ProfileStore` (one
JSON file, one writer, mirrored to R2 as a last-writer-wins snapshot) so many match hosts can write independently.

## Schema (v1, `migrations/0001_init.sql`)

`profiles` (callsign PK, case-insensitive unique via `lower(callsign)`; `token_sha256` only; `gv >= 0`; JSON stats,
cosmetics, achievements, progress) - `gv_by_month` - `gv_ledger` (append-only, trigger-enforced) - `match_results`
(PK `(match_id, callsign)`: the idempotency key) - `session_leases` (callsign PK, owner, **fence**, expiry; rows are
never deleted so a fence is never reused) - `purchases` (idempotency keys of the shop).

## Guarantees (each has a test in `tests/`)

- One live match per profile across hosts (`acquire_lease`); a takeover after expiry increments the fence.
- `record_result` is one transaction: lock the lease row, `AlreadyApplied` if committed before (even after the
  fence moved on), `StaleFence` if the fence is not the lease's (nothing changes), else stats + GV + month +
  ledger + result row + lease release together. Crash before COMMIT applies nothing; a retry applies once.
- `gv` only changes with a ledger row: `rh-persist-admin reconcile` proves `gv == sum(ledger)` per profile.
- `purchase` is idempotent by `purchase_id`, debits under the profile row lock with `gv >= price`, never touches
  `gv_lifetime` or `gv_by_month`.
- The binary refuses a database whose schema is newer than it knows (`Store::connect`, `migrate`).
- Achievements are NOT ported (`achievements_pending`): the counters they read are kept as the legacy `recordRun` keeps them.

## Admin tool

```
rh-persist-admin migrate --url URL
rh-persist-admin import-legacy --file profiles.json [--dry-run] --url URL   # one transaction; exit 2 on conflicts
rh-persist-admin reconcile --url URL                                        # exit 1 on any mismatch
rh-persist-admin export-legacy --out file.json --url URL
```

Import hashes tokens and writes one opening ledger row per profile; re-running skips identical profiles and reports
different ones as conflicts (never overwrites). Export cannot recover tokens (only hashes exist): rolling back to the
legacy server needs the ORIGINAL profiles file kept as the backup.

## Running the tests (real PostgreSQL required)

```
eval "$(tools/pgtest/start.sh)"      # throwaway cluster, free port; as root it runs as the OS user `pgtest`
cargo test -p rh-persist
tools/pgtest/stop.sh
```

Each test creates and drops its own `rh_test_<random>` database, so they run in parallel. Without `DATABASE_URL`
the tests FAIL (set `RH_SKIP_PG_TESTS=1` to skip deliberately).

CI (GitHub Actions): `services: postgres: { image: postgres:16, env: { POSTGRES_PASSWORD: pw }, ports: ["5432:5432"] }`
and `DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres`.
