# P-SIM-LIVE-CONTENT-1: one definition of the live content world, used by the server and by every tool that says "as live"

- **Serves:** owner direction 2026-11-13/14 (architecture so later changes are small); owner decision 8 (the learner
  and tuner must play the game the live server plays); reviewer-opus note on P-BOT-BRAIN-CHOICES-1 (2026-11-14)
- **Implementer tier:** implementer-opus (cross-crate: `rh-sim`, `rh-server`, `rh-headless`)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-BOT-BRAIN-CHOICES-1 (packet branched from `coord/int-35` @ b4106a2d8)
- **D-rules touched:** D1: structure only, no legacy behaviour; the oracle is a characterisation of today's live
  `SimConfig` (green) plus structural tests (red). D2: n/a. D5/D6/D9: none. No wire, checkpoint, replay or content-hash
  change; the only behaviour that moves is the Brain tournament/tuner world's hitbox mode (`LegacyCircle` to the live
  `Archetypes`), which is the point of the packet.

## 1. ID and outcome
"The world the live server plays" is written down in several places. The server builds it in
`crates/rh-server/src/runtime.rs:209-247` (`Settings::sim`, with `LIVE_DEFAULT_HITBOXES = Archetypes` at `:50-51`).
P-BOT-BRAIN-CHOICES-1 copied its content fields as literals into `crates/rh-headless/src/tournament_learning.rs:319-333`
(`tournament_world`'s Brain arm, `:309-335`) so the learner and the tuner play a real world, and already got one field
wrong: the Brain world plays `LegacyCircle` hitboxes (it never sets `hitboxes`, so `sim_config_for`'s default stays)
while live plays `Archetypes`. Each time the live runtime gains a switch (the camp buff themes, Frost Wall, regen in
combat), every copy has to be found and changed, and a missed one makes a tool measure a game nobody plays.

When this lands there is one constructor in `rh-sim` for the live content world, `SimConfig::live_content()` beside
`SimConfig`'s definition in `crates/rh-sim/src/statics.rs`, returning every content field including the live hitbox
mode. The server's `Settings::sim` builds on it and applies only what is the server's own: the timers
(`min_players`, `lobby_seconds`, `fill_seconds`), the lifecycle where it differs, the practice-room overrides, and the
operator flag `--hitboxes`. `tournament_world`'s Brain arm builds on it and applies only the plan's timers
(`lifecycle`, `min_players`, `lobby_seconds`, `fill_seconds` from `sim_config_for(plan)`). Adding a content switch
later is one line in one place.

## 2. Dependencies
P-BOT-BRAIN-CHOICES-1 (merged on the integration side; in `coord/int-35`).

## 3. Relevant legacy paths
none (structure only; no legacy behaviour is ported or changed).

## 4. New paths
none for the implementer (the oracle files below are already committed).

## 5. Exclusive write scope
- `crates/rh-sim/src/statics.rs`: replace the stub body of `SimConfig::live_content()`; add the live hitbox constant
  here (suggested `pub const LIVE_DEFAULT_HITBOXES: HitboxMode = HitboxMode::Archetypes;`, reachable as
  `rh_sim::statics::LIVE_DEFAULT_HITBOXES`; `statics` is `pub mod` in `lib.rs:57`, so `lib.rs` need not change). No
  field added or removed, no default changed, `SimConfig::default()` untouched.
- `crates/rh-server/src/runtime.rs`: `Settings::sim` built on the constructor; `LIVE_DEFAULT_HITBOXES` becomes a
  re-export (`pub use rh_sim::statics::LIVE_DEFAULT_HITBOXES;` or `pub const … = rh_sim::…;`): it MUST stay nameable
  as `rh_server::runtime::LIVE_DEFAULT_HITBOXES`, because the oracle and the existing `runtime::tests` use that path.
  The existing `#[cfg(test)] mod tests` in this file is not edited.
- `crates/rh-headless/src/tournament_learning.rs`: the Brain arm only (and its doc comment).
- Optionally, where the copy means "as live" and the change moves no expected value:
  `crates/rh-headless/tests/source_arena_soak.rs` (`live_config`, `:13-35`) and
  `crates/rh-headless/examples/hitbox_compare.rs` (`live_config`, `:38-61`). See "Established facts" for the four
  copies; `brain_bots.rs` and `bot_loot.rs` keep their literals.
- Not: `SimConfig::default()`, `crates/rh-server/src/main.rs` (the core runtime), the parity harness configuration
  (`rh_parity::HITBOXES`), `crates/rh-headless/src/bin/camp_bench.rs`, `Cargo.lock`, any oracle file.

## 6. Contracts and references
- C-TICK, C-RNG, C-PARITY untouched: no system, draw, hash or fixture changes.
- ADR 0024 (archetype hitboxes; the live default flip 2026-11-10, DEV-009/DEV-010).
- `crates/rh-server/src/runtime.rs` `tests::which_runtimes_default_to_which_hitbox_mode` (the deliberate pin of the
  live default) stays as it is.

## 7. Behaviour to preserve
- The live server's `SimConfig` for every runtime and flag combination is field-for-field what it is today (pinned by
  the `guard_*` tests in `crates/rh-server/tests/live_content.rs`).
- Every pinned digest, hash tape, parity fixture and tournament golden is unchanged, EXCEPT the Brain tournament and
  Brain tuner outputs, which change because their hitbox mode becomes the live one. No test pins a Brain-policy digest
  (checked: `tournament_learning.rs` and `learn_tune_fix.rs` play `SeatPolicy::Brain` on their own `fast_config()` and
  the practice arena, not through `tournament_world`; `tune_evidence*.rs` pass `--policy human`). BUT see
  "Established facts" (brain_choices): one existing loose assertion goes red under `Archetypes` on its pinned seed.
- `content_hash` is unchanged (see Established facts).

## 8. Acceptance checks
- `crates/rh-server/tests/live_content.rs`: all green. The `guard_*` tests are green before and after; the four
  structural tests go green.
- `crates/rh-headless/tests/live_content.rs`: all green (the Brain world is `live_content()` plus the plan's timers,
  hitboxes included; the source scan finds no live-only literal).
- `crates/rh-headless/tests/brain_choices.rs`: green in release, which needs the owner-approved change described in
  "Established facts" first.
- `cargo test --locked -p rh-sim --test content` (and the other `*_content` suites) unchanged and green.
- `scripts/gate.sh --oracle packet/P-SIM-LIVE-CONTENT-1` passes.

### The source-check rule (c)
`no_source_outside_rh_sim_writes_the_live_content_values` scans every `.rs` file under `crates/rh-headless/src` and
`crates/rh-server/src`, excluding test-only code (files named `tests.rs` or `*_tests.rs`, files under a `tests/`
directory, and every `#[cfg(test)]` item, an inline `mod … { … }` counted by braces), with `//` comments removed. A line
fails when it contains a **live-only content value**: `RegenInCombat::Off`, `CampBuffRule::Themed`,
`EngagementHolyPlagueFireFrostSentencedFireRoam` or `terrain::Mode::Map`. These are the values that only the live
content world writes; after the packet they are written only in `SimConfig::live_content()` (in `rh-sim`, not
scanned). One sanctioned exception: `rh-headless/src/bin/camp_bench.rs` may write the full faction mode (its world is
a camp bench: regen off, quests off, hazards All, consumables off, lifecycle Off; not a live copy). The rule does not
forbid writing a content field in general (dozens of benches and test literals write `abilities`, `quests`,
`FrostWish::Freeze`, `RegenInCombat::Legacy` …); it catches the next copy of the live world, which must carry the live
switches. The scan's own parsing is pinned by `guard_the_source_scan_sees_through_comments_and_test_modules`.
Today it reports exactly `rh-headless/src/tournament_learning.rs:322,323,326,328` and
`rh-server/src/runtime.rs:215,218,229,232`.

## Oracle files (read-only for implementers)
- `crates/rh-server/tests/live_content.rs`
- `crates/rh-headless/tests/live_content.rs`
- (existing, unchanged) `crates/rh-headless/tests/brain_choices.rs`, `crates/rh-server/tests/camp_buffs_profile.rs`,
  `crates/rh-server/src/runtime.rs` `mod tests`

The `stub:` commit (implementer replaces it): `crates/rh-sim/src/statics.rs`, `impl SimConfig { pub fn
live_content() -> Self { Self::default() } }`.

## Baseline (packet/P-SIM-LIVE-CONTENT-1, after the stub)
`cargo test --locked -p rh-server --test live_content`: 5 passed, 4 failed, every failure an `assert_eq!`:
- green guards: `guard_the_live_default_hitbox_mode_is_archetypes`, `guard_the_source_arena_runtime_config_field_by_field`
  (default flags; `--hitboxes archetypes|legacy`; `--min-players/--lobby-seconds/--fill-seconds`; `--map-pool`,
  `--signature-landmarks`, `--fill-bots`, `--max-rooms`, `--lobby-timing matchmaking` change nothing in
  `Settings::sim`), `guard_the_lobby_timing_flag_as_the_director_applies_it` (matchmaking gives min_players 8,
  lobby 15 s, fill 0 after `apply_lobby_timing`), `guard_the_practice_room_config_field_by_field`,
  `guard_what_is_reachable_of_the_core_runtime`.
- red: `live_content_is_the_source_arena_world_minus_the_servers_named_fields` (left `SimConfig::default()` with the
  server's timers vs the server's config), `live_content_carries_the_live_default_hitbox_mode` (`LegacyCircle` vs
  `Archetypes`), `the_operator_flags_override_live_content_only_in_their_own_fields`,
  `the_practice_room_is_live_content_plus_the_named_practice_overrides`.

`cargo test --locked -p rh-headless --test live_content`: 1 passed, 3 failed on assertions:
- green: `guard_the_source_scan_sees_through_comments_and_test_modules`.
- red: `the_brain_tournament_world_is_live_content_with_the_plans_timers` (`assert_eq!`),
  `the_brain_tournament_world_plays_the_live_hitbox_mode` (`assert_ne!(live_content(), default())`),
  `no_source_outside_rh_sim_writes_the_live_content_values` (the eight lines listed above).

Identities: none move (no `CHECKPOINT_FORMAT`, `REPLAY_FORMAT`, `OBSERVATION_VERSION`, `PROTOCOL_VERSION` or content
hash change).

## Established facts (oracle author, 2026-11-14)
- **Operator flags that change a `SimConfig` field** (runtime.rs): `--hitboxes` (`hitboxes`), `--min-players`,
  `--lobby-seconds`, `--fill-seconds`. `--lobby-timing matchmaking` changes `min_players`/`lobby_seconds`/
  `fill_seconds` later, in `director.rs:957` (`BotFillConfig::apply_lobby_timing`, `bot_fill.rs:189-195`), not in
  `Settings::sim`. **There is no `--frost-wish`, camp-buff or regen flag**: `frost_wish`, `camp_buffs`,
  `regen_in_combat` are fixed in `Settings::sim` (`:215-219`). The brief's earlier mention of `--frost-wish` was wrong.
- **The practice room** (`--runtime training`) is today the same literal with `training`, `dummies`, `quests`,
  `hazards`, `lifecycle`, `mob_mode`, `initial_loot` and the timers overridden: it shares every other live content
  value (regen, regen_in_combat Off, camp_buffs Themed, faction mode, abilities Full, walk hints, hitboxes). The oracle
  pins that (`the_practice_room_is_live_content_plus_the_named_practice_overrides`).
- **The core runtime** (no `--runtime`, `--runtime core`, `--first-playable`) builds its config inline in
  `crates/rh-server/src/main.rs:889-932` (`--wish-full`, first-playable switches); `Settings::from_args` returns `None`
  for it, so it is not reachable from an integration test. Only `core_hitboxes` is pinned. It is NOT the live content
  world and `main.rs` is outside the write scope, which is what keeps it unchanged.
- **Lifecycle**: the source-arena runtime plays `ArenaMode::Source(ArenaRules::default())`. The oracle compares
  `live_content()` to it with `lifecycle` overwritten, so `live_content()` may carry `Source(default)` (then
  `Settings::sim` overrides only for training) or anything else, as long as the server's result is unchanged.
- **The four test copies** (none is in the source scan, which covers `src/` only):
  - `crates/rh-headless/tests/brain_bots.rs:39-57`: NOT the live world. Differs in `hazards: All` (live `Map`),
    `regen_in_combat` Legacy (live Off), `camp_buffs` Legacy (live Themed), `hitboxes: LegacyCircle` (live Archetypes),
    plus timers. Its passivity floors and measured numbers (P-BOT-BRAIN-CONTINUITY-1) were measured on this config;
    using live would move them. Keeps its literal; its header calls it "the live configuration", which is stale.
  - `crates/rh-headless/tests/bot_loot.rs:11-28` (`#[ignore]`): NOT the live world (same four differences). Asserts
    determinism and counts > 0; switching changes what it measures. Keep the literal (it is ignored, so a switch would
    go unrun by the gate).
  - `crates/rh-headless/tests/source_arena_soak.rs:13-35` (`#[ignore]`): the live world exactly, except the timers
    (`min_players 1`, `lobby 5`, `fill 3`) and the `hitboxes` parameter (it runs both modes). Can become
    `SimConfig { hitboxes, min_players: 1, lobby_seconds: 5., fill_seconds: 3., ..SimConfig::live_content() }` with
    an identical value (lifecycle `Source(default)` either way, if `live_content()` carries it; otherwise set it).
  - `crates/rh-headless/examples/hitbox_compare.rs:38-61` (an example, not a test): the live world except timers and
    the `(hitboxes, mob_spacing)` parameters; same conversion, identical value.
- **brain_choices under `Archetypes`** (measured 2026-11-14, release, by setting `hitboxes: Archetypes` in the Brain
  arm temporarily): 4 of 5 tests stay green; `a_learning_brain_tournament_records_legacys_choice_kinds_in_sane_numbers`
  goes RED at `brain_choices.rs:187` ("at least one seat makes a second-weapon choice in this run"): the plan's seed 7
  records 0 `second|…` keys under `Archetypes` (2 under `LegacyCircle`). `second` choices are sparse in both modes on
  this plan (2 games, 3 seats, 3 minutes, patience 60, sudden 20): seeds 1-12 record a second on seeds 7, 8, 10
  under `LegacyCircle` and on seeds 8, 10 only under `Archetypes` (8 and 10 give 1 each, in both modes; 3-game plans
  add nothing). Openers are recorded by 6 of 6 seats on every seed in both modes. `two_seeded_…byte_identical…` and
  `the_tournament_binary_learns_…` compare two runs/the binary with the library, not fixed bytes: green under
  `Archetypes`. **This existing oracle must change for the packet to pass, which needs the owner's approval**: the
  smallest change is the seed 7 to 8 in both `plan()` (`:45`) and the binary test's `--seed`, `"7"` (`:230-231`), which
  keeps every assertion and passes in both hitbox modes on the measurement above (one second; thin). The oracle author
  did not edit it. Without that approval the implementer cannot go green; the coordinator decides before dispatch.
- **content_hash**: `content::content_hash()` (`crates/rh-sim/src/content.rs:454-489`) folds the content registry,
  stagger table, map/coliseum definitions, stat-fold, mob catalog and runtime words; it does not read `SimConfig`.
  Adding a constructor adds no gameplay constant. The implementer checks: `git diff packet/P-SIM-LIVE-CONTENT-1 --
  crates/rh-sim/src/content.rs` is empty, and `cargo test --locked -p rh-sim --test content` (plus the other
  `*_content` suites) and `cargo test --locked -p rh-server --test map_anchors --test dress_bake` (which compare
  against `content_hash()`) stay green.
- **Where `LIVE_DEFAULT_HITBOXES` lives**: `rh-server` depends on `rh-headless`, not the reverse, so the value moves to
  `rh-sim` (`statics.rs`, beside `SimConfig`) and `rh-server::runtime` re-exports it under the same name (the existing
  `runtime::tests`, `core_hitboxes` and the oracle use `rh_server::runtime::LIVE_DEFAULT_HITBOXES`). Flipping the
  live default stays a deliberate change: the constant, `runtime::tests::which_runtimes_default_to_which_hitbox_mode`,
  and the oracle's `guard_the_live_default_hitbox_mode_is_archetypes` and source-arena table.

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"`
- `cargo test --locked -p rh-server --test live_content`
- `cargo test --locked -p rh-headless --test live_content`
- `cargo test --locked --release -p rh-headless --test brain_choices` (after the approved seed change)
- `cargo test --locked -p rh-server -p rh-headless`; `cargo test --locked -p rh-sim --test content`
- `cargo run -p rh-parity --bin parity-report` (unchanged)
- `scripts/gate.sh --oracle packet/P-SIM-LIVE-CONTENT-1`

## 10. Risk and suggested model tier
Opus. Small in lines; the risk is changing what the live server plays without meaning to, which is what the
characterisation tests are for.

## 11. Known traps
- `rh-server` depends on `rh-headless`, not the reverse: the constant cannot stay only in `rh-server`.
- The practice room and the "core" runtime are not the live content world: training keeps its overrides on top of
  `live_content()`; core stays in `main.rs`, untouched.
- `rh_parity::HITBOXES` is `LegacyCircle` on purpose (parity against legacy): untouched.
- `SimConfig::default()` must not change (tests, parity, benches and every hash depend on it).
- Do not move the live values into `sim_config_for`/`default_sim_config`: the Human tournament's world must stay
  byte-identical (`brain_choices::guard_the_default_seats_play_todays_world`).
- `brain_choices` has no debug skip: the gate runs it in whatever profile it uses, and it is slow in debug; iterate on
  it in release.

## Notes from previous attempts
