# Sentenced resistance restore repair

Private candidate based on `80a4e130a661eae9e9e52420288e0af05f1649ca` (G6 + player Frost resistance).
Only `systems/sentenced.rs::validate` changes production behavior; no gameplay, source expected outputs, serialized
fields, format/content/observation/protocol versions or hash tapes change.

## Reproduction and repair

Real player-only Full-faction duel: Sentenced and Frost, default hp, swords, no mobs/training, real `cards::grant`
Iron Will, then ordinary `validate` + budgeted `Sim::submit` Target/Attack. No chill/Mark output is installed.
At tick15 the prior chill is `0.8079999999999999`, hits2/progress`2.237623762376238`/tier1. The original restore fails
`Malformed("invalid Sentenced state for player 1")`; the new `real_iron_will_mark_restores` regression passes and
restore/continue compares events and state hashes over12 more steps. The initial compiled red log is retained separately
as `../repro-clean.log` in this task's private artifact directory (its hash is in checks.json).

The old two-increment lattice (1 or1/(1-FROST_SLOW)) is invalid. Source `factions.ts::markStep` accumulates prior cached
chill, not today's stats. `mods.ts::resistSlow` and the admitted Frost corpus already capture the arithmetic. The shipped
native SlowResist row is unique IronWill0.4; farm, chest boosts, kill augments and trader facts introduce no other
SlowResist row. The folded read is clamped[0,1]. Frost's real bonus-shield/haste formula independently deepens chill down
to `1-FROST_SLOW-modifiers::DEFINITION.frost_cap`. A grant/refold does not rewrite cached chill or accumulated Mark.

Restore therefore checks finite nonnegative progress, exact zero progress for zero hits, and a per-hit history envelope
from1 through1/max(MARK_CHILL_FLOOR,1-FROST_SLOW-frost_cap), retaining the conservative binary64 accumulation tolerance.
It cannot prove an exact omitted per-hit history. It neither invents history nor changes the Mark producer. Counter,
tier, target, enablement, sentence and private clock/denial checks remain. There is no new NPC admission.

Five new tests cover the genuine resisted hit, a mid-Mark IronWill grant with stale prior chill/mixed history, real
haste-deepened Frost beyond the old maximum, later source-stat changes, and malformed progress/counter/tier/target/time/
denial/nonfinite controls. Existing source Mark matrices and Frost resistance witnesses remain unchanged.

## Focused proof

The first repair gate passed21 Sentenced tests,11 Frost tests,6 checkpoint tests,21 content tests and6 replay tests
(65 total, none ignored). Formatting passed. Strict lint modes will be recorded with the complete follow-up tier repair;
they are not claimed in this first commit. The unchanged content golden is356457e6ccfb22cd, checkpoint25/replay19.
The two old card-tier checker defects were separately demonstrated; their separate follow-up proof is below.

## Completed card-tier follow-up

A second separate repair follows resistance commit `e6f9680a37bb4e085796860cbc0b5772cbdc6ed2`.
The original checker also refuses real Swift Judgment (tick16, hits2/progress2.4705882352941178/swaps0/tier2) and
No Commutation (tick18, same progress/hits, swaps1/tier3 after a validated victim Swap). A compiled red run against
that unchanged tier checker fails all five new tier regressions, including both ordinary producers. Copies of the
original red logs are `progress-red.txt` and `tiers-red.txt`; final receipt hashes/commands are in tier-checks.json.

The actual promotion in `before_damage` and source `factions.ts::promote/swapSteps` raises tier only. Let T(P,S) be the
existing capped tier formula from progress P and swap steps S. The repaired validator uses:

| State | Lowest legal tier | Highest legal tier |
| --- | --- | --- |
| Ordinary world, no tier flags | T(P,swaps) | Same (exact) |
| Ordinary world, owned tier flags | T(P,swaps) | T(P,swaps*(NoCommutation?2:1)+(SwiftJudgment?floor(hits/2):0)) |
| Training, whose Clear can remove flags | T(P,swaps) | T(P,2*swaps+floor(hits/2)) |

Current flags cannot retroactively promote a cached tier immediately after grant/refold; the next mark pass promotes it.
Training Clear can remove both flags but leaves the Mark intact, so a former flagged tier can persist. Per-hit/card grant
chronology is not stored: these are validation bounds, not invented history or exact historic reconstruction. No counters
means exact tier0 even with both flags; flags alone cannot justify a tier. Other counter/enablement/target/time/denial
checks remain. There is no gameplay, serialized state or identity change.

The five additional tests cover each real card producer, both real grants after an existing mark (before and after the
next promotion pass), actual training Clear, and rejection of tiers outside the history bounds/unsafe counters/unearned
tiers without hits or swaps. Every positive restore compares subsequent events and state hashes over12 steps.
The training test also sends real validated Train Card count0 messages: the current console refuses NoCommutation and
SwiftJudgment because neither is in the INTERACTIVE set (Swift is also Conditional); it successfully removes an admitted
SlowBurn card, preserving the Mark; then Clear actually removes the tier flags. No supported input/gate was widened and
no removal outcome was installed. Source `training.ts::trainClear` likewise clears the build without resetting Mark.

Final focused proof runs26 Sentenced tests (including10 new),11 Frost tests,6 checkpoint,21 content and6 replay tests:
70 passed, none failed or ignored. Both strict rh-sim all-target Clippy modes and workspace formatting pass. The last
training-control addition reruns the affected Sentenced tests, both lint modes and formatting; unchanged Frost/checkpoint/
content/replay gates are not repeated. All builds use the task-private target, pinned env, jobs2 and debug0.

## Explicit next mechanic, outside these repairs

Source `factions.ts::markStep` reads `markRateOf(c.s)/chill`; the current native producer still adds1/chill. Source
`mods.ts::markRateOf` is max(0,1+sum), and the ready unique GatheringStorm card contributes+0.5. This is a missing gameplay
port requiring its own source/native parity and actual content registration, assigned separately by the lead. The present
progress bound describes CURRENT native behavior, not full MarkRate parity, and must be revisited with that implementation.
No source expected bytes, gameplay producer, content definition, hash tape, checkpoint/replay format, public protocol,
observation, policy or client code is modified here. Full NPC and other held feature gates remain held.
