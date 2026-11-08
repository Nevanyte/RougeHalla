# P-FACTION-3 corpse fixtures

- `check.mjs` verifies `parity/corpses/source-manifest.json`, the three pinned fixtures and their corpse diagnostics.
- `run-mutants.sh` applies each committed mutant, requires a failure, and restores the tree.

Regenerate the fixtures only with the pinned image recorded in the manifest, using `capture.ts --only <scenario>`.
