# P-BACKEND-UNITY-PREFLIGHT-1 — isolated backend / Unity union preflight

**Status: plan only; independent review requested.** This packet describes a bounded local integration after the Card candidate is admitted. It does not create the worktree, reserve identities, run checks, modify either source branch, merge, or authorize release. Root owns selecting and pinning the final source cuts and starting the integration. DeepSeek owns Rust and test implementation only inside the later exact file/hunk lease. Root owns git merge operations and all final release decisions.

## Purpose and source cuts

Prepare one disposable local union from the then-admitted backend and the then-fixed Unity primary commit. Keep the canonical `optimization_port`, primary checkout, and Claude worktrees untouched. Do not push Unity history or publish a merged branch. Do not run Unity, a browser/Editor session, or deployment as part of this preflight. Before final handoff, Root must refresh both branch tips, dirty-file state, identity values, and the client bake against current primary; the current review is a planning input, not a release pin.

Sol's read-only readiness audit is [backend-unity-merge-readiness](../../evidence/backend-unity-merge-readiness/README.md). It compared primary at `feaae8e4` with backend `770a424a` and found actual merge base `61f9f15f`; both tips have since advanced. Latest observed clean primary is `3bcba1ea` (`feature/unity-rework`), whose newest commit only records Gate 2 documentation/evidence; the latest code commit remains `e438c100`, which already flips the live hitbox default, on top of baked-content commit `ae953573`. Latest observed backend integration tip is `be383c28`; its newest commit only records that primary runtime change in the readiness audit. These are observations, not approved inputs to a future merge. Root must pin exact cuts at dispatch, after Card admission, and preserve the preflight's own worktree identity.

The composition must retain both branches' behavior. Several shared files already have identical committed blobs at the reviewed merge base; integrate those once. Do not treat an old direct tip-to-tip diff as a deletion list, and do not port already-shared zombie/fighter-churn crash fixes a second time.

## Identity and protocol decisions

The reviewed backend/Card internal identifiers are checkpoint `30`, replay `24`, observation `22`, and policy contract `16`; the primary hitbox identities are `30/24/22/16` for different schema semantics. Subject to Root rechecking every final cut and consumer, the proposed union identities are checkpoint `31`, replay `25`, observation `23`, and policy contract `17`. These values are proposals only until Root reserves them. Update only the reviewed internal format literals, matching assertions and old-format rejection controls; preserve fail-closed refusal of old or mismatched internal formats. Derived native content/tape changes need the separate authorization below; this grants no codec or source-fixture edit.

Keep public wire protocol **16** and its Rust/C#/JS codecs and golden vectors. Card adds no wire event shape; its raw report stays server-only and public output uses the existing Hit event. Regenerate neither protocol fixtures nor source corpora merely to resolve internal version conflicts. A later incompatible wire change would require its own protocol decision and vector regeneration.

Reconcile the identity consumers identified in Sol's audit: `crates/rh-sim/src/{checkpoint,replay,observe,fighter,content}.rs`, `crates/rh-policy/src/lib.rs`, `crates/rh-sim/tests/{checkpoint,replay,content,hash_coverage}.rs`, `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs`, `crates/rh-sim/src/systems/sentenced/npc_tests.rs`, and `parity/abilities/hash-tape.json`. This list is a review inventory, not a blanket write lease. Root must grant only the exact files/hunks needed after inspecting final diffs.

Preserve primary protocol-16 archetype IDs/table, Welcome vision data, decoding, and hitbox geometry/height behavior. Preserve Card's strict B3 trusted amounts, exact per-viewer aggregation, entitlement-before-error handling, source redaction, report/cold-restore invariants, and raw-event privacy. Do not route trusted report totals into observation or wire output.

## Runtime default already changed

The latest primary already flips `LIVE_DEFAULT_HITBOXES` to `Archetypes` in `crates/rh-server/src/runtime.rs` (`e438c100`). The same commit updates `which_runtimes_default_to_which_hitbox_mode`, `hitboxes_take_effect_on_the_core_path_too`, and the live-runtime expectation test. Do not allocate a redundant default-flip edit. Preserve those expectations and parser tests on the union: `source-arena` and `training` follow the live Archetypes default; `--first-playable` follows it; explicit `--hitboxes legacy|archetypes` still works; bare core and `--runtime core` remain LegacyCircle. Keep `SimConfig::default()` LegacyCircle so parity and headless behavior do not silently change. Verify the live runtime's actual selected `Settings::sim` value in the combined tree.

## Minimal producer-composition proof

The existing legacy/source suites and the selected-mode producer checks establish different facts. Preserve the immutable legacy assertions as captured; add only these three focused composition cases after the Card and Quest Room candidates are admitted:

1. **NPC bleed and checkpoint continuation in Archetypes mode.** Extend the existing regional-NPC test in `crates/rh-sim/src/systems/mob_checkpoint/bleed_tests.rs` that proves `earned_hemorrhage_bleed_on_regional_npc_restores_and_continues`. Run its real PvE Sim with `SimConfig.hitboxes = Archetypes`, obtain the Hemorrhage status through the existing real join/raid-start, validated Attack/Release, and landed-hit path, then checkpoint, restore, and compare the existing continuation invariants. Confirm the Attack actually lands in this mode before asserting the bleed. Reuse its setup and assertion helpers; do not install a status row, call the damage/Card hook directly, or assume a legacy-only placement remains in reach. Keep the existing LegacyCircle case and all fractional/offset-clock, departure, and malformed-shape controls.
2. **Card public flush in Archetypes mode.** Add one focused test beside the existing Card source producer tests in `crates/rh-sim/src/systems/card_bleed_feedback/source_tests.rs` (or the exact admitted equivalent). Reuse the `first-use-clock-periodic-and-empty-interval` case's declared `input` (loadouts, setup, ordinary commands, and spans) with Archetypes selected in the constructed Sim. A narrow `construct_with_hitboxes`/`run_case_with_hitboxes` helper can share the existing case runner while leaving `run_case`'s LegacyCircle behavior unchanged. The test must use the actual scheduled landed Card DoT, periodic flush, and `FxProjector` delivery, then assert that a real eligible public Card Hit reaches a viewer and raw trusted report state is not emitted. The selected Archetypes run is a producer/projection integration assertion, not a comparison to legacy expected numbers: do not read that case's `trace`, `cardContributions`, `cardFx`, or `final` fields as setup/oracles for this new assertion. Keep the seven unchanged source histories and their 390 ordinary steps in their original LegacyCircle profile. Never seed a report, flush directly, install expected output, or alter source fixture expectations to force geometry parity.

3. **The same earned Quest Room completion in Archetypes mode.** Reuse the admitted `quest_room_earned_shards_completion_delivers_exact_owner_and_foreign_toasts` proof in `crates/rh-server/src/quest_bridge_tests.rs`. Its original component configuration uses LegacyCircle independently of the live default. Preserve that existing test/helper behavior as a LegacyCircle wrapper, factor one shared complete proof, and add an Archetypes wrapper. Select the mode before genesis Sim, Room config/join and active-Sim construction; never flip it after actors spawn. Retain the real issued handles, accepted Move/Pickup/return, ordinary Room wakes, full decoded owner4/foreign1 vectors, Done/credit corroboration and post-execution frozen oracle. Read native completion ticks from the actual run; do not impose the original1386/69300ms or source8/400ms. Do not duplicate the790-line proof, install progress, or add post-bootstrap teleports. Preserve all four older bridge tests unchanged.

For the NPC test, keep its existing LegacyCircle helper/case intact and add a mode-specific constructor helper or parameter used only by the new Archetypes case; the current `place_attacker` setup must prove a landed ordinary hit in the selected mode. For Card, the existing runner creates the world, joins real seats, starts the raid, applies only declared bootstrap placements/loadout/cards, submits actual commands, advances scheduled ticks, and captures producer output. Its exhaustive `SimConfig` constructor needs the new hitboxes field explicitly set from the mode helper, preserving LegacyCircle for the old source wrapper; do not broadly default missing configuration. The exact helpers/cases must be independently reviewable before Root grants a write lease. If a selected-mode producer cannot reach its assertion, preserve the failure and return the concrete reach gap rather than weakening the assertion or substituting state. These three existing test files are already registered; no new module registration or production visibility change is needed for the added proofs.

## Preservation gates before derived native identity work

On the isolated union, first run the frozen ability source set (63 legacy cases) with legacy hitboxes while the Card and hitbox schemas are both present, all seven immutable Card source histories / 390 ordinary steps, and the admitted NPC earned-bleed checkpoint/continuation suite with its existing controls. Do not edit source TS, captured JSON, expected outputs, source capture tools, or source corpus manifests. Run the three focused Archetypes composition cases above and the existing live-runtime/default/override tests. Keep the unchanged legacy Quest Room proof as well.

Keep primary Archetypes geometry, valid-height restore, projectile/homing, chest C-OBS, and both-mode source-soak/churn checks, plus backend Card redaction/privacy, reset/run-end/clone/restore, capacity, and viewer-projector controls. Preserve test registrations on `systems/mod.rs` and checkpoint modules instead of overwriting one branch. Existing committed identical ledger/weapons/fighter-churn/module files should remain a single copy.

Only after those producer and preservation gates pass may Root separately authorize the native ability recorder on the final union. The recorder must derive its tape/hash from actual code and source inputs; then run the existing checker and content/hash-coverage gates. Do not hand-edit `hash-tape.json`, choose either branch's content golden as the answer, or run the recorder before authorization. Full workspace/browser/deployment checks are later release gates, outside this packet.

## Candidate validation sequence and failure handling

After Root selects exact cuts and creates the isolated candidate:

1. Record both source commits, merge base, worktree path, clean/dirty status, all version values, and tracked-file manifest before edits. Preserve primary's generated BakedContent only if Root expressly includes its exact final reviewed value; never copy a stale dirty bake.
2. Apply the reviewed shared-file hunk plan and the smallest explicit identity/test changes. DeepSeek resolves only actual conflicts in Root's exact file/hunk lease. Do not edit unrelated strategy, quest, client, or hosting work.
3. Run the three focused Archetypes composition tests and retain their raw output on failure. Run the unchanged 63 legacy source cases, Card seven histories / 390 ordinary steps, NPC source controls, the legacy Quest Room proof and existing hitbox/Card/checkpoint/privacy tests. Follow with scoped `fmt` and strict default/all-feature lint for the affected crates under Root's exact dispatch commands. Full workspace, Postgres and browser gates in the combined-backend validation sheet remain Root's later union/release checks; that sheet is not a broad campaign allocation here. Commands must use the final reserved identities and isolated target directory.
4. Preserve every first failure and its command, cwd, exit code, log, and candidate hash. Do not refresh source output or expected corpus data. Fix a real issue only within the granted lease; if the accepted producer cannot reach the requested assertion, stop and report the exact reach blocker for Root's decision.
5. Once gates pass, record a complete immutable file manifest and exact source/tool/corpus identities. Root separately authorizes the native hash recorder and checkers; update the generated content identity only from those actual results. No passing status transfers from the two source branches to the union.
6. Before final handoff, refresh primary and backend tips, merge base, dirty state, protocol/content identity, and generated client artifacts. Reconcile any drift with Root after17:30UTC; the preflight is not final integration, final release approval, browser proof, or deployment.

## Exact lease still required

This packet grants no write access. After Card and Quest Room admission and clean-cut review, Root should create the isolated worktree and issue DeepSeek a path-and-hunk lease covering only the shared version consumers that truly differ, the three existing Card/NPC/Quest test files needed for the focused proofs, and any generated native identity files only after the later recorder authorization. Keep primary, `optimization_port`, client files, Unity history, wire codecs, source fixtures/tools, and unrelated backend features outside that lease. Root owns cut selection, version reservation, merge operations, release, and deployment.

## Active Root allocation — isolated preflight only (2026-11-10)

This allocation supersedes the plan-only execution status above. Root approves the independently reviewed plan
SHA256 `102e81e5bbd32fee13f40567da5c89e82e3f13fd1c1e56978e41ea9b8fa5e5d2`, frozen in `a9b21a0d`, and
the exact [dispatch scope](../../evidence/backend-unity-preflight-plan-review/dispatch-scope.md).
Card is admitted as `37a02542` with seven actual Root checks passing; Quest Room is admitted as `63dbe68a` with
Root's5-test bridge and format passing. Source/private Brain implementation remains separate and active.

Root selects clean primary `bb0c1cad790cbba729d3a8d8ddafe6abecc93eb8` for this local preflight. Its Rust/protocol/
Cargo.lock bytes are unchanged since `e438c100` (verified read-only); subsequent surface/audio/client work is not
an additional Rust lease. The backend parent is the Root commit containing this allocation, after `a9b21a0d`.
Root creates branch `codex/backend-unity-preflight` at
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-unity-preflight`, then begins an explicit
`--no-commit --no-ff` merge of that fixed primary SHA. The worktree is intentionally in an unresolved merge state;
it is not claimed clean/runnable before DeepSeek resolves the allocated hunks. Canonical `optimization_port`, primary,
all Claude worktrees and original worker trees remain untouched. No push, final merge, client build or deployment.

Root reserves **checkpoint31/replay25/OBS23/policy17 with wire16 unchanged** for this exact isolated union. Both
parents still use30/24/22/16 for different semantics. Recheck later drift before final admission; this is not a claim
that those formats are already deployed. Preserve both branches' gameplay, privacy, strict intake, cache and hash leaves.

DeepSeek's initial write lease is EXACTLY the15 Rust paths and one JSON path in the dispatch-scope tables: five
conflicted Rust paths, seven additional internal-version consumers, three existing selected-mode proof files, and
`parity/abilities/hash-tape.json` solely as the exact stale backend placeholder initially. The regenerated preview at
backend`c5f26d88`/primary`bb0c1cad` has tree`da0d42da6d0b0096969fe7a8319f85fe93beca0d` and the same six textual
conflict paths as the reviewed preview. Root will record the actual merge state after worktree creation. No whole-file
ours/theirs for Rust, generic defaulting, source-oracle change, hidden-state action, actor-mode flip after spawn, or
new gameplay rule is allocated. Read and preserve the verified automatic union hunks; report any genuine compile/
semantic obstruction outside these exact hunks with its function/path. Root retains git staging/merge completion.

NEW sanitized evidence may be written only under `docs/evidence/backend-unity-preflight/`; build/test logs and private
checkpoint transcripts otherwise stay outside Git. Do not edit shared status records, Cargo.lock, protocol vectors,
client/Unity files, source fixtures/tools/manifests, the existing Brain implementation, or hosting scripts.

Use the pinned Rust1.97 toolchain, offline/locked/jobs1, `CARGO_INCREMENTAL=0`, debug/test debug0 and an isolated
`target-deepseek-backend-unity-preflight`. Execute all three real Archetypes proofs plus unchanged LegacyCircle
ability63/Card7/390-step/NPC/Quest controls and the affected existing runtime/geometry/height/checkpoint/privacy/
capacity filters. Run scoped format and strict default/all-feature all-target lint for `rh-sim`, `rh-policy`,
`rh-server` and `rh-headless`; no full workspace/Postgres/browser campaign in this packet. Both-mode headless soak
preservation remains required. Record exact commands/results rather than an inferred aggregate pass.

The stale native tape and content golden are intentionally NOT pre-recorder acceptance prerequisites. Preserve any
genuine mismatch. After final-semantic source and selected-mode producer gates pass, report those actual receipts
promptly so Root can separately authorize ONLY the existing native recorder and single derived golden pin. Then
run unchanged tape/content/hash-coverage admission. No tape fold splicing, source recapture or source expectation
refresh. Finish a complete scoped manifest after final gates; Root seals only exact reviewed bytes and revalidates
primary drift at the later handoff. No communication with Claude before17:30UTC/10:30am Edmonton.
