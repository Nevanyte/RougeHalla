# Owner-combat source evidence (OWNER_COMBAT_SOURCE_WITNESS)

Source-only capture of the legacy owner combat group (`attackTarget`, `drawStartedAt`, `readyAt`, `asMult`, `windupMult`,
`speedMult`), with the real server world, the real wire and the original human projection methods. This is evidence for the
root hidden-lock decision; it changes no production, schema, protocol, native, Unity, content or shared status file.

- **Base**: `a894574f8f46938cafef7f4103877be58c602905` (`deepseek/owner-combat-source`, immutable).
- **Capture**: `tools/owner-combat-fixtures/capture.mts` at the commit that carries these corpora; the exact tool hashes are
  inside every corpus's `profile.tool`.
- **Image**: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
  `--platform linux/amd64`, repo/tool mounts read-only, `--tmpfs /repo/node_modules`, `npm ci --ignore-scripts
  --no-audit --no-fund`, `node --import tsx --experimental-loader ./client-stub-loader.mjs`.

## Files and hashes

| file | bytes | sha256 |
|---|---|---|
| `parity/policy/owner-combat/producer.json` | 2,483,560 | `399758fd97403383c57c8e0395f9196d4d6ad23afa2ee57e7c5396bce6911ba2` |
| `parity/policy/owner-combat/human-projection.json` | 2,970,805 | `d5774fdbc6e058152d74330d204b02d0b328aa49d574caf8051944af14da4abf` |
| `parity/policy/owner-combat/boundaries.json` | 41,479 | `6b040642ad184405b9c924cb10821fb3d174a6a539b802d5d9597500ee427e60` |
| `producer.json` `profile.captureSha256` | | `549fc35f50d3c4d373e9b0f4c6e2e9f7b85672584b9e875affc42374f513a261` |

The capture profile pins the internal static TypeScript/style import closure (145 source files, 5 stylesheets), the
dependency lock and manifests (`package.json` `9da8ab00…`, `package-lock.json` `991869bd…`, `tsconfig.base.json`
`017575ec…`, three package tsconfigs), the installed external versions (`@colyseus/schema` 5.0.42, `tsx` 4.23.15,
`typescript` 7.0.2), and the seven tool files. External package contents are pinned by the lockfile and versions, and are
not claimed as a fully hashed external graph.

Commands run (all from the worktree root, pinned image):

```
bash tools/owner-combat-fixtures/capture.sh            # captured 3 corpora; checked 3 corpora byte for byte
bash tools/owner-combat-fixtures/capture.sh --check    # pass 1: checked 3 corpora byte for byte
bash tools/owner-combat-fixtures/capture.sh --check    # pass 2: checked 3 corpora byte for byte
RH_OWNER_COMBAT_OUTPUT=<inside the worktree> bash tools/owner-combat-fixtures/capture.sh   # external write recapture: identical bytes
bash tools/owner-combat-fixtures/run-mutants.sh        # 4 KILL + 2 SURVIVOR + RESTORED CONTROL PASS (exit 0)
```

## Setup (declared once, before the first recorded combat input)

- **Map** (hashed in the profile): `mapFromTiles(40, 20, tiles, seed 7)`, one wall tile around the edge, a vertical wall at
  tile column 17 rows 1-12 (its only doorway is rows 13-18, far below the actors), one declared `bush` `MapFeature` on tiles
  (10,4),(11,4),(10,5),(11,5) and open floor. `ARENA_MAP.tiles` and `featureGrid` SHA-256 are in `profile.declared.map`.
- **Profiles**: `arena-weapon-only` (four real seats, `minPlayers4`, lobby/fill/plan 0, patience 3600, sudden death 3600,
  `signatures:false` — which truthfully also removes every faction module), `arena-full-module` (the complete assembler
  order, `walkHints:false` only), `training-console` (real `config.training` + actual `installTraining`, one seat).
- **Seats/racks**: declared factions per case (L06 uses fire/plague/frost/holy so the target owns Swarm); weapons come from
  real ground racks through `sim/loot.ts dropWeapon` at tick 0 and an ordinary `pickup` message. Only D03/D04 declare an
  initial source clock (before `addPlayer`); every later clock is the actual fixed step.

## Case matrix

Twelve rows are recorded: **10 PASS + 2 BLOCKED** (M02/M03 are genuine source refusals). This is a coherent slice, not the
full packet; remaining required cases are listed below.

| case | profile | frames | result |
|---|---|---|---|
| L01 acquire/re-click/retarget | arena-weapon-only | 26 | **PASS**: lock at step 1 (`attackTarget="tgt"`); re-click at step 4 leaves the mirror and `readyAt` unchanged; retarget to `thr` at step 8 moves the mirror |
| L02 move clear | arena-weapon-only | 32 | **PASS**: the lock's own cast is pending at steps 5-13; the ordinary move at step 6 clears `attackTarget` to "" while the committed ranged cast survives (`action.target` kept, projectile lands at step 20); `readyAt` stays 1360.1010101010102 (not refunded) |
| L03 stop clear | arena-weapon-only | 32 | **PASS**: same acquisition; the ordinary stop at step 6 clears the mirror and the cast survives to step 13 |
| L04 lost direct LOS with trail entitlement | arena-weapon-only | 300 | **PASS**: owner pre-walks the doorway (arrive step 91, back step 180), locks at step 180, target walks round the wall (move at 182); first after-lock direct-LOS false at step 210 (t=10600; an earlier pre-lock false at step 63/t=3250 is unrelated), the source records `lockLosLostAt` at step 211 (t=10650), the grace timer runs 212-240 (50…1450 ms) and the canonical lock clears at step 241 (t=12150) — exactly **1500 ms** after `lockLosLostAt` (1550 ms after the first LOS-false completed step) |
| L05 lost entitlement (bush) | arena-weapon-only | 60 | **PASS**: the target walks into the declared bush; at step 23 (t=1250) `bushConceals` is true and `canPlayerSeeActor` is false while `attackTarget` is still "tgt"; the lock clears at step 24. One completed step of entitlement-lost lock |
| L06 hidden then reappears (Swarm) | arena-full-module | 198 (steps 897-1094) | **PASS**: Plague target waits its own natural `wishReadyAt` (idle ordinary steps), casts Swarm at step 899 (casting bit 4096); the cast lands at step 904 (hidden bit 256) and the canonical lock clears **in the same completed step**; hidden expires after 8000 ms (step 1064) and one fresh ordinary `target` message reacquires at step 1065 |
| D01 bow draw/release/ready | arena-weapon-only | 46 | **PASS**: draw starts step 5 (350 → cleared step 15 at launch); second draw starts step 23 (1204.7008547008547) and clears at step 32; release at step 33; `readyAt` 350 → 1204.7008547008547 → 2059.4017094017095 |
| D03 fractional clock 100000.25 | arena-weapon-only | 26 | **PASS**: host `drawStartedAt` 100350.25 / `readyAt` 101204.95085470086; schema owner 100350 / 101204; bot (host state) 100350 / 101204 |
| D04 near-u32 wrap 2^32-75.25 | arena-weapon-only | 26 | **PASS**: host `drawStartedAt` 4294967570.75 / `readyAt` 4294968425.450854; schema owner **274** / **1129** (wrapped); bot 274 / 1129; UI `DrawTrack`/cooldown see the wrapped values |
| M01 canonical identity mirrors | arena-weapon-only | 14 | **PASS**: two pickups, two swaps and one attack; `asMult/windupMult/speedMult` stay 1000 in the host, the wire and the decoded row (never filled in by hand) |
| M02 haste3 (proposed producer) | training-console | 28 | **BLOCKED**: the ordinary `train {cmd:'card',id:'haste3'}` message is accepted by the queue and **refused by `sim/training.ts trainCard`**; `trainCard` rejects base cards and accepts only the 14 `INTERACTIVE_AUGMENT_IDS`, so `haste3` (a base card) is refused. The build stays empty and `asMult` stays 1000 |
| M03 quickdraw (proposed producer) | training-console | 20 | **BLOCKED**: same refusal for `quickdraw`, which is not in `INTERACTIVE_AUGMENT_IDS`; `windupMult` never moves |

**Not attempted / REMAINING** (honest gaps, not silently skipped): L07 (target death), L08 (permanent departure/removal),
D02 (cancel vs swap), M04 (speed conditional/clear), M05 (training down/reset), and the training/status profiles' remaining
M cases. They were not reached in this context; no outcome is claimed for them.

## Root-critical answers (exact values from the corpora)

**Question**: is there any completed step with a canonical nonempty owner lock (`attackTarget`) while that target is NOT
disclosed by the owner's source perception / human projection?

- **Swarm-hidden target (L06): ZERO completed steps.** The hidden status lands in the abilities phase of step 904 and the
  canonical lock clears in the same step's targeting phase: at step 904 `attackTarget=""`, `effects=256`, `hidden=true`.
  No completed step has a nonempty lock on a hidden target. Reappearance: hidden expires after step 1064 and one ordinary
  `target` message reacquires at 1065.
- **Perception criterion: zero intervals in every recorded case** (`hiddenLock.byCriterion.perceptionDisclosure.intervalCount
  = 0`). The original `perceive()` on the live host state never fails to list the fighter a canonical lock names.
- **Source-entitlement criterion: exactly one interval.** L05 step 23 (t=1250): `canPlayerSeeActor(own,tgt)=false` (bush
  concealment) while `attackTarget="tgt"` — **1 completed step = 50 ms**, cleared at step 24. The human perception still
  lists that fighter because `perceive`'s `canSee` is `canPlayerSee` (trail/LOS), which does not apply `bushConceals`; so
  the bush-concealed fighter is disclosed by the projection but not entitled by the source's own targeting predicate.
- **Direct-LOS-only gap (not hidden)**: L04 records its first *after-lock* direct-LOS false at step 210 (t=10600); the
  source's `lockLosLostAt` is step 211 (t=10650); the canonical lock clears at step 241 (t=12150), i.e. **1500 ms after
  `lockLosLostAt`** and 1550 ms after the first LOS-false completed step, exactly at the source's
  `TARGET_LOS_GRACE_MS=1500` boundary. The target remains entitled by the owner's vision trail the whole time.
  (`caseFacts.firstDirectLosFalse` step 63/t=3250 is a pre-lock unrelated false; it must be qualified as such.)
- **Classification of every critical frame** is in the frame probes: `present/standing/hidden/untargetable/canSeePoint/
  entitled/directLos/bushConcealed/lockable` plus the lock runtime's `lockSeen/lockLosLostAt/lockLosLostMs`, and the
  owner's perception listing (`bot.fighters`). No global roster is granted.

## Schema, bot and human-projection classifications

- **PlayerState timers are `uint32` (index 15/16, default 0).** The host keeps the raw double; the wire truncates toward
  zero and wraps modulo 2^32; the original bot `u32 = v >>> 0` agrees with the wire on every declared probe. Full table in
  `boundaries.json` (0, 0.25, 1, 1.75, 2^32-1, 2^32-0.25, 2^32, 2^32+1.75, -1, -0.25, NaN, ±Infinity for both fields):
  0.25→0, 1.75→1, 4294967295.75→4294967295, 4294967296→0, 4294967297.75→1, -1→4294967295, -0.25→0, NaN/±Infinity→0.
  Non-finite values are typed strings in the corpus, never JSON null.
- **D03**: the fraction survives on the host (100350.25) and is truncated by the wire and the bot (100350). **D04**: the
  host keeps 4294967570.75 while the wire and the bot carry 274; the UI receives 274 as `drawStartedAt` and 1129 as
  `readyAt` and reports a positive draw with a 1 ms cooldown — a wrapped clock the client cannot distinguish from a fresh
  draw. Nothing was normalised.
- **Mirrors are f64 thousandths.** `encodeMirrors(identity)` = 1000/1000/1000/0/0/0/0. `encodeMult` clamps only to
  `MOD_MULT_MIN=0.05` (50 wire) and keeps huge finite values (1e300 → 1e303 wire); the legacy 20× ceiling
  (`MOD_MULT_MAX=20`) is not applied. Non-finite → identity 1000.
- **Human methods** (original exports, no hand-copied formulas): `LockDisplay` flips from optimistic to synced exactly at
  `OPTIMISTIC_LOCK_MS=500` (note at 1000: shown "tgt" at 1499, "" at 1500); `DrawTrack` shows the draw only once
  `renderT >= start` and clears at the patch that zeroes `drawStartedAt`; `nextCooldown/isExtension` reproduce the
  extension rule (prev 1000/ready 1500/patch 900 → extension, 1000 ms; patch 1200 → 300 ms); `statsOf` returns the nine
  identity cells and `ChampionCombatHud.update` returns its three real rows (e.g. "Wand hit · 82.62 / hit · 0.99/s",
  "Dragonslayer · 44.8 magic/s", "Blaze Step · 30 true DPS · 2s trail" for the untouched Fire owner).

## Semantic controls (`docs/evidence/owner-combat-source/mutants/`)

Run from disposable copies under `/tmp/repo` with read-only `/repo`; every file a patch touches is restored before each
mutant. `compare.mjs` excludes `/profile` only. Raw capture logs and output SHA256SUMS are kept per mutant; `run.log` is
the full run.

| mutant | result |
|---|---|
| `01-setlock-attacktarget-omit` | **KILL** `producer.json /cases/0/frames/1/owner/attackTarget` "tgt" → "" |
| `02-clearlock-attacktarget-omit` | **KILL** `producer.json /cases/1/frames/6/owner/attackTarget` "" → "tgt" |
| `03-perceive-u32-identity` | **KILL** `producer.json /cases/0/frames/5/bot/self/readyAt` 1360 → 1360.1010101010102 (a production-frame kill; the schema/botDecoded columns are unchanged) |
| `04-writemirrors-windupmult-omit` | **SURVIVOR** — every corpus semantically identical; the mutated source hash changed (provenance only). No reachable producer moves `windupMult`: the only windup card (`quickdraw`) is refused by the training console (M03), and granting it directly is forbidden |
| `05-nextcooldown-arithmetic` | **KILL** `human-projection.json /cases/0/frames/0/cooldown/nextCooldown` 250 → 251 |
| `06-provenance-only-comment` | **SURVIVOR (required)** — a comment changes only the file hash; all corpora identical |
| restored control | **PASS** — the unmutated capture matches the checked-in corpora byte for byte |

**Deviation from the proposal's suggested four.** Three of the four suggested *producer* categories are killed
(setLock, clearLock, perceive-u32). The fourth suggested category (`writeMirrors` windupMult) is **unreachable in this
source** through ordinary inputs, because `sim/training.ts trainCard` **rejects base cards and accepts only the 14
`INTERACTIVE_AUGMENT_IDS`** (M02/M03 record the refusals; `quickdraw` and the base `haste3` card are refused). The fourth kill therefore comes from the proposal's "optional
separate UI-nextCooldown mutant" category, killed in the human projection. The fact that `windupMult` has no reachable
producer is reported as evidence, not hidden.

## Checker corrections (documentation; no corpus/outcome change)

The independent checker's six findings are recorded here. None changes a raw frame, root-critical answer or mutant result;
the corpora are intentionally not recaptured for prose-only corrections.

1. **Fourth producer kill is absent.** Only three of the proposal's four *producer* categories are killed (setLock,
   clearLock, perceive-u32). The fourth suggested producer category (writeMirrors windupMult) has no reachable ordinary
   producer (`quickdraw` is refused; direct build writes are forbidden), so KILL 05 is the proposal's optional
   UI-nextCooldown helper kill, not a producer kill. The slice therefore **does not satisfy the proposed four-producer-kill
   requirement**; the windupMult unreachability is evidence, and a root waiver/decision is required rather than a helper
   substitution being counted as producer coverage.
2. **Transitions arrays.** The corpus `transitions` arrays were generated with object-identity comparison and therefore
   include every recorded frame rather than only real changes. Raw `frames`, the root-critical intervals and all mutant
   first-mismatch paths are unaffected; no outcome depends on the transitions indexes. Recorded as a known evidence defect.
3. **Perception-disclosure label.** The `perceptionDisclosure` criterion is computed on the host bot state
   (`frame.bot.fighters`), although its label/root-answer wording says "decoded client state". Host and decoded
   perception are both zero intervals in every case; the label is clarified here.
4. **L04 firstDirectLosFalse.** `caseFacts.firstDirectLosFalse` step 63/t=3250 is a pre-lock unrelated LOS-false; the
   evidence text now qualifies the after-lock loss as step 210/t=10600 and the clean `lockLosLostAt` boundary as step
   211/t=10650, with clear at step 241/t=12150 (1500 ms after `lockLosLostAt`).
5. **D01 release semantics.** The queued release at step 33 occurs after the second draw launched at step 32; it ends the
   held attack rather than cancelling a draw. The README does not claim a draw-cancel.
6. **Case count.** Twelve recorded rows are 10 PASS + 2 BLOCKED (M02/M03), not 12 PASS.

## Honest limits

- Source and projection witness only: no native/Rust parity, no Unity/DOM/rendering/GPU claim, no socket/Room/join/reconnect,
  no protocol, public-field or eligibility admission.
- The client modules run in Node with stub DOM/CSS/Phaser modules; the projection functions are the original exports, but no
  real DOM, layout or Phaser work happens.
- Per-frame schema recording is a full `encodeAll` at the first frame plus the real per-step patch decoded into one retained
  client state; it is not a delta-stream benchmark.
- L06's 45 s Wish lock is waited out with idle ordinary steps that are not recorded as frames (they span no transition); the
  recorded window is steps 897-1094.
- The L04 grace path is route-dependent: this declared route reaches the 1500 ms boundary; other routes may regain line of
  sight first and never fire it.
- Training-profile card producers (M02/M03) are refused by the source; no direct build write was used to force them.
