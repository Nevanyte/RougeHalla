# P-CI-GREEN-7: card provenance refresh for `tools/protocol-js/check-vectors.mjs` (the rework's wire packets)

- **Serves:** CI green before the local integration branch is pushed (coordinator, 2026-11-20).
  - P-WIRE19-A/B, P-SYNC-ORIGIN-1 (protocol 20) and P-AUG-NATIVE-5 (State key 15) each edited
    `tools/protocol-js/check-vectors.mjs`.
  - That file is pinned in the card catalog's `protectedSha256` map, so the gate step "card provenance chain (pins
    current)" and CI's `provenance` job have been red since P-WIRE19-A.
  - The coordinator waived that one red until this single refresh. It runs after the last wire packet of the rework
    (P-AUG-NATIVE-5, integration 74).
- **Tier:** `implementer-sonnet`. Reviewer: `reviewer` (Sonnet).
- **Base:** `feature/unity-rework` at the commit that adds `docs/backlog/packets/P-SYNC-ORIGIN-2.md` (the coordinator
  names it in the dispatch).
  - This packet runs in parallel with P-SYNC-ORIGIN-2, which may change no pinned file (its decision 7).
  - On 2026-11-20 the two lines differed in exactly one of the catalog's 325 pinned files, `check-vectors.mjs`, and
    origin had not touched the card chain since `81866e9c4`. So a capture on this base gives the merged tree's pins.
- **Route:** exactly P-CI-GREEN-5's (`docs/backlog/packets/P-CI-GREEN-5.md`, commit `551814bc`, evidence
  `docs/evidence/ci-provenance-refresh-2026-11-17/README.md`). Origin's P-CI-GREEN-6 (`a16f3c59d`, evidence
  `docs/evidence/ci-provenance-refresh-2026-11-20/README.md`) is the latest worked example.
  1. Genuine recaptures in the pinned `node:22.23.4-bookworm-slim@sha256:aaa4b5ba...` linux/amd64 image, with the repo
     mounted read-only and output to an external directory.
  2. A recursive leaf diff against the committed corpus.
  3. The catalog, runtime overlay, witness overlay and `check-card-chain.mjs` tables, advanced in that order.
- **Write scope:**
  - `parity/card-catalog/source.json`, `parity/card-runtime/{source.json,INPUT_SHA256.json}`,
    `parity/card-runtime-witness/{source.json,INPUT_SHA256.json}`, each only by its documented `capture.sh`.
  - `tools/card-runtime-fixtures/capture.mts` and `tools/card-runtime-witness-fixtures/capture.mts`, overlay entries
    only.
  - `tools/provenance/check-card-chain.mjs`: the `EXPECTED` and accepted-leaf tables only. It stays read-only.
  - `docs/evidence/ci-provenance-refresh-2026-11-20-check-vectors/README.md` (new).
  - This file (the hand-off section).
- **Oracle (already failing):** `node tools/provenance/check-card-chain.mjs` on the base gives `failureCount: 1`:
  `catalog-protected-sha` for `tools/protocol-js/check-vectors.mjs`, expected `aebbcc17…`, actual the file's current
  sha256.

## Must

- After recapture, the only differing catalog leaf is that one pin. Any other differing leaf: stop and report.
- Runtime and witness recaptures keep their cases and outcomes; differing leaves are provenance only. Anything else:
  stop and report.
- `FROZEN_PINS.json` stays untouched. No hand-edit of any file under `parity/`.

## Docker on this Mac

- Docker Desktop's keychain credential helper hangs here. Create a config directory of your own (for example
  `<your scratchpad>/dockercfg/config.json` containing `{"auths":{}}`). Run every docker command and every `capture.sh`
  with these exported:
  - `DOCKER_CONFIG=<that dir>`
  - `DOCKER_HOST=unix://$HOME/.docker/run/docker.sock`
- First check that `docker version` answers within a minute. If the daemon is not running, stop and report; do not try
  to start Docker Desktop.
- The image runs emulated (amd64 on arm64), which is slow: P-CI-GREEN-5 took about four hours. Capture each corpus once,
  keep the output and run long steps in the background.

## Done

- `node tools/provenance/check-card-chain.mjs` exits 0 (`failureCount: 0`).
- `tools/card-catalog-fixtures/capture.sh --check`, `tools/card-runtime-fixtures/capture.sh --check` and
  `tools/card-runtime-witness-fixtures/capture.sh --check` pass.
- `scripts/gate.sh --quick --allow-protected --regen-fixtures` passes. Use the flags P-CI-GREEN-5's hand-off says the
  path check needs.
- The evidence README is written, and the AGENTS.md hand-off report is in this file.

## Hand-off

```
PACKET:          P-CI-GREEN-7 — serves CI green before the rework branch is pushed (coordinator, 2026-11-20)
BRANCH:          agent/sonnet/P-CI-GREEN-7 @ HANDOFF_SHA (worktree .claude/worktrees/agent-afbcb21ea50c4150c)
GATE:            PASS (quick) `scripts/gate.sh --quick --allow-protected --regen-fixtures --base 52bd52065`; check-card-chain failureCount 0; three capture.sh --check pass
CHANGED:         parity/card-catalog/source.json; parity/card-runtime/{source,INPUT_SHA256}.json; parity/card-runtime-witness/{source,INPUT_SHA256}.json (all by capture.sh output); tools/card-runtime-fixtures/capture.mts and tools/card-runtime-witness-fixtures/capture.mts (overlay entries); tools/provenance/check-card-chain.mjs (EXPECTED, lineage, leaf count 2->1, leaf table); docs/evidence/ci-provenance-refresh-2026-11-20-check-vectors/README.md; this file
D-RULES:         n/a (provenance only; no parity capture content changed)
DEVIATIONS:      none
SHARED RECORDS:  none
LEGACY DOUBTS:   none
NOT ESTABLISHED: capture.sh --check exit codes were read from their printed matching hashes (set -e scripts), not an explicit exit status
RISKS:           pins are correct for 52bd52065; any later edit to a pinned file needs another refresh
```

Pins: catalog `08eedc97...`, runtime source `eb66dd5e...`, runtime input `0e81c141...`, witness source `03e174c3...`,
witness input `0a9b428d...`, runtime tool `558741bb...`, witness tool `cc6e87a6...`. Only differing catalog leaf was the
check-vectors pin; runtime 10 and witness 22 differing leaves, all provenance. Corpora captured once each, outside the repo.
