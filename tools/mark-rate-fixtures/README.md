# `tools/mark-rate-fixtures` — P-SENTENCED-MARK-RATE-1 actual-source capture

Pinned actual-source witness for Gathering Storm driving real Sentenced Mark progress. `capture.sh` runs the unmodified
source in the pinned linux/amd64 Node 22.23.4 image and writes `parity/mark-rate/runtime.json`; `--check` requires
byte-identical output. The declared player-only/no-mobs full-player faction profile, modules, map and all producer
actions are recorded in the corpus/provenance; no expected Mark outcome is installed.

`run-mutants.sh` applies the committed compiled-Rust semantic mutants (`01-mark-rate-missing`,
`02-prior-chill-arithmetic-wrong`, `03-history-restore-broadened`), requires a real semantic test failure (never a
compile error), restores every file, and finally requires the unchanged control suite to pass.
