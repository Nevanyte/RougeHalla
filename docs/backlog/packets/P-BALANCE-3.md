# P-BALANCE-3: walk-time table (time value of stats)

- **Serves:** not in ORDER_OF_OPERATIONS; requested by the owner in chat 2026-11-13 (balance tooling, sibling of
  P-BALANCE-2). The coordinator records that approval in the MIGRATION checkpoint when this packet is scheduled.
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (measurement tool, no legacy counterpart) · D2 harness evidence only · D5/D6/D9 none

## 1. ID and outcome
The game has no gold. Its only currency is stats, so a stat is valued by the **seconds of farming it saves**. The farming
cycle is `walk + kill + overhead`. P-BALANCE-2 (`camp_bench`) already measures kill time per camp kind. This packet
measures the walk term.

Outcome: a read-only binary `walk_bench` generates N styled maps by seed and reports, in seconds at base speed, how long a
fighter walks between camps. Distances are pathfinding distances, not straight-line distances, and the tour covers the
**whole map**: from each player spawn it goes to the nearest uncleared camp, repeated until every camp is visited. The
tool changes no rule and no number.

## 2. Dependencies
None. It uses existing public APIs: `rh_sim::mapgen` (`generate_styled`), `rh_sim::pathfind::Pathfinder::find_path`, and
`GameMapData { camps, spawns, .. }` in `crates/rh-sim/src/mapdata/model.rs`.

## 3. Relevant legacy paths
None. This is a new measurement with no legacy equivalent, and no parity is claimed.

## 4. New paths
- `crates/rh-headless/src/bin/walk_bench.rs`
- `crates/rh-headless/tests/walk_bench_oracle.rs` (oracle)
- `tools/balance-walk/README.md`

## 5. Exclusive write scope
The three new paths above. No `rh-sim` edits. If a needed accessor is missing, stop and hand back; do not add it here.
`Cargo.toml` is not touched: bins under `src/bin/` are discovered automatically.

## 6. Contracts and references
- C-INPUT and C-OBS are not touched. The tool reads map data directly and never runs `Sim`.
- `PLAYER_SPEED` (170 u/s) and `PLAYER_RADIUS` (12 u) in `crates/rh-sim/src/constants.rs`. Use base speed only;
  faction and item speed are applied later as multipliers.
- Sibling tool: `crates/rh-headless/src/bin/camp_bench.rs`, `tools/balance-camps/README.md` (CLI and JSON style to
  mirror).

## 7. Behaviour to preserve
Nothing in the sim changes. Existing gate suites stay green.

## 8. Acceptance checks
1. `walk_bench --seeds A..B` prints one JSON report (`schema_version: 1`), deterministic: two runs give byte-identical
   output.
2. Per seed, and aggregated per map:
   - `camps`: camp count; `camps_by_zone`: count per `Zone`.
   - `t1`, `t2`, `t3`: seconds for the first three legs of the greedy tour (spawn → nearest camp → nearest remaining …),
     averaged over all player spawns.
   - `tour_legs`: every leg time of the whole-map greedy tour from each spawn; summaries `tour_avg`, `tour_p50`,
     `tour_p90`, `tour_total`.
   - `contested_pct`: share of camps whose two nearest spawns are within 20% path distance of each other.
   - `unreachable`: camps the pathfinder cannot reach (listed, not counted in times).
3. Leg time = sum of path segment lengths (start, then waypoints) ÷ `PLAYER_SPEED`. The target is the camp centre
   `(x, y)`, and the footprint is a disc of `PLAYER_RADIUS`. Ties in "nearest" break by camp index (deterministic).
4. A final `aggregate` block over all seeds: mean and p90 of `t1..t3`, `tour_avg`, `tour_total`, `contested_pct`.
5. Oracle: on a small hand-built `TileMap` with known camp and spawn positions, the greedy tour visits camps in the
   expected order and the leg times equal hand-computed path lengths ÷ 170 within 1e-9. A second case puts a wall
   between two camps and checks that the reported time is longer than the straight-line distance.

## Oracle assumptions
- The map the live server uses is the output of `generate_styled` with `Options::default()`. If the live server uses a
  different entry point, the coordinator corrects this before implementation.
- `GameMapData.spawns` are the player spawns, and `GameMapData.camps` are every farmable camp.

## Oracle files (read-only for implementers)
- `crates/rh-headless/tests/walk_bench_oracle.rs`

## 9. Validation commands
- `cargo run --release -p rh-headless --bin walk_bench -- --seeds 1..50` (to be created by this packet)
- `scripts/gate.sh --oracle packet/P-BALANCE-3`

## 10. Risk and suggested model tier
Low: a read-only tool outside `rh-sim`, implemented by implementer-sonnet and reviewed by reviewer.

## 11. Known traps
- Generation can fail for a seed (`Error::Exhausted`). Report the seed as skipped; do not panic and do not retry other
  seeds silently.
- No hash-ordered collections in output paths. JSON field order must be stable for the determinism check.
- Camp respawns, per-faction speed and map-size scaling by lobby are out of scope (see §1).

## Routing
oracle-author (Sonnet) → implementer-sonnet → reviewer.

## Notes from previous attempts
None.
