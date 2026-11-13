# P-MECHANICS-SALVAGE-3: camp-clear and Wish bookkeeping from `fix/mechanics-sim` (bruiser mirror rows, armWishes effect refresh, resetAll DoT crit memory)

- **Serves:** as [P-MECHANICS-SALVAGE-1](P-MECHANICS-SALVAGE-1.md) (owner beta-follow-up decision 1; branch triage
  2026-11-12, row `fix/mechanics-sim`)
- **Implementer tier:** implementer-opus (schedule rows, raid-start reset of hashed state)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework (`cdc119ec`; P-MECHANICS-SALVAGE-1 and -2 merged)
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none
- **Status:** oracle committed on `packet/P-MECHANICS-SALVAGE-3` (4 failing tests, 3 guards; section 8); ready for
  implementer-opus.

## 1. ID and outcome
Inventory rows #1, #3 and #4 of P-MECHANICS-SALVAGE-1 section A. No live balance effect is expected; this closes the
last `Partial` rows the branch closed:
- **Bruiser camp-clear mirror** (`bruiserPassives.update` x2, `resetRun` x2, the `campCleared` link; `Partial("P-MOBS-2")`).
  The integration branch already reads `Player.camps_cleared` for Holy's camp lifesteal and the kill-augment leech
  (P-HOLY-DEMON-BLOOD-1). Legacy reads the public mirror `PlayerState.campClears`, which equals the canonical count
  wherever the Bruiser installer runs (live: `Gates::MOB_FROST_FOUNDATION`, `bruiser: true`) and stays 0 where it does
  not. Port as the branch did, derived (`systems::bruiser::camp_clears(k, p)`: the count when `Gates::of(k).bruiser`,
  else 0), and make the lifesteal reader (`signatures.rs::after_damage`) go through it. No new state.
  The oracle pins the legacy reading (mirror 0 without the installer), so "record that the readers already equal the
  mirror and flip the rows with a comment" (the alternative the first draft offered) no longer passes.
- **armWishes**: after the reset, `refreshEffects` for every player (the native refreshes the bits only when a status
  was removed, so a pending cast's bit survives raid start). Row `abilities.armWishes` `Partial("P-ABIL-1")` -> Ported.
- **cardHooks.resetAll**: `rt.cards = undefined` also clears the DoT crit memory (`critAccDot`, `dotRollTick`,
  `dotCrit`); the native keeps `core.card_dot_crit`. Row `cardHooks.resetAll` `Partial("P-CARDS-1")` -> Ported.

### Re-check against the merged tree (2026-11-12, `cdc119ec`)
None of rows #1, #3, #4 is done; no file moved. P-MECHANICS-SALVAGE-1 and -2 touched none of the files here except
`schedule.rs` (row `cardHooks.onBlocked`, now `Ported`) and `crates/rh-parity/tests/schedule.rs` (that row's
assertion). The seven rows are still `partial(...)`/`partial_link(...)` at `crates/rh-sim/src/schedule.rs:1072`
(afterWeapons `bruiserPassives.update`), `:1196` (systems `bruiserPassives.update`), `:1602` (raidStarted
`abilities.armWishes`), `:1634` (raidStarted `cardHooks.resetAll`), `:1648` (raidStarted `bruiserPassives.resetRun`),
`:1712` (runEnded `bruiserPassives.resetRun`), `:1840` (campCleared `bruiserPassives.<arrow>`).
`systems/status/mod.rs::raid_started` (`:375-404`) has no refresh; `cards/runtime.rs::reset_player` (`:31-49`) keeps
`core.card_dot_crit`; `signatures.rs:432-436` reads `pl.camps_cleared` directly. Row #2 (Holy camp lifesteal) stays
dropped: present since P-HOLY-DEMON-BLOOD-1 (`systems/holy_demon_blood_tests.rs`).

## 2. Dependencies
none (P-MECHANICS-SALVAGE-2, the other `schedule.rs` editor of the trio, is merged).

## 3. Relevant legacy paths
- `packages/server/src/sim/bruiserPassives.ts:59-71` (`update`, mirror sync `:63-71`, active phase only), `:101-113`
  (`resetRun`, sync `:105-109`), `:115-126` (install: afterWeapons `:118`, systems `:120`, campCleared `:124`,
  raidStarted `:125`, runEnded `:126`).
- `packages/server/src/sim/factions.ts:895-896` (the lifesteal reader of `c.s.campClears`),
  `packages/shared/src/championPassives.ts:6-9` (`holyCampLifestealOf`), `packages/server/src/sim/campHeal.ts:92`
  (the canonical count, kept without the installer). Other readers of the mirror:
  `packages/shared/src/combatReadability.ts:102`, `:126-133` (kill-augment leech score and build marks).
- `packages/server/src/sim/abilities.ts:51` (install), `:84-99` (`armWishes`: `rt.cast = null` `:91`, `removeStatuses`
  `:92`, `refreshEffects` `:97`, players only), `packages/server/src/sim/status.ts:345-365` (`effectsOf`: the casting
  bit from `rt.cast` alone, `:357`).
- `packages/server/src/sim/cardHooks.ts:44` (install), `:75-79` (`resetAll`), `packages/server/src/sim/cardState.ts:22-27`
  (`cardsOf` rebuilds `critAccDot: 0, dotRollTick: -1, dotCrit: false`), `:59-70` (`rollDotCrit`).
  `packages/server/src/sim/training.ts:335-344` (`trainClear` also sets `rt.cards = undefined`: the practice console's
  `clear` calls the same `reset_player`, so it gains the same fix).
- Reference port: `git show 364c9dd0 -- crates/rh-sim/src/systems/bruiser.rs crates/rh-sim/src/systems/status/mod.rs
  crates/rh-sim/src/cards/runtime.rs crates/rh-sim/src/schedule.rs crates/rh-parity/tests/schedule.rs` and
  `git show c4913a0d -- crates/rh-sim/src/sim.rs`. **Do not** bring the branch's Holy lifesteal hunks
  (`constants.rs`, `signatures.rs` beyond the mirror read, `kill_augments*`), its `parity/holy-camp-lifesteal` capture or
  its content-hash regeneration: the integration branch has the constant already. Careful with the `status/mod.rs`
  hunk: `remove_discard_with(.., Selector::All, ..)` followed by `}` appears twice in that file (`clear_all` at `:358`
  and `raid_started` at `:397`); the refresh goes in `raid_started` only.

## 4. New paths
- none for the implementer (the oracle file below is committed by the oracle author; its `mod mechanics_salvage3_tests;`
  line in `crates/rh-sim/src/systems/mod.rs` is the stub commit's).

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/bruiser.rs`, `crates/rh-sim/src/systems/status/mod.rs`, `crates/rh-sim/src/cards/runtime.rs`
- `crates/rh-sim/src/schedule.rs` (the seven rows named in section 1, plus `#[allow(dead_code)]` on `partial_link`,
  whose five uses are exactly these rows), `crates/rh-parity/tests/schedule.rs`
  (`what_the_slice_has_ported_stays_ported`, `partial_rows_keep_pending_ownership_and_execute_in_source_position`,
  `a_match_runs_its_ported_rows_in_table_order`: see section 8)
- `crates/rh-sim/src/systems/signatures.rs` (`after_damage` Holy camp term only)
- optional, same rule, not tested by the oracle: `crates/rh-sim/src/kill_augments.rs` (`Readable::of`) and
  `crates/rh-sim/src/build_summary.rs` (Holy camp rows). Both read `Player.camps_cleared` with no `MatchStatic`;
  routing them means a new parameter on `pub fn invested_stats`/`build_marks`, whose callers are in `crates/rh-server`
  (cross-crate): prefer to leave them and note it (section 11).

No `content!` constant, no content hash move (`4674a176a28e3c7a` stays), no new serialized state.

## 6. Contracts and references
C-TICK (rows flip in place, no reordering; `crates/rh-parity/tests/schedule.rs` against
`parity/schedule/legacy_schedule.json`); `tests/hash_coverage.rs` (no new leaf; `effects` and `card_dot_crit` are
already hashed and checkpointed). C-RNG: no draw.

Identities: none move. `CHECKPOINT_FORMAT` 31, `REPLAY_FORMAT` 25, `OBSERVATION_VERSION` 27, `PROTOCOL_VERSION` 17,
policy contract 21, content hash `4674a176a28e3c7a`. The fix changes values of already-hashed fields at raid start
(effect bits of a player with a pending cast, `card_dot_crit`), so a state hash can differ only for a world that carried
either into a raid start: none of the existing fixtures does (the reference port turns the oracle green with the rest
of `cargo test -p rh-sim --features trusted-status-probes` green, section 8).

## 7. Behaviour to preserve
- Live Holy lifesteal and kill-augment leech numbers (the mirror equals the count in every live world;
  `systems/holy_demon_blood_tests.rs` replays the installed case, `Gates::MOB_FROST_FOUNDATION`).
- Parity report all MATCH; `parity/abilities` base cases (`wishReadyAt`/`wishFullAt`/`effects` on the birth frame).
- The canonical `Player.camps_cleared` is still counted without the installer (legacy `campHeal.ts:92`).

## 8. Acceptance checks
- `cargo test -p rh-sim --features trusted-status-probes --lib mechanics_salvage3`: all 7 pass (4 fail today, on
  assertions; 3 guards pass today and must keep passing).
- `cargo test -p rh-sim --features trusted-status-probes`; `cargo test -p rh-sim --features trusted-status-probes --test
  content`; `cargo test -p rh-parity --test schedule` with the existing assertions updated for the flipped rows:
  `what_the_slice_has_ported_stays_ported` asserts `abilities.armWishes` has `pending == None`, `completed == None`
  (today it asserts `P-ABIL-1` / `"status and field reset"`, `crates/rh-parity/tests/schedule.rs:454-455`);
  `partial_rows_keep_pending_ownership_and_execute_in_source_position` mutates the armWishes row into a synthetic
  partial and must set both halves itself (as the reference port's hunk does), since the row is no longer partial;
  the comment on `TraceEntry::Hook("raidStarted", "abilities.armWishes")` (`:674`) loses "P-ABIL remainder".
  These are edits of existing tests by the implementer, inside the write scope; the oracle commit does not change them.
- `cargo run -p rh-parity --bin parity-report`: all MATCH, no fixture regenerated (stub: 109 slice scenarios + 13
  capture-only, 300 pathfinding queries, all MATCH).
- `cargo clippy -p rh-sim --all-targets --all-features -- -D warnings`; `cargo fmt --all -- --check`.
- `scripts/gate.sh --oracle packet/P-MECHANICS-SALVAGE-3`.

### The oracle (`crates/rh-sim/src/systems/mechanics_salvage3_tests.rs`)
#1 runs in the partial Holy foundation (`FactionMode::EngagementHoly`, no mobs: signatures on, Bruiser installer off)
with the `holy-demon-blood` corpus's operation (p0 at 500 hp, one deferred plain hit of raw 60 by p0, two steps);
#3 and #4 run through the real lobby (`Sim::new`, `add_player`, step until `Event::RaidStarted`), so the whole
raidStarted chain has run (`systems/lobby.rs::start_raid`).

| Test | Mechanic | Legacy number (worked) | Native today (assertion) |
|---|---|---|---|
| `a_holy_without_the_bruiser_installer_gains_no_camp_lifesteal` | #1 | mirror 0 without the installer: p0 hp with 3 canonical clears = p0 hp with 0 (difference 0; `factions.ts:896`, `bruiserPassives.ts:68`, `:108` are the only writers) | +0.3208 hp (3 x 0.005 x about 21.4 damage fed) |
| `arm_wishes_drops_a_pending_casts_effect_bit_at_raid_start` | #3 | no status, cast cleared, `refreshEffects`: effects 0 (`abilities.ts:91`, `:97`; `status.ts:357`) | 4096 (`EFFECT_CASTING` survives) |
| `reset_all_clears_the_dot_crit_memory_at_raid_start` | #4 | `rt.cards = undefined` (`cardHooks.ts:76`): no DoT crit memory (`None`) | `Some(accumulator 0.4, roll tick 3, critical)` |
| `the_salvaged_bookkeeping_rows_are_ported_in_place` | C-TICK | the seven rows `Ported` (no `pending`, no `completed`) | all seven partial |
| guard `guard_the_canonical_count_and_the_own_share_stay_without_the_installer` | #1 | Holy own share still heals (hp > 500), canonical count stays 3 (`campHeal.ts:92`) | passes |
| guard `guard_a_player_without_a_cast_enters_the_raid_with_no_effect_bits` | #3 | effects 0 for every player | passes |
| guard `guard_reset_all_still_clears_the_hit_crit_accumulator` | #4 | `critAcc` 0 after the reset | passes |

Checked by the oracle author: the reference port's three hunks (mirror read gated on `Gates::of(k).bruiser` in
`signatures.rs`, the `refresh_effects` call after the removal in `status::raid_started` for players, and
`p.core.card_dot_crit = None` in `reset_player`) turn the three mechanic tests green and keep
`holy_demon_blood_tests` green; it was not committed.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/systems/mechanics_salvage3_tests.rs`
- `docs/backlog/packets/P-MECHANICS-SALVAGE-3.md`

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --lib mechanics_salvage3`
- `cargo test -p rh-sim --features trusted-status-probes --lib holy_demon_blood`
- `cargo test -p rh-sim --features trusted-status-probes`; `cargo test -p rh-sim --features trusted-status-probes --test content`
- `cargo test -p rh-parity --test schedule`; `cargo run -p rh-parity --bin parity-report`
- `cargo clippy -p rh-sim --all-targets --all-features -- -D warnings`; `cargo fmt --all -- --check`
- `scripts/gate.sh --oracle packet/P-MECHANICS-SALVAGE-3`

## 10. Risk and suggested model tier
Opus: schedule-table ownership checks and raid-start resets of hashed state; small code (about 40 lines).

## 11. Known traps
- The practice console's clear (`systems/training/console.rs::clear`) does not zero `campsCleared`/`campContrib` as
  legacy `trainClear` does (`training.ts:343-344`; found by the branch, unreachable today): out of scope, note only.
- `partial_link` becomes unused once the five partial links flip: `#[allow(dead_code)]` with a reason, as
  `pending_link` has (clippy runs `-D warnings`).
- Legacy `armWishes` walks players only (`for (const [id, p] of s.players)`); the native loop also clears casts and
  statuses of mobs present at raid start. Keep the refresh players-only, as the reference port does; the mob half is a
  legacy doubt for another packet, not this one.
- Kill-augment leech (`kill_augments.rs::Readable::of`) and the HUD build summary (`build_summary.rs`) read the
  canonical count; legacy reads the mirror there too (`combatReadability.ts:102`, `:133`). They differ only in worlds
  without the Bruiser installer (capture and partial foundation profiles), which no live room runs. Not tested here.
- The mirror's lag between a trusted placement and the next step (legacy `update` syncs it in afterWeapons) is not
  reproduced by the derived read; it is unobservable without a trusted placement (`holy_demon_blood_tests.rs` header).

## Notes from previous attempts
