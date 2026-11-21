# P-AUG-BOTS-1: bots score the rework's chest cards and read the elite rule

- **Serves:** `docs/backlog/AUGMENT_ELITE_REWORK.md` P-AUG-BOTS-1 (wave 7); folds in the P-ELITE-TUNE-1 review note.
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer (Sonnet)
- **Integration base:** `coord/int-72` @ `4f1a1884a`
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
A fill bot (`HumanBot`) offered a Rework chest scores the 14 native cards instead of reading them as unknown ids
(score 0), values the four faction-only cards by the bot's own faction only, treats Marked Man as a trade-off, and
reads the room's elite rule (`SimConfig::elites`) in its two elite estimates, so a Rework elite is estimated at its real
hp x1.5 and damage x1.0. Legacy rooms behave byte-identically.

## 2. Dependencies
In the base: P-AUG-POOL-1, NATIVE-1a/1b..4, ELITE-TUNE-1, WIRE19-A (native ids on the wire; `reward_option_id` already
maps them).

## 3. Relevant legacy paths
- `packages/server/src/bots/chestHunt.ts:164` costsSomething, `:221` cardScore, `:251` chooseOption (ported at
  `crates/rh-policy/src/bots/temporal_percept/modules/choice.rs`). Natives are new content with no legacy bot score:
  the scores are a design choice built from the same formula (tier-I unique augment: `tier + 1 + 2*risk + fit`).
- `packages/shared/src/mobs.ts:37` mobFaction; `packages/shared/src/constants.ts:513` ELITE_HP_MULT (legacy 2.0 / dmg 1.5).
  Rust: `planning.rs` `mob_faction`, `hunt_adapter.rs` `mob_max_hp`, both read `EliteTuning::of(Legacy)` today, so under
  Rework bots think elites have 2.0/1.5 = 4/3 of their real hp and 1.5x their real damage (errs cautious).
- Same-tick/RNG: scoring and the two estimates are pure; no RNG draw changes. Empty build: `build: None` handled as
  today by `card_block`.

## 4. New paths
- Oracle files below (all test modules).

## 5. Exclusive write scope
- `crates/rh-policy/src/lib.rs` (`MatchStart::of` reads `sim.config().elites`; the field exists as a stub)
- `crates/rh-policy/src/bots/temporal_percept/modules/choice.rs` (`card_def` finds natives; faction-only and Marked Man
  rules; may add a `faction` read of `pool_members`)
- `crates/rh-policy/src/bots/planning.rs`, `crates/rh-policy/src/bots/temporal_percept/strategy/hunt_adapter.rs`
  (use the `rule` parameter; fix the two stale P-ELITE-TUNE-1 comments)
- `crates/rh-policy/src/bots/bot.rs` plus whatever carries the rule from `MatchStart` (`reset`) to `matchup_share` /
  `mob_like_of` callers (`planning` state, the Brain composer `SeatComposer14` if it reaches them).
- Not: rh-sim, rh-server, client-unity, the oracle files.

## 6. Contracts and references
C-INPUT, C-OBS (the rule is public room config, like `frost_wish`), C-POLICY. rh-policy determinism rules.

## 7. Behaviour to preserve
- Legacy-rule runs unchanged: existing bot tests (`planning_parity_tests`, `mob_hunt_parity_tests`, `wish_*`,
  `tests/first_pick_bots.rs`, `frost_wall_*`) stay green.
- `choice.rs` existing unit tests (unknown id scores 0, boundaries) stay green.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-BOTS-1`.

## Existing tests that pin what changes
- `crates/rh-policy/src/frost_tests.rs:84` asserts `POLICY_CONTRACT_VERSION == 28`. The new `MatchStart::elites` field
  is a public contract addition (Frost precedent bumped to 25), but a bump would edit that test, so this packet does
  **not** bump; the coordinator decides whether to bump to 29 and amend that line afterwards.
- `choice.rs` `mod tests` pin unknown ids scoring 0 and the risk boundaries: unchanged by this packet.
- Stub commit touched compile-only lines (`elites: EliteRule::Legacy,`) in the `MatchStart` literals of `bots/bot.rs`,
  `planning_parity_tests.rs`, `bot/reset_stream_tests.rs`, `wish_module_tests.rs`, `frost_wall_bots_tests.rs`.

## Oracle files (read-only for implementers)
- `crates/rh-policy/src/bots/temporal_percept/modules/choice/native_tests.rs`
- `crates/rh-policy/src/bots/planning/elite_tests.rs`
- `crates/rh-policy/src/bots/temporal_percept/strategy/hunt_adapter/elite_tests.rs`
- `crates/rh-policy/tests/elite_rule_start.rs`

## 9. Validation commands
`cargo test -p rh-policy`; `scripts/gate.sh --quick --oracle packet/P-AUG-BOTS-1`.

## 10. Risk and tier
Low: one crate, pure functions. Design choices the oracle pins (flag to owner): a native augment scores like a tier-I
unique augment; a faction card off its faction scores below a plain tier-I base (here `ad1`, 3.5) while on its faction
at risk 1.0 it beats it; Marked Man is refused below `TRADEOFF_RISK` and ranks under Wish Engine; Calluses/Bastion/
Marksman's Tally prefer Fists/Shield/Bow. `the_five_pool_additions_are_scored` is green today (catalog cards already
score); it guards regressions only.

## 11. Known traps
- `mob_faction` and `mob_max_hp` signatures already take `rule` (stub); the work is carrying the rule from
  `MatchStart` through `HumanBot::reset` to `matchup_share` and `mob_like_of` (public `matchup_share` has other callers).
- Legacy rooms must reach the identical `EliteTuning::of(Legacy)` numbers.
