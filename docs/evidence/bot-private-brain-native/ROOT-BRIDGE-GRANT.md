# Root authorized additional draw/path bridge

 (2026-11-10, after concrete worker obstruction)

Root approves the independently reviewed [draw/path bridge](../../evidence/bot-brain-composition-interfaces/brain-live-bridge-review.md),
SHA256 `3f2cc11b2253789dbe67ff2d2cec624ef5260a55e2fffdd6231717517a9b4294`, in the existing Brain worktree.
This extends the prior exact four-file lease only as follows: the existing `strategy.rs` may add the one
parent-visible `HuntMobLike` reexport, and `crates/rh-policy/src/bots/random.rs` may add the reviewed `cfg(test)`
scoped observer plumbing, one notification of the already-computed value at `next_f64`, and an additive test module
declaration. The optional NEW `crates/rh-policy/src/bots/random/draw_trace_tests.rs` is allocated for its focused
bridge controls. No production RNG representation, recurrence, traits, cloning, concrete Hand API or component
algorithm changes. No unsafe code or persistent non-Send state.

In already-owned new Brain files, use the actual typed rich-mob override and the same caller path service/allowance;
record actual Hand motor/lapse draws synchronously into the existing global recorder. Keep actual borrowed instances
in place, release registry borrows before recording, isolate per-thread/nested/parallel scopes, and restore prior
registration on return and unwind. Never dereference stored pointer identities. Remove state-delta reconstruction,
its finite4096 search and all per-lane regrouping/sorting. Exact global callback/RNG sequence remains mandatory.
Previously relaxed passes are historical/partial and may not be relabelled final. Frozen source/tools/expectations
stay unchanged. No Humanizer/clicks/Strategy-engine or other new file lease is granted.

Required focused additions: rich four Hunt callback rows; exact31/855 and Hand6/12 global traces; reject a comparator
control swapping different-lane draws while preserving per-lane values/counts; observed/unobserved real Hand/RNG
outputs, final states and draw counts equal; no hook leakage after return/unwind or across concurrent/nested tests.
Retain all other original packet gates, actual Send proof and strict default/all-feature lint. DeepSeek implements;
Root reviews/seals. No early Claude communication, activation, merge, push or deployment.


---

Independent review copied verbatim below; original review SHA256 as above.

# Brain draw/path bridge review — 2026-11-10

Disposition: **two narrow additional bridges required; current weakened comparison is not admission evidence.** This is an interface review of the moving native Brain checkout at HEAD `c050d938da37562fea98497d7a67dedcb5477b50`, not a review or release of the incomplete Brain. Root retains dispatch authority. No Rust, tests, captures, or primary-checkout changes were made.

Inspected checkout: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-brain-native`. The worker request is `docs/evidence/bot-private-brain-native/root-bridge-request.md`, SHA-256 `36fc5f5881adf2c9f460f287e4ec3042e2dd66b007489652c2ecf0f8868c44e5`.

## 1. Hunt callback type: accept the visibility-only bridge

`crates/rh-policy/src/bots/temporal_percept/strategy/types.rs:475` declares `PathApi::walk_mob` using `mob_hunt::HuntMobLike`. Its default reduces that argument to a point. The struct is already `pub(crate)` with public fields (`strategy/mob_hunt.rs:28`), but its parent child module is private (`strategy.rs:8`). The sibling Brain adapter cannot name it. Its current `PathApi` implementation (`brain/adapters.rs:2084`) overrides point/camp walks, not mob walks. The admitted Strategy fixture adapter already demonstrates the exact typed override at `strategy/source_tests.rs:2062`.

Smallest permitted extension: one `pub(super)` reexport of `HuntMobLike` alongside the existing engine facade in `strategy.rs`, then one typed `walk_mob` override in the already-owned new `brain/adapters.rs`. Keep the child module private. The override must encode the actual passed MobLike in the source field order, preserving optional/undefined/text domains, and pass its coordinates through the same `call_walk`, actual caller service, and borrowed allowance. Do not infer a substitute mob from Memory, change the engine, or create a second path service/cache. This closes the worker-reported four rich-argument callback rows; successful position-only walking does not close those rows. Full frozen trace comparison must establish the count and exact arguments/results after repair.

## 2. Humanizer draws: reject the per-lane downgrade

The admitted `Humanizer::Context` takes concrete mutable `Rng` references (`humanizer.rs:72–78`). Its distributions/clicks also take concrete `Rng`; the existing Strategy `RngStream` implementation (`strategy/types.rs:369–376`) delegates to `next_f64` but does not make Humanizer's context polymorphic. `random.rs:38–55` exposes only construction and advancing draws, with no observer or overridable dispatch. There is no existing public trait seam to wrap this call path.

There is a real order difference to detect: `clicks.rs:155` draws lapse first, then motor Gaussian draws at 163–168. The WIP `brain.rs:777–824` instead snapshots both states, invokes Hand, then `recover_hand_draws` emits every motor draw before every lapse draw. `recover_lane` at 1441 additionally searches only 4096 advances and silently returns if none matches. State-delta reconstruction proves neither cross-lane order nor placement among callbacks, even if every lane value/count and released command matches. Different interleavings have identical final lane states.

The frozen source has the stronger observable: `tools/bot-private-brain-fixtures/runner.mts:23–35` appends callbacks and RNG results into one sequence at their actual invocation/draw sites. The direct Hand producer (`hand.mts:14`) likewise appends actual draws. The current native comparator (`brain/tests.rs:1476–1584`) explicitly groups motor/lapse rows and compares them per lane. This is a contract relaxation. **No current relaxed PASS count closes the original global trace requirement.** Keep those receipts accurately labelled partial/historical; restore exact ordered sequence comparison before final sealing.

### Smallest bridge recommendation

Authorize a **`cfg(test)`-only scoped observer at `Rng::next_f64`**, in `crates/rh-policy/src/bots/random.rs`, without changing the production RNG representation, constructor, recurrence, division, cloning, equality, or concrete Humanizer/distribution APIs. Observe the actual already-computed f64 immediately before returning it. Do not also emit in `next_u32`, which would double-count a normal f64 draw. All inspected Hand/distribution/click paths reach `next_f64`; no additional draw endpoint is needed for this seam.

A scoped helper can bind the actual two mutable Hand lane instances to actor/lane metadata for one synchronous submit/release and execute the real call with those same references. A thread-local observer registry keyed by those instance addresses is one small safe arrangement: compare identities only, never dereference stored pointers or use unsafe code; keep the instances in place for the duration of that borrow. Preserve/restore the prior scope with RAII, including unwind. Release any registry borrow before invoking its recording sink. Scope isolation must prevent parallel tests, nested scopes, another Brain, unregistered RNG clones, or later operations from inheriting the recorder. The observer appends only the real returned value to the same existing ordered recorder; it never supplies draws or runs expected/source answers.

Use it only around the concrete Hand calls. Existing real-time recorded wrappers elsewhere may remain, with no overlapping registration/double emission. In the new Brain files, remove state-delta recovery and the lane-grouping comparator; register real motor/lapse metadata and compare the entire frozen trace, including global sequence, without sorting. This requires no persistent recorder field in `Rng`, no persistent `!Send` Brain state, no owned-tier change, and no Humanizer production refactor. Exact helper spelling is DeepSeek's implementation decision within this boundary. A per-instance callback field would unnecessarily disturb the RNG's derived traits/layout/clone semantics; a production-wide conversion of Humanizer/distributions to trait objects is a larger alternative, not required here.

## Exact additional scope and proof boundary

- Existing `temporal_percept/strategy.rs`: the single HuntMobLike parent reexport only.
- Existing `bots/random.rs`: cfg(test) draw observation plumbing and its one cfg(test) notification in `next_f64`; additive focused test-module declaration only if needed. No arithmetic or production field/API changes.
- Optional new `bots/random/draw_trace_tests.rs`: test-only bridge checks; Root must grant the path if selected.
- Already packet-owned new `temporal_percept/brain.rs`, `brain/adapters.rs`, and `brain/tests.rs` (and their new trace helper if needed): exact rich mob override, real scoped draw recording, removal of recovery/grouping, meaningful exact comparator controls and honest receipts.

No additional Humanizer, clicks, Strategy engine, module, path-service, source/tool/corpus, public bot, Sim, protocol, Cargo, or shared-status lease follows from this review.

Required finite checks within the existing Brain acceptance run: all 31 histories/855 operations and six direct Hand profiles/12 operations retain exact global callback/RNG sequence, actual arguments/results, lane indices/values/counts, and state/output comparison; the four Hunt rows retain their rich argument. A comparator control must exchange two adjacent different-lane draws while retaining each lane's own values/counts and be rejected through the same complete comparison. The focused hook proof must show observed versus unobserved real RNG/Hand behavior has identical outputs, final RNG states, and draw values/counts; actual interleaving is recorded, and scopes do not leak after return/unwind or across concurrent tests. Reuse the admitted Hand/random overlaps and already frozen Brain corpus; no recapture or new generic campaign is required. Final fmt and strict default/all-feature lint remain the packet's gates.

Inspected WIP SHA-256 bindings (not a seal):

| File | SHA-256 |
| --- | --- |
| `bots/random.rs` | `d369b36155e7935c7b80763453ca5db3b1323a83b2239ffa0a20c61fa5d99a52` |
| `bots/humanizer.rs` | `6d08c937974ec6dd778cece44846b73ba4d72167c3021d9f442fe40e51843793` |
| `temporal_percept/brain.rs` | `2559cf723c76d816bc4b35fcfab530a0bb2b8bccdc9e14bd19dc1b3a866f1718` |
| `temporal_percept/brain/tests.rs` | `813a05ba9278bf41a46f6f812e33d09345cffb4902caae8cdab7e5fa16ec9ed0` |

This proposes a bridge grant, not native Brain admission or live/public activation. Root must authorize the extra existing-file hunk before DeepSeek changes it.
