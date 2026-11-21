# P-AUG-NATIVE-2: Calluses, Executioner's Ledger and Eighth Strike (weapon batch, live world only)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3), under the owner's 2026-11-18 approval of the elite and
  augment rework (`docs/OWNER_DECISIONS.md:12`, row "Elite and augment rework": augments "Plus 13 new"; plan of record
  `docs/backlog/AUGMENT_ELITE_REWORK.md`: packet row P-AUG-NATIVE-2, decision 3 "Eighth Strike", Appendix A rows
  "Calluses", "Executioner's Ledger", "Tenth Strike", and the coordinator note "P-AUG-NATIVE-1b and the batches").
- **Implementer tier:** implementer-sonnet (one batch table plus the stat-fold seam; the hooks exist since 1b)
- **Reviewer:** reviewer (Sonnet); reviewer-opus if the implementer changes the fold beyond the one native term
- **Integration base:** `coord/int-67` @ d837d7652. Gate runs take `--base coord/int-67`.
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): one test per card shows its numbers match the
  workbook through the real hooks; a native-free Rework world stays byte-identical (1b's digest test) · D2 n/a ·
  D5/D6/D9 none (no wire; readout rows are produced sim-side, P-WIRE19-B carries them).
- **OWNER_DECISIONS:** searched for Calluses, Ledger, Tenth/Eighth Strike: no row beyond the rework row (line 12). Decision 3
  of the plan (8th hit, rename) is the plan's own and is kept.

## 1. ID and outcome

P-AUG-NATIVE-1b gave the 13 hooks, the batch tables and two exemplars. This packet fills `cards/native/weapon.rs` with
the three remaining weapon cards. When it lands, a Rework holder gets:

1. **Calluses** (workbook Augment_Tuning: "0.05 armor per fist hit, cap 25" becomes **0.07, cap 30**; alignment fists):
   each `NativeEvent::FistHit` adds `REWORK_CALLUSES_PER` (0.07) to `counter`, `min(REWORK_CALLUSES_CAP, ...)`.
   The counter is armor: it joins the holder's `armor_bonus` in `modifiers::recompute` (so `mirrors().armor_bonus`, the
   HUD defense and every mitigation read it; the mirror is wire-rounded to 0.1, `flat_wire_per_point` 10), and a Holy
   holder takes `(1 + 78/100) / (1 + (78 + armor)/100)` of a Holy physical hit (`content::mitigate_shares`).
2. **Executioner's Ledger** (workbook "+1 AD per player/elite kill" becomes **+3 AD per player or elite kill only, cap
   30**; alignment axe, sword): each `NativeEvent::CreditedKill { player, elite }` with `player || elite` adds
   `REWORK_EXECUTIONERS_LEDGER_PER` (3) to `counter`, `min(REWORK_EXECUTIONERS_LEDGER_CAP, ...)`. A normal mob kill
   (`player: false, elite: false`) adds nothing. The counter is AD: it joins `ad_bonus` (mirror, 0.1 resolution).
3. **Eighth Strike** (decision 3: "every 8th hit doubles", renamed from Tenth Strike; the workbook number is 8):
   `counter` is the hits since the last doubled hit, 0..=7 (1a's cap `REWORK_EIGHTH_STRIKE_EVERY - 1`). The holder's
   landed weapon hit (the `HitCount` events, `passive: false`) that is the 8th, 16th, ... deals
   `REWORK_EIGHTH_STRIKE_MULT` (2) times the amount it would have dealt; every other hit is unchanged. After each
   landed hit `counter = (counter + 1) mod 8`. The doubling is in the hit itself (the `Event::Hit` amount and the
   victim's hp), so it is decided BEFORE the hit's `HitCount` hook advances the count, like Bastion's burst
   (`landed_burst`/`Bursts`, `systems/ledger.rs:724-740`, before the PvP hit cap at `:741`, which at 0.35 of max hp
   does not bind a doubled sword hit).
4. **Exact `check` rules** (coordinator note, plan "P-AUG-NATIVE-1b and the batches"; `cards::native::check`, after
   the cap test): Eighth Strike's counter is an integer (3.5 refused); Executioner's Ledger's counter is a whole
   multiple of `PER` (1.5 refused); Calluses' counter is the cap or a whole multiple of `PER` within 1e-9 (0.035
   refused; repeated addition of 0.07 drifts by about 1e-14 and must be accepted). Cap and sign rules stay as in 1a.
5. **Readouts and pool.** `weapon::readouts`: `(card, Counter, counter, rule cap)` for each of the three (1b's
   `Source::Counter`). `weapon::POOL` lists them as `Offer::Any` (membership only; no pool reads it: admission is not this
   packet's).
6. **No new state, no format bump.** The slots are 1a's. `CHECKPOINT_FORMAT`, `REPLAY_FORMAT`, `OBSERVATION_VERSION`
   stay. The content hash moves only if the batch folds new rows; then through `scripts/regolden-content.sh`.

## 2. Dependencies
- P-AUG-NATIVE-1a, 1b, P-WIRE19-A (all in `coord/int-67`).
- Parallel: P-AUG-NATIVE-3 (zone table `cards/native/zone.rs`) and P-WIRE19-B (`observe.rs`, protocol). Keep out of
  their files. `cards/native/mod.rs` is shared with NATIVE-3: edit only the lines for your three cards (the `check`
  arms; NATIVE-3 adds its own) so the two merge.

## 3. Relevant legacy paths
The cards are new (no legacy implementation: owner-approved additions). Legacy the pieces sit beside:
- `packages/server/src/sim/ledger.ts:370-395` `hitLanded` (after the victim took the damage): Rust
  `systems/ledger.rs:963` and the 1b native block at `:995-1019`.
- Kill credit: Rust `systems/credit.rs:40` `credit_kill`, `systems/mob_life.rs:599` (`CreditedKill { player, elite }`,
  1b); "killer" is the credited killer (plan decision 6, `mob_life.rs:243-252`).
- Armor law: `content.rs:163` `mitigate_shares` (legacy `mitigateShares`); armor and AD bonus live in the stat-fold
  mirror (`stat_fold/mirror.rs`, `ArmorBonus`, `AdBonus`); kill-stat AD (`kill_augments.rs`) is the existing producer.
- Same-tick: a count earned by a hit is not in that hit (the hook fires after the amount); the doubled hit is the one
  whose count BEFORE it is 7.
- RNG: none of the three draws. Adding a draw is a parity defect.
- Workbook `docs/quests/FUTURE_ONLY_Quest_Design_Discussion.xlsx` Augment_Tuning rows for the three cards; their numbers
  are already registered rows (1a): `REWORK_CALLUSES_PER/CAP`, `REWORK_EXECUTIONERS_LEDGER_PER/CAP`,
  `REWORK_EIGHTH_STRIKE_EVERY/MULT` (`constants.rs:607-617`).

## 4. Existing tests that pin what this packet touches
- `hooks_tests::the_batch_tables_hold_their_own_cards_and_no_pool_offers_them_yet`: the weapon table may hold the five
  weapon cards, no card is in two tables, nothing reads `POOL` into `Tuning::pool`. Stays green; no conflict.
- `tests/native_cards.rs`: caps by name (`the_native_numbers_are_the_workbooks_registered_rows_and_the_caps_read_them`),
  `check_world_refuses_native_state_outside_its_caps_and_shapes` (Calluses at counter 0 and -1 only),
  `a_rework_checkpoint_with_native_cards_restores_hash_exact_and_plays_on` (Tally, Hazard Walker, Stoked). None
  conflicts with the new rules.
- `hooks_tests::a_rework_world_without_native_cards_plays_as_on_the_base`: the native-free Rework digest. Stays green.
- 1b's `exemplars_tests` (Tally, Bastion): unchanged behaviour.
- `tests/content.rs`, `tests/native_no_alloc.rs`: statics audit and zero allocation; keep green.
No oracle-amend is needed; no conflict goes to the coordinator.

## 5. New paths
None required. Likely: arms in `weapon.rs` `handle` and `readouts`, a doubling seam beside `landed_burst`, a native
armor/AD term in `modifiers::recompute_core` (`outgoing_share` is the pattern), and `check` arms in `native/mod.rs`.

## 6. Exclusive write scope
- `crates/rh-sim/src/cards/native/weapon.rs` (handlers, readouts, doubling term).
- `crates/rh-sim/src/cards/native/mod.rs`: the `check` arms for the three cards and the seam functions only.
- `crates/rh-sim/src/cards/native/table.rs`: the three cards' rows only if a cap changes (none expected).
- `crates/rh-sim/src/systems/ledger.rs`: the doubling term beside Bastion's burst (a helper call only).
- `crates/rh-sim/src/modifiers/mod.rs`: the native armor/AD term in the fold inputs; `maximum_packet` only if a card
  bakes damage into a packet (none should).
- `crates/rh-sim/src/constants.rs`: appended `REWORK_*` rows only if a number is missing (none expected).
- `crates/rh-sim/tests/content.rs`: `NON_GAMEPLAY` / folded-table entries; `GOLDEN_CONTENT_HASH` only by the script.
- The content-hash copies through `scripts/regolden-content.sh` only (if the hash moves).
- `docs/agent/AUGMENT_REWORK.md`: a short "Weapon batch" list.
Nothing in `zone.rs`, `faction.rs`, `observe.rs`, `rh-protocol`, `rh-server`, `schedule.rs`, `client-unity/`.

## 7. Behaviour to preserve
- Legacy world and a native-free Rework world: byte-identical (1b digest; 1a legacy digest).
- Marksman's Tally and Bastion as 1b pinned them.
- Observations of a holder equal a non-holder's (1a); no pool or chest offers a native card.
- Zero allocations per step.

## 8. Acceptance checks
- `cargo test -p rh-sim --features trusted-status-probes --lib cards::native` green.
- `cargo test -p rh-sim --test native_cards --test native_no_alloc --test content --test hash_coverage`.
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-2 --base coord/int-67` (add `--allow-artefacts --regen-fixtures`
  only if the content hash moved).

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/cards/native/weapon_batch_tests.rs`
- `docs/backlog/packets/P-AUG-NATIVE-2.md` (this brief)

Stub (`stub:` commit): the `#[cfg(test)] mod weapon_batch_tests;` line in `cards/native/mod.rs`. Nothing else is
stubbed: the tests use existing APIs only (`hooks::fire`, `NativeEvent`, `modifiers::recompute`, `mirrors()`,
`weapon::POOL`).

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --lib cards::native::weapon_batch_tests`
- the acceptance list above.

## 10. Risk and suggested model tier
implementer-sonnet. Risks: the doubling must sit before the PvP cap and double a hit once; armor and AD must reach the
fold so the mirrors move (a direct mitigation read would leave `mirrors()` and the HUD stale); the check rules must
accept real accumulated floats.

## 11. Known traps
- Hook order: `HitCount` fires after the amount; the 8th-hit decision reads the count BEFORE it (7 means this hit doubles).
- A multi-body swing: each body is a hit and advances the count once; the doubling is per hit.
- The holder holds a native card in BOTH arms of an oracle comparison: `power()` counts native tiers and feeds
  `pvp_factor`, so the reference arm holds Pathfinder (no weapon behaviour).
- Mirrors refold when a counter changes (the oracle reads them a few ticks after the event).
- Do not credit a normal-mob kill to the Ledger; `elite` and `player` are separate flags.

## Pinned quirks to flag
- Mirrors round to 0.1: a Calluses counter of 0.21 reads 0.2 on `armor_bonus`; the counter itself stays exact.
- AD has no direct weapon-hit term in this sim (it feeds Fire burst, plague zombies, scale rows and the HUD offense):
  the Ledger's proof is the `ad_bonus` mirror and the counter, not a weapon-hit delta.
- The elite and normal-mob kill cases are proved by firing `CreditedKill` through `hooks::fire` (staging a mob kill needs
  the whole mob world); the player-kill case runs through real play, and 1b pinned the call sites.

## Notes from previous attempts
<!-- Coordinator appends on escalation. -->
