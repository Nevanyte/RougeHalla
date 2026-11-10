# P-QUEST-BACKEND-1: tour-supply repair and replaceable K1 backend rules

## Outcome and ownership

Repair a concrete distinct-region supply error using a new actual-source regression, then isolate the current K1
objective and reward rules behind small internal typed functions. Preserve gameplay after the repair and retain all
current public input/protocol/persistence boundaries. This prepares for an owner-specified quest redesign without
inventing that redesign. Architecture: [QUEST_BACKEND_REWORK](../../coordination/QUEST_BACKEND_REWORK.md).

Base: `4151b3af597cc06d1b3b77f4e3e21cc9906b6a86` on `optimization_port`. Coordination/source worktree:
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests`, branch
`codex/backend-gameplay-quests`. DeepSeek Rust worktree:
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-quest-runtime`, branch
`codex/deepseek-quest-backend`. DeepSeek can read the preparation in the coordination worktree; Root transfers
the frozen source evidence before native consumer validation. Reading/design preparation may begin while capture runs.
Root must allocate any further author/reviewer worktrees. Never edit Claude's
`/Users/nevinmckinnon/Documents/Projects/RogueHalla` checkout.

DeepSeek writes **all Rust implementation and tests**. Sol/Luna own the new non-Rust capture/harness/evidence and
architecture/review. This packet is ordered; do not label extraction complete while the source-derived repair remains
unverified. No Unity/networking/Editor/browser work is authorized by this packet.

## Exact write scopes

| Owner/stage | Files |
|---|---|
| Sol/Luna source stage0 (new, separately reserved) | `tools/quest-tour-supply-fixtures/**`, `parity/quest-tour-supply/**`, `docs/evidence/quest-tour-supply/**` |
| DeepSeek stage0 Rust regression and minimal repair | `crates/rh-sim/src/quests/live.rs`, `crates/rh-sim/src/quests/mod.rs`, NEW `crates/rh-sim/src/quests/tour_supply_source_tests.rs` |
| DeepSeek stage1 objective/reward extraction | Same `live.rs`/`mod.rs`; NEW `crates/rh-sim/src/quests/objectives.rs`, NEW `crates/rh-sim/src/quests/rewards.rs` |
| Sol/Luna preparation | `docs/coordination/QUEST_BACKEND_REWORK.md`, this packet |
| Root only, if needed for stage0 admission | Content/replay identity integration and resulting declared pins; shared MIGRATION/CONTRACTS status and Cargo.lock |

All paths outside these scopes are read-only. In particular preserve `quests/catalog.rs`, `rules.rs`, `roster.rs`,
`placement.rs`, `giver.rs`, all existing native tests/corpora/capture tools, `quest_view/**`, `input.rs`, `schedule.rs`,
`hooks.rs`, `World`, checkpoint shapes, protocol/server/policy/headless/client implementations and dependencies.
New tests may use existing test-only setup/production paths from their allowed new module. If a scope expansion is
necessary, return the concrete file/hunk need to Root before editing it. Do not bypass a test by altering its expectation.

No speculative architecture changes or Cargo dependency additions. Root coordinates compatibility identity changes
for the stage0 reachable-behavior repair. Stage1 must leave the admitted stage0 identities and hashes unchanged.

## Read first

`AGENTS.md`, current `docs/MIGRATION.md`, `REQUIREMENTS.md`, `CONTRACTS.md`, backlog README,
ADR0007/0009, and `docs/sweep/PACKAGES.md`. Then:

- Native: `quests/{live,catalog,rules,roster,placement,giver,notices}.rs`, current quest test modules,
  `quest_view/{mod,presentation}.rs`, checkpoint quest validation and `content.rs` visitor `quests/1`.
- Source: `packages/server/src/sim/quests.ts` (`onMobKilled`, `killSupplyLeft`, `closeImpossible`, `questSystem`),
  `mobLife.ts` real kill/credit path and `camps.ts` recheck producer; shared quests/catalog.
- Evidence: `parity/quests/README.md`, `parity/quest-giver/README.md`,
  `docs/evidence/quest-notices/native-consumer.md`, human eligibility evidence and the architecture note above.

## Stage0: source-derived repair, separate commit

Current Rust `close_impossible` reads a visit **population count** and subsequently uses it as a region mask. Source
uses actual membership in its visited Set. For `grand-tour` count3 with earned visit Frost (mask8, progress1):

1. Leave only Fire and Holy live supply: source has two unvisited regions and stays open; current Rust counts Fire as
   visited and expires. This is the premature-expiry regression.
2. Leave only Frost and Sentenced live supply: source has one unvisited region and expires; current Rust counts both
   unvisited and stays open. This is the false-survival regression.

Sol/Luna capture both against unchanged source in a **new** corpus. Record at least initial map/seed/attempt/private
salts/config/seat profile; every declared setup and real input/producer action; accepted/progress/visited-region facts
before the clearing pass; real remaining regional mob supply; camp-clear producer reached; post-step open/expired
status, deadlines/closed time, giver/container retirement, ordered notices and zero quest payout. Require open-before
and closure/nonclosure-after explicitly. Include source fact that no other standing human can finish from zero
progress with only two live regions. Do not silently exclude other humans in the native replay.

Use real `createGameWorld`, real quest spawn/publication and normal50ms steps. Accept through
`enqueueClientMessage`. Earn the Frost visit through the real credited mob-kill path. Prefer ordinary attack with
explicit HP/placement/loadout setup. For supply exhaustion, the existing real `killMob` producer pattern is acceptable
only as a labelled declared producer; record its actions and replay that same boundary natively. Never call
`killSupplyLeft`/`closeImpossible` directly, install progress/visits/recheck, invoke hook callbacks in place of the real
producer, or forge publication/status. Stop well before camp respawn/deadline/sudden-death timers confound the case.
The source snapshot must demonstrate the expected branch actually ran, including its visible consequences.

Use the established pinned Node22.23.4/linux-amd64 image and read-only source mounting. Record tool/source/import
closure hashes and exact corpus byte/SHA256 receipts. `--check` must compare byte-identical output. Existing corpora
are immutable. Add a semantic negative control in a disposable source copy that substitutes visited-size/count for Set
membership: it must disagree on the declared outcome path. Syntax/build/capture failure is not a semantic kill; verify
unchanged-source restored control passes. Do not mutate a live/shared checkout.

DeepSeek first implements a native source consumer in the new test module, replaying source actions through the actual
sim and normal `validate` + `Sim::submit` for inputs. It must fail against the pre-repair runtime at the source-derived
status difference, not an unrelated fixture/map/compile error. Preserve the red receipt. Apply the minimal mask fix
and require both cases to pass. No refactor belongs in this repair commit.

Root independently reviews the witness and repair and decides the content/replay admission. The shape remains
protocol14/checkpoint29/OBS21/policy15 at the base; no wire/schema change is needed. A changed gameplay trajectory must
not be advertised as an unchanged rules identity or silently accepted by old verified replay expectations. Keep any
required identity update separate and declared; DeepSeek must not edit unallocated identity files preemptively.

## Stage1: internal boundaries, separate commit

Proceed on the admitted stage0 code. Leave serialized `Offer`, `Quests`, `Status` and all entry-point signatures at
their current paths. Never reorder schedule/hook tables or add a second action path.

1. Add internal `objectives.rs`. Lower `&catalog::Def` into a small typed Kill/Collect/Fetch objective. Preserve mob
   region/elite/tour versus human-player distinctions and the source precedence. Derive on demand; do not store it.
   Pure functions operate on explicit existing counts/masks, typed credited facts and live-region/elite counts.
   Centralize capped advancement, tour update, readiness and per-player supply feasibility. Return explicit changes
   so a no-op never creates a new progress/visit row. Keep row insertion/update order identical, including saturated
   tour events. Do not allocate/clone the world or accept a `World` reference into objective evaluation.
2. Keep lifecycle gates/effects in `live.rs`: phase, standing human, publication/open/acceptance, source-ordered
   refusals, range/LOS, pickup side effects, reveal/head start, source tie rank, expiry/linger and actor retirement.
   The source supply check asks whether ANY standing human could finish, including unaccepted humans; preserve that.
   No standing human means do not expire for supply. Tour freshness uses the **repaired actual mask**.
3. Add internal `rewards.rs`: a typed plan `{gv, stat, stacks}` from the current `Def` using existing reward rules,
   applied through existing capped quest GV and `grant_mob_stat` paths. Move the narrow award plumbing here; do not
   duplicate formulas or move entire lifecycle state into it. Keep exact event order: quest GV, farm gain notice if
   any, owner completion, room completion. Completion/retirement remains one lifecycle transition.
4. Update only stale quest-module commentary within the allowed files. Do not touch unrelated stale comments.

No dynamic registry, trait-object plugin host, scripting language, event log, deferred reward delivery, quest database,
new target/capability, new policy interface or new gameplay tunable is required. Keep the code smaller than the existing
logic plus the necessary narrow typed boundary; a wrapper that adds no boundary should be omitted.

## Evidence and tests

The existing fixture consumers are the primary preservation evidence, not new tests that restate helper formulas.
Run all quest and quest_view tests, which include:

- Source catalog/rewards/rosters/placements/wording and the ten-case lifecycle consumer.
- Eight real giver cases and14 public action cases with exact ordered feedback.
- Selected notices cases0/4 only with actual reached run-end closure and owner/foreign preview controls.
- Human/bot eligibility, real carrier drop, completion, quest cap/two reward channels, checkpoint restore/hash and
  hidden-world/prepare/commit/reconnect/owner-navigation projection controls.
- New stage0 cases, rerun after extraction. They must still hit the same real producer and post-step branch.

For stage1, compare baseline and extracted code on the **same source-derived action script**. An ephemeral test-only
transcript may extend the lifecycle runner in private temporary copies to record per captured tick: private state hash,
checkpoint JSON, events and prepared human QuestViews, then continue both original/Clone/restored states with the same
remaining actions. Compare complete transcripts; do not create new Rust-derived normative fixture expectations.
At minimum compare acceptance/deadline, tour progress/supply, hidden preview/publication, collect completion,
carrier death/steal, expiry and run-end branches. This confirms layout, ordering and derived readiness remain stable.
Keep the test-only harness/transcripts private (state hashes/checkpoints may encode secrets); never include them in a
public protocol or unsanitized external report. Report their comparison and command/environment, not private state.

Run the relevant existing layout/hash/checkpoint/replay/content tests after extraction. Source/catalog changes are
not authorized merely to make a fingerprint pass. Do not claim allocation improvement or speedup; preserve the
existing real giver warm-allocation test and report if a measured new regression appears. Any broader performance
work requires a demonstrated cost rather than a new benchmark suite by default.

Suggested focused commands (private target, jobs1 if other work is compiling):

```sh
cargo test -p rh-sim --all-features --lib quests:: -- --test-threads=1
cargo test -p rh-sim --all-features --lib quest_view:: -- --test-threads=1
cargo test -p rh-sim --test checkpoint --test replay --test hash_coverage --test content -- --test-threads=1
cargo test -p rh-parity --test schedule -- --test-threads=1
cargo run -p rh-parity --bin parity-report
cargo clippy -p rh-sim --all-targets --all-features -- -D warnings
cargo fmt --all -- --check
```

Only Rust files within the allocated scope may be formatted. `cargo fmt --all -- --check` is read-only. No Postgres,
AWS, client runtime, browser or package installation is required for native tests. The pinned source capture's npm
install is container-local. Root runs the eventual integration checks, including workspace/headless gates, after
composition. A filter that matches zero tests is not a pass; record executed counts and failures/ignores honestly.

## Return to Root

Return separate source-evidence, minimal-repair and extraction commit IDs, changed-file list, exact fixture
bytes/hashes, pre-fix failure path, passing native command/counts and explicit limits. Give Root any identity admission
need before changing versions. Report any new source discrepancy separately; do not fold it into this refactor.
This packet does not claim full quest-port equality, all notice cases, browser flows, new persistence, bot quest
participation or an implemented future quest design.
