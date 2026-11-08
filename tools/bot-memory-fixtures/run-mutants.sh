#!/usr/bin/env bash
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=${RH_BOT_MEMORY_MUTANT_OUTPUT:?set an external evidence directory}; mkdir -p "$OUTPUT"; OUTPUT=$(cd "$OUTPUT" && pwd)
docker run --rm --platform linux/amd64 --mount "type=bind,src=$REPO,dst=/original,readonly" --mount "type=bind,src=$OUTPUT,dst=/out" \
 node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 sh -eu -c '
 mkdir /tmp/repo; cp -R /original/packages /original/tools /original/crates /original/protocol /original/client-unity /tmp/repo/
 cp /original/package.json /original/package-lock.json /original/tsconfig.base.json /tmp/repo/
 cd /tmp/repo; npm ci --ignore-scripts --no-audit --no-fund >/tmp/npm-ci.log 2>&1 || { cat /tmp/npm-ci.log; exit 1; }
 node --import tsx tools/bot-memory-fixtures/capture.mts --write /out/control-before.json
 node tools/bot-memory-fixtures/compare.mjs /original/parity/policy/bot-memory-subset.json /out/control-before.json
 cp packages/server/src/bots/brain/memory.ts /tmp/memory-original.ts
 for name in still expiry held; do
  cp /tmp/memory-original.ts packages/server/src/bots/brain/memory.ts
  NAME="$name" node --input-type=module -e '\''import fs from "node:fs";const p="packages/server/src/bots/brain/memory.ts";let s=fs.readFileSync(p,"utf8");const [a,b]=({still:["dist(me, stillAnchor) > 1","dist(me, stillAnchor) >= 1"],expiry:["age > tier.memorySpanMs","age >= tier.memorySpanMs"],held:["a.held = f.inHand;","a.held = null;"]})[process.env.NAME];if(s.split(a).length!==2)throw Error("mutation not unique");fs.writeFileSync(p,s.replace(a,b));'\''
  node --import tsx tools/bot-memory-fixtures/capture.mts --write "/out/mutant-$name.json"
  node tools/bot-memory-fixtures/compare.mjs /original/parity/policy/bot-memory-subset.json "/out/mutant-$name.json" /memoryCases
 done
 cp /tmp/memory-original.ts packages/server/src/bots/brain/memory.ts
 node --import tsx tools/bot-memory-fixtures/capture.mts --write /out/control-restored.json
 node tools/bot-memory-fixtures/compare.mjs /original/parity/policy/bot-memory-subset.json /out/control-restored.json
 node --input-type=module -e '\''import fs from "node:fs";let c=JSON.parse(fs.readFileSync("/out/control-restored.json","utf8"));c.profile.provenanceOnly="not a semantic kill";c.captureSha256="PROVENANCE_ONLY";fs.writeFileSync("/out/provenance-only.json",JSON.stringify(c));'\''
 node tools/bot-memory-fixtures/compare.mjs /original/parity/policy/bot-memory-subset.json /out/provenance-only.json
 echo "ALL 3 SEMANTIC MUTANTS KILLED; RESTORED AND PROVENANCE-ONLY CONTROLS PASS"'
