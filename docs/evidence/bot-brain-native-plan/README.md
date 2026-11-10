# Full private Brain native plan review

## Status

Plan-only, not dispatched. This note accompanies [P-BOT-BRAIN-NATIVE-1](../../backlog/packets/P-BOT-BRAIN-NATIVE-1.md).
No capture, Rust build/test, native implementation or live/public adapter was run or changed for this plan. The source
candidate is independently RELEASED at `6aaa4c6d33dad8a47ab7957b41d420fa78954af6` and integrated as `5a5a28c6` with
review `8fa97f24`. See [source README](../bot-private-brain-source/README.md) and
[source review](../bot-private-brain-source-review/README.md) for exact source/tool/corpus/runtime pins and independent
reproduction.

## Bounded native outcome

The next native component should implement the real `createBrain` scheduler/coordinator over the existing component
engines, in actual source order; it must not reimplement Strategy, Tactics, module FSMs, Memory or Humanizer. It is not a
public BotBrain or a live driver. The complete source fixture set is 31
chronological histories / 855 operations including 425 ticks, plus 6 direct Humanizer overlap profiles / 12 operations;
the source witness also includes 32 separate real Knowledge constructors / 2,240 draws and 111 Brain Knowledge calls.
Source reached 40 semantic assertions and rejected 30 malformed reader inputs before the source runner. The source
expectations are captured from unchanged TypeScript and are the expected comparison oracle; no expected answer is a
native runtime input, state installation or setup value.

The Hand feature gate is now admitted: source candidate `76f8a9aadb7decfa4532c02f03403867d3816339`, integrated as
`483c149018eb648b1d7904ab9d82cb297cf8a238`, with Root binding review `2436ed80`. Tactics' native candidate remains
HOLD pending the reviewed repair and independent follow-up; Modules' native APIs remain WIP. The callback/goal-context
Strategy bridge and borrowed path-budget bridge have separate packets. Path implementation is independently dispatched
from `37403399` in `backend-bot-path-budget`; Strategy awaits review/dispatch. Neither bridge is yet admitted. Full Brain
dispatch still waits on those exact bridges and remaining component seals.

The composition sequence preserves all source state boundaries:

```text
caller: RoomPathService/cache construction -> registry enabled selection -> createBrain
room:   one shared PathBudget.start_tick per room frame
Brain:  tagged streams -> Knowledge(tag 3) -> Memory -> Humanizer(features) -> Tactics
        -> Brain-local guarded module wrappers/config -> Strategy(attacking closure)
tick:   paths.set_frame -> Memory.observe -> drain misses -> engaged -> selected module observe
        -> nonactive path OR stall/grab -> Strategy -> cadence draw -> goal adoption
        -> (Module act bypass OR Tactics + ordered intents + merge + sequential adjust)
        -> persist -> submit nonempty -> release -> stamp Move/Stop -> Memory.note_sent every released command -> return
```

This order is a planning target, not proof all native interfaces currently compose. The caller's `Memory.note_sent`
occurs for every released command before an external runner might accept/reject a command. Only Move/Stop receive the
source sequence wrapper. Runner potion throttle and adapter acceptance are separate later contracts.

## Source-backed dependency interface map

| Engine/state to reuse | Current evidence/code seam | Minimal bridge to reserve after seals |
|---|---|---|
| Full Brain source | `P-BOT-BRAIN-1`; source `createBrain`, `brain.ts`; 31/855 histories, 40 reached checks | New private `temporal_percept/brain.rs` coordinator, owned Brain state and atomic typed reader/replay. No edits to public `bots/brain.rs`. |
| Memory | `temporal_percept/memory.rs`: `Memory::new`, `observe`, `note_sent`, `record_choice`, `view`, `whereabouts`; source input in `memory/source_input.rs` | Use one real Memory. Brain can be a child of `temporal_percept`, so it can use the parent's private module and crate-visible methods/types. No expected view state. |
| Strategy / Goal | `temporal_percept/strategy/engine.rs`: `Strategy::new/decide/state/hunt_stats`; `strategy/types.rs`: full Goal, context and callback traits | Current `engine`/`types` are private submodules with no parent re-exports. Add only selected `pub(super)` re-exports for Strategy/Options and the full shared types needed by Brain; keep engine private to subsystem. Before production Brain, admit P-BOT-STRATEGY-COMPOSITION-BRIDGE-1: callback aliases become `Arc<dyn Fn... + Send + Sync>` through Strategy/HuntAdapter/MobHunter, and `FeatureModule::goals` receives `&mut StrategyContext` at the existing call site. Preserve exact callback allocations/order and reborrow the current tick's mutable services. |
| Tactics | Provisional WIP `backend-bot-tactics` only; its `types.rs` reuses Strategy's Goal and exposes a distinct TacticsContext interface | After final seal, adapt shared Memory/Knowledge/paths/RNG into its context. Reuse Tactics instance; do not copy its component or translate through public Goal. |
| Four built-in modules | Native APIs remain WIP; registry returns ordered enabled descriptors and hook traits are mutable, while Strategy `FeatureModule` retains `&self`; StrategyPercept is narrower than ModulePercept | After seal, retain exact original registry/module objects and forward mutable goals context at the existing Strategy call site. The full current-tick ModulePercept scratch must pair with the same mutable path/RNG/Memory/Knowledge services. Persistent `Rc<RefCell<dyn SourceModule>>` is not Send and cannot be stored in the production Policy graph; select a Send-owned identity-preserving handle/arena only after the Modules seal. Use sequential short borrows and preserve source singleton/config/fault identities. |
| Humanizer | Admitted Hand seam: source candidate `76f8a9aa`, integrated `483c1490`, Root review `2436ed80`; evidence `bot-hand-feature-native` and `bot-hand-feature-review` | Brain uses admitted feature-aware `with_features`; absent features preserve legacy behavior, present membership rejects unsupported offers before pending/channel/delay/RNG work. No Humanizer behavior edit is included. |
| Knowledge | `bots/knowledge.rs`: actual `Knowledge::create(tier, &mut rng)`; 70 draws in source order | Construct once with tag-3 stream; use same object for Strategy/Tactics/modules. Keep source dependency witness distinct from callback traces. |
| Pathfinding | `bots/paths.rs`: each `RoomPathService` owns its own cache and a by-value `PathBudget`; `set_frame` is distinct from `start_tick`; source runner binds/reuses service by original cfg identity | Proposed minimal addition in P-BOT-PATH-BUDGET-1: preserve owned methods/value semantics and add borrowed-budget entries to one search/cache core. Cache belongs to caller's original service handle, not Brain instance: same original cfg/service reuse (including Brain recreation) shares exact cache; equal-value distinct cfgs have separate caches. |
| Shared room caller | Source BotManager starts room budget once; distinct service caches may borrow the same room allowance | Keep room-frame operation outside Brain tick; caller retains and passes the same mutable allowance to each service adapter in deterministic bot order. `start_tick()` once per room frame. Brain does not allocate, replace or reset caller-owned service/budget. A BotClient-style private caller may pass its own budget. |

At this review cut, the Tactics native candidate is HOLD pending its repair/review, and Modules APIs are WIP. Do not
assume paths/exports/borrow rules from either are final. Root must record exact final dependency SHAs/reviews before
Brain dispatch. The modules↔strategy shared Goal is compatible in observed code. Mutable goal context and Send-safe
callback requirements have separate plan packets; neither plan replaces verification against final sealed APIs,
same-object behavior, full-frame scratch, service identity and borrow scopes.

## Native behavior and control targets

The native harness must exercise genuine chronological component composition—not just call each engine independently.
The unchanged-source ledger already defines the scenario meanings and finite limits. At minimum preserve assertions for:

- path frame before Memory hit fold; alive miss append versus dead drain/discard; inclusive engagement timeout;
- Strategy-before-cadence draw; first/deadline/salient/think gating; source Goal key/choice/log identity;
- selected module observe on nonactive/dead, planning-only Idle intents, and one module-goal branch that bypasses Tactics,
  ordinary intents and adjust;
- ordinary-goal Tactics → ordered module intents → one merge → sequential evolving adjust; accepted/rejected channel
  claims and no-change return identity;
- same-tick selected wrapper continuation after a fault, equal-ID fault marker, next enabled-selection behavior;
- nonempty and empty module observability profiles kept distinct; feature-aware hand rejection before draw/pending work;
- real release each tick, `note_sent` for every released command before return, Move/Stop-only 1..255 wrapping,
  repeated end followed by continuing tick;
- source Strategy HuntStats vs tactic stats, and interleaved same/shared cfg, isolated cfg, per-service cache, shared budget;
- strict typed intake failures that leave all existing state, callback counts, RNGs, module state and path budget untouched.

The current-source Tactics cast/menu replacement arms and direct empty-route service throw stay honestly limited as
specified by the packet. The native implementation must not report them as reached by duplicating extras or fabricating
a Tactics base. Preserve the existing source/component parity filters and use exact binary64/discrete comparisons per
the frozen fixture profile; no global tolerance.

## Required decisions before dispatch

1. Confirm final independently reviewed seals/API signatures for Memory, Strategy, Tactics, Modules, the Send-safe
   callback/mutable-goal Strategy bridge, and the borrowed path-budget bridge. The Hand feature gate is admitted:
   source candidate `76f8a9aadb7decfa4532c02f03403867d3816339`, integrated as `483c149018eb648b1d7904ab9d82cb297cf8a238`,
   Root review `2436ed80`. Tactics remains HOLD pending repair/review; Modules remains WIP.
2. Approve the minimal Strategy re-export path and Brain-only component module registration on a clean assigned base.
3. Review the proposed `walk_with_budget`/`path_with_budget` additions in `bots/paths.rs`: both old owned-budget and new
   borrowed-budget entry points must use one cache/search/stale/fallback/stat core, selecting allowance only after a cache
   miss. Confirm sealed consumers need no other budget-consuming method, and preserve existing constructor,
   `budget()`/`budget_mut()`, clone/value semantics and independent caches. Focused bridge evidence must show cache hits
   do not spend either allowance, ordered misses in separate services spend one caller-owned allowance, and old owned
   calls retain exact prior results/stats/budget observations. Allocate only these new methods and their shared-core
   factoring; no broad path service refactor.
4. Review the module wrapper's exact borrow plan against source module-object identity, shared original cfg versus distinct
   cfg, source order, full ModulePercept scratch and per-Brain fault-marker semantics. The persistent production object
   graph must be `Send`; the earlier `Rc<RefCell<dyn SourceModule>>` proposal is not permitted. After Modules is sealed,
   choose a Send-owned identity-preserving handle/arena, with a brief immutable borrow for `enabled`, then a brief mutable
   borrow for each source mutable hook. The Strategy wrapper remains `&self`, but its separately planned `goals` bridge
   receives `&mut StrategyContext` and forwards the same current-tick path/RNG services. Other hooks run sequentially
   after Strategy. Brain supplies ephemeral full current-tick module input because StrategyPercept is narrower, then
   clears scratch after Strategy returns. Check whether final APIs permit this without an existing-engine hunk. If not,
   allocate only a function-level adapter signature after sealing that component.
5. Assign only the Brain new-file paths, exact visibility hunk(s), packet-owned Rust target and evidence directory. Keep
   the F0/F1 fair publication/driver plan separate.

## Integrity and limitations

This plan adds no claim that private method inputs can be constructed from today's fair public Observation. Fair provider
coverage, identity continuity, client cue/windup facts, validate/submit behavior, headless bot scheduling, hosted bot
fill and F1 accepted result handling remain separate work. This plan does not imply persistence/durability, cross-room
learning, campaign outcomes, Unity/browser acceptance, deployment readiness or completion of the broader migration.

No source capture, Rust test, build, deployment or status update was executed for this document. The exact source fixture
bytes and command/runtime receipts are linked above, not regenerated here. Root retains dispatch, integration, status and
commit ownership.
