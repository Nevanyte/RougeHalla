#!/usr/bin/env bash
# Isolated runner-safety regression tests: disposable tiny source + mocked commands only.
# Exercises mktemp failure, cp failure/partial backup, HUP/INT/TERM during the backup window,
# restore failure (nonzero + retained recovery bytes), and proof that MUT_FILE arms only after a checked backup.
set -m
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
LIB=$REPO/tools/wish-terminal-fixtures/lib/runner-guard.sh
ROOT=$(mktemp -d /tmp/wish-terminal-guard-test.XXXXXX) || exit 1
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT
. "$LIB"
TARGET=$ROOT/source.ts
printf 'safe original bytes\n' > "$TARGET"
cp "$TARGET" "$ROOT/original"
FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILS=$((FAILS+1)); }
assert_original() { if cmp -s "$TARGET" "$ROOT/original"; then pass "$1"; else fail "$1 (original changed)"; fi; }
reset_guard_env() {
  unset MKTEMP_CMD CP_CMD MUT_BACKUP_TEMPLATE MUT_FORCE_HASHER MUT_SHA256SUM_CMD MUT_SHASUM_CMD
  MUT_FILE=""
  MUT_BACKUP=""
  MUT_ORIGINAL_SHA=""
  MUT_ORIGINAL_SIZE=""
}

# 0. Hasher/digest fail-closed controls for BOTH sha256sum and shasum paths.
cat > "$ROOT/fail-hash" <<'MOCK_EOF'
#!/usr/bin/env bash
exit 1
MOCK_EOF
cat > "$ROOT/empty-hash" <<'MOCK_EOF'
#!/usr/bin/env bash
exit 0
MOCK_EOF
cat > "$ROOT/malformed-hash" <<'MOCK_EOF'
#!/usr/bin/env bash
printf 'not-a-64-hex-digest  %s\n' "$2"
MOCK_EOF
chmod +x "$ROOT/fail-hash" "$ROOT/empty-hash" "$ROOT/malformed-hash"
for hasher in sha256sum shasum; do
  for mock in fail-hash empty-hash malformed-hash; do
    reset_guard_env
    if [ "$hasher" = sha256sum ]; then
      MUT_FORCE_HASHER=sha256sum MUT_SHA256SUM_CMD="$ROOT/$mock"
    else
      MUT_FORCE_HASHER=shasum MUT_SHASUM_CMD="$ROOT/$mock"
    fi
    MUT_BACKUP_TEMPLATE="$ROOT/hash.XXXXXX"
    if mut_backup_source "$TARGET"; then fail "$hasher $mock was accepted"; else pass "$hasher $mock fails closed"; fi
    if [ -z "$MUT_FILE" ]; then pass "$hasher $mock leaves restore unarmed"; else fail "$hasher $mock armed restore"; fi
    assert_original "$hasher $mock"
  done
done

# 1. mktemp failure: fail closed, not armed, original untouched.
reset_guard_env
MKTEMP_CMD=false
if mut_backup_source "$TARGET"; then fail "mktemp failure returned success"; else pass "mktemp failure fails closed"; fi
if [ -z "$MUT_FILE" ]; then pass "mktemp failure leaves restore unarmed"; else fail "mktemp failure armed restore"; fi
assert_original "mktemp failure original bytes"

# 2. cp failure: fail closed, not armed, original untouched.
reset_guard_env
CP_CMD=false
MUT_BACKUP_TEMPLATE="$ROOT/backup.XXXXXX"
if mut_backup_source "$TARGET"; then fail "cp failure returned success"; else pass "cp failure fails closed"; fi
if [ -z "$MUT_FILE" ]; then pass "cp failure leaves restore unarmed"; else fail "cp failure armed restore"; fi
assert_original "cp failure original bytes"

# 3. partial backup: checked size/hash rejects it and never arms.
reset_guard_env
cat > "$ROOT/partial-cp" <<'MOCK_EOF'
#!/usr/bin/env bash
head -c 3 "$1" > "$2"
MOCK_EOF
chmod +x "$ROOT/partial-cp"
CP_CMD="$ROOT/partial-cp"
MUT_BACKUP_TEMPLATE="$ROOT/backup.XXXXXX"
if mut_backup_source "$TARGET"; then fail "partial backup returned success"; else pass "partial backup fails closed"; fi
if [ -z "$MUT_FILE" ]; then pass "partial backup leaves restore unarmed"; else fail "partial backup armed restore"; fi
assert_original "partial backup original bytes"

# 4. complete checked backup arms only after size+hash verification, and restores exactly.
reset_guard_env
MUT_BACKUP_TEMPLATE="$ROOT/backup.XXXXXX"
if mut_backup_source "$TARGET"; then pass "complete backup arms"; else fail "complete backup refused"; fi
if [ -n "$MUT_FILE" ] && [ -f "$MUT_BACKUP" ]; then pass "arm happens after complete backup"; else fail "arm state/backup missing"; fi
if cmp -s "$MUT_BACKUP" "$ROOT/original"; then pass "backup bytes complete"; else fail "backup bytes mismatch"; fi
printf 'mutated bytes\n' > "$TARGET"
if mut_restore_and_finalize; then pass "checked restore succeeds"; else fail "checked restore failed"; fi
assert_original "checked restore original bytes"

# 5. restoration failure: nonzero and recovery bytes retained.
reset_guard_env
MUT_BACKUP_TEMPLATE="$ROOT/recovery.XXXXXX"
if mut_backup_source "$TARGET"; then pass "recovery test arms"; else fail "recovery test could not arm"; fi
printf 'mutated bytes for recovery\n' > "$TARGET"
cat > "$ROOT/fail-cp" <<'MOCK_EOF'
#!/usr/bin/env bash
exit 1
MOCK_EOF
chmod +x "$ROOT/fail-cp"
CP_CMD="$ROOT/fail-cp"
if mut_restore_source; then fail "restore failure returned success"; else pass "restore failure is nonzero"; fi
if [ -n "$MUT_BACKUP" ] && [ -f "$MUT_BACKUP" ]; then pass "restore failure retains recovery bytes"; else fail "restore failure lost recovery bytes"; fi
if cmp -s "$MUT_BACKUP" "$ROOT/original"; then pass "retained recovery bytes are original bytes"; else fail "retained recovery bytes mismatch"; fi
unset CP_CMD
mut_restore_source || fail "cleanup restore failed"
mut_finalize_restore

# 6. HUP/INT/TERM during the backup window: trap sees MUT_FILE unarmed; original untouched.
cat > "$ROOT/slow-cp" <<'MOCK_EOF'
#!/usr/bin/env bash
printf 'started\n' > "$SLOW_MARKER"
sleep 1
cp -- "$1" "$2"
MOCK_EOF
chmod +x "$ROOT/slow-cp"
cat > "$ROOT/signal-child.sh" <<'CHILD_EOF'
#!/usr/bin/env bash
LIB=$1
TARGET=$2
. "$LIB"
emit_armed() {
  if [ -z "$MUT_FILE" ]; then echo ARMED_AFTER_SIGNAL:none; else echo ARMED_AFTER_SIGNAL:armed; fi
}
on_signal() {
  code=$1
  emit_armed
  if ! mut_restore_source; then echo SIGNAL_RESTORE_FAILED; exit 1; fi
  mut_finalize_restore
  exit $code
}
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
mut_backup_source "$TARGET"
echo BACKUP_COMPLETED_BEFORE_SIGNAL
exit 0
CHILD_EOF
chmod +x "$ROOT/signal-child.sh"
for spec in "HUP 129" "INT 130" "TERM 143"; do
  set -- $spec
  sig=$1
  expected=$2
  reset_guard_env
  rm -f "$ROOT/marker"
  export SLOW_MARKER="$ROOT/marker"
  export MKTEMP_CMD=mktemp
  export CP_CMD="$ROOT/slow-cp"
  export MUT_BACKUP_TEMPLATE="$ROOT/signal-backup.XXXXXX"
  bash "$ROOT/signal-child.sh" "$LIB" "$TARGET" > "$ROOT/signal-$sig.log" 2>&1 &
  child=$!
  i=0
  while [ $i -lt 100 ]; do
    if [ -f "$ROOT/marker" ]; then break; fi
    sleep 0.05
    i=$((i+1))
  done
  kill -$sig $child 2>/dev/null
  wait $child
  code=$?
  if [ $code -ne 0 ]; then pass "$sig during backup is nonzero"; else fail "$sig during backup exited zero"; fi
  if grep -q "ARMED_AFTER_SIGNAL:none" "$ROOT/signal-$sig.log"; then pass "$sig during backup leaves restore unarmed"; else fail "$sig during backup saw an armed restore"; fi
  if grep -q "BACKUP_COMPLETED_BEFORE_SIGNAL" "$ROOT/signal-$sig.log"; then fail "$sig signal arrived after backup completed"; else pass "$sig interrupted the backup window"; fi
  assert_original "$sig interrupted backup original bytes"
  unset MKTEMP_CMD CP_CMD MUT_BACKUP_TEMPLATE SLOW_MARKER
done

if [ $FAILS -ne 0 ]; then
  echo "runner safety: $FAILS failure(s)"
  exit 1
fi
echo "runner safety: all checks passed"
