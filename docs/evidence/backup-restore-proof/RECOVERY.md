# Local recovery and rollback procedure

This executable rehearsal handles synthetic local proof bundles only. It does not authorize live data changes or cloud
operations. Keep the bundle and original client credentials private, outside Git; a PostgreSQL dump contains account
token hashes, and the proof's private authentication receipt also contains the disposable client tokens. Real client
credentials remain the clients' responsibility: database backup cannot reconstruct plaintext tokens from their hashes.

## Establish the boundary before backing up

1. Stop admission and all old application writers, including result workers, jobs and placement/account writers that
   share the database. Fence their database/network access and terminate outstanding transactions. **Killing a client
   process alone is insufficient:** a PostgreSQL backend waiting on a row lock can remain alive and commit after the lock
   is released. Verify the original cluster identity before any targeted termination. The local harness deliberately
   holds the second match's actual lease rows in an independent `psql` transaction, waits for two real spool append/fsync
   acknowledgments, SIGKILLs its application, terminates its remaining database backends while keeping those locks held,
   waits until only the locker remains, then rolls back the locker. This is a declared fault plus explicit writer fencing,
   not a claim that every application crash aborts its in-flight transaction unaided.
2. Verify zero remaining application sessions and a stable database/spool boundary. This proof compares all full account,
   lease, result, match, ledger, month, purchase, schema/migration and bot-learning rows plus sequence values before/after
   writer shutdown. It requires two committed results and two genuine pending records. Reconciliation must pass. Unfinished
   active matches and in-memory emitted-but-unspooled results have no recoverable completed result; never manufacture one.
3. With every producer still stopped, make a custom-format `pg_dump --format=custom --no-owner --no-privileges` of the
   application database. Copy the complete required spool directory, including dead letters for operator review, at that
   same quiescent boundary. The dump does not contain the filesystem spool. Preserve schema/build identity, the boundary
   receipt and the original credentials needed for this synthetic authentication verification. The runner checksum-manifests
   and fsyncs every backup artifact and directory; it validates the archive TOC. An independent safe copy is an operational
   prerequisite for actual host loss, not something this same-disk rehearsal proves.
4. Keep the original database unavailable. Confirm its `pg_ctl status` and loopback port are down. Do not let old writers
   resume against either endpoint while recovering or verifying.

## Execute the reproducible proof

From the task worktree, source the pinned environment and then override its shared paths:

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/postgres-cold-restore/target
export RH_PGTEST_STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/postgres-cold-restore/unused-pgtest-state
python3 tools/backup-restore-proof/proof.py --state /absolute/private/new-proof-directory
```

Replace `/absolute/private/new-proof-directory` with a new directory outside Git. The command performs the entire
boundary/backup/cold-restore procedure and negative controls. It exits nonzero on failure, keeps private logs and artifacts,
and stops only the clusters it created. The positive verifier cannot use the original cluster: that cluster is stopped,
and its independently checked identity differs from the identity required on the target application connection.

## Recover the saved bundle without rebuilding the source database

Set `RH_SAVED_BUNDLE` to the previous proof's private `backup` directory and choose a new private state directory:

```sh
export RH_SAVED_BUNDLE=/absolute/private/previous-proof-directory/backup
python3 tools/backup-restore-proof/proof.py \
  --restore-bundle "$RH_SAVED_BUNDLE" \
  --state /absolute/private/new-recovery-directory
```

This second command validates the required artifact inventory and every SHA-256 **before** creating a target cluster. It
refuses a reachable original database port or an original postmaster PID. It creates a fresh data directory and cluster,
verifies all durable settings and a new system identifier, restores with `pg_restore --exit-on-error --single-transaction`,
copies the validated spool bytes, and runs the application verification against that target only. No migration or seed
script runs over the restored database. The saved bundle itself remains unchanged. The command stops its target on exit.
It is deliberately scoped to the local proof; port/PID checks on this host are not a distributed old-writer fence.

The verifier first compares the full restored database with the backed-up boundary and reopens every profile with its
original HTTP-issued token. Missing, invalid and another owner's tokens must return 403. Only then does the normal
`Director::recover_spooled` replay the two actual pending records through the existing fenced store path. All four profiles
must have one run, exact wire GV/kills/outcome statistics, correct monthly/lifetime totals and a clean ledger reconciliation.
Each pending stored version, body, profile/match/fence and every original metadata field must match its genuine spool
record. Match `ended_at` must match the grouped maximum original `spooled_at_ms` within 0.01 ms, allowing timestamp
representation precision without requiring individual record times to be identical. Exact committed-result
retries and exact requeued spool bytes must leave the entire recovered snapshot unchanged. Lease API checks require an
unreleased restored lease to reject a competing writer, and a released lease to advance its fence; stale renew/release
and a stale-fence negative result must not alter the successor or award anything.

## Roll back or retry a failed recovery

Preserve the failure's private logs, dump, manifest and spool; leave the original stopped. Stop/fence the failed target
application and database writers before selecting an older bundle. Do not restore over the sole preserved source or try to
repair a missing artifact by inventing a result. Run `--restore-bundle` into another new private directory with a complete,
validated bundle and its matching build. A failed `pg_restore` has `--single-transaction` protection, but a new empty target
is still the rollback/retry unit. This procedure was actually rerun from a preserved bundle; see the measured receipt.

**Restoring an older database rolls back session lease fences and result idempotency history too.** A writer holding a
fence from the abandoned newer history can become dangerous after rollback; checking that numeric fences were monotonic
in the new database does not exclude it. All old writers must remain stopped/fenced externally until a single restored
writer is selected. Do not reconnect the former primary, start both histories, or let old applications target the restored
endpoint. Endpoint cutover, credential rotation, deployment/IAM/network fencing and reopening admissions are untested
operational/cloud gates here and are not executed by this task.

## Data-loss boundary and remaining limits

The verified recovery point is the quiescent backup boundary: both database-committed results plus the two included fsynced
pending records. There is no loss inside that verified boundary. Any subsequent account changes/results, in-memory output,
unspooled results or omitted/lost spool volume lie outside it. The maximum time loss is the age of the chosen backup plus
any uncaptured producer interval; this rehearsal establishes no scheduled backup frequency, continuous WAL archiving or
PITR target. A logical dump's database snapshot alone does not make an independently changing spool consistent.

Recover pending records before allowing fresh admissions. A different writer can take an expired restored lease and make
an old pending result stale; never bypass the fence to force it through. The fresh full proof keeps the normal 120-second TTL and requires both competing-writer exclusions while those
leases are live. A saved-bundle retry after expiry skips admission probes, records their count as zero, and recovers
pending records first; it still checks successor fences and exact duplicate protection. It never renews or reacquires an
old lease merely to force a pending result through. Pending credit uses its commit-time UTC month, while recovered match `ended_at`
retains its original result time; a month-boundary recovery can therefore credit a later month by existing contract.

Durable PostgreSQL flags, fsynced local spool, SIGKILL and clean database stop/start do not certify physical power-loss,
storage-controller or filesystem failure behavior. This is logical database recovery into a different local cluster,
with artifacts retained on the same machine. Off-host backup transport/encryption/retention, cloud host/volume loss,
RDS/Aurora restore/failover, WAL/PITR, managed identities, pool exhaustion, fleet writers, cloud costs and production
RTO/RPO remain untested. No full R-PERSIST or cloud release readiness is inferred.
