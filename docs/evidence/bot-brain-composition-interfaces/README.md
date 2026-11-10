# Full private Brain composition — final interface proposal

Status: **ready for Root's exact lease review; no implementation dispatch or Brain admission**. This replaces the
provisional WIP interface map. The remaining changes below are private composition plumbing over sealed engines;
they do not change a bot rule, activate public/live/headless bots, or close fair-publication provider gaps.

## Reviewed dependency cut and tier decision

Read-only integration code at `721d04dabaa734f33835cd69bbb64385843d9a7d` (subsequent inspected HEAD
`611a20341083ae71be67f7f4902bf7862c4025ad` contains documentation changes): Strategy callback/goals bridge is
integrated as `0457716918b398320a38b93666b274bb68b35c29`; Modules final seal
`0c6dcee4f649336a9b4c422d0c6068e19e96344e` is independently admitted and integrated as `721d04da`.
Tactics `cdf5b70f`/`df62934a`, borrowed path allowance `5d351cb5`/`07babf29`, and feature-aware Hand `483c1490`
are admitted. The actual unchanged-source Brain witness `6aaa4c6d` is released:31 histories/855 operations,
Hand6 profiles/12 operations, and32 separately labelled Knowledge constructor dependencies/2240 draws/111 call
bindings. These are finite private method witnesses, not accepted public observations.

Root separately reports combined `rh-policy --lib --nocapture` PASS389/0 at the `721d04da` code, including the
admitted component overlaps; this reviewer did not rerun it. No Rust, tests, probes, captures, worker contact, source
expectation changes, shared status edits or Claude communication were performed for this interface review.

**Root's settled tier boundary:** production Brain accepts `&'static TierParams`, passed unchanged to existing
Memory and Humanizer and borrowed by the other components. Actual legacy callers select canonical `TIERS`
(`packages/server/src/bots/BotManager.ts:269,333`; `BotClient.ts:301`). Frozen witness custom full profiles may
use finite test-only static storage, as existing fixtures do. Preserve all supplied profile values; do not replace
custom values with `TierParams::by_id(id)`. Do not add owned-tier/Arc-tier production storage bridges, production
`Box::leak`, or Memory/Humanizer constructor/storage edits. The earlier contrary recommendation was unnecessary
for the actual caller contract and is withdrawn. In particular, the Modules fixture helper
`SourceConfig::tier_static` canonicalizes by id; it is not the constructor helper for Brain's custom full profiles.

## Persistent ownership and identities

The new private `temporal_percept/brain.rs` coordinates the admitted full nine-way Strategy Goal, Tactics, Modules,
Memory, Knowledge and Hand. Existing `bots/brain.rs` is a reduced compatibility scheduler, not this composition;
leave it unchanged. The new production Brain and caller-owned module/service handles must be `Send` by compile
assertion. No unsafe Send, persistent Rc/RefCell graph, whole-Brain callback lock, copied engine or provider reseed.

Keep these identities distinct, assigned from actual construction/handles rather than expected identity numbers:

| Identity | Required lifetime and meaning |
|---|---|
| Original caller cfg | Reuse only when the caller supplies the same cfg object/handle; equal values do not merge it. |
| Caller path service | Same original cfg/service reuses its actual trip cache across Brains/recreation. Distinct services keep distinct caches even when they borrow one room allowance. |
| Original module object | Caller/host-owned allocation, shared across Brains; not recreated per Brain or per hook. |
| Guarded wrapper | Stable per Brain and original list slot, with the source hook-presence list. Temporary Rust call adapters point to this persistent wrapper identity. |
| Fault set | Per Brain, keyed by module id; equal-id wrappers share fault suppression without becoming the same original object. |
| bcfg | For a nonempty module list, one new stable cfg token per Brain, used for module per-cfg state. For a truly empty list source keeps original cfg identity. Actor id, seed and serialized equality are not cfg tokens. |
| Runtime RNGs | One actual decide/motor/lapse tuple per Brain; Knowledge's tag3 constructor stream remains separate. |

Memory, Knowledge, Humanizer, Tactics, Strategy and the three runtime streams remain actual owned component state.
The Strategy attacking callback uses a per-Brain `Arc<AtomicBool>` updated from the real stored Tactics/module
output, preserving the source previous-attacking read without capturing Brain. Logger captures only a Send+Sync
sink/name handle; Strategy's logger adds the source name prefix, while module cfg log uses its proper original sink.

The caller may own `Arc<Mutex<RoomPathService>>` service handles, or an equivalent Send-owned arena handle. At a
Brain tick it borrows that exact service and the room driver's `&mut PathBudget`; the adapter does not acquire a
second service or copy the allowance. The caller starts allowance once per room frame. Set frame before Memory
observe, but never replenish in Brain/set_frame. Reuse the existing borrowed walk/path entry points and same trip
core; LOS/clear/collision-map remain budget-free. A service lock, if used, must not be reacquired from a module
callback: the callback reborrows the current adapter described below.

## Actual module host, registry and guards

Put the host/facade implementation in NEW `brain/host.rs` (or a child there), not another module engine. It owns
stable handles to the real `WishesModule`, `PlanningModule`, `ChestsModule` and `HazardsModule` allocations. The
existing types are already Send, and `Registry`/`CustomModule` use Arc Send+Sync callbacks. Store an actual builtin
behind a narrow `Box<dyn SourceModule + Send>`/concrete enum and short module-local Mutex guard as needed;
`SourceModule` itself needs no global Send super-bound or behavior edit. New Brain-local fallible guard adapters
can wrap native builtin calls and the source witness's explicitly declared custom-module rules; custom rules are
inputs, not expected callback answers and not substitutes for real builtin execution.

Reuse admitted `Registry::enabled`, registration/replacement/order/reset and opaque cast-policy behavior for caller
registry operations. Resolve its `EnabledModule.builtin` to the already-owned builtin handle; resolve custom tokens
to the actual caller-provided descriptor/handle. Do not construct fresh builtins from each enabled row, use id alone
as object identity, or reimplement registry filtering. Explicit caller module lists preserve their own order,
duplicates and original object handles; they are not sorted/deduplicated through Registry. Registry selection is a
caller action; Brain still performs the source wrapper enabled checks at their actual call sites.

Each persistent guarded wrapper has original handle, owned id, presence mask and stable wrapper token. Its short
call adapter acquires only that module's mutable state, forwards the full current context, releases the guard, and
applies source guard fallback/error/log behavior. Do not hold a module or fault-set lock while entering a different
module, Strategy, logger or another guarded hook. Fault-set read/update locks are short and separate from the
module invocation. Source `guardModules` checks fault suppression in `enabled`, not in every hook: a wrapper already
selected may still run later that tick, and every actual caught throw follows source logging/fallback behavior.
Do not invent once-only logging or blanket same-tick disabling. Keep per-hook absence distinct from empty output.

Guarded source faults must preserve pre-throw module mutations and allow already-selected later hooks to execute.
Prefer typed hook-fault results for the witness's actual declared custom throw rules: mutate their real counters/state
as source does, return the typed source fault, then release the normal module guard and apply the exact fallback/log.
Do not simulate these source throws by panicking through a MutexGuard. If a hook boundary uses catch_unwind, the
module guard must remain owned outside that catch boundary so unwinding does not drop/poison it; recover only the
represented source hook failure, retaining the same object and pre-throw state. An unrelated Rust/invariant panic or
pre-existing poison is not permission to return a source empty default, replace/reset the module, clear poison, or
silently continue. Preserve it as a distinct native failure with honest evidence. No unsafe recovery. The guard
continuation controls must prove real pre-fault mutation and the later same-tick call on that same object, not merely
that another enabled check reports false. DeepSeek chooses the exact implementation within this contract.

`CfgToken` remains the actual identity key supplied to admitted module state. End does not reset/drop module state or
stop Brain; later ticks/choices continue. The sealed Vec/BTreeMap cfg-state stores do not reclaim source WeakMap keys.
This packet makes no JS weak-key reclamation or unbounded host-lifetime memory claim. Host teardown/reclamation for
long-running activation stays a later interface gate, with no speculative GC/refactor lease now.

## Tick-local same-provider goal composition

The sealed bridge already changes `FeatureModule::goals` to accept `&mut StrategyContext` at the original ordered
engine call (`strategy/types.rs:509-537`; `engine.rs:287-303`), with Arc Send+Sync persistent attacking/log callbacks.
Modules imports the SAME `strategy::types::MemoryApi` (`modules/types.rs:23-27`); no alternate Memory seam is needed.
Two small remaining type seams make full module contexts representable without persistent borrowed scratch:

1. Change only `StrategyConfig<'a>.modules` from `&'a [Box<dyn FeatureModule>]` to an explicit borrowed object
   lifetime, `&'a [Box<dyn FeatureModule + 'a>]`. Existing static fixture modules continue to fit. Build these
   temporary adapters each Strategy call from persistent wrapper metadata and the validated current Brain frame.
   The temporary box address is not source wrapper identity. Never store the adapters in persistent Brain state.
2. Add one object-safe private capability on Strategy `PathApi`, conceptually
   `module_paths(&mut self) -> Option<&mut dyn modules::types::ModulePaths>`, with default `None` for existing
   standalone adapters. The NEW Brain path adapter implements both private path traits and returns `Some(self)`;
   all methods forward to its one actual caller service and borrowed room allowance. This preserves rich module
   target arguments and full `path`/`collision_map` support, which the old Strategy path surface lacks. Check the
   required capability before any Memory/RNG/path-frame/module mutation; missing capability is a typed composition
   refusal, never a guessed None path, map copy, fallback provider or panic. The probe itself creates no source
   callback/RNG trace. Existing standalone Strategy callers need no new method implementation.

The current full `ModulePercept`, immutable ModuleConfig facts (including open map/terrain/plan map), collision
view, cfg token, logger and engagement are borrowed from one validated tick frame. They are not rebuilt from the
narrower StrategyPercept, cached as module state, or read from World. Use exactly the same current Memory overlay
(actual Memory plus this tick's merged observed/missed stimuli), Knowledge and callbacks across layers. Strategy
already supplies actual `ctx.mem`, `ctx.decide`, `ctx.lapse` and mutable path adapter. Module goals reborrow these;
only motor needs another short borrow because Strategy itself has no motor lane.

Keep the real motor Rng owned by Brain. During the Strategy call, place only its temporary mutable reborrow in a
stack-local `RefCell<&mut Rng>` shared by the temporary goal adapters. Each goals call holds one short motor guard,
reborrows decide/lapse directly from StrategyContext, uses `ctx.paths.module_paths()` for the same full path
provider, calls the actual module and drops every guard before returning. No runtime Rng is cloned/reseeded, no
persistent !Send cell is introduced, and no ephemeral context escapes. On returning from Strategy, drop temporary
adapters/context before mutating Memory for adopted choice or borrowing those providers for Tactics, module
intents/act/adjust and Humanizer. Fresh later contexts therefore see actual adopted choices and evolving state.
The temporary callback receiver may be !Send; the stored Brain/host graph remains Send.

This is a proposed implementation arrangement, not prewritten Rust. If compiler lifetime requirements need another
existing signature change, return the exact conflict to Root; do not grow the lease or introduce a copied provider.
No change to the Strategy candidate loop/order, globals, RNG behavior or other component engines is allocated.

## Source obligations and bounded overlap gates

One checked complete Brain operation path must validate all declared consumed inputs before mutation and drive all
31/855 operations, Hand6/12 overlap and separately labelled Knowledge constructor dependencies. Guard/control input
must enter that same path with declaration-consistent errors and actual state/RNG/callback/path nonadvance.
Compare complete ordered commands, goals/status, Memory, callbacks (full args/results/order), four stream accounting
with constructor/runtime distinction, retained diagnostics, choices/stats/end and actual continuations. Do not use
expected outputs as constructor state, inputs or filters. Preserve the source's tagged dynamic object order and
all existing exact/tolerance rules; an outer JSON record is not an unordered dynamic object.

Source behaviors requiring composition gates are unchanged from P-BOT-BRAIN-NATIVE-1: frame-before-observe,
merged alive-only misses, lock/trade engagement, strategy-before-cadence RNG, source first-think/dead/nonactive gates,
module act bypass versus ordinary Tactics/intents/merge/evolving adjust, hook guards and continuation, shared object /
original cfg / bcfg / service / room allowance identity, and nonterminating end. Call Memory.note_sent on EVERY released
command before returning it; sequence wrapping1..255 applies only to Move/Stop. Do not duplicate noteSent in a later
adapter or make it contingent on eventual simulation acceptance.

The small seams need meaningful focused gates: actual full module-goal context forwarding (not a copied Strategy
percept); a real chests goal path call through the same cache/allowance; motor plus decide/lapse continuity after a
goals callback; None capability refusal before mutation; static legacy module caller overlap; actual Brain/host Send;
and exact full histories including same-service/recreation versus distinct-service/shared-allowance behavior. Existing
Strategy13 declared + source98/658 + supplement4/48, Modules255/3259, Tactics154/720 and admitted old overlaps,
Hand and path witnesses remain unchanged regression evidence. Reuse final exact-bound component receipts where
unchanged; run the packet's affected gates and combined policy gate as Root assigns, not a new Cartesian campaign.
Preserve source limits: empty module list has no runtime observer hooks; normal empty-route throwing is unclaimed;
current Tactics does not reach cast/menu-base replacement; instrumentation and constructor witnesses stay labelled.

## Test-only helper reuse

Prefer existing generic pure codecs/encoders over cloned fixture engines. Modules `source_reader::parse` preserves
tagged values; `source_trace` exports ordered comparison and Goal/Intent/ModuleOutput/Memory encoders. Its existing
`source_input::parse_raw` rejects raw duplicate JSON keys before serde conversion and can be re-exported directly
without exposing its component-specific typed reader. Existing Memory `source_input` is already parent-visible;
its checked read_percept/read_game_map exports already work under cfg(test). No Memory visibility/body edit is needed.
New complete Brain tests own the complete checked input/schema and trace/comparison orchestration, reusing these
pure helpers only. All four-status Brain fields are validated before actual provider/component mutation.

The admitted Modules and Tactics typed percept decoders are NOT complete Brain intake helpers: their self/fighter/
mob status domain is alive/dead/mia (`modules/source_input.rs:89`, `tactics/source_decode.rs:132`), while the released
Brain source reader explicitly also admits lobby (`tools/bot-private-brain-fixtures/value-reader.mjs:47`). Production
records store status strings, so the new Brain layer can construct faithful typed component projections after its
own complete four-status validation without changing those component engines. Do not label lobby as alive, discard
fields, widen old readers, or call a normalized plain-percept helper to bypass this difference. Their typed decoders
and constructors/runners need no visibility or body lease. The Modules SourceConfig/tier_static helper also must not
erase full custom Brain profile values; resolve/validate those in the new Brain test reader and place them in finite
test-only static storage. Old accepted-reader/comparator policies and fixtures remain unchanged.

Do not copy component case engines, install recorded own-state, or capture test-local Rc tracers inside persistent
callbacks. The existing Memory/Goal/Intent encoders provide comparison facts from actual state only; the new Brain
trace still has to preserve full callback args/results/order, identity and constructor/runtime lane distinctions.

## Exact minimal existing-file lease proposed to Root

Only the following semantic hunks are needed; Root chooses final base/worktree and grants them explicitly. This document
allocates no Rust work itself. New implementation/tests stay in `temporal_percept/brain.rs` + `brain/**`; new receipts
in `docs/evidence/bot-private-brain-native/**`.

| Existing file | Exact proposed hunk; every other behavior remains outside lease |
|---|---|
| `crates/rh-policy/src/bots/temporal_percept.rs` | One `mod brain;` registration. |
| `.../temporal_percept/strategy.rs` | Parent-visible re-export of engine Strategy and StrategyOptions; types is already pub(super), no second visibility change. |
| `.../temporal_percept/strategy/types.rs:475-490,518-527` | Add the default-unavailable full-module-path capability to private PathApi; explicit `+ 'a` boxed-module lifetime in StrategyConfig only. No new required old implementor methods, candidate/goal/RNG changes or engine rewrite. |
| `.../temporal_percept/modules.rs` | Parent-visible types/registry (or selected equivalent re-exports), plus the four concrete builtin struct re-exports. Their children/engines need not become public. Register no new module engine. Under existing cfg(test), make source_reader/source_trace parent-visible for pure helper reuse and add a selected parent-visible re-export of the existing source_input::parse_raw function only. |

The host, temporary Goal adapters, full-path capability implementation, lifetime/Send/forwarding/atomicity controls,
complete checked Brain reader and source replay all fit the NEW Brain paths. Do not edit strategy/engine.rs,
modules/registry.rs/types.rs/source_input.rs/builtin engines, Tactics or its readers, Memory, Knowledge, Humanizer, paths.rs, existing source tests/expected
corpora, reduced public Brain, Policy trait, live/public/frame adapters, Sim/World, protocol, client, Cargo.lock or
shared status. A new concrete compile obstruction must be returned as a specific hunk for Root, not resolved by
provider copies or broad refactoring. Root's final doc review and dispatch remain required.
