# Direct stage-four landmark recipes

This leaf implements the actual Rime watchtower, Sanctum shrine and Warren burrow callbacks. It does not grow lakes,
paint ICE/LIGHT/BOG, build halls/barrows, implement other style passes, or claim finished-map pins. All templates and
recipe policy live in borrowed `Definition` values, parsed once by immutable `Recipe` constructors. Visitors enumerate
all definition fields in declaration order and every template key/row/job through the common template visitor.
No callback draws from either the main attempt stream or its independent landmark stream.

Rime computes its clipped, margin-shifted 3/4 clearance once, with snapshot lake seeds. Its SAT deliberately ignores
reservations/rim while `stamp_fits` subsequently reads the current runtime. Numeric binary64 keys retain the source's
524288/256/8 packing and order, including its fixed-column decoding. Failed fits consume no placement tries; the sixth
failed whole placement returns immediately. Only exhausted keys trigger a fresh original-policy six-try search.
Sanctum keeps the original bad SAT across both shrines, scans row-major with strict score improvement, and preserves
all cost/bearing/extra ties and bearing 7 after a failed first shrine. Its `l` cells are only owned floor at this stage.
Warren uses current-ground camp nodes and Gabriel roads, longest/node-key order, then the original permille/across
loop order; it stops at first success on a road. No MST, terrain generation, alternate transaction policy or cache survives
between callbacks. Fixed orientation counts, half-template offsets, integer geometry units, DIR16 quantization,
permille denominators and key packing are structural encodings; tunable margins, counts, costs and thresholds are live.

## Evidence

`tools/map-fixtures/landmark-recipes-direct.ts` copies original sources to a temporary directory and adds import rewrites,
export-only private-helper exposure and observational taps. Unique source anchors are required. It calls the real
`tryAttempt`, with default landmarks/bushes and `styleZones:null` (plus one honestly labelled styled observer control).
For every real case it requires complete final GameMap/null equality and actual `mapHash` equality with an unmodified
call before writing the fixture. Source dependency SHA-256s and Linux x64 Node 22.23.4 provenance are recorded.

The real pool is seed/attempt `1/0`, `-1/0`, `4294967297/4294967296`, `176/0`, `54/0`, `17/0` (M3a redraw), `17/1`,
and the styled `1/0` control. No actual null result was encountered in this bounded pool; none is claimed. Seed 176
contains the genuine Rime local-key exhaustion fallback. The fixture preserves all five ordered zone inputs/outputs,
original hard/territory, masks/edge fields/camps/geometry bits, lossless state snapshots, ordered stamps/fits/whole
transactions/reservations, scanner keys/SAT, clearance/seeds/targets, hall windows/scan candidates/slots, roads/noise/
centres, score bits and main/independent zero-draw stream continuations.

Tests recompute the real M3a prefix, check its collision/zone/territory, and execute these live recipes against one
continuous `Stage4State`. Every owned direct planner decision, ordered stamp/fit/place call, score bit and complete
boundary state is compared. The other two factions are explicitly **infrastructure replay** in this leaf's isolated
check; their captured placements do not prove their callbacks. The coordinator's live five-zone gate owns that proof,
original-protection admission and full integration. Complete snapshots include refused guard state, scratch mark/qa/qb/
epoch, counters, ownership, reservations, features, terrain, collision and wrote. Missing sections fail the tests.

Eight separately labelled actual-source synthetic helper cases cover six local refusals after rejected fits with no
fallback, genuine empty-key exhaustion, a clipped shifted field, failed first shrine/bearing 7, the minimum hall radius/
pole fallback, equal-road order/first success, exact minimum road length, and no nodes. An additional actual private
second-seed helper probe checks separation equality, clearance equality and earliest-index ties. Live tuning, template
rows, keys and jobs are perturbed in Rust and must change behavior as well as content words.

### Discarded-cache composition exception

The accepted Rust free search wrapper owns a new `LandmarkSearch` session; after success it patches its private SAT
before dropping the session. Source free `bestLandmark` passes `st=null`, so it skips that unobservable final patch.
The recipe test compares the complete source build/candidate/shortlist/attempt transcript and live score bits exactly,
then separately verifies the extra final Rust patch cell-by-cell from the source initial table and successful source
stamp, its SAT arrays, current box sum and feature count. It does not invent a source patch event or normalize other
events. Complete runtime states and outputs agree. No accepted search production behavior is changed for this exception.

## Reproduction

Canonical capture uses the coordinator-pinned Linux amd64 image, a read-only repository mount and a private output
mount, with node_modules in tmpfs:

```text
npx --yes --package node@22.23.4 node --import tsx tools/map-fixtures/landmark-recipes-direct.ts
npx --yes --package node@22.23.4 node --import tsx tools/map-fixtures/landmark-recipes-direct.ts --check
cargo test -p rh-sim --lib mapgen::landmarks::recipes::direct_family
```

Set `RH_DIRECT_OUTPUT` for an external capture destination. Isolated checks use a git-archive snapshot of accepted
`438074d3`, this owned leaf/fixture, a parent declaration and the coordinator's read-only cfg(test) search diagnostics
getter. Parent registry/content/status changes, broad gates, locks, commits and pushes belong to the coordinator.

Frozen leaf validation: six focused Rust tests pass (including every live scalar/array element/template byte/job in the
content visitor), isolated library+test Clippy passes with warnings denied, and a second canonical Linux capture
reproduces the complete fixture byte-for-byte. The transitive source inventory contains 39 SHA-256 entries. This is
leaf evidence pending independent review; the coordinator owns the separate live cross-zone gate and acceptance.


### Review repair: strict trace admission and fallback opens

The test harness admits exactly the 30 captured event kinds and validates every state reference before any event
classification, including foreign infrastructure replay records. It pins the eight real case identities/order/state
inventories, all 39 source names and SHA-256 values, the eight synthetic identities/order/state inventories, and the
private-helper probe identity. Unknown operations and missing inventories are rejected explicitly.

For each Rime fallback, the observed `rimeFallback` call first verifies and stores the actual Rust pre-search state.
After the actual search executes, its first Rust build diagnostics supply `okFloor` and `okWall`. The test reconstructs
the source open-call sequence in row-major order only where the **actual Rust** `okFloor` is one, checks each exact
index/result/count against actual `okWall`, and binds every source open state to that already-verified Rust boundary.
Source tables are still independently compared against Rust diagnostics; they do not drive both sides of the open check.

Focused negative controls retain an unchanged valid source stream and reject a missing open, reordered opens, a corrupt
index, flipped result, invalid state reference, a valid reference to a different full state, and the reviewer's combined
all-open corruption. Additional controls reject unknown operations in owned and foreign zones, invalid state references,
and missing case/source/synthetic/helper inventories. This repair changes only tests and this explanation; production,
capture-tool and fixture bytes retain their original frozen hashes. The discarded-cache exception above is unchanged.
