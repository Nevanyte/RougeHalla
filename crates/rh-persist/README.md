# rh-persist

Durable profile store for the Rust server, on PostgreSQL. It replaces the legacy single-file `ProfileStore` (one
JSON file, one writer, mirrored to R2 as a last-writer-wins snapshot) so many match hosts can write independently.

## Schema (v1, `migrations/0001_init.sql`)

`profiles` (`profile_id` identity PK; `callsign` a unique-by-`lower()` display name that may be renamed; `token_sha256`
only; `gv >= 0`; JSON stats, cosmetics, achievements, progress) - `gv_by_month` - `gv_ledger` (append-only,
trigger-enforced) - `matches` (one row per match; `ended_at` is the time of the latest recorded result: owner, region, placement, build, content hash, humans, bots, replay ref) -
`match_results` (PK `(match_id, profile_id)`: the idempotency key; `result` is the versioned full record) -
`session_leases` (`profile_id` PK, owner, **fence**, expiry; rows are never deleted so a fence is never reused) -
`purchases` (idempotency keys of the shop) - `schema_compat` (one row: `min_binary`). Every child table references
`profile_id`. The callsign is resolved once, at admission (`acquire_lease` returns the id); a live match then records, renews and
releases by id (`*_by_id`), so a rename mid-match is safe. The callsign forms resolve per call, for edge and admin callers.

The live server additionally binds the ID to successful token verification, before admission waits. Its live-only
acquisition/renewal paths use bounded transactions/nonblocking row locks, captured match/fence and unexpired rows.
Director defaults are TTL 120 s / renew 30 s / database budget 5 s (TTL maximum one hour); room deadlines prevent
expired gameplay and cancellation cleanup retires abandoned reservations/leases. These guarantees are independently
tested against PostgreSQL and documented in [ADR 0006](../../docs/adr/0006-persistence.md). Edge/admin renewal APIs keep
their existing semantics; live results/releases never infer an old principal from a reassigned display name.

The initial migration was rewritten in place before any production database existed. After the first deployment, never
edit an applied migration.

## Durable data rules

- **Ids are append only.** Faction, weapon, cosmetic and achievement id strings (and the `outcome` / `winBonusWhy`
  spellings) are keys and values in stored JSON. Add, never rename or reuse; `rh-server/tests/durable_ids.rs` and `rh-persist/tests/ids.rs` pin them (both in the default test run).
- **Blobs are tolerant.** `Stats`, `Progress` and `Cosmetics` have `#[serde(default)]` and a flattened `rest` map: a new field
  needs a default, and unknown keys survive a write-back by an older binary. Never change the meaning of an existing key.
- **Expand/contract.** An additive migration (new table, new nullable or defaulted column) does not touch
  `schema_compat.min_binary`; old binaries keep running while the fleet updates. A migration old binaries cannot survive
  (drop or retype a column, change a meaning) first ships the tolerant code in a release, and only the later migration that
  removes the old shape sets `UPDATE schema_compat SET min_binary = <that migration's version>`. A binary whose newest
  migration is below `min_binary` refuses to start.
- **One writable primary.** Leases and fences assume exactly one global writer (ADR 0006).

## Guarantees (each has a test in `tests/`)

- One live match per profile across hosts (`acquire_lease`); a takeover after expiry increments the fence.
- `record_result` is one transaction: lock the lease row, `AlreadyApplied` if committed before (even after the
  fence moved on), `StaleFence` if the fence is not the lease's (nothing changes), else stats + GV + month +
  ledger + result row + lease release together. Crash before COMMIT applies nothing; a retry applies once.
- `gv` only changes with a ledger row: `rh-persist-admin reconcile` proves `gv == sum(ledger)` per profile.
- `purchase` is idempotent by `purchase_id`, debits under the profile row lock with `gv >= price`, never touches
  `gv_lifetime` or `gv_by_month`.
- The binary refuses a database whose `schema_compat.min_binary` is above its own version (`Store::connect`, `migrate`); a database with only additive newer migrations is accepted.
- Achievement ids and cosmetic rewards are evaluated and granted in the same fenced result transaction. The catalog,
  thresholds and unlock order match 83 observations of the real legacy evaluator, including withheld wins and previously
  unlocked ids. Retrying a result cannot award twice; a crash before commit rolls back rewards with the payout.
  Recheck the legacy rules with `node --import tsx tools/persist-fixtures/achievements.ts --check`.
- `cosmetics` exposes the 57-entry legacy catalog, server-owned prices and slot-checked look words. The 301 captured
  observations reject unowned, unknown and mismatched entries and cover combined golden variants. Recheck with
  `node --import tsx tools/persist-fixtures/cosmetics.ts --check`. This is profile/API support; publishing equipped looks
  in live snapshots and Unity is still pending.

## Account service reads

`account.rs` adds the leaderboard rows (equipped title included), the owner's rank (`row_number()` over the same ordering as
the listing, `gv DESC, callsign COLLATE "C"`), the month list, `ping`, `Error::is_unavailable` and `Store::gv_epoch` (bumped
after COMMIT by every result that credits GV; leaderboard caches compare it). Token hashes are compared with `ct_eq`.
The HTTP routes are in `rh-server` (`api.rs`, ADR 0006 addendum).

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
