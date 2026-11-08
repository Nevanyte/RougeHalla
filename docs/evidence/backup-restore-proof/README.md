# R-PERSIST-2: local PostgreSQL backup and cold recovery

Completed 2026-11-08 in branch `codex/postgres-cold-restore`, based exactly on local `optimization_port`
`86f03cbdda15eca64585093d5c88fda2c42e4810`. The OPTimization_port lead confirmed this stable base and the exclusive new-file
scope before implementation; its newer native union was being composed separately. The integration branch later advanced to
`a894574f8f46938cafef7f4103877be58c602905`; this task retains the explicitly confirmed 86f03cbd base for lead integration. No production code, migration,
dependency, Cargo.lock, existing test, gameplay, protocol, Unity or shared status file changed. One worker, no subagents.
No AWS, spending, production data, DNS, login, merge or push was used.

This closes the specific missing local `pg_dump` → different cold cluster → `pg_restore` → authenticated application gap
identified in [account-durability](../account-durability/README.md). It does not close cloud durability or all R-PERSIST.
The [runnable recovery/rollback procedure](RECOVERY.md) documents backup consistency, required artifacts, external writer
fencing, data-loss limits and remaining cloud prerequisites. [Tool entry point](../../../tools/backup-restore-proof/README.md).

## Actual workload and boundary

The new ignored integration-test phase is invoked by the runner in separate OS processes. It constructs actual
AccountApi/public/control listeners, Director, PostgreSQL Store and ResultSpool, rather than the `rh-server` CLI entry
point. Four synthetic credentials come only from actual HTTP claims. Real operator session/admit APIs and authenticated
WebSocket Hello admit two adjacent-spawn pairs. Ordinary Attack inputs produce actual authoritative match results;
no credentials, currency, simulation state, combat outcome or pending record is installed by the harness.

The declared gameplay profile matches the bounded existing account integration proof: two humans per match, no fill,
regen, quests, consumables or broader gameplay content. Room wakes are 3 ms; authoritative simulation steps remain 50 ms / 20 Hz.
Each actual match produces one credited kill and 10 GV, with the existing below-three-human win-bonus gate preserved.
This is persistence-path coverage, not full-game parity or Unity/browser acceptance.

The first pair's two real results commit and their spool drains. The second pair's existing lease rows are held by an
independent `psql` transaction before combat inputs. Both second-match wire results arrive and both actual spool appends
finish their production fsync path; source metrics are **spooled 4, committed 2, pending 2, errors 0, full 0, dead 0**. Wire Result
alone is never treated as a durable acknowledgment. The process marker is written only after these checks.

The runner SIGKILLs only its source application child, verifies the source cluster again, then terminates exactly **two**
remaining old database backends while the external row locks remain held. It waits until only the locker remains, releases
that locker with ROLLBACK, verifies zero database sessions and reruns the full boundary comparison/reconciliation in a
separate phase. This establishes quiescence before the dump and spool copy. The custom-format archive and both original
spool files, private credentials/boundary receipts, source identity and producer counts form one checksum-manifested,
fsynced backup unit. The original PostgreSQL is then stopped and its port verified unavailable throughout positive restore.

## Independent cluster identity and durable settings

Final whole-flow receipt: [receipt.json](receipt.json). The third row is the separate saved-bundle recovery, whose
[receipt](saved-bundle-receipt.json) proves the documented retry command without rebuilding/reusing the source database.
All data paths below are relative to the private task directory
`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/postgres-cold-restore/`.

| Cluster | PostgreSQL system identifier | Loopback port | Separate data directory |
|---|---|---|---|
| Original | `7705918681422122132` |64303| `run-08/source/data` |
| Cold restored | `7705918684548414647` |64304| `run-08/target/data` |
| Saved-bundle retry | `7705919319429575539` |64681| `recovery-03/target/data` |

Each uses an independently created `initdb` data directory, not a copied original cluster. All listen only on 127.0.0.1,
with Unix sockets disabled. **fsync, synchronous_commit and full_page_writes are ON**, checked with `SHOW` in each cluster
and rechecked through application connection settings. The ordinary nondurable `tools/pgtest/start.sh` is unchanged and
unused. Different URLs alone are not accepted as proof: `pg_control_system().system_identifier`, actual data_directory,
server address, port, database and settings must match the expected identity before application construction.

## Positive verification

`pg_restore --exit-on-error --single-transaction --no-owner --no-privileges` restores into the independent empty target;
no migration or seed script runs over it. The original database is unavailable. The target verifier compares every full
row of profiles, leases, matches/results, ledger, monthly totals, purchases, schema compatibility, migrations and both
bot-learning tables, plus sequence values, to the private backup boundary. Full profile DTOs reopen with all four original
HTTP credentials before replay; missing, wrong and another owner's credentials each return 403.

The two actual pending records are then replayed by `Director::recover_spooled`, preserving their original profile IDs,
match/fence, complete result body, original metadata and `ended_at` time. All four profiles have one run and exact wire
balance, lifetime GV, kills and outcome-derived wins/draws/deaths. Monthly totals agree with lifetime values. The database
has four result rows, two matches and exactly two paid ledger rows totaling 20 GV. Reconciliation has no mismatch or monthly
gap; every committed result releases its lease.

Every one of the four exact genuine stored documents returns `AlreadyApplied` after cold recovery. Both original spool
records are requeued through the production append/recovery APIs; their bytes must equal the backed-up original files,
and they too return already applied. Complete recovered and duplicate snapshots are equal, including all statistics,
achievements, progress, ledger, results, metadata, timestamps, sequence values and leases. Their equal SHA-256 is
`10985eb77024651c11a6ecc6fe74723fec052632a3547c5269e5878a94831a3b`.
[Boundary row counts/checksums](boundary-checksums.json) retain the difference from the earlier two-result backup boundary.
The full rows and credentials remain private.

In the fresh full proof, existing Store APIs also prove that a competing writer cannot acquire either unexpired pending
restored lease before recovery,
a released lease advances its fence, and old renew/release cannot mutate the successor. An exact old duplicate remains
AlreadyApplied and cannot release that successor. One explicitly negative never-recorded key with the genuine body and
old fence returns `StaleFence` and leaves the full snapshot unchanged; it produces no progression. The successor's own
renew/release succeeds. These checks concern restored history, not exclusion of externally running pre-rollback writers. A saved-bundle retry can occur
after the original lease TTL: it records zero live-pending-lease exclusion probes and recovers without attempting a new
admission. The primary fresh proof requires both exclusion probes to execute; an expired lease cannot silently weaken it.

## Negative controls

| Deliberate fault | Required rejection |
|---|---|
| Reachable original URL with expected target identity | Rust phase exits nonzero with `CLUSTER_IDENTITY_MISMATCH` before Store/service construction; connection refusal is not counted. |
| Real archive truncated to 64 bytes, passed to actual pg_restore | Nonzero exit: `could not read from input file: end of file`; separate empty negative database, never used for positive verification. |
| Real archive bytes modified | Required bundle validator rejects `ARTIFACT_CHECKSUM_MISMATCH: database.dump`. |
| One required genuine pending spool removed | Required inventory rejects `REQUIRED_ARTIFACT_MISSING`; an empty spool cannot earn PASS. |
| Private authentication receipt removed | Required inventory rejects `REQUIRED_ARTIFACT_MISSING`; authentication verification cannot be skipped. |

These controls are required by the same runner that performs the positive restore. The unmodified bundle is validated
again immediately before the actual restore. [Bounded logs](bounded.txt) intentionally retain the expected failing guard
phase and truncated-archive error alongside successful boundary/verification phases.

## Measurements and checks

Native Apple M5 Pro / Darwin arm64 / macOS 26.6.1, PostgreSQL 16.15 Homebrew, rustc 1.97.0, Python 3.9.6; unoptimized test
profile, loopback, four tiny synthetic accounts, 21,529-byte archive. This is a measured local rehearsal, not a production
RTO commitment or throughput comparison. The primary target's cold-start + negative controls + restore + authenticated
verification took **0.555 s**; its earlier initial initdb/setup separately took 0.736 s. The independently repeated
saved-bundle command took **1.403 s including fresh initdb**, target startup, restore and authenticated verification.
Compilation is excluded from both recovery clocks; the tool builds/verifies its executable before starting the clock.
The target phase durations are recorded in bounded logs; they do not imply host capacity.

Commands, from this worktree after sourcing `final-env.sh` and overriding task-owned `CARGO_TARGET_DIR` and
`RH_PGTEST_STATE` as shown in the [procedure](RECOVERY.md):

```sh
python3 tools/backup-restore-proof/proof.py --state /absolute/private/new-proof-directory
python3 tools/backup-restore-proof/proof.py --restore-bundle /absolute/private/new-proof-directory/backup --state /absolute/private/new-recovery-directory
cargo clippy -p rh-server --features postgres --test account_backup_restore_flow --locked -- -D warnings
rustfmt --check --edition 2021 crates/rh-server/tests/account_backup_restore_flow.rs
uvx --from ruff==0.14.5 ruff check --select E,F,I,B,UP,SIM --line-length 120 --target-version py39 tools/backup-restore-proof/proof.py
uvx --from ruff==0.14.5 ruff format --check --line-length 120 tools/backup-restore-proof/proof.py
python3 -W error -m py_compile tools/backup-restore-proof/proof.py
```

Both recovery commands, strict Clippy, Rust formatting, strict selected Python lint rules, Python formatting and compile
checks pass. Ruff 0.14.5 was isolated by `uvx` outside the repository; no project dependency/lockfile was added. The runner
builds with `cargo test -p rh-server --features postgres --test account_backup_restore_flow --locked --no-run`, then executes
the one focused phase test: the source phase is intentionally SIGKILLed, the identity-negative phase intentionally fails,
and the boundary and target verification phases pass. Ordinary Cargo discovery ignores this phase with an explicit
runner-required reason; an ignored Cargo result is not proof. Existing unrelated suites were not rerun.

The source was tested as the new working-tree files over the exact base above; the receipt's `tested_head` therefore
names that base. Its separate test-source/orchestrator/executable SHA-256 binds the actual new implementation; production
sources are unchanged from that base. [SHA256SUMS](SHA256SUMS) binds the delivered source and public evidence. The final
clean commit identity is supplied in the lead handoff rather than embedding a self-referential commit hash in this file.
Archive SHA-256: `5fe02da80b92af478ccc4a40f4db75581f53fa09912f8559467400da2ab0c099`.
Manifest SHA-256: `22547771e0ef880d8b14194673672bc9053fea4193fc88a14544b58d46847835`.
[Artifact checksums](manifest-checksums.json) expose only checksums/filenames, not dump contents, full boundary rows or tokens.

## Findings, failures and limits

No production defect was found. The significant operational finding is that client death alone did not abort blocked
PostgreSQL backends; writer-session termination is an explicit additional boundary control, not an unassisted crash
recovery guarantee. Failed private attempts remain: run-01 caught PostgreSQL inet-to-text `/32` formatting in the harness
listener comparison (fixed with `host()`); run-02 caught the blocked-backend boundary issue; run-03 caught a harness-only
misnamed bot-learning snapshot table. run-04/05/06/07 and recovery-01/02 are earlier passing revisions; final code/measurements are run-08 and
recovery-03. No expected gameplay data or production behavior was changed to make a proof pass.

All task-created PostgreSQL processes are stopped. Dumps, tokens, original spool bytes, full snapshots, build receipts
and failed-attempt logs remain outside Git under the private task directory. [Recovery procedure](RECOVERY.md) requires
old writers to be stopped/fenced before an older database is restored, because restoring also rolls back fence/idempotency
history. No data loss occurs within the verified quiescent database+spool boundary; later/unspooled/in-memory results are
outside it. Cloud backup transport, off-host retention, host/volume loss, power loss, WAL/PITR, RDS/Aurora failover,
production role/privilege recovery, pool exhaustion and distributed writer fencing remain untested.
