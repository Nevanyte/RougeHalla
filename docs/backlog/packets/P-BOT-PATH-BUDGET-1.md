# P-BOT-PATH-BUDGET-1: borrowed room path allowance

## Authority and result

Planning packet only. Root chooses the exact clean base/worktree/target and dispatches after review; no Rust implementation is authorized by this document. All Rust/tests belong to DeepSeek. This small bridge is independent of full private Brain, Tactics/Modules/Hand WIP, persistent callback Send migration, fair observation binding and live activation.

Add crate-private borrowed-allowance entries to the existing `bots::paths::RoomPathService`, reusing the same actual cache/search/stale/fallback core. Preserve all current owned-budget APIs and values. The caller can then share one room budget across distinct service caches without cloning/replenishing allowance or changing PathBudget's value semantics. This packet changes no path algorithm, map/gate geometry, observation, actor identity, policy activation, source fixture or public command behavior.

Read `P-BOT-BRAIN-NATIVE-1`, independent `docs/evidence/bot-brain-native-plan-review/README.md`, actual `packages/server/src/bots/brain/services.ts`, current `crates/rh-policy/src/bots/paths.rs`, existing `paths_parity_tests.rs` and frozen `parity/policy/bot-tactics.json`. Source Brain witness6aaa4c6d and its independent review are already released; use its identity-shared-budget history as caller evidence, not a replacement engine or expected-state input.

## Exclusive implementation lease proposed

- `crates/rh-policy/src/bots/paths.rs`: only existing private walk/path/trip plumbing needed to select a borrowed allowance, additive crate-private entry methods, and one cfg(test) module declaration. Preserve public new/budget/budget_mut/walk/path/LOS/clear/collision_map/set_frame/stats contracts.
- NEW `crates/rh-policy/src/bots/paths/shared_budget_tests.rs` and packet-owned helpers beneath that new test directory if genuinely needed.
- NEW `docs/evidence/bot-path-budget-native/**` for code/command/result bindings and raw receipts.

No edits to existing path expectations/tools, existing `paths_parity_tests.rs`, pathfinder/geometry, Strategy/Tactics/Modules/Memory/Hand/Brain engines, Policy/Seat, World/Sim, accepted delivery, Unity/network/protocol, dependencies/Cargo.lock or shared status. The new test helper may read existing frozen fixtures. Root allocates any unforeseen file/signature separately. No source recapture or broad path refactor.

## Exact contract

1. Keep `RoomPathService::new(map, PathBudget)`, its owned budget field, `budget()`, `budget_mut()`, existing `walk` and `path`, and PathBudget new/start_tick/take/left/Clone value semantics unchanged. Cloning a PathBudget still makes an independent value; do not silently replace it with shared reference semantics.
2. Add crate-private `walk_with_budget` and `path_with_budget` entries taking from/to and one borrowed mutable PathBudget for the duration of the call. They return the same WalkAnswer/path representations as the existing entries. Borrowed input does not escape into service state.
3. Factor only enough shared private plumbing so owned and borrowed entries use ONE walk/path/trip transition implementation. Select the supplied allowance or the owned budget only at the existing budget.take miss point. No copied room allowance, temporary budget swap, second search/cache loop or duplicate state machine.
4. Preserve order: entry finite check; identical key/cache lookup; fresh cache hit with no budget take; otherwise chosen allowance take; existing search/store if granted; existing stale cache answer if denied; otherwise existing fallback/stat update. Keep failed-path cache, exact cache/stale/prune boundaries, vector ordering, path length and stats unchanged. LOS, clear, collision_map and set_frame remain allowance-free; set_frame must not call start_tick.
5. Borrowed calls must leave the service-owned budget untouched, including on search/fallback. Owned calls must not touch any external allowance. Both sets of entries intentionally see the service's same cache and stats; a cached path created through one entry is not duplicated for another entry.
6. Cache identity belongs to each ACTUAL service handle, not each Brain. Distinct services have independent caches but may use the same room allowance in deterministic order. Callers reusing one original cfg/service across Brain instances or recreation reuse that exact service/cache. Brain construction/end does not reset a caller-owned service. The later Brain adapter binds each service to its declared caller budget; this small API does not invent config/Brain identities.
7. Caller owns one start_tick at the room-frame boundary. Passing one mutable room allowance serially through two services must expose the remaining allowance from the first call to the second. Never replenish on each service/set_frame/walk/path call. A standalone client caller may instead own its own allowance.

Current source and Rust trip order agree at `services.ts:96–121` and `paths.rs:124–167`; this is a budget ownership bridge, not new algorithm evidence. The existing path service retains its admitted gate-map/precision limits; broadening them is not leased.

## Bounded meaningful evidence

Reuse existing frozen source results; never install cached Trips/stats/budgets from expected rows.

- Run unchanged `bots::paths_parity_tests::the_path_service_matches_the_source_step_by_step`. It checks old owned calls against the actual-source script, including outputs, search/hit/fallback counters and owned budget left. This is the compatibility overlap for existing public consumers; do not rewrite its fixture or loosen its existing comparator.
- Replay that same existing frozen service script through the new borrowed entries, resetting the caller budget only on each declared frame operation. Compare the actual borrowed allowance against the captured left and actual service outputs/stats against the same source rows; assert the separate owned budget stays unchanged. Reuse the new helper instead of duplicating an engine. The source script's invalid geometry, cache/stale/fallback/prune behavior supplies real branch overlap; no new capture is needed.
- Add a small deterministic two-service test over one declared map and a caller allowance small enough to exhaust: first ordered uncached request searches/spends; a different service's uncached request observes exhaustion/fallback; a real fresh hit still returns without spending; one caller reset permits the next missed search. Prove separate caches do not borrow each other's hits and same-service walk/path share one cache. Check actual outputs/counters/left, not only absence of panic. An unexpected owned-budget debit, per-service refill, shared cache or cache-hit debit must fail these assertions.
- Include owned PathBudget clone independence and no-refill-on-set_frame in that focused sequence where they distinguish the proposed sharing mistake; do not add a broad generic test matrix.

The released Brain `identity-shared-budget` history (`cases.mts:145–148`, runner's cfg/service construction) already demonstrates a/b sharing the original service, equal-value c owning a distinct service, one room allowance, and recreated b retaining caller service. Read its actual source declarations/trace to preserve that meaning. Full31/855 Brain replay is a later composition gate; do not require it for this independently dispatchable bridge or manufacture a smaller Brain substitute here.

## Commands, receipts and admission

Use the repository-pinned Rust toolchain, locked/offline dependency mode and Root-assigned isolated target. Exact test-module/filter names are finalized by the author and reported, not silently skipped.

Required focused gates:

- new shared-budget module tests;
- existing `bots::paths_parity_tests::the_path_service_matches_the_source_step_by_step`;
- rh-policy fmt check;
- strict rh-policy default library/tests Clippy and all-feature library/tests Clippy.

No full workspace/hash/Memory sweep, source recapture, native Brain or active sibling-worker test restart is requested. Broaden only for a new concrete regression found during this scoped work and coordinate it with Root. Keep initial failures and actual terminal exits; do not overwrite red receipts or count import/build failures as semantic evidence.

Evidence must bind base/final code SHA, clean scope, exact commands/cwd/toolchain/target/environment, exits/counts/raw logs, unchanged source fixture identity, and relevant actual allowance/cache observations. Report the test-only facts and existing behavior limits separately. Independent exact-seal code/receipt review gates Root integration. No shared status or commit ownership is transferred unless Root explicitly grants it.

**Release is limited to the borrowed path-allowance interface and unchanged owned behavior.** It does not admit full private Brain, persistent Send callbacks, module wrappers, shared live runner budgets, publication/identity providers, hosted bots or deployment. Root must separately gate those dependencies and interfaces.
