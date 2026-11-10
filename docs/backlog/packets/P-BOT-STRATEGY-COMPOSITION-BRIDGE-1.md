# P-BOT-STRATEGY-COMPOSITION-BRIDGE-1: Send-safe callbacks and mutable module-goal services

Plan-only precondition for production private Brain composition in [P-BOT-BRAIN-NATIVE-1](P-BOT-BRAIN-NATIVE-1.md).
No code dispatch is granted by this packet. DeepSeek owns any future Rust/tests; Root chooses the exact base and leases.
This packet addresses the two Strategy seams independently identified by the native Brain plan review. The borrowed
RoomPathService allowance bridge remains separately scoped in [P-BOT-PATH-BUDGET-1](P-BOT-PATH-BUDGET-1.md).

## Source-backed problem

`rh-policy::Policy` already requires `Send` (`crates/rh-policy/src/lib.rs`). The admitted Strategy keeps callback
objects in persistent state: `StrategyOptions.attacking/log` (`temporal_percept/strategy/engine.rs`),
`HuntAdapterOptions` retained by `HuntAdapter` and cloned into the hunter (`strategy/hunt_adapter.rs`), and
`MobHunter.log_fn` (`strategy/mob_hunt.rs`). Their aliases in `strategy/types.rs` are currently `Rc<dyn Fn...>`;
`MobHunter::new_with_log` also builds its default no-op with `Rc`. Thus the production Strategy/HuntAdapter state
cannot satisfy `Send`, even when the current option is absent.

Separately, `FeatureModule::goals(&self, &StrategyContext)` in `strategy/types.rs` and the one call in
`strategy/engine.rs::Strategy::decide` expose the path and RNG interfaces only behind a shared context reference.
The real private chest module's goal hook at `packages/server/src/bots/brain/modules/chests.ts:237-252` calls
`ChestHunter.decide`; its `huntInput` at `:124-139` supplies `ctx.svc.paths.walk` and `.los` callbacks. The native hook
needs the same live mutable path allowance/cache and declared RNG lanes as the rest of the tick. A parallel chest goal
engine or copied path/RNG provider would break source call order and service identity.

## Narrow production hunk allocation

Only these existing production files are in scope:

1. `crates/rh-policy/src/bots/temporal_percept/strategy/types.rs`
   - Change aliases to `Arc<dyn Fn() -> bool + Send + Sync>` and `Arc<dyn Fn(&str) + Send + Sync>`.
   - Change only `FeatureModule::goals`' context argument from `&StrategyContext` to `&mut StrategyContext`; retain
     `&self`, the default empty result, module ordering semantics, and every other field/type.
2. `crates/rh-policy/src/bots/temporal_percept/strategy/mob_hunt.rs`
   - Construct the default no-op `LogFn` with `Arc::new`. Keep `new`, `new_with_log`, call timing, arguments, and
     behavior unchanged.
3. `crates/rh-policy/src/bots/temporal_percept/strategy/engine.rs`
   - At the existing module-goal call in `Strategy::decide`, pass the current mutable `StrategyContext` to
     `FeatureModule::goals`. Preserve enabled-check and registration order, candidate normalization, and subsequent
     dedupe/selection. If borrow checking requires it, copy the immutable `modules` slice and `features` reference out
     of `ctx.cfg` into locals before the call; do not clone module state or `StrategyContext` providers.

`StrategyOptions` and `HuntAdapterOptions` already use the callback aliases; their fields and stored clones must resolve
to the new Send-safe object without changing callback identity. Verify that `HuntAdapter::new` passes an `Arc::clone`
of the same callback into `MobHunter` while retaining it in `opts`; do not wrap/copy the callback into independent
closures. No Strategy/HuntAdapter/MobHunter algorithm, type visibility outside the private subsystem, FeatureModule
trait bounds, policy interface, or path service implementation is part of this bridge.

## Narrow test-support hunk allocation

Only the following existing Strategy test files may change:

- `strategy/source_trace.rs`: its persisted test callbacks capture `TraceHandle`. Replace the captured
  `Rc<RefCell<TraceLog>>` with one shared `Arc<Mutex<TraceLog>>`; change `options_log` and `options_attacking` to build
  the new callback aliases, and retain their exact arguments/results and shared ordered callback/RNG transcript.
  `RecordedModule::goals` adopts the mutable context signature. Keep callback recording synchronous and release the lock
  before returning. A poisoned lock must not be translated into a successful callback result.
- `strategy/private_strategy_tests.rs`: migrate the `Rc<RefCell<_>>` state actually captured by
  `private_strategy_attacking_instances_are_independent`'s persistent callbacks to Send-safe owned shared state; keep
  independent-instance behavior and event values. `CountingModule::goals` adopts the mutable context signature.
  Its associated readout accesses also change mechanically to the same short lock/expect access (current lines
  1014/1015/1101/1106/1110/1115). Uncaptured test-local `Rc` may remain.
- `strategy/source_tests.rs`: ONLY the eight existing TraceHandle access expressions at current lines
  2754/2824/2911/3049/3143/3203/3366/3940 may change from `borrow`/`borrow_mut` to short `lock().expect(...)`
  guards. Obtain owned encoded snapshots before comparing, and drop reset guards before dispatching callbacks.
  No reader, decoding, comparator, control, expectation or fixture logic changes are leased.

No source capture, source tool, corpus, expected trace, strict reader or old fixture change is allowed. The only
`source_tests.rs` lease is the eight access expressions above; recorder accesses in `source_trace.rs` at current
117/163/1342 need the same mechanical change. There are two current FeatureModule implementations in Strategy tests
(`RecordedModule` and `CountingModule`);
the Brain-owned adapter created by the later B1 composition must implement the new signature and is not permission to
change or duplicate the actual private modules.

## Mutable service forwarding contract

The Strategy trait call remains at its current module-goal stage. Its `&mut StrategyContext` must carry the exact
current tick's existing mutable `paths`, `decide`, and `lapse` service references. The later real module adapter must
construct its call from the already declared full current-tick module percept scratch and those same context
references; it may not rebuild missing module facts from the narrower `StrategyPercept`, clone/reset/replenish a path
budget, create another path cache/search provider, reseed RNGs, or use fixture outputs as inputs. Service calls and
draws occur inline in the existing module registration order, before Strategy's existing candidate dedupe and
selection. This preserves each RoomPathService/cache identity and shared room allowance semantics from the separate
path-budget bridge.

Add one meaningful focused forwarding control in `strategy/private_strategy_tests.rs`: an actual `Strategy::decide`
module hook receives mutable `StrategyContext`, calls the passed path service and consumes a declared mutable RNG
lane, and the test verifies those effects on the same instrumented service/stream after the decision. Keep the control
deterministic and small; it should fail if a read-only or copied provider is forwarded. It is an adapter plumbing
control, not a new source case or a substitute module implementation.

## Compatibility and acceptance gates

- Keep all existing source comparison and strict-control behavior unchanged: primary Strategy source **98 cases / 658
  operations**, module-goal-key supplement **4 histories / 48 calls**, all seven positive replay paths
  (`private_strategy_source_tracker_parity`, `..._hunter_parity`, `..._build_route_parity`, `..._memory_parity`,
  `..._hunt_adapter_parity`, `..._strategy_parity`, and `private_module_goal_key_source_parity`),
  `private_strategy_source_envelope_guard`, `private_strategy_source_trace_negatives`,
  `private_strategy_source_reader_controls`, and `private_strategy_source_intake_non_advance`. Expected values remain
  comparison oracles only; no recapture or answer edits.
- Add compile-time/unit assertions that the actual `Strategy`, `HuntAdapter`, and `MobHunter` are `Send`, plus a focused
  callback behavior/shared-trace and independent-instance assertion. The direct `Arc::clone` storage path preserves
  callback allocation identity; no wrapper closure should replace it. Do not use `unsafe impl Send/Sync`, weaken
  `Policy: Send`, swallow callback errors/panics, or add shared locking around the whole Brain/Strategy call.
- Preserve callback values, number/order of callback invocations, exact RNG transcript, source-state transitions and
  Strategy outputs. `Arc` cloning shares the original callback allocation; it is not permission to invoke callbacks at
  different times or memoize their values.
- Run the scoped Strategy source/strict/semantic tests, the new forwarding/Send controls, Rust formatting, and the
  default plus all-feature `rh-policy` lint gates required by the existing Strategy packet. No full-workspace run or
  unchanged unrelated suite campaign is requested here. Preserve first failures and final exact hashes/commands.
- Run the unchanged declared `private_strategy_tests` regression filter (the existing11 plus the newly added
  forwarding/Send controls), separately from the source11. Report each actual count without summing overlaps.

## Explicit limits

This bridge only makes the admitted Strategy dependency Send-compatible and permits the existing module-goal dispatch
to use mutable tick services. It does not implement or admit the full Brain, module adapter, complete chest module,
caller/registry lifecycle, fair `Observation`/`FrameRing` binding, `validate` + `Sim::submit` driver, live/headless
activation, path allowance ownership change, persistence, wire/client changes, or full-game parity. The later full
Brain must still prove its *entire* persistent object graph is `Send` after sealed Hand/Tactics/Modules interfaces are
available. In particular, the earlier plan's persistent `Rc<RefCell<dyn SourceModule>>` wrapper sketch is not a valid
production `Policy: Send` representation; replace it with a Send-owned identity-preserving handle/arena after the
Modules interface is sealed. This packet does not broaden the Strategy lease to choose or implement that later adapter.
