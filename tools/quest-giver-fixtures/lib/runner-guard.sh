#!/usr/bin/env bash
# Checked multi-file backup/restore primitives for tools/quest-giver-fixtures/run-mutants.sh.
# Sourced, not executed. Backups must be nonempty and SHA-256-identical before a caller may arm restoration.
qg_sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}
qg_name() { printf '%s' "$1" | sed 's#/#__#g'; }
qg_copy_checked() {
  if [ "$#" -ne 2 ]; then return 2; fi
  src=$1; dst=$2
  [ -f "$src" ] || { echo "backup: missing $src" >&2; return 1; }
  cp_cmd="$QG_CP"
  [ -n "$cp_cmd" ] || cp_cmd=cp
  if ! "$cp_cmd" "$src" "$dst"; then echo "backup: copy failed for $src" >&2; return 1; fi
  [ -f "$dst" ] && [ -s "$dst" ] || { echo "backup: empty/missing $dst" >&2; return 1; }
  src_sha=$(qg_sha "$src") || return 1
  dst_sha=$(qg_sha "$dst") || return 1
  if [ "$src_sha" != "$dst_sha" ]; then echo "backup: bytes mismatch for $src" >&2; return 1; fi
  return 0
}
qg_verify_manifest() {
  if [ "$#" -ne 3 ]; then return 2; fi
  manifest=$1; backup_dir=$2; expected=$3
  verified=0
  while read -r want f; do
    b="$backup_dir/$(qg_name "$f")"
    [ -f "$b" ] && [ -s "$b" ] || { echo "manifest: missing backup $b" >&2; return 1; }
    got=$(qg_sha "$b") || return 1
    src=$(qg_sha "$f") || return 1
    if [ "$got" != "$want" ] || [ "$src" != "$want" ]; then echo "manifest: mismatch for $f" >&2; return 1; fi
    verified=$((verified+1))
  done <"$manifest"
  if [ "$verified" -ne "$expected" ]; then echo "manifest: incomplete $verified/$expected" >&2; return 1; fi
  return 0
}
qg_restore_manifest() {
  if [ "$#" -ne 2 ]; then return 2; fi
  manifest=$1; backup_dir=$2
  local restore_status=0
  cp_cmd="$QG_CP"
  [ -n "$cp_cmd" ] || cp_cmd=cp
  while read -r want f; do
    b="$backup_dir/$(qg_name "$f")"
    [ -f "$b" ] && [ -s "$b" ] || { echo "restore: missing backup $b" >&2; restore_status=1; continue; }
    if ! "$cp_cmd" "$b" "$f"; then echo "restore: copy failed for $f; recovery bytes retained at $b" >&2; restore_status=1; continue; fi
    now=$(qg_sha "$f") || { echo "restore: cannot hash $f; recovery bytes retained at $b" >&2; restore_status=1; continue; }
    if [ "$now" != "$want" ]; then echo "restore: bytes mismatch for $f; recovery bytes retained at $b" >&2; restore_status=1; fi
  done <"$manifest"
  return "$restore_status"
}
