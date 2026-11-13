# P-FROST-WALL-1: Frost Wall in the sim: a placed barrier that stops bodies and swings, as a switch the live profile turns on

- **Serves:** owner beta-follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"; legacy commits
  `78dd8bd4`, `cde6f785` on `origin/claude/adoring-edison-mxt8ab`). First of three: sim (this), wire and prediction
  (`P-FROST-WALL-2`), Unity aim and art (`P-UNITY-FROST-WALL-1`).
- **Implementer tier:** implementer-opus (rh-sim abilities, state, collision, save/restore/hash)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): port by reading `78dd8bd4`; existing parity fixtures
  stay byte-identical (default stays Freeze) · D2 n/a

## 1. ID and outcome
In the unreleased legacy patch Frost's Wish is Frost Wall: aimed at a point (range 450, no closer than 64), cast 250 ms,
cooldown 45 s. It raises a barrier 224 long (seven tiles), square to the line from the caster, for 4 s. The FLOOR tiles
under it become LOW while it stands: bodies and melee swings stop, sight and shots do not. A fighter it would land on
is set down clear on its own side (the caster on the caster's side); one with no room keeps a gap round it. Walks
planned through it are planned again. It outlives its caster and falls at its time, at the coliseum teleport or at the
run's end. Freeze stays in the catalog. This packet ports that into `rh-sim` behind a `SimConfig` switch (default:
Frost's Wish is Freeze, serialized as nothing, so no hash, fixture, checkpoint or replay moves; the live `source-arena`
and `training` profiles select the wall). Nothing is sent to clients yet (`P-FROST-WALL-2`): until then the live
profiles must NOT opt in; this packet adds the switch and the rule, and the profile flips in `P-FROST-WALL-2`.

## 2. Dependencies
- P-REGEN-COMBAT-1-fix merged (the switch-encoding rule in `statics.rs`); P-CAMP-BUFF-THEMES-1 merged or not running
  (both add a `SimConfig` switch: strictly serial on `statics.rs`).

## 3. Relevant legacy paths
Read with `git show 78dd8bd4:<path>` (not in this branch's `packages/`; do not merge it):
- `packages/shared/src/barriers.ts` (`wallSegmentFor`, `wallCells`, `WALL_CELL_REACH` = 0.75 tile, `WALL_END_SLACK` =
  0.25 tile, `withBarriers`)
- `packages/shared/src/abilities.ts` (the `frostWall` definition, `{ do: "wall" }`, shape `wall`, faction Wish table),
  `packages/shared/src/constants.ts` (`FROST_WALL_RANGE` 450, `_MIN_RANGE` 64, `_LENGTH` 224, `_MS` 4000, `_CAST_MS`
  250, `_COOLDOWN_SECONDS` 45)
- `packages/server/src/sim/abilities.ts` (`raiseWall`: push-out search step 4 up to 96, the gap rule, the re-plan of
  blocked walks; cast point clamped from where the caster stands), `fields.ts` (field kind `wall`, `cells`,
  `barrierChanged`), `world.ts` (`collisionMap` overlay)
- `packages/server/test/frostWall.test.ts`, `packages/shared/test/barriers.test.ts` (the legacy acceptance cases)

## 4. New paths
- a `barriers` module in `crates/rh-sim/src/` (pure: segment and cells), named by the oracle author

## 5. Exclusive write scope
- `crates/rh-sim/src/statics.rs` (the switch), `crates/rh-sim/src/abilities/` (definition, cast, landing),
  the field store and its checkpoint (field kind `wall` with its cells), the collision and path queries that must see
  standing barriers (name each file in the hand-off), `crates/rh-sim/tests/hash_coverage.rs`
- version constants only where a serialized shape changes (checkpoint, replay); say which and why
- not `observe.rs`, not `rh-protocol`, not `rh-policy`, not `rh-server`

## 6. Contracts and references
- C-TICK: the wall is raised in the ability landing step where legacy raises it; no new system, no reordering.
- C-RNG: no draw. Determinism: cells are row-major indices in ascending order; push-out iterates fighters in the
  store's stable order; float arithmetic copies legacy's (sqrt only, no platform libm beyond what the crate allows).
- C-INPUT: the cast is the existing ability command with a point; no new command in this packet.
- Save/hash: a standing wall's cells and end time survive checkpoint and restore and reach the state hash.

## 7. Behaviour to preserve
- Every parity fixture, the hash tape and the determinism sweep byte-identical under the default config; Freeze
  unchanged and still castable under the default.
- The ability catalog's existing order (it is a wire order); `frostWall` is appended.
- If appending the ability moves the content hash under the default config, stop and report it before going on: the
  coordinator decides (a content hash bump needs the client and fixtures in the same branch).

## 8. Acceptance checks
- Oracle (pure): `wall_segment_for` and `wall_cells` on three hand-worked cases from `barriers.test.ts`: an
  axis-aligned wall takes seven tiles; a diagonal makes a closed staircase; cursor inside the minimum range clamps to 64.
- Oracle (sim, switch on): a Frost player's Wish raises a wall whose cells are LOW for bodies for 4 s then FLOOR again;
  a fighter standing on the line is set down on its own side within 96 units; a walker whose path crossed it is
  re-planned and does not pass through; a projectile passes over it.
- Oracle: default and wall configs give different statics digests; a standing wall round-trips through checkpoint;
  default-config state hash unchanged.
- `cargo run -p rh-parity --bin parity-report` all MATCH; `scripts/gate.sh --oracle packet/P-FROST-WALL-1` passes.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/barriers_tests.rs` (11 tests: three pure, five sim, three switch/save/hash)

## 9. Validation commands
- `cargo test -p rh-sim frost_wall`, `cargo test -p rh-sim barriers`, `cargo test -p rh-sim --test hash_coverage`,
  `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. The collision overlay is the risk: every query that reads the tile plane for bodies or swings must see the
barrier, and none that reads it for sight or shots may.

## 11. Known traps
- Mob spacing and Archetype hitboxes (live mode) also query the tile plane: list which of those see the barrier.
- Bots: legacy's ability policy drops a wall between itself and a chaser (`abilityPolicy.ts`, `WALL_PEEL_*`). `HumanBot`
  and the ported Brain are out of scope: say what a Frost bot does with its Wish under the switch (it must not cast a
  wall onto itself or stall).
- A DEVIATIONS row is needed (live rule differs from the in-repo legacy oracle): propose it in the hand-off.

## Notes from previous attempts
2026-11-12 (coordinator): both dependencies are met: P-REGEN-COMBAT-1-fix and P-CAMP-BUFF-THEMES-1 are merged
(`SimConfig` now carries `regen_in_combat` and `camp_buffs`, `crates/rh-sim/src/statics.rs:258,265`; a `Legacy`
variant serializes as a unit and adds no digest word, `hash.rs:21-22`: the wall's switch follows the same rule).
Identities at this point: protocol 17, observation 27, policy contract 21, checkpoint 31, replay 25, content hash
`4674a176a28e3c7a`. Facts for the oracle author: Freeze is defined at `crates/rh-sim/src/abilities/mod.rs:106` and
mapped to Frost at `:247`; `Target` kinds (`Unit`, `Self_`, `Point`) at `:38-39` and `:145`; a point-carrying cast
is `PublicCommand::Cast` (`crates/rh-sim/src/input.rs:101`, validated points clamped to the world, `:254`); placed
zones land in `crates/rh-sim/src/systems/abilities/effects.rs:386-476` (Trial) through `fields::add`/`remove`
(`:201-255`), with the field-kind checkpoint mapping in `abilities/effect_checkpoint.rs:35`. No oracle is written
yet. The champion panel's Welcome terms pin Freeze's numbers (P-WIRE17-HUD-2b, codes 0 and 1): the wall's own terms
are appended by P-FROST-WALL-2, not here.

2026-11-12 (worker, oracle author): verified against the code; the packet is CUT and STAGED (owner answers in the
worker session, 2026-11-12):
- **No new ability id here.** Appending `frostWall` to `AbilityId::ALL` moves the content hash `4674a176a28e3c7a`
  (`abilities::visit_content`, `status_runtime::rules::visit_extra_content`'s id loop) pinned in
  `parity/abilities/hash-tape.json` and `protocol/fixtures/*`, and breaks exhaustive matches in rh-policy
  (`delivery/projection.rs:183`, `tests/hud_content.rs`) and rh-server tests. Owner chose: under
  `SimConfig::frost_wish = Wall` Frost's Wish keeps id `Freeze` and casts the wall row (`abilities::definition_for`,
  `frost_wall_definition`); the wall's numbers are listed in `tests/content.rs` NON_GAMEPLAY and enter the content hash
  with the `frostWall` id, its wire code and the client in P-FROST-WALL-2.
- **The switch** is `SimConfig::frost_wish: FrostWish { Freeze (default, unit), Wall }` (`statics.rs`, hasher tag
  `"frost_wish=wall"`). SimConfig is built with full literals in ~30 places outside rh-sim (rh-server src and tests,
  rh-headless, rh-load): the owner approved adding only `frost_wish: rh_sim::FrostWish::Freeze,` there.
- **Storage:** a field of kind `FieldKind::Wall` (appended; not in the content field list yet) plus a barrier row in
  `AbilityRuntime::barriers` (unit when empty, like `MobRuntime::buffs`), and a derived `AbilityRuntime::overlay`
  (`#[serde(skip)]`) rebuilt by `barriers::sync`. `Field` itself is unchanged (rh-parity and rh-headless build it by
  literal). Walls are filtered out of `status_runtime/observe.rs` projections until P-FROST-WALL-2.
- **Cut** (WORKER_RULES, the sim packet is over ~450 lines): this packet = switch, cast and clamp, the wall's tiles,
  the collision overlay for walk planning (move orders, chase plans, displacement re-plans, slips) and swings, expiry,
  teleport/run-end clears, save/restore/hash. `P-FROST-WALL-1b` = setting down fighters it lands on (push-out, gap
  rule), re-planning walks already under way, mob AI and spacing, blink landings.
