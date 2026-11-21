# P-ELITE-SHARE-1: helper share on an elite kill (live-only, under `EliteRule::Rework`)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-MOBS-2), under the owner's 2026-11-18 approval "Helpers earn
  stacks" (`docs/OWNER_DECISIONS.md` row "Elite and augment rework", 2026-11-18; plan `docs/backlog/AUGMENT_ELITE_REWORK.md`
  decisions 1, 6, 7, packet row P-ELITE-SHARE-1).
- **Implementer tier:** implementer-sonnet (escalate to implementer-opus if new serialized state turns out to be needed)
- **Reviewer:** reviewer-opus
- **Integration base:** `coord/int-61` (3c530434f; the integration branch has not caught up, so every gate run passes
  `--base coord/int-61`)
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10; one behaviour test file) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Under `SimConfig::elites == Rework`, when an elite camp's elite dies, every player in that camp's contributor snapshot who
is still standing gets `REWORK_ELITE_SHARE_STACKS` (12, registered by P-AUG-CONTENT-1; one camp's worth) stat stacks of the
stat the camp's normal kills pay (its buff row, else its normal mob type; never the elite's own type), the credited
killer included, each exactly once. The elite's chest reward and the
killer's existing elite payout (GV, weapon, `MobKilled` hook) are unchanged. Under `Legacy` nothing changes.

Decisions for this packet (coordinator):
- **Who is paid:** only contributors alive and still in the match at the kill, i.e. `Player::standing()` (status Alive, not
  downed, not resolved). A contributor that died earlier gets nothing. `modifiers::farm::grant_mob_stat` already refuses a
  non-standing player (`farm.rs:180`), so the existing grant path gives this for free.
- **Each player once:** the killer is one of the contributors (the snapshot holds every positive-hit player) and is paid
  the share once. Today an elite kill pays the killer NO stacks (`mob_life.rs` `pay`: the stack grant sits under
  `if !a.elite`), so the share is the killer's only stacks from an elite; there is nothing to add to or deduplicate against.
- **Grant path:** `crate::modifiers::grant_mob_stat(k, w, id, camp_stat, REWORK_ELITE_SHARE_STACKS as u64)`, the same call
  the normal-kill branch makes, so stacks reach save, restore and the state hash as normal stacks do (`Player::farm`). No
  new serialized state: the snapshot already travels on `Award::contributors`, which is non-empty only for elites. **If you
  find you need new state, stop: the packet goes to Opus.**

## 2. Dependencies
P-AUG-CONTENT-1 (registers `REWORK_ELITE_SHARE_STACKS`, already in `coord/int-61`), P-AUG-RULES-1 (`SimConfig::elites`).

## 3. Relevant legacy paths
Legacy has no helper share; this is the owner-approved rework, not a port. The seams it reads (verified by reading):
- `crates/rh-sim/src/systems/mob_life.rs:200-224` contributor snapshot built on every positive hit (first-hit order, present
  players only); `:284-290` `Award::contributors` is the camp's list for an elite, empty otherwise; `:243-252` the credited
  killer is the player with most damage (decision 6).
- `crates/rh-sim/src/systems/mob_life.rs` `pay` (about `:496-560`): `if !a.elite { ... grant_mob_stat(..., paid, DEFINITION.kill_stacks) }`
  where `paid = camp buff row (rt.buffs.0[camp]) else a.mob_type`. **The share must NOT copy that fallback.** For an
  elite kill `a.mob_type` is the ELITE's own catalog type (`mob_catalog/rosters.rs:90-106` `camp_mobs` puts `elite_type`
  at the elite spot; `hurt` copies `m.mob_type` into the `Award`), and `modifiers/farm.rs` `DEFINITION.rows` has no row
  for an elite type, so `grant_mob_stat` returns 0 and nobody is paid (on-theme camps, and every `CampBuffRule::Legacy`
  world, have no buff row). The stat the share pays is the camp's buff row if set, else the camp's NORMAL mob type:
  `rt.buffs.0.get(camp).copied().flatten().unwrap_or(rt.camps[camp].mob_type)` (`CampRoster::mob_type`). The `MobKilled`
  hook takes `a.contributors` by value at the end of `pay`: loop over the snapshot before it moves.
- Legacy source for the normal grant: `mobLife.ts:265-270` (per the existing code comment).
- `crates/rh-sim/src/mob_runtime.rs:440` `EliteTuning`. Its `stored_rule` stores a `Rework` world whose numbers still equal
  legacy as `Legacy`, so `MobRuntime::elites` is NOT a reliable "rework" test. Read the rule from `k.config.elites`.
- Chest side (unchanged): `crates/rh-sim/src/reward_chests/mod.rs:172-194`, which also reads the contributors.

## 4. New paths
- `crates/rh-sim/src/systems/mob_life/share_tests.rs` (the oracle; its `mod` line is in the `stub:` commit).

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/mob_life.rs` (the share, in `pay`, or a small private fn beside it)
- `docs/backlog/packets/P-ELITE-SHARE-1.md` only for the coordinator's notes; the implementer adds nothing else.

Must not touch (owned by parallel packets): `reward_chests/*`, `cards/tuning.rs`, `constants.rs`, `checkpoint.rs`,
`systems/training/console.rs`, `tests/content.rs` and the content-hash copies (P-AUG-POOL-1); `cards/wishful_thinking`,
`rework_overrides.rs`, `abilities/checkpoint.rs` (P-AUG-TUNE-1). The share needs no registry row and no content-hash
move. If it truly needs one of those files, stop and say so in the hand-off.

## 6. Contracts and references
C-TICK (no reorder: the share runs inside the existing `MobKill` payout), C-RNG (no draw), C-OBS (stacks are already
observed through the existing farm readout; the Toast is the viewer's own), `docs/agent/AUGMENT_REWORK.md` (rule seam:
read the rule from config, do not add a hash tag), P-AUG-RULES-1 packet.

## 7. Behaviour to preserve
- A `Legacy` world: byte-identical (no stacks, no Toast, same events); every parity fixture and state hash unchanged.
- A `Rework` world with no elite kill: same hash as before.
- Normal-mob kills: same 3 stacks to the killer alone, same Toast, under both rules.
- No allocation added to the step (`no_alloc` tests): iterate the snapshot by reference.

## 8. Acceptance checks
- `cargo test -p rh-sim --lib share_tests` green.
- `scripts/gate.sh --oracle packet/P-ELITE-SHARE-1 --base coord/int-61` passes (full).
- Existing `pay_tests::capped_or_nonapplicable_payout_never_claims_a_stat_grant` stays green (see below).

## Existing tests that pin what this changes
- `crates/rh-sim/src/systems/mob_life/pay_tests.rs`, `capped_or_nonapplicable_payout_never_claims_a_stat_grant`, kind
  `"elite"`: an elite award (default `SimConfig`, so `EliteRule::Legacy`) pays no stat and no notice. Consistent with this
  packet (Legacy pays nothing); no conflict. `credited_normal_payout_reports_only_...`: a normal kill pays 3 stacks and one
  Toast; unchanged.
- No other test found that asserts an elite kill's stacks under `Rework`. No conflict to report.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/systems/mob_life/share_tests.rs`
- `crates/rh-sim/tests/augment_rules.rs` (oracle-amend, for the owner: `legacy_and_equal_elite_rework_play_the_same_match`
  asserted that a Rework-elites world equals the Legacy one. Under this packet an elite kill deliberately differs by the
  helper share, so on a seed where an elite dies it asserts the share per player and per stat through `Farm::count`, and
  compares the worlds with only `world.players[*].farm.counts` and `world.players[*].core.modifiers.farm` masked; a seed
  with no elite death keeps the exact comparison, and a floor requires at least one elite-kill seed.)

Tests and what they pin. They run on a real seed1 map (Pve, three seated players) and build every elite `Award` from the
camp's real elite mob, so its `mob_type` is the elite type; the expected stat is the camp's buff else `CampRoster::mob_type`.
Worlds swept: `CampBuffRule::Themed` with reward salts 1-4 and `Legacy` salt 1, with floors (at least one on-theme and one
off-theme elite camp).
- `the_share_is_one_camps_worth`: the constant is 12.
- `an_elite_award_carries_the_elite_type_which_pays_no_farm_stat`: guards the fixture (elite type != camp type, no farm row).
- `rework_elite_kill_pays_every_standing_contributor_the_camps_normal_stat_killer_included`: every elite camp of every
  swept world pays exactly 12 of the camp stat to each of three contributors, nothing else.
- `snapshot_order_does_not_matter`, `only_the_snapshot_is_paid_not_every_player_in_the_match`.
- `a_contributor_who_is_not_standing_is_not_paid`: dead / resolved / downed player 2 gets 0.
- `the_share_is_elite_only_a_normal_kill_still_pays_the_killer_alone`: normal award pays the killer 3, nobody else.
- `legacy_elite_kill_pays_no_stacks_to_anyone`: Legacy elites pay no stacks, no Toast, still GV (pins today).
- `the_share_survives_a_checkpoint_and_hashes_equal_including_a_max_hp_stat`: all elite camps paid, restore equal, hash
  equal, max hp equal, with a MaxHp-paying camp type among them (floor asserted).
- `a_real_elite_death_through_hurt_and_the_payout_queue_pays_both_contributors`: wiring: two `hurt` passes on a real elite
  (a wound from player 2, the kill by player 1), `pay_all`, then both get 12 of the camp stat and the bystander nothing.

## DEVIATIONS wording (proposed row, for the coordinator)
An elite kill pays 12 stat stacks of the camp's normal stat (its buff, else its normal mob type) to every standing
contributor, killer included; Legacy pays none.

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p rh-sim --lib share_tests`
- `scripts/gate.sh --quick --oracle packet/P-ELITE-SHARE-1 --base coord/int-61`

## 10. Risk and suggested model tier
implementer-sonnet; reviewer-opus. A small change inside the payout, no new state. Escalate to Opus only if new serialized
state is needed.

## 11. Known traps
- **Not pinned, decide in review:** (a) an elite killed with `killer == None` returns from `pay` before any grant, so no
  share is paid then even to live contributors; the oracle does not cover it (a killer is always present for a player kill;
  `None` arises only when no live player dealt damage). (b) the share is paid at `pay` time (a later pass of the same tick
  than the death); "alive at the kill" is tested as standing when `pay` runs, which equals the death-tick state unless a
  same-tick death sits between them. Pinned only for already-dead/downed/resolved contributors.
- `grant_mob_stat` is all-or-nothing against `max_count` (about 9e15), so the 12-stack grant cannot hit the cap in practice.
- Toast: normal kills push a `farm_text::grant_notice` Toast; whether helpers get one is not pinned (reusing the same
  notice for each paid player is natural; Legacy must push none).
- Do not gate on `MobRuntime::elites` (see section 3).
- Hit order: the `MobKilled` hook consumes `a.contributors`; pay the share before it moves.

## Notes from previous attempts
