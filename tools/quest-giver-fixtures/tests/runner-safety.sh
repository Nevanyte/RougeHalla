#!/usr/bin/env bash
# Disposable runner-safety controls for the quest-giver checked-backup discipline.
# Uses tiny temporary files and mocked cp commands only; never touches the active game source.
set -m
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
LIB=$REPO/tools/quest-giver-fixtures/lib/runner-guard.sh
ROOT=$(mktemp -d /tmp/qg-runner-safety.XXXXXX) || exit 1
cleanup_root(){ rm -rf "$ROOT"; }
trap cleanup_root EXIT
. "$LIB"
TARGET=$ROOT/source.ts
printf 'safe quest-giver source bytes\n' >"$TARGET"
cp "$TARGET" "$ROOT/original"
FAILS=0
pass(){ echo "PASS: $1"; }
fail(){ echo "FAIL: $1"; FAILS=$((FAILS+1)); }
assert_original(){ if cmp -s "$TARGET" "$ROOT/original"; then pass "$1 original untouched"; else fail "$1 original changed"; fi; }
reset_env(){ unset QG_CP; }

# cp failure: checked copy fails, no original overwrite.
reset_env
QG_CP=false
if qg_copy_checked "$TARGET" "$ROOT/backup-fail"; then fail "cp failure returned success"; else pass "cp failure fails closed"; fi
assert_original "cp failure"

# partial cp: size/hash check rejects it.
reset_env
cat >"$ROOT/partial-cp" <<'MOCK_EOF'
#!/usr/bin/env bash
head -c 3 "$1" >"$2"
MOCK_EOF
chmod +x "$ROOT/partial-cp"
QG_CP="$ROOT/partial-cp"
if qg_copy_checked "$TARGET" "$ROOT/backup-partial"; then fail "partial cp returned success"; else pass "partial cp fails closed"; fi
assert_original "partial cp"

# complete checked copy + manifest verify; restore failure is nonzero and retains recovery bytes.
reset_env
mkdir -p "$ROOT/good"
GOOD_BACKUP="$ROOT/good/$(qg_name "$TARGET")"
if qg_copy_checked "$TARGET" "$GOOD_BACKUP"; then pass "checked copy succeeds"; else fail "checked copy failed"; fi
printf '%s  %s\n' "$(qg_sha "$GOOD_BACKUP")" "$TARGET" >"$ROOT/manifest.sha256"
if qg_verify_manifest "$ROOT/manifest.sha256" "$ROOT/good" 1; then pass "complete manifest verifies"; else fail "complete manifest failed"; fi
printf 'mutated disposable bytes\n' >"$TARGET"
cat >"$ROOT/fail-cp" <<'MOCK_EOF'
#!/usr/bin/env bash
exit 1
MOCK_EOF
chmod +x "$ROOT/fail-cp"
QG_CP="$ROOT/fail-cp"
if qg_restore_manifest "$ROOT/manifest.sha256" "$ROOT/good"; then fail "restore failure returned success"; else pass "restore failure is nonzero"; fi
if cmp -s "$GOOD_BACKUP" "$ROOT/original"; then pass "restore failure retains recovery bytes"; else fail "recovery bytes lost"; fi
reset_env
qg_restore_manifest "$ROOT/manifest.sha256" "$ROOT/good" || fail "cleanup restore failed"
if cmp -s "$TARGET" "$ROOT/original"; then pass "cleanup restore exact"; else fail "cleanup restore mismatch"; fi

# HUP/INT/TERM during the backup-copy window: traps must not restore because no target is armed yet.
cat >"$ROOT/slow-cp" <<'MOCK_EOF'
#!/usr/bin/env bash
printf 'started\n' >"$SLOW_MARKER"
sleep 1
cp -- "$1" "$2"
MOCK_EOF
chmod +x "$ROOT/slow-cp"
cat >"$ROOT/backup-child.sh" <<'CHILD_EOF'
#!/usr/bin/env bash
LIB=$1; TARGET=$2; BACKUP=$3
. "$LIB"
ARMED=0
on_signal(){
  code=$1
  if [ "$ARMED" -eq 1 ]; then echo "ARMED_FLAG:armed"; else echo "ARMED_FLAG:none"; fi
  if [ "$ARMED" -eq 1 ]; then exit 1; fi
  exit "$code"
}
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
qg_copy_checked "$TARGET" "$BACKUP"
ARMED=1
echo BACKUP_COMPLETED_BEFORE_SIGNAL
exit 0
CHILD_EOF
chmod +x "$ROOT/backup-child.sh"
for spec in "HUP 129" "INT 130" "TERM 143"; do
  set -- $spec
  sig=$1
  expected=$2
  reset_env
  rm -f "$ROOT/marker"
  export SLOW_MARKER="$ROOT/marker"
  export QG_CP="$ROOT/slow-cp"
  bash "$ROOT/backup-child.sh" "$LIB" "$TARGET" "$ROOT/signal-backup-$sig" >"$ROOT/signal-$sig.log" 2>&1 &
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
  if grep -q "ARMED_FLAG:none" "$ROOT/signal-$sig.log"; then pass "$sig during backup leaves restore unarmed"; else fail "$sig during backup saw an armed restore"; fi
  if grep -q "BACKUP_COMPLETED_BEFORE_SIGNAL" "$ROOT/signal-$sig.log"; then fail "$sig signal arrived after backup completed"; else pass "$sig interrupted the checked-copy window"; fi
  assert_original "$sig during backup"
  unset QG_CP SLOW_MARKER
done

if [ $FAILS -ne 0 ]; then echo "runner safety: $FAILS failure(s)"; exit 1; fi
echo "runner safety: all checks passed"
