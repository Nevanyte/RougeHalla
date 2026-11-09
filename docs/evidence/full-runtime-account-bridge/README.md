# Full Source runtime → owned accounts and durable results

This packet proves an actual HTTP-owned profile/hosted encoded-client/Source match/results/spool/PostgreSQL/profile/leaderboard chain. Production source is exact `a0c4818ce9df8ad0f4124db31e65ba1244bddc3b`. Final test/runner code is `7c8dd4eea94a1574a46cc77c79f609426c20942a`, on `codex/full-runtime-account-bridge`. Only the new server integration test, new runner/guard tests and this new evidence are added. No production seam, gameplay rule, ABI, migration, dependency, lockfile, existing test, C# or shared status change was needed.

## Reproduce the bounded proof

Source the pinned tool environment, then assign the Cargo target and private state. The state path must be new and outside **every** Git repository, worktree and Git metadata directory, including through symlinks. PostgreSQL must be installed locally; no existing cluster is reused.

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rh-full-account-target.XXXXXX")"
export CARGO_BUILD_JOBS=1 CARGO_INCREMENTAL=0
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export RH_BUILD=a0c4818ce9df8ad0f4124db31e65ba1244bddc3b
export RH_BUILD_REV="$RH_BUILD"
python3 tools/full-runtime-account-proof/proof.py \
  --pg-bin /opt/homebrew/opt/postgresql@16/bin \
  --state "/task-owned/private/root/new-full-account-run"
```

Use the displayed source build identity only when the production tree is still exact a0. The recorded final run uses the shared target under an exclusive project-lead loan, not the example's fresh target. The runner creates one disposable loopback cluster with a separate data directory and port, verifies its system identity and `fsync`, `synchronous_commit`, `full_page_writes` all ON, runs exactly the named ignored test, requires its successful receipt and genuine private replay, then stops the owned cluster. A test merely being skipped cannot produce PASS. It preserves failed setup/logs/data; it does not retry until an outcome is selected. Credentials, raw replays and PostgreSQL files stay outside Git.

The test is intentionally ignored in ordinary test discovery because it requires a fresh durable cluster; the existing pgtest launcher disables durability. The runner invokes it with `--ignored --exact http_owned_source_match_spool_profile_and_leaderboard_agree` and checks `1 passed; 0 failed; 0 ignored`.

## Authentic runtime and input path

The test calls the production `Settings` configuration for `--runtime source-arena --map maps/first-playable.json`. It preserves Source's default lifecycle rules, minPlayers 2, lobby 30 s and fill 5 s. Full abilities, all five factions plus FireRoam, PvE, initial loot, regen, consumables, quests/traders and terrain All remain installed. The unchanged admitted small map has the population limits documented in `maps/README.md`; this packet does not claim full-map population coverage.

The public HTTP API issues both credentials. Operator session/admit calls and encoded Hello establish actual owned durable seats. One client disconnects/resumes through the existing session route, retaining the same PostgreSQL principal and fence. Each client receives its own Plan and sends ordinary Plan/Ready. It derives a navigation goal from the **received Welcome** collision/region planes, then uses only currently delivered human actor positions to send Move, Stop and manual Attack. Every command goes through the production decoder, observer resolution, validation and Sim submission. No private position, forced phase, HP, kill, winner, currency, expected result or test-only gameplay rule enters the match. Secrets remain the server's real OS-generated secrets.

The room wakes every 3 ms of wall time, while each native step is exactly 50 ms. Every received snapshot asserts `server_time == tick * 50`. This is a real loopback TCP/HTTP/WebSocket and PostgreSQL run with an **accelerated native clock**. It is not 20 Hz physical-time, browser, WAN, cloud, or performance acceptance.

## Final recorded result

At exact final code `7c8dd4ee`, `attempt-004` passes one focused test in approximately 6.4 seconds, excluding compilation/cluster setup. Both wire results arrive at tick 362 (18.1 seconds on the source clock), with 13 seconds reported run duration. Alice's genuine native combat outcome is Won, one kill and 10 GV; Bob's is Died, zero kills and zero GV. Each client sent 22 ordinary Attack commands. The full private replay verifies all 2,029 hashes through Ended; that count includes the existing result linger, whose physical wait continues to advance the accelerated native clock.

The actual room reports append two fsynced spool records, commit both through the fenced store path and drain pending to zero. Authenticated profile runs, kills, wins/draws/deaths, GV and lifetime GV equal their actual wire results. The authenticated leaderboard names the actual greatest wire-GV owner; no assumption that a loser always earns zero is made. Reconciliation passes, and both committed result transactions release their leases.

Retrying the exact genuine stored result under its original match/profile/fence returns AlreadyApplied and leaves the complete owned profile unchanged. Submitting that same genuine result to a third HTTP-owned principal that never held a seat returns NoLease and leaves that profile unchanged. Missing/foreign profile credentials fail, an unreserved Hello fails, a fresh duplicate Hello cannot reuse a consumed admit, public/control listeners remain separate, and a leaderboard request with an invalid token receives no private owner rank. Reconstructing the service and pool against the same database preserves both original authenticated profile DTOs and leaderboard. This reconstruction is not a cold database restore or outage test.

Final cluster identity: `7706089559897707935`, loopback port `60869`, with all three durability settings ON. The exact data path and settings are recorded in `attempt-004/cluster-identity.json`. `CLEANUP.json` records all owned clusters stopped with pg_ctl status 3, closed ports and absent postmaster PID files. No AWS, production data, DNS, spending or login was used.

## Honest attempt history and review correction

| Attempt | Exact code | Recorded outcome |
| --- | --- | --- |
| 001 | `54c671d59f19205c6e05c871e3aba5fd40becf62` | FAIL retained verbatim. HTTP ownership/resume/Planning/Active and visible navigation worked, and native results eventually arrived. The sparse chase driver's reach condition never pressed Attack, so the required ordinary-combat assertion failed. Failed-test shutdown cancelled pending result tasks; this is not a durable bridge PASS. |
| 002 | `587969d3ac167afa1f422b08eb0771e0db63eb2b` | PASS after changing only the new client driver to hold an ordinary manual Attack while approaching a visible opponent. Native one-kill/positive-GV outcome, spool/store, ownership and replay checks passed. |
| 003 | `c8996a02c6eb171d8ba994dbf446b4254f06a41e` | PASS with direct outcome/statistics assertions and native result tick/duration recorded. Bob legitimately earned 6 GV in this separate run. Its receipt is retained independently, not relabeled as final source. |
| 004 | `7c8dd4eea94a1574a46cc77c79f609426c20942a` | Final PASS after fixing leaderboard-owner selection to compare actual wire totals and applying the reviewed private-state guard. |

Independent source review accepted the ordinary authority/results/replay chain and found that the initial runner's pathname check rejected only its own repository. The correction resolves symlinks, discovers actual Git membership from the nearest existing directory, scrubs ambient Git routing/ceiling variables, rejects worktrees/metadata/bare repositories, and sets umask 0077 before private creation. Eight cheap guard tests cover outside/missing-parent, this repository, another linked worktree, symlink, metadata, bare repository, ambient Git variables and private-write mode. They pass without PostgreSQL or gameplay. The corrected guard also rechecked all four actual retained attempt locations as outside Git.

All four retained state roots are mode 0700. Earlier files were not uniformly 0600; their actual modes are recorded, and protection relied on the 0700 root containment. Final-attempt top-level files are verified 0600 under the corrected umask. Raw private replays and credentials are excluded from this bundle; replay-audit files publish only their checksum, configuration, format/build and hash count.

## Standalone exact-a0 binary

The PostgreSQL-feature server was built while the checkout was clean at exact a0, before any new test/helper file was added, with both `RH_BUILD` and `RH_BUILD_REV` equal to the full a0 SHA. Existing runtime identity reads compile-time `RH_BUILD`; setting `RH_BUILD_REV` alone would not change it. A health-only launch independently reports the full a0 build ID, then exits cleanly with both ports closed. This launch is artifact attestation, not a second gameplay proof.

Retained artifact: `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/full-runtime-account-a0c4818c-2026-11-09/bin/rh-server-a0c4818c`.

Size 42,081,296 bytes. SHA-256 `cd802bd8bf4391ee3d8a24281dc0832dedb6c6c94db6d8dcbc9bf6c0729a20d5`. The retained a3d standalone is byte-checked unchanged. The binary stays outside Git for the next actual browser/full-runtime proof.

## Checks, evidence and limits

The focused integration test, scoped strict PostgreSQL-feature Clippy, Rust formatting and eight Python state-guard tests pass. `CHECKS.json` records exact commands and logs. No workspace, map-generator, Unity, browser or cloud campaign was run. SHA256SUMS covers every portable payload including MANIFEST.json; verify from this directory with `shasum -a 256 -c SHA256SUMS`.

Remaining limits: one configured small-map Source account/result bridge, cooperative ordinary public combat, local PostgreSQL and accelerated native timing. This does not establish every mechanic/population, real human playability, full-map match completion, matched browser/server physical-time acceptance, managed failover, host replacement or new backup/recovery guarantees. The earlier cold-restore packet remains separate. No discovered production defect required a source edit. Independent acceptance and main integration remain project-lead-owned.
