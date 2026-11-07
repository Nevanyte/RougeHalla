# P-CONS-1b: wind emblems and the speed boost (P-CONS-1 remainder, part 1)

## 0. Revisions

- Base: `62368a49` (`deepseek/p-cons-1a`, protocol 9, P-CONS-1a). Stacked because this packet adds protocol 10.
- Toolchain: `cargo 1.97.0`, capture container `node:22.23.4-bookworm-slim@sha256:aaa4b5ba…`, linux/amd64.

## 1. Outcome

Port `updateWindEmblems` from `packages/server/src/sim/consumables.ts`: a private, order-salt-derived stream that spawns
walk-over "wind emblem" props on floor tiles away from the existing ones (8-15 s apart, at most 12 up), the nearest
standing player within 30 u and line of sight consuming one (ties by `tieRank`), and the +50% movement speed for 5 s it
grants through the stat-mirror source, with the source's toast. Emblems never spawn in training, never on their birth
tick, and the boost ends on time or on death. Cannons remain P-CONS-1c.

## 2. Legacy paths verified with `rg`

- `packages/server/src/sim/consumables.ts`: `updateWindEmblems`, `WIND_SPAWN_MIN_MS 8000`, `WIND_SPAWN_MAX_MS 15000`,
  `WIND_EMBLEM_LIMIT 12`, `WIND_PICKUP_RADIUS 30`, the `windRandom = mulberry32(world.orderSalt ^ 0x6a2c581f)` stream,
  the install-time and `raidStarted` timer draws, `bornThisTick`/LoS/tieRank selection, `WIND_EMBLEM_DEF`, and the
  `fighterOut` cleanup.
- `packages/shared/src/constants.ts`: `SPEED_BOOST_MS` and `SPEED_BOOST_MULT`.
- `packages/server/src/sim/world.ts`: `orderSalt` (the secret the stream derives from).

## 3. Write scope

`crates/rh-sim/src/{state,constants,checkpoint,events,hooks,schedule}.rs`, `src/systems/{consumables,wind}.rs`,
`src/systems/potions.rs` (the Hot loop moves under the consumables system), `src/systems/{items,mod}.rs`,
`src/item_view.rs`, `src/initial_world/mod.rs`, protocol 10: `crates/rh-protocol/**`, `client-unity/**`,
`crates/rh-server/src/{wire,wire_state}.rs`, `crates/rh-server/web/probe.html`, `tools/protocol-js/**`,
`tools/browser-proof/**`, `protocol/fixtures/v10.json`, `tools/consumable-fixtures/**`, `parity/consumables/**`, this
README and the ledger.

## 4. Contracts

- **C-RNG:** one new private stream, `World.wind_rng = Mulberry32(order_salt ^ 0x6a2c581f)`; its seed derivation is pinned
  in a unit test, its state is hashed/checkpointed, and the legacy source probe pins the draw order (install draw, the
  `raidStarted` draw, then one timer draw per spawn plus up to 40 two-draw tile attempts).
- **C-TICK:** the wind update keeps `consumables.updateConsumables`'s slot and runs before the potion Hot loop, as source.
- **C-OBS:** an emblem is a visible public prop (`PropKind::Consumable` with the fixed label) and the pickup toast is
  private to its consumer; the speed boost itself reaches clients only as movement.
- **C-DET:** `speed_boost_until`, `wind_next_at` and the RNG state are world leaves, validated and checkpointed.
- **C-NET:** protocol 10 (a new prop kind and the toast event) with regenerated vectors and both decoder mirrors.

## 5. Behaviour to preserve

- No spawn in training or outside the active phase; no pickup of an emblem born this tick.
- The timer is re-armed by one draw whenever it is due, before the 12-emblem cap check; a capped map still consumes the
  draw.
- The pickup winner is the nearest eligible player (distance, then `tieRank`); only a standing player inside 30 u with
  line of sight qualifies.
- `speed_boost_until = now + 5000`; the source is `1.5x` while it is in the future and the fighter is alive; it is
  cleared on death/leave and at expiry, re-folding the mirrors.
- The toast text is the source's "Wind emblem · +50% movement for 5s".

## 6. Acceptance checks

(TBD)

## 7. Commands

(TBD)

## 8. Traps

- The install-time timer draw and the `raidStarted` draw both happen before the first spawn; a port that only seeds at
  raid start shifts every later position.
- `circleClear` uses the move mask and `PLAYER_RADIUS`; the three-tile spacing check is between emblems only.
- The cap check happens after the timer draw, so the RNG stream advances even when no emblem is placed.
