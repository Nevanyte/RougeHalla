# P-BOT-BRAIN-NATIVE-1: compose the complete private Brain

## Outcome and readiness

Implement the unchanged legacy `createBrain` composition over the admitted private Memory, Strategy, Tactics, four feature
modules, Knowledge, path services, and Humanizer. The Brain is a private method-level policy component: it accepts the
declared source-shaped inputs in the frozen witness and emits source-shaped timed commands and diagnostics. This packet
does **not** bind those inputs to accepted live observations, validate/submit commands, activate bots, change the public
wire, or claim full gameplay completion.

The unchanged-source witness at `6aaa4c6d33dad8a47ab7957b41d420fa78954af6` is independently RELEASED and integrated
(`5a5a28c6` plus review `8fa97f24`). See [the source evidence](../../evidence/bot-private-brain-source/README.md) and
[independent review](../../evidence/bot-private-brain-source-review/README.md). It contains 31 chronological histories /
855 operations (425 ticks), 6 Humanizer profiles / 12 operations, 32 separate Knowledge constructor witnesses / 2,240
draws, 111 Brain Knowledge calls, 40 reached assertions and 30 strict reader negatives. All values and source results
come from actual source constructors/methods. The frozen outputs are the expected comparison oracle for native replay;
they must never be installed as native component state or fed back as native inputs.

**No native dispatch is granted by this packet.** The feature-aware Hand seam is admitted at source candidate
`76f8a9aadb7decfa4532c02f03403867d3816339`, integrated as `483c149018eb648b1d7904ab9d82cb297cf8a238`, with Root's
binding review `2436ed80`. Tactics' native candidate remains **HOLD** pending its documented repair and independent
review; Modules' native APIs remain **WIP**. The persistent callback/mutable-goal Strategy bridge in
[P-BOT-STRATEGY-COMPOSITION-BRIDGE-1](P-BOT-STRATEGY-COMPOSITION-BRIDGE-1.md) and borrowed path-budget bridge in
[P-BOT-PATH-BUDGET-1](P-BOT-PATH-BUDGET-1.md) are not admissions. The path bridge is independently dispatched from
`37403399` in `backend-bot-path-budget`; the Strategy bridge awaits its separate review/dispatch. Root must verify
and seal all remaining exact dependency commits/reviews before Brain dispatch. No crate-wide or blanket existing-file
lease is proposed. Root assigns the clean base, target, exact path lease and dispatch after those gates; DeepSeek owns
all Rust and tests.

## Source limits and separation

Use the complete frozen `rh-bot-private-brain-source/1` contract. Its Percepts, callbacks, maps, learned snapshot and
later feedback are declared private source-method inputs, not earned World/public observations. The 31/855 counts are
composition evidence only. They do not close the separate F0 fair-publication binding or F1 validate/submit/live/headless
activation in [P-BOT-FAIR-ACTIVATION-1](P-BOT-FAIR-ACTIVATION-1.md) and
[its field closure](../../evidence/bot-fair-activation-plan/field-closure.md).

Do not read `World` or `Sim`, invent actor aliases, turn arbitrary strings into authoritative IDs, infer hidden card or
player facts, add public observation fields, or use native answers as source inputs. No ML, learned store, persistence,
client/network/wire change, gameplay rule, Unity work or server dispatch is in scope. Preserve exact source operation
order, source identities, ordered collections, absence/Undefined/Null, f64 values and three runtime RNG lanes. The
constructor's Knowledge/tag-3 derivation is separately witnessed with the actual source constructor; it is not a fourth
Brain-observer callback lane.

The source witness deliberately leaves current-Tactics cast/menu-base replacement unclaimed: ordinary current Tactics
does not emit those channels, and a Module goal bypasses the ordinary merge. It reaches insertion/first accepted channel
claim. The truly empty module list also lacks observer Memory/runtime-RNG hooks and remains a separate observability
profile. The empty-route test-service throw is not a normal RoomPathService result or a typed source error. Preserve these
limits; do not fabricate branches to fill them.

## Component reuse and exact bridge needs

Implement the real `createBrain` coordinator, including its cadence, guard and orchestration state. Do not duplicate the
already admitted Strategy, Tactics, chest hunter, module registry, Memory, or Humanizer engines. The intended new
composition is `crates/rh-policy/src/bots/temporal_percept/brain.rs`
plus `brain/**`, with new tests and `docs/evidence/bot-private-brain-native/**`. The only unconditional source-tree
registration proposed is `mod brain;` in `crates/rh-policy/src/bots/temporal_percept.rs`, after Root assigns the clean
base. Existing user-facing `bots/brain.rs`, `bot.rs`, `types.rs`, observation construction and server/headless dispatch
remain out of this packet.

### Strategy boundary

Reuse `temporal_percept::strategy::engine::Strategy` and its full nine-way `strategy::types::Goal`/`StrategyContext`.
Current `strategy.rs` declares both `engine` and `types` private and has no narrow Brain-facing re-export. Allocate only a
small bridge in that file: re-export the required `Strategy`/`StrategyOptions` from `engine`, and expose the existing
`types` module (or a selected set of its types/traits) to its parent with `pub(super)`. Do not make the strategy engine or
types public outside this private subsystem. Keep all strategy behavior and existing fixture tests unchanged.

Before production Brain dispatch, admit the separate Strategy composition bridge: persistent `AttackFn`/`LogFn` must
use Send-compatible `Arc<dyn Fn... + Send + Sync>` handles, including the stored `HuntAdapter` options and
`MobHunter` log callback/default; the existing `FeatureModule::goals` seam must accept `&mut StrategyContext` at the
same module-goal call site. These are currently Rc callbacks and a shared context borrow, so the bridge is a real
prerequisite, not a Brain-local workaround. Its plan is [P-BOT-STRATEGY-COMPOSITION-BRIDGE-1](P-BOT-STRATEGY-COMPOSITION-BRIDGE-1.md).
The later wrapper must forward the full current-tick module percept plus the same mutable `paths`, `decide`, and `lapse`
services; preserve module order and release borrows before returning. Do not clone/reset/reseed a provider or implement
a second module/Strategy engine. Any persistent module handle owned by the production policy must also be Send-safe and
identity-preserving; the earlier `Rc<RefCell<dyn SourceModule>>` sketch is not a valid `Policy: Send` object graph.

`StrategyContext` already accepts trait objects for Memory, Knowledge, paths, learned bias and RNG; implement adapters
over the one Brain-owned admitted component state. The source full Goal type is the shared goal representation for
Strategy, Tactics and modules. Never use the reduced public compatibility `brain::Goal`.

### Tactics and Modules boundaries

Reuse the independently authored Tactics and Modules implementations only after their final seals/reviews. Their
observed WIP is not an admission. Tactics currently shares the source Goal/GoalKind/GoalStatus definitions from
`strategy::types`, while its own `TacticsContext` defines a separate adapter trait surface. Modules likewise imports
the shared source Goal/decision/status types and owns its actual registry/module state. Brain should adapt the same
Memory, Knowledge, path service and source RNG objects into each component's required context in call order; avoid
translating goals through a second enum or duplicating component-owned state.

The Modules registry currently materializes `EnabledModule` descriptors, and its hook types are mutable; its native
interfaces remain WIP. Strategy's `FeatureModule` receiver remains `&self`, but the admitted bridge will make its
`goals` context `&mut StrategyContext`, enabling the adapter to borrow the live mutable tick services. After the final
APIs are sealed, use Send-owned identity-preserving handles/arena entries for the same actual module objects shared by
caller/registry lifetime and each Brain's Strategy wrappers. Do not store `Rc<RefCell<dyn SourceModule>>` in the
production Policy graph. The exact handle representation and any narrow trait bounds wait for the Modules seal; no
replacement per-Brain module objects are allowed. `enabled` takes a short immutable borrow. The Strategy wrapper's
`goals(&self, ...)` takes one short mutable borrow of the matching actual module, forwards the Brain's current full
module-goal frame and mutable path/RNG services, then releases all borrows before returning. Brain's `observe`,
`intents`, `act` and `adjust` take their own sequential borrows after Strategy returns. Never hold a guard across
another module callback or a call into Strategy.

For the wider `ModulePercept`, maintain Brain-owned ephemeral current-tick input scratch populated from the same typed
Brain tick input before calling Strategy. During a wrapped module `goals` callback, construct `ModuleContext` from that
scratch plus reborrows of the live shared Memory/Knowledge/path/RNG state; do not reconstruct missing extras from
StrategyPercept, persist scratch as module state, or feed any component output into it. The mutable context bridge is
what permits the source chests goal callback to call its real path closures. Clear/take the scratch after Strategy
returns so a later callback cannot see a stale tick. Borrow scopes must release before path/Memory/RNG adapters leave
the wrapper. If final sealed APIs cannot support this exact callback, stop and ask Root for the smallest specific
signature bridge; do not duplicate the registry or component FSM.

This wrapper design must preserve source module singleton identity across Brain instances while keeping each source cfg
identity and Brain-local guarded `bcfg` distinct. The mutable hook's module state stays in the actual shared object and
uses the source cfg identity key. The fault marker stays per Brain wrapper set and is shared by equal IDs inside that
Brain. An already-selected wrapper remains callable later in the same tick after a fault; only the next enabled
selection observes the marker. No global wrapped-once bit, state reset, per-call copy, or blanket same-tick disabling.

The fixed source module order is wishes, planning, chests, hazards. Preserve direct original module-object identity,
same-config reuse versus equal-config isolation, Brain-local `bcfg` identity, wrapper identity and equal-ID guard sharing.
Fault handling remains per callback: a faulted ID is checked when enabled modules are selected, so a wrapper already
selected can still be called later that tick. Do not impose blanket same-tick disabling.

### Knowledge, Memory, Humanizer and path service

Construct one actual Knowledge using tag 3 and the complete tier before the first Brain tick. Reuse one actual Memory
for every observer/module/strategy/tactics/Brain operation. Its `observe`, `note_sent`, `record_choice`, `view` and
`whereabouts` remain the source of state, not expected snapshots. The Humanizer must use the admitted feature-aware
`with_features` constructor; absent features preserve legacy
behavior, while a present message-type list rejects unsupported offers before pending/channel/delay/RNG work. No
unreviewed edit to `humanizer.rs` is authorized here.

The caller owns/binds the path service handle and cache identity; a Brain does not allocate or replace it merely because
the Brain is created, ended or recreated. Brains using the same original caller cfg/service handle reuse its exact
service/cache, including recreation; an equal-value but distinct cfg/service keeps a separate cache. All distinct
services may borrow one caller-owned room allowance in deterministic call order. The legacy caller starts that shared
allowance once at the room-frame boundary. Current Rust `RoomPathService` owns its `PathBudget` by value (`paths.rs`),
so preserve its existing `new(map, PathBudget)`, `budget()`, `budget_mut()`,
`walk()` and `path()` semantics, and add a narrow external-budget entry path rather than changing `PathBudget::clone`
or sharing service caches. The proposed minimal bridge is:

- Keep `RoomPathService`'s owned budget field and all current owned-budget methods. Make their existing calls use the
  same private `walk`/`trip`/`path` transition core with no external allowance.
- Add crate-private `walk_with_budget(&mut self, from, to, &mut PathBudget)` and
  `path_with_budget(&mut self, from, to, &mut PathBudget)` methods for Brain adapters. Both forward to the same core,
  passing an optional borrowed allowance. The single `trip` core checks the existing cache first; only on a cache miss
  does it call `take()` on the borrowed room allowance, or on `self.budget` for existing methods. All cache lookup,
  search, stale answer, fallback and stats behavior stays in that one core.
- The caller retains each original `RoomPathService` and its trip cache. The room caller owns one `PathBudget`, calls
  `start_tick()` exactly once for each room frame, then passes `&mut PathBudget` through each service adapter in the
  caller's deterministic bot order. A BotClient-style private caller may pass its own budget. `Brain::tick` never
  allocates, replaces or resets a caller-owned service/budget.

This leaves `PathBudget` clone/value semantics unchanged, moves no allowance between services, and adds no second
search/cache state machine. Before dispatch, confirm `walk` and `path` are the only budget-consuming path entry points
required by Strategy/Tactics/Modules APIs; LOS, clear and collision-map reads remain budget-free. Focused bridge
gates must show: a fresh cache hit consumes neither owned nor external allowance; two distinct service caches consume
the same caller allowance on their ordered misses; and old owned methods preserve their existing results, stats and
`budget()` observations. The exact hunk in `bots/paths.rs` is independently leased by the separate path packet;
its final admission remains required before Brain dispatch. Do not give each Brain an independent fresh room allowance or change
per-service cache ownership.

The Brain's source order is significant: caller binds/constructs the path service for its original cfg identity before
enabled-module selection and Brain construction; room driver starts a shared budget once; then Brain derives tag
streams, creates Knowledge, Memory, feature-aware Humanizer, Tactics, guarded module wrappers/Brain-local config, and
Strategy with its attacking closure. Each Brain tick calls path `set_frame(now, gates_locked)` on that bound service
before `Memory.observe`; `set_frame` does not replenish budget. Preserve caller service/cache and config identity across
recreation/interleaving cases: the same original cfg/service reuses the same cache, distinct equal-value cfgs keep
distinct caches, and their services may consume one room allowance sequentially.

## Required composition behavior

Follow the source contract in P-BOT-BRAIN-1 and the frozen source README. In particular:

1. **Tick prefix and observer:** path frame first; Memory.observe; drain hand misses; append alive-only misses after
   observed stimuli, discarding dead-frame misses; keep last non-null faction. Build engaged from lock/last Tactics attack
   or Memory hit/dealt timestamps with the inclusive trade window. Filter enabled wrappers once; call selected observe
   hooks even when dead/nonactive.
2. **Nonactive/dead:** clear Brain stall anchors; only planning asks module goal intents with Idle; skip core decide/act/
   adjust; still release and flush the real Humanizer every frame. Hand-owned phase/status behavior controls pending work.
3. **Alive active:** perform stall/grab watches before strategy. Strategy gates are first/deadline/nonrunning/salient;
   call Strategy before the next cadence RNG draw; preserve Goal key identity/equality, choice/log semantics, first-act
   behavior, and strategy-owned HuntStats. Tactics is called only for ordinary goals. Module-goal dispatch calls only the
   matching module act and bypasses core Tactics, all module intents and merge/adjust. Ordinary path runs Tactics, collects
   module intents in order, merges once, then applies sequential evolving adjust hooks.
4. **Hand/flush:** persist actual tactics/status; compute next think time from real uniform cadence and cap; submit only
   nonempty intents; call release every tick. Stamp only released Move/Stop with the source wrapping sequence 1..255.
   Call actual `Memory.note_sent` on **every** released command before returning it; only Move/Stop receive the
   sequence wrapper. This is source Brain behavior, not contingent on downstream adapter acceptance. Keep runner
   accepted-send/potion guards separate.
5. **Faults, stats and lifetime:** guard each optional callback with source fallback/error/log behavior; later selected
   wrappers may still execute the same tick after a fault. Export Humanizer stats, Strategy HuntStats (not Tactics
   analogues), Tactics counters, stalls/grabs/sparse goals/build/route stats as source does. `end` uses last known result
   fields or void/zero defaults and a fresh choices list; it neither flushes nor stops/resets Brain. Later tick/choice
   calls must demonstrate retained state.

No hard-coded expected output, callback answer tape, installed timer/goal/Memory state, direct counter edit, post-hoc
Goal/status filter, or output-fed-as-input case is allowed. Strict intake validates complete declared input before any
Brain component, RNG, Memory, module, path or Humanizer state mutates.

## Native tests and source comparison

Use the frozen source histories and exact comparator policy from the source manifest. Add a private typed reader with
atomic nonadvance behavior for every malformed required profile. Replay real constructors and chronological operations;
compare ordered commands, goals, stats, summaries, callback arguments/results/order, relevant retained state and runtime
RNG order/count. Keep Knowledge's separately admitted tag-3 constructor witness distinct. Existing component tests and
parity remain intact; no blanket dead-code suppression or widened numeric tolerance.

The native suite must include all 31 source histories / 855 operations and 6/12 Hand overlap records; the source's 40
reached assertions and source controls must map to meaningful native assertions. Preserve reached controls for scheduler
ordering, dead/nonactive miss behavior, module bypass/ordinary merge and adjust order, guard continuation, hand feature
rejection, sent sequence/noteSent, Strategy-vs-Tactics stats, end continuation, identity/isolation and shared room-budget
interleaving. Include strict malformed/nonadvance tests and semantic KILL controls for the Brain coordinator, rather
than relying on component-only tests. Existing Memory/Strategy/Tactics/Modules/Hand source comparators remain separate
overlap evidence, not substitutes for full composition.

Use the repository-pinned Rust toolchain and packet-owned target assigned by Root. Run focused Brain tests, affected
component regression filters, format, strict default/all-feature policy lint, and required broader regression gates only
as Root dispatches. Record exact HEAD, commands/cwd/environment, exits, counts and raw output under the new Brain native
evidence directory. Independent reviewer must inspect the exact sealed code/evidence and rerun the declared gates before
Root integrates. Do not update shared status or Cargo.lock.

## Proposed later write scope and explicit non-scope

After the seals and bridge are reviewed, Root may allocate only:

- NEW `crates/rh-policy/src/bots/temporal_percept/brain.rs` and `brain/**` for Brain, typed intake, adapters and tests.
- NEW `docs/evidence/bot-private-brain-native/**` for receipts.
- One Root-approved `mod brain;` line in `temporal_percept.rs` and the exact selected sibling re-exports in `strategy.rs`.
- The already separate Strategy composition and path-budget bridges only by their named Root-approved leases; Hand
  feature gating is admitted and requires no further edit from this packet.

No automatic edits to Strategy/Tactics/Modules/Memory/Knowledge/path service/Humanizer, public bot API, frame/publication
adapter, Sim/World, headless/live runner, Unity, protocol, database, learning store, dependencies or shared records are
included. If a source mismatch or missing interface makes an out-of-scope edit necessary, retain the mismatch and return
the specific function/signature/path to Root before continuing.

## Acceptance and stop conditions

Release requires: all three component seals/reviews, the separately admitted Strategy composition and path-budget
bridges, and the already admitted Hand feature-gate seal; exact frozen source fixture comparison; 31/855 and Hand 6/12
composition overlap; full intended Brain contract and strict atomic intake;
meaningful semantic controls; default/all-feature regression and independent review. Then report exact admitted scope and
unreached source limits separately. This does not close fair live observation, accepted identity/session policy, bot
activation, host/end-to-end game behavior, persistence, or overall migration acceptance.

If any required component is unsealed, a shared core would need duplication, the proposed borrowed-budget bridge cannot
preserve legacy cache/search semantics, an identity or RNG boundary cannot be represented, or a source/native mismatch
is found: stop before disguising
the gap with defaults or an out-of-scope edit; keep the exact red evidence and ask Root to allocate the smallest bridge.
