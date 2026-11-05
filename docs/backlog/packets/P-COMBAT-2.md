# P-COMBAT-2: projectiles (bow and wand)

## ID and outcome
P-COMBAT-2. Bow arrows and wand balls exist in `rh-sim` with legacy-identical flight, hits and interactions: windup + release,
launch from the actual release request origin or authoritative release position, the 10 ms substep sweep, wand splash,
ball-vs-arrow deletion, sword swing vs ball, shield arrow reflection, `projEnd` reasons; plus the wire/observation
representation of a launch (announced once, never updated) and replay of it on the client side contract.

## Dependencies
Stage 2 implementation order: first the authoritative Rust flight/interactions, trusted events and parity/headless/replay
evidence; then legitimate observer projection and coordinated transport. Keep this packet open until both stages pass.
Unity receives presentation data only and never simulates collision, hits, reflections or damage. Existing generalized
capture/launch tracking is already implemented by P-CAPTURE-1; extend it rather than rebuilding that prerequisite.

P-COMBAT-1 should merge first (sword swing vs ball and shield reflection need the sword/shield melee and `Placement.weapon0`).
The directional-only parts (bow, wand without a lock) can start in parallel. Homing wand balls need P-COMBAT-3's lock; this
packet ports the `targetId` flight but cannot create a locked shot until P-COMBAT-3.

## Relevant legacy paths (verified)
- `packages/server/src/sim/projectiles.ts`: `spawnProjectiles` (l.97), `sweepProjectiles` (l.207), `closestApproach`, `interceptBall` (l.388), `ballsThisTick`, `endProjectile`, `clearProjectiles`; the header comment (l.1-16) is the order of a substep.
- `packages/server/src/sim/weapons.ts` (ranged branch ~l.300-352: `combat.spawns.push`, `drawStartedAt`, `rangeMult`, windup/release, `RANGED_RELEASE_PAUSE_MS` at l.228), `melee.ts` (`meetBalls`, `crossesArc`).
- `packages/shared/src/weapons.ts` (bow: speed 900, range 520, boost 0.95, floor 0.25, dpsMult 0.8; wand: speed 380, range 640, boost 0.65, floor 0.3, dpsMult 0.8; `ARROW_RADIUS` 7), `interactions.ts` (`reflectVelocity`, `ballDeletesArrow`, `swingVsBall`, `projectileOnShieldFront`), `policies.ts` (`leadAim` l.160), `constants.ts` (`PROJECTILE_SUBSTEP_MS` 10, `BALL_ARROW_RADIUS` 28, `BALL_AFTER_ARROW` 0.6, `ARROW_REFLECT_SHARE` 0.15, `MAX_ARROW_REFLECTIONS` 2, `SWORD_BALL_SCALE` 0.5, `WAND_SPLASH_SHARE` 0.3, `WAND_SPLASH_RADIUS` 48, `RANGED_SLACK` 2, `RANGED_HIT_REACH` 14).
- Tests: `packages/server/test/projectiles.test.ts`, `weapons.test.ts`; fixture `parity/fixtures/bow_wand_capture.json` (capture-only).

## New paths
`crates/rh-sim/src/systems/projectiles.rs` (its rows flip in `schedule.rs`; the live projectile list is world state, the per-substep lists are `TickScratch`); additions to `content.rs` (specials, constants, `content_hash`); capture scenarios; optionally
`crates/rh-protocol` launch/end tuples (coordinate: shared files).

## Exclusive write scope
`crates/rh-sim/src/{systems/projectiles.rs,systems/weapons.rs,systems/melee.rs,systems/mod.rs,schedule.rs,state.rs,scratch.rs,checkpoint.rs,content.rs,constants.rs,lib.rs,observe.rs}`, `crates/rh-sim/tests/`, `crates/rh-parity/**`,
`parity/legacy-capture/capture.ts` (new scenarios and the projectile recorder), `parity/fixtures/`. Protocol and C# files only if the coordinator
assigns them (README "Shared-file rule"). Core layout rules (post-sweep, [ADR 0009](../../adr/0009-core-layout.md); the README "Shared-file rule" has the long form): the mechanic is `systems/<mechanic>.rs` with `fn(&mut Cx)` entry points, plus its rows flipped from `Pending` to `Ported` in `schedule.rs` at their legacy position (the row names, never a reorder); entity data goes in `fighter.rs` / `state.rs` / `store.rs` (hashed and checkpointed: extend `check_world` in `checkpoint.rs` if the new data has an invariant the tick relies on) and per-tick lists in `TickScratch` (`scratch.rs`, never serialized); `tests/no_alloc.rs` must stay at zero allocations per step, new content goes through the `content.rs` registry (`content_hash`), and every new serialized field must be covered by `tests/hash_coverage.rs`. `sim.rs` is a facade and is not in any write scope.

## Contracts and references
C-TICK (projectile sweep sits after history, before melee, with "spawns"), C-DET, C-OBS (a launch is perceivable by viewers who can see the
shooter or the path: decide and leak-test), C-NET (fx are droppable; `projEnd` must reach clients that saw the launch), C-PARITY. ADR 0002, 0007.

## Behaviour to preserve
- Legacy projectiles are runtime objects outside synced state. A client receives launch presentation data and a server end cue. In this port only Rust advances authoritative flight, tests collision, reflects and deals damage; Unity may animate the permitted launch cue and stop at server cues. Public identity/target disclosure requires a separate observation review.
- Per substep (10 ms), in this order: move (stop at a wall of `collisionMap`, closed gates included, or at range) -> a ball deletes every enemy arrow within `BALL_ARROW_RADIUS` (tested at the closest approach of the two stretches, in line of sight, never around a corner) keeping `BALL_AFTER_ARROW` 0.6 of its damage per arrow deleted -> first body whose centre, **where it was at that substep time** (history), comes within the reach (`PLAYER_RADIUS + ARROW_RADIUS` for an arrow, `RANGED_HIT_REACH` for a ball). A projectile starting inside reach hits only if heading into the body. Owner never hit.
- Shield: an arrow on a raised shield's front is stopped and a **new** arrow owned by the holder flies on from the contact point with the mirrored velocity (`reflectVelocity`), full bow range (an already-reflected arrow keeps only the range it has left), `ARROW_REFLECT_SHARE` 0.15 of the damage, the holder takes the rest as a normal hit; after `MAX_ARROW_REFLECTIONS` 2 it is just blocked. A reflection made in a substep starts moving in the next. Reflected-arrow damage is `passive`/returned.
- Wand splash: an impact also hits every other enemy within 48 u for 30% (`derived` ledger entries, a wall stops it, the primary is never hit twice, a mob's ball never splashes a mob). `weaponSpecials: false` disables it.
- Swing vs ball: a sword swing meeting an enemy ball in its arc (this tick's stretch, ball radius counted) halves it once (`SWORD_BALL_SCALE`, `halved`); an axe destroys it and shield bash does nothing (`interactions.ts:swingVsBall`). Interception also scales or cancels that ball's ledger entry made this tick.
- Launch uses `req.origin` when supplied, otherwise the owner's authoritative release position (`projectiles.ts:spawnProjectiles`). Directional ranged requests currently omit origin. Locked attacks use `leadAim` (P-COMBAT-3). Projectiles first move next tick's sweep; hits settle in their connection tick's ledger after melee.
- Timings: bow windup `min(0.5, 0.55 * interval)` with `drawStartedAt` synced, wand `min(0.45, 0.5 * interval)`; ranged users are rooted only for the final `RANGED_RELEASE_PAUSE_MS` 200 ms of the windup (`windingUp`), a stagger never cancels a bow draw. Homing wand ball (locked): flies toward the target's position at each substep time at its launch speed, dies after 5000 ms or when the target is not standing.
- A projectile outlives its owner; a kill by a departed shooter is credited by name only (no GV/bounty).
- Rust already has Draw/Cast actions and release pause in `systems/weapons.rs`; carried bow/wand are accepted. `land` currently clears the draw pause without creating a projectile. Replace that stub with the real spawn path; verify current callers and fixtures.

## Acceptance checks
1. Preserve the generalized P-CAPTURE-1 event and launch tracking, including same-tick projectile destruction. Extend scenarios/requirements as needed; never discard launch/end fields or ignore unknown events to make parity pass.
2. New slice scenarios with **directional inputs only**: `bow_duel` (two bows, stand and trade), `wand_duel`, `ball_vs_arrow`, `sword_swing_ball`, `shield_arrow_reflect`, `wand_splash_group` (3+ players), `projectile_outlives_owner` (owner leaves, MIA). Re-capture `bow_wand_capture` as is; it contains a wand `target` input, so it flips to `slice` in P-COMBAT-3, not here.
3. `cargo test -p rh-parity` passes; hits compared by tick, victim, attacker, weapon (exact) and amount (2e-6); launches and ends by tick/id/kind exact and positions within 2e-6.
4. Unit tests: substep order (ball deletes arrow before body test), closest-approach head-on case, reflection chain limits, range left after reflection, starting-inside rule, 5 s homing cap (stub target).
5. Observation leak test: a launch from a shooter the viewer cannot see is not in that viewer's observation.
6. Replay + checkpoint continue identically with arrows in flight.

## Validation commands
`npx tsx parity/legacy-capture/capture.ts --only <scenario>`, `cargo test -p rh-sim`, `cargo test -p rh-parity`, `cargo test --workspace`,
`cargo run -p rh-parity --bin parity-report`, `cargo clippy --workspace --all-targets`; if the wire changes: `dotnet test client-unity/RoguehallaNet.Tests`
(with `export PATH=/root/.dotnet:$PATH`), `client-unity/sync-net.sh`, `node tools/browser-proof/proof.mjs`.

## Risk and suggested model tier
High risk: strongest model, high effort. Geometry-heavy float code whose results depend on evaluation order (closest approach,
history-based body positions, substep timing). Use `libm` only through `rh_sim::math`; compare intermediate values against
the TypeScript on a debug build when a fixture diverges.

## Known traps
- Tick-order position: sweep is after history and before melee; spawns happen after the sweep (`spawnProjectiles`). Never reorder.
- A swing landing this tick meets balls anywhere on **this tick's** stretch (`tickX/tickY`), not only their end point.
- Substep count is `round(dt / 10)` = 5; times are `now - dt + dt*k/steps` (floating-point identical expression needed).
- Projectile ids are counters (`nextId`), compared by the harness: keep the same allocation order.
- Legacy events between ticks (a leave removing the shooter) travel with the next step.
- Unity code was written without a compiler: any C# decode of launches is unverified until P-UNITY-1.
