# Next shared bot facts: proposed field contracts, decisions and write leases

Review base `198902f4`, protocol13 / Observation19 / policy13. **No field/tag/bit/version is allocated here.** Root owns
the public successor and composition with the independently owned quest Observation/policy candidate. These are
concrete proposed contracts, not approval to expose private runtime or a declaration that the old fair-view proposal passed.
The private codec/memory subset does not activate any of these facts.

## Current gaps and source controls

The source is `packages/server/src/bots/brain/perception.ts` and `frames.ts` as executed at the base, not old BOTS.md
availability prose. A source field being schema-synced is not itself permission for current human/policy disclosure.
Current native `observe.rs::SelfView` includes a visible-target-only attack_target; human13 `wire.rs::wire_self` and
C# `Net/Views.cs::SelfView` omit it. Draw and mirrors are also absent. Timed Wish events are already delivered and must
be reused. Ordinary combat origin times, raw Windup, durable object keys and individual mob dots are not supplied by
human13. `reward_chests::RewardChestView.handle` / pickup handles / per-scene NPC refs are action/presentation offers,
not a source lifetime identity; never store their numeric indices as eternal objects.

The precise next implementation should start with **owner combat displays plus timed existing combat FX**, after the
source witnesses/decisions below; this unlocks memory lock/order/draw/timing folds and fight tactics. Stable object
continuity and minimap form a second packet for ChestHunter/stateful MobHunter/BuildRoute, with a separate source/UI
continuity witness. Global player counters/names/BOT tags, winner and unrelated quest/trade facts are outside both.

## Per-field specification for root review

The table specifies both the source receiver and proposed encoding. Encoding proposals are intentionally not assigned
wire codes. If a producer cannot satisfy the specified numeric domain, refuse its public projection; never saturate,
truncate or substitute a default. Existing gameplay timing, gates and input validation are unchanged.

| Field | Exact source producer and actual human / old-bot receiver | Entitlement, value/encoding and clear semantics | Smallest consumers and missing proof |
|---|---|---|---|
| Owner authoritative lock | `server/src/sim/weapons.ts::{setLock,clearLock}` (set/clear attackTarget), cancellations/reset paths; `shared/schema.ts::PlayerState.attackTarget`; human `client/src/scenes/RaidScene.ts` lockDisplay + local prediction reconciliation/updateInput; `client/src/render/targeting.ts::LockDisplay`; bot `selfView`, memory `foldLock/foldOrders`, fight tactics, huntAdapter | Owner only, canonical state separate from local pending click. Proposed optional typed public ActorRef; explicit clear is no lock, not unavailable. Current native projection includes target only if visible. **Decision required:** source's own lock can name a no-longer-drawn target; do not leak a never-delivered/hidden raw identity, and do not silently call a redacted unknown target "no lock". Review whether own locked-but-unidentifiable state needs an explicit public case and how prior public refs may be retained. This is a root C-OBS decision, not solved by a bool guess. | Native owner cue + staged actor-ref mapping; server Full/Delta + C#/JS owned view; human lock display; policy memory order/lock fold. Actual source target→move/stop/cancel/death/hidden/leave/reappear, lost sight while still locked, own Swarm, NPC-ref renewal and same-tick order cases are needed; old click intent is not the witness. |
| Owner bow draw start | `sim/weapons.ts` start action writes drawStartedAt; land/cancel/reset writes 0; schema uint32; human `PlayerView` / `FighterArt` bow pull and `RaidScene` localBowPull confirmation; bot selfView and fight swap guard | Owner only in this first packet. Proposed source uint32 timestamp, 0 is explicit no draw. Source `perception.selfView` applies `>>>0`; the actual schema boundary must witness fractional/offset/large clock handling before using native f64 directly. Do not export pending action/aim/packet damage. No extra remote draw leaf is automatically admitted. | Current Player.weapon.draw_started_at projection, codec owner replacement, display and memory/tactics. Need genuine public validate+submit draw→release/cancel/stagger/death/training reset + original/restore continuation, including source clock fraction and uint32 boundary. Do not derive it from readyInMs. |
| Owner absolute ready clock (adjacent prerequisite) | Same source action start sets readyAt; cooldown stays spent across cancellation; schema uint32, selfView `>>>0`; bot fight/orb timing; human weapon bar/predicted pause state reads public cooldown inputs | Existing human13 remaining u16 is NOT this historical source timestamp. If root includes the prerequisite, proposed source-u32 absolute value with actual source schema normalization; explicit 0 remains source value. Unsupported/current13 is unavailable, not now+remaining. Numeric boundary/offset proof as for draw. | Needed for exact fight swap/orbwalker source callers, not for the private memory subset. Source timestamp normalization and cancel-vs-ready continuation are still missing as a coupled human/native witness. |
| Owner attack-speed mirror | `sim/mods.ts` recompute/set mirrors; `shared/mods.ts::{encodeMult,decodeMult,encodeMirrors}`; schema asMult float64 thousandths; human buildModel/buildHud/championCombatHud and FighterArt timings; bot selfView.asMult | Owner only. Proposed **f64 wire-form thousandths**, finite >=50, decoded by /1000. Source encoder can produce finite values above u16, the stale MOD_MULT_MAX=20 is not a ceiling. Do not fold/simulate stats in Unity/policy or recalculate from a guessed Build. Explicit identity is 1000; absent support is unavailable, not identity. | Export existing canonical modifier wire mirror (not decoded then re-encoded approximate f32); owner codec/UI/policy. Need real grant/buff/debuff/faction/death/TrainingClear and restore including post-cap attack modifiers; exact source mirror bytes and above-u16 values. No new gameplay mirror producer. |
| Owner windup mirror | Same canonical source mirror producer/schema; human FighterArt/weapon timing/bow-pull; selfView.windupMult (`undefined` fallback exists only for older source branches) | Same f64 thousandths domain/identity/absence rule; do not expose the private remaining action/root or use fallback1 on a current unsupported field. A three-mirror atomic owner group avoids mixing samples. | Existing modifier wire slot + codec/display; exact fight timing later. Source card/buff cancellation and warm real cast/timing witness needed; not just schedule constants. |
| Owner speed mirror | Source mods/recompute/schema speedMult; human buildModel/buildHud and movement display/prediction; selfView.speedMult, strategy/build route travel estimates | Same f64 thousandths. It is the canonical mirror, **not final actual velocity** or all chill/terrain/Wish motion modifiers; do not add a private total-speed fact by renaming it. | Existing canonical wire slot + human display and policy route estimate; actual source slow/clear/restore/large-value witnesses. No movement prediction/rule changes in this packet. |
| Stable weapon-prop continuity key | Source container IDs born in sim loot/pickups; human `ContainerView` and interaction focus identity; bot `seeContainers`, memory container records. Actual contents remain gated by focus/range/LOS | Proposed viewer-local opaque u64 key, distinct namespace from reward keys and action handles. Allocate only after public entitlement, public-precision canonical sorting and duplicate handling; raw global serial never leaves server. Stable while continuously entitled across public cue changes/handle renewals. Full replacement omits no-longer-entitled rows; omission is not death/removal proof. **Decision required** for reappearance: resetting key on entitlement loss is privacy-safe but differs from source lifetime IDs; retaining across a hidden replacement at the same cue could reveal private identity. Do not claim source-equivalent continuity without that witness/decision. | ItemObserver staged continuity table, public prop row/owned client marker+policy memory. Bind current Pickup handle separately at each accepted update; no continuity→pickup conversion. Genuine swap/open/empty-body/death/replacement, duplicates/ties, source getter UI/focus and hidden replacement paired-world controls needed. |
| Stable reward-chest continuity key | Source `sim/chests.ts`/killAugments create container IDs; human minimap/chestPanel and chestMath.pickReward; bot seeChests/ChestHunter/module state | Separate viewer-local u64 key; retain while entitled across taken/picked/gain-only/handle updates. Trophy owner filtering BEFORE keys/counts/sort/alloc; options still governed by current can_choose/open panel. Key grants neither Choose nor hidden cards. Source bot panel rule uses no human hysteresis: seeChests vs chestMath openId must remain explicit. Reappearance/reconnect semantics same unresolved continuity issue above. | Reward observer + server state/owned rows + policy chest module; normal current handle/index validated Choose remains the only action door. Need existing Trophy/card lifecycle plus duplicate/owner/stranger/offscreen and key-vs-handle renewal regression; do not reuse last handle after enqueue failure. |
| Ordinary combat origin time and within-step order | Actual source step FX → `rooms/FxChannel.ts::batch` → shared/fxCodec packFx/unpackFx, batch t exact and emit order; human FxView queue/render and bot observe/FrameRing.deliver/memory | Add a shared envelope to **currently public** Swing/Hit/Block/Stagger/Teleport and reliable Death/Bounty (Ended if consumed). Proposed finite nonnegative f64 source completed-step time; within-step order is contiguous **public-after-redaction** sequence, never raw event index/global serial. Source time is not final wake time or tick*50. Existing geometry/amount precision must be explicitly preserved or source-normalized, not silently widened under "time only". | Seal timing/sight at completed step in projector/carry; server queue + Rust/C#/JS codec + owned events + policy event memory. Need three-step catchup with original times/order, hidden source/target/own-hit, same-time ties, duplicates/loss/clock reset and original/restored continuation. Current percept windup witness proves partial timing distinction, not this committed carry bridge. |
| Windup public cue | Source weapons non-bow start emits windup(by,weapon,a,ms); bow draw sync and related emission paths must be witnessed separately; FxChannel + fxCodec tuple, human FxView.windup/actor cues; bot observe and memory.onWindup | Current native Event::Windup is ServerOnly. **New public classification requires root approval**. Own or actually entitled visible source only; hidden foreign source drops whole cue, not an anonymous presence leak. Proposed same source-time envelope + public actor ref/weapon + **source-decoded** centiradian angle and whole-ms duration. Conservative payload f64 for already-normalized finite angle and nonnegative whole-ms avoids invented i16/u16 caps; encoding may be narrowed only after actual producer domain proof. No projectile launch, target, action packet, private future deadline or damage. | New projector classification/SeenEvent and normal wire/client/policy presentation; retain C-TICK. Capture genuine melee/ranged/wand starts, cancellation/replaced order, stagger/death/source visibility/carry; source actual pack/unpack rounding. Existing partial windup capture is not full lifecycle or new native-public admission. |
| Individual permissible mob minimap dots | Human `RaidScene.update` feeds **rendered + vision.canSee** mob samples to Minimap.setMobs; Minimap allows living mob/elite/zombie, caps drawable dots280; old bot perceive repaint is100ms,16u Math.round and includes only regional mob/elite, filters canSee, retains ID continuity | Propose typed public **navigation** dot key separate from temporary actor refs; x/y source16u grid, faction + elite; no hp, weapon, threat/home/path/brain. Candidate collection replaces at an explicit source repaint time (finite nonnegative f64), at most once per100ms source interval, clearing once when eligibility ends. No global omniscient roster grant. Entitlement must match current human rendered/vision path, not just all native mobs. Old-bot excludes zombies while human allows them; first packet can retain the narrower regional subset, label difference and leave zombie dots unconsumed. Before feature activation prove the supported regional source/map domain fits the human renderer bound280; a larger scene needs an explicit admission/overflow design. Never silently sort/truncate by private ID or let an unadmitted optional dot list freeze unrelated supported frames. | New source-faithful per-view minimap projector with staged continuity; human owned minimap rows and display; policy repaint/mob/camp memory. Need actual UI-feed+perceive paired lifecycle (camera vs off-camera vision, trail expiry, hidden death/replacement, cleared/respawned camp, dot ties/quantization); no source memory's "missing dot means dead" guess promoted to authoritative death. Reappearance identity policy and overflow decision remain root gates. |

## Shared delivery, absence and lifecycle rules (apply to every row)

- Owner cue/mirror values are scoped to an existing owner record in every source phase/training mode where that record
  is delivered, not an invented Active-only gate. Publish the producer's actual reset/identity values in lobby/death/
  training states; do not synthesize them from phase. Props/rewards follow their already-admitted per-view publication
  entitlement, not a widened global container list. Windup exists only when the real admitted weapons producer emits it.
  Minimap phase/training/widget availability still needs the actual human receiver witness; no all-phase promise follows
  from old perceive() iterating its state collection.
- Proposed public continuity keys are nonzero u64, separate typed prop/reward namespaces, monotonic with no wrap/reuse;
  zero is never an object. Initial active row bounds remain the existing512 props /512 reward rows. Root must define
  bounded retained continuity storage and admission/exhaustion behavior before activation; no private hidden history
  may fill it. Use current normal offer handles independently (no new action capability from a u64 key).
- **Unavailable** means not supported/admitted by the negotiated shape/adapter. **Delivered absent/clear** means the
  supported field explicitly has no value. Delta omitted group means retain the last committed value; it does not clear
  it. Full owner replacement must carry the supported group or a defined canonical default; never retain stale fields
  across absent owner, new session, reset, changed protocol or missing Full baseline. A clear owner clears its dependent
  cue fields atomically. Do not leak whether a hidden foreign actor exists with an "unavailable target" marker; own-lock
  unknown-state semantics require the separate root decision above.
- Every reference projects exactly once through the same viewer namespace. A retained navigation key cannot be passed to
  Target/Choose/Pickup. Those actions still require the current committed actor/offer binding and normal validate+submit,
  sight/range/owner/hold/refusal rules. No action gate widening and no client prediction of attack outcome.
- Prepare continuity keys, actor refs, collection replacements, event envelopes and action bindings together. Commit only
  after successful queue admission; dropping/failed enqueue/retry cannot consume IDs, publish half a group or grant handles.
  Reliable replacement base and policy frame must describe the same committed update. A byte decoder does not attest this.
- Hidden changes must not alter public order, key allocation, renewal/capacity/exhaustion, timestamps of empty batches,
  queue pressure or unrelated clear decisions. Sort public decoded cues; do not reuse private/native residual values as
  tie-breakers. Equal public duplicates require a witnessed stable matching policy; a hidden identity substitution alone
  must not become observable. Per-view state capacity derives only from public rows ever admitted.
- Bound per-view carry/dedupe/continuity storage. FX may follow existing documented droppable policy; reliable state/own
  capability publication must fail atomically. Do not let hidden events fill a per-view public queue. No dropping one reward
  option, remapping indices or using raw event-vector gaps to expose private event counts.
- Source time comes from each completed step / decoded source override. On nonincreasing time, explicit interpolation/
  event/memory epoch reset must preserve canonical current state but discard stale timing and pending acknowledgements;
  ordinary tick ordering and movement acknowledgements retain their current contract. Reconnect revokes every action
  capability; continuity retention vs reset must be specified before promising it. The safe initial policy subset resets
  all its history on caller-declared epoch reset, with no replay of events.
- No names/BOT labels, exact remote mirrors, hidden participants, other players' inventory/build/locks, raw reward rolls,
  paths/aggro, global source containers or source roster order become fair merely by appearing in old synced schema.

## Exact implementation/source leases needed before live binding

1. **Real prepared/public bridge:** producer in server/headless after successful publication/observer commit, current
   decoded precision and namespace projection, and adapter delivery cadence. Files: coordinator leases around
   `rh-headless/src/lib.rs`, `rh-policy/src/{lib.rs,bots/{perception,bot,types}.rs}` and server prepared publication tests;
   shared precision helpers only if root chooses them. No raw-observe shortcut; no claim the current data-only Frame is
   an unforgeable token. No live binding in this candidate.
2. **Owner combat group:** `rh-sim` new observation projection/accessors + actor_refs, server wire/publisher, protocol
   codec/goldens, C#/JS owned views/clear tests, human presentation, new source actual producer/UI witness. Root must resolve
   hidden-lock identity and source-u32 clock handling first. This is the smallest shared fact packet for exact fight/order
   consumers; private memory does not justify omitting those consumers forever.
3. **Timed existing FX + approved Windup:** Event/projector/carry scope + normal codec/owned-event/UI paths and source
   timeline evidence. Native public event shape/visibility/order require independent C-OBS review. Policy frame/event
   fold then needs real source FrameRing sampling/visibility/timing tests, not the existing command delay diagnostic.
4. **Public continuity + minimap:** Item/reward and new per-view minimap leaf plus human/policy rows; source actual
   receiver witness. Root chooses source identity vs strict hidden-replacement semantics before implementation, including
   no-overflow/truncation behavior. Then ChestHunter/MobHunter/BuildRoute/huntAdapter can consume it.

The source-only work that can start before shared code leases is precise: genuine owner lock/draw/mirror clear/restore
and render feed fixtures, and the minimap/continuity lifecycle witness. They must capture actual producers + actual UI
projection methods, preserve source bytes, label any declared setup/probes and prove semantic mutants excluding provenance.
They must not install expected locks/cards/camp outcomes or run a global source/map campaign. The current source memory
subset corpus covers only declared no-event contexts; it does not close these producer/UI gaps.
