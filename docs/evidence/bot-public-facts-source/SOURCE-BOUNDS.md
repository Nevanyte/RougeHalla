# Source retention, population and order

All references below describe the unchanged legacy source at `a3d4b3ce575442c9a06916888035ca849a6cd05a`. These are source inspections and bounded witnesses, not a maximum-population test or a proof about all legal match histories.

## Retention is not a producer bound

| Source | Constant | Scope |
| --- | --- | --- |
| `packages/server/src/bots/brain/frames.ts:24-26,93-107,222-228` | `MAX_FRAMES=128`, `MAX_QUEUED=4096` | Retained frame count and undelivered world/immediate event queues. Neither bounds the flight map or total producer emissions. |
| `packages/server/src/bots/brain/frames.ts:36,346-350` | `DONE_MAX=256` | Finished-projectile ID deduplication retention. |
| `packages/server/src/bots/brain/tactics/kite.ts:171,208-214` | `REMEMBER=48` | Reflex decision memory. |
| `packages/client/src/ui/minimap.ts:40,206-226` | `MAX_DOTS=280` | Human display-dot buffer cap. This does not cap source actors or historical IDs. |

Source projectile launch inserts a fresh room ID into a Map (`sim/projectiles.ts:50-64`, `sim/world.ts:1088-1092`); end handling deletes it (`projectiles.ts:67-80`). Insertion alone supplies no universal population cap. FxChannel retains insertion order and an append-only roster (`rooms/FxChannel.ts:23-50,57-70`). `addMob` similarly establishes no insertion cap (`sim/mobs.ts:34-54`). Regional camp respawn creates fresh IDs each 180-second cycle (`sim/mobLife.ts:91-124`, `sim/camps.ts:78-84`), so live count and cumulative IDs are distinct. This packet does not prove an unbounded legitimate match duration.

The generated map assumptions, five zones with ten camps each and three to five regional spots, give at most 250 initial regional actors for that map construction (`shared/constants.ts:48-53`, `sim/mobLife.ts:78-89`). Seats, mode-specific actors, overrides and historical IDs need separate accounting. The training ever-spawn value 150 is mode-specific (`shared/training.ts:23-27`), not a global cap.

A conditional projectile estimate would require bounded attackers, emissions per interval, maximum flight lifetime, minimum emission interval and any reflection multiplier. Base catalog Bow speed/range are 900/520 and Wand 380/640 (`shared/weapons.ts:103,108`): with range multiplier 1 their derived base flight times are about 577.78 ms and 1684.21 ms. These are catalogue calculations, not universal lifetimes. Range modifiers are passed by weapons and applied during launch (`sim/weapons.ts:316-320`, `sim/projectiles.ts:106-112`); a universal maximum is not proved here. Source reflection is limited to two (`shared/constants.ts:375-378`, `sim/projectiles.ts:302-326`), which alone cannot close the other bounds. No new transport count or byte budget follows.

## Identity and order are observable

FrameRing flight iteration preserves Map order (`brain/frames.ts:320-343`). Reflex dodge/juke paths can return the first successful candidate and consume RNG (`brain/tactics/kite.ts:226-252,257-283,306-321`). Actor lists sort by string ID (`bots/brain/perception.ts:616,637-638`); launcher ties use strict less-than and keep the first candidate (`brain/frames.ts:402-416`). Flight/done/decided/incomingSeen structures key by identity. The recorded equal-cue MobHunter reversal is an actual order-sensitive consumer example.

An opaque rename must therefore preserve supported identity relationships and relevant source order, or supply explicit equivalence evidence. The recorded single-entity alpha witness does not justify arbitrary permutation invariance, new ordering, ID reuse or a changed deduplication lifetime. A single first-percept rebase sample cannot close these history requirements.

## Human producer consistency

`packages/client/src/scenes/RaidScene.ts:639-642` reads decoded mob state before the render gate. At `763-770` it passes current rendered positions through current vision into the minimap. `packages/client/src/ui/minimap.ts:206-226` replaces the dot data; `373-405` schedules visual repaint at 33 ms with live actors/player and otherwise 100 ms. The bot's separate refresh path (`packages/server/src/bots/brain/perception.ts:618-640`) and disappearance belief (`brain/memory.ts:561-590`) do not establish the same human display history.

The declared wall snapshots are unsupported for World/intended-behavior admission. A living actor's omission must not silently become authoritative death, and a diagnostic result is not proof of a source bug. For windups, human `RaidScene.ts:1323-1342` and `render/FxView.ts:286-304` cancel on weapon changes; the bot's delayed retained event is not a claim about the human visual lifetime.

## Gates held for Root

1. Admit only producer-consistent, legitimately perceivable NPC identity/lifetime facts, with actual living/fog/death/replacement histories where required.
2. Resolve supported projectile/cue disclosure and lifecycle boundaries without passing hidden original launch facts merely because the raw legacy carrier contains them.
3. Prove any candidate rebase over history, ordering, identity/deduplication, expiry and RNG branches, using source-supported inputs rather than guessed physical limits.
4. Establish applicable per-mode actor, emission, live-flight and historical-identity bounds before choosing a transport cap or split budget.

No native implementation, ADR approval or owner question is produced by this inspection. R-PROC source diagnostics cannot silently redefine the intended behavior required by R-GAME-6 or the privacy requirement in R-ML-4/C-OBS.
