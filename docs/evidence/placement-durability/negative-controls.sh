#!/usr/bin/env bash
# Negative controls for the durable placement ledger. For the unchanged control and each mutant (a RUNTIME switch read from
# RH_PLACEMENT_MUTANT by the library and by the crash child, so the build is identical) this runs the PostgreSQL test sets and
# prints PASS/FAIL per set. The control must pass everywhere; every mutant must fail at least one set on a BEHAVIOURAL
# assertion (a failed test result; a compile error or a hang does not count). Exit status 0 only when both hold.
# Needs a toolchain on PATH and PostgreSQL (tools/pgtest); it never prints DATABASE_URL.
set -u
cd "$(dirname "$0")/../../.."
if [ -z "${DATABASE_URL:-}" ]; then eval "$(tools/pgtest/start.sh)"; fi
SETS="${SETS:-crash_restart delayed_effects placement_durable ledger_conformance_postgres}"
MUTANTS="none skip_write_ahead skip_ownership_check skip_fencing premature_completion"
FEATURES="postgres,fault-injection"
LOGDIR="${LOGDIR:-$(mktemp -d)}"
cargo test -p rh-placement --features "$FEATURES" --no-run >/dev/null 2>"$LOGDIR/build.log" || { echo "BUILD FAILED (see $LOGDIR/build.log)"; exit 2; }
status=0
for m in $MUTANTS; do
  detected=0
  echo "== mutant: $m"
  for s in $SETS; do
    log="$LOGDIR/$m.$s.log"
    RH_PLACEMENT_MUTANT=$m perl -e 'alarm 900; exec @ARGV' cargo test -p rh-placement --features "$FEATURES" --test "$s" >"$log" 2>&1
    rc=$?
    failed=$(grep -E '^test .* FAILED$' "$log" | sed -E 's/^test (.*) \.\.\. FAILED$/\1/' | tr '\n' ' ')
    if grep -qE '^error(\[E[0-9]+\])?: (could not compile|aborting)' "$log"; then verdict="BUILD-ERROR"
    elif [ $rc -eq 0 ]; then verdict="PASS"
    elif [ -n "$failed" ]; then verdict="FAIL"; detected=1
    else verdict="ABORT(rc=$rc, not a failed assertion)"; fi
    echo "  $s: $verdict ${failed:+[$failed]}"
    [ "$m" = none ] && [ "$verdict" != PASS ] && status=1
  done
  if [ "$m" != none ] && [ $detected -eq 0 ]; then echo "  !! mutant $m was NOT detected"; status=1; fi
done
[ $status -eq 0 ] && echo "RESULT: control passes, every mutant detected" || echo "RESULT: NEGATIVE CONTROLS NOT SATISFIED"
echo "logs: $LOGDIR"
exit $status
