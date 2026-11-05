# Landmark template and stamp leaf

This leaf ports the pure template/stamp boundary used by `zoneStyle/landmarks.ts`: template cell parsing, all eight mirror/rotation
orientations, declaration-order stamp lists, greedy requirement rectangles, sparse-grid admission, width-dependent offsets,
`stamp_fits`, and the handoff to the actual whole-wall landmark runtime. It does not choose templates, search candidates, or own
faction recipes. The five current template definitions are captured as source-backed fixture inputs, not embedded as Rust rules.

Mirroring occurs before clockwise rotation. Lists retain original non-underscore template cell order after transforming their
coordinates. Requirement rectangles are greedy row-major rectangles, with wall rectangles emitted before floor rectangles; a
fully occupied template box omits floor rectangles. Stamp bounds check only non-underscore cells. `stamp_fits_with` accepts the
callback's planning hard/open view explicitly; placement still uses the runtime's original transaction closures. Successful
placement sorts the feature parameter door payload while reserving doors in stamp order.

`LandmarkTemplate::jobs` retains the source feature-job order. `parse_template` reports source cell/ragged-row failures, while
`templateProblems` remains a separate source diagnostic and is not run implicitly by parsing. Empty row sets retain their source
behavior. The dimensions and coordinate scratch follow the legacy Int16 storage semantics. The source caches each relative linear
offset through Int32 before adding the origin; that wrapping is preserved. A wrapped result outside the positive, i32-indexed
runtime grid is refused, so legacy overflow artifacts cannot alias a real tile. Runtime grid area is bounded to `i32::MAX`.

The fixture oracle runs the real generator in an isolated copy of the mapgen-to-five-stylers source chain. Its only source changes
are import rewrites and observational taps at the actual template helpers, writer context, and landmark stage input. Each tapped
run must equal the complete unmodified `tryAttempt` result (including `null`) and `mapHash` before its observations are saved.
Planning arrays are losslessly RLE encoded and compared cell by cell. Actual callback stamps, fit inputs/results, feature writes,
reservations, and final whole-wall runtime snapshots are included. Directly labelled helper cases cover sparse bounds, changing
grid width, parser diagnostics, fit refusal, gap edges, sorted payload doors, original reservation order, and no reservation on
placement refusal.

Capture or check on Linux x64 with Node 22.23.4:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx --yes --package node@22.23.4 node --import tsx tools/map-fixtures/landmark-templates.ts
npx --yes --package node@22.23.4 node --import tsx tools/map-fixtures/landmark-templates.ts --check
```

Rust differential tests are checked into this leaf and wired into the shared `rh-sim` module. This leaf does not claim complete
generator, search, callback-selection, or pin parity.
