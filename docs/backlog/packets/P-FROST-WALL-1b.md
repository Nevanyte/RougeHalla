# P-FROST-WALL-1b: Frost Wall, second sim part: fighters it lands on, walks under way, mobs and blinks

- **Serves:** owner beta-follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"), cut from
  P-FROST-WALL-1 (2026-11-12). Legacy: `git show 78dd8bd4` (`packages/server/src/sim/abilities.ts` `raiseWall`,
  `handleCast`, `landCasts`; `packages/server/test/frostWall.test.ts`).
- **Implementer tier:** implementer-opus · **Reviewer:** reviewer-opus · **Integration base:** feature/unity-rework
- **Depends on:** P-FROST-WALL-1 merged (`crate::barriers`, `SimConfig::frost_wish`, `FieldKind::Wall`).
- **D-rules touched:** D1 loose proof; default config byte-identical (no fixture moves).

## Outcome
Under `frost_wish = Wall`, when the wall rises (target pass of the landing step, `systems/abilities/effects.rs`
`Effect::Wall`, before the barrier row is pushed):
1. Every standing fighter (quest mobs excepted) whose disc (`PLAYER_RADIUS + 1`) touches a wall tile is set down clear
   on its own side of the line (the caster on the caster's side; one exactly on the line on the far side), searched
   outward from its projection onto the line along the wall's normal, step 4 up to 96, then the other side
   (`WALL_PUSH_STEP`, `WALL_PUSH_MAX`), through `displace`. One with no clear spot on either side keeps the tiles within
   `PLAYER_RADIUS + 32` of it free (a gap); a wall with no tile left is not raised.
2. After the wall stands, every standing fighter whose path now runs into it (`segment_clear(after, from, p,
   PLAYER_RADIUS)` along the waypoints) plans again to its last waypoint.
3. Mob AI paths and mob spacing (`systems/mob_ai.rs:315,329,464,493`, `systems/mob_spacing.rs`) and blink landings
   (`systems/abilities/mod.rs` `blink`, legacy `blinkLanding(collisionMap(world), ...)`) read `barriers::body_map`.

## Write scope
`crates/rh-sim/src/systems/abilities/effects.rs`, `crates/rh-sim/src/barriers.rs`, `systems/mob_ai.rs`,
`systems/mob_spacing.rs`, `systems/abilities/mod.rs`, a new `crates/rh-sim/src/barriers_push_tests.rs`. Not
`observe.rs`, rh-protocol, rh-policy, rh-server, client-unity.

## Acceptance (oracle, switch on, legacy frostWall.test.ts numbers)
- A fighter 4 u west of the wall's line (cast from the west at (12, 10)) ends west of `tc(12)`, its disc clear on the
  body map; the caster's disc is clear.
- A fighter walking east from (8, 10) to (20, 10) when the wall rises across its walk (cast from (3, 16) at (13, 10))
  never overlaps the ice over 120 ticks and ends within a tile of its goal.
- A fighter with no room on either side (a one-tile corridor) leaves a gap; the wall's other tiles still stand.
- A mob's chase path and a Blaze blink do not land on or cross a standing wall.
- Default-config parity, hash tape and determinism sweep unchanged; `scripts/gate.sh --oracle packet/P-FROST-WALL-1b`.

## Known traps
- Push-out iterates fighters in the store's stable order; `displace::apply` defers inside ledger collection.
- The gap rule changes the wall's cells before the field is added: keep cells ascending.
- `HumanBot` and the Brain still aim Frost's Wish at a unit's position (a wall on the enemy). With part 1b it sets
  them down; say what a Frost bot does in the hand-off (legacy `abilityPolicy.ts` `WALL_PEEL_*` is a later packet).
