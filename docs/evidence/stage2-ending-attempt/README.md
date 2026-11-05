# Ending metadata and actual attempt prefix

Branch: `optimization_port`. The integrated native gate passed **521 tests, zero failures/filters and one intentional
ignored heap measurement**. Formatting and all/default-feature workspace Clippy passed. The gameplay report remains
57 compared scenarios/13 capture-only plus 300 path queries; existing gameplay fixture values are unchanged.
Ending/attempt integration is committed at `135ad2d5`; after a test-only lease contention repair, Rust CI `42023715522`
at `f4f38755` passed all jobs, including the new oracles, PostgreSQL, C# and Chromium WSS.

## Ending metadata

Private admission state preserves the original optional faction choice before runtime defaulting. Typed optional
faction/weapon enter RunResult once at resolution, using the selected raw slot after the existing body-drop order.
Empty hand, death, active MIA and the qualified posthumous winner have no weapon. Runtime default factions do not
create faction-win progress. This corrects stale packet assumptions, preserving actual legacy behavior.

The oracle invokes real RaidRoom admission/settle/bankVoided and JsonProfileStore on synthetic profiles in temporary
files. Fifteen adapter/lifecycle cases are distinct from combat/network fixtures. Their exact source boundary and the
strict decoder/projection contract are documented in [parity/persistence](../../../parity/persistence/README.md).
Two Linux x64 Node 22.23.4 and two host Node22 recaptures are byte-identical.

Independent review compared another 72 actual adapter combinations, including all explicit factions, omitted choice,
both selected slots, empty/armed combinations and Subject joining second. Metadata, pending-MIA restore continuation,
hashes, public observation isolation and all reset-active explicit factions passed. Invalid enums and six nested unknown
fixture fields were refused. Real PostgreSQL checks covered full stats/progress documents, concurrent duplicate delivery,
rename/name reassignment, stale fences, rollback/retry and old durable v1 documents without the optional fields.
Wire-result bytes are unchanged for every faction/weapon pair; bot reports still cannot bank. No new training or
shutdown/void gameplay path was added; existing Store void semantics are tested separately.

The existing immutable durable ID, match/fence, atomic transaction and retry path carry these values. No mutable
departed-player lookup, schema migration, result-document version change or dependency was needed.

## Map attempt prefix (M3a)

The real prefix implements stages 1–3 only: binary64 attempt-seed arithmetic before JavaScript integer coercion,
pillar/faction draws, four layout rounds, fixed ground, clearing indices and StyleCamp views. A camp failure redraws
zones on the same stream; a partition failure ends the attempt. The returned frame owns the advanced RNG and internal
IDs/arrays. It is not a finished map and does not claim plain-pin parity.

The observational oracle copies the actual generator module to a temporary file, resolves imports to the real modules,
adds export-only exposure/read-only taps, and checks complete final map/null and actual mapHash equality with the
unmodified invocation before trusting intermediate snapshots. Fourteen pinned cases include real seed17/34/49
redraws, signed/wide/max-safe metadata, typed coercion vectors and a styled invocation. Failed-round arrays, exact draw
words and continuation words are compared. Boundary tests for four exhausted rounds and immediate partition failure
are explicitly rule-unit inputs, not invented failing map seeds.

Independent review matched 37 additional full cases, including custom radii, negative fractional stride, zero rounds,
forced exhaustion and exact numeric seed bits. Integer-first arithmetic and incorrect partition-redraw mutations failed.
Five attempt tests, inherited heap regression, Clippy and frozen pinned recapture passed. Both new rule values drive
runtime and their allocation-free content visitor; clearing geometry remains shared with M2.

Landmarks/bushes, later safety nets/spots/repair/records, final gates, complete hashing/orchestration and independent
certification remain open. PINNED_PLAIN retains real landmarks/bushes. No source behavior or map pins were changed.

## Reproduction and formats

```
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p rh-parity --bin parity-report
node --import tsx tools/persist-fixtures/ending-metadata.ts --check
node --import tsx tools/map-fixtures/attempt-frame.ts --check
```

Node oracle checks require pinned Linux x64 Node 22.23.4 and locked dependencies. PostgreSQL tests use the disposable
local PG16 setup. Current formats are checkpoint /10, replay /8, observation 7, policy 4 and wire 5; content identity
is `e639a5f9fc48e272`. Full game, live profile routes/recovery and cloud/browser release gates remain open.
