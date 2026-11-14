#!/usr/bin/env bash
# The band outline render check (P-UNITY-GROUND-BANDS-1; needs graphics; NOT in the gate).
#   band-outline-check.sh --out <dir> [--max <tiles>]
# Renders a Plague bog pool with the server's marsh bands round it (Assets/Editor/Look/BandOutlineCapture.cs) to <dir>/band-{with,without,without2}.png, then runs
# band-outline-measure.py on them (its docstring says how the outline is found). Exit: 0 measured (and under --max when given); 1 the render failed or the run is
# >= --max; 2 usage; 3 unavailable (no editor, or the project is open in an editor). Same environment rules as look-capture.sh.
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$PROJECT/Tools"
die() { echo "band-outline-check: $*" >&2; exit 2; }
unavailable() { echo "band-outline-check: unavailable: $*" >&2; exit 3; }

OUT=""; MAX=()
while (($#)); do
  case "$1" in
    --out) (($# >= 2)) || die "--out needs a directory"; OUT="$2"; shift 2 ;;
    --max) (($# >= 2)) || die "--max needs a number of tiles"; MAX=(--max "$2"); shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "$OUT" ]] || die "--out <dir> is required"

EDITOR_BIN="${RH_UNITY_EDITOR:-}"
if [[ -z "$EDITOR_BIN" ]]; then
  VERSION="$(sed -n 's/^m_EditorVersion: *//p' "$PROJECT/ProjectSettings/ProjectVersion.txt" | head -1 | tr -d '[:space:]')"
  EDITOR_BIN="/Applications/Unity/Hub/Editor/$VERSION/Unity.app/Contents/MacOS/Unity"
fi
[[ -x "$EDITOR_BIN" ]] || unavailable "no Unity Editor at $EDITOR_BIN (set RH_UNITY_EDITOR)"
[[ ! -e "$PROJECT/Temp/UnityLockfile" ]] || unavailable "the project is open in an Editor (Temp/UnityLockfile exists)"

REPO="$(git -C "$PROJECT" rev-parse --show-toplevel)"
if [[ ! -d "$PROJECT/Library" ]]; then
  MAIN="$(git -C "$REPO" worktree list --porcelain | sed -n '1s/^worktree //p')"
  if [[ -n "$MAIN" && "$MAIN" != "$REPO" && -d "$MAIN/client-unity/UnityProject/Library" ]]; then
    echo "band-outline-check: cloning Library/ copy-on-write from $MAIN"
    cp -cR "$MAIN/client-unity/UnityProject/Library" "$PROJECT/Library" || echo "band-outline-check: clone failed; Unity will reimport" >&2
  fi
fi

REL="client-unity/UnityProject"
TOUCH=("$REL/ProjectSettings/ShaderGraphSettings.asset" "$REL/Assets/Resources/Showcase")
dirty() { git -C "$REPO" status --porcelain -- "${TOUCH[@]}" | sed 's/^...//' | sort; }
DIRTY_BEFORE="$(dirty)"

mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"; LOG="$OUT/band-outline-check.log"
echo "band-outline-check: rendering to $OUT, log $LOG"
RC=0
"$EDITOR_BIN" -batchmode -projectPath "$PROJECT" -executeMethod Roguehalla.Editor.BandOutlineCapture.Run -bandOut "$OUT" -logFile "$LOG" >/dev/null 2>&1 || RC=$?

while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  if grep -qxF -- "$f" <<<"$DIRTY_BEFORE"; then
    echo "band-outline-check: warning: $f was already modified before this run; restore it before committing (git checkout -- $f)" >&2
  else
    git -C "$REPO" checkout -- "$f"; echo "band-outline-check: restored $f"
  fi
done <<<"$(dirty)"

for f in band-with band-without band-without2; do
  if ((RC != 0)) || [[ ! -s "$OUT/$f.png" ]]; then
    echo "band-outline-check: FAIL (editor exit $RC; $f.png missing); last lines of the log:" >&2
    grep -E 'error CS[0-9]+|BandOutlineCapture failed' "$LOG" 2>/dev/null | sort -u | head -5 | sed 's/^/  /' >&2 || true
    tail -n 20 "$LOG" 2>/dev/null | sed 's/^/  /' >&2 || true
    exit 1
  fi
done
exec python3 "$TOOLS/band-outline-measure.py" "$OUT" ${MAX[@]+"${MAX[@]}"}
