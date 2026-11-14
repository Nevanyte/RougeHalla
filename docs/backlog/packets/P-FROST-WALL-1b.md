# P-FROST-WALL-1b: Frost Wall, second sim part: fighters it lands on, walks under way, mobs and blinks

- **Serves:** owner beta-follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"), cut from
  P-FROST-WALL-1 (2026-11-12). Legacy: `git show 78dd8bd4` (`packages/server/src/sim/abilities.ts` `raiseWall`,
  `handleCast`, `landCasts`; `packages/server/test/frostWall.test.ts`).
- **Implementer tier:** implementer-opus · **Reviewer:** reviewer-opus · **Integration base:** feature/unity-rework
  (staged head `coord/int-34` @ `e74f7658b`)
- **Depends on:** P-FROST-WALL-1 merged (`crate::barriers`, `SimConfig::frost_wish`, `FieldKind::Wall`); merged with
  its `-fix` (`2acf7e423`: the overlay holds the walls over both gate states, `frost_wall_no_alloc`). P-SIM-REPLAY-LONG-1
  merged (a step reads only its own events: `TickScratch::step_event_start`).
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) against unreleased legacy 78dd8bd4 · D2 n/a · default
  config byte-identical (no fixture, tape or identity moves) · D5/D6/D9 none.

## Routing
- **Serves:** owner beta-follow-up decision 2 (not an ORDER_OF_OPERATIONS item; recorded in MIGRATION 2026-11-10).
- **Tier:** implementer-opus (rh-sim state and tick: positions, paths, displacement inside the landing step).
- **Reviewer:** reviewer-opus.
- **D-rules:** D1 loose proof; existing parity fixtures and the ability hash tape unchanged (switch off).
- **Write scope:** section 5.

## Outcome
Under `frost_wish = Wall`, when the wall rises (target pass of the landing step, `systems/abilities/effects.rs`
`raise_wall`, before the barrier row is pushed):
1. Every standing fighter (quest mobs excepted) whose disc (`PLAYER_RADIUS + 1`) touches a wall tile is set down clear
   on its own side of the line (the caster on the caster's side; one exactly on the line on the far side), searched
   outward from its projection onto the line along the wall's normal, step 4 up to 96, then the other side
   (`WALL_PUSH_STEP`, `WALL_PUSH_MAX`), through `displace`. One with no clear spot on either side keeps the tiles within
   `PLAYER_RADIUS + 32` of it free (a gap); a wall with no tile left is not raised.
2. After the wall stands, every standing fighter whose path now runs into it (`segment_clear(after, from, p,
   PLAYER_RADIUS)` along the waypoints) plans again to its last waypoint.
3. The mob AI's line of sight and walkable checks (`systems/mob_ai.rs:298-300` `los`, `:312-318` the retreat
   predicate; the Rust-only spacing predicates `:448-452` and `:477-481`) and blink landings (`systems/abilities/mod.rs:55-64`
   `blink`, used at cast and at landing) read `barriers::body_map`.

## Established facts (oracle author, 2026-11-13, verified on `coord/int-34`)

### Legacy behaviour (`git show 78dd8bd4:<path>`; not in this branch's `packages/`)
- `packages/server/src/sim/abilities.ts:532-533` `WALL_PUSH_STEP = 4`, `WALL_PUSH_MAX = 96`.
- `:543-616` `raiseWall`: the segment from `l.origin` with `range + CAST_RANGE_SLACK` (part 1 has this); `before =
  collisionMap(world)`; cells as a set; the unit normal from the caster's origin to the wall's centre, the caster's
  facing when nearer than 1 u. `overlaps(p)`: any wall cell among the tiles under the box of radius `PLAYER_RADIUS + 1`
  round `p`. For each of `standingCombatants(world)` (players then mobs, `combatant.ts:191`) except quest mobs (`:567`)
  that overlaps: `along` = signed distance from the wall's centre along the normal; first side = -1 for the caster, else
  +1 when `along >= 0`, else -1; from the projection `(x - along*nx, y - along*ny)` try `d = 4, 8, ..., 96` on the first
  side then the other, taking the first `p` with `!overlaps(p) && circleClear(before, p, PLAYER_RADIUS)`. Found: queued
  as a move. Not found: every cell whose tile centre is within `PLAYER_RADIUS + 32` of the fighter on both axes (a square,
  Chebyshev) is deleted (`:585-590`). Cells sorted ascending; none left: return without a field (`:594`). Then the field
  is added, then `displace` for every move in fighter order (`:600`), then with `after = collisionMap(world)` every
  standing fighter not moved and with a non-empty path is walked waypoint by waypoint with `segmentClear(after, from, p,
  PLAYER_RADIUS)`; blocked: `planPath(world, f.s, last waypoint)` (`:602-613`; an unreachable goal gives an empty path:
  the fighter stops).
- `packages/server/src/sim/displace.ts` (in-repo): moves any combatant (players and mobs), resets history, clears the
  slip, re-plans a walk in hand, bumps `displaceSeq`; deferred with `payLater` while the ledger collects.
- Blink: `abilities.ts:154` (handleCast) and `:423` (landCasts) call `blinkLanding(collisionMap(world), ...)`; in-repo
  `packages/shared/src/blink.ts:135-165`: a blink passes THROUGH walls; the landing is the farthest point on the ray, in
  steps of 4, whose disc is clear on the map, in the origin's floor component and not across the coliseum ring.
- Mobs: in-repo `packages/server/src/sim/mobAI.ts:271` `const map = collisionMap(world)` feeds the melee line of sight
  (`:279`, `reachMask(weapon)`) and the retreat predicate (`:289-291`); with the patch `collisionMap` carries the wall
  (`world.ts:1079-1093` in 78dd8bd4), so a melee mob across a wall has no line of sight, chases, and its walk is planned
  round the wall. Mob move orders already plan on the body map in Rust (part 1, `systems/inputs.rs:107-108`).
- Legacy acceptance: `packages/server/test/frostWall.test.ts:111-125` (the fighter 4 u west of the line) and `:127-146`
  (the walk under way, 120 ticks).

### What part 1 left out (and this packet adds)
- `raise_wall` (`crates/rh-sim/src/systems/abilities/effects.rs:270-318`) computes the cells and pushes the field and row:
  no push-out, no gap rule, no re-plan of walks under way.
- `blink` (`systems/abilities/mod.rs:55-64`) passes `cx.k.collision_map(..)`: a blink can land on a standing wall.
- `mob_ai.rs:299`, `:313`, `:448`, `:477` read `cx.k.collision_map(..)`: a melee mob 80 u from its target across a wall
  holds its swing into the ice for the wall's whole life.
- Rust `displace::execute` (`systems/displace.rs:30-63`) moves only players (`w.idx` is the player store): a mob the wall
  lands on cannot be set down through it as it stands.
- Events: no 1b rule reads events inside a step. If one is added, it reads `cx.ev` from `cx.s.step_event_start` only
  (P-SIM-REPLAY-LONG-1, `systems/mob_ai.rs` Block wake).

### Identities that move: none
- Checkpoint (`rh-checkpoint/32`): no new serialized field (positions, paths, `displace_seq`, the barrier row and its
  cells exist already; the gap only changes which cells are stored). Replay (`rh-replay/25`): none (no live profile
  selects `Wall`, so no stored replay has a wall). Observation (29) and policy contract (23): none (walls stay filtered
  until P-FROST-WALL-2; a pushed fighter's `displace_seq` is already observed). Content hash: none under the default; keep
  `WALL_PUSH_STEP`/`WALL_PUSH_MAX` module-local (as legacy does) or list them in `tests/content.rs` NON_GAMEPLAY beside the
  other wall numbers. Protocol 17: none.

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/abilities/effects.rs` (push-out, gap, re-plan in `raise_wall`)
- `crates/rh-sim/src/systems/abilities/mod.rs` (`blink` reads the body map)
- `crates/rh-sim/src/systems/mob_ai.rs` (the four map reads above)
- `crates/rh-sim/src/systems/displace.rs` (set down a mob as well as a player; added by the oracle author: needed for
  mobs, see above)
- `crates/rh-sim/src/barriers.rs` (helpers only; leave the `#[cfg(test)]` module lines as they are)
- `docs/DEVIATIONS.md` row DEV-029: propose the edit in the hand-off (the "Part 1 does not yet ..." sentence); signing
  is the owner's.
- Not: `systems/mob_spacing.rs` (it reads no map: its predicates are passed in from `mob_ai.rs`), `observe.rs`,
  `status_runtime/observe.rs`, rh-protocol, rh-policy, rh-server, client-unity, any oracle file.

## Acceptance (oracle, switch on)
- The oracle files below pass; `scripts/gate.sh --oracle packet/P-FROST-WALL-1b` (full) passes.
- Switch off unchanged: `cargo run -p rh-parity --bin parity-report` all MATCH; the ability hash tape
  (`cargo test --locked -p rh-sim --features trusted-status-probes --lib ability_hash_tape_matches_the_base`, against
  `parity/abilities/hash-tape.json`) and `tests/step_event_window.rs` (`pinned_fold`) green without re-recording; no
  `parity/**` or `protocol/fixtures/**` file changes.
- The existing part 1 oracle (`src/barriers_tests.rs`, `src/barriers_gate_tests.rs`, `tests/frost_wall_no_alloc.rs`,
  `tests/hash_coverage.rs`) stays green.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/barriers_push_tests.rs` (8 tests: push-out, gap, empty wall, walk under way, two mob, blink,
  checkpoint)
- `crates/rh-sim/tests/frost_wall_replay.rs` (a recorded match with a wall replays to every hash; witness: the push-out)
- `crates/rh-sim/tests/frost_wall_push_no_alloc.rs` (raise with a push-out and a re-plan at most 48 blocks; standing
  steps 0; witness: the push-out)

## Baseline (on `packet/P-FROST-WALL-1b`, before any implementation)
`cargo test --locked -p rh-sim --features trusted-status-probes --lib barriers::push_tests`: 8 of 8 red on assertions:
- `a_fighter_the_wall_lands_on_is_set_down_clear_on_its_own_side`: "the fighter it landed on is clear of the ice" (it
  stays at x 396, under the wall).
- `a_fighter_with_no_room_on_either_side_keeps_a_gap_...`: cells `[292,332,372,412,452,492,532]` vs the gap
  `[292,332,492,532]`.
- `a_wall_left_with_no_tile_is_not_raised`: one wall field, expected none.
- `a_walk_under_way_when_the_wall_rises_is_planned_again_round_it`: at the landing step the walk in hand
  (331.5,336) -> (656,336) runs into the wall.
- `a_melee_mob_across_a_standing_wall_walks_round_it_...`: the mob stays at (360,336) while the wall stands.
  (Verified satisfiable: with `mob_ai.rs:299` alone reading the body map, it passes.)
- `a_mob_the_wall_lands_on_is_set_down_clear_too`: the mob stays at x 404 under the wall.
- `a_blaze_blink_aimed_at_a_standing_wall_lands_short_of_it`: the blink lands at (400,336), on the wall.
- `a_checkpoint_taken_after_the_wall_set_someone_down_...`: its witness "the fighter under it was set down".
`--test frost_wall_replay`: red on its witness (the fighter on the line is not moved). `--test frost_wall_push_no_alloc`:
red on its witness (432,336 unmoved); its allocation numbers are already within bounds (raise 14 blocks, 78 standing
steps 0 blocks).

## 9. Validation commands
- `cargo test --locked -p rh-sim --features trusted-status-probes --lib barriers`
- `cargo test --locked -p rh-sim --features trusted-status-probes --test frost_wall_replay --test frost_wall_push_no_alloc --test frost_wall_no_alloc --test step_event_window --test hash_coverage`
- `cargo run -p rh-parity --bin parity-report`; `scripts/gate.sh --quick`; `scripts/gate.sh --oracle packet/P-FROST-WALL-1b`

## Legacy doubts (pinned as legacy; flag, do not fix)
- 78dd8bd4 `abilities.ts:577-578`: the search checks only the destination disc (`circleClear(before, p)`), not the way
  there or the floor component: a fighter beside a one- or two-tile solid wall can be set down on its far side (up to
  96 u). Match it; not pinned by a test.
- `:567`, `:570-573`: every combatant is tested with the player disc (`PLAYER_RADIUS + 1`), mobs included. Under
  `HitboxMode::Archetypes` a mob's foot box differs; use the legacy disc (the oracle's mobs run the legacy circle).
- `:585-590`: the gap is a square of half-side `PLAYER_RADIUS + 32` on tile centres, not a disc.
- `:602-613`: a fighter whose re-planned walk has no route gets an empty path (it stops); one set down keeps the
  `displace` re-plan only.
- Legacy reads `collisionMap(world)` in more places than parts 1 and 1b port: `consumables.ts:107,159,172`,
  `loot.ts:146`, `plagueZombies.ts:25,138`, `plagueCorpses.ts:51,86`, `traders.ts:65,103`, `quests.ts:201,422`,
  `training.ts:198,222,307`, `walkHint.ts:167,192`, `bruiserPassives.ts:48`, `projectiles.ts:211`. With the wall's tiles
  LOW, those with `MASK_MOVE` (wind landings, loot and corpse reach, trader and quest reach, zombie reach) see the wall in
  legacy. Out of this packet: a follow-up packet or a DEV-029 note (the owner decides).

## Not established by this oracle
- Quest mobs being left alone (no quest mob in a test); the caster's own push (at the 64 u minimum range the caster's disc
  never reaches a wall tile, so only "the caster's disc is clear" is asserted); the Rust-only spacing predicates
  (`mob_ai.rs:448`, `:477`, under Archetypes) and the retreat predicate (`:313`) individually; a push across a solid
  wall; the push-out inside ledger collection (`displace::apply` defers).

## 10. Risk and suggested model tier
Opus: positions and paths change inside the landing step in fighter order; a mob set down needs `displace` to reach mobs;
the default config must stay byte-identical.

## 11. Known traps
- Push-out iterates fighters in the store's stable order (players, then mobs, as `standingCombatants`); the gap rule
  changes the cells before the field is added: keep them ascending. Collect the moves first, add the field and the
  row, sync the overlay, then displace, then re-plan on the new overlay (legacy order).
- `displace::apply` defers while `w.pay.collecting`; the landing pass is not inside collection, but check.
- No allocation in standing steps (`frost_wall_no_alloc`, `frost_wall_push_no_alloc`): the push-out may use scratch
  buffers; a re-plan writes into the fighter's existing path.
- `HumanBot` and the Brain still aim Frost's Wish at a unit's position (a wall on the enemy). With part 1b it sets them
  down; say what a Frost bot does in the hand-off (legacy `abilityPolicy.ts` `WALL_PEEL_*` is a later packet).

## Notes from previous attempts
2026-11-13 (oracle author): brief checked against `coord/int-34`. Corrections: the mob map reads are at `mob_ai.rs:299,
313,448,477` (the brief said 315, 329, 464, 493); `mob_spacing.rs` reads no map and leaves the write scope;
`systems/displace.rs` joins it (Rust displacement moves players only); a blink passes through walls in legacy, so the
acceptance is "does not land on a standing wall", not "does not cross it"; a mob's chase path already plans on the body
map (part 1), the gap was its line of sight. P-FROST-WALL-1-fix has no packet file (commits `8726ac2f`..`265a0011`,
merged in `2acf7e423`).
