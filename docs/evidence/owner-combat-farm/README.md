# Owner-combat farm mirror: adjective ordinary kill source evidence

Packet: additive generated/camp-bearing source map with `config.mobs: true`, nontraining, complete canonical
`createGameWorld` module order. This captures ONE actual ordinary credited player kill of a real catalog nonelite
**Plague Rat** (`plagueRat`, swarm role) that awards +3 attackSpeed, producing the actual owner `asMult` mirror
`1000 -> 1030` through `grantMobStat -> recomputeMods -> writeMirrors`.

## Base / branch / head

- Base commit: `dbd70f9d810330099b754281b70d511a60f62cf8` (current public main at packet start)
- Branch: `deepseek/owner-combat-farm` (isolated worktree; no merge/push)
- Head at capture: `dbd70f9d810330099b754281b70d511a60f62cf8` with only the three new packet paths present
  (`git status --porcelain` showed only `?? docs/evidence/owner-combat-farm/`, `?? parity/policy/owner-combat-farm/`,
  `?? tools/owner-combat-farm-fixtures/`). The audited packet commit is
  `488d3677d31917740434d5960e1dc61d1f50751f`; the docs-only checker-correction commit on top is the final branch head
  (`git log -1`, reported to Lead). The corpus itself does not embed a self-referential head.

## Actual capture

| field | actual value |
|---|---|
| map source | `packages/shared/src/mapgen.ts generateMap(seed)` |
| seed / attempt | `20261101` / `0` |
| map hash / tiles SHA-256 | `3435915058` / `91cd5e5dcf0ffb95f64cc8f636c5d1a4112038c2c9c6930442787a129300ae10` |
| camp | index `20`, id `plague-1`, zone `plague`, eliteSpot `-1`, 5 spots |
| target slot / mob id | `0` / `mob36` |
| target type / role / elite | `plagueRat` (Plague Rat) / `swarm` / `false` |
| target weapon / hp | `bow` / `314.15999999999997` |
| target home / owner placement | `(2736,3568)` / `(2436,3568)`, 300 units, clear line of sight |
| owner faction | `plague` (owner only; two idle allies kept alive: `ally1` frost, `ally2` holy) |
| config | `mobs:true`, `quests:false`, nontraining, `pvpRules:true`, `hazards:true`, `regen:true`, plan 0, patience 3600 |
| RNG labels | `random: mulberry32(8)` (orderSalt `671282643`), `rewardSalt [1,2,3,4]`, `questSalt [5,6,7,8]` |
| loadout | real `sim/loot.ts dropWeapon` ground container `c12` (wand) at the owner's start, ordinary `pickup` at step 1 |
| target order | ordinary `target {id:"mob36"}` at step 4; every attack is the source's own wand trigger |

The camp's `plagueRat` roster is the actual `rewardStream(rewardSalt) -> rollCampTypes` output; the mob's stats, spawn,
movement, damage, death, farm grant, build and mirrors are source output, not setup. No direct write to mob stats/HP/death,
farm gain, build, mirrors, RNG or outcome occurs. Declared SETUP is limited to the map seed, config, seat ids/factions
(includes the map-derived ally placements recorded in `setup.seats`), the recorded RNG setup (`setup.rng`:
mulberry32(8) and the reward/quest salts),
owner/ally start positions and the rack/loadout.

## Corpora and hashes

- `parity/policy/owner-combat-farm/source.json`: 1,250,830 bytes, SHA-256
  `9cbb71b162a6bf36b5b4445cd4ca4bb5ab5e3c6559279467153e9ee9d7a62228`; profile `captureSha256`
  `e15c3bc4bfaad9850a0d9cfe72e4de757742d18c1bf089c6b382394bab4725c3` (covers the JSON including the profile, excluding
  only itself). Canonical form: `JSON.stringify(corpus) + "\n"`.
- 135 completed-step frames; 126-file TypeScript source closure (`sourceClosureSha256`
  `97f1b6d8081e77c55b68737e680cd2f91fad34e73979c04d1d99f1d0e5c37bb8`); tool inventory SHA-256
  `42117b1fff3cf51620b7964e41438aa2cd80e7092e8d0876b1b681d6dc30302e`; manifests inventory SHA-256
  `9fb914d40dc719123ccb98c2f0a0b27f5cd8cf2c43da348c787fcccfba778585`.
- Pinned image `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
  `linux/amd64`, Node `v22.23.4`, repo/tool mounts read-only, empty `/repo/node_modules` tmpfs, `npm ci --ignore-scripts
  --no-audit --no-fund`, `node --import tsx`.
- Lock/package hashes: `package-lock.json` `991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481`,
  `package.json` `9da8ab00050db3ec14c083365ab0c3a5b8986e38fd13c086b2913249d531422c`, `Cargo.lock`
  `2496c636db1e569779671d6826fae146d52ef823983d49adfed1c5c162cfa9fb`; external `@colyseus/schema` 5.0.42,
  `tsx` 4.23.15, `typescript` 7.0.2.
- Tool hashes (also recorded in the corpus): `capture.mts` `fd8c2bfd2c8c15a5612a27b1081c86f431d76c4f98cda54dd96aa40d65a59cf4`,
  `capture.sh` `0828dfeba75608e14b6db93029aff98ba484b11e65f27e159c27a11f01556f4a`, `verify.mjs`
  `dca46ed9786ea07b775a09d2315105ca3e9a67648eb096e36e16974c1ac322d3`, `apply-patch.mjs`
  `eb4fc92a659ee9cf3580896a80d0a1b824dc44ffc50d2bda12fe6f8e17e47225`, `run-mutants.sh`
  `99375d8928970f50a4777634d8abdd642d94df41cdf39722c16842b8435820da`, `hash-of.mjs`
  `edb0967ec022e61e87be75c6587769283b0a712fb0c7d4217f47744b881fa9ee`.
- Raw logs: `logs/capture-write.log`, `logs/check-1.log`, `logs/check-2.log`, `logs/external-write.log`,
  `logs/external-sha.txt`, `logs/verify-full.log`, `logs/run-mutants.log`.

## Initial / pre-kill / kill / post-kill frames

All frames are completed source steps (fixed 50 ms). Mirrors below are the host wire values; decoded mirrors are exactly
`decodeMult(wire) = wire / 1000` (so `asMult` decodes `1`, then `1.03`).

| frame | step | serverTime | owner attackTarget | asMult | windupMult | speedMult | owner mobStats | target |
|---|---|---|---|---|---|---|---|---|
| initial 0 | 1 | 100 | `""` | 1000 | 1000 | 1000 | `{}` | alive 314.16 |
| pre-kill 103 | 104 | 5250 | `mob36` | 1000 | 1000 | 1000 | `{}` | alive `1.2313904974938321` |
| kill 104 | 105 | 5300 | `mob36` | **1030** | 1000 | 1000 | **`{plagueRat:3}`** | dead 0 |
| post-kill 114 | 115 | 5800 | `""` | 1030 | 1000 | 1000 | `{plagueRat:3}` | dead 0 |
| last 134 | 135 | 6800 | `""` | 1030 | 1000 | 1000 | `{plagueRat:3}` | corpse reaped |

Transitions: `asMult` has exactly one transition (`frameIndex 104, step 105, 1000 -> 1030`); `windupMult` and
`speedMult` have none; `mobStats[plagueRat]` has exactly one (`0 -> 3`); `attackTarget` sets at step 4 and clears at
step 106 after the target dies.

## Actual producer and schema/perceive evidence

Kill step 105 at serverTime 5300: the kill pass's **first** owner wand hit (`applied:2.3502824858757068`) removed
the target's remaining `1.2313904974938321` hp; the recorded `hitLanded` with `applied:7.287056304148811`,
`sig:"disease"` is the same pass's second/signature share, not a single lethal blow. The source emitted the `fx death`
with `by:"own"`, the `mobKilled` hook reported `{type:"plagueRat", zone:"plague", camp:20, elite:false,
at:(2736,3568)}` with killer `own`, and `payMobKill -> grantMobStat` paid the real `gv` 6 mob event and the actual
toast `Plague Rat: +3 kill stacks · +3% attack speed total`. All of the killing damage is owner-sourced; the plague
signature's disease share is part of the same owner pass.

- Retained client: the first recorded frame is a real `@colyseus/schema` `encodeAll` (30,245 bytes, SHA-256
  `8c7ebdb733fa6288baa58ea5f3b7664bb772b2425bdad866004b693bbfc54bc1`), then every completed step is the real per-step
  patch decoded into one retained `RaidState`. The kill patch is 144 bytes, SHA-256
  `06ca5655b6e6c6f3811f9a5726058bdde418c8a373f8a697275e5c529414b67d`; the post-kill frame 114 patch is 15 bytes,
  SHA-256 `47feac553241e4289e88850e97c9908f725bfb0e65161f1634c5c0d9349698b7`.
- Fresh full-group snapshot encode/decode at the kill: 376 bytes, SHA-256
  `af86f5a1b372f0645e2ff990e0aab0c221c18184959a2a53c4768ca913087fe7`, decoded `asMult 1030` /
  `windupMult 1000` / `speedMult 1000`.
- The original `perceive` on both the live host state and the decoded client state at the kill:
  `self.asMult 1.03`, `self.windupMult 1`, `self.speedMult 1`, `self.mobStats {plagueRat:3}`, `self.mobKills 1`,
  `self.gv 6`, `self.attackTarget "mob36"`. The post frame already has `attackTarget null` and the same farm values.
- The retained decoded owner mirrors equal the host mirrors on every recorded frame (mirror fields and the integer lock
  fields); `readyAt` is a uint32 on the wire, so the host fractional value decodes truncated (D22 quantization), and both
  values are recorded per frame. The full-group decoded `asMult` equals the host mirror on every frame.
- Camp after the kill: `alive 4`, `state 1` (engaged), `type plagueRat`, no clear. At the kill the map has 194
  total mobs, 193 alive (the target is dead); every other mob is still alive. The run stays `active` and all three seats
  are alive at the last frame.

## Reproducibility checks

- `bash tools/owner-combat-farm-fixtures/capture.sh` wrote the checked-in corpus and its own byte check passed:
  `checked source.json byte for byte sha256=9cbb71b1...`.
- The pinned `--check` ran twice, both exact:
  `logs/check-1.log` and `logs/check-2.log` each report `sha256=9cbb71b162a6bf36b5b4445cd4ca4bb5ab5e3c6559279467153e9ee9d7a62228`.
- Genuine external write reproduction: `RH_OWNER_COMBAT_FARM_OUTPUT=<worktree>/.farm-external-out capture.sh` wrote a
  separate output mount and `cmp` reported `EXTERNAL_WRITE_BYTE_IDENTICAL`; both files have the same SHA-256
  (`logs/external-sha.txt`). The temporary output was removed.
- Full consumer in the pinned image: `verify.mjs --repo /repo --corpus /baseline/source.json` passed all 126 source
  hashes, all tool hashes, all manifest/lock hashes and every semantic check (`logs/verify-full.log`).

## Semantic mutant and restored control

All mutations ran in a fresh disposable `/tmp/repo` copy inside the pinned container; the read-only host source was never
patched. Raw logs and output SHA-256 records are in `mutants/`.

| mutant | result | first mismatch / result |
|---|---|---|
| `01-writemirrors-asmirror-omit` | **KILL** | `FIRST_MISMATCH frames[104].owner.asMult expected=1030 actual=1000 (kill step 105)`; mutated `packages/server/src/sim/mods.ts` hash `f9a3528187e3d5b052097a6ef63baff50edd3c12914faaa675c6ac2ccc3a1508` vs baseline `93db949f7b217b93942efdeca66caef29096d94881c5dd28bcf0eaf8287d323b` |
| `02-provenance-only-comment` | **SURVIVOR** | producer consumer passed; compare identical excluding `/profile`; a provenance-only change is not a semantic kill |
| restored unmutated control | **PASS** | `capture.mts --check /baseline --repo /repo` byte-identical (`sha256=9cbb71b1...`) |

The semantic mutant removes exactly the owner `s.asMult = m.asMult` assignment in `writeMirrors`; the real producer
consumer (which computes the expected wire from the actual recorded `mobStats` through the actual shared
`mobStatRows -> foldRows -> mirrorsFromFold -> encodeMirrors`) fails on the actual recorded frame. Identity, rounding,
provenance and hash failures were not used as this proof.

## Boundaries and limits

- Source and owner-projection proof only: no native/Rust parity, no Unity/DOM/rendering/GPU, no socket/Room/join/reconnect,
  no protocol/public-field admission. Root owns native consumption and public admission.
- One kill on one generated map seed/attempt; this is not a whole-map, workspace, previous-owner or quest campaign.
- Declared SETUP: map seed, config, seat ids/factions (including map-derived ally placements in `setup.seats`), RNG
  setup (`setup.rng`: mulberry32(8) and reward/quest salts), owner/ally start positions, and the ground rack/loadout.
  NOT setup:
  NPC stats/roster/spawn/movement/damage, the target's death, farm gain, build, mirrors and every RNG outcome.
- The retained client decode is the real full encodeAll at the first recorded step plus real per-step patches into one
  retained state; it is not a delta-stream benchmark. `readyAt` is wire-quantized uint32; the corpus records both values.
- The optional second real move-speed farm case was not attempted; the required attack-speed case is complete.
- Blocker: none. The exact ordinary producer was reachable and produced the required actual `asMult` 1000 -> 1030.
