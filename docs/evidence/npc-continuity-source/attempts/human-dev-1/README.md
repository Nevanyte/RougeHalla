# Human producer extraction development smoke

This receipt preserves the focused development smoke used while authoring `tools/npc-continuity-fixtures/human.mts`. It is not the root's integrated World-patch capture and does not claim a live Phaser scene, MobView, Minimap canvas, or pixels.

## Command and environment

The source checkout was mounted read-only. `npm ci` wrote only to the container tmpfs. The smoke constructed one minimal `RaidState`, encoded and decoded it with the actual Colyseus Schema `Encoder`/`Decoder`, and called `createHumanWitness(...).push(decodedState)` once. This was an extraction smoke, not an actual source World lifecycle.

Pinned runtime: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, linux/amd64, Node `v22.23.4`.

Exact executed command:

```sh
docker run --rm --platform linux/amd64 --tmpfs /repo/node_modules:rw,exec,size=1500m --mount type=bind,src=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/npc-continuity-source/repo,dst=/repo,readonly -w /repo node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 sh -eu -c 'npm ci --ignore-scripts --no-audit --no-fund >/tmp/npc-human-npm.log 2>&1 || { cat /tmp/npc-human-npm.log; exit 1; }; node --import tsx --input-type=module -e '\''import { RaidState,PlayerState,MobState } from "./packages/shared/src/schema.ts"; import {Encoder,Decoder} from "@colyseus/schema"; import {mapFromTiles,TILE_FLOOR} from "./packages/shared/src/map.ts"; import {createHumanWitness} from "./tools/npc-continuity-fixtures/human.mts"; const m=mapFromTiles(32,24,new Uint8Array(32*24).fill(TILE_FLOOR)); const s=new RaidState(); s.phase="active"; s.serverTime=1000; s.gatesLocked=false; s.training=false; const p=new PlayerState(); p.status="alive"; p.x=528; p.y=528; s.players.set("viewer",p); const n=new MobState(); n.kind="mob"; n.status="alive"; n.x=550; n.y=528; n.faction="fire"; s.mobs.set("mob-one",n); const e=new Encoder(s); const o={offset:0}; e.encodeAll(o); const b=e.sharedBuffer.slice(0,o.offset); const d=new RaidState(); new Decoder(d).decode(b); const w=createHumanWitness(m,"viewer"); console.log(JSON.stringify({provenance:w.provenance,result:w.push(d)},null,2));'\'' '
```

## Observed successful stdout

The smoke printed JSON to stdout; it did not write a capture file. This excerpt is transcribed from the successful tool result (no output-file hash is claimed):

```json
{
  "provenance": {
    "sourceMode": "exact AST source-span extraction; source methods/callback bodies are transpiled from unchanged RaidScene.ts spans and invoked",
    "source": "packages/client/src/scenes/RaidScene.ts",
    "sceneSourceSha256": "64e79df4ee60c16237b0b3ef5c912a131bd64b49e83d9e0b2a6b913d5dcc3234",
    "moduleSha256": "aee30c480e9505473c541f400be9a644c167ddaab66e1c20206db68b6487f299",
    "typescriptVersion": "7.0.2",
    "transpiler": { "name": "esbuild", "version": "0.28.2" },
    "extracted": {
      "drawRemote": {
        "lines": [930, 936],
        "sourceSha256": "1454adb805019e5581b1d4c1ddf789d7ec6dc211b26dfa68db2f06c3badacf24",
        "transpiledSha256": "806ae7a6ffa662ead05b96ac911fb4feb37f49bbb8afe3fc4647c77432322939"
      },
      "regionalMobAdmissionPrefix": {
        "lines": [640, 642],
        "sourceSha256": "3d5ce4b962095d42ab91c64fe13c313f5a0e2eae06a05d91fdab9fd3e473c6c1",
        "transpiledSha256": "98ff413bf00b40bef4c485399fc0721f5cb72feb0ff1130fa4234a6aaba52786"
      },
      "minimapProducerArgument": {
        "lines": [763, 771],
        "sourceSha256": "762048b05b927771e3d829081948d3846a684c82f591c50cce913d042d4e77b5",
        "transpiledSha256": "444098300061aff235160b6c05bb93e03ecebe37563b0110f6fd71de20a668ce"
      }
    }
  },
  "result": {
    "patch": 1,
    "sourceTime": 1000,
    "localReceiptTime": 1000,
    "renderTime": 900,
    "drawAhead": false,
    "extractedMobAdmissionPrefix": {
      "invoked": true,
      "statementCount": 3,
      "admittedRows": [
        { "id": "mob-one", "kind": "mob", "status": "alive", "x": 550, "y": 528 }
      ],
      "unsupportedAdmittedKinds": []
    },
    "inlineMinimapProducer": {
      "invoked": true,
      "rows": [
        { "x": 550, "y": 528, "kind": "mob", "status": "alive", "faction": "fire", "owned": false, "id": "mob-one" }
      ],
      "renderedPositionCount": 1
    },
    "renderer": {
      "fullSceneRan": false,
      "mobViewRan": false,
      "minimapSetMobsRan": false,
      "pixelsCaptured": false
    }
  }
}
```

## Earlier development failures retained

The following excerpts are transcribed from the failed tool results during development. They are not source behavior failures. Some full error diffs were truncated by the exec tool; no omitted bytes are reconstructed here.

1. Initial TypeScript namespace/default-import attempt (observed twice):

   ```text
   TypeError: Cannot read properties of undefined (reading 'Latest')
       at extractExactSource (/repo/tools/npc-continuity-fixtures/human.mts:96:78)
       at <anonymous> (/repo/tools/npc-continuity-fixtures/human.mts:165:19)
   Node.js v22.23.4
   ```

   TypeScript 7's package root does not expose the old `ScriptTarget`/`createSourceFile` API; the final extraction uses `typescript/unstable/sync` and `typescript/unstable/ast`.

2. First TS 7 program text comparison included AST `getText()` trivia behavior:

   ```text
   AssertionError [ERR_ASSERTION]: AST project text must match the byte-hashed source file
   + actual - expected
   ... Skipped lines
   + 'import Phaser from "phaser";\n' +
   - '// Renders interpolated state and turns mouse/keyboard into input messages. No game rules here.\n' +
   ```

   The full actual diff was truncated by the exec tool. Final code compares `getFullText()` with the byte-read source.

3. First AST traversal used a legacy Node API absent from the TS 7 AST node wrapper:

   ```text
   TypeError: node.getChildren is not a function or its return value is not iterable
       at visit (/repo/tools/npc-continuity-fixtures/human.mts:84:30)
   ```

   Final traversal uses the node's `forEachChild` method.

4. First minimized callback shape regex omitted the source's `: void` return annotations:

   ```text
   AssertionError [ERR_ASSERTION]: Minimap producer callback changed; refusing a hand-written equivalent
   actual: '{ forEach: (cb: (mob: MinimapMob, id: string) => void): void => { state.mobs.forEach((mob, id) => { const at = this.rendered.get(id); if (!at || !this.vision.canSee(at)) return; cb({ x: at.x, y: at.y, kind: mob.kind, status: mob.status, faction: mob.faction, owned: mob.ownerId === this.room.sessionId }, id); }); }, }'
   ```

   The fail-closed shape guard was corrected to match those exact source annotations.
