# P-FROST-WALL-3: the live profiles select Frost Wall

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze")
- **Implementer tier:** implementer-opus (changes what the live server plays; cross-crate tests)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-FROST-WALL-1c (the sim rule complete), P-FROST-WALL-2a (the
  wall's numbers in content), P-FROST-WALL-2 (the wall on the wire) and P-UNITY-FROST-WALL-1 (the client draws it and
  aims it). Packet branched from the coordinator's staging merge `85bfd025e`. Pushed in the same integration batch as
  P-UNITY-FROST-WALL-1; no deploy happens between them.
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` · D2 n/a · parity fixtures run the
  default config (`Freeze`) and stay untouched · DEV-029 (signed; its amended text is the owner's to re-confirm: its
  "no live profile selects it yet" clause becomes false when this lands) · D5/D6/D9 none

## 1. ID and outcome
The wall is complete in the sim, on the wire and in the client, and nothing selects it. When this lands the live
world plays it: `frost_wish: FrostWish::Wall` in `SimConfig::live_content()` (`crates/rh-sim/src/statics.rs:454`), ONE
line, which reaches the source-arena server, the practice room and the Brain tournament world
(P-SIM-LIVE-CONTENT-1). With it:
1. The characterisation tables that state the live value move: `crates/rh-server/tests/live_content.rs:86`
   (`expected_source`) and `:115` (`expected_training`). Amended by the oracle author (coordinator-approved).
2. The two literal copies of the live world that the scan does not see are switched to `..SimConfig::live_content()`
   and the scan is widened to `crates/rh-headless/examples` (done by the oracle author): `examples/source_soak.rs:23-42`
   (the `cfg` literal), `examples/full_map_cost.rs:34-55` (`live_rules`).
3. Bots: see "Bot evidence" below and the decision there.
4. An operator switch for Freeze: none exists on a live profile, and this packet adds none (see Established facts).

## 2. Dependencies
As the integration base lists. Serial with anything touching `statics.rs` or `rh-server/tests/live_content.rs`.
Known red on the base, not this packet's: `cargo test -p rh-sim --lib ability_hash_tape_matches_the_base` and one
digest assertion in `crates/rh-sim/tests/frost_wall_content.rs` (a coordinator carry in progress on another branch).

## 3. Relevant legacy paths
Legacy is not merged into `packages/`; the rule is in the unreleased commit `78dd8bd4` (read with
`git show 78dd8bd4:<path>`):
- `packages/shared/src/abilities.ts:260-273` (`frostWall`: `ai: ["peel", "escape"]`, point target range 450 / min 64,
  cast 250 ms), `:274` (`WISHES.frost = "frostWall"`): legacy's live game plays the wall, no Freeze switch.
- `packages/server/src/bots/abilityPolicy.ts:54-58` (`WALL_PEEL_DISTANCE = 260`, `WALL_PEEL_MIN = 56`,
  `WALL_PEEL_SHARE = 0.7`), `:97-101` (`wallBetween`: only a point rule, only when the enemy is 56..=260 away; the
  wall's aim point is `me + (enemy - me) * min(range, d * 0.7) / d`, i.e. 70% of the way to the enemy, no unit id),
  `:113-123` (`escape`: in trouble, a wall goes between us and the threat, else the foe), `:164-167` (`peel`: a
  chasing, targetable threat gets `wallBetween`; the PEEL_DISTANCE cap of the unit branch does not apply).
  Engage/control are not in the wall's `ai`, so a wall is never cast at a foe standing off (test
  `packages/server/test/abilityPolicy.test.ts:217-231`: chasing at 200 casts at `me.x + 140`; not chasing, under
  56 or over 260 casts nothing; low and hit with a non-chasing threat at 150 casts at `me.x + 105`; a `foe` at 200
  with no threat casts nothing).

## 4. New paths
- `crates/rh-sim/tests/frost_wall_live.rs` (oracle)
- `crates/rh-server/tests/frost_wall_live_room.rs` (oracle)
- `crates/rh-headless/tests/frost_wall_live.rs` (oracle)

## 5. Exclusive write scope
- `crates/rh-sim/src/statics.rs`: the one line at `:454` (`frost_wish: FrostWish::Wall` in `live_content()`), and
  the doc comment of `frost_wish` (`:266-270`, "No live profile selects `Wall` …") which becomes false.
- `crates/rh-headless/examples/source_soak.rs`, `crates/rh-headless/examples/full_map_cost.rs`: build on
  `..SimConfig::live_content()` (no other change to what they measure: timers, `hitboxes` parameter, lifecycle).
- Not: the wire, `content.rs`, `SimConfig::default()`, `crates/rh-server/src/main.rs` (the core runtime),
  `crates/rh-server/src/runtime.rs` (it already builds on `live_content()`), `Cargo.lock`, any oracle file, any
  parity fixture, any bot file (see the bot decision).

## 6. Contracts and references
- C-PARITY: fixtures run `SimConfig::default()` / `rh_parity` configs (Freeze); untouched.
- C-RNG / C-TICK: no draw or row changes (a config value only).
- DEVIATIONS DEV-029 (the wall), P-SIM-LIVE-CONTENT-1 (one definition of the live world).

## 7. Behaviour to preserve
- Every parity fixture and the default `SimConfig` (`frost_wish: Freeze`): untouched. Core runtime: untouched.
- The practice room (`--runtime training`) and the source-arena profile agree on Frost's Wish.
- Every other live content field: unchanged (the characterisation tables pin all of them).

## 8. Acceptance checks
- `crates/rh-sim/tests/frost_wall_live.rs`, `crates/rh-server/tests/frost_wall_live_room.rs`,
  `crates/rh-server/tests/live_content.rs`, `crates/rh-headless/tests/live_content.rs`,
  `crates/rh-headless/tests/frost_wall_live.rs`: green.
- Guards: the default config is `Freeze`; `cargo run -p rh-parity --bin parity-report` all MATCH.
- The release smoke (see Validation): Brain and HumanBot matches with Frost seats under the wall complete.
- `scripts/gate.sh --oracle packet/P-FROST-WALL-3` passes.

## Oracle files (read-only for implementers)
- `docs/backlog/packets/P-FROST-WALL-3.md` (this brief)
- `crates/rh-sim/tests/frost_wall_live.rs` (new): `the_live_content_world_plays_frost_wall` (red),
  `guard_the_default_world_keeps_freeze`.
- `crates/rh-server/tests/frost_wall_live_room.rs` (new): `the_live_profiles_select_frost_wall` (red: six flag sets
  of `--runtime source-arena` and `--runtime training`), `a_live_frost_wish_cast_at_the_ground_raises_a_wall_that_a_second_client_receives`
  (red: a hand-driven source-arena room built from the server's own `Settings::sim`/`Settings::arena` on the admitted
  seed-1 map; two clients; the Frost player casts its Wish at open ground 160 u away chosen by the sim's own
  `barriers::wall_segment_for`/`wall_cells`; the SECOND client's State carries field kind 3 with tiles including the
  aim tile, owned by the caster, and its Welcome's HUD term 23 is 1), `the_practice_rooms_welcome_says_frost_wall`
  (red). The practice room seats one human (`crates/rh-server/src/room.rs:913-915`), so the two-client test uses the
  source-arena profile. Debug run time 21 s.
- `crates/rh-server/tests/live_content.rs` (amended, coordinator-approved): `expected_source` and
  `expected_training` state `frost_wish: FrostWish::Wall`; `guard_the_source_arena_runtime_config_field_by_field`,
  `guard_the_lobby_timing_flag_as_the_director_applies_it`, `guard_the_practice_room_config_field_by_field` are red
  today, green after the flip.
- `crates/rh-headless/tests/live_content.rs` (amended): the source scan covers `rh-headless/examples`;
  `no_source_outside_rh_sim_writes_the_live_content_values` is red today on `examples/source_soak.rs:27,29,38,39` and
  `examples/full_map_cost.rs:38,39,42,44`.
- `crates/rh-headless/tests/frost_wall_live.rs` (new): `the_brain_tournament_world_plays_frost_wall` (red),
  `guard_the_human_tournament_world_keeps_the_default_freeze`, `the_live_examples_build_on_live_content` (red: both
  examples carry `FrostWish::Freeze` and no `..SimConfig::live_content()`), and the release-only smoke (ignored in
  debug): `a_live_humanbot_match_with_frost_seats_finishes_under_the_wall` (seed 6),
  `a_live_brain_match_with_frost_seats_keeps_playing_under_the_wall` (seed 2, 3,600 ticks). Both play the unmodified
  `..SimConfig::live_content()` (short lobby timers), so in release they are red today on "a Frost bot raised at
  least one wall" and green after the flip (13 s in release together).

Stall, for the smoke: a seat fault (the runner's own `Fault`), a self-kill (`Death { by: self }`), a Frost caster
moved 20 u or more on the tick its own wall rose (set down by it; a walking step is 8.5 u), or a living caster with
no accepted command in the 200 ticks (10 s) after its wall. The HumanBot match must also end by its own rules within
9,000 ticks.

No `stub:` commit: the implementer edits only `statics.rs` and the two examples, none of which the oracle touched.

## Baseline (packet/P-FROST-WALL-3 @ oracle commit, debug unless stated)
- `cargo test --locked -p rh-sim --test frost_wall_live`: 1 passed, 1 failed (`left: Freeze, right: Wall`).
- `cargo test --locked -p rh-server --test frost_wall_live_room`: 3 failed on assertions (`Freeze` vs `Wall`; the
  practice Welcome `Some(0.0)` vs `Some(1.0)`; the two-client test: no wall row reaches the viewer, `told []`).
- `cargo test --locked -p rh-server --test live_content`: the three guard tables red (`Freeze` vs `Wall` in
  `frost_wish`), the six other tests green.
- `cargo test --locked -p rh-headless --test live_content`: the scan red on the eight example lines above; three green.
- `cargo test --locked -p rh-headless --test frost_wall_live`: 2 red (`the_brain_tournament_world_plays_frost_wall`,
  `the_live_examples_build_on_live_content`), 1 green, 2 ignored in debug.
- Known red on the base, not this packet's: `cargo test -p rh-sim --lib ability_hash_tape_matches_the_base` and one
  digest assertion in `crates/rh-sim/tests/frost_wall_content.rs` (coordinator carry).
- With a TRIAL flip (the one line plus both examples on `..live_content()`, applied locally and reverted, never
  committed): every oracle test above green, the release smoke green (HumanBot: 3,738 ticks, terminated, 3 walls,
  0 faults/self-kills, caster moved 0.0 on landing, 0 idle; Brain: 3,600 ticks, 1 wall, 0 faults/self-kills, caster
  moved 8.5, 0 idle); `cargo test --locked -p rh-server` (debug, `RH_SKIP_PG_TESTS=1`): all 47 test binaries green;
  `cargo test --locked --release -p rh-headless`: all 54 test binaries green (`brain_choices` 6/6, `brain_bots`, `learn_tune_fix`, `tournament_learning`, `tune*` included): no existing test pins a number that the wall moves.

## Established facts (oracle author, 2026-11-14, base `85bfd025e`)

### (1) Every place that states the live value of `frost_wish`
`git grep -n "FrostWish::Freeze\|frost_wish\|FrostWish::Wall" -- crates/` (excluding the sim's own Wall
implementation and its Wall tests), classified:
- **The live value (moves with the flip):** `crates/rh-sim/src/statics.rs:454` (`live_content()`: the one line);
  `crates/rh-server/tests/live_content.rs:86` (`expected_source`) and `:115` (`expected_training`): the
  characterisation tables. Nothing else states it: `crates/rh-server/src/runtime.rs:215-236` (`Settings::sim`)
  builds both live profiles on `..SimConfig::live_content()` and overrides only timers, `hitboxes` and the practice
  fields; `crates/rh-headless/src/tournament_learning.rs:310-328` (`tournament_world`, Brain arm) builds on
  `..SimConfig::live_content()` and overrides only `lifecycle` and the timers. So the source arena, the practice room
  and the Brain tournament/tuner world all move with the one line.
- **Literal copies of the live world (must become `..live_content()`):** `crates/rh-headless/examples/source_soak.rs:40`
  and `crates/rh-headless/examples/full_map_cost.rs:40` (both whole live literals: `RegenInCombat::Off`,
  `CampBuffRule::Themed`, `terrain::Mode::Map`, the full faction mode, plus `frost_wish: Freeze`). The source scan
  (`crates/rh-headless/tests/live_content.rs:142`) covers only `rh-headless/src` and `rh-server/src`, so it does not see
  them; `examples/hitbox_compare.rs:44` already builds on the constructor.
- **Default / non-live worlds that stay Freeze (exhaustive literals or `..Default`):**
  `crates/rh-sim/src/statics.rs:485` (`SimConfig::default()`); `crates/rh-server/src/main.rs:895` (the core runtime:
  bare binary, `--runtime core`, `--first-playable`; not the live content world, outside scope);
  `crates/rh-headless/src/bin/determinism_sweep_support/mod.rs:88` (sweep spec world);
  `crates/rh-server/src/bin/densitybench/engine.rs:212`; `crates/rh-server/examples/connheap.rs:55`;
  `crates/rh-server/src/director.rs:2398`, `crates/rh-server/src/room.rs:2157`, `:3289` (`#[cfg(test)]` fixtures);
  `crates/rh-load/tests/smoke.rs:29`; `crates/rh-server/tests/{account_api.rs:102, account_api_memory.rs:20,
  control.rs:151,307,1405, density.rs:37, equivalence.rs:53, lifecycle.rs:52,459, live.rs:104, pg_e2e.rs:118,387,
  publish.rs:369, result_recovery.rs:146, transport.rs:47}`. Each is a headless/test world with abilities Off or the
  legacy defaults, not a statement of what live plays.
- **Freeze-behaviour fixtures that must STAY Freeze:** `crates/rh-server/tests/frost_wall_welcome.rs` (builds both
  worlds explicitly); `crates/rh-policy/tests/frost_wall_delivery.rs`; `crates/rh-sim/src/barriers*_tests.rs` and
  `crates/rh-sim/tests/frost_wall_*.rs` (explicit `Freeze` guards beside `Wall`); `crates/rh-sim/tests/hash_coverage.rs:692-733`
  (explicit Wall scenario); every parity fixture (default config).
- **Room-side readers of the value (follow the config, no literal):** `crates/rh-server/src/room.rs:656`
  (`hud_content_for(self.sim.config().frost_wish)`: the Welcome's HUD term 23), `crates/rh-policy/src/delivery/projection.rs:703-769`
  (`wire_hud_for`).
- **The core runtime is not reachable from a test:** `Settings::from_args` returns `None` for it
  (`crates/rh-server/tests/live_content.rs:229-237`).

### (4) Operator switch
No flag selects Frost's Wish on a live profile: `crates/rh-server/src/runtime.rs` parses `--hitboxes` (`:61`),
`--lobby-timing` (`:36`), `--runtime` (`:125`), `--map`, `--min-players`, `--fill-bots`, `--max-rooms`,
`--lobby-seconds`, `--fill-seconds`, `--map-pool`, `--signature-landmarks` (`:158-197`); none touches `frost_wish`
(P-SIM-LIVE-CONTENT-1 established the same). After this packet a Freeze room exists only on the core runtime
(`main.rs:895`, no `--runtime`), which is not the live game. This packet adds no flag (the brief says: if none, add
nothing and say so). Rolling back is the one line.

### Bots and Frost's Wish today
- Both bot stacks know five Wish rows and no wall: `crates/rh-policy/src/bots/wish.rs:152-168` (`WISHES[0]`, Freeze:
  `ai: [Control, Peel, Engage]`, `TargetRule::Unit { range: 450 }`). The sim keeps the wall under Freeze's id
  (`crates/rh-sim/src/abilities/mod.rs:390-397`, `definition_for`), and the observation reports the bot's own Wish as
  `AbilityId::Freeze` (`crates/rh-policy/src/bots/perception.rs:484-496`), so in a Wall world a bot still plans a
  Freeze: the shared cast core (`crates/rh-policy/src/bots/wish/source_core.rs:271-325`, `engage`/`peel`) casts at a
  foe or chaser's position with its unit id. HumanBot: `crates/rh-policy/src/bots/humanizer.rs:480-548` turns it into
  `Command::Cast { slot: "wish", x, y, id }` at the target's position; `crates/rh-policy/src/bots/bot.rs:851-866`
  (`emit_command`, shared by HumanBot and BrainBot) submits `PublicCommand::Cast`. The Brain decides in
  `crates/rh-policy/src/bots/temporal_percept/modules/wishes.rs:319-350` (`cast_intent` over the same
  `source_decide_cast`).
- The sim under `Wall` reads the cast as a point cast at `(x, y)` (`crates/rh-sim/src/systems/abilities/mod.rs:248-270`:
  a Point rule ignores the unit check and lands at the point if `blink`-style placement allows): the wall is raised
  centred on the target's position at cast start, square to the aim, and whoever it lands on is set down on their
  own side (DEV-029). Legacy (above) instead drops it 70% of the way to a CHASING enemy, and never at a foe standing off.

### (3) Bot evidence (release, 2026-11-14)
Runner: a temporary probe over `rh_headless::Env` (not committed), 8 bots on the admitted seed-1 map, the live world
`SimConfig { min_players: 1, lobby_seconds: 5., fill_seconds: 3., frost_wish, ..SimConfig::live_content() }`, seats
`BotKind::{Human, Brain}.policy(..)` with factions `FactionId::ALL[(i + seed) % 5]` (as `examples/source_soak.rs` and
`tests/brain_bots.rs` deal them: two Frost seats when `(i + seed) % 5 == 3` twice). Counted: `CastStarted`/`CastLanded`
of Frost's Wish by a Frost seat, `Death`s, `Death { by: self }`, seat faults, the caster's and the nearest other
fighter's movement on the landing tick, the longest run of ticks a living fighter's position is unchanged. The committed
smoke (`crates/rh-headless/tests/frost_wall_live.rs`) reproduces the HumanBot seed 6 and Brain seed 2 rows exactly.

| Run | Wish | Seeds | Ended by rules / cut off | Mean length (ticks) | Frost casts (landed) | Faults | Self-kills | Frost deaths | Frost wins |
|---|---|---|---|---|---|---|---|---|---|
| HumanBot, cap 9,000 | Freeze | 1-30 | 24 / 6 | 3,100 | 22 (22) | 0 | 0 | 44 | 2 |
| HumanBot, cap 9,000 | Wall | 1-30 | 26 / 4 | 2,714 | 9 (9) | 0 | 0 | 46 | 2 |
| Brain, cap 14,000 | Freeze | 1-6 | 0 / 6 | 14,000 | 20 (20) | 0 | 0 | 2 | 0 |
| Brain, cap 14,000 | Wall | 1-6 | 0 / 6 | 14,000 | 23 (23) | 0 | 0 | 7 | 0 |

Single seeds (the smoke's): HumanBot seed 6: Freeze cut off at 9,000 (9 casts), Wall ended at 3,738 (Holy winner,
3 walls). Brain seed 2: Freeze 7 casts, Wall 11 walls over 14,000 ticks (first at tick 2,917); both cut off (Brain
matches outlast 14,000 ticks on this map in both modes, as `tests/brain_bots.rs` records).

Where the walls land (29 landings measured: HumanBot seeds 1-30, Brain seeds 2, 3 and 6): 62 to 381 u from the caster (the min range 64 holds; HumanBot
casts at foes 380 u away, which legacy never does); the nearest other fighter is 38 to 113 u from the aim point and is
set down 0 to 61 u on the landing tick: the wall rises on or beside the target (the bots aim at the unit's position).
The caster moved 0 to 8.9 u on every landing tick (an ordinary walking step): no caster was set down by its own wall.
No CastEnded (no fizzle) in either mode. Longest still runs of Frost seats are of the same size under Freeze and Wall
on every seed (e.g. HumanBot seed 18: 8,641 Freeze, 913 Wall; Brain seed 1: 453/721 vs 640/721); the very long ones
are end-game survivors, present for every faction and under Freeze too.

**Decision: the bot aiming rule is NOT in this packet.** The bots cast the wall as a unit-aimed Freeze: it lands on or
beside the target and sets the target down on its own side, which wastes the cast (it rarely separates a chaser from
the caster) but harms nobody: no stall, no fault, no self-kill, no caster displaced, every match finishes or runs to
its cap as under Freeze, Frost's win count is unchanged (HumanBot 2/30 both). Brain Frost seats die more under the
wall (7 vs 2 over 6 seeds), consistent with the owner's ruling that Freeze was too strong; HumanBot Frost deaths
44 vs 46. Recorded follow-up (coordinator to list it): **P-FROST-WALL-BOTS-1**, port legacy's `WALL_PEEL_*` rule
(`78dd8bd4` `abilityPolicy.ts:54-58`, `:97-101`, `:113-123`, `:164-167`; test `abilityPolicy.test.ts:217-231`):
a sixth Wish row (Frost Wall: `ai: [Peel, Escape]`, `TargetRule::Point { range: 450, min_range: 64 }`) in
`crates/rh-policy/src/bots/wish.rs`, a `wallBetween` branch in `wish/source_core.rs` `peel`/`escape`, and the bot's
own Wish view reporting the wall when the room's `frost_wish` is `Wall` (the HUD term 23 in the Welcome, or the
observation). It changes `POLICY_CONTRACT_VERSION`-level behaviour of live bots and belongs with the learner runs.

### Web round, once this lands (with P-UNITY-FROST-WALL-1)
A source-arena room on the Web client must show: the Welcome-driven Frost HUD naming Frost Wall; R shows the aim
preview clamped to 450 u; a click raises the wall (a row of ice tiles square to the aim) that a second browser sees
for 4 s; bodies and melee stop at it while shots pass; a player it lands on is set down on its own side; fill bots
playing Frost cast walls onto their targets (expected, see the decision) and keep playing.

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"`
- `cargo test --locked -p rh-sim --test frost_wall_live`
- `cargo test --locked -p rh-server --test frost_wall_live_room --test live_content --test frost_wall_welcome`
- `cargo test --locked -p rh-headless --test frost_wall_live --test live_content`
- `cargo test --locked --release -p rh-headless --test frost_wall_live` (the smoke, 13 s)
- `cargo test --locked --release -p rh-headless --test brain_choices --test brain_bots` (the Brain world moves)
- `cargo run -p rh-parity --bin parity-report` (all MATCH, unchanged: default config)
- `cargo build --locked -p rh-headless --examples`
- `scripts/gate.sh --oracle packet/P-FROST-WALL-3`

## 10. Risk and suggested model tier
Opus. One line changes what every live player gets; the tests above are the net. The risk is a test that pinned the
Brain world's numbers moving (see Baseline, trial) and the Web round.

## 11. Known traps
- The practice room seats exactly one human: two-client checks need the source-arena profile.
- Do not set `frost_wish` in `Settings::sim`, `tournament_world` or the examples: the value lives only in
  `live_content()` (the scan and `the_live_examples_build_on_live_content` check the examples).
- Do not add a `FrostWish::Wall` marker to the scan: `crates/rh-server/src/room.rs:331` matches on it legitimately.
- `examples/source_soak.rs` keeps its `hitboxes` argument (default `legacy`) and short timers; `full_map_cost.rs`
  keeps `Archetypes` (the live value, so `..live_content()` covers it) and its timers.
