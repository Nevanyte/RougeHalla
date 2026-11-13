# P-MECHANICS-SALVAGE-2: block and riposte bookkeeping from `fix/mechanics-sim` (Best Offense pending note, card weapon-hit test, riposte returned mult)

- **Serves:** as [P-MECHANICS-SALVAGE-1](P-MECHANICS-SALVAGE-1.md) (owner beta-follow-up decision 1; branch triage
  2026-11-12, row `fix/mechanics-sim`)
- **Implementer tier:** implementer-opus (rh-sim melee, projectiles, ledger scratch, schedule row)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-MECHANICS-SALVAGE-1 lands
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none
- **Status:** oracle committed on `packet/P-MECHANICS-SALVAGE-2` (5 failing tests, 5 guards; section 8); ready for
  implementer-opus.

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
- `packages/server/src/sim/cardHooks.ts:291-293`: `isWeaponHit` = weapon, no sig, no ability, not dot, not passive,
  not derived.
- `packages/server/src/sim/cardHooks.ts:42` (`chainHook(world, "blocked", onBlocked)`) is installed before
  `packages/server/src/sim/bruiserPassives.ts:122` (`noteBlockedContact`): the `BLOCKED` table's order
  (`crates/rh-sim/src/schedule.rs:1875-1890`, `cardHooks.onBlocked` then `bruiserPassives.noteBlockedContact`) already
  matches; the hook fires at `melee.ts:83` (every melee block, before the riposte is recorded) and `projectiles.ts:305`,
  `:310` (arrow blocked at the reflection cap / reflected, only `if (shooter)`). The row flips in place; nothing moves
  (C-TICK). The pending note is read by the existing `cardHooks.afterDamage` system row (`cardHooks.ts:301-335`).
- `packages/shared/src/interactions.ts:60-74`: `shieldOutcome`: a sword is a riposte, a shield bash a plain block, an
  arrow a reflection, an axe pierces.
- `packages/server/src/sim/cardHooks.ts:139-146`: Spiked Shell's return is deferred (`deferHit`, next tick's ledger),
  names the holder's `activeWeapon`, `passive: true, final: true`, with `returnedMultOf(victim.s)`.
- `packages/server/src/sim/cardHooks.ts:367-388`: `wishfulThinking` (needs a cast Wish; 1000 ms per counted hit,
  `packages/shared/src/cards.ts:399-404`).
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

## 4. New paths
- none for the implementer (the oracle file below is committed by the oracle author; its `mod on_hit_salvage2_tests;`
  line in `crates/rh-sim/src/cards/mod.rs` is the stub commit's).

## 5. Exclusive write scope
- `crates/rh-sim/src/cards/after_damage.rs`
- `crates/rh-sim/src/systems/melee.rs`, `crates/rh-sim/src/systems/projectiles.rs`
- `crates/rh-sim/src/systems/signatures.rs` (`BlockContact`, `LandedHit` only), `crates/rh-sim/src/systems/ledger.rs`
- test helpers that build `LandedHit` (`crates/rh-sim/src/systems/frost.rs`, `systems/regen.rs`, and any other the
  compiler names: on the reference port also `crates/rh-sim/src/systems/terrain/source_tests.rs` and
  `crates/rh-sim/src/fx_projector/tests.rs`, field additions only)
- `crates/rh-sim/src/schedule.rs` (row `cardHooks.onBlocked`), `crates/rh-parity/tests/schedule.rs`
  (`what_the_slice_has_ported_stays_ported`)

No `content!` constant, no content hash move (`b35f23ed00df75b3` stays). `LandedHit.passive/derived` and
`BlockContact.hooked` are per-tick scratch (`TickScratch`; `LandedHit` derives `Serialize` for reports, so the two new
fields are `serde(skip)`): no new state leaf, so `tests/hash_coverage.rs` gains nothing and `CHECKPOINT_FORMAT` (31),
`REPLAY_FORMAT` (25), `OBSERVATION_VERSION` (26), `PROTOCOL_VERSION` (17) and the policy contract (20) do not move.
If the implementer finds `LandedHit` reaching a hashed or checkpointed record, that is a stop-and-report, not a bump.

## 6. Contracts and references
C-TICK (the pending note is read by the existing card `after_damage` system row); C-RNG (no draw); `tests/no_alloc.rs`.

## 7. Behaviour to preserve
- The faction layer's use of block contacts (`signatures.rs`) sees the same contacts it saw in engagement worlds.
- Parity report all MATCH (the branch with all groups: all MATCH).

## 8. Acceptance checks
- `cargo test -p rh-sim --features trusted-status-probes --lib on_hit_salvage2`: all 10 pass (5 fail today, on
  assertions; 5 guards pass today and must keep passing). `on_hit_salvage_tests` (P-MECHANICS-SALVAGE-1) stays green.
- `cargo test -p rh-sim --features trusted-status-probes`; `cargo test -p rh-sim --features trusted-status-probes --test
  content`; `cargo test -p rh-parity --test schedule` (with `what_the_slice_has_ported_stays_ported` asserting the
  `cardHooks.onBlocked` row is `Ported`, no `pending`).
- `cargo run -p rh-parity --bin parity-report`: all MATCH, no fixture regenerated (stub: 109 slice scenarios + 13
  capture-only, 300 pathfinding queries, all MATCH).
- `scripts/gate.sh --oracle packet/P-MECHANICS-SALVAGE-2`.

### The oracle (`crates/rh-sim/src/cards/on_hit_salvage2_tests.rs`, rig as `on_hit_salvage_tests.rs`, abilities on with
no opening Wish lock so the holder can cast at once, as the card-runtime capture's config)

Wishful Thinking cuts 1000 ms per counted hit or Best Offense note; the scenarios stay far below the 30 s budget and the
half-cooldown floor (at most 7 s of a 150 s Holy Wish), so "trimmed" is exactly 1000 x the count. Block counts come from
`Event::Block` with the holder as `id` (the attacker exists throughout, so each ran the `blocked` hook).

| Test | Mechanic | Legacy number (worked) | Native today (assertion) |
|---|---|---|---|
| `a_sword_riposte_carries_the_holders_returned_mult` | #8 | riposte bleed 0.11256976744186048 x Boom `returned` 1.25 = 0.1407122093023256/s (`melee.ts:88`; `returned-eye-spike-no-recursion` tick 2, `bleed:2`) | 0.11256976744186048 |
| `a_riposte_is_no_weapon_hit_for_wishful_thinking_or_the_streak` | #5c | 7 sword blocks with ripostes, holder with Wishful Thinking only: 0 ms trimmed, no streak (`cardHooks.ts:291-293`) | 7000 ms |
| `best_offense_shield_bash_blocks_trim_the_wish_in_a_core_world` | #5b | shield bash = plain block (`interactions.ts:64`), Best Offense notes each: 1000 ms x 5 blocks = 5000 ms (`cardHooks.ts:206-214`, `:319-323`) | 0 ms (no contact in a core world) |
| `best_offense_sword_blocks_trim_once_each_in_a_faction_world` | #5b + #5c (trap 1) | 1000 ms per block, 0 per riposte: 7 blocks = 7000 ms (core capture 150100 -> 143100; the rule has no faction term) | 14000 ms (block + riposte) |
| `best_offense_counts_a_reflected_arrow_once_in_every_world` | #5b (reflected arrow) + #5c | core and full: 1000 ms per reflection (7), 0 for the returned arrow (`projectiles.ts:310`, `returnedFlag`) | core 7000 (right for the wrong reason); full 14000 |
| guard `guard_the_core_real_block_pending_case_trims_seven_seconds` | #5b + #5c together | `real-block-pending-best-pocket-tank-wish`: 7 blocks (ticks 2, 12, 22, 32, 42, 51, 61), `wishReadyAt` 150100 -> 143100 = 7000 ms | passes (riposte counted, block not: the two errors cancel); fixing only one half fails it |
| guard `guard_an_unblocked_weapon_hit_still_trims_the_wish` | a hit that is not blocked is unchanged | 1000 ms per unblocked sword hit (`cardHooks.ts:317`) | passes |
| guard `guard_eye_for_an_eye_spiked_shell_return_shreds_with_the_axe` | carried from SALVAGE-1 review (rule #7 on a Spiked Shell return) | axe in hand, Spiked Shell return names it (`cardHooks.ts:141`): shred `AXE_SHRED_ARMOR` 3 x k 1 = 3 (`onHit.ts:47-55`) | passes (group 1 landed it) |
| guard `guard_same_tick_block_and_riposte_bleeds_share_one_instance` | carried from SALVAGE-1 review (same-tick tag) | Best Offense block bleed 4.321875 + Eye riposte bleed 0.11256976744186048 in one `bleed:2` instance = 4.434444767441861/s (`fix/mechanics-sim:parity/card-onhit/source.json` `returned-eye-third-charm-not-counted`, tick 2) | passes (one instance, 4.4344) |

#8 must not move a holder without a `returned` mult (x1): the same-tick guard above and P-MECHANICS-SALVAGE-1's
`guard_eye_for_an_eye_plain_riposte_bleed_matches_the_capture` pin that.

Checked by the oracle author: applying the reference port (`git show 364c9dd0` hunks of `after_damage.rs`, `melee.rs`,
`projectiles.rs`, `ledger.rs`, the `LandedHit`/`BlockContact` fields of `signatures.rs`, the test helpers, plus the
riposte hunk of `6cdfbd68`) turns all 10 green; it was not committed.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/cards/on_hit_salvage2_tests.rs`
- `docs/backlog/packets/P-MECHANICS-SALVAGE-2.md`

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --lib on_hit_salvage`
- `cargo test -p rh-sim --features trusted-status-probes`; `cargo test -p rh-sim --features trusted-status-probes --test content`
- `cargo test -p rh-parity --test schedule`; `cargo run -p rh-parity --bin parity-report`
- `cargo clippy -p rh-sim --all-targets --all-features -- -D warnings`; `cargo fmt --all -- --check`
- `scripts/gate.sh --oracle packet/P-MECHANICS-SALVAGE-2`

## 10. Risk and suggested model tier
Opus: melee/projectile resolution and per-tick scratch shared with the faction layer; a contact recorded in a new world
must not change a faction-layer reader.

## 11. Known traps
- Before the branch the two errors (no core-world contacts; riposte counted as a weapon hit) cancelled in the core
  profile and double-counted in faction worlds: fix both together or a test will look right for the wrong reason.
- `pending` is cleared at raid start (`resetAll`, `cardHooks.ts:75-79`) and by `resetFight` (`:85-97`, `:96`); it is
  otherwise read and cleared by the same tick's `afterDamage` (`:319-323`), so per-tick scratch (`TickScratch.blocks`)
  is the faithful home: no state crosses a tick.
- Recording contacts in every world: the faction-layer readers of `s.blocks` (`signatures.rs`) must not start acting in
  worlds where `faction_mode.engagement()` is false (section 7). The reference port records `hooked` contacts always;
  check every reader of `blocks` gates on the faction layer itself.
- A twice-reflected arrow (`pr.launch.reflected`, weapon `shield`) is a `passive` contact; legacy still runs the hook for
  it (the reflecting holder is the shooter and exists), so Best Offense counts it. The native filter `!b.passive` drops
  it; the reference port counts `hooked` instead. Not covered by a test (two shields facing each other).
- A missing shooter (the archer left before the arrow arrived) runs no hook (`projectiles.ts:305`, `:310`): not counted.
  Not covered by a test.
- Rust's empty `f64` sum is `-0.0`; the tests compare with `==`, which treats it as `0.0`.

## Notes from previous attempts

## Carried from the review of P-MECHANICS-SALVAGE-1 (2026-11-12, MINOR)
- One loose test for an Eye for an Eye holder with an axe whose Spiked Shell return shreds the attacker by
  `AXE_SHRED_ARMOR` (k = 1): rule #7 on a Spiked Shell return, which the first packet's oracle does not cover.
- The same-tick case: Best Offense, Eye for an Eye and Hemorrhage with a sword riposte in one tick share the tag
  `bleed:<tick>`, so the block bleed and the riposte bleed add into one instance (legacy 4.434): pin it here, with the
  riposte multiplier this packet owns.
- Both are pinned in the oracle as guards (`guard_eye_for_an_eye_spiked_shell_return_shreds_with_the_axe`,
  `guard_same_tick_block_and_riposte_bleeds_share_one_instance`); both pass on the integration branch today. The
  same-tick case's legacy number has a x1 holder (no Boom): no legacy number exists for the same-tick sum with Boom.
- Evidence note: the parity report's "all MATCH" covers only the plain axe path (`axe_shred_stack`); the four on-hit
  rules of the first packet are evidenced by its loose tests only.
