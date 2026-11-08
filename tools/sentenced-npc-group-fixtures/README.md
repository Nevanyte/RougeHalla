# `tools/sentenced-npc-group-fixtures` — source NPC Mark / camp-group witness

Pinned actual-source capture for Sentenced NPC sources and player-to-camp Mark groups. `capture.sh` runs the unmodified
legacy TS in the official linux/amd64 `node:22.23.4-bookworm-slim@sha256:aaa4b5…` image (read-only repo mount,
writable node_modules tmpfs) and writes `parity/sentenced-npc-group/source.json`; `--check` requires byte-identical
output. `RH_SENTENCED_NPC_GROUP_OUTPUT` redirects the output.

`capture.mts` uses real `createGameWorld`/`addPlayer`/`step` with generated map seed1, catalog-rolled camps/mobs, real
AI and normal player `attack` commands (50 ms steps). It records focused player/NPC fighters, camp members, IDs, pulses
from a labelled read-only `beforeDamage` ledger tap, and events; no Mark target/group/size/hits/progress/tier/pool/denial
/ledger outcome is installed. Existing trusted setup `parity/sentenced/runtime-matrix.json` and
`denial-matrix.json` are referenced as read-only prior evidence, never presented as ordinary gameplay.

`run-mutants.sh` arms restoration only after a checked complete backup, handles EXIT/HUP/INT/TERM, restores exact bytes
and propagates restoration failure; it compares only `format`+`cases` (provenance excluded) so provenance-only changes
are not kills. Three committed mutants: `01-duplicate-or-unscaled-group-pulse`, `02-current-survivor-size-wrong`,
`03-wrong-regional-pool`.
