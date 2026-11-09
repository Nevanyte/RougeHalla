#!/usr/bin/env bash
# Focused semantic controls for the owner-combat farm packet, in the same pinned linux/amd64 Node 22.23.4 image.
# Every patch is applied to a disposable copy of the repository under /tmp/repo inside the container; the read-only /repo
# mount is never patched. The semantic mutant must fail the REAL PRODUCER CONSUMER on the actual recorded output; the
# provenance-only comment mutant must survive the same consumer (a provenance hash change is not a semantic kill). The
# final restored unmutated control must match the checked-in corpus byte for byte.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
LOGS="$REPO/docs/evidence/owner-combat-farm/mutants"
mkdir -p "$LOGS"
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/owner-combat-farm-fixtures,dst=/capture,readonly" \
 --mount "type=bind,src=$REPO/parity/policy/owner-combat-farm,dst=/baseline,readonly" \
 --mount "type=bind,src=$LOGS,dst=/logs" \
 -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 rm -rf /tmp/repo /tmp/out
 mkdir -p /tmp/repo /tmp/out
 cp -a /repo/. /tmp/repo/
 TOUCHED=$(sed -n "s|^+++ b/||p" /capture/mutants/*.patch | sort -u)
 for patch in /capture/mutants/*.patch; do
   name=$(basename "$patch" .patch)
   expected_row=$(grep "^$name|" /capture/mutants/expected.txt || true)
   [ -n "$expected_row" ] || { echo "mutant $name: missing expected signature"; exit 1; }
   IFS="|" read -r exp_name exp_expect exp_file exp_path exp_value exp_mutant <<EXPECTED
$expected_row
EXPECTED
   [ "$exp_name" = "$name" ] || { echo "mutant $name: malformed expected signature"; exit 1; }
   for rel in $TOUCHED; do cp -a "/repo/$rel" "/tmp/repo/$rel"; done
   node /capture/apply-patch.mjs /tmp/repo "$patch" | tee "/logs/$name-apply.log"
   rm -rf "/tmp/out/$name"
   mkdir -p "/tmp/out/$name"
   if ! RH_OWNER_COMBAT_FARM_RECORD=1 RH_OWNER_COMBAT_FARM_PINNED=1 node --import tsx /capture/capture.mts --write "/tmp/out/$name" --repo /tmp/repo > "/tmp/out/$name/capture.log" 2>&1; then
     echo "MUTANT $name: capture failed (compile/syntax or runtime), not a semantic kill"; cat "/tmp/out/$name/capture.log"; exit 1
   fi
   grep -q "captured source.json" "/tmp/out/$name/capture.log" || { echo "MUTANT $name: capture did not finish"; cat "/tmp/out/$name/capture.log"; exit 1; }
   sha256sum "/tmp/out/$name/source.json" > "/logs/$name-SHA256SUMS"
   cp "/tmp/out/$name/capture.log" "/logs/$name-capture.log"
   mutated_rel=$(sed -n "s|^+++ b/||p" "$patch" | head -1)
   baseline_hash=$(node /capture/hash-of.mjs /baseline/source.json "$mutated_rel")
   mutant_hash=$(node /capture/hash-of.mjs "/tmp/out/$name/source.json" "$mutated_rel")
   [ -n "$mutant_hash" ] || { echo "MUTANT $name: the mutated file is not in the recorded source closure"; exit 1; }
   [ "$mutant_hash" != "$baseline_hash" ] || { echo "MUTANT $name: the mutated file hash did not change (patch did not land)"; exit 1; }
   set +e
   node --import tsx /capture/verify.mjs --repo /tmp/repo --corpus "/tmp/out/$name/source.json" --semantic-only > "/tmp/out/$name/verify.log" 2>&1
   vrc=$?
   set -e
   cp "/tmp/out/$name/verify.log" "/logs/$name-verify.log" || true
   if [ "$exp_expect" = "IDENTICAL" ]; then
     [ "$vrc" -eq 0 ] || { echo "MUTANT $name: expected a semantic survivor, verifier failed"; cat "/logs/$name-verify.log"; exit 1; }
     node --import tsx /capture/verify.mjs --repo /tmp/repo --corpus "/tmp/out/$name/source.json" --compare /baseline/source.json --semantic-only > "/tmp/out/$name/compare.log" 2>&1 || { echo "MUTANT $name: compare failed"; cat "/tmp/out/$name/compare.log"; exit 1; }
     grep -q "compare identical (excluding /profile)" "/tmp/out/$name/compare.log" || { echo "MUTANT $name: compare was not identical"; cat "/tmp/out/$name/compare.log"; exit 1; }
     cp "/tmp/out/$name/compare.log" "/logs/$name-compare.log"
     echo "SURVIVOR $name: producer consumer passed; compare identical excluding /profile (provenance only)"
     continue
   fi
   [ "$exp_expect" = "KILL" ] || { echo "mutant $name: expected kind must be KILL or IDENTICAL"; exit 1; }
   [ "$vrc" -ne 0 ] || { echo "MUTANT $name: NOT KILLED (producer consumer passed)"; cat "/logs/$name-verify.log"; exit 1; }
   first=$(head -1 "/logs/$name-verify.log")
   if ! printf "%s" "$first" | grep -Eq "^FIRST_MISMATCH frames\[[0-9]+\]\.owner\.asMult expected=1030 actual=1000"; then
     echo "MUTANT $name: unexpected first mismatch"; cat "/logs/$name-verify.log"; exit 1
   fi
   echo "KILL $name: $first"
   echo "  mutated source hash $mutant_hash (baseline $baseline_hash); raw logs and output SHA256SUMS in /logs"
 done
 echo "== restored control (unmutated /repo, read-only baseline)"
 RH_OWNER_COMBAT_FARM_PINNED=1 node --import tsx /capture/capture.mts --check /baseline --repo /repo > /logs/restored-control.log 2>&1
 cat /logs/restored-control.log
 echo "RESTORED CONTROL PASS: the unmutated capture matches the checked-in corpus byte for byte"
 '
