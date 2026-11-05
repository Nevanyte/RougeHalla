# Stage-six style runtime prerequisite

This leaf ports `zoneStyle/context.ts`'s guarded operations/transactions, `features.ts::makeRouteGuard`, and
`kit.ts::{floorComponents,repairConnectivity}`. It does **not** run the five faction style callbacks, dispatch stage six,
finish the styled generator, certify a map, or establish styled pins. Stage-four landmark runtime remains unchanged.
Other `features.ts` geometry/graph/field/search helpers needed by the eventual callbacks are still a separate seam.

## State and public API

- `State::new(w,h,tiles,terrain,props,features,feature_owner)` admits owned initial arrays and starts the whole style
  pass's zero `wrote` and scratch. Retain one State across zones. Its arrays/counters are not externally mutable.
  `into_layers()` returns durable `Layers`; pass-local buffers are discarded.
- `Geometry::new(index,faction,zone,tiles,w,h,camps)` recomputes the source mask, 3/4 chamfer, summary and zone camps
  from **current** collision. It borrows the accepted landmark geometry algorithm without changing that module;
  its own admitted dimensions prevent equal-area transposed-grid confusion.
- `no_block(protect,extra)` implements whole-pass precedence: nonzero protection forces byte 1, otherwise retain the
  optional caller byte. The dispatcher must use `noProp ?? protect`, filter spawns by the current zone mask, and retain
  shared noBlock/noProp/wrote/features/owner/scratch across zones, just as the source does.
- `Runtime::new(&mut state, Inputs{...}, Metadata{...}, &Definition)` starts one zone with fresh counters, reservations,
  log and lazy route guard. It does not draw a main RNG stream. `shape_context`, `surface_context`, and `prop_context`
  create distinct phase writers with fresh private streams 0/2/1; `BaseContext` is immutable. Only shape can place
  blockers/features or reserve/release. Context stream/noise keys use source `hashSeed(seed,attempt,zone,stream)` and
  `stream+100`; source safe-integer inputs retain their low 32-bit semantics.
- Shape operations are `can_block`, `block`, `release`, `open`, `reserve`, `is_reserved`, `fence_detour_ok`,
  `place_feature`, `route_guard`, and `worst_stretch`. A readonly base exposes ownership and zone features. The one
  source write through the nominally readonly feature view is explicitly `set_hall_pier_count(id,count)`: Holy's
  existing Hall `p[3]`, bounded by possible 3x3 piers. No arbitrary feature setter is exposed.
- Surface and prop contexts expose their source operations. Metadata borrows existing terrain and prop rows and tile
  scale. `terrain_gate::PropKind.home` is the sole prop-home authority, typed as `Option<Zone>` and folded by that table's
  content visitor. There is no parallel home array or second production catalog. The canonical oracle checks all34 rows.
- `finish_shape(before_components)` performs the source conditional repair after shape and before surface. It returns
  `(components,repaired)` and intentionally does not refund runtime counters or feature ownership for safety-net
  openings. Stage dispatch must carry the cached component count across zones and build the route guard before first
  shape write when centreWalk and members exist. Standalone `floor_components` and `repair_connectivity` preserve
  their distinct queue orders, largest-component ties and source stale component-label behavior.

## Exact semantics and admitted domain

Whole/trim/group transactions retain write order, first-appearance group order, duplicate LOW-to-wall writes,
reverse rollback/give-back, class-specific eight-connected piece sizes, stand-share counting before final tile
uniquing, optional-vs-empty floor stamp behavior, first owner, and feature-log order. Join budget and refusals survive
rollback. LOW promotion is a distinct early branch: it bypasses floor-only rim/reservation/noBlock/ICE/detour/support
checks, keeps the old terrain kind and refunds only a LOW this pass wrote. Off-grid integer fence-detour queries remain vacuously true, without scratch writes. Release similarly has no zone/ownership
check; signed counters preserve the source in that case. Ordinary floor writes retain every zone/territory join,
seam, LOW support, ICE adjacency, hard/rim/reservation/owner and footprint barrier.

Surfaces distinguish hard protection, noBlock byte **1** from margin byte **2**, landmark ownership, corridor slowdown,
ember adjacency and full ICE floor ring. LIGHT still respects hard protection. Props check the separate noProp mask,
class, faction home and per-zone 8% cap; repeated props on one tile remain allowed.

Route guards keep source member order, baseline costs, pulled-and-dilated corridors and per-member tile order,
outside-zone seed selection/ties, private candidate-wall probes, scoped 5/7/11 field, worst-member ties and cutoff.
They read current collision on each stretch query but retain the pick-time baseline/corridor. Accepted topology helpers
are reused unchanged. No process-global mutable cache is introduced.

Typed admission precedes mutation: positive dimensions with at most 2^21 cells (source route index packing), matching
layers/dimensions, recognized physical codes and the required fixed source terrain IDs (none0 through light7) and valid owners, finite safe seed/attempt metadata, matching prop
table bounds, finite positive tile scale, and bounded policy/feature lengths. Reordered required terrain IDs are refused; repair therefore always clears to source NONE=0. Owner overflow beyond Uint16 is
refused before a transaction. Route baseline costs plus worst grid path cost stay below the shared field's signed
sentinel. Fence detour depths stay within Int16. Policy validation rejects nonfinite/negative percentages/rims,
excessive joins/costs/pieces/group/share limits and stream-offset overflow. Invalid indices that the source treats as
ordinary refusals remain refusals; malformed structural input is a typed `Error`. Exact parity is claimed in this
explicit admitted domain, not for JS undefined accesses, overflow-alias artifacts or unbounded custom definitions.

`Definition` is the single runtime policy read by allocation-free `visit_content` (16 words, including the shared 1030-permille route stretch ceiling consumed by faction callbacks). Shared terrain/prop
identities and tile scale are borrowed; their existing visitors remain coordinator-owned. Runtime work is off tick;
this leaf makes no new performance claim and performs no algorithmic optimization.

## Oracle and tests

`tools/map-fixtures/style-runtime.ts` copies actual source modules into a temporary directory and adds observational
context/route taps. Four real `tryAttempt` calls use the public default hook and all five real stylers, with both decor
settings and signed/wide seed arithmetic. Every call requires complete final map/null equality **and** `mapHash`
equality with the untouched caller. Twenty zones replay continuously on one Rust State per attempt. Fourteen explicitly
labelled direct-source boundary cases and three source repair cases cover guard edges absent from normal maps.

The fixture retains 285,680 context/route/noise/RNG events: 222 feature requests, 45 stretch queries, 9,161 surface
calls, 1,725 prop calls and 1,220 RNG draws, plus four continuation words for each created stream. Numeric operation
tuples and RLE/sparse array deltas are lossless encodings, not semantic normalization. Rust executes operation inputs;
results, counters and expected state are assertions and are never injected into the runtime. Initial scratch/wrote are
constructed by Rust; later zones reuse them. Every captured mutable-state delta and complete zone-end state compares
all layers, props, features, ownership, reservations, scratch arrays, epoch and counters. Route seed/corridor/private
probe state compares too. Read-only calls and exact noise results are replayed in order.

Only `StyleResult.ms` is omitted: elapsed clock telemetry cannot feed gameplay, plans or map output. Callback `plan`,
source final map hashes and full source provenance are **captured-only evidence**, not claims of native callback/hash
execution in this leaf. Their exact bytes are pinned along with the whole fixture by a test-only integrity digest.
The source `--check` is the authoritative byte reproduction check. Recursive duplicate JSON keys, unknown fields and
operations, wrong arities, wrapped numbers, duplicate/missing streams, noncanonical RLE and empty/overlapping/reordered/
unchanged sparse patches are refused. Exact case, zone, event and stream inventories prevent deletions from passing.
Malformed definitions, dimensions, ownership capacity, route costs and feature metadata have no-write tests.

Canonical capture requires Linux x64 Node 22.23.4. The producer used image
`sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c` with `--pull never --platform linux/amd64`,
repository mounted readonly and executable container-local node_modules. Run:

```
node --import tsx tools/map-fixtures/style-runtime.ts
node --import tsx tools/map-fixtures/style-runtime.ts --check
cargo test -p rh-sim --locked --lib mapgen::style_runtime
cargo clippy -p rh-sim --all-targets --locked -- -D warnings
```

`RH_STYLE_RUNTIME_OUTPUT` may redirect capture output. No production source, shared status, Cargo.lock, dependency,
wire, Unity, cloud or DNS change belongs to this leaf. The coordinator has registered the module/content hook and unified
prop-home metadata after bounded independent acceptance. Faction callbacks, stage-six dispatch and the full styled pipeline
remain separate work; their absence is not a successful styled-pin result.
