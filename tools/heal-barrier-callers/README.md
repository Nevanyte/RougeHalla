# `tools/heal-barrier-callers` — real G6 heal-caller witness (P-G6-CALLER-REPAIR)

Pinned actual-source capture of the G6 barrier's REAL callers in a genuine **player-only / no-mobs full-player faction**
world: `createGameWorld` with `config.mobs: false`, `modules.signatures: true`, `modules.walkHints: false`, no quests,
no training, no dummies, and two Holy players. The recorded profile is bound explicitly by the native consumer (it is
not inferred from a constant config field): `input.profile`,
`player-only-no-mobs/full-player-faction/signatures-true`, plus `input.config` and `input.modules`.

Cases (`parity/heal-barrier-callers/runtime.json`, 3 cases, 45,245 B, SHA256
`5a5a0462fc56f23dcb5f65f44e7b13c934e6c80b89a285787b264bacd458c393`):

- `lifesteal-before-slot` — real `leech1` + `secondSkin` grants (real `grantCard`), a recorded declared wound through the
  real `applyDamage` producer, then a real sword attack through the ordinary input queue. The factions `afterDamage`
  lifesteal heal happens BEFORE `buffs.expireBoosts`, so the new barrier loses one tick in its grant tick: source hit
  36.137967 on p1, heal 13.089361 on p0, barrier 1.064308 = 0.3*13.089361 - 2.8625 (one 5%-maxHp/s tick).
- `potion-after-slot` — the actually installed consumables system with the real `useConsumable` command (a declared
  `setPotion` trusted setup gives the potion): the Hot heal grants barrier AFTER the buffs slot, so the grant tick holds
  8.5875 = 0.3*28.625 with no decay, and the next tick 5.725 = 8.5875 - 2.8625.
- `antiheal-scaled-heal` — a labelled trusted setup through the real generic `addStatus` API (`antiHeal` value 0.5,
  6000 ms; no ordinary shipped producer in this world), then the same real potion command: heal 14.3125 = 0.5*28.625 and
  barrier 4.29375 = 0.3*14.3125 on the grant tick, next tick 1.43125.

Each frame records the public player facts (faction/position/hp/maxHp/barrier/status/weapon/slot/potion), the private
`boost` timer, and the step's real `hit`/`heal` fx amounts. The source keeps no expected post-hit values: the frames are
the source's own outputs.

Commands: `bash tools/heal-barrier-callers/capture.sh` (write) and `--check` (byte-identical, pinned linux/amd64
`node:22.23.4-bookworm-slim@sha256:aaa4b5…`; 127 source files digest
`e6efe7f3048659701a589433d1690651e8a43d28aa2610bedad744cc3705e1a1`; capture tool hashes in the corpus provenance:
`capture.mts` `52fc282e6b198988442a07f4bd4af1f22a75d849f4b552bc9c7decd0c67a6f5f`, `capture.sh`
`668518906191cbcf48ca00663cb4ee082f4ef89a463054ad28a52fc6bed3d386`, `package-lock.json`
`991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481`). `bash tools/heal-barrier-callers/run-mutants.sh`
applies the committed semantic mutants and requires ACTUAL caller-consumer output mismatches with restore controls:
`01-lifesteal-grant-missing` (the real lifesteal caller no longer grants a barrier), `02-antiheal-scaling-missing` (the
barrier uses the pre-anti-heal amount while hp is scaled) and `03-wrong-slot-timing` (the buffs system moves after the
consumables system, flipping the potion case's grant-tick decay). 3/3 killed; unchanged control passes.
