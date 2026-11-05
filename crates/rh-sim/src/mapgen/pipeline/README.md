# Plain generator orchestration

`Pipeline` composes the actual accepted stages in `mapgen.ts` order. It exposes only
plain attempts: stage six is exactly `styleZones:null`; the actual five faction landmark
callbacks and elite bushes remain enabled by default. Styling must be added at the single
stage-six slot in this orchestrator, retaining the same stream, masks and remaining stages.
This module does not expose a second simplified generator.

Construct one accepted `FixedLayout`, then reuse `Pipeline::new(&fixed)`. Derived contexts
and parsed recipe templates are retained across attempts; map state and random streams
belong to an attempt. There is no process-global mutable cache, I/O, clock or entropy.

- `plain_attempt(seed, attempt, options)` returns one map or normal source refusal (`None`).
- `plain_attempt_with_trace` also exposes the refusing phase and observational cloned main-stream
  continuation words/pool lists. Prefix refusal is deliberately phase-level: the accepted prefix
  API does not expose its internal retry counters.
- `certified_plain` returns the first accepted attempt in 0..16, or `None`.
- `generate_plain(seed, None, options)` searches 0..64, returning typed exhaustion;
  `Some(attempt)` selects exactly that attempt and returns typed refusal when it fails.

Seed/attempt metadata uses the accepted safe-integer admission and binary64 retry arithmetic.
`decor`, `shape_gates` and `bushes` mirror source options. Plain runs produce no styler props,
so decor has no visible effect. Original picked-pool masks remain intact through loot/bushes;
spawn measurement and dropping run afterward, and only records receives the kept pool.
The bounded source scan 0..1599 found no plain gate drops; this is not a claim that none exist.

`Definition` owns only the source orchestration limits (16,64,250), also consumed by its
allocation-free content visitor. Geometry/protection/placement/terrain rules come from the
accepted definitions. Source rectangles are checked when converted into final DTO rectangles.
The spots API borrows the original Uint16 ownership through crate placement, including high IDs on
attempts that may later exceed the feature limit. It performs no narrowing or per-attempt owner copy. Ownership-width
source controls separately verify the crate boundary; this does not implement stage-six callbacks.

## Evidence

The canonical fixture is produced by unmodified source `certifiedMap` for all 200 original
`PINNED_PLAIN` entries, retaining complete DTOs (lossless byte-layer RLE only). Each pin must
match the unchanged original source pin file and its version-400 inventory. Eleven additional
actual source attempts have full output/null/hash equality with an observational module copy,
120 phase continuations, option/wide/negative metadata controls and a genuine seed2459/attempt0
camp-layout refusal followed by successful attempt1. Both retry wrappers have complete source
maps captured. The original pin file is never rewritten.

```
node --import tsx tools/map-fixtures/plain-pipeline.ts --check
cargo test -p rh-sim mapgen::pipeline --lib --locked
```

The source oracle refuses anything other than Linux x64 Node22.23.4. The strict fixture reader
rejects missing/unknown fields and malformed, empty, oversized or noncanonical RLE layers.
All 200 generated maps are separately checked with the independently authored frozen certifier
in unstyled mode and in its additional zone-check mode with strict styler-only rules disabled.
That certifier is a separate independently reviewed module, integrated by the coordinator. These checks do not make
`certified_plain` invoke the independent certifier in production or alter legacy acceptance.

No styled-generator, 200 styled pins, complete release or performance claim is made here.
A quiet M5 Pro release timing belongs after correctness and independent review; concurrent test
runtime is not a generator performance measurement.

A separate, off-core benchmark harness is retained at `plain-work/bench/` for the coordinator
after review. No clock is introduced into rh-sim, including its tests. The quiet reference
median remains unmeasured.
