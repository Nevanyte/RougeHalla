# P-BOT-BRAIN-THEMED-1: the Brain values a camp by the buff it actually pays

- **Serves:** owner decision 2 (2026-11-10: zone-themed camp buffs) and the owner's condition on DEV-027 (signed
  2026-11-13): "the Brain's camp valuation must read themed buffs before `--bot-brain full` goes live"; owner decision 8
  (learner and tuner runs)
- **Implementer tier:** implementer-opus (bot priority, `rh-policy`)
- **Reviewer:** reviewer-opus
- **Integration base:** `coord/int-35` (feature/unity-rework after P-BOT-BRAIN-CHOICES-1)
- **D-rules touched:** D1: the legacy camp-buff patch `a7b5c4ce` is the reference, and it did change the Brain (below);
  loose proof on composed percepts · D2 n/a · C-OBS: the seat reads only the reward its own percept already carries ·
  no wire, observation or percept change · D5/D6/D9 none

## 1. ID and outcome
With themed camp buffs (live, and the Brain tournament world: `crates/rh-headless/src/tournament_learning.rs:323`) a
camp pays the stat of its zone's theme, not always the stat its mob type implies. The Brain's route still values a camp
by mob type: `crates/rh-policy/src/bots/temporal_percept/strategy/build_route.rs:246-262` (`route_camp_value`,
`normals * type_weight(build, mob_type)` at :257). The percept already delivers each camp's reward stat
(`brain/compose14.rs:944-949`); until this packet no strategy code read it.

When this lands the route values a camp by the stat its kills pay, as the seat's own percept reports it
(`RouteCamp::reward`), weighted `build.weight(stat).max(STAT_FLOOR)`, which is exactly legacy's
`typeWeight(build, c.buff || c.type)` after `a7b5c4ce`; a camp whose percept reward is not a stat code is valued as
today. Under `CampBuffRule::Legacy` every camp's reward is its own type's stat, so every value is bit-identical and the
frozen-corpus and parity paths do not move.

## Established facts

**Legacy.** `packages/` holds legacy *before* the patch: `packages/server/src/bots/brain/buildRoute.ts:171-178`
(`campValue`: `normals * typeWeight(this.build, c.type || undefined)` at :175), `:127-131` (`typeWeight`: the build's
weight for `mobStatReward(type)`'s stat, floored at `STAT_FLOOR` 0.25, :62), `strategy.ts:711-718` (route camps from
`extras.camps`; no buff), `perception.ts:807` (`CampLike.reward` copied through: legacy's `CampState.reward` is the
clear-reward kind `"" | "?" | "skills" | "relic" | "cursed"`, `packages/shared/src/schema.ts:209-213`, always `""` in R5
`packages/server/src/sim/camps.ts:39`; it is **not** a stat). The patch `a7b5c4ce` (on
`origin/claude/adoring-edison-mxt8ab`; the brief's `a7a5c4ce` does not resolve, DEV-027's `a7b5c4ce` does; it is **not**
merged into `packages/`: `git log -- packages` has no commit of it and `buildRoute.ts` has no `buff`) changed the Brain:
- `buildRoute.ts:180` (patched): `typeWeight(this.build, c.buff || c.type || undefined)`; `RouteCamp.buff` (types).
- `strategy.ts:716` (patched): the route camp takes `buff` from the percept's `CampView.buff` (`CampState.buff`, a
  public synced field naming the *type* whose stat the camp pays when off theme; `""` = its own type,
  `shared/mobStats.ts:118` `campRewardId`).
- `buildRoute.test.ts:52` (patched): Fire A values a Flame Caller camp paying the Pardoner's stat at
  `4 * typeWeight(fireA, "pardoner")` and walks past a nearer Soul Offence camp to a Damage one.
- Also the hunt: `huntAdapter.ts:123-135` and `mobHunt.ts:464` (patched) weigh a mob by `m.reward ?? m.type` (its
  camp's buff). **Not in this packet's scope** (see Legacy doubts and Not established).
So "match legacy" and "value by the buff paid" agree: no deviation is needed for the route. A type's weight depends only
on its stat (`typeWeight` -> `mobStatReward(type)`), so valuing by the paid stat equals valuing by the buff type.

**Percept.** `extras.camps[i].reward` is the composer's HUD stat code (`compose14.rs:83-93` `HUD_STATS`, filled at
:944-949 from `frame.collections.camps[i].reward`), sourced from `rh-sim` `observe.rs:405-438` `camp_hud_into`: the stat
of `campRewardId` (the buff under `Themed`, else the own type) for **every camp row, every frame, every viewer**, in
both modes (public content, not sight-limited: camps the seat has never seen carry it too, as legacy's synced
`CampState.buff` does). `""` only when the type has no farm row (none on seed1). The frozen corpus
(`parity/policy/**`) always carries legacy's `reward: ""` (6313 `"reward": ""` occurrences by `rg`; the 12 other `reward` texts are
provenance notes, not camp rows; no stat code anywhere).
Measured on seed1 (secrets seed 11, Themed): 14 of 50 camps pay a stat other than their type's own (28 %; the patch
measured 28.7 %); the test pins only 10-50 %.

**Today's Rust.** `route_camp_value` reads `elite`, `state`, `spots`, `alive`, `mob_type`; nothing reads the reward.
`crate::bots::build_route::{type_weight, reward_stat, BuildGoal::weight, STAT_FLOOR}` (`bots/build_route.rs:255-259`)
is the weight table, keyed by `FarmStat`; the HUD code -> `FarmStat` map is `rh-sim` `observe.rs:386-403` `hud_stat`
read backwards (offense=Ad, soulOffense=Ap, damage, attackSpeed, lifeSteal=Lifesteal, health=MaxHp, defense=Armor,
soulDefense=Shield, moveSpeed), a bijection over the nine stats.

**No percept or observation change is needed.** The stub only threads the already-composed `reward` text into the
typed strategy input (`CampView::reward`, `RouteCamp::reward`) and moves the engine's route-camp loop into
`engine.rs` `route_camps` unchanged so the oracle can call it.

**Identities.** `POLICY_CONTRACT_VERSION` (23, `crates/rh-policy/src/lib.rs:52`) versions the seat interface: each bump
in its doc (versions 19-23) follows an observation or input change; a Brain decision rule is not part of it. No bump.
No `OBSERVATION_VERSION`, `PROTOCOL_VERSION`, content hash, checkpoint or replay identity moves (nothing in `rh-sim`).

## 2. Dependencies
P-BOT-BRAIN-CHOICES-1 (the Brain tournament world has themed buffs on). In `coord/int-35`.

## 3. Relevant legacy paths
- `packages/server/src/bots/brain/buildRoute.ts:62, 127-131, 171-178` (pre-patch campValue/typeWeight).
- `git show a7b5c4ce -- packages/server/src/bots packages/shared/src/mobStats.ts packages/server/test/bots/buildRoute.test.ts`
  (patched: `buildRoute.ts:132, 180`, `strategy.ts:716`, `mobStats.ts:118`, test `:52`; hunt `huntAdapter.ts:123-135`,
  `mobHunt.ts:464`).
- `packages/shared/src/schema.ts:209-213` (legacy `CampState.reward`: the clear-reward kind).

## 4. New paths
- `crates/rh-policy/src/bots/temporal_percept/brain/themed_camp_tests.rs` (oracle).

## 5. Exclusive write scope
- `crates/rh-policy/src/bots/temporal_percept/strategy/build_route.rs` (`route_camp_value`; a private stat-code ->
  `FarmStat` helper may live there).
- If needed, the stub files of this packet (below), for the same purpose only. Not `compose14.rs`, not `rh-sim`, not
  the hunt (`hunt_adapter.rs`, `mob_hunt.rs`).

Stub files (commit `stub:`; the implementer may edit them): `strategy/types.rs` (`RouteCamp::reward`,
`CampView::reward`), `brain/adapters.rs` (reads `extras.camps[].reward`), `strategy/engine.rs` (`route_camps`),
`strategy.rs` (test-only re-exports), `brain.rs` (`mod themed_camp_tests`), and compile-only `reward: String::new()`
lines in the existing tests `strategy/source_tests.rs` (frozen-corpus readers: legacy has no stat there) and
`strategy/private_strategy_tests.rs`. **Owner/coordinator note:** those two existing test files change by one field
line per struct literal; no assertion changes.

## 6. Contracts and references
- C-OBS (only the seat's own percept), C-INPUT (unchanged), C-POLICY (no contract bump), R-ML (no learning added),
  DEV-026 (the degraded fair profile), DEV-027 (themed buffs; this packet meets its Brain-route condition).

## 7. Behaviour to preserve
- Unthemed mode: identical values, so identical decisions. Guards: `themed_camp_tests::unthemed_rewards_leave_every_camp_value_as_today`
  (every seed1 camp, all ten builds, bit for bit), the frozen-corpus Strategy/Brain tests in `rh-policy` (`source_tests`,
  `brain/tests.rs`, `parity/policy/**` readers: reward `""` there), `cargo test --release -p rh-headless --test brain_bots`.
- Themed mode decisions move by design: `brain_choices` (loose bounds) must stay green.
- A reward text that is not one of the nine stat codes is unknown: valued by mob type.

## 8. Acceptance checks
- The four oracle tests pass; two are red today (`themed_camps_are_valued_by_the_stat_they_pay_not_their_mob_type`:
  `camp 1 (flameCaller paying soulDefense), build fire:A, elites false: value 0.75, the paid stat gives 1.59`;
  `two_camps_of_one_type_paying_different_stats_are_ranked_by_the_build_weights`: `left 1.0, right 4.0`), two are guards
  green today.
- `cargo test --locked -p rh-policy` and `cargo test --locked --release -p rh-headless --test brain_bots --test brain_choices` green.
- `scripts/gate.sh --oracle packet/P-BOT-BRAIN-THEMED-1` passes.

## Oracle files (read-only for implementers)
- `crates/rh-policy/src/bots/temporal_percept/brain/themed_camp_tests.rs`
- `docs/backlog/packets/P-BOT-BRAIN-THEMED-1.md`

## Baseline
Measured on `coord/int-35` + stub (this branch): `cargo test --locked -p rh-policy --lib themed_camp`: 2 passed, 2
failed (the two red tests above, assertion failures). A trial implementation (stat-code match in `route_camp_value`,
discarded, not committed) made all four pass and kept `cargo test --locked -p rh-policy` green (521 + 23 tests).
With that trial, `cargo test --locked --release -p rh-headless --test brain_bots --test brain_choices` stayed green.

Opener zones (a throwaway probe, not committed: `play_learning` on the Brain tournament world, Themed, 8 games x 3
seats, seed 7, the `brain_choices` timers): 24 of 24 seats record an opener. Baseline (by type): zone fire 6, frost 10,
holy 4, sentenced 4, plague 0. Trial (by paid stat): fire 7, frost 9, holy 4, sentenced 4, plague 0 (one seat moved).
Not degenerate either way, and the route decides few openers in such short games (most come from the first mob
farmed), so **no end-to-end bound is pinned**; `brain_choices` keeps its existing loose bounds.

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test --locked -p rh-policy themed_camp`
- `cargo test --locked -p rh-policy`; `cargo test --locked --release -p rh-headless --test brain_bots --test brain_choices`
- `scripts/gate.sh --quick --base coord/int-35`; `scripts/gate.sh --oracle packet/P-BOT-BRAIN-THEMED-1`

## 10. Risk and suggested model tier
Opus (bot priority). Small change; the risk is moving an unthemed decision (a mismatched code table, or reading the
reward where it is not a stat). Any learning store or searched table made before this lands is provisional and is
regenerated after it.

## 11. Known traps
- The frozen-corpus paths must keep the source rule exactly: branch on what the percept carries (a known stat code),
  never on a global mode. Legacy's `reward` field is the clear-reward kind; only the composer puts a stat code there.
- `type_weight` floors at `STAT_FLOOR`; the paid-stat weight must floor the same way (`max(STAT_FLOOR)`), and keep the
  float order `normals * weight` then `+ ELITE_VALUE`.
- Do not change the hunt here (legacy changed it too; separate packet).

## Legacy doubts
- The patch is unreleased and not in `packages/`; the in-repo legacy Brain still values by type. This packet follows
  the patch, as DEV-027 does for the sim.
- Legacy patched the hunt as well (`mobHunt.ts:464`, `huntAdapter.ts:123-135`: a mob of a buffed camp is weighed by the
  buff). The Rust Brain's hunt (`strategy/engine.rs:218-219`, `mob_hunt.rs:550`) still weighs by mob type; DEV-027's
  "route and hunt" sentence names both. Proposed follow-up: P-BOT-BRAIN-THEMED-2 (hunt reads the camp's reward), needed
  for the DEV-027 condition read literally.

## NOT ESTABLISHED
- That valuing by the paid stat improves play or win rate; only that the value follows the weight table as legacy's
  patched Brain does.
- The hunt (above), and the camp-roam utility (`engine.rs` camp candidates; legacy `strategy.ts:650-651` leaves the buff
  "for a later pass") are not changed.
- Composed-percept coverage is one map (seed1) and one reward salt (seed 11) in the lobby.

## Notes from previous attempts
