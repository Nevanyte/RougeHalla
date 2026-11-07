# P-CONS-1a: the large potion and the camp-clear reward

## 0. Revisions

- Base: `33ee92c7f1914e6813c17ef50f36da6e12e0503e` (`origin/deepseek/p-faction-3`: protocol 8, P-FACTION-4 + P-FACTION-3).
  This packet is stacked on that snapshot branch because it bumps the protocol to 9.
- Toolchain: `cargo 1.97.0 (c980f4866 2026-06-30)`, `rust-toolchain.toml` 1.97.0; capture container
  `node:22.23.4-bookworm-slim@sha256:aaa4b5ba…`, linux/amd64, Node v22.23.4.

## 1. Outcome

Port the large ("Camp") potion and the camp-clear reward from `packages/server/src/sim/consumables.ts` and
`campHeal.ts`:

- a second potion stock (`potionLarge`, cap 5, 40% of max hp over 5 s) beside the small one (25%), with the source's
  use/refusal rules (a large potion is preferred, `POTION_MAX_CONCURRENT` 3 Hot stacks, full health and an empty bag
  refuse);
- the `campCleared` hook chain: a real dispatched link at its recorded position, and `campHeal.payCampHeal` — every
  standing contributor of the cleared camp gets one `potionLarge` (a bag-full toast instead when it cannot be stored), the
  eligible ones gain `campsCleared`, and the camp's contributors are forgotten;
- the wire: `potionLarge` in the player inventory record and the large/camp potion notice codes 8..10, with protocol v9,
  golden vectors and the C#/JS decoder mirrors (and the browser probe's decoder).

This is a slice of P-CONS-1. Wind emblems and travel cannons stay Pending (`consumables.updateConsumables`'s remaining
system body and the `consumables.<anonymous>` mod source).

## 2. Legacy paths verified with `rg`

- `packages/server/src/sim/consumables.ts`: `grantConsumable`, `handleUseConsumable` (size choice, `potionRefusal`, Hot
  amount `maxHp * share / steps`), `updateConsumables`'s Hot loop, `CONSUMABLES`/`POTION_REFUSAL` wording.
- `packages/server/src/sim/campHeal.ts`: `noteCampContributors`, `campContribOf`, `eligibleContributors`, `nearCamp`,
  `campCentre`, `payCampHeal`, `install` (the `campCleared` link).
- `packages/server/src/sim/camps.ts`: `campMobDied` — the clear is paid after the ledger pass, fx then
  `world.hooks.campCleared(world, camp)`.
- `packages/shared/src/constants.ts`: `POTION_LARGE_SHARE = 0.4`, `POTION_SMALL_SHARE = 0.25`, `POTION_HEAL_MS = 5000`,
  `POTION_MAX_CONCURRENT = 3`, `CONSUMABLE_CAP = 5`, `CAMP_HEAL_RANGE = 12 * TILE`.
- `packages/shared/src/consumables.ts`: names/text, `potionRefusal` order.
- `packages/server/src/sim/gameplay.ts`: the install order (campHeal after chests/quests, before consumables).

## 3. Write scope

`crates/rh-sim/src/{state,checkpoint,events,hooks,initial_world/mod,item_view,replay}.rs`,
`src/systems/{potions,items,ledger,camp_heal,mod}.rs`, `src/potions/mod.rs`, `src/schedule.rs`,
`crates/rh-sim/tests/{content,no_alloc}.rs`, `crates/rh-parity/tests/schedule.rs`, protocol v9:
`crates/rh-protocol/**`, `client-unity/RoguehallaNet/Protocol/{State,Messages,Codec}.cs` + the Unity copy,
`client-unity/RoguehallaNet.Tests/**`, `client-unity/README.md`, `crates/rh-server/src/{wire,wire_state,main}.rs`,
`crates/rh-server/web/probe.html`, `tools/protocol-js/check-vectors.mjs`, `tools/browser-proof/proof.mjs`,
`protocol/fixtures/v9.json`, `tools/consumable-fixtures/**`, `parity/consumables/source.json`, this README and the
ledger.

## 4. Contracts

- **C-TICK:** `campHeal.payCampHeal` keeps its CAMP_CLEARED position; the clear's payout pushes the fx event, then fires
  the chain (source order). The potion Hot loop keeps its `consumables.updateConsumables` slot.
- **C-OBS:** the new stock reaches clients only through the observation `Inventory` and the protocol inventory record;
  no hidden state changed (the potion notices are the source's own toasts).
- **C-RNG:** no new stream.
- **C-DET:** `potion_large` and `camps_cleared` are `World` leaves (hashed, checkpointed; `potion_large` is capped by
  `potions::validate`).
- **C-NET:** protocol 8 -> 9 (an incompatible inventory record change) with regenerated golden vectors, C#/JS mirrors and
  the browser probe decoder.
- **C-PARITY:** the potion and camp cases are actual-source probes compared by `crates/rh-sim/src/systems/consumables_source_tests.rs`.

## 5. Behaviour to preserve

- `potionRefusal` order: blocked (stunned/casting), busy (3 Hot stacks), full health, empty bag (both stocks 0).
- A use prefers the large potion; each 500 ms step heals `maxHp * share / steps` (steps = 10) with `ignoreLockout`; the Hot
  lasts 5 s and mirrors `healingUntil`/`potionsHealing`.
- `payCampHeal`: a no-op for a camp nobody damaged; each standing contributor is granted a large potion (the camp bag-full
  toast when full); `campsCleared` only for contributors standing inside the camp territory or within `CAMP_HEAL_RANGE` of
  its centre (no centre: everyone who fought it); contributors are then forgotten.
- The clear itself is unchanged (state, ward, respawn clocks set before the payout).

## 6. Acceptance checks

- [x] Actual-source probe `parity/consumables/source.json` (pinned container, `tools/consumable-fixtures/capture.sh`):
      **5 potion cases compared tick by tick** (hp, both stocks, heal clock, Hot count; the presses go through the real
      intake) and **4 camp cases** (players, contributors, toasts); `--check` matches **byte for byte**.
- [x] `cargo test -p rh-sim systems::consumables_source_tests --lib` — 3 passed.
- [x] Unit tests: large preferred and 40% / small-only 25%; full camp bag refuses without storing; Hot ticks; camp clear
      pays the contributors at the camp and not the far one, a dead contributor gets nothing, nobody pays nothing
      (`systems::camp_heal`, `systems::potions`).
- [x] Checkpoint: `potion_large` capped; the existing checkpoint/Hot validation covers the mirrors.
- [x] `cargo test -p rh-sim --test no_alloc -- --nocapture` — potion Hot: **100 measured steps, 18 heals, 0 allocations**
      (the use action's Hot-vector allocation is setup, outside the measured steps, as the pre-existing small potion path).
- [x] `cargo test -p rh-sim --test content` — 21 passed, golden `b9ea06c370690603` (was `a882b26657530d74`).
- [x] `cargo test -p rh-parity --test schedule` — 14 passed; the CAMP_CLEARED `campHeal.payCampHeal` link is asserted ported.
- [x] Negative controls: 8/8 mutants killed by semantic test failures, unchanged control passes
      (`tools/consumable-fixtures/run-mutants.sh`).
- [x] Protocol: `cargo test -p rh-protocol` all suites; `node tools/protocol-js/check-vectors.mjs` — 25 server vectors, 89
      malformed, 10 chains, 15,484 checks against `v9.json`; `dotnet test client-unity/RoguehallaNet.Tests` — 271 passed.
- [x] `cargo fmt --all --check`; both strict Clippy workspace modes.
- [ ] `cargo test --workspace --all-features --locked` (throwaway PostgreSQL) — RUNNING.
- [x] `node tools/browser-proof/proof.mjs` — **15/15 checks PASS**, protocol **9**, 4 Full + 415 delta snapshots, no page
      errors, content hash `b9ea06c370690603` (the page's own decoder reads the new `potionLarge` inventory byte).

## 7. Commands

```sh
tools/consumable-fixtures/capture.sh --check          # byte-for-byte source.json
cargo test -p rh-sim systems::consumables_source_tests --lib
cargo test -p rh-sim systems::camp_heal --lib
cargo test -p rh-sim systems::potions --lib
cargo test -p rh-sim --test no_alloc -- --nocapture
cargo test -p rh-sim --test content
cargo test -p rh-parity --test schedule
cargo test -p rh-protocol
node tools/protocol-js/check-vectors.mjs
dotnet test client-unity/RoguehallaNet.Tests
tools/consumable-fixtures/run-mutants.sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
eval "$(PGBIN=/opt/homebrew/opt/postgresql@16/bin bash tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked
node tools/browser-proof/proof.mjs
```

## 8. Shared-file hunks

- `crates/rh-sim/src/{hooks,ledger,schedule}.rs`: the `CampCleared` hook argument and its firing point in the clear
  payout; the `campHeal.payCampHeal` link flipped in place.
- `crates/rh-sim/src/{state,potions,systems/potions,systems/items,systems/camp_heal}.rs`: the large stock, the size-aware
  grant/use/validate, the pickup branch and the reward system.
- `crates/rh-sim/src/{initial_world,item_view,replay}.rs`: `ItemDef::PotionLarge` and the observation `Inventory` field.
- `crates/rh-protocol/**`, `client-unity/**`, `protocol/fixtures/v9.json`, `crates/rh-server/web/probe.html`,
  `tools/protocol-js/check-vectors.mjs`, `tools/browser-proof/proof.mjs`: protocol 9, `potionLarge`, notice codes 8..10.
- `crates/rh-sim/tests/{content,no_alloc}.rs`; `crates/rh-parity/tests/schedule.rs`.

## 9. Traps

- The probe's presses must go through `createIntake` with `{kind: "heal"}`: the validator refuses an empty payload, and a
  direct `handleUseConsumable` call would use a clock one tick earlier than the sim's input window (the first capture had
  that off-by-one-tick heal clock).
- The camp cases need the same map on both sides; the probe now builds its map from `parity/initial-loot/input-map.json`
  (the layered map the Rust test loads), not from `generateMap(1)` (a different camp layout).
- `campCleared` was an event only; the chain had no firing site. The payout now emits the event and fires the chain in
  source order.
- The Rust live profile keeps `regen`/`camps` staged; this packet does not enable a new live mode.

## 10. Owner questions

1. Protocol 9 is stacked on the unmerged v8 snapshot branch (P-FACTION-3): the coordinator must merge in version order.
2. The shared status records still carry the old content hash; this packet's is `b9ea06c370690603`.
