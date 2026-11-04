#!/usr/bin/env bash
# Starts a THROWAWAY PostgreSQL cluster (temp dir, free port, unix socket in the temp dir, trust auth on 127.0.0.1)
# and prints `export DATABASE_URL=...`. Use: eval "$(tools/pgtest/start.sh)"   Stop: tools/pgtest/stop.sh
# Postgres refuses to run as root: when run as root this creates/uses the OS user `pgtest` and runs the cluster as it.
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "postgres binaries not found (set PGBIN)" >&2; exit 1; }

STATE_DIR="${RH_PGTEST_STATE:-${TMPDIR:-/tmp}/rh-pgtest-state}"
mkdir -p "$STATE_DIR"
if [ -f "$STATE_DIR/dir" ] && "$PGBIN/pg_ctl" status -D "$(cat "$STATE_DIR/dir")/data" >/dev/null 2>&1; then
  echo "export DATABASE_URL=$(cat "$STATE_DIR/url")"
  exit 0
fi

if [ "$(id -u)" = 0 ]; then
  id pgtest >/dev/null 2>&1 || useradd -m -s /bin/bash pgtest
  RUN=(runuser -u pgtest --)
  DIR="$(mktemp -d /tmp/rh-pgtest.XXXXXX)"
  chown pgtest "$DIR"
else
  RUN=()
  DIR="$(mktemp -d "${TMPDIR:-/tmp}/rh-pgtest.XXXXXX")"
fi
chmod 755 "$STATE_DIR"

# A free TCP port.
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"

"${RUN[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust -E UTF8 >"$DIR/initdb.log" 2>&1
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -l "$DIR/postgres.log" -w \
  -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=300" \
  start >/dev/null

URL="postgres://postgres@127.0.0.1:$PORT/postgres"
echo "$DIR" >"$STATE_DIR/dir"
echo "$URL" >"$STATE_DIR/url"
echo "export DATABASE_URL=$URL"
