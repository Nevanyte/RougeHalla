# P-BOT-BRAIN-THEMED-2: the Brain's hunt values a mob by the stat its camp pays

- **Serves:** owner decision 2 (2026-11-10: zone-themed camp buffs); the owner's condition on DEV-027 (signed
  2026-11-13): "the Brain's camp valuation must read themed buffs before `--bot-brain full` goes live" (DEV-027's
  "route and hunt": P-BOT-BRAIN-THEMED-1 did the route, this packet does the hunt); owner decision 8 (learner and
  tuner runs)
- **Implementer tier:** implementer-opus (bot priority, `rh-policy`)
- **Reviewer:** reviewer-opus
- **Integration base:** `bc3dcfba6` (`agent/opus/P-BOT-BRAIN-THEMED-1`, reviewed LAND, merged on the coordinator's
  staging branch); `docs/agent/INTEGRATION_BRANCH` reads `feature/unity-rework`
- **D-rules touched:** D1: the legacy camp-buff patch `a7b5c4ce` is the reference; loose proof on composed percepts ·
  D2 n/a · C-OBS: the seat reads only the camp rewards its own percept already carries · no wire, observation or
  percept change; `POLICY_CONTRACT_VERSION` stays 23 · D5/D6/D9 none · C-INPUT unchanged · R-ML: nothing learned

## 1. ID and outcome
With themed camp buffs (`SimConfig::camp_buffs = Themed`: live profiles and the Brain tournament world) about 28 % of
camps pay a stat other than their mob type's own (14 of 50 on seed1, secrets seed 11). The Brain's route already values
a camp by the stat it pays (P-BOT-BRAIN-THEMED-1). Its hunt still weighs each candidate mob by the mob's type:
`strategy/engine.rs` builds the type-keyed weight and `strategy/mob_hunt.rs` `wanted` reads `m.type_`.

When this lands the hunt weighs a normal mob whose camp pays a stat other than its type's own by the build's weight for
the **paid** stat, floored at `STAT_FLOOR`, which is legacy's patched `typeWeight(m.reward ?? m.type)`; every other mob
(on-theme camp, no camp, unknown camp, a reward text that is not a stat code, elites, no build) keeps today's weight.
Under `CampBuffRule::Legacy` every weight is bit-identical, so the frozen corpus and the parity paths do not move.

## Established facts
(Paths under `crates/rh-policy/src/bots/` unless stated; lines on `packet/P-BOT-BRAIN-THEMED-2` after the stub.)

**Legacy (patch `a7b5c4ce`, on `origin/claude/adoring-edison-mxt8ab`, not in `packages/`).**
- `git show a7b5c4ce:packages/server/src/bots/brain/huntAdapter.ts` lines 123-135: a map camp id -> `mobTypeById(c.buff)`
  from `p.extras.camps` (only camps that carry a `buff`, i.e. off theme: `CampState.buff` is `""` on theme,
  `shared/mobStats.ts:118` `campRewardId`); each remembered mob with `m.campId` in the map gets `MobLike.reward`.
- `git show a7b5c4ce:packages/server/src/bots/mobHunt.ts` line 464: `wanted = m.kind === "elite" || !inp.typeWeight ? 1 :
  inp.typeWeight(m.reward ?? m.type)`. Pre-patch in-repo: `packages/server/src/bots/mobHunt.ts:462`
  (`inp.typeWeight(m.type)`).
- `typeWeight` (`packages/server/src/bots/brain/buildRoute.ts:127-131`): the build's weight for the type's stat, floored at
  `STAT_FLOOR`; an unknown or absent type is worth the floor. `strategy.ts:259` passes `(type) => typeWeight(build, type)`.
- `mobLikeOf` (`packages/server/src/bots/brain/huntAdapter.ts:68-75`): `type` only when memory learned it.
- Patch test `packages/server/test/mobHunt.test.ts:138` (in `a7b5c4ce`): two bailiffs, "plain" at walk 100 and
  "buffed" at walk 130 with `reward: "inquisitor"`; with a weight 1 for inquisitor, 0.25 otherwise, the hunter picks
  "buffed"; without the reward it picks "plain". Oracle (1, direction) is this test on a real build.

**Rust today (verified).**
- `temporal_percept/strategy/engine.rs:218` (stub: `build.map(hunt_type_weight)`; before the stub `:218-219` built the
  closure inline), `hunt_type_weight` at `engine.rs:1816` (stub body: today's `type_weight(build, mob_type)`).
- `strategy/mob_hunt.rs:9` `TypeWeightFn = dyn Fn(Option<&str>) -> f64`; `wanted` is now `hunt_wanted`
  (`mob_hunt.rs:595`, stub body: today's rule), called from the hunter's pick.
- `HuntMobLike` (`mob_hunt.rs:29-44`) had no reward or camp field; the stub adds `reward: Option<FarmStat>` (`:43`).
- `MobMemory.camp_id: Option<String>` (`temporal_percept/memory.rs:140`), set from the home spot by `camp_at`
  (`memory.rs:582-594`) both for minimap dots (`fold_mobs`, `memory.rs:1160-1180`: `type_ = None`) and for seen mobs.
  **So a remembered mob can have a camp id and no type.**
- `mob_like_of` (`strategy/hunt_adapter.rs:296`) drops the camp id; the snapshot is now built by `hunt_mobs`
  (`hunt_adapter.rs:326`, stub: today's loop, ignores `camps`/`defs`), called by `HuntAdapter::mobs` (`:73`).
- `CampView` (`strategy/types.rs:345-353`) has `index`, `type_`, `reward` but no id: the camp id is
  `ctx.cfg.map.camps[view.index].id` (`CampDef.id`), which is what `camp_at` returns (`memory.rs:431` geoms from
  `config.map.camps`).
- `paid_stat` (private, `strategy/build_route.rs:258`) reverses the nine HUD codes; `HUD_STATS`
  (`temporal_percept/brain/compose14.rs:84-94`, made `pub(crate)` by the stub). No test tied the two before this packet.
- The frozen Brain corpus carries camp `reward` texts `"known"` (`parity/policy/bot-private-strategy/source.json`, about
  1 200 rows) and `"weapon"` (`parity/policy/bot-private-brain/`, about 1 100 rows); `""` in `npc-continuity`,
  `npc-runner-callsite`, `owner-combat-farm`. None is a stat code. Two comments say "always \"\"" and are wrong:
  `strategy/types.rs:196` (`RouteCamp::reward`) and `strategy/source_tests.rs:1962`.

**The on-theme trap (why "use the percept reward whenever it is a stat code" is wrong).** Rust's percept carries a stat
code for **every** camp, on theme or not (`rh-sim` `observe.rs:405-438` `camp_hud_into`); legacy's buff exists only off
theme. For a minimap dot (`type_ = None`) in an on-theme camp legacy weighs `typeWeight(undefined)` = the floor; reading
the percept code would give the stat's weight. So the reward applies only when the camp's paid stat differs from its
camp type's own stat (`reward_stat(view.type_)`). On seed1/seed 11 every legacy buff pays a stat other than its camp
type's own (asserted by oracle (1)), so this percept-side test reproduces legacy there. Under `Legacy` it makes no mob
carry a reward, which keeps every weight bit-identical (oracle (2), unthemed, includes the dots).

**Existing tests freeze `TypeWeightFn`.** `strategy/source_tests.rs:3027` and `:3291` pass one-argument weight closures
into `HuntInput` and `HuntAdapter::decide` (frozen-corpus parity). Do not change `TypeWeightFn`'s signature. A trial
that kept it (in `hunt_wanted`, a mob with `reward: Some(stat)` calls `weight` with the id of a normal type that pays
`stat`, as legacy calls `typeWeight` with the buff type) passed all ten oracle tests and `cargo test --locked -p
rh-policy` (527 lib tests and the integration tests; discarded, not committed).

**Identities.** No `PROTOCOL_VERSION`, `OBSERVATION_VERSION`, `POLICY_CONTRACT_VERSION` (23), content hash,
checkpoint or replay identity moves. Nothing in `rh-sim`. No RNG draw added or moved.

## 2. Dependencies
P-BOT-BRAIN-THEMED-1 (`bc3dcfba6`): `CampView::reward`, `RouteCamp::reward`, `route_camp_value` by paid stat.

## 3. Relevant legacy paths
- `git show a7b5c4ce -- packages/server/src/bots/brain/huntAdapter.ts packages/server/src/bots/mobHunt.ts
  packages/server/test/mobHunt.test.ts` (patched: `huntAdapter.ts:123-135`, `mobHunt.ts:464`, test `:138-145`).
- `packages/server/src/bots/mobHunt.ts:462` (pre-patch `wanted`), `packages/server/src/bots/brain/buildRoute.ts:127-131`
  (`typeWeight`), `packages/server/src/bots/brain/strategy.ts:259`, `packages/server/src/bots/brain/huntAdapter.ts:68-75,
  124-130` (pre-patch `mobLikeOf` and the mobs loop).

## 4. New paths
- `crates/rh-policy/src/bots/temporal_percept/brain/themed_hunt_tests.rs` (oracle).

## 5. Exclusive write scope
Stub files (commit `stub:`); the implementer edits only these, for this purpose:
- `crates/rh-policy/src/bots/temporal_percept/strategy/hunt_adapter.rs`: `hunt_mobs` (the camp id -> paid-stat match,
  setting `HuntMobLike::reward`), `mob_like_of`.
- `crates/rh-policy/src/bots/temporal_percept/strategy/mob_hunt.rs`: `hunt_wanted` (read `reward`), `HuntMobLike` doc.
  `TypeWeightFn` keeps its signature.
- `crates/rh-policy/src/bots/temporal_percept/strategy/engine.rs`: `hunt_type_weight` and its call at `:218` only (the
  weight path). Probably needs no change.
- `crates/rh-policy/src/bots/temporal_percept/strategy/build_route.rs`: replace `paid_stat` by `hud_code_stat` (one
  table, crate-visible; remove the stub's `#[allow(dead_code)]`), `route_camp_value` calls it. Nothing else.
- `crates/rh-policy/src/bots/temporal_percept/strategy/types.rs`: the `RouteCamp::reward` comment (corpus carries
  `"known"`/`"weapon"`, not always `""`). Comment only.
- `crates/rh-policy/src/bots/temporal_percept/strategy/source_tests.rs:1962`: that comment only. **Owner/coordinator
  note:** an existing test file; a comment line, no assertion.
- Already changed by the stub, not for the implementer: `brain.rs` (oracle `mod` line), `brain/compose14.rs`
  (`HUD_STATS` made `pub(crate)`), `strategy.rs` (test-only re-exports), and one compile-only `reward: None` line each
  in the existing tests `strategy/private_strategy_tests.rs` and `strategy/source_tests.rs` (**owner/coordinator note:**
  existing tests changed by one field line each; no assertion changed).
Not `rh-sim`, not the composer's logic, not `memory.rs`, not the route's ranking.

## 6. Contracts and references
- C-OBS (only the seat's own percept), C-INPUT (unchanged), C-POLICY (no contract bump), R-ML (no learning), DEV-027
  (this packet completes its Brain condition: route and hunt), DEV-026.

## 7. Behaviour to preserve
- Unthemed rewards change no hunt decision: under `Legacy` every hunt weight is today's, bit for bit (oracle
  `unthemed_rewards_leave_every_hunt_weight_as_today`).
- Frozen-corpus hunt captures stay green: `private_strategy_source_hunt_adapter_parity`
  (`strategy/source_tests.rs:4244`), the other `source_tests` hunt replays, `bots::mob_hunt_parity_tests`, `brain/tests.rs`.
  Their camp rewards are `"known"`/`"weapon"`/`""`, never a stat code, so no mob there carries a reward.
- No new RNG draw; no change to the hunter's candidate order, filters or score other than `wanted`.
- Ordered iteration only (`Vec`, memory order); no hash collections (`clippy.toml`).
- The route's values (P-BOT-BRAIN-THEMED-1 oracle `brain/themed_camp_tests.rs`) are unchanged by moving the table.

## 8. Acceptance checks
- The six oracle tests in `brain/themed_hunt_tests.rs` pass; three are red today (Baseline).
- `cargo test --locked -p rh-policy` green.
- `cargo test --locked --release -p rh-headless --test brain_bots --test brain_choices` green (themed decisions move by
  design; `brain_choices` has loose bounds). Not measured by the oracle author.
- `scripts/gate.sh --oracle packet/P-BOT-BRAIN-THEMED-2` passes (full).

## Oracle files (read-only for implementers)
- `crates/rh-policy/src/bots/temporal_percept/brain/themed_hunt_tests.rs`
- `docs/backlog/packets/P-BOT-BRAIN-THEMED-2.md`

## Baseline
Measured on `bc3dcfba6` + stub (this branch), `cargo test --locked -p rh-policy --lib themed_hunt`: 3 passed, 3 failed,
each on an assertion:
- `themed_hunt_weighs_a_mob_by_the_stat_its_camp_pays`: `mob n1 (mob Some("flameCaller")) of camp 1 (flameCaller paying
  soulDefense), build fire:A: hunt weight 0.25, the paid stat gives 0.53`.
- `the_hunter_picks_the_mob_whose_camp_pays_the_builds_stat`: `a cinderHound whose camp pays damage is worth 1 to Fire A,
  the plain one 0.25` (left `Some("plain")`, right `Some("buffed")`).
- `the_shared_stat_code_table_covers_every_hud_code`: `HUD code "offense" names no farm stat in the shared table`.
Green guards: `a_mob_without_a_paid_stat_in_the_percept_keeps_its_type_weight`,
`elites_and_a_buildless_hunt_keep_weight_one_in_a_themed_world`, `unthemed_rewards_leave_every_hunt_weight_as_today`.
The four `themed_camp_tests` stay green.

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test --locked -p rh-policy --lib themed_`
- `cargo test --locked -p rh-policy`; `cargo test --locked --release -p rh-headless --test brain_bots --test brain_choices`
- `scripts/gate.sh --quick --base bc3dcfba6`; `scripts/gate.sh --oracle packet/P-BOT-BRAIN-THEMED-2`

## 10. Risk and suggested model tier
Opus (bot priority; Brain decisions). Small change. Risks: moving an unthemed decision (applying the reward on theme,
see the trap), changing `TypeWeightFn` (breaks frozen-corpus tests), or a hunt-only table that drifts from the route's.
Any learning store or searched table made before this lands is provisional.

## 11. Known traps
- **On-theme camps:** apply the reward only when the percept's paid stat differs from the camp type's own stat
  (`reward_stat(view.type_)`); a minimap dot (`type_ = None`) in an on-theme camp keeps the floor, as legacy.
- **A mob with no `camp_id`, or one no camp definition has:** no reward. A view whose `index` has no `CampDef`: skip.
- **A camp whose reward is not a stat code** (`""`, `"?"`, `"known"`, `"weapon"`, `"skills"`, mis-cased `"Damage"`): no
  reward. `camps == None` (feature off): no reward.
- **Elites** stay at 1 whatever their camp pays; with no build (`type_weight: None`, the release path) every mob is 1.
- Floor the paid-stat weight at `STAT_FLOOR` exactly as `type_weight` does (bit-equal results are asserted).
- `TypeWeightFn` signature is fixed by existing tests (above).
- The hunter's pick must read the weight through `hunt_wanted` and the adapter must build its snapshot through
  `hunt_mobs` (the oracle calls those seams; the reviewer checks there is no second path).

## Legacy doubts
- The patch is unreleased and not in `packages/`; this follows it, as DEV-027 does for the sim.
- Legacy decides "off theme" by `CampState.buff` being set; Rust's percept has only the stat code, so off theme is "the
  paid stat differs from the camp type's own". These agree unless a buff could name a type paying the camp type's own
  stat; not seen on seed1/seed 11 (oracle (1) asserts it), not proved for every roll.
- `packages/server/src/bots/mobHunt.ts:462-466` (pre-patch, also patched): `wanted` is used both in the off-build skip
  (`wanted < BUILD_WANTED && walk > OFF_BUILD_WALK && mobKills > 0`) and in the score; both move with the reward, as
  in legacy.

## NOT ESTABLISHED
- That weighing by the paid stat improves play or win rate; only that the hunt's weight follows legacy's patched rule.
- End-to-end: no oracle runs a full `Strategy::decide` or a live Brain seat; the seams (`hunt_mobs`, `hunt_type_weight`,
  `hunt_wanted`, the real `MobHunter::decide`) are tested, and the engine already calls them in the stub.
- Composed-percept coverage is one map (seed1), one reward salt (seed 11), in the lobby; mobs are synthesised per camp
  (a typed normal, a minimap dot, the elite) with the map camp id memory would give them, not taken from a running seat's
  memory.
- The camp-roam utility (`engine.rs` camp candidates; legacy `strategy.ts:650-651`) is not changed.

## Notes from previous attempts
