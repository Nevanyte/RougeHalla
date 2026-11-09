# Explicit native preparation refreeze at 76d

Code commit: `098b448a8bf40809798e21eed2bd41400b4061c1`.
Exact branch base and new native candidate: `76d170a16158a9709178a741f12bd4abb357201f`.
Previous native candidate: `a0c4818ce9df8ad0f4124db31e65ba1244bddc3b`.
Branch: `codex/staging-preparation-ci76d`, in the existing owned-seat-checkpoint worktree.

The lead reported normal CI run **42680383918** failing the actual-source pin assertion at 76d. That remote run was neither fetched nor rerun here. Before changing any source, the same assertion was run once locally at exact 76d: exit 1, one expected failure, actual runtime SHA `e90c5037ce04ba35d83da65e8b4030a070015ad3de3745d2ca27f3aa77df7e8f` versus historical `a3d52a5595b4e2c489784aa8e4e8bcc8a7b1f3c7cfca6685bb20a7bedaa6d7bf`. [original-red.txt](original-red.txt) preserves that first failure. All five historical hashes match a0c blobs; the failure was legitimate source drift.

The full reviewed delta is [native-source.diff](native-source.diff): seven insertions in four files, all from the WalkHint change. `runtime.rs` enables `walk_hints: Some(true)` and asserts it for both Source and Training. `main.rs` adds `walk_hints: None` to its fallback. `director.rs` and two `room.rs` test configurations add `walk_hints: None`. `lib.rs` is unchanged. [source-audit.json](source-audit.json) records exact old/new/checkout SHA256 values for all five files and the reviewed native commit.

The lead accepted an explicit refreeze after reviewing that complete delta. BASE, the five-file native manifest, blank plan and root README now identify 76d consistently; the launcher comment no longer names a0. The candidate names native source, not the current full repository HEAD and not an artifact receipt. Later unrelated commits can pass while the pinned native bytes remain identical. Any later change in those five native files still fails the gate until separately reviewed.

Historical-snapshot validation was rejected for this repair: checking only a0c bytes would lose the gate against current native deployment-source drift. Fetching old Git objects would also break the offline/shallow-checkout constraint. The production test continues to hash files from the actual checkout; it needs no history, network or extra snapshot. The local source audit used already available Git objects; a shallow CI does not need that audit to run the gate. No separate shallow-checkout execution was performed.

## Gate semantics and negative controls

`test_actual_frozen_native_configuration_is_pinned` still compares SHA256 of all five current native files. It additionally fixes the expected five-path coverage and requires agreement among manifest, BASE, blank plan and README. The existing old-binary test now explicitly refuses these historical a0c inputs:

| Input | Required refusal |
|---|---|
| Plan with historical source | `native source is not the frozen base` |
| Native validation receipt with historical source | `binary/map/runtime proof does not bind the frozen artifacts` |
| Web manifest with historical source | `Web runtime/account binding required` |

For both receipt controls, the enclosing artifact descriptor is rehashed to the mutated bytes so the refusal reaches the source-binding check. The existing positive synthetic fixture remains accepted for local integrity math only, with `deployable:false`. The fixtures are explicitly synthetic; their source fields are test inputs, never actual validation evidence. The blank plan remains blank apart from its candidate identifier.

All old binary/map/profile/Web receipts and evidence remain historical and untouched. This refreeze creates no native binary, Web build, real artifact-validation receipt, hosted endpoint, PostgreSQL proof or cloud claim. Actual candidate binary/map/profile/Web proofs and all other existing activation gates still need separate work and authorization.

## Bounded verification

The original targeted test was reproduced once before editing:

```sh
python3 -B -m unittest discover -s tools/staging-full-runtime \
  -p test_preparation.py -k test_actual_frozen_native_configuration_is_pinned -v
# Expected original exit 1; checked for exactly one failure and both exact runtime hashes.
```

The corrected suite ran once: **14 tests PASS**, including the three historical-source refusal controls. Three modified Python files passed AST parsing, both JSON inputs parsed, `verify.sh` passed `bash -n`, and `git diff --check` passed. [offline-checks.txt](offline-checks.txt) contains the bounded output. No broader tests, native build, database, host or network commands were run.

Exact local environment setup and reproducible verification, from the worktree root:

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/staging-preparation-ci76d-state/cargo-target-not-created
export RH_PGTEST_STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/staging-preparation-ci76d-state/pg-not-created
export PYTHONDONTWRITEBYTECODE=1
bash -n docs/evidence/staging-preparation-ci76d/verify.sh
bash docs/evidence/staging-preparation-ci76d/verify.sh
test ! -e "$CARGO_TARGET_DIR"
test ! -e "$RH_PGTEST_STATE"
shasum -a 256 -c docs/evidence/staging-preparation-ci76d/SHA256SUMS
```

No new worktree or cache was created. The separate installer branch remains exactly `7b2599aad0a7ad8bb00e9300ed1312e26dab6078`; its commits are not incorporated, changed or replayed by this branch. The code commit changes only six leased staging root files; the evidence commit adds only this directory. No workflow, native source, dependency/lock, historical evidence, shared status or installer subtree changes are included. Root owns independent review and integration; this worker made no merge or push.

`SHA256SUMS` covers the six code files and every evidence payload except itself. Verify it from the repository root. The evidence commit ID is reported in the handoff to avoid a self-referential commit identifier here.
