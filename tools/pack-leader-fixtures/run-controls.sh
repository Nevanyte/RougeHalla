#!/usr/bin/env bash
# Root-aligned semantic/provenance controls for the Pack Leader source witness, in the pinned linux/amd64 Node 22.23.4 image.
# Each patch is applied to a writable copy of /repo under /tmp/repo; the read-only /repo mount is never patched. Every capture
# runs with cwd/import/hash root = /tmp/repo, so the recorded source hashes are the ACTUAL imported mutant bytes; each changed
# file's recorded hash is asserted against sha256 on disk. A semantic mutant must change the actual recorded witness/result;
# the comment-only patch must keep the semantic projection identical while its provenance hash MUST differ; the restored run
# must equal the canonical corpus byte for byte. Raw logs are written under docs/evidence/pack-leader/repair/controls.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
LOGS=${RH_PACK_CONTROLS_LOG:-$REPO/docs/evidence/pack-leader/repair/controls}
BASELINE=${RH_PACK_LEADER_BASELINE:-$REPO/parity/pack-leader/repair}
[ -f "$BASELINE/source.json" ] || { echo "Missing repaired canonical corpus: $BASELINE/source.json" >&2; exit 1; }
mkdir -p "$LOGS"
LOGS=$(cd "$LOGS" && pwd)
BASELINE=$(cd "$BASELINE" && pwd)
SOURCE_BASE=db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 \
 -e RH_PACK_LEADER_BASE="$SOURCE_BASE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/pack-leader-fixtures,dst=/capture,readonly" \
 --mount "type=bind,src=$BASELINE,dst=/baseline,readonly" \
 --mount "type=bind,src=$LOGS,dst=/logs" \
 -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 rm -rf /tmp/repo /tmp/out
 mkdir -p /tmp/repo /tmp/out
 tar -C /repo --exclude=./node_modules --exclude=./.git -cf - . | tar -C /tmp/repo -xf -
 mkdir -p /tmp/repo/node_modules
 for d in /repo/node_modules/*; do n=$(basename "$d"); [ "$n" = "@raid" ] && continue; ln -s "$d" "/tmp/repo/node_modules/$n"; done
 mkdir -p /tmp/repo/node_modules/@raid
 ln -s /tmp/repo/packages/shared /tmp/repo/node_modules/@raid/shared
 ln -s /tmp/repo/packages/server /tmp/repo/node_modules/@raid/server
 ln -s /tmp/repo/packages/client /tmp/repo/node_modules/@raid/client
 echo "BASELINE_SHA256 $(sha256sum /baseline/source.json | cut -d" " -f1)" > /logs/source-bytecheck.log
 source_inventory() {
   ( cd /repo && find packages/shared/src packages/server/src -type f -name "*.ts" | LC_ALL=C sort | while IFS= read -r f; do printf "%s  %s\n" "$(sha256sum "$f" | cut -d" " -f1)" "$f"; done )
 }
 { echo "SOURCE-INVENTORY-BEFORE"; source_inventory | sha256sum; source_inventory | wc -l; } >> /logs/source-bytecheck.log
 restore_all() {
   for p in /capture/mutants/*.patch; do
     while IFS= read -r rel; do
       [ -n "$rel" ] || continue
       mkdir -p "/tmp/repo/$(dirname "$rel")"
       cp -a "/repo/$rel" "/tmp/repo/$rel"
     done <<PATCHFILES
$(sed -n "s|^+++ b/||p" "$p")
PATCHFILES
   done
 }
 run_capture() { # $1 outdir: cwd = actual mutable import root
   rm -rf "$1"; mkdir -p "$1"
   ( cd /tmp/repo && RH_PACK_LEADER_CONTROL=1 RH_PACK_LEADER_BASE="$RH_PACK_LEADER_BASE" \
       RH_PACK_LEADER_OUTPUT="$1/source.json" \
       node --max-old-space-size=4096 --import tsx tools/pack-leader-fixtures/capture.mts )
 }
 fails=0
 for patch in /capture/mutants/*.patch; do
   name=$(basename "$patch" .patch)
   log="/logs/$name.log"
   : > "$log"
   restore_all
   printf "CONTROL %s\n" "$name" | tee -a "$log"
   rels=$(sed -n "s|^+++ b/||p" "$patch")
   if ! node /capture/apply-patch.mjs /tmp/repo "$patch" >> "$log" 2>&1; then
     echo "PATCH-APPLY-FAILED $name" | tee -a "$log"; exit 1
   fi
   cap="/logs/$name.capture.log"
   if ! run_capture "/tmp/out/$name" > "$cap" 2>&1; then
     echo "CONTROL $name: CAPTURE-FAILED (compile/import/runtime), not a semantic kill" | tee -a "$log"
     cat "$cap" >> "$log"; fails=1; continue
   fi
   cat "$cap" >> "$log"
   for rel in $rels; do
     want=$(sha256sum "/tmp/repo/$rel" | cut -d" " -f1)
     got=$(node -e "const d=require(process.argv[1]);process.stdout.write((d.source||{})[process.argv[2]]||\"\")" "/tmp/out/$name/source.json" "$rel")
     if [ "$got" = "$want" ]; then echo "MUTANT-SOURCE-HASH-BOUND $rel $got" | tee -a "$log"; else echo "MUTANT-SOURCE-HASH-MISMATCH $rel want=$want got=$got" | tee -a "$log"; fails=1; fi
   done
   out=$(node /capture/compare.mjs /baseline/source.json "/tmp/out/$name/source.json" 2>&1)
   printf "%s\n" "$out" >> "$log"
   printf "OUTPUT_SHA256 %s\n" "$(sha256sum "/tmp/out/$name/source.json" | cut -d" " -f1)" >> "$log"
   expected=$(grep "^$name|" /capture/mutants/expected.txt | cut -d"|" -f2-)
   case "$out" in
     SEMANTIC-DIFF*) got="SEMANTIC-DIFF" ;;
     "SEMANTIC-IDENTICAL PROVENANCE-DIFF"*) got="SEMANTIC-IDENTICAL PROVENANCE-DIFF" ;;
     "SEMANTIC-IDENTICAL PROVENANCE-IDENTICAL"*) got="SEMANTIC-IDENTICAL PROVENANCE-IDENTICAL" ;;
     *) got="UNCLASSIFIED" ;;
   esac
   if [ "$got" != "$expected" ]; then echo "CONTROL-MISMATCH $name expected=$expected got=$got" | tee -a "$log"; fails=1; else echo "CONTROL-OK $name $got" | tee -a "$log"; fi
 done
 restore_all
 if ! run_capture /tmp/out/restored > /logs/restored.capture.log 2>&1; then
   echo "RESTORED-CAPTURE-FAILED" | tee -a /logs/restored.log; fails=1
 else
   cat /logs/restored.capture.log >> /logs/restored.log 2>/dev/null || true
   if cmp -s /baseline/source.json /tmp/out/restored/source.json; then
     echo "RESTORED-IDENTICAL-BYTES" | tee -a /logs/restored.log
   else
     echo "RESTORED-DIFFERS (expected byte-identical pristine output)" | tee -a /logs/restored.log; fails=1
   fi
 fi
 { echo "SOURCE-INVENTORY-AFTER"; source_inventory | sha256sum; source_inventory | wc -l; } >> /logs/source-bytecheck.log
 { echo "PROTECTED-SOURCE-SHA256"; sha256sum /repo/packages/shared/src/cards.ts /repo/packages/server/src/sim/mods.ts /repo/packages/server/src/sim/campHeal.ts /repo/packages/server/src/sim/camps.ts /repo/packages/server/src/sim/ledger.ts; } >> /logs/source-bytecheck.log
 [ "$fails" -eq 0 ] && echo "CONTROLS-GREEN"
 '
if [ "$?" -ne 0 ]; then echo "controls failed (see logs)" >&2; exit 1; fi
