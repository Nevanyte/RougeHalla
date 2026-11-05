# P-MAP-1 M2a: exact pre-styler zone partition

This module ports the actual `partitionZones` path in `packages/shared/src/zones.ts`, ending before `placeCamps`.
`ZoneContext::new(&fixed_layout)` owns derived annulus/ring/clearing tables while borrowing the fixed layout.
`partition_zones(&context, &mut rng_callback)` yields the source's internal zone IDs and complete integer cost layer,
or `None` after all retries. The callback supplies finite values in [0,1); it is never replaced, reset or sourced from
entropy by the module. There are no I/O, clock reads, mutable global caches or changes to existing map exports/pins.

The public helper APIs are `pseudo_angle`, `chamfer`, `chamfer_labels`, `ring_contact` and `sliver_counts`. Grids have
exactly the existing registered 160x160 dimensions. Heaps retain the source's packed cost/tile keys, strict comparison
semantics and duplicate entries; smoothing and boundary trades retain in-place row-major and neighbour order.
Arithmetic-only angular sorting, integer noise and JavaScript rounding/order are preserved. The general camp-stage
Voronoi routine is deliberately absent because M2a does not call it.

`DEFAULT_DEFINITION` is the sole source of 28 partition tunables, including formerly inline thresholds/weights.
`visit_content(&definition, callback)` emits their declaration-ordered integer words/IEEE bits without allocation.
`ZoneContext::from_definition` rebuilds every derived table from that same definition; tests do not change rules while
retaining tables built with other rules. Definitions must preserve the algorithm's valid scale, geometry and packed-key
bounds. This is rule data for content accounting, not an untrusted runtime configuration interface.
`ZONES` derives from the existing faction table, `N` from registered dimensions, and `KEY` is the legacy heap encoding.

The oracle tool `tools/map-fixtures/zones-partition.ts` imports and calls the real TypeScript functions. It captures:

- Actual generator-prefix pillar draw and real Fisher-Yates faction shuffle, consuming five words before stage 2.
- A bounded scan of real prefixed Mulberry streams 0..1023: 1024 successes, 398 with failed `zoneSliver` retries, zero
  terminal failures. A terminal-failing generated-map seed is **not** claimed.
- Eight complete zone/cost/helper-array cases, exact consumed RNG words and eight continuation words, including seed -1,
  wider-than-u32 seed 4294967297, large attempt 4294967296 and a separate fresh-stream call.
- A separately labelled direct actual-function call with an injected constant-zero RNG: `partitionZones` returns null
  after 1888 draws, with eight `zoneSpine` failures. This is a valid injected-function unit input, not a map seed/pin.
- Complete binary and labelled chamfer outputs for four masks and 80 rational pseudo-angle cases (including signed zero
  and the actual NaN-at-origin behavior).

Generate/check using Linux x64 Node 22.23.4 and `node --import tsx tools/map-fixtures/zones-partition.ts [--check]`.
The fixture lives beside the earlier foundations fixture at `mapgen/fixtures/zones-partition.json`. Tests compare full
arrays and exact draw transcripts/continuations rather than substituting hash-only assertions; the full bounded scan
also compares every success/retry outcome. A custom-rule test checks every visitor field, real generation changes and
freshly rebuilt derived geometry.

Not implemented here: camp placement, Lloyd/Voronoi territories, camp spots, post-styler territory repair, faction
contract renumbering, stylers, full attempt orchestration, independent certification or seed-map hash parity. The capture
uses JavaScript's actual attempt-seed arithmetic and records the resulting uint32 stream input; this module accepts an
already injected RNG and does not claim to port complete attempt initialization.
