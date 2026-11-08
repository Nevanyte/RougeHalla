# Quest-public source witness (P-QUEST-TRADE-PUBLIC-WITNESSES)

Canonical **source-only** capture of the legacy human quest command door, its intake/queue/action path, the actual
QuestState/TraderState/PlayerState schema and Colyseus encode/decode shapes, the private-reveal/public boundary and the
client's quest wording/receiver. This is evidence for the lead's public protocol-13 quest contract; it changes no
production, Rust, C#, Unity, wire, protocol, version, profile or gameplay rule.

The capture runs in pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
with `--platform linux/amd64`: the repository is mounted read-only at `/repo` (its ignored `node_modules` is a writable
tmpfs), this tool directory is read-only at `/capture`, and the output is mounted at `/out` (read-only for `--check`).
Setup is `npm ci --ignore-scripts --no-audit --no-fund` and `node --import tsx`.

```sh
bash tools/quest-public-fixtures/capture.sh            # write parity/quest-public/{doors,schema-receivers,wording,manifest}.json
bash tools/quest-public-fixtures/capture.sh --check    # compare every byte (output mounted read-only) + verify.mjs
bash tools/quest-public-fixtures/run-mutants.sh        # four compiled semantic mutants + provenance-only non-kill + restored control
```

`RH_QUEST_PUBLIC_OUTPUT` redirects the output; the path must stay inside this isolated worktree. Canonical serialization
is `JSON.stringify(corpus) + "\n"`; every corpus carries `profile` with the pinned image digest, the Node/linux/x64
asserts, sha256/bytes of `package-lock.json`, every package manifest and `tsconfig`, the versions of the imported npm
packages, the sha256 of the actual internal TypeScript source closure (149 files), the tool/reused-corpus hashes, the
exact source-inventory line anchors, and `profile.captureSha256` (over the corpus with the profile present and
`captureSha256` absent). `manifest.json` lists every corpus byte/sha256/captureSha256 and its bounded counts.
`verify.mjs` independently re-derives the bytes/hashes, re-runs the real `enqueueClientMessage` on every recorded door
payload and inspects the door/intake/action/schema/receiver bindings.

## Corpora

| file | bounded counts | content |
|---|---:|---|
| `doors.json` | 7 client-door cases, 13 intake cases, 14 action cases | The real `QuestDialog` (`open/update/accept/noteToast` and the real capturing keydown/click path) constructed with the scene's `(msg) => sendInput(room,"questAccept",msg)` wiring on a declared minimal DOM; the real `enqueueClientMessage`/parseQuestAccept/InputQueue table; the real `handleQuestAccept` through ordinary 50 ms steps for accepted/repeat/far/unknown/hidden/stale/busy/dead/LOS/order/phase/reveal cases. |
| `schema-receivers.json` | 4 schema kinds, 2 encode rounds, 2 receiver cases | Actual QuestState/TraderState/PlayerState/RaidState field metadata and a real Colyseus `Encoder`/`Reflection.decode` round trip; the hidden-offer/finder-private/public matrix; `questFromReveal`, `questCollections` and `questRows` over actual state and the actual private reveal message. |
| `wording.json` | 19 strings, 16 runtime toasts | The shared `QUEST_REFUSAL`/`questAcceptedText`/`questAcceptFirstText` declarations, the dialog's actual rendered status/labels/hints, and the real action toasts with recipients, kept distinct from helper declarations. |

## Declared inputs vs actual outputs

- **World**: `createGameWorld` with the production module order, quests on, map `generateMap(1, attempt 0, {decor:false})`,
  world random `mulberry32(12)`, reward salt `[1,2,3,4]`, three declared players, ordinary 50 ms `step()`. The map hash
  and every placement/offer are actual outputs. Raid-start quest givers/traders are the source's own producers.
- **Door**: `QuestDialog` is the real imported class; its frame values come from the actual `RaidState`/player. The DOM is
  the declared `fake-dom.mts` (elements, classList, focus, capturing keydown, bubbling click); the room is a declared
  `{send}` recorder. No browser, renderer, real keyboard or scene is claimed.
- **Actions**: player x/y/status, a real `addStatus` stun, one forced wall tile (LOS probe) and the declared end-phase
  nudge are labelled per case; the input queue, parse, action handler, step and event emission are actual.
- **Schema**: `Encoder.BUFFER_SIZE` is raised to the server's 64 KiB setting; the decoded state is the actual decoder's
  state. Numeric/enum values are plain JSON; no expected reward, offer, acceptance, cost/gain, owned state, eligibility or
  toast is installed.

## Source inventory

The exact anchors are in `profile.sourceInventory` of every corpus (path:line + source text). The main chain:

- human door: `packages/client/src/scenes/RaidScene.ts:432` quest dialog `send`; `RaidScene.ts:473` private reveal
  receiver; `packages/client/src/ui/questDialog.ts:225/376/398` `open`/`accept`/`noteToast`.
- room edge: `packages/server/src/rooms/RaidRoom.ts:293-303` (`CLIENT_MESSAGE_TYPES` loop, liveness, order budget,
  training, `enqueueClientMessage`) and `:741` `sendTo(ev.to,"questReveal",ev.quest)` (source-anchored; no Room/socket run).
- intake: `packages/server/src/sim/inputs.ts:179` `parseQuestAccept`, `:243` `enqueueClientMessage`, `:351` quest branch.
- action: `packages/server/src/sim/quests.ts:190` `handleQuestAccept`; `:454` head-start deadline; `:456` reveal recipient.
- schema/receiver: `packages/shared/src/schema.ts:294` QuestState, `:330` TraderState, `:152-154` PlayerState trade fields,
  `:368/:394` RaidState containers; `packages/shared/src/messages.ts:348` QuestRevealMessage, `:109` questAccept;
  `packages/client/src/ui/questModel.ts:136/153/230` receiver functions.

## Semantic mutants

`run-mutants.sh` copies the repository to a writable `/tmp/repo` (workspace packages resolve inside the copy), restores
every patched file from the read-only `/repo` before each mutant, applies the exact unified diff with `apply-patch.mjs`,
and recaptures with `RH_QUEST_PUBLIC_RECORD=1` (structural assertions become recorded booleans; the comparator is not
weakened). `compare.mjs` reports the first JSON-path mismatch, skipping only `/profile` (a mutant necessarily changes
the mutated file's hash). A compile/syntax/runtime failure is not a semantic kill. Four semantic mutants change named
consumer outputs (door payload shape, intake/length acceptance, hidden-reveal public boundary, refusal wording); the
provenance-only comment edit must remain `IDENTICAL`. After the mutants, the runner re-runs the unmutated capture
`--check` and `verify.mjs` against the checked-in corpora.

## Boundaries and remaining prerequisites

This is a method-level source witness, not a real Unity/Room/socket/browser run. The generic `RaidRoom` registration,
liveness, order budget and real session are source-anchored, not executed; the dialog's synthetic key/click events are a
declared DOM, not a keyboard. The existing lifecycle corpus `parity/quests/lifecycle.json` is cited for the far → accept →
repeat campaign, turn-in rewards, collect/fetch carriers, teleport/run-end closes and the 4 s head start; this packet adds
the door payload, intake table, toast recipients/wording, public-vs-private schema boundary and receiver outputs. The
native observation/codec contract, protocol-13 wire tags, public filters and Unity receiver remain the lead's separate
work.
