# Current protocol14 local PostgreSQL cold restore

**PASS: one actual cold backup/restore proof at exact a3d4b3ce575442c9a06916888035ca849a6cd05a**, compiled with
RH_BUILD set to that full immutable SHA. Runtime identity is protocol14/checkpoint28/replay22/observation21/policy15,
content643d294869db55a4. This is the existing bounded R-PERSIST-2 manual scenario, now executed on the current code;
it does not certify the remaining full-game, heap, browser, cloud or hosted release gates.

The test/source tool and all production/migrations/dependencies/identities/status/tapes remain unchanged. The old cold
proof and all previous raw receipts remain intact. Only this new revision-scoped evidence directory is committed on
`codex/postgres-cold-restore-a3d4b3ce`, based on a3d. No main merge/push or extra worker was used.

## Exact command and execution

From the clean reusable `return-cleanup-2026-11-08/wrapup-final-native/repo` worktree, checked out detached at a3d before
building/running:

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-target
export RH_PGTEST_STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/cold-restore-a3d4b3ce-2026-11-09/unused-pgtest-state
export CARGO_BUILD_JOBS=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export RH_BUILD=a3d4b3ce575442c9a06916888035ca849a6cd05a
unset DATABASE_URL
cargo build --locked -p rh-server --features postgres --bin rh-server
python3 -u tools/backup-restore-proof/proof.py --state /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/cold-restore-a3d4b3ce-2026-11-09/private-run
```

Both commands exited0. Source pinned environment first, then assign all task state/target settings. The runner builds
only the focused `account_backup_restore_flow` integration executable using `--features postgres --locked --no-run`.
It invokes `--ignored --exact cold_backup_restore_phase --nocapture` in separate OS processes for the source, boundary,
negative identity guard and target verification phases. The source process instantiates the production HTTP/control
routers, Director, ResultSpool and Store, and runs genuine hosted matches; target verification reconstructs those
services in a new process against the restored target only. This is actual application/process/database recovery,
not only a pool restart or an old receipt read. It does not execute the standalone CLI main inside the cold scenario.

Root exclusively lent final-target for this packet. No other cargo/rustc was active at entry. The cache was released
immediately after proof completion, binary retention and cleanup checks; do not reuse it without a new exclusive lease.
For future reproduction, choose an authorized target and a NEW private state directory. No broad suite, full-game/heap
opt-in, source/map capture, Docker, Editor, browser or cloud campaign was run.

No protocol13-only validator was found or relaxed: the ignored phase uses the current compiled PROTOCOL_VERSION. The
unchanged raw runner's `base_sha:86f03cbd...` is its original implementation provenance, not this execution's base.
[Current revision receipt](current-revision.json) and raw `tested_head` explicitly bind this run to a3d. The raw receipt
is preserved unedited rather than silently repinned. No simulation checkpoint file is restored in this database proof;
checkpoint28 identifies the compiled current runtime, not a claimed checkpoint-file recovery test.

## Durable independent clusters and boundary

Native Apple M5 Pro/arm64, macOS26.6.1, Rust/Cargo1.97.0, Homebrew PostgreSQL16.15. No existing/real database or profile
was used. Both disposable databases are `rh_backup`, independently initialized with separate task-owned data directories,
ports and pg_control_system identifiers:

| cluster | system identifier | loopback port | data directory |
|---|---|---:|---|
| source |7706054284319083982|62337|`private-run/source/data` under the private task directory above|
| cold target |7706054287388188185|62338|`private-run/target/data` under the same private task directory|

**fsync=on, synchronous_commit=on and full_page_writes=on** were explicitly supplied and independently checked through
SHOW and application identity SQL on each cluster. The nondurable pgtest launcher was never run. The target was stopped
after fresh independent initialization, then cold-started for recovery. It contained no application tables before restore.

The actual public HTTP API issued four synthetic profile credentials. Ordinary admitted players fought two authoritative
hosted matches with actual Attack inputs, wire Result production and the normal fsynced spool path. The first match
committed two results; an independent transaction held the second match's two genuine lease rows until its two real
pending records were fsynced. No credential/currency/death/result was seeded or installed.

The source application was SIGKILLed. Its verified source-cluster backends were terminated while the external lease
locks remained held, preventing a blocked old writer from committing after lock release. Only then were the locks rolled
back. Full boundary comparison and zero other database sessions established quiescence before pg_dump. Original
application and database processes were unavailable during every positive restore/verification step. Data directories
remain private for review; no physical data erasure or power-loss failure is claimed.

The real custom-format pg_dump archive is21,546 bytes, SHA-256
**74fd00f7fa03f8ea2bd31a6ca0eb49743c1aefcd841f0fbac349169a41e5682f**.
Its checksum manifest includes the dump, matching private authentication/boundary receipts and both genuine pending
spool records; every file/directory was fsynced. Target pg_restore uses --exit-on-error --single-transaction and no
migration/seed operation runs over the restored database before verification. Dump/spool bytes, plaintext credentials
and complete account/database rows remain0700/0600 outside Git. Only checksums and credential-free evidence are published.

## Verified recovery and negative controls

- Full restored rows and sequence values equal the backup boundary before target application construction: profiles,
  leases, matches/results, ledger, month totals, purchases, compatibility/migrations and bot-learning tables. Hashes and
  row counts are in [boundary-checksums.json](boundary-checksums.json); raw private rows are withheld.
- All original HTTP-issued credentials reopen the byte-equal boundary profile DTOs. Missing, wrong and another owner's
  tokens fail403. The verifier's private authentication receipt supplies the original synthetic client tokens; database
  recovery preserves their hashes and does not reconstruct plaintext credentials from the database.
- Both restored pending leases reject competing acquisition while still live (the required count is2, not a skipped
  expired-lease mode). Normal recover_spooled replays the two actual records with complete result/metadata/fence/original
  time comparison. All four genuine profiles then have one run and exact genuine wire balances/statistics; total GV20,
  four committed results, two paid ledger rows and reconciliation are correct. Both pending records recover with no
  spool/dead-letter error.
- Five exact direct-store retries and two requeued exact genuine spool bytes change no balance/statistics/result/ledger/
  metadata/lease/sequence snapshot. Released-fence successor acquisition and stale renew/release/result tests preserve
  the successor and award no additional progression. No fabricated positive outcome is installed.

| negative control | required/observed reason |
|---|---|
| Reachable original URL paired with target identity, before source shutdown | CLUSTER_IDENTITY_MISMATCH; fails before Store/application construction |
| Actual truncated archive passed to pg_restore | nonzero; could not read input/end of file |
| Corrupt archive bytes against checksum manifest | ARTIFACT_CHECKSUM_MISMATCH |
| Missing required pending spool record | REQUIRED_ARTIFACT_MISSING |
| Missing original authentication receipt | REQUIRED_ARTIFACT_MISSING |

The positive application receives only the target URL and expected target identity. Original pg_ctl status/port checks
also remain down throughout positive recovery. An identity-negative test is deliberately nonzero and the original source
process deliberately exits by SIGKILL; these expected controls are retained in raw logs and are not relabelled test failures.

## Recovery time, rollback and limits

Measured recovery **0.444 seconds**, including cold target start, negative controls, pg_restore, pending replay and
application verification. Initial target initdb/database creation is measured separately at0.667 seconds. Build, source
workload, backup creation and off-host transfer are outside that recovery timer. This is one tiny same-host21KB logical
archive on M5/APFS/PostgreSQL16.15, not a production RTO measurement.

The verified data-loss boundary includes the two database-committed results and the two captured fsynced pending
records: no loss inside that boundary. Later writes, unfinished matches, in-memory/unspooled output or missing/lost spool
volumes are outside it. There is no backup schedule/WAL/PITR target or production RPO established here.

The existing [recovery/rollback procedure](../RECOVERY.md) remains applicable to this unchanged runner. Stop/fence all old
writers **before restoring an older database**: rollback also rolls back lease fences and idempotency history, so a writer
from abandoned newer history must not reconnect to either endpoint. Preserve the private complete bundle, keep the source
stopped, and select a NEW empty target/state directory for retry. The runner's `--restore-bundle PRIVATE_BACKUP --state
NEW_PRIVATE_STATE` validates all required artifacts and refuses a reachable old source; it recovers pending results before
new admissions. This new packet did not run an additional saved-bundle rollback rehearsal; the earlier receipt retains
its historical scope. Never restore over the sole preserved copy or manufacture an omitted pending result.

No power-loss/storage-controller test, independent off-host backup, encryption/retention transport, managed database,
cloud volume/host loss, distributed/fleet fencing, AWS spend, real data, DNS or login was involved. No complete R-PERSIST,
full-game, heap, cloud or release certification follows from this local gate.

## Portable evidence, cleanup and standalone artifact

[MANIFEST.json](MANIFEST.json) and [SHA256SUMS](SHA256SUMS) seal this new directory. Seventeen complete unmodified raw logs
are tracked as .txt, with original paths/digests in [log-manifest.json](log-manifest.json). The initial Git whitespace check
flagged final blank lines in five raw logs. A directory-local .gitattributes disables only blank-at-EOF checks for these
raw logs, preserving their complete original bytes; other whitespace checks remain enabled. All portable payloads were scanned
against the four synthetic HTTP credential values; none is present. Actual private dumps/authentication rows/spool files
are never committed. Existing old-proof payloads remain unchanged.

[Cleanup](cleanup.json) verifies both task-owned pg_ctl status exits3, absent postmaster.pid files, closed exact source/
target loopback ports and no remaining application-phase process. No arbitrary process, cluster or cache was killed or
removed. All private proof artifacts are retained for review; final-target was released to Root after cleanup.

[Binary receipt](binary-receipt.json) records the actual cold-phase executable/argv/hash and a distinct matching standalone
postgres-feature native arm64 debug server retained for Root's later Web proof:

`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/cold-restore-a3d4b3ce-2026-11-09/bin/rh-server-a3d4b3ce`

Standalone bytes41,799,488; SHA-256 **0b08727ba9cc7a5850e10f09e0737042937b865ee47dd29f1afc67abbbc242eb**.
Its full immutable RH_BUILD stamp is present. It was built and retained, **not launched** by the cold runner; no CLI launch
arguments or Web acceptance are invented. The production-router integration phase is the application actually exercised.
