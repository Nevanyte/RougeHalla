# rh-persist: local rules

PostgreSQL 16 (ADR 0006, CONTRACTS C-PERSIST): profiles keyed by surrogate `profile_id`, fenced session leases,
idempotent match results, achievements, cosmetics. `rh-persist-admin` is its CLI. Details: [README.md](README.md).

## Invariants

- Migrations in `migrations/` move forward: a merged migration stays byte-identical; changes are a new numbered file.
  Every migration packet goes to `implementer-opus` and needs the owner's approval before merge.
- Queries are sqlx with bound parameters.
- Credentials come from the caller (`DATABASE_URL`, `--url`, the server's `--database-url`), never from code, tests or
  fixtures.
- Leases are safe under concurrency (transactions, row locks, fences); a change to lease logic adds a racing test like the
  ones in `tests/results.rs`.
- Results are idempotent: a duplicate report returns the same outcome and gives its lease back.

## Tests

`eval "$(tools/pgtest/start.sh)"` starts a throwaway cluster and exports `DATABASE_URL`
(`PGBIN=/opt/homebrew/opt/postgresql@16/bin` on macOS). Without it, `RH_SKIP_PG_TESTS=1` skips the suites explicitly.
