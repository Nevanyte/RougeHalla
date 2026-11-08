#!/usr/bin/env bash
# Source semantic negative controls for P-QUEST-TRADE-PUBLIC-WITNESSES (quest family), in the pinned linux/amd64 Node
# 22.23.4 image. Each patch is applied to a writable copy of /repo under /tmp/repo; the read-only /repo mount is never
# patched. A semantic mutant must produce the exact first JSON-path mismatch in mutants/expected.txt; the provenance-only
# patch must remain IDENTICAL (a source-hash change is not a consumer-output change). The restored control re-runs the
# unmutated capture with --check against the checked-in corpora and the independent verifier.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e RH_QUEST_MUTANTS_DISCOVER="${RH_QUEST_MUTANTS_DISCOVER:-}" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/quest-public-fixtures,dst=/capture,readonly" \
 --mount "type=bind,src=$REPO/parity/quest-public,dst=/baseline,readonly" \
 -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 rm -rf /tmp/repo /tmp/out /tmp/work
 mkdir -p /tmp/repo /tmp/out /tmp/work
 tar -C /repo --exclude=./node_modules -cf - . | tar -C /tmp/repo -xf -
 mkdir -p /tmp/repo/node_modules
 for d in /repo/node_modules/*; do n=$(basename "$d"); [ "$n" = "@raid" ] && continue; ln -s "$d" "/tmp/repo/node_modules/$n"; done
 mkdir -p /tmp/repo/node_modules/@raid
 ln -s /tmp/repo/packages/shared /tmp/repo/node_modules/@raid/shared
 ln -s /tmp/repo/packages/server /tmp/repo/node_modules/@raid/server
 ln -s /tmp/repo/packages/client /tmp/repo/node_modules/@raid/client
 LOADER="--experimental-loader /capture/stub-loader.mjs"
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
 first_mismatch() {
   for corpus in doors.json schema-receivers.json wording.json; do
     out=$(node /capture/compare.mjs "/baseline/$corpus" "/tmp/out/$1/$corpus" || true)
     case "$out" in
       FIRST_MISMATCH*) printf "%s|%s" "$corpus" "$(printf "%s" "$out" | head -1)"; return 0 ;;
     esac
   done
   printf "IDENTICAL"
 }
 for patch in /capture/mutants/*.patch; do
   name=$(basename "$patch" .patch)
   case "$name" in *-provenance-only) ;; *) ;; esac
   restore_all
   node /capture/apply-patch.mjs /tmp/repo "$patch"
   rm -rf "/tmp/out/$name"; mkdir -p "/tmp/out/$name"
   if ! RH_QUEST_PUBLIC_RECORD=1 node --import tsx $LOADER /capture/capture.mts --write "/tmp/out/$name" --repo /tmp/repo > "/tmp/out/$name/capture.log" 2>&1; then
     echo "MUTANT $name: capture failed (compile/syntax/runtime), not a semantic kill"; cat "/tmp/out/$name/capture.log"; exit 1
   fi
   got=$(first_mismatch "$name")
   if [ "${RH_QUEST_MUTANTS_DISCOVER:-}" = "1" ]; then
     echo "DISCOVER $name|$got"
     continue
   fi
   expected_row=$(grep "^$name|" /capture/mutants/expected.txt || true)
   [ -n "$expected_row" ] || { echo "mutant $name: missing expected signature"; exit 1; }
   if [ "$expected_row" = "$name|IDENTICAL" ]; then
     [ "$got" = "IDENTICAL" ] || { echo "MUTANT $name: expected IDENTICAL (provenance-only), got $got"; exit 1; }
     echo "NON-KILL (provenance-only) $name: all semantic corpora identical"
     continue
   fi
   [ "$got" != "IDENTICAL" ] || { echo "MUTANT $name: NOT KILLED (all semantic corpora identical)"; exit 1; }
   IFS="|" read -r exp_name exp_file exp_rest <<EXPECTED
$expected_row
EXPECTED
   got_file=${got%%|*}
   got_line=${got#*|}
   [ "$got_file" = "$exp_file" ] || { echo "MUTANT $name: first changed corpus is $got_file, expected $exp_file"; exit 1; }
   exp_full="$exp_rest"
   if [ "$got_line" != "$exp_full" ]; then
     echo "MUTANT $name: unexpected mismatch"
     echo "  got:      $got_line"
     echo "  expected: $exp_full"
     exit 1
   fi
   echo "KILL $name: $got_file $got_line"
 done
 if [ "${RH_QUEST_MUTANTS_DISCOVER:-}" = "1" ]; then exit 0; fi
 echo "== restored control (unmutated /repo, read-only baseline)"
 node --import tsx $LOADER /capture/capture.mts --check /baseline --repo /repo > /tmp/rh-restored.log 2>&1 || { cat /tmp/rh-restored.log; exit 1; }
 node --import tsx /capture/verify.mjs /baseline /repo > /tmp/rh-restored-verify.log 2>&1 || { cat /tmp/rh-restored-verify.log; exit 1; }
 echo "RESTORED CONTROL PASS: the unmutated capture matches the checked-in corpora byte for byte and verify.mjs passes"
 echo "ALL SEMANTIC MUTANTS KILLED; PROVENANCE-ONLY CONTROL NON-KILL"
 '
