#!/usr/bin/env bash
# REAL read-only canonical checks for the repaired Pack Leader source seal.
# POSITIVE: a fresh capture must reproduce the readonly repaired canonical corpus EXACTLY (cmp, all bytes, no stripping).
# NEGATIVE: the same check against a disposable deliberately byte-substituted copy must fail, while the canonical corpus
# bytes stay unchanged (it is mounted read-only). Raw logs go under docs/evidence/pack-leader/repair/checks.
set -euo pipefail
export RH_PACK_LEADER_BASE=${RH_PACK_LEADER_BASE:-db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
LOGS=${RH_PACK_LEADER_CHECKS_LOG:-$REPO/docs/evidence/pack-leader/repair/checks}
CANON=${RH_PACK_LEADER_CANONICAL_DIRECTORY:-$REPO/parity/pack-leader/repair}
[ -f "$CANON/source.json" ] || { echo "Missing repaired canonical corpus: $CANON/source.json" >&2; exit 1; }
mkdir -p "$LOGS"
LOGS=$(cd "$LOGS" && pwd)
CANON=$(cd "$CANON" && pwd)
before=$(sha256sum "$CANON/source.json" | cut -d" " -f1)
set +e
RH_PACK_LEADER_CANONICAL_DIRECTORY="$CANON" bash "$REPO/tools/pack-leader-fixtures/capture.sh" --check > "$LOGS/positive.log" 2>&1
rc_pos=$?
set -e
NEG=$(mktemp -d "${TMPDIR:-/tmp}/rh-pack-leader-neg.XXXXXX")
python3 - "$CANON/source.json" "$NEG/source.json" <<'PY'
import sys
data = bytearray(open(sys.argv[1], 'rb').read())
assert data, 'canonical corpus is empty'
data[-1] = ord('X') if data[-1] != ord('X') else ord('Y')
open(sys.argv[2], 'wb').write(bytes(data))
PY
neg_before=$(sha256sum "$NEG/source.json" | cut -d" " -f1)
set +e
RH_PACK_LEADER_CANONICAL_DIRECTORY="$NEG" bash "$REPO/tools/pack-leader-fixtures/capture.sh" --check > "$LOGS/negative.log" 2>&1
rc_neg=$?
set -e
after=$(sha256sum "$CANON/source.json" | cut -d" " -f1)
neg_after=$(sha256sum "$NEG/source.json" | cut -d" " -f1)
{
 echo "CANONICAL-SHA256-BEFORE $before"
 echo "CANONICAL-SHA256-AFTER  $after"
 echo "POSITIVE-EXIT $rc_pos"
 echo "NEGATIVE-EXIT $rc_neg"
 echo "SUBSTITUTED-COPY-SHA256-BEFORE $neg_before"
 echo "SUBSTITUTED-COPY-SHA256-AFTER  $neg_after"
} > "$LOGS/summary.log"
ok=1
[ "$rc_pos" -eq 0 ] || ok=0
[ "$rc_neg" -ne 0 ] || ok=0
[ "$before" = "$after" ] || ok=0
[ "$neg_before" = "$neg_after" ] || ok=0
if [ "$ok" -eq 1 ]; then echo "CHECKS-GREEN"; else echo "CHECKS-FAILED"; exit 1; fi
