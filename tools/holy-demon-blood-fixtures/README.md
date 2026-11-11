# Holy Demon Blood source witness (P-HOLY-DEMON-BLOOD-1)

Canonical actual-source capture of Holy's camp lifesteal: `holyCampLifestealOf(c.s.campClears)` (0.005 per eligible camp
clear, `packages/shared/src/championPassives.ts:6-9`, `packages/shared/src/constants.ts:81`) added to the earned farm rows
of the per-tick lifesteal (`packages/server/src/sim/factions.ts:895-896`), which `lifestealTotal`
(`packages/shared/src/mods.ts:380-382`) adds outside `LS_CAP` and `LIFESTEAL_MAX` and multiplies by `lifestealMult`.

The corpus is `parity/holy-demon-blood/source.json`; the native comparison is
`crates/rh-sim/src/systems/holy_demon_blood_tests.rs`. The capture runs in the pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292` linux/amd64 image
(the image of the other fixture tools; on an arm64 Mac Docker runs it emulated, and the recorder asserts linux/x64 and
Node v22.23.4):

```sh
bash tools/holy-demon-blood-fixtures/capture.sh            # capture to a temporary directory
RH_HOLY_DEMON_BLOOD_OUTPUT=parity/holy-demon-blood bash tools/holy-demon-blood-fixtures/capture.sh   # write the corpus
bash tools/holy-demon-blood-fixtures/capture.sh --check    # compare the checked-in corpus byte for byte
```

The script creates the git-ignored `node_modules/` mountpoint the read-only repository mount needs. The recorder replays
every case twice and requires identical output, and hashes the `packages/server/src/sim` + `packages/shared/src` closure
into the provenance. The declared map is byte-identical to `crates/rh-sim/tests/fixtures/mob-pve-map.json` (sha256
`5ee388ca...`), the map of `tools/bruiser-fixtures`.

## Profile and boundary

Installers, in `gameplay.ts` MODULES order: `loot, weapons, targeting, projectiles, factions, mobs, buffs, feed, camps,
chests, mobLife, mobAI, abilities, vision, campHeal, cardHooks, bruiserPassives, mods`. Players: `p0` Holy at (80,112),
`p1` Frost at (176,80), both fists. The map has one three-member camp (`mob1` elite, `mob2`, `mob3`). Operations: the
source exports `deferHit` (the entry opens the next tick's ledger), `grantCard` and `step`, plus trusted placements of a
player's hp, a mob's hp and `PlayerRuntime.campsCleared`. Regen, consumables, quests, traders, kill augments, terrain and
the Plague/Fire/Sentenced extras are not installed; training practice camps are not exercised.

## Cases (each: frames after every operation; player hp, private `campsCleared`, public `campClears`; camp mob hp/status)

- `holy_zero_clears`: Holy at 500 hp lands 50 on `mob2`: own share only.
- `holy_one_clear`, `holy_twenty_clears`: +0.25 and +5 hp on the same hit (0.005 and 0.1 of 50).
- `holy_sixty_clears_past_lifesteal_max`: Holy at 60 hp (own share at its 0.6 ceiling) with 60 clears heals 0.9 of the
  damage, past `LIFESTEAL_MAX` 0.85.
- `frost_twenty_clears_control`: a Frost with 20 clears heals nothing.
- `holy_bloodthirst_zero_clears`, `holy_bloodthirst_twenty_clears`: Leech + Bloodthirst below half health; the camp term
  is doubled (+10 hp on 50 damage).
- `holy_real_clear_same_tick`: three lethal deferred hits clear the camp in one pass; campHeal counts p0 (0 -> 1), the
  campCleared chain syncs the mirror, and that tick's lifesteal already includes the new clear.

Recapture only with the pinned container: the corpus is immutable expected output, never regenerated from Rust.
