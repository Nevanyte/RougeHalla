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

## Final exact-seal follow-up — 2026-11-10

**Disposition: RELEASE the bounded private Modules candidate at `0c6dcee4f649336a9b4c422d0c6068e19e96344e` for Root admission/integration.** This supersedes the pre-seal HOLD above, which was specifically an incomplete-evidence HOLD. It does not claim Brain composition, fair publication, live/headless activation, or full-game parity.

### Seal and manifest verification

The commit parent is the declared clean dispatch base `9f74ff3e87461ff31f84720240455d6ef33f420b`. The tracked candidate contains 38 paths: the five leased existing files and the packet-owned new files/evidence. The only worktree status entries are the seven untracked `target-*` build caches called out in the dispatch; they are excluded from the commit and manifest.

I independently checked all 36 manifest entries against the frozen candidate worktree: SHA-256, Git blob SHA-1, byte count, and filesystem mode match. Manifest SHA-256 is `b4190e873ef02e02f8b2a8f625fbb06c29ce812662dc1c712aa491c0cc0286b8`; the binary patch for the five existing files matches SHA-256 `f06ebfdf84be98ca13aff4121d794173aa321ffb9ef9e7b9bcd3fc4742395400`; the `SEAL.txt` digest is `b619cddd04946707a1b94ed6a8fbd7344aad90fc0cb96225d18b27f64bbfe37a`. The final tracked delta matches that patch hash. The frozen corpus remains 12,755,158 bytes / SHA-256 `645e85f16adbea001f8d0e06a70b6e5d311864ed9691622c06b789c95578b012`.

### Final code/evidence delta review

The final code retains the shared-engine design reviewed pre-seal: old planning/Wish/hazard wrappers and private modules route through the same transition cores, and only the two allocated module/type visibility lines are added outside those shared-engine files. The final manifest confirms the reviewed `planning.rs`, `wish/source_core.rs`, `hazards/source_core.rs`, module registry, and source replay harness identities. The registry is `Send` through its persistent `Arc<dyn Fn + Send + Sync>` callbacks; pointer-identity and Send assertions are present, without `unsafe impl` or a non-Send wrapper. Its custom-enabled callback transcript is appended after the registry operation; the corpus-specific justification remains accurate because those enabled operations have no interleaved callback source in the operation.

The final harness keeps expected result/context/hunter/callback values as post-operation comparisons; native state is constructed from declared inputs, fresh per-case modules/registry/hunter, declared Memory/Knowledge/map/path services, and per-cfg RNG streams. Source replay totals are hard-checked before execution. The strict reader and semantic controls are separate: 24 intake negatives and 28 native semantic controls, with the declared native profile limits and unproved paths retained in LEDGER/CONTROLS rather than advertised as general support.

The final frozen-tree receipts record 255 cases / 3,259 operations with zero mismatches, 354 `rh-policy` lib tests passing, 24/24 strict intake negatives, 28 semantic controls, Send assertion, old overlap filters, formatting, and default/all-feature clippy all exiting zero. RUNS.md preserves the earlier first failures and repairs. I reviewed the code, manifest and receipts read-only; I did not run Rust tests or recapture source. Root's command receipts remain the execution authority.

### Limits preserved

This release only covers the private source-module layer and its shared engine bridges. Explicit limits remain: unsupported future/custom ability shapes, source throws outside the finite method profile, and any other declared unproved paths in LEDGER. No full `createBrain` composition, fair Observation/FrameRing publication, validated live/headless driver, persistent learning lifecycle, client/wire behavior, or whole-game parity is established by this candidate.


## Root integration receipt

Exact independently released seal `0c6dcee4f649336a9b4c422d0c6068e19e96344e` integrates cleanly as
`721d04dabaa734f33835cd69bbb64385843d9a7d`. The already-present Strategy types visibility hunk is identical, so the
integration commit changes37 paths rather than the worker seal's38; all new module/core code is preserved. Root starts
one combined full `rh-policy --lib --nocapture` check at this exact integration, with the previously admitted Hand,
Tactics, PathBudget, Potion and Strategy composition changes. Its raw receipt is `root-integrated-policy.log`; at this
recording it is running and no pass is claimed. Target caches are not tracked.
