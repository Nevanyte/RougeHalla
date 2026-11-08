# Trade-public source witness (P-QUEST-TRADE-PUBLIC-WITNESSES)

Canonical **source-only** capture of the legacy human trader command door, its intake/queue/action path, the actual
TraderState/PlayerState/RaidState schema and Colyseus encode/decode shapes, the public-actor vs owner-offer/cooldown
boundary and the panel/TraderView wording and receivers. This is evidence for the lead's public protocol-13 trader
contract; it changes no production, Rust, C#, Unity, wire, protocol, version, profile or gameplay rule.

The capture runs in pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
with `--platform linux/amd64`: the repository is mounted read-only at `/repo` (its ignored `node_modules` is a writable
tmpfs), this tool directory is read-only at `/capture`, and the output is mounted at `/out` (read-only for `--check`).
Setup is `npm ci --ignore-scripts --no-audit --no-fund` and `node --import tsx`.

```sh
bash tools/trade-public-fixtures/capture.sh            # write parity/trade-public/{doors,schema-receivers,wording,manifest}.json
bash tools/trade-public-fixtures/capture.sh --check    # compare every byte (output mounted read-only) + verify.mjs
bash tools/trade-public-fixtures/run-mutants.sh        # four compiled semantic mutants + provenance-only non-kill + restored control
```

`RH_TRADE_PUBLIC_OUTPUT` redirects the output; the path must stay inside this isolated worktree. Canonical serialization
is `JSON.stringify(corpus) + "\n"`; every corpus carries `profile` with the pinned image digest, the Node/linux/x64
asserts, sha256/bytes of `package-lock.json`, every package manifest and `tsconfig`, the versions of the imported npm
packages, the sha256 of the actual internal TypeScript source closure (136 files), the tool/reused-corpus hashes, the
exact source-inventory line anchors, and `profile.captureSha256` (over the corpus with the profile present and
`captureSha256` absent). `manifest.json` lists every corpus byte/sha256/captureSha256 and its bounded counts.
`verify.mjs` independently re-derives the bytes/hashes, re-runs the real `enqueueClientMessage` on every recorded door
payload and inspects the door/intake/action/schema/receiver bindings.

## Corpora

| file | bounded counts | content |
|---|---:|---|
| `doors.json` | 8 client-door cases, 17 intake cases, 17 action cases | The real `TraderPanel` (constructor/update/click) with the scene's `(trader, pick) => sendInput(room,"trade",{trader,pick})` wiring on a declared minimal DOM; the real `enqueueClientMessage` trade parse/queue table; the real `handleTrade` through ordinary 50 ms steps for stat offers/trade/repeat/no-offers-yet, the barter cycle/refusals/Committed second slot, range/LOS/dead/stunned/unknown/order/phase cases, and the real `TraderView.update` on a declared scene recorder. |
| `schema-receivers.json` | 3 schema kinds, 3 encode rounds, 2 receiver cases | Actual TraderState/PlayerState/RaidState field metadata and a real Colyseus `Encoder`/`Reflection.decode` round trip; the trader actor vs owner offers/cooldowns matrix; the actual `PlayerState.tradeOffers/tradeStats` public-field disclosure (labelled SOURCE FINDING); the real panel receiver over actual state. |
| `wording.json` | 31 strings, 19 runtime toasts | The shared `TRADE_STAT_NAMES`/`barterLabels`/range declarations, the panel's actual title/description/choice labels, and the real handler toasts with recipients, kept distinct from helper declarations. |

## Declared inputs vs actual outputs

- **World**: `createGameWorld` with the production module order, quests on, map `generateMap(1, attempt 0, {decor:false})`,
  world random `mulberry32(12)`, reward salt `[1,2,3,4]`, three declared players, ordinary 50 ms `step()`. The raid-start
  trader actors, destinations, walking and first-contact stat offers are the source's own producers.
- **Door**: `TraderPanel` is the real imported class; its frame values come from the actual `RaidState`/player. The DOM is
  the declared `fake-dom.mts`; the room is a declared `{send}` recorder. No browser, renderer or real mouse is claimed.
- **Actions**: player x/y/status, weapons/potions, the real `grantCard` Committed card and one forced wall tile (LOS probe)
  are labelled per case; the input queue, parse, action handler, step and toast emission are actual. Expected offers,
  costs/gains, trades or refusals are never installed.
- **TraderView**: the real `TraderView.update` is called with a declared Phaser-like graphics/text/container recorder and a
  declared `canSee`; method-level only, not a rendered scene or pixel proof.
- **Schema**: `Encoder.BUFFER_SIZE` is raised to the server's 64 KiB setting; the decoded state is the actual decoder's
  state.

## Source inventory

The exact anchors are in `profile.sourceInventory` of every corpus (path:line + source text). The main chain:

- human door: `packages/client/src/scenes/RaidScene.ts:332` panel wiring, `:751-752` panel/view update; `packages/client/src/ui/traderPanel.ts:26/34/65` constructor/update/onTrade; `packages/client/src/render/TraderView.ts:15` update.
- room edge: `packages/server/src/rooms/RaidRoom.ts:293-303` (`CLIENT_MESSAGE_TYPES` loop, liveness, order budget,
  training, `enqueueClientMessage`) (source-anchored; no Room/socket run).
- intake: `packages/server/src/sim/inputs.ts:297` inline trade branch, `:243` `enqueueClientMessage`, `:140` `parseId`.
- action: `packages/server/src/sim/traders.ts:61` `handleTrade`, `:64-65` silent phase/standing/trader/lock/range/LOS
  guard, `:68` stat-used, `:81` barter cooldown, `:96` cooldown write, `:113` offer creation.
- schema/receiver: `packages/shared/src/schema.ts:330` TraderState, `:152-154` PlayerState trade fields, `:394` RaidState
  traders; `packages/shared/src/messages.ts:73` trade message; `packages/client/src/ui/traderPanel.ts:46` offer receiver;
  `packages/client/src/render/TraderView.ts:11` view class.

## Public-field disclosure finding

`PlayerState.tradeOffers`, `tradeStats` and `tradeUsed` are ordinary synced fields on the shared `RaidState` (metadata
`noSync === false`); the encoded/decoded state therefore carries a player's rolled stat offers (cost/gain/values/label)
and applied deltas to every client, even though the panel only reads `frame.me`. This is recorded as a **SOURCE FINDING**
in `schema-receivers.json`, not sanitized into owner-private behaviour. The barter cooldown (`world.traders.barterAt`) is
runtime-only and absent from the decoded state (owner-private). `TraderState` carries no offer or deadline.

## Semantic mutants

`run-mutants.sh` copies the repository to a writable `/tmp/repo` (workspace packages resolve inside the copy), restores
every patched file from the read-only `/repo` before each mutant, applies the exact unified diff with `apply-patch.mjs`,
and recaptures with `RH_TRADE_PUBLIC_RECORD=1` (structural assertions become recorded booleans; the comparator is not
weakened). `compare.mjs` reports the first JSON-path mismatch, skipping only `/profile` (a mutant necessarily changes
the mutated file's hash). A compile/syntax/runtime failure is not a semantic kill. Four semantic mutants change named
consumer outputs (door trader payload, barter cooldown, public offer sync/metadata, offer cost/label); the provenance-only
comment edit must remain `IDENTICAL`. After the mutants, the runner re-runs the unmutated capture `--check` and
`verify.mjs` against the checked-in corpora.

## Boundaries and remaining prerequisites

This is a method-level source witness, not a real Unity/Room/socket/browser run. The generic `RaidRoom` registration,
liveness, order budget and real session are source-anchored, not executed; the panel's synthetic clicks are a declared DOM,
not a real mouse. The existing `parity/trade/runtime.json` is cited for the spawn/wander/stat-offer/stat-trade/barter/
Committed campaign; this packet adds the door payload/gating, intake table, toast recipients/wording, schema encode/decode,
public-actor vs owner-offer/cooldown boundary and receiver outputs. The native observation/codec contract, protocol-13 wire
tags, public filters and Unity receiver remain the lead's separate work.
