# `tools/trophy-witness-fixtures` — P-TROPHY-WITNESS-1 evidence capture

Actual-source, evidence-only capture for the source Trophy lifecycle and the all-nine-key wording/helper tables. No
native/client/protocol/publication implementation is added or implied. The source paths exercised are
`packages/server/src/sim/{killAugments,chests,loot,inputs,gameplay,ledger}.ts` and
`packages/shared/src/{killAugments,combatReadability}.ts` (names verified against the source before use).

`capture.sh` runs the unmodified source in the pinned linux/amd64 Node 22.23.4 container
(`node:22.23.4-bookworm-slim@sha256:aaa4b5…`) and writes two additive immutable corpora to
`parity/trophy-witness/`: `lifecycle.json` (real credited player kills through ordinary enqueue/input/steps) and
`helpers.json` (declared-input pure helper cases calling the ACTUAL shared functions). `--check` requires identical
bytes. Provenance records the image/platform/Node, the capture tool hashes (`capture.mts`, `capture.sh`,
`run-mutants.sh`), the dependency lock (`package-lock.json`) and the SHA256 of all 127 imported TS source files.

The lifecycle world is a four-seat **player-only / no-mobs weapons-only** profile (`config.mobs:false`,
`modules.signatures:false`, quests/training/dummies false, four Holy/Fire/Plague/Frost seats) so match termination
cannot replace the requested lifecycle; the only dummies appear in the separately labelled training-exclusion case.
Real producers only: `grantCard`, `grantMobStat`, the arena `applyDamage` wound, ordinary `attack` input, ordinary
`choose` input and a real `removePlayer` leave; expected Trophy options/gains/takenBy/killStats are never installed.
`rewardOffered`/`rewardChosen` are read through a labelled hook-only observational probe, never counted as gameplay
producers.

`run-mutants.sh` applies four committed source mutants and requires a real captured-output mismatch against the
canonical corpora (a compile/import/setup failure does not count), restores every file, and finally requires the
unchanged control `--check`: `01-owner-refusal-removed`, `02-birth-hold-removed`, `03-ranking-order-reversed`,
`04-grant-arithmetic-doubled` — 4/4 killed.
