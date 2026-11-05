# Pure style feature kit

This module ports the `features.ts` helpers before the route guard. It owns geometry not already ported,
node graphs, fields, smoothing, components, and searches. The sole numeric definition and its ordered
`visit_content` fold cover the local weights/defaults/sentinels. The coordinator registers that visitor.

Existing `recipe_support` helpers and its `Node`/`Noise` types are reexported; `pseudo_angle` comes from
`zones`, fBm comes from `style_runtime::noise_fbm`, and `DIR8` is derived by rotating the accepted topology
ring. Route guards, connectivity repair, landmark recipes and complete style callbacks remain outside
this module. None of these functions draws a random stream. The currently used stylers need no other
`kit.ts` geometry export; their only kit import is the shared DIR8 encoding.

Inputs are borrowed. Grid helpers require positive dimensions and exactly `w*h` cells. Coordinates and
indices follow actual generator integer domains (geometry retains f64 arithmetic where the source uses
Number). Graph edges must reference existing nodes. Path endpoints are valid grid indices, costs are
nonnegative Int32 values, and noise is the accepted stateless `Noise`. Viterbi offsets fit signed bytes
(`half` is 0..127); row/field coordinates and their arithmetic fit i32. These are producer preconditions,
not a new untrusted-input admission layer. Definitions are trusted content; algorithm weights must remain
nonnegative and dimensions/weights must not overflow the source Int32 domains.

`disc_offsets` returns a fresh owned list in source order instead of a mutable global cache.
`PathSource` reads immutable protection data on each invocation, avoiding a global context cache.
`PathCost` accepts no extra cost, a borrowed map, or a pure callback; callbacks are sampled once per
encountered tile. `majority_smooth` accepts `None` for the sole definition's default threshold.
`add_shortcuts` appends to its edge argument and returns only the edges it added.

The checked-in source oracle has 232 complete helper cases (205 explicit boundaries, 27 first real-caller
inputs), 14 complete path cases in all cost modes including unreachable/self, and 26 Viterbi path cases.
Tests compare arrays, graph insertion order, in-place mutations, binary64 scalar bits, callback call
order, and every numeric definition/content field. Normal cargo tests enforce exact fixture section/origin
inventories, duplicate/unknown refusal, a canonical byte-integrity fold, and checked scalar narrowing. The fixture inventories all 26 pre-route exported
functions, naming seven reused and nineteen owned exports, and hashes 39 transitive source files.
Three observational generator attempts preserve complete final output/null and mapHash.

Canonical capture/recheck uses cached image `c86ecead9e55` with `--pull=never --platform linux/amd64`,
mounts the existing Linux x64 Node 22.23.4 binary read-only, and invokes:

```text
/node/bin/node --experimental-transform-types tools/map-fixtures/style-features.ts --check
```

No production source file or pin is rewritten. A recursive temporary `.mts` import closure only inserts
entry observations; the original exported function bodies still compute every captured result.
Capture output is byte-checked, the export inventory is exact, duplicate boundary inputs refuse, and
repeated identical observational inputs are explicitly counted. The capture does not certify the full
styled generator or update finished-map pins.
