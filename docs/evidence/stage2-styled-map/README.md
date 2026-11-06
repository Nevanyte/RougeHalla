# Complete styled-map integration

Branch: `optimization_port`. This checkpoint completes the five-faction styling path in the same
pure orchestrator as plain generation. Full gameplay, public rich-map transport, the live map pool,
Unity flows, AWS staging and release remain separate backlog items.

## Behavior and source parity

`mapgen::pipeline::Pipeline` now exposes styled attempts, traced attempts, the source 16-attempt
certified wrapper and the 64-attempt generate wrapper. Stage six preserves the original pool and
centre-walk inputs, uses one state across zones, and keeps faction/phase streams separate from the
main attempt stream. Gallows has no surface phase. The post-hook contract runs in source order;
T8 clears floor hazards using the original pool's 5x5 mask. Safety nets, crate placement, territory
repair, cleanup and final terrain acceptance receive the actual styling mode.

The original `PINNED_PLAIN`, `PINNED_MAPS`, eight `OPEN_PINNED` entries and version-400 records
are unchanged. All 200 plain and 200 styled pins match complete native DTOs. Styled comparisons
include 160,996 ordered props, which the source map hash omits. The styled fixture binds the existing
bare DTO backbone by SHA256; its producer recomputes all 200 actual bare maps and verifies that
turning decor on changes only props. Both native pin suites independently certify base/zone rules,
including strict styled windows: 800 hard checks across the 400 maps.

Sixteen additional genuine styled attempts preserve complete DTO/null/hash outputs and 195 main-stream
phase continuations, including negative/wide metadata, decor/gates/bushes options, actual prefix refusal
at seed 2459/attempt 0, successful retry 1, certified/generate wrappers and explicit-attempt failure.
Eleven earlier plain cases preserve 120 continuations. The standalone registry corpus covers 18 complete
open/full/wide/option cases, original absent-field semantics and eight original open-map pins. Independent
registry review adds 14 fresh cases, including repeated calls on the same state.

The post-hook corpus checks 37 labelled inputs, 1,944 Cartesian combinations and six T8 original-pool
cases. Two independent source captures agree on all 1,944 diagnostics. These are explicitly labelled
helper inputs; every sparse combination is not claimed reachable from default generation.

Native generated maps for seeds 1 and 2459 enter normal full-layer admission and eight-bot headless play
with a 200-tick cap. Checkpoint continuation and serialized replay retain all map metadata and state
hashes. Full-layer admission validates metadata/collision; source map-hash correctness comes from
separate pin comparisons. This check does not imply full-game bot behavior or termination.

## Review and repairs

The four remaining callbacks are bound by their independent reports:

| Callback | Checked-in complete source inputs | Independent fresh/repeated replay rows | Review |
|---|---:|---:|---|
| Warren | 6 actual +14 direct | 44 | [report](warren-review.json) |
| Scorch | 6 actual +15 direct | 45 | [report](scorch-review.json) |
| Rime | 6 actual +14 direct | 44 | [report](rime-review.json) |
| Gallows | 6 actual +23 direct | 53 | [report](gallows-review.json) |

[Pipeline review](pipeline-review.json) separately reproduces all 200 decorated maps, 400 hard checks,
16 genuine attempts and plain phase preservation. Its six meaningful mutations detect a main-stream
extra draw, omitted styling, discarded decor, T8 using the 3x3 mask, unstyled crate policy and skipping
attempt0. [Controls-adapter review](controls-adapter-review.json) binds the retained source regression
files and their exact source inventory.

[Registry review](registry-review.json) binds the exact driver, all open pins, private stream continuations,
source noninterference controls and repeated-state behavior. Initial equal-area mismatched geometry,
malformed Forge and malformed watchtower inputs could refuse after earlier zone writes. The registry
now preflights the existing leaf admission rules before resetting scratch or invoking any zone.
All three independent repros preserve the complete primed state after repair. Existing leaf admission
bodies are shared rather than copied. Five independent and six producer registry mutants are detected;
the producer's Gallows-surface metadata mutation is an inventory control, not an operation-level mutant.

[Contract review](contract-review.json) covers exact first-breach order, valid ownership, terrain classes,
original-pool T8 behavior and six operation-level mutations. Dangling nonzero owner references are outside
its admitted source fixture domain: the legacy helper throws, while native checking returns a defensive
ownership diagnostic. T8 atomicity is asserted for malformed layer lengths; unknown terrain kinds after
failed contract admission are outside that guarantee.

Coordinator integration folds every callback definition, resolved Gallows dial and actual registry field
into aggregate content. Actual Rime facet normals are folded in their source order; the existing exhaustive
word test retains its scalar/radius assertions and adds the independent source-normal prefix. The small
source capture CLI repair rejects unknown arguments before doing work. No gameplay rule, tick order,
checkpoint layout, observation schema, policy contract or wire layout changes here.

## Verification and measurement

[Integrated results](integrated-result.json) records the final workspace checks and source fingerprints.
[CI results](ci-result.json) bind source checkpoint `d1027eac`: Rust/C# `42132791905` and all six native
determinism jobs `42133186195` passed, including both foreign replay directions.
The content identity is `105333d9ac5d8d92`; checkpoint 14/replay 12/observation 11/policy 8/wire 5 remain.
Canonical recaptures use Linux amd64 Node 22.23.4 in the cached image, read-only source mounts and private
executable dependency storage. CI retains all four callback checks plus the styled pin, registry,
controls and post-hook captures.

[Performance evidence](performance.json) records the paired release measurements and exact runtime,
source identity, options and hardware. Both modes use decor:false, five warmups and 40 common seeds,
alternating which mode runs first. Only the certified call is timed; unchanged original pins are checked
after each call. The named reference is the owner's native Apple M5 Pro,18 CPU cores,64 GiB RAM.
| Mode | Rust median / p95 | Actual TypeScript median / p95 | Median ratio |
|---|---|---|---|
| Plain | 13.47 /21.24 ms | 29.48 /49.75 ms | 2.19× |
| Styled | 22.21 /32.98 ms | 45.32 /68.04 ms | 2.04× |

One quiet run measured the final native implementations with identical options. These samples differ
from the historical default-decor CI yardstick. The measured comparison covers the port as a whole;
it does not isolate the contribution of any particular allocation or algorithm choice. Full original
pin/DTO parity and the source/Rust per-sample pin checks guard behavior. Reproduction commands are in
[`tools/map-bench`](../../../tools/map-bench/README.md); [context](performance-context.json) records
native binary and before/after background CPU observations. Map-generation duration is separate from
server tick throughput and Unity/browser rendering performance.
