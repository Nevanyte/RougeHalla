#!/usr/bin/env bash
# Cheap static guard for the controls output selection. Uses a fake repo only; never runs Docker,
# never touches the real canonical corpus, and proves canonical/caller sentinels survive.
set -euo pipefail
REAL=$(cd "$(dirname "$0")/../.." && pwd)
TMP=$(mktemp -d /tmp/walk-hint-guard.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
FAKE="$TMP/repo"
mkdir -p "$FAKE/tools/walk-hint-fixtures" "$FAKE/parity/walk-hint/repair" "$FAKE/parity/walk-hint/legacy"
cp "$REAL/tools/walk-hint-fixtures/capture.sh" "$FAKE/tools/walk-hint-fixtures/capture.sh"
printf 'canonical-sentinel\n' > "$FAKE/parity/walk-hint/repair/source.json"
printf 'canonical-sentinel\n' > "$FAKE/parity/walk-hint/repair/canonical-sentinel"
printf 'legacy-sentinel\n' > "$FAKE/parity/walk-hint/legacy/legacy-sentinel"
mkdir -p "$TMP/caller"
printf 'caller-sentinel\n' > "$TMP/caller/caller-sentinel"
run() { RH_WALK_HINT_OUTPUT="$1" bash "$FAKE/tools/walk-hint-fixtures/capture.sh" --output-guard; }

# Default controls output must be fresh, outside Git, and must not disturb either canonical tree.
DEFAULT_OUT=$(cd "$FAKE" && bash tools/walk-hint-fixtures/capture.sh --output-guard)
case "$DEFAULT_OUT/" in "$FAKE/"*) echo "guard: default controls output inside repo" >&2; exit 1 ;; esac
[ -d "$DEFAULT_OUT" ] || { echo "guard: default controls output missing" >&2; exit 1; }
[ -f "$FAKE/parity/walk-hint/repair/canonical-sentinel" ] || { echo "guard: canonical sentinel deleted" >&2; exit 1; }
[ -f "$FAKE/parity/walk-hint/legacy/legacy-sentinel" ] || { echo "guard: legacy sentinel deleted" >&2; exit 1; }
[ -f "$TMP/caller/caller-sentinel" ] || { echo "guard: caller sentinel deleted" >&2; exit 1; }

# The canonical directory itself (old and new) must be refused, with sentinels intact.
if run "$FAKE/parity/walk-hint/repair" >/dev/null 2>&1; then echo "guard: canonical output accepted" >&2; exit 1; fi
if run "$FAKE/parity/walk-hint/legacy" >/dev/null 2>&1; then echo "guard: legacy canonical output accepted" >&2; exit 1; fi
[ -f "$FAKE/parity/walk-hint/repair/canonical-sentinel" ] || { echo "guard: canonical sentinel deleted after refusal" >&2; exit 1; }

# An arbitrary existing caller directory must be refused, never removed.
if run "$TMP/caller" >/dev/null 2>&1; then echo "guard: existing caller output accepted" >&2; exit 1; fi
[ -f "$TMP/caller/caller-sentinel" ] || { echo "guard: caller sentinel deleted after refusal" >&2; exit 1; }

# A fresh, nonexisting caller output is accepted and remains independent.
TMP_REAL=$(cd "$TMP" && pwd -P)
FRESH="$TMP_REAL/fresh-controls"
OUT=$(run "$FRESH")
[ "$OUT" = "$FRESH" ] || { echo "guard: fresh output mismatch: $OUT" >&2; exit 1; }
[ -d "$FRESH" ] || { echo "guard: fresh output missing" >&2; exit 1; }
[ -f "$FAKE/parity/walk-hint/repair/canonical-sentinel" ] || { echo "guard: canonical sentinel deleted after fresh" >&2; exit 1; }

echo "guard: PASS default=$DEFAULT_OUT fresh=$FRESH canonical/caller sentinels preserved"