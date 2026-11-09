#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 2 ] || exit 2
REPO=$(cd "$(dirname "$0")/../.." && pwd)
HEAD_REF=$(git -C "$REPO" rev-parse --verify "$1^{commit}")
OUTPUT=$2
mkdir -p "$OUTPUT/repo"
OUTPUT=$(cd "$OUTPUT" && pwd)
[ ! -e "$OUTPUT/repo/package.json" ] || { echo 'export destination must be fresh' >&2; exit 2; }
git -C "$REPO" archive "$HEAD_REF" packages package.json package-lock.json tsconfig.base.json tools/bot-fight-fixtures/cases.mts tools/bot-reflex-fixtures parity/policy/bot-reflex | tar -x -C "$OUTPUT/repo"
printf '%s\n' "$HEAD_REF" > "$OUTPUT/export-head.txt"
bash "$OUTPUT/repo/tools/bot-reflex-fixtures/capture.sh" --check
