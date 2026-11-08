# Semantic source mutants (P-WISH-PUBLIC-WITNESS-1)

Each `.patch` is a unified diff against the immutable base `fb738cd93d675d4074b7c37c15de6af2dd837ceb`. It is applied
to a writable copy of the repository under `/tmp/repo` inside the pinned container; the read-only `/repo` mount is
never patched. Before each mutant every file named by any patch is restored from `/repo`, so the mutations do not
accumulate. The mutated TypeScript is recaptured with the same tool and pinned image under
`RH_WISH_PUBLIC_RECORD=1` (source assertions become recorded booleans; `compare.mjs` and the signature check are
unchanged). A compile/syntax/runtime failure is not a semantic kill.

`compare.mjs` reports the first JSON-path mismatch and skips only `/profile` (the mutated file's sha256 is provenance,
not semantic corpus content). The runner fails unless the first changed corpus and the exact first mismatch match
`expected.txt`.

| mutant | source change | actual first mismatch |
|---|---|---|
| `01-armwishes-opening-lock` | `abilities.ts` opening lock: `wishLockSeconds*1000` -> `wishLockSeconds*1000 - 1000` | `queued-stock-clocks.json /cases/0/frames/0/players/0/wishReadyAt` 45050 -> 44050 |
| `02-fx-batch-time` | `FxChannel.batch`: packed `t` -> `t - 1` | `fx-timing.json /batches/0/batchTime` 45050 -> 45049 |
| `03-fx-same-tick-multiplicity` | `fxCodec.packFx`: drops every `castLand` after the first in one batch | `fx-timing.json /batches/2/batch/l/6` `[15,4,4,null,800,500]` -> missing |
| `04-wishfx-cansee-endpoint` | `WishFx.update`: keeps the destination `canSee` call but ignores it (`=== undefined`) | `wishfx-endpoints.json /cases/11/actual/graphics/0/calls/8/call` "setVisible" -> "setPosition" (the hidden-destination blink draws instead of releasing) |
| `05-perceive-ext-coordinate` | `perception.observeExt`: drops numeric `x/y/x2/y2` from `ext.data` | `perceive-wish.json /cases/0/actual/events/0/data/x` 350 -> missing |

Mutant 02 deliberately perturbs the packed stamp rather than forcing `tick*50`: in this legacy path the producer time
and batch time already equal `tick*50` for these steps, so forcing `tick*50` would be a no-op (a witnessed fact).
Mutant 04 preserves the host `canSee` call sequence, so its first mismatch is the hidden-destination Blaze case, not a
visible-case instrumentation difference.
