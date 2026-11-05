#!/usr/bin/env bash
# Exercise the real helper lifecycle in an isolated state directory, as root or a normal user.
set -euo pipefail
[ -n "${PGBIN:-}" ] || { echo "Set PGBIN to the PostgreSQL bin directory" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
export RH_PGTEST_STATE="$(mktemp -d "${TMPDIR:-/tmp}/rh-pgtest-smoke.XXXXXX")"
cleanup() {
  if [ -f "$RH_PGTEST_STATE/dir" ]; then "$BASH" "$here/stop.sh" >/dev/null; fi
  rmdir "$RH_PGTEST_STATE"
}
trap cleanup EXIT
first="$("$BASH" "$here/start.sh")"
cluster="$(cat "$RH_PGTEST_STATE/dir")"
pid="$(head -1 "$cluster/data/postmaster.pid")"
second="$("$BASH" "$here/start.sh")"
[ "$first" = "$second" ]
[ "$pid" = "$(head -1 "$cluster/data/postmaster.pid")" ]
eval "$second"
[ "$("$PGBIN/psql" "$DATABASE_URL" -Atc 'select 42')" = 42 ]
"$BASH" "$here/stop.sh" >/dev/null
[ ! -e "$RH_PGTEST_STATE/dir" ] && [ ! -e "$RH_PGTEST_STATE/url" ]
if kill -0 "$pid" 2>/dev/null; then
  echo "PostgreSQL is still running after stop" >&2
  exit 1
fi
echo "pgtest start/query/reuse URL and PID/stop/cleanup passed (uid $(id -u))"
