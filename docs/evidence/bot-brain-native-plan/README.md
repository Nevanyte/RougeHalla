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

The composition sequence preserves all source state boundaries:

```text
caller: RoomPathService/cache construction -> registry enabled selection -> createBrain
room:   one shared PathBudget.start_tick per room frame
Brain:  tagged streams -> Knowledge(tag 3) -> Memory -> Humanizer(features) -> Tactics
        -> Brain-local guarded module wrappers/config -> Strategy(attacking closure)
tick:   paths.set_frame -> Memory.observe -> drain misses -> engaged -> selected module observe
        -> nonactive path OR stall/grab -> Strategy -> cadence draw -> goal adoption
        -> (Module act bypass OR Tactics + ordered intents + merge + sequential adjust)
        -> persist -> submit nonempty -> release -> stamp Move/Stop -> Memory.note_sent -> return
```

This order is a planning target, not proof all native interfaces currently compose. The caller's `Memory.note_sent`
occurs for Brain-stamped Move/Stop before an external runner might accept/reject a command. Runner potion throttle and
adapter acceptance are separate later contracts.

## Source-backed dependency interface map

| Engine/state to reuse | Current evidence/code seam | Minimal bridge to reserve after seals |
|---|---|---|
| Full Brain source | `P-BOT-BRAIN-1`; source `createBrain`, `brain.ts`; 31/855 histories, 40 reached checks | New private `temporal_percept/brain.rs` coordinator, owned Brain state and atomic typed reader/replay. No edits to public `bots/brain.rs`. |
| Memory | `temporal_percept/memory.rs`: `Memory::new`, `observe`, `note_sent`, `record_choice`, `view`, `whereabouts`; source input in `memory/source_input.rs` | Use one real Memory. Brain can be a child of `temporal_percept`, so it can use the parent's private module and crate-visible methods/types. No expected view state. |
| Strategy / Goal | `temporal_percept/strategy/engine.rs`: `Strategy::new/decide/state/hunt_stats`; `strategy/types.rs`: full Goal, context and callback traits | Current `engine`/`types` are private submodules with no parent re-exports. Add only selected `pub(super)` re-exports for Strategy/Options and the full shared types needed by Brain; keep engine private to subsystem. |
| Tactics | Provisional WIP `backend-bot-tactics` only; its `types.rs` reuses Strategy's Goal and exposes a distinct TacticsContext interface | After final seal, adapt shared Memory/Knowledge/paths/RNG into its context. Reuse Tactics instance; do not copy its component or translate through public Goal. |
| Four built-in modules | Provisional WIP `backend-bot-modules` only; Registry returns ordered enabled descriptors, module hook traits are mutable, while Strategy `FeatureModule` takes `&self`; StrategyPercept is narrower than ModulePercept | After seal, retain real registry and module objects. Proposed wrapper uses shared `Rc<RefCell<dyn SourceModule>>` handles for the exact objects. `enabled` uses a short immutable borrow; wrapped `goals(&self)` briefly borrows mutably to call the source mutable hook, then releases before returning. Other hooks borrow mutably sequentially after Strategy returns. Populate a Brain-owned ephemeral full ModulePercept scratch from the same current tick before Strategy; wrapper constructs ModuleContext from that plus live adapters, then clear/take scratch. Never persist scratch as state, reconstruct omitted facts from StrategyPercept, clone module objects, or hold RefCell borrows across callbacks. Preserve singleton object lifetime across Brains, cfg-keyed module state, per-Brain fault markers and same-tick selected-wrapper continuation. |
| Humanizer | Existing `bots/humanizer.rs` has `new`, `submit`, `release`, `drain_misses`, stats. Feature-aware `with_features` appears only in provisional Hand WIP at review time | Require independently admitted feature constructor/offer gate; Brain supplies the source feature set. No Humanizer behavior edit is included. |
| Knowledge | `bots/knowledge.rs`: actual `Knowledge::create(tier, &mut rng)`; 70 draws in source order | Construct once with tag-3 stream; use same object for Strategy/Tactics/modules. Keep source dependency witness distinct from callback traces. |
| Pathfinding | `bots/paths.rs`: each `RoomPathService` owns its own cache and a by-value `PathBudget`; `set_frame` is distinct from `start_tick` | Proposed minimal addition: preserve current `new(map, PathBudget)`, owned budget field, `budget()`, `budget_mut()`, `walk()` and `path()`. Add crate-private `walk_with_budget(from,to,&mut PathBudget)` and `path_with_budget(from,to,&mut PathBudget)` that forward to one existing transition core with an optional borrowed allowance. Cache lookup stays first; only a miss calls `take()` on the supplied allowance or service-owned budget. Keep one search/cache/stale/fallback/stat core, one independent cache per service, unchanged PathBudget clone/value semantics. Brain adapters use borrowed methods; caller passes room-owned `&mut PathBudget` after `start_tick()` once per room frame. |
| Shared room caller | Source BotManager starts room budget once, each BotClient/service owns its cache | Keep room-frame operation outside Brain tick; pass the same mutable allowance to each service adapter in deterministic call order while retaining independent caches. BotClient-style caller may pass its own budget. No per-Brain `start_tick`, copying/refilling allowance, or cache sharing. |

At review time, tactics/modules/Hand Rust in their sibling worktrees is dirty, provisional WIP and not a dependency seal.
In particular, do not assume paths/exports/borrow rules shown there are final. Root must record exact final dependency SHAs
and reviews before allocating Brain code. The modules↔strategy shared Goal is compatible in observed code. The wrapper
design above resolves the observed mutability shape provisionally, but still needs checking against final sealed APIs,
same-object behavior, full-frame scratch and borrow scopes before dispatch.

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
- real release each tick, Move/Stop-only 1..255 wrap, `note_sent` before return, repeated end followed by continuing tick;
- source Strategy HuntStats vs tactic stats, and interleaved same/shared cfg, isolated cfg, per-service cache, shared budget;
- strict typed intake failures that leave all existing state, callback counts, RNGs, module state and path budget untouched.

The current-source Tactics cast/menu replacement arms and direct empty-route service throw stay honestly limited as
specified by the packet. The native implementation must not report them as reached by duplicating extras or fabricating
a Tactics base. Preserve the existing source/component parity filters and use exact binary64/discrete comparisons per
the frozen fixture profile; no global tolerance.

## Required decisions before dispatch

1. Confirm the final, independently reviewed seals for Memory, Strategy, Tactics, Modules and Humanizer feature gating;
   document exact commit IDs and API signatures.
2. Approve the minimal Strategy re-export path and Brain-only component module registration on a clean assigned base.
3. Review the proposed `walk_with_budget`/`path_with_budget` additions in `bots/paths.rs`: both old owned-budget and new
   borrowed-budget entry points must use one cache/search/stale/fallback/stat core, selecting allowance only after a cache
   miss. Confirm sealed consumers need no other budget-consuming method, and preserve existing constructor,
   `budget()`/`budget_mut()`, clone/value semantics and independent caches. Focused bridge evidence must show cache hits
   do not spend either allowance, ordered misses in separate services spend one caller-owned allowance, and old owned
   calls retain exact prior results/stats/budget observations. Allocate only these new methods and their shared-core
   factoring; no broad path service refactor.
4. Review the module wrapper's exact borrow plan against source module-object identity, shared original cfg versus distinct
   cfg, source order, full ModulePercept scratch and per-Brain fault-marker semantics. The proposed shape is shared
   `Rc<RefCell<dyn SourceModule>>` object handles, a brief immutable borrow for `enabled`, a brief mutable borrow for the
   source mutable goals hook from Strategy's `&self` FeatureModule callback, then borrow release before returning. Other
   callbacks run later with sequential mutable borrows. Brain supplies ephemeral full current-tick module input because
   StrategyPercept is narrower, then clears scratch after Strategy returns. Check whether final APIs permit this without
   an existing-engine hunk. If not, allocate only a function-level adapter signature after sealing that component.
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
