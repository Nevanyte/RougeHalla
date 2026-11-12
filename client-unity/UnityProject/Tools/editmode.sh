#!/usr/bin/env bash
# Runs the Unity EditMode suite in batch mode and prints totals, failed tests (with messages) and compile errors.
#   client-unity/UnityProject/Tools/editmode.sh
# Exit: 0 every test passed; 1 failures or compile errors; 3 unavailable (no Editor installed, or the project is open
# in an Editor), so a caller can report a named skip instead of a pass.
# Editor: $RH_UNITY_EDITOR, else the version in ProjectSettings/ProjectVersion.txt under /Applications/Unity/Hub/Editor.
# In a git worktree without Library/, the Library of the main checkout (first path of `git worktree list`) is cloned
# copy-on-write (cp -cR) so the first run does not reimport everything.
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(git -C "$PROJECT" rev-parse --show-toplevel)"
unavailable() { echo "editmode: unavailable: $*" >&2; exit 3; }

EDITOR_BIN="${RH_UNITY_EDITOR:-}"
if [[ -z "$EDITOR_BIN" ]]; then
  VERSION="$(sed -n 's/^m_EditorVersion: *//p' "$PROJECT/ProjectSettings/ProjectVersion.txt" | head -1 | tr -d '[:space:]')"
  EDITOR_BIN="/Applications/Unity/Hub/Editor/$VERSION/Unity.app/Contents/MacOS/Unity"
fi
[[ -x "$EDITOR_BIN" ]] || unavailable "no Unity Editor at $EDITOR_BIN (set RH_UNITY_EDITOR)"
[[ ! -e "$PROJECT/Temp/UnityLockfile" ]] || unavailable "the project is open in an Editor (Temp/UnityLockfile exists)"

if [[ ! -d "$PROJECT/Library" ]]; then
  MAIN="$(git -C "$REPO" worktree list --porcelain | sed -n '1s/^worktree //p')"
  if [[ -n "$MAIN" && "$MAIN" != "$REPO" && -d "$MAIN/client-unity/UnityProject/Library" ]]; then
    echo "editmode: cloning Library/ copy-on-write from $MAIN"
    cp -cR "$MAIN/client-unity/UnityProject/Library" "$PROJECT/Library" || { rm -rf "$PROJECT/Library"; echo "editmode: clone failed; Unity will reimport" >&2; }
  fi
fi

ASSET="client-unity/UnityProject/Assets/Resources/Showcase/NunitoBold.asset"
ASSET_CLEAN=0
[[ -z "$(git -C "$REPO" status --porcelain -- "$ASSET")" ]] && ASSET_CLEAN=1
metas() { git -C "$REPO" ls-files --others --exclude-standard -- client-unity/UnityProject/Assets | grep '\.meta$' | sort || true; }
METAS_BEFORE="$(metas)"

# Unity rejects result paths under a dot-directory, so keep them in a plain temporary directory.
OUT="$(mktemp -d "${TMPDIR:-/tmp}/rh-editmode.XXXXXX")"
RESULTS="$OUT/results.xml" LOG="$OUT/editor.log"
echo "editmode: $EDITOR_BIN"
echo "editmode: results $RESULTS, log $LOG"

RC=0
"$EDITOR_BIN" -batchmode -nographics -projectPath "$PROJECT" -runTests -testPlatform EditMode \
  -testResults "$RESULTS" -logFile "$LOG" >/dev/null 2>&1 || RC=$?

# Leave the tree as found.
if ((ASSET_CLEAN)) && [[ -n "$(git -C "$REPO" status --porcelain -- "$ASSET")" ]]; then
  git -C "$REPO" checkout -- "$ASSET"
  echo "editmode: restored NunitoBold.asset"
fi
NEW_METAS="$(comm -13 <(printf '%s\n' "$METAS_BEFORE") <(metas) | grep -v '^$' || true)"
if [[ -n "$NEW_METAS" ]]; then
  echo "editmode: untracked .meta files left under Assets/ (track them if they belong to new scripts):"
  sed 's/^/  /' <<<"$NEW_METAS"
fi

CS_ERRORS="$(grep -E 'error CS[0-9]+' "$LOG" 2>/dev/null | sort -u || true)"
if [[ -n "$CS_ERRORS" ]]; then
  echo "editmode: compile errors:"
  sed 's/^/  /' <<<"$CS_ERRORS"
fi
if [[ ! -s "$RESULTS" ]]; then
  echo "editmode: FAIL: no results file (editor exit $RC); last lines of the log:"
  tail -n 20 "$LOG" 2>/dev/null | sed 's/^/  /' || true
  exit 1
fi

node - "$RESULTS" <<'JS' || exit 1
const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const run = /<test-run\b[^>]*>/.exec(xml);
const attr = (tag, name) => { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag || ''); return m ? m[1] : '0'; };
const total = +attr(run && run[0], 'total'), passed = +attr(run && run[0], 'passed'), failed = +attr(run && run[0], 'failed');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
console.log(`editmode: total ${total}, passed ${passed}, failed ${failed}`);
const cases = xml.match(/<test-case\b[\s\S]*?<\/test-case>/g) || [];
for (const c of cases) {
  const head = /<test-case\b[^>]*>/.exec(c)[0];
  if (attr(head, 'result') !== 'Failed') continue;
  const msg = /<message>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/message>/.exec(c);
  console.log(`  FAILED ${unesc(attr(head, 'fullname'))}`);
  if (msg) console.log(unesc(msg[1] !== undefined ? msg[1] : msg[2]).trim().split('\n').map((l) => '    ' + l).join('\n'));
}
process.exit(failed === 0 && total > 0 && passed === total ? 0 : 1);
JS
echo "editmode: PASS"
