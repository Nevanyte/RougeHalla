#!/usr/bin/env bash
# RogueHalla acceptance gate. An agent's work is done when this script says GATE PASS, not when the agent thinks so.
#
#   scripts/gate.sh --quick                     iterate: fmt, then clippy/tests/checks for the crates and areas you changed
#   scripts/gate.sh                             full local gate: everything below that runs on a Mac (the hand-off gate)
#   scripts/gate.sh --oracle packet/<ID>        also: oracle files (packet commits, captures, golden vectors, packages/) untouched
#   scripts/gate.sh --base <ref>                compare against <ref> instead of the integration branch
#
# Exceptions (each needs the approval named in AGENTS.md "Protected paths"; say which you used in the hand-off):
#   --allow-protected   hosting/, .github/, .claude/, packages/, scripts/gate.sh, AGENTS.md/CLAUDE.md files (owner approval)
#   --coordinator       shared status records: Cargo.lock, docs/MIGRATION.md, docs/CONTRACTS.md, ... (coordinator only)
#   --regen-fixtures    protocol/fixtures/ may change (wire-format packets; regenerated only by the documented command)
#
# Postgres: export DATABASE_URL (eval "$(tools/pgtest/start.sh)") to include the Postgres suites; without it they are
# skipped and the result line says so. Logs: .agent-runs/gate/. CI (.github/workflows/rust.yml) remains the final word;
# the full gate prints the CI-only checks it did not run.
set -euo pipefail

MODE=full BASE="" ORACLE="" ALLOW_PROTECTED=0 COORD=0 REGEN=0
while (($#)); do
  case "$1" in
    --quick) MODE=quick ;;
    --full) MODE=full ;;
    --base) BASE="${2:?--base needs a ref}"; shift ;;
    --oracle) ORACLE="${2:?--oracle needs a ref}"; shift ;;
    --allow-protected) ALLOW_PROTECTED=1 ;;
    --coordinator) COORD=1 ;;
    --regen-fixtures) REGEN=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)"; exit 2 ;;
  esac
  shift
done

ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
command -v cargo >/dev/null 2>&1 || export PATH="$HOME/.cargo/bin:$PATH"
command -v dotnet >/dev/null 2>&1 || { [[ -x "$HOME/.dotnet/dotnet" ]] && export PATH="$HOME/.dotnet:$PATH"; } || true

if [[ -z "$BASE" ]]; then
  BASE="${GATE_BASE:-$(tr -d '[:space:]' < docs/agent/INTEGRATION_BRANCH 2>/dev/null || true)}"
  [[ -n "$BASE" ]] || { echo "GATE FAIL: no base: pass --base <ref> or fill docs/agent/INTEGRATION_BRANCH"; exit 1; }
fi
git rev-parse --verify -q "$BASE^{commit}" >/dev/null || { echo "GATE FAIL: base '$BASE' is not a commit"; exit 1; }
MB="$(git merge-base HEAD "$BASE")"

BRANCH="$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"
mkdir -p .agent-runs/gate
LOG=".agent-runs/gate/$(date +%Y%m%dT%H%M%S)-${BRANCH}-${MODE}.log"
STEP_LOG="$(mktemp)"
# rh-pgtest clusters already present when the gate starts are not ours to stop (the one DATABASE_URL points at, or another
# session's); any other that appears during the run is stopped on exit.
PGT_TMP="${TMPDIR:-/tmp}"; PGT_TMP="${PGT_TMP%/}"
pgtest_dirs() { { ls -d "$PGT_TMP"/rh-pgtest.* /tmp/rh-pgtest.* 2>/dev/null || true; } | sort -u; }
PGT_BEFORE="$(pgtest_dirs)"
cleanup() {
  rm -f "$STEP_LOG"
  local d port bin="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
  while read -r d; do
    [[ -n "$d" && -f "$d/data/postmaster.pid" ]] || continue
    if grep -qxF "$d" <<<"$PGT_BEFORE"; then continue; fi
    port="$(sed -n 4p "$d/data/postmaster.pid" 2>/dev/null || true)"
    if [[ -n "$port" && "${DATABASE_URL:-}" == *":$port/"* ]]; then continue; fi
    [[ -x "$bin/pg_ctl" ]] || bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
    "$bin/pg_ctl" -D "$d/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$d"
    echo "gate: stopped rh-pgtest cluster started during this run: $d" >&2
  done <<<"$(pgtest_dirs)"
}
trap cleanup EXIT
exec > >(tee "$LOG") 2>&1

SKIPPED=()
fail() { echo; echo "GATE FAIL: $*"; echo "log: $LOG"; exit 1; }
note() { echo "   - $*"; }
run() { # run <name> <cmd...>: stop at the first red step and show its last 40 lines
  local name="$1"; shift
  echo "== $name"
  echo "   \$ $*"
  if ! "$@" >"$STEP_LOG" 2>&1; then
    cat "$STEP_LOG" >>"$LOG"
    echo "---- last 40 lines of '$name' ----"; tail -n 40 "$STEP_LOG"
    fail "$name"
  fi
  cat "$STEP_LOG" >>"$LOG"
}

CHANGED="$( { git diff --name-only "$MB"; git ls-files --others --exclude-standard; } | sort -u)"
echo "gate: mode=$MODE base=$BASE merge-base=${MB:0:10} head=$(git rev-parse --short HEAD) changed=$(grep -c . <<<"$CHANGED" || true) files"

# ---------- path checks ----------------------------------------------------------------------------------------------
echo "== path checks"
match() { grep -E "$1" <<<"$CHANGED" || true; }

PROTECTED_RE='^(hosting/|\.github/|\.claude/|packages/|scripts/gate\.sh$)|(^|/)(AGENTS|CLAUDE)\.md$'
SHARED_RE='^(Cargo\.lock|docs/MIGRATION\.md|docs/CONTRACTS\.md|docs/PROJECT_COORDINATION\.md|docs/agent/INTEGRATION_BRANCH)$'
CAPTURE_RE='^(parity/.*\.json|protocol/fixtures/)'

bad="$(match "$PROTECTED_RE")"
if [[ -n "$bad" ]]; then
  ((ALLOW_PROTECTED)) || fail "protected paths changed (owner approval, then --allow-protected):"$'\n'"$bad"
  note "protected paths changed under --allow-protected: $(tr '\n' ' ' <<<"$bad")"
fi
bad="$(match "$SHARED_RE")"
if [[ -n "$bad" ]]; then
  ((COORD)) || fail "shared status records changed (coordinator only; list proposed edits in the hand-off):"$'\n'"$bad"
  note "shared records changed under --coordinator: $(tr '\n' ' ' <<<"$bad")"
fi
if [[ -n "$ORACLE" ]]; then
  git rev-parse --verify -q "$ORACLE^{commit}" >/dev/null || fail "oracle ref '$ORACLE' is not a commit"
  # Oracle = every file touched by the commits in merge-base(<ref>, base)..<ref> whose subject does not start with
  # "stub:" (stub files are what an implementer replaces), plus captured fixtures and golden vectors below. Merge
  # commits count as non-stub. A branch with no "stub:" commit has every touched file as an oracle file.
  ORACLE_FILES="$(
    git log --format='%H %s' "$(git merge-base "$ORACLE" "$BASE")..$ORACLE" | while read -r sha subject; do
      if [[ "$subject" == stub:* ]]; then continue; fi
      git diff-tree -r -m --root --no-commit-id --name-only "$sha"
    done | sort -u
  )"
  SINCE="$( { git diff --name-only "$ORACLE"; git ls-files --others --exclude-standard; } | sort -u)"
  bad="$(comm -12 <(sort -u <<<"$ORACLE_FILES") <(sort -u <<<"$SINCE") | grep -v '^$' || true)"
  [[ -z "$bad" ]] || fail "oracle files changed since $ORACLE:"$'\n'"$bad"
  bad="$(grep -E "$CAPTURE_RE" <<<"$SINCE" || true)"
  ((REGEN)) && bad="$(grep -vE '^protocol/fixtures/' <<<"$bad" || true)"
  [[ -z "$bad" ]] || fail "captured fixtures or golden vectors changed since $ORACLE (regenerate only via the documented commands, with --regen-fixtures for wire packets):"$'\n'"$bad"
fi
if grep -qE '(^|/)Cargo\.toml$' <<<"$CHANGED"; then
  note "WARNING: a Cargo.toml changed. New dependencies need coordinator approval; the coordinator regenerates Cargo.lock."
fi
if git diff "$MB" -- 'crates/*.rs' | grep -qE '^\+.*allow\(clippy::disallowed_(types|methods)\)'; then
  note "WARNING: new allow(clippy::disallowed_*) in the diff. Each needs its reason beside it; the reviewer checks it (ADR 0007)."
fi

# ---------- environment preflight ------------------------------------------------------------------------------------
# With DATABASE_URL set the Postgres suites run and one rh-server test needs PGBIN: resolve it as tools/pgtest does, or
# fail before any build.
if [[ -n "${DATABASE_URL:-}" ]]; then
  if [[ -z "${PGBIN:-}" ]]; then
    for d in /opt/homebrew/opt/postgresql@16/bin "$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"; do
      if [[ -n "$d" && -x "$d/initdb" ]]; then PGBIN="$d"; break; fi
    done
  fi
  if [[ -z "${PGBIN:-}" || ! -x "$PGBIN/initdb" || ! -x "$PGBIN/pg_ctl" ]]; then
    fail "DATABASE_URL is set but PGBIN does not resolve to PostgreSQL 16 binaries (initdb, pg_ctl): export PGBIN (e.g. /opt/homebrew/opt/postgresql@16/bin) or unset DATABASE_URL"
  fi
  export PGBIN
  note "PGBIN=$PGBIN"
fi
# Test hook for scripts/gate.test.sh (not for normal use): stop after the path and environment checks, before any build.
if [[ -n "${GATE_STOP_AFTER_CHECKS:-}" ]]; then echo "GATE STOP (test hook)"; exit 0; fi

# ---------- what changed --------------------------------------------------------------------------------------------
CRATES="$(grep -oE '^crates/[^/]+' <<<"$CHANGED" | cut -d/ -f2 | sort -u || true)"
WORKSPACE_WIDE=0; grep -qE '^(Cargo\.toml|Cargo\.lock|rust-toolchain\.toml|\.cargo/)' <<<"$CHANGED" && WORKSPACE_WIDE=1
has() { grep -qE "$1" <<<"$CHANGED"; }

PG=0
if [[ -n "${DATABASE_URL:-}" ]]; then PG=1; else export RH_SKIP_PG_TESTS=1; fi

csharp() {
  if command -v dotnet >/dev/null 2>&1; then
    run "C# net library tests" dotnet test client-unity/RoguehallaNet.Tests
    run "Unity copy of the net library is current" bash client-unity/sync-net.sh --check
  else
    SKIPPED+=("dotnet (install the .NET 8 SDK)")
  fi
}
jsvectors() {
  run "JS decoder vs golden vectors" node tools/protocol-js/check-vectors.mjs
  run "JS first-playable checks" node tools/protocol-js/check-first-playable.mjs
}
sim_tests() { run "rh-sim suite (trusted-status-probes, as CI)" cargo test --locked -p rh-sim --features trusted-status-probes; }

run "rustfmt" cargo fmt --all -- --check

if [[ "$MODE" == quick ]]; then
  if ((WORKSPACE_WIDE)); then CRATES="$(ls crates)"; fi
  for c in $CRATES; do
    [[ -f "crates/$c/Cargo.toml" ]] || continue
    run "clippy $c (all features)" cargo clippy --locked -p "$c" --all-targets --all-features -- -D warnings
    if [[ "$c" == rh-sim ]]; then sim_tests; else run "tests $c" cargo test --locked -p "$c"; fi
    if ((PG)) && [[ "$c" == rh-server ]]; then run "rh-server Postgres suite" cargo test --locked -p rh-server --features postgres; fi
    if ((PG)) && [[ "$c" == rh-placement ]]; then run "rh-placement Postgres suite" cargo test --locked -p rh-placement --features postgres,fault-injection; fi
  done
  if has '^crates/(rh-sim|rh-parity|rh-policy)/|^parity/'; then run "parity report" cargo run -q --locked -p rh-parity --bin parity-report; fi
  if has '^crates/rh-protocol/|^protocol/fixtures/|^tools/protocol-js/'; then jsvectors; fi
  if has '^client-unity/RoguehallaNet|^protocol/fixtures/'; then csharp; fi
  if ! ((PG)) && grep -qE '^(rh-server|rh-persist|rh-placement)$' <<<"$CRATES"; then SKIPPED+=("Postgres suites (no DATABASE_URL)"); fi
  [[ -n "$CRATES" ]] || note "no Rust crate changed: only fmt and area checks ran"
  echo; echo "GATE PASS (quick)${SKIPPED:+ — skipped: ${SKIPPED[*]}}"; echo "log: $LOG"
  exit 0
fi

# ---------- full ----------------------------------------------------------------------------------------------------
run "clippy workspace (all features)" cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
run "clippy workspace (default features)" cargo clippy --locked --workspace --all-targets -- -D warnings
run "workspace tests except rh-sim" cargo test --locked --workspace --exclude rh-sim
sim_tests
if ((PG)); then
  run "rh-server Postgres suite" cargo test --locked -p rh-server --features postgres
  run "rh-placement Postgres suite" cargo test --locked -p rh-placement --features postgres,fault-injection
else
  SKIPPED+=("Postgres suites (no DATABASE_URL)")
fi
run "parity report (Rust vs captured legacy)" cargo run -q --locked -p rh-parity --bin parity-report
jsvectors
csharp
run "headless smoke (seed1, 8 bots)" cargo run -q --release --locked -p rh-headless -- --matches 1 --players 8 \
  --map parity/maps/seed1.map.json --max-ticks 4000

echo
echo "Not run here (CI or owner hardware only): source-witness capture checks (tools/*/capture.sh --check, Node 22.23.4"
echo "and Docker on Linux), perfproof (valgrind), cross-architecture determinism, browser proof, Unity Web build."
echo "GATE PASS (full)${SKIPPED:+ — skipped: ${SKIPPED[*]}}"
echo "log: $LOG"
