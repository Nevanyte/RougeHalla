# Actual legacy terrain witness

`source.json` is parity evidence from the unmodified TypeScript source at
`d00e5e52f0b981c7c8afb6c721ddcaae7d29864b`. It is not gameplay training data.
Expected values were produced by executing that source, never derived from Rust.
The corpus contains server-private test state; it must never be served as a client observation.

Canonical witness: official Linux amd64 Node22.23.4 Docker image pinned by digest in
`tools/terrain-fixtures/capture.sh`. `npm ci --ignore-scripts` uses the repository lockfile;
`tsx` executes actual source with the repository ES2022 target. Runtime, compiler versions,
130 source/lock/compiler/harness hashes and explicit controlled RNG provenance are in the file.
The 129 original source/lock/compiler files were compared with the integration checkout: zero differences.
Every world's complete main-stream draws are recorded in exact order. Reward and quest streams
use declared synthetic salts; generated IDs are sequential. `Math.random` throws.
No production state, user data, live service, Rust output or undeclared entropy is consulted.

Run one canonical recapture/compare:

```sh
tools/terrain-fixtures/capture.sh --check
```

Capture a proposal into a new temporary directory:

```sh
tools/terrain-fixtures/capture.sh
```

An alternate directory can be selected with `RH_TERRAIN_DIRECTORY`. The script mounts the
source read-only, installs dependencies into a temporary in-memory mount and writes only the
selected output. Capture and check each execute the harness exactly once; neither command
performs an implicit additional recapture.

## Format and roles

`rh-terrain-source/1` separates declared `input` from actual source `expected` or `frames`.
Numbers remain full JavaScript precision. Nonfinite private clocks encode as exact strings
`-Infinity`, `Infinity`, `NaN`; fixtures never silently replace them with null.
Actor rows have explicit `kind: player|mob`. `state` is a selected source schema snapshot,
while `private` contains server-only path/history/slide/status/credit and optional faction runtime.
`slipPathIdentity` distinguishes a path array replacement. Shared-walk snapshots encode
`slip.path` as `current`, `other` or null so identity is testable without leaking a runtime pointer.

- `surfaceCases`: 55 actual surface/effect/hazard lookups across all eight terrain IDs,
  neutral plus every faction, and exact/out-of-range tile boundaries.
- `runtimeCases`: 66 cases and263 frames. Every case uses actual `createWorld` or
  `createGameWorld`, actual exported installers, `addPlayer`, `startRaid`, actual regional
  `placeMob`/`addMob`, declared trusted setup, and ordered source calls. A setup frame precedes
  all actions. Ordinary `step` cases use the complete production assembler with signatures
  disabled explicitly, and enqueue real movement input. The three ordinary surface traces
  each run24 ticks; one additional ordinary lethal tick captures the exact5s credit boundary.
- `walkCases`: 11 trajectories and242 frames from actual `slipWalk` (which calls actual
  `slipStep`), including acceleration, braking/arrival, stop/turn/root, fractional/substepped
  dt, path replacement, surface crossing, sweep/replan throttling, backward clock clamp,
  and a full T-junction stuck/grip/arrival continuation.
- `velocityCases`: six actual `tickVelocity` history edge cases.
- `sweepCases`: 56 actual `sweepX`/`sweepY` long and tiny deltas at corner/radius boundaries.
- `regripCases`: five actual `regrip` clear/blocked/empty/unreachable path outcomes and
  returned-array identity.
- `mathCases`: 32 actual `slipAccel` and `resistSlow` numeric boundary results.

## Runtime coverage and interpretation

Mode matrix: Off/Map/All × ember/bog/ice/light × all five factions. Holy's light rule
is a boost, not an exemption, and Sentenced has no hazard exemption. Off still permits a
caller to inspect `surfaceOf`; the installed passes and traction are what the switch disables.

Ember covers installed ledger entry shape/order, true damage, barriers, teleport immunity,
lethal overkill, death floor accounting, mixed rival/terrain ledger, recent-rival credit at
5s ±1e-6ms, locked gates, all regional factions, a returning mob and a dummy. Full Frost and
Sentenced NPC constructors are captured even where their native admission prerequisites remain.

Bog covers clamped slow resistance, multiplicative composition, positive floor and exact root.
The probe records only actual source modifier outputs. Its explicit trusted `base` modifier
is installed before a real `step`; final authoritative displacement witnesses the source floor.
The harness does not copy the floor formula into expected values.

Light covers player-only eligibility, both independently active3s clocks at ±1e-6ms,
landed victim/dealer clock stamps, quiet accumulation, the0.5 heal threshold and1000ms
window boundary, dead-player report suppression, overheal cap and heal-received modifiers.
Direct light actions execute every explicitly installed source system in source order.
Consequently mob idle regeneration and dummy reset can independently alter mob HP;
`stats.heal` and `terrain.lightAcc` identify light's actual contribution and have no mob rows.
Ordinary light frames independently witness summed public heal FX through the complete tick.

The ice server wrapper carries actual history velocity and clears/regrips on leaving ice.
Teleport clears all player/mob slides but preserves light clocks/accumulation. Raid start
clears all slides, both terrain maps and restarts the reporting clock. Shared-walk fixtures
also cover collision fallback on deliberately invalid ice-adjacent-wall maps; these are
robustness fixtures, not a claim those maps pass `validateTerrain`.

This source witness alone does not declare native terrain, full NPC content, locked arena,
observation privacy, restore/hash coverage or headless/policy integration complete. Native
consumers must exercise the same declared inputs and compare actual results, then verify
those integration contracts separately. Private fixture fields are never a public projection.
