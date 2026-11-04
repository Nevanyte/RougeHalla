#!/usr/bin/env bash
# Stops and deletes the throwaway cluster started by start.sh.
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
STATE_DIR="${RH_PGTEST_STATE:-${TMPDIR:-/tmp}/rh-pgtest-state}"
[ -f "$STATE_DIR/dir" ] || { echo "no pgtest cluster recorded" >&2; exit 0; }
DIR="$(cat "$STATE_DIR/dir")"
if [ "$(id -u)" = 0 ]; then RUN=(runuser -u pgtest --); else RUN=(); fi
if [ -d "$DIR/data" ]; then
  "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true
fi
case "$DIR" in /tmp/rh-pgtest.*|"${TMPDIR:-/tmp}"/rh-pgtest.*) rm -rf "$DIR" ;; esac
rm -f "$STATE_DIR/dir" "$STATE_DIR/url"
echo "stopped"
