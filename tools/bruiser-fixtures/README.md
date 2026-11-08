# Frozen Justice source witness (P-FACTION-5)

Canonical actual-source capture for Frost's Frozen Justice (`sim/bruiserPassives.ts`): the elite-lock reach and line of
sight, the private contact clock and synced guard flag, the standard-mirror defense bonus it folds, and every reset
(hit/block contact both directions, death, run end, camp-cleared link) driven through declared fixed-step operations.

The corpus is `parity/bruiser/frozen-justice.json`; the native comparison is
`crates/rh-sim/src/systems/bruiser/tests.rs`. The capture runs in the pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
linux/amd64 image (the same immutable image as the other fixture tools):

```sh
bash tools/bruiser-fixtures/capture.sh            # capture to a temporary directory
bash tools/bruiser-fixtures/capture.sh --check    # compare the checked-in corpus byte for byte
```

`RH_BRUISER_FIXTURE_OUTPUT` points the capture at another directory. The recorder asserts the exact Node version,
platform and architecture, replays every case twice and requires byte-identical output, and hashes the complete
`packages/server/src/sim` + `packages/shared/src` TypeScript closure into the corpus provenance. The declared map input is
byte-identical to the admitted Rust map fixture (`crates/rh-sim/tests/fixtures/mob-pve-map.json`, sha256
`5ee388ca...`).

## Profile and boundary

The profile installs the unchanged source modules `loot, weapons, targeting, projectiles, mobs, buffs, feed, camps,
chests, mobLife, mobAI, abilities, vision, cardHooks, factions, bruiserPassives, mods` with the declared 24x24 map from the
`tools/pve-dot` declared input and two declared players (a Frost seat with a wand and a Holy seat). Every case rebuilds the
world and applies only its declared operations: trusted placements, the source exports `recordHit`+`applyLedger`,
`downPlayer`, and the source-installed `blocked`/`runEnded`/`campCleared` chains. The harness adds no observers and never
reads expected values back into the source.

The boundary is declared, not implied: the camp-heal/regen producers (P-MOBS-2), the training constructors
(P-ARENA-2/P-MOBS-1), quests (P-QUEST-1) and the other pending consumer modules are not installed, so this corpus is not a
full-default claim.

## What the corpus witnesses

- `idle_no_contact`: no contact, no guard.
- `locked_elite_guard`: a Frost wand lock on the live elite at reach sets the guard (armor/shield 116 -> 141) and the lock
  survives; the guard follows the lock, not an attack.
- `hit_contact_linger`: a landed hit from the Frost seat on the elite sets the 2 s window; walking away keeps the guard
  for exactly `FROST_ELITE_GUARD_LINGER_MS` and it drops on the boundary tick (tick 40 true, tick 41 false).
- `normal_mob_hit_no_guard` / `holy_hit_elite_no_guard`: normal camp mobs and non-Frost seats never arm it.
- `blocked_contact_guard`: a block involving the real elite sets the window through the installed `blocked` chain.
- `death_clears_guard` / `run_end_clears_guard`: a down and a run end clear the guard and the mirror bonus at once.
- `camp_cleared_link`: the installed `campCleared` link runs, then the window expires on its own boundary.
Every frame records real public state: each player's weapon lock, `frostEliteGuard` and `defenseOf()` armor/shield.

Recapture only with the pinned container: the corpus is immutable expected output, never regenerated from Rust.
