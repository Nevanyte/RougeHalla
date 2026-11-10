# Private feature Modules native candidate — pre-seal review

Status: **provisional pre-seal review; not RELEASE**. This is a read-only review of the moving DeepSeek candidate. The
candidate still needs its final source replay, full focused-gate receipts, complete manifest, exact sealed commit, and a
fresh post-seal review before Root can admit it. It proves neither public Brain activation nor live/headless parity.

## Inspected cut and integrity binding

- Candidate worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-modules`
- Branch / HEAD at review: `codex/deepseek-private-modules` / `9f74ff3e87461ff31f84720240455d6ef33f420b`.
- Inspected status: modified `planning.rs`, `wish.rs`, `hazards.rs`, `temporal_percept.rs`, `temporal_percept/strategy.rs`; new shared cores and `temporal_percept/modules{.rs,/**}`; candidate evidence is untracked. Several untracked `target-*` directories are also present and were not inspected or changed.
- A sorted inventory of the 23 Rust files in the module layer and the five bridge/wiring files was hashed as
  `SHA256(path + NUL + SHA256(file) + LF, in path order)`: `2d222cd70353a2312e48b2858af38461b57a2d324a86da379b73d177a32df746`.
- Key file SHA-256 at this cut: `planning.rs` `dc890370267c43ac4fc69402957a699790590a786e2457ee68321702670f2394`;
  `wish/source_core.rs` `32c091477dbf613cbb38733ab6866e54582c9777839e197a8677ffaa958e5900`;
  `hazards/source_core.rs` `8c4b12af4bb8e90e11b1d3918c990a6ef0ecd55766c75c9020a31003e9a4f485`;
  `modules/source_tests.rs` `c4cd7d383b5cb03ee0f0c5f60d0a6dfa5c6c30362d48a5952059d7f0f0dd796f`;
  `modules/registry.rs` `d06a0ad6e81ac65c8a316d8cacdd411410f07c63b69f08157b8191763f725674`.
- Frozen source authority is unchanged by this review: 255 cases / 3,259 operations, source SHA-256
  `645e85f16adbea001f8d0e06a70b6e5d311864ed9691622c06b789c95578b012`.

No Rust, tests, captures, or source/native candidate files were executed or modified during this review. The checked-in
working-tree statements below are code inspection only, not independently reproduced gates.

## Findings

### Shared-engine reuse and compatibility

At this inspected cut I found the expected shared transition arrangement, with no obvious surviving duplicate planner,
Wish policy/state machine, or hazard transition implementation:

- `bots/planning.rs` contains the shared `source_observe` / `source_intents` transitions and raw-number `PlanDealView`
  adapter; `temporal_percept/modules/planning.rs` delegates its per-cfg source state to those transitions. The old
  `PlanModule` also calls the same transitions. The source adapter retains ordered event scan, uses `event.t` for the
  first valid deal schedule, and passes full `TierParams` for reaction/softmax/lapse consumers.
- `bots/wish.rs` / `bots/wish/source_core.rs` own the shared `WishStateCore` and cast policy. The old public
  `WishModule` wraps the shared state, while the private source adapter consumes declared AbilityDef rank/tags and actual
  Memory last-cast/hit facts. The finite profile explicitly refuses unsupported definition shapes before mutation;
  it does not map unknown custom definitions to a static row.
- `bots/hazards.rs` / `bots/hazards/source_core.rs` own the source fact/service transitions used by both old public
  `Hazards` and the private module. The source adapter passes actual path-service callbacks and preserves unknown faction
  as no home faction rather than inventing one.
- The only visible pre-existing-file wiring edits outside those shared seams are the allocated `mod modules;` and
  `pub(super) mod types;` visibility changes. I saw no `rh-sim`, `Observation`, World, protocol, or source-corpus edit.

This is a bounded code review, not an exhaustive proof that every old adapter behavior is unchanged. Final evidence must
retain and report the required unchanged planning/Wish/hazard and other overlap filters.

### Harness, state, callbacks, and values

The replay driver in `modules/source_tests.rs` declares 255/3,259 as hard counts and constructs fresh module instances
per case. Per-cfg state is selected through `CfgToken`, while its setup constructs actual admitted Memory, Knowledge,
RoomPathService, and separately seeded decide/motor/lapse lanes. Expected operation result/context/hunter/callback values
are compared after execution; inspected code does not install those expected outputs into module state. The corpus
comparison preserves ordered values and callback/RNG traces. `source_input.rs` and `source_reader.rs` have a separate
strict typed input path and distinguish method-value tags; they are not a general raw game-frame/public observation
adapter.

The callback wrappers record the declared path, collision-map, learned-bias, hunter, and custom-enabled interactions.
The registry callback is recorded after the direct registry operation because its persistent `Send + Sync` closure
captures into a synchronized side buffer; the harness comments that these registry operations have no competing callback
inside that call. This is compatible with the captured operation shape, but should remain stated as a corpus-specific
replay boundary, not a general callback scheduler guarantee.

Registry inspection confirms the approved `Arc<dyn Fn + Send + Sync>` form for both the custom enabled callback and
cast-policy slot, pointer identity checks in the test helper, and a compile-time `Send` assertion for Registry,
CustomModule, and all four module types. This confirms the intended implementation is present at this cut; the compile
gate remains unverified by this reviewer.

## Current pre-seal HOLD

The candidate README describes a complete green replay and full gates, but the evidence directory at the inspected cut
contains only `README.md`, `REPLAY.md`, `bridge-proposal.md`, and `LEASES-ACK.md`. The README also links to `RUNS.md`,
`CONTROLS.md`, `OVERLAPS.md`, `NUMERICS.md`, `BRIDGES.md`, `SEND-COMPAT.md`, `LEDGER.md`, and `CANDIDATE.md`, which were
not yet present at inspection. Root's handoff separately says the final gates and full replay were still in progress and
the inventory/evidence incomplete. This is an evidence-completeness HOLD only; I have not found a substantive defect in
the shared-core, registry-Send, or harness wiring inspected so far. Do not treat the candidate README's result table as
independently verified until the final receipts arrive.

## Required exact-seal follow-up

After the worker finishes and Root seals a clean candidate, bind the new commit and full file manifest, then verify the
actual receipts for:

1. all 255 source cases / 3,259 operations exact, no skipped suite, and frozen source/coverage/controls/manifest bytes;
2. strict intake negatives and semantic controls that reach their target behavior (not compiler/metadata-only kills),
   with expected output used only for comparison;
3. unchanged public planning, Wish, hazards, path/knowledge/Memory/hand overlap gates, plus default and all-feature
   formatting/lint commands with exact exits/counts;
4. the approved bridge identities and Registry/CustomModule/module `Send` assertion, with actual final code hashes;
5. comments-only and restoration checks against the final harness/candidate, where required by the packet.

Even a successful exact-seal review is limited to this private source-module layer. Full `createBrain` composition,
public fair-fact publication, validate+submit activation, headless/live execution, and Unity/network behavior remain
separate work and admission gates.
