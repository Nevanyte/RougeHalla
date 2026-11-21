# P-AUG-NATIVE-3b-fix: the Wish owner view counts charges from the stock clocks' own cooldown

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3), as P-AUG-NATIVE-3b does (owner approval 2026-11-18,
  `docs/OWNER_DECISIONS.md:12`, row "Elite and augment rework"). A `-fix` packet for reviewer-opus note 1 on
  P-AUG-NATIVE-3b (LAND WITH NOTES).
- **Implementer tier:** implementer-opus (rh-sim owner view read by the observation and the bots).
- **Reviewer:** reviewer-opus.
- **Integration base:** stacked on the unmerged `agent/opus/P-AUG-NATIVE-3b` @ `1966ae491` (on integration 68).
  `docs/agent/LANES.md` "Stacked packets": every gate run takes `--base agent/opus/P-AUG-NATIVE-3b`.
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): the view is checked against the stock clocks the
  server itself accepts casts by · D2 n/a · D5/D6/D9 none (no wire, observation-format, checkpoint or hash change; the
  owner view's fields and their encoding are unchanged; only the values of `charges` and `next_charge_at` for a player
  whose Wish cooldown moved after a spend).

## 1. ID and outcome
`OwnerView::of` (`crates/rh-sim/src/abilities/mod.rs:572-597` on the base) computes `charges` and `next_charge_at` from
`recharge_ms`, the cooldown the *next* cast will spend (`cooldown(.., wish_mult(p))`), but the stock clocks
(`wish_full_at`, `wish_ready_at`) were built by `spend_charge` from the cooldown the *last* spend used
(`crates/rh-sim/src/systems/abilities/mod.rs:158-177`, recorded as `card_runtime.wish_cast`). Once Wish Engine's share
steps on landing (or Arcane Overload is granted mid-recharge) the two differ and the view lies:
- Fire holder, first cast at t1 (row 30000): full = t1+30000, ready = t1; after landing `recharge_ms` = 29250, so the
  view shows 0/2 and `next_charge_at` = t1+750 while the server accepts the second charge. The HUD
  (`client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Legacy.cs:542`, `WishFxModel.cs:236`) and the bots read it.
  Measured on the base: one tick after landing (t=150, cast at t=100) the view is `charges 0, next_charge_at 850`.
- Single-charge holders right after landing: `next_charge_at` = full - next cooldown (Frost measured: 1787 against a
  real 45100; Plague, Holy, Sentenced likewise).
- Fire casting its two charges back to back (Blaze lands in the same tick, so the second cast is 50 ms after the
  first, at the stepped cooldown 29250): full = t1+30000+29250, ready = t1+30000. Even with the last spend's cooldown,
  `next_charge_at(full, now, 29250)` gives missing = 3 > max and returns t1+750; the true next charge is `ready`.
  **The reviewer's suggested fix (pass `wish_cast.cooldown_ms` to `charges_at`/`next_charge_at`) is necessary but not
  sufficient**: measured with that change applied, three oracle tests go green and the Arcane-Overload test stays red
  on the holder at t=150 (`(0, Some(850))` against `(0, Some(30100))`). Clamping the missing count to `max_charges`
  (equivalently: no charge up → the next charge is `wish_ready_at`; one of two up → `wish_full_at`) makes all four
  green (checked on a scratch copy, then reverted).

When this lands: on every tick the view shows `charges` equal to what the server accepts (`wish_ready_at <= now` is one
charge, `wish_full_at <= now` all), `next_charge_at` equal to the real clock (`wish_ready_at` with none up,
`wish_full_at` with one of two up), `recharge_ms` still the next cast's cooldown, and a player whose cooldown did not
move after its spend sees exactly the base view.

## 2. Dependencies
`agent/opus/P-AUG-NATIVE-3b` (Wish Engine, `wish_mult`, `card_runtime.wish_cast` written on every Wish spend).

## 3. Relevant legacy paths
- `packages/shared/src/abilities.ts:296-299` `chargesAt`, `:308-313` `nextChargeAt`: the same formulas as Rust's
  `charges_at`/`next_charge_at` (`crates/rh-sim/src/abilities/mod.rs:523-539`).
- `packages/client/src/ui/abilitySlot.ts:93-100`: legacy's slot recomputes `recharge` from the *current*
  `wishCooldownMult` and feeds it to `chargesAt`/`nextChargeAt`. So legacy has the latent Arcane-Overload case too
  (a Fire player granted Arcane Overload while both charges recharge sees one charge back early). Legacy has no Wish
  Engine (a Rework native card), so the holder cases have no legacy counterpart.
- No `docs/OWNER_DECISIONS.md` row names the Wish owner view or charge display; row 12 (the rework) covers Wish Engine.

**Flag (legacy display difference):** the non-holder Arcane-Overload-mid-recharge case deviates from legacy's
client display (`abilitySlot.ts:96-99`); it is display only (the server's acceptance, `readyAt`, is unchanged and
matches legacy). The coordinator asked for the true count; proposed `DEVIATIONS.md` row in the hand-off.

## 4. New paths
- none for the implementer (the oracle file below is new on `packet/P-AUG-NATIVE-3b-fix`).

## 5. Exclusive write scope
- `crates/rh-sim/src/abilities/mod.rs`: `OwnerView::of` only. `charges_at`, `spend_charge` and `next_charge_at` keep
  their signatures and results (they mirror legacy and are read by `owner_view_tests.rs` and the cast system).

## 6. Contracts and references
- C-OBS (the owner view goes only to its owner), C-TICK, C-PARITY (existing fixtures stay green: none holds a lever
  change mid-recharge), ADR 0008/D9 (Unity only displays the view).

## 7. Behaviour to preserve
- `recharge_ms` is the next cast's cooldown (pinned by `wish_engine_tests.rs` `view_recharge_ms` asserts).
- A player with no cooldown change after its last spend (every Legacy player, every Rework non-holder without a
  mid-recharge Arcane Overload grant) gets a byte-identical view (`a_non_holder_s_owner_view_is_byte_equal_to_the_base`).
- The pre-raid `fullAt ?? 0` fallback, the opening Wish lock in `ready_at`, training's 5 s cooldown
  (`crates/rh-sim/src/abilities/owner_view_tests.rs`).
- No state, checkpoint, hash, wire, observation-version or content change; no RNG draw.

Existing tests that pin what this changes (all must stay green, none is amended):
- `crates/rh-sim/src/abilities/owner_view_tests.rs`: `absent_full_clock_uses_the_legacy_zero_fallback` (full_at None
  → max charges), `blaze_partial_and_empty_stocks_use_canonical_deadlines` (Blaze 1/2 and 0/2 deadlines with a constant
  cooldown), `training_uses_canonical_five_second_wish_cooldown`, `opening_lock_deadlines_remain_in_the_owner_view`,
  `matches_additive_legacy_stock_helpers_and_slot_display_capture` (the helpers against legacy's slot capture). These
  build players with no `card_runtime`; the fix's fallback for a player with no recorded spend must keep them.
- `crates/rh-sim/src/cards/native/wish_engine_tests.rs`: `view_recharge_ms == spend.cooldown_ms` before each cast.
- `crates/rh-sim/src/observe.rs:818` embeds the view; `crates/rh-policy/src/bots/wish_module_tests.rs` and the protocol
  wish-barrier tests read it from scenarios without Wish Engine (unchanged by the byte-equality above).

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-3b-fix --base agent/opus/P-AUG-NATIVE-3b` passes; the four
  tests in the oracle file are green.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/cards/native/wish_engine_view_tests.rs`
- `docs/backlog/packets/P-AUG-NATIVE-3b-fix.md`

Stub commit (compile-only): the `mod wish_engine_view_tests;` line in `crates/rh-sim/src/cards/native/mod.rs`, and
`crates/rh-sim/src/cards/native/wish_engine_tests.rs` helpers `world_of`, `world`,
`give`, `share`, `spend`, `in_flight`, `row_cooldown`, `step_of`, `wish_raw` widened from private to `pub(super)`
(no expectation changed).

Red on the stub (each an assertion failure):
- `a_fire_holder_shows_its_second_charge_one_tick_after_the_first_cast_lands`: charges 0, want 1 (view
  `next_charge_at` 850 against full 30100).
- `single_charge_holders_show_their_real_full_clock_after_landing`: Frost `next_charge_at` 1787, want 45100.
- `fire_with_arcane_overload_granted_mid_recharge_shows_the_true_charge_count`: non-holder after the grant shows next
  15100, want 30100 (and the holder shows next 850, want 30100, which the suggested fix alone leaves red).
Green guard: `a_non_holder_s_owner_view_is_byte_equal_to_the_base` (Legacy and Rework non-holders, all five factions,
three casts, every tick).

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p rh-sim --lib wish_engine`
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-3b-fix --base agent/opus/P-AUG-NATIVE-3b`

## 10. Risk and suggested model tier
Opus: a small change in a view the bots and HUD read every tick; the trap is the back-to-back Fire spend at two
different cooldowns (a mixed full clock), where the missing count exceeds `max_charges`.

## 11. Known traps
- Fire's two spends can carry two cooldowns (30000 then 29250, 50 ms apart): neither cooldown alone describes
  `full - now`; read the count off `wish_ready_at`/`wish_full_at` or clamp.
- `card_runtime` is `None` before a player's first Wish (and after `cards::runtime::reset_player` clears it): fall back
  to `recharge_ms`, which then equals the clocks' cooldown.
- Wishful Thinking trims (`cards::wishful_thinking`) move the clocks; the oracle does not exercise them, so do not assume a cooldown-derived count survives them.
- The opening Wish lock lives in `wish_ready_at`, not `wish_full_at`; `ready_at` is copied unchanged.

## Notes from previous attempts
