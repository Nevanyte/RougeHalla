# P-ARENA-1: planning phase, coliseum, patience and sudden death

## ID and outcome
P-ARENA-1. The run lifecycle around the active phase matches legacy: lobby -> **planning** (private spawn deal, picks, ready) ->
active -> the **coliseum schedule** (patience timer, teleport, gates lock, teleport immunity) -> **sudden death** burn -> end,
including the MIA-in-planning rule and the first-patience rules. Today the Rust slice goes lobby -> active and never teleports
(the `Pending("P-ARENA-1")` rows in `crates/rh-sim/src/schedule.rs` and the bracketed comment in `systems/settle.rs` mark where it plugs in).

## Dependencies
The complete map generator and admitted `rh-map/2` layers are integrated: `mapdata::MapLayers` already supplies the
spawn pool, coliseum centre, ordered gates and inner spawns. Consume these fields; do not replace map fixtures or add
a competing export. `shared/planning.ts::spawnWalks` still requires an exact native caller over the admitted map.

Serialize runtime integration after the in-flight P-TERRAIN-1 checkpoint/path changes. Terrain currently refuses a
restored locked gate because the arena transition is unported; this packet must replace that temporary refusal with
validated lifecycle invariants and prove locked-state continuation. Selected mobs, weapons, statuses and terrain
already have hook links whose actual teleport behavior must be preserved. Complete cards/boons and other unported
hook producers remain separately tracked; do not fabricate neutral behavior and call the full game complete.

## Relevant legacy paths (verified)
- `packages/server/src/sim/planning.ts`: `startPlanning` (l.80), `updatePlanning` (l.102), `planFor` (l.116), `leavePlanning` (l.138), `assignSpawns` (l.204), `dealSpawns` (l.258), `PlanningRuntime`.
- `packages/server/src/sim/arena.ts`: `beginRun` (l.70), `markTickStart`, `downPlayer` (l.323), `missInPlanning` (l.349), `suddenDeath` (l.391), `settle` (l.408), `endRun`, `teleportToColiseum` (l.495), `coliseumSpots` (l.530), `patienceMs` (l.59), `scheduleOf` (l.64).
- `packages/server/src/sim/step.ts` (lobby/planning/active dispatch, `lastOneStanding`, removePlayer in planning), `packages/server/src/rooms/RaidRoom.ts` (room lock at planning start, `sendPlan`, reconnect resend).
- `packages/shared/src/rules.ts` (`coliseumSlotAt` l.40, `suddenDeathShare` l.51, `patienceSecondsFor`), `planning.ts` (`spawnWalks`, `sameTier`, `walkSeconds`, `primeSpawnWalks`), `coliseum.ts` (`fixedLayout` l.66), `map.ts` (`withGates` l.324, `GameMap.coliseum`), `messages.ts` (`PlanMessage`), `constants.ts` (l.129-190).
- Tests: `packages/server/test/planning.test.ts`, `planningRoom.test.ts`, `arena.test.ts`, `lifecycle.test.ts`, `lobby.test.ts`.

## New paths
`crates/rh-sim/src/systems/planning.rs`, `crates/rh-sim/src/systems/arena_rules.rs` (coliseum/sudden death), private planning
state and exact source capture cases. Planning draws from the existing private reward stream at its actual caller
position. Teleport uses the world's private general RNG, which must preserve its relationship to the unconditional
raid-start spawn shuffle. Audit existing `Secrets`/RNG ownership before adding any stream; do not invent an independent
planning seed. Add owner-only plan observations/transport and phase `Planning` as a serialized compatibility change.
Exact new capture/helper filenames and integration owners are assigned before implementation.

## Exclusive write scope
`crates/rh-sim/src/{systems/planning.rs,systems/arena_rules.rs,systems/mod.rs,schedule.rs,state.rs,scratch.rs,statics.rs,checkpoint.rs,constants.rs,content.rs,map.rs,observe.rs,rng.rs,lib.rs}`, `crates/rh-sim/tests/`,
`crates/rh-parity/**`, `crates/rh-server/src/{room.rs,wire.rs}` for sending the private plan, `parity/legacy-capture/capture.ts`,
`parity/maps/`. Protocol/C# edits are the shared-file change (README). Core layout rules (post-sweep, [ADR 0009](../../adr/0009-core-layout.md); the README "Shared-file rule" has the long form): the mechanic is `systems/<mechanic>.rs` with `fn(&mut Cx)` entry points, plus its rows flipped from `Pending` to `Ported` in `schedule.rs` at their legacy position (the row names, never a reorder); entity data goes in `fighter.rs` / `state.rs` / `store.rs` (hashed and checkpointed: extend `check_world` in `checkpoint.rs` if the new data has an invariant the tick relies on) and per-tick lists in `TickScratch` (`scratch.rs`, never serialized); `tests/no_alloc.rs` must stay at zero allocations per step, new content goes through the `content.rs` registry (`content_hash`), and every new serialized field must be covered by `tests/hash_coverage.rs`. `sim.rs` is a facade and is not in any write scope.

### Approved private implementation scope (2026-11-06)

The coordinator and independent reviewer approved core-first implementation after source/caller audit. Necessary
`sim.rs` changes are thin delegations only, amending its exclusion above. The worker proposes changes privately;
the coordinator retains root integration, shared versions/status, Cargo.lock and public activation.

1. Derive an immutable locked collision view and route actual movement/path/target/projectile/melee/item/observer
   consumers. Keep canonical layers/terrain intact and classify intentional open-map consumers individually.
   Historical vision records its collision variant; same-tick reveals need an ordinal or equivalent invalidation in
   tile caches and stationary-tail matching. Preserve source exploration across transitions.
2. Implement exact planning/deal and arena lifecycle below the facade, with input/events/hook/state/restore changes
   and owner-only observations. Extend the affected vision, sight, fighter, lifecycle and projection modules as the
   caller audit requires. All actors use validate/submit. Headless/policy integration follows the same core.
3. Validate planning records by phase: source retains deals/holders/last-sent state into Active/Ended, including records
   for actors removed after start. Current membership/holder reciprocity applies during Planning; later records require
   valid historical identities and bounds. Preserve valid source history.
4. Distinguish constructor prefixes by installed modules. Source mode with neither loot nor mobs still consumes its
   order-salt draw. Source mobsOn/lootOff requires its actual capture-backed prefix or explicit refusal; it must not
   inherit the foundation's synthetic loot-prefix consumption. Preserve existing public profile behavior.
5. Serialize protocol/client/server/durable shutdown work afterward. Protocol6 cannot expose this mode. Planning
   indices need ordered pool mapping and server-produced choice facts, or resolved owner-option facts; gate metadata
   alone is insufficient. Unity implements no deal, pathfinding, matchup or arena rules. Public activation waits for
   actual Rust/C#/JS vectors, UI and persistence checks.

Source witness scope is `tools/arena-fixtures/**` and `parity/arena/**`, initially proposed privately with immutable
inputs, source hashes and one canonical reproduction. No legacy corpus replacement, map re-pin, cloud action or
Unity visual expansion belongs to this implementation stage.

## Contracts and references
C-RNG (the deal reads existing private `rewardRandom`; raid-start spawn shuffle and teleport read private `world.random`,
never the public map seed), C-TICK (settle is last; teleport only in a tick with no death), C-INPUT (the new plan command
passes validate/submit and the existing action budget), C-OBS (only the owner's two options and `taken` flags), C-NET
(admission closes at planning), C-DET/C-NUM (all private lifecycle state hashed/restored, no nonfinite sentinels), C-PARITY.
ADRs0005/0007/0009/0018/0019. Protocol6 is current; bump incompatible versions and regenerate all three golden decoders.

## Behaviour to preserve
- Phases: lobby closes -> `planning` when `planSeconds > 0` (live: `PLAN_SECONDS` 45; tests use 0 and `firstPatienceSeconds 0`); the Room locks at planning start; nobody moves or takes damage, no mobs exist; only `plan {spawn?: 0|1, boon?, ready?}` is applied, in the tick's secret action order, other inputs are drained and dropped. First to pick a spawn holds it; picking the other frees the first; `ready: true` latches and freezes picks. Ends at `planEndsAt`, when every **connected** player is ready, or `lastOneStanding`. `assignSpawns`: a pick stands, the rest take their first free option, then the other, then the free spawn nearest by walk.
- Deal (`dealSpawns`): two spawns per player from `map.spawnPool`, both in one walking tier (`sameTier`, `PLAN_WALK_TOLERANCE` 0.08) and in different zones; no spawn dealt twice while `2n <= pool`; windows/global tier rules then fallbacks (`rule: pairs | global | fallback | none`). Drawn only from the private reward stream; sent only as the player's own `plan` message (`endsAt, spawns, taken[2], pick, boons[], boon`) at planning start, on every change, and on reconnect.
- Leaving during planning is **MIA** (`missInPlanning`): `resolved` outcome `mia`, `place` = players still in the room, 0 GV, counts as a run and a death in persistence; no body, no kill credit. The leaver stays a starter (win-bonus gate counts them). A shutdown during planning voids (`abandonPlayer`, sticky `voided`). A dropped player keeps the seat and gets the default spawn.
- The first patience timer is flat `FIRST_PATIENCE_SECONDS`300 when only that is set; the default live schedule is
  `COLISEUM_FIRST_SECONDS`600, `SECOND`900, `REPEAT`120, `MIN_GAP`30. **With a schedule, a death outside the locked
  coliseum leaves the existing slot unchanged and only blocks teleport in that tick. A death while gates are locked
  chooses the first slot at or after `now + min_gap`, then reopens gates and clears `inColiseum`/`suddenDeathAt`.** This is
  the actual `arena.ts::settle` behavior; the earlier packet had these cases reversed. Without a schedule, any death
  resets the scaled patience timer (300s at8 alive,120s at<=3, linear). `firstPatienceSeconds:0` disables the schedule;
  it does not itself make the fallback patience timer zero. No repeat slot is source Infinity; encode it as a typed
  absent deadline in Rust rather than admitting a nonfinite serialized value.
- Teleport (`teleportToColiseum`, only from `settle` in a tick with no death): spots from `coliseumSpots` shuffled with the secret stream; position set, `immuneUntil = now + 1500`, path and queued inputs cleared, history reset to the new spot, `gatesLocked`, `inColiseum`, `suddenDeathAt = now + SUDDEN_DEATH_SECONDS (60) * 1000`, `teleported` hook (later packets clear projectiles, refund casts, reset mobs), a `teleport` fx. While `gatesLocked`, movement/collision/LOS use the gated map.
- Sudden death (`suddenDeath`, between `beforeDamage` and the ledger): after `suddenDeathAt`, each alive player takes a **true-damage ledger entry** (`arena: true`, killer id `SUDDEN_DEATH_KILLER`) of `suddenDeathShare(elapsed) = 0.02 + 0.02 * floor(elapsed_s)` of max hp per second times dt. It is a ledger entry (lands with the tick's hits, no hit fx, no kill credit of its own).
- Docs disagree: docs/legacy/CLAUDE_LEGACY.md says `PLAN_SECONDS` 12 and a patience timer with 40% minimum; code has 45 and the coliseum schedule (INVENTORY section 9). Code wins.
- `startRaid` always consumes the ordinary shuffled-spawn draws, including when planning supplies every position.
  Slot assignment uses binary64 source order and stable equal-distance ties. Gate closure changes collision, LOS,
  pathfinding and projectile/melee sweeps through the same active collision view; terrain remains the original static
  layer. An immutable cached gated view must have its own derived caches, without mutating shared map layers or
  passing a deliberately closed gate through canonical open-map admission.

## Acceptance checks
1. Capture planning and teleport scenarios from the real legacy world with `planSeconds` set (the capture config currently sets `patienceSeconds: 3600` to disable them; add per-scenario `planSeconds`, `coliseumSchedule` and a coliseum-bearing hand-built map or the `seed1` map): `planning_picks_and_ready`, `planning_leave_mia`, `coliseum_teleport_first_slot`, `sudden_death_burn`, `death_reschedules_slot`.
2. Plans are private: add a new field to the fixture (`plans`) with each player's message sequence; compare messages exactly. Two worlds with different secret seeds produce different deals but identical public state (port `planning.test.ts` "deals are private").
3. `cargo test -p rh-parity` and an observation leak test: no other player's options appear in another's observation.
4. Deal statistics: for a pool of 24-32 (use the exported seed1 spawn pool) over 200 deals of 2..8 players, every pair is one tier and different zones, no duplicates while `2n <= pool` (the legacy numbers: 100% tiering, deal under 0.9 ms).
5. Replay/checkpoint determinism across a teleport; the browser proof still passes.
6. Compare scheduled outside/inside deaths, between-tick MIA, deaths on a due-teleport tick, firstPatienceSeconds0,
   repeat<=0, all-disconnected ready state, solo planning, shutdown voiding and reconnect. Prove locked-gate collision,
   sight/projectile filtering, history/input/slide reset, teleport immunity and exact first sudden-death tick. Drive
   ordinary fixed steps across boundaries rather than substituting a clock jump. Include shared mob/weapon/status
   hooks and owner-outliving effects for all admitted producers; mark remaining producer domains explicitly.
7. Headless and live policies receive only their own current plan through immutable observations, use validate/submit,
   and preserve simulated action timing. Test hidden deals against absent/alternate deals through observations,
   events and transport; no private stream/counter/digest is public. Check invalid holders, duplicate picks, deadlines,
   phase tuples and gate map selection on restore. Steady ordinary movement/combat remains allocation-free.

## Validation commands
`npx tsx parity/legacy-capture/capture.ts --only <scenario>`, `cargo test -p rh-sim`, `cargo test -p rh-parity`, `cargo test -p rh-headless`,
`cargo test -p rh-server`, `cargo test --workspace`, `node tools/browser-proof/proof.mjs` (after `cargo build -p rh-server`),
`dotnet test client-unity/RoguehallaNet.Tests` if the protocol changed.

## Risk and suggested model tier
Medium-high: mostly lifecycle bookkeeping but with a private-stream and protocol change. Strong builder; strongest model for the
`settle` ordering and the MIA/void semantics.

## Known traps
- `settle` stays the last step; a teleport and a death never share a tick; "hp fraction at tick start" decides same-tick winners (already ported).
- The teleport shuffle uses `world.random`; preserve its private sequence with the unconditional raid-start shuffle.
  Do not reuse `order_salt` or the public map seed, or introduce an extra stream that changes source draw order.
- The deal must not leak through anything public (order of spawn assignment, timing of messages). Send the plan off the tick path like other private messages.
- Doors: gates are part of the map (`withGates`), not of `Sim` state; keep a gated copy cached per map like legacy.
- Legacy events emitted between ticks (leaves) travel with the next step; a leave during planning must not require a step to resolve.
