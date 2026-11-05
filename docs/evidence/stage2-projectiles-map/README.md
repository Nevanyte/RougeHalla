# Rust projectile rules and map foundations

Verified 2026-11-05 on `optimization_port`, based on `c6906268` plus this evidence's containing changes. Hardware:
Apple M5 Pro, macOS 26.6.1 arm64, Rust 1.97.0. PostgreSQL integration uses local PostgreSQL 16.15. All checks are local;
no cloud/DNS/production change or cloud spend was made.

Authoritative bow/wand flight now includes release after movement, 10 ms sweeps, body/wall/range stops, shield returns,
ball–arrow deletion, sword scaling, axe destruction, wand splash, owner departure and end-of-run clearing. Projectile
state and events remain private. Public viewer-specific projectile identities, observation/presentation and transport
are a later P-COMBAT-2 stage; target-lock creation and other pending mechanics are not claimed here.

Seven actual legacy captures cover 594 ticks, 204 canonical events, 80 launches and 3 results. All discrete fields match;
maximum position error is zero and maximum HP error is 4.83e-7 under the unchanged 2e-6 contract. The full parity report
matches 27 scenarios and 300 paths; 15 scenarios remain capture-only. A 0.60 → 0.61 ball-retention mutation fails
`ball_vs_arrow` at tick 30. Six pressure fixtures allocate zero times across 336 measured steps after warm-up.

Independent review compared 41 supplementary legacy scenarios over 3,936 ticks and verified serialize/restore/step
continuation at every tick, including 3,268 with live shots. It reproduced malformed reflection-serial headroom and
damage-packet checkpoint defects; both now fail at restore and have regressions. The isolated projectile package gate
passed 206 tests; the reviewer separately ran 201 tests in its narrower crate selection.

The map milestone is pure deterministic trig, topology, distance/descent/segment kernels and fixed coliseum geometry
under `rh-sim::mapgen`. The real legacy fixture covers all 256 SIMPLE masks, 295 grids, signed-i32 seed boundaries,
98,618 segment queries, bit-exact trig/round/wrap observations, full fixed-layout layers and eight pillar variants.
Review found an `i32::MAX` terminal cursor overflow; the regression captures the actual legacy result and the fix passes.
One geometry definition supplies both generation and 89 allocation-free content words; geometry and pillar mutations
move the content hash. Full map generation, richer layer loading, zones/styles, independent certification and seed-pin
parity remain open. No map pins were changed.

Integrated checks:

- `cargo test --workspace --all-features`: **431 passed, 0 failed/filtered, 1 intentionally ignored heap measurement**.
- Workspace/all-target/all-feature Clippy with warnings denied and `cargo fmt --all --check`: passed.
- Eight capture-helper tests passed natively and on Linux x64 Node 22.23.4.
- A fresh full Linux recapture reproduced all 44 scenario/path/map JSON files, ignoring `legacyRevision` alone. Git
  provenance is unavailable inside the read-only checkout mount; the source-side package tree was unchanged.
- Pinned Linux Node 22.23.4 map-foundation `--check`: byte-for-byte match.
- C# library **214 tests passed** after removing approximate client movement and repairing stale/full/delta recovery;
  source copies match. Current-source Unity Web execution is still pending.

Current identity: content **`550aa6db909619c1`**, checkpoint **`rh-checkpoint/6`**, replay **`rh-replay/4`**, observation **4**,
policy contract **3**, unchanged wire protocol **5**. The content identity includes the new fixed map definition; this is
not a map re-pin or a balance change. Earlier compiled Unity players carry older content and require rebuilding.

Reproduce with `cargo test --workspace --all-features`, `cargo run -p rh-parity --bin parity-report`, and the existing
capture/map-fixture tools on pinned Linux Node 22.23.4. This foundation does not satisfy the full-game, browser, hosting,
capacity or release gates.
