# Hand-off: P-FROST-WALL-1 (worker session, 2026-11-13)

```
PACKET:          P-FROST-WALL-1 — serves owner beta-follow-up decision 2 (MIGRATION 2026-11-10, "Frost Wall replaces
                 Freeze"); cut: this is part 1 of the sim work, P-FROST-WALL-1b (brief committed) is part 2
BRANCH:          agent/claude/P-FROST-WALL-1 @ 4361f9420 (oracle: packet/P-FROST-WALL-1 @ 981c3b895)
GATE:            PASS (full) [skipped: Postgres suites (no DATABASE_URL); CI-only checks: capture --check, perfproof,
                 cross-arch determinism, browser proof, Unity Web build]
CHANGED:         see "Files" below (stub + implementation; oracle = crates/rh-sim/src/barriers_tests.rs and the briefs)
D-RULES:         D1 loose proof from legacy 78dd8bd4 (barriers.test.ts and frostWall.test.ts numbers); D2 n/a;
                 nothing touches D5/D6/D9. Default config: parity report all MATCH, hash tape, hash_coverage and the
                 headless smoke unchanged (gate)
DEVIATIONS:      proposed DEV-<n>: under SimConfig::frost_wish = Wall, Frost's Wish is Frost Wall (unreleased legacy
                 78dd8bd4), not the in-repo legacy oracle's Freeze; part 1 does not yet set down fighters the wall lands
                 on or re-plan walks already under way (P-FROST-WALL-1b)
SHARED RECORDS:  proposed edits: docs/MIGRATION.md checkpoint: P-FROST-WALL-1 landed behind frost_wish (default
                 Freeze, no live profile), P-FROST-WALL-1b queued; identities unchanged (protocol 17, observation 27,
                 policy 21, checkpoint 31, replay 25, content hash 4674a176a28e3c7a)
LEGACY DOUBTS:   none in the ported rule. 78dd8bd4 abilities.ts handleCast clamps the aim point without the range
                 slack, and raiseWall clamps again with `range + CAST_RANGE_SLACK` from where the caster stands at the
                 landing; ported as written
NOT ESTABLISHED: see below
RISKS:           see below
```

## Owner decisions taken in the worker session (2026-11-12/13)
1. **Staged, no new ability id.** Appending `frostWall` to `AbilityId::ALL` would move the content hash (it is pinned
   in `parity/abilities/hash-tape.json` and `protocol/fixtures/*`) and break exhaustive matches in rh-policy and
   rh-server. Under `frost_wish = Wall`, Frost's Wish keeps id `Freeze` and casts the wall row
   (`abilities::definition_for`, `frost_wall_definition`). The wall's numbers are listed in `tests/content.rs`
   NON_GAMEPLAY and enter the content hash with the id, wire code and client in P-FROST-WALL-2.
2. **SimConfig literals outside rh-sim.** One line, `frost_wish: rh_sim::FrostWish::Freeze,`, was added to every
   existing SimConfig literal in rh-server (src and tests), rh-headless and rh-load. Nothing else changed in those
   crates, and no profile opts in.
3. **Range kept at 64–450, any angle** (owner confirmed). The wall is square to the caster→cursor line at any angle;
   its tiles snap to the grid, so a diagonal is a closed staircase.

## What the packet does
- `SimConfig::frost_wish: FrostWish { Freeze (default), Wall }` (`statics.rs`). `Freeze` serializes as a unit (JSON
  `null`, no hash word). `Wall` is `"wall"` in JSON and the 15-byte tag `"frost_wish=wall"` in the hasher.
- `crate::barriers`: `wall_segment_for` and `wall_cells` (legacy `wallSegmentFor`/`wallCells`, same operation order,
  `crate::math` only); `Barriers` rows in `AbilityRuntime::barriers` (unit when empty, like `MobRuntime::buffs`); a
  derived `Overlay` (`#[serde(skip)]`), the arena map with the wall tiles LOW (`TileMap::with_low`), rebuilt by
  `barriers::sync`; `barriers::check` in `check_world`.
- Cast (`systems/abilities/mod.rs`): `Target::Placed` clamps the aim point from the caster's position at the cast.
  The landing raises the wall in the target pass of the existing landing step (`effects.rs` `raise_wall`, legacy
  `raiseWall`): no new system, no reordering, no RNG draw. The cast-landed event is drawn at the wall's centre.
- Field kind `FieldKind::Wall` (appended). Walls outlive their caster (`FieldSelector::Departed`), fall at their time
  (`end_fields_with`, which syncs), and are cleared at the teleport, the run's end and raid start (each syncs).
  Restore rebuilds the overlay.
- Walls are filtered out of `status_runtime/observe.rs` projections, so nothing reaches clients
  (`crates/rh-sim/src/observe.rs` is untouched).

## Queries that see a standing barrier (`barriers::body_map`)
- `systems/inputs.rs` `apply_inputs`: move orders are planned round it.
- `systems/targeting.rs` `plan` and `sealed`: chase plans.
- `systems/displace.rs` `execute`: re-plan after a displacement.
- `systems/movement.rs`: slip walk and regrip.
- `systems/melee.rs` swing ray (`MASK_MELEE`): swings stop.

Queries that do NOT see it, deliberately or as part 1b:
- Sight, targeting LOS and projectiles: LOW passes `MASK_SIGHT` anyway.
- Mob AI paths and mob spacing (`mob_ai.rs`, `mob_spacing.rs`): 1b.
- Blink landings: 1b.
- Plague, bruiser, wind, cannons, items, traders, quests, reward chests, training: placement and reach queries,
  unchanged.
- Archetype hitboxes: they read the same maps as above, so they see the wall exactly where a circle does.

## Frost bot under the switch
`HumanBot` and the Brain still send Frost's Wish at a unit's position (the Freeze cast with `id`). Under `Wall` the
id is ignored and the wall lands at that point, clamped to 64–450. The bot never walls itself and never stalls: the
cooldown is spent as before. Until 1b, an enemy standing on the wall's tiles is not set down and cannot plan a walk
out for up to 4 s (in effect a root). No live profile opts in.

## Files beyond the brief's write scope (named, as asked)
- `crates/rh-sim/src/map.rs`: `TileMap::with_low`, the overlay builder; `layers` is private to map.rs.
- `crates/rh-sim/src/lib.rs`: module and re-export.
- `crates/rh-sim/src/status_runtime/observe.rs`: the wall filter.
- `crates/rh-sim/src/systems/{inputs,melee,targeting,movement,status/mod}.rs`: query sites and sync points.
- `crates/rh-sim/tests/content.rs`: NON_GAMEPLAY rows for the 8 staged constants.
- `crates/rh-sim/tests/status_content.rs`: unreachable `Wall` arm.
- rh-server, rh-headless, rh-load: the default `frost_wish` line only.

## NOT ESTABLISHED
- Fighters the wall lands on are not set down (no push-out, no gap rule), and walks already under way when it rises
  are not re-planned. Both are 1b, and both differ from legacy until then.
- Mobs path through standing walls. Blinks can land on them.
- JSON checkpoints and replay headers of default-config worlds now carry `"frost_wish": null` and
  `"barriers": null` keys, as `camp_buffs`/`buffs` did. State hashes, the hash tape and parity are unchanged, and
  no format version was bumped (the gate passes with every fixture). A byte comparison of checkpoint JSON outside
  this repo would see the new keys.
- No Postgres suite ran locally.

## RISKS
- The overlay is rebuilt only at its sync points (raise, expiry, clears, restore). A future path that removes a wall
  field without `barriers::forget` + `sync` would leave a stale overlay; `check_world` refuses the inconsistency on
  restore only.
- A full `TileMap` rebuild per raise/fall (two per wall) allocates under `Wall` only; the `no_alloc` tests run the
  default config.

## `git diff --stat packet/P-FROST-WALL-1` (before this file)
```
 crates/rh-sim/src/abilities/mod.rs             |   7 +-
 crates/rh-sim/src/barriers.rs                  | 138 +-
 crates/rh-sim/src/map.rs                       |  15 +
 crates/rh-sim/src/systems/abilities/effects.rs |  59 +-
 crates/rh-sim/tests/hash_coverage.rs           |  62 +
 5 files changed, 266 insertions(+), 15 deletions(-)
```
Stub + oracle vs `038f83c8`: 46 files, 977 insertions, 24 deletions (including the 32 one-line config additions).
