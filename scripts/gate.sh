#!/usr/bin/env bash
# RogueHalla acceptance gate. An agent's work is done when this script says GATE PASS, not when the agent thinks so.
#
#   scripts/gate.sh --quick                     iterate: fmt, then clippy/tests/checks for the crates and areas you changed
#   scripts/gate.sh                             full local gate: everything below that runs on a Mac (the hand-off gate)
#   scripts/gate.sh --oracle packet/<ID>        also: oracle files (packet commits, captures, golden vectors, packages/) untouched
#   scripts/gate.sh --base <ref>                compare against <ref> instead of the integration branch
#   scripts/gate.sh --keep-going                run every step even after one fails; result line "GATE FAIL (n steps): a; b"
#   scripts/gate.sh --list-steps                print the full-mode step order and run nothing
#
# Exceptions (each needs the approval named in AGENTS.md "Protected paths"; say which you used in the hand-off):
#   --allow-protected   hosting/, .github/, .claude/, packages/, scripts/gate.sh, AGENTS.md/CLAUDE.md files (owner approval)
#   --coordinator       shared status records: Cargo.lock, docs/MIGRATION.md, docs/CONTRACTS.md, ... (coordinator only)
#   --regen-fixtures    protocol/fixtures/ may change (wire-format packets; regenerated only by the documented command)
#   --allow-artefacts   build artefacts may change (Showcase font assets, BakedContent.cs, ShaderGraphSettings.asset)
#
# Postgres: export DATABASE_URL (eval "$(tools/pgtest/start.sh)") to include the Postgres suites; without it they are
# skipped and the result line says so. Logs: .agent-runs/gate/. CI (.github/workflows/rust.yml) remains the final word;
# the full gate prints the CI-only checks it did not run.
set -euo pipefail

MODE=full BASE="" ORACLE="" ALLOW_PROTECTED=0 COORD=0 REGEN=0 KEEP_GOING=0 LIST=0 ARTEFACTS=0
while (($#)); do
  case "$1" in
    --quick) MODE=quick ;;
    --full) MODE=full ;;
    --base) BASE="${2:?--base needs a ref}"; shift ;;
    --oracle) ORACLE="${2:?--oracle needs a ref}"; shift ;;
    --allow-protected) ALLOW_PROTECTED=1 ;;
    --coordinator) COORD=1 ;;
    --regen-fixtures) REGEN=1 ;;
    --allow-artefacts) ARTEFACTS=1 ;;
    --keep-going) KEEP_GOING=1 ;;
    --list-steps) LIST=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)"; exit 2 ;;
  esac
  shift
done

ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
command -v cargo >/dev/null 2>&1 || export PATH="$HOME/.cargo/bin:$PATH"
command -v dotnet >/dev/null 2>&1 || { [[ -x "$HOME/.dotnet/dotnet" ]] && export PATH="$HOME/.dotnet:$PATH"; } || true

# ---------- steps ---------------------------------------------------------------------------------------------------
# Cheap checks first (seconds to minutes), then the builds. --list-steps replaces `run` with a printer and walks the
# full-mode list, so the README table and the tests are checked against the gate's own list.
csharp() {
  if ((LIST)) || command -v dotnet >/dev/null 2>&1; then
    run "C# net library tests" dotnet test client-unity/RoguehallaNet.Tests
    run "Unity copy of the net library is current" bash client-unity/sync-net.sh --check
  else
    SKIPPED+=("dotnet (install the .NET 8 SDK)")
  fi
}
jsvectors() {
  run "JS decoder vs golden vectors" node tools/protocol-js/check-vectors.mjs
  run "JS first-playable checks" node tools/protocol-js/check-first-playable.mjs
  run "JS dressing vectors" node tools/protocol-js/check-dressing.mjs
  run "JS patience and carrier vectors" node tools/protocol-js/check-map-patience.mjs
  run "JS landmark anchor vectors" node tools/protocol-js/check-map-anchors.mjs
}
reload_proof_tests() { # hand-written Welcome/Hello parsers of the browser reload proof: CI runs them (rust.yml, the JS step)
  run "browser reload-proof tests (node --test)" node --test tools/unity-browser-reload-proof/*.test.mjs
}
unity_editmode() { # exit 3 from editmode.sh = no Editor / project open: a named skip, never a pass
  local rc=0
  if ((LIST)); then echo "Unity EditMode suite"; return 0; fi
  echo "== Unity EditMode suite"
  echo "   \$ client-unity/UnityProject/Tools/editmode.sh"
  bash client-unity/UnityProject/Tools/editmode.sh >"$STEP_LOG" 2>&1 || rc=$?
  cat "$STEP_LOG" >>"$LOG"
  if ((rc == 3)); then
    note "$(tail -n 1 "$STEP_LOG")"
    SKIPPED+=("Unity EditMode (no Editor / project open)")
  elif ((rc != 0)); then
    echo "---- last 40 lines of 'Unity EditMode suite' ----"; tail -n 40 "$STEP_LOG"
    red "Unity EditMode suite"
  else
    note "$(grep -E '^editmode: total' "$STEP_LOG" | tail -n 1)"
  fi
}
# Unity tool tests that fail on the integration branch today, excluded by name (one list, with the reason).
UNITY_TOOL_TEST_EXCLUDE=(
  profile-hub14.test.cjs # pinned to the protocol 14 marker: "P14 probe codec block is unavailable" on the current codec
)
unity_tool_tests() {
  local f x skip files=()
  if ((LIST)); then run "Unity tool tests (node --test)" node --test; return 0; fi
  for f in client-unity/UnityProject/Tools/*.test.cjs; do
    [[ -e "$f" ]] || continue
    skip=0
    for x in "${UNITY_TOOL_TEST_EXCLUDE[@]}"; do [[ "$(basename "$f")" == "$x" ]] && skip=1; done
    ((skip)) || files+=("$f")
  done
  if ((${#files[@]})); then run "Unity tool tests (node --test)" node --test "${files[@]}"; fi
}
sim_tests() {
  # The content registry runs first as its own step: the suite stops at its first red test binary, and a red pin in the
  # lib tests (the hash tape the coordinator regenerates) otherwise hides an unregistered constant until the full gate
  # on the merge (integration 5, 2026-11-12).
  run "rh-sim content registry" cargo test --locked -p rh-sim --features trusted-status-probes --test content
  run "rh-sim suite (trusted-status-probes, as CI)" cargo test --locked -p rh-sim --features trusted-status-probes
}
cheap_area_checks() { unity_tool_tests; jsvectors; reload_proof_tests; csharp; } # full-mode order; quick picks by changed path
full_steps() {
  run "rustfmt" cargo fmt --all -- --check
  cheap_area_checks
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
  unity_editmode
  run "headless smoke (seed1, 8 bots)" cargo run -q --release --locked -p rh-headless -- --matches 1 --players 8 \
    --map parity/maps/seed1.map.json --max-ticks 4000
  # Tests that only run in a release build (`cfg_attr(debug_assertions, ignore)`): no other step reaches them, so a
  # packet's release-only acceptance check was run by hand or not at all (P-FROST-WALL-BOTS-1 review, 2026-11-14).
  # A new release-only test file is added to this list by the packet that adds it.
  run "release-only checks (bots in the live world)" cargo test --locked --release -p rh-headless \
    --test frost_wall_bots --test frost_wall_live --test brain_choices
}
if ((LIST)); then
  run() { echo "$1"; }
  PG=1
  echo "path checks"
  full_steps
  exit 0
fi

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
# Clusters started under this gate (by tools/pgtest/start.sh, here or in a child test) carry this run's owner id in
# <dir>/owner; on exit the gate stops only those, never another session's and never the one DATABASE_URL points at.
# (With the test hook, scripts/gate.test.sh may preset the id.)
if [[ -z "${GATE_STOP_AFTER_CHECKS:-}" || -z "${RH_PGTEST_OWNER:-}" ]]; then RH_PGTEST_OWNER="gate-$$-$(date +%s)"; fi
export RH_PGTEST_OWNER
PGT_TMP="${TMPDIR:-/tmp}"; PGT_TMP="${PGT_TMP%/}"
pgtest_dirs() { { ls -d "$PGT_TMP"/rh-pgtest.* /tmp/rh-pgtest.* 2>/dev/null || true; } | sort -u; }
cleanup() {
  rm -f "$STEP_LOG"
  local d port bin="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
  while read -r d; do
    [[ -n "$d" && -f "$d/owner" && -f "$d/data/postmaster.pid" ]] || continue
    [[ "$(cat "$d/owner" 2>/dev/null || true)" == "$RH_PGTEST_OWNER" ]] || continue
    port="$(sed -n 4p "$d/data/postmaster.pid" 2>/dev/null || true)"
    if [[ -n "$port" && "${DATABASE_URL:-}" == *":$port/"* ]]; then continue; fi
    [[ -x "$bin/pg_ctl" ]] || bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
    if "$bin/pg_ctl" -D "$d/data" -m immediate stop >/dev/null 2>&1; then
      rm -rf "$d"
      echo "gate: stopped rh-pgtest cluster started under this run: $d" >&2
    else
      echo "gate: could not stop rh-pgtest cluster $d (left in place)" >&2
    fi
  done <<<"$(pgtest_dirs)"
}
trap cleanup EXIT
exec > >(tee "$LOG") 2>&1

SKIPPED=() FAILED=() NOTRUN=() BROKEN="" TESTHOOK=""
fail() { echo; echo "GATE FAIL: $*"; echo "log: $LOG"; exit 1; }
note() { echo "   - $*"; }
red() { # a step went red: fail fast, or with --keep-going remember it and carry on
  if ((KEEP_GOING)); then FAILED+=("$1"); else fail "$1"; fi
}
run() { # run <name> <cmd...>: stop at the first red step (--keep-going: record it) and show its last 40 lines
  local name="$1"; shift
  echo "== $name"
  if [[ -n "$BROKEN" && "$1" == cargo ]]; then
    echo "   not run (after $BROKEN)"; NOTRUN+=("$name (after $BROKEN)"); return 0
  fi
  echo "   \$ $*"
  if ! "$@" >"$STEP_LOG" 2>&1; then
    cat "$STEP_LOG" >>"$LOG"
    echo "---- last 40 lines of '$name' ----"; tail -n 40 "$STEP_LOG"
    red "$name"
    # A cargo test/run step that did not compile: later cargo steps may not build either; they are "not run", never passed.
    if [[ "$1" == cargo && "$*" != *clippy* && -z "$BROKEN" ]] && grep -q 'could not compile' "$STEP_LOG"; then BROKEN="$name"; fi
    return 0
  fi
  cat "$STEP_LOG" >>"$LOG"
}
finish() { # finish <label> <exit code when green>: the one place a result line is printed
  local label="$1" okrc="$2" joined="" f n=${#FAILED[@]}
  echo
  if ((n)); then
    for f in "${FAILED[@]}"; do joined="${joined:+$joined; }$f"; done
    for f in ${NOTRUN[@]+"${NOTRUN[@]}"}; do echo "not run: $f"; done
    echo "GATE ${TESTHOOK:+TEST-HOOK }FAIL ($n step$( ((n == 1)) || echo s)): $joined"
    echo "log: $LOG"; exit 1
  fi
  if ((${#NOTRUN[@]})); then # cannot happen without a red step; never read as a pass if it does
    echo "GATE ${TESTHOOK:+TEST-HOOK }FAIL: steps not run: ${NOTRUN[*]}"; echo "log: $LOG"; exit 1
  fi
  echo "GATE ${TESTHOOK:+TEST-HOOK }PASS ($label)${SKIPPED:+ — skipped: ${SKIPPED[*]}}"; echo "log: $LOG"
  exit "$okrc"
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
# Build artefacts: build-web.sh and Unity EditMode runs rewrite these; they must never ride along in a commit by accident.
ARTEFACT_RE='^client-unity/UnityProject/Assets/Resources/Showcase/[^/]*(Cinzel|Nunito|Font|SDF)[^/]*\.asset$|(^|/)BakedContent\.cs$|^client-unity/UnityProject/ProjectSettings/ShaderGraphSettings\.asset$'
bad="$(match "$ARTEFACT_RE")"
if [[ -n "$bad" ]]; then
  ((ARTEFACTS)) || fail "build artefacts changed (restore with git checkout <base> -- <file>; --allow-artefacts only for a packet that means to change one):"$'\n'"$bad"
  note "build artefacts changed under --allow-artefacts: $(tr '\n' ' ' <<<"$bad")"
fi
# Mesh colours: the project renders in Linear colour space and Mesh.SetColors takes raw values, so sRGB constants written
# to a mesh show lifted. Only lines ADDED by this diff are judged, so untouched existing code never fails an unrelated edit.
MESH_RE='SetColors\(|\.colors32 =|[Mm]esh\.colors ='
MESH_OK_RE='/(Presentation/SrgbMeshColors|WeaponRangePresenter|HitZonePresenter|CampPatienceOutlines)\.cs$'
bad=""
while IFS= read -r f; do
  [[ -n "$f" && -f "$f" ]] || continue
  if grep -qE "$MESH_OK_RE" <<<"/$f"; then continue; fi
  if git cat-file -e "$MB:$f" 2>/dev/null; then
    # No grep -q at the end of a pipeline: it exits early, the writer gets SIGPIPE and pipefail reports a miss.
    if git diff -U0 "$MB" -- "$f" | grep -E '^\+[^+]' | grep -E "$MESH_RE" >/dev/null; then bad="$bad$f"$'\n'; fi
  elif grep -qE "$MESH_RE" "$f"; then
    bad="$bad$f"$'\n'
  fi
done < <(match '^client-unity/UnityProject/Assets/Scripts/.*\.cs$')
if [[ -n "$bad" ]]; then
  fail "vertex colours uploaded without the helper SrgbMeshColors (Presentation/SrgbMeshColors.cs converts sRGB to linear; only lines added by this diff are checked):"$'\n'"${bad%$'\n'}"
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
if git diff "$MB" -- 'crates/*.rs' | grep -E '^\+.*allow\(clippy::disallowed_(types|methods)\)' >/dev/null; then
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
# Test hook for scripts/gate.test.sh (not for normal use): stop after the path and environment checks, before any build,
# with exit 42 (never 0: a gate that built nothing must not look green).
if [[ -n "${GATE_STOP_AFTER_CHECKS:-}" ]]; then echo "GATE STOP (test hook)"; exit 42; fi

# ---------- what changed --------------------------------------------------------------------------------------------
CRATES="$(grep -oE '^crates/[^/]+' <<<"$CHANGED" | cut -d/ -f2 | sort -u || true)"
WORKSPACE_WIDE=0; grep -qE '^(Cargo\.toml|Cargo\.lock|rust-toolchain\.toml|\.cargo/)' <<<"$CHANGED" && WORKSPACE_WIDE=1
has() { grep -qE "$1" <<<"$CHANGED"; }

PG=0
if [[ -n "${DATABASE_URL:-}" ]]; then PG=1; else export RH_SKIP_PG_TESTS=1; fi

# Test hook for scripts/gate.test.sh (not for normal use): GATE_TEST_STEPS, lines "name::shell command", replaces the step
# list with those fake steps. Its result line says "test hook" and its green exit code is 43, never 0: a run of fake
# steps must not look like a real PASS.
if [[ -n "${GATE_TEST_STEPS:-}" ]]; then
  TESTHOOK=1
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    run "${line%%::*}" bash -c "${line#*::}"
  done <<<"$GATE_TEST_STEPS"
  finish "fake steps only, not a real gate result" 43
fi

if [[ "$MODE" == quick ]]; then
  run "rustfmt" cargo fmt --all -- --check
  # Same relative order as full mode: the cheap area checks first, then the crates, the parity report, EditMode.
  if has '^client-unity/UnityProject/Tools/'; then unity_tool_tests; fi
  if has '^crates/rh-protocol/|^protocol/fixtures/|^tools/protocol-js/'; then jsvectors; fi
  if has '^crates/rh-protocol/|^protocol/fixtures/|^crates/rh-server/web/|^tools/unity-browser-reload-proof/'; then reload_proof_tests; fi
  if has '^client-unity/RoguehallaNet|^protocol/fixtures/'; then csharp; fi
  if ((WORKSPACE_WIDE)); then CRATES="$(ls crates)"; fi
  for c in $CRATES; do
    [[ -f "crates/$c/Cargo.toml" ]] || continue
    run "clippy $c (all features)" cargo clippy --locked -p "$c" --all-targets --all-features -- -D warnings
    if [[ "$c" == rh-sim ]]; then sim_tests; else run "tests $c" cargo test --locked -p "$c"; fi
    if ((PG)) && [[ "$c" == rh-server ]]; then run "rh-server Postgres suite" cargo test --locked -p rh-server --features postgres; fi
    if ((PG)) && [[ "$c" == rh-placement ]]; then run "rh-placement Postgres suite" cargo test --locked -p rh-placement --features postgres,fault-injection; fi
  done
  if has '^crates/(rh-sim|rh-parity|rh-policy)/|^parity/'; then run "parity report" cargo run -q --locked -p rh-parity --bin parity-report; fi
  if has '^client-unity/UnityProject/Assets/'; then unity_editmode; fi
  if ! ((PG)) && grep -qE '^(rh-server|rh-persist|rh-placement)$' <<<"$CRATES"; then SKIPPED+=("Postgres suites (no DATABASE_URL)"); fi
  [[ -n "$CRATES" ]] || note "no Rust crate changed: only fmt and area checks ran"
  finish "quick" 0
fi

# ---------- full ----------------------------------------------------------------------------------------------------
full_steps

echo
echo "Not run here (CI or owner hardware only): source-witness capture checks (tools/*/capture.sh --check, Node 22.23.4"
echo "and Docker on Linux), perfproof (valgrind), cross-architecture determinism, browser proof, Unity Web build."
finish "full" 0
