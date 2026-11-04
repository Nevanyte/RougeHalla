# P-ARENA-1: planning phase, coliseum, patience and sudden death

## ID and outcome
P-ARENA-1. The run lifecycle around the active phase matches legacy: lobby -> **planning** (private spawn deal, picks, ready) ->
active -> the **coliseum schedule** (patience timer, teleport, gates lock, teleport immunity) -> **sudden death** burn -> end,
including the MIA-in-planning rule and the first-patience rules. Today the Rust slice goes lobby -> active and never teleports
(the `Pending("P-ARENA-1")` rows in `crates/rh-sim/src/schedule.rs` and the bracketed comment in `systems/settle.rs` mark where it plugs in).

## Dependencies
None hard. Needs map data the `rh-map/1` export lacks: per-spawn zone and walk tier (for the deal), the coliseum centre, the four gates
and the coliseum spots (`fixedLayout`, `GameMap.coliseum`), gate lock via `withGates`. Add them to the export as **additive**
`rh-map/2` fields (the coordinator serialises capture.ts edits with P-MOBS-1, which adds camps/territory, and P-MAP-1). Until
P-MAP-1 lands, hand-built test maps get a coliseum helper in `rh-sim` tests.

## Relevant legacy paths (verified)
- `packages/server/src/sim/planning.ts`: `startPlanning` (l.80), `updatePlanning` (l.102), `planFor` (l.116), `leavePlanning` (l.138), `assignSpawns` (l.204), `dealSpawns` (l.258), `PlanningRuntime`.
- `packages/server/src/sim/arena.ts`: `beginRun` (l.70), `markTickStart`, `downPlayer` (l.323), `missInPlanning` (l.349), `suddenDeath` (l.391), `settle` (l.408), `endRun`, `teleportToColiseum` (l.495), `coliseumSpots` (l.530), `patienceMs` (l.59), `scheduleOf` (l.64).
- `packages/server/src/sim/step.ts` (lobby/planning/active dispatch, `lastOneStanding`, removePlayer in planning), `packages/server/src/rooms/RaidRoom.ts` (room lock at planning start, `sendPlan`, reconnect resend).
- `packages/shared/src/rules.ts` (`coliseumSlotAt` l.40, `suddenDeathShare` l.51, `patienceSecondsFor`), `planning.ts` (`spawnWalks`, `sameTier`, `walkSeconds`, `primeSpawnWalks`), `coliseum.ts` (`fixedLayout` l.66), `map.ts` (`withGates` l.324, `GameMap.coliseum`), `messages.ts` (`PlanMessage`), `constants.ts` (l.129-190).
- Tests: `packages/server/test/planning.test.ts`, `planningRoom.test.ts`, `arena.test.ts`, `lifecycle.test.ts`, `lobby.test.ts`.

## New paths
`crates/rh-sim/src/systems/planning.rs`, `crates/rh-sim/src/systems/arena_rules.rs` (coliseum/sudden death), a `plan_seed` and `teleport_seed` in `Secrets`, protocol additions
(`Plan` message to one player, phase `Planning`), capture scenarios and `rh-map/2` fields.

## Exclusive write scope
`crates/rh-sim/src/{systems/planning.rs,systems/arena_rules.rs,systems/mod.rs,schedule.rs,state.rs,scratch.rs,statics.rs,checkpoint.rs,constants.rs,content.rs,map.rs,observe.rs,rng.rs,lib.rs}`, `crates/rh-sim/tests/`,
`crates/rh-parity/**`, `crates/rh-server/src/{room.rs,wire.rs}` for sending the private plan, `parity/legacy-capture/capture.ts`,
`parity/maps/`. Protocol/C# edits are the shared-file change (README). Core layout rules (post-sweep, [ADR 0009](../../adr/0009-core-layout.md); the README "Shared-file rule" has the long form): the mechanic is `systems/<mechanic>.rs` with `fn(&mut Cx)` entry points, plus its rows flipped from `Pending` to `Ported` in `schedule.rs` at their legacy position (the row names, never a reorder); entity data goes in `fighter.rs` / `state.rs` / `store.rs` (hashed and checkpointed: extend `check_world` in `checkpoint.rs` if the new data has an invariant the tick relies on) and per-tick lists in `TickScratch` (`scratch.rs`, never serialized); `tests/no_alloc.rs` must stay at zero allocations per step, new content goes through the `content.rs` registry (`content_hash`), and every new serialized field must be covered by `tests/hash_coverage.rs`. `sim.rs` is a facade and is not in any write scope.

## Contracts and references
C-RNG (deal and teleport shuffles are **secret streams**, new `Secrets` fields, never derived from the public map seed; the legacy deal reads `rewardRandom`, the teleport shuffle `world.random`), C-TICK (settle is last; the teleport only happens in a tick with no death), C-OBS (the deal is private: observation/protocol carry only the player's own two options and `taken` flags), C-NET (admission refused once locked at planning), C-PARITY. `docs/GAME_DESIGN.md` section 6. ADR 0007.

## Behaviour to preserve
- Phases: lobby closes -> `planning` when `planSeconds > 0` (live: `PLAN_SECONDS` 45; tests use 0 and `firstPatienceSeconds 0`); the Room locks at planning start; nobody moves or takes damage, no mobs exist; only `plan {spawn?: 0|1, boon?, ready?}` is applied, in the tick's secret action order, other inputs are drained and dropped. First to pick a spawn holds it; picking the other frees the first; `ready: true` latches and freezes picks. Ends at `planEndsAt`, when every **connected** player is ready, or `lastOneStanding`. `assignSpawns`: a pick stands, the rest take their first free option, then the other, then the free spawn nearest by walk.
- Deal (`dealSpawns`): two spawns per player from `map.spawnPool`, both in one walking tier (`sameTier`, `PLAN_WALK_TOLERANCE` 0.08) and in different zones; no spawn dealt twice while `2n <= pool`; windows/global tier rules then fallbacks (`rule: pairs | global | fallback | none`). Drawn only from the private reward stream; sent only as the player's own `plan` message (`endsAt, spawns, taken[2], pick, boons[], boon`) at planning start, on every change, and on reconnect.
- Leaving during planning is **MIA** (`missInPlanning`): `resolved` outcome `mia`, `place` = players still in the room, 0 GV, counts as a run and a death in persistence; no body, no kill credit. The leaver stays a starter (win-bonus gate counts them). A shutdown during planning voids (`abandonPlayer`, sticky `voided`). A dropped player keeps the seat and gets the default spawn.
- The first patience timer is flat `FIRST_PATIENCE_SECONDS` 300 when only that is set; **but the default live schedule is the coliseum schedule** (`COLISEUM_FIRST_SECONDS` 600, `SECOND` 900, `REPEAT` 120, `MIN_GAP` 30): `coliseumSlotAt(startedAt, notBefore, first, second, repeat)`; after a death outside the coliseum the next slot is the first at or after `now + min_gap`; deaths inside the coliseum move nothing but reopen the gates (`gatesLocked = false`, `inColiseum = false`, `suddenDeathAt = 0`). Old patience (`PATIENCE_SECONDS` 300 at 8 alive, `PATIENCE_MIN_SECONDS` 120 at <=3, linear) applies only without a schedule.
- Teleport (`teleportToColiseum`, only from `settle` in a tick with no death): spots from `coliseumSpots` shuffled with the secret stream; position set, `immuneUntil = now + 1500`, path and queued inputs cleared, history reset to the new spot, `gatesLocked`, `inColiseum`, `suddenDeathAt = now + SUDDEN_DEATH_SECONDS (60) * 1000`, `teleported` hook (later packets clear projectiles, refund casts, reset mobs), a `teleport` fx. While `gatesLocked`, movement/collision/LOS use the gated map.
- Sudden death (`suddenDeath`, between `beforeDamage` and the ledger): after `suddenDeathAt`, each alive player takes a **true-damage ledger entry** (`arena: true`, killer id `SUDDEN_DEATH_KILLER`) of `suddenDeathShare(elapsed) = 0.02 + 0.02 * floor(elapsed_s)` of max hp per second times dt. It is a ledger entry (lands with the tick's hits, no hit fx, no kill credit of its own).
- Docs disagree: docs/legacy/CLAUDE_LEGACY.md says `PLAN_SECONDS` 12 and a patience timer with 40% minimum; code has 45 and the coliseum schedule (INVENTORY section 9). Code wins.

## Acceptance checks
1. Capture planning and teleport scenarios from the real legacy world with `planSeconds` set (the capture config currently sets `patienceSeconds: 3600` to disable them; add per-scenario `planSeconds`, `coliseumSchedule` and a coliseum-bearing hand-built map or the `seed1` map): `planning_picks_and_ready`, `planning_leave_mia`, `coliseum_teleport_first_slot`, `sudden_death_burn`, `death_reschedules_slot`.
2. Plans are private: add a new field to the fixture (`plans`) with each player's message sequence; compare messages exactly. Two worlds with different secret seeds produce different deals but identical public state (port `planning.test.ts` "deals are private").
3. `cargo test -p rh-parity` and an observation leak test: no other player's options appear in another's observation.
4. Deal statistics: for a pool of 24-32 (use the exported seed1 spawn pool) over 200 deals of 2..8 players, every pair is one tier and different zones, no duplicates while `2n <= pool` (the legacy numbers: 100% tiering, deal under 0.9 ms).
5. Replay/checkpoint determinism across a teleport; the browser proof still passes.

## Validation commands
`npx tsx parity/legacy-capture/capture.ts --only <scenario>`, `cargo test -p rh-sim`, `cargo test -p rh-parity`, `cargo test -p rh-headless`,
`cargo test -p rh-server`, `cargo test --workspace`, `node tools/browser-proof/proof.mjs` (after `cargo build -p rh-server`),
`dotnet test client-unity/RoguehallaNet.Tests` if the protocol changed.

## Risk and suggested model tier
Medium-high: mostly lifecycle bookkeeping but with a private-stream and protocol change. Strong builder; strongest model for the
`settle` ordering and the MIA/void semantics.

## Known traps
- `settle` stays the last step; a teleport and a death never share a tick; "hp fraction at tick start" decides same-tick winners (already ported).
- The teleport shuffle used `Math.random`-seeded `world.random`: use a dedicated seed, do not reuse `order_salt` (it also keys tie ranks, which a client can stage and read).
- The deal must not leak through anything public (order of spawn assignment, timing of messages). Send the plan off the tick path like other private messages.
- Doors: gates are part of the map (`withGates`), not of `Sim` state; keep a gated copy cached per map like legacy.
- Legacy events emitted between ticks (leaves) travel with the next step; a leave during planning must not require a step to resolve.
