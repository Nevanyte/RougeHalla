# Declared LOS elapsed correction

Code-only follow-up to a4ece57e4f7e5c233e6c80a8663f43ca99be74b7. Root approved the
minimal correction described in the independent first-capture diagnosis
SHA256 61888923065d6d54ba8929ecbc28e244e817ae9a82f7609b2097e49237d35257.

The first offline capture ran once on Node22.23.4/linux/x64 and failed exit1:
`los-before` rejected its setup with elapsed1500. Its only output is retained,
unmodified, at `offline-790-corrected-review-01/captured/observations-before-verification.json`:
145577 bytes, SHA256 3ad4fa1e7040c524026f0aab2bd5a816fffbb1effc6421fad7e8fe7774db0daa.
No source.json or verification.json was published. The external raw receipt is
`coordination/reports/walkhint-a4ece-phase-b-first.json`; the failed stage is not admitted.

At the actual setup clock, at2150 minus nextUp650 rounds to exactly1500.
The recipe now chooses the adjacent elapsed input nextDown1500 first and derives
the declared historical lock timestamp by subtraction. An exact round-trip guard
must pass before the existing strict before/equal assertion. For this clock,
targetElapsed1499.9999999999998 produces lostAt650.0000000000002 and the same
actual elapsed. Equality remains lostAt650/elapsed1500. This corrects the input's
representability; the actual source helper still supplies the answer.

Only this LOS construction/guard and its elapsed diagnostics change. All other
23 context recipes, the24 IDs, geometry, ordinary setup steps, outcome assertions,
source APIs, build/runtime safeguards, source pins and legacy70433 bytes remain
unchanged. The other23 retained observations match their declared checks, but the
whole capture failed. Direct direction inputs yielded255/0/0; Cartesian placement
collapsed to one endpoint/angle and255/255/255, so path-direction transition
coverage remains OPEN. No favorable-input search or assertion relaxation is made.

The proposed fresh run root is
`docs/evidence/walk-hint-helper-boundaries/offline-790-corrected-review-02`.
It has not been created. No build, scenario import, World execution, capture,
bytecheck or semantic control was performed for this correction. Root must review
and authorize a new host-build-only operation with this new sealed head, then
independently review its generated hashes before any separately authorized runtime.
The failed01 directory must not be reused, rewritten or deleted.
