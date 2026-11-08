# Advanced bot completion: concrete disclosure and implementation dependencies

Review base `198902f42970bd3d71d431931020819b0e36f008`; current main identities at that base are protocol13,
Observation19, policy13. This is a proposed sequencing/lease map, **not** admission of new public facts or versions.
It updates the older `docs/coordination/FAIR_OBSERVATION_ADMISSION_REVIEW.md` findings without changing that record.
The isolated hazard leaf is the first implementation, not a substitute for the remainder below.

## Existing work to retain

`bots/{knowledge,planning,view,delay,learning,paths,kite,wish,mob_hunt,build_route}.rs` already contain the verified
foundation. Knowledge tag-3 RNG wiring/diagnostics and planning seat wiring are already repaired/admitted; do not port
them again. `mob_hunt` and `build_route` are pure helper subsets, not the source stateful hunters. `perception.rs` is a
small current seat adapter, not the complete source constructor/FrameRing. The seat still has a bounded combat/roam
front end; it has no complete BrainContext/memory/strategy/tactics goal arbitration.

Read-only inventory of all local bot/brain branch heads found no committed `rh-policy` memory/frames/strategy/chest/
hazard implementation to import. `deepseek/p-bots-brain` ends at `47ffd063` (the held observation proposal); its prior
Knowledge/view/planning prefix is already present. The old telemetry branches retain a nonancestor `9bbac425` history
entry, while its composed runner/telemetry implementation is already in main; this is not missing bot-brain work.
This inventory does not authorize deleting preserved branches or consuming uncommitted/private experiments. Before
starting each memory/brain write lease, the coordinator must reconcile any such retained work with its owner.

## Actual disclosure gap map

The source anchors here are executable code, not the broad old "human receives it" assertion:
`packages/server/src/bots/brain/perception.ts::{selfView,fighterSeen,mobSeen,perceive,seeContainers,seeChests,seeCamps,seeFields}`;
`frames.ts::{push,compose,deliver}`; `memory.ts::{foldFighters,foldEvents,foldMobs,foldCamps,foldContainers,foldProjectiles,foldOrders}`.
Current native anchors: `crates/rh-sim/src/observe.rs::{SelfView,ActorView,SeenEvent,Observation}`,
`item_view.rs`, `reward_chests/{observer,view}.rs`, `projectile_view.rs`, `status_runtime/observe.rs`.
Actual human projection is `crates/rh-server/src/{wire,wire_state}.rs` plus `crates/rh-protocol/src/{delta,quant}.rs` and
`client-unity/RoguehallaNet/Net/{Views,SnapshotBuffer,Collections,Session}.cs` / owned collection/event views.

| Inputs / consuming layer | Current native vs actual human13 | Minimal disposition |
|---|---|---|
| Visible position/facing/status/faction/in-hand weapon, HP share, bounty, effects, sig | Present; actor coordinates/facing quantize on wire (1/8 unit / signed-turn u16); shares become whole percentages; bounty saturates u16. Native raw values must not bypass decoded precision. | Shared delivered-precision adapter, then source-compatible `dist`, central, in-hand (`Fists`→empty-hand compatibility), targetable effect-bit predicate. No new hidden data. Native visibility is a ceiling; camera filtering can narrow it. |
| Owner hp/max/barrier/ring, inventory, build, Wish, arena clocks/training | Delivered; owner floats are f32, clock overrides are authoritative source time, counts have declared wire bounds. Source power is derivable from own card counts/catalog. | Expand policy-only shapes from these lawful facts. Do not replace absence of lifecycle/arena with made-up defaults. Potion stock is already delivered. |
| Owner attack lock | Native `SelfView.attack_target` visible-target-only; **not** in `wire_self` or C# `SelfView`. Source `memory.foldLock/foldOrders`, hazards.stepOff and fight tactics read the canonical lock. | Decide and share an actual owner lock display/ack fact; own remembered target click is not proof the lock landed. No automatic disclosure lease. Hazard source parity may use declared native contexts privately, but live human/policy activation remains held. |
| Owner draw/absolute ready/immunity, mirrors, mob kills/farm stats; fighter draw/immunity; name/BOT/brand | Various native runtime facts exist, but the requested source leaves are not all in human13. Source multipliers are thousandths; `ready_in_ms` is capped/floored u16, not historical `readyAt`; source fighter immunity is a render-time boolean, not its private expiry. Names/BOT aren't canonical delivered roster facts. | Separate owner combat-display packet with specified precision/availability, then visible fighter cues. Do not reconstruct exact historical timestamps, farm totals or bot tags. Content labels from already-delivered mob type are lawful static labels; arbitrary display names require bounded ingress/publication. |
| Camp roster | Native `CampRoster` and `wire_state::camps` already deliver type/elite/alive/state/clear/respawn. | Source camp memory can consume these public aggregates. It must not infer the individual NPC roster or hidden hp from a count. Source ward-owner/expiry extras are a separate availability question. |
| Individual mob minimap dots | Source `perceive` repaints 100ms, 16-unit position dots, stable IDs and faction/elite, vision filtered when `canSee` exists. Current transport has camp aggregates and visible actor rows, not this offscreen dot collection. | Source stateful MobHunter/home/awake/return/camp inference needs a shared human minimap projection with viewer-scoped stable continuity and lifecycle. Cannot fill it from `World`/camp counts. Current source `canSee` differs from old no-fog prose; honor the current vision wrapper. |
| Reward rows/choices | Human13 now supports Card/Boost/all9 Kill gains, own Build and normal Choose; source `seeChests` owner-filters Trophy before disclosure and hides options outside panel range. Current policy `format!(Debug)` options and `r{index}` IDs are not source option strings/stable identity. | Adapter should use `OptionId::as_str`, picked/taken states and committed current handle/index, retaining owner/sight/range/birth hold. No reindexing or invented action mapping. Durable memory needs a continuity decision below. |
| Weapon props/bodies/cannons | Human already receives typed cues, focused item and bounded labels, not complete private container inventories. Native policy currently uses `c{index}`. | Project existing cues only. Source body "empty only when reached and nothing lights up" cannot be replaced by private item count. Public cue ordering/action handles do not prove persistent container identity. |
| Stable object memory | Pickup/reward handles renew/rebind only to their immutable offer targets; collection order/index can change. Source memory keys real source container IDs across frames. | Explicit viewer-local public continuity IDs or a witnessed public matching policy; do not use raw private serials or claim equal-coordinate duplicates are distinguishable. Keep observation identity distinct from current action capability. Renewal/grace, duplicates, disappearance/reappearance, reconnect require defined semantics. |
| Fields/current projectiles | Delivered native field geometry/deadlines and current ID-free projectile kind/position/facing/visible owner. | Field avoidance may read decoded public geometry; no hidden owner recovery. Source FrameRing launch IDs, speeds, stops, range/history and time-of-origin cannot be invented from current snapshots. A different trajectory estimator would be a declared adaptation, not exact source parity. |
| Wish event lifecycle | `CastStarted/Landed/Ended` now have event_time and delivered human WishStarted/Landed/Ended. | Reuse the actual timed public path and redacted anchors. The old review's blanket missing-Wish claim is stale. Do not broaden to private AbilityHit/StatusApplied/Heal/SignatureHit. |
| Ordinary combat/memory events | Human13 Swing/Hit/Block/Stagger/Teleport + reliable Death/Bounty/Ended/refusals exist; raw Windup is still server-only; Heal/AttackCancelled/AbilityHit/SignatureHit/StatusApplied are omitted by `wire::to_wire`. Most SeenEvents lack origin time; catch-up final observation time is not source event time. | A shared delivered event envelope needs original time/order and bounded carry semantics; decide Windup/visible draw separately. Preserve completed-step sight and actor-reference redaction; actual source frame-time perception is not proven equivalent by copying an enum. |
| Global run summary, winner, announcements/roster names | `Arena.started_with` exists; current player alive/count/min threshold and durable winner name don't. Legacy all-row `perceive` counts hidden deaths, while human statusLine/held-Tab have different phase/training availability. Existing MatchEnded winner ID is a notification, not durable source winner name. | Root ADR must name the aggregate exception and phase/training/reconnect availability before transport. Preserve threshold vs rows vs fixed denominator. This blocks source coliseum `alive>2` branch, not all independent policy modules. No full hidden roster grant. |
| Quest/trade | Separate owners/candidates; not a carte blanche global roster or body location feed. | Consume only finally admitted shared quest facts/actions. No quest-target IDs converted to target capability or hidden coordinates. No overlap in this lease. |

## Smallest useful shared design and exact decisions

1. **DeliveredFrame boundary, before full memory activation.** A pure policy leaf can own source-shaped optional cue records
   built solely from committed per-seat public delivery. The producer must normalize exactly as human13 decodes (including
   saturation, quantization, omission and event kind), with no `rh-protocol` I/O dependency in `rh-sim`. Define tiny shared
   precision/projection helpers in a separately leased leaf or prove equivalence through existing wire tests. Human client
   remains a presentation/input consumer; no gameplay/AI is copied to Unity. Model unsupported facts explicitly as unavailable (distinct from a delivered empty/false fact); do not create per-hidden-row
   availability markers. Never model an unavailable leaf as zero/false/empty or call that exact source input. Gates prevent consumers requiring an unavailable fact from activating.
2. **Bounded memory prefix independent of new facts.** Fold only seen player positions/weapons/faction/public bars and
   own observed motion/commands, using delivered source time. Source `whereabouts` expands last-seen position by
   `0.6*PLAYER_SPEED*age/1000`, expires strictly after tier memorySpan, and never fills hidden hp. Use source 100ms velocity samples only when both public samples
   exist; the current adapter's immediately previous observation is not that source calculation. Human/policy acquisition
   cadence and configured self/world delay must be witnessed before FrameRing parity is claimed. Last observed positions
   are memory, not present target authority: all commands resolve against the current delivered reference/handle and normal
   validate+submit. Keep unimplemented event/lock/minimap folds explicitly unavailable. Reconcile preserved prefixes first.
3. **Unlock exact combat callers:** root chooses owner lock + draw/mirrors precision and timed combat/Windup disclosure,
   then memory event fold/fight tactics/orbwalker can be ported against actual source timelines. Until then, no claimed
   readyAt/windup/feint/order-ack parity; command delay is not FrameRing latency.
4. **Unlock economic/hunter callers:** root chooses public object continuity and minimap dot availability/continuity;
   then source ChestHunter/chest module and stateful MobHunter/BuildRoute/huntAdapter. Current lawful reward metadata,
   Build and camps permit helper parity before this, but not a fake full world-memory port.
5. **Complete goal arbitration:** memory + Knowledge → strategy scoring/goal lifecycle → tactics/{fight,world} →
   module goal/intent merge → Humanizer → current public command doors. Source `strategy.ts` has real dependencies on
   mobKills/power/speedMult, timers and `hud.alive>2`; retain each missing branch rather than omit it silently. Choices
   recorded by this layer feed the already-admitted learning store; no replacement store/model architecture is needed.

Requested future write leases (not exercised here):

| Lease | Exact scope / prerequisite |
|---|---|
| Policy delivered adapter + bounded memory | new `rh-policy/src/bots/{delivered,memory}/**`, minimal types/module exports, source capture/test tools and new corpus; reconcile retained prefixes; root must first approve delivered precision/availability contract. No native private fields. |
| Owner combat cues | root-approved narrow `rh-sim/observe` + prepared actor-reference projection, server/protocol/JS/C# owned-view/golden consumers; public display/ack semantics for lock, draw, immunity/mirrors; versions root allocated. |
| Timed combat delivery | `rh-sim` projector/event carry + server publication + protocol decoders/owned events; separate root Windup decision; timing/order/redaction witness before memory callers. |
| Stable public object/minimap identities | `item_view`/reward observer/minimap leaf + matching human delivery; after entitlement filtering only, no hidden births/counts/serials/exhaustion effects. Root chooses identity lifetime and public availability. |
| Summary | dedicated ADR + projection/transport/client replacement state, named hidden aggregate exception; distinct from the earlier leases and not required for private hazards helper parity. |

All new shared facts remain held. No version/bit numbers are allocated by this document.

## Admission tests that matter

- Compare actual source helper/FSM calls, then actual validate+submit seat commands; distinguish module parity from whole
  brain/game outcomes. New corpora never rewrite earlier expected outcomes or bless injected expected runtime state.
- Paired worlds differing in hidden actor state/birth/death/order, private item contents, fields and NPC movement must yield
  identical unrelated decoded cues, IDs/order/counts, source-time envelopes, memory transitions and commands. Enumerate any
  separately approved public aggregate exception; never exempt the full frame.
- Persistent observer/publisher tests: prepare/drop/enqueue failure does not grant bindings; committed publication does;
  carry uses original visibility/order/time; no same-batch duplication; bounded overflow refuses/drops only documented FX.
- Duplicate coordinates/kinds, gain-only updates, handle renewal, retired grace and stranger/hidden/offscreen action refusals;
  no stale memory ID becomes new target capability. Reconnect revokes capabilities and clears pending event/command epochs;
  continuity/memory retention requires an explicit lifecycle choice, not an accidental index reuse.
- Source clocks may start offset/non-grid; restored continuation, clock reset/backwards, teleport cuts, removed/rejoined
  actors, repeated snapshot times, bounded frame/event/projectile retention and delayed source events need positive and
  negative controls. Do not assign event origins from `tick*50` or the final catch-up clock.
- Warm allocation/time gates include genuine owner casts, visible players/mobs/dummies, labels and reused buffers. No I/O,
  clock/entropy calls or ML services in pure simulation/policy decisions. Policy RNG streams retain admitted source order.
