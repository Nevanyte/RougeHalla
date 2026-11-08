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
The two old card-tier checker defects were separately demonstrated and are being repaired in a separate commit.
