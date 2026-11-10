# Native private Brain plan — independent review

2026-11-10. Reviewed exact committed plan cut `8820c74d3dc25740fe3295ce3edf8e9cad838efc`, `P-BOT-BRAIN-NATIVE-1.md` and its evidence README, against the released source witness 6aaa4c6d, current admitted Strategy/path APIs and source caller/identity histories. **The borrowed path-allowance bridge is independently dispatchable under its own narrow packet. Full production private Brain dispatch remains HOLD for the service-identity correction, a Send-compatible persistent callback/mutable-goals-context bridge, and the already required final dependency seals.** This is plan-only. No Rust/tests/captures, native answer tuning, cloud or Claude work occurred.

## Required service-identity correction

The proposed cache/search bridge itself is compatible with the source. The surrounding ownership prose is not yet exact: packet path section says each Brain owns a distinct cached service and later says each Brain retains its own RoomPathService. That is true for ordinary BotManager-created distinct cfgs, but not the released explicit same-cfg profile.

`tools/bot-private-brain-fixtures/runner.mts:85–110` creates paths only when a caller cfg handle does not already exist; reusing that cfg reuses its exact service. `cases.mts:145–148` gives Brains a and b original cfg `same`, c equal-value distinct cfg `equal`, then recreates b with `same`. Thus a/b/recreated-b share one service and cache; c has a separate cache; both actual services consume the one room allowance. `checks.mts`'s identity-shared-budget assertion and the frozen complete service traces/stats already witness this. No recapture is needed.

Proposed sentence replacement: “The caller supplies/binds an explicit service handle. Each distinct service owns one RoomPathService/cache; Brains that reuse the same original cfg/service handle, including recreation, reuse that cache. Distinct services retain distinct caches while borrowing the same caller-owned room allowance in deterministic call order. Brain construction/end must not allocate, reset or replace a caller service merely because a Brain instance changes.”

Apply that rule consistently in constructor inputs, path paragraph and evidence table. Brain recreation resets its own Memory/RNG/cadence/guarded bcfg but does not reset caller-owned service/cache/budget. This is a full-Brain plan correction, not an obstacle to the additive borrowed-budget methods.

## Required Send dependency before production Brain

`crates/rh-policy/src/lib.rs:194` requires Policy:Send. The admitted Strategy is already structurally non-Send:

| Persistent field | Exact existing location / effect |
| --- | --- |
| AttackFn / LogFn | `temporal_percept/strategy/types.rs:364–365` are Rc callback aliases. Even Options whose current values are None retain this non-Send type. |
| Strategy options | `strategy/engine.rs:85–87,95–120` stores those callbacks. Wrapping the complete Strategy in Arc<Mutex> does not make its Rc fields Send. |
| HuntAdapter options | `strategy/hunt_adapter.rs:20–22,30–37,46` stores/clones the same callback types. |
| MobHunter log | `strategy/mob_hunt.rs:186,209–224` retains LogFn and constructs a default Rc no-op. |
| Proposed module/service/config handles | Persistent Rc<RefCell<dyn SourceModule>> and any other persistent Rc scratch/config/service handles would add further non-Send state. Replacing only the outer wrapper with Arc is insufficient if its contained trait object/state is still non-Send. |

Root's decision is to design the production private Brain for eventual Policy:Send now, not postpone a predictable rewrite to F1. Allocate a narrow persistent callback bridge as a separate dependency before full Brain dispatch. Preferred minimal contract: AttackFn/LogFn become Arc callbacks with Send+Sync captures; preserve their exact call timing, arguments, returns and identity sharing. Update the no-op factory and affected callback constructions, not Strategy/HuntAdapter/MobHunter algorithms. Captured attack/log state should be independently owned Send state/handles; callbacks must not capture and lock the whole Brain while Brain invokes them. Avoid mirrored expected attack state; callbacks read the actual source-owned state cell/handle.

For module/service identity, Arc<Mutex<Send-owned object>> or stable handles into a Send-owned arena can preserve same-object identity and per-cfg state. Arc<Mutex<Box<dyn SourceModule+Send>>> is a possible shape, not a final API allocation before Modules admission. Use short nonreentrant critical sections; release them before another module hook or Strategy call, and do not silently translate lock failure/panic into a successful source callback. Module object identity, guarded-wrapper identity, cfg/bcfg identity and fault-by-id remain different concepts. A mutex is not permission to serialize all Brain work behind one reentrant callback lock.

Persistent trait objects also need the appropriate Send bound: the borrowed StrategyConfig.modules at `types.rs:526` is a slice of Box<dyn FeatureModule>, so that borrowed view is not itself permission to persist a non-Send boxed vector in Brain. Keep a Send-owned wrapper/object handle and an ephemeral view, or obtain the exact compatible typed trait-object bridge after component seals. Do not weaken the private callback contract just to make an auto-trait assertion pass.

Borrowed Memory/Knowledge/path/RNG adapters and full-current-tick scratch views can be ephemeral synchronous tick locals. They need not themselves be Send if they do not escape into persistent fields/closures. Test-local Rc is also acceptable when it is not captured by a stored Send callback. Current Strategy fixture `source_trace.rs:75,171–186` and the attacking-instance regression `private_strategy_tests.rs:864–935` do capture Rc storage in stored callbacks; the callback bridge must migrate those captures to a Send-safe recording channel/state while preserving the unified ordered transcript. It must not discard/reorder callback events or substitute callback tapes.

Bounded callback-bridge overlap: compile-time Send checks for the actual Strategy/HuntAdapter/MobHunter types; retain the attacking-instance isolation control; run existing declared Strategy 11 and full source 11 (98/658 plus supplement 4/48, typed/trace controls), default/all-feature policy lint and fmt. No source expectation changes or heavy unchanged Memory rerun. Full Brain itself later needs an actual Send compatibility assertion once composed, and the final Modules/Hand/Tactics interfaces must be sealed before exact further visibility/signature leases are chosen. No unsafe Send/Sync or weakening Policy is acceptable.

## Module adapter design: conditionally sound

The plan correctly shares actual original module-object handles across caller/registry lifetimes, while minting per-Brain guarded wrappers/bcfg and a per-Brain fault set shared by equal module IDs. Source `brain.ts:96–117,164–165` does this; selected wrappers may still run after a same-tick fault, and only a subsequent enabled check consults the fault marker. Do not clone modules per Brain to satisfy mutability or clear singleton state on end/recreation. State keyed by actual bcfg identity must remain separate even when the original caller cfg is reused.

Mutable module-object borrowing alone does not resolve the actual callback obstruction: `strategy/types.rs:509–514` defines FeatureModule.goals with an immutable StrategyContext, and `strategy/engine.rs:291` calls it that way. The context contains mutable path/RNG provider references, which cannot be reborrowed mutably through that immutable context. Actual source `modules/chests.ts:237–248` makes a fresh ChestHunter for goals, calls decide(huntInput), and huntInput's callback (`:134`) calls ctx.svc.paths.walk; this is a real spending/cache mutation during goals, not a cached observe answer.

Root approves a narrow function-level bridge: give the goals hook a mutable StrategyContext and update its existing callsite/implementations while preserving algorithm, order and results. Reborrow the actual current providers; do not work around this with copied state, duplicate budget/service/RNG, or another callback service layer. This bridge belongs with the persistent callback Send migration before full Brain dispatch, and the unchanged Strategy source transcript is its regression gate. FeatureModule's immutable receiver can remain because the actual module object uses its short interior mutable borrow.

The full ModulePercept scratch must be the current declared typed tick input, with live actual Memory/Knowledge/path/RNG adapters—not a reconstructed narrower StrategyPercept, old cached ctx or expected snapshots. Clear scratch after Strategy returns; later act/intents/adjust must see fresh live context, including choices recorded on adoption. Do not store borrowed tick/RNG/path references in callbacks or module state. Retain original object lifetime and cfg-key lifetime explicitly, including continued use after end; no global wrapped-once flag or value-based cfg merging.

Whether the final sealed Module/Tactics signatures allow this exact adapter remains a real interface gate after the known goals-context bridge is fixed. That cannot be released from provisional WIP types. Prefer the least signature/visibility bridge needed after seals; do not duplicate module or tactic FSMs. The proposed persistent handles must follow the Send decision above rather than the plan's Rc shape.

One wording repair: evidence README says Memory.note_sent occurs for Brain-stamped Move/Stop. Source `brain.ts:205–213` calls noteSent for EVERY released command; only Move/Stop gain wrapping sequence numbers. State this explicitly, including cast, because the existing core-wish-slip history earns Memory.lastCast from actual release. No new source case is required. Private end remains nonterminating/pure; once-only stop/finalization belongs to the later runner.

## Independently dispatchable path bridge

Current `bots/paths.rs:124–167` has one trip core: fresh cache first, then owned budget.take, search/store, stale answer, fallback. `walk` and `path` (`:169–189`) reject nonfinite geometry before trip. LOS/clear/collision_map do not spend allowance. Add the proposed crate-private borrowed-budget entries and select owned versus borrowed allowance only at that existing miss/take point. Old new/budget/budget_mut and PathBudget clone/value semantics remain unchanged. Do not copy room allowance into each service, replenish it in set_frame/tick, or create a second cache/search core.

Existing frozen `parity/policy/bot-tactics.json` and `bots/paths_parity_tests.rs::the_path_service_matches_the_source_step_by_step` already cover the old service's script, counters and budget observations. Reuse it unchanged for the old owned path. Exercise the same frozen service script through the borrowed path with external budget observations and owned budget unchanged; this catches stale/cache/fallback/invalid-input differences without recapturing source. Add only a small native two-service ordered-miss/cache-hit/reset test for the actual new sharing capability. The released Brain identity-shared-budget history supplies the caller/service identity meaning; its full replay waits for Brain and is not demanded for this plumbing change.

No global path geometry/refactor, new gate-map behavior, callback Send migration or public bot activation belongs to that bridge. Preserve existing source precision/tolerances and explicit path-service limits. Independent callback/Brain gates do not block its dispatch. Proposed exact scope/acceptance is in new P-BOT-PATH-BUDGET-1, for Root base/worktree/lease assignment.

**Disposition:** approve the additive path bridge plan; correct full Brain service ownership, make the combined persistent Send/mutable-goals-context bridge a pre-Brain dependency, preserve all-command noteSent wording, and retain final component/interface gates. No full Brain or live dispatch release is granted here.

## Immutable review bindings

Read-only plan/code/overlap bytes at 8820c74d:

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `docs/backlog/packets/P-BOT-BRAIN-NATIVE-1.md` | 19014 | `f6607633abb6373fc2bbe9e6ee8290bd72e7877bda7f0232f4a7caa2187f2d01` |
| `docs/evidence/bot-brain-native-plan/README.md` | 12099 | `dea398625a68b463a8ab59f6000be49d37532506146c5c0d7c33e36a4c56d81d` |
| `crates/rh-policy/src/bots/paths.rs` | 6578 | `1a25bae35dc5a3533dfeb8b0eb95e26f5a487c9fc9bef63e674554bc78a077b4` |
| `crates/rh-policy/src/bots/paths_parity_tests.rs` | 6266 | `4d80b7472c104afe2551a8ac98921637a8148d09a293bbd2b011b408ab740ca2` |
| `parity/policy/bot-tactics.json` | 22987 | `eee99102ed65c580dfe82e696e32fb9887d7ebc66e935349e43d9bd1ba909a5f` |
