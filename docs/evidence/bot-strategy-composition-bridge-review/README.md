# Strategy composition bridge — independent plan review

2026-11-10. **RELEASE the bounded bridge plan conditional on Root's exact documentation corrections below.** Root has accepted those corrections and will apply/commit them before dispatch. No other concrete blocker in this scoped plan review. This is not Rust/code admission or full Brain/live activation. No Rust, tests, captures, cloud, worker or Claude communication was performed by the reviewer.

Reviewed the draft P-BOT-STRATEGY-COMPOSITION-BRIDGE-1 and evidence README against current admitted Strategy, every callback-alias constructor/consumer, both FeatureModule implementations and the source-goals callback requirement. Initial draft bindings: packet 9191 bytes/SHA256 `da4923da4deea7464611bf9e057af6e497cf4be244a23050c023118804a144da`; evidence 5266 bytes/SHA256 `16b26fffdc6557df2a4175fa9fb05ee3d53564f23eabc54652c117afa6597fba`. Integration HEAD at final inspection was 20a4606a493ad26f62779e41a5e179edfd9fe6ef; the draft files were new/untracked. Later Root corrections are a separately identified dispatch document delta, not these original reviewed bytes.

## Exact required documentation corrections

The draft changes TraceHandle from Rc<RefCell<TraceLog>> to Arc<Mutex<TraceLog>>, but simultaneously forbids any source_tests.rs edit. That cannot compile: eight current replay/snapshot accesses still call borrow/borrow_mut. Root approves the direct Arc/Mutex approach rather than a new wrapper emulating RefCell APIs.

Add **only access/guard-lifetime mechanics** in `crates/rh-policy/src/bots/temporal_percept/strategy/source_tests.rs` at current lines 2754,2824,2911,3049,3143,3203,3366,3940. Convert those trace reads/resets to short lock+expect guards, taking owned encoded snapshots when needed and dropping reset guards before actual dispatch. Do not move the reset across preflight, change what is compared, alter controls, decode declarations differently, change expected values or retain locks across callbacks. These eight hunks do not grant a file-wide reader/comparator/replay rewrite.

Recorder internals in already leased `source_trace.rs` require the same mechanics at 117,163,1342, alongside the type/factory changes. Independent-instance callbacks in `private_strategy_tests.rs` need their existing capture storage and readouts migrated consistently: the read accesses at1014,1015,1101,1106,1110,1115 are part of that same storage-only change. Test-local Rc not captured by persistent callbacks may remain.

Make the unchanged `bots::temporal_percept::strategy::private_strategy_tests` filter explicit as a required regression gate, retaining all old 11 declared tests including attacking-instance independence. Run it with the new Send/forwarding controls as well as the complete existing source filter. Do not substitute only the attacking control or seven positive source replays for the old declared regressions and four strict/trace/intake source controls. Final post-bridge counts must be actual recorded totals; do not preinvent how many tests the new control organization adds.

## Accepted narrow production bridge

- `strategy/types.rs:364–365`: Arc callbacks with Send+Sync captures make the actual persisted options Send-compatible; retain callback return/argument behavior and clone the same allocation. `FeatureModule::goals` at509–514 gains a mutable StrategyContext argument while retaining its immutable receiver/default result and existing trait bounds.
- `strategy/mob_hunt.rs:223`: the default no-op uses the same new Arc alias. No hunter/decision/reset algorithm changes.
- `strategy/engine.rs:284–296`: the existing registration-ordered enabled/goals stage forwards its current mutable context. If needed, copy immutable module-slice/features references out of cfg before the loop; this copies references, not modules/providers/state. Preserve candidate normalization, dedupe/selection and RNG/callback order.

StrategyOptions and HuntAdapterOptions already refer to the aliases. `hunt_adapter.rs:46`'s existing opts.log.clone resolves to the same Arc allocation; no source hunk is needed merely to spell Arc::clone differently. Wrapping an Rc-containing Strategy in Arc<Mutex> would not solve Send and is not this design.

The actual source chest goals constructs a fresh ChestHunter and calls huntInput's mutable path callback (`modules/chests.ts:134,237–248`). The new hook can reborrow the exact current path/RNG providers rather than make a second cache/allowance or copy/reseed streams. The full ModulePercept scratch remains the later Brain adapter's responsibility; this bridge neither invents omitted extras from StrategyPercept nor implements modules.

## Final allowed files / effects

| Existing file under `crates/rh-policy/src/bots/temporal_percept/strategy/` | Exact allowed change |
| --- | --- |
| types.rs | Two persistent callback aliases; goals mutable-context signature/default body type adjustment only. |
| mob_hunt.rs | Default log callback construction for the new alias. |
| engine.rs | Existing goals dispatch borrow plumbing; optional local immutable reference bindings. |
| source_trace.rs | Shared Arc/Mutex recorder storage/access, stored callback construction/captures and RecordedModule goals signature; synchronous transcript shape/order unchanged. |
| private_strategy_tests.rs | CountingModule signature, captured independent-instance state/access mechanics, focused actual-type Send and mutable-service forwarding controls. |
| source_tests.rs | Exactly the eight existing trace access-only sites identified above, including immediate owned snapshots/guard release if needed. No reader/comparator/intake logic change. |

Add only Root-assigned bridge evidence/receipt paths. Source/tool/corpus/expectations, source_reader/source_strict, strategy algorithms/types/visibility beyond the named changes, path service, public Policy/Seat and other components remain protected. HuntAdapter's field types automatically follow the aliases and its behavior/clone path need no edit. Root chooses exact base/worktree/target and scope; no unsafe Send/Sync, new global FeatureModule bound or whole-Brain locking is permitted.

Persistent Arc callback captures must themselves be Send+Sync, including the actual recorder they capture. A poisoned recording lock must fail rather than forge a successful source callback. Acquire a trace lock only while appending/resetting/copying owned data; release it before another callback/service call. Preserve one shared callback/RNG sequence: no independent per-hook buffers merged later, omitted events, sorting or answer tapes.

Repository scan found only RecordedModule and CountingModule as current Strategy FeatureModule implementations, and only the recorded options factories, default MobHunter log and independent-instance probe as callback constructors beyond the existing alias-consuming options. Ephemeral borrowed StrategyContext traits/boxes need no new Send bound. The later production Brain/Modules object graph still requires actual Send-owned persistent handles, including Registry custom callbacks; correcting packet-owned Modules before its first seal is preferable to another later rewrite and is outside this Strategy lease.

## Meaningful bounded gates

The planned forwarding control is appropriate if it reaches the module hook through actual Strategy::decide, makes a real path request and real mutable RNG draw, and asserts effects on those SAME caller-owned providers afterward. Confirm the hook was reached; a separate pure validator/fake answer call is not that proof. This control is plumbing evidence, not a substitute module/source oracle. Actual-type compile assertions must cover Strategy, HuntAdapter and MobHunter; eventual full Brain gets its own Send assertion after all components are sealed.

Required existing source gate remains primary 98 cases / 658 operations plus module-key 4 histories / 48 calls, all seven positive replay tests and envelope/trace-negative/strict-reader/actual-intake-nonadvance controls. Preserve exact state, raw ordering, callback args/results/order and RNG transcripts; no numeric whitelist or expectation change. Run old declared 11 plus the new controls, format and strict default/all-feature rh-policy library/tests lint. The existing source transcript is the behavior regression authority. No heavy unchanged Memory, full workspace/hash campaign or source recapture is warranted for these signature/storage mechanics.

The separate borrowed path-budget bridge remains independently dispatchable; this packet changes no room budget ownership. Luna's revised native Brain plan now correctly binds caller service identity across same-cfg/recreation, requires the Send/mutable-goals bridge before composition, and states noteSent for every released command with sequence stamping limited to Move/Stop. Final Tactics/Modules/Hand seals and private Brain interface/admission remain separate gates; fair publication/driver gaps remain open.

**Conditional disposition: RELEASE for Root's bounded dispatch after adding the eight access-only source_tests hunks and explicit old declared 11 gate to packet/evidence.** No additional design/capture campaign is required. Inspect the eventual exact code seal and actual unchanged-source/control receipts before native bridge admission.

## Final Root-corrected plan release — 2026-11-10

**RELEASE exact documentation cut `afdb13ac2b7b63b7ffc363392290102e08140904` for Root's isolated bridge dispatch.** Independently read the committed packet/evidence: the eight source_tests trace-access hunks are now explicitly leased with no reader/comparator/replay logic change, the necessary recorder/test readout accesses are identified, and the unchanged declared11 regression filter is an explicit gate alongside full source11/new controls. The earlier blanket source_tests prohibition is removed; all protected source/expectation/algorithm boundaries remain. This satisfies the conditional review above. No new code/tests/capture were executed for this final doc check.

Final committed packet:10117bytes/SHA256 `3bf77a840291c4ca32f0a2abb3d26acd646271830ac7aadfdc293bd9601aff87`; evidence:5952bytes/SHA256 `a4d65b5d542994897c52dd0ea9a2dc798c81a74a70949fa77394d61f235316cb`. Native implementation/admission, final Brain object-graph Send, component seals and fair live/driver gates remain separate.
