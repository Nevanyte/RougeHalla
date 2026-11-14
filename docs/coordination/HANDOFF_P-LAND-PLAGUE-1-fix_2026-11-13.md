# Hand-off: P-LAND-PLAGUE-1-fix (2026-11-13)

```
PACKET:          P-LAND-PLAGUE-1-fix — serves the reviewer-opus notes on P-LAND-PLAGUE-1 and the owner's hard guarantee that pools keep off spawn routes (LAND_GENERATION_REQUIREMENTS sections 1 and 3)
BRANCH:          agent/opus/P-LAND-PLAGUE-1-fix @ d8472fa22 (code; this hand-off is the next commit)
GATE:            PASS (full) [skipped: Postgres suites, no DATABASE_URL; CI-only checks the gate lists] — run as `scripts/gate.sh --base agent/opus/P-LAND-PLAGUE-1 --oracle packet/P-LAND-PLAGUE-1-fix` (log .agent-runs/gate/20261113T192806-agent-opus-P-LAND-PLAGUE-1-fix-full.log): with the default base (feature/unity-rework) the oracle check counts the stacked P-LAND-PLAGUE-1 implementation commits under packet/ as oracle files and fails on pools.rs/shape.rs/mod.rs/README.md; the stacked base limits the oracle set to the stub and oracle commits
CHANGED:         crates/rh-sim/src/mapgen/style_warren/{walk.rs (new), pools.rs, shape.rs, mod.rs, README.md}
D-RULES:         D1: option off byte-identical (G8 guards green; option-off code path untouched); option on stays under P-LAND-PLAGUE-1's proposed row. D2 n/a. No D5/D6/D9 change; no tick, wire, save, state-hash or content-hash change
DEVIATIONS:      none
SHARED RECORDS:  none
LEGACY DOUBTS:   none (signature mode only; no legacy counterpart)
NOT ESTABLISHED: walls laid after the Plague shape by zones styled later or by later pipeline phases are outside the styler's view; give_way has fired only on a discarded attempt (seed 37 attempt 0), never on a served map of 1-96; seeds beyond 96
RISKS:           a body given back by give_way keeps its BogPool feature owning plain (non-bog) floor
```

## The rule and where it runs

- `style_warren/walk.rs` (`Walk`): the test's measure inside the styler. 4-connected steps over `TILE_FLOOR` on the
  current tiles, multi-source from the coliseum centre `(CX, CY)` and every gate tile of `Callbacks::fixed.gates` (the
  `FixedLayout` the pipeline hands the Warren callbacks, so the gates are the served layout's, not a rebuilt default).
  Spawns are `BaseContext::spawns` reachable on the open field; each gets the limit `open + POOLS.walk_detour` (2).
  `dry` is the field with every pool tile laid so far forbidden; `band[k]` holds the tiles of spawn `k` with
  `steps from the spawn + dry <= limit` (every walk within the limit lies in it).
- `pools::lay`: a grown new pool is taken only if `walk.keeps(tiles)`; a merge only if `keeps` on the merged body.
  `keeps` is free for a candidate touching no band (every walk within the limit survives); otherwise a search from
  that spawn, pruned by `dry` (a lower bound once more tiles are forbidden), must reach a coliseum tile within the
  limit. After each `place`, `refresh` forbids the new tiles and recomputes `dry` and the bands. The new-pool check is
  lazy (only a candidate that would beat the current best is checked), so the result is the largest pool that keeps
  the walks among the first `best_of` grown; if all of them fail, the scan goes on to the first further one that keeps.
- `shape` (end, signature mode only): `walk::give_way` recomputes the walks on the tiles with the barrows' walls and,
  while a spawn's walk is past its limit with the pools forbidden, gives back the body of bog (a new pool and every
  merge onto it) that crosses a band, last laid first. Giving back every body crossing a band restores every walk
  (the bands are taken with no pool forbidden), so the loop ends with the guarantee kept as the styler sees the map.
  It removes tiles from `plan.pools` only (the surface then lays no bog there); no draw, no feature write.
- Draws: unchanged. The check adds no draw, and on a map where no candidate is rejected nothing moves.

## Measurements (release reports, seeds 1-32 / 33-96 / 1-96)

Before = `packet/P-LAND-PLAGUE-1-fix` @ `3265e71a0`, after = this branch; `cargo test --release ... -- --ignored
report_seeds_1_to_32 report_wide` (full output after: `target/plague_fix_report.txt`; sheet: `target/plague_fix_sheet.txt`).

| | 1-32 before / after | 33-96 before / after | 1-96 before / after |
|---|---|---|---|
| M1 on/off bog-share ratio min / median / max | 0.28 / 0.85 / 1.87, same | 0.23 / 0.73 / 1.34, same (sum 48.23 -> 48.07) | 0.23 / 0.76 / 1.87, same |
| M1 styler bog on, sum | 8080 / 8080 | 15929 / 15876 | 24009 / 23956 |
| M8 barrows on / off | 296 / 397 (74.6%), same | 587 / 801 (73.3%), same | 883 / 1198 (73.7%), same |
| M4 near / mid / far pieces (mean area) | 10 (250.4) / 43 (68.9) / 35 (74.6), same | 19 (233.3) / 103 (66.7) / 68 (68.0) -> 19 (233.3) / 103 (66.7) / 68 (67.3) | 29 (239.2) / 146 (67.4) / 103 (70.3) -> 29 (239.2) / 146 (67.3) / 103 (69.8) |
| size classes on, small / medium / large | 59 / 19 / 10, same | 128 / 43 / 19 -> 129 / 42 / 19 | 187 / 62 / 29 -> 188 / 61 / 29 |
| M3 pairs closer than 8 | 0, same | 0, same | 0, same |
| M6 attempt on, max | 5, same | 5, same | 5, same |
| M7 worst walk growth on | 0 / 0 | 3 (seed 75), sum 7 / 2, sum 2 | 3 / 2 |
| refusals (Prefix / RadiusPost / SignatureDiscarded) | 4 / 1 / 24, same | 18 / 10 / 33, same | 22 / 11 / 57, same |

Maps that moved: seeds 75 and 88 only (2 of 96; none of 1-32, so the `rh-mapdress` goldens did not move and were not
re-pinned). Seed 75: styler bog 411 -> 405 (pieces [70, 267, 74] -> [70, 267, 68]: the third pool grows another way), ratio 1.05 -> 1.03. Seed 88: 308 ->
261 (pieces [74, 37, 141, 56] -> [74, 37, 56, 94]: the 141-tile pool is not laid, a 94-tile one stands instead), ratio 0.96 -> 0.82. Every other per-seed report line is
identical. A temporary count (not committed) saw 17 candidate rejections over all attempts of seeds 1-96 (all in
33-96) and one `give_way` (seed 37 attempt 0, one body, an attempt the pipeline then discarded as before).

Cost: the oracle test binary, debug, 98.6 s after (brief: 98.7 s before, same machine, shared load). Release
reports 17.1 s before, 16.4-17.0 s after.

## git diff --stat packet/P-LAND-PLAGUE-1-fix

```
 crates/rh-sim/src/mapgen/style_warren/README.md |   5 +-
 crates/rh-sim/src/mapgen/style_warren/mod.rs    |   1 +
 crates/rh-sim/src/mapgen/style_warren/pools.rs  |  39 ++++-
 crates/rh-sim/src/mapgen/style_warren/shape.rs  |  25 ++-
 crates/rh-sim/src/mapgen/style_warren/walk.rs   | 209 ++++++++++++++++++++++++
 5 files changed, 261 insertions(+), 18 deletions(-)
```

## Tests

`mapgen_land_plague` (debug): 23 passed, 3 ignored (reports), including `wide_pools_keep_off_spawn_walks_spawn_pads_and_camp_halos`
(red before) and the 14 tests on seeds 1-32 and the other eight `wide_*`. `--lib style_warren` 6 passed (legacy
capture), `--test content` 21 passed, the eight `mapgen_signature_*.rs` all green with no value moved, `rh-mapdress`
all green (goldens not re-pinned; `OFF_GOLDEN`, `NO_ANCHOR_GOLDEN`, `SIG_GOLDEN` unchanged), clippy `-D warnings` clean.
