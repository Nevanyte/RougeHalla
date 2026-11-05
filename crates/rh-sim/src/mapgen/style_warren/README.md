# Warren stage-six callbacks

`Callbacks` builds from borrowed Warren-only dials, the existing common scale/fixed-layout definitions,
the existing stage-four Warren template definition, and the sole prop catalog. It exposes typed
`shape`, `surface`, and `props` phase callbacks and a source-shaped `Plan`; it contains no landmark
callback, generator orchestration, or finished-map pins. The coordinator owns module/registry/content
registration. `visit_content` folds every local dial in declaration order; common route limits,
scale, template and prop identities retain their existing owners.

Planning preserves source road order, quarter-tile radius shrink, candidate score/ties, lazy open-ground
classification, noisy rock order, core/fringe clip fallback, wet-side tie, four-connected crescent
piece discovery, route pruning, tunnel priority/fallback and trim transactions. Surface and decor use
only their phase contexts. Fresh owned disc lists replace source global caches; output order is unchanged.
No callback consumes RNG; all variation uses accepted stateless `Noise`.

Two narrow proposed shared seams are excluded from this leaf's handoff: `recipe_support::CampNodeInputs`
and `camp_nodes_from` share the existing camp-node body with the old landmark wrapper, and the existing
stage-four Warren `Road`/`roads` become crate-visible. The old landmark callback is unchanged. All 37
existing landmark/support/template/search/stage tests pass after those source-preserving seams.
The cfg(test)-only input-prefix restoration seam is the same proposal used by the Holy callback leaf.

The source oracle records six genuine pre-Plague generator inputs and fourteen labelled direct source
cases: open roads, no/short/exact-minimum roads, partial/zero wall budget, protected ground, corridor
core/fringe and route pruning, prop protection/cap, and actual burrow road exclusion/rubble. The two pruning fixtures use unmodified `walkField16`
outputs (one with actual obstacles) and the genuine route guard; no guard return or adjusted baseline
is injected. Native
callbacks start from captured input layers, earlier-zone wrote/scratch, and stage-four feature metadata;
no expected post-callback plan or decision is supplied to production code. Shape, surface and final
states compare complete plans, tiles/terrain, owners, features/props, wrote/reserved, scratch, counters,
and all phase RNG continuations. The generator controls compare complete final map/null and mapHash
against unchanged source exports. Elapsed `StyleResult.ms` is omitted because it never feeds rules.

Canonical capture uses cached image `c86ecead9e55`, `--pull=never --platform linux/amd64`, and the existing
Linux x64 Node 22.23.4 binary mounted read-only:

```text
/node/bin/node --experimental-transform-types tools/map-fixtures/style-warren.ts --check
```

All source imports are prepared as temporary extension-resolved copies; only the caller/context chain
receives observation taps. Every captured helper/callback result still comes from the unchanged source
algorithm. The fixture records all 75 source hashes. Normal tests enforce exact field/name/source and
phase inventories, canonical RLE, unique JSON object keys, checked integer conversions and complete
consumption. Invalid continuation plans refuse before surface/decor writes. This evidence covers one
callback leaf and genuine injected inputs; it is not a full native styled-generator or pin claim.

Set `RH_STYLE_WARREN_OUTPUT` to write or check a separate capture destination; the default remains the
checked-in `style-warren.json` fixture.

Admitted jitter definitions keep `512 * jitter_scale / jitter_divisor` finite and below 3.5, so the
source sampling/cache and guaranteed/possible disc shortcuts stay within their exact -3..3 envelope.
Default and zero jitter are accepted; oversized ratios and tiny divisors refuse before any callback.
