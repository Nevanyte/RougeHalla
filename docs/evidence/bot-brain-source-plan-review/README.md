# Full Brain source-plan review

Disposition: **ready for source-only dispatch after the small clarifications below**. The actual createBrain APIs can drive
the proposed complete composition. No source patch, fake Memory/Strategy output, private getter or native-answer inspection
is needed. Two specifically claimed reaches need an explicit recipe/limit, rather than being promised by labels.

Read-only review of integration HEAD `34e6b6c65b88fce090d320d35109c1912b637a83`, the then-uncommitted
`docs/backlog/packets/P-BOT-BRAIN-1.md`, BOT_BRAIN_COMPLETION.md, unchanged Brain/Strategy/Humanizer/Knowledge/services,
BotClient.start, BotManager.seat/frame and BotRunner. No capture, execution/probe, Rust review or code edit was performed.
The modules candidate remains immutable. This file is the reviewer's only write and is not a source/native admission.

## Smallest corrections before dispatch

1. **Correct caller construction order and declare external budget operations.** Packet's “enabledModules, create paths,
   then createBrain” reverses both current callers: BotClient.ts306..312 creates paths before evaluating enabledModules in
   the constructor argument; BotManager.ts344..346 likewise constructs the service before enabledModules/makeBrain.
   Declare construction/recreation handles and room budget.startTick explicitly; createBrain only calls setFrame and never
   replenishes a budget. BotManager starts one shared allowance per room frame, with one cache/service per bot;
   BotClient has its own budget. Do not reset that allowance once per interleaved Brain tick.

2. **Make module-object identity separate from module.id and cfg identity.** A descriptor needs ordered module-handle
   references, not just strings. Resolve actual built-ins to their existing singleton exports. Reusing the same original
   cfg must reuse its exact module objects/list; createBrain itself allocates fresh wrappers and a fresh bcfg when the list
   is nonempty (brain.ts151..152). Two distinct module objects with equal ids remain two entries for a directly declared
   cfg, while their wrappers share that Brain's fault marker by id. Instrumentation bookkeeping must key the actual rng/
   bcfg handle per Brain, not a global “wrapped once” bit on a shared observer object. This is essential to the already
   required same-cfg/two-Brain and equal-id fault histories, not an additional case campaign.

3. **Distinguish exposed tracing from constructor dependency evidence.** Install real service wrappers before createBrain;
   an observer first reached at brain.ts300 cannot retrospectively see setFrame at288. Its supported ctx can wrap the
   three mutable runtime RNG functions before their first ordinary tick use; Knowledge tag3 is already closed and its70
   draws are not observed there. The existing knowledge-repair tool extracts/evaluates actual derive source and checks
   wiring, but records only three preview draws (capture.mts105..109), and its fingerprints use r6 rounding. Reuse that
   source recipe/provenance, not its rounded values as the new exact oracle: create a separately labelled actual-source
   dependency witness with all70 wrapped draws/full tier and unrounded queries; compare real Brain Knowledge calls to it.
   Knowledge.odds invokes closed faction/weapon helpers internally, so wrapping its public methods does not reveal nested
   internal calls. Do not invent such callback events. “No features” with an always-enabled observer is also not a truly
   empty cfg.modules profile; the latter has bcfg===cfg and no exposed ctx RNG/Memory observer. Label those observability
   limits instead of claiming one unified observed four-lane constructor transcript.

4. **Supply the two minimum distinguishing recipes.** For path-clock-before-observe, a callback log followed by observer
   cannot alone distinguish moving setFrame just after Memory.observe. A valid zero-draw recipe is to retain the actual
   live ctx.mem handle from an earlier observe, then have the already-installed setFrame wrapper snapshot self.lastHitAt
   on a later declared hit frame: original reads the prior value, reordered source reads the newly folded hit. This reads
   supported state only; it never installs Memory. For “first act despite unchanged initial Idle key,” explicitly permit a
   caller-only extension to offer an ordinary Idle candidate through real Strategy. Unchanged active Strategy inserts
   Hold(wait) when otherwise empty (strategy.ts294..298), and dead Brain skips Strategy; natural built-ins therefore do
   not supply that Idle reach. Keep this extension out of the genuine core-gameplay histories.

5. **Do not promise unreachable cast/menu base replacement through ordinary hooks.** brain.ts259..263 passes actual
   Tactics output as merge base, collects all module intents as extras, then adjusts afterward. Current Tactics emits no
   cast/plan/choose, and module.act bypasses merge entirely. Thus extras can demonstrate cast/menu insertion and first
   accepted claim, but cannot reach mergeIntents130's replacement-over-existing-cast/menu arm. Either mark that arm
   explicitly unreachable in the full-Brain input profile, or separately approve a read-only actual private-helper
   extraction supplement. Never fabricate a Tactics base, feed earlier adjusted results back, or label a duplicate extra
   as proof of that replacement arm. Ordinary order/swap/pickup rejection-then-acceptance remains genuinely reachable.

6. **Keep the core-error boundary honest.** Valid real RoomPathService does not supply the non-null empty route used by
   the admitted tactics method-test boundary. If this Brain packet claims that exact propagation reach, explicitly allow
   the same labelled argument-sensitive test-service descriptor and capture actual JS throw/pre-error effects. The source
   error is not a typed EmptyWorldRoute; that is the separately approved native mapping. Otherwise retain this boundary
   as component evidence/unreached full-Brain service scope, rather than promising it from normal real services.

## What is sound and needs no redesign

The stated constructor layer order, derived tags0/1/2/3, per-Brain guarded config, repeat enabled checks, same-tick selected
wrapper behavior, dead/nonactive release, old-goal stall/grab watches, strategy-before-cadence/adopt, ordinary merge then
evolving adjust, module bypass, Move/Stop stamping before noteSent, HuntStats selection and end lifetime/copy semantics
match unchanged source. Source Brain does not expose its Strategy state/candidates or Humanizer pending closure; supported
context observation plus genuine subsequent ticks, command feedback and component evidence is the correct boundary.

Declared finite extension hooks can legitimately supply goals, statuses, competing extras and hook throws through the real
FeatureModule API for caller-only histories. They must not replace built-ins or real Strategy/Tactics in the core histories,
and descriptor hooks must depend only on declared input/context/call counters, never recorded expected outputs. Real wand
misses, released casts, enough alternating real hand releases for seq255, inventory/route/engagement feedback and later
summary snapshots are all supported without counter setters. Capture actual reaches and continuations, not just labels.

The direct feature-aware Humanizer supplement is appropriate: absent features retains old constructor behavior, and the
COMMAND_TYPE offer gate precedes pending/delay/draw work. Full Brain still supplies actual features. Runner.frame's
supports/send acceptance, potion guard, FrameRing/vision/delay composition and runner.end's ended latch are later adapter
work: they must not be added to createBrain, whose end itself does not terminate future ticks. This separation preserves
fair Observation/live/headless gates and Claude's network/client ownership.

No optional cross-product expansion is requested. Once these descriptor/observability/reachability clarifications are
incorporated, Root can dispatch genuine full Brain source preparation with the packet's current finite families and
independent reproduction requirement.
