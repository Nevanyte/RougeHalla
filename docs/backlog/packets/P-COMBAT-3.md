# P-COMBAT-3: target lock and the locked-windup cancel

## Stage 2 implementation boundary

The Rust core/policy/headless phase is implemented and independently reviewed. Explicit public targets require
delivered actor records, and unseen guesses are budgeted misses. The approved hidden-candidate vision correction,
actual capture counts, checkpoint repairs and numeric-ID ordering scope are recorded in
[evidence](../../evidence/stage2-targeting-zones/README.md). Live protocol-5 inputs, target metadata and cancel
presentation remain open; the v5 adapter explicitly omits the new core cancel event.

## ID and outcome
P-COMBAT-3. The wand-only target lock (`target {id}`), its server-played chase/aim/trigger, its drop rules, exact committed
cast/cancellation behavior, and attack-move (`attackMove`), with actual source captures. Preserve the original full-world
`bow_wand_capture` as capture-only until its consumable-produced entity allocations are ported; do not remap IDs or strip
modules to relabel that trace as matching. A separately named explicit-module combat fixture can test this prerequisite.

## Dependencies
P-COMBAT-2 (projectiles, homing balls, `leadAim`). P-COMBAT-1 (swap drops the lock unless the new weapon is a wand).
Visibility uses `canPlayerSeeActor`: the 30-second trail/bush prerequisite is implemented (P-VISION-1), correcting stale
120-second text. Ward/hunter/training and ability producers remain pending; do not introduce substitute flags for them.

## Relevant legacy paths (verified)
- `packages/server/src/sim/targeting.ts`: `lockable` (l.24), `handleTarget` (l.30), `updateTargets` (l.74), `acquireAttackMoveTarget`, `resumeAttackMove`, `follow`, `chase`, `sealedOff`; `GOAL_MOVED` 8.
- `packages/server/src/sim/weapons.ts`: `setLock`, `dropLock`, `cancelLockedWindup`, `cancelAction`; `PendingAction.target`, `WeaponRuntime.lock*` fields (`lockSeen`, `lockLosLostAt`, `lockSearchAt`, `lockPlanAt`, `lockGoal`, `attackMoveGoal`).
- `packages/server/src/sim/step.ts`: where `move`/`stop`/`target` cancel the lock and the windup (`cancelLockedWindup`, `dropLock`), and the tick position of `updateTargets` (after abilities, before weapons).
- `packages/shared/src/policies.ts`: `lockSpacing` (l.58), `decide`, `leadAim` (l.160), `POLICIES`.
- `packages/shared/src/constants.ts`: `TARGET_SNAP_RADIUS` 64 (client only), `TARGET_RANGE` 640, `TARGET_LOS_GRACE_MS` 1500, `TARGET_REPATH_MS` 250, `MOB_AIM_DEADBAND`.
- Tests: `packages/server/test/targeting.test.ts`, `targetingThrottle.test.ts`, `visionTargeting.test.ts`, `playtestCombatControls.test.ts`, `pathLoad.test.ts`.

## New paths
`crates/rh-sim/src/systems/targeting.rs` (+ `policies.rs` if `decide`/`lockSpacing` are ported as a pure module shared with P-BOTS-1 and P-MOBS-1); capture scenarios.

## Exclusive write scope
`crates/rh-sim/src/{systems/targeting.rs,policies.rs,systems/inputs.rs,systems/weapons.rs,systems/mod.rs,schedule.rs,state.rs,fighter.rs,scratch.rs,checkpoint.rs,input.rs,content.rs,lib.rs}`, `crates/rh-sim/tests/`, `crates/rh-parity/**`,
`parity/legacy-capture/capture.ts` (scenarios), `parity/fixtures/`. New commands (`Target`, `AttackMove`) extend `RawCommand` and
the private `Kind` behind the opaque `Command` in `input.rs` (a variant is built by `validate` only; its decode re-validates); the protocol/C# mirror is a shared-file change (README). Core layout rules (post-sweep, [ADR 0009](../../adr/0009-core-layout.md); the README "Shared-file rule" has the long form): the mechanic is `systems/<mechanic>.rs` with `fn(&mut Cx)` entry points, plus its rows flipped from `Pending` to `Ported` in `schedule.rs` at their legacy position (the row names, never a reorder); entity data goes in `fighter.rs` / `state.rs` / `store.rs` (hashed and checkpointed: extend `check_world` in `checkpoint.rs` if the new data has an invariant the tick relies on) and per-tick lists in `TickScratch` (`scratch.rs`, never serialized); `tests/no_alloc.rs` must stay at zero allocations per step, new content goes through the `content.rs` registry (`content_hash`), and every new serialized field must be covered by `tests/hash_coverage.rs`. `sim.rs` is a facade and is not in any write scope.

## Contracts and references
C-INPUT (`target` is a normal validated command; one path search per `TARGET_REPATH_MS` per player is the abuse bound), C-TICK
(`updateTargets` position), C-OBS, C-PARITY. ADR 0005 (policies may issue `target` through the same seat path).

## Behaviour to preserve
- Only the **wand** locks (`handleTarget`: `activeWeapon === "wand"`); the game client sends `target` for the wand and `attack`/`release` for everything else. Mobs never lock. Other weapons still walk an accepted attack-move point; acquisition alone is wand-gated.
- `lockable`: target standing, not evading, not untargetable (Swarm, P-ABIL-1), hostile, visible to the locker (players), within `TARGET_RANGE` 640 u. Line of sight is not needed to lock, only to attack; a target out of sight needs a path (one search; an order sooner than `TARGET_REPATH_MS` after the last is refused). Re-clicking the locked fighter changes nothing (no cooldown loss, trigger kept). A new lock clears the earlier walk and lets go of the trigger; the old lock's pending windup is cancelled unless it already targets the new fighter.
- Each tick (`follow`): drop to `resumeAttackMove` when the locker is not standing, the target is gone/unlockable, or the weapon is no longer the wand; a stunned locker keeps the lock but does not chase/aim/fire; sight bookkeeping (`lockSeen`, `lockLosLostAt`; a target seen once and then out of sight for `TARGET_LOS_GRACE_MS` 1.5 s is dropped, a target never seen is chased behind the wall); `decide(...)` with `lockSpacing("wand")`: `far = 0.88 * 640`, `attackRange = 0.96 * 640`, `retreatBelow 0`, lead speed from the policy; movement re-planned at most every `TARGET_REPATH_MS` and only if the goal moved over `GOAL_MOVED` 8 u or the path ran out; a goal with no path that is out of sight, or provably in another move component (`sealedOff`, `moveComponents`), ends the lock.
- A locked attack has **no client `t`**: `lagMs = TICK_MS`; it is aimed from the present with `leadAim` on the target's velocity; the wand ball homes on the target (`targetId`, P-COMBAT-2). Facing follows `out.aim` when it differs by `MOB_AIM_DEADBAND`.
- Orders replace each other in arrival order within a tick (`moveBefore`/`aimBefore` indexes in the Rust `InputQueue` already model this): `move`/`stop`/`attack` drop the lock (an unreachable `move` still does); `target` lets go of the trigger.
- `step.ts::applyMove` calls `cancelLockedWindup(..., true)` for move/stop/attack-move: a committed targeted wand cast
  survives these orders (`playtestCombatControls.test.ts:67–75`). An accepted different target, unless already the pending
  target, and fresh attack-move acquisition use non-preserving cancellation: refund `readyAt = startedAt`, cut root,
  clear draw start and emit cancel. Same-target re-click, refused target, landed attack and ordinary attack cancel nothing.
  Directional windups remain committed. The old packet's cancel-by-move expectation was stale.
- Attack-move walks its accepted point for any weapon. With a wand it acquires the nearest lockable hostile in
  `attackRange` with line of sight (ties: cursor distance, then smaller id); after losing a target it resumes the point order.
- `endRun` and the teleport drop every lock; a swap to a non-wand drops it.
- Doc/code note: docs/legacy/CLAUDE_LEGACY.md describes bows as locking in older text; code and "Live playtest controls" say wand only.

## Acceptance checks
1. Compare the existing 100-tick `wand_lock` plus strict new scenarios; retain the original 727-tick full-world bow/wand
   fixture until its real consumable allocations exist. Its launch IDs skip 40->42, 87->89 and 125->127; investigate actual
   producer/RNG effects rather than renumbering. Capture settled lock/path/trigger/timer/action state and launch/end IDs.
2. New cases: behind-wall chase, 1.5 s direct-LOS grace, re-click no-op, move/stop/attack-move preserving the committed
   wand cast, accepted retarget refund/cancel, autonomous acquisition/ties/resume, swap/drop and terminal cleanup.
3. Unit tests: independent order-search and chase-replan throttles (each at most once per 250 ms; together up to two),
   sealed-component drop and exact 640/641 range boundary. Stun/untargetable integration waits for actual status producers.
4. Replay/checkpoint determinism with an active lock.
5. Tolerance: ticks/events/targets exact; positions and facings within 2e-6 (a path replanned one tick later is a failure, not noise).

## Validation commands
`npx tsx parity/legacy-capture/capture.ts --only bow_wand_capture` (and new names), `cargo test -p rh-sim`, `cargo test -p rh-parity`,
`cargo test --workspace`, `cargo run -p rh-parity --bin parity-report`, `cargo clippy --workspace --all-targets`.

## Risk and suggested model tier
High: strongest model, high effort. Many interacting timers (`lockPlanAt`, `lockSearchAt`, `lockSeen`), path planning shared
with the ported A*, and float-sensitive aiming. Read `targeting.test.ts` first and port its cases as Rust tests.

## Known traps
- Tick order: `updateTargets` runs after the abilities phase and before `update_weapons`; never move it. A fighter that just became untargetable loses locks in the same tick, which is why abilities precede it (P-ABIL-1 inserts before).
- The path search budget matters for parity: a replanned path on a different tick changes positions. Port `lockSearchAt/lockPlanAt` exactly, including `-Infinity` initial values (use `f64::NEG_INFINITY` and make sure serialisation of the state hash handles it, or store options).
- `moveComponents` is a cached flood per map; the Rust map may need it added (check `crates/rh-sim/src/map.rs`).
- A refused `target` is silent (no toast), and still counts toward the order budget.
- Do not accept positions from clients; `target` carries an id only.
- Public targets resolve only actors from the last successfully delivered actor view that remain legitimately visible.
  Hidden/missing guesses consume identical budget and replay as explicit misses. Observer target records are derived,
  session-owned and reset on disconnect. Target metadata in SelfView must obey the same simultaneous visibility filter.
- Legacy candidate lookup may refresh private vision before refusal. Test odd-phase moving paired worlds with hidden
  versus absent candidates, including later expiry. Any deliberate correction of that concealed-existence side effect
  must have concrete evidence and independent C-OBS review; do not mask private trace fields or widen tolerances.
