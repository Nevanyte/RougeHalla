# Actual legacy arena witnesses

`source.json` (`rh-arena-source/1`) records unchanged TypeScript source constructors,
private planning, ordinary50ms lifecycle ticks, coliseum transitions and actual source
geometry/vision/projectile behavior. Expected values never come from Rust. This is parity
evidence, not gameplay training data or a claim of native arena completion.

The capture uses the existing full `rh-map/2` seed1 export, copied without modification to
`tools/arena-fixtures/seed1-input.json`. It never generates a new map. A case explicitly
uses a reduced pool with all region/spawn views rebuilt from declared pool indices; a
separate no-pool room exercises the legacy fallback. These are declared map inputs.
The existing `parity/fixtures/planning.json` and `coliseum_sudden_death.json` are untouched
and their byte hashes are retained in provenance.

```sh
tools/arena-fixtures/capture.sh --check
```

Capture into a fresh temporary directory with `tools/arena-fixtures/capture.sh`.
`RH_ARENA_DIRECTORY` selects another output directory. Capture and check each execute
once; neither implicitly performs a second capture. The official Linux amd64
Node22.23.4 Docker image is pinned by digest. Source is mounted read-only; `npm ci` uses
the existing lockfile and temporary dependencies. Runtime/compiler/input/source hashes
are embedded in the corpus. `Math.random` throws; item IDs are sequential.

## Constructor and RNG boundary

Both profiles use actual `createWorld`, actual exported installers, normal `addPlayer`
and ordinary `step`. `constructed` precedes joins; `joined` precedes the first tick.
Each frame has stream offsets, and each case has a complete ordered `randomTape` of
`{stream,value,tick,time,phase}`. Native consumers must start streams from these declared
inputs and execute the real prefix; expected poststate is never construction input.

| Profile | Source scope | Observed constructor prefix |
| --- | --- | --- |
| `core` | weapons, targeting, projectiles, terrain, abilities and vision; no loot, camps, mobs or faction-signature installer | main1/reward0/quest0: the real `createWorld` order-salt draw |
| `roster` | actual ordered loot/camps/chests/mobLife/mobAI and shared hook installers, without faction signatures | main118/reward45/quest0 on the declared seed1 input |

In the primary core three-player deal, planning consumes365 reward draws; raid start
then consumes28 main draws for the map's unconditional spawn shuffle, including when
planning supplies every placement. The roster profile's deal begins after its45 actual
roster draws, ends at reward410, then advances main118→146 at raid start and146→148 at
teleport. The full tape preserves cross-stream order, not merely totals.

There is no `mobOn + lootOff` source profile here. A native synthetic loot prefix in
that configuration is not justified by this witness. Full source roster births occur
only through the actual raid-start hook, after planning. Captured actual actor identities,
private homes, paths, histories, inputs, weapon states and constructor containers permit
independent native provenance checks.

## Format and private outputs

Each case separates `input` from constructed/joined snapshots and `frames`. A repeated
step action expands to one frame per actual50ms tick; `action` and `iteration` identify
its origin. Literal and anchor-resolved input payloads and actual acceptance outcomes are
recorded in `frames[].inputs`. Every event array is drained once and never reinserted.
Between-tick remove/drop/reconnect/abandon operations produce their own frames, including
immediate MIA results and owner-addressed reconnect `planFor` output.

`public` is a selected actual RaidState snapshot. `private` contains arena and planning
runtime, including complete deals/holders/report/last-sent strings, player and mob queues,
paths/history/slides/statuses/casts, projectiles/fields/ledger and private counters. `plans`
contains emitted owner-addressed messages; `ownerPlans` stores each owner's current
`planFor`. They are private fixture evidence, not a shared observation. No secret tape,
deal, counter, runtime digest or other owner's options may be projected to clients.

Nonfinite values preserve exact tags such as `{"$float":"Infinity"}`. The no-repeat
source deadline is Infinity; native state must use its typed absent-deadline form.
No source null substitution hides that boundary.

Hook observation wraps actual installed chains and records each installed link completing
in source order. The gate-history scenario is also reconstructed from the same declared
inputs with hook observation disabled; full captured behavior agrees. Its independently
reconstructed geometry is labeled `reconstructed-from-inputs:*`. TypeScript has no native
checkpoint restore API; those labels do not claim source checkpoint restoration. Native
restore/continuation/cache checks remain separate.

## Important source behavior

- Planning does not move or fight, and drains other commands. Ready latches. Empty normal
  boon lists are preserved; repository source has no normal boon-populating producer.
  The nonempty-boon case is explicitly trusted helper setup and never asserts native boon
  content/admission. Held dropped seats are exercised through actual simulation intake;
  this does not claim a disconnected live socket can deliver an input.
- Planning leave resolves MIA immediately, without a body or credit; starters remain
  counted. Abandon makes void sticky past timeout. Reconnect obtains only its owner's
  current plan. After entering Active, legacy retains planning deals/holders/sent; later
  removal does not delete those retained entries. Restore membership rules must therefore
  depend on phase, not require all retained active deals to name current players.
- A scheduled death outside the locked coliseum leaves the due slot unchanged and blocks
  teleport only in that tick. Locked-coliseum deaths choose a new slot, reopen gates and
  clear sudden death. Without a schedule a death uses scaled patience. First patience0
  disables scheduling but leaves fallback patience active. The corpus includes real
  melee deaths and between-tick MIA, exact due ticks, repeats and typed no-repeat Infinity.
- Teleport uses the same advanced main stream as the unconditional raid-start shuffle.
  It resets authoritative positions/history/path/inputs, applies1500ms immunity and runs
  actual weapon, projectile, terrain, ability, vision and applicable NPC/card hook links.
  Normal queued casts witness Freeze cancellation/refund and Last Stand status cleanup.
  A real released arrow outlives its departed owner before a later teleport clears it.
- Sudden death ledger entries begin only when the tick starts at/after the deadline.
  Immunity can still absorb them. The increasing whole-second true-damage burn, first
  damage at immunity expiry, terminal outcomes and post-end continuation are preserved.
  Source `endRun` can leave `inColiseum=true` while gates are unlocked; the fixture retains it.

## Gate and historical sight boundary

Explicit geometry actions record active gate tiles, the original terrain, circle/segment,
LOS, path, raycast, fresh vision and map identity. Actual queued bow shots cross open
gates and stop at locked gates. Geometry is queried with the actual active collision view;
the original static terrain reference and hash remain unchanged.

The bounded history trace reveals beside a gate while open, performs an actual scheduled
teleport/lock, queries old points and current geometry, then removes another player and
lets ordinary settle unlock. The observer remains stationary through unlock. Owner vision
queries use actual source refresh/query semantics; full sparse expiry tables are captured.
Read-only references to those actual memories show the same memory refreshing **open at
250ms and locked at250ms**, so a map-identity change must bypass the ordinary100ms throttle.
Historical deadlines remain those produced under the collision variant at reveal time;
replaying old samples through the current gate map would change exploration.

`currentLOS` / `currentIsInVision` and `trailCanSee` are distinct. Legacy's raw
`canPlayerSeeActor` helper also accepts a remembered trail point across the newly closed
gate. That raw source fact is labeled separately; it does not authorize leaking a currently
hidden actor in the native public observation. Existing native privacy corrections and
current-actor filtering must be evaluated explicitly rather than silently conflating map
memory with current sight.

## Bounded helper coverage

Two hundred actual deals use this one unchanged map and players2..8. Actual source
checks verify tier/different-zone pairs and no duplicate option while the pool permits;
all private draw tapes are retained. This is not a map-generator campaign or timing claim.
Pure source helper vectors cover spawn walks, tier boundaries, first/second/repeat slots,
scaled patience, whole-second sudden death and coliseum spot selection.

A separately labeled `visionHelpers` sequence invokes actual shared `VisionMemory.update`
with only declared static gate anchors, times and variants: open250 → locked250 → stationary
locked300 → moved locked350 → unlock350 → stationary reuse450. Complete sparse deadlines
and current/trail query results permit standalone history parity without using expected
world positions as inputs. It complements the ordinary lifecycle trace.

A separately labeled `assignmentHelpers` case captures actual `assignSpawns` on literal
trusted deals/holders after a recorded natural source deal. Both of one player's options
are held, so the source chooses a free pool spawn nearest by actual walking distance.
These literal helper inputs are not source expected random deals or native poststate,
and the case does not justify weakening normal lifecycle/checkpoint admission.

Native runtime, protocol/private-plan transport, full producer domains, strict restore/hash
coverage, public privacy and headless/policy acceptance remain implementation gates.

## Complete scenario inventory

| Case | Frames | Profile / boundary |
| --- | ---: | --- |
| `planning-timeout` | 6 | core |
| `planning-picks-ready-latch` | 6 | core |
| `planning-invalid-and-nonplan-drain` | 7 | core |
| `planning-drop-excludes-unready` | 5 | core |
| `planning-all-dropped-timeout` | 9 | core |
| `planning-solo-timeout` | 6 | core |
| `planning-leave-mia-last-standing` | 6 | core |
| `planning-shutdown-void-sticky` | 11 | core |
| `planning-reconnect-owner-plan` | 10 | core |
| `planning-disabled-0` | 3 | core |
| `planning-disabled-unset` | 3 | core |
| `planning-short-pool-contention-switch-free` | 14 | core |
| `planning-no-pool-fallback-shuffle` | 5 | core |
| `planning-explicit-boon-helper` | 9 | core / trusted helper only; no normal boon producer exists in source |
| `planning-private-deal-1` | 1 | core |
| `planning-private-deal-9` | 1 | core |
| `coliseum-first-slot-immunity-sudden-death` | 46 | core |
| `coliseum-sudden-death-terminal` | 230 | core |
| `scheduled-outside-mia-preserves-due-slot` | 8 | core |
| `scheduled-outside-real-death-on-due-tick` | 9 | core |
| `scheduled-inside-mia-reschedules-slot` | 12 | core |
| `patience-first-flat-then-scaled` | 12 | core |
| `first-zero-disables-schedule-not-patience` | 8 | core |
| `no-repeat-typed-infinite-deadline` | 13 | core |
| `gate-open-projectile` | 30 | core |
| `gate-locked-projectile` | 32 | core |
| `gate-history-open-lock-unlock` | 18 | core |
| `teleport-live-windup-status-refund` | 9 | core / source Wishes preserved; native producer admission is separate |
| `roster-prefix-planning-birth-and-teleport` | 6 | roster |
| `teleport-clears-flight-owner-left` | 14 | core |
| `planning-eight-player-normal-deal` | 4 | core |
| `scheduled-inside-real-death-after-immunity` | 44 | core |
| `planning-all-dropped-ready-held-seat-inputs` | 11 | core / actual simulation intake on held dropped seats; no live socket delivery claim |
| `planning-action-budget-and-outside-phase-drain` | 8 | core |
| `planning-active-leave-retains-private-deals` | 5 | core |
