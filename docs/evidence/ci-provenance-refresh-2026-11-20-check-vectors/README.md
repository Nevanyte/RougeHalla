# Card provenance refresh, 2026-11-20, check-vectors pin (P-CI-GREEN-7)

Same route as `docs/evidence/ci-provenance-refresh-2026-11-17/README.md` and
`docs/evidence/ci-provenance-refresh-2026-11-20/README.md`: genuine recaptures in the pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5ba...` linux/amd64 image (emulated on this arm64 Mac), repo mounted read-only,
output to an external directory, then a recursive leaf diff against the committed corpus. Base: `feature/unity-rework`
@ `52bd52065` (integration 76). An empty untracked `node_modules/` was created in the worktree for the tmpfs mountpoint;
each corpus was captured once.

## Why

`tools/protocol-js/check-vectors.mjs` is pinned in the catalog's `protectedSha256` map. P-WIRE19-A/B, P-SYNC-ORIGIN-1
(protocol 20) and P-AUG-NATIVE-5 (State key 15) edited it, so the provenance chain step was red until this refresh.

## Catalog (`parity/card-catalog/source.json`)

`ab40ad59...` -> `08eedc97...`. 409 cases, families as before; the only differing leaf is the one protected pin:

| file | old pin | new pin |
|---|---|---|
| `tools/protocol-js/check-vectors.mjs` | `aebbcc17...` | `c9dc4476...` |

## Runtime and witness

- Runtime tool `tools/card-runtime-fixtures/capture.mts`: overlay advanced (prior `ab40ad59...`, effective `08eedc97...`,
  one accepted leaf, evidence path of this note, lineage extended) -> `558741bb...`. Recapture: 65 cases, 6236 steps,
  3179 private records, as before; 10 differing leaves, all provenance (harness pin, catalog reference, overlay record).
  `source.json` `eb66dd5e...`, `INPUT_SHA256.json` `0e81c141...`.
- Witness tool `tools/card-runtime-witness-fixtures/capture.mts`: three overlay entries advanced (prior = old effective;
  evidence path of this note) -> `cc6e87a6...`. Recapture: 2 cases, 6 steps, extraDamage and sourceRatio as before; 22
  differing leaves, all provenance. `source.json` `03e174c3...`, `INPUT_SHA256.json` `0a9b428d...`.
- `FROZEN_PINS.json` untouched.
- `tools/provenance/check-card-chain.mjs`: `EXPECTED`, the lineage string, the leaf count (2 -> 1) and the accepted-leaf
  table updated; still read-only.

Checks: `node tools/provenance/check-card-chain.mjs` exits 0 (`failureCount: 0`); the three `capture.sh --check` results
are in the packet hand-off.
