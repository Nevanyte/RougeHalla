# Whole-wall landmark runtime

This leaf ports the actual stage-4 wall guard and whole-feature transaction from `zoneStyle/context.ts`, plus the exact
size-free 3/4 chamfer and `zoneInfoOf`/camp-view geometry. It does not select templates, search candidates or implement
faction callbacks, later style passes or finished maps. Captured requests are oracle inputs, not a replacement generator.

`Stage4State::new` owns floor/wall collision, initially zero terrain/write flags, draft features/Uint16 ownership and shared
scratch. `ZoneGeometry::new` computes each ordered zone's mask, edge distances, binary64 summary and filtered camp views
from the current collision and actual M3a StyleCamp values. `LandmarkRuntime::new` borrows shared state, geometry, the
original transaction hard mask and optional territory; it rejects unsupported terrain/collision, inconsistent dimensions
and invalid ownership. The hard mask also embodies the source's unchanged `noBlock = protect.slice()` in this stage.
There is no route guard, LOW/fence/ICE branch, trim/groups, surface or prop API.

The typed `LandmarkSpec` accepts only whole landmark/wall requests. Optional floor and params retain absent/empty
semantics. Unknown serialized fields (including unsupported modes) are rejected. `open` is pure; `can_block_wall` is
stateful. `place_whole` preserves write order, refusal, both topology checks, footprint, whole rollback, deduplicated floor
ownership and draft fields. `reserve` is a separate ordered operation. Failed attempts restore collision/write flags and
wall count but retain spent join budget, refusal count and scratch changes. Scratch arrays/epochs carry across zones;
per-zone counters/reservations reset exactly as in the actual constructor. Public read-only runtime views allow later
callbacks to query ownership, zone features and reservations.

`LandmarkDefinition` has three fields: join_checks=128, footprint_percent=4.0 and rim_tiles=3.0. They drive runtime and
allocation-free `visit_content` in that order (join count as u64, then f64 bits). Source percentage unit 100, 3/4 distance
weights, `1<<20` chamfer sentinel, eight-ring/four-neighbor traversal and scratch stamps are algorithm/encoding values,
not independent geometry knobs. Existing M1 SIMPLE/ring and tile encodings are reused. M2's 5/7 chamfer has different
semantics, so it cannot substitute for the required size-free kit transform. The coordinator owns module/content hooks.

The oracle copies actual mapgen/styler/hook/styleZones/context modules into a temporary directory, resolving all other
imports to real source. Only observational entry/exit/reservation taps and stateful-call assertions are added. Each run
must match the unmodified complete final map and actual hash before observations are saved. Three real plain attempts
cover seed 1, seed -1 and seed 4294967297/attempt 4294967296. All retain real callback/template planning. Every placement
attempt, including refusal, and every actual reservation is saved. It fails if any guard-state operation occurs outside
placement. Scorch's hard/open planning view retains the original runtime closures; it does not replace transaction hard.

Snapshots losslessly RLE encode full collision, terrain, ownership, write/reservation flags, scratch marks/queues and open
vectors; feature drafts/counters/epoch remain complete. Tests expand every cell after every ordered command, never use
hashes as array substitutes and never initialize counters from expected outputs. They also independently recompute the
real M3a prefix, protection, zone summaries (float bits), masks/fields and camp views. Shared state runs continuously
through all five zones; no per-zone post-hoc state injection occurs.

Nine honestly labelled direct source helpers cover the two actual seed-1 Holy requests under join cap 2, skipping the
failed first request, duplicate wall rollback/floor dedup/empty feature, a zone seam/reservation, zone and territory cuts,
a planning hard/open overlay with unchanged transaction closures, zero footprint and exact rim boundary. The budget
counterexample makes both requests fail; skipping the failed first lets the second place 27 walls. Alternative definitions
are inputs; expected counters never are. The original temporary diagnostic is preserved outside the repository at
`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/landmark-guard-trace.mts`.

Pinned generation/check: Linux x64 Node22.23.4, `node --import tsx tools/map-fixtures/landmark-runtime.ts [--check]`.
The isolated harness is `$PREFIX/landmark-runtime-tool`, target `$PREFIX/landmark-runtime-target`. Its directly included
DTO model has a harness-only dead-code allowance for parent-admission helpers; the managed leaf has no suppressions.
