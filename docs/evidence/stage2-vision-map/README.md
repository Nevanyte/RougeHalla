# Rust vision and full map admission

Branch: `optimization_port`. This is a bounded Rust prerequisite for target locking and subsequent map mechanics.
Unity remains presentation/input only. Full game, public map transport, generation/certification and release gates remain open.

## Visibility

The source constant is 30 seconds, superseding stale 120-second documentation. Two genuine captures add 720 ticks
(670 trail/wall, 50 bush/coliseum on actual certified seed 1), without a vision overlay. Capture probes assert that
measurement changes neither private refresh timing nor tile deadlines. A 30-to-120-second mutation diverges at tick
620; changing the 64-unit bush boundary to 63 diverges at tick 4.

Independent review compared 210,820 actual legacy point queries across 1,270 moving/off-phase/reconnect ticks and
restores, all 159 sampled props, cached/event projections and bush/exposure/source-attribution cases. It found a valid
ended-match checkpoint with an old pending bush deadline that failed to restore; the fix accepts historical ended
deadlines while retaining active-state bounds. A 40-terminal-tick continuation now has identical events and hashes.

For a worst-history retained observer (300 moving origins and 512 distinct hidden queries), native release measurement
changed median/max from 3,775/4,511 microseconds to 70/77, with zero warmed allocations. This measures the query slice,
not a whole tick. Only retained policy/headless observers use this memo; current v5 room publishing is disposable.

## Full map admission

`rh-map/2` preserves all 19 actual GameMap fields as strict typed data. `rh-headless::load_arena` admits these documents
alongside existing `rh-map/1`. Layers survive static hashing, checkpoint restoration and headless replay. Collision and
metadata dimensions must match as a pair; unknown fields and inconsistent collision/layer references are refused.
Checkpoint spawn overrides must be walkable on layered maps; valid custom floor locations remain supported.

Independent review round-tripped 24 additional certified maps (seeds 3–26, including 12 with decor) and compared all
614,400 tile-centre region/bush/coliseum queries with the reference. Five original corrupt-map probes are now refused:
open border, displaced gate, bush-owned wall, wrong crater camp and wrong bush camp. Misspelled `layerz` cannot silently
discard metadata, and a wall spawn cannot survive checkpoint restoration.

Actual producer captures preserve seed -1, seed 4,294,967,297 and attempt 4,294,967,296. Metadata admits the JavaScript
safe-integer domain (signed seed, nonnegative attempt). The captured uint32 legacy hash remains **unverified oracle
metadata** until the complete Rust generator/hash lands; no pins were changed.

On the same actual seed-3 map (JSON parsing excluded), a counting allocator independently reproduced validation
184,105 → 41 calls and arena attachment 51,258 → 8. Diagnostics now allocate only on failure. Checks were retained;
this is construction/restore evidence, not a steady-tick or server-speed claim.

## Reproduction

Use the repository-pinned Rust toolchain and temporary PostgreSQL environment for the whole-workspace gate:

```
cargo fmt --all --check
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo run -p rh-parity --bin parity-report
cargo run --release -p rh-headless -- --matches 1 --players 8 --map crates/rh-sim/src/mapdata/fixtures/seed1.map.json --max-ticks 4000 --replay-out /tmp/rh-full-map-replay.json
cargo run --release -p rh-headless -- --verify-replay /tmp/rh-full-map-replay.json
```

Reference captures require Linux x64 Node 22.23.4 and the locked npm dependencies:

```
node --import tsx --test parity/legacy-capture/*.test.ts
node --import tsx parity/legacy-capture/capture.ts --out /tmp/rh-parity-recapture
node parity/legacy-capture/check-recapture.mjs --generated /tmp/rh-parity-recapture
node --import tsx tools/map-fixtures/foundations.ts --check
node --import tsx tools/map-fixtures/full-map.ts --check
```

The checker compares the committed inventory and excludes only `legacyRevision` provenance. No event masking or
tolerance increase is part of this batch. Full integration counts and current identities are recorded in
[MIGRATION.md](../../MIGRATION.md) after the gate finishes.

Integration result: **456 passed, 0 failed/filtered, 1 intentionally ignored heap measurement**; formatting and
warnings-denied all-feature Clippy passed. All 29 compared scenarios and 300 path queries matched; 15 scenarios remain
capture-only. Fresh Linux recapture matched all 46 files, eight helper tests and both map checkers. The eight-basic-bot
full-map smoke reached its explicit 4,000-tick truncation limit and verified all 4,000 replay steps. This is no claim of
full bot behavior, a naturally completed large-map match or full-game performance.
