# P-MAP-1 M3b: spawn preparation, protection and pure gate decisions

This leaf ports real stage-5 preparation/picking and the standalone `gateSpawnWalks` decision. It consumes actual
post-landmark tile/zone/mask/camp inputs; it does not generate landmarks, replace them with empty masks, measure
production gate paths or claim a complete map / PINNED_PLAIN result. Plain reference runs retain real landmarks
and bushes. The coordinator owns the parent hook and content fold.

APIs:

- `SpawnContext::new(&FixedLayout)` and `from_definitions(...)` rebuild shared clearing/halo geometry from the existing
  zone/camp definitions and use the supplied coliseum ring-road definition. No shared rule values are redeclared.
- `prepare(tiles)` returns the actual 5/7/11 centre field and row-based clear-3x3 mask.
- `pick_spawn_pool(context, input, preparation, rng)` preserves candidate order, contour quantiles, first-wins score
  ties, admissibility and every draw/retry. `prepare_and_pick` also returns the original pool's protection masks.
- `landmark_masks`, `landmark_protect`, `pool_masks` and `style_protect` implement the real clipped/protected grids.
- `gate_spawn_walks(definition, pool, walks, hazards, zone_of)` returns kept INPUT indices in pick order. It accepts
  matching arrays of finite nonnegative measured walk lengths. It never mutates the original pool or masks.
- `mark_rect` and `walk_segment` retain source clipping / integer supercover visit order, including vertex side cells
  and early callback termination.

`DEFAULT_DEFINITION` is the sole source of 27 new spawn/protection rule words; `visit_content` emits them without
allocation. Dimensions, classes/masks, fixed geometry, clearing radius and camp halo rules use existing definitions.
Contexts use trusted bounded rule data and matching fixed geometry. All grid slices have the registered W*H length.
The core reads no I/O, clock or entropy and has no mutable global cache or new dependencies.

`tools/map-fixtures/spawns.ts` observes an isolated copy of the actual TypeScript module, preserving consumer bodies
and dependencies. It adds read-only stage taps / private-helper exports and observes the real main RNG constructor.
Every normal run must retain complete final output/null AND actual mapHash equality against an unmodified invocation
before its intermediate observations are trusted. Snapshots are copied immediately, before later styles/records mutate
arrays. Capture provenance is pinned Linux x64 Node 22.23.4 plus the actual mapgen source SHA256.

The bounded scan runs 32 real plain/styled invocations. Five full cases preserve real landmark buildings, feature owners,
post-landmark fields, chosen order, consumed RNG words and continuation words, all protection arrays and final gate
layers. Styled seeds 0 and 1 drop four and two members. The observer checks masks at real gate entry/exit; Rust tests
prove the masks remain from the original picked pool and that recomputing them after these removals would lose reserved
ground. There is no automatic reconstruction from the final kept pool.

Strict precision proof runs the existing Rust Pathfinder on the same actual final collision grids: **157 queries**
match every waypoint coordinate bit, ordered sqrt-summed walk-length bit and distinct hazard count with no tolerance.
This validates the existing pathfinder on these inputs, not a new production spawnGate measurement implementation.
Standalone actual-function boundary captures cover hazard 8/9, minimum counts/zones, extremes/ties, ratio boundary/one
ULP over, zero lengths, rect clipping and segment visit/stop order. Separate explicitly labelled direct-picker unit inputs
retain a captured real layer and control only candidate exclusion flags: zero candidates draw nothing; 12 or 25 allowed
original candidates exercise all retries and return null. These are helper inputs, not manufactured map-seed claims.

Generate/check: `node --import tsx tools/map-fixtures/spawns.ts [--check]` on Linux x64 Node 22.23.4. The fixture is
`mapgen/fixtures/spawns.json`. Tests compare full arrays and exact indices/words, not hash-only approximations. Later
landmark runtime/callbacks, safety nets, loot/repair, records/hash, final validation and full seed-pin parity remain open.
