# `parity/heal-barrier-callers` — pinned real-caller G6 corpus

`runtime.json` — `rh-heal-barrier-callers-source/1`, 3 cases, 45,245 B, SHA256
`5a5a0462fc56f23dcb5f65f44e7b13c934e6c80b89a285787b264bacd458c393`, captured by
`tools/heal-barrier-callers/capture.mts` in the pinned linux/amd64 Node 22.23.4 container from the unmodified source.
Provenance records the image, Node version, the capture tool hashes (`capture.mts`
`52fc282e6b198988442a07f4bd4af1f22a75d849f4b552bc9c7decd0c67a6f5f`, `capture.sh`
`668518906191cbcf48ca00663cb4ee082f4ef89a463054ad28a52fc6bed3d386`), the dependency lock (`package-lock.json`
`991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481`) and the SHA256 of every imported
`packages/shared/src` + `packages/server/src/sim` file (127 files; digest
`e6efe7f3048659701a589433d1690651e8a43d28aa2610bedad744cc3705e1a1`).

The profile is part of the corpus: `player-only-no-mobs/full-player-faction/signatures-true` with the actual
`config`/`modules` objects (mobs false, signatures true, quests/training/dummies false). Cases:
`lifesteal-before-slot` (real cards + real validated attack; same-tick post-ledger decay of the lifesteal barrier),
`potion-after-slot` (real installed potion command; no decay on its grant tick, one decay next tick) and
`antiheal-scaled-heal` (real generic anti-heal status application scales both hp gain and barrier; labelled trusted
setup). Frames carry player public facts, the private boost timer and the step's real hit/heal amounts.

Native consumer: `crates/rh-sim/src/systems/buffs/caller_tests.rs`, which binds the profile explicitly (SimConfig with
`mob_mode: Off`, `FactionMode::EngagementHoly`, quests off) and asserts the resulting gates/signing profile and the
empty mob store before replaying. `bash tools/heal-barrier-callers/capture.sh --check` requires identical bytes;
`bash tools/heal-barrier-callers/run-mutants.sh` requires actual-output mutant kills (3/3). The original ten-case
`parity/heal-barrier/runtime.json` is untouched.
