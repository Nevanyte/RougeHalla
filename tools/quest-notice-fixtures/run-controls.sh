#!/usr/bin/env bash
# Semantic negative controls for the quest-notice fixture, in the pinned linux/amd64 Node 22.23.4 image. Each patch is
# applied to a writable copy of /repo under /tmp/repo; the read-only /repo mount is never patched. A semantic mutant must
# change the ACTUAL recorded case outputs (first JSON-path mismatch in /cases, not /profile) in its expected case; the
# provenance-only comment patch must remain IDENTICAL. Raw logs and output SHA are written under
# docs/evidence/quest-notices/controls (RH_QUEST_CONTROLS_LOG overrides). The restored control re-runs the unmutated
# capture --check against the checked-in corpus and the independent verifier.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
LOGS=${RH_QUEST_CONTROLS_LOG:-$REPO/docs/evidence/quest-notices/controls}
mkdir -p "$LOGS"
LOGS=$(cd "$LOGS" && pwd)
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/quest-notice-fixtures,dst=/capture,readonly" \
 --mount "type=bind,src=$REPO/parity/quest-notices,dst=/baseline,readonly" \
 --mount "type=bind,src=$LOGS,dst=/logs" \
 -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 rm -rf /tmp/repo /tmp/out
 mkdir -p /tmp/repo /tmp/out
 tar -C /repo --exclude=./node_modules -cf - . | tar -C /tmp/repo -xf -
 mkdir -p /tmp/repo/node_modules
 for d in /repo/node_modules/*; do n=$(basename "$d"); [ "$n" = "@raid" ] && continue; ln -s "$d" "/tmp/repo/node_modules/$n"; done
 mkdir -p /tmp/repo/node_modules/@raid
 ln -s /tmp/repo/packages/shared /tmp/repo/node_modules/@raid/shared
 ln -s /tmp/repo/packages/server /tmp/repo/node_modules/@raid/server
 ln -s /tmp/repo/packages/client /tmp/repo/node_modules/@raid/client
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
 for patch in /capture/mutants/*.patch; do
   name=$(basename "$patch" .patch)
   log="/logs/$name.log"
   : > "$log"
   restore_all
   printf "CONTROL %s\n" "$name" | tee -a "$log"
   node /capture/apply-patch.mjs /tmp/repo "$patch" >> "$log" 2>&1 || { echo "PATCH-APPLY-FAILED $name" | tee -a "$log"; exit 1; }
   rm -rf "/tmp/out/$name"; mkdir -p "/tmp/out/$name"
   cap="/logs/$name.capture.log"
   if ! RH_QUEST_NOTICE_RECORD=1 node --import tsx /capture/capture.mts --write "/tmp/out/$name/source.json" --repo /tmp/repo > "$cap" 2>&1; then
      echo "CONTROL $name: CAPTURE-FAILED (compile/import/runtime), not a semantic kill" | tee -a "$log"
      cat "$cap" >> "$log"
      exit 1
   fi
   cat "$cap" >> "$log"
   out=$(node /capture/compare.mjs /baseline/source.json "/tmp/out/$name/source.json" 2>&1)
   printf "%s\n" "$out" >> "$log"
   out_sha=$(sha256sum "/tmp/out/$name/source.json" | cut -d" " -f1)
   printf "OUTPUT_SHA256 %s\n" "$out_sha" | tee -a "$log"
   expected=$(grep "^$name|" /capture/mutants/expected.txt || true)
   [ -n "$expected" ] || { echo "missing expected row for $name" | tee -a "$log"; exit 1; }
   IFS="|" read -r ename kind ecase <<EXPECTED
$expected
EXPECTED
   if [ "$kind" = "IDENTICAL" ]; then
      if [ "$out" = "IDENTICAL" ]; then
         echo "NON-KILL (provenance-only) $name: all semantic cases identical" | tee -a "$log"
      else
         echo "CONTROL $name: expected IDENTICAL, got: $out" | tee -a "$log"; exit 1
      fi
   else
      case "$out" in
        FIRST_MISMATCH\ /cases/*) ;;
        *) echo "CONTROL $name: expected a semantic /cases mismatch, got: $out" | tee -a "$log"; exit 1 ;;
      esac
      got_case=$(printf "%s\n" "$out" | sed -n "s/^MISMATCH_CASE //p")
      if [ "$got_case" != "$ecase" ]; then
         echo "CONTROL $name: mismatch case $got_case, expected $ecase" | tee -a "$log"; exit 1
      fi
      echo "KILL $name: actual recorded-output mismatch in $ecase" | tee -a "$log"
   fi
 done
 echo "== restored control (unmutated /repo, read-only baseline)" | tee -a /logs/restored.log
 node --import tsx /capture/capture.mts --check /baseline/source.json --repo /repo >> /logs/restored.log 2>&1
 node /capture/verify.mjs /baseline/source.json /repo >> /logs/restored.log 2>&1
 echo "RESTORED CONTROL PASS" | tee -a /logs/restored.log
 echo "ALL SEMANTIC CONTROLS KILLED; PROVENANCE-ONLY NON-KILL; RESTORED CONTROL PASS"
 '
