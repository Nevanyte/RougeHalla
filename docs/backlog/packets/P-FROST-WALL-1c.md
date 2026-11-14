# P-FROST-WALL-1c: Frost Wall, third sim part: the remaining body-map readers, and the wall's numbers in content

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"); reviewer-opus
  notes on P-FROST-WALL-1b (2026-11-14)
- **Implementer tier:** implementer-opus (`rh-sim` state and tick code; content registry)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-FROST-WALL-1b
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` (read with `git show`; not merged
  into `packages/`) · the content hash MOVES (the wall's numbers enter content) · parity fixtures run with the switch
  off and stay untouched · no wire change (P-FROST-WALL-2)

## 1. ID and outcome
After P-FROST-WALL-1b a standing wall stops bodies, swings, mob paths and blink landings, behind
`SimConfig::frost_wish == Wall` (default `Freeze`; no profile selects `Wall`). Legacy reads the wall
(`collisionMap(world)`, patch `78dd8bd4`) in more places than the two sim parts ported. Before any profile selects
`Wall`, the readers whose miss a player would see must read it too. When this lands, with a wall standing:
1. **A cannon never lands a player in the ice** (`crates/rh-sim/src/systems/cannons.rs:49`, the landing's
   `circle_clear` with `MASK_MOVE`): the landing search treats wall tiles as blocked, as legacy does.
2. **Plague zombies** are never placed in the ice and never hit across it (`plague_zombies.rs:60` placement beside the
   owner; `:371` the hit line with `MASK_MOVE`).
3. **Bruiser passive reach** does not cross ice a swing cannot cross (`bruiser.rs:70`, `reach_mask(weapon)`).
4. **Wind emblems** never spawn in the ice, with legacy's draw count when a candidate is rejected (`wind.rs:61,108`).
5. **The wall's numbers are content**: the set-down step and limit (4, 96) and the gap's reach (`PLAYER_RADIUS + 32`),
   today literals inside `barriers::set_down` and `keep_gap`, become named constants registered in the content
   registry with the wall's other numbers (`abilities/mod.rs:272-278`, `barriers.rs:20-22`), so `content_hash` covers
   every number the wall plays with. The content hash moves once, here.
Readers left as they are, recorded in DEV-029 (pick-up and interaction line of sight in `items.rs:297`, quests,
corpses, chests, training spawn, `walk_hint`, traders): someone can pick up or interact across the ice.

## 2. Dependencies
P-FROST-WALL-1b merged. Serial with any packet touching `content.rs` or `tests/content.rs`.

## 3. Relevant legacy paths (commit `78dd8bd4`)
`packages/server/src/sim/world.ts` (`collisionMap`), and its readers: `consumables.ts:107,159,172`, `loot.ts:146`,
`plagueZombies.ts:25,138`, `plagueCorpses.ts:51,86`, `traders.ts:65,103`, `quests.ts:201,422`,
`training.ts:198,222,307`, `walkHint.ts:167,192`, `bruiserPassives.ts:48`, `projectiles.ts:211`. The oracle author
maps each to its Rust reader and states which this packet ports (the four above) and which stay.

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/{cannons,plague_zombies,bruiser,wind}.rs` (only the map reads named above)
- `crates/rh-sim/src/barriers.rs` (the constants), `crates/rh-sim/src/content.rs` and the registry rows
- the identities' pinned content hash wherever the repo pins it (the oracle author lists every file; Rust, C# and JS)
- not `observe.rs`, not the protocol, not `statics.rs` (`live_content()` is P-FROST-WALL-2's flip)

## 7. Behaviour to preserve
- Switch off: byte-identical. Every parity fixture, the ability hash tape, `step_event_window`, the no-allocation
  oracles and the replay tests stay green without re-recording. A reader takes `barriers::body_map` (the plain map,
  no allocation, when no wall stands).
- No RNG draw added or removed with the switch off; with it on, Wind's draw count follows legacy.
- Protocol 17, observation 29, policy contract 23, checkpoint 32, replay 25 unchanged. Only the content hash moves.

## 8. Acceptance checks
- Unit (red today), each with a wall standing: a cannon shot aimed to land on a wall tile lands clear of it; a
  zombie raised beside an owner standing against the wall is not on a wall tile, and a zombie's hit line across the
  wall does not connect; a bruiser passive does not reach across the wall where the same weapon's swing does not; a
  wind emblem's spawn candidates on wall tiles are rejected.
- Guards: each of the four with the switch off equals today (same positions, same draws).
- Registry (red today): the three numbers are named constants present in the content registry; the content hash
  differs from `4674a176a28e3c7a` and is pinned at its new value in every place that pins it.
- `scripts/gate.sh --oracle packet/P-FROST-WALL-1c` passes.

## 10. Risk and suggested model tier
Opus. The content hash is an identity: client and server must agree, so every pinned copy moves in this packet.

## 11. Known traps
- `tests/content.rs` counts every `const` in `rh-sim` source: a new constant needs its registry or `NON_GAMEPLAY` row.
- Sight and shots are NOT stopped by the wall (legacy: "shots fly over it"): readers using `MASK_SIGHT` stay as they
  are. Only body and reach reads change.

## Notes from previous attempts
