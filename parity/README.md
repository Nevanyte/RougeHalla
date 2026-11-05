# Parity: legacy fixtures and the differential harness

`legacy-capture/capture.ts` runs the **real legacy TypeScript simulation** (`createGameWorld` + `step`, as `RaidRoom` ticks it)
headless on hand-built maps, with every nondeterministic input injected:

- `world.random` = `mulberry32(randomSeed)`, so the secret action-order salt (`orderSalt`) is fixed and recorded.
- The reward and quest salts are fixed (`[1,2,3,4]`, `[5,6,7,8]`).
- Client messages go through the real validator (`enqueueClientMessage`) and are recorded verbatim, with the tick they were queued for.

```
npm exec --yes --package=node@22.23.4 -- node --import tsx parity/legacy-capture/capture.ts  # all scenarios
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

Legacy configuration of the original slice scenarios (also recorded in each file's `legacyConfig`): `signatures: false` (faction
signatures, Fire roam, bruiser passives, Plague corpses/zombies and the Sentenced hunt are not installed), `walkHints: false`,
no mobs, quests, hazards or regen, PvP rules on (the PvP factor at card power 0 is 0.77, hit cap 35% of max hp), no cards,
players start on fists. This is the configuration the Rust slice implements; the other mechanics are in `docs/backlog/`.

## Fixture format `rh-legacy-scenario/1`

| Field | Meaning |
|---|---|
| `map.rows` | One string per tile row: `#` wall, `~` LOW (fence/lava/crevasse class), `.` floor. Tile = 32 u. |
| `legacyConfig.orderSalt` | The injected secret salt behind `actionOrder` and `tieRank`. |
| `legacyConfig.world`, `tickMs`, `mobsPresent`, `startEvents`, `unexpectedEventTypes` | How the fixture was captured (asserted, see below). |
| `legacyConfig.modules`, `options`, `secrets`, `setup`, `mapSeed`, `itemUidScheme` | Explicit module order, scenario configuration overrides, injected salts, initial loose weapons, optional generated-map seed and deterministic sequential item UIDs (`"1"`, `"2"`, ...; container IDs retain legacy `c` + base36). Non-default settings fail slice preconditions until replayed. |
| `legacyConfig.startEventPayloads` | Every initial non-GV/non-result event, including private planning deals. Slice asserts exactly `raidStarted`. |
| `requires`, `packet` | Kinds that must occur and the packet responsible for promotion from capture-only. Prefixes `input:`, `action:` and `state:` identify other streams; `launch` requires an actual projectile birth. |
| `budgeted` | Optional; true submits through the ordinary per-player order budget. `order_budget` exercises real token-bucket refusals/refill; original fixtures retain their unbudgeted compatibility path. |
| `legacyConfig.startTick` / `startServerTime` | The run started on the first step; players are then placed at `players[].x/y` (history reset). |
| `players` | id, faction, start position and hp, `maxHp` (the faction's) and `weapon0` (`""` = fists). |
| `actions` | Between-step leaves, dropped connections and reconnects, applied after the recorded tick. Original `{kind: "remove" | "drop" | "reconnect"}` records stay readable; `{type: "leave" | "drop" | "join"}` is also accepted (`join` reattaches an existing seat). Their events travel with the next step. |
| `ticks[].launches` | Every new projectile insertion, including reflected and same-tick-ended projectiles: full immutable launch payload plus owner. Ends retain every `projEnd` field (`reason`, coordinates, original time and owner). |
| `inputs` | `{tick, player, type, msg, accepted?}` (`accepted` defaults true; false records a refusal): queued just before the step that makes `state.tick == tick`. |
| `ticks` | Per step: `serverTime`, every player's `x, y, facing, hp, status, readyAt` (rounded to 1e-6), and canonical events (`hit` with amount, `swing` with origin and angle, `death`, `victory`, `raidEnded`, ...). |
| `notCompared` | Optional: per-entity keys deliberately not compared (`"players.<key>"`). |
| `results` | Every `resolved` result: outcome, place, players, kills, killedBy, GV total/win/kills, and its tick. |

Every key is read: an unknown key anywhere makes the fixture unreadable. Known capture-only streams (`launches`,
`mobs`, `fields`) parse for catalogue discovery, but explicitly fail comparison as an
`unported stream` even when their recorded list is empty. A new player field fails without a projection. The keys that describe how the
fixture was captured are asserted as **preconditions** (`rh_parity::preconditions`): `legacyConfig.world` is the slice
configuration above, `tickMs` is 50, `startTick` 1 and `startServerTime` 50, `mobsPresent` 0, `startEvents`
`[raidStarted]`, `unexpectedEventTypes` empty, `map.tile` 32 and `w`/`h` match `rows`, each player's `maxHp` is the
faction's and `weapon0` is empty (fists) or carried by the Rust player, and ticks run consecutively from `startTick + 1`.

Per-tick entity state is compared through a projection table per entity kind (`rh_parity::PLAYERS`: key, tolerance
class exact/abs/angle, Rust getter). A legacy key with no projection fails as `unported key players.<k>`, unless the
fixture lists it in the optional top-level `notCompared` (`["players.<k>", ...]`, for a key deliberately not compared;
a compared key there is refused), and a projected key the legacy entity lacks fails too. A new per-player field is one
capture field plus one projection line; a new entity kind adds its `EntityKind` table and removes its explicit unported-stream refusal when the comparison is complete.

Scenario files are found by their leading `"format": "rh-legacy-scenario/1"` key (capture.ts writes it first; the peek
reads the valid UTF-8 prefix of the first 256 bytes, so a multibyte character cut at the boundary cannot hide it), so
the pathfinding fixture (`rh-legacy-pathfinding/1`) never loads as a scenario. Discovery is loud (`rh_parity::discover`):
any other `*.json` file in `fixtures/` (no leading `format` key, or another format) fails the test, `scenario_paths()`
and `parity-report` (`UNRECOGNISED ...`, exit 1), so a fixture can neither drop out of the gate nor join it unseen. The
`msg` of each slice input type may only carry the keys the harness reads (`rh_parity::INPUT_MSG_KEYS`: move `x, y, seq`,
stop `seq`, aim `a`, attack and release `a, t`); any other key fails the comparison. `cargo run -p rh-parity --bin parity-report`
prints `14 slice scenarios + 14 capture-only, 300 pathfinding queries: all MATCH` when the gate is green.

`parity: "slice"` fixtures are compared by the Rust harness. `parity: "capture-only"` fixtures (the catalogue below) are for the
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


## Capture helpers and mechanic catalogue

`legacy-capture/canon.ts` recursively sorts payload keys and applies `r6` to every number. Every fx payload survives,
including future kinds; `toast`, `plan`, `questReveal` and lifecycle events keep their fields. GV feedback remains checked
through results and `resolved` keeps its result stream. Rust's `canon.rs` projects every field of each supported event;
`mapping.rs` lists supported event/input kinds. A missing kind fails with its name. Mismatches identify the first tick,
array index and differing field. Only declared continuous numeric fields receive `2e-6`; timing/count fields compare
exactly after canonical rounding. These offline fixtures can include private planning/status data; they are not player
observations.

`world.ts` defaults to the real `createGameWorld` assembler. A scenario may declare an explicit `modules: string[]` of
exported installers, in production order, to opt into particular faction signatures/passives. An executable equivalence
test checks the default list against `createGameWorld`, including its hidden RNG draw and complete state. Optional
`budgeted` uses the real legacy `TokenBucket` on simulation time and records acceptance, including over-budget and queue-full refusals. Rust compares every validation/submission outcome. Inputs/actions must fall on a captured tick in nondecreasing order; requirements count replayed records, so surplus or out-of-order records cannot pass. Optional `config`, `secrets`, initial `containers`, `generatedMapSeed` and `record` declarations keep setup reproducible.

The six P-COMBAT-1 scenarios in `scenarios/melee.ts` record each hand, slot, windup, stagger immunity,
armor mirror, per-source shred, and every field of every container on every tick. They install the usual legacy
modules in their recorded order except `consumables`, which periodically spawns unrelated map pickups.
`swap_cooldown` also sets `weaponSpecials: false`, which disables the axe shred (and future wand splash).
Shield blocks, passive returns and sword stagger retain their ordinary rules. `emblem_during_melee` retains
the full production module installation: its wind-emblem container appears at tick 238. It remains capture-only
for P-CONS-1, and a regression test requires that the current simulation report this specific missing container.
All six matched cases run through death and settlement for at least 200 ticks. The comparison requires the
full combat, status and container streams on every tick. Container IDs use base 36 after a leading `c`,
and decimal item UIDs come from the injected `sequential/1` counter.

The executable skeletons in `scenarios/catalogue.ts` remain capture-only until their named packets implement complete
comparisons. Each records nonempty `requires`; a test verifies those requirements occurred.

| Scenarios | Promotion packet |
|---|---|
| `swap_pickup`, `sword_duel`, `axe_duel`, `shield_duel` | P-COMBAT-1 |
| `bow_wand_capture`, `wand_lock` | P-COMBAT-2 |
| `signature_fire`, `signature_frost`, `signature_holy`, `signature_plague`, `signature_sentenced` | P-FACTION-1 |
| `planning`, `coliseum_sudden_death` | P-ARENA-1 |
| `mob_camp` (real generated-map camp spawns) | P-MOBS-1 |

The camp skeleton captures four ticks to avoid storing repeated full rosters; its mechanic packet extends combat coverage.
Existing slice fixtures keep their original state, tick, result and input comparisons. Generic recording adds windup
`a/ms`, death `x/y`, victory `name`, bounty `id/name/bounty` and the complete previously collapsed `projEnd` payload.

## Recapture gate

Use Node **22.23.4 on Linux x86_64**, the exact CI runtime/platform. macOS arm64 produces five raw input-angle
ULP differences in the existing scenarios even with the same Node version; Linux x86_64 reproduces the original inputs
exactly. Use an isolated Linux x86_64 container for committed recaptures from a Mac. The diff deliberately refuses those
platform differences instead of rounding or tolerating recorded inputs. `.github/workflows/parity-recapture.yml` installs dependencies, runs capture
helper/mutation tests, re-captures into a fresh temporary directory with a 600-second timeout, runs `check-recapture.mjs --generated`, then `cargo test -p rh-parity`.
The diff compares every committed/current JSON file under `fixtures/` and `maps/`, including additions/deletions (a removed scenario cannot leave a stale fixture behind), ignoring
only the independently authored `maps/duel.map.json` when comparing generated inventory and the top-level `legacyRevision`. It names changed scenarios and tells the author to update Rust or deliberately
re-record when a legacy rule changes. No numerical tolerance is applied to the recapture diff.

Local full capture before the four-tick `order_budget` case (27 scenarios plus 300 path queries and the map) measured **2.42 s** wall time on macOS arm64 with Node
25.8.1 (diagnostic capture; committed outputs were generated with Linux x86_64 Node 22.23.4); the CI runner time is not yet measured. The ten-minute CI timeout enforces the packet's maximum.

```
node --import tsx --test parity/legacy-capture/*.test.ts
node parity/legacy-capture/check-recapture.mjs          # compare with HEAD, ignoring provenance only
```
