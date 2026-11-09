# NPC source witness development run

This is a focused development capture for the new `tools/bot-public-facts-fixtures/npc.mts` module. It is not the root-controlled pristine/control runner receipt and does not claim a Sim-earned NPC death, heal, home return, or respawn.

## Pinned runtime and command

- Source checkout: `a3d4b3ce575442c9a06916888035ca849a6cd05a`
- Runtime: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, linux/amd64, Node `v22.23.4`
- Dependencies were installed by `npm ci --ignore-scripts --no-audit --no-fund` into the container's tmpfs `/repo/node_modules`; source tree was mounted read-only.

The focused command was:

```sh
docker run --rm --platform linux/amd64 \
  --tmpfs /repo/node_modules:rw,exec,size=1500m \
  --mount type=bind,src=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/bot-public-facts-source/repo,dst=/repo,readonly \
  --mount type=bind,src=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/bot-public-facts-source/repo/docs/evidence/bot-public-facts-source/attempts/npc-dev-1,dst=/out \
  -w /repo node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 \
  sh -eu -c 'npm ci --ignore-scripts --no-audit --no-fund >/tmp/npc-npm-ci.log 2>&1 || { cat /tmp/npc-npm-ci.log; exit 1; }; node --import tsx --input-type=module -e '\''import {writeFileSync} from "node:fs"; import {createHash} from "node:crypto"; import {captureNpcWitness} from "./tools/bot-public-facts-fixtures/npc.mts"; const value=await captureNpcWitness(); const text=JSON.stringify(value,null,2)+String.fromCharCode(10); writeFileSync("/out/npc-source-output.json",text); console.log(JSON.stringify({format:value.format,node:process.version,timelineTicks:value.sameEntity.ticks.length,returnTicks:value.memoryReturnHeuristic.ticks.length,replacementTicks:value.replacement.ticks.length,sha256:createHash("sha256").update(text).digest("hex")}));'\'''
```

Result: `rh-bot-public-facts-npc/1`, four same-identity visibility ticks, four declared return-heuristic ticks, two declared replacement ticks. The generated source output is [npc-source-output.json](npc-source-output.json), SHA-256 `ce883f5296a03767dcb02c1d53a504acdc9212edd3687897928273a82878e564` (27,723 bytes). Capture module SHA-256: `85cfa2125d7a3b71bbaa8fa9763aa9ed3c43df8cb5b834d93beb1809db5a139f`.

## What the source returned

- A `MobState` row survived actual Colyseus `Encoder.encodeAll` → `Decoder.decode`. The actual human `RaidVision` and `shouldRenderActor` gate allowed the NPC at the nearby and off-camera probe locations; the capture labels camera pixel visibility as unevaluated. `perceive()` plus zero-delay `FrameRing.compose()` dropped the farther actor from the view list while retaining its minimap dot and stable memory ID.
- The separate declared memory sequence returned `returning: true` only after a rising HP share was observed while the remembered actor was away from its first-seen home point; the declared home-position snapshot cleared that flag. This is a source-heuristic observation, not a simulated healing or walk-home event.
- The replacement control changes the runtime map key while holding row name/location/HP constant. Its input keeps both names in the declared roster; after the minimap refresh the old ID is marked absent/dead by memory while the new ID is learned separately. This is not a source death/respawn or claim that IDs are reused.
- An actual opaque wall makes `RaidVision.canSee` and the human render gate false; `perceive()` returns no actor ID or minimap dot in either alpha-renamed occluded snapshot. The visible alpha-rename control does expose the changed runtime ID in the actual MobSeen projection.
- Two otherwise identical equal-score `MobHunter` candidate lists select their first entries when input order is reversed. This documents an order-sensitive tie; it does not claim a canonical stable target.

No Phaser stubs or fabricated `canSee` callback were used. This module does not instantiate a client scene or capture pixels, does not use full raw hidden actor fields as the Percept expectation, and does not call a Sim death/respawn producer. The capture profile includes source hashes and exact source anchors for the consumed paths.
