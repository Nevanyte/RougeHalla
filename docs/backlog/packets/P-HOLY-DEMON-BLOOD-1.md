# P-HOLY-DEMON-BLOOD-1: Holy gains lifesteal per camp cleared, as legacy

- **Serves:** ORDER_OF_OPERATIONS phase 2, items 13-14 (mechanic port under C-PARITY); closes DEV-012
- **Implementer tier:** implementer-opus
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 exact actual-source capture (pinned linux/amd64 Node 22.23.4 image), compared at
  `rh_parity::TOL` 2e-6 · D2 n/a (legacy behaviour; closes DEV-012) · D5/D6/D9 none

## 1. ID and outcome
Legacy adds `holyCampLifestealOf(campClears)` (0.005 per eligible camp clear) to a Holy player's lifesteal. The Rust sim
counts camp clears (`Player.camps_cleared`, `crates/rh-sim/src/state.rs:593`) but never applies them, so a Holy player
who farms heals less than in the live game, and the server's build marks omit the term (DEV-012). When this lands Rust
applies the passive where legacy does, the build marks include it, and DEV-012's exception is gone.

## 2. Dependencies
none

## 3. Relevant legacy paths (verified by the oracle author)
- `packages/shared/src/constants.ts:81`: `HOLY_CAMP_LIFESTEAL_PER_CLEAR = 0.005`.
- `packages/shared/src/championPassives.ts:6-9`: `holyCampLifestealOf(n)` = `max(0, floor(n)) * 0.005`, 0 for a
  non-finite n. **No upper bound** (`holyCampLifestealOf(1000) === 5`, `packages/shared/test/championPassives.test.ts:10`).
  For the Rust `u16` count it is exactly `f64::from(n) * 0.005` (the same single JS multiplication).
- Which clears count ("eligible"): `packages/server/src/sim/campHeal.ts:84-97` (`payCampHeal`, the `campCleared` link):
  every contributor (a player whose hit took hp off a camp member, `noteCampContributors`, `campHeal.ts:13-27`) who is
  standing and inside the camp's territory or within `CAMP_HEAL_RANGE` (12 tiles) of its centre (`eligibleContributors`,
  `campHeal.ts:63-75`) gets `rt.campsCleared += 1`. Already ported: `crates/rh-sim/src/systems/camp_heal.rs:39`
  (`Player.camps_cleared`). The count only grows during a run.
- The value read is the public mirror `c.s.campClears` (`packages/shared/src/schema.ts:141`), synced from
  `rt.campsCleared` by `packages/server/src/sim/bruiserPassives.ts:62-70` (afterWeapons and systems updates, active phase
  only), `:104-110` (raidStarted/runEnded) and its `campCleared` link (`:127`, after campHeal's). So a clear paid in a
  tick's ledger payouts already counts for that tick's lifesteal (systems run after the payouts,
  `packages/server/src/sim/step.ts:291-293`). Rust has one field, already updated by then: read `camps_cleared` directly.
- `packages/server/src/sim/factions.ts:888-901` (`afterDamage`, a `systems` entry): for `c.kind === "player" &&
  faction === "holy"`, `farmRows = farmLifestealRowsOf(c.s) + holyCampLifestealOf(c.s.campClears)` (that f64 sum
  order), passed to `lifestealTotal(own, rows, mult, 0 | onDot, farmRows)` for both the direct and the DoT share.
- `packages/shared/src/mods.ts:380-382` `lifestealTotal`: `min(LIFESTEAL_MAX, own + min(LS_CAP, rows) * mult + onDot) +
  max(0, farmRows) * mult`. The camp term is **outside both caps**, **not** multiplied by `HOLY_LEECH_ROW_MULT` (rows only,
  `factions.ts:894`) and **is** multiplied by Bloodthirst's `lifestealMult`.
- `packages/shared/src/combatReadability.ts:126-135` (`cardLeech`, build-mark leech score): `farm` starts at
  `holyCampLifestealOf(campClears)` for a Holy, then adds each mob-stat lifesteal row; the score is
  `max(0, min(0.25, rows)) + max(0, farm)`, and `bonusLeech = cardLeech(...) + killStat(lifesteal)` (`:102`). No row
  multiplier here.

## 4. New paths (created by the oracle author on `packet/P-HOLY-DEMON-BLOOD-1`)
- `tools/holy-demon-blood-fixtures/` (capture tool, README, declared map) and `parity/holy-demon-blood/source.json`.
- `crates/rh-sim/src/systems/holy_demon_blood_tests.rs` (in `rh-sim`, not `rh-parity`: like the bruiser corpus test it
  drives `Sim` internals such as `w.deferred` and `cards::grant`), declared in `crates/rh-sim/src/systems/mod.rs`.

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/signatures.rs`: `after_damage`, the farm argument of both `lifesteal_total` calls (near
  `:419-437`): `v.farm_lifesteal_rows + camp term` for a Holy **player** only.
- `crates/rh-sim/src/constants.rs`: one row `HOLY_CAMP_LIFESTEAL_PER_CLEAR: f64 = 0.005, "fraction";` appended to the
  `content!` registry. The registry feeds `content_hash` by itself: **`content.rs` needs no edit**. The content hash
  changes (from `7d2d84b827af3ddc`); the hand-off states the new value.
- `crates/rh-sim/src/kill_augments.rs`: `invested_scores` reads `Readable::camp_clears` (a stub field the oracle added,
  filled by `Readable::of` from `p.camps_cleared`; remove its `#[allow(dead_code)]`), and the doc comment at `:211-215`.
  Not `build_marks_tests.rs` (oracle file).

## 6. Contracts and references
- C-PARITY: captured legacy fixture plus parity test. C-NUM: f64, legacy operation order.
- C-TICK: no schedule row moves. C-RNG: no draw is added.
- `docs/DEVIATIONS.md` DEV-012 (resolution: fold the term in and drop the `holy_camp_clears` exception in
  `parity/build-marks/legacy.json:544`'s Rust comparison).
- `crates/rh-sim/AGENTS.md`: no_alloc, hash_coverage and `check_world` stay green.

## 7. Behaviour to preserve
- Every existing Holy fixture (`parity/fixtures/holy_*`, `signature_holy`) still MATCH: with zero camp clears the term
  is 0.
- No new serialized field (`camps_cleared` exists): checkpoint 31, replay 25, observation 24 unchanged. The content hash
  changes (new registry row): the hand-off states the new value for the coordinator.
- No RNG draw added, no schedule row moved.
- Caps as legacy: the camp term is outside `LS_CAP` and `LIFESTEAL_MAX`, untouched by `HOLY_LEECH_ROW_MULT`, multiplied by
  `lifestealMult` (corpus cases `holy_sixty_clears_past_lifesteal_max`, `holy_bloodthirst_twenty_clears`).

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-HOLY-DEMON-BLOOD-1` passes (full).
- `cargo test -p rh-sim --lib holy_demon_blood_tests`: all nine pass. The corpus is not an `rh-legacy-scenario/1`
  fixture, so `parity-report` does not list it; its output stays unchanged.
- `cargo test -p rh-sim --lib build_marks_tests`: `holy_camp_clears` equals legacy with no exception.
- `bash tools/holy-demon-blood-fixtures/capture.sh --check` stays byte-identical (needs Docker).
- A non-Holy player with camp clears gains nothing (`frost_twenty_clears_control`).

## Oracle files (read-only for implementers)
- `parity/holy-demon-blood/source.json` (exact capture, pinned linux/amd64 Node 22.23.4 image)
- `tools/holy-demon-blood-fixtures/capture.sh`, `capture.mts`, `declared-map-input.json`, `README.md`
- `crates/rh-sim/src/systems/holy_demon_blood_tests.rs` and its `mod holy_demon_blood_tests;` line in
  `crates/rh-sim/src/systems/mod.rs`
- `crates/rh-sim/src/kill_augments/build_marks_tests.rs` (exception removed; `parity/build-marks/legacy.json` unchanged)

Failing today on an assertion: `one_clear_adds_half_a_percent_of_the_damage`, `twenty_clears_add_ten_percent_outside_ls_cap`,
`sixty_clears_carry_the_share_past_lifesteal_max`, `bloodthirst_doubles_the_camp_term`,
`a_clear_paid_in_the_pass_feeds_the_same_ticks_lifesteal`, `build_marks_match_the_legacy_readability_formula`. Controls
passing before and after: `holy_with_zero_clears_heals_its_own_share_only`,
`a_frost_with_twenty_clears_gains_no_lifesteal`, `holy_bloodthirst_with_zero_clears_matches`,
`the_corpus_holds_exactly_the_compared_cases`.

## 9. Validation commands
- `cargo test -p rh-sim --lib holy_demon_blood_tests build_marks_tests`
- `cargo test -p rh-sim --features trusted-status-probes`
- `cargo test -p rh-parity`; `cargo run -p rh-parity --bin parity-report` (unchanged)
- `bash tools/holy-demon-blood-fixtures/capture.sh --check` (Docker; pinned linux/amd64 Node 22.23.4 image)

## 10. Risk and suggested model tier
Opus: `rh-sim` combat path and a parity capture. Small diff, high cost if the term lands at the wrong point of the
lifesteal sum.

## 11. Known traps
- Eligibility is decided where the count grows (campHeal, already ported); the passive itself has no bound.
- The camp term goes in the farm argument, not in `own` (the 60-clear case tells them apart: 0.9 vs 0.85) and not in
  `rows` (the 20-clear case: 0.1 vs a capped 0.25 after x2.7). Sum order is `farm_rows + camp`, as legacy.
- Only a Holy **player** (`c.kind === "player"`); Holy-faction mobs get no camp term.
- Build-mark leech score: legacy sums `camp + mob-stat rows` first (`farm` starts at the camp term), then the kill stat.
  Put the camp term at the head of the Rust farm sum and keep the existing order otherwise (the test is bit-exact).
- Legacy doubt, pinned not fixed: training practice camps pay the clear without the `campCleared` chain
  (`packages/server/src/sim/camps.ts:97-100`), so in training the mirror, and the camp term, lag the count by up to one
  tick. Not exercised by the corpus; Rust reads the count directly.
- The Unity client bakes the content hash (`client-unity/README.md:69`): deploying this packet needs a client rebuild.
- This raises Holy sustain. The owner reported Holy as too strong in the beta; it is still legacy behaviour and is
  ported as is. The hand-off says so under RISKS.
- If no Linux x64 / Node 22.23.4 container is available for an exact capture, stop and report: do not hand-write a
  fixture.

## Notes from previous attempts
