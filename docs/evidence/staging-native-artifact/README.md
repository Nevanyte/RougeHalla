# Code-only Linux native component workflow

Exact base: `6a251045a05e3abd2ed63eb2df4d080930a22a64`.
Code commit: `e733dbe1c9ed297131a57d8b67718f5c856c445d`.
Branch: `codex/staging-native-artifact`, in the same owned-seat-checkpoint worktree.

This packet creates six files only: the manual workflow and five files under `tools/staging-native-artifact`. Existing workflows, Cargo/source/dependencies, shared status, deployment and prior workers' files are unchanged. The earlier expiry branch remains at `f640dbf17bb8f4a7252d021bdb2707f742f8175e`. This evidence directory is additive. Root owns review/integration/dispatch; this worker made no merge or push.

The complete implementation/operating contract and unresolved assumptions are in [the tool README](../../../tools/staging-native-artifact/README.md). The workflow isolates the reviewed harness from the exact selected source, validates full-SHA canonical ancestry before source checkout, builds only the explicit locked postgres release server, and collects real protocol/content from bounded loopback `/info` on fresh CI-only PostgreSQL. Zero rooms/players/results and zero account/lease/ledger/result rows are required, including a post-shutdown database check. No expected metadata receipt is loaded. No claims, accounts, Hello or rooms are produced.

Packaging is strict: exactly regular `bin/rh-server` and canonical `component.json`, deterministic USTAR metadata, bounded ELF/schema/hash checks, no symlinks/traversal/extras, no directory/glob upload. Only that tar is retained in GitHub Actions; no logs, PostgreSQL files, credentials, Cargo state or unrelated workspace files are included. Mandatory `deployable:false` distinguishes this x86_64 component from the final host bundle/ARM64/client/installer/durability/deployment gates.

## Finite local checks

The first **13/13 tests PASS** ([first-offline.txt](first-offline.txt)). Review added post-shutdown zero-row validation and two producer-boundary tests; final **15/15 PASS** ([final-offline.txt](final-offline.txt)). All four Python files passed AST parsing and staged whitespace checks passed. Tests use explicitly synthetic ELF/HTTP/DB/toolchain data, real private temporary file/archive operations and private synthetic Git repositories. Injected probe tests assert only the three allowed GETs, observed values reaching validation, cleanup on refusal, and stop-before-final-DB-check ordering. No native code or database was executed.

Workflow checks used already cached PyYAML (no installation) to parse YAML, require only manual dispatch/read-only contents/no persisted credentials/no `secrets.` references, and feed all three shell payloads to `bash -n`. These passed. This is local syntax/policy checking, not a GitHub workflow run or full Actions semantic validation. `verify.sh` itself passed `bash -n`.

Exact pinned local environment and offline reproduction:

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/staging-native-artifact-state/cargo-target-not-created
export RH_PGTEST_STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/staging-native-artifact-state/pg-not-created
export PYTHONDONTWRITEBYTECODE=1
bash -n docs/evidence/staging-native-artifact/verify.sh
bash docs/evidence/staging-native-artifact/verify.sh
test ! -e "$CARGO_TARGET_DIR"
test ! -e "$RH_PGTEST_STATE"
shasum -a 256 -c docs/evidence/staging-native-artifact/SHA256SUMS
```

No local Rust build, PG/native process, workflow dispatch, host provisioning, cloud operation, new worktree or Cargo cache occurred. Private synthetic Git/temp resources were cleaned by their tests. Documentation browsing was limited to primary GitHub Actions sources. `source-audit.json` records exact code scope, preserved refs, checks and pending gates. `SHA256SUMS` covers the six code files and evidence payloads except itself; the handoff gives the evidence commit ID to avoid self-reference.

## Actual build remains unresolved and unclaimed

Root must review the source, establish workflow dispatchability on the repository/default branch, select a reachable full commit and authorize the first actual job. Hosted runner image/disk/time, installed rustup/psql/Python/git, exact source toolchain/locked dependency downloads, PostgreSQL16 loopback service startup, release compile/link/ELF, actual readiness/zero data and clean shutdown are all untested. No package, database, credential or target fallback exists. `ubuntu-24.04` and `postgres:16` tags can change; actual versions are captured, but immutable OS/container provenance is not claimed. Actions are pinned to verified official commits. GNU libc/loader and x86_64 compatibility on a future host still need separate verification.

No component archive, binary SHA, actual protocol/content receipt, performance result, capacity claim, actual-host gate or cloud recovery proof has been produced by this packet. The tests' synthetic values are not promoted to artifacts. Unity/map/profile validation, final bundle, trusted installer/PG/age/TLS and independent offhost restore remain separate. GitHub artifact storage is distinct from AWS/public upload; no AWS credentials/resources/spending or DNS/data changes were used here.

Primary sources reviewed: [manual dispatch event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch), [checkout v4.2.2 commit](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683), [upload-artifact pinned commit](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02), [checkout inputs](https://raw.githubusercontent.com/actions/checkout/v4/action.yml), [artifact inputs](https://raw.githubusercontent.com/actions/upload-artifact/v4/action.yml). Manual-dispatch registration/default-branch requirements, checkout credentials/history/ref behavior and exact-path artifact retention informed the workflow; Root must validate the actual repository run.
