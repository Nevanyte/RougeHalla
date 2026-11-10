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

**No native dispatch is granted by this packet.** Root must first verify and seal the exact admitted dependency commits,
their independent reviews, the feature-aware Hand constructor, and the shared-type/path-budget bridge listed below.
Until then, the tactics/modules/hand interfaces are observations of worker WIP and remain provisional. No crate-wide or
blanket existing-file lease is proposed. Root assigns the clean base, target, exact path lease and dispatch after those
gates; DeepSeek owns all Rust and tests.

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

The WIP Modules registry currently materializes `EnabledModule` descriptors, and its hook types are mutable. Strategy's
`FeatureModule` trait currently takes `&self`, and its `StrategyPercept` is narrower than the full `ModulePercept` read by
module hooks. After the final APIs are sealed, use per-module `Rc<RefCell<dyn SourceModule>>` handles shared by the
caller/registry lifetime and by each Brain's Strategy wrappers. The wrappers point at the same actual module objects
used for mutable Brain hooks; they do not allocate per-Brain replacement objects. `enabled` takes a short immutable
borrow. Strategy's `goals(&self, ...)` wrapper takes one short mutable borrow of the matching module because the source
hook is mutable, forwards the Brain's current full module-goal frame, then drops the borrow before returning. Brain's
`observe`, `intents`, `act` and `adjust` take their own short mutable borrows sequentially after Strategy returns. Never
hold a `Ref`/`RefMut` across another module callback or a call into Strategy.

For the wider `ModulePercept`, maintain Brain-owned ephemeral current-tick input scratch populated from the same typed
Brain tick input before calling Strategy. During a wrapped module `goals` callback, construct `ModuleContext` from that
scratch plus adapters over the live shared Memory/Knowledge/path/RNG state; do not reconstruct missing extras from
StrategyPercept, persist scratch as module state, or feed any component output into it. Clear/take the scratch after
Strategy returns so a later callback cannot see a stale tick. Borrow scopes must also release before path/Memory/RNG
adapters leave the wrapper. If the actual sealed Strategy/Modules APIs cannot support this exact callback without
changing an engine, stop and ask Root for a specific function signature bridge; do not duplicate the registry or
component FSM.

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
`whereabouts` remain the source of state, not expected snapshots. The Humanizer must use the separately admitted
feature-aware `with_features` constructor (or the Root-approved exact equivalent); absent features preserve legacy
behavior, while a present message-type list rejects unsupported offers before pending/channel/delay/RNG work. No
unreviewed edit to `humanizer.rs` is authorized here.

Use a real `RoomPathService` cache per Brain/service identity. The legacy caller starts one room-shared path allowance
once at the room-frame boundary while each bot owns a distinct cached path service. Current Rust `RoomPathService`
owns its `PathBudget` by value (`paths.rs`), so preserve its existing `new(map, PathBudget)`, `budget()`, `budget_mut()`,
`walk()` and `path()` semantics, and add a narrow external-budget entry path rather than changing `PathBudget::clone`
or sharing service caches. The proposed minimal bridge is:

- Keep `RoomPathService`'s owned budget field and all current owned-budget methods. Make their existing calls use the
  same private `walk`/`trip`/`path` transition core with no external allowance.
- Add crate-private `walk_with_budget(&mut self, from, to, &mut PathBudget)` and
  `path_with_budget(&mut self, from, to, &mut PathBudget)` methods for Brain adapters. Both forward to the same core,
  passing an optional borrowed allowance. The single `trip` core checks the existing cache first; only on a cache miss
  does it call `take()` on the borrowed room allowance, or on `self.budget` for existing methods. All cache lookup,
  search, stale answer, fallback and stats behavior stays in that one core.
- Each Brain retains its own `RoomPathService` and trip cache. The room caller owns one `PathBudget`, calls
  `start_tick()` exactly once for each room frame, then passes `&mut PathBudget` through the Brain tick's path adapters.
  A BotClient-style private caller may pass its own budget. `Brain::tick` never resets a budget.

This leaves `PathBudget` clone/value semantics unchanged, moves no allowance between services, and adds no second
search/cache state machine. Before dispatch, confirm `walk` and `path` are the only budget-consuming path entry points
required by sealed Strategy/Tactics/Modules APIs; LOS, clear and collision-map reads remain budget-free. Focused bridge
gates must show: a fresh cache hit consumes neither owned nor external allowance; two distinct service caches consume
the same caller allowance on their ordered misses; and old owned methods preserve their existing results, stats and
`budget()` observations. This is a proposed exact hunk in `bots/paths.rs`, not an active lease; Root must separately
allocate it after checking component seals. Do not give each Brain an independent fresh room allowance or change
per-service cache ownership.

The Brain's source order is significant: caller constructs path service before enabled-module selection and Brain
construction; room driver starts a shared budget once; then Brain derives tag streams, creates Knowledge, Memory,
feature-aware Humanizer, Tactics, guarded module wrappers/Brain-local config, and Strategy with its attacking closure.
Each Brain tick calls path `set_frame(now, gates_locked)` before `Memory.observe`; `set_frame` does not replenish budget.
Preserve service and config identity across recreation/interleaving cases.

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
   nonempty intents; call release every tick. Stamp only released Move/Stop with the source wrapping sequence 1..255;
   call actual Memory.note_sent on each stamped result before returning it. This is source Brain behavior, not contingent
   on downstream adapter acceptance. Keep runner accepted-send/potion guards separate.
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
- Any additional path-budget or Hand bridge only by a separately named, minimal Root lease after dependency review.

No automatic edits to Strategy/Tactics/Modules/Memory/Knowledge/path service/Humanizer, public bot API, frame/publication
adapter, Sim/World, headless/live runner, Unity, protocol, database, learning store, dependencies or shared records are
included. If a source mismatch or missing interface makes an out-of-scope edit necessary, retain the mismatch and return
the specific function/signature/path to Root before continuing.

## Acceptance and stop conditions

Release requires: all three component seals/reviews plus Hand and path-budget interface readiness; exact frozen source
fixture comparison; 31/855 and Hand 6/12 composition overlap; full intended Brain contract and strict atomic intake;
meaningful semantic controls; default/all-feature regression and independent review. Then report exact admitted scope and
unreached source limits separately. This does not close fair live observation, accepted identity/session policy, bot
activation, host/end-to-end game behavior, persistence, or overall migration acceptance.

If any required component is unsealed, a shared core would need duplication, the proposed borrowed-budget bridge cannot
preserve legacy cache/search semantics, an identity or RNG boundary cannot be represented, or a source/native mismatch
is found: stop before disguising
the gap with defaults or an out-of-scope edit; keep the exact red evidence and ask Root to allocate the smallest bridge.
