# Gallows stage-six Rows

`Callbacks` owns shape and props only. The source has **no surface callback**: the registry must skip
that phase without creating a surface context or stream. The existing stage-four Gallows definition
owns the guard-house template and landmark policy; this leaf only borrows its template for decor.
Existing `style_features::{isqrt,viterbi_rows,viterbi_path}`, the runtime's route stretch limit, actual
phase contexts and sole prop catalog are reused. Planned-grid detour scratch is private to this leaf;
it does not read, restore or mutate the runtime's guard scratch. No shared seam or landmark port is added.

`Dials` is the resolved source factory configuration. `resolve_dials(PartialDials)` preserves omission
semantics: a supplied period with omitted phases creates the half-period stagger from the sole default
phase origin; explicit phases win. Missing fields take the defaults, while null/unknown/fractional integer
fields refuse. Admitted factory inputs have gapMin 1..64, gapMax gapMin..64, gapTarget 0..64, finite
gapPenalty 0..1000, period 1..64, width 0..period, 1..64 signed phases in -1024..1024, minRun 1..2048,
squares 0/1, and route open/repair/none. Unsupported JavaScript-number configurations are not silently
coerced. Grid inputs use the runtime's admitted dimensions/layers, and guard builders/baselines are real.

`Definition` contains the remaining Rows-only source constants, including score costs, square preference
lists, piece/check/iteration limits and prop noise decisions. Its constructor bounds state/cost arithmetic
and caps route checks at the source's six. `visit_content(definition, resolved_dials, word)` folds all
actual values once; the coordinator registers the default pair or the registry's actual resolved pair.
No separate catalog of template rows, prop IDs, route thresholds or Viterbi mechanics is maintained.

The typed `Plan`, `Row`, and `Square` preserve source order and all row/window/house reporting. Tests begin
with genuine captured pre-zone inputs, including earlier-zone layers, feature metadata and wrote/scratch;
expected post-callback plans and decisions are never supplied to production code. Six real caller inputs
and 23 labelled direct cases compare complete phase/final plans, layers, feature owners/logs, props,
reserved/wrote, scratch, counters, and independent RNG continuations. Virtual surface snapshots remain
unchanged and create no stream. Source controls require identical complete final map/null and mapHash.
The two factory route modes and ordinary repair use actual `walkField16` fields and the genuine guard.
A dense-row partial-guard fixture exercises seven post-write releases on ordinary walls/protected cells.
A short protected-row factory boundary preserves the source retention rule: its six-tile row stays
recorded and stretch remains 1041. This is reported as source behavior, not variant certification.

Boundaries cover axis selection, empty boxes, square/no-square, even/odd period auto phases, explicit
negative phases, row spacing/ties, all-open gates, zigzags, detour/piece trimming, limited guard budgets,
route-open/repair/none, prop protection/caps and actual guard-house decor. Another 572 gate, 24 phase and
14 gate-distance calls come directly from the actual source exports. Fixture tests enforce exact sections,
fields/names/source inventories, duplicate object/input refusal, canonical RLE, checked integer narrowing,
malformed-plan atomic refusal and every numeric content field. All source hashes are recorded.

Canonical capture uses cached Docker image `c86ecead9e55` with `--pull=never --platform linux/amd64` and
read-only Linux x64 Node 22.23.4:

```text
/node/bin/node --experimental-transform-types tools/map-fixtures/style-gallows.ts --check
```

`RH_STYLE_GALLOWS_OUTPUT` overrides the capture/check destination. Temporary extension-resolved source
copies receive caller/context observations only; the original callback/factory algorithms produce every
answer. Only elapsed `StyleResult.ms` telemetry is omitted. This is callback-leaf parity with genuine
injected prefix inputs; full native styled generation and finished-map pins remain coordinator work.
