#!/usr/bin/env bash
# Exercise the REAL runner's backup and TERM paths only inside fresh git-archive sandboxes.
# Never copy a backup onto the host source. No source recapture, Docker or semantic-mutant campaign runs here.
set -euo pipefail
set -m
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
SOURCE=packages/server/src/sim/factions.ts
RUNNER=tools/sentenced-npc-group-fixtures/run-mutants.sh
MUTANTS=tools/sentenced-npc-group-fixtures/mutants
SEALED=$(git -C "$REPO" rev-parse HEAD)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/sng-signal.XXXXXX")
ACTIVE_PID=
ACTIVE_GROUP=
CLEANED=0
sha_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}
HOST_SHA=$(sha_of "$REPO/$SOURCE")
HOST_STATUS=$(git -C "$REPO" status --porcelain -- "$SOURCE")
cleanup() {
  local result=$1 i
  if [ "$CLEANED" -eq 1 ]; then exit "$result"; fi
  CLEANED=1
  trap - EXIT HUP INT TERM
  if [ -n "$ACTIVE_PID" ]; then
    if kill -0 "$ACTIVE_PID" 2>/dev/null; then
      if [ -n "$ACTIVE_GROUP" ]; then kill -TERM -- "-$ACTIVE_GROUP" 2>/dev/null || true; else kill -TERM "$ACTIVE_PID" 2>/dev/null || true; fi
      for i in $(seq 1 100); do kill -0 "$ACTIVE_PID" 2>/dev/null || break; sleep 0.05; done
      if kill -0 "$ACTIVE_PID" 2>/dev/null; then
        echo "FAIL: owned runner did not stop; forcing owned job cleanup" >&2
        if [ -n "$ACTIVE_GROUP" ]; then kill -KILL -- "-$ACTIVE_GROUP" 2>/dev/null || true; else kill -KILL "$ACTIVE_PID" 2>/dev/null || true; fi
        result=1
      fi
    fi
    wait "$ACTIVE_PID" 2>/dev/null || true
    ACTIVE_PID=; ACTIVE_GROUP=
  fi
  if [ "$(sha_of "$REPO/$SOURCE")" != "$HOST_SHA" ] || [ "$(git -C "$REPO" status --porcelain -- "$SOURCE")" != "$HOST_STATUS" ]; then
    echo "FAIL: host source changed externally; it was never a restoration destination" >&2
    result=1
  fi
  if [ "$result" -eq 0 ]; then
    if ! rm -rf "$WORK"; then echo "FAIL: sandbox cleanup failed: $WORK" >&2; result=1; fi
  else
    echo "Recovery/evidence sandboxes retained: $WORK" >&2
  fi
  exit "$result"
}
on_exit() { local result=$?; cleanup "$result"; }
trap on_exit EXIT
trap 'cleanup 129' HUP
trap 'cleanup 130' INT
trap 'cleanup 143' TERM
fail() { echo "FAIL: $*" >&2; exit 1; }
mkdir -p "$WORK/shims"
REAL_CP=$(command -v cp)
REAL_MKTEMP=$(command -v mktemp)
# Fault injection affects only the real runner's initial backup copy in its disposable sandbox.
cat >"$WORK/shims/cp" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "$SNG_SOURCE_REL" ]; then
  case "$SNG_COPY_FAULT" in
    fail) exit 65 ;;
    partial-success) head -c 17 "$1" >"$2"; exit 0 ;;
  esac
fi
if [ "${2:-}" = "$SNG_SOURCE_REL" ]; then printf 'restore-copy\n' >>"$SNG_COPY_TRACE"; fi
exec "$SNG_REAL_CP" "$@"
SH
# Keep the pinned runner's own backup/output/log temporaries inside this case, without editing that runner.
cat >"$WORK/shims/mktemp" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -eq 1 ] && [[ "$1" == /tmp/sng-* ]]; then exec "$SNG_REAL_MKTEMP" "$SNG_CASE_TMP/${1##*/}"; fi
exec "$SNG_REAL_MKTEMP" "$@"
SH
cat >"$WORK/shims/docker" <<'SH'
#!/usr/bin/env bash
printf 'unexpected-docker\n' >>"$SNG_DOCKER_TRACE"
echo 'FAIL: signal helper must not run a capture/container' >&2
exit 99
SH
chmod +x "$WORK/shims/cp" "$WORK/shims/mktemp" "$WORK/shims/docker"
new_case() {
  CASE="$WORK/$1"
  mkdir -p "$CASE/repo" "$CASE/tmp"
  # Archive creation and extraction are checked separately; partial extraction cannot write host source.
  git -C "$REPO" archive --format=tar "$SEALED" -- "$SOURCE" "$RUNNER" "$MUTANTS" tools/sentenced-npc-group-fixtures/capture.sh >"$CASE/source.tar"
  tar -xf "$CASE/source.tar" -C "$CASE/repo"
  git -C "$CASE/repo" init -q
  [ -s "$CASE/repo/$SOURCE" ] || fail "empty archived source"
  BASE_SHA=$(sha_of "$CASE/repo/$SOURCE")
  : >"$CASE/copy.trace"
  export SNG_REAL_CP="$REAL_CP" SNG_REAL_MKTEMP="$REAL_MKTEMP" SNG_SOURCE_REL="$SOURCE"
  export SNG_CASE_TMP="$CASE/tmp" SNG_COPY_TRACE="$CASE/copy.trace" SNG_DOCKER_TRACE="$CASE/docker.trace"
}
check_host() {
  [ "$(sha_of "$REPO/$SOURCE")" = "$HOST_SHA" ] || fail "host bytes changed"
  [ "$(git -C "$REPO" status --porcelain -- "$SOURCE")" = "$HOST_STATUS" ] || fail "host source status changed"
}
check_case() {
  [ "$(sha_of "$CASE/repo/$SOURCE")" = "$BASE_SHA" ] || fail "disposable source was not preserved/restored"
  [ ! -e "$CASE/docker.trace" ] || fail "unexpected capture/container attempt"
  check_host
}
fault_case() {
  local kind=$1 code
  new_case "copy-$kind"
  if (cd "$CASE/repo" && env PATH="$WORK/shims:$PATH" TMPDIR="$CASE/tmp" SNG_COPY_FAULT="$kind" bash "$RUNNER") >"$CASE/runner.log" 2>&1; then code=0; else code=$?; fi
  [ "$code" -ne 0 ] || fail "$kind copy was accepted"
  if [ "$kind" = fail ]; then grep -q 'BACKUP COPY FAILED' "$CASE/runner.log" || fail "missing failed-copy guard";
  else grep -q 'BACKUP BYTES MISMATCH' "$CASE/runner.log" || fail "missing partial-copy guard"; fi
  [ ! -s "$CASE/copy.trace" ] || fail "restoration armed after a bad initial copy"
  check_case
  echo "PASS: $kind initial backup copy: exit=$code, zero restore copies, sandbox+host source SHA unchanged"
}
wait_ready() {
  local i
  for i in $(seq 1 100); do
    [ ! -e "$CASE/ready" ] || return 0
    kill -0 "$ACTIVE_PID" 2>/dev/null || return 1
    sleep 0.05
  done
  return 1
}
wait_stopped() {
  local i
  for i in $(seq 1 100); do kill -0 "$ACTIVE_PID" 2>/dev/null || return 0; sleep 0.05; done
  return 1
}
term_case() {
  local mode=$1 code pgid restores
  new_case "term-$mode"
  (
    cd "$CASE/repo"
    if [ "$mode" = before-arm ]; then
      exec env PATH="$WORK/shims:$PATH" TMPDIR="$CASE/tmp" SNG_COPY_FAULT= SNG_TEST_PAUSE_BEFORE_ARM=30 SNG_TEST_PAUSE_AFTER_MUTATION= SNG_TEST_READY_FILE="$CASE/ready" bash "$RUNNER"
    else
      exec env PATH="$WORK/shims:$PATH" TMPDIR="$CASE/tmp" SNG_COPY_FAULT= SNG_TEST_PAUSE_BEFORE_ARM= SNG_TEST_PAUSE_AFTER_MUTATION=30 SNG_TEST_READY_FILE="$CASE/ready" bash "$RUNNER"
    fi
  ) >"$CASE/runner.log" 2>&1 &
  ACTIVE_PID=$!
  pgid=$(ps -o pgid= -p "$ACTIVE_PID" | tr -d ' ')
  [ "$pgid" = "$ACTIVE_PID" ] || fail "runner is not its own owned job group"
  ACTIVE_GROUP=$pgid
  wait_ready || fail "$mode readiness was not reached"
  if [ "$mode" = before-arm ]; then
    [ "$(sha_of "$CASE/repo/$SOURCE")" = "$BASE_SHA" ] || fail "source changed before arming"
  else
    [ "$(sha_of "$CASE/repo/$SOURCE")" != "$BASE_SHA" ] || fail "applied mutation window not reached"
  fi
  # A real TERM goes to only this verified owned job group, including its foreground pause.
  kill -TERM -- "-$ACTIVE_GROUP" || fail "could not signal owned runner group"
  wait_stopped || fail "$mode runner did not exit after TERM"
  if wait "$ACTIVE_PID"; then code=0; else code=$?; fi
  ACTIVE_PID=; ACTIVE_GROUP=
  [ "$code" -eq 143 ] || fail "$mode exit=$code (expected143)"
  restores=$(wc -l <"$CASE/copy.trace" | tr -d ' ')
  if [ "$mode" = before-arm ]; then [ "$restores" -eq 0 ] || fail "pre-arm restoration ran";
  else [ "$restores" -eq 1 ] || fail "expected one restoration, saw$restores"; fi
  if grep -Eq 'RESTORATION FAILED|RESTORE BYTES MISMATCH|manifest.sha256: No such file' "$CASE/runner.log"; then cat "$CASE/runner.log" >&2; fail "$mode restoration error"; fi
  check_case
  echo "PASS: actualTERM $mode: exit143, restore-copies=$restores, sandbox+host source SHA unchanged"
}
fault_case fail
fault_case partial-success
term_case before-arm
term_case mutation
check_host
echo "PASS: host source SHA256=$HOST_SHA; no host restoration destination or capture/container execution"
echo 'signal-path: all four isolated controls passed; SIGINT/HUP delivery and SIGKILL restoration are not claimed'
