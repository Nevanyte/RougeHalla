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
`run-mutants.sh`, `compare.mjs`), the dependency lock (`package-lock.json`) and the SHA256 of the 127-file shared/sim TypeScript inventory.

The lifecycle world is a four-seat **player-only / no-mobs weapons-only** profile (`config.mobs:false`,
`modules.signatures:false`, quests/training/dummies false, four Holy/Fire/Plague/Frost seats) so match termination
cannot replace the requested lifecycle; the only dummies appear in the separately labelled training-exclusion case.
Real producers only: `grantCard`, `grantMobStat`, the arena `applyDamage` wound, ordinary `attack` input, ordinary
`choose` input and a real `removePlayer` leave; expected Trophy options/gains/takenBy/killStats are never installed.
`rewardOffered`/`rewardChosen` are read through a labelled hook-only observational probe, never counted as gameplay
producers.

`run-mutants.sh` applies four committed source mutants and requires a mismatch at each named semantic witness in
`compare.mjs`. It compares parsed `cases` only: source/tool provenance is excluded, so changing a hash is never a kill.
The original whole-file `cmp` result is withdrawn as semantic evidence because mutated source hashes alone changed
the files. Capture/compile/import/setup errors are failures, not kills. Each source patch is restored, and the final
unchanged control must pass byte-identical `--check`.

Before the four mutants, a comment-only source mutation must change provenance but leave both case payloads equal;
the comparator reports `semanticKill:false`. The four expected categories are stranger-refusal toasts, birth-hold
`takenBy`, ranked option ordering and the owner's granted AD amount. No new expected gameplay values are installed.
See `docs/evidence/trophy-witness/mutant-admission-repair.json` and its scoped log for the actual repaired results.
