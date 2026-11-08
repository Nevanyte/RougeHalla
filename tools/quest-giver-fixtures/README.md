# `tools/quest-giver-fixtures` — source quest-giver lifecycle/side-effect witness

Pinned actual-source capture for the quest giver. `capture.sh` runs the unmodified legacy TS in the official
linux/amd64 `node:22.23.4-bookworm-slim@sha256:aaa4b5…` image (read-only repo mount, writable node_modules tmpfs) and
writes `parity/quest-giver/source.json`; `--check` requires byte-identical output. `RH_QUEST_GIVER_OUTPUT` redirects the
output directory.

`capture.mts` builds the real `createGameWorld`/`addPlayer`/`step` path with a declared generated map, player factions
and loadouts, and real commands (`move`, `attack`, `release`, `cast`, `questAccept`, `pickup`). It records the actual
quest lifecycle giver identity/position/facing, ID counters, standing-combatant membership, runtime history, faction
signature state, movement, projectile/melee paths and landed hits, public event streams, and the declared diagnostic
read-only ledger tap (labelled in the corpus input; it never writes the world). Helper/declared diagnostics are kept
separate from genuine runtime witnesses. No expected giver/status/damage/telemetry outcome is installed.

`run-mutants.sh` applies three committed actual-source semantic mutants:
`01-projectile-giver-exclusion-removed`, `02-hostile-giver-exclusion-removed` and
`03-giver-quest-damage-immunity-removed`. It captures with each mutant applied, compares only the runtime cases/format
(provenance/source hashes are excluded, so a provenance-only change is not a kill), restores byte-for-byte, and finally
requires the unchanged `--check` control to pass.
