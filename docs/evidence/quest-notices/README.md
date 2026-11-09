# Quest notice source continuation — six bounded event producers

Source-only mechanical fixture for the quest notice producers, in the isolated worktree
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-quest-notice-source`, branch
`deepseek/quest-notice-source`.

- **Base:** `dbd70f9d810330099b754281b70d511a60f62cf8` (current public main when the packet started).
- **Source candidate head:** `21bf7944` (tools + corpus + raw control logs; this README is the following evidence commit).
- **Evidence commit / final head:** the commit that adds this README (reported to the Lead; run `git rev-parse HEAD`).
- **Status:** all six planned producers PASS. No BLOCKED or UNREACHABLE branch. This is **not** a native notice
  implementation: GPT/the root owns native source messages, `Some(owner)/None(room)` recipients, completion farm notice,
  closure aggregation, wire/public activation and composition.
- **Scope confirmation:** only new paths were added: `tools/quest-notice-fixtures/**`,
  `parity/quest-notices/source.json`, `docs/evidence/quest-notices/**`. No existing source, tool, corpus, evidence,
  native, header, content, tape, status, Cargo.lock, client or cloud path was edited. Worktree/read-only mounts only;
  no merge or push.

## Artifacts and hashes

| artifact | bytes | sha256 |
|---|---:|---|
| `parity/quest-notices/source.json` | 1,154,229 (`wc -c`; the capture log prints UTF-16 string length 1,154,217) | `a20d751e88cb16765cf2aa3ef856765a0d3321d8e25eb6e41c6722cdf9a99244` |

- Format: `rh-quest-notices-source/1`; canonical serialization: `JSON.stringify(body, null, 1) + "\n"`.
- `profile.captureSha256` (over the body with the field absent): `c066a4d976396a095c9e45162448ee89382921a7b77f6e0763d7bf912e018daa`.
- Source closure: 127 `.ts` files under `packages/shared/src` and `packages/server/src/sim`, per-file sha256, sorted
  inventory in `profile.sourceSha256`.
- Tool closure: 12 files under `tools/quest-notice-fixtures`, per-file sha256 in `profile.tools.files`.
- Locks/config: `package-lock.json` `991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481`;
  `package.json` `9da8ab00050db3ec14c083365ab0c3a5b8986e38fd13c086b2913249d531422c`;
  `tsconfig.base.json` `017575ec3101f44df43b5a7cc850779582650d9e01a2090b7e311b213b98ef88`;
  `packages/shared/tsconfig.json` `e81b194f96f35e0d1e9e8069998a30740b08703e085bb7d0f92922d7b6d06193`;
  `packages/server/tsconfig.json` `38a209200ba0dde3bbaeee8df1e29755aa35b63c588367da486b31a83b90cd15`.
- Source anchors: 26 exact `file:line + text` bindings in `profile.sourceAnchors` (pickup guard/before-accept/carry
  limit/existing carrier, stolen/dropped text, completion notices, `announceExpired`/`closeAll`, teleport/run-end hooks,
  publication/reveal/discovery, `closeImpossible` and the real publication/close call sites, `teleportToColiseum`,
  `endRun` hooks, `step` event clearing and `killMob`). No anchor issue was recorded.

### Tool hashes

| tool | sha256 |
|---|---|
| `capture.mts` | `be18d392260ebcd331d8a5982ae770a8f167b99bda702c5a7e839206b0a6cc52` |
| `capture.sh` | `3849a175a0ae65031184f3fc417517d0aafb49a1ced6ae33e7adfbae40d75c7a` |
| `verify.mjs` | `851cd4eda612537af1051524fce3654489bdf4350d0d14b140fbb0b9f580128b` |
| `compare.mjs` | `6bdb48c8896504feb314ac6d2af058d482be742c6e317022d58120bbd08230f7` |
| `apply-patch.mjs` | `2c60284a7b7691ef52b6c3f9a564f0bf199ccec830650a04b40cf33139d9cd8f` |
| `run-controls.sh` | `189968e93f96a980595cb4247f7ef940d275dbb38ee08e6c62fd1fd076dfa2fe` |
| `mutants/01-wrong-recipient.patch` | `c9fa5e5e8a252ce4287b4d1b63e3a6c961749681ba2de3e14f84e6cd1494396f` |
| `mutants/02-missing-stolen-text.patch` | `351d18174a7ad9c35f19b43830134af4a013e602f286cb9bd1713c6dc14bebd8` |
| `mutants/03-run-end-loud.patch` | `ea2d76a40c6c0d1a37c74ed07b68d6d2e33224988e036db38c81458dc33fdc35` |
| `mutants/04-per-quest-spam.patch` | `c449cd57c134aef3684abdbb7f6e73b74bad956bb136a1c6c2b810a5f5b1ffd1` |
| `mutants/05-provenance-only.patch` | `b7efd90668981cca193c899fb0062798e84edcfaaa2abb5d33f9c9f7eddeccd1` |
| `mutants/expected.txt` | `c680d53992e0c3ae9fd7d6a96b79f4ca84b5edde17f52a087e28a4dbcb5001fa` |

## Method / declared inputs

- Pinned `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
  `--platform linux/amd64`, Node `v22.23.4` asserted in the tool. Repository and capture tool are mounted read-only;
  `node_modules` is a writable tmpfs seeded by `npm ci --ignore-scripts --no-audit --no-fund`. Output is mounted writable
  for write and read-only for `--check`.
- Real unmodified source path: `createGameWorld` (production module order), `addPlayer`, ordinary real `step(w, 50)`.
  Map `generateMap(1, attempt 0, {decor:false})`, world random `mulberry32(12)`, reward salt `[1,2,3,4]`, three declared
  human seats (holy/fire/plague names `name0/1/2`). Quests and mobs on; signatures, training, dummies and planning off.
- All notice/event streams are the actual `step()` return or the actual producer queue, recorded with tick/time,
  recipient (typed seat id or `null` room), type and full payload. The recorder captures **every** event type
  (`raidStarted`, `toast`, `questReveal`, `gv`, `resolved`, `fx`, `raidEnded`), not only strings starting “Quest”.
  Events emitted by a declared inline producer call are recorded at the producer point and labelled
  `via:"inline-producer"`; step events are `via:"step"`.
- Declared setup (trusted, never an installed outcome): initial map/seats, positions, HP and loadouts; the case-2 direct
  runtime guard writes; the case-3/case-6 `expireSoon` deadline nudge; the case-6 finder HP 1000. No expected
  acceptance, progress, carrier, reward, ledger, death, toast or closure is installed.
- Actor aliases are trusted fixture bindings only. Each case records the alias, source actor id, name, faction, human seat
  label, birth position/HP/loadout, and the explicit note “alias is a trusted fixture binding only; it is not ownership or
  capability”. Role labels in `script.bindings` are descriptive only; they are not ownership or capability.
- `questReveal` payloads are recorded in full where the source emits them (the finder-private preview); public state in
  the snapshots remains the source's published-only `RaidState.quests` view, and `unknownQuests` is retained.

## Case matrix

| case | producer(s) actually exercised | method/setup label | result |
|---|---|---|---|
| `parcel-feedback` | real accept/pickup input path, real sword death + `dropBody` parcel drop, real steal pickup, automatic Fetch turn-in | ordinary actions; only weapon/HP/position are declared setup | **PASS** |
| `pickup-closed-guard` | `onQuestPickup` stale/closed guard and existing-carrier guard against a real produced box | **NONCANONICAL** direct runtime status/carrier writes while the box is retained; ordinary retirement removes the box | **PASS** |
| `expiry-cohort-order` | `questSystem` timed expiry, hidden discovery, automatic turn-in in one step | real collect path; declared `expireSoon` 50 ms for ORDER only (not natural duration; giver8 remains the actual 300 s witness) | **PASS** |
| `teleport-close-notices` | exported `teleportToColiseum` producer + its `teleported` quest hook | direct producer invocation between steps; real queue read immediately before the next step clears it; labelled as the settle-owned producer | **PASS** |
| `run-end-silent-close` | real final-rival sword kills, `settle`/`endRun`, `runEnded` hook | ordinary combat; weapon/HP/position declared setup only | **PASS** |
| `camp-and-publication-closure` | inline whole-region `killMob` producer/recheck; real publication + immediate impossible close | **inline producer calls** (not ordinary player swings); `expireSoon` order-only; finder HP 1000 declared setup | **PASS** |

## Exact ordered events and recipients

Notation: `t=<tick> (<ms>ms)`; `to=pN` is the typed private human seat; `to=null` is the room/public notice.
The corpus stores the complete event objects (including `fx` payloads, `gv` amounts and `resolved` results); the lists
below give every notice/reveal and collapse only long `fx` runs, with their exact counts.

### 1. parcel-feedback (22 events)

- `t=1 (50)` `raidStarted`.
- `t=2 (100)` `to=p0` `Accept The Reliquary at Abbot Gavril first` — before-accept pickup refusal; real box remains.
- `t=2 (100)` `questReveal to=p0` id `quest84` def `cull-frost` at `(1712,48)`, `expiresAt=0`; then `to=p0`
  `Quest discovered: Thaw the Watch (Warden Sigur)` — incidental real discovery retained.
- `t=3 (150)` `to=p0` `Quest accepted: The Reliquary`.
- `t=4 (200)` `to=p2` `Quest accepted: The Reliquary` (accepted stealer).
- `t=5 (250)` `to=p0` `Picked up: The Reliquary — carry it to Abbot Gavril` (first parcel; not stolen).
- `t=6 (300)` `to=p0` `Quest accepted: The Frozen Standard` (second known Fetch).
- `t=7 (350)` `to=p0` `you can carry one quest item` — second-parcel carry-limit refusal; box `c7q` remains.
- `t=8 (400)` `fx` windup/swing; `fx` death `p0` by `p1`; `to=null`
  `name0 dropped parcel: The Reliquary`; `fx` hit; `gv p1 +10 kill`; `resolved p0 died place 3`.
- `t=10 (500)` `to=null` `name2 stole parcel: The Reliquary`; then `to=p2`
  `Picked up: The Reliquary — carry it to Abbot Gavril`. **Order: dropped (t8) → room stolen (t10) → private picked (t10).**
- `t=11 (550)` `gv p2 +10 quest`; `to=p2` `Acolyte: +10 kill stacks · +2.5% lifesteal total` (farm stat);
  `to=p2` `Quest complete: The Reliquary`; `to=null` `name2 completed quest: The Reliquary`.
  **Order: GV → farm stat → private complete → room complete.**

### 2. pickup-closed-guard (5 events; guard fixture, noncanonical)

- `t=1 (50)` `raidStarted`.
- `t=2 (100)` `to=p0` `That quest is over` — the private shared Over from the stale/closed guard; the real box and item
  UID are unchanged (no consumption). Incidental `questReveal to=p0` `cull-frost` + private discovery follow in the
  same step as real source behavior.
- `t=3 (150)` `to=p0` `Quest accepted: The Reliquary` — the declared guard restoration + real accept that sets up the
  sibling.
- Sibling step `t=4 (200)`: **no events** (the existing-carrier guard is silent); the real box and item UID remain.

### 3. expiry-cohort-order (16 events)

- `t=1 (50)` `raidStarted`.
- `t=2 (100)` `to=p0` `Quest accepted: Shards of the Watch`.
- `t=3 (150)` `to=p0` `Shards of the Watch: 1/3`; incidental `questReveal to=p0` `cull-fire` + private discovery.
- `t=4 (200)` `to=p0` `Shards of the Watch: 2/3`.
- `t=5 (250)` `to=p0` `Shards of the Watch: 3/3`.
- `t=6 (300)` one step contains, in order: `questReveal to=p1` `long-haul` → `to=p1`
  `Quest discovered: The Long Haul (Freight Captain Mora)` → `questReveal to=p1` `tithe-rim` (incidental, retained) →
  `to=p1` `Quest discovered: Offerings at the Edge (Pilgrim Saoirse)` → `to=null` `2 quests expired` →
  `gv p0 +10 quest` → `to=p0` `Rime Stalker: +10 kill stacks · +12.5 Defense total` → `to=p0`
  `Quest complete: Shards of the Watch` → `to=null` `name0 completed quest: Shards of the Watch`.
  **Order: discovery → aggregated-expired (no names) → completion.** `unknownQuests` stayed 10; the discovered
  `long-haul` remained unpublished (`publishAt` head start). The two aggregated expiries are published
  `grand-tour` and `headhunter`; the aggregate text contains no quest name.

### 4. teleport-close-notices (5 events)

- `t=1 (50)` `raidStarted`.
- `t=2 (100)` `to=p0` `Quest accepted: The Grand Tour`.
- `t=3 (150)` `to=p0` `Quest accepted: A Head for a Head`.
- Direct `teleportToColiseum(r.w)` at `t=3 (150)` (before the next step): actual queue, read immediately, is exactly
  `[toast to=null "10 quests expired", fx kind=teleport]`. The next step is `t=4 (200)` and clears the queue.
  Hidden offers are deleted silently (`unknownQuests 10 → 0`); the ten published open offers become
  `status:"expired"`; no hidden definition appears in the queue.

### 5. run-end-silent-close (18 events)

- `t=1 (50)` `raidStarted`; `t=2` `to=p0` `Quest accepted: The Grand Tour`; `t=3` `to=p0`
  `Quest accepted: A Head for a Head`.
- `t=4 (200)` first real sword duel: windup/swing/death `p1`/hit; `gv p0 +10 kill`; `resolved p1 died place 3`.
  The contested run stays `active`.
- `t=14 (700)` final real duel: windup/swing/death `p2`/hit; `gv p0 +10 kill`; `resolved p2 died place 2`;
  `resolved p0 won place 1`; `fx victory p0`; `raidEnded`. **No toast of any kind in the end step and no
  `Quest expired/quests expired` notice anywhere.** Hidden offers deleted silently (10 → 0); ten published offers
  closed to `expired`; the real end-run events above are preserved.

### 6. camp-and-publication-closure (115 events)

- `t=1 (50)` `raidStarted`.
- `t=2 (100)` `questReveal to=p0` `cull-fire` at `(4624,4880)`; `to=p0` `Quest discovered: Cinder Cull (Ashmother Vela)`.
- `t=82 (4100)` `to=null` `name0 revealed quest: Cinder Cull` (real 4000 ms publication); then the declared inline
  fire whole-region wipe: 44 death `fx` + 10 `campCleared` `fx` (`via:"inline-producer"`, producer `killMob`).
- `t=83 (4150)` `to=null` `Quest expired: Cinder Cull` — the recheck closed the published cull offer, one named
  expiry (not a count).
- `t=84 (4200)` `questReveal to=p0` `cull-frost` at `(1712,48)`; `to=p0` `Quest discovered: Thaw the Watch
  (Warden Sigur)`.
- `t=85 (4250)` `to=p0` `That quest is over` — the finder-private impossible offer is nonactionable before publication.
- `t=163 (8150)` declared inline frost whole-region wipe: 41 death `fx` + 10 `campCleared` `fx`
  (`via:"inline-producer"`, producer `killMob`); `expireSoon` set the published `grand-tour` deadline for this step.
- `t=164 (8200)` `to=null` `name0 revealed quest: Thaw the Watch` (publication) **then** `to=null`
  `2 quests expired` (aggregate for the immediately-impossible `cull-frost` + nudged `grand-tour`).
  **Order: publication → aggregated expiry; both closed in the same step.** No still-hidden quest name appears in
  the publication-step public notices.

## Checks and commands/results

### Canonical corpus / byte reproduction

```sh
bash tools/quest-notice-fixtures/capture.sh            # write parity/quest-notices/source.json
bash tools/quest-notice-fixtures/capture.sh --check    # run twice, output mounted read-only
```

- `--check` run 1 and run 2 both exited 0; each printed
  `checked sha256=a20d751e… bytes=1154217` (string length) and verifier
  `sha256=a20d751e… captureSha256=c066a4d… cases=6 events=181 frames=41 sourceFiles=127 toolFiles=12 anchors=26`.
- Genuine external write reproduction:
  `RH_QUEST_NOTICE_OUTPUT=/tmp/rh-quest-notice-external-final.KN86xp bash tools/quest-notice-fixtures/capture.sh`
  wrote the same bytes; `cmp` reported identical and both files hashed
  `a20d751e88cb16765cf2aa3ef856765a0d3321d8e25eb6e41c6722cdf9a99244`.
- `verify.mjs` independently recomputes the canonical bytes, capture SHA, all 127 source hashes, all 12 tool hashes,
  package-lock/package.json/tsconfig hashes, all 26 source anchors and the per-case actual-event/recipient/order
  assertions. It passes on the checked-in corpus and on the external reproduction.

### Semantic controls (actual recorded outputs, not helper/provenance text)

Mutations start in a fresh disposable copy of the read-only `/repo`; each patch is applied by the exact-context
`apply-patch.mjs`. `compare.mjs` skips only `/profile` (a mutant necessarily changes its source hash); every semantic
first mismatch below is inside `/cases/.../events/...`, i.e. the actual recorded event stream. A compile/import/runtime
failure would abort as “not a semantic kill”; none occurred. The provenance-only comment patch must remain identical.

| control | expected/actual first recorded-output mismatch | mutant output sha256 | result |
|---|---|---|---|
| `01-wrong-recipient` | `/cases/1/events/1/to expected="p0" mutant=null` (Over made public) in `pickup-closed-guard` | `abce957d07f68a4fc86ba70f9d9eac6d2af61e743701721814947c98a5950299` | **KILL** |
| `02-missing-stolen-text` | `/cases/0/events/16/to expected=null mutant="p2"` (stolen room notice removed → private picked shifted) in `parcel-feedback` | `91991308dbfe4631697debf442ecdf10ef71f42bc236dd003530c18f49a8802e` | **KILL** |
| `03-run-end-loud` | `/cases/4/events/16/type expected="fx" mutant="toast"` (run-end expiry made loud) in `run-end-silent-close` | `c45a4ff5d4dc5c727a8c45e918e8a328cd1716db684caf436b532cbd9ca97b10` | **KILL** |
| `04-per-quest-spam` | `/cases/2/events/11/text expected="2 quests expired" mutant="Quest expired: The Grand Tour"` in `expiry-cohort-order` | `6957db978b4846647f7b4af0023c3d3637ec8c77c6e2275e4fd0eec659e5a0ee` | **KILL** |
| `05-provenance-only` | `IDENTICAL` (comment-only source edit; only `/profile` differs) | `2a69dc5e0aba99f62d9442e83e749150d679324dd4b440a27de5e5700da23f59` | **NON-KILL** |
| restored unmutated control | `--check` + verifier against the checked-in corpus | `a20d751e…` | **PASS** |

Raw control logs (stdout, capture JSON, comparator lines, output SHA) are committed under
`docs/evidence/quest-notices/controls/`; the restored run is `restored.log`.

| raw log | sha256 |
|---|---|
| `01-wrong-recipient.log` | `6410f219440b54bb8b6501602f11b9c5429fbd01aa4b1c39776febd3f4e8874f` |
| `01-wrong-recipient.capture.log` | `afca998ba5ae2adb60e938c70c8a68cc6b172d6df2c76570e5daa21a1f873f93` |
| `02-missing-stolen-text.log` | `f62fbd0c8ff0376fbc544a2b3ea8e9e50fac5836be10f54151081c07064b4d54` |
| `02-missing-stolen-text.capture.log` | `7c89720bbca2e71b874f83566fb5d89f0fe6d4d2e9abb1cd4573cb38060193ad` |
| `03-run-end-loud.log` | `70788d88b28011eb8949b86dfa2f5ff8f571045b3c43e25fe2190967005c8aac` |
| `03-run-end-loud.capture.log` | `13adb3875c443d59cb83209937df3eb2d7345ff0fae5df003626ee4d94d74383` |
| `04-per-quest-spam.log` | `91265458e4de4c717facb1d59e6f00ec46f044b469f5e48cf7c11c49340739dc` |
| `04-per-quest-spam.capture.log` | `8e445e23da9cb859d6fa04b1c7aecaee616602c61a49d6ac476c00555f9acebc` |
| `05-provenance-only.log` | `6dd7c10b3070578b25c9029bb1e931a9a3ec7c329310b5191de9d23b99afb184` |
| `05-provenance-only.capture.log` | `9e1040743ffc0627f8ac3fbf2bc09f7788b6b1eed2b730affde30a576c4b865f` |
| `restored.log` | `ed0c3db19f98197aab4b25f6195c81ccc6bf2d1c26c2fe09dc91db7bd8b29be4` |

## Honest limits / remainder

- **Noncanonical guard (case 2):** the stale/closed status and the stale carrier are written directly while a real
  produced box is retained. This is a labelled guard fixture, **not** normal post-retirement state: ordinary
  `retire()` removes the box. It is not evidence of ordinary gameplay, only of the pickup guard branch and no
  consumption.
- **Order-only deadline (case 3 and case 6):** `expireSoon` is the admitted lifecycle convention and proves ordering,
  not natural duration. giver8 remains the independent actual 300-second timing witness. No progress or reward is
  installed; the ready turn-in is built by real accept/pickup actions.
- **Direct producer invocation (case 4):** `teleportToColiseum` is invoked directly between steps and its real queue is
  read before the next step clears it. This is the exported producer that `settle()` calls, not the patience-timer path.
  The label is explicit; it is not “only the quest hook”.
- **Inline whole-region wipe (case 6):** the `killMob` calls are declared inline producer invocations with no credited
  killer, not claims that ordinary player swings killed 44 fire or 41 frost mobs. p0's HP 1000 is declared setup so the
  finder can stand through the head-start waits.
- **Incidental discoveries retained:** real source discovery behavior (for example `Thaw the Watch` at `t=2` in case 1,
  `Cinder Cull` at `t=3` and `Offerings at the Edge` at `t=6` in case 3) is recorded rather than suppressed. It does not
  alter the tested orders; all public-notice hidden-name checks pass.
- **No hidden-name leak:** targeted checks assert no still-hidden quest name/coords appear in the public notices for
  the tested steps; private `questReveal` payloads remain in the entitled finder's event stream. The corpus itself keeps
  the private fixture data (as the admitted lifecycle corpus does), it is not a public wire payload.
- **Existing admitted artifacts untouched:** the existing `tools/quest-fixtures/**`, `tools/quest-public-fixtures/**`,
  `tools/quest-giver-fixtures/**`, `parity/quests/lifecycle.json`, `parity/quest-public/**`,
  `parity/quest-giver/source.json` and all native/client/cloud/source paths are byte-identical to base. A
  `git diff --name-status dbd70f9d810330099b754281b70d511a60f62cf8..HEAD` shows only added files (25 paths: 12 tool
  files, the corpus, 11 raw control logs and this README); no modification or deletion entries exist.
- **No native/wire claim:** this packet does not implement native notices, `Option<PlayerId>` recipients, completion
  farm formatting, closure aggregation, wire tags, schemas, protocol/frontend rules, tapes or activation. It also does
  not edit the existing quest-public/giver/lifecycle corpora or tools. Those are unchanged and were used only as
  read-only recipes/references; no whole campaign was rerun.
- **Remainder for GPT/root:** compose this actual source stream into the native producers; use the source-only
  labelled boundaries above for a correspondingly labelled native control; resolve the cross-cutting owner/room
  recipient and completion-order changes in the native lease; root independently composes and registers derived
  identities, public transport and activation.

## Reproduction

```sh
# canonical write + verifier
bash tools/quest-notice-fixtures/capture.sh

# exact read-only check (run twice)
bash tools/quest-notice-fixtures/capture.sh --check

# genuine external write reproduction
out=$(mktemp -d /tmp/rh-quest-notice.XXXXXX)
RH_QUEST_NOTICE_OUTPUT="$out" bash tools/quest-notice-fixtures/capture.sh
cmp "$out/source.json" parity/quest-notices/source.json

# semantic controls + provenance-only non-kill + restored control
bash tools/quest-notice-fixtures/run-controls.sh
```

Reproduce binds to the pinned image; no host Node is used for the canonical bytes.
