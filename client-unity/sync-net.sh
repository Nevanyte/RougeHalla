#!/usr/bin/env bash
# Copies RoguehallaNet/{Protocol,Net}/*.cs into UnityProject/Assets/RoguehallaNet/ (the asmdef there is hand-written and kept).
# The dotnet library is the source of truth; never edit the Unity copy. `--check` only verifies (exit 1 on drift).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/RoguehallaNet"; dst="$here/UnityProject/Assets/RoguehallaNet"
list() { (cd "$1" && find Protocol Net -name '*.cs' | LC_ALL=C sort); }
if [ "${1:-}" = "--check" ]; then
  status=0
  diff <(list "$src") <(list "$dst") >/dev/null || { echo "file lists differ"; status=1; }
  while read -r f; do cmp -s "$src/$f" "$dst/$f" || { echo "out of date: $f"; status=1; }; done < <(list "$src")
  [ $status -eq 0 ] && echo "Unity copy is up to date"
  exit $status
fi
(cd "$dst" && find Protocol Net -name '*.cs' -delete 2>/dev/null || true)
while read -r f; do mkdir -p "$dst/$(dirname "$f")"; cp "$src/$f" "$dst/$f"; done < <(list "$src")
echo "synced $(list "$src" | wc -l) files into $dst"
