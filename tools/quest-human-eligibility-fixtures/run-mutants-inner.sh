#!/bin/sh
# Mutation-safety inner runner (pinned linux/amd64 Node 22.23.4 container). The read-only /repo checkout is never edited:
# every mutant is applied to a writable /tmp/repo copy. Before restoration is armed, a complete backup of every mutable
# file is copied from /repo, compared byte for byte, hashed in a sha256 manifest, and self-checked. Traps are installed
# only after that verification; EXIT/INT/TERM/HUP restore the exact backup bytes and re-verify, failing nonzero if any
# restore or verification step fails.
set -eu
fail() { echo "MUTANTS FAIL: $*" >&2; exit 1; }
REPO=/repo
CAPTURE=/capture
BASE=/baseline
DISCOVER=$(printenv RH_QUEST_MUTANTS_DISCOVER || true)
WORK=$(mktemp -d /tmp/rh-mutants.XXXXXX) || fail "mktemp failed (fail closed)"
BACKUP="$WORK/backup"
OUT="$WORK/out"
SELF="$WORK/selfcheck"
MUTABLE="$WORK/mutable-files.txt"
mkdir -p "$BACKUP" "$OUT" "$SELF" || fail "workspace creation"

echo "== pinned mutation run: $WORK"
npm ci --ignore-scripts --no-audit --no-fund > "$WORK/npm-ci.log" 2>&1 || { cat "$WORK/npm-ci.log" >&2; fail "npm ci"; }

# The writable source copy: workspace packages resolve inside the copy; external packages stay in the tmpfs.
rm -rf /tmp/repo
mkdir -p /tmp/repo || fail "copy root"
tar -C "$REPO" --exclude=./node_modules -cf - . | tar -C /tmp/repo -xf - || fail "copy /repo"
mkdir -p /tmp/repo/node_modules /tmp/repo/node_modules/@raid || fail "copy node_modules root"
for d in "$REPO"/node_modules/*; do
  n=$(basename "$d")
  [ "$n" = "@raid" ] && continue
  ln -s "$d" "/tmp/repo/node_modules/$n" || fail "link $n"
done
for pkg in shared server client; do
  [ -d "/tmp/repo/packages/$pkg" ] || fail "missing package $pkg"
  ln -s "/tmp/repo/packages/$pkg" "/tmp/repo/node_modules/@raid/$pkg" || fail "link @raid/$pkg"
done

# Every file any patch can touch, before any mutant is applied.
: > "$MUTABLE"
for patch in "$CAPTURE"/mutants/*.patch; do
  [ -f "$patch" ] || fail "no mutant patches"
  sed -n 's|^+++ b/||p' "$patch" >> "$MUTABLE" || fail "scan $patch"
done
sort -u "$MUTABLE" -o "$MUTABLE" || fail "dedupe mutable files"
[ -s "$MUTABLE" ] || fail "empty mutable-file list"

# COMPLETE VERIFIED BACKUP BEFORE TRAPS. A copy/verify failure here exits nonzero with no restoration armed.
: > "$WORK/repo.manifest"
: > "$WORK/backup.manifest"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  mkdir -p "$BACKUP/$(dirname "$rel")" || fail "backup dir $rel"
  cp -a "$REPO/$rel" "$BACKUP/$rel" || fail "backup copy $rel"
  cmp -s "$REPO/$rel" "$BACKUP/$rel" || fail "backup verify $rel"
  cmp -s "$REPO/$rel" "/tmp/repo/$rel" || fail "writable copy differs $rel"
  h=$(sha256sum "$REPO/$rel" | awk '{print $1}')
  printf '%s  %s\n' "$h" "$rel" >> "$WORK/repo.manifest"
  h2=$(sha256sum "$BACKUP/$rel" | awk '{print $1}')
  printf '%s  %s\n' "$h2" "$rel" >> "$WORK/backup.manifest"
done < "$MUTABLE"
( cd "$BACKUP" && sha256sum -c "$WORK/backup.manifest" >/dev/null ) || fail "backup sha256 manifest"
( cd "$REPO" && sha256sum -c "$WORK/repo.manifest" >/dev/null ) || fail "read-only /repo sha256 manifest"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  mkdir -p "$SELF/$(dirname "$rel")" || fail "selfcheck dir $rel"
  cp -a "$BACKUP/$rel" "$SELF/$rel" || fail "selfcheck copy $rel"
  cmp -s "$BACKUP/$rel" "$SELF/$rel" || fail "selfcheck verify $rel"
done < "$MUTABLE"
echo "== backup verified before traps: $(wc -l < "$MUTABLE") mutable file(s), sha256 manifests and self-check copies"

restore_files() {
  rc=0
  while IFS= read -r rfile; do
    [ -n "$rfile" ] || continue
    if ! cp -a "$BACKUP/$rfile" "/tmp/repo/$rfile"; then echo "restore copy failed: $rfile" >&2; rc=1; continue; fi
    if ! cmp -s "$BACKUP/$rfile" "/tmp/repo/$rfile"; then echo "restore verify failed: $rfile" >&2; rc=1; fi
  done < "$MUTABLE"
  if ! ( cd "$BACKUP" && sha256sum -c "$WORK/backup.manifest" >/dev/null ); then echo "backup manifest failed after restore" >&2; rc=1; fi
  if ! ( cd "$REPO" && sha256sum -c "$WORK/repo.manifest" >/dev/null ); then echo "read-only /repo changed" >&2; rc=1; fi
  if [ "$rc" -ne 0 ]; then
    echo "MUTANTS FAIL: RESTORE/VERIFICATION FAILED" >&2
    trap - EXIT INT TERM HUP
    exit 1
  fi
}
restore_and_disarm() { trap - EXIT INT TERM HUP; restore_files; }
on_signal() {
  echo "MUTANTS INTERRUPTED: restoring exact backup bytes" >&2
  restore_and_disarm
  echo "SIGNAL_RESTORE_PASS: exact backup bytes verified after SIGTERM" >&2
  exit 1
}
trap 'restore_and_disarm' EXIT
trap 'on_signal' INT TERM HUP

SELFTEST=$(printenv RH_QUEST_MUTANT_SELFTEST || true)
SIGNAL_TEST=$(printenv RH_QUEST_MUTANT_SIGNAL_TEST || true)
if [ "$SELFTEST" = "1" ] || [ "$SIGNAL_TEST" = "1" ]; then
  patch=$(ls "$CAPTURE"/mutants/*.patch | head -1)
  node "$CAPTURE/apply-patch.mjs" /tmp/repo "$patch" > "$WORK/selftest-apply.log" 2>&1 || { cat "$WORK/selftest-apply.log" >&2; fail "selftest apply"; }
  target_rel=$(sed -n 's|^+++ b/||p' "$patch" | head -1)
  cmp -s "$REPO/$target_rel" "/tmp/repo/$target_rel" && fail "selftest patch did not change $target_rel"
  if [ "$SIGNAL_TEST" = "1" ]; then
    echo "SIGNAL TEST READY: mutant applied; waiting for SIGTERM"
    sleep 120
  fi
  restore_files
  cmp -s "$REPO/$target_rel" "/tmp/repo/$target_rel" || fail "selftest restore of $target_rel"
  echo "SELFTEST PASS: applied $patch, restored the exact backup bytes, verified $target_rel"
  exit 0
fi

first_mismatch() {
  for corpus in ordinary.json diagnostic.json; do
    if ! out=$(node "$CAPTURE/compare.mjs" "$BASE/$corpus" "$OUT/$1/$corpus" 2>&1); then
      fail "compare failed for $1/$corpus: $out"
    fi
    case "$out" in
      FIRST_MISMATCH*) printf '%s|%s' "$corpus" "$(printf '%s' "$out" | head -1)"; return 0 ;;
    esac
  done
  printf 'IDENTICAL'
}

for patch in "$CAPTURE"/mutants/*.patch; do
  name=$(basename "$patch" .patch)
  restore_files
  node "$CAPTURE/apply-patch.mjs" /tmp/repo "$patch" > "$WORK/$name.apply.log" 2>&1 || { cat "$WORK/$name.apply.log" >&2; fail "apply $name"; }
  sed -n 's|^+++ b/||p' "$patch" > "$WORK/$name.files"
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    cmp -s "$REPO/$rel" "/tmp/repo/$rel" && fail "patch did not change $rel ($name)"
    cmp -s "$BACKUP/$rel" "$REPO/$rel" || fail "/repo changed while applying $name"
  done < "$WORK/$name.files"
  mkdir -p "$OUT/$name" || fail "output dir $name"
  if ! RH_QUEST_MUTANT_RECAPTURE=1 node --import tsx "$CAPTURE/capture.mts" --write "$OUT/$name" --repo /tmp/repo > "$OUT/$name/capture.log" 2>&1; then
    echo "MUTANT $name: capture failed (compile/syntax/runtime), not a semantic kill" >&2
    cat "$OUT/$name/capture.log" >&2
    fail "mutant $name is not a semantic kill"
  fi
  got=$(first_mismatch "$name")
  if [ "$DISCOVER" = "1" ]; then
    echo "DISCOVER $name|$got"
    continue
  fi
  expected_row=$(grep "^$name|" "$CAPTURE/mutants/expected.txt" || true)
  [ -n "$expected_row" ] || fail "mutant $name: missing expected signature"
  expected_value=$(printf '%s' "$expected_row" | cut -d'|' -f2-)
  if [ "$expected_value" = "IDENTICAL" ]; then
    [ "$got" = "IDENTICAL" ] || fail "MUTANT $name: expected IDENTICAL (provenance-only), got $got"
    echo "NON-KILL (provenance-only) $name: semantic corpora identical"
    continue
  fi
  [ "$got" != "IDENTICAL" ] || fail "MUTANT $name: NOT KILLED (both semantic corpora identical)"
  [ "$got" = "$expected_value" ] || {
    echo "MUTANT $name: unexpected mismatch" >&2
    echo "  got:      $got" >&2
    echo "  expected: $expected_value" >&2
    fail "mutant $name signature"
  }
  echo "KILL $name: $got"
done

if [ "$DISCOVER" = "1" ]; then
  echo "DISCOVER COMPLETE (no expectations enforced; restored control follows in the normal run)"
  exit 0
fi

echo "== restored control (unmutated /repo, read-only baseline)"
if ! node --import tsx "$CAPTURE/capture.mts" --check "$BASE" --repo "$REPO" > "$WORK/restored.log" 2>&1; then
  cat "$WORK/restored.log" >&2
  fail "restored control"
fi
echo "RESTORED CONTROL PASS: the unmutated /repo matches the checked-in corpora byte for byte"
echo "ALL SEMANTIC MUTANTS KILLED; PROVENANCE-ONLY CONTROL NON-KILL"
