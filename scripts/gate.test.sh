#!/usr/bin/env bash
# Checks for the gate's own rules (oracle/stub rule, Postgres environment preflight). Runs on a temporary git repository
# and never builds the workspace: it uses the gate's test hook GATE_STOP_AFTER_CHECKS=1, which makes the gate exit 42
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
if [[ $rc -eq 42 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "stub-only file may change"; else bad "stub-only file may change (rc=$rc)" "$out"; fi

rc=0; out="$(try packet/X tests/oracle.rs --quick --base main --oracle packet/X)" || rc=$?
if [[ $rc -ne 0 && "$out" == *"oracle files changed"* && "$out" == *"tests/oracle.rs"* ]]; then ok "oracle-commit file may not change"; else bad "oracle-commit file may not change (rc=$rc)" "$out"; fi

rc=0; out="$(try packet/X src/mixed.rs --quick --base main --oracle packet/X)" || rc=$?
if [[ $rc -ne 0 && "$out" == *"oracle files changed"* && "$out" == *"src/mixed.rs"* ]]; then ok "file touched by a stub and an oracle commit may not change"; else bad "mixed file may not change (rc=$rc)" "$out"; fi

rc=0; out="$(try packet/X src/free.rs --quick --base main --oracle packet/X)" || rc=$?
if [[ $rc -eq 42 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "file no packet commit touched may change"; else bad "untouched file may change (rc=$rc)" "$out"; fi

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
if [[ $rc -eq 42 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "DATABASE_URL with a usable PGBIN passes the preflight"; else bad "usable PGBIN (rc=$rc)" "$out"; fi

# Without DATABASE_URL the preflight does not apply.
rc=0; out="$(env -u DATABASE_URL GATE_STOP_AFTER_CHECKS=1 PGBIN=/nonexistent/pg/bin bash scripts/gate.sh --quick --base main 2>&1)" || rc=$?
if [[ $rc -eq 42 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "no DATABASE_URL: no Postgres preflight"; else bad "no DATABASE_URL (rc=$rc)" "$out"; fi

# Cluster cleanup: only clusters whose owner file holds this run's id are stopped (stub pg_ctl, no Postgres started);
# the one DATABASE_URL points at is skipped, and a cluster whose stop fails is left in place and named.
CT="$TMP/ct"
mkdir -p "$CT" "$TMP/stubbin"
printf '#!/bin/sh\necho "$@" >>"%s/pg_ctl.log"\ncase "$*" in *failme*) exit 1 ;; esac\nexit 0\n' "$CT" >"$TMP/stubbin/pg_ctl"
printf '#!/bin/sh\n' >"$TMP/stubbin/initdb"
chmod +x "$TMP/stubbin/pg_ctl" "$TMP/stubbin/initdb"
mkcluster() { # <name> <owner or -> <port>
  mkdir -p "$CT/rh-pgtest.$1/data"
  printf '1\n/x\n0\n%s\n' "$3" >"$CT/rh-pgtest.$1/data/postmaster.pid"
  if [[ "$2" != - ]]; then echo "$2" >"$CT/rh-pgtest.$1/owner"; fi
}
mkcluster mine RUN1 5001; mkcluster other RUN2 5002; mkcluster noowner - 5003; mkcluster dburl RUN1 5004; mkcluster failme RUN1 5005
rc=0; out="$(TMPDIR="$CT" RH_PGTEST_OWNER=RUN1 GATE_STOP_AFTER_CHECKS=1 DATABASE_URL=postgres://x@127.0.0.1:5004/postgres PGBIN="$TMP/stubbin" bash scripts/gate.sh --quick --base main 2>&1)" || rc=$?
log="$(cat "$CT/pg_ctl.log" 2>/dev/null || true)"
if [[ $rc -eq 42 && ! -d "$CT/rh-pgtest.mine" && -d "$CT/rh-pgtest.other" && -d "$CT/rh-pgtest.noowner" && -d "$CT/rh-pgtest.dburl" \
  && -d "$CT/rh-pgtest.failme" && "$log" == *rh-pgtest.mine* && "$log" != *rh-pgtest.other* && "$log" != *rh-pgtest.noowner* \
  && "$log" != *rh-pgtest.dburl* && "$out" == *"could not stop rh-pgtest cluster"*failme* ]]; then
  ok "cleanup stops only this run's clusters, skips DATABASE_URL's, keeps a cluster whose stop failed"
else bad "cluster cleanup (rc=$rc)" "$out"$'\n'"$log"; fi

# ---------- step order, artefact and mesh-colour path checks, --keep-going (P-ENV-RETRO-1) ----------------------------
# expect <label> <rc-expected|any> <rc> <out> <must-contain...>: tiny helper, never exits the test script.
git checkout -q -B work main

# --list-steps prints the full-mode order and runs nothing.
rc=0; out="$(bash scripts/gate.sh --list-steps 2>&1)" || rc=$?
prev=0 order_ok=1 missing=""
for pat in "path checks" "rustfmt" "Unity tool tests" "JS decoder vs golden" "reload-proof" "C# net library tests" \
  "Unity copy of the net library" "clippy workspace (all features)" "workspace tests except rh-sim" "rh-sim suite" \
  "Postgres suite" "parity report" "Unity EditMode" "headless smoke"; do
  n="$(grep -nF -- "$pat" <<<"$out" | head -n 1 | cut -d: -f1 || true)"
  if [[ -z "$n" ]]; then order_ok=0; missing="$missing [$pat]"; continue; fi
  if ((n <= prev)); then order_ok=0; missing="$missing [$pat out of order]"; fi
  prev=$n
done
if [[ $rc -eq 0 && $order_ok -eq 1 && "$out" != *"GATE PASS"* && "$out" != *"== "* ]]; then ok "--list-steps prints the full-mode order without running anything"
else bad "--list-steps order (rc=$rc;$missing)" "$out"; fi

# newfile <path> <content>: add a new file on a fresh branch off main, commit, run the gate checks (test hook).
newfile() {
  local file="$1" content="$2"; shift 2
  git checkout -q -B work main
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$content" >"$file"
  git add -A; git commit -q -m "work"
  GATE_STOP_AFTER_CHECKS=1 bash scripts/gate.sh --quick --base main "$@" 2>&1
}
UA=client-unity/UnityProject/Assets
for art in "$UA/Resources/Showcase/NunitoBold.asset" "$UA/Scripts/BakedContent.cs" "client-unity/UnityProject/ProjectSettings/ShaderGraphSettings.asset"; do
  rc=0; out="$(newfile "$art" "x")" || rc=$?
  if [[ $rc -ne 0 && $rc -ne 42 && "$out" == *"$art"* && "$out" == *"--allow-artefacts"* ]]; then ok "artefact in the diff fails by name: $(basename "$art")"
  else bad "artefact $art (rc=$rc)" "$out"; fi
  rc=0; out="$(newfile "$art" "x" --allow-artefacts)" || rc=$?
  if [[ $rc -eq 42 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "artefact passes with --allow-artefacts: $(basename "$art")"
  else bad "artefact allowed $art (rc=$rc)" "$out"; fi
done

# Mesh colours: added lines in a C# file under Assets/Scripts.
rc=0; out="$(newfile "$UA/Scripts/Presentation/NewPresenter.cs" 'mesh.SetColors(colors);')" || rc=$?
if [[ $rc -ne 0 && $rc -ne 42 && "$out" == *"NewPresenter.cs"* && "$out" == *"SrgbMeshColors"* ]]; then ok "raw SetColors( in a new file fails naming the file and SrgbMeshColors"
else bad "SetColors new file (rc=$rc)" "$out"; fi
for snippet in 'mesh.colors32 = c;' 'mesh.colors = c;'; do
  rc=0; out="$(newfile "$UA/Scripts/Other.cs" "$snippet")" || rc=$?
  if [[ $rc -ne 0 && $rc -ne 42 && "$out" == *"Other.cs"* && "$out" == *"SrgbMeshColors"* ]]; then ok "raw '$snippet' fails"
  else bad "raw $snippet (rc=$rc)" "$out"; fi
done
for f in Presentation/SrgbMeshColors.cs WeaponRangePresenter.cs HitZonePresenter.cs CampPatienceOutlines.cs; do
  rc=0; out="$(newfile "$UA/Scripts/$f" 'mesh.SetColors(colors);')" || rc=$?
  if [[ $rc -eq 42 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "approved file may upload colours: $f"
  else bad "approved $f (rc=$rc)" "$out"; fi
done
# Unity UI code: button.colors = ... is not a vertex-colour upload.
rc=0; out="$(newfile "$UA/Scripts/UI/Menu.cs" 'button.colors = colors;')" || rc=$?
if [[ $rc -eq 42 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "UI button.colors = is allowed"; else bad "button.colors (rc=$rc)" "$out"; fi
rc=0; out="$(newfile "$UA/Scripts/Other2.cs" 'm.mesh.colors = c;')" || rc=$?
if [[ $rc -ne 0 && $rc -ne 42 && "$out" == *"Other2.cs"* ]]; then ok "mesh.colors = still fails"; else bad "mesh.colors (rc=$rc)" "$out"; fi
# A large diff (about 600 KB added, one offending line near the start) must fail on every run (no SIGPIPE miss).
git checkout -q -B work main
mkdir -p "$UA/Scripts"; printf 'int x;\n' >"$UA/Scripts/Big.cs"; git add -A; git commit -q -m "big base"
git checkout -q -B bigbase work
{ printf 'int x;\nmesh.SetColors(c);\n'; for i in $(seq 1 20000); do printf 'int filler_%05d = %05d; // padding\n' "$i" "$i"; done; } >"$UA/Scripts/Big.cs"
git commit -q -am "big edit"
misses=0
for i in $(seq 1 20); do
  rc=0; out="$(GATE_STOP_AFTER_CHECKS=1 bash scripts/gate.sh --quick --base bigbase~1 2>&1)" || rc=$?
  [[ $rc -ne 0 && $rc -ne 42 && "$out" == *"Big.cs"* ]] || misses=$((misses + 1))
done
if ((misses == 0)); then ok "a large added diff with one raw SetColors( fails on all 20 runs"; else bad "large diff missed $misses of 20 runs"; fi
git checkout -q -B work main

# Only added lines are judged: an untouched existing line does not fail an unrelated edit.
git checkout -q -B work main
mkdir -p "$UA/Scripts"; printf 'mesh.SetColors(old);\n' >"$UA/Scripts/Old.cs"; git add -A; git commit -q -m "old"
git checkout -q -B base2 work
printf '// comment\n' >>"$UA/Scripts/Old.cs"; git commit -q -am "edit"
rc=0; out="$(GATE_STOP_AFTER_CHECKS=1 bash scripts/gate.sh --quick --base base2~1 2>&1)" || rc=$?
if [[ $rc -eq 42 && "$out" == *"GATE STOP (test hook)"* ]]; then ok "an untouched existing SetColors( line is not judged"
else bad "existing SetColors line (rc=$rc)" "$out"; fi
git checkout -q -B work main

# --keep-going, with the test hook GATE_TEST_STEPS (lines "name::shell command") replacing the step list.
kg() { # <steps> <gate args...>
  local steps="$1"; shift
  GATE_TEST_STEPS="$steps" bash scripts/gate.sh --base main "$@" 2>&1
}
two=$'alpha::echo a-out; exit 1\nbeta::echo b-out; exit 1\ngamma::echo fine'
rc=0; out="$(kg "$two" --keep-going)" || rc=$?
if [[ $rc -eq 1 && "$out" == *"GATE TEST-HOOK FAIL (2 steps): alpha; beta"* && "$out" == *"a-out"* && "$out" == *"b-out"* && "$out" != *"GATE PASS"* && "$out" != *"GATE FAIL"* ]]; then ok "--keep-going reports two failing steps, exit 1, no PASS"
else bad "keep-going two failures (rc=$rc)" "$out"; fi

one=$'alpha::echo a-out; exit 1\ngamma::echo fine'
rc=0; out="$(kg "$one" --keep-going)" || rc=$?
if [[ $rc -eq 1 && "$out" == *"GATE TEST-HOOK FAIL (1 step"* && "$out" == *"alpha"* && "$out" == *"== gamma"* && "$out" != *"GATE PASS"* ]]; then ok "--keep-going: a failing step then a passing one reports one failure"
else bad "keep-going one failure (rc=$rc)" "$out"; fi

rc=0; out="$(kg $'gamma::echo fine\ndelta::echo fine2' --keep-going)" || rc=$?
if [[ "$out" == *"GATE TEST-HOOK PASS"* && "$out" != *"GATE PASS"* && "$out" != *"GATE FAIL"* && $rc -ne 1 && $rc -ne 0 ]]; then ok "--keep-going with no failure prints GATE TEST-HOOK PASS (never a plain GATE PASS)"
else bad "keep-going none (rc=$rc)" "$out"; fi

rc=0; out="$(kg "$two")" || rc=$?
if [[ $rc -eq 1 && "$out" == *"GATE FAIL: alpha"* && "$out" != *"== beta"* && "$out" != *"== gamma"* && "$out" != *"GATE PASS"* ]]; then ok "without --keep-going the first failing step ends the run"
else bad "fail fast (rc=$rc)" "$out"; fi

echo
echo "$PASSES passed, $FAILS failed"
[[ $FAILS -eq 0 ]]
