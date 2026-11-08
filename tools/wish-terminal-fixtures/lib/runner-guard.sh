#!/usr/bin/env bash
# Checked backup/restore primitives for run-mutants.sh. Sourced, never executed directly.
# MUT_FILE is armed only after a completed backup has been checked for size and SHA-256 equality.
# Hasher failure/empty/malformed digests are fail-closed; test-only hash command overrides are unset in normal use.
MUT_FILE=""
MUT_BACKUP=""
MUT_ORIGINAL_SHA=""
MUT_ORIGINAL_SIZE=""
mut_digest_valid() {
  digest=$1
  [ -n "$digest" ] || return 1
  case "$digest" in
    *[!0-9a-f]*)
      return 1
      ;;
  esac
  len=$(printf '%s' "$digest" | wc -c | tr -d ' ')
  [ "$len" -eq 64 ] || return 1
  return 0
}
mut_file_sha() {
  local hasher out digest cmd force
  force="$MUT_FORCE_HASHER"
  if [ "$force" = sha256sum ]; then
    cmd="$MUT_SHA256SUM_CMD"
    [ -n "$cmd" ] || cmd=sha256sum
    out=$("$cmd" "$1") || { echo "hash: sha256sum command failed" >&2; return 1; }
  elif [ "$force" = shasum ]; then
    cmd="$MUT_SHASUM_CMD"
    [ -n "$cmd" ] || cmd=shasum
    out=$("$cmd" -a 256 "$1") || { echo "hash: shasum command failed" >&2; return 1; }
  elif command -v sha256sum >/dev/null 2>&1; then
    out=$(sha256sum "$1") || { echo "hash: sha256sum command failed" >&2; return 1; }
  else
    out=$(shasum -a 256 "$1") || { echo "hash: shasum command failed" >&2; return 1; }
  fi
  digest=$(printf '%s\n' "$out" | cut -d' ' -f1) || { echo "hash: cannot parse digest" >&2; return 1; }
  if ! mut_digest_valid "$digest"; then
    echo "hash: empty or malformed digest; refusing" >&2
    return 1
  fi
  printf '%s' "$digest"
}
mut_file_size() {
  wc -c < "$1" | tr -d ' '
}
mut_backup_source() {
  if [ "$#" -ne 1 ]; then return 2; fi
  file=$1
  MUT_FILE=""
  MUT_BACKUP=""
  MUT_ORIGINAL_SHA=""
  MUT_ORIGINAL_SIZE=""
  if [ ! -f "$file" ]; then
    echo "backup: missing source $file" >&2
    return 1
  fi
  size=$(mut_file_size "$file") || return 1
  if [ "$size" -le 0 ]; then
    echo "backup: source $file is empty; refusing to arm" >&2
    return 1
  fi
  sha=$(mut_file_sha "$file") || return 1
  if ! mut_digest_valid "$sha"; then echo "backup: invalid source digest; refusing to arm" >&2; return 1; fi
  mktemp_cmd="$MKTEMP_CMD"
  [ -n "$mktemp_cmd" ] || mktemp_cmd=mktemp
  template="$MUT_BACKUP_TEMPLATE"
  [ -n "$template" ] || template=/tmp/wish-terminal-mut-backup.XXXXXX
  backup=$("$mktemp_cmd" "$template")
  rc=$?
  if [ $rc -ne 0 ] || [ -z "$backup" ]; then
    echo "backup: mktemp failed; refusing to arm" >&2
    return 1
  fi
  cp_cmd="$CP_CMD"
  [ -n "$cp_cmd" ] || cp_cmd=cp
  if ! "$cp_cmd" "$file" "$backup"; then
    echo "backup: copy failed; refusing to arm (original untouched)" >&2
    rm -f "$backup"
    return 1
  fi
  if [ ! -f "$backup" ]; then
    echo "backup: copy produced no file; refusing to arm" >&2
    rm -f "$backup"
    return 1
  fi
  backup_size=$(mut_file_size "$backup") || { rm -f "$backup"; return 1; }
  backup_sha=$(mut_file_sha "$backup") || { rm -f "$backup"; return 1; }
  if ! mut_digest_valid "$backup_sha"; then echo "backup: invalid backup digest; refusing to arm" >&2; rm -f "$backup"; return 1; fi
  if [ "$backup_size" != "$size" ] || [ "$backup_sha" != "$sha" ]; then
    echo "backup: partial/mismatched copy; refusing to arm (original untouched)" >&2
    rm -f "$backup"
    return 1
  fi
  MUT_FILE=$file
  MUT_BACKUP=$backup
  MUT_ORIGINAL_SHA=$sha
  MUT_ORIGINAL_SIZE=$size
  return 0
}
# Copy the checked recovery bytes back and verify them. The backup is retained until
# mut_finalize_restore succeeds, so a restoration failure always leaves recovery bytes behind.
mut_restore_source() {
  if [ -z "$MUT_FILE" ]; then return 0; fi
  if [ -z "$MUT_BACKUP" ] || [ ! -f "$MUT_BACKUP" ]; then
    echo "restore: missing recovery bytes; cannot restore $MUT_FILE" >&2
    return 1
  fi
  if ! mut_digest_valid "$MUT_ORIGINAL_SHA"; then
    echo "restore: original digest empty/malformed; recovery bytes retained at $MUT_BACKUP" >&2
    return 1
  fi
  cp_cmd="$CP_CMD"
  [ -n "$cp_cmd" ] || cp_cmd=cp
  file=$MUT_FILE
  backup=$MUT_BACKUP
  if ! "$cp_cmd" "$backup" "$file"; then
    echo "restore: copy failed; recovery bytes retained at $backup" >&2
    return 1
  fi
  restored_sha=$(mut_file_sha "$file") || {
    echo "restore: cannot hash restored file; recovery bytes retained at $backup" >&2
    return 1
  }
  if ! mut_digest_valid "$restored_sha"; then
    echo "restore: restored digest empty/malformed; recovery bytes retained at $backup" >&2
    return 1
  fi
  if [ "$restored_sha" != "$MUT_ORIGINAL_SHA" ]; then
    echo "restore: restored bytes mismatch; recovery bytes retained at $backup" >&2
    return 1
  fi
  return 0
}
mut_finalize_restore() {
  if [ -n "$MUT_BACKUP" ]; then rm -f "$MUT_BACKUP"; fi
  MUT_FILE=""
  MUT_BACKUP=""
  MUT_ORIGINAL_SHA=""
  MUT_ORIGINAL_SIZE=""
}
mut_restore_and_finalize() {
  mut_restore_source || return 1
  mut_finalize_restore
}
