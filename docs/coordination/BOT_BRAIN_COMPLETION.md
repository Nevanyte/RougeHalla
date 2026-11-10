# Complete private bot modules and Brain delivery

Planning only,2026-11-10, inspected on integration `b03374083929c3dac3edc4d8e71436962dac6416` and its then-current
unchanged source. Root owns admission, current bases, shared-file leases and dispatch. This document authorizes no
capture, implementation, interface edit, public bot rewrite, identity change or live activation. DeepSeek authors every
Rust implementation/test/probe; Sol/Luna prepare/review source and architecture. Claude owns client/network work.

The next bounded closure is [P-BOT-MODULES-1](../backlog/packets/P-BOT-MODULES-1.md): complete all four actual built-in
modules and their missing chest dependencies, with real source context and module-hook contracts. Then integrate the
full private createBrain caller with the admitted Memory/strategy/tactics/modules and the existing hand. Preserve the
complete legacy behavior, rather than extending the reduced public Goal/front end until it looks approximately similar.
Fair public intake and actual seat activation remain subsequent gates; private method completion need not wait for them.

## Verified inventory: reuse, then close the actual seams

| Source / current Rust | Verified disposition |
|---|---|
| `bots/chestHunt.ts`, `brain/modules/chests.ts` | No ChestHunter/cardScore/chooseOption/chest-module implementation exists in rh-policy. Implement the complete source state machines. Existing sim card catalog, CardDef blocker metadata, boost and kill-augment formats are reusable static leaves where contracts match; they are not the bot's choice policy. Preserve arbitrary unknown card strings scoring0, rather than restricting input to known CardId. |
| `brain/modules/planning.ts` / `bots/planning.rs` | Rust already has reference matchup/plan-score leaves and substantial PlanModule state/retry/read/ready logic, with immutable `bot-planning.json` comparison. Reuse that engine. Close ordered private-event parsing, event timestamp versus current now, full parameter/context and observable learned callback seams. Current observe accepts a parsed PlanDeal with integer fields and one supplied time; source readDeal retains number values. Intents takes TierId/static params and PlanLearned table, not the full source callback/context contract. |
| `brain/modules/wishes.ts`, `bots/abilityPolicy.ts` / `bots/wish.rs` | Rust already has the five public definition rows, pure cast policy, availability/Easy gate, retry, armed slip/from/leg state, goal_active and slip geometry. The older “slip not ported” comment/evidence is stale. Do not rewrite those leaves. The current adapter is still narrower: hit memory is a separate capped list, sent time is inferred from observed casting rather than real Memory.lastCast, nearest threat can be recomputed from coordinates instead of source dist, non-unit output optional fields differ, and landing ignores gates_locked/max/min in its existing fair-view path. Add a source-shaped entry/context and repair only demonstrated seams while preserving existing public consumers. |
| `brain/modules/hazards.ts` / `bots/hazards.rs` | Standalone native burns/bad classification, stable tile search, held step/arrival/expiry/cooldown, light and copy-on-change adjust are present with `bot-hazards.json`. Reuse them. Current Context/adjust takes Observation and direct geometry; full source takes arbitrary string owner/lock facts and calls collisionMap/clear at specific points. Parameterize the shared engine through honest source facts/callbacks; do not construct fake actor IDs/earned Observations or rewrite terrain rules. |
| `brain/modules/index.ts` | Registry order is wishes→planning→chests→hazards; replacement under equal string id keeps position. reset clears registry and optional cast-policy slot. Wishes calls real decideCast directly; registered CastPolicy is not its injected oracle. No skills/relic module is currently registered; do not invent one because feature/comment names exist. |
| `brain/humanizer.ts` / `bots/humanizer.rs` | Hand/channel/reaction/APM/scatter/click engines are already source-backed. One missing compatibility seam is optional features.messageTypes filtering in offer before channel/pending/delay work. The old bot-core capture constructs without features. Add this narrow gate under the later Brain lease; do not replace the hand. |
| `brain/brain.ts` / public `bots/brain.rs`, `bot.rs` | Rust has cadence/adopt/merge helpers and a bounded HumanBot caller, plus repaired derived RNG wiring. It is not full createBrain: full private goals/modules, guarded calls, actual Memory+miss feedback, exact sequence stamping, caller order, stats/end and full-layer composition remain. Preserve those public APIs while adding a private composer. |
| `bots/learning.rs` | Source-compatible pure summary/snapshot/bias logic exists. Brain reads an injected read-only learned snapshot and returns a summary; it does not create a store. No new persistence, external learning service, ML, datasets or inference belongs here. |

Existing compatibility witnesses remain immutable: `bot-planning.json`, `bot-wish.json`, `bot-hazards.json`, `bot-core.json`,
`bot-brain-prefix/source.json`, admitted Memory/knowledge/path/random/click/fight/Orb/Reflex components, and the frozen
private strategy/tactics corpora. In particular, the prefix Brain witness intentionally consumed opaque strategy draw
counts; it is a scheduler/merge overlap, not the new whole-Brain oracle. Older planning fixtures contain rounded helper
values and looser comparisons; retain them as regressions, never round new method inputs/expectations to imitate them.

## Delivery sequence and exact boundaries

| Stage | Scope / dependency | Exit |
|---|---|---|
| M0: Root reviews modules packet | This plan and packet only. Strategy source is frozen; native callback/atomic-intake/raw-key HOLD repairs continue in their exclusive lease. Tactics source54ff01a2 has independent reproduction and Root's separate semantic/numeric/error mapping decisions. | Root chooses source-only capture lease. No implicit dispatch from this document. |
| M1: complete module source witness | New tools/corpus/evidence paths named in the packet. Invoke actual ChestHunter/card helpers and actual singleton module methods with real chronological Memory/Knowledge/path services; finite registry traces use actual registry APIs; Brain guard traces belong to B1. | Independent fresh pinned reproduction and finite semantic review; then Root freezes source. Can proceed without inspecting evolving native answers after Root review. |
| M2: complete private modules | Memory admitted; full private Goal/type contracts available only after strategy admission/Root visibility lease. Tactics need not be integrated merely to port modules: compatible pure away/path leaves suffice. New modules directory plus separately approved small shared-engine bridges only. | All four full modules/hooks/chest dependencies match frozen source, old overlaps green; independent native review/admission. |
| B0: prepare hand feature gate | Root isolates a tiny humanizer.rs/constructor lease, its new tests and new private Brain evidence. Source behavior: optional no-features constructor keeps old behavior; Some(empty messageTypes) drops every offered intent without consuming hand draws. | Direct actual-source feature-filter supplement and old hand/core tests agree; no change to old constructor consumers or core scheduling. Can be integrated with B1 after its own review. |
| B1: full private Brain composition | Strategy HOLD repaired/admitted, tactics admitted, modules admitted, feature-filter seam ready. New `temporal_percept/brain.rs` + `brain/**`; Root adds only `mod brain;` and narrowly needed sibling visibility. Public bots/brain.rs and bot.rs stay untouched. | Real createBrain source-method transcript versus complete native composition, all observable calls/outputs/RNG/cadence/summary and source continuations; independent admission. |
| F0: earned fair publication / accepted consumer | Separate later packet and Root/Claude field/identity ownership. Bind complete legitimate observations/FrameRing/Memory, reject missing facts without fake defaults, prove hidden-state twins and source-clock/session rules. | No hidden state/alias stitching; same private Brain drive through ordinary validate+submit/budgets in headless/live. Any needed wire/client change belongs to the separately approved owner. |
| F1: complete outcomes and driver semantics | Later explicit runner/adapter lifecycle and real full-game scenarios; reuse admitted pure learning and current account/headless infrastructure. Potion/driver feature guards are runner behavior, not secretly inserted into createBrain. | Actual reset/end/result/headless/live behavior and bounded long-run bot acceptance. No whole-bot completion claim from M/B component parity alone. |

Root must rebase and inventory each stage at dispatch. Proposed modules bridge hunks are described in the packet; none
is an authorization to touch active strategy types, old fixtures, Cargo.lock, World/Sim, observation/protocol, client or
shared status. Native worktrees/build targets remain packet-owned; no reuse of another worker's target/process.

## The actual createBrain caller contract

Construction order is significant: derive decide/motor/lapse from seed tags0/1/2, Knowledge from tag3; construct real
Knowledge, Memory, feature-aware Humanizer, Tactics, guarded module wrappers, then Strategy with attacking callback
reading lastTactics and its log-name prefix. If modules exist, bcfg is a new config object holding those wrappers; this
object is the WeakMap state key. A source cfg identity is not an actor ID. Each actual Brain owns the source-equivalent
per-config module state. Direct module tests must also distinguish equal-value/different-config isolation and shared
same-config continuations.

Each tick follows this order; the private implementation must not flatten it into a generic scheduler:

1. Optional paths.setFrame(now,gatesLocked), then Memory.observe(p), then Humanizer.drainMisses. Only alive owner frames
   append missed-click stimuli, centraltrue, noticed at current now, after the observed stimuli. Dead-frame misses are
   drained and discarded. Remember the latest non-null faction for end summaries.
2. Construct one context with the real Memory view plus the augmented stimulus list. engaged means existing lock AND
   lastTactics.attacking, or real lastHitAt/lastDealtAt within ENGAGE_TRADE_SECONDS. It is not “a fighter exists nearby”.
3. Filter guarded modules by enabled(cfg.features), then run each selected observe even on dead/nonactive ticks. The
   filtered list is fixed for this tick. Strategy independently checks its cfg.modules enabled hooks when it actually
   runs; repeated enabled calls and fault timing are observable.
4. On dead OR nonactive: clear Brain's stall anchors. Only planning phase asks selected modules.intents(ctx,Idle),
   flat-mapping in order; no core goal/strategy/tactics or adjust occurs there. Submit if nonempty, then release/flush
   the hand on every such frame, including dead/ended. Do not add a blanket hand clear, suppress pending releases or
   invent an alive guard for the planning module branch.
5. On active/alive: watchStall and watchGrabs before any new strategy adoption/act. Busy includes old attacking, current
   bow draw, Loot, Hold other than wait, or active sudden death. Movement>=1 resets the Brain anchor. Grabs count an
   inventory increase within2000ms of a frame on which the previous/current goal was Loot.
6. Decide on first frame, strategy deadline, non-running status or SALIENT stimuli (newThreat,lowHp,teleport,targetDown,
   announcement,chestUp,planOffer,lockLost). Run the real strategy first, set status running/decided, draw next strategy
   deadline, then adopt. Goal equivalence includes coarse roam cells, hold reason only, flee renewed as same, and ordered
   JSON.stringify Module data. Count a sparse goal entry/record a truthy choice/log/reset attacking only when its key
   actually changes. First frame still forces act even when the key remains initial Idle.
7. Act on changed/first, any toast, any stimulus or think deadline. Module goal directly invokes that selected module's
   act or exact missing-module failure; it bypasses core Tactics, all modules.intents and all adjust hooks. Ordinary
   goals run real Tactics, concatenate all module intents in order, merge once, then pass the evolving list through
   every adjust in order. merge claims an extra channel only after an accepted insert/replacement: a rejected low
   priority extra does not prevent a later better extra. Cast/menu override; other channels require strictly lower
   numeric priority. At most the first accepted extra claims a channel. Preserve return-list identity on no-change
   adjust where source exposes it.
8. Store lastTactics/status; draw nextThinkAt=min(uniform thinkMs,2000)+now; submit only nonempty intents. Release hand
   every tick regardless of whether a decision/act occurred. Stamp only released Move/Stop commands1..255→1, never
   target/attack/release/cast/etc; then Memory.noteSent on the stamped TimedCommand before returning it. Adapter support/
   actual send acceptance is later runner behavior, not a second condition for this source noteSent.

Module guards belong around each optional module hook, not core layers. Source guard fallbacks are enabledfalse,
observeundefined, goals/intents empty, adjust original list, act failed/`module ID failed`; error text/logs/fault-by-ID
are observable. **Do not strengthen the comment into an immediate blanket guard:** only enabled checks the faulted set.
A wrapper already selected in a tick can still be reached later that tick; run itself does not re-check faulted.
Source capture must establish this actual trajectory. Core Tactics' approved typed service error propagates as a private
core error; it must not be silently converted to a module fault or arbitrary GoalStatus.

Stats are not just the last tactic counters: merge complete hand stats with strategy.huntStats targets/drops/retreats/
focusMs, Brain grabs/maxStall, Tactics dodges/jukes/kiteCycles, sparse changed-goal counts, plan build/route contests.
Tactics.mobTargets/retreats are not the exported Brain values. end(result) returns tier/persona/latest known faction,
result fields or void/zero defaults and a fresh copy of Memory choices; it neither flushes/clears state nor writes a
store. Repeated end is a pure summary call; stopping future driver frames belongs to BotRunner, not a new Brain flag.

## Ready source witness recipe for modules, and later full Brain

The modules packet defines the immediate finite corpus. After Root approval use the existing Node22.23.4 linux/amd64
Docker digest `aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, source read-only, tmpfs node_modules,
npm ci --ignore-scripts, new outputs only. Reuse/copy the reviewed MethodValue codec by pinned provenance, never edit the
17 frozen strategy files or frozen tactics source. Real constructor/method calls generate expectations; no generic
reimplementation/expected state/constant dependency-result tape is needed.

A later full-Brain witness should call actual createBrain.tick/end with actual built-in registry modules and declared
complete Percepts, map/path services and learned snapshot descriptors. A finite supported observer FeatureModule may
wrap the actual exposed context decide/motor/lapse and Knowledge/path functions to record calls without adding draws,
and snapshot the actual eight-field Memory view immediately. Declare that observer in the module list and its exact
no-decision/no-intent behavior; do not replace real strategy/tactics/modules with source-count surrogates. Compare full
returned stamped TimedCommands, goal, stats, summaries, logs, callbacks, actual RNG values/count/order and continuation
behavior. Real humanizer misses must cause later clickMissed; actual released casts must supply Memory.lastCast; order
feedback scenes remain declared, not an invented earned simulation result. Include enough real releases to cross255.

Knowledge's constructor stream is private before any module.observe can wrap context. Do not claim that an observer
saw its constructor draws. Pin actual createBrain derive/tag wiring and use the already source-executed
knowledge-repair constructor witness (actual createKnowledge with externally wrapped derived tag3 RNG) as the explicit
constructor dependency, alongside the unified post-constructor trace. Native construction must replay that real
constructor exactly before Brain ticks. If independent review requires direct unified constructor instrumentation,
Root must approve a narrowly observational recipe first; no fabricated four-lane transcript or source rewrite is an
acceptable shortcut. Likewise Brain does not expose Strategy's closure diagnostics: reuse the independently sealed
component witness and distinguish caller state with subsequent Brain calls rather than inventing getters.

Full-Brain semantic controls should target path-clock-before-observe, miss ordering/dead drain, engagement boundaries,
strategy-before-cadence draw, changed-key/choice/log rules, module bypass/merge/adjust order, fault timing/fallbacks,
feature rejection before hand draws, release on dead/nonactive, seq255 wrap and stamped noteSent, hunt-vs-tactic stats,
stall/grab windows and end copy/defaults. Keep first failures and surviving controls; compile/decoder failures are not
semantic KILLs. Old source corpora provide compatibility overlaps, not opaque answers fed into runtime.

New captures keep binary64 inputs/results unrounded, exact identities/order/enums/counters/clocks/timers/RNG and all
callback arguments/results. Source-supported Undefined/Null/missing and Infinity sentinels stay distinct. Begin native
comparison exact; only independently approved field/path numeric whitelists may relax genuinely continuous geometry/
transcendental leaves. Do not inherit old rounded planning output as a new blanket utility/timer tolerance. Independent
source reproduction gates native fixture reader/comparison; strict typed conversion must complete before state/RNG/path
mutation. This architecture plan reports no executed new tests or parity result.
