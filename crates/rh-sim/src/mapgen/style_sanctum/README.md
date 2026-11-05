# Holy stage-six callbacks

`Callbacks::new` borrows the existing stage-four Sanctum definition/template and recipe scale definition,
resolves six prop keys against the sole `terrain_gate` prop catalog, and admits the callback policy.
`shape`, `surface`, and `props` operate only through the accepted phase-specific runtime contexts.
The coordinator registers this module and folds `visit_content` after the shared prerequisite definitions.
The callback definition owns the shrine-line bonus/width, outer-bay radius threshold, measurement
budgets and decor salts/density. The shared runtime owns `route_stretch_max`; the stage-four Sanctum definition owns hall pitch,
radius bounds, minimum pier count and pier scoring. No second shrine or prop catalog is present.

`Plan` preserves every source field and its order-sensitive lists: requested versus standing piers,
light bays, lit bays, raw planned floor, feature ID, route stretch/measurement count and shrine lights.
Shapes use the shared source-exact scan, then bounded worst-member corridor thinning, fallback,
group placement and narrow `set_hall_pier_count` correction. Surface re-stamps the shared shrine
and keeps bay lighting out of its cells. Props preserve source kind, order, hash salts and variants.
Continuation plans are checked before writes for invalid dimensions/indices, carriers and limits;
they are internal callback state, not authenticated external gameplay inputs.

## Source evidence

`tools/map-fixtures/style-sanctum.ts` executes original `tryAttempt` calls and an observational copy
of its caller chain. All actual source rules and faction callback modules are unchanged. Every actual
case requires deep equality of the complete final output (including a null result if encountered)
and equal source `mapHash`. The six pinned actual attempts all finish with a map; this fixture does
not claim to exercise a terminal-null attempt. Decor is enabled and disabled, and seed/attempt high
word aliases are included. All 75 original TypeScript source hashes are recorded.

Ten labelled direct source contexts cover full/empty halls, vertical axis and minimum radius,
partial piers, fewer than four accepted groups and rollback, existing/protected surfaces,
prop exclusion, route thinning, repeated decoration reaching the source prop cap, and two real
source-stamped shrines whose offset line changes the selected hall centre.
The repeated decoration case deliberately calls the real props callback eight times; it is not a
generated-map case. Every capture stores input, post-shape, post-surface and final layers, ownership,
ordered feature/prop records, plan, all scratch buffers, reserved/wrote masks, counters, and each
phase RNG/noise seed with four continuation values. Holy consumes no sequential RNG draws.

Replay invokes these native callbacks, not recorded operations. A narrow test-only runtime helper
restores **source-captured input scratch**, including earlier zones' prerequisite work; this proves
the Holy leaf on actual inputs, not native execution of earlier faction callbacks. Full integration
must retain runtime state while running all native factions in source order. The runtime-owned shape
repair is executed between shape and surface for actual caller cases.

The fixture parser rejects duplicate raw JSON keys recursively, requires exact case/unit/source
inventories, rejects unknown/missing fields, narrowing overflow, off-grid camp coordinates and noncanonical RLE,
compares complete states and
checks malformed continuation refusal leaves the runtime unchanged. Callback definition fields
are exhaustively destructured and individually checked against the content visitor.

## Reproduction

Canonical capture/check use cached image `c86ecead9e55` with `--pull=never --platform linux/amd64`,
read-only source, private output and executable temporary dependency storage. The image starts a
different Node version; install and explicitly invoke `node@22.23.4`. The capture rejects anything
except Linux x64 Node 22.23.4. Set `RH_STYLE_SANCTUM_OUTPUT` for private output; `--check` is byte exact.

Targeted native checks: `cargo test -p rh-sim --lib style_sanctum`, the six existing `direct_family`
regressions for the shared scan extraction, formatting and strict Clippy. Frozen handoff evidence
records semantic mutation results. No full generator, styled map pin, full-game or performance claim.
