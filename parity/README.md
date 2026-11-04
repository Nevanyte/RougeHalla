# Parity: legacy fixtures and the differential harness

`legacy-capture/capture.ts` runs the **real legacy TypeScript simulation** (`createGameWorld` + `step`, as `RaidRoom` ticks it)
headless on hand-built maps, with every nondeterministic input injected:

- `world.random` = `mulberry32(randomSeed)`, so the secret action-order salt (`orderSalt`) is fixed and recorded.
- The reward and quest salts are fixed (`[1,2,3,4]`, `[5,6,7,8]`).
- Client messages go through the real validator (`enqueueClientMessage`) and are recorded verbatim, with the tick they were queued for.

```
npx tsx parity/legacy-capture/capture.ts                 # all scenarios -> parity/fixtures/*.json
npx tsx parity/legacy-capture/capture.ts --only rewind   # one scenario
cargo test -p rh-parity                                  # replays every "slice" fixture through the Rust core and compares
cargo run -p rh-parity --bin parity-report               # the same comparison as a human-readable report
```

Legacy configuration of every scenario (also recorded in each file's `legacyConfig`): `signatures: false` (faction
signatures, Fire roam, bruiser passives, Plague corpses/zombies and the Sentenced hunt are not installed), `walkHints: false`,
no mobs, quests, hazards or regen, PvP rules on (the PvP factor at card power 0 is 0.77, hit cap 35% of max hp), no cards,
players start on fists. This is the configuration the Rust slice implements; the other mechanics are in `docs/backlog/`.

## Fixture format `rh-legacy-scenario/1`

| Field | Meaning |
|---|---|
| `map.rows` | One string per tile row: `#` wall, `~` LOW (fence/lava/crevasse class), `.` floor. Tile = 32 u. |
| `legacyConfig.orderSalt` | The injected secret salt behind `actionOrder` and `tieRank`. |
| `legacyConfig.startTick` / `startServerTime` | The run started on the first step; players are then placed at `players[].x/y` (history reset). |
| `players` | id, faction, start position and hp (max hp is the faction's). |
| `inputs` | `{tick, player, type, msg}`: queued just before the step that makes `state.tick == tick`. |
| `ticks` | Per step: `serverTime`, every player's `x, y, facing, hp, status, readyAt` (rounded to 1e-6), and canonical events (`hit` with amount, `swing` with origin and angle, `death`, `victory`, `raidEnded`, ...). |
| `results` | Every `resolved` result: outcome, place, players, kills, killedBy, GV total/win/kills, and its tick. |

`parity: "slice"` fixtures are compared by the Rust harness. `parity: "capture-only"` fixtures (projectiles) are for the
backlog packets that port those mechanics.

`pathfinding_seed1.json` (`rh-legacy-pathfinding/1`) holds the 160x160 tile layer of the generated map of seed 1 (the
legacy generator's certified attempt, with its `mapHashU32`) and 300 `findPath` queries with the legacy waypoints.

## Tolerances (what "parity" means here)

Discrete outcomes must match **exactly**: which events happen on which tick (hits, swings, deaths, victory), who hit whom,
statuses, results (outcome, place, kills, killedBy, GV). Continuous values (positions, facings, hp, hit amounts, ready
times) must match within `2e-6` absolute (`rh_parity::TOL`: the fixture's own 1e-6 rounding plus one step):
the Rust core uses the same IEEE-754 double arithmetic in the same order, and transcendental functions (`atan2`, `hypot`,
`exp`, `asin`, `sin`, `cos`) come from the `libm` crate in Rust and from V8 in the legacy code, which can differ in the last
ulp. A tolerance that hides a changed hit, winner, reward or timing is a harness bug.
