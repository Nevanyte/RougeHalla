# `tools/overkill-producer-fixtures` — actual-source Overkill producer matrix

Source-only capture for the confirmed Overkill arithmetic/filter distinction. `capture.mts` drives the unmodified
legacy `createGameWorld` through real card grants, the actual `heal`/Second Skin barrier producer, ordinary queued
sword/wand attacks and 50 ms steps. It installs only read-only hook taps for `hitLanded`/`overkilled`/`hurt`/
`fighterOut` (preserving every original callback) plus a labelled read-only `beforeDamage` ledger tap; no expected
barrier, damage, death, hook payload or RNG outcome is installed.

`capture.sh` runs it in the pinned linux/amd64 Node 22.23.4 container; `--check` requires byte-identical output.
Output path: `parity/overkill-producer/source.json`; env override `RH_OVERKILL_PRODUCER_OUTPUT`.

`run-mutants.sh` is copy-only: each variant extracts a pristine `git archive HEAD` into a disposable temp repo, copies
only the new capture tools there, applies one patch, runs the pinned capture, and compares `format`+`cases`
semantically. The live host checkout is never mutated; it verifies the host ledger remains clean and runs the
unchanged canonical `--check` control. Mutants: `01-barrier-subtraction-removed`,
`02-applied-vs-prehp`, `03-non-arena-filter-removed`; `provenance-only.patch` is a comment-only non-kill.
