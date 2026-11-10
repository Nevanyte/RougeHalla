# Private Brain native composition — evidence (P-BOT-BRAIN-NATIVE-1)

Status: **implementation complete, gates green; awaiting Root sealing and independent review (no admission claim)**. This directory is the new native evidence area leased by Root in
[P-BOT-BRAIN-NATIVE-1](../../backlog/packets/P-BOT-BRAIN-NATIVE-1.md) ("Final Active Root implementation allocation",
2026-11-10, final interface SHA256 `3c9fc0c5b7f29247f9c0bba53c68ca48b02afd2e3ea0f0bd203968f21fb2ae0f`). It records only later
receipts; the frozen source/tool/corpus/expectations stay immutable.

## Scope implemented

New private composition code:

- `crates/rh-policy/src/bots/temporal_percept/brain.rs` — the unchanged source `createBrain` coordinator (Memory →
  Strategy → cadence/act → Tactics/modules → Humanizer, stall/grab/engagement, stats/end).
- `.../brain/{config,percept,host}.rs` — caller config/map/path-service/statistics boundary, the complete declared
  source-shaped private Percept, the actual shared module host/registry and per-Brain guarded wrapper boundary.
- `.../brain/adapters.rs` — complete Percept projections into Memory/Strategy/Tactics/Modules/Humanizer inputs and the
  one path adapter over the caller service + borrowed room allowance; recording adapters for knowledge/learned/RNG.
- `.../brain/trace.rs` — lossless tagged value model, per-case identity table, ordered recorder, source-shape encoders
  and the exact comparison utilities.
- `.../brain/source_input.rs` (cfg(test)) — complete checked intake of `parity/policy/bot-private-brain/source.json`
  (envelope, profile, maps, 31 cases / 855 operations, 6 Hand profiles / 12 operations, 32 Knowledge constructors /
  2,240 draws / 111 call bindings) with atomic rejection and four-status (`alive`/`dead`/`mia`/`lobby`) Brain intake.
- `.../brain/tests.rs` (cfg(test)) — native replay harness: 31/855 + setup traces + Hand 6/12 + Knowledge 32/2240/111.
- `.../brain/controls_tests.rs` (cfg(test)) — the 30 frozen strict-intake negatives, the 40 reached assertions and
  same-entrypoint semantic/atomic-nonadvance controls.

Existing-file edits (exact Root lease): `temporal_percept.rs` one `mod brain;`; `strategy.rs` parent-visible
`Strategy`/`StrategyOptions` re-export; `strategy/types.rs` explicit `+ 'a` boxed-module lifetime and the
default-unavailable object-safe `PathApi::module_paths` capability; `modules.rs` parent-visible types/registry + four
builtin struct exports and cfg(test) `source_reader`/`source_trace`/`parse_raw` access.

No accepted live observation, validate/submit, bot activation, wire/protocol, client/network, persistence, learning store,
dependencies or shared status record is changed. The packet does not close P-BOT-FAIR-ACTIVATION-1 or full gameplay.

## Frozen source identity

Corpus files under `parity/policy/bot-private-brain/` are immutable and compared by SHA256 (receipts added with final run):

| File | SHA256 |
| --- | --- |
| `source.json` | `ed054bfd2663f4aa64d08f517295d07459c4543b92cae99c0356fb0d14ae3943` |
| `coverage.json` | `c4ea7643d5dd16432f8788a8bd22ebe0bb6bdee45fa89902588e7f39d51a4c21` |
| `controls.json` | `13a366f62aef962352656817843a15d9ff222af3c93641d609e35a34b45b1307` |
| `manifest.json` | `f51b0f3a8766e613acef9263d1537fcc27ce03de1db40918da6ac11441161927` |

Frozen witness commit: `6aaa4c6d33dad8a47ab7957b41d420fa78954af6` (integrated `5a5a28c6`, review `8fa97f24`).
Dispatch base: `c050d938da37562fea98497d7a67dedcb5477b50` (`codex/deepseek-private-brain`).
Worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-brain-native`.
Toolchain: `rustc 1.97.0 (2d8144b78 2026-07-07)`, offline/locked, own target `target-deepseek-private-brain`,
`CARGO_INCREMENTAL=0`. Target caches are outside the seal.

## Declared limits (limits 1 and 2 below are HISTORICAL: closed by the ROOT-BRIDGE-GRANT draw/path bridge; state-delta recovery, 4096 search and lane-split comparator were removed)

1. **Hunt path callback arguments.** `research` — `Strategy PathApi::walk_mob` is not overridden because
   `strategy::mob_hunt::HuntMobLike` is sealed private to the strategy module. The 4 frozen hunt `paths.walk` rows with
   rich `MobLike` arguments cannot be reproduced exactly until Root grants the one-line hunk
   `pub(super) use mob_hunt::HuntMobLike;` in `crates/rh-policy/src/bots/temporal_percept/strategy.rs` (plus a 6-line
   adapter override; no behavior change). Every other path callback is exact; the fallback records point arguments only.
2. **Humanizer concrete-Rng lane interleaving.** The admitted `Humanizer::Context` takes concrete `&mut Rng` lanes, so
   its motor/lapse draws cannot be wrapped at the draw site. The Brain recovers each lane's exact values/count from the
   pure mulberry state delta (per-lane order and counts exact); cross-lane interleaving *inside one hand call* is not
   observable through that public API and is compared declaratively (per-lane transcript equality + counts), not
   silently reordered. A future test-only draw hook (e.g. in `bots/random.rs`) would close it; not requested unless Root
   requires exact global RNG transcript equality for the hand lanes.
3. Source witness limits preserved: empty module list has no observer/runtime-RNG context; current Tactics never emits
   cast/menu-base replacement; the radius0 empty-route throw is the labelled test-service boundary.

## Final gate receipts

Base HEAD (commit parent): `c050d938da37562fea98497d7a67dedcb5477b50`. cwd for every command:
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-brain-native`. Env: `CARGO_TARGET_DIR=target-deepseek-private-brain
CARGO_INCREMENTAL=0`, rustc 1.97.0, `--offline --locked`. Raw logs: `logs/*.log` (final run on the committed tree).

Root-granted final change this session: `bots/paths.rs` two-site `rh_sim::math::hypot` -> `rh_sim::mapgen::certify::source_hypot`
(`WalkAnswer` straight-line fallback and `path_length()` segment distance). This closes the 1-ULP `paths.walk` mismatches
(core-farm-route op[11] trace[29], core-coliseum op[7] trace[17]). No existing path/budget/paths test pinned the old value.
Also removed: the leftover `compare_transcript_lane_split` comparator (+ `split_transcript`, `without_sequence`, `rng_lane`, its
unit test) from `brain/trace.rs`; `cargo fmt` applied to lease files; one `unused_braces` fix at `brain.rs` module-goals closure.

| Gate | Command | Exit | Result |
| --- | --- | --- | --- |
| Focused Brain | `cargo test -p rh-policy --lib temporal_percept::brain` | 0 | 38 passed, 0 failed (includes replay_all_frozen_brain_histories 31/855, hand 6/12, knowledge 32/2240/111, 40 reached, 30 negatives, adjacent cross-lane swap rejected by complete comparator, persistent Brain Send) |
| Draw-trace bridge | `... --lib draw_trace` | 0 | 5 passed |
| Paths filter | `... --lib paths` | 0 | 5 passed |
| Full policy lib | `cargo test -p rh-policy --lib` | 0 | 432 passed, 0 failed |
| Format | `cargo fmt --check` | 0 | clean |
| Clippy default | `cargo clippy -p rh-policy --all-targets -- -D warnings` | 0 | clean |
| Clippy all-features | `cargo clippy -p rh-policy --all-targets --all-features -- -D warnings` | 0 | clean |

History (kept, not hidden): `logs/pre-fmt-run/` (all green except `cargo fmt --check` exit 1, formatting only) and
`logs/pre-brace-fix-run/` (after fmt: both clippy runs exit 101 with one `unused_braces` error at `brain.rs:1474`, fixed).
Frozen corpus SHA256s listed above verified byte-identical; no Cargo.lock, dependency, shared-record or frozen-tool change.
Not independently verified by this worker: the 31/855 counts are asserted by the test harness (`frozen_corpus_declares_the_required_totals`),
not separately re-counted here. Build output `target-deepseek-private-brain/` is not committed.
