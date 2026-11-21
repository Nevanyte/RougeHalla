#!/usr/bin/env bash
# Refresh every pinned copy of the content hash (packet P-CONTENT-REGOLDEN-1).
#
#   scripts/regolden-content.sh --check [--root DIR] [--hash HEX]
#   scripts/regolden-content.sh [--root DIR] [--hash HEX] [--text-only] [--dry-run]
#
# The hash comes from `cargo run -q -p rh-sim --example content_hash` unless --hash is given.
# --check   exit 0 when all six copies hold the hash; else exit 1 and print `STALE <path>` per stale copy.
# regen     rewrites the four text copies in place, then runs the documented commands for the two protected copies
#           (parity/abilities/hash-tape.json, protocol/fixtures/archetypes_v1.json). Those commands compute from the
#           code, so they refuse (exit 2) a foreign --root or a --hash that differs from the code's hash.
# --text-only skips the protected commands; --dry-run edits and runs nothing and prints WOULD EDIT / WOULD RUN lines.
set -euo pipefail

SELF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$SELF_ROOT"
HASH=""
CHECK=0
TEXT_ONLY=0
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$(cd "$2" && pwd)"; shift 2 ;;
    --hash) HASH="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    --text-only) TEXT_ONLY=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "regolden-content.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

export PATH="$HOME/.cargo/bin:$PATH"
CODE_HASH=""
code_hash() {
  if [ -z "$CODE_HASH" ]; then
    CODE_HASH="$(cd "$SELF_ROOT" && cargo run -q -p rh-sim --example content_hash)"
  fi
  printf '%s' "$CODE_HASH"
}

if [ -n "$HASH" ]; then
  if ! [[ "$HASH" =~ ^[0-9a-f]{16}$ ]]; then
    echo "regolden-content.sh: --hash must be 16 lower-case hex digits, got '$HASH'" >&2
    exit 2
  fi
else
  HASH="$(code_hash)"
fi
UND="${HASH:0:4}_${HASH:4:4}_${HASH:8:4}_${HASH:12:4}"

GOLDEN_RS=crates/rh-sim/tests/content.rs
CHECK_MJS=tools/unity-browser-reload-proof/check.mjs
COMPANION_MJS=tools/unity-browser-reload-proof/normal-companion.mjs
BAKED=client-unity/UnityProject/Assets/Scripts/BakedContent.cs
TAPE=parity/abilities/hash-tape.json
ARCH=protocol/fixtures/archetypes_v1.json
TEXT_COPIES=("$GOLDEN_RS" "$CHECK_MJS" "$COMPANION_MJS" "$BAKED")

text_holds() { # path -> 0 when the file holds the hash in its pinned spelling
  case "$1" in
    "$GOLDEN_RS") grep -q "GOLDEN_CONTENT_HASH: u64 = 0x$UND;" "$ROOT/$1" ;;
    "$CHECK_MJS") grep -q "export const CONTENT = '$HASH';" "$ROOT/$1" ;;
    "$COMPANION_MJS") grep -q "EXPECTED_CONTENT_HASH = '$HASH';" "$ROOT/$1" ;;
    "$BAKED") grep -q "ulong Hash = 0x${HASH}UL;" "$ROOT/$1" ;;
  esac
}
json_holds() { # path -> 0 when the JSON's contentHash is the hash
  grep -Eq "\"contentHash\"[[:space:]]*:[[:space:]]*\"$HASH\"" "$ROOT/$1"
}

if [ "$CHECK" = 1 ]; then
  rc=0
  for f in "${TEXT_COPIES[@]}"; do
    text_holds "$f" || { echo "STALE $f"; rc=1; }
  done
  for f in "$TAPE" "$ARCH"; do
    json_holds "$f" || { echo "STALE $f"; rc=1; }
  done
  exit $rc
fi

edit() { # path
  local f="$ROOT/$1"
  case "$1" in
    "$GOLDEN_RS") perl -0pi -e "s/(GOLDEN_CONTENT_HASH: u64 = )0x[0-9a-f_]+;/\${1}0x$UND;/" "$f" ;;
    "$CHECK_MJS") perl -0pi -e "s/(export const CONTENT = ')[0-9a-f]+(';)/\${1}$HASH\${2}/" "$f" ;;
    "$COMPANION_MJS") perl -0pi -e "s/(EXPECTED_CONTENT_HASH = ')[0-9a-f]+(';)/\${1}$HASH\${2}/" "$f" ;;
    "$BAKED") perl -0pi -e "s/(ulong Hash = 0x)[0-9a-fA-F]+(UL;)/\${1}$HASH\${2}/" "$f" ;;
  esac
}

for f in "${TEXT_COPIES[@]}"; do
  if [ "$DRY" = 1 ]; then
    echo "WOULD EDIT $f"
  else
    edit "$f"
    text_holds "$f" || { echo "regolden-content.sh: could not rewrite $f" >&2; exit 2; }
    echo "edited $f"
  fi
done

if [ "$TEXT_ONLY" = 1 ]; then
  exit 0
fi

TAPE_CMD="cargo test -p rh-sim --lib record_ability_hash_tape -- --ignored"
ARCH_CMD="cargo run -p rh-parity --bin hitbox-fixtures"
if [ "$DRY" = 1 ]; then
  echo "WOULD RUN $TAPE_CMD"
  echo "WOULD RUN $ARCH_CMD"
  exit 0
fi
if [ "$ROOT" != "$SELF_ROOT" ]; then
  echo "regolden-content.sh: the protected copies are written from this checkout's code; refusing --root $ROOT" >&2
  exit 2
fi
if [ "$HASH" != "$(code_hash)" ]; then
  echo "regolden-content.sh: --hash $HASH differs from the code's content hash $(code_hash); refusing the protected commands" >&2
  exit 2
fi
cd "$ROOT"
echo "running $TAPE_CMD"
$TAPE_CMD
echo "running $ARCH_CMD"
$ARCH_CMD
