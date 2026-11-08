# Quest-public semantic controls

Each patch is a one-line source mutation applied to a writable copy by `../run-mutants.sh`; `../apply-patch.mjs`
verifies every context line. The capture is recaptured with `RH_QUEST_PUBLIC_RECORD=1`; `compare.mjs` skips only
`/profile` and reports the first JSON-path mismatch. `expected.txt` holds the exact first-mismatch signature per patch.

| patch | named consumer output | expected first mismatch |
|---|---|---|
| `01-quest-door-payload.patch` | the real QuestDialog Accept payload changes from the runtime quest id to its catalog def id | `doors.json /clientDoor/cases/0/actual/sent/0/payload/quest` |
| `02-quest-intake-parse.patch` | `parseQuestAccept` stops enforcing the 1..64 length bound | `doors.json /intake/cases/7/parsed` (the over-64 id) |
| `03-quest-head-start.patch` | the hidden reveal publishes with no 4 s head start | `doors.json /actions/cases/13/actual/headStart/publicHas` (false -> true) |
| `04-quest-refusal-wording.patch` | `QUEST_REFUSAL.far` wording changes in the real dialog/refusal surface | `doors.json /clientDoor/cases/5/actual/afterRefusal/status` |
| `99-provenance-only.patch` | none: hyphenates a word in a source comment (source hash changes only) | `IDENTICAL` (NON-KILL) |

A compile/syntax/runtime failure is not accepted as a kill. After the five controls, `run-mutants.sh` re-runs the
unmutated `capture.mts --check` and `verify.mjs` against the checked-in `parity/quest-public` corpora; that restored
control must pass byte for byte. `RH_QUEST_MUTANTS_DISCOVER=1` prints observed signatures without enforcing them.
