# P-MAP-1: port the map generator and the independent certifier

## ID and outcome
P-MAP-1. A Rust generator (`generate_map(seed, attempt, options)`, `certified_map(seed)`) and an independently written Rust
certifier produce the 160x160 zone maps the game plays on. Success = for seeds 0..199 the Rust `map_hash` equals the legacy
pinned hash (`packages/shared/test/mapPins.ts`), or the coordinator records an **owner-approved re-pin** (decision needed;
ADR 0003 allows either). Until then the server keeps playing `rh-map/1` exports. The server is the only generator (clients
receive the map: ADR 0003), so cross-engine float drift is not a client problem; it is a parity-with-legacy and a
self-determinism problem.

## Dependencies
None to start. Milestone M0 (an `rh-map/2` exporter) unblocks P-MOBS-1 (camps), P-ARENA-1 (coliseum/spawn zones), P-TERRAIN-1,
P-VISION-1 (bushes), P-QUEST-1 and P-COMBAT-4 (crate/ground spots). P-MOBS-1 and P-ARENA-1 add their fields to the same export
additively; merge those edits one at a time.

## Relevant legacy paths (verified)
- `packages/shared/src/mapgen.ts` (1,056 lines: the 13-stage attempt pipeline, `generateMap` l.184, `tryAttempt` l.198, `certifiedMap` l.211, `gateSpawnWalks` l.862, `mapHash` l.1024, `MAX_ATTEMPTS` 16, `SHAPE_GATES`), `zones.ts` (1,082: zone partition, camps, elites, territories, repair, `MAPGEN_FAILS`), `coliseum.ts` (194: `fixedLayout`), `gridOps.ts` (57), `gridTopology.ts` (275: `walkField16`, `descentPath`, `segmentBlocked`), `detMath.ts` (19), `terrain.ts` (429: `validateTerrain`), `map.ts` (464: `GameMap`, masks, `withGates`, `moveComponents`), `bushes.ts` (117), `rng.ts` (mulberry32, `hashSeed`), `styler.ts`, `zoneStyle/*` (about 6,700 lines: `styleZones.ts`, `context.ts` guard/transaction runtime, `features.ts`, `landmarks.ts`, `kit.ts`, `scorch.ts`, `gallows.ts`, `warren.ts`, `rime.ts`, `sanctum.ts`, `hook.ts`), `pathfind.ts` (already ported in `crates/rh-sim/src/pathfind.rs`; the spawn gate uses it).
- Tests/tools: `packages/shared/test/mapCertify.ts` (1,574 lines, independent certifier, reads only `GameMap`), `mapgen.cert.0..7.test.ts` (200 seeds in 8 shards via `mapCertifyShards.ts`), `mapPins.ts` (`PINNED_MAPS`, `PINNED_PLAIN`, `OPEN_PINNED`, `PIN_STYLER_VERSIONS` all 400), `mapgen.test.ts` (determinism + a spy on 23 `Math` functions), `mapgen.perf.test.ts`, `zoneStyle*.test.ts`; `packages/shared/scripts/{printMap,printZone,mapBench,mapSweep,pinMaps}.ts`.
- Docs: `docs/ZONE_SHAPES_AS_BUILT.md` (as-built reference, section 3 pipeline, 11 gates, 18 how to change a shape), `docs/R2_GENERATOR_AS_BUILT.md`, `docs/R1_GENERATOR_NOTE.md` (history). docs/legacy/CLAUDE_LEGACY.md map sections are partly 136x136/8-camp stale (INVENTORY section 9): 160x160, 10 camps per zone, 2 elites, `BAG_COPIES` 3.

## New paths
Stage 2 decision: keep the pure generator and certifier under modular `crates/rh-sim/src/mapgen/`, within the Rust
simulation boundary requested by the owner. No new crate or dependencies are needed for the foundation. A headless
tool can later provide sweep/print; tools/map-fixtures exports actual reference observations. The `rh-map/2` name below
is an export format, not a separate gameplay implementation. Full-layer export, pins and independent certifier remain.

M0 full-layer admission, M1 deterministic trig/grid/fixed layout and M2a exact zone partitioning are implemented and
independently reviewed. They do not claim a complete generator, public rich-map transport or seed-pin parity. M2a compares
real pre-styler intermediate arrays and consumed RNG words. M2b adds camp sites and initial territories. Post-styler repair
waits for real stage inputs. New rule definitions must drive both the implementation and allocation-free content words.

M2b initial camp placement/territories/reach is also implemented and independently reviewed; camp spots, post-styler
repair and canonical record renumbering remain open. M3a is now implemented/reviewed through stage 3, retaining
the advanced RNG and internal IDs. Camp failure redraws zones within the four layout attempts on the same stream;
partition failure ends the attempt. Seed 17 exercises the distinction. Capture private stages using an isolated actual
module copy with export-only exposure/read-only taps, and require final output/hash equality with the unmodified caller.
Never reconstruct pre-repair inputs from final DTOs.

`PINNED_PLAIN` disables only `styleZones`: real landmarks and bushes still run. A no-landmarks diagnostic variant is
not plain-pin parity. Camp radius is fractional `sqrt(reach2) * TILE` and participates in the legacy hash; exact
ECMAScript number strings and UTF-16 hashing are required, not integer-only formatting. Full plain pins must wait for
the actual landmark runtime/callbacks, safety nets, spot/crate/repair passes, tail records and all acceptance gates.

M3b spawn-pool preparation, protection and standalone gate walk decisions are implemented and independently reviewed
on actual post-landmark/final layers. No empty landmark masks are substituted. The original picked pool's protection
masks survive later gate member removal. Parent/content hooks and the combined 557-test native gate pass.
Actual elite-bush placement on genuine stage-11b inputs is also implemented and independently reviewed, with its
separate stream, internal camp order, provisional feature records and original masks preserved. Both leaves passed the
combined integration gate. Landmark runtime/templates/callbacks remain a separate prerequisite before claiming plain
generation. Existing strict differential and pin rules continue to apply.

The stage-4 whole-wall landmark guard/runtime is implemented and independently reviewed, excluding template search and callbacks.
Replay every actual placement request (including refusals) and reservation from genuine initial arrays; guard counters
are assertions, never replay inputs. Actual seeds 0/1/17 produced no stateful canBlock calls outside placement, and all
read-only open probes left guard state unchanged. A labelled reduced-budget source case proves skipping a refused
request changes the next result: join budget survives rollback. Scorch's hard/open override changes its planning view;
its inherited placement closure still uses the original transactional hard mask. Full per-command arrays/scratch/counters,
refusal-budget behavior and malformed terrain admission are tested. The separate template/stamp leaf is also implemented and independently reviewed: seven checked-in differential tests
replay actual helper calls and complete runtime state, and inventory assertions reject truncated captures. Source Int32
offset semantics are preserved for valid indices; invalid overflow artifacts are explicitly refused instead of aliasing
tile zero. Search/planning-cache/callback selection remains a later exact port. See
[the bounded evidence](../../evidence/stage2-fire-landmarks/README.md).

## Exclusive write scope
Initial foundation worker: new `crates/rh-sim/src/mapgen/**` and `tools/map-fixtures/**` only. Coordinator adds the module
declaration after it is buildable. Later milestones separately coordinate full-layer loading/export, pin tests and the
independent certifier. No edits under `packages/`; no simultaneous edits to projectile/core shared files.

## Contracts and references
C-MAP (server-sent canonical map), C-RNG (generator streams are a function of the public `(seed, attempt)`; gameplay randomness never derives from the map seed), C-NUM, ADR 0003 (server is the only generator; blob + FNV identity), ADR 0007. `docs/CONTRACTS.md` C-PARITY (hash equality is a discrete outcome).

## Behaviour to preserve
- **Determinism rules (legacy, enforced by a Math spy test):** only `+ - * /`, `sqrt`, `floor`, `ceil`, `round`, `abs`, `min`, `max`, `sign`, `imul` and bit operations; `detSin/detCos` from `detMath.ts`; no `pow/exp/log/atan2/hypot/sin/cos/random`; integer value noise, integer 5/7 and 5-7-11 distance fields and heap keys; total comparators (value, then tile index). Port with `i32/u32/wrapping_mul` where the TypeScript uses `Math.imul` and `>>> 0`; JS `Math.round` rounds half toward +infinity (`rh_sim::math::js_round`).
- One `mulberry32` stream per attempt (`seed` for attempt 0, else `seed + attempt * 0x9e3779b1`), drawn **only at stages 1, 2, 5, 8 and 11 in a fixed order**; each zone's styler draws from `mulberry32(hashSeed(seed, attempt, zone, stream))` (`STYLE_STREAM` 0 shape, 1 decor, 2 surface, 3 landmark). Changing draw order moves every map.
- `mapHash` (l.1024) is FNV-1a 32 over: seed, attempt, w, h, `tiles`, `terrain`, `regionGrid`, `territoryGrid`, camps (id, zone, centre, r, spots, eliteSpot, chest, area, radius), spawn pool (+zone), regions (id, pole, area, spawns, chestSpots), buildings, `featureGrid`, features (kind, variant, zone, jobs, ax, ay, p, bbox, tiles), spawns, crateSpots, groundSpots. Numbers are hashed as **`String(n)`** (exact ECMAScript number formatting, including fractional camp radii): reproduce exactly. Strings hash UTF-16 low/high bytes and a 0x1f delimiter; props are not hashed.
- What an attempt certifies (hard checks; no relaxed attempt): one 4-connected floor piece; four 4-wide gates (n,e,s,w) as the only arena links, arena sealed when gates close; 5 zones of ~equal painted area (within 8 tiles), floor share max/min <= 1.15, >= 24 ring-road tiles per zone, <= 100 sliver tiles; 10 camps per zone (`CAMPS_PER_ZONE`), 2 elite (`ELITES_PER_ZONE`, farthest from the coliseum, >= 16 apart when possible), `CAMP_GAP` 9, territories partition the zone (`territoryGrid` = 1 + camp index), territory radius <= 30 tiles; spawn pool 24-32 in >= 4 zones with the 10-tile rule; spawn gate: `findPath` walks to the coliseum centre within ratio 1.2 and <= 8 hazard tiles (`A:spawnRatio`); terrain T1-T11 (`validateTerrain`); shape gates (every zone wall/LOW tile belongs to a feature, no wall piece < 6 tiles, <= 250 features). `certifiedMap` tries attempts 0..15.
- Perf (legacy gates, quiet Apple M5 Pro): styled 130 ms / plain 71 ms median per map at the CI yardstick (`mapgen.perf.test.ts`); the Rust port should be faster, record the number.

## Acceptance checks
1. M0: `capture.ts` writes `rh-map/2` (all gameplay layers: tiles, terrain, regionGrid, territoryGrid, camps, spawnPool with zones, regions, buildings, features, featureGrid, crate/ground spots, coliseum def) for seeds 1 and a second seed, plus the legacy `mapHashU32`; `rh-sim` loads it; browser proof and parity still pass.
2. M1-M3: foundations (`gridOps`, `gridTopology`, `detMath`, coliseum, zones) with unit tests ported from `gridTopology16.test.ts`, `geometry.test.ts`, and per-stage dumps compared with `printMap.ts` output.
3. M4: the five stylers + landmarks + the feature transaction runtime; port `zoneStyle*.test.ts`; `styler=none` plain maps first (compare against `PINNED_PLAIN`), then styled (`PINNED_MAPS`), then `OPEN_PINNED`.
4. M5: independent certifier written from `mapCertify.ts`'s requirements by a different author/module than the generator; run on seeds 0..199 strict, 0 hard failures; a mutation test that breaks each guarantee and is caught.
5. M6: seeds 0..199 `seed:attempt:hash` all equal to `PINNED_MAPS`. If a stage cannot match (float/ordering), stop and file the exact first differing stage and tile; the **owner** decides on a re-pin (then regenerate pins via a Rust `pin` bin and record it in `docs/CONTRACTS.md` change log by the coordinator).
6. Perf: `certified_map` median recorded in the packet hand-off; no allocation per tile in hot loops.

## Validation commands
`npx tsx packages/shared/scripts/printMap.ts <seed>` (reference ASCII), `npx tsx packages/shared/scripts/mapSweep.ts <count>` (legacy certifier),
`npx tsx parity/legacy-capture/capture.ts --only map`, `cargo test -p rh-sim mapgen::`, `node --import tsx tools/map-fixtures/foundations.ts --check`, `cargo test --workspace`,
`cargo clippy --workspace --all-targets`, `cargo run -p rh-parity --bin parity-report`. Legacy test run for reference: `npm test -w @raid/shared`.

## Risk and suggested model tier
Highest effort in the backlog (~11,000 lines of dense TypeScript). Split into the milestones above, each its own PR and worker.
M4 (stylers) and M6 (hash parity) need the strongest model and high effort; M1-M3 and M5 suit a strong builder. Do not start M4
before M3 matches the plain pins.

## Known traps
- New crate = a `Cargo.lock` change: per `AGENTS.md` only the coordinator edits `Cargo.lock`; list the new dependencies in the hand-off.
- The generator's spawn gate depends on `findPath`; `PULL_WINDOW` 96 and string-pulling are already ported: a difference there re-pins everything (`pullWindow.ts` bench).
- Hot imports in the TypeScript are copied to module constants for speed; irrelevant in Rust, but evaluation order of draws is not.
- `Uint8Array` wrap-around and `>>> 0` semantics: use explicit u8/u32 arithmetic; no implicit float-to-int casts (JS `|0` truncates toward zero, Rust `as` saturates).
- Sorting: JS `Array.prototype.sort` is stable; use stable sorts with the same comparators.
- Do not reorder stages 1/2/5/8/11 draws; stylers must never touch the main stream.
- A server-only build uses `decor: false`; decor (props) is client cosmetics and unhashed (P-MAP-4).
- `Unfinished code/` in the repo root is unrelated to this packet; do not read it for specs.
