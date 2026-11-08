#!/usr/bin/env bash
# Checked backup/restore primitives for run-mutants.sh. Sourced, never executed directly.
# MUT_FILE is armed only after a completed backup has been checked for size and SHA-256 equality.
MUT_FILE=""
MUT_BACKUP=""
MUT_ORIGINAL_SHA=""
MUT_ORIGINAL_SIZE=""
mut_file_sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
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
