#!/usr/bin/env bash
# Renders named look scenes through the client's real map view to sRGB PNGs, in the Unity editor (batch mode, WITH graphics).
#   look-capture.sh <scene...> --out <dir> [--ground-only] [--quality low|medium|high|ultra]
#   look-capture.sh --list
# Exit: 0 every named scene's <dir>/<scene>.png exists and is non-empty; 1 the run failed (log at <dir>/look-capture.log);
# 2 usage (unknown scene, no scene, no --out); 3 unavailable (no editor, or the project is open in an editor).
# Editor: $RH_UNITY_EDITOR, else the version in ProjectSettings/ProjectVersion.txt under /Applications/Unity/Hub/Editor.
# Library/ is cloned copy-on-write from the main checkout in a worktree without one, as editmode.sh does.
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIST="$PROJECT/Assets/Editor/Look/scenes.txt"
die() { echo "look-capture: $*" >&2; exit 2; }
unavailable() { echo "look-capture: unavailable: $*" >&2; exit 3; }

SCENES=(); OUT=""; GROUND=0; QUALITY=""; HAVE_OUT=0
while (($#)); do
  case "$1" in
    --list) cat "$LIST"; exit 0 ;;
    --out) (($# >= 2)) || die "--out needs a directory"; OUT="$2"; HAVE_OUT=1; shift 2 ;;
    --quality) (($# >= 2)) || die "--quality needs low, medium, high or ultra"; QUALITY="$2"; shift 2 ;;
    --ground-only) GROUND=1; shift ;;
    -*) die "unknown option: $1" ;;
    *) SCENES+=("$1"); shift ;;
  esac
done
((${#SCENES[@]})) || die "no scene named; see --list"
((HAVE_OUT)) && [[ -n "$OUT" ]] || die "--out <dir> is required"
case "$QUALITY" in ""|low|medium|high|ultra) ;; *) die "--quality must be low, medium, high or ultra" ;; esac
for s in "${SCENES[@]}"; do grep -qx -- "$s" "$LIST" || die "unknown scene: $s (see --list)"; done

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
    echo "look-capture: cloning Library/ copy-on-write from $MAIN"
    cp -cR "$MAIN/client-unity/UnityProject/Library" "$PROJECT/Library" || echo "look-capture: clone failed; Unity will reimport" >&2
  fi
fi

# What Unity rewrites on a run: the settings asset and the font assets. A file changed by the run is restored; a file that was
# already modified before the run is left alone, with a warning (an earlier EditMode run may have left it).
REL="client-unity/UnityProject"
TOUCH=("$REL/ProjectSettings/ShaderGraphSettings.asset" "$REL/Assets/Resources/Showcase")
dirty() { git -C "$REPO" status --porcelain -- "${TOUCH[@]}" | sed 's/^...//' | sort; }
DIRTY_BEFORE="$(dirty)"

mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"; LOG="$OUT/look-capture.log"
JOINED="$(IFS=,; echo "${SCENES[*]}")"
ARGS=(-lookScenes "$JOINED" -lookOut "$OUT")
((GROUND)) && ARGS+=(-lookGroundOnly 1)
[[ -n "$QUALITY" ]] && ARGS+=(-lookQuality "$QUALITY")
echo "look-capture: $EDITOR_BIN"
echo "look-capture: ${#SCENES[@]} scene(s) to $OUT, log $LOG"

RC=0
"$EDITOR_BIN" -batchmode -projectPath "$PROJECT" -executeMethod Roguehalla.Editor.LookCapture.Run "${ARGS[@]}" -logFile "$LOG" >/dev/null 2>&1 || RC=$?

while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  if grep -qxF -- "$f" <<<"$DIRTY_BEFORE"; then
    echo "look-capture: warning: $f was already modified before this run; restore it before committing (git checkout -- $f)" >&2
  else
    git -C "$REPO" checkout -- "$f"; echo "look-capture: restored $f"
  fi
done <<<"$(dirty)"

MISSING=()
for s in "${SCENES[@]}"; do [[ -s "$OUT/$s.png" ]] || MISSING+=("$s"); done
if ((RC != 0 || ${#MISSING[@]})); then
  echo "look-capture: FAIL (editor exit $RC; missing PNG: ${MISSING[*]:-none}); last lines of the log:" >&2
  grep -E 'error CS[0-9]+|LookCapture failed' "$LOG" 2>/dev/null | sort -u | head -5 | sed 's/^/  /' >&2 || true
  tail -n 20 "$LOG" 2>/dev/null | sed 's/^/  /' >&2 || true
  exit 1
fi
for s in "${SCENES[@]}"; do echo "look-capture: $OUT/$s.png"; done
