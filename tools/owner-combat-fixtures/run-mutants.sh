#!/usr/bin/env bash
# Compiled semantic controls for OWNER_COMBAT_SOURCE_WITNESS, run in the same pinned linux/amd64 Node 22.23.4 image.
# Every mutant is applied to a disposable copy of the repository under /tmp/repo; the read-only /repo mount is never patched
# and no host source file is touched. Every file any patch touches is restored from /repo before each mutant, so one mutant's
# change can never leak into the next. Each mutant's first semantic mismatch must equal the signature in mutants/expected.txt;
# a mutant marked IDENTICAL there must recapture every corpus semantically identically (a provenance-only change is not a kill).
# The raw capture logs and the output SHA256SUMS are copied into docs/evidence/owner-combat-source/mutants/.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
LOGS="$REPO/docs/evidence/owner-combat-source/mutants"
mkdir -p "$LOGS"
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/owner-combat-fixtures,dst=/capture,readonly" \
 --mount "type=bind,src=$REPO/parity/policy/owner-combat,dst=/baseline,readonly" \
 --mount "type=bind,src=$LOGS,dst=/logs" \
 -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 rm -rf /tmp/repo /tmp/out
 mkdir -p /tmp/repo /tmp/out
 cp -a /repo/. /tmp/repo/
 LOADER="--experimental-loader /capture/client-stub-loader.mjs"
 TOUCHED=$(sed -n "s|^+++ b/||p" /capture/mutants/*.patch | sort -u)
 for patch in /capture/mutants/*.patch; do
   name=$(basename "$patch" .patch)
   expected_row=$(grep "^$name|" /capture/mutants/expected.txt || true)
   [ -n "$expected_row" ] || { echo "mutant $name: missing expected signature"; exit 1; }
   IFS="|" read -r exp_name exp_expect exp_file exp_path exp_value exp_mutant <<EXPECTED
$expected_row
EXPECTED
   [ "$exp_name" = "$name" ] || { echo "mutant $name: malformed expected signature"; exit 1; }
   # Restore every file any patch touches, then apply only this patch: no earlier mutant can survive into this copy.
   for rel in $TOUCHED; do
     cp -a "/repo/$rel" "/tmp/repo/$rel"
   done
   node /capture/apply-patch.mjs /tmp/repo "$patch"
   rm -rf "/tmp/out/$name"
   mkdir -p "/tmp/out/$name"
   if ! RH_OWNER_COMBAT_RECORD=1 node --import tsx $LOADER /capture/capture.mts --write "/tmp/out/$name" --repo /tmp/repo > "/tmp/out/$name/capture.log" 2>&1; then
     echo "MUTANT $name: capture failed (compile/syntax or runtime), not a semantic kill"; cat "/tmp/out/$name/capture.log"; exit 1
   fi
   grep -q "captured 3 corpora" "/tmp/out/$name/capture.log" || { echo "MUTANT $name: capture did not finish"; cat "/tmp/out/$name/capture.log"; exit 1; }
   # The mutated file must really be in the copy: its recorded source hash must differ from the checked-in profile.
   mutated_rel=$(sed -n "s|^+++ b/||p" "$patch" | head -1)
   baseline_hash=$(node /capture/hash-of.mjs /baseline/producer.json "$mutated_rel")
   mutant_hash=$(node /capture/hash-of.mjs "/tmp/out/$name/producer.json" "$mutated_rel")
   [ -n "$mutant_hash" ] || { echo "MUTANT $name: the mutated file is not in the recorded source closure"; exit 1; }
   [ "$mutant_hash" != "$baseline_hash" ] || { echo "MUTANT $name: the mutated file hash did not change (patch did not land)"; exit 1; }
   got=""
   for corpus in producer.json human-projection.json boundaries.json; do
     out=$(node /capture/compare.mjs "/baseline/$corpus" "/tmp/out/$name/$corpus")
     case "$out" in
       FIRST_MISMATCH*) got="$corpus|$(printf "%s" "$out" | head -1)"; break ;;
     esac
   done
   sha256sum "/tmp/out/$name/producer.json" "/tmp/out/$name/human-projection.json" "/tmp/out/$name/boundaries.json" > "/logs/$name-SHA256SUMS"
   cp "/tmp/out/$name/capture.log" "/logs/$name-capture.log"
   if [ "$exp_expect" = "IDENTICAL" ]; then
     if [ -n "$got" ]; then echo "MUTANT $name: expected a semantic survivor, but $got"; exit 1; fi
     echo "SURVIVOR $name: every corpus is semantically identical (provenance only)"
     echo "  mutated source hash $mutant_hash (baseline $baseline_hash) is excluded from the comparison"
     cat "/logs/$name-SHA256SUMS"
     continue
   fi
   [ "$exp_expect" = "KILL" ] || { echo "mutant $name: expected kind must be KILL or IDENTICAL"; exit 1; }
   [ -n "$got" ] || { echo "MUTANT $name: NOT KILLED (every corpus semantically identical)"; exit 1; }
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
   echo "  raw log kept at /tmp/out/$name/capture.log; output sha256 recorded"
   cat "/logs/$name-SHA256SUMS"
 done
 echo "== restored control (unmutated /repo, read-only baseline)"
 node --import tsx $LOADER /capture/capture.mts --check /baseline --repo /repo
 echo "RESTORED CONTROL PASS: the unmutated capture matches the checked-in corpora byte for byte"
 '
