#!/usr/bin/env bash
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=${RH_BOT_HAZARDS_MUTANT_OUTPUT:?set an external evidence directory}
mkdir -p "$OUTPUT"
OUTPUT=$(cd "$OUTPUT" && pwd)
# All source mutation is in the container's disposable /tmp copy, never the host checkout.
docker run --rm --platform linux/amd64 --mount "type=bind,src=$REPO,dst=/original,readonly" \
 --mount "type=bind,src=$OUTPUT,dst=/out" \
 node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 sh -eu -c '
 mkdir /tmp/repo; cp -R /original/packages /original/tools /original/crates /tmp/repo/
 cp /original/package.json /original/package-lock.json /original/tsconfig.base.json /tmp/repo/
 cd /tmp/repo; npm ci --ignore-scripts --no-audit --no-fund >/tmp/npm-ci.log 2>&1 || { cat /tmp/npm-ci.log; exit 1; }
 node --import tsx tools/bot-hazards-fixtures/capture.mts --write /out/control-before.json
 node tools/bot-hazards-fixtures/compare.mjs /original/parity/policy/bot-hazards.json /out/control-before.json
 cp packages/server/src/bots/brain/modules/hazards.ts /tmp/hazards-original.ts
 for name in still hold bog; do
   cp /tmp/hazards-original.ts packages/server/src/bots/brain/modules/hazards.ts
   NAME="$name" node --input-type=module -e '\''import fs from "node:fs";const p="packages/server/src/bots/brain/modules/hazards.ts";let s=fs.readFileSync(p,"utf8");const [a,b]=({still:["stillMs: 250","stillMs: 249"],hold:["holdMs: 1500","holdMs: 1499"],bog:["e.speedMult < 1","e.speedMult < 0"]})[process.env.NAME];if(s.split(a).length!==2)throw Error("mutation not unique");fs.writeFileSync(p,s.replace(a,b));'\''
   node --import tsx tools/bot-hazards-fixtures/capture.mts --write "/out/mutant-$name.json"
   case "$name" in still|hold) required=/steps;; bog) required=/adjusts;; esac
   node tools/bot-hazards-fixtures/compare.mjs /original/parity/policy/bot-hazards.json "/out/mutant-$name.json" "$required"
 done
 cp /tmp/hazards-original.ts packages/server/src/bots/brain/modules/hazards.ts
 node --import tsx tools/bot-hazards-fixtures/capture.mts --write /out/control-restored.json
 node tools/bot-hazards-fixtures/compare.mjs /original/parity/policy/bot-hazards.json /out/control-restored.json
 node --input-type=module -e '\''import fs from "node:fs";const p="/out/control-restored.json",c=JSON.parse(fs.readFileSync(p,"utf8"));c.profile.provenanceOnlyControl="different metadata must not be a semantic kill";c.captureSha256="PROVENANCE_ONLY";fs.writeFileSync("/out/provenance-only.json",JSON.stringify(c));'\''
 node tools/bot-hazards-fixtures/compare.mjs /original/parity/policy/bot-hazards.json /out/provenance-only.json
 echo "ALL 3 SEMANTIC MUTANTS KILLED; RESTORED AND PROVENANCE-ONLY CONTROLS PASS"'
