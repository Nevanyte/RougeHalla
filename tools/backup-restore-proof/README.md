# Local PostgreSQL cold-restore proof

Run from this worktree with a non-root user. Python 3.9+, the pinned Rust toolchain and PostgreSQL16 tools are required.
The runner uses Python's standard library; Ruff is only an optional development check. No project dependency changes.

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/postgres-cold-restore/target
export RH_PGTEST_STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/postgres-cold-restore/unused-pgtest-state
python3 tools/backup-restore-proof/proof.py
```

The last command chooses a new private temporary directory and prints its path. For a stable receipt location, add
`--state /absolute/private/new-directory`; the directory must not already exist and must be outside the repository.
All dumps, account credentials, complete boundary rows and raw logs remain there, under umask077. The runner never invokes
`tools/pgtest/start.sh`. Its own loopback clusters use `fsync=on`, `synchronous_commit=on`, `full_page_writes=on`, independently
checked with `SHOW` and application connection settings. Separate ports, data paths and `pg_control_system()` identifiers
are checked. The recovered application requires the expected target identity before constructing its Store or service.

The command builds the focused integration test with `--locked`, starts two disposable clusters, drives HTTP-issued
accounts through two actual hosted combat matches, makes a genuine custom-format `pg_dump`, stops the original database,
cold-starts the second cluster, restores with `pg_restore --exit-on-error --single-transaction`, and reconstructs the
application in a separate process. A successful run prints `PASS` only after authenticated account, complete database
boundary, genuine pending spool replay, duplicate protection, reconciliation and fence checks pass. Negative controls
must also reject a reachable original-cluster connection, truncated archive, checksum corruption, missing pending spool
and missing authentication receipt. The deliberately ignored Rust phase is an internal entry point: running ordinary
`cargo test` alone does not execute or certify this proof.

Both task-owned clusters stop in `finally`; private data/logs are retained on success and failure. The runner kills only
its own child application process and explicitly fences that application's database backends on its own verified source
cluster before releasing its external lease-row lock. It never enumerates or stops another worker's database cluster.
No AWS, production data, deployment, DNS, login, merge or push is involved.

See [recovery/rollback procedure](../../docs/evidence/backup-restore-proof/RECOVERY.md) and
[measured evidence and limits](../../docs/evidence/backup-restore-proof/README.md).
