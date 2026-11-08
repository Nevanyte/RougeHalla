#!/usr/bin/env bash
# Compiled semantic negative controls for P-PERCEPTION-WITNESS-1, run in the same pinned linux/amd64 Node 22.23.4 image.
# Each mutant is applied to a writable copy of /repo under /tmp/repo; the read-only /repo mount is never patched. The
# mutated capture must produce the exact first mismatch documented in mutants/expected.txt, otherwise this script fails.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/percept-witness-fixtures,dst=/capture,readonly" \
 --mount "type=bind,src=$REPO/parity/policy/percept-witness,dst=/baseline,readonly" \
 -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 rm -rf /tmp/repo /tmp/out
 mkdir -p /tmp/repo /tmp/out
 cp -a /repo/. /tmp/repo/
 LOADER="--experimental-loader /capture/css-stub-loader.mjs"
 for patch in /capture/mutants/*.patch; do
   name=$(basename "$patch" .patch)
   expected_row=$(grep "^$name|" /capture/mutants/expected.txt)
   [ -n "$expected_row" ] || { echo "mutant $name: missing expected signature"; exit 1; }
   IFS="|" read -r exp_name exp_file exp_path exp_value exp_mutant <<EXPECTED
$expected_row
EXPECTED
   [ "$exp_name" = "$name" ] || { echo "mutant $name: malformed expected signature"; exit 1; }
   while IFS= read -r rel; do
     [ -n "$rel" ] || continue
     cp -a "/repo/$rel" "/tmp/repo/$rel"
   done <<PATCHFILES
$(sed -n "s|^+++ b/||p" "$patch")
PATCHFILES
   node /capture/apply-patch.mjs /tmp/repo "$patch"
   rm -rf "/tmp/out/$name"
   mkdir -p "/tmp/out/$name"
   if ! RH_PERCEPT_WITNESS_RECORD=1 node --import tsx $LOADER /capture/capture.mts --write "/tmp/out/$name" --repo /tmp/repo > "/tmp/out/$name/capture.log" 2>&1; then
     echo "MUTANT $name: capture failed (compile/syntax or runtime), not a semantic kill"; cat "/tmp/out/$name/capture.log"; exit 1
   fi
   grep -q "captured 3 corpora" "/tmp/out/$name/capture.log" || { echo "MUTANT $name: capture did not finish"; cat "/tmp/out/$name/capture.log"; exit 1; }
   got=""
   for corpus in run-summary.json availability.json windup-path.json; do
     out=$(node /capture/compare.mjs "/baseline/$corpus" "/tmp/out/$name/$corpus")
     case "$out" in
       FIRST_MISMATCH*) got="$corpus|$(printf "%s" "$out" | head -1)"; break ;;
     esac
   done
   [ -n "$got" ] || { echo "MUTANT $name: NOT KILLED (corpus semantically identical)"; exit 1; }
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
 echo "== restored control (unmutated /repo, read-only baseline)"
 node --import tsx $LOADER /capture/capture.mts --check /baseline --repo /repo
 echo "RESTORED CONTROL PASS: the unmutated capture matches the checked-in corpora byte for byte"
 echo "ALL 3 SEMANTIC MUTANTS KILLED"
 '
