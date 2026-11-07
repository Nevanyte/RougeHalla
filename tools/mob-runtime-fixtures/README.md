# Mob lifecycle source witness (P-MOBS-1)

Canonical actual-source capture for the regional mob lifecycle: the ordered `mobKilled`/`campCleared` hook producer
calls with their arguments, the camp-clear reward state (GV, feed, per-type mob stat stacks), the single camp-clear
ground weapon award, and the 180 s full-roster respawn boundary driven through ordinary fixed 20 Hz steps.

The corpus is `parity/mobs/runtime-lifecycle.json`; the native comparison is
`crates/rh-sim/src/systems/mob_life/mob_lifecycle_tests.rs`. The capture runs in the pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
linux/amd64 image (the same immutable image as the other fixture tools):

```sh
bash tools/mob-runtime-fixtures/capture.sh            # capture to a temporary directory
bash tools/mob-runtime-fixtures/capture.sh --check    # compare the checked-in corpus byte for byte
```

`RH_MOB_LIFECYCLE_OUTPUT` points the capture at another directory; `--check` reads
`<dir>/runtime-lifecycle.json`. The recorder asserts the exact Node version, platform and architecture, replays the
scenario twice and requires byte-identical output, and hashes the complete `packages/server/src/sim` +
`packages/shared/src` TypeScript closure into the corpus provenance.

## Profile and boundary

The profile installs the unchanged source modules `loot, weapons, targeting, projectiles, mobs, buffs, feed, camps,
chests, mobLife, mobAI, abilities, vision, cardHooks, mods` with `signatures: false` (no faction layer), one declared
24×24 map (`declared-map-input.json`, copied from the `tools/pve-dot` declared map input) and one declared fixed-step
scenario: two wand players locking the camp's first alive normal mob (then the elite) from (`80,112`) and (`176,80`).

The harness adds only **passive observers** of `world.hooks.mobKilled` / `world.hooks.campCleared`: each calls the
installed chain first and then records the ordered call with its arguments. They change no gameplay state, draw nothing,
and never feed expected values back into the source. These observers are the source witness for the producer call sites
the port fires; their consumers are Pending in other packets, so the corpus is not a claim that the chests
(P-CARDS-2), camp-heal/regen (P-MOBS-2) or quest (P-QUEST-1) consumers exist:

- the training dummy constructor and its reset (`mobs.spawnTraining` / `mobs.resetDummies`, P-ARENA-2 / P-MOBS-1's
  blocked dummy item) are not installed, so no dummy exists;
- the camp heal/ward and passive regen producers (P-MOBS-2) are not installed;
- only ground weapon containers are compared: the elite augment chest is a reward container owned by P-MOBS-2/P-CARDS-2.

## What the corpus witnesses

- `mobKilled` fires at tick 53 and 79 for the two normal mobs and at tick 345 for the elite `wyrmling`, each with the
  credited killer, mob type, zone, 0-based camp, elite flag and death position.
- `campCleared` fires at tick 345 **before** that same pass's elite `mobKilled` (the source pays the camp clear before
  the kill's spoils), for the camp's 0-based index.
- The camp's `alive`/state/clearedAt/respawnAt transition at tick 345; the killer keeps GV/feed and the normal kills'
  `flameCaller` ×3 stacks, the elite grants no stat stack; exactly one ground weapon (`axe`) drops for the clear.
- The trace records every ordinary tick from 2 through `respawnTick + 2`: `respawnAt = clearedAt + 180000 ms` and the
  full three-mob roster returns at tick 3945 with fresh ids, homes and repath phases, while the camp clock ran from the
  clear with the players still on the map.

Recapture only with the pinned container: the corpus is immutable expected output, never regenerated from Rust.
