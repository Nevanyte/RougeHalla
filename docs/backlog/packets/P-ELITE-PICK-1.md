# P-ELITE-PICK-1: the elite camp killer's 5 s first pick (live world only)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-MOBS-2 / P-CARDS-2), under the owner's 2026-11-18 approval "Killer
  first pick" (`docs/OWNER_DECISIONS.md` row "Elite and augment rework", 2026-11-18; plan of record
  `docs/backlog/AUGMENT_ELITE_REWORK.md`: decisions 1 and 6, packet row and details P-ELITE-PICK-1, wave W5, chest-file
  lane POOL-1 → PICK-1). Workbook chest rule: "the killer gets a 5 s first-pick window".
- **Implementer tier:** implementer-opus (hashed state, checkpoint format, `check_world` rule; cross-crate: `rh-sim` and
  `rh-policy`)
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework` @ `7673f8a02` (checkpoint `rh-checkpoint/33`, content hash
  `c890f52fd7ab4546`)
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10; the rule is new, not a port, so no legacy capture
  exists; Legacy is pinned byte-identical by the oracle) · D2 n/a · D5/D6/D9 none (no wire change; C-OBS kept)

## 1. ID and outcome

Under `SimConfig::elites == Rework` only (the live world, `SimConfig::live_content()`), when an elite camp's chest drops,
the credited killer (decision 6: the player with the most damage) gets a 5 s window in which only they may choose at that
chest. After the window the chest is first-come, as today. Under `Legacy`, and on every other chest, nothing changes.

What is true when this packet lands:
- `Chest` carries a hashed `first_pick: Option<FirstPick { killer, until }>` (stub-defined, see section 4). A Rework
  elite **camp** chest is dropped with `Some(FirstPick { killer, until: drop time + window })`; every other chest has
  `None`.
- The window length is a registered content row in `constants.rs` (name containing `FIRST_PICK`, unit `"ms"`, value
  `5000.`), returned by `reward_chests::first_pick_window_ms()`.
- `choose` refuses a non-killer inside the window with the existing `Refusal::NotYours` (no new refusal code), for a card
  and for the skip (`pick == -1`) alike, and records nothing. The per-viewer `can_choose` in `RewardChestObserver` uses
  the same predicate, so the observation and the command never disagree.
- `reward_chests::validate_world` refuses a window on a campless chest, under `Legacy`, with a killer who never joined,
  or ending after `drop + window`. `CHECKPOINT_FORMAT` is bumped once.
- Bots wait: a non-killer `HumanBot` at the chest submits no `Choose` during the window, then picks.

### Decisions (the coordinator asked for them to be decided and pinned)

1. **Open while `server_time < until`** (exclusive end), as the chest's own `server_time < expires_at`. The killer may
   choose at any time; others from `server_time >= until`.
2. **Killer dies, is downed, resolves or leaves: the window ends at once** (the recommended option). Predicate: a
   non-killer is gated only while `server_time < until` **and** the killer is a standing player (`w.player(killer)` is
   `Some` and `standing()`). A player who stops standing never stands again inside a match (the only status reset is
   the lobby and the training console: `systems/lobby.rs:67`, `systems/training.rs:48-56`), so the derived predicate needs
   no extra state and no schedule row. The oracle checks after one step, so a stored early end (e.g. `until` set to now
   in `expire`) passes too.
3. **A killer who is not standing at the drop gets no window** (first-come at once). The derived predicate gives this
   even if the drop stores the window.
4. **The window is the credited killer's wherever they stand.** Eligibility near the camp (`near_camp`) shapes only the
   cards rolled (the pickers' builds); a killer who landed the kill from outside the camp still holds the window.
5. **Refusal code:** `Refusal::NotYours` ("Not yours"), the code an ineligible picker at another player's Trophy gets
   (`mod.rs:300-302`). The window check sits where that check sits (after `Gone`, before reach), so a far non-killer
   inside the window hears "Not yours" rather than "Too far away"; the oracle pins only players in reach.
6. **The skip is gated too.** A skip (`pick == -1`) records the picker and pays the skip heal on a camp chest
   (`mod.rs:308-322`); inside the window it is the killer's alone.
7. **Field shape:** one `Option<FirstPick>` field, last in `Chest`, `#[serde(default)]` (test JSON that declares chests
   without the key keeps reading `None`). It hashes its `Option` tag on every chest (`hash.rs:14-19`), so the state hash
   of every world holding a reward chest moves, Legacy included; the Legacy **behaviour** and draws are byte-identical
   (pinned). See section 7 for the measured effect on existing pins.
8. **`until` is stored, not derived:** the drop time is not stored on a chest, but a shared chest's `expires_at` is
   `drop + lifetime_ms` (`insert`, `mod.rs:61-80`), so `validate_world` checks `until <= expires_at - lifetime_ms +
   window`. A past `until` is valid (the window ended while the chest stands for 10 more seconds).

## 2. Dependencies

- P-AUG-POOL-1 (merged at integration 62): `drop_augment_in` with `Picker`s, `validate_world(w, pool, near)`.
- P-AUG-RULES-1 (merged): `SimConfig::elites`, `EliteRule`.
- Serial merges (coordinator): P-AUG-NATIVE-1a (also bumps `CHECKPOINT_FORMAT`), P-ELITE-TUNE-1 (appends to
  `constants.rs`, regolds), P-AUG-POOL-1-fix (regolds). Whichever of PICK-1 and NATIVE-1a merges second bumps the format
  once more and re-records the hash tape at the merge.
- P-WIRE19-A (later) puts `until` on the wire; this packet changes no wire byte.

## 3. Relevant legacy paths

Legacy has no first-pick window: this is the owner's rework (decision 1). The seams it builds on:
- `packages/server/src/sim/mobLife.ts:158-198`: the kill goes to the player who did the most damage over the whole fight
  (`brain.threat`), ties by `tieRank`; `:228-234`: no killer, no `payMobKill` (so no chest).
- `packages/server/src/sim/chests.ts:217-229` `install`: the `mobKilled` link drops a camp chest (`rollChest`) or, for a
  campless elite, a chest at its body with no pickers; `:87-98` `rollChest` (eligible contributors' builds);
  `:127-160` `handleChoose` (the refusal order: busy, gone, Trophy owner, far, blocked, picked; skip pays on a camp chest).

Rust today (base `7673f8a02`):
- `crates/rh-sim/src/systems/mob_life.rs:243-252` credited killer (most damage, `tie`); `:584-603` the `MobKilled` hook
  fires with `killer: id` and the camp's contributor snapshot.
- `crates/rh-sim/src/hooks.rs:130-141` `HookArgs::MobKilled { killer, camp, elite, contributors, .. }`.
- `crates/rh-sim/src/reward_chests/mod.rs:50-60` `Chest`; `:61-80` `insert`; `:118-145` `drop_augment_in`;
  `:150-173` `drop_trophy`; `:179-222` `on_mob_killed` (the drop, with the killer in hand); `:278-376` `choose`
  (`:300-302` the `NotYours` check); `:393-396` `expire`; `:402-466` `validate_world`.
- `crates/rh-sim/src/reward_chests/observer.rs:159-168` per-viewer `can_choose`.
- `crates/rh-sim/src/checkpoint.rs:23` `CHECKPOINT_FORMAT = "rh-checkpoint/33"`; `:663` the `validate_world` call
  (passes `k.cards.pool()`; the rule needs `k.config.elites` too).
- `crates/rh-sim/src/schedule.rs:1140` `reward_chests::expire` (per-tick system), `:1336` `on_choose`, `:1737` the
  `mobKilled` chest link.
- Bots: `crates/rh-policy/src/bots/perception.rs:338-352` (the live `HumanBot` reads a chest's cards only when
  `can_choose`), `bots/loot.rs:528-537` `pick_intent` (no `Choose` without readable options);
  `bots/temporal_percept/modules/chests.rs:195-223, 247-283` and `temporal_percept/brain/compose14.rs:896` (the private
  Brain, not live). `bots/bot/loot_seat_tests.rs:158-205` already pins "no choose before the cards were readable".
  So the live bot should already wait once `can_choose` is false; the oracle proves it end to end. The implementer
  touches `rh-policy` only if that proof fails.

## 4. New paths

- `crates/rh-sim/src/reward_chests/first_pick_tests.rs` (oracle)
- `crates/rh-policy/tests/first_pick_bots.rs` (oracle)

Stub (commit `stub:`, the implementer's to replace or edit):
- `reward_chests/mod.rs`: `pub(crate) struct FirstPick { pub killer: PlayerId, pub until: f64 }`
  (`deny_unknown_fields`); `Chest::first_pick: Option<FirstPick>` (`#[serde(default)]`, last field); `insert` and
  `drop_trophy` write `None`; `pub(crate) fn first_pick_window_ms() -> f64 { 0. }`; `mod first_pick_tests;`.
- Compile-only `first_pick: None,` lines in the `Chest` literals of `reward_chests/tests.rs` (6) and
  `reward_chests/pool_tests.rs` (1; a P-AUG-POOL-1 oracle file, touched only by this compile line).

## 5. Exclusive write scope

- `crates/rh-sim/src/reward_chests/mod.rs` (the drop sets the window; `choose` gates; `validate_world` rule; the window
  fn; keep the `FirstPick` field names and the `Option` shape, which the oracle and test JSON use)
- `crates/rh-sim/src/reward_chests/observer.rs` (`can_choose` reads the same predicate)
- `crates/rh-sim/src/checkpoint.rs`: `CHECKPOINT_FORMAT` and the one `reward_chests::validate_world` call line
- `crates/rh-sim/src/constants.rs`: append one row after the last `REWORK_*` row, e.g.
  `REWORK_ELITE_FIRST_PICK_MS: f64 = 5000., "ms";`
- `crates/rh-sim/README.md:71` and `crates/rh-sim/src/fighter.rs:7` (doc mentions of the format string), optional
- `crates/rh-policy/src/bots/perception.rs`, `bots/loot.rs`, `bots/temporal_percept/modules/chests.rs` only if the bot
  oracle fails without a change
- The content-hash copies, by `scripts/regolden-content.sh` only (it rewrites `tests/content.rs` `GOLDEN_CONTENT_HASH`,
  the two reload-proof `.mjs`, `BakedContent.cs`, `parity/abilities/hash-tape.json` and
  `protocol/fixtures/archetypes_v1.json`; the tape's recorder also writes the new `checkpoint` string). Gate flags:
  `--allow-artefacts` (`BakedContent.cs`), `--regen-fixtures`; the `hash-tape.json` lines trip the oracle-capture stop and
  the coordinator waives them, as for P-AUG-TUNE-1.

## 6. Contracts and references

- C-OBS: the window's end is public (everyone may know it), but it reaches viewers only with P-WIRE19-A. Here the only
  observable is the viewer's own `can_choose`, which is already per viewer.
- C-RNG / determinism: the window draws nothing; the Rework drop's options and reward-RNG continuation equal Legacy's.
- C-INPUT: the gate is inside `choose` (the one `Choose` path); bots go through `validate` + `submit`.
- `crates/rh-sim/AGENTS.md`: a `check_world` rule per new invariant with a refusal test each; bump `CHECKPOINT_FORMAT`.
- `docs/agent/AUGMENT_REWORK.md`: never branch on the rule where a table would do. This rule has no table: the drop reads
  `k.config.elites == EliteRule::Rework` (as `mob_life.rs:530` does for the helper share), and `validate_world` takes the
  rule.

## 7. Behaviour to preserve

- `Legacy`: every chest's options, spot, expiry, hold and the reward-RNG words after a drop are those of today
  (pinned by `legacy_has_no_window_and_the_rework_drop_differs_from_it_by_the_window_alone`); no window, no new refusal.
- The `Option` tag changes the state hash of any world holding a reward chest (decision 7). Measured on the stub with
  the whole `rh-sim` suite (`--features trusted-status-probes`): **no pinned fold moved** (the ability hash tape,
  `step_event_window`, `mob_spacing_tests::LEGACY_FOLD`, `frost_wall_content`, the terrain and replay pins all stay
  green); the only red tests were this oracle, the literal format pins and `hash_coverage`'s optional-leaf rule (all
  handled below).
- Wire and observation: `RewardChestView` keeps exactly `handle, at, expires_at, options, picked, can_choose`; no
  `PROTOCOL_VERSION`, `OBSERVATION_VERSION` or policy-contract bump.
- Schedule: no new row (`crates/rh-parity/tests/schedule.rs`).
- `no_alloc`: the gate allocates nothing (a `Copy` field and a predicate).

## 8. Acceptance checks

- `scripts/gate.sh --quick --oracle packet/P-ELITE-PICK-1` passes (flags as in section 5).
- `cargo test -p rh-sim --features trusted-status-probes --lib reward_chests::` green (the oracle and the existing chest
  tests).
- `cargo test -p rh-policy --test first_pick_bots` green.
- `cargo test -p rh-sim --features trusted-status-probes --test checkpoint --test content --test hash_coverage` green.
- `scripts/regolden-content.sh --check` clean.

## Existing tests that pin what this packet changes

| Test | What it asserts | After this packet |
|---|---|---|
| `crates/rh-sim/tests/checkpoint.rs:103, :152-176, :190-215, :339-341, :354-356` | the format string literal `rh-checkpoint/33` and the refused older formats (32 the immediate predecessor) | `oracle-amend`: the literals read `rh_sim::CHECKPOINT_FORMAT`; `rh-checkpoint/33` joins the refused list and is the immediate predecessor in the payload-order check. Red at the stub (33 is still current), green once the constant is bumped to any later number |
| `crates/rh-sim/src/systems/sentenced/npc_tests.rs:463, :501-507` | the format literal and the refused older formats | `oracle-amend`: reads `crate::CHECKPOINT_FORMAT`; `rh-checkpoint/33` refused |
| `crates/rh-sim/tests/hash_coverage.rs` `every_serialized_leaf_of_a_match_changes_the_state_hash` | every optional leaf of its (Legacy) corpora is perturbed or documented in `VALIDATED` | the stub's `first_pick` is a `null` leaf no corpus can fill (Legacy refuses a window), so it failed at the stub; `oracle-amend` adds the `VALIDATED` row `world.reward_chests.*.first_pick` (the rule this packet adds). The Some value's hashing is pinned by `first_pick_tests::the_window_is_hashed` |
| `crates/rh-sim/src/abilities/source_tests/hash_tape.rs` with `parity/abilities/hash-tape.json` | the tape's `checkpoint` equals `CHECKPOINT_FORMAT`, its `contentHash` the build's, and 63 folds | green at the stub (no fold moved); the implementer's bump and the new content row move its `checkpoint` and `contentHash` lines, re-recorded by `scripts/regolden-content.sh` (the coordinator waives those lines at the oracle-capture stop) |
| `crates/rh-sim/tests/content.rs` `hash_golden`, `every_const_in_the_source_tree_is_registered_or_explained` | the content hash golden; every `const` registered | the new row moves the golden (regold by the script); the oracle uses fns, not consts |
| `crates/rh-sim/src/reward_chests/tests.rs:742-858` (observer `can_choose` vs `choose` at the birth hold and expiry) | the observer and the command agree | unchanged; the stub adds compile-only `first_pick: None` lines |
| `crates/rh-sim/src/reward_chests/pool_tests.rs:577-592` `with_chest` (P-AUG-POOL-1 oracle) | declares a chest literal | compile-only `first_pick: None` line in the stub commit; nothing else |
| `crates/rh-policy/src/bots/bot/loot_seat_tests.rs:158-205` | no `Choose` before the cards are readable (`can_choose`) | unchanged; it is why the live bot already waits |
| `crates/rh-headless/tests/cards.rs:34`, `mob_dot.rs:69`, `crates/rh-server/tests/native_reward_transport_regression.rs`, `trophy_status_los_transport.rs`, `crates/rh-parity/src/combat.rs:65` | declare or read chest JSON without the new key | unchanged: `#[serde(default)]` reads `None` |

## Oracle files (read-only for implementers)

- `crates/rh-sim/src/reward_chests/first_pick_tests.rs` (oracle)
- `crates/rh-policy/tests/first_pick_bots.rs` (oracle)
- `docs/backlog/packets/P-ELITE-PICK-1.md` (this brief)
- `crates/rh-sim/tests/checkpoint.rs` (`oracle-amend`, for the owner: format literals read the constant; 33 refused)
- `crates/rh-sim/src/systems/sentenced/npc_tests.rs` (`oracle-amend`, same)
- `crates/rh-sim/tests/hash_coverage.rs` (`oracle-amend`, for the owner: one `VALIDATED` row)

What each oracle test pins (`first_pick_tests.rs`; at the stub 11 of 14 fail on an assertion):
- `the_window_is_the_owners_five_seconds_read_from_its_content_row`: `first_pick_window_ms() == 5000` and a registry row
  `*FIRST_PICK*`, `"ms"`, 5000 (stub: 0).
- `a_rework_elite_camp_chest_holds_the_killer_and_drop_plus_the_window`: the drop stores `Some(FirstPick { killer,
  until: drop + 5000 })` (stub: `None`).
- `the_window_goes_to_the_credited_killer_with_the_most_damage_not_the_last_hit`: a real elite death through `hurt`
  and `pay_all`; 60% damage holds the window, the 40% last hitter does not (decision 6).
- `inside_the_window_only_the_killer_can_pick_and_after_it_anyone_eligible_can`: observer and command; card pick and
  skip refused `NotYours`, nothing recorded; the killer picks; still refused after the killer's pick; first-come from
  `until`.
- `the_window_is_open_while_server_time_is_before_its_end_for_the_command_and_the_observer_alike`: ahead −50, −1, 0, 1,
  50 ms on a declared window; `choose` and `can_choose` agree; exclusive end.
- `the_window_ends_early_when_the_killer_dies_or_leaves_and_a_fallen_killer_gets_none`: dead, downed, resolved, left
  (`remove_player`), fallen before the drop; after one step another player picks inside the original 5 s, and the
  checkpoint restores with an equal hash.
- `a_killer_away_from_the_camp_still_holds_the_window`.
- `legacy_has_no_window_and_the_rework_drop_differs_from_it_by_the_window_alone`: equal chest minus the field, equal
  next reward draw; Legacy first-come at once (green at the stub; a guard).
- `no_window_on_a_campless_elite_a_stat_crate_or_a_trophy_and_no_chest_from_a_normal_mob` (green at the stub; a guard).
- `a_checkpoint_mid_window_restores_hashes_equal_and_plays_the_window_out`: format tag is the constant; equal hashes and
  steps; the restored window refuses; after the window both pick.
- `the_window_is_hashed`: none / other killer / `until` − 50 each move the hash (green at the stub; a guard).
- `check_world_refuses_forged_windows`: a valid window restores; refused: a killer on a campless chest, `until` 1 ms
  past `drop + 5 s`, killer `PlayerId(99)`, any window in a Legacy world.
- `the_checkpoint_format_is_bumped_past_the_base`: the constant's number is above 33.
- `the_window_shows_only_in_can_choose_and_the_chest_row_carries_no_new_field`: the killer's and another's rows are
  equal but for `can_choose`; `RewardChestView` keys are exactly `at, can_choose, expires_at, handle, options, picked`.

`first_pick_bots.rs` `a_bot_waits_out_another_players_first_pick_then_picks`: seeds 1-4, a `HumanBot` at a restored
Rework chest holding player 1's window submits no `Choose` while `server_time < until`, draws no `ChestRefused`, and
takes an option at or after `until`; player 1 stands throughout (stub: the bot picks at once, "seed 1: the bot asked
for another player's first pick").

A throwaway prototype (not committed: the window fn reading a new `REWORK_ELITE_FIRST_PICK_MS` row, the drop setting
the window when `k.config.elites == Rework` and the killer stands, one `first_pick_blocks(w, chest, who)` predicate used
by `choose` (beside the Trophy owner check) and by `can_choose`, a `validate_world` rule taking `k.config.elites`, and
`rh-checkpoint/34`) passed all 14 oracle tests, the bot oracle, the amended `checkpoint.rs`, `npc_tests` and
`hash_coverage`, and the existing `reward_chests::` tests. Only `content.rs` `hash_golden` stayed red (the regold). No
`rh-policy` source change was needed.

## 9. Validation commands

- `cargo test -p rh-sim --features trusted-status-probes --lib reward_chests::first_pick_tests`
- `cargo test -p rh-policy --test first_pick_bots`
- `scripts/regolden-content.sh` then `scripts/regolden-content.sh --check`
- `scripts/gate.sh --quick --oracle packet/P-ELITE-PICK-1 --allow-artefacts --regen-fixtures`

## 10. Risk and suggested model tier

Opus implementer, reviewer-opus: new hashed state on a shared struct, a checkpoint-format bump that collides with
P-AUG-NATIVE-1a, a `check_world` rule, and a cross-crate proof (the live bot). The gate itself is a few lines.

## 11. Known traps

1. **One predicate, two readers.** `choose` and the observer's `can_choose` must call the same function (the
   `birth_available` precedent, `mod.rs:42-47`), or a bot reads "open" and spams refused picks.
2. **The killer's own gate.** The killer passes the window; every other check (busy, gone, reach, picked, taken,
   owned, needs) applies to them as before.
3. **Same tick.** The window opens at the drop (the `mobKilled` link, inside the payout pass) and the chest is held one
   tick (`birth_hold_ticks`), so no pick can race the drop. At the end, a pick submitted for the tick whose
   `server_time >= until` succeeds for anyone.
4. **Format bump order.** NATIVE-1a may bump first; read the constant, never a literal. The oracle-amends below replace
   the literals of the existing format pins with the constant and add `rh-checkpoint/33` to their refused lists.
5. **Content hash.** The new row moves `content_hash`; regold only through the script.
6. **`validate_world` signature.** It needs the rule (or `k`); its one caller is `checkpoint.rs:663`.

## Notes from previous attempts
