# Actual TypeScript Wish witnesses

This is source-only evidence for P-ABIL-1. It does not claim native ability, wire, policy or full-port success.
All five Wishes are executed: Freeze, Swarm, Trial, Fire's Blaze Step and Last Stand. Blaze Step is not a sixth ability.

Frozen source SHA256: `8629c08fa42ac9fb15b21c52416658997c7d8969a6962cf59b71cebedd571330`. Bytes: 11861510. FNV1a64 decimal: `16985897309986684806`.
The closed corpus has 63 cases, 6318 ordinary50ms calls and 1237 full frames.
`INPUT_SHA256.json` inventories 132 unchanged legacy/package inputs and every harness input.
Source bytes are original TypeScript; this proposal adds only new fixture and harness files.

## Reproduction

Use `bash tools/ability-fixtures/capture.sh --check` from a checkout containing these new files and the unchanged arena corpus.
The script runs exactly one capture evaluation, with fresh `npm ci --ignore-scripts` from the unchanged lock, inside
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, Linux amd64.
Captured compiler versions are tsx4.23.15 and esbuild0.28.2.
`capture` writes a new temporary output directory by default; `RH_ABILITY_DIRECTORY` selects a directory explicitly.
No npm/root lock changes, live service, production/player data or undeclared entropy is used. `Math.random` throws.
The canonical freeze used one final fresh-npm capture followed by one fresh-npm byte comparison of both source and input inventory.
Development executions preceded the freeze; they are not additional canonical comparisons.

## Source boundary and profiles

`engine.mts` calls unchanged `createWorld`, the actual named module installers, `addPlayer`, `enqueueClientMessage`
and ordinary `step(world,50)`. It never assigns a clock, expected actor, cast, stock, field, RNG cursor or poststate.
The source's initial constructor, joins and first ordinary raid/birth step are captured before the declared bootstrap.
The map choices are one retained full rh-map/2 seed1 export, the retained bounded PvE constructor input, and an explicit
small floor room. This is no generated-map campaign. Seed1 retains all original layers, gates, regions and metadata.

Core installs weapons, targeting, projectiles, terrain effects, abilities and vision. Roster adds actual loot, mobs,
buffs, feed, camps, chests, mobLife, mobAI, card hooks and modifiers, while leaving faction signatures off deliberately.
`rosterSignatures` additionally installs the real factions module and captures all five full source NPC profiles.
Cards/signatures/training profiles are separately declared, with their complete ordered installer lists in `source.json.profiles`.
These are exact named constructor profiles, not a claim that an omitted room subsystem is active.
The source main stream uses declared mulberry32 seeds; reward/quest streams use declared SFC32 salts. Every actual draw
records stream, value, tick, time and phase in one ordered tape. Constructor/raid checkpoints record consumed offsets.
Ability casts themselves draw no additional random values; actual attacks and full producers retain their genuine draws.

The base profile explicitly sets Wish lock0 so focused cases can exercise genuine casts promptly. The separate45s lock
case executes every idle tick around its configured source45s boundary. All long recharge cases use ordinary ticks:
no `train`, timer assignment, fast-forward, cooldown replacement or shortened normal cooldown substitutes for recharge.
Training separately uses the real source training installer and its actual5s cooldown.

## Declared setup versus lifecycle

Every player position/HP/equipped weapon in `input.players` is named bootstrap applied after the recorded genuine raid start.
`place` actions, including between-step NPC placement and `brain.mode='return'`, are declared helper setup on existing actors.
They may reset that actor's rewind history/slip to the declared position. They do not claim movement or AI naturally produced it.
NPCs are first born through actual normal camp constructors/RNG. Their IDs, types, faction, maxHP, camp, home and home-facing
are never seeded or edited; lineage is asserted against the captured birth before every subsequent action.
`@m0`/`@m1` resolve indices in that genuine ordered birth list, never expected native actor IDs.
`status` uses actual `addStatus` with named inputs and is a helper setup for stun/silence/root/anti-heal eligibility.
It is not evidence of a normal producer for those helper-applied statuses.
Cards use actual `grantCard` as declared setup, not a fictitious chest selection or proof of its producer lifecycle.
Own Convicted Mark is different: it is genuinely earned from ordinary queued weapon attacks, with a bounded stop when the
source `markTierOn` reaches3; no Mark tier, stacks or faction clock is assigned.
Drop, reconnect, removal, real damage/death, raid start and teleport execute their real source lifecycle functions.
The final arena refund requirement is reused from the immutable earlier corpus as described below.

## Format and continuation

`rh-ability-source/1` cases carry independent `input`, constructor/join/birth/initial snapshots, ordered timeline and final state.
Snapshot `public` is raw legacy synced state; `private` is the server oracle, including full actor runtime, history, casts,
previous/current Wish clocks, card/faction/field state, current action ranks, ledger/landed entries and hook ordering.
Public actor string status, private status instances and public effect bits are separate facts.
Hook argument taps capture real zero-time pending casts and cancel-hook clocks before refund/clearing; no expected cast is inserted.
`cast.rank` is ability rank1. `private.actionRank` is the current tick's secret combat order; seed1 explicitly reverses
join/intake `p0,p1,p2` into due order `p1,p0,p2`. Full castLand/status/hook event order is retained.

A `span` declares its count and executes each50ms step. Full snapshots retain its first/last, declared boundary,
changed owned position/HP/effect/cast/status/stock/field/projectile state and every nonempty event tick.
`completeNonemptyEventTape` preserves every event in emission order, including between-step lifecycle emissions;
`completeOrdinaryHookTape` preserves every ordinary tick's nonempty hook trace. Idle World copies alone are omitted.
The coverage checks verify that no nonempty event is absent from the full frames and the executed step counts reconcile.
A native restore/continue consumer should derive initial state from constructor inputs and declared setup, then replay actions.
Expected snapshots are assertions only. Ordinary native checkpoints cover source-reachable completed-step or
administrative boundaries, including queued inputs, pending timed casts, stock, field and departed-owner states.
Zero-time cast-hook and due-batch observations test transient hooks and scratch; they do not introduce a mid-step
checkpoint API. Source clock jumps and expected-state seeding are never replay inputs.

Numbers remain source JavaScript numbers. Nonfinite values use `{"$float":"Infinity"}` / `-Infinity` / `NaN`;
undefined uses `{"$undefined":true}`. Consumers must distinguish these sentinels from normal JSON null.
Map/Set order is preserved as arrays; typed arrays become numeric arrays. Source-specific rounding and fractional helper probes stay intact.

## Observation and privacy

`legacyObserver` is produced by the actual `FxChannel` plus `perceive` with actual source vision, at the explicitly declared
observation actions. It is the observer witness. The rest of a frame is not an observation or client payload.
`rawSourceHelpers` and raw synced fields are separately labeled diagnostics; source remembered-trail actor helpers,
raw field IDs/owners, target points, previous clocks, delayed damage buckets, action ranks and RNG never authorize a native leak.
Retain existing native current-actor visibility, field-ID and per-contribution damage projection corrections.
Hidden versus absent target guesses use paired otherwise identical traces and produce equal actual perceive output and equal
caster private runtime after the guess. Syntactic enqueue result is separate from semantic ability refusal.
Only players can originate Wishes; a real source-born NPC queue is separately shown to produce none.

Departed Blaze source quirk is preserved: delayed hit attribution remains `p0`, resolved killedBy remains `name0`,
public death FX has `by:null` once the owner is absent, and no reward goes to an absent owner.
Last Stand captures all incoming pool damage including overkill, normal/teleport payback, anti-heal through common healing,
and removal/run-end no-pay. Trial captures own-versus-other-owner Mark, after-self-effect center and strict edge exit.

## Immutable arena and shared helper companions

`parity/arena/source.json` remains byte-for-byte SHA256
`6ff324e134127d9c84a4f4383965f11e08a108fbe306424b1547795265adf6f5`.
Its real `teleport-live-windup-status-refund` case is referenced and SHA-asserted, not copied, modified or recaptured here.
It supplies genuine pending Freeze plus Last Stand and actual teleport refund of both previous clocks.
The new cases add ordinary lifecycle teleports, grace/immunity edges, Last Stand payback and open/locked Blaze behavior.
The arena-owned native collision seam is `collision_view(locked)` with `current()`/`at(Variant)`; ability ring caching remains
native Wish work. This corpus defines source outputs, not a proposed native admission widening.

Helpers call unchanged executable source functions from declared inputs, never calculate expected Rust outputs:

- 9 `coliseumFallback`: n1/3/8, open with origin, open without origin, unreachable ring with one floor/spawn forcing spawn fallback.
- 28 blink probes on the declared ordinary room and retained seed1 gates, open/locked.
- 12 miniature ring/vertex probes, both active variants, including diagonal wall and clear-gate vertices. Miniature geometry is explicit helper input.
- 28 stock probes with fractional times and exact recharge boundaries;30 cooldown context probes and the actual five-Wish catalog.
- 31 planning ETA probes: declared0/Infinity plus actual `spawnWalks(seed1)`29 outputs passed to actual `walkSeconds`.
  Seed1 map/index is the input; derived distance/seconds are separate outputs. Arena expected distances are never used as inputs.

## Dependency and admission limits

Full NPC-signature, card and training witnesses are retained as separate prerequisite domains. They must not be flattened,
neutralized or silently skipped and then called full native ability success. Normal born five-faction recipients also have
separate signature-off profiles that an admitted generic NPC runtime can consume earlier.
The Gallows, Arcane Overload/Wishful Thinking, common healing and real own-Mark cases retain their source coupled behavior.
Their source execution does not prove native card/chest/training/full-signature producers exist.
No full quest-giver, player-owned pet/zombie, skill-equipment or whole-card-producer campaign is claimed by this bounded corpus.
Native restore validation, hashing, allocation measurements, mutation rejection, policy cadence, wire/client facts and parity
consumers remain implementation/review work. All five real source Wish outcomes are present; native/full ability success is not claimed.

## Complete closed case inventory

| Case | Profile | Actual50ms steps | Declared non-default domain |
| --- | --- | ---: | --- |
| `cast-parser-empty-slots-sequence-lag` | `core` | 9 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `normal-45s-lock-ready-boundary` | `core` | 907 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `all-five-normal-cooldowns-and-blaze-stocks` | `core` | 3610 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `cast-status-eligibility-stun` | `core` | 9 | named actual addStatus setup; genuine Cast input, not a normal status-producer claim |
| `cast-status-eligibility-silence` | `core` | 9 | named actual addStatus setup; genuine Cast input, not a normal status-producer claim |
| `cast-status-eligibility-root` | `core` | 9 | named actual addStatus setup; genuine Cast input, not a normal status-producer claim |
| `freeze-range-slack-482` | `core` | 9 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `freeze-range-slack-482.000001` | `core` | 9 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `freeze-wall-los-refusal` | `core` | 9 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `teleport-grace-and-immunity-boundaries` | `core` | 40 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `atomic-reciprocal-freezes-12` | `core` | 10 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `atomic-reciprocal-freezes-77` | `core` | 10 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `atomic-freeze-and-swarm-same-due` | `core` | 10 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `freeze-after-swarm-fizzles` | `core` | 11 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `freeze-moving-target-fizzle` | `core` | 10 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `freeze-interrupt-spends-without-refund` | `core` | 11 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `cast-cancels-directional-windup-keeps-walk-held-trigger` | `core` | 16 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `drop-reconnect-preserve-pending-cast` | `core` | 10 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `swarm-unknown-hidden-target-and-next-tick-reveal` | `core` | 18 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `swarm-drops-lock-and-chase` | `core` | 15 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `swarm-independent-walk-reveal-and-expiry` | `core` | 172 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `trial-inclusive-edge-then-ordinary-exit` | `core` | 68 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `trial-existing-zone-blaze-exit-same-phase` | `core` | 15 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `trial-centre-after-same-batch-self-blink` | `core` | 13 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `trial-departed-owner` | `core` | 12 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `trial-departed-subject` | `core` | 12 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `blaze-zero-time-order-swap-second-cast` | `core` | 6 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `blaze-through-connected-interior-wall` | `core` | 5 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `blaze-no-direction-and-sealed-pocket` | `core` | 5 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `blaze-open-coliseum-gate` | `core` | 6 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `blaze-locked-coliseum-gate-no-charge-spend` | `core` | 13 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `blaze-source-born-npc-return-and-credit` | `roster` | 10 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `freeze-trial-source-born-return-target` | `roster` | 42 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `blaze-trail-outlives-removed-owner-to-lethal` | `core` | 47 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `blaze-contact-tail-and-field-expiry` | `core` | 98 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `laststand-overkill-and-natural-payback` | `core` | 105 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `laststand-teleport-payback-without-cooldown-refund` | `core` | 9 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `laststand-run-end-does-not-pay` | `core` | 4 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `laststand-mia-does-not-pay` | `core` | 5 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `trial-gallows-card-exit` | `cards` | 90 | coupled card prerequisite: actual grantCard(gallowsPatience), no native admission claim |
| `arcane-overload-wishful-stock-trim` | `cards` | 12 | coupled card prerequisites: actual grantCard arcaneOverload+wishfulThinking |
| `trial-own-convicted-mark-from-real-weapon-hits` | `signatures` | 60 | coupled full faction/own-Mark prerequisite; bounded actual ordinary weapon hits, no seeded Mark tier |
| `trial-other-owner-convicted-is-not-own-mark` | `signatures` | 60 | coupled full faction/own-Mark prerequisite; another owner tier3 must not tighten this Trial |
| `training-swarm-real-five-second-recast-replacement` | `training` | 272 | training/dummy birth and short-cooldown prerequisite; every50ms still executed, no train or time jump |
| `atomic-landing-rank-reverses-join-and-intake` | `core` | 10 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `atomic-due-batch-fizzle-with-surviving-swarm` | `core` | 10 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `observer-hidden-absent-twin-p1` | `core` | 10 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `observer-hidden-absent-twin-absent-actor` | `core` | 10 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `pending-freeze-real-sword-death-paylater` | `core` | 9 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `pending-freeze-run-end-keeps-spending` | `core` | 4 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `swarm-drop-reconnect-and-owner-removal` | `core` | 13 | Named constructor/actor bootstrap; queued lifecycle/actions |
| `laststand-antiheal-common-healing` | `core` | 105 | named actual addStatus antiHeal setup; genuine LastStand and weapon hit/heal funnel |
| `blaze-source-born-fire-return-and-credit` | `roster` | 10 | actual normal camp constructors; FactionModeOff profile, full NPC signatures remain separate prerequisite |
| `blaze-source-born-plague-return-and-credit` | `roster` | 10 | actual normal camp constructors; FactionModeOff profile, full NPC signatures remain separate prerequisite |
| `blaze-source-born-frost-return-and-credit` | `roster` | 10 | actual normal camp constructors; FactionModeOff profile, full NPC signatures remain separate prerequisite |
| `blaze-source-born-sentenced-return-and-credit` | `roster` | 10 | actual normal camp constructors; FactionModeOff profile, full NPC signatures remain separate prerequisite |
| `full-signature-source-born-holy-wish-recipients` | `rosterSignatures` | 42 | actual full factions and source-born signatures; native NPC signature prerequisite, never flatten to FactionModeOff |
| `full-signature-source-born-fire-wish-recipients` | `rosterSignatures` | 42 | actual full factions and source-born signatures; native NPC signature prerequisite, never flatten to FactionModeOff |
| `full-signature-source-born-plague-wish-recipients` | `rosterSignatures` | 42 | actual full factions and source-born signatures; native NPC signature prerequisite, never flatten to FactionModeOff |
| `full-signature-source-born-frost-wish-recipients` | `rosterSignatures` | 42 | actual full factions and source-born signatures; native NPC signature prerequisite, never flatten to FactionModeOff |
| `full-signature-source-born-sentenced-wish-recipients` | `rosterSignatures` | 42 | actual full factions and source-born signatures; native NPC signature prerequisite, never flatten to FactionModeOff |
| `blaze-resets-slip-history-and-real-chaser-lock` | `core` | 9 | declared existing slip setup plus genuine target lock and Cast displacement |
| `source-born-npc-cannot-originate-wish` | `roster` | 6 | Named constructor/actor bootstrap; queued lifecycle/actions |
