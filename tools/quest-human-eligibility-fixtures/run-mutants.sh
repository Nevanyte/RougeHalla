#!/usr/bin/env bash
# Host entry for the P-QUEST-HUMAN-ELIGIBILITY source semantic mutants, pinned linux/amd64 Node 22.23.4. The read-only
# /repo checkout is mounted at /repo; every mutation happens in the container's writable /tmp/repo copy. The inner script
# creates and verifies a complete backup before arming EXIT/INT/TERM/HUP restoration and fails nonzero on any restore or
# verification failure. The host also asserts the protected source paths were untouched before and after.
# RH_QUEST_MUTANT_SIGNAL_TEST=1 runs a real SIGTERM driver: it starts the pinned container detached, waits for the inner
# 'SIGNAL TEST READY' line, sends SIGTERM, waits for the trap, and requires the inner 'SIGNAL_RESTORE_PASS' proof.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
DISCOVER=$(printenv RH_QUEST_MUTANTS_DISCOVER || true)
SELFTEST=$(printenv RH_QUEST_MUTANT_SELFTEST || true)
SIGNAL_TEST=$(printenv RH_QUEST_MUTANT_SIGNAL_TEST || true)
fail() { echo "MUTANTS FAIL: $*" >&2; exit 1; }
for f in packages/server/src/sim/quests.ts crates/rh-sim Cargo.lock; do
  git -C "$REPO" diff --quiet -- "$f" || fail "protected path is already modified before the run: $f"
done
[ -d "$REPO/parity/quest-human-eligibility" ] || fail "missing baseline parity/quest-human-eligibility"
[ -f "$REPO/tools/quest-human-eligibility-fixtures/mutants/expected.txt" ] || fail "missing mutants/expected.txt"
BEFORE=$(git -C "$REPO" status --porcelain -- packages/server/src/sim/quests.ts crates/rh-sim Cargo.lock)
handle_mutants() {
  git -C "$REPO" status --porcelain -- packages/server/src/sim/quests.ts crates/rh-sim Cargo.lock
}
run_container() {
  docker run --rm --platform linux/amd64 -e RH_QUEST_MUTANTS_DISCOVER="$DISCOVER" \
   -e RH_QUEST_MUTANT_SELFTEST="$SELFTEST" -e RH_QUEST_MUTANT_SIGNAL_TEST="$SIGNAL_TEST" \
   --tmpfs /repo/node_modules:rw,exec,size=1500m \
   --mount "type=bind,src=$REPO,dst=/repo,readonly" \
   --mount "type=bind,src=$REPO/tools/quest-human-eligibility-fixtures,dst=/capture,readonly" \
   --mount "type=bind,src=$REPO/parity/quest-human-eligibility,dst=/baseline,readonly" \
   -w /repo "$IMAGE" sh /capture/run-mutants-inner.sh
}
if [ "$SIGNAL_TEST" = "1" ]; then
  SIGDIR=$(mktemp -d /tmp/rh-human-signal.XXXXXX) || fail "mktemp signal workspace failed (fail closed)"
  NAME="rh-human-signal-$$"
  LOG="$SIGDIR/container.log"
  cleanup_signal() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
  trap cleanup_signal EXIT
  docker run -d --name "$NAME" --platform linux/amd64 -e RH_QUEST_MUTANT_SIGNAL_TEST=1 \
   --tmpfs /repo/node_modules:rw,exec,size=1500m \
   --mount "type=bind,src=$REPO,dst=/repo,readonly" \
   --mount "type=bind,src=$REPO/tools/quest-human-eligibility-fixtures,dst=/capture,readonly" \
   --mount "type=bind,src=$REPO/parity/quest-human-eligibility,dst=/baseline,readonly" \
   -w /repo "$IMAGE" sh /capture/run-mutants-inner.sh >/dev/null || fail "signal-test container start failed"
  ready=0
  for _ in $(seq 1 240); do
    if docker logs "$NAME" 2>&1 | grep -q 'SIGNAL TEST READY'; then ready=1; break; fi
    sleep 0.5
  done
  [ "$ready" = "1" ] || { docker logs "$NAME" > "$LOG" 2>&1 || true; fail "signal test never became ready"; }
  docker kill --signal=TERM "$NAME" >/dev/null || fail "could not send SIGTERM to the signal-test container"
  set +e
  docker wait "$NAME" >/dev/null
  set -e
  docker logs "$NAME" > "$LOG" 2>&1 || true
  grep -q 'MUTANTS INTERRUPTED' "$LOG" || { cat "$LOG" >&2; fail "SIGTERM did not interrupt the inner mutant run"; }
  grep -q 'SIGNAL_RESTORE_PASS' "$LOG" || { cat "$LOG" >&2; fail "signal restore proof (SIGNAL_RESTORE_PASS) missing"; }
  if grep -Eq 'MUTANTS FAIL|restore copy failed|restore verify failed|RESTORE/VERIFICATION FAILED|read-only /repo changed' "$LOG"; then cat "$LOG" >&2; fail "signal restore verification reported a failure"; fi
  echo 'SIGNAL TEST READY: mutant applied; waiting for SIGTERM'
  echo 'MUTANTS INTERRUPTED: restoring exact backup bytes'
  echo 'SIGNAL_RESTORE_PASS: exact backup bytes verified after SIGTERM'
else
  run_container
fi
AFTER=$(git -C "$REPO" status --porcelain -- packages/server/src/sim/quests.ts crates/rh-sim Cargo.lock)
[ "$BEFORE" = "$AFTER" ] || fail "protected source/status paths changed during the mutation run"
for f in packages/server/src/sim/quests.ts crates/rh-sim Cargo.lock; do
  git -C "$REPO" diff --quiet -- "$f" || fail "protected path changed during the mutation run: $f"
done
echo "HOST GUARD PASS: packages/server/src/sim/quests.ts, crates/rh-sim and Cargo.lock are unchanged"
