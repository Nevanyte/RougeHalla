# Actual landmark recipes and stage admission evidence

The Rust stage executes all five actual source callbacks in internal zone order, with shared runtime state and the
original post-callback breach gate. See [ADR 0015](../../adr/0015-landmark-recipes.md) and the stage/recipe READMEs.
This evidence does not establish finished Rust generator pins or full-game completion.

## Actual-source observations

- Search family: seven real attempts, 35 zones, 14 Scorch/Gallows callbacks, 29 target searches and 235 guarded
  attempts (208 refusals). Two separately labelled actual-source synthetic callbacks cover refusal continuation and
  no-camp planning. Nineteen source hashes, Linux x64 Node22.23.4, complete final GameMap/null and mapHash observer
  equality, and byte-exact recapture. No actual null map occurred in this bounded pool.
- Direct family: eight real attempts, 40 zones and 745 lossless runtime states; eight labelled actual-source synthetic
  cases plus a separate private second-seed equality/tie probe. Thirty-nine transitive source hashes and the same
  canonical runtime/noninterference/recapture requirements. Actual Rime key exhaustion/fallback occurs in seed176.
- Parent admission: a separate eight-case oracle records all 75 shared TypeScript source hashes, original protection,
  admitted collision/features/ownership, ordered buildings and exact box/near1 masks. Source taps require complete
  final-map and mapHash equality before saving. Source output hashes here prove observer noninterference only.

The parent test recomputes M3a, executes all five live recipes across the direct oracle's eight attempts/40 zones and
compares complete per-zone states, scratch/epochs, counters, reservations, geometry bits and stream continuations.
It compares the separate admission oracle's masks/outputs byte for byte. The original prefix/main RNG remains identical.
An earlier wrapper test intentionally replays transaction fixtures to test orchestration only; it is not used as proof
of live recipe execution. Existing canonical gameplay fixture bytes remain unchanged.

## Independent review and repairs

Independent Scorch/Gallows review added six actual inputs, including maximum-safe seed and retry metadata: 12 target
zones, 24 searches, 58 attempts and 34 refusals matched. Six additional semantic mutants were rejected: margin order,
simple-point bypass, elite radius, door-facing reward, territory penalty and collapsed additive penalties.

Independent direct-family review added eight actual inputs and 581 states, then executed all five live callbacks over
their 40 zones. Four semantic mutants were rejected: seventh-versus-sixth failed placement, removed clearance shift,
failed-first shrine direction eight instead of seven, and strict instead of inclusive road minimum.

That review also proved two evidence defects: an unknown operation and all 3,600 corrupted source fallback open
records could pass the initial test filter. The repaired tests admit only the complete explicit event inventory and
valid state references; reconstruct ordered open indices/results from actual Rust build tables; and bind every open
state to the already verified pre-search Rust boundary. Seven independent corruptions now fail, including the original
two, isolated index/result changes, valid-but-wrong state, missing and reordered opens. The unchanged valid control and
fresh all-five corpus pass. Only tests/README changed; production/tool/fixture hashes remain frozen.

The discarded-private-cache diagnostic difference is asserted separately as described in ADR0015, without inventing
a source patch event or broad event normalization. Representative rule/template changes alter live behavior. Aggregate
content identity additionally passes 767 independent mutations across all five definitions: 46 scalar probes, 88 numeric
array probes and 633 template probes. Exhaustive struct destructuring and exact nonempty inventories guard coverage.

## Reproduction and integration

```sh
cargo test -p rh-sim --lib mapgen::landmarks --locked
cargo test -p rh-sim --test content --test landmark_recipe_content --locked
node --import tsx tools/map-fixtures/landmark-recipes-search.ts --check
node --import tsx tools/map-fixtures/landmark-recipes-direct.ts --check
node --import tsx tools/map-fixtures/landmark-stage.ts --check
```

Source commands require Linux x64 Node22.23.4. Isolated captures use read-only source mounts, executable tmpfs
node_modules and dedicated output paths; the checked-in tools enforce their runtime/provenance and unique tap sites.
The Rust workflow runs all three recapture checks alongside existing source oracles. No `packages/` source was edited.

Final combined integration results are recorded with this checkpoint in `docs/MIGRATION.md`. Content identity is
`1e0774e8e0ba1649`; checkpoint /14, replay /12, observation11, policy8 and wire5 are unchanged. Requested independent
review routing was Astra/high; the runtime did not expose an independently attestable model identifier. No cloud/DNS,
Unity, protocol, dependency or ML change is part of this batch. The separate Claude and Kimi ownership reservations
remain active.
