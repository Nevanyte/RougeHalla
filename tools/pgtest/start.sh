#!/usr/bin/env bash
# Starts a THROWAWAY PostgreSQL cluster (temp dir, free port, unix socket in the temp dir, trust auth on 127.0.0.1)
# and prints `export DATABASE_URL=...`. Use: eval "$(tools/pgtest/start.sh)"   Stop: tools/pgtest/stop.sh
# Postgres refuses to run as root: when run as root this creates/uses the OS user `pgtest` and runs the cluster as it.
set -euo pipefail

# Empty arrays under `set -u` fail on the Bash 3.2 shipped with macOS.
# Keep the same root/non-root execution paths without an optional array prefix.
run_pg() {
  if [ "$(id -u)" = 0 ]; then
    runuser -u pgtest -- "$@"
  else
    "$@"
  fi
}

if [ -z "${PGBIN:-}" ]; then
  if [ -x /opt/homebrew/opt/postgresql@16/bin/initdb ]; then
    PGBIN=/opt/homebrew/opt/postgresql@16/bin
  else
    PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  fi
fi
[ -x "$PGBIN/initdb" ] || { echo "postgres binaries not found (set PGBIN)" >&2; exit 1; }

# Without a valid locale PostgreSQL 16 on macOS stops with "postmaster became multithreaded during startup".
if [ -z "${LC_ALL:-}" ]; then
  for loc in en_US.UTF-8 C.UTF-8; do
    if locale -a 2>/dev/null | grep -qxF "$loc"; then LC_ALL="$loc"; break; fi
  done
  export LC_ALL="${LC_ALL:-C}"
fi

STATE_DIR="${RH_PGTEST_STATE:-${TMPDIR:-/tmp}/rh-pgtest-state}"
mkdir -p "$STATE_DIR"
if [ -f "$STATE_DIR/dir" ] && run_pg "$PGBIN/pg_ctl" status -D "$(cat "$STATE_DIR/dir")/data" >/dev/null 2>&1; then
  echo "export DATABASE_URL=$(cat "$STATE_DIR/url")"
  exit 0
fi

if [ "$(id -u)" = 0 ]; then
  id pgtest >/dev/null 2>&1 || useradd -m -s /bin/bash pgtest
  DIR="$(mktemp -d /tmp/rh-pgtest.XXXXXX)"
  chown pgtest "$DIR"
else
  DIR="$(mktemp -d "${TMPDIR:-/tmp}/rh-pgtest.XXXXXX")"
fi
chmod 755 "$STATE_DIR"

# A free TCP port.
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"

run_pg "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust -E UTF8 >"$DIR/initdb.log" 2>&1
run_pg "$PGBIN/pg_ctl" -D "$DIR/data" -l "$DIR/postgres.log" -w \
  -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=300" \
  start >/dev/null

URL="postgres://postgres@127.0.0.1:$PORT/postgres"
echo "$DIR" >"$STATE_DIR/dir"
echo "$URL" >"$STATE_DIR/url"
echo "export DATABASE_URL=$URL"
