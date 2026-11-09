# Owner-combat continuation evidence (OWNER_COMBAT_SOURCE_WITNESS bounded continuation)

Additive evidence for the five remaining owner-combat rows on the immutable frozen slice. This packet changes no production,
native, Unity, protocol, Cargo or shared status file. It does not recapture, copy over or edit the frozen original 32 files or
their three corpora.

- **Worktree**: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-owner-combat-continuation`
- **Branch**: `deepseek/owner-combat-continuation`
- **Immutable base**: `d061aacd61c2338d00dd51119cab4d2651f4a23d` (the frozen owner-combat slice)
- **Capture/code head**: `de142b00e270ceb92c24465f668f48912a8addd4` (this README and the forced-add logs are the evidence commit that follows)
- **Image**: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, `--platform linux/amd64`, repo/tool mounts read-only, `--tmpfs /repo/node_modules`, `npm ci --ignore-scripts --no-audit --no-fund`.

## Files and hashes

| file | bytes | sha256 | captureSha256 |
|---|---:|---|---|
| `parity/policy/owner-combat-continuation/producer.json` | 1,011,285 | `6edf61838c6ff65afae7878f929afb832896cb1a9f031b8d7273babdbe51d096` | `0d902c863171cd3181af86b1ba829a2b951d6e9a1af6112e5983ccb8ffe65046` |
| `parity/policy/owner-combat-continuation/human-projection.json` | 1,160,798 | `b21e041e4b043c945928955ff9548ee54e1528d682fbdd66fdf5dbff5eb5324d` | `aca29b59a3d9d34bb44676fbc17ccace31940fb6f2b26237b1f4f1ccf92313b3` |

The capture profile pins the internal static TypeScript/style import closure (**145 source files, 5 stylesheets**), the
manifests/lock/tsconfig hashes (the same values as the frozen slice: `package.json`
`9da8ab00…`, `package-lock.json` `991869bd…`, `tsconfig.base.json` `017575ec…`), the installed external versions
(`@colyseus/schema` 5.0.42, `tsx` 4.23.15, `typescript` 7.0.2), the declared map/profiles/setups, the frozen original
32-file hash map and the seven new tool hashes:

| tool | sha256 |
|---|---|
| `tools/owner-combat-continuation-fixtures/capture.mts` | `088487242b869b65fe8b73a0e81fe4372e8251f472e007388ba9d0b2b6ce412b` |
| `tools/owner-combat-continuation-fixtures/capture.sh` | `3e22531beaff9ffc0dcd761aaa884de09261cdbed6eaaef1ce8acefe38885ae8` |
| `tools/owner-combat-continuation-fixtures/client-stub-loader.mjs` | `c6d2c62875ecb9e172a5f232e00a690fa5e63f91e9a700ca9a2c4c707164ca48` |
| `tools/owner-combat-continuation-fixtures/compare.mjs` | `66516a2bcdb183aeb569aa425b60824ded1abac727cb1fb1f897856c53674acd` |
| `tools/owner-combat-continuation-fixtures/apply-patch.mjs` | `8db390d33925b9f93b63f98dd5e8a4a5fe43c1b7cc328fd408ac9298408cab10` |
| `tools/owner-combat-continuation-fixtures/run-mutants.sh` | `bcce6e97f33aa2f23a077cc1f060bfd97bacd2135945f5ecc78c2739c5390e5c` |
| `tools/owner-combat-continuation-fixtures/hash-of.mjs` | `811be269005bb619856a1857902fab708705c4a8fb2e0a59ffe357f6f36364fc` |

The frozen original corpora are recorded in `profile.base.frozenOriginal` and still hash to
`399758fd…` (producer, 2,483,560 bytes), `d5774fdb…` (human-projection, 2,970,805 bytes) and `6b040642…` (boundaries,
41,479 bytes), with their original `captureSha256` values. All 32 frozen original files match their base hashes; the
post-commit `git diff d061aacd..HEAD --name-only` contains no frozen path.

## Case matrix

| case | profile | frames | steps | result | provenance / label |
|---|---|---:|---|---|---|
| **L07** real target death under a nonempty lock | arena-weapon-only | 31 | 262–292 recorded | **PASS** | actual ordinary inputs |
| **L08** actual `removePlayer` | arena-weapon-only | 24 + 1 direct snapshot | 0–23 | **PASS** | ordinary inputs + **labelled direct-lifecycle API call** |
| **D02** bow draw vs legal swap | arena-weapon-only | 30 | 0–29 | **PASS** | actual ordinary inputs |
| **M04** `fleet3` speed card | training-console | 26 | 0–25 | **BLOCKED** | actual ordinary inputs; source refusal |
| **M05** training down/revival | training-console | 195 | 0–1003 recorded | **PASS** | actual ordinary inputs; real practice elite damage |

L08 is **not** an ordinary-reachability claim: `sim/step.ts removePlayer(world, 'tgt')` was called directly between completed
steps and is labelled in the corpus. Every other queued input went through `enqueueClientMessage`.

## Root-relevant findings

### L07 — a real target death under a nonempty canonical lock

The owner (fire) locks `tgt` (fire) with an ordinary target message at step 2 and holds a real wand; the lock's own trigger
fires real wand balls. The leading fight is unrecorded; the recorded window starts at step 262/t=13200 with the lock already
nonempty and the target at 54.969696969696685 hp.

- **Death**: step **281**, t=**14150**, target hp **0**, status **dead**, canonical owner `attackTarget` still **`"tgt"`**.
  The lethal `hitLanded` entry is owner wand: `raw=82.61818181818182`, `applied=68.84848484848486`, target hp after 0.
- **What killed it**: the owner's wand ball only. `killedBy` is `"OWN"`; `lastHit` is `{by:"own", at:14150}`; the death
  events are `projEnd`, `death` (by own), `hit` (by own), a `gv` grant to own and `resolved` for tgt with outcome `died`.
  No hp is written and no death is forged.
- **Lock clear**: step **282**, t=**14200** — one completed step after the death. The clear is the source's own
  `lockable` false -> `resumeAttackMove` -> `dropLock` path, and both the host and the decoded owner row read
  `attackTarget=""`. The target row is still present with status `dead` (resolved), so the lock clears because the target
  stopped standing, not because the row was deleted.
- **What survives**: exactly **one completed frame** with a nonempty lock after death (`lockAfterDeathBeforeClear=1`). No
  action and no projectile survive the death in this trace (`actionAfterDeath=[]`, `projectilesAfterDeath=[]`).

### L08 — actual `removePlayer` (direct lifecycle, labelled)

At step 8/t=450, between completed steps, the case calls the actual `packages/server/src/sim/step.ts removePlayer(world, "tgt")`.
Before the call the target is alive at 480,320 with 950 hp and the owner's canonical lock is `"tgt"`.

- **At the direct snapshot**: owner host and decoded `attackTarget` remain **`"tgt"`**; the target state row is deleted
  (`targetPresent=false`, `probes.target.present=false`); both host and decoded `perceive()` fighters are `["fou","thr"]`.
- **Actual removal events**: one `resolved` event for tgt with outcome **`mia`**, place 4, `killedBy=null`; the observer
  tap records `fighterOut` cause `down` then cause `removed` (both at 450 ms; status `mia`, down outcome `mia`).
- **Next completed step**: frame step 8/t=500 clears host and decoded `attackTarget` to `""`; the target row stays absent.
- **Human projection**: the retained `LockDisplay` still shows `tgt` optimistically from the note at 200 ms through step 11
  (t=650); it clears at step **12** (t=700), 500 ms after the note. This is the original optimistic lock UI, not a surviving
  canonical lock.

### D02 — real bow draw vs a legal ordinary swap

The owner picks a real bow into slot 0 and a real wand into slot 1. At step 4/t=300 an ordinary attack queues; the bow draw
starts at step 5/t=350 with `drawStartedAt=350`, `readyAt=1204.7008547008547`, action `{kind:"draw", weapon:"bow",
startedAt:350, landsAt:820.0854700854702, target:null}`.

At step 8/t=500 an ordinary swap to slot 1 is queued. Before the swap, `swapAllowed(hand,1,false)` is **true**
(`weapon0="bow"`, `weapon1="wand"`, slot 0). The swap lands:

- slot **0 -> 1**; `drawStartedAt` **350 -> 0**; action **null**; the bow's `landsAt` 820.085 is never reached and **no bow
  projectile is ever spawned** (`bowProjectiles=[]`); target hp stays 950 throughout.
- `readyAt` **1204.7008547008547 -> 1454.7008547008547** = `max(1204.7008547008547, 500) + SWAP_SECONDS*1000` (250).
- The draw was cancelled by `weaponChanged -> cancelAction`, not by the release queued afterwards (step 9). This case makes
  no draw-vs-swap overclaim.
- `DrawTrack`: shown true at step 7 (renderT 350 = start 350); at step 8/9 the decoded `drawStartedAt` is already 0 but the
  retained track still shows the draw because `renderT` (400/450) is before its patch end (500); it clears at step 10
  (renderT 500).

### M04 — the speed card is BLOCKED by the real training console

The ordinary `train {cmd:"card", id:"fleet3", count:1}` message is accepted by the queue at step 3, but
`sim/training.ts trainCard` returns at its first guard: `fleet3` is a **base** card (`kind:"base"`, title `Fleet III`,
text `+15% move speed (off while shooting)`) and `isInteractiveAugment("fleet3")` is **false**. The only admitted cards are
the 14 `INTERACTIVE_AUGMENT_IDS`: `slowBurn, overkill, tankEngine, pocketSand, gambler, thirdTimesTheCharm, eyeForAnEye,
bestOffense, plantYourFeet, wishfulThinking, hemorrhage, spikedShell, siphon, secondWind`.

The refusal is **silent**: there is no toast at the refusal, the build stays empty, and `asMult/windupMult/speedMult` stay
**1000** in every frame. The later ordinary `train clear` only emits `"Cleared: cards, practice mobs and chests"`; it cannot
clear a card that was never admitted. **Speed producer: BLOCKED.** No base card was direct-granted and no substitute speed
card was installed. None of the 14 admitted interactive augments writes the self `speedMult` mirror in this source, so there
is no admissible M04 producer path to record.

### M05 — real training down and `trainingSettle` revival

Through the real training console, `overkill` (one of the 14 interactive augments) is granted at step 2 with the real toast
`"Overkill: Damage beyond a kill splashes onto the nearest enemy within 200 u."`; the build is `overkill=1` and persists.
The practice elite `executioner` is spawned by an ordinary `train {cmd:"camp"}` at step 4; an ordinary target message locks
`moba` at step 6.

- **First down (step 494/t=24800)**: the elite's real damage kills the player. The exact `fighterOut` tap reads status
  `dead`, hp **0**, `killedBy "Executioner"`, `attackTarget ""` (downPlayer's `releaseTrigger` dropped the lock), draw
  `0`, readyAt **25652.52525252526**, build `overkill=1`, mobStats empty, mirrors 1000. The pre-down frame is step 493/t=24750
  at hp **9.975290697675916**, `attackTarget "moba"`, readyAt 25652.52525252526.
- **First revival (same completed step 494)**: `trainingSettle` sets status **alive**, hp **950/950**, readyAt **0**, draw
  **0**, attackTarget **""**, and keeps position 400,320, build `overkill=1`, mobStats empty and identity mirrors. There are
  94 real hits on the player in the trace.
- **Second down with a live bow draw**: after revival the player re-engages, swaps to the real bow at step 848; the first
  live draw frame is **step 877** (`drawStartedAt=43676.418…`), not the queued-attack step 849 in `facts.secondPhase`. The
  draw live at the second down begins at **step 992** (`drawStartedAt=49659.324009323995`). At step 993/t=49750 the
  pre-down frame has hp 9.975290697675916, `drawStartedAt=49659.324009323995`, readyAt 50514.02486402485, slot 1; step
  994/t=49800 is the down. The down tap reads draw **0** (cancelled by
  `downPlayer -> releaseTrigger`) and readyAt **50514.02486402485**; the revival frame 994 reads hp **950**, status
  **alive**, readyAt **0**, draw **0**, attackTarget **""**, build `overkill=1` and identity mirrors. `DrawTrack` shows the
  draw at step 994 and still at step 995 (render lag) even though the decoded `drawStartedAt` is already 0; it clears at
  step 996, not on the immediately next frame.
- **What persists vs resets**: the build/card, weapon slots and identity mirrors persist; position persists. `trainingSettle`
  resets down/resolved/killedBy/lastHit, path/history, status to alive, hp to maxHp, and `resetWeapons` (readyAt 0,
  drawStartedAt 0, attackTarget "", fresh weapon runtime). It does not clear build, mobStats or the mirrors. The lock and a
  pending draw are already cleared by `downPlayer` at the down, before `trainingSettle`; this is not labelled a simulation
  restore.

### Fourth-mirror (attack-speed) producer — auditable blocker

`packages/server/src/sim/mobLife.ts` `payMobKill` starts with `if (world.config.training) return;` (line 252) **before**
`creditMobKill` and **before** `grantMobStat(..., MOB_KILL_STACKS)` (line 265). `shared/mobStats.ts` gives `plagueRat` and
`frostbowSentry` a `stat attackSpeed v 0.01` row, and `MOB_KILL_STACKS=3`, so one credited ordinary kill would write +3%
attack speed. Ordinary training-camp kills return before that row is reached, so a training kill cannot change `mobStats` or
`asMult` (identity 1000). `train stat` is a direct console set and was forbidden and not used. No live training-kill case
is claimed as a producer.

**The checker's exact reachability condition:** the declared continuation profiles are **not** sufficient for the arena
route — `arena-weapon-only`/`arena-full-module` omit `mobs:true` (`world.ts:33`) and the declared `mapFromTiles` map has
`camps: []` (`shared/map.ts:455`), so only training practice mobs exist and `payMobKill` returns for training. A **new
additive profile** with `mobs:true` plus a generated or camp-bearing map would be required to reach a real non-elite
`plagueRat`/`frostbowSentry` kill and its +3% attackSpeed → `asMult` 1030; this slice did not add such a profile. Whether
that additive profile is allowed is a **root decision**; if it is not, the original windup-specific producer requirement
remains waived for this inadmissible-card/declaration scope. The four-producer/mirror requirement therefore remains **open**
and is not claimed.

## Semantic controls

Run from disposable `/tmp/repo` copies with the read-only `/repo` mount; every touched file is restored before each mutant.
`compare.mjs` excludes `/profile` only.

| mutant | result | first semantic mismatch |
|---|---|---|
| `01-clearlock-attacktarget-omit` | **KILL** | `producer.json /cases/0/frames/20/owner/attackTarget` `""` -> `"tgt"` |
| `02-weaponchanged-cancel-omit` | **KILL** | `producer.json /cases/2/frames/8/owner/drawStartedAt` `0` -> `350` |
| `03-trainingsettle-resetweapons-omit` | **KILL** | `producer.json /cases/4/frames/58/owner/readyAt` `0` -> `25652.52525252526` |
| `04-provenance-only-comment` | **SURVIVOR (required)** | every corpus semantically identical; the training.ts source hash changed from `1d433ef3…` to `70d4ce47…` and is excluded by `/profile` |
| restored control | **PASS** | the unmutated capture matches the checked-in corpora byte for byte |

This is **3 semantic kills + 1 provenance survivor**, not a four-producer packet. The fourth-mirror control is the bounded
source audit above, not a forced producer kill. Raw logs and output SHA256SUMS are in `mutants/` (force-added because the
repository ignores `*.log`).

## Commands and results

From the worktree root, pinned image:

```sh
bash tools/owner-combat-continuation-fixtures/capture.sh            # captured 2 corpora, then checked 2 corpora byte for byte
bash tools/owner-combat-continuation-fixtures/capture.sh --check    # pass 1: checked 2 corpora byte for byte
bash tools/owner-combat-continuation-fixtures/capture.sh --check    # pass 2: checked 2 corpora byte for byte
RH_OWNER_COMBAT_CONTINUATION_OUTPUT=<inside the worktree> \
  bash tools/owner-combat-continuation-fixtures/capture.sh           # external write recapture: identical bytes
bash tools/owner-combat-continuation-fixtures/run-mutants.sh        # 3 KILL + 1 SURVIVOR + RESTORED CONTROL PASS (exit 0)
```

The external recapture was written to
`parity/policy/owner-combat-continuation/.recapture` (inside the worktree), compared with `cmp`, found byte-identical, and
removed. Logs are in `logs/` (capture, check-1, check-2, recapture).

## Checker corrections (documentation; no corpus/outcome change)

The independent continuation checker returned PASS WITH DISCREPANCIES at `8e886ef1`; it reproduced all five rows,
scope/frozen base, corpora, `--check` twice, external recapture, mutants and labels. Corrections:
1. M05 second-phase narrative: the first live draw is step **877** (`drawStartedAt=43676.418…`), not step 849 (that is the
   queued-attack step); the draw live at the step-994 down begins at step **992** (`49659.324…`), not 849/993.
2. `DrawTrack` at the step-994 down is shown at 994 **and 995**, clearing at **996**, not on the immediately next frame.
3. The corpus `transitions` arrays repeat the frozen slice's object-identity defect (fresh objects compared, so every
   recorded frame is emitted); the new README failed to disclose it. Raw `frames`, `facts` and all mutant paths are
   unaffected; no outcome depends on transition indexes. This is a known evidence defect.
4. The fourth-mirror section above now states the checker's exact condition: declared profiles omit `mobs:true` and use a
   hand-built map with no camps; a new additive generated/camp-bearing map profile (or a root waiver) is required. No
   producer pass is claimed.

## Honest limits and remaining items

- Source and projection witness only: no native/Rust parity, no Unity/DOM/rendering/GPU, no socket/Room/join/reconnect, no
  protocol, public-field or eligibility admission.
- **L08 is a direct lifecycle call**, not ordinary client input; it must not be mixed into ordinary reachability claims.
- **M04 is BLOCKED**: the real console refuses `fleet3`; no speed mirror producer was forced or substituted.
- **Fourth mirror remains unreachable through allowed ordinary training input**: the `payMobKill` training guard is the
  blocker; only a non-training credited kill of `plagueRat`/`frostbowSentry` could write it, which this packet does not claim.
- M05's two downs are real elite damage in a real training world; the down tap is the exact `fighterOut` transition before
  `trainingSettle`, and the next completed frame is the revived state. It is not a schema resync labelled as simulation
  restore.
- Recorded frames cover declared windows; unrecorded steps are completed ordinary steps and are not omitted from the action
  log where they queue inputs.
- The client modules run inside Node with stub DOM/CSS/Phaser modules; the projection functions are the original exports but
  no real DOM, layout or Phaser work happens.
- No merges or pushes were made. The frozen original 32 files and three corpora remain byte-identical at
  `d061aacd61c2338d00dd51119cab4d2651f4a23d`.
