# Plain and styled generator orchestration

`Pipeline` composes the actual accepted stages in `mapgen.ts` order. Plain generation runs
with `styleZones:null`. Styled generation runs all five faction callbacks at the same stage-six
slot, preserving the main stream, original pool masks and remaining stages. Both modes retain
actual faction landmarks and elite bushes by default.

Construct one `FixedLayout`, then reuse `Pipeline::new(&fixed)`. Derived contexts and definitions
are retained across attempts; map state and random streams belong to an attempt. The implementation
has no process-global mutable cache, I/O, clock or entropy.

- `plain_attempt` and `styled_attempt` return one complete map or a normal source refusal (`None`).
- Their `_with_trace` variants also return the refusing phase and observational cloned main-stream
  continuation words/pool lists. Styled traces include `Styler` at the source lap, before hook
  breach refusal and original-pool hazard clearing. Plain traces preserve their original twelve phases.
- A styler's `style_runtime::Error::Landmark` (it cannot build round a signature landmark; option on only) refuses
  the attempt (`Refusal::StyleLandmark`) before the `Styler` trace; any other styler error fails the call.
- `certified_plain` and `certified_styled` return the first accepted attempt in 0..16, or `None`.
- `generate_plain` and `generate_styled` search 0..64 when the attempt is `None`, returning typed
  exhaustion. `Some(attempt)` selects exactly that attempt and returns typed refusal if it fails.

Seed/attempt metadata uses safe-integer admission and binary64 retry arithmetic. `decor`,
`shape_gates` and `bushes` mirror source options. The styled registry uses separate public-map
streams for each faction/phase, with one shared state across zones and fresh per-zone runtime.
The source generator's post-hook contract runs before T8 clears floor hazards in the original
pool's 5x5 mask. LOW terrain remains there as in the source. Safety nets, crates, territory repair,
terrain cleanup and final terrain acceptance all receive the actual styling mode.

Original picked-pool masks remain intact through loot and bushes. Spawn measurement and dropping
run afterward; records receives the kept pool. The spots API borrows the original Uint16 ownership
through crate placement, including high IDs on attempts that can later exceed the feature limit.
It performs no narrowing or per-attempt owner copy.

`Definition` owns the source orchestration limits (16,64,250), consumed by the same content visitor.
Geometry, protection, placement, registry and terrain policies retain their existing definition
owners. Source rectangles are checked when converted into final DTO rectangles.

## Source evidence

All 200 original `PINNED_PLAIN` entries and all 200 original `PINNED_MAPS` entries match complete
native DTOs. Styled coverage includes the ordered decor props, which the source map hash omits.
The styled capture binds the existing `map-certify.json` bare-map backbone by SHA256, recomputes
all 200 actual bare source maps and separately verifies that enabling decor changes only props.
Lossless byte-layer RLE reduces fixture size. The source pin file and version-400 entries stay intact.

Eleven additional actual plain attempts cover 120 phase continuations. Sixteen additional actual
styled attempts cover 195 continuations, option combinations, negative/wide metadata and genuine
seed2459/attempt0 camp-layout refusal followed by successful attempt1. Source observational copies
must preserve complete DTO/null/hash outputs. Certified/generate retry wrappers and explicit
attempt success/failure are covered. Strict fixture readers reject missing, unknown, duplicate,
malformed and incomplete evidence.

The separate post-hook corpus covers 37 labelled cases, 1,944 Cartesian combinations and six
original-pool hazard cases. Independently captured diagnostics agree; T8 masks come from the real
source pool-mask statements and native `SpawnContext::pool_masks`. Sparse inputs are labelled
helper probes, without a full-generator reachability claim for every combination.

All 400 pinned maps pass the independently authored hard certifier in base and additional zone
modes (800 checks); styled zone checks include all strict faction windows. The certifier reads
finished DTOs independently. Production retry wrappers preserve source generator acceptance.
Native generated maps also enter the ordinary eight-bot headless path with a 200-tick cap,
checkpoint continuation and serialized replay, retaining complete admitted map metadata.

```
node --import tsx tools/map-fixtures/plain-pipeline.ts --check
node --import tsx tools/map-fixtures/styled-pipeline.ts --check
node --import tsx tools/map-fixtures/styled-controls.ts --check
node --import tsx tools/map-fixtures/style-contract.ts --check
cargo test -p rh-sim mapgen::pipeline --lib --locked
cargo test -p rh-headless --test map_loading --locked
```

Canonical source bytechecks require Linux x64 Node22.23.4. Standalone registry/open-map proof is
recorded with `style_zones`; full gameplay, map-pool operation, public map transport and release
remain separate work. Concurrent test duration supplies no generator or rendering performance
measurement. Quiet M5 Pro release measurements remain pending.
