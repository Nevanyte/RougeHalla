# Bot mob-hunt / build-route pure witness (P-BOTS-4)

These tools capture the actual TypeScript source's pure mob-hunt and build-route decisions for the Rust policy port:
`packages/server/src/bots/mobHunt.ts` (MOB_HUNT, mobWeapon/useless/bestEdge/bestSlotVsMob, retreatPoint),
`packages/server/src/bots/brain/huntAdapter.ts` (huntConfigFor, wantsMobs) and
`packages/server/src/bots/brain/buildRoute.ts` (BUILD_GOALS, buildOf, typeWeight, readyForElites, campValue and the
elite/route constants). The stateful MobHunter and BuildRoute planner are the documented remainder and are not captured.

Only the pinned official Linux amd64 Node 22.23.4 runtime is accepted (the image is pinned by digest in
`capture.sh`; the corpus records the Node/platform/arch and the hashed source closure). All inputs are declared
constants, weapon/faction/type strings, player/tier/persona configs, a declared 16x12 tile map and declared camp
records; expectations are the actual exported source functions' outputs (numbers at full precision; retreat points at
the capture's 1e-6 rounding). No expected value is computed from Rust and no entropy is read.

## Capture and check

```sh
tools/bot-mob-hunt-fixtures/capture.sh            # write parity/policy/bot-mob-hunt.json
tools/bot-mob-hunt-fixtures/capture.sh --check    # one canonical recapture/compare
```

`RH_MOB_HUNT_OUTPUT` selects another output directory. Capture and check each execute the harness once; the repository
is mounted read-only and `npm ci --ignore-scripts` uses the lockfile in a temporary node_modules mount.

Rust validation: `cargo test -p rh-policy --all-features --lib -- bots::mob_hunt_parity_tests` (5 tests: the config
table and its 12 tier/persona derivations, the weapon rules, retreat points, the no-mob-in-reach answer, and the
build goals/constants/pure rules).

## Mutants

```sh
CARGO=... tools/bot-mob-hunt-fixtures/run-mutants.sh
```

Four committed mutants each revert one landed rule: the elite share default, the wand-vs-bow useless rule, the elite
camp value, and the retreat search's distance order. Each must make the parity tests fail semantically; the unchanged
control must pass.
