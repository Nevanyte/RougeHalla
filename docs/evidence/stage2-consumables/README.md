# P-CONS-1a: the large potion and the camp-clear reward

## 1. Outcome

Port the large ("Camp") potion and the camp-clear reward from `packages/server/src/sim/consumables.ts` and
`campHeal.ts`:

- a second potion stock (`potionLarge`, cap 5, 40% of max hp over 5 s) beside the small one (25%), with the source's
  use/refusal rules (a large potion is preferred, `POTION_MAX_CONCURRENT` 3 Hot stacks, full health and an empty bag
  refuse);
- the `campCleared` hook chain: a real dispatched link at its recorded position, and `campHeal.payCampHeal` — every
  standing contributor of the cleared camp gets one `potionLarge` (a bag-full toast instead when it cannot be stored), the
  eligible ones gain `campsCleared`, and the camp's contributors are forgotten;
- the wire: `potionLarge` in the player inventory record and the large/camp potion notice codes, with golden vectors and
  the C#/JS decoder mirrors.

This is a slice of P-CONS-1. Wind emblems and travel cannons stay Pending (`consumables.updateConsumables`'s remaining
system body and the `consumables.<anonymous>` mod source).

## 2. Legacy paths verified with `rg`

- `packages/server/src/sim/consumables.ts`: `grantConsumable`, `handleUseConsumable` (size choice, `potionRefusal`, Hot
  amount `maxHp * share / steps`), `updateConsumables`'s Hot loop (already ported for small potions),
  `CONSUMABLES`/`POTION_REFUSAL` wording.
- `packages/server/src/sim/campHeal.ts`: `noteCampContributors`, `campContribOf`, `eligibleContributors`, `nearCamp`,
  `campCentre`, `payCampHeal`, `install` (the `campCleared` link).
- `packages/server/src/sim/camps.ts`: `campMobDied` — the clear is paid after the ledger pass, fx then
  `world.hooks.campCleared(world, camp)`; `CAMP_RESPAWN_MS`, `CAMP_WARD_MS`.
- `packages/shared/src/constants.ts`: `POTION_LARGE_SHARE = 0.4`, `POTION_SMALL_SHARE = 0.25`,
  `POTION_HEAL_MS = 5000`, `POTION_MAX_CONCURRENT = 3`, `CONSUMABLE_CAP = 5`, `CAMP_HEAL_RANGE = 12 * TILE`.
- `packages/shared/src/consumables.ts`: `CONSUMABLES` names/text, `potionRefusal` order.
- `packages/server/src/sim/gameplay.ts`: the install order (campHeal after chests/quests, before consumables).

## 3. Write scope

`crates/rh-sim/src/{state,constants,checkpoint,events}.rs`, `src/systems/{potions,items,ledger,mob_life,camp_heal}.rs`,
`src/potions/mod.rs`, `src/schedule.rs`, `src/hooks.rs`, `src/initial_world/mod.rs`, `crates/rh-parity/**` (option and
scenario plumbing), `crates/rh-protocol/**` + `client-unity/RoguehallaNet/Protocol/**` + the Unity copy + `protocol/fixtures/v9.json`
+ `tools/protocol-js/**` + `tools/browser-proof/**`, `parity/legacy-capture/**`, `parity/fixtures/**`, `tools/consumable-fixtures/**`,
this README and the progress ledger.

## 4. Contracts

- C-TICK: `campHeal.payCampHeal` keeps its recorded CAMP_CLEARED position (after quests, before bruisers); the potion Hot
  loop stays in `consumables.updateConsumables`'s slot.
- C-OBS: the new stock is public *and* private: it reaches clients only through the wire inventory record; no hidden
  state changes.
- C-RNG: no new stream.
- C-DET: `potion_large` and `camps_cleared` are `World` leaves (hashed, checkpointed, validated).
- C-NET: protocol 8 -> 9 (an incompatible inventory record change), regenerated golden vectors, C#/JS mirrors, browser
  proof.

## 5. Behaviour to preserve

- `potionRefusal` order: blocked (stunned/casting), busy (3 Hot stacks), full health, empty bag (both stocks 0).
- A use prefers the large potion; the amount is `maxHp * share / steps` per 500 ms step, the Hot lasts 5 s and mirrors
  `healingUntil`/`potionsHealing`; anti-heal and the healing-received multiplier apply through `heal()`.
- `payCampHeal`: a no-op for a camp nobody damaged; each standing contributor is granted a large potion (bag-full toast
  when full); `campsCleared` only for contributors standing inside the camp territory or within `CAMP_HEAL_RANGE` of its
  centre (a camp with no centre counts everyone who fought it); the camp's contributors are then deleted.
- The clear itself is unchanged: the final death sets the state, ward and respawn clocks, then the payout emits the fx and
  fires the chain (fx first, as in source).

## 6. Acceptance checks

(to fill: capture/probe, per-tick parity, restore, mutants, gates, protocol)

## 7. Commands

(to fill)

## 8. Traps

- The large potion's only ordinary producer is the camp-clear reward, and mobs are not yet comparable in the parity
  harness (P-PARITY-2): the use path is captured with a scenario setup that grants the stock through the actual source
  `grantConsumable`, and the camp reward is a source-module probe (`noteCampContributors` + `payCampHeal`), not a
  hand-written oracle.
- `campsCleared` has no consumer yet (Pack Leader/chest offers are P-CARDS-2); it is still written and hashed because the
  source writes it, and the campHeal probe pins it.
- The bag-full toast differs from the ordinary potion refusal wording; it is its own notice code, not `BagFull`.
