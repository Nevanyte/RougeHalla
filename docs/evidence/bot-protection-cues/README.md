# Protection/cues finite source witness — CODE-ONLY PREPARATION (UNRUN)

Status: CODE-ONLY / UNRUN. No compiler, native helper, scenario/World import or execution, Node
module import, Docker/source capture/control/frozen run, package install/download, new cache, source or
corpus edit, public/native activation, or subagent was performed. Root reviews this sealed source and the
literal Phase A/B envelopes before any execution.

- Branch: deepseek/protection-cues-source.
- Exact base: bb564d3b53728cbd205af375b5342eca466f3656.
- Write scope only: NEW tools/bot-protection-cues-fixtures/**, parity/policy/bot-protection-cues/**,
  docs/evidence/bot-protection-cues/**.
- Old source/evidence, the sealed14/helper69/boundary24 corpora, all raw receipts and both prior untracked
  offline-01/02 directories are preserved; this branch changes no existing source or old evidence.
- The prior automatic-review denial and access mode remain unchanged.

## Fixed design

- Exactly 11 cases: P0 P1 B0 B1 B2 W0 W1 W2 W3 W4 W5; one builder, born map, seed7, max96 ordinary steps
  per case, total maximum1056; no extra World/probe campaign.
- Only initial weapon slots and W4 caster HP1 are declared before the first step. All clocks, positions,
  immunity, history, action, visibility, RNG, death, launches and cancels come from actual source.
- Inputs use ordinary enqueueClientMessage before the step whose post-step time is the declared apply time;
  every schedule records acceptance and actual arrival/apply timing, and refusal aborts the case.
- One persistent Encoder per case; actual order: step events -> FxChannel.batch against previously SENT
  roster -> extendRoster -> encodeAll with fresh offset/copy bytes -> fresh RaidState Decoder -> rosterSent;
  only then feed decoded state and packed/unpacked FX/launches to viewers.
- Runtime consumer order: BotVision.update -> perceive -> FrameRing.push -> compose (including startup null)
  -> BotVision.filter -> Memory.observe. No replaced intermediate frames/digests.

## Temporal data retention (addendum f507844d)

For every actual step and each viewer, a deep copy of the complete pre-push Frame is retained before the
actual FrameRing.push: t,self,hud,fighters,mobs,containers,projectiles,minimap,events,immediate,extras.
The complete actual compose return, including null, is retained before filter; postfilter is separate.
Actual composition inputs are retained: selfDelayMs=0, worldDelayMs=WORLD_RENDER_DELAY_MS,
attentionCentral=TIERS.normal.attention.central, full features, unchanged typed-array map/gate data, map
source path/hash. No private Memory values are used as expected/input facts.

Serialization policy: finite JSON numbers stay numbers; NaN/Infinity/-Infinity/-0 and undefined are tagged
explicitly as {$number:"NaN"|"Infinity"|"-Infinity"|"-0"} / {$undefined:true}; never silently NaN/Infinity
to null. The verifier consumes these raw bytes; no numeric canonicalization is allowed.

## Files

- tools/bot-protection-cues-fixtures/scenario.mts — 11 cases, fixed builder, actual codec/FX/vision/ring/memory.
- tools/bot-protection-cues-fixtures/build.mjs — Phase A host-only builder (exact pinned esbuild; no
  scenario/World import/execution; writes only a fresh prepared directory).
- tools/bot-protection-cues-fixtures/runtime.mjs — Phase B runtime only; imports frozen relative scenario
  and verifier after Root-supplied manifest/scenario/runtime/verify pins; no compiler/child/npm/network.
- tools/bot-protection-cues-fixtures/verify.mjs — raw-first semantic producer verifier.
- tools/bot-protection-cues-fixtures/controls.mjs — six actual compiled control mutations plus comment
  provenance nonkill, DEFINED_NOT_RUN.
- This README, PROPOSED-READSET.json, OFFLINE-COMMANDS.md, CONTROL-MATRIX.md, PARITY-README.md.
- parity/policy/bot-protection-cues/README.md — no corpus produced yet; UNRUN.

## Expected positives / negatives

P0: positive owner deadline, lower and upper remote protection guards, before/expiry zero. P1: protected
attempt no paid HP loss, then paid unprotected HP loss after expiry. B0: real Bow draw/Arrow launch; B1:
committed draw + Swap -> no Arrow, no cancel FX claimed; B2: paid Sword hit during Bow draw, Bow not
stagger-cancelled, Arrow survives. W0: actual retarget cancel FX + observer windup/cancel feint, not merely
no Ball after later Swap. W1/W2: committed Wand cast still launches after Stop/Move. W3: real Wand windup,
paid Sword hit/stagger, standing, no Ball. W4: real hit/down/death/runEnded with HP1 caster, action released,
no post-death Ball. W5: one chronological run; first Wand Ball, readiness wait, second windup delivered at
its original time after hand becomes Bow, no second Ball; must fit96. All cases include actual acceptance,
timestamps, IDs, event order, RNG tape, uid tape, schema bytes/hash/size, pre-push frames, compose returns,
postfilter and public stimuli/alive/feint.

## Explicit UNRUN / limits

Phase A build, Phase B capture, readonly bytecheck/check, six semantic controls, comment/restored controls,
frozen Git export, external byte reproduction, native24 consumption and full P15/public/fair/live
activation are UNRUN. No renderer/Phaser claim, no private windup-map expiry proof, no foreign-deadline
fair API, no direct canPlayerSee substitution, no desired visibility/state/RNG installation, no full
signature assembler/live Brain. Root owns admission, timings, and the next lease.
