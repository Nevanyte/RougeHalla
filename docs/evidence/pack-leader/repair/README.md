# Pack Leader source-first seal — bounded repair (tooling / provenance / cache-claim)

Branch `deepseek/p-pack-leader-source-repair` is an **additive** repair branch from the sealed source-first seal
`c946cfbf27a59d06f4de7f1270a69d477efbb7de` (code `62257be9…`, base `db5ed80b…`). The original sealed branch, corpus
(`parity/pack-leader/source.json` sha `c9ae77c7…`, preserved byte-unchanged), helpers, old README/logs and receipts are
left untouched; the only worktree changes are the repaired tools plus this new `repair/` evidence/corpus tree. The
repaired canonical corpus is `parity/pack-leader/repair/source.json` sha
`62047e82cde33f9d056e5cc3452a8d1dc19545372f971f9040c99a3ee56e26ea`. `logs/old-vs-new.log` shows the only differences
from the old corpus are allowed additive/provenance ones: added `/witness/cachePhases` and changed `/tool/capture`;
`result` is byte-for-byte identical and the gameplay projection (input/result/source/base/case/acquisition) is equal.

Native implementation remains HELD; this repair does not authorize native edits/builds and does not touch the loaned
`final-target` or `bot-fight-native` targets.

## Repair 1 — REAL readonly `--check`

`tools/pack-leader-fixtures/capture.sh --check` now mounts the repaired canonical directory **read-only**, runs a fresh
capture into a task-private `/tmp` path inside the pinned container, and compares **every byte** with `cmp` (no
semantic/provenance stripping). The canonical file is never written.

- Positive: `CHECK-OK: fresh capture reproduces the canonical corpus bytes exactly`, exit 0
  (`checks/positive.log`).
- Negative: a disposable copy with one deliberately substituted byte
  (sha `1008c3ffb279a536cf65ce11caca9d1e4b1b30a4d1c3cbfad43877829d16261a`) must fail:
  `CHECK-MISMATCH`, exit 1 (`checks/negative.log`).
- Canonical bytes before/after the run: `62047e82…` unchanged; substituted copy unchanged; summary in
  `checks/summary.log`, full exits in `checks/run.log`. `CHECKS-GREEN` (exit 0).

## Repair 2 — mutant root/provenance alignment

Every control capture now runs with **cwd/import/hash root = `/tmp/repo`** (the actual writable mutant source copy), so
the recorded source hashes are the mutated imported bytes, not `/repo`. Each changed file's recorded provenance hash is
asserted against `sha256` on the imported file (`MUTANT-SOURCE-HASH-BOUND` lines in each log), and the comparator now
classifies semantic vs provenance independently (`SEMANTIC-DIFF` / `SEMANTIC-IDENTICAL PROVENANCE-DIFF` /
`SEMANTIC-IDENTICAL PROVENANCE-IDENTICAL`).

| control | changed file (recorded imported hash bound) | classification |
|---|---|---|
| 01-constant-zero | mods.ts `afa6a796…` | SEMANTIC-DIFF (625.73 -> 611.06) |
| 02-wrong-per | cards.ts `e9869c22…` | SEMANTIC-DIFF (-> 640.39) |
| 03-wrong-step | cards.ts `f1875b84…` | SEMANTIC-DIFF (-> 611.06) |
| 04-cache-refresh-timing | mods.ts `90bfdd93…` | SEMANTIC-DIFF (-> 611.06) |
| 05-comment-only | mods.ts `8d4a289a…` (differs from sealed `93db949f…`) | **SEMANTIC-IDENTICAL PROVENANCE-DIFF changed=source** |
| 06-excluded-count | campHeal.ts `fb91c940…` | SEMANTIC-DIFF (-> 611.06) |
| restored | none | **RESTORED-IDENTICAL-BYTES** (cmp with canonical) |

All six patches applied cleanly; all captures compiled and ran (no compiler/setup failure counted as a kill); the five
numeric mutants are actual compiled assertion/diff kills. `/repo` stayed read-only; every mutation is in the
disposable copy. Protected source inventory before/after is byte-identical: 208 files sha
`85a220c1911579b5189b9d3acf34b13cdc51e51dd594988a74edd9cccceb7453`; the five protected file hashes are unchanged.
Full logs: `controls/run.log`, `controls/0*.log`, `controls/restored.log`, `controls/source-bytecheck.log`.

## Repair 3 — narrowed cache claim (no intra-pass proof claimed)

The stronger "cached 0 *during* the clear pass" wording is removed. The retained evidence is explicitly **post-step
only**: the last retained pre-clear post-step sample is **tick168 / 8400 ms** with count not positive and cached build
camps **0**; the clear step's retained post-step sample is **tick169 / 8450 ms** with count **1** and cached build camps
**1**. `witness.cachePhases` records exactly those samples and states the capture does not serialize the hook snapshots'
`$oracle` refs, so this is **not** an independently readable intra-pass cache proof. The native pass-start design is
justified from the concrete source ordering instead: `sim/ledger.ts` precomputes outgoing mults (including
`outgoingExecuteShare`) before any `applyVictim` and pays deferred rewards after; `campHeal.ts` increments the canonical
count in that deferred payout chain; `mods.updateMods` refreshes watched cached counts after payout and before the next
ordinary pass; `step.ts` is the only production `applyLedger` caller. Root has accepted the private **pass-start count**
design for the future native outgoing + execute context, conditional on preserving that ordering; no new persistent camp
cache is justified by this source.

## Historical labels (accurate)

- The old seal remains: branch head `c946cfbf…`, code `62257be9…`, corpus `c9ae77c7…`, old evidence head
  `c946cfbf…`; its `sealed-export.log` records the historical clean-export result at commit `0ced321a…` and its
  `sealed-git.log` records the historical manifest verification at `a5e3fb22…`. Those are **historical** labels, not
  claims about this repaired final seal.
- `attempts-failures.log` on the old branch is explicitly **narrative retention of failure causes**, not preserved raw
  red logs; this repair does not retroactively claim otherwise. All repair attempts/logs here are fresh and retained.

## Exact commands (portable; pinned `node:22.23.4-bookworm-slim` linux/amd64 image, source read-only)

```
# regenerate repaired canonical (writable output dir)
mkdir -p node_modules
RH_PACK_LEADER_BASE=db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de \
  RH_PACK_LEADER_DIRECTORY=$PWD/parity/pack-leader/repair \
  bash tools/pack-leader-fixtures/capture.sh                       # exit 0; logs/capture.log
# REAL readonly check (positive + byte-substituted negative)
RH_PACK_LEADER_CHECKS_LOG=$PWD/docs/evidence/pack-leader/repair/checks \
  bash tools/pack-leader-fixtures/run-checks.sh                    # exit 0; checks/run.log ends CHECKS-GREEN
# root-aligned mutant controls
RH_PACK_CONTROLS_LOG=$PWD/docs/evidence/pack-leader/repair/controls \
  RH_PACK_LEADER_BASELINE=$PWD/parity/pack-leader/repair \
  bash tools/pack-leader-fixtures/run-controls.sh                  # exit 0; controls/run.log ends CONTROLS-GREEN
```

## Limits (explicit)

- Source-first seal repair only; one genuine clear remains sufficient. No eight-clear/full-card campaign.
- Helper probes are unchanged (old `helpers.json` is byte-preserved) and remain declared-helper-count contexts only.
- Native consumer, Rust/native/cache work, headers/locks/status and any activation remain out of scope and held.
