# Strategy composition bridge plan review

Plan-only record for [P-BOT-STRATEGY-COMPOSITION-BRIDGE-1](../../backlog/packets/P-BOT-STRATEGY-COMPOSITION-BRIDGE-1.md).
No Rust or tests were edited or run. No source capture, worker contact, or Claude contact occurred.

## Why this bridge is needed before production Brain

The independent [native Brain plan review](../bot-brain-native-plan-review/README.md) found two concrete seams. The
first is structural: `Policy: Send` already exists, while persistent `StrategyOptions`, `HuntAdapterOptions`, and
`MobHunter.log_fn` retain `Rc<dyn Fn...>` callback types. A wrapper around `Strategy` cannot erase those `Rc` fields.
The second is input mutability: real chest module goals can consume the live path allowance/cache and their declared RNG
stream, but `FeatureModule::goals` currently receives only `&StrategyContext`.

The minimal fix is limited to callback aliases/default construction, one `FeatureModule::goals` context signature, and
its single existing Strategy dispatch call. Callback aliases use `Arc<dyn Fn... + Send + Sync>`; cloned callback handles
remain clones of the same allocation as Strategy passes the log callback through HuntAdapter into MobHunter. The
existing option behavior, callback arguments/results/timing, source state, and synchronous callback order stay intact.
The goal hook retains its `&self` receiver and changes its context borrow to mutable, allowing the real adapter to
reborrow the current tick's path/RNG services without creating copies.

## Exact current call sites and test impact

- `strategy/types.rs:364-365`: `AttackFn` and `LogFn` aliases; `:509-513`: `FeatureModule::goals` signature.
- `strategy/engine.rs:85-87`: persisted Strategy options use those aliases; `:188-193` shows `decide` already accepts
  `&mut StrategyContext`; the module loop at `:284-296` is the sole production `goals` call and already lies before
  candidate dedupe/selection.
- `strategy/hunt_adapter.rs:20-22,30-47`: options retain the callback aliases and pass `opts.log.clone()` into the
  hunter. Keep the Arc allocation shared; no algorithm hunk is expected.
- `strategy/mob_hunt.rs:186,209-224`: retained log alias and default no-op currently use `Rc`.
- Current FeatureModule test implementations are `RecordedModule` in `strategy/source_trace.rs:320-348` and
  `CountingModule` in `strategy/private_strategy_tests.rs:127-134`. Those signatures must follow the trait. The
  current Brain adapter does not exist yet; it must forward the full declared module percept and the same mutable tick
  services when the later B1 composition is dispatched.
- Persisted callback capture sites are `source_trace.rs:75-80,171-185` and
  `private_strategy_tests.rs:864-936`. Use one `Arc<Mutex<TraceLog>>` for the source recorder so callback and RNG
  entries remain in one shared sequence; use Send-safe state for the independent-instance callback regression. Any
  test-local `Rc` that does not enter a stored callback need not change.
- Root's independent review adds the necessary mechanical access-only lease for `source_tests.rs` at current
  2754/2824/2911/3049/3143/3203/3366/3940. These eight TraceHandle borrow calls become short lock/expect guards,
  with owned snapshots and guards released before comparisons/dispatch. Recorder accesses117/163/1342 and the
  independent-instance test readouts1014/1015/1101/1106/1110/1115 follow the same mechanics. No test logic,
  reader/comparator or expected value is changed by this access lease.

## Forwarding and verification contract

Strategy's call order remains: built-in and loot candidates, then each enabled module's `goals` in registration order,
then existing dedupe/selection. The mutable context is the existing current-tick Strategy context. The full Brain adapter
must combine the predeclared full `ModulePercept` scratch with that same context's `paths`, `decide`, and `lapse` borrows
for its synchronous source module call. It must not reconstruct omitted facts from `StrategyPercept`, use a copied
provider/budget/cache, reset the shared room budget, or reseed a stream. A small test module should make a real path
call and consume a real context RNG draw through the actual `Strategy::decide` dispatch, then assert service effects
afterward. This proves mutability/forwarding, not full module parity.

The existing frozen witness gates remain unchanged: primary Strategy 98 cases/658 operations and the module-goal-key
supplement 4 histories/48 calls, including strict intake, trace-order/negative controls, and non-advance on malformed
input. A compile-time or unit test must assert `Strategy`, `HuntAdapter`, and `MobHunter: Send`; the eventual Brain will
receive its own full-object-graph Send assertion after its component APIs are sealed. Also preserve the independent
attacking-instance behavior and shared ordered callback trace. Direct `Arc::clone` preserves the callback allocation;
no wrapper closure should replace it. Run both default/all-feature policy lint plus format gates. No source files or
expected outputs need regeneration.
Run the existing declared11 `private_strategy_tests` filter plus new controls as well as source11; report the actual
counts separately and preserve each unchanged regression.

The earlier native Brain plan's persistent `Rc<RefCell<dyn SourceModule>>` adapter sketch cannot enter a production
`Policy: Send` object graph. The eventual Brain/module adapter must use a Send-owned identity-preserving handle or arena
once the Modules interfaces are sealed. This is a later composition gate, not an expansion of the Strategy callback
bridge lease.

## Disposition

The seams are concrete and narrowly addressable. This packet proposes the compatible bridge but authorizes no
implementation. Path budget sharing is separately handled by P-BOT-PATH-BUDGET-1. Final Brain/module-adapter design
and full object-graph Send remain gated on component seals and Root's later dispatch.
