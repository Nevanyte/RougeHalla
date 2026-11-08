#!/usr/bin/env bash
# Compiled semantic negative controls for P-WISH-PUBLIC-WITNESS-1, in the same pinned linux/amd64 Node 22.23.4 image.
# Each patch is applied to a writable copy of /repo under /tmp/repo; the read-only /repo mount is never patched. The
# mutated capture must produce the exact first JSON-path mismatch in mutants/expected.txt or this script fails.
# RH_WISH_MUTANTS_DISCOVER=1 prints the observed first mismatches and skips the signature check (no writes outside
# /tmp; the checked-in corpora are still compared only by the restored-control run at the end).
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e RH_WISH_MUTANTS_DISCOVER="${RH_WISH_MUTANTS_DISCOVER:-}" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/wish-public-fixtures,dst=/capture,readonly" \
 --mount "type=bind,src=$REPO/parity/wish-public,dst=/baseline,readonly" \
 -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 rm -rf /tmp/repo /tmp/out
 mkdir -p /tmp/repo /tmp/out
 cp -a /repo/. /tmp/repo/
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
 for patch in /capture/mutants/*.patch; do
   name=$(basename "$patch" .patch)
   restore_all
   node /capture/apply-patch.mjs /tmp/repo "$patch"
   rm -rf "/tmp/out/$name"; mkdir -p "/tmp/out/$name"
   if ! RH_WISH_PUBLIC_RECORD=1 node --import tsx $LOADER /capture/capture.mts --write "/tmp/out/$name" --repo /tmp/repo > "/tmp/out/$name/capture.log" 2>&1; then
     echo "MUTANT $name: capture failed (compile/syntax/runtime), not a semantic kill"; cat "/tmp/out/$name/capture.log"; exit 1
   fi
   grep -q "mode.*--write" "/tmp/out/$name/capture.log" || { echo "MUTANT $name: capture did not finish"; cat "/tmp/out/$name/capture.log"; exit 1; }
   got=""
   for corpus in r-input.json stock-clocks.json fx-timing.json wishfx-endpoints.json perceive-wish.json; do
     out=$(node /capture/compare.mjs "/baseline/$corpus" "/tmp/out/$name/$corpus")
     case "$out" in
       FIRST_MISMATCH*) got="$corpus|$(printf "%s" "$out" | head -1)"; break ;;
     esac
   done
   if [ "${RH_WISH_MUTANTS_DISCOVER:-}" = "1" ]; then
     echo "DISCOVER $name|$got"
     continue
   fi
   [ -n "$got" ] || { echo "MUTANT $name: NOT KILLED (all five corpora semantically identical)"; exit 1; }
   expected_row=$(grep "^$name|" /capture/mutants/expected.txt || true)
   [ -n "$expected_row" ] || { echo "mutant $name: missing expected signature"; exit 1; }
   IFS="|" read -r exp_name exp_file exp_path exp_value exp_mutant <<EXPECTED
$expected_row
EXPECTED
   [ "$exp_name" = "$name" ] || { echo "mutant $name: malformed expected signature"; exit 1; }
   got_file=${got%%|*}
   got_line=${got#*|}
   [ "$got_file" = "$exp_file" ] || { echo "MUTANT $name: first changed corpus is $got_file, expected $exp_file"; exit 1; }
   expected_line="FIRST_MISMATCH $exp_path expected=$exp_value mutant=$exp_mutant"
   if [ "$got_line" != "$expected_line" ]; then
     echo "MUTANT $name: unexpected mismatch"
     echo "  got:      $got_line"
     echo "  expected: $expected_line"
     exit 1
   fi
   echo "KILL $name: $got_file $got_line"
 done
 if [ "${RH_WISH_MUTANTS_DISCOVER:-}" = "1" ]; then exit 0; fi
 echo "== restored control (unmutated /repo, read-only baseline)"
 node --import tsx $LOADER /capture/capture.mts --check /baseline --repo /repo > /tmp/rh-restored.log 2>&1 || { cat /tmp/rh-restored.log; exit 1; }
 echo "RESTORED CONTROL PASS: the unmutated capture matches the checked-in corpora byte for byte"
 echo "ALL 5 SEMANTIC MUTANTS KILLED"
 '
