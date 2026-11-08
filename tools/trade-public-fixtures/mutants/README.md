# Trade-public semantic controls

Each patch is a one-line source mutation applied to a writable copy by `../run-mutants.sh`; `../apply-patch.mjs`
verifies every context line. The capture is recaptured with `RH_TRADE_PUBLIC_RECORD=1`; `compare.mjs` skips only
`/profile` and reports the first JSON-path mismatch. `expected.txt` holds the exact first-mismatch signature per patch.

| patch | named consumer output | expected first mismatch |
|---|---|---|
| `01-trade-door-payload.patch` | the real TraderPanel click sends the trader name instead of its runtime id | `doors.json /clientDoor/cases/0/actual/sent/0/payload/trader` |
| `02-trade-barter-cooldown.patch` | the 5 s barter cooldown is zero, so an immediate second trade succeeds | `doors.json /actions/cases/4/actual/events/1/text` ("packing" -> "Traded for Wand") |
| `03-trade-offer-not-synced.patch` | `PlayerState.tradeOffers` becomes `noSync()`, removing the public offer field from the encoded schema metadata | `schema-receivers.json /schema/kinds/1/fields/9/name` (tradeOffers -> tradeStats) |
| `04-trade-offer-cost.patch` | the rolled stat cost share changes 12% -> 11%, changing the actual panel label | `doors.json /clientDoor/cases/0/actual/view/choices/0/text` |
| `99-provenance-only.patch` | none: appends a comment to a CSS import (source hash changes only) | `IDENTICAL` (NON-KILL) |

A compile/syntax/runtime failure is not accepted as a kill. After the five controls, `run-mutants.sh` re-runs the
unmutated `capture.mts --check` and `verify.mjs` against the checked-in `parity/trade-public` corpora; that restored
control must pass byte for byte. `RH_TRADE_MUTANTS_DISCOVER=1` prints observed signatures without enforcing them.
