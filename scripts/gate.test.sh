#!/usr/bin/env bash
# Checks for the gate's own rules (oracle/stub rule, Postgres environment preflight). Runs on a temporary git repository
# and never builds the workspace: it uses the gate's test hook GATE_STOP_AFTER_CHECKS=1, which makes the gate exit 0
# with the line "GATE STOP (test hook)" right after its path and environment checks.
#   bash scripts/gate.test.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FAILS=0 PASSES=0
ok() { PASSES=$((PASSES + 1)); echo "ok   - $1"; }
bad() { FAILS=$((FAILS + 1)); echo "FAIL - $1"; [[ -z "${2:-}" ]] || sed 's/^/         | /' <<<"$2" | tail -n 15; }

R="$TMP/repo"
mkdir -p "$R/scripts" "$R/docs/agent" "$R/src" "$R/tests"
cd "$R"
git init -q -b main .
git config user.email t@example.com
git config user.name t
cp "$SRC/scripts/gate.sh" scripts/gate.sh
echo main >docs/agent/INTEGRATION_BRANCH
printf '.agent-runs/\n' >.gitignore
echo 0 >src/stub.rs; echo 0 >tests/oracle.rs; echo 0 >src/mixed.rs; echo 0 >src/free.rs
git add -A
git commit -q -m "base"

# packet/X: a stub commit, then an oracle commit (which also touches mixed.rs, first touched by the stub commit).
git checkout -q -b packet/X
echo 1 >src/stub.rs; echo 1 >src/mixed.rs
git commit -q -am "stub: X stubs"
echo 1 >tests/oracle.rs; echo 2 >src/mixed.rs
git commit -q -am "oracle: X failing tests"
# packet/Y: no stub commit at all.
git checkout -q -b packet/Y main
echo 1 >tests/oracle.rs
git commit -q -am "oracle: Y failing tests"

# try <from> <file> <gate args...>: edit <file> on a fresh branch off <from>, commit it, run the gate with the hook.
try() {
  local from="$1" file="$2"; shift 2
  git checkout -q -B work "$from"
  echo changed >>"$file"
  git commit -q -am "work"
  GATE_STOP_AFTER_CHECKS=1 bash scripts/gate.sh "$@" 2>&1
}

rc=0; out="$(try packet/X src/stub.rs --quick --base main --oracle packet/X)" || rc=$?
if [[ $rc -eq 0 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "stub-only file may change"; else bad "stub-only file may change (rc=$rc)" "$out"; fi

rc=0; out="$(try packet/X tests/oracle.rs --quick --base main --oracle packet/X)" || rc=$?
if [[ $rc -ne 0 && "$out" == *"oracle files changed"* && "$out" == *"tests/oracle.rs"* ]]; then ok "oracle-commit file may not change"; else bad "oracle-commit file may not change (rc=$rc)" "$out"; fi

rc=0; out="$(try packet/X src/mixed.rs --quick --base main --oracle packet/X)" || rc=$?
if [[ $rc -ne 0 && "$out" == *"oracle files changed"* && "$out" == *"src/mixed.rs"* ]]; then ok "file touched by a stub and an oracle commit may not change"; else bad "mixed file may not change (rc=$rc)" "$out"; fi

rc=0; out="$(try packet/X src/free.rs --quick --base main --oracle packet/X)" || rc=$?
if [[ $rc -eq 0 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "file no packet commit touched may change"; else bad "untouched file may change (rc=$rc)" "$out"; fi

rc=0; out="$(try packet/Y tests/oracle.rs --quick --base main --oracle packet/Y)" || rc=$?
if [[ $rc -ne 0 && "$out" == *"oracle files changed"* ]]; then ok "branch with no stub: commit treats every touched file as oracle"; else bad "no-stub branch (rc=$rc)" "$out"; fi

# Environment preflight: DATABASE_URL set, PGBIN unusable -> fail before any build, naming the variable.
git checkout -q -B work main
rc=0; out="$(GATE_STOP_AFTER_CHECKS=1 DATABASE_URL=postgres://x@127.0.0.1:1/postgres PGBIN=/nonexistent/pg/bin bash scripts/gate.sh --quick --base main 2>&1)" || rc=$?
if [[ $rc -ne 0 && "$out" == *"PGBIN"* && "$out" != *"== rustfmt"* && "$out" != *"GATE STOP"* ]]; then ok "DATABASE_URL with no usable PGBIN fails early naming PGBIN"; else bad "PGBIN preflight (rc=$rc)" "$out"; fi

# A usable PGBIN passes the preflight.
mkdir -p "$TMP/pgbin"
for t in initdb pg_ctl; do printf '#!/bin/sh\n' >"$TMP/pgbin/$t"; chmod +x "$TMP/pgbin/$t"; done
rc=0; out="$(GATE_STOP_AFTER_CHECKS=1 DATABASE_URL=postgres://x@127.0.0.1:1/postgres PGBIN="$TMP/pgbin" bash scripts/gate.sh --quick --base main 2>&1)" || rc=$?
if [[ $rc -eq 0 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "DATABASE_URL with a usable PGBIN passes the preflight"; else bad "usable PGBIN (rc=$rc)" "$out"; fi

# Without DATABASE_URL the preflight does not apply.
rc=0; out="$(env -u DATABASE_URL GATE_STOP_AFTER_CHECKS=1 PGBIN=/nonexistent/pg/bin bash scripts/gate.sh --quick --base main 2>&1)" || rc=$?
if [[ $rc -eq 0 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "no DATABASE_URL: no Postgres preflight"; else bad "no DATABASE_URL (rc=$rc)" "$out"; fi

echo
echo "$PASSES passed, $FAILS failed"
[[ $FAILS -eq 0 ]]
