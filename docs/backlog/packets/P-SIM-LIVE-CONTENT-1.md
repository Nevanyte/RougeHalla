# P-SIM-LIVE-CONTENT-1: one definition of the live content world, used by the server and by every tool that says "as live"

- **Serves:** owner direction 2026-11-13/14 (architecture so later changes are small); owner decision 8 (the learner
  and tuner must play the game the live server plays); reviewer-opus note on P-BOT-BRAIN-CHOICES-1 (2026-11-14)
- **Implementer tier:** implementer-opus (cross-crate: `rh-sim`, `rh-server`, `rh-headless`)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-BOT-BRAIN-CHOICES-1
- **D-rules touched:** none intended: no behaviour of the live server changes (the oracle pins its `SimConfig` field by
  field before and after) · no wire, checkpoint, replay or content-hash change

## 1. ID and outcome
"The world the live server plays" is written down in several places. The server builds it in
`crates/rh-server/src/runtime.rs:209-246` (`Settings::sim`, with `LIVE_DEFAULT_HITBOXES = Archetypes` at `:50`).
P-BOT-BRAIN-CHOICES-1 copied its content fields as literals into `crates/rh-headless/src/tournament_learning.rs`
(`tournament_world`'s Brain arm) so the learner and the tuner play a real world, and already got one field wrong: the
Brain world plays `LegacyCircle` hitboxes while live plays `Archetypes`. Four tests hold further copies
(`brain_bots.rs`, `source_arena_soak.rs`, `bot_loot.rs`, `hitbox_compare.rs`). Each time the live runtime gains a
switch (the camp buff themes, Frost Wall, regen in combat), every copy has to be found and changed, and a missed one
makes a tool measure a game nobody plays.

When this lands there is one constructor in `rh-sim` for the live content world (suggested: `SimConfig::live_content()`
beside `SimConfig`'s definition in `statics.rs`, returning every content field including the live hitbox mode; the
`LIVE_DEFAULT_HITBOXES` value lives in or is re-exported from `rh-sim`, because `rh-headless` cannot see
`rh-server`). The server's `Settings::sim` builds on it and applies only what is the server's own: timers and
lifecycle, the practice-room overrides, and operator flags (`--hitboxes`, `--frost-wish`, ...). `tournament_world`'s
Brain arm builds on it and applies only the plan's timers. Adding a content switch later is one line in one place.

## 2. Dependencies
P-BOT-BRAIN-CHOICES-1 (merged on the integration side).

## 3. Relevant legacy paths
none (structure only)

## 5. Exclusive write scope
- `crates/rh-sim/src/statics.rs` (the constructor; no field added or removed, no default changed)
- `crates/rh-server/src/runtime.rs` (`Settings::sim` and the constant's home)
- `crates/rh-headless/src/tournament_learning.rs` (the Brain arm)
- the four tests that hold a copy, ONLY to call the constructor where they mean "as live" and where doing so changes
  no expected value (a test whose pinned numbers would move keeps its literal copy and is listed in the hand-off)
- not `SimConfig::default()`, not the parity harness's configuration, not `Cargo.lock`

## 7. Behaviour to preserve
- The live server's `SimConfig` for every runtime and flag combination is field-for-field what it is today.
- Every pinned digest, hash tape, parity fixture and tournament golden is unchanged, EXCEPT the Brain tournament and
  Brain tuner outputs, which change because their hitbox mode becomes the live one (no test pins a Brain-policy
  digest today: confirm; the `brain_choices` oracle pins key kinds, not counts).

## 8. Acceptance checks
- `rh-server`: for the source-arena runtime, `Settings::sim()` equals `SimConfig::live_content()` in every field
  except a named list (timers, lifecycle, flags); the list is in the test, so a new content field that the server sets
  and the constructor does not is a failure. Before the change, a characterisation test records today's server
  configs (default flags, each operator flag, the practice room): they must be identical after.
- `rh-headless`: the Brain world's content fields equal `SimConfig::live_content()`'s, hitboxes included (red today:
  `LegacyCircle`).
- A source check: no literal assignment of the content fields outside the constructor in `rh-headless/src` and
  `rh-server/src` (the oracle author decides how strict; the point is that the next copy fails a test).
- `scripts/gate.sh --oracle packet/P-SIM-LIVE-CONTENT-1` passes.

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test --locked -p rh-server -p rh-headless`; `cargo run -p rh-parity --bin parity-report`

## 10. Risk and suggested model tier
Opus. Small in lines; the risk is changing what the live server plays without meaning to, which is what the
characterisation test is for.

## 11. Known traps
- `rh-server` depends on `rh-headless`, not the reverse: the constant cannot stay in `rh-server`.
- The practice room and the "core" runtime are not the live content world: they keep their own overrides.
- `rh_parity::HITBOXES` is `LegacyCircle` on purpose (parity against legacy): untouched.

## Notes from previous attempts
