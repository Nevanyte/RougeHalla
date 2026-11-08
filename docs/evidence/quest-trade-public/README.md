# P-QUEST-TRADE-PUBLIC-WITNESSES — quest/trade public source witness

**Status: source-only witness complete for the bounded human-door/schema/receiver surface.** This packet adds no
production, Rust, C#, Unity, wire, protocol, version, profile, gameplay, cost/grant or public-policy change. It records
actual legacy TypeScript execution for the lead's protocol-13/public-contract work and cites the existing quest/trade
corpora instead of repeating their campaigns.

- Isolated worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-quest-trade-witness`
- Branch: `deepseek/quest-trade-public-witness`
- Immutable base: `138a10de41f4e113e9dc85f0150a8e493d291c2b`
- Implementation head (tools/corpora): `0b4e0d425d24ea342b956babaf53332a6f8348f4`
- Evidence head: the commit containing this README update; the implementation head 0b4e0d42 remains the tools/corpora
  commit. The final branch head is reported in the coordination report.
- Contract: `docs/coordination/P-QUEST-TRADE-PUBLIC-WITNESSES.md` (not present in the worktree; read from the object
  store at `1cf3c5d5:docs/coordination/P-QUEST-TRADE-PUBLIC-WITNESSES.md`).

## Deliverables and exact hashes

Canonical serialization is `JSON.stringify(corpus) + "\n"`. `captureSha256` is over the corpus with `profile` present
and `profile.captureSha256` absent. All hashes were produced by the pinned container.

| file | bytes | SHA256 | captureSha256 | counters |
|---|---:|---|---|---|
| `parity/quest-public/doors.json` | 155,825 | `ea880564c0cc4487888503fcbc38a53f8f791d04a25464b32314981e957a95e9` | `9749ef75c335763dd363aea94a5d6398f20c42cbb056eb9cc8499ecd13732253` | 7 client-door, 13 intake, 14 action cases |
| `parity/quest-public/schema-receivers.json` | 55,517 | `c3902048d13aee55e33b29dae97295b6ecedb850e19ba4d0450aab97dc6b11e7` | `d3b8c29e81c0daf090c51660837e3d611e3074344393677a297d4d83fc22a37b` | 4 schema kinds, 2 encode rounds, 2 receiver cases |
| `parity/quest-public/wording.json` | 46,227 | `a23c7ff2866084c2a4cf7d4fedda710441dab6805741e184f8e356221edcf8cb` | `91f18d0df22450a308e49ced18e9115e0ccf2c8887bfcb5225193daf7b8866b8` | 19 strings, 16 runtime toasts |
| `parity/trade-public/doors.json` | 84,114 | `2ace515574261ef6d092cf8e973f8df0c0218a462037ab707badc73540ac5cc5` | `fc32e407e79e0cf5be9d49b46a9b9eb80bdef6775b03542b20fc349312440304` | 8 client-door, 17 intake, 17 action cases |
| `parity/trade-public/schema-receivers.json` | 45,101 | `ca15081396b494009d0bdf09c46942ae04dd5930133e7f4a68b4ffce6824ca8f` | `ab550e5f438b4ade739892710b90e3610e998d38f3f2dc5b53988c3d545058df` | 3 schema kinds, 3 encode rounds, 2 receiver cases |
| `parity/trade-public/wording.json` | 44,668 | `4c5f8a16692fa7007c3d10d2bceda092c196df69fa2e5e2b1a88d7a22c578748` | `cf7c21f40ac15dea6c7a66935478fadaf0308bdff050b64f985bc7f88a19912b` | 31 strings, 19 runtime toasts |
| `parity/quest-public/manifest.json` | 1,044 | `9f7070b087ed66ccf21d1809a5ca501c20055d10bf407c5becaa93919819fa6a` | n/a (manifest) | lists the three quest corpora/provenance |
| `parity/trade-public/manifest.json` | 1,043 | `815772be116c7572c8a5fb6e49e4b4446f157852d073ca8412a06ddd73562b94` | n/a (manifest) | lists the three trade corpora/provenance |

Each `manifest.json` carries the same table plus the source-closure/tool counts. The quest cross-checks are
`tools/quest-public-fixtures/verify.mjs`; the trade cross-checks are `tools/trade-public-fixtures/verify.mjs`.

## Provenance pins

- Image: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
  `--platform linux/amd64`; Node `v22.23.4`, linux, x64. Repo mounted read-only at `/repo`; tool dir read-only at
  `/capture`; output at `/out` (read-only under `--check`); `--tmpfs /repo/node_modules:rw,exec,size=1500m`;
  `npm ci --ignore-scripts --no-audit --no-fund`; `node --import tsx`.
- `package-lock.json` SHA256 `991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481`; tsx 4.23.15;
  `@colyseus/schema` 5.0.42.
- Source closure: quest 149 TypeScript files / 4 CSS; trade 136 TypeScript files / 1 CSS. Every runtime-imported
  closure file's SHA256 is in `profile.sourceClosure.sourceFiles`; tool files (including the five mutant patches and
  `expected.txt`; README files are documentation, excluded from the runtime pins) are in `profile.tool`. Handlers or
  modules outside the runtime import closure (e.g. the generic `RaidRoom.ts` registration path) are pinned as
  path:line text in `sourceInventory`, not as full-file hashes. Every corpus repeats the full profile.
- Reused/cited corpora are pinned by bytes/SHA256 in `profile.reusedOrCited`: quest `parity/quests/data.json` 79,403 /
  `c01c045f…` and `lifecycle.json` 633,814 / `c292c637…`; trade `parity/trade/runtime.json` 64,757 / `a03bfd02…`.
- Map: real `generateMap(1, 0, {decor:false})`, `mapHashU32 = 3499839449`; world random `mulberry32(12)`, reward salt
  `[1,2,3,4]`; players holy/fire/plague as `name0/name1/name2`; production module order from `createGameWorld`, quests
  on; ordinary 50 ms `step()`.

## Source inventory (handler → intake → action → schema → receiver)

Exact path:line + source text is recorded in every corpus's `profile.sourceInventory`. Condensed:

| stage | quest family | trade family |
|---|---|---|
| human door | `packages/client/src/scenes/RaidScene.ts:432` dialog `send: (msg) => sendInput(this.room,"questAccept",msg)`; `RaidScene.ts:473` private `questReveal` receiver; `packages/client/src/ui/questDialog.ts:225/376/398` `open`/`accept`/`noteToast` | `RaidScene.ts:332` panel `(trader,pick) => sendInput(this.room,"trade",{trader,pick})`; `:751-752` panel/view update; `packages/client/src/ui/traderPanel.ts:26/34/65` ctor/update/onTrade; `packages/client/src/render/TraderView.ts:15` update |
| room edge | `packages/server/src/rooms/RaidRoom.ts:293-303` `CLIENT_MESSAGE_TYPES` loop, liveness, order budget, `{training}`, `enqueueClientMessage`; `:741` `sendTo(ev.to,"questReveal",ev.quest)` | same `:293-303` loop/edge; no private send |
| intake/queue | `packages/server/src/sim/inputs.ts:179` `parseQuestAccept`, `:243` `enqueueClientMessage`, `:351` quest branch | `inputs.ts:297` inline trade branch (trader id + integer pick 0..2), `:243` enqueue, `:140` `parseId` |
| action | `packages/server/src/sim/quests.ts:190` `handleQuestAccept`; `:454` head-start deadline; `:456` reveal recipient | `packages/server/src/sim/traders.ts:61` `handleTrade`; `:64-65` silent phase/standing/trader/lock/range/LOS; `:68` used; `:81` cooldown; `:96` cooldown write; `:113` offer creation |
| schema | `packages/shared/src/schema.ts:294` QuestState; `:330` TraderState; `:152-154` PlayerState trade fields; `:368`/`:394` RaidState containers; `messages.ts:348` QuestRevealMessage, `:109` questAccept | `schema.ts:330` TraderState; `:152-154` PlayerState trade fields; `:394` RaidState traders; `messages.ts:73` trade |
| receiver | `packages/client/src/ui/questModel.ts:136/153/230` `questFromReveal`/`questCollections`/`questRows` | `packages/client/src/ui/traderPanel.ts:46` offer receiver; `packages/client/src/render/TraderView.ts:11` view class |

## Coverage matrix

| surface | status | evidence |
|---|---|---|
| Quest Accept human door: payload, open/reconnect/click-guard/pending gating, dead/closed/range/inactive gates | **captured** | `quest-public/doors.json/clientDoor` (7 cases) |
| Quest intake/parse/queue: valid, extra, null/empty, empty/non-string/array/over-64/at-64 id, unknown id, wrong type, training option, 6-per-tick cap | **captured** | `quest-public/doors.json/intake` (13 cases) |
| Quest action outcomes through ordinary steps: accept, repeat/already, far, unknown, hidden/unpublished, stale/closed, busy/stun, dead-silent, LOS, order busy→offer→range→already, ended phase not drained | **captured** (far/accept/repeat also cited) | `quest-public/doors.json/actions` |
| Hidden reveal: finder-only private message, absent public row during 4 s head start, publication + giver mob (the kill-verb case records the giver; no item pieces), global "revealed" toast | **captured** | `actions.hidden-reveal-publish`; `schema-receivers` rounds |
| Quest public fields accepted/progress/carrier/visitedRegions | **captured** | `schema-receivers.json/schema.rounds`, disclosure matrix |
| Client quest receiver: `questFromReveal`, `questCollections`, `questRows`, dialog text/status | **captured** | `schema-receivers.json/receivers`, `wording.json`, door views |
| Quest catalog/roster/placement/reward/turn-in/collect/fetch/expiry/teleport/run-end/camp-clear | **cited existing** | `parity/quests/data.json`, `parity/quests/lifecycle.json` |
| Trader stat offer roll/trade/repeat/no-offers-yet; barter cycle/cooldown/refusals; Committed second slot; range/LOS/dead/stunned/unknown/order/ended phase | **captured** | `trade-public/doors.json/actions` (17 cases) |
| Trade human door: stat/barter labels, click payloads, disabled pick-2 gates, stats-used, committed door→server refusal, panel visibility gates, TraderView figures | **captured** | `trade-public/doors.json/clientDoor` (8 cases) |
| Trade intake/parse/queue: picks 0/1/2, unknown trader, malformed/null, empty/non-string/over-64, string/fractional/out-of-range pick, wrong type, training option, 6-per-tick cap | **captured** | `trade-public/doors.json/intake` (17 cases) |
| TraderState/PlayerState/RaidState schema metadata, real encode/decode, trader actor vs owner offer/cooldown, panel receiver | **captured** | `trade-public/schema-receivers.json` |
| Trade spawn/wander/stat-offer/stat-trade/barter/Committed runtime | **cited existing** | `parity/trade/runtime.json` |
| Generic RaidRoom instance, socket/session, liveness, order budget, real browser/DOM/keyboard/render, real Unity | **source-anchored / not executed** | `sourceInventory.roomRegistration`, method limits below |

## Doors: actual payloads, gating and order

- **Quest Accept**: the real `QuestDialog` (constructed with the scene's `sendInput(room,"questAccept",msg)`) sends
  `{quest:"quest6y"}` for the first known offer; the same payload is accepted by the real `enqueueClientMessage` and
  queued as `{kind:"questAccept",quest:"quest6y"}`. The synthetic Enter key path sends the same payload and consumes the
  event; a click inside 250 ms is ignored, a later click sends once and a second click is suppressed by the pending/
  disabled latch; `canSend=false` sends nothing and shows `Reconnecting: that was not sent...`. The dialog refuses to
  open out of range, dead, on a closed offer or outside active. After the server step the public row shows
  `accepted:[[p0,true]]` and `expiresAt` starts.
- **Quest intake**: `parseQuestAccept` accepts a 1..64-char id and ignores extra fields; null/object/empty/non-string/
  array/over-64 are refused and queue nothing; a 64-char id and a made-up id parse (the sim decides); eight valid
  messages in one tick queue six and drop two (`dropped:2`). Training rooms still parse/queue at the edge but
  `world.actions.questAccept/trade` are `undefined` (module install gates) and the step emits nothing.
- **Quest action order**: busy/stun is checked before the offer lookup; offer published/open/giver is checked before
  range; range before already-accepted. Refusal toasts are private to p0 and use the shared strings exactly
  (`Can't do that now`, `Too far away`, `Can't reach that`, `That quest is over`, `You already accepted that quest`);
  success is `Quest accepted: <name>`. A dead player's queued action is drained before the handler (no toast); an ended
  phase does not drain (queue stays 1) — the handler's phase guard is source-anchored.
- **Trade legs**: the real panel sends `{trader:"trader-stats",pick:1}`, `{trader:"trader-barter",pick:0}` and, with
  Committed, `{trader:"trader-barter",pick:2}`; a second click is suppressed. Pick 2 is disabled with no potion or with
  both weapon slots full, but is **enabled** with Committed and one empty slot: the server refuses it with
  `Make an empty weapon slot first`, keeps the potion and sets no cooldown (the door's gate does not read the flag).
- **Trade action order**: silent phase/standing/trader/lock guard; range + LOS answer `Move closer to the trader`;
  stat-used before offer parse; barter cooldown before held/pick; then the held/potion/empty-slot branches. Exact
  runtime toasts include `Wait for the trader's offers`, `The villager is packing your last trade`,
  `Hold a weapon to trade`, `Your small potion pouch is full`, `Bring a small healing potion`,
  `Make an empty weapon slot first`, `Stat trade: ...`, `Traded for <weapon>` and
  `Traded weapon for a small healing potion`.

## Schema, receivers and disclosure

- **Quest**: `QuestState` is the 11-field schema (id/def/x/y/status/doneBy/expiresAt/carrier/progress/accepted/
  visitedRegions); `TraderState` is 5 fields (id/kind/x/y/name); `RaidState.quests`/`unknownQuests`/`traders` are the
  public containers. At spawn the state has 10 known rows and `unknownQuests:10`; a hidden `cull-fire` reveal emits a
  private `questReveal` to the finder only, with no public row, and the count stays 10; 4 s later the row publishes
  (11 rows, `unknownQuests:9`). The finder preview merges to 11 keys with `hidden:9` in `questCollections`; the public
  row is visible to all and carries accepted/progress/carrier/visitedRegions (public by design). `questRows` renders the
  actual objective/reward/progress/acceptance/time text. No quest source leak was found in the bounded surface.
- **Trade**: the decoded state has 2 public `TraderState` actors and no offer/deadline on them. The barter cooldown lives
  only in `world.traders.barterAt` (owner-private, not synced). **SOURCE FINDING (not sanitized):**
  `PlayerState.tradeOffers`, `tradeStats` and `tradeUsed` are ordinary synced fields (`noSync:false`); every client's
  decoded `RaidState` can read the owner's rolled stat offers (cost/gain/values/label) and applied deltas, even though
  the panel only reads `frame.me`. The capture records the decoded p0 offers (3) and p1 offers (0), the stats after one
  trade, and the panel's post-trade text. This is a source public-field disclosure for the lead's filter decision, not
  owner-private behaviour.
- The real `TraderView.update` (declared Phaser-like scene recorder) creates 2 figures when visible, destroys them when
  `canSee` is false, and shows the "Trade panel open" hint only for the near, living trader.

## Wording

- Quest helper declarations: `QUEST_REFUSAL` (busy/far/blocked/over/already), `questAcceptedText`,
  `questAcceptFirstText`; dialog constants `ACCEPT_NOT_CONFIRMED_SAY`, `ACCEPT_RECONNECTING_SAY`; actual dialog labels
  `EnterAccept`/`EscClose`, hints `Press F to close` / `Enter or 1 accept Esc or F close`; status lines
  `Accept it to start...`, `Accepting...`, `Quest accepted. It counts from now.`,
  `Not accepted yet: nothing counts until you accept.`, the ready line (source-anchored) and the reconnect/not-confirmed
  lines. The 16 runtime toast rows are actual `toast` SimEvents with recipients; each of the five shared refusals has a
  matching runtime row and helper-vs-runtime equality is asserted by `verify.mjs`.
- Trade helper declarations: `TRADE_STAT_NAMES`, `barterWeapons`/`barterLabels` (Sword→Bow, Sword→potion,
  potion→Wand, etc.); panel text: `Choose one permanent exchange for this run. These offers reflect your current
  stats.`, `Your stat trade is complete for this run.`, `Trade the weapon in your hand, or exchange a small potion for a
  weapon. One trade every 5 seconds.`; actual rolled labels and 19 runtime toasts. The source's inline handler strings are
  recorded as strings with their `path:line` and only counted as runtime when a matching `{to,text}` toast exists;
  `You already hold that weapon` is recorded as source text but is unreachable from pick 2 with the cycle (runtime 0).

## Semantic controls

`run-mutants.sh` copies the repo to `/tmp/repo`, links workspace packages inside the copy, restores every patched file
from read-only `/repo` before each mutant, applies the exact diff, and recaptures with `RH_*_PUBLIC_RECORD=1`.
`compare.mjs` skips only `/profile`; a compile/runtime failure is not accepted as a kill. Results (full logs in the
packet's terminal/commit evidence):

| family | semantic mutant | named consumer output | actual first mismatch |
|---|---|---|---|
| quest | `01-quest-door-payload` | dialog Accept payload id -> catalog def | `doors /clientDoor/cases/0/actual/sent/0/payload/quest expected="quest6y" mutant="grand-tour"` |
| quest | `02-quest-intake-parse` | no 1..64 length bound | `doors /intake/cases/7/parsed expected=null mutant={"kind":"questAccept","quest":"xxxx…"}` |
| quest | `03-quest-head-start` | head start removed | `doors /actions/cases/13/actual/headStart/publicHas expected=false mutant=true` |
| quest | `04-quest-refusal-wording` | `QUEST_REFUSAL.far` wording | `doors /clientDoor/cases/5/actual/afterRefusal/status expected="Too far away" mutant="Not close enough"` |
| quest | `99-provenance-only` | none (comment hash only) | `IDENTICAL` (NON-KILL) |
| trade | `01-trade-door-payload` | panel payload id -> name | `doors /clientDoor/cases/0/actual/sent/0/payload/trader expected="trader-stats" mutant="Soul Broker"` |
| trade | `02-trade-barter-cooldown` | cooldown 5000 -> 0 | `doors /actions/cases/4/actual/events/1/text expected="The villager is packing your last trade" mutant="Traded for Wand"` |
| trade | `03-trade-offer-not-synced` | `tradeOffers` no longer synced | `schema-receivers /schema/kinds/1/fields/9/name expected="tradeOffers" mutant="tradeStats"` |
| trade | `04-trade-offer-cost` | 12% -> 11% cost label | `doors /clientDoor/cases/0/actual/view/choices/0/text expected="−12% attack speed…" mutant="−11% attack speed…"` |
| trade | `99-provenance-only` | none (comment hash only) | `IDENTICAL` (NON-KILL) |

Each runner ends with the unmutated `capture.mts --check` against the checked-in corpora and `verify.mjs`; both
restored controls pass. `RH_QUEST_MUTANTS_DISCOVER=1` / `RH_TRADE_MUTANTS_DISCOVER=1` prints observed signatures
without enforcing them.

## Commands and results

```sh
# in the isolated worktree, pinned docker:
bash tools/quest-public-fixtures/capture.sh            # write parity/quest-public
bash tools/quest-public-fixtures/capture.sh --check    # byte-identical, read-only /out, verify.mjs PASS
bash tools/trade-public-fixtures/capture.sh            # write parity/trade-public
bash tools/trade-public-fixtures/capture.sh --check    # byte-identical, read-only /out, verify.mjs PASS
bash tools/quest-public-fixtures/run-mutants.sh        # 4 semantic KILLs + provenance NON-KILL + restored PASS
bash tools/trade-public-fixtures/run-mutants.sh        # 4 semantic KILLs + provenance NON-KILL + restored PASS
```

Results in this worktree: the read-only `--check` was run twice per family (four runs total), each recapturing in the
pinned container and comparing every byte plus `verify.mjs` — all PASS with the hashes above. A separate write-recapture
(`capture.sh` twice, SHA256 list before/after) was byte-identical (`WRITE_RECAPTURE_IDENTICAL`). The mutant runners
reported four semantic KILLs plus the provenance-only NON-KILL and the restored-control PASS per family. The capture tools
refuse an output path outside this worktree.

## Method-rig limits

- No Colyseus `Room` instance, socket, session, liveness tracker or order budget is constructed. The generic
  `RaidRoom` registration/guard block is source-anchored at `RaidRoom.ts:293-303`/`:741`; only the exact function it
  calls (`enqueueClientMessage(rt.inputs,type,msg,{training})`) and the real action handlers/steps are executed.
- No real browser, renderer, CSS layout, keyboard, mouse, scene or pixel output is claimed. `fake-dom.mts` is a
  declared element/focus/event stub; `TraderView` uses a declared graphics/text/container recorder.
- Player positions/status, weapons/potions, the real `grantCard` Committed card, one forced wall tile for LOS, the
  declared ended phase, and the client frame wrapper are declared and recorded per DOOR/ACTION case. The
  schema-receiver cases reuse the same declared world/player rows; their setup is recorded once in the corpus `world`
  block (config, players, traders, barterAt, playersState) instead of a repeated per-case `declared` object: documented
  setup, not produced sim state. All sim execution, offers, trades, toasts, schema bytes and decoded state are actual.
- No bots are added; no quest/trade profile is installed; missing runtime/handlers are asserted (canonical run) rather
  than skipped. The end-to-end room/socket/Unity proof remains separate.

## Independent checker (separate agent)

Verdict **PASS WITH DISCREPANCIES** (documentation/transparency only). The checker independently reproduced: the
41-added-file scope (only the three allowed new directory families; old `parity/{quests,trade}`,
`tools/{quest,trade}-fixtures`, production, Cargo.lock and shared status untouched); every corpus and manifest
byte-size/SHA256 and all six captureSha256 values; both `--check` suites twice (exit 0, `verify.mjs` PASS, same
counters); both mutant suites (four semantic KILLs per family, provenance NON-KILL, restored PASS) and independently
applied the door, head-start, offer-not-synced, cooldown and provenance patches in /tmp copies with the pinned image,
reproducing the exact first mismatches and IDENTICAL provenance result; the real `QuestDialog`/`TraderPanel`/
`sendInput` path and payloads, real `enqueueClientMessage`/parse/action steps, training-world behaviour, and the absence
of bots/profiles/installed outcomes; the **SOURCE FINDING** that `tradeOffers`/`tradeStats`/`tradeUsed` are
`noSync:false` public fields (decoded p0 has 3 offers/stats, p1 empty; `barterAt` is runtime-only and absent from
decoded rows); the hidden-quest boundary (absent during the head start, finder-only `questReveal`, published row
afterwards; accepted/progress/carrier/visitedRegions public); legal/item wording and toast rows; and the cited corpora
pins. It found no sanitized leak, false private claim or Room/socket/browser/Unity proof. Its discrepancies are fixed in
this commit: the queue-cap prose now says **eight** valid messages (six queued, two dropped); the schema-receiver
trusted setup is documented as recorded once in the corpus `world` block rather than as per-case declared objects;
the source-closure sentence distinguishes runtime-import-closure hashes from path:line anchors outside that closure; and
the hidden-reveal coverage text is narrowed to the giver mob for the kill-verb case. The checker did not repeat a
separate write-recapture (the twice `--check` is a full container recapture plus byte comparison); the Lead additionally
ran a trade write-recapture and a quest `--check` with identical bytes.

## Remaining gaps for the lead

1. Protocol-13 public/observation contract: ask/answer, wire tags, public filters and a real per-client view; the trade
   `tradeOffers/tradeStats/tradeUsed` public-field decision is the concrete source finding to resolve.
2. A real server Room/socket session run and a Unity/browser receiver proof (this packet is method-level/source-only).
3. Native quest/trade observation + codec fixture parity against these corpora; the existing `parity/quests` and
   `parity/trade` remain the lifecycle/state references.
4. Toast/reveal transport ownership (the source emits private toasts/questReveal; the current public transport is
   coordinator-owned) and any public NPC/actor representation.
