# CI card-runtime provenance reconciliation — approach (reported before edits)

Base: `df0d7bb82bd681747d94a985df6cf5083a8e577f`. Isolated branch `deepseek/ci-card-runtime-provenance` in
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-ci-card-provenance`. The human-eligibility worker's worktree is a
different checkout and is not touched.

## Finding

`tools/card-runtime-fixtures/capture.mts` pins the immutable catalog reference corpus at
`d50c03e471f9d11ff790cac0f31d4ab82b5bb45f1b963b41725d58814cc6f74e`, but the admitted catalog corpus is now
`9e76292b7ae74d305da2729a2ceba63965e64aa9fd670ab85568ae7909270507` (1,045,681 bytes). Root/independent review in
`docs/evidence/ci-card-catalog-protocol13/` proved the catalog changed at exactly one protected metadata leaf:
`/protectedSha256/tools/protocol-js/check-vectors.mjs` `775ab7cf…` -> `3c96f5b0…`; all 409 case inputs/outcomes/
inventory, 78 source pins and 5 harness pins are identical. This is provenance reconciliation, not a mechanic change.

## Approach (narrow accepted-provenance overlay, then genuine pinned recapture)

1. **Runtime capture**: keep the original catalog hash recorded, add a narrow explicit accepted-provenance overlay for
   exactly `parity/card-catalog/source.json` original `d50c03e4…` -> effective `9e76292b…`, with the accepted change
   scope and evidence path. The tool checks the effective hash and fails closed on any other hash. The reference
   metadata and the capture file pin (harness input) are the only bytes allowed to change.
2. **Genuine external pinned recapture first**: run the unchanged-source capture in the official linux/amd64 Node
   22.23.4 image into an external fresh directory (never hand-edit expected data), then recursively compare old vs fresh
   JSON. Allowed differences are only the accepted provenance paths (catalog reference hash, this capture tool's
   harness hash, the new overlay record; the runtime `INPUT_SHA256.json` equivalent). **STOP and report if any other
   leaf differs.**
3. **Semantic equality proof**: compare every case input/expected output, every `privateOracleRecords` entry, and
   `noninterference`/`profiles`/`roles` recursively; compute old/new semantic digests over those subtrees (excluding
   provenance only), inventory counts, and save the recursive difference report and raw logs.
4. **Canonical metadata update**: only after equality passes, copy the fresh `source.json`/`INPUT_SHA256.json` bytes into
   `parity/card-runtime/`; run `capture.sh --check` (positive bytecheck) — expected exit 0.
5. **Witness**: keep `tools/card-runtime-witness-fixtures/FROZEN_PINS.json` untouched and its 15 frozen pins (65
   original cases/source `c2e5d1a0…`, 11 tools) inspectable. Extend the existing documented-overlay pattern with a second
   narrow overlay entry for the runtime `source.json` (`c2e5d1a0…` -> new effective) and runtime `INPUT_SHA256.json`
   (`2ea71ac1…` -> new effective), scope limited to those metadata bytes; the frozen pins remain original in the output
   and `actualPinnedInputs` records original/actual/overlay status. Genuine external witness recapture, recursive
   semantic equality (cases/cleanControls/comparison/privateOracleRecords/controlCorrection unchanged), then canonical
   metadata update and `capture.sh --check` exit 0.
6. **Negative control**: mutate one non-provenance expected output in a copy of the fresh runtime output; the pinned
   `--check` must reject it with canonical byte mismatch (exit nonzero). No expected data is refreshed or relaxed. Also
   assert the runtime overlay rejects any catalog hash other than the recorded original/effective pair.
7. **Evidence**: new `docs/evidence/ci-card-runtime-provenance/` records base/head, old/new exact SHAs and bytes,
   allowed/forbidden diff paths, recursive diff JSON, semantic digests, case/private-record counts, raw command logs,
   FROZEN pin immutability, and the external preserved old/fresh/log workspace. Separate checker reproduces the two
   pinned captures/bytechecks, semantic equality, overlay narrowness and the negative control.

## Invariants

- No edits outside `tools/card-runtime-fixtures/capture.mts`, `tools/card-runtime-witness-fixtures/capture.mts`,
  metadata-only `parity/card-runtime/{source.json,INPUT_SHA256.json}` and metadata-only
  `parity/card-runtime-witness/{source.json,INPUT_SHA256.json}`, plus the new evidence directory.
- `FROZEN_PINS.json` stays byte-identical; its 65-case/source and 11-tool pins are never weakened, removed or blindly
  re-pinned. Original executable source, engine, inspection, cases, controls and comparisons do not change.
- No native, TypeScript production, protocol, browser, cloud/ML or shared-status/lock edits; no expected
  gameplay/poststate/private tuples installed; comparisons not relaxed. Root owns merge/status/identities.
