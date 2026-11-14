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
   and the scan is widened to `crates/rh-headless/examples`: `examples/source_soak.rs:23-42`,
   `examples/full_map_cost.rs:33-51`.
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
(filled at the oracle commit)

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

(Bot evidence and the decision follow the trial runs below.)
