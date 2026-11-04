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

`legacy-capture/schedule.ts` records the legacy **tick schedule** as data (`schedule/legacy_schedule.json`, format
`rh-legacy-schedule/2`): the fixed phase order of `updateActive`, the resolved order of every runtime-registered hook list
(`afterWeapons`, `beforeDamage`, `systems`, `moveModifiers`, `modSources`) and every link of every world hook chain
(`world.hooks`), for three worlds: `production` (createGameWorld with the live server's defaults), `capture` (the
parity fixtures' module set and config) and `training` (the training config, then `installTraining`). In legacy that
order is emergent (module install order plus push/unshift and chainHook); the record is checked against the real
`createGameWorld` and fails loudly when `step.ts` or `gameplay.ts` change shape.

```
npx tsx parity/legacy-capture/schedule.ts                # -> parity/schedule/legacy_schedule.json
```

### Schedule format `rh-legacy-schedule/2`

| Field (per world) | Meaning |
|---|---|
| `modules` | The installed modules, in install order. |
| `lists.<list>` | `{module, fn}` per entry, in execution order. |
| `actions` | Action name -> the module that registered its handler. |
| `hooks.<key>` | The hook's chain: one link per assignment, in install order, `{module, mode, fn, src?, when?, dropped?}`. |
| `hookTotals` | Link counts by mode, live and dropped links, static sites and conditional sites not taken. |

A link's `mode` is `default` (createWorld's own hook), `append` (`chainHook`: runs after the existing chain), `wrap` (a
hand-written wrapper that calls the previous chain first, e.g. quests' `dropBody`) or `replace` (an assignment that drops
the chain: every earlier link is marked `dropped` and never runs, e.g. loot's and training's `dropBody`). The links that
are not `dropped` run in list order. `fn` is the function's name when the source names it, else `<arrow>` with `src`
its compacted source; `when` is the condition of a conditional site (`if (...) chainHook(...)`, or an install guard
such as quests' `if (!world.config.quests || world.config.training) return;`). One module can link a hook more than once
(cardHooks chains `teleported` and `runEnded` twice). Only gameplay.ts's `MODULES` (and `installTraining`) are recorded: telemetry.ts (16
chainHook links) and the input trace (trace.ts, 1) attach later in RaidRoom as observers, and BotManager chains
`lobbyClosing` (1) when the room runs bots, so the record is the gameplay chain, not the complete runtime chain.

Each link is captured twice and the two must agree: at runtime (a logging Proxy on `world.hooks` while each module
installs; an assignment made by `chainHook` is an append, a direct assignment after reading the hook a wrap, any other a
replace) and statically (the `chainHook(world, "key", fn)` call sites and `world.hooks.key = ...` assignments of each
module in source order). Per (module, key) the runtime count must equal the number of unconditional static sites or
the number of all static sites, and the modes must be the same sequence; a wrapper that does not call its previous link first is refused (execution order
would no longer be install order). Production at the recorded revision: 74 static sites in 29 modules (72 chainHook, 1
wrap, 1 replace), 73 links installed plus the createWorld default, 1 conditional site not taken (mobs' dummies-only
`raidStarted`).

Legacy configuration of every scenario (also recorded in each file's `legacyConfig`): `signatures: false` (faction
signatures, Fire roam, bruiser passives, Plague corpses/zombies and the Sentenced hunt are not installed), `walkHints: false`,
no mobs, quests, hazards or regen, PvP rules on (the PvP factor at card power 0 is 0.77, hit cap 35% of max hp), no cards,
players start on fists. This is the configuration the Rust slice implements; the other mechanics are in `docs/backlog/`.

## Fixture format `rh-legacy-scenario/1`

| Field | Meaning |
|---|---|
| `map.rows` | One string per tile row: `#` wall, `~` LOW (fence/lava/crevasse class), `.` floor. Tile = 32 u. |
| `legacyConfig.orderSalt` | The injected secret salt behind `actionOrder` and `tieRank`. |
| `legacyConfig.world`, `tickMs`, `mobsPresent`, `startEvents`, `unexpectedEventTypes` | How the fixture was captured (asserted, see below). |
| `legacyConfig.startTick` / `startServerTime` | The run started on the first step; players are then placed at `players[].x/y` (history reset). |
| `players` | id, faction, start position and hp, `maxHp` (the faction's) and `weapon0` (`""` = fists). |
| `inputs` | `{tick, player, type, msg}`: queued just before the step that makes `state.tick == tick`. |
| `ticks` | Per step: `serverTime`, every player's `x, y, facing, hp, status, readyAt` (rounded to 1e-6), and canonical events (`hit` with amount, `swing` with origin and angle, `death`, `victory`, `raidEnded`, ...). |
| `notCompared` | Optional: per-entity keys deliberately not compared (`"players.<key>"`). |
| `results` | Every `resolved` result: outcome, place, players, kills, killedBy, GV total/win/kills, and its tick. |

Every key is read: an unknown key anywhere (a new per-tick entity list such as `mobs`, a new player field) makes
the fixture unreadable, so the gate fails instead of passing on a key it never compared. The keys that describe how the
fixture was captured are asserted as **preconditions** (`rh_parity::preconditions`): `legacyConfig.world` is the slice
configuration above, `tickMs` is 50, `startTick` 1 and `startServerTime` 50, `mobsPresent` 0, `startEvents`
`[raidStarted]`, `unexpectedEventTypes` empty, `map.tile` 32 and `w`/`h` match `rows`, each player's `maxHp` is the
faction's and `weapon0` is empty (fists) or carried by the Rust player, and ticks run consecutively from `startTick + 1`.

Per-tick entity state is compared through a projection table per entity kind (`rh_parity::PLAYERS`: key, tolerance
class exact/abs/angle, Rust getter). A legacy key with no projection fails as `unported key players.<k>`, unless the
fixture lists it in the optional top-level `notCompared` (`["players.<k>", ...]`, for a key deliberately not compared;
a compared key there is refused), and a projected key the legacy entity lacks fails too. A new per-player field is one
capture field plus one projection line; a new entity kind (mobs, projectiles) is one `FixTick` list plus one
`EntityKind` table.

Scenario files are found by their leading `"format": "rh-legacy-scenario/1"` key (capture.ts writes it first; the peek
reads the valid UTF-8 prefix of the first 256 bytes, so a multibyte character cut at the boundary cannot hide it), so
the pathfinding fixture (`rh-legacy-pathfinding/1`) never loads as a scenario. Discovery is loud (`rh_parity::discover`):
any other `*.json` file in `fixtures/` (no leading `format` key, or another format) fails the test, `scenario_paths()`
and `parity-report` (`UNRECOGNISED ...`, exit 1), so a fixture can neither drop out of the gate nor join it unseen. The
`msg` of each slice input type may only carry the keys the harness reads (`rh_parity::INPUT_MSG_KEYS`: move `x, y, seq`,
stop `seq`, aim `a`, attack and release `a, t`); any other key fails the comparison. `cargo run -p rh-parity --bin parity-report`
prints `13 slice scenarios + 1 capture-only, 300 pathfinding queries: all MATCH` when the gate is green.

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

## Behaviour fingerprints for performance work

`tools/perfproof/perfproof.py --baseline REV` measures instruction and allocation counts of fixed workloads against a
baseline and fails when behaviour changed. Its fingerprint is `outcomeDigest` (`rh_headless::digest`: every tick's
public snapshot and events, folded field by field, independent of `Sim::state_hash` and of any serde layout), printed by
`rh-headless --digest`, `wirebench --digest` and `parity-bench ... --digest` (`parity-bench paths N` runs the 300 findPath
queries above), plus the state hashes the binaries report and a verification of baseline-recorded replays by both
builds (`rh-headless --verify-replay FILE [--ignore-content-hash]`; the flag skips the content gate only, never the
per-step hash comparison).
