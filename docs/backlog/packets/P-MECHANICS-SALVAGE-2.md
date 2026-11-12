# P-MECHANICS-SALVAGE-2: block and riposte bookkeeping from `fix/mechanics-sim` (Best Offense pending note, card weapon-hit test, riposte returned mult)

- **Serves:** as [P-MECHANICS-SALVAGE-1](P-MECHANICS-SALVAGE-1.md) (owner beta-follow-up decision 1; branch triage
  2026-11-12, row `fix/mechanics-sim`)
- **Implementer tier:** implementer-opus (rh-sim melee, projectiles, ledger scratch, schedule row)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-MECHANICS-SALVAGE-1 lands
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none
- **Status:** brief ready; the oracle (one failing sim test per mechanic, section 8) remains to be written.

## 1. ID and outcome
Inventory rows #5b, #5c and #8 of P-MECHANICS-SALVAGE-1 section A. When this lands:
- every block whose `blocked` hook ran counts for a Best Offense holder's streak and Wishful Thinking after the pass: in
  every world (not only with the faction layer on), reflected arrows included, a missing shooter excluded;
- the card `isWeaponHit` test excludes returned (`passive`) and follow-on (`derived`) hits: a sword riposte or a
  Spiked Shell return no longer counts as a streak hit or a Wishful Thinking trim;
- a sword riposte carries the shield holder's `returned` multiplier (Here Comes the Boom x1.25).
Legacy-direction only; no deviation row. Row `cardHooks.onBlocked` flips `Partial("P-CARDS-1")` -> `Ported`.

## 2. Dependencies
P-MECHANICS-SALVAGE-1 merged (its `block_hit` is the hit half of Best Offense; this packet is the pending half).
Merge one at a time with P-MECHANICS-SALVAGE-3 (both edit `schedule.rs`).

## 3. Relevant legacy paths
- `packages/server/src/sim/cardHooks.ts:176-178`, `:206-214`: `pending` gets `{by: holder, victim: attacker}` when
  `blockHits && standing(holder)` and a weapon is in hand.
- `packages/server/src/sim/cardHooks.ts:292-293`: `isWeaponHit` = weapon, no sig, no ability, not dot, not passive,
  not derived.
- `packages/server/src/sim/cardHooks.ts:301-335` (`:317`, `:319-323`): the system notes weapon hits, then every pending
  block (`note(b.by, b.victim, 0)`), then clears `pending`; `:75-79`, `:96` clear it on raidStarted / teleport.
- `packages/server/src/sim/melee.ts:80-90`: `blocked` hook for every melee block; riposte packet
  `raw * SHIELD_BLOCK_SHARE * riposteShare() * returnedMultOf(target.s)` (`:88`).
- `packages/server/src/sim/projectiles.ts:305`, `:310`: `if (shooter) world.hooks.blocked?.(...)` (reflect and block).
- Reference port: `git show 364c9dd0 -- crates/rh-sim/src/cards/after_damage.rs crates/rh-sim/src/systems/melee.rs
  crates/rh-sim/src/systems/projectiles.rs crates/rh-sim/src/systems/ledger.rs crates/rh-sim/src/systems/signatures.rs
  crates/rh-sim/src/systems/frost.rs crates/rh-sim/src/systems/regen.rs`, and the riposte hunk of
  `git show 6cdfbd68 -- crates/rh-sim/src/systems/melee.rs`; the `cardHooks.onBlocked` row in
  `git show 364c9dd0 -- crates/rh-sim/src/schedule.rs crates/rh-parity/tests/schedule.rs`.

## 5. Exclusive write scope
- `crates/rh-sim/src/cards/after_damage.rs`
- `crates/rh-sim/src/systems/melee.rs`, `crates/rh-sim/src/systems/projectiles.rs`
- `crates/rh-sim/src/systems/signatures.rs` (`BlockContact`, `LandedHit` only), `crates/rh-sim/src/systems/ledger.rs`
- test helpers that build `LandedHit` (`crates/rh-sim/src/systems/frost.rs`, `systems/regen.rs`, and any other the
  compiler names)
- `crates/rh-sim/src/schedule.rs` (row `cardHooks.onBlocked`), `crates/rh-parity/tests/schedule.rs`
  (`what_the_slice_has_ported_stays_ported`)

No `content!` constant, no content hash move. `LandedHit.passive/derived` and `BlockContact.hooked` are per-tick scratch
(`serde(skip)` where serialized): no checkpoint, replay or observation change.

## 6. Contracts and references
C-TICK (the pending note is read by the existing card `after_damage` system row); C-RNG (no draw); `tests/no_alloc.rs`.

## 7. Behaviour to preserve
- The faction layer's use of block contacts (`signatures.rs`) sees the same contacts it saw in engagement worlds.
- Parity report all MATCH (the branch with all groups: all MATCH).

## 8. Acceptance checks (the oracle to write: one failing sim test each, rig as `cards/on_hit_salvage_tests.rs`)
- **Riposte returned mult**: sword on a shield holder with Eye for an Eye, Hemorrhage, Spiked Shell and Here Comes the
  Boom (`parity/card-runtime/source.json` `returned-eye-spike-no-recursion`): legacy riposte bleed 0.1407122093023256/s
  = 0.11256976744186048 x 1.25. After group 1 alone the native gives 0.1126 (20 % low).
  Alternative check with no bleed: the swordsman's HP loss from one riposte is 1.25x a plain holder's.
- **isWeaponHit excludes returned hits**: a shield holder with Wishful Thinking (Plague, so the Wish has a cooldown)
  blocked by a sword: legacy trims nothing for the riposte (`cardHooks.ts:292-293`); the native trims 1 s per riposte.
  Check `card_trims` (or `stocks.wish_ready_at`) after one swing.
- **Best Offense pending note in a core world**: `real-block-pending-best-pocket-tank-wish` (`card-runtime/source.json`,
  core profile): legacy p1 (holder) `wishReadyAt` is trimmed by its blocks; the native (contacts recorded only under
  `engagement()`) does not count them. The branch's evidence names the numbers: 143100 (legacy) vs 150100 (no block
  counting).
- `scripts/gate.sh --oracle packet/P-MECHANICS-SALVAGE-2`; parity report all MATCH.

## 10. Risk and suggested model tier
Opus: melee/projectile resolution and per-tick scratch shared with the faction layer; a contact recorded in a new world
must not change a faction-layer reader.

## 11. Known traps
- Before the branch the two errors (no core-world contacts; riposte counted as a weapon hit) cancelled in the core
  profile and double-counted in faction worlds: fix both together or a test will look right for the wrong reason.
- `pending` is cleared at teleport and raid start (`cardHooks.ts:77`, `:96`).

## Notes from previous attempts

## Carried from the review of P-MECHANICS-SALVAGE-1 (2026-11-12, MINOR)
- One loose test for an Eye for an Eye holder with an axe whose Spiked Shell return shreds the attacker by
  `AXE_SHRED_ARMOR` (k = 1): rule #7 on a Spiked Shell return, which the first packet's oracle does not cover.
- The same-tick case: Best Offense, Eye for an Eye and Hemorrhage with a sword riposte in one tick share the tag
  `bleed:<tick>`, so the block bleed and the riposte bleed add into one instance (legacy 4.434): pin it here, with the
  riposte multiplier this packet owns.
- Evidence note: the parity report's "all MATCH" covers only the plain axe path (`axe_shred_stack`); the four on-hit
  rules of the first packet are evidenced by its loose tests only.
