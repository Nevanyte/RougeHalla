# P-AUG-TUNE-1: Wishful Thinking's Rework rule (1.5% of the full cooldown a hit, at most 20% a window), live world only

- **Serves:** the owner's elite and augment rework approval of 2026-11-18 (`docs/backlog/AUGMENT_ELITE_REWORK.md`, the
  P-AUG-TUNE-1 row and Appendix A's Wishful Thinking row; content-hash move 4, accepted by the coordinator).
- **Implementer tier:** implementer-sonnet implementer-opus (coordinator routing, 2026-11-19: the restore bound must hold across a Wish cooldown that changes between casts; see section 10)
- **Reviewer:** reviewer-opus
- **Integration base:** `coord/int-62` @ `5aaadea74` (`feature/unity-rework` + P-ELITE-BENCH-1, P-AUG-CONTENT-1-fix, P-AUG-POOL-1)
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10); D2 n/a; D5/D6/D9 none (no wire; text-only client
  change). Legacy is unchanged and byte-identical.

## 1. ID and outcome

Under `AugmentRule::Rework` each hit you land shortens your Wish's cooldown by 1.5% of its full length, and a rolling
window may cut at most 20% of the full length. Legacy keeps 1 s a hit and 30 s a window. "Full length" is
`WishSpend::cooldown_ms`: the cooldown the Wish was cast with, after every cooldown multiplier (Arcane Overload's
included). It is the same value `abilities/checkpoint.rs` already validates against `cooldown(wish, training, mult)`, so
the restore bound can read it without new state. Window and floor keep their legacy meaning (below).

## 2. Dependencies

`coord/int-62` @ `5aaadea74` (P-AUG-RULES-1, P-AUG-CONTENT-1, P-AUG-UI-1, Plant, ELITE-BENCH-1, the CONTENT-1 guard and P-AUG-POOL-1 merged). If the coordinator adds fix
commits, merge them in.

## 3. Relevant legacy paths

- `packages/server/src/sim/cardHooks.ts:367-388` `wishfulThinking`: sums the owner's `hit` `cooldown` trigger rows
  (`:371`); returns without a cast or a running clock (`:379`); drops trims with `now - t.at >= WISHFUL_WINDOW_MS`
  (`:380`, a ROLLING window, exclusive: a trim exactly 60 s old is gone); `used` is the sum of the trims left (`:381`);
  `floorAt = max(now, cast.at + WISHFUL_FLOOR_SHARE * cast.cooldownMs)` (`:382`); `cut = min(n*ms, BUDGET - used,
  clockEnd - floorAt)` (`:383`); a cut cuts `wishReadyAt` only while on cooldown, and always `wishFullAt` (`:385-386`);
  records `{at: now, ms: cut}` (`:387`). `n` is the hits of the tick (`:329`).
- `packages/shared/src/constants.ts:278-280` (`WISHFUL_BUDGET_MS` 30000, `WISHFUL_WINDOW_MS` 60000,
  `WISHFUL_FLOOR_SHARE` 0.5).
- Rust: `cards/mod.rs:229-269` `wishful_thinking`; `cards/after_damage.rs:62-101` (caller; `wish_ms` is the sum of the
  card's trigger rows, 1000 for the flag row); `abilities/checkpoint.rs:19-46` (`trim_trace_coherent`, `max_trim_cut`,
  legacy `WISHFUL_BUDGET_MS` / `WISHFUL_WINDOW_MS`) and `:127-182` (where they gate the restore).
- Owner decisions: `docs/OWNER_DECISIONS.md` row 2026-11-18 (the rework, live world only); nothing narrower on Wishful.

## 4. New paths

None outside the oracle files. Registry rows `REWORK_WISHFUL_HIT_SHARE` and `REWORK_WISHFUL_BUDGET_SHARE`.

## 5. Exclusive write scope

- `crates/rh-sim/src/constants.rs` (append after the last REWORK row, `REWORK_EYE_FOR_AN_EYE_WEIGHT` on int-62, adjacent and in this order:
  `REWORK_WISHFUL_HIT_SHARE: f64 = 0.015, "share"; REWORK_WISHFUL_BUDGET_SHARE: f64 = 0.20, "share";`)
- `crates/rh-sim/src/cards/tuning.rs` (REWORK table points `wishful_hit_share` / `wishful_budget_share` at them;
  LEGACY keeps `0.` = the millisecond rule, so its arithmetic is untouched)
- `crates/rh-sim/src/cards/rework_overrides.rs` (Wishful's text-only row, in `CardId` order: copy the catalog block
  unchanged, change only `text`)
- `crates/rh-sim/src/cards/mod.rs` (`wishful_thinking`, the non-test code only) and `cards/after_damage.rs` if the call
  needs it
- `crates/rh-sim/src/abilities/checkpoint.rs` (the trim bound; takes the rule's numbers from `k.cards`)
- the content-hash copies, by `scripts/regolden-content.sh` only (six copies; the `hash-tape.json` `contentHash` line
  trips the gate's oracle-capture stop and the coordinator waives that one line)
- `client-unity/UnityProject/Assets/Scripts/UI/CardDisplayCatalog.cs`, line 80 (the Wishful entry, index 64): back to
  UI-1's text, "Each hit you land shortens your Wish's cooldown by 1.5% of its full length (at most 20% a minute)."
- Gate flags: `--allow-artefacts`, and `--regen-fixtures` for the `contentHash` lines.

## 6. Contracts and references

C-TICK (no tick-order change), C-NUM, `docs/agent/AUGMENT_REWORK.md` ("Changing a named number", "Moving the content
hash"): register the number by name, point the `REWORK` field at it, never branch on the rule in game code, move the
checkpoint bound with it.

## 7. Behaviour to preserve

- Legacy: byte-identical (existing `cards::wishful_tests`, `on_hit_salvage2_*`, the frozen source corpus, hash tape).
- Draw order: no RNG involved. Stays: the window is rolling and exclusive (`now - at < window`), the floor is
  `max(now, cast.at + 0.5 * cast.cooldown_ms)` and means the same under Rework, a charged Wish's `wish_full_at` shifts
  with the cut, a refused cut records no trim. "Same for every faction": the share reads the cast's own cooldown, so a
  two-charge Wish is cut by the same percentage.
- Order of operations (answers "after the multipliers"): the share multiplies `cast.cooldown_ms`, which already has the
  multipliers (Arcane Overload's) in it. Flat 1 s `ms` of the card row is ignored under Rework (the row stays the flag
  row, like Gambler, Third Time and Plant).

## 8. Acceptance checks

- `scripts/gate.sh --quick --oracle packet/P-AUG-TUNE-1`; the six content-hash copies regenerated by
  `scripts/regolden-content.sh`.
- The Unity mirror test (`BuildDrawerEditModeTests.cs`) passes with no edit: it reads `rework_overrides.rs` and the C#
  catalog and needs the same text on both sides.

## Oracle files (read-only for implementers)

- `crates/rh-sim/src/cards/wishful_rework_tests.rs` (numbers, text-only override, cut share, budget, rolling window,
  floor and charge clock, Legacy)
- `crates/rh-sim/src/abilities/source_tests/wishful_rework_restore_tests.rs` (the restore bound, both rules, a played Rework
  world, a cooldown that lengthens between casts)
- `client-unity/RoguehallaNet.Tests/CardDisplayReworkTests.cs` (the Wishful row back in `Retuned`: "1.5%", "full",
  "20%" present, "1 s", "30 s" absent; rest count `80 - 22`; digest `5cc91496...56a4d0`). This reverts the test half of
  coordinator commit `08bbb1405`; it fails until the catalog line is restored.
- `crates/rh-sim/src/cards/rework_content_tests.rs`: `oracle-amend` commit, one edit to P-AUG-CONTENT-1's tests (for
  the owner): `legacy_is_unchanged_and_unlisted_cards_keep_their_catalog_rows` skips the Wishful row's `text` (its
  rows are still asserted equal to the catalog's). Appends no longer break the registry-run test (373b919fe).
- `crates/rh-sim/src/cards/rework_guard_tests.rs` (P-AUG-CONTENT-1-fix, existing, read-only): every number an override
  row changes must bit-equal a `REWORK_*` registry value. Wishful's override is text-only, so it passes; a bare literal
  in the row would fail it.

Stub commit (the implementer replaces the zeros): `CardNumbers::wishful_hit_share` and `wishful_budget_share`
(`tuning.rs`, both tables `0.` = legacy ms path), the two `mod` lines, `setup.rs` reading `config.augments: "rework"`
(test-only), two compile lines in `tuning_tests.rs`.

## Existing tests that pin what this changes

- `cards/mod.rs` `wishful_tests::wishful_thinking_trims_with_the_source_caps`: Legacy numbers, 1 s, 30 s budget, floor,
  rolling window. Keeps passing (signature unchanged; Legacy path unchanged).
- `abilities/source_tests/mod.rs` `card_producer_checkpoint_states_restore_and_reject_malformed_producers`: a Legacy
  trim of `WISHFUL_BUDGET_MS + 1` is refused. Keeps passing.
- `cards/on_hit_salvage2_tests.rs` (Wishful counts per hit, ripostes not): Legacy worlds, unchanged.
- `cards/rework_content_tests.rs`: the two edits above (oracle-amend).
- `tests/content.rs`: new registry rows are hashed; no `NON_GAMEPLAY` entry needed.
- `tests/hash_coverage.rs` (`card_trims`): no new serialized field is expected.

## 9. Validation commands

`cargo test -p rh-sim --lib wishful`; `scripts/gate.sh --quick --oracle packet/P-AUG-TUNE-1 --allow-artefacts
--regen-fixtures`.

## 10. Risk and suggested model tier

Opus, `reviewer-opus`. The restore bound is the risk. The oracle pins the cap (20% of the cast's full cooldown, per trim
and per window sum) and that a Wish cooldown which LENGTHENS between casts inside the 60 s window restores
(`a_cooldown_that_lengthens_between_casts_restores_in_both_worlds`: Wishful trims under the short cooldown, Arcane
Overload taken, a second cast under the long one). Finding on the other direction (a cooldown that SHORTENS): no
reachable lever. `WishCooldown` multipliers come only from Arcane Overload and only lengthen; no card is removed alone;
the training console's `clear` and a raid start both clear `card_trims` (`cards/runtime.rs:31-52`). So a bound that reads
only the current cast's `cooldown_ms` is sound for every reachable state; a bound that reads a stale, shorter cooldown
is not. No new serialized field is needed for this. Do not weaken the cap tests. If a per-trim cooldown record seems
needed after all, that is a format bump (`CHECKPOINT_FORMAT`, hash, restore) and goes back to the coordinator.

### Folded-in defect: a Wish spend refused after a grant (coordinator, 2026-11-19)

After a card grant changes the Wish cooldown multiplier (a chest pick of Arcane Overload while the Wish cools down is
ordinary play) and before the next cast, `validate` refuses the checkpoint with `invalid card Wish spend`. Cause:
`abilities/checkpoint.rs:75-89` requires the stored `wish_cast.cooldown_ms` to equal `cooldown(wish(faction), training,
Some(p.modifiers.wish_cooldown_mult()))` recomputed NOW, but the stored value is what the cast was spent with, under the
multiplier of that moment. Oracle: `a_grant_between_a_cast_and_the_next_cast_checkpoints_and_plays_on_in_both_worlds`
(Legacy and Rework: cast, grant Arcane Overload, checkpoint before the next cast; it must restore, hash equal, and play
equal through the next cast). It is red today with the restore refusal.

Write scope: the validation that refuses, `abilities/checkpoint.rs:80-86` (the spend check), and every other place that
recomputes the cooldown from the current multiplier and compares it with stored clocks (`:121-126` `recharge`,
`:257-283`), because the stock equations (`full_at == spend.at + recharge`, the charge lattice) use the same
recomputed value and will refuse the same state. The fix must keep refusing a genuinely forged Wish spend: a cooldown
no multiplier the build could have held produces (zero, non-integer, past the largest the faction's Wish can have), an
`at` off the tick lattice or before the first cast, a nulled spend with stocks that need it. Existing forged-spend
tests that must stay green: `abilities/source_tests/repair_tests.rs:33` (`cooldown_ms` 150001 on a completed spend),
`cards/fight_clock_tests.rs:635` (cooldown 0, `at` 99, nulled spend). Keep at least one of them.
Do not paper over it by dropping the check.

## 11. Known traps

- `ms` passed to `wishful_thinking` is 1000 under both rules (flag row): under Rework do not use it.
- The shared `trims` Vec mixes cuts from earlier casts; the budget is shared (legacy `:381`).
- Legacy must keep its exact float arithmetic (`n * ms`, `BUDGET - used`); Rework's `0.015 * cd` times `n`: the oracle
  uses exact values with 40 000, 60 000 (600, 900, 1800, 8 000), so compute `n * (share * cd)` or `share * cd * n`
  and check it prints those exactly.
- `REGISTRY` tail order is asserted; the `scripts/regolden-content.sh` run moves content hash `abed1bee9a62b4f8` (move 6; POOL-1 was move 5).
- `a_played_rework_world...` reads the Rework cooldown from the played state (45 000 there; Legacy plays 60 000 in the
  same case), so do not copy a constant into the test.

## Notes from previous attempts
